import pg from 'pg';
import mysql from 'mysql2/promise';
import sqlite3 from 'sqlite3';
import { getSandboxDatabase } from './sandbox.js';

// Connection pools registry
const activePools = new Map();
let customDbInstance = null;

// Helper to initialize custom in-memory database
async function initCustomDatabase(ddl) {
  if (customDbInstance) {
    await new Promise((resolve) => customDbInstance.close(() => resolve()));
    customDbInstance = null;
  }
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) return reject(err);
      db.run('PRAGMA foreign_keys = ON;', (pragmaErr) => {
        if (pragmaErr) return reject(pragmaErr);
        db.exec(ddl, (execErr) => {
          if (execErr) {
            db.close();
            return reject(execErr);
          }
          resolve(db);
        });
      });
    });
  });
}

/**
 * Creates or retrieves a database connection/pool based on config.
 * @param {object} config - Connection configuration
 */
export async function getDbClient(config) {
  const { type, host, port, user, password, database, sandboxType, ddl, recreate } = config;

  if (type === 'sandbox') {
    return {
      type: 'sqlite',
      client: await getSandboxDatabase(sandboxType),
      close: async () => {} // Don't close cached sandboxes
    };
  }

  if (type === 'custom') {
    if (!customDbInstance) {
      if (!ddl) {
        throw new Error('Custom schema database is not initialized. Please apply a schema first.');
      }
      customDbInstance = await initCustomDatabase(ddl);
    } else if (ddl && recreate) {
      customDbInstance = await initCustomDatabase(ddl);
    }
    return {
      type: 'sqlite',
      client: customDbInstance,
      close: async () => {} // Managed locally
    };
  }

  const key = `${type}:${host}:${port}:${user}:${database}`;
  if (activePools.has(key)) {
    return activePools.get(key);
  }

  if (type === 'postgres') {
    const pool = new pg.Pool({
      host,
      port: parseInt(port) || 5432,
      user,
      password,
      database,
      ssl: false // User can toggle this if needed, defaults false
    });
    
    // Test connection
    const testClient = await pool.connect();
    testClient.release();

    const clientObj = {
      type: 'postgres',
      client: pool,
      close: async () => {
        await pool.end();
        activePools.delete(key);
      }
    };
    activePools.set(key, clientObj);
    return clientObj;
  }

  if (type === 'mysql') {
    const pool = mysql.createPool({
      host,
      port: parseInt(port) || 3306,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 10
    });

    // Test connection
    const connection = await pool.getConnection();
    connection.release();

    const clientObj = {
      type: 'mysql',
      client: pool,
      close: async () => {
        await pool.end();
        activePools.delete(key);
      }
    };
    activePools.set(key, clientObj);
    return clientObj;
  }

  throw new Error(`Unsupported database type: ${type}`);
}

/**
 * Runs a query on the database client.
 */
export async function runQuery(clientObj, sql, params = []) {
  const startTime = Date.now();
  
  if (clientObj.type === 'sqlite') {
    return new Promise((resolve, reject) => {
      // Check if this is a SELECT or mutation query to structure response correctly
      const isSelect = sql.trim().toUpperCase().startsWith('SELECT') || 
                       sql.trim().toUpperCase().startsWith('WITH') ||
                       sql.trim().toUpperCase().startsWith('PRAGMA') ||
                       sql.trim().toUpperCase().startsWith('EXPLAIN');
      
      if (isSelect) {
        clientObj.client.all(sql, params, (err, rows) => {
          if (err) return reject(err);
          resolve({
            rows,
            affectedRows: 0,
            executionTimeMs: Date.now() - startTime
          });
        });
      } else {
        clientObj.client.run(sql, params, function (err) {
          if (err) return reject(err);
          resolve({
            rows: [],
            affectedRows: this.changes,
            lastID: this.lastID,
            executionTimeMs: Date.now() - startTime
          });
        });
      }
    });
  }

  if (clientObj.type === 'postgres') {
    const res = await clientObj.client.query(sql, params);
    const isSelect = Array.isArray(res.rows);
    return {
      rows: isSelect ? res.rows : [],
      affectedRows: res.rowCount || 0,
      executionTimeMs: Date.now() - startTime
    };
  }

  if (clientObj.type === 'mysql') {
    const [rows, fields] = await clientObj.client.query(sql, params);
    const isSelect = Array.isArray(rows);
    return {
      rows: isSelect ? rows : [],
      affectedRows: !isSelect && rows ? rows.affectedRows : 0,
      executionTimeMs: Date.now() - startTime
    };
  }

  throw new Error(`Unknown client type: ${clientObj.type}`);
}

/**
 * Extracts schema information for active tables.
 */
export async function extractSchema(clientObj, databaseName = 'public') {
  if (clientObj.type === 'sqlite') {
    return extractSqliteSchema(clientObj.client);
  } else if (clientObj.type === 'postgres') {
    return extractPostgresSchema(clientObj.client);
  } else if (clientObj.type === 'mysql') {
    return extractMysqlSchema(clientObj.client, databaseName);
  }
}

