import sqlite3 from 'sqlite3';

// Cache for active sandbox DB connections
const sandboxConnections = new Map();

/**
 * Creates and seeds an in-memory SQLite database for a specific sandbox type.
 * @param {string} type - 'hr', 'university', or 'ecommerce'
 * @returns {Promise<sqlite3.Database>}
 */
export function getSandboxDatabase(type) {
  if (sandboxConnections.has(type)) {
    return Promise.resolve(sandboxConnections.get(type));
  }

  return new Promise((resolve, reject) => {
    // Use an in-memory database
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) return reject(err);
      
      // Enable foreign keys
      db.run('PRAGMA foreign_keys = ON;', async (pragmaErr) => {
        if (pragmaErr) return reject(pragmaErr);
        
        try {
          if (type === 'hr') {
            await seedHRDatabase(db);
          } else if (type === 'university') {
            await seedUniversityDatabase(db);
          } else if (type === 'ecommerce') {
            await seedEcommerceDatabase(db);
          } else {
            return reject(new Error(`Unknown sandbox type: ${type}`));
          }
          
          sandboxConnections.set(type, db);
          resolve(db);
        } catch (seedErr) {
          reject(seedErr);
        }
      });
    });
  });
}

/**
 * Resets a sandbox database to its default state.
 */
export async function resetSandboxDatabase(type) {
  const db = sandboxConnections.get(type);
  if (db) {
    await new Promise((resolve) => db.close(resolve));
    sandboxConnections.delete(type);
  }
  return getSandboxDatabase(type);
}

