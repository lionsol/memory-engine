export function ensureMemoryConfidenceTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_confidence (
      chunk_id TEXT PRIMARY KEY,
      initial_confidence REAL NOT NULL DEFAULT 0.5,
      confidence REAL NOT NULL DEFAULT 0.5,
      last_confidence_update INTEGER,
      base_tau REAL NOT NULL DEFAULT 7.0,
      hit_count INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      is_protected INTEGER NOT NULL DEFAULT 0,
      conflict_flag INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'raw_log',
      kg_data TEXT
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_mc_archived ON memory_confidence(is_archived)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_mc_category ON memory_confidence(category)");
}

export function ensureMemoryEventsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      session_id TEXT,
      trace_id TEXT,
      memory_id TEXT,
      latency_ms INTEGER,
      candidate_count INTEGER,
      injected_count INTEGER,
      cited_count INTEGER,
      vector_score REAL,
      fts_score REAL,
      final_score REAL,
      source TEXT,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_memory_events_created ON memory_events(created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_memory_events_trace ON memory_events(trace_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_memory_events_session ON memory_events(session_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_memory_events_type ON memory_events(event_type)");
}

export function ensureMemoryEngineTables(db) {
  ensureMemoryConfidenceTable(db);
  ensureMemoryEventsTable(db);
}

export function tableExists(db, name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?").get(name);
  return !!row;
}
