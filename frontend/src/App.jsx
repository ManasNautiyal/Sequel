import React, { useState, useEffect, useRef } from 'react';

const API_BASE = 'http://localhost:5000';

/* ─── tiny SVG helpers ─────────────────────────────────── */
const Icon = ({ d, size = 12, stroke = 'currentColor', fill = 'none', sw = 2, vb = '0 0 24 24' }) => (
  <svg width={size} height={size} viewBox={vb} fill={fill} stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

const TableIcon = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="3" y1="15" x2="21" y2="15" />
    <line x1="9" y1="9" x2="9" y2="21" />
  </svg>
);

const ColIcon = ({ size = 9 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </svg>
);

function App() {
  /* ── State ── */
  const [dbConfig, setDbConfig] = useState({
    type: 'postgres',
    host: 'localhost', port: '5432',
    user: 'postgres', password: '', database: 'postgres',
    ddl: `CREATE TABLE users (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL,\n  email TEXT UNIQUE NOT NULL,\n  created_at TEXT DEFAULT CURRENT_TIMESTAMP\n);\n\nCREATE TABLE posts (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  user_id INTEGER,\n  title TEXT NOT NULL,\n  content TEXT,\n  published_date TEXT,\n  FOREIGN KEY(user_id) REFERENCES users(id)\n);`
  });

  const [isConnected, setIsConnected] = useState(false);
  const [connectionMsg, setConnectionMsg] = useState('');
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schema, setSchema] = useState([]);
  const [expandedTables, setExpandedTables] = useState({});

  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedData, setGeneratedData] = useState(null);
  const [selectedQueryIdx, setSelectedQueryIdx] = useState(0);
  const [activeSql, setActiveSql] = useState('');

  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState(null);
  const [executionError, setExecutionError] = useState('');

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [resultTab, setResultTab] = useState('data');

  const promptRef = useRef(null);

  /* ── Effects ── */
  useEffect(() => {
    fetchHistory();
  }, []);

  useEffect(() => {
    const sql = generatedData?.queries?.[selectedQueryIdx]?.sql || '';
    setActiveSql(sql);
  }, [generatedData, selectedQueryIdx]);

  /* ── Helpers ── */
  const getChips = () => {
    if (dbConfig.type === 'custom') return [
      'Select all users with their post count.',
      'Find posts with matching user names.',
      'Count posts written by each user.',
      'Insert a new user into the users table.',
    ];
    return [
      'Show all tables in the database.',
      'List columns of the first table.',
      'Select 10 rows from the main table.',
      'Count total rows in each table.',
    ];
  };

  /* ── API Calls ── */
  const handleConnect = async (e) => {
    if (e) e.preventDefault();
    setSchemaLoading(true);
    setConnectionMsg('');
    try {
      const payload = { ...dbConfig, recreate: dbConfig.type === 'custom' ? true : undefined };
      const res = await fetch(`${API_BASE}/api/connect`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        setIsConnected(true);
        setConnectionMsg(data.message);
        fetchSchema(dbConfig);
        setExecutionResult(null);
        setExecutionError('');
        setGeneratedData(null);
        setPrompt('');
      } else {
        setIsConnected(false);
        setConnectionMsg(`Error: ${data.error}`);
      }
    } catch {
      setIsConnected(false);
      setConnectionMsg('Cannot reach backend. Is the server running?');
    } finally {
      setSchemaLoading(false);
    }
  };

  const fetchSchema = async (config) => {
    try {
      const res = await fetch(`${API_BASE}/api/schema`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      const data = await res.json();
      if (data.success) {
        setSchema(data.schema);
        const exp = {};
        data.schema.forEach(t => { exp[t.table] = true; });
        setExpandedTables(exp);
      }
    } catch { /* silent */ }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setGeneratedData(null);
    setSelectedQueryIdx(0);
    setResultTab('data');
    try {
      const res = await fetch(`${API_BASE}/api/generate-sql`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          schema,
          dbType: dbConfig.type === 'custom' ? 'sqlite' : dbConfig.type
        })
      });
      const data = await res.json();
      if (data.success) setGeneratedData(data);
      else setExecutionError(`Generation failed: ${data.error}`);
    } catch {
      setExecutionError('Could not reach generation backend.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExecute = async (sqlOverride = null) => {
    const q = sqlOverride || activeSql;
    if (!q) return;
    setIsExecuting(true);
    setExecutionError('');
    setExecutionResult(null);
    setResultTab('data');
    try {
      const res = await fetch(`${API_BASE}/api/execute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: q, config: dbConfig, prompt: sqlOverride ? 'Manual SQL' : prompt })
      });
      const data = await res.json();
      if (data.success) {
        setExecutionResult({ rows: data.rows, affectedRows: data.affectedRows, executionTimeMs: data.executionTimeMs });
        fetchHistory();
        if (/UPDATE|DELETE|INSERT/i.test(q)) fetchSchema(dbConfig);
      } else {
        setExecutionError(data.error);
      }
    } catch {
      setExecutionError('Execution failed. Is the backend running?');
    } finally {
      setIsExecuting(false);
    }
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/history`);
      const data = await res.json();
      if (data.success) setHistory(data.history);
    } catch { /* silent */ }
    finally { setHistoryLoading(false); }
  };

  const handleToggleStar = async (id, isStarred) => {
    try {
      const res = await fetch(`${API_BASE}/api/history/star`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isStarred: !isStarred })
      });
      const data = await res.json();
      if (data.success) setHistory(prev => prev.map(item => item.id === id ? { ...item, is_starred: isStarred ? 0 : 1 } : item));
    } catch { /* silent */ }
  };

  const handleClearHistory = async () => {
    if (!confirm('Clear all execution history?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/history/clear`, { method: 'POST' });
      const data = await res.json();
      if (data.success) setHistory([]);
    } catch { /* silent */ }
  };

  const loadHistoryItem = (item) => {
    setPrompt(item.prompt);
    setDbConfig(prev => ({ ...prev, type: item.db_type }));
    setActiveSql(item.query);
    setGeneratedData({
      queries: [{ name: 'Logged Query', sql: item.query, explanation: 'Restored from history.' }],
      explanation: { general: 'Restored from history.', clauses: [] },
      impact: { affectedTables: [], estimatedRowsReturned: 'N/A', estimatedRowsModified: 'N/A', riskLevel: 'safe' },
      optimization: { performance: 'N/A', suggestions: [] }
    });
  };

  const toggleTable = (t) => setExpandedTables(prev => ({ ...prev, [t]: !prev[t] }));

  const exportCsv = () => {
    if (!executionResult?.rows?.length) return;
    const headers = Object.keys(executionResult.rows[0]);
    const csv = [
      headers.join(','),
      ...executionResult.rows.map(r =>
        headers.map(h => { const v = r[h]; return typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v; }).join(',')
      )
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `result_${Date.now()}.csv`;
    a.click();
  };

  /* ── derived ── */
  const lineCount = activeSql ? activeSql.split('\n').length : 1;
  const activeCand = generatedData?.queries?.[selectedQueryIdx];

  const dbLabel = isConnected
    ? (dbConfig.type === 'custom'
        ? 'custom [SQLite]'
        : `${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`)
    : 'Not connected';

  const dbTypeLabel = {
    postgres: 'PostgreSQL',
    mysql: 'MySQL',
    custom: 'Custom SQLite',
  }[dbConfig.type] || dbConfig.type;

  return (
    <div className="ide-shell">

      {/* ══ TITLEBAR ══════════════════════════════════════ */}
      <header className="ide-titlebar">
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-bright)', letterSpacing: '0.02em' }}>Sequel</span>
        <div className="titlebar-spacer" />
        <div className="titlebar-connection">
          <span className={`status-dot ${isConnected ? 'active' : ''}`} />
          {dbLabel}
        </div>
      </header>

      {/* ══ TOOLBAR ═══════════════════════════════════════ */}
      <div className="ide-toolbar">
        <div className="toolbar-group">
          <select
            className="toolbar-select"
            value={dbConfig.type}
            onChange={e => setDbConfig(p => ({ ...p, type: e.target.value }))}
          >
            <option value="postgres">PostgreSQL</option>
            <option value="mysql">MySQL</option>
            <option value="custom">Custom SQLite Schema</option>
          </select>

          <button
            className="toolbar-btn"
            onClick={handleConnect}
            disabled={schemaLoading}
            title="Connect to database"
          >
            {schemaLoading
              ? <div className="toolbar-spinner" />
              : <Icon d="M5 12h14M12 5l7 7-7 7" />
            }
            {dbConfig.type === 'custom' ? 'Apply Schema' : 'Connect'}
          </button>
        </div>

        <div className="toolbar-sep" />

        <button
          id="run-query-btn"
          className="toolbar-btn run"
          onClick={() => handleExecute()}
          disabled={!activeSql || isExecuting || !isConnected}
          title="Execute SQL (Ctrl+Enter)"
        >
          {isExecuting
            ? <div className="toolbar-spinner" />
            : <Icon d="M5 3l14 9-14 9V3z" fill="currentColor" sw={0} />
          }
          {isExecuting ? 'Running…' : 'Run'}
        </button>

        <button
          className="toolbar-btn"
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim()}
          title="Generate SQL from natural language"
        >
          {isGenerating
            ? <div className="toolbar-spinner" />
            : <Icon d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          }
          Generate
        </button>

        <div className="toolbar-sep" />

        {activeSql && (
          <button className="toolbar-btn" onClick={() => navigator.clipboard.writeText(activeSql)} title="Copy SQL">
            <Icon d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2M8 4v2a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V4M8 4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2" />
            Copy SQL
          </button>
        )}
      </div>

      {/* ══ LEFT — DATABASE EXPLORER ══════════════════════ */}
      <aside className="ide-filetree">
        <div className="panel-header">
          <span className="panel-title">Database Explorer</span>
          <div className="panel-actions">
            <button className="icon-btn" title="Refresh schema" onClick={() => fetchSchema(dbConfig)}>
              <Icon d="M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" size={11} />
            </button>
          </div>
        </div>

        <div className="filetree-body">

          {/* Custom Schema DDL editor */}
          {dbConfig.type === 'custom' && (
            <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--b0)' }}>
              <div className="panel-title" style={{ marginBottom: 5 }}>DDL Schema</div>
              <textarea
                className="ddl-textarea"
                value={dbConfig.ddl}
                onChange={e => setDbConfig(p => ({ ...p, ddl: e.target.value }))}
                spellCheck={false}
              />
            </div>
          )}

          {/* Connection fields for real DBs */}
          {(dbConfig.type === 'postgres' || dbConfig.type === 'mysql') && (
            <div className="conn-form">
              {[
                { label: 'Host', key: 'host' },
                { label: 'Port', key: 'port' },
                { label: 'DB', key: 'database' },
                { label: 'User', key: 'user' },
              ].map(({ label, key }) => (
                <div key={key} className="conn-form-row">
                  <span className="conn-label">{label}</span>
                  <input
                    className="conn-input"
                    value={dbConfig[key]}
                    onChange={e => setDbConfig(p => ({ ...p, [key]: e.target.value }))}
                    spellCheck={false}
                  />
                </div>
              ))}
              <div className="conn-form-row">
                <span className="conn-label">Pass</span>
                <input
                  className="conn-input"
                  type="password"
                  value={dbConfig.password}
                  onChange={e => setDbConfig(p => ({ ...p, password: e.target.value }))}
                />
              </div>
              <button className="conn-btn" onClick={handleConnect} disabled={schemaLoading}>
                {schemaLoading ? <><div className="spinner" />Connecting…</> : <>Connect</>}
              </button>
            </div>
          )}

          {/* Connection status */}
          {connectionMsg && (
            <div className={`conn-msg ${isConnected ? 'ok' : 'err'}`} style={{ padding: '4px 10px' }}>
              {connectionMsg}
            </div>
          )}

          {/* Schema Tree */}
          {schema.length > 0 ? (
            <>
              <div className="tree-section-head" style={{ marginTop: 4 }}>
                <span className="tree-icon">
                  <Icon d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM12 22.08V12M3.27 6.96 12 12.01l8.73-5.05" size={11} />
                </span>
                <span style={{ color: 'var(--accent)', fontSize: 12 }}>{dbTypeLabel}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-dim)' }}>{schema.length} tables</span>
              </div>

              {schema.map(tableObj => (
                <div key={tableObj.table}>
                  <div className="tree-table-row" onClick={() => toggleTable(tableObj.table)}>
                    <span className="tree-arrow" style={{ transform: expandedTables[tableObj.table] ? 'rotate(90deg)' : 'none', fontSize: 9, transition: 'transform 0.15s' }}>▶</span>
                    <span className="tree-icon" style={{ color: '#cc7832' }}><TableIcon size={11} /></span>
                    <span style={{ flex: 1, fontSize: 12 }}>{tableObj.table}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{tableObj.columns.length}</span>
                  </div>
                  {expandedTables[tableObj.table] && tableObj.columns.map(col => {
                    const isPk = col.isPrimary;
                    const isFk = tableObj.foreignKeys?.some(fk => fk.column === col.name);
                    return (
                      <div key={col.name} className="tree-col-row">
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                          <span className="tree-icon" style={{ opacity: 0.4 }}><ColIcon size={9} /></span>
                          <span className="tree-col-name">{col.name}</span>
                          <span className="tree-col-badges">
                            {isPk && <span className="badge badge-pk">PK</span>}
                            {isFk && <span className="badge badge-fk">FK</span>}
                          </span>
                        </span>
                        <span className="tree-col-type">{col.type}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </>
          ) : (
            <div style={{ padding: '16px 10px', fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', opacity: 0.6, lineHeight: 1.6 }}>
              {schemaLoading
                ? 'Loading schema…'
                : isConnected
                  ? 'No tables found in this database.'
                  : 'Enter connection details and click Connect to browse your schema.'}
            </div>
          )}
        </div>
      </aside>

      {/* ══ CENTER — EDITOR ═══════════════════════════════ */}
      <main className="ide-editor-area">

        {/* Tab bar */}
        <div className="ide-tabbar">
          <div className="ide-tab active">
            <span className="tab-dot" />
            <span className="tab-sql">console.sql</span>
          </div>
          <div className="ide-tab">
            <span className="tab-hist">history.log</span>
          </div>
        </div>

        {(isGenerating || isExecuting) && <div className="loader-bar" />}

        <div className="editor-layout">

          {/* ── Prompt bar ── */}
          <div className="prompt-bar">
            <span className="prompt-icon">
              <Icon d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" size={14} />
            </span>
            <textarea
              ref={promptRef}
              className="prompt-input"
              value={prompt}
              placeholder="Describe what you want to query in natural language…  (Enter to generate)"
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(); }
              }}
              rows={1}
            />
          </div>

          {/* Prompt chips */}
          <div className="prompt-chips">
            {getChips().map((c, i) => (
              <span key={i} className="prompt-chip" onClick={() => setPrompt(c)}>{c}</span>
            ))}
          </div>

          {/* Candidate selector */}
          {generatedData?.queries?.length > 1 && (
            <div className="candidate-bar">
              {generatedData.queries.map((q, i) => (
                <button
                  key={i}
                  className={`candidate-btn ${selectedQueryIdx === i ? 'active' : ''}`}
                  onClick={() => setSelectedQueryIdx(i)}
                >
                  {q.name || `Option ${i + 1}`}
                </button>
              ))}
            </div>
          )}

          {/* Brief */}
          {activeCand?.explanation && (
            <div className="query-brief">
              <strong>Intent:</strong> {activeCand.explanation}
            </div>
          )}

          {/* SQL Editor */}
          <div className="sql-pane">
            <div className="sql-gutter">
              {Array.from({ length: Math.max(lineCount, 12) }, (_, i) => (
                <div key={i} className="gutter-line">{i + 1}</div>
              ))}
            </div>
            <div className="sql-editor-wrap">
              {activeSql ? (
                <textarea
                  id="sql-editor"
                  className="sql-textarea"
                  value={activeSql}
                  onChange={e => setActiveSql(e.target.value)}
                  spellCheck={false}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault(); handleExecute();
                    }
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      const { selectionStart: s, selectionEnd: en } = e.target;
                      const v = e.target.value;
                      setActiveSql(v.substring(0, s) + '  ' + v.substring(en));
                      setTimeout(() => { e.target.selectionStart = e.target.selectionEnd = s + 2; }, 0);
                    }
                  }}
                />
              ) : (
                <div className="sql-empty-state">
                  <Icon d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM12 22.08V12M3.27 6.96 12 12.01l8.73-5.05" size={36} sw={1} />
                  <div>Connect to a database, then describe your query above</div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>
                    Press <kbd style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid var(--b2)', borderRadius: 3, padding: '0px 5px', fontFamily: 'var(--font-mono)', fontSize: 10 }}>Enter</kbd> to generate SQL &nbsp;·&nbsp;
                    <kbd style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid var(--b2)', borderRadius: 3, padding: '0px 5px', fontFamily: 'var(--font-mono)', fontSize: 10 }}>Ctrl+Enter</kbd> to run
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Results Panel ── */}
          <div className="results-panel" style={{ height: '38%' }}>
            <div className="results-tabbar">
              {[
                { id: 'data', label: 'Output' },
                { id: 'explanation', label: 'Explanation' },
                { id: 'impact', label: 'Impact' },
                { id: 'optimization', label: 'Optimization' },
              ].map(t => (
                <div
                  key={t.id}
                  id={`results-tab-${t.id}`}
                  className={`results-tab ${resultTab === t.id ? 'active' : ''}`}
                  onClick={() => setResultTab(t.id)}
                >
                  {t.label}
                  {t.id === 'data' && executionResult && (
                    <span style={{ fontSize: 10, background: 'rgba(107,156,228,0.2)', color: 'var(--accent)', borderRadius: 9, padding: '0 5px', marginLeft: 4 }}>
                      {executionResult.rows.length}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="results-content">
              {/* DATA tab */}
              {resultTab === 'data' && (
                <>
                  {executionError && (
                    <div className="error-banner">
                      <span className="error-banner-icon"><Icon d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" size={14} /></span>
                      <div>
                        <div className="error-banner-title">SQL Error</div>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{executionError}</span>
                      </div>
                    </div>
                  )}
                  {executionResult && !isExecuting ? (
                    <div className="fade-in data-table-wrap">
                      {executionResult.rows.length === 0 ? (
                        <div className="results-empty">
                          <Icon d="M22 11.08V12a10 10 0 1 1-5.93-9.14" size={28} sw={1.5} />
                          <div>Query executed — no rows returned</div>
                          <div style={{ fontSize: 11 }}>{executionResult.affectedRows} row(s) affected · {executionResult.executionTimeMs}ms</div>
                        </div>
                      ) : (
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th className="row-num">#</th>
                              {Object.keys(executionResult.rows[0]).map(h => <th key={h}>{h}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {executionResult.rows.map((row, ri) => (
                              <tr key={ri}>
                                <td className="row-num">{ri + 1}</td>
                                {Object.keys(row).map((h, ci) => {
                                  const v = row[h];
                                  const isNull = v === null || v === undefined;
                                  const isNum = !isNull && typeof v === 'number';
                                  return (
                                    <td key={ci} className={isNull ? 'null-val' : isNum ? 'num-val' : 'str-val'}>
                                      {isNull ? 'NULL' : v.toString()}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ) : !executionError && !isExecuting && (
                    <div className="results-empty">
                      <Icon d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zM12 8v4M12 16h.01" size={28} sw={1} />
                      <div>No query executed yet</div>
                      <div style={{ fontSize: 11 }}>Run a query with <kbd style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid var(--b2)', borderRadius: 3, padding: '0px 4px', fontFamily: 'var(--font-mono)', fontSize: 10 }}>Ctrl+Enter</kbd></div>
                    </div>
                  )}
                </>
              )}

              {/* EXPLANATION tab */}
              {resultTab === 'explanation' && generatedData && (
                <div className="explanation-rows fade-in">
                  <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 6, padding: '0 2px' }}>
                    {generatedData.explanation?.general}
                  </div>
                  {generatedData.explanation?.clauses?.map((c, i) => (
                    <div key={i} className="explanation-row">
                      <div className="explanation-clause">{c.name}</div>
                      <div className="explanation-detail">{c.details}</div>
                    </div>
                  ))}
                  {!generatedData.explanation?.clauses?.length && (
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', opacity: 0.6 }}>No clause breakdown available.</div>
                  )}
                </div>
              )}

              {/* IMPACT tab */}
              {resultTab === 'impact' && generatedData && (
                <div className="fade-in">
                  <div className="analytics-grid">
                    <div className="analytics-card">
                      <div className="analytics-label">Affected Tables</div>
                      <div className="analytics-value accent" style={{ fontSize: 13, marginTop: 4 }}>
                        {generatedData.impact?.affectedTables?.join(', ') || '—'}
                      </div>
                    </div>
                    <div className="analytics-card">
                      <div className="analytics-label">Rows Returned</div>
                      <div className="analytics-value green">{generatedData.impact?.estimatedRowsReturned || '0'}</div>
                    </div>
                    <div className="analytics-card">
                      <div className="analytics-label">Rows Modified</div>
                      <div className="analytics-value orange">{generatedData.impact?.estimatedRowsModified || '0'}</div>
                    </div>
                  </div>
                  <div style={{ padding: '0 12px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Risk:</span>
                    <span className={`risk-badge risk-${generatedData.impact?.riskLevel}`}>
                      {generatedData.impact?.riskLevel?.toUpperCase()}
                    </span>
                  </div>
                  {generatedData.impact?.riskWarning && (
                    <div className="warn-banner">
                      <div>
                        <div className="warn-banner-title">⚠ Risk Warning</div>
                        <div style={{ fontSize: 11.5, marginTop: 3 }}>{generatedData.impact.riskWarning}</div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* OPTIMIZATION tab */}
              {resultTab === 'optimization' && generatedData && (
                <div className="opt-list fade-in">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, padding: '0 4px', fontSize: 12 }}>
                    <span style={{ color: 'var(--text-dim)' }}>Performance Profile:</span>
                    <span style={{ fontWeight: 600, color: generatedData.optimization?.performance === 'Optimal' ? 'var(--green)' : 'var(--orange)' }}>
                      {generatedData.optimization?.performance || 'Optimal'}
                    </span>
                  </div>
                  {generatedData.optimization?.suggestions?.length > 0
                    ? generatedData.optimization.suggestions.map((s, i) => (
                        <div key={i} className="opt-item">
                          <span className="opt-icon">⚡</span>
                          <span>{s}</span>
                        </div>
                      ))
                    : <div className="opt-item"><span className="opt-icon">✓</span><span>No optimizations needed — query is efficient.</span></div>
                  }
                </div>
              )}

              {/* Tabs with no data */}
              {(resultTab === 'explanation' || resultTab === 'impact' || resultTab === 'optimization') && !generatedData && (
                <div className="results-empty">
                  <Icon d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" size={28} sw={1} />
                  <div>Generate SQL first to see analytics</div>
                </div>
              )}
            </div>

            {/* Stats footer */}
            {executionResult && (
              <div className="results-stats-bar">
                <span className="statusbar-item">Rows: <span className="val">&nbsp;{executionResult.rows.length}</span></span>
                <span className="stat-sep">|</span>
                <span className="statusbar-item">Affected: <span className="val">&nbsp;{executionResult.affectedRows}</span></span>
                <span className="stat-sep">|</span>
                <span className="statusbar-item">Time: <span className="val">&nbsp;{executionResult.executionTimeMs}ms</span></span>
                {executionResult.rows.length > 0 && (
                  <button className="csv-btn" onClick={exportCsv}>Export CSV</button>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ══ RIGHT — HISTORY ═══════════════════════════════ */}
      <aside className="ide-right-panel">
        <div className="panel-header">
          <span className="panel-title">Query History</span>
          <div className="panel-actions">
            {history.length > 0 && (
              <button className="icon-btn" title="Clear history" onClick={handleClearHistory}>
                <Icon d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" size={11} />
              </button>
            )}
            <button className="icon-btn" title="Refresh" onClick={fetchHistory}>
              <Icon d="M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" size={11} />
            </button>
          </div>
        </div>

        <div className="history-list">
          {historyLoading && history.length === 0 ? (
            <div style={{ padding: '12px 10px', fontSize: 11, color: 'var(--text-dim)', textAlign: 'center' }}>Loading…</div>
          ) : history.length === 0 ? (
            <div style={{ padding: '16px 10px', fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', opacity: 0.6, lineHeight: 1.7 }}>
              No history yet.<br />Execute a query to log it here.
            </div>
          ) : (
            history.map(item => (
              <div key={item.id} className="history-item" onClick={() => loadHistoryItem(item)}>
                <div className="history-item-prompt" title={item.prompt}>{item.prompt}</div>
                <div className="history-item-sql" title={item.query}>{item.query}</div>
                <div className="history-item-meta">
                  <span className="history-db-tag">{item.db_type}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                      {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <button
                      className={`star-btn ${item.is_starred ? 'active' : ''}`}
                      onClick={e => { e.stopPropagation(); handleToggleStar(item.id, item.is_starred); }}
                      title="Star query"
                    >★</button>
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ══ STATUS BAR ════════════════════════════════════ */}
      <footer className="ide-statusbar">
        <span className="statusbar-item">
          <span className={`status-dot ${isConnected ? 'active' : ''}`} style={{ width: 6, height: 6 }} />
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>
        <span className="statusbar-sep">·</span>
        <span className="statusbar-item">{dbTypeLabel}</span>
        {activeSql && (
          <>
            <span className="statusbar-sep">·</span>
            <span className="statusbar-item">{lineCount} line{lineCount !== 1 ? 's' : ''}</span>
          </>
        )}
        <span className="statusbar-spacer" />
        <span className="statusbar-item">SQL · UTF-8</span>
        <span className="statusbar-sep">·</span>
        <span className="statusbar-item">Sequel v1.0</span>
      </footer>

    </div>
  );
}

export default App;
