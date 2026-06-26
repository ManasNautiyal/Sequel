import React, { useState, useEffect } from 'react';

const API_BASE = 'http://localhost:5000';

function App() {
  // DB connection settings
  const [dbConfig, setDbConfig] = useState({
    type: 'sandbox',
    sandboxType: 'hr',
    host: 'localhost',
    port: '5432',
    user: 'postgres',
    password: '',
    database: 'postgres',
    ddl: `CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  title TEXT NOT NULL,
  content TEXT,
  published_date TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);`
  });

  const [activeSql, setActiveSql] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [connectionMsg, setConnectionMsg] = useState('');
  const [schema, setSchema] = useState([]);
  const [expandedTables, setExpandedTables] = useState({});
  const [schemaLoading, setSchemaLoading] = useState(false);

  // App API state
  const [apiKey, setApiKey] = useState('');
  const [prompt, setPrompt] = useState('Show all employees whose salary is greater than 50000.');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState('explanation');

  // Generated queries
  const [generatedData, setGeneratedData] = useState(null);
  const [selectedQueryIdx, setSelectedQueryIdx] = useState(0);

  // Execution states
  const [executionResult, setExecutionResult] = useState(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionError, setExecutionError] = useState('');

  // History logs
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Fetch schema when connection details change
  useEffect(() => {
    // Auto-connect default sandbox on mount
    handleConnect(null, true);
    fetchHistory();
  }, []);

  // Sync active SQL state with selected query candidate
  useEffect(() => {
    const currentSql = generatedData?.queries?.[selectedQueryIdx]?.sql || '';
    setActiveSql(currentSql);
  }, [generatedData, selectedQueryIdx]);

  // Sync suggestion chips based on active sandbox
  const getChips = () => {
    if (dbConfig.type === 'custom') {
      return [
        'Select all users.',
        'Find posts with matching user names.',
        'Count posts written by each user.',
        'Insert a new user into users table.'
      ];
    }
    if (dbConfig.type !== 'sandbox') {
      return [
        'SELECT * FROM public.users LIMIT 10;',
        'Show all tables in public schema.',
        'Count total rows in first table.'
      ];
    }
    if (dbConfig.sandboxType === 'hr') {
      return [
        'Show all employees whose salary is greater than 50000.',
        'Find the highest paid employee.',
        'Count employees in each department.',
        'Increase salary of IT department by 10%.',
        'Update salary of all employees.' // Risky query suggestion
      ];
    }
    if (dbConfig.sandboxType === 'university') {
      return [
        'Find the top 5 students with highest CGPA.',
        'List students enrolled in course CS101.',
        'Calculate average CGPA of all students.',
        'Find students with CGPA less than 3.0.'
      ];
    }
    if (dbConfig.sandboxType === 'ecommerce') {
      return [
        'Show all products.',
        'Find orders with status Delivered.',
        'Calculate total revenue.',
        'List order items for order #3.'
      ];
    }
    return [];
  };

  // Connect to Database or select Sandbox
  const handleConnect = async (e, isInitial = false) => {
    if (e) e.preventDefault();
    setSchemaLoading(true);
    setConnectionMsg('');
    try {
      const payload = {
        ...dbConfig,
        recreate: dbConfig.type === 'custom' ? true : undefined
      };
      const response = await fetch(`${API_BASE}/api/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (data.success) {
        setIsConnected(true);
        setConnectionMsg(data.message);
        // Load schema
        fetchSchema(dbConfig);
        // Reset results from previous connections
        setExecutionResult(null);
        setExecutionError('');
        if (!isInitial) {
          // Set appropriate initial prompt based on sandbox
          if (dbConfig.type === 'sandbox') {
            if (dbConfig.sandboxType === 'hr') setPrompt('Show all employees whose salary is greater than 50000.');
            if (dbConfig.sandboxType === 'university') setPrompt('Find the top 5 students with highest CGPA.');
            if (dbConfig.sandboxType === 'ecommerce') setPrompt('Show all products.');
            setGeneratedData(null);
          } else if (dbConfig.type === 'custom') {
            setPrompt('Select all posts with user details.');
            setGeneratedData({
              queries: [
                {
                  name: 'Primary Query',
                  sql: 'SELECT p.title, u.name \nFROM posts p \nJOIN users u ON p.user_id = u.id;',
                  explanation: 'Selects post titles alongside their author names.'
                }
              ],
              explanation: {
                general: 'Queries the custom posts table and joins it with the users table.',
                clauses: [{ name: 'JOIN', details: 'Matches posts to their authors using user_id.' }]
              },
              impact: {
                affectedTables: ['posts', 'users'],
                estimatedRowsReturned: 'All rows',
                estimatedRowsModified: '0 rows',
                riskLevel: 'safe'
              },
              optimization: {
                performance: 'Optimal',
                suggestions: []
              }
            });
          } else {
            setPrompt('Select 10 records from the main database table.');
            setGeneratedData(null);
          }
        } else if (dbConfig.type === 'custom') {
          setGeneratedData({
            queries: [
              {
                name: 'Primary Query',
                sql: 'SELECT p.title, u.name \nFROM posts p \nJOIN users u ON p.user_id = u.id;',
                explanation: 'Selects post titles alongside their author names.'
              }
            ],
            explanation: {
              general: 'Queries the custom posts table and joins it with the users table.',
              clauses: [{ name: 'JOIN', details: 'Matches posts to their authors using user_id.' }]
            },
            impact: {
              affectedTables: ['posts', 'users'],
              estimatedRowsReturned: 'All rows',
              estimatedRowsModified: '0 rows',
              riskLevel: 'safe'
            },
            optimization: {
              performance: 'Optimal',
              suggestions: []
            }
          });
        }
      } else {
        setIsConnected(false);
        setConnectionMsg(`Connection failed: ${data.error}`);
      }
    } catch (err) {
      console.error(err);
      setIsConnected(false);
      setConnectionMsg(`Could not connect to server API. Check if backend is running.`);
    } finally {
      setSchemaLoading(false);
    }
  };

  // Fetch schema layout
  const fetchSchema = async (config) => {
    try {
      const response = await fetch(`${API_BASE}/api/schema`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      const data = await response.json();
      if (data.success) {
        setSchema(data.schema);
        // Autoexpand all tables initially
        const expanded = {};
        data.schema.forEach(tableObj => {
          expanded[tableObj.table] = true;
        });
        setExpandedTables(expanded);
      }
    } catch (err) {
      console.error('Error fetching schema:', err);
    }
  };

  // Generate SQL Query Candidate(s)
  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setGeneratedData(null);
    setSelectedQueryIdx(0);
    try {
      const response = await fetch(`${API_BASE}/api/generate-sql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          schema,
          dbType: dbConfig.type === 'sandbox' || dbConfig.type === 'custom' ? 'sqlite' : dbConfig.type,
          apiKey
        })
      });
      const data = await response.json();
      if (data.success) {
        setGeneratedData(data);
      } else {
        alert(`Generation failed: ${data.error}`);
      }
    } catch (err) {
      console.error('Error generating SQL:', err);
      alert('Error communicating with SQL generation backend.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Execute selected Query
  const handleExecute = async (sqlOverride = null) => {
    const queryToRun = sqlOverride || activeSql;
    if (!queryToRun) return;

    setIsExecuting(true);
    setExecutionError('');
    setExecutionResult(null);
    try {
      const response = await fetch(`${API_BASE}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql: queryToRun,
          config: dbConfig,
          prompt: sqlOverride ? 'Manual SQL Query Execution' : prompt
        })
      });
      const data = await response.json();
      if (data.success) {
        setExecutionResult({
          rows: data.rows,
          affectedRows: data.affectedRows,
          executionTimeMs: data.executionTimeMs
        });
        // Auto scroll to results section
        setTimeout(() => {
          document.getElementById('results-section')?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
        // Refresh history & schema in case mutations occurred
        fetchHistory();
        if (queryToRun.toUpperCase().includes('UPDATE') || 
            queryToRun.toUpperCase().includes('DELETE') || 
            queryToRun.toUpperCase().includes('INSERT')) {
          fetchSchema(dbConfig);
        }
      } else {
        setExecutionError(data.error);
      }
    } catch (err) {
      console.error('Execution failed:', err);
      setExecutionError('Failed to communicate with DB execution server.');
    } finally {
      setIsExecuting(false);
    }
  };

  // Reset sandbox seed values
  const handleResetSandbox = async () => {
    if (dbConfig.type !== 'sandbox') return;
    if (!confirm('Are you sure you want to reset this sandbox database to its default seeding? All modifications will be lost.')) return;
    
    try {
      const response = await fetch(`${API_BASE}/api/reset-sandbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sandboxType: dbConfig.sandboxType })
      });
      const data = await response.json();
      if (data.success) {
        alert(data.message);
        fetchSchema(dbConfig);
        setExecutionResult(null);
        setExecutionError('');
      }
    } catch (err) {
      console.error('Reset sandbox failed:', err);
      alert('Error resetting sandbox database.');
    }
  };

  // Fetch logs history
  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/history`);
      const data = await response.json();
      if (data.success) {
        setHistory(data.history);
      }
    } catch (err) {
      console.error('Error fetching history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Star a query
  const handleToggleStar = async (id, isStarred) => {
    try {
      const response = await fetch(`${API_BASE}/api/history/star`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isStarred: !isStarred })
      });
      const data = await response.json();
      if (data.success) {
        // Toggle in local state
        setHistory(prev => prev.map(item => item.id === id ? { ...item, is_starred: isStarred ? 0 : 1 } : item));
      }
    } catch (err) {
      console.error('Error toggling star:', err);
    }
  };

  // Clear log history
  const handleClearHistory = async () => {
    if (!confirm('Clear all query execution history?')) return;
    try {
      const response = await fetch(`${API_BASE}/api/history/clear`, { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        setHistory([]);
      }
    } catch (err) {
      console.error('Error clearing history:', err);
    }
  };

  // Toggle tree expansion
  const toggleTableExpand = (table) => {
    setExpandedTables(prev => ({
      ...prev,
      [table]: !prev[table]
    }));
  };

  // Load history item back to active
  const loadHistoryItem = (item) => {
    setPrompt(item.prompt);
    // Auto toggle DB settings back if possible
    setDbConfig(prev => ({
      ...prev,
      type: item.db_type,
      sandboxType: item.sandbox_type || prev.sandboxType
    }));
    setActiveSql(item.query);
    setGeneratedData({
      queries: [
        {
          name: 'Logged Query',
          sql: item.query,
          explanation: 'Restored from query history logs.'
        }
      ],
      explanation: {
        general: 'Restored query from execution history logs.',
        clauses: []
      },
      impact: {
        affectedTables: [],
        estimatedRowsReturned: 'N/A',
        estimatedRowsModified: 'N/A',
        riskLevel: 'safe'
      },
      optimization: {
        performance: 'N/A',
        suggestions: []
      }
    });
  };

  return (
    <div className="app-container">
      {/* 1. LEFT SIDEBAR: Connection & Schema Tree */}
      <aside className="sidebar">
        <div className="app-logo">
          <div className="logo-icon">S</div>
          <div className="logo-text">Sequel</div>
        </div>

        {/* Database selector config */}
        <section className="glass-card">
          <div className="section-title" style={{ marginTop: 0 }}>Connection Settings</div>
          <form onSubmit={handleConnect}>
            <div className="form-group">
              <label className="form-label">Database Engine</label>
              <select 
                className="form-select"
                value={dbConfig.type}
                onChange={(e) => setDbConfig({ ...dbConfig, type: e.target.value })}
              >
                <option value="sandbox">Sandbox (SQLite In-Memory)</option>
                <option value="custom">Custom Schema Editor</option>
                <option value="postgres">PostgreSQL</option>
                <option value="mysql">MySQL</option>
              </select>
            </div>

            {dbConfig.type === 'custom' ? (
              <div className="form-group">
                <label className="form-label">Database DDL (SQL Schema)</label>
                <textarea
                  className="form-input custom-ddl-input"
                  style={{ minHeight: '140px', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', lineHeight: '1.4', resize: 'vertical' }}
                  placeholder="CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);"
                  value={dbConfig.ddl}
                  onChange={e => setDbConfig({ ...dbConfig, ddl: e.target.value })}
                />
              </div>
            ) : dbConfig.type === 'sandbox' ? (
              <div className="form-group">
                <label className="form-label">Sandbox Dataset</label>
                <select 
                  className="form-select"
                  value={dbConfig.sandboxType}
                  onChange={(e) => setDbConfig({ ...dbConfig, sandboxType: e.target.value })}
                >
                  <option value="hr">HR Management Database</option>
                  <option value="university">University Enrollment</option>
                  <option value="ecommerce">E-Commerce Store</option>
                </select>
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label className="form-label">Host</label>
                  <input 
                    type="text" className="form-input" 
                    value={dbConfig.host} 
                    onChange={e => setDbConfig({ ...dbConfig, host: e.target.value })} 
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <div className="form-group">
                    <label className="form-label">Port</label>
                    <input 
                      type="text" className="form-input" 
                      value={dbConfig.port} 
                      onChange={e => setDbConfig({ ...dbConfig, port: e.target.value })} 
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Database Name</label>
                    <input 
                      type="text" className="form-input" 
                      value={dbConfig.database} 
                      onChange={e => setDbConfig({ ...dbConfig, database: e.target.value })} 
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Username</label>
                  <input 
                    type="text" className="form-input" 
                    value={dbConfig.user} 
                    onChange={e => setDbConfig({ ...dbConfig, user: e.target.value })} 
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Password</label>
                  <input 
                    type="password" className="form-input" 
                    value={dbConfig.password} 
                    onChange={e => setDbConfig({ ...dbConfig, password: e.target.value })} 
                  />
                </div>
              </>
            )}

            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} disabled={schemaLoading}>
              {schemaLoading ? (
                <>
                  <div className="spinner" style={{ width: '14px', height: '14px', borderThickness: '1px' }}></div>
                  {dbConfig.type === 'custom' ? 'Applying Schema...' : 'Connecting...'}
                </>
              ) : dbConfig.type === 'custom' ? 'Apply Custom Schema' : 'Connect Database'}
            </button>
          </form>

          {connectionMsg && (
            <div style={{ 
              marginTop: '0.75rem', 
              fontSize: '0.75rem', 
              color: isConnected ? 'var(--color-accent)' : 'var(--color-danger)',
              wordBreak: 'break-word'
            }}>
              {connectionMsg}
            </div>
          )}

          {dbConfig.type === 'sandbox' && isConnected && (
            <button 
              onClick={handleResetSandbox}
              className="btn btn-secondary" 
              style={{ width: '100%', marginTop: '0.5rem', fontSize: '0.75rem', padding: '0.35rem' }}
            >
              Reset Sandbox Data
            </button>
          )}

          {dbConfig.type === 'custom' && isConnected && (
            <button 
              onClick={handleConnect}
              className="btn btn-secondary" 
              style={{ width: '100%', marginTop: '0.5rem', fontSize: '0.75rem', padding: '0.35rem' }}
            >
              Reset / Re-apply Schema
            </button>
          )}
        </section>

        {/* ACTIVE SCHEMA EXPLORER TREE */}
        <section className="schema-section" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
          <div className="section-title">Active Database Schema</div>
          <div style={{ flexGrow: 1, overflowY: 'auto', maxHeight: '350px' }}>
            {schema.length === 0 ? (
              <div style={{ color: 'var(--text-dark)', fontSize: '0.8rem', textAlign: 'center', padding: '1rem' }}>
                No active schema detected. Connect a database to load schema metadata.
              </div>
            ) : (
              <ul className="schema-tree">
                {schema.map(tableObj => (
                  <li key={tableObj.table} className="schema-table-item">
                    <div className="schema-table-header" onClick={() => toggleTableExpand(tableObj.table)}>
                      <span className="schema-table-name">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--color-primary)' }}>
                          <path d="M12 22c5.523 0 10-2.239 10-5V7c0-2.761-4.477-5-10-5S2 4.239 2 7v10c0 2.761 4.477 5 10 5z"/>
                          <path d="M22 7c0 2.76-4.477 5-10 5S2 9.76 2 7"/>
                          <path d="M22 12c0 2.76-4.477 5-10 5S2 14.76 2 12"/>
                        </svg>
                        {tableObj.table}
                      </span>
                      <span>
                        {expandedTables[tableObj.table] ? '▼' : '►'}
                      </span>
                    </div>
                    {expandedTables[tableObj.table] && (
                      <ul className="schema-columns-list">
                        {tableObj.columns.map(col => {
                          // Check if this column is a PK
                          const isPk = col.isPrimary;
                          // Check if this column is a FK
                          const isFk = tableObj.foreignKeys.some(fk => fk.column === col.name);
                          
                          return (
                            <li key={col.name} className="schema-column-item">
                              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.6 }}>
                                  <rect x="3" y="3" width="18" height="18" rx="2" />
                                </svg>
                                {col.name}
                              </span>
                              <div className="column-meta">
                                {isPk && <span className="badge-pk">PK</span>}
                                {isFk && <span className="badge-fk">FK</span>}
                                <span className="column-type">{col.type}</span>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </aside>

      {/* 2. MIDDLE PANEL: Playgrounds, Queries & Visual Telemetry */}
      <main className="main-workspace">
        <header className="workspace-header">
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800 }}>SQL Intelligent Assistant</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Translate natural language requests into production-ready SQL queries</p>
          </div>
          <div className="connection-status-pill">
            <span className={`status-dot ${isConnected ? 'active' : ''}`}></span>
            {isConnected 
              ? `${dbConfig.type === 'sandbox' ? dbConfig.sandboxType.toUpperCase() : dbConfig.type.toUpperCase()} Connected` 
              : 'Disconnected'}
          </div>
        </header>

        {/* API Key settings banner */}
        <section className="glass-card" style={{ display: 'flex', gap: '1rem', alignItems: 'center', padding: '0.75rem 1.25rem', marginBottom: '1.5rem' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--color-primary)' }}>
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
          </svg>
          <div style={{ flexGrow: 1 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>Gemini Developer AI Integration</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Using localized schema patterns. Input a Gemini API key to enable dynamic custom translations.</div>
          </div>
          <input 
            type="password" 
            placeholder="AI Studio API Key" 
            className="form-input" 
            style={{ width: '220px', padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </section>

        {/* PROMPT PANEL */}
        <section className="prompt-container">
          <textarea
            className="prompt-textarea"
            placeholder="Describe what data you want to retrieve or modify in natural language..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleGenerate();
              }
            }}
          />
          <div className="prompt-actions-overlay">
            <button 
              onClick={handleGenerate}
              className="btn btn-primary"
              disabled={isGenerating || !isConnected}
              style={{ padding: '0.6rem 1.25rem' }}
            >
              {isGenerating ? (
                <>
                  <div className="spinner" style={{ width: '14px', height: '14px' }}></div>
                  Thinking...
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                  Generate SQL
                </>
              )}
            </button>
          </div>
        </section>

        {/* Prompt Suggestions Chip */}
        <div className="chips-container">
          {getChips().map((chipText, i) => (
            <span 
              key={i} 
              className="chip"
              onClick={() => {
                setPrompt(chipText);
                // Trigger auto execution if it is SQL direct format
                if (chipText.trim().toUpperCase().startsWith('SELECT') || chipText.trim().toUpperCase().startsWith('UPDATE')) {
                  // Direct run
                  setDbConfig(prev => {
                    setTimeout(() => handleExecute(chipText), 100);
                    return prev;
                  });
                }
              }}
            >
              {chipText}
            </span>
          ))}
        </div>

        {/* GENERATED QUERY candidates */}
        {generatedData ? (
          <div className="animate-fade-in">
            <h3 className="section-title" style={{ marginTop: '0.5rem' }}>SQL Candidates & Analytics</h3>
            <div className="query-card-grid">
              
              {/* Option Selector Toggle if multiple queries exist */}
              {generatedData.queries.length > 1 && (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {generatedData.queries.map((q, idx) => (
                    <button
                      key={idx}
                      className={`btn ${selectedQueryIdx === idx ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
                      onClick={() => setSelectedQueryIdx(idx)}
                    >
                      {q.name || `Option ${idx + 1}`}
                    </button>
                  ))}
                </div>
              )}

              {/* Core Active Query Card */}
              <div className="query-card active">
                <div className="query-card-header">
                  <span className="query-badge">
                    {generatedData.queries[selectedQueryIdx]?.name || 'SQL Query'}
                  </span>
                  <div className="query-card-actions">
                    <button 
                      onClick={() => navigator.clipboard.writeText(activeSql)}
                      className="btn btn-secondary" 
                      style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}
                      title="Copy to Clipboard"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                      Copy
                    </button>
                    <button 
                      onClick={() => handleExecute()}
                      className="btn btn-primary" 
                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', backgroundColor: 'var(--color-accent)', boxShadow: '0 4px 14px var(--color-accent-glow)' }}
                      disabled={isExecuting}
                    >
                      {isExecuting ? 'Running...' : (
                        <>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polygon points="5 3 19 12 5 21 5 3"/>
                          </svg>
                          Run Query
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="sql-editor-container" style={{ padding: 0 }}>
                  <textarea
                    className="sql-code-editor"
                    value={activeSql}
                    onChange={(e) => setActiveSql(e.target.value)}
                    spellCheck="false"
                  />
                </div>

                {generatedData.queries[selectedQueryIdx]?.explanation && (
                  <p className="query-brief">
                    <strong>Intent:</strong> {generatedData.queries[selectedQueryIdx].explanation}
                  </p>
                )}

                {/* TABS ANALYTICS FOR SELECTED QUERY */}
                <div style={{ marginTop: '0.5rem' }}>
                  <div className="tabs-header">
                    <button 
                      className={`tab-btn ${activeTab === 'explanation' ? 'active' : ''}`}
                      onClick={() => setActiveTab('explanation')}
                    >
                      Query Explanation
                    </button>
                    <button 
                      className={`tab-btn ${activeTab === 'impact' ? 'active' : ''}`}
                      onClick={() => setActiveTab('impact')}
                    >
                      Impact Analyzer
                    </button>
                    <button 
                      className={`tab-btn ${activeTab === 'optimization' ? 'active' : ''}`}
                      onClick={() => setActiveTab('optimization')}
                    >
                      Validation & Optimization
                    </button>
                  </div>

                  <div className="tab-content">
                    {activeTab === 'explanation' && (
                      <div className="explanation-list">
                        <p style={{ fontSize: '0.85rem', marginBottom: '0.5rem', color: 'var(--text-main)' }}>
                          {generatedData.explanation?.general}
                        </p>
                        {generatedData.explanation?.clauses?.map((c, i) => (
                          <div key={i} className="explanation-item">
                            <div className="explanation-item-title">{c.name} Clause</div>
                            <div className="explanation-item-desc">{c.details}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {activeTab === 'impact' && (
                      <div>
                        <div className="impact-panel">
                          <div className="impact-metric-card">
                            <div className="metric-label">Affected Tables</div>
                            <div className="metric-value" style={{ fontSize: '0.95rem', color: 'var(--color-primary)' }}>
                              {generatedData.impact?.affectedTables?.join(', ') || 'None'}
                            </div>
                          </div>
                          <div className="impact-metric-card">
                            <div className="metric-label">Est. Rows Returned</div>
                            <div className="metric-value">{generatedData.impact?.estimatedRowsReturned || '0'}</div>
                          </div>
                          <div className="impact-metric-card">
                            <div className="metric-label">Est. Rows Modified</div>
                            <div className="metric-value">{generatedData.impact?.estimatedRowsModified || '0'}</div>
                          </div>
                        </div>

                        <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Risk Assessment:</span>
                          <span className={`risk-meter risk-${generatedData.impact?.riskLevel}`}>
                            {generatedData.impact?.riskLevel?.toUpperCase()}
                          </span>
                        </div>

                        {generatedData.impact?.riskWarning && (
                          <div className="risk-banner">
                            <div style={{ fontSize: '1.25rem' }}>⚠️</div>
                            <div>
                              <div className="risk-banner-title">Potential Risk Warning</div>
                              <div>{generatedData.impact.riskWarning}</div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {activeTab === 'optimization' && (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
                          <span>Query Profile Performance:</span>
                          <span style={{ 
                            fontWeight: 700, 
                            color: generatedData.optimization?.performance === 'Optimal' ? 'var(--color-accent)' : 'var(--color-warning)' 
                          }}>
                            {generatedData.optimization?.performance || 'Optimal'}
                          </span>
                        </div>
                        <ul className="opt-suggestions-list">
                          {generatedData.optimization?.suggestions?.length > 0 ? (
                            generatedData.optimization.suggestions.map((s, idx) => (
                              <li key={idx} className="opt-suggestion-item">{s}</li>
                            ))
                          ) : (
                            <li className="opt-suggestion-item" style={{ color: 'var(--text-dark)' }}>No performance issues or inefficiencies detected. Query is optimized!</li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

              </div>

            </div>
          </div>
        ) : (
          !isGenerating && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 2rem', color: 'var(--text-dark)', gap: '0.5rem' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ opacity: 0.3 }}>
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                <line x1="12" y1="22.08" x2="12" y2="12"/>
              </svg>
              <div>Describe what you want to query in the box above.</div>
            </div>
          )
        )}

        {isGenerating && (
          <div className="loader-container">
            <div className="spinner"></div>
            <div>Consulting Sequel AI and inspecting database schemas...</div>
          </div>
        )}

        {/* 3. EXECUTION RESULTS VIEW GRID */}
        <section id="results-section" className="results-section">
          <div className="results-meta">
            <h3 className="section-title" style={{ margin: 0 }}>Execution Results</h3>
            {executionResult && executionResult.rows?.length > 0 && (
              <button 
                onClick={() => {
                  const headers = Object.keys(executionResult.rows[0]);
                  const csvRows = [
                    headers.join(','),
                    ...executionResult.rows.map(row => 
                      headers.map(header => {
                        const val = row[header];
                        return typeof val === 'string' ? `"${val.replace(/"/g, '""')}"` : val;
                      }).join(',')
                    )
                  ];
                  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `query_result_${Date.now()}.csv`;
                  a.click();
                }}
                className="btn btn-secondary" 
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
              >
                Export CSV
              </button>
            )}
          </div>

          {isExecuting && (
            <div className="loader-container" style={{ padding: '2rem' }}>
              <div className="spinner"></div>
              <div>Executing SQL query statement on active database...</div>
            </div>
          )}

          {executionError && (
            <div className="risk-banner" style={{ marginTop: 0 }}>
              <div style={{ fontSize: '1.25rem' }}>❌</div>
              <div>
                <div className="risk-banner-title">SQL Execution Error</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{executionError}</div>
              </div>
            </div>
          )}

          {executionResult && !isExecuting && (
            <div className="animate-fade-in">
              <div className="results-stats">
                <div className="stat-item">Rows returned: <span>{executionResult.rows.length}</span></div>
                <div className="stat-item">Rows affected: <span>{executionResult.affectedRows}</span></div>
                <div className="stat-item">Execution Time: <span>{executionResult.executionTimeMs} ms</span></div>
              </div>

              <div className="table-wrapper" style={{ marginTop: '0.75rem' }}>
                {executionResult.rows.length === 0 ? (
                  <div className="table-empty">
                    Query executed successfully. No records returned. (e.g. Update/Delete operation completed)
                  </div>
                ) : (
                  <table className="results-table">
                    <thead>
                      <tr>
                        {Object.keys(executionResult.rows[0]).map(header => (
                          <th key={header}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {executionResult.rows.map((row, rIdx) => (
                        <tr key={rIdx}>
                          {Object.keys(row).map((header, cIdx) => (
                            <td key={cIdx}>
                              {row[header] === null || row[header] === undefined ? (
                                <span style={{ color: 'var(--text-dark)', fontStyle: 'italic' }}>NULL</span>
                              ) : (
                                row[header].toString()
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {!executionResult && !isExecuting && !executionError && (
            <div style={{ padding: '2.5rem', textAlign: 'center', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)', color: 'var(--text-dark)', fontSize: '0.85rem' }}>
              No query has been executed yet in this session.
            </div>
          )}
        </section>

      </main>

      {/* 3. RIGHT SIDEBAR: History logger */}
      <aside className="history-sidebar">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div className="section-title" style={{ margin: 0 }}>Query Logs History</div>
          {history.length > 0 && (
            <button 
              onClick={handleClearHistory} 
              style={{ background: 'none', border: 'none', color: 'var(--color-danger)', fontSize: '0.75rem', cursor: 'pointer' }}
            >
              Clear
            </button>
          )}
        </div>

        <div style={{ flexGrow: 1, overflowY: 'auto' }}>
          {historyLoading && history.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-dark)', padding: '1rem' }}>Loading logs...</div>
          ) : history.length === 0 ? (
            <div style={{ color: 'var(--text-dark)', fontSize: '0.8rem', textAlign: 'center', padding: '1rem' }}>
              Execution history is currently empty.
            </div>
          ) : (
            <div className="history-item-list">
              {history.map(item => (
                <div 
                  key={item.id} 
                  className="history-item"
                  onClick={() => loadHistoryItem(item)}
                >
                  <div className="history-item-header">
                    <span className="history-prompt" title={item.prompt}>{item.prompt}</span>
                    <span className="history-db-tag">{item.sandbox_type || item.db_type}</span>
                  </div>
                  <div className="history-query" title={item.query}>
                    {item.query}
                  </div>
                  <div className="history-footer">
                    <span>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <button 
                      className={`star-btn ${item.is_starred ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation(); // Avoid loading item
                        handleToggleStar(item.id, item.is_starred);
                      }}
                    >
                      ★
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

export default App;
