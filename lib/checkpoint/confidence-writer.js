const checkpointDate = require("./date");
const { withDb, ensureCheckpointTables } = require("./db");
const { withEngineDbIsolated } = require("../db/isolated-dbs.js");
const { getRuntime } = require("./runtime");

function writeConfidence(entryId, text, category, options = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const catParams = {
    preference: { conf: 0.8, tau: 90.0 },
    episodic: { conf: 0.7, tau: 30.0 },
    user_identity: { conf: 0.95, tau: 365.0 },
    kg_node: { conf: 0.85, tau: 90.0 },
    temporary: { conf: 0.4, tau: 2.0 },
    raw_log: { conf: 0.5, tau: 7.0 },
  };
  const params = catParams[category] || { conf: 0.5, tau: 7.0 };
  const rt = getRuntime();
  const fileRel = options.fileRel || `memory/smart-add/${checkpointDate.todayDateStr(rt.now(), rt.timeZone)}.md`;
  const chunkId = withDb((db) => {
    const row = db.prepare(`
      SELECT id FROM chunks
      WHERE path = ?
      ORDER BY updated_at DESC LIMIT 1
    `).get(fileRel);
    return row ? row.id : null;
  });

  if (chunkId) {
    const { coreDbPath, engineDbPath } = getRuntime();
    withEngineDbIsolated((engineDb) => {
      ensureCheckpointTables(engineDb);
      engineDb.prepare(`
        INSERT OR REPLACE INTO memory_confidence
        (chunk_id, initial_confidence, confidence, last_confidence_update,
         base_tau, hit_count, is_archived, is_protected, conflict_flag, category)
        VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?)
      `).run(chunkId, params.conf, params.conf, nowSec, params.tau, category);
    }, {
      coreDbPath,
      engineDbPath,
    });
    console.log(`[checkpoint] Confidence written: ${category} conf=${params.conf} tau=${params.tau}`);
  }
}

module.exports = {
  writeConfidence,
};
