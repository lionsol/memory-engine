import Database from "better-sqlite3";
import {
  CORE_DB_PATH,
  ENGINE_DB_PATH,
} from "../../memory-manager-runtime.js";

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeSampleLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.floor(n));
}

function monthKeyFromUnixSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "unknown";
  try {
    return new Date(seconds * 1000).toISOString().slice(0, 7);
  } catch {
    return "unknown";
  }
}

function incrementCount(map, key, by = 1) {
  const normalized = String(key ?? "unknown");
  map[normalized] = (map[normalized] || 0) + by;
}

function resolveDbPaths(options = {}) {
  return {
    engineDbPath: options.engineDbPath
      || process.env.ENGINE_DB_PATH
      || process.env.MEMORY_ENGINE_DB_PATH
      || process.env.MEMORY_ENGINE_DB
      || ENGINE_DB_PATH,
    coreDbPath: options.coreDbPath
      || process.env.CORE_DB_PATH
      || process.env.MEMORY_ENGINE_CORE_DB
      || CORE_DB_PATH,
  };
}

function tableExists(db, schemaName, tableName) {
  try {
    const row = db.prepare(
      `SELECT name FROM ${schemaName}.sqlite_master WHERE type = 'table' AND name = ?`,
    ).get(String(tableName || ""));
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

function withReadonlyAttachedDbs(options, fn) {
  const { engineDbPath, coreDbPath } = resolveDbPaths(options);
  const db = new Database(engineDbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma("busy_timeout = 5000");
    db.exec(`ATTACH DATABASE '${String(coreDbPath).replace(/'/g, "''")}' AS core`);
    return fn(db, { engineDbPath, coreDbPath });
  } finally {
    db.close();
  }
}

export function collectOrphanConfidenceDryRun(options = {}) {
  const sampleLimit = normalizeSampleLimit(options.sampleLimit);

  return withReadonlyAttachedDbs(options, (db, paths) => {
    const confidenceRows = db.prepare(`
      SELECT chunk_id, last_confidence_update
      FROM memory_confidence
      ORDER BY chunk_id ASC
    `).all();

    const confidenceTotalCount = confidenceRows.length;
    const chunksTotalCount = toCount(
      db.prepare("SELECT COUNT(*) AS c FROM core.chunks").get()?.c,
    );

    const orphanRows = db.prepare(`
      SELECT
        mc.chunk_id,
        mc.last_confidence_update
      FROM memory_confidence mc
      LEFT JOIN core.chunks c ON c.id = mc.chunk_id
      WHERE c.id IS NULL
      ORDER BY mc.last_confidence_update DESC, mc.chunk_id ASC
    `).all();

    const idLengthDistribution = {};
    for (const row of confidenceRows) {
      const chunkId = String(row.chunk_id || "");
      incrementCount(idLengthDistribution, String(chunkId.length));
    }

    const monthDistribution = {};
    const orphanPrefixes = new Set();
    for (const row of orphanRows) {
      const chunkId = String(row.chunk_id || "");
      incrementCount(monthDistribution, monthKeyFromUnixSeconds(row.last_confidence_update));
      orphanPrefixes.add(chunkId.slice(0, 16));
    }

    let eventPrefixSeenCount = 0;
    if (orphanPrefixes.size > 0 && tableExists(db, "main", "memory_events")) {
      const eventRows = db.prepare(`
        SELECT DISTINCT memory_id
        FROM memory_events
        WHERE memory_id IS NOT NULL AND memory_id != ''
      `).all();
      for (const row of eventRows) {
        const memoryId = String(row.memory_id || "");
        if (orphanPrefixes.has(memoryId)) eventPrefixSeenCount += 1;
      }
    }

    const orphanConfidenceCount = orphanRows.length;
    return {
      mode: "dry-run",
      generated_at: new Date().toISOString(),
      engine_db_path: paths.engineDbPath,
      core_db_path: paths.coreDbPath,
      confidence_total_count: confidenceTotalCount,
      chunks_total_count: chunksTotalCount,
      orphan_confidence_count: orphanConfidenceCount,
      would_delete_count: orphanConfidenceCount,
      orphan_ratio: confidenceTotalCount > 0
        ? Number((orphanConfidenceCount / confidenceTotalCount).toFixed(6))
        : 0,
      id_length_distribution: idLengthDistribution,
      month_distribution: monthDistribution,
      event_prefix_seen_count: eventPrefixSeenCount,
      sample_orphan_chunk_ids: orphanRows.slice(0, sampleLimit).map((row) => String(row.chunk_id || "")),
    };
  });
}

export function inspectOrphanConfidenceDryRun(options = {}) {
  return collectOrphanConfidenceDryRun(options);
}