// Internal SQLite schema reader
async function extractSqliteSchema(db) {
  const getTables = () => new Promise((res, rej) => {
    db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';", (err, rows) => {
      if (err) rej(err);
      else res(rows.map(r => r.name));
    });
  });

  const getTableInfo = (table) => new Promise((res, rej) => {
    db.all(`PRAGMA table_info("${table}");`, (err, rows) => {
      if (err) rej(err);
      else res(rows);
    });
  });

  const getFks = (table) => new Promise((res, rej) => {
    db.all(`PRAGMA foreign_key_list("${table}");`, (err, rows) => {
      if (err) rej(err);
      else res(rows);
    });
  });

  const tables = await getTables();
  const schema = [];

  for (const table of tables) {
    const columnsInfo = await getTableInfo(table);
    const fks = await getFks(table);

    const columns = columnsInfo.map(c => ({
      name: c.name,
      type: c.type.toUpperCase(),
      nullable: c.notnull === 0,
      isPrimary: c.pk > 0,
      defaultValue: c.dflt_value
    }));

    const foreignKeys = fks.map(f => ({
      column: f.from,
      referencedTable: f.table,
      referencedColumn: f.to
    }));

    schema.push({
      table,
      columns,
      foreignKeys
    });
  }

  return schema;
}

// Internal Postgres schema reader
async function extractPostgresSchema(pool) {
  // Get columns and types
  const colsRes = await pool.query(`
    SELECT 
      table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position;
  `);

  // Get primary keys
  const pkRes = await pool.query(`
    SELECT
      kcu.table_name,
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = 'public';
  `);

  // Get foreign keys
  const fkRes = await pool.query(`
    SELECT
      kcu.table_name AS source_table,
      kcu.column_name AS source_column,
      ccu.table_name AS target_table,
      ccu.column_name AS target_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public';
  `);

  const pks = new Set(pkRes.rows.map(r => `${r.table_name}.${r.column_name}`));
  const fksMap = new Map();
  fkRes.rows.forEach(r => {
    if (!fksMap.has(r.source_table)) fksMap.set(r.source_table, []);
    fksMap.get(r.source_table).push({
      column: r.source_column,
      referencedTable: r.target_table,
      referencedColumn: r.target_column
    });
  });

  const schemaMap = new Map();
  colsRes.rows.forEach(row => {
    const { table_name, column_name, data_type, is_nullable, column_default } = row;
    if (!schemaMap.has(table_name)) {
      schemaMap.set(table_name, {
        table: table_name,
        columns: [],
        foreignKeys: fksMap.get(table_name) || []
      });
    }
    schemaMap.get(table_name).columns.push({
      name: column_name,
      type: data_type.toUpperCase(),
      nullable: is_nullable === 'YES',
      isPrimary: pks.has(`${table_name}.${column_name}`),
      defaultValue: column_default
    });
  });

  return Array.from(schemaMap.values());
}

// Internal MySQL schema reader
async function extractMysqlSchema(pool, databaseName) {
  const [cols] = await pool.execute(`
    SELECT 
      TABLE_NAME as table_name, 
      COLUMN_NAME as column_name, 
      DATA_TYPE as data_type, 
      IS_NULLABLE as is_nullable, 
      COLUMN_DEFAULT as column_default,
      COLUMN_KEY as column_key
    FROM information_schema.columns
    WHERE table_schema = ?
    ORDER BY table_name, ordinal_position;
  `, [databaseName]);

  const [fks] = await pool.execute(`
    SELECT
      TABLE_NAME AS source_table,
      COLUMN_NAME AS source_column,
      REFERENCED_TABLE_NAME AS target_table,
      REFERENCED_COLUMN_NAME AS target_column
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE table_schema = ? AND REFERENCED_TABLE_NAME IS NOT NULL;
  `, [databaseName]);

  const fksMap = new Map();
  fks.forEach(r => {
    if (!fksMap.has(r.source_table)) fksMap.set(r.source_table, []);
    fksMap.get(r.source_table).push({
      column: r.source_column,
      referencedTable: r.target_table,
      referencedColumn: r.target_column
    });
  });

  const schemaMap = new Map();
  cols.forEach(row => {
    const { table_name, column_name, data_type, is_nullable, column_default, column_key } = row;
    if (!schemaMap.has(table_name)) {
      schemaMap.set(table_name, {
        table: table_name,
        columns: [],
        foreignKeys: fksMap.get(table_name) || []
      });
    }
    schemaMap.get(table_name).columns.push({
      name: column_name,
      type: data_type.toUpperCase(),
      nullable: is_nullable === 'YES',
      isPrimary: column_key === 'PRI',
      defaultValue: column_default
    });
  });

  return Array.from(schemaMap.values());
}
