/**
 * Main SQL generation entry point.
 * Integrates DeepSeek (or any OpenAI-compatible API) via native fetch.
 */
export async function generateSqlFromPrompt({ prompt, schema, dbType, apiKey, apiUrl, modelName }) {
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('DEEPSEEK_API_KEY is not set. Add it to backend/.env to enable AI generation.');
  }

  const { system, user } = buildPrompts(prompt, schema, dbType);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:3000', // Optional, for OpenRouter rankings
      'X-Title': 'Sequel SQL Generator' // Optional, for OpenRouter rankings
    },
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.2,
      response_format: {
        type: 'json_object'
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMsg = `DeepSeek API error: ${response.status} ${response.statusText}`;
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.error && errorJson.error.message) {
        errorMsg = `DeepSeek API error: ${errorJson.error.message}`;
      }
    } catch {
      if (errorText) errorMsg += ` - ${errorText}`;
    }
    throw new Error(errorMsg);
  }

  const result = await response.json();
  const text = result.choices?.[0]?.message?.content;
  if (!text) throw new Error('DeepSeek returned an empty response.');

  return parseResponseText(text);
}

/* ── Prompt builder ─────────────────────────────────────── */
function buildPrompts(prompt, schema, dbType) {
  const system = `You are Sequel, an expert Database Administrator and AI SQL assistant.
Your task is to take a database schema (provided in JSON), a target SQL dialect, and a natural language requirement.
You must return a valid JSON response containing SQL queries, explanation, impact metrics, and optimization hints.

JSON Response Schema:
{
  "queries": [
    {
      "name": "string (e.g., Primary Query, Alternative approach)",
      "sql": "string (valid SQL query for the target dialect, formatted cleanly)",
      "explanation": "string (brief summary of this query)"
    }
  ],
  "explanation": {
    "general": "string (general description in simple language)",
    "clauses": [
      {
        "name": "string (e.g., WHERE, JOIN, GROUP BY)",
        "details": "string (how it is used in this query)"
      }
    ]
  },
  "impact": {
    "affectedTables": ["string"],
    "estimatedRowsReturned": "string",
    "estimatedRowsModified": "string",
    "riskLevel": "string ('safe' | 'warning' | 'critical')",
    "riskWarning": "string (empty if safe)"
  },
  "optimization": {
    "performance": "string (e.g., 'Optimal', 'Requires Indexing')",
    "suggestions": ["string"]
  }
}

CRITICAL RULES:
1. Output ONLY valid JSON — no markdown fences, no extra text. Start with '{' and end with '}'.
2. SQL MUST be valid for the target dialect (${dbType}).
3. Flag DELETE/UPDATE without WHERE as riskLevel 'critical'.
4. Provide 2-3 alternatives if there is ambiguity.
5. Only reference columns/tables that exist in the schema.`;

  const user = `Database Dialect: ${dbType}

Database Schema:
${JSON.stringify(schema, null, 2)}

User Natural Language Requirement:
"${prompt}"

Generate the SQL and analysis JSON:`;

  return { system, user };
}

/* ── Response parser ────────────────────────────────────── */
function parseResponseText(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.substring(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.substring(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.substring(0, cleaned.length - 3);
  return JSON.parse(cleaned.trim());
}
