const Database = require("better-sqlite3");
const { getRuntime } = require("./runtime");

function withDb(fn) {
  const db = new Database(getRuntime().coreDbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma("busy_timeout = 5000");
    return fn(db);
  } finally {
    db.close();
  }
}

function withMeDb(fn, options = {}) {
  const db = new Database(getRuntime().engineDbPath, { readonly: options.readonly || false });
  try {
    db.pragma("busy_timeout = 5000");
    if (!options.readonly) ensureCheckpointTables(db);
    db.exec(`ATTACH DATABASE '${getRuntime().coreDbPath.replace(/'/g, "''")}' AS chunks_db`);
    return fn(db);
  } finally {
    db.close();
  }
}

function ensureCheckpointTables(db) {
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

function inspectBusyTimeouts() {
  const busy = {};
  withDb((db) => {
    busy.core = Number(db.pragma("busy_timeout", { simple: true }));
  });
  withMeDb((db) => {
    busy.engine = Number(db.pragma("busy_timeout", { simple: true }));
    busy.attachedCore = Number(db.prepare("PRAGMA chunks_db.busy_timeout").pluck().get());
  }, { readonly: true });
  return busy;
}

module.exports = {
  withDb,
  withMeDb,
  ensureCheckpointTables,
  inspectBusyTimeouts,
};