// Run statement helper that returns a Promise
function runAsync(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// HR Database Seeding
async function seedHRDatabase(db) {
  await runAsync(db, `
    CREATE TABLE departments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      department_name TEXT NOT NULL,
      manager_id INTEGER,
      location TEXT NOT NULL
    );
  `);

  await runAsync(db, `
    CREATE TABLE employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone_number TEXT,
      hire_date TEXT NOT NULL,
      salary REAL NOT NULL,
      department_id INTEGER,
      job_title TEXT NOT NULL,
      FOREIGN KEY(department_id) REFERENCES departments(id)
    );
  `);

  // Insert Departments
  await runAsync(db, `
    INSERT INTO departments (id, department_name, manager_id, location) VALUES
    (1, 'Executive', 1, 'New York'),
    (2, 'IT Development', 3, 'San Francisco'),
    (3, 'Sales & Marketing', 5, 'Chicago'),
    (4, 'Human Resources', 8, 'New York'),
    (5, 'Finance', 9, 'Boston');
  `);

  // Insert Employees
  const employees = [
    [1, 'Alice', 'Smith', 'alice.smith@company.com', '555-0101', '2020-01-15', 145000, 1, 'CEO'],
    [2, 'Bob', 'Jones', 'bob.jones@company.com', '555-0102', '2021-03-22', 95000, 2, 'Senior Developer'],
    [3, 'Charlie', 'Brown', 'charlie.brown@company.com', '555-0103', '2019-06-10', 120000, 2, 'IT Director'],
    [4, 'Diana', 'Prince', 'diana.prince@company.com', '555-0104', '2022-11-01', 85000, 2, 'QA Engineer'],
    [5, 'Evan', 'Wright', 'evan.wright@company.com', '555-0105', '2020-08-14', 110000, 3, 'Sales VP'],
    [6, 'Fiona', 'Gallagher', 'fiona.g@company.com', '555-0106', '2023-02-18', 62000, 3, 'Sales Associate'],
    [7, 'George', 'Costanza', 'george.c@company.com', '555-0107', '2021-09-01', 58000, 3, 'Marketing Assistant'],
    [8, 'Harriet', 'Tubman', 'harriet.t@company.com', '555-0108', '2018-04-12', 90000, 4, 'HR Director'],
    [9, 'Irene', 'Adler', 'irene.a@company.com', '555-0109', '2020-10-05', 105000, 5, 'Finance Controller'],
    [10, 'Jack', 'Ryan', 'jack.ryan@company.com', '555-0110', '2022-05-15', 72000, 2, 'System Administrator'],
    [11, 'Karen', 'Gillan', 'karen.g@company.com', '555-0111', '2023-06-01', 48000, 4, 'HR Representative'],
    [12, 'Leo', 'Messi', 'leo.messi@company.com', '555-0112', '2024-01-10', 130000, 3, 'Brand Ambassador'],
    [13, 'Mona', 'Lisa', 'mona.lisa@company.com', '555-0113', '2021-12-25', 52000, 5, 'Accountant Specialist'],
    [14, 'Ned', 'Stark', 'ned.stark@company.com', '555-0114', '2015-05-01', 98000, 1, 'Operations COO'],
    [15, 'Oscar', 'Wilde', 'oscar.wilde@company.com', '555-0115', '2022-08-30', 67000, 3, 'Copywriter']
  ];

  for (const emp of employees) {
    await runAsync(db, `
      INSERT INTO employees (id, first_name, last_name, email, phone_number, hire_date, salary, department_id, job_title)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
    `, emp);
  }
}

// University Database Seeding
async function seedUniversityDatabase(db) {
  await runAsync(db, `
    CREATE TABLE students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      enrollment_date TEXT NOT NULL,
      cgpa REAL NOT NULL
    );
  `);

  await runAsync(db, `
    CREATE TABLE courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_code TEXT UNIQUE NOT NULL,
      course_name TEXT NOT NULL,
      credits INTEGER NOT NULL
    );
  `);

  await runAsync(db, `
    CREATE TABLE enrollments (
      student_id INTEGER,
      course_id INTEGER,
      grade TEXT,
      semester TEXT NOT NULL,
      PRIMARY KEY (student_id, course_id),
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
    );
  `);

  // Insert Students
  const students = [
    [1, 'John', 'Doe', 'john.doe@univ.edu', '2023-09-01', 3.85],
    [2, 'Jane', 'Doe', 'jane.doe@univ.edu', '2023-09-01', 3.92],
    [3, 'Mark', 'Twain', 'mark.twain@univ.edu', '2022-09-01', 2.75],
    [4, 'Emily', 'Dickinson', 'emily.d@univ.edu', '2024-01-15', 3.64],
    [5, 'Albert', 'Einstein', 'albert.e@univ.edu', '2021-09-01', 4.00],
    [6, 'Marie', 'Curie', 'marie.curie@univ.edu', '2021-09-01', 3.98],
    [7, 'Isaac', 'Newton', 'isaac.newton@univ.edu', '2022-09-01', 3.45],
    [8, 'Ada', 'Lovelace', 'ada.lovelace@univ.edu', '2022-09-01', 3.95],
    [9, 'Alan', 'Turing', 'alan.turing@univ.edu', '2021-09-01', 3.97],
    [10, 'Grace', 'Hopper', 'grace.hopper@univ.edu', '2022-01-10', 3.80],
    [11, 'Nikola', 'Tesla', 'nikola.tesla@univ.edu', '2023-01-15', 3.12],
    [12, 'Stephen', 'Hawking', 'stephen.h@univ.edu', '2022-09-01', 3.89],
    [13, 'Charles', 'Darwin', 'charles.d@univ.edu', '2023-09-01', 2.95],
    [14, 'Galileo', 'Galilei', 'galileo.g@univ.edu', '2021-09-01', 3.60],
    [15, 'Richard', 'Feynman', 'richard.f@univ.edu', '2023-09-01', 3.78]
  ];

  for (const std of students) {
    await runAsync(db, `
      INSERT INTO students (id, first_name, last_name, email, enrollment_date, cgpa)
      VALUES (?, ?, ?, ?, ?, ?);
    `, std);
  }

  // Insert Courses
  await runAsync(db, `
    INSERT INTO courses (id, course_code, course_name, credits) VALUES
    (1, 'CS101', 'Introduction to Computer Science', 4),
    (2, 'CS202', 'Data Structures & Algorithms', 4),
    (3, 'MATH101', 'Calculus I', 3),
    (4, 'MATH201', 'Linear Algebra', 3),
    (5, 'PHY101', 'General Physics I', 4),
    (6, 'ENG102', 'Academic Writing', 2);
  `);

  // Insert Enrollments
  const enrollments = [
    [1, 1, 'A', 'Fall 2025'], [1, 3, 'B+', 'Fall 2025'], [1, 6, 'A', 'Fall 2025'],
    [2, 1, 'A', 'Fall 2025'], [2, 3, 'A', 'Fall 2025'], [2, 5, 'A-', 'Fall 2025'],
    [3, 3, 'C', 'Fall 2025'], [3, 6, 'B', 'Fall 2025'],
    [4, 1, 'B', 'Spring 2026'], [4, 6, 'A', 'Spring 2026'],
    [5, 1, 'A', 'Fall 2025'], [5, 2, 'A', 'Spring 2026'], [5, 3, 'A', 'Fall 2025'], [5, 4, 'A', 'Spring 2026'], [5, 5, 'A', 'Fall 2025'],
    [6, 1, 'A', 'Fall 2025'], [6, 2, 'A', 'Spring 2026'], [6, 5, 'A', 'Fall 2025'],
    [7, 3, 'B-', 'Fall 2025'], [7, 5, 'B+', 'Fall 2025'],
    [8, 1, 'A', 'Fall 2025'], [8, 2, 'A', 'Spring 2026'], [8, 4, 'A', 'Spring 2026'],
    [9, 1, 'A', 'Fall 2025'], [9, 2, 'A', 'Spring 2026'], [9, 4, 'A-', 'Spring 2026'],
    [10, 1, 'A-', 'Spring 2026'], [10, 3, 'A', 'Spring 2026'],
    [11, 1, 'B', 'Fall 2025'], [11, 5, 'B-', 'Fall 2025'],
    [12, 2, 'A', 'Spring 2026'], [12, 3, 'A', 'Fall 2025'], [12, 5, 'A', 'Fall 2025'],
    [13, 3, 'C+', 'Fall 2025'], [13, 6, 'B-', 'Fall 2025'],
    [14, 3, 'B', 'Fall 2025'], [14, 5, 'A-', 'Fall 2025'],
    [15, 1, 'B+', 'Fall 2025'], [15, 2, 'A-', 'Spring 2026'], [15, 5, 'A', 'Fall 2025']
  ];

  for (const enr of enrollments) {
    await runAsync(db, `
      INSERT INTO enrollments (student_id, course_id, grade, semester)
      VALUES (?, ?, ?, ?);
    `, enr);
  }
}

// E-Commerce Database Seeding
async function seedEcommerceDatabase(db) {
  await runAsync(db, `
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      registered_at TEXT NOT NULL
    );
  `);

  await runAsync(db, `
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL,
      stock INTEGER NOT NULL
    );
  `);

  await runAsync(db, `
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      order_date TEXT NOT NULL,
      status TEXT NOT NULL,
      total_amount REAL NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  await runAsync(db, `
    CREATE TABLE order_items (
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      PRIMARY KEY (order_id, product_id),
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
  `);

  // Insert Users
  const users = [
    [1, 'John Smith', 'john@gmail.com', '2025-01-10'],
    [2, 'Jane Miller', 'jane.miller@outlook.com', '2025-02-14'],
    [3, 'Alex Mercer', 'alex.m@gmail.com', '2025-03-01'],
    [4, 'Sarah Connor', 'sconnor@skynet.com', '2025-03-15'],
    [5, 'Bruce Wayne', 'bruce@waynecorp.com', '2025-04-01'],
    [6, 'Clark Kent', 'clark@dailyplanet.com', '2025-04-12'],
    [7, 'Diana Prince', 'diana@themiscira.org', '2025-04-20'],
    [8, 'Barry Allen', 'barry@star-labs.com', '2025-05-02'],
    [9, 'Peter Parker', 'peter@dailybugle.com', '2025-05-18'],
    [10, 'Tony Stark', 'tony@stark.com', '2025-06-01']
  ];

  for (const usr of users) {
    await runAsync(db, `
      INSERT INTO users (id, name, email, registered_at)
      VALUES (?, ?, ?, ?);
    `, usr);
  }

  // Insert Products
  const products = [
    [1, 'Elitebook Laptop', 'Electronics', 1299.99, 15],
    [2, 'Mechanical Keyboard', 'Accessories', 89.99, 50],
    [3, 'Wireless Gaming Mouse', 'Accessories', 59.99, 80],
    [4, 'UltraWide 34 inch Monitor', 'Electronics', 399.99, 20],
    [5, 'Noise Cancelling Headphones', 'Audio', 199.99, 35],
    [6, 'USB-C Hub Multiport', 'Accessories', 29.99, 120],
    [7, 'Smart Watch Series 9', 'Electronics', 349.99, 25],
    [8, 'Bluetooth Soundbar', 'Audio', 129.99, 40],
    [9, 'Ergonomic Office Chair', 'Furniture', 249.99, 10],
    [10, 'Standing Desk Converter', 'Furniture', 149.99, 18]
  ];

  for (const prod of products) {
    await runAsync(db, `
      INSERT INTO products (id, title, category, price, stock)
      VALUES (?, ?, ?, ?, ?);
    `, prod);
  }

  // Insert Orders & Items
  // Order 1 (John): Laptop + Mouse
  await runAsync(db, `INSERT INTO orders (id, user_id, order_date, status, total_amount) VALUES (1, 1, '2025-06-10', 'Delivered', 1359.98);`);
  await runAsync(db, `INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (1, 1, 1, 1299.99), (1, 3, 1, 59.99);`);

  // Order 2 (Jane): Keyboard + Headphones
  await runAsync(db, `INSERT INTO orders (id, user_id, order_date, status, total_amount) VALUES (2, 2, '2025-06-12', 'Delivered', 289.98);`);
  await runAsync(db, `INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (2, 2, 1, 89.99), (2, 5, 1, 199.99);`);

  // Order 3 (Tony): Monitor + Chair + Desk
  await runAsync(db, `INSERT INTO orders (id, user_id, order_date, status, total_amount) VALUES (3, 10, '2025-06-15', 'Delivered', 1199.96);`);
  await runAsync(db, `INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (3, 4, 2, 399.99), (3, 9, 1, 249.99), (3, 10, 1, 149.99);`);

  // Order 4 (Bruce): Laptop + Keyboard + Soundbar
  await runAsync(db, `INSERT INTO orders (id, user_id, order_date, status, total_amount) VALUES (4, 5, '2025-06-18', 'Shipped', 1519.97);`);
  await runAsync(db, `INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (4, 1, 1, 1299.99), (4, 2, 1, 89.99), (4, 8, 1, 129.99);`);

  // Order 5 (Peter): USB-C Hub
  await runAsync(db, `INSERT INTO orders (id, user_id, order_date, status, total_amount) VALUES (5, 9, '2025-06-20', 'Processing', 59.98);`);
  await runAsync(db, `INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (5, 6, 2, 29.99);`);
}
