import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Main SQL generation coordinator.
 */
export async function generateSqlFromPrompt({ prompt, schema, dbType, apiKey }) {
  if (apiKey && apiKey.trim() !== '') {
    try {
      return await generateWithGemini({ prompt, schema, dbType, apiKey });
    } catch (err) {
      console.error('Gemini API Error, falling back to local engine:', err);
      // Fallback if Gemini fails
    }
  }

  // Fallback engine
  return generateWithFallback({ prompt, schema, dbType });
}

/**
 * AI generation using Gemini API.
 */
async function generateWithGemini({ prompt, schema, dbType, apiKey }) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const systemInstruction = `
You are Sequel, an expert Database Administrator and AI SQL assistant.
Your task is to take a database schema (provided in JSON), a target SQL dialect (e.g. SQLite, PostgreSQL, MySQL), and a natural language requirement.
You must return a valid JSON response containing SQL queries, explanation, impact metrics, and optimization hints.

JSON Response Schema:
{
  "queries": [
    {
      "name": "string (e.g., Primary Query, Alternative approach)",
      "sql": "string (valid SQL query adhering to target dialect, formatted cleanly)",
      "explanation": "string (brief summary of this alternative)"
    }
  ],
  "explanation": {
    "general": "string (general description in simple language)",
    "clauses": [
      {
        "name": "string (e.g., WHERE, JOIN, GROUP BY)",
        "details": "string (how it is used in the query)"
      }
    ]
  },
  "impact": {
    "affectedTables": ["string (tables involved in query)"],
    "estimatedRowsReturned": "string (number or description e.g. '5 rows', 'All matching records')",
    "estimatedRowsModified": "string (number or description e.g. '0 rows', '42 rows')",
    "riskLevel": "string ('safe' | 'warning' | 'critical')",
    "riskWarning": "string (empty if safe, warning description if risky e.g. DELETE/UPDATE without WHERE or cross join)"
  },
  "optimization": {
    "performance": "string (e.g., 'Optimal', 'Requires Indexing', 'Inefficient')",
    "suggestions": ["string (tips to optimize the query or indices to add)"]
  }
}

CRITICAL RULES:
1. Always output ONLY valid JSON. Do not include markdown code block formatting (\`\`\`json) or extra text. Start directly with '{' and end with '}'.
2. The SQL generated MUST be syntactically valid for the target dialect (${dbType}).
3. If the user prompt is a mutation (INSERT, UPDATE, DELETE), design it carefully. If it's a DELETE or UPDATE without a WHERE clause, flag riskLevel as 'critical' and add a prominent riskWarning.
4. If there is ambiguity, provide 2 or 3 alternatives in the 'queries' array. Otherwise, 1 is sufficient.
5. Identify tables and column names exactly as they are defined in the schema. Do not invent columns.
`;

  const schemaContext = JSON.stringify(schema, null, 2);
  const fullPrompt = `
Database Dialect: ${dbType}

Database Schema:
${schemaContext}

User Natural Language Requirement:
"${prompt}"

Please generate the SQL and analysis JSON:
`;

  const result = await model.generateContent([
    { text: systemInstruction },
    { text: fullPrompt }
  ]);

  const text = result.response.text();
  
  // Clean up potential markdown formatting in response
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.substring(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.substring(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  cleaned = cleaned.trim();

  return JSON.parse(cleaned);
}

/**
 * Regex-based local generator for sandbox databases.
 */
function generateWithFallback({ prompt, schema, dbType }) {
  const p = prompt.toLowerCase();
  
  // Let's identify which schema is likely loaded
  const isHR = schema.some(t => t.table === 'employees');
  const isUniv = schema.some(t => t.table === 'students');
  const isEcom = schema.some(t => t.table === 'products');

  // --- 1. HR DATABASE MATCHES ---
  if (isHR) {
    if (p.includes('all employees') || p.includes('list employees') || p.includes('show employees')) {
      if (p.includes('salary >') || p.includes('salary is greater than')) {
        const num = extractNumber(p) || 50000;
        return makeResponse(
          [{ name: 'Primary Query', sql: `SELECT * FROM employees WHERE salary > ${num};`, explanation: `Selects employee details where salary exceeds ${num}.` }],
          `Displays employee records where salary exceeds $${num.toLocaleString()}.`,
          [{ name: 'WHERE', details: `Filters records where the 'salary' column value is greater than ${num}.` }],
          ['employees'], '15 rows max', '0 rows', 'safe', '', 'Optimal', ['Ensure there is an index on salary for larger datasets.']
        );
      }
      return makeResponse(
        [{ name: 'Primary Query', sql: 'SELECT * FROM employees;', explanation: 'Retrieves all columns for all employee records.' }],
        'Fetches and displays the complete list of employees from the table.',
        [{ name: 'SELECT *', details: 'Retrieves all attributes from the target table.' }],
        ['employees'], '15 rows', '0 rows', 'safe', '', 'Optimal', []
      );
    }

    if (p.includes('highest paid') || p.includes('highest salary') || p.includes('top salary') || p.includes('max salary')) {
      return makeResponse(
        [
          { name: 'Primary Query (LIMIT)', sql: 'SELECT * FROM employees ORDER BY salary DESC LIMIT 1;', explanation: 'Sorts employees by salary in descending order and returns the first row.' },
          { name: 'Alternative (Subquery)', sql: 'SELECT * FROM employees WHERE salary = (SELECT MAX(salary) FROM employees);', explanation: 'Uses a subquery to find employees matching the maximum salary.' }
        ],
        'Retrieves details of the employee with the highest salary.',
        [
          { name: 'ORDER BY', details: 'Sorts employees from highest to lowest salary.' },
          { name: 'LIMIT 1', details: 'Restricts the output to only the top single record.' }
        ],
        ['employees'], '1 row', '0 rows', 'safe', '', 'Optimal', ['Ensure salary has an index if ordering is a frequent operation.']
      );
    }

    if (p.includes('increase salary') || p.includes('update salary')) {
      let percent = 1.10;
      let percentText = '10%';
      if (p.includes('5%')) { percent = 1.05; percentText = '5%'; }
      if (p.includes('20%')) { percent = 1.20; percentText = '20%'; }
      
      if (p.includes('it department') || p.includes('it dev')) {
        return makeResponse(
          [{
            name: 'Primary Query',
            sql: `UPDATE employees \nSET salary = salary * ${percent.toFixed(2)} \nWHERE department_id = (SELECT id FROM departments WHERE department_name = 'IT Development');`,
            explanation: `Multiplies the salary of IT employees by ${percent.toFixed(2)}.`
          }],
          `Increases the salary of all employees belonging to the 'IT Development' department by ${percentText}.`,
          [
            { name: 'UPDATE', details: 'Instructs the database to modify rows in the employees table.' },
            { name: 'SET', details: 'Updates the salary column value.' },
            { name: 'WHERE subquery', details: 'Filters to target only employees working in IT by looking up the department_id dynamically.' }
          ],
          ['employees', 'departments'], '0 rows', '4 rows', 'warning', 'This statement modifies data. Ensure you have backed up your table before execution.', 'Optimal', ['An index on department_id is recommended.']
        );
      }

      // Risky update (without WHERE)
      if (!p.includes('where') && !p.includes('department') && !p.includes('employee id')) {
        return makeResponse(
          [{
            name: 'Primary Query (DANGEROUS)',
            sql: `UPDATE employees \nSET salary = salary * ${percent.toFixed(2)};`,
            explanation: 'Increases salary for EVERY employee in the table.'
          }],
          `Modifies every single employee record in the database, increasing salary by ${percentText}.`,
          [{ name: 'UPDATE', details: 'Modifies the salary column across all rows as there is no WHERE filter.' }],
          ['employees'], '0 rows', '15 rows', 'critical', 'CRITICAL WARNING: This UPDATE statement has no WHERE clause! Running this will modify every employee in the database.', 'Inefficient', ['Always use a WHERE clause when performing updates to prevent accidental data loss.']
        );
      }
    }

    if (p.includes('count') && (p.includes('department') || p.includes('dept'))) {
      return makeResponse(
        [{
          name: 'Primary Query',
          sql: 'SELECT d.department_name, COUNT(e.id) AS employee_count \nFROM departments d \nLEFT JOIN employees e ON d.id = e.department_id \nGROUP BY d.department_name;',
          explanation: 'Joins departments with employees and aggregates with COUNT.'
        }],
        'Calculates the total number of employees working in each department, including departments with zero employees.',
        [
          { name: 'LEFT JOIN', details: 'Combines all departments with matching employees, maintaining empty departments.' },
          { name: 'GROUP BY', details: 'Groups results by department name to perform aggregation.' },
          { name: 'COUNT()', details: 'Counts the number of employee IDs inside each group.' }
        ],
        ['departments', 'employees'], '5 rows', '0 rows', 'safe', '', 'Optimal', []
      );
    }

    if (p.includes('manager')) {
      return makeResponse(
        [{
          name: 'Primary Query',
          sql: 'SELECT d.department_name, e.first_name || \' \' || e.last_name AS manager_name \nFROM departments d \nJOIN employees e ON d.manager_id = e.id;',
          explanation: 'Joins departments and employees on manager_id matching employee id.'
        }],
        'Lists all departments alongside the names of their respective managers.',
        [{ name: 'JOIN', details: 'Matches the manager_id of the department table with the id of the employees table.' }],
        ['departments', 'employees'], '5 rows', '0 rows', 'safe', '', 'Optimal', []
      );
    }

    if (p.includes('hired in 2021')) {
      return makeResponse(
        [{
          name: 'Primary Query',
          sql: "SELECT * FROM employees WHERE hire_date LIKE '2021%';",
          explanation: 'Filters employees whose hire date starts with 2021.'
        }],
        'Finds all employees who were hired during the calendar year 2021.',
        [{ name: 'LIKE \'2021%\'', details: 'Matches string representations of date fields starting with 2021.' }],
        ['employees'], '2 rows', '0 rows', 'safe', '', 'Optimal', []
      );
    }

    if (p.includes('delete') && p.includes('hr')) {
      return makeResponse(
        [{
          name: 'Primary Query',
          sql: "DELETE FROM employees WHERE department_id = (SELECT id FROM departments WHERE department_name = 'Human Resources');",
          explanation: 'Deletes employee rows associated with the HR department.'
        }],
        'Removes all employees currently working in the Human Resources department.',
        [{ name: 'DELETE', details: 'Removes rows from the employees table.' }, { name: 'WHERE', details: 'Filters rows matching the HR department id.' }],
        ['employees', 'departments'], '0 rows', '2 rows', 'warning', 'Modifying operation: This will delete employee data from the database.', 'Optimal', []
      );
    }

    if (p.includes('delete') && !p.includes('where')) {
      return makeResponse(
        [{
          name: 'Primary Query (DANGEROUS)',
          sql: 'DELETE FROM employees;',
          explanation: 'Deletes all records from the employees table.'
        }],
        'Wipes out all employee records from the database.',
        [{ name: 'DELETE', details: 'Performs a full table purge since no filter is defined.' }],
        ['employees'], '0 rows', '15 rows', 'critical', 'CRITICAL WARNING: This DELETE statement has no WHERE clause! Running this will delete all employee records from the database.', 'Inefficient', ['Always add a WHERE clause to DELETE statements in production databases.']
      );
    }
  }

  // --- 2. UNIVERSITY DATABASE MATCHES ---
  if (isUniv) {
    if (p.includes('highest cgpa') || p.includes('top 5 students') || p.includes('top students')) {
      const num = extractNumber(p) || 5;
      return makeResponse(
        [{
          name: 'Primary Query',
          sql: `SELECT * FROM students ORDER BY cgpa DESC LIMIT ${num};`,
          explanation: `Sorts students by CGPA in descending order and returns the top ${num}.`
        }],
        `Returns the top ${num} students based on their Cumulative Grade Point Average (CGPA).`,
        [
          { name: 'ORDER BY cgpa DESC', details: 'Sorts students from highest CGPA to lowest.' },
          { name: 'LIMIT', details: `Restricts result set to top ${num} items.` }
        ],
        ['students'], `${num} rows`, '0 rows', 'safe', '', 'Optimal', ['Make sure there is an index on the cgpa column.']
      );
    }

    if (p.includes('courses') || p.includes('list courses')) {
      return makeResponse(
        [{ name: 'Primary Query', sql: 'SELECT * FROM courses;', explanation: 'Retrieves all available courses.' }],
        'Lists all course details, including course code, course name, and credits.',
        [{ name: 'SELECT', details: 'Retrieves all columns from the courses table.' }],
        ['courses'], '6 rows', '0 rows', 'safe', '', 'Optimal', []
      );
    }

    if (p.includes('average cgpa') || p.includes('avg cgpa')) {
      return makeResponse(
        [{ name: 'Primary Query', sql: 'SELECT AVG(cgpa) AS average_cgpa FROM students;', explanation: 'Uses AVG aggregate function.' }],
        'Calculates the average CGPA across all students enrolled in the university.',
        [{ name: 'AVG(cgpa)', details: 'Computes the mean of the cgpa column values.' }],
        ['students'], '1 row', '0 rows', 'safe', '', 'Optimal', []
      );
    }

    if (p.includes('enrolled in') || p.includes('enrolled students')) {
      let code = 'CS101';
      if (p.includes('cs202')) code = 'CS202';
      if (p.includes('math101')) code = 'MATH101';
      if (p.includes('phy101')) code = 'PHY101';

      return makeResponse(
        [{
          name: 'Primary Query',
          sql: `SELECT s.first_name, s.last_name, s.email, e.grade \nFROM students s \nJOIN enrollments e ON s.id = e.student_id \nJOIN courses c ON e.course_id = c.id \nWHERE c.course_code = '${code}';`,
          explanation: `Joins students, enrollments, and courses filtering for code '${code}'.`
        }],
        `Lists all students enrolled in course code '${code}', including the grades they received.`,
        [
          { name: 'JOIN enrollments', details: 'Connects students to their enrollment records.' },
          { name: 'JOIN courses', details: 'Connects enrollment records to course definitions.' },
          { name: 'WHERE', details: `Filters results for course code '${code}'.` }
        ],
        ['students', 'enrollments', 'courses'], '5 rows', '0 rows', 'safe', '', 'Optimal', ['Indexes on student_id and course_id inside enrollments table will speed up this join.']
      );
    }

    if (p.includes('cgpa less than') || p.includes('cgpa <')) {
      const num = extractDecimal(p) || 3.0;
      return makeResponse(
        [{
          name: 'Primary Query',
          sql: `SELECT * FROM students WHERE cgpa < ${num};`,
          explanation: `Filters students with CGPA lower than ${num}.`
        }],
        `Lists all students who have a CGPA of less than ${num}.`,
        [{ name: 'WHERE', details: `Filters records where cgpa column is less than ${num}.` }],
        ['students'], '2 rows', '0 rows', 'safe', '', 'Optimal', []
      );
    }

    if (p.includes('add student') || p.includes('insert student')) {
      return makeResponse(
        [{
          name: 'Primary Query',
          sql: "INSERT INTO students (first_name, last_name, email, enrollment_date, cgpa) \nVALUES ('Elon', 'Musk', 'elon@univ.edu', '2026-06-01', 3.20);",
          explanation: 'Inserts a new student record.'
        }],
        'Adds a new student record to the students table.',
        [{ name: 'INSERT INTO', details: 'Appends a new row to the students table with specified values.' }],
        ['students'], '0 rows', '1 row', 'warning', 'Modifying operation: Inserts data into the database.', 'Optimal', []
      );
    }
  }

  // --- 3. E-COMMERCE DATABASE MATCHES ---
  if (isEcom) {
    if (p.includes('products') || p.includes('list products')) {
      return makeResponse(
        [{ name: 'Primary Query', sql: 'SELECT * FROM products;', explanation: 'Retrieves all products in stock.' }],
        'Lists all product specifications including title, category, price, and stock levels.',
        [{ name: 'SELECT', details: 'Retrieves all product columns.' }],
        ['products'], '10 rows', '0 rows', 'safe', '', 'Optimal', []
      );
    }

    if (p.includes('delivered') || p.includes('order status')) {
      return makeResponse(
        [{ name: 'Primary Query', sql: "SELECT * FROM orders WHERE status = 'Delivered';", explanation: 'Filters orders with status Delivered.' }],
        'Fetches all orders that have been successfully delivered to users.',
        [{ name: 'WHERE status = \'Delivered\'', details: 'Filters orders table columns based on delivery status.' }],
        ['orders'], '3 rows', '0 rows', 'safe', '', 'Optimal', []
      );
    }

    if (p.includes('total sales') || p.includes('revenue') || p.includes('sales volume')) {
      return makeResponse(
        [{ name: 'Primary Query', sql: 'SELECT SUM(total_amount) AS total_revenue FROM orders WHERE status != \'Cancelled\';', explanation: 'Sums total_amount for active orders.' }],
        'Calculates the total revenue from all active and delivered orders.',
        [{ name: 'SUM(total_amount)', details: 'Adds up order totals for records that are not cancelled.' }],
        ['orders'], '1 row', '0 rows', 'safe', '', 'Optimal', []
      );
    }

    if (p.includes('top selling') || p.includes('best seller')) {
      return makeResponse(
        [{
          name: 'Primary Query',
          sql: 'SELECT p.title, SUM(oi.quantity) AS total_sold \nFROM products p \nJOIN order_items oi ON p.id = oi.product_id \nGROUP BY p.title \nORDER BY total_sold DESC \nLIMIT 5;',
          explanation: 'Joins products with order_items, aggregates sales count, and returns top 5.'
        }],
        'Lists the top 5 best selling products ranked by total volume sold.',
        [
          { name: 'JOIN order_items', details: 'Connects products with purchased items.' },
          { name: 'SUM(quantity)', details: 'Aggregates volume per product.' },
          { name: 'ORDER BY total_sold DESC', details: 'Sorts list from highest units sold to lowest.' }
        ],
        ['products', 'order_items'], '5 rows', '0 rows', 'safe', '', 'Optimal', []
      );
    }

    if (p.includes('order #3') || p.includes('order 3') || p.includes('items for order')) {
      const orderId = extractNumber(p) || 3;
      return makeResponse(
        [{
          name: 'Primary Query',
          sql: `SELECT p.title, oi.quantity, oi.unit_price, (oi.quantity * oi.unit_price) AS subtotal \nFROM order_items oi \nJOIN products p ON oi.product_id = p.id \nWHERE oi.order_id = ${orderId};`,
          explanation: `Retrieves items, titles, and subtotal for order id ${orderId}.`
        }],
        `Fetches and calculates items breakdown for order ID #${orderId}.`,
        [{ name: 'WHERE order_id =', details: `Filters purchase records specifically for order index ${orderId}.` }],
        ['order_items', 'products'], '3 rows', '0 rows', 'safe', '', 'Optimal', []
      );
    }
  }

  // --- GENERAL MULTI-DIALECT FALLBACK FOR ANY SCHEMA ---
  // If we can't find a pattern match, we generate a simple query based on the first table
  if (schema && schema.length > 0) {
    const firstTable = schema[0];
    const tableName = firstTable.table;
    const cols = firstTable.columns.slice(0, 4).map(c => c.name).join(', ');
    
    return makeResponse(
      [
        {
          name: 'Default Query',
          sql: `SELECT ${cols} FROM ${tableName} LIMIT 10;`,
          explanation: `Selects up to 10 rows from the primary table: ${tableName}.`
        }
      ],
      `Retrieves basic sample records from the table '${tableName}'.`,
      [
        { name: 'SELECT', details: `Queries attributes (${cols}) from '${tableName}' table.` },
        { name: 'LIMIT 10', details: 'Restricts performance impact by returning only the first 10 rows.' }
      ],
      [tableName],
      '10 rows',
      '0 rows',
      'safe',
      'Configure a Gemini API Key in the settings panel to enable dynamic AI query generation for custom queries and schemas.',
      'Optimal',
      ['Add a Gemini API Key to enable advanced custom queries.']
    );
  }

  // Pure fallback if schema is empty too
  return makeResponse(
    [{ name: 'Fallback Query', sql: 'SELECT 1;', explanation: 'Standard placeholder execution.' }],
    'Returns a static value of 1.',
    [],
    [],
    '1 row',
    '0 rows',
    'safe',
    'No schema available. Enter a Gemini API Key to unlock real generation.',
    'Optimal',
    []
  );
}

// Helpers for local mock responses
function makeResponse(queries, generalExpl, clauses, affectedTables, estRowsRet, estRowsMod, riskLevel, riskWarning, performance, suggestions) {
  return {
    queries,
    explanation: {
      general: generalExpl,
      clauses
    },
    impact: {
      affectedTables,
      estimatedRowsReturned: estRowsRet,
      estimatedRowsModified: estRowsMod,
      riskLevel,
      riskWarning
    },
    optimization: {
      performance,
      suggestions
    }
  };
}

function extractNumber(str) {
  const match = str.match(/\d+/);
  return match ? parseInt(match[0]) : null;
}

function extractDecimal(str) {
  const match = str.match(/\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}
