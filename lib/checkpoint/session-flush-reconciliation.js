const { readFileSync } = require("node:fs");
const {
  withCoreDbReadonly,
  withEngineDbIsolated,
} = require("../db/isolated-dbs.js");
const { catParams } = require("../memory-confidence.js");
const { getRuntime } = require("./runtime");
const {
  parseCanonicalSmartAddBlocks,
  resolveSourcePath,
} = require("./smart-add-entry-identity.js");

const MAX_ENGINE_INSERTS_PER_CYCLE = 500;
const CORE_READ_BATCH_SIZE = 400;
const SESSION_FLUSH_PATH_PREFIX = "memory/smart-add/";

function isFirstSlicePath(value) {
  const path = typeof value === "string" ? value : "";
  return path.startsWith(SESSION_FLUSH_PATH_PREFIX) && path.endsWith(".md");
}

function compareCoreRows(left, right) {
  const leftUpdatedAt = left?.updated_at === null || left?.updated_at === undefined || String(left.updated_at).trim() === ""
    ? -Infinity
    : Number.isFinite(Number(left.updated_at)) ? Number(left.updated_at) : -Infinity;
  const rightUpdatedAt = right?.updated_at === null || right?.updated_at === undefined || String(right.updated_at).trim() === ""
    ? -Infinity
    : Number.isFinite(Number(right.updated_at)) ? Number(right.updated_at) : -Infinity;
  if (leftUpdatedAt !== rightUpdatedAt) return leftUpdatedAt - rightUpdatedAt;
  const leftId = String(left?.id ?? "");
  const rightId = String(right?.id ?? "");
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function parseLineNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 ? number : null;
}

function createCollectionResult(trigger) {
  return {
    ok: true,
    trigger,
    eligible_core_examined: 0,
    eligible_session_flush: 0,
    excluded_non_session_flush: 0,
    ambiguous_chunk_count: 0,
    unmappable_chunk_count: 0,
    eligibleCoreRows: [],
    error: null,
  };
}

function collectEligibleSessionFlushCoreRows({
  trigger = "nightly_checkpoint",
  getRuntimeImpl = getRuntime,
  withCoreDb: withCoreDbOverride = null,
  readFile = readFileSync,
  workspaceDir: workspaceDirOverride = null,
} = {}) {
  const runtime = getRuntimeImpl();
  const workspaceDir = workspaceDirOverride || runtime.workspaceDir;
  const withCoreDb = withCoreDbOverride || (fn => withCoreDbReadonly(fn, runtime.dbOptions));
  const result = createCollectionResult(trigger);

  let coreRows;
  try {
    coreRows = withCoreDb(db => db.prepare(`
      SELECT *
      FROM chunks
      WHERE path LIKE 'memory/%'
    `).all());
  } catch (error) {
    return {
      ...result,
      ok: false,
      error: error?.message ? String(error.message) : String(error),
    };
  }

  const sourceCache = new Map();
  const orderedRows = [...coreRows].sort(compareCoreRows);
  for (const row of orderedRows) {
    const sourcePath = typeof row?.path === "string" ? row.path : "";
    if (!isFirstSlicePath(sourcePath)) {
      result.excluded_non_session_flush += 1;
      continue;
    }

    result.eligible_core_examined += 1;
    const startLine = parseLineNumber(row.start_line);
    const endLine = parseLineNumber(row.end_line);
    const markAmbiguous = (unmappable = false) => {
      result.ambiguous_chunk_count += 1;
      if (unmappable) result.unmappable_chunk_count += 1;
    };
    if (!row.id || startLine === null || endLine === null || startLine > endLine) {
      markAmbiguous(true);
      continue;
    }

    let mapping = sourceCache.get(sourcePath);
    if (!mapping) {
      const filePath = resolveSourcePath(workspaceDir, sourcePath);
      if (!filePath) {
        mapping = { blocks: null, error: "unsafe_or_missing_source_path" };
      } else {
        try {
          mapping = {
            blocks: parseCanonicalSmartAddBlocks(readFile(filePath, "utf8")),
            error: null,
          };
        } catch (error) {
          mapping = {
            blocks: null,
            error: error?.message ? String(error.message) : String(error),
          };
        }
      }
      sourceCache.set(sourcePath, mapping);
    }
    if (!mapping.blocks) {
      markAmbiguous(true);
      continue;
    }

    const containingBlocks = mapping.blocks.filter(block => (
      startLine >= block.startLine && endLine <= block.endLine
    ));
    if (containingBlocks.length !== 1) {
      markAmbiguous(false);
      continue;
    }

    const block = containingBlocks[0];
    if (block.provenance !== "session_flush" || block.category !== "raw_log") {
      result.excluded_non_session_flush += 1;
      continue;
    }

    result.eligible_session_flush += 1;
    result.eligibleCoreRows.push({
      id: String(row.id),
      path: sourcePath,
      text: row.text == null ? null : String(row.text),
      updated_at: row.updated_at ?? null,
      start_line: startLine,
      end_line: endLine,
      category: "raw_log",
    });
  }

  return result;
}

