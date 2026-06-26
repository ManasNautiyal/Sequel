import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Main SQL generation entry point.
 * Uses the Gemini API if a key is configured; otherwise returns a clear error.
 */
export async function generateSqlFromPrompt({ prompt, schema, dbType, apiKey }) {
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('GEMINI_API_KEY is not set. Add it to backend/.env to enable AI generation.');
  }

  return generateWithGemini({ prompt, schema, dbType, apiKey });
}

/**
 * AI generation using the Gemini API.
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

  // Strip potential markdown fences
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.substring(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.substring(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.substring(0, cleaned.length - 3);
  cleaned = cleaned.trim();

  return JSON.parse(cleaned);
}


