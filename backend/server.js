import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';
import { getDbClient, runQuery, extractSchema } from './db.js';
import { generateSqlFromPrompt } from './ai.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Initialize History Database
const historyDbFile = path.join(__dirname, 'history.db');
const historyDb = new sqlite3.Database(historyDbFile, (err) => {
  if (err) {
    console.error('Error opening history database:', err);
  } else {
    historyDb.run(`
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prompt TEXT,
        query TEXT,
        db_type TEXT,
        sandbox_type TEXT,
        timestamp TEXT,
        rows_affected INTEGER,
        execution_time_ms INTEGER,
        is_starred INTEGER DEFAULT 0
      );
    `);
  }
});

// Run statement helper for history
function runHistory(sql, params = []) {
  return new Promise((resolve, reject) => {
    historyDb.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// All rows helper for history
function allHistory(sql, params = []) {
  return new Promise((resolve, reject) => {
    historyDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// 1. Connect and test database credentials
app.post('/api/connect', async (req, res) => {
  try {
    const config = req.body;
    if (!config.type) {
      return res.status(400).json({ success: false, error: 'Database type is required' });
    }
    
    const clientObj = await getDbClient(config);
    // If successful, extract table count
    const schema = await extractSchema(clientObj, config.database);
    
    res.json({
      success: true,
      message: `Connected successfully to ${config.type === 'sandbox' ? config.sandboxType + ' sandbox' : config.type === 'custom' ? 'custom schema' : config.type}`,
      tableCount: schema.length
    });
  } catch (err) {
    console.error('Database connection test failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Retrieve database schema metadata
app.post('/api/schema', async (req, res) => {
  try {
    const config = req.body;
    const clientObj = await getDbClient(config);
    const schema = await extractSchema(clientObj, config.database);
    res.json({ success: true, schema });
  } catch (err) {
    console.error('Schema extraction failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Generate SQL from natural language prompt
app.post('/api/generate-sql', async (req, res) => {
  try {
    const { prompt, schema, dbType } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'Prompt is required' });
    }
    // API key is read securely from server environment — never from the client
    const apiKey = process.env.GEMINI_API_KEY || '';
    const analysis = await generateSqlFromPrompt({ prompt, schema, dbType, apiKey });
    res.json({ success: true, ...analysis });
  } catch (err) {
    console.error('AI generation failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Execute custom/generated SQL query
app.post('/api/execute', async (req, res) => {
  try {
    const { sql, config, prompt } = req.body;
    if (!sql) {
      return res.status(400).json({ success: false, error: 'SQL query is required' });
    }

    const clientObj = await getDbClient(config);
    const result = await runQuery(clientObj, sql);

    // Save to history async (don't block execution API response)
    const timestamp = new Date().toISOString();
    const dbType = config.type;
    const sandboxType = config.type === 'sandbox' ? config.sandboxType : null;
    
    runHistory(`
      INSERT INTO history (prompt, query, db_type, sandbox_type, timestamp, rows_affected, execution_time_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      prompt || 'Direct Query Execution',
      sql,
      dbType,
      sandboxType,
      timestamp,
      result.affectedRows || 0,
      result.executionTimeMs
    ]).catch(histErr => console.error('Failed to log history:', histErr));

    res.json({
      success: true,
      rows: result.rows,
      affectedRows: result.affectedRows,
      executionTimeMs: result.executionTimeMs
    });
  } catch (err) {
    console.error('SQL execution failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});



// 6. Fetch query execution history
app.get('/api/history', async (req, res) => {
  try {
    const rows = await allHistory(`
      SELECT * FROM history 
      ORDER BY datetime(timestamp) DESC 
      LIMIT 100;
    `);
    res.json({ success: true, history: rows });
  } catch (err) {
    console.error('Failed to fetch history:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Toggle query star state
app.post('/api/history/star', async (req, res) => {
  try {
    const { id, isStarred } = req.body;
    await runHistory('UPDATE history SET is_starred = ? WHERE id = ?', [isStarred ? 1 : 0, id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to toggle star state:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Clear all query history
app.post('/api/history/clear', async (req, res) => {
  try {
    await runHistory('DELETE FROM history;');
    res.json({ success: true, message: 'History cleared successfully.' });
  } catch (err) {
    console.error('Failed to clear history:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Sequel backend running on http://localhost:${PORT}`);
});
