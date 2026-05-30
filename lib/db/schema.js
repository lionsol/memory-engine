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

export function migrateLegacyMemoryEventsFromCore(db) {
  ensureMemoryEventsTable(db);
  let coreHasEvents = false;
  try {
    const row = db.prepare("SELECT name FROM core.sqlite_master WHERE type = 'table' AND name = 'memory_events'").get();
    coreHasEvents = Boolean(row?.name);
  } catch {
    coreHasEvents = false;
  }
  if (!coreHasEvents) return { migrated: 0, reason: "core_table_missing" };

  const localCount = Number(db.prepare("SELECT COUNT(*) AS c FROM memory_events").get()?.c || 0);
  if (localCount > 0) return { migrated: 0, reason: "local_not_empty" };

  const columns = [
    "event_type",
    "session_id",
    "trace_id",
    "memory_id",
    "latency_ms",
    "candidate_count",
    "injected_count",
    "cited_count",
    "vector_score",
    "fts_score",
    "final_score",
    "source",
    "metadata_json",
    "created_at",
  ];
  const colSql = columns.join(", ");
  const before = Number(db.prepare("SELECT COUNT(*) AS c FROM memory_events").get()?.c || 0);
  db.prepare(`INSERT INTO memory_events (${colSql}) SELECT ${colSql} FROM core.memory_events ORDER BY id ASC`).run();
  const after = Number(db.prepare("SELECT COUNT(*) AS c FROM memory_events").get()?.c || 0);
  return { migrated: Math.max(0, after - before), reason: "ok" };
}

export function tableExists(db, name) {
  const tableName = String(name || "");
  const schemas = ["main", "temp", "core"];
  for (const schema of schemas) {
    try {
      const row = db.prepare(`SELECT name FROM ${schema}.sqlite_master WHERE type IN ('table','view') AND name = ?`).get(tableName);
      if (row) return true;
    } catch {
      continue;
    }
  }
  return false;
}
