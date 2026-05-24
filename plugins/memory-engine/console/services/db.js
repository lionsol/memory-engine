import Database from "better-sqlite3";
import { homedir } from "node:os";
import { resolve } from "node:path";

export const DB_PATH = process.env.MEMORY_ENGINE_DB || resolve(homedir(), ".openclaw/memory/main.sqlite");

export function openDb(options = {}) {
  return new Database(DB_PATH, { readonly: options.readonly ?? false, fileMustExist: false });
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
}

export function initConsoleStorage() {
  const db = openDb();
  try {
    ensureMemoryEventsTable(db);
    ensureMemoryConfidenceTable(db);
  } finally {
    db.close();
  }
}

export function withDb(fn, options = {}) {
  const db = openDb(options);
  try {
    ensureMemoryEventsTable(db);
    return fn(db);
  } finally {
    db.close();
  }
}

export function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?").get(name);
}

export function safeJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function recordEvent(db, event) {
  ensureMemoryEventsTable(db);
  db.prepare([
    "INSERT INTO memory_events",
    "(event_type, session_id, trace_id, memory_id, latency_ms, candidate_count, injected_count, cited_count, vector_score, fts_score, final_score, source, metadata_json)",
    "VALUES (@event_type, @session_id, @trace_id, @memory_id, @latency_ms, @candidate_count, @injected_count, @cited_count, @vector_score, @fts_score, @final_score, @source, @metadata_json)"
  ].join(" ")).run({
    event_type: event.event_type,
    session_id: event.session_id ?? null,
    trace_id: event.trace_id ?? null,
    memory_id: event.memory_id ?? null,
    latency_ms: event.latency_ms ?? null,
    candidate_count: event.candidate_count ?? null,
    injected_count: event.injected_count ?? null,
    cited_count: event.cited_count ?? null,
    vector_score: event.vector_score ?? null,
    fts_score: event.fts_score ?? null,
    final_score: event.final_score ?? null,
    source: event.source ?? "console",
    metadata_json: event.metadata_json ? JSON.stringify(event.metadata_json) : null,
  });
}
