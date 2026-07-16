import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  CORE_DB_PATH,
  ENGINE_DB_PATH,
} from "../../memory-manager-runtime.js";
import { withCoreDbReadonly } from "../db/isolated-dbs.js";

const CORE_ID_BATCH_SIZE = 500;

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

function withCleanupDbs(options, fn, dbOptions = {}) {
  const { engineDbPath, coreDbPath } = resolveDbPaths(options);
  const engineDb = new Database(engineDbPath, {
    readonly: Boolean(dbOptions.readonly),
    fileMustExist: true,
  });
  try {
    engineDb.pragma("busy_timeout = 5000");
    return withCoreDbReadonly((coreDb) => fn({
      engineDb,
      coreDb,
      paths: { engineDbPath, coreDbPath },
    }), {
      coreDbPath,
      engineDbPath,
    });
  } finally {
    engineDb.close();
  }
}

function chunkRows(rows, batchSize = CORE_ID_BATCH_SIZE) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += batchSize) {
    chunks.push(rows.slice(index, index + batchSize));
  }
  return chunks;
}

function readExistingCoreIds(coreDb, chunkIds) {
  const existingIds = new Set();
  for (const batch of chunkRows(chunkIds)) {
    if (batch.length === 0) continue;
    const placeholders = batch.map(() => "?").join(", ");
    const rows = coreDb.prepare(`
      SELECT id
      FROM chunks
      WHERE id IN (${placeholders})
    `).all(...batch);
    for (const row of rows) {
      existingIds.add(String(row.id || ""));
    }
  }
  return existingIds;
}