function chunked(values, size = CORE_READ_BATCH_SIZE) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function readExistingIds(db, ids) {
  const existing = new Set();
  for (const batch of chunked(ids)) {
    if (batch.length === 0) continue;
    const placeholders = batch.map(() => "?").join(", ");
    const rows = db.prepare(`
      SELECT chunk_id
      FROM memory_confidence
      WHERE chunk_id IN (${placeholders})
    `).all(...batch);
    for (const row of rows) existing.add(String(row.chunk_id));
  }
  return existing;
}

function resolveNowSec(runtime, suppliedNowSec) {
  if (suppliedNowSec !== undefined && suppliedNowSec !== null) return Number(suppliedNowSec);
  const rawNow = Number(runtime.now());
  return rawNow > 100000000000 ? Math.floor(rawNow / 1000) : Math.floor(rawNow);
}

function failureResult(collection, error) {
  return {
    ...collection,
    ok: false,
    error: error?.message ? String(error.message) : String(error),
    engine_existing: 0,
    engine_missing_before: collection.eligibleCoreRows.length,
    engine_inserted: 0,
    engine_backlog_remaining: collection.eligibleCoreRows.length,
    engine_converged: false,
  };
}

function reconcileSessionFlushManagedState({
  trigger = "nightly_checkpoint",
  nowSec: suppliedNowSec,
  getRuntimeImpl = getRuntime,
  withCoreDb: withCoreDbOverride = null,
  withEngineDb: withEngineDbOverride = null,
  readFile = readFileSync,
  workspaceDir = null,
  catParamsImpl = catParams,
} = {}) {
  const runtime = getRuntimeImpl();
  const collection = collectEligibleSessionFlushCoreRows({
    trigger,
    getRuntimeImpl,
    withCoreDb: withCoreDbOverride,
    readFile,
    workspaceDir,
  });
  if (!collection.ok) return failureResult(collection, new Error(collection.error));

  const eligibleIds = collection.eligibleCoreRows.map(row => row.id);
  const base = {
    ...collection,
    engine_existing: 0,
    engine_missing_before: eligibleIds.length,
    engine_inserted: 0,
    engine_backlog_remaining: eligibleIds.length,
    engine_converged: false,
  };
  if (eligibleIds.length === 0) {
    return {
      ...base,
      engine_missing_before: 0,
      engine_backlog_remaining: 0,
      engine_converged: collection.ambiguous_chunk_count === 0,
    };
  }

  const withEngineDb = withEngineDbOverride || (fn => withEngineDbIsolated(fn, {
    ...runtime.dbOptions,
    readonly: false,
  }));
  const nowSec = resolveNowSec(runtime, suppliedNowSec);
  try {
    const engineResult = withEngineDb(db => {
      const existingBefore = readExistingIds(db, eligibleIds);
      const missingRows = collection.eligibleCoreRows.filter(row => !existingBefore.has(row.id));
      const selectedRows = missingRows.slice(0, MAX_ENGINE_INSERTS_PER_CYCLE);
      let inserted = 0;
      if (selectedRows.length > 0) {
        const insert = db.prepare(`
          INSERT OR IGNORE INTO memory_confidence
            (chunk_id, initial_confidence, confidence, last_confidence_update,
             base_tau, hit_count, is_archived, is_protected, conflict_flag, category)
          VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?)
        `);
        const transaction = db.transaction(() => {
          for (const row of selectedRows) {
            const params = catParamsImpl("raw_log", false);
            const info = insert.run(
              row.id,
              params.conf,
              params.conf,
              nowSec,
              params.tau,
              "raw_log",
            );
            if (Number(info?.changes || 0) > 0) inserted += 1;
          }
        });
        transaction();
      }
      const managedAfter = readExistingIds(db, eligibleIds);
      return {
        engine_existing: existingBefore.size,
        engine_missing_before: missingRows.length,
        engine_inserted: inserted,
        engine_backlog_remaining: eligibleIds.length - managedAfter.size,
      };
    });
    return {
      ...base,
      ...engineResult,
      engine_converged: engineResult.engine_backlog_remaining === 0
        && collection.ambiguous_chunk_count === 0,
    };
  } catch (error) {
    return failureResult(collection, error);
  }
}

module.exports = {
  MAX_ENGINE_INSERTS_PER_CYCLE,
  collectEligibleSessionFlushCoreRows,
  isFirstSlicePath,
  parseCanonicalSmartAddBlocks,
  reconcileSessionFlushManagedState,
};
