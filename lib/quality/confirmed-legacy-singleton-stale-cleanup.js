import Database from "better-sqlite3";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import {
  normalizeReviewPath,
  runLegacySingletonReview,
} from "./legacy-singleton-review.js";
import { writeAuditReport } from "./chunks-without-confidence-audit.js";

export const CONFIRMED_LEGACY_SINGLETON_STALE_CLEANUP_CONFIRM_TOKEN = "cleanup-confirmed-legacy-singleton-stale";
export const DEFAULT_CONFIRMED_LEGACY_SINGLETON_STALE_PATH = "memory/daily.md";

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeAbsolutePath(value) {
  return String(value ?? "").replace(/\\/g, "/");
}

function timestampForFilename(now = new Date()) {
  return new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function resolveCleanupPaths(options = {}) {
  const home = homedir();
  const rootDir = options.rootDir || process.env.MEMORY_ENGINE_WORKSPACE_DIR || resolve(home, ".openclaw/workspace");
  const memoryDir = options.memoryDir || resolve(rootDir, "memory");
  const coreDbPath = options.coreDbPath
    || process.env.CORE_DB_PATH
    || process.env.MEMORY_ENGINE_CORE_DB
    || process.env.MEMORY_ENGINE_CORE_DB_PATH
    || resolve(home, ".openclaw/memory/main.sqlite");
  const engineDbPath = options.engineDbPath
    || process.env.ENGINE_DB_PATH
    || process.env.MEMORY_ENGINE_DB
    || process.env.MEMORY_ENGINE_DB_PATH
    || resolve(home, ".openclaw/memory/memory-engine/memory-engine.sqlite");
  return { rootDir, memoryDir, coreDbPath, engineDbPath };
}

function openCoreDb(coreDbPath, { readonly = true } = {}) {
  const db = new Database(coreDbPath, { readonly, fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  if (!readonly) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
  }
  return db;
}

function attachEngine(db, engineDbPath) {
  if (!engineDbPath || !existsSync(engineDbPath)) return false;
  db.exec(`ATTACH DATABASE '${String(engineDbPath).replace(/'/g, "''")}' AS engine`);
  return true;
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

function tableColumns(db, schemaName, tableName) {
  try {
    return db.prepare(`PRAGMA ${schemaName}.table_info(${tableName})`).all().map(row => String(row.name || ""));
  } catch {
    return [];
  }
}

function buildSideEffects({ mode, backupCreated = false } = {}) {
  return {
    db_writes: mode === "apply",
    core_db_backup: backupCreated,
    memory_file_mutation: false,
    archive: false,
    quarantine: false,
    reinforce: false,
    confidence_backfill: false,
    llm: false,
    network: false,
  };
}

function resolveBackupPath(coreDbPath, options = {}, now = new Date()) {
  const backupDir = options.backupDir || resolve(dirname(coreDbPath), "backups");
  return {
    backupDir,
    backupPath: resolve(
      backupDir,
      `main-before-confirmed-legacy-singleton-stale-cleanup-${timestampForFilename(now)}.sqlite`,
    ),
  };
}

function querySingleValue(db, sql, ...params) {
  const row = db.prepare(sql).get(...params);
  const key = row ? Object.keys(row)[0] : null;
  return key ? row[key] : 0;
}

function runReview(targetPath, resolved, sampleLimit) {
  return runLegacySingletonReview({
    targetPath,
    sampleLimit,
    projectRoot: resolved.rootDir,
    dbPaths: {
      coreDbPath: resolved.coreDbPath,
      engineDbPath: resolved.engineDbPath,
    },
  });
}

function buildBaseReport({ mode, targetPath, review }) {
  return {
    mode,
    target_path: targetPath,
    confirm_token_required: CONFIRMED_LEGACY_SINGLETON_STALE_CLEANUP_CONFIRM_TOKEN,
    preflight_passed: false,
    preflight_failures: [],
    review: {
      exists_on_disk: Boolean(review?.exists_on_disk),
      indexed_chunk_count: toCount(review?.indexed_chunk_count),
      chunk_ids: Array.isArray(review?.chunk_ids) ? review.chunk_ids.slice() : [],
      has_confidence_record_count: toCount(review?.has_confidence_record_count),
      retrieved_count: toCount(review?.retrieved_count),
      injected_count: toCount(review?.injected_count),
      likely_classification: review?.likely_classification || "unknown",
      suggested_action: review?.suggested_action || "unknown",
    },
    would_delete: {
      core_chunks: 0,
      core_chunks_fts: 0,
      engine_memory_confidence: 0,
    },
    deleted: {
      core_chunks: 0,
      core_chunks_fts: 0,
      engine_memory_confidence: 0,
    },
    backup_path: null,
    post_apply: null,
    side_effects: buildSideEffects({ mode, backupCreated: false }),
  };
}

function evaluatePreflight(options = {}) {
  const resolved = resolveCleanupPaths(options);
  const targetPath = normalizeReviewPath(options.path || DEFAULT_CONFIRMED_LEGACY_SINGLETON_STALE_PATH);
  const sampleLimit = Number.isFinite(Number(options.sampleLimit)) ? Number(options.sampleLimit) : 20;
  const review = runReview(targetPath, resolved, sampleLimit);
  const report = buildBaseReport({ mode: "dry_run", targetPath, review });

  if (!existsSync(resolved.coreDbPath)) {
    report.preflight_failures.push(`core_db_missing:${normalizeAbsolutePath(resolved.coreDbPath)}`);
    return { resolved, report, targetPath, chunkId: "", exact: null };
  }

  const expectedPath = targetPath;
  const chunkIds = report.review.chunk_ids;
  const chunkId = chunkIds.length === 1 ? String(chunkIds[0] || "") : "";

  if (targetPath !== expectedPath) {
    report.preflight_failures.push(`target_path_mismatch:${targetPath}`);
  }
  if (report.review.exists_on_disk !== false) {
    report.preflight_failures.push("exists_on_disk_must_be_false");
  }
  if (report.review.indexed_chunk_count !== 1) {
    report.preflight_failures.push(`indexed_chunk_count_must_equal_1:${report.review.indexed_chunk_count}`);
  }
  if (report.review.has_confidence_record_count !== 0) {
    report.preflight_failures.push(`has_confidence_record_count_must_equal_0:${report.review.has_confidence_record_count}`);
  }
  if (report.review.retrieved_count !== 0) {
    report.preflight_failures.push(`retrieved_count_must_equal_0:${report.review.retrieved_count}`);
  }
  if (report.review.injected_count !== 0) {
    report.preflight_failures.push(`injected_count_must_equal_0:${report.review.injected_count}`);
  }
  if (report.review.likely_classification !== "stale_index_candidate") {
    report.preflight_failures.push(`likely_classification_must_equal_stale_index_candidate:${report.review.likely_classification}`);
  }
  if (report.review.suggested_action !== "safe_to_review_for_stale_index_or_legacy_file") {
    report.preflight_failures.push(`suggested_action_must_equal_safe_to_review_for_stale_index_or_legacy_file:${report.review.suggested_action}`);
  }
  if (chunkIds.length !== 1) {
    report.preflight_failures.push(`chunk_ids_length_must_equal_1:${chunkIds.length}`);
  }
  if (!chunkId) {
    report.preflight_failures.push("chunk_id_missing");
  }

  const db = openCoreDb(resolved.coreDbPath, { readonly: true });
  let engineAttached = false;
  try {
    engineAttached = attachEngine(db, resolved.engineDbPath);
    const exactChunkCount = chunkId
      ? toCount(querySingleValue(
        db,
        "SELECT COUNT(*) AS c FROM main.chunks WHERE id = ? AND path = ?",
        chunkId,
        targetPath,
      ))
      : 0;
    if (exactChunkCount !== 1) {
      report.preflight_failures.push(`core_chunks_exact_match_must_equal_1:${exactChunkCount}`);
    }

    const ftsExists = tableExists(db, "main", "chunks_fts");
    const ftsColumns = ftsExists ? tableColumns(db, "main", "chunks_fts") : [];
    const ftsHasIdColumn = ftsColumns.includes("id");
    const ftsHasPathColumn = ftsColumns.includes("path");
    let exactFtsCount = 0;
    if (ftsExists && !ftsHasIdColumn) {
      report.preflight_failures.push("chunks_fts_missing_id_column");
    }
    if (ftsExists && ftsHasIdColumn && chunkId) {
      exactFtsCount = toCount(querySingleValue(
        db,
        "SELECT COUNT(*) AS c FROM main.chunks_fts WHERE id = ?",
        chunkId,
      ));
      if (ftsHasPathColumn) {
        const mismatchedFtsCount = toCount(querySingleValue(
          db,
          "SELECT COUNT(*) AS c FROM main.chunks_fts WHERE id = ? AND path <> ?",
          chunkId,
          targetPath,
        ));
        if (mismatchedFtsCount > 0) {
          report.preflight_failures.push(`chunks_fts_id_has_mismatched_paths:${mismatchedFtsCount}`);
        }
      }
    }

    const hasConfidenceTable = engineAttached && tableExists(db, "engine", "memory_confidence");
    const exactConfidenceCount = hasConfidenceTable && chunkId
      ? toCount(querySingleValue(
        db,
        "SELECT COUNT(*) AS c FROM engine.memory_confidence WHERE chunk_id = ?",
        chunkId,
      ))
      : 0;

    report.would_delete = {
      core_chunks: exactChunkCount,
      core_chunks_fts: exactFtsCount,
      engine_memory_confidence: exactConfidenceCount,
    };
    report.preflight_passed = report.preflight_failures.length === 0;
    return {
      resolved,
      report,
      targetPath,
      chunkId,
      exact: {
        ftsExists,
        ftsColumns,
        hasConfidenceTable,
      },
    };
  } finally {
    if (engineAttached) {
      try { db.exec("DETACH DATABASE engine"); } catch {}
    }
    db.close();
  }
}

export function collectConfirmedLegacySingletonStaleCleanupDryRun(options = {}) {
  return evaluatePreflight(options).report;
}

export function renderConfirmedLegacySingletonStaleCleanupMarkdown(report) {
  const chunkIds = (report?.review?.chunk_ids || []).map(id => `- ${id}`).join("\n") || "- none";
  const failures = (report?.preflight_failures || []).map(item => `- ${item}`).join("\n") || "- none";
  return `# Confirmed Legacy Singleton Stale Cleanup

## Summary

- mode: ${report.mode}
- target_path: ${report.target_path}
- confirm_token_required: ${report.confirm_token_required}
- preflight_passed: ${report.preflight_passed}

## Review

- exists_on_disk: ${report.review.exists_on_disk}
- indexed_chunk_count: ${report.review.indexed_chunk_count}
- has_confidence_record_count: ${report.review.has_confidence_record_count}
- retrieved_count: ${report.review.retrieved_count}
- injected_count: ${report.review.injected_count}
- likely_classification: ${report.review.likely_classification}
- suggested_action: ${report.review.suggested_action}

## Chunk IDs

${chunkIds}

## Preflight Failures

${failures}

## Would Delete

- core_chunks: ${report.would_delete.core_chunks}
- core_chunks_fts: ${report.would_delete.core_chunks_fts}
- engine_memory_confidence: ${report.would_delete.engine_memory_confidence}

## Side Effects

- db_writes: ${report.side_effects.db_writes}
- core_db_backup: ${report.side_effects.core_db_backup}
- memory_file_mutation: ${report.side_effects.memory_file_mutation}
- archive: ${report.side_effects.archive}
- quarantine: ${report.side_effects.quarantine}
- reinforce: ${report.side_effects.reinforce}
- confidence_backfill: ${report.side_effects.confidence_backfill}
- llm: ${report.side_effects.llm}
- network: ${report.side_effects.network}
`;
}

export function applyConfirmedLegacySingletonStaleCleanup(options = {}) {
  if (options.confirm !== CONFIRMED_LEGACY_SINGLETON_STALE_CLEANUP_CONFIRM_TOKEN) {
    throw new Error(`apply mode requires --confirm ${CONFIRMED_LEGACY_SINGLETON_STALE_CLEANUP_CONFIRM_TOKEN}`);
  }

  const deps = options.__testDeps || {};
  const preflight = evaluatePreflight(options);
  if (!preflight.report.preflight_passed) {
    throw new Error(`preflight failed: ${preflight.report.preflight_failures.join(", ")}`);
  }

  const { backupDir, backupPath } = resolveBackupPath(preflight.resolved.coreDbPath, options, deps.now || new Date());
  mkdirSync(backupDir, { recursive: true });
  (deps.copyFileSync || copyFileSync)(preflight.resolved.coreDbPath, backupPath);
  if (!existsSync(backupPath)) {
    throw new Error(`backup file was not created: ${backupPath}`);
  }

  const db = openCoreDb(preflight.resolved.coreDbPath, { readonly: false });
  let engineAttached = false;
  try {
    engineAttached = attachEngine(db, preflight.resolved.engineDbPath);
    const ftsExists = tableExists(db, "main", "chunks_fts");
    const ftsColumns = ftsExists ? tableColumns(db, "main", "chunks_fts") : [];
    if (ftsExists && !ftsColumns.includes("id")) {
      throw new Error("chunks_fts lacks id column; refusing apply");
    }
    const hasConfidenceTable = engineAttached && tableExists(db, "engine", "memory_confidence");

    const tx = db.transaction(() => {
      const deletedCoreChunksFts = ftsExists
        ? toCount(db.prepare("DELETE FROM main.chunks_fts WHERE id = ?").run(preflight.chunkId)?.changes)
        : 0;
      const deletedCoreChunks = toCount(
        db.prepare("DELETE FROM main.chunks WHERE id = ? AND path = ?").run(preflight.chunkId, preflight.targetPath)?.changes,
      );
      const deletedEngineMemoryConfidence = hasConfidenceTable
        ? toCount(db.prepare("DELETE FROM engine.memory_confidence WHERE chunk_id = ?").run(preflight.chunkId)?.changes)
        : 0;

      if (deletedCoreChunks !== preflight.report.would_delete.core_chunks) {
        throw new Error(`core chunk delete mismatch: expected ${preflight.report.would_delete.core_chunks}, got ${deletedCoreChunks}`);
      }
      if (deletedCoreChunksFts !== preflight.report.would_delete.core_chunks_fts) {
        throw new Error(`core chunks_fts delete mismatch: expected ${preflight.report.would_delete.core_chunks_fts}, got ${deletedCoreChunksFts}`);
      }
      if (typeof deps.afterDeleteHook === "function") {
        deps.afterDeleteHook();
      }

      return {
        deletedCoreChunks,
        deletedCoreChunksFts,
        deletedEngineMemoryConfidence,
      };
    });
    const deleted = tx();
    const postApply = runReview(preflight.targetPath, preflight.resolved, options.sampleLimit);
    if (toCount(postApply.indexed_chunk_count) !== 0) {
      throw new Error(`post-apply review failed: indexed_chunk_count=${postApply.indexed_chunk_count}`);
    }

    return {
      ...preflight.report,
      mode: "apply",
      deleted: {
        core_chunks: deleted.deletedCoreChunks,
        core_chunks_fts: deleted.deletedCoreChunksFts,
        engine_memory_confidence: deleted.deletedEngineMemoryConfidence,
      },
      backup_path: normalizeAbsolutePath(backupPath),
      post_apply: {
        target_path: postApply.target_path,
        indexed_chunk_count: toCount(postApply.indexed_chunk_count),
        chunk_ids: Array.isArray(postApply.chunk_ids) ? postApply.chunk_ids.slice() : [],
        has_confidence_record_count: toCount(postApply.has_confidence_record_count),
        retrieved_count: toCount(postApply.retrieved_count),
        injected_count: toCount(postApply.injected_count),
        likely_classification: postApply.likely_classification,
        suggested_action: postApply.suggested_action,
      },
      side_effects: buildSideEffects({ mode: "apply", backupCreated: true }),
    };
  } finally {
    if (engineAttached) {
      try { db.exec("DETACH DATABASE engine"); } catch {}
    }
    db.close();
  }
}

export {
  normalizeReviewPath as normalizeConfirmedLegacySingletonStaleCleanupPath,
  writeAuditReport,
};