function collectOrphanDiagnostics({ engineDb, coreDb }, sampleLimit) {
  const confidenceRows = engineDb.prepare(`
    SELECT chunk_id, last_confidence_update
    FROM memory_confidence
    ORDER BY chunk_id ASC
  `).all();

  const existingCoreIds = readExistingCoreIds(
    coreDb,
    confidenceRows.map((row) => String(row.chunk_id || "")),
  );

  const orphanRows = confidenceRows
    .filter((row) => !existingCoreIds.has(String(row.chunk_id || "")))
    .sort((left, right) => (
      Number(right.last_confidence_update || 0) - Number(left.last_confidence_update || 0)
      || String(left.chunk_id || "").localeCompare(String(right.chunk_id || ""))
    ));

  const confidenceTotalCount = confidenceRows.length;
  const chunksTotalCount = toCount(
    coreDb.prepare("SELECT COUNT(*) AS c FROM chunks").get()?.c,
  );

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
  if (orphanPrefixes.size > 0 && tableExists(engineDb, "main", "memory_events")) {
    const eventRows = engineDb.prepare(`
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
    confidenceRows,
    orphanRows,
    confidenceTotalCount,
    chunksTotalCount,
    orphanConfidenceCount,
    idLengthDistribution,
    monthDistribution,
    eventPrefixSeenCount,
    sampleOrphanChunkIds: orphanRows.slice(0, sampleLimit).map((row) => String(row.chunk_id || "")),
  };
}

function buildDryRunResult(diagnostics, paths) {
  return {
    mode: "dry-run",
    generated_at: new Date().toISOString(),
    engine_db_path: paths.engineDbPath,
    core_db_path: paths.coreDbPath,
    confidence_total_count: diagnostics.confidenceTotalCount,
    chunks_total_count: diagnostics.chunksTotalCount,
    orphan_confidence_count: diagnostics.orphanConfidenceCount,
    would_delete_count: diagnostics.orphanConfidenceCount,
    orphan_ratio: diagnostics.confidenceTotalCount > 0
      ? Number((diagnostics.orphanConfidenceCount / diagnostics.confidenceTotalCount).toFixed(6))
      : 0,
    id_length_distribution: diagnostics.idLengthDistribution,
    month_distribution: diagnostics.monthDistribution,
    event_prefix_seen_count: diagnostics.eventPrefixSeenCount,
    sample_orphan_chunk_ids: diagnostics.sampleOrphanChunkIds,
  };
}

function timestampForFilename(now = new Date()) {
  const iso = new Date(now).toISOString();
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function resolveBackupPath(options, engineDbPath, now = new Date()) {
  const backupDir = options.backupDir || resolve(dirname(engineDbPath), "backups");
  const backupPath = resolve(
    backupDir,
    `memory-engine-before-orphan-confidence-cleanup-${timestampForFilename(now)}.sqlite`,
  );
  return { backupDir, backupPath };
}

function deleteOrphanConfidenceRows(db, orphanChunkIds) {
  if (orphanChunkIds.length === 0) return 0;
  const placeholders = orphanChunkIds.map(() => "?").join(", ");
  const result = db.prepare(
    `DELETE FROM memory_confidence WHERE chunk_id IN (${placeholders})`,
  ).run(...orphanChunkIds);
  return toCount(result?.changes);
}

export function collectOrphanConfidenceDryRun(options = {}) {
  const sampleLimit = normalizeSampleLimit(options.sampleLimit);
  return withCleanupDbs(options, ({ engineDb, coreDb, paths }) => {
    const diagnostics = collectOrphanDiagnostics({ engineDb, coreDb }, sampleLimit);
    return buildDryRunResult(diagnostics, paths);
  }, { readonly: true });
}

export function applyOrphanConfidenceCleanup(options = {}) {
  const sampleLimit = normalizeSampleLimit(options.sampleLimit);
  const paths = resolveDbPaths(options);
  const startedAt = new Date().toISOString();
  const precomputed = collectOrphanConfidenceDryRun({
    ...options,
    sampleLimit,
    engineDbPath: paths.engineDbPath,
    coreDbPath: paths.coreDbPath,
  });

  const { backupDir, backupPath } = resolveBackupPath(options, paths.engineDbPath);
  mkdirSync(backupDir, { recursive: true });
  copyFileSync(paths.engineDbPath, backupPath);
  if (!existsSync(backupPath)) {
    throw new Error(`backup file was not created: ${backupPath}`);
  }

  const orphanChunkIds = withCleanupDbs({
    ...options,
    engineDbPath: paths.engineDbPath,
    coreDbPath: paths.coreDbPath,
  }, ({ engineDb, coreDb }) => collectOrphanDiagnostics({ engineDb, coreDb }, sampleLimit)
    .orphanRows
    .map((row) => String(row.chunk_id || "")), {
    readonly: true,
  });

  const deletedCount = withCleanupDbs({
    ...options,
    engineDbPath: paths.engineDbPath,
    coreDbPath: paths.coreDbPath,
  }, ({ engineDb }) => {
    const tx = engineDb.transaction(() => deleteOrphanConfidenceRows(engineDb, orphanChunkIds));
    return tx();
  }, { readonly: false });

  const post = collectOrphanConfidenceDryRun({
    ...options,
    sampleLimit,
    engineDbPath: paths.engineDbPath,
    coreDbPath: paths.coreDbPath,
  });

  const warning = deletedCount !== precomputed.would_delete_count
    ? `deleted_count (${deletedCount}) did not match precomputed_would_delete_count (${precomputed.would_delete_count})`
    : null;

  return {
    mode: "apply",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    backup_path: backupPath,
    engine_db_path: paths.engineDbPath,
    core_db_path: paths.coreDbPath,
    before_orphan_confidence_count: precomputed.orphan_confidence_count,
    precomputed_would_delete_count: precomputed.would_delete_count,
    deleted_count: deletedCount,
    remaining_orphan_confidence_count: post.orphan_confidence_count,
    warning,
    sample_orphan_chunk_ids: precomputed.sample_orphan_chunk_ids,
    month_distribution: precomputed.month_distribution,
    id_length_distribution: precomputed.id_length_distribution,
    event_prefix_seen_count: precomputed.event_prefix_seen_count,
    confidence_total_count: precomputed.confidence_total_count,
    chunks_total_count: precomputed.chunks_total_count,
  };
}

export function inspectOrphanConfidenceDryRun(options = {}) {
  return collectOrphanConfidenceDryRun(options);
}
