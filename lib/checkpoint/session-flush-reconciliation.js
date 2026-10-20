const { readFileSync } = require("node:fs");
const businessTime = require("../business-time.cjs");
const {
  withCoreDbReadonly,
  withEngineDbIsolated,
} = require("../db/isolated-dbs.js");
const { catParams } = require("../memory-confidence.js");
const { getRuntime } = require("./runtime");
const {
  assignStableMemoryIdentity,
  stableMemoryIdentitySchemaState,
} = require("../db/stable-memory-identity.cjs");
const {
  parseCanonicalSmartAddBlocks,
  resolveSourcePath,
} = require("./smart-add-entry-identity.js");
const { selectCoreRowsInTimeRange } = require("./raw-log-db-collector.js");

const MAX_ENGINE_INSERTS_PER_CYCLE = 500;
const CORE_READ_BATCH_SIZE = 400;
const SESSION_FLUSH_PATH_PREFIX = "memory/smart-add/";

function isFirstSlicePath(value) {
  const path = typeof value === "string" ? value : "";
  return path.startsWith(SESSION_FLUSH_PATH_PREFIX) && path.endsWith(".md");
}

function isTargetDatePath(value, targetDate) {
  return Boolean(targetDate) && value === `${SESSION_FLUSH_PATH_PREFIX}${targetDate}.md`;
}

function prioritizeTargetDateRows(rows, targetDate, targetCandidateIds = null) {
  if (!targetDate) return [...rows];
  if (targetCandidateIds) {
    return [
      ...rows.filter(row => targetCandidateIds.has(String(row?.id || ""))),
      ...rows.filter(row => !targetCandidateIds.has(String(row?.id || ""))),
    ];
  }
  return [
    ...rows.filter(row => isTargetDatePath(row.path, targetDate)),
    ...rows.filter(row => !isTargetDatePath(row.path, targetDate)),
  ];
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

function createCollectionResult(trigger, targetDate = null) {
  return {
    ok: true,
    trigger,
    eligible_core_examined: 0,
    eligible_session_flush: 0,
    excluded_non_session_flush: 0,
    ambiguous_chunk_count: 0,
    unmappable_chunk_count: 0,
    target_date: targetDate || null,
    target_date_core_examined: 0,
    target_date_candidate_ids: [],
    target_date_eligible_session_flush: 0,
    target_date_ambiguous_chunk_count: 0,
    target_date_unmappable_chunk_count: 0,
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
  targetDate = null,
} = {}) {
  const runtime = getRuntimeImpl();
  const workspaceDir = workspaceDirOverride || runtime.workspaceDir;
  const withCoreDb = withCoreDbOverride || (fn => withCoreDbReadonly(fn, runtime.dbOptions));
  const result = createCollectionResult(trigger, targetDate);

  let coreRows;
  let targetCandidateIds = null;
  try {
    coreRows = withCoreDb(db => {
      const rows = db.prepare(`
        SELECT *
        FROM chunks
        WHERE path LIKE 'memory/%'
      `).all();
      if (targetDate) {
        const range = businessTime.businessDateToUtcRange(targetDate, runtime.timeZone);
        const candidate = selectCoreRowsInTimeRange(db, range);
        targetCandidateIds = new Set(candidate.coreRows.map(row => String(row.id || "")).filter(Boolean));
        result.target_date_candidate_ids = [...targetCandidateIds];
      }
      return rows;
    });
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
    const targetDateRow = targetCandidateIds
      ? targetCandidateIds.has(String(row.id || ""))
      : isTargetDatePath(sourcePath, targetDate);
    if (targetDateRow) result.target_date_core_examined += 1;
    const startLine = parseLineNumber(row.start_line);
    const endLine = parseLineNumber(row.end_line);
    const markAmbiguous = (unmappable = false) => {
      result.ambiguous_chunk_count += 1;
      if (unmappable) result.unmappable_chunk_count += 1;
      if (targetDateRow) {
        result.target_date_ambiguous_chunk_count += 1;
        if (unmappable) result.target_date_unmappable_chunk_count += 1;
      }
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
    if (targetDateRow) result.target_date_eligible_session_flush += 1;
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

function readExistingDetails(db, ids) {
  const details = new Map();
  const columns = new Set(db.prepare("PRAGMA table_info(memory_confidence)").all().map(row => String(row.name)));
  const entityProjection = columns.has("entity_id") ? "entity_id" : "NULL AS entity_id";
  for (const batch of chunked(ids)) {
    if (batch.length === 0) continue;
    const placeholders = batch.map(() => "?").join(", ");
    const rows = db.prepare(`
      SELECT chunk_id, ${entityProjection}
      FROM memory_confidence
      WHERE chunk_id IN (${placeholders})
    `).all(...batch);
    for (const row of rows) details.set(String(row.chunk_id), row);
  }
  return details;
}

function readStableIdentitySchemaState(db) {
  return stableMemoryIdentitySchemaState(db);
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
    target_date_backlog_remaining: collection.target_date_eligible_session_flush,
    target_date_engine_converged: false,
    target_date_input_complete: false,
    historical_backlog_remaining: collection.eligibleCoreRows.length,
    historical_ambiguous_chunk_count: Math.max(
      0,
      collection.ambiguous_chunk_count - collection.target_date_ambiguous_chunk_count,
    ),
  };
}

function reconcileSessionFlushManagedState({
  trigger = "nightly_checkpoint",
  targetDate = null,
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
    targetDate,
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
    target_date_backlog_remaining: collection.target_date_eligible_session_flush,
    target_date_engine_converged: false,
    target_date_input_complete: false,
    historical_backlog_remaining: collection.eligibleCoreRows.length,
    historical_ambiguous_chunk_count: Math.max(
      0,
      collection.ambiguous_chunk_count - collection.target_date_ambiguous_chunk_count,
    ),
  };
  if (eligibleIds.length === 0) {
    const targetDateComplete = targetDate
      ? collection.target_date_ambiguous_chunk_count === 0
      : collection.ambiguous_chunk_count === 0;
    return {
      ...base,
      engine_missing_before: 0,
      engine_backlog_remaining: 0,
      engine_converged: collection.ambiguous_chunk_count === 0,
      target_date_backlog_remaining: 0,
      target_date_engine_converged: targetDateComplete,
      target_date_input_complete: targetDateComplete,
      historical_backlog_remaining: 0,
    };
  }

  const withEngineDb = withEngineDbOverride || (fn => withEngineDbIsolated(fn, {
    ...runtime.dbOptions,
    readonly: false,
  }));
  const nowSec = resolveNowSec(runtime, suppliedNowSec);
  try {
    const engineResult = withEngineDb(db => {
      const stableIdentityState = readStableIdentitySchemaState(db);
      if (stableIdentityState === "partial" || stableIdentityState === "error") {
        throw new Error("stable memory identity schema incomplete; Engine reconciliation halted");
      }
      const stableIdentityReady = stableIdentityState === "migrated";
      const existingBefore = readExistingIds(db, eligibleIds);
      const existingDetails = readExistingDetails(db, eligibleIds);
      const missingRows = collection.eligibleCoreRows.filter(row => !existingBefore.has(row.id));
      const identityRepairRows = stableIdentityReady
        ? collection.eligibleCoreRows.filter(row => (
          !String(existingDetails.get(row.id)?.entity_id ?? "").trim()
          && existingBefore.has(row.id)
        ))
        : [];
      const workRows = prioritizeTargetDateRows(
        [...identityRepairRows, ...missingRows],
        targetDate,
        targetDate ? new Set(collection.target_date_candidate_ids || []) : null,
      );
      const repairIds = new Set(identityRepairRows.map(row => row.id));
      const selectedRows = workRows.slice(0, MAX_ENGINE_INSERTS_PER_CYCLE);
      let inserted = 0;
      let identityRepaired = 0;
      if (selectedRows.length > 0) {
        const transaction = db.transaction(() => {
          const legacyInsert = stableIdentityReady ? null : db.prepare(`
            INSERT OR IGNORE INTO memory_confidence
              (chunk_id, initial_confidence, confidence, last_confidence_update,
               base_tau, hit_count, is_archived, is_protected, conflict_flag, category)
            VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?)
          `);
          for (const row of selectedRows) {
            const params = catParamsImpl("raw_log", false);
            const result = stableIdentityReady
              ? assignStableMemoryIdentity(db, {
                skipSchema: true,
                chunkId: row.id,
                path: row.path,
                source: "core",
                text: row.text,
                initialConfidence: params.conf,
                confidence: params.conf,
                lastConfidenceUpdate: nowSec,
                baseTau: params.tau,
                category: "raw_log",
              })
              : { confidence: legacyInsert.run(
                row.id,
                params.conf,
                params.conf,
                nowSec,
                params.tau,
                "raw_log",
              ) };
            if (repairIds.has(row.id) && result.confidence?.linked) identityRepaired += 1;
            else if (result.confidence?.created) inserted += 1;
            else if (!stableIdentityReady && Number(result.confidence?.changes || 0) > 0) inserted += 1;
          }
        });
        transaction();
      }
      const managedAfter = readExistingIds(db, eligibleIds);
      const detailsAfter = readExistingDetails(db, eligibleIds);
      const identityMissingAfter = stableIdentityReady
        ? collection.eligibleCoreRows.filter(row => (
          managedAfter.has(row.id) && !detailsAfter.get(row.id)?.entity_id
        ))
        : [];
      const targetCandidateIds = new Set(collection.target_date_candidate_ids || []);
      const targetIds = new Set(collection.eligibleCoreRows
        .filter(row => targetCandidateIds.has(String(row.id || "")))
        .map(row => row.id));
      const targetMissingAfter = targetIds.size === 0
        ? 0
        : [...targetIds].filter(id => (
          !managedAfter.has(id) || identityMissingAfter.some(row => row.id === id)
        )).length;
      return {
        engine_existing: existingBefore.size,
        engine_missing_before: missingRows.length,
        engine_inserted: inserted,
        engine_identity_repaired: identityRepaired,
        engine_identity_missing_before: identityRepairRows.length,
        engine_identity_missing_after: identityMissingAfter.length,
        engine_backlog_remaining: (eligibleIds.length - managedAfter.size) + identityMissingAfter.length,
        target_date_backlog_remaining: targetDate
          ? targetMissingAfter
          : (eligibleIds.length - managedAfter.size) + identityMissingAfter.length,
        stable_identity_ready: stableIdentityReady,
        stable_identity_state: stableIdentityState,
      };
    });
    const targetDateComplete = targetDate
      ? engineResult.target_date_backlog_remaining === 0
        && collection.target_date_ambiguous_chunk_count === 0
      : engineResult.engine_backlog_remaining === 0
        && collection.ambiguous_chunk_count === 0;
    return {
      ...base,
      ...engineResult,
      engine_converged: engineResult.engine_backlog_remaining === 0
        && collection.ambiguous_chunk_count === 0,
      target_date_engine_converged: targetDateComplete,
      target_date_input_complete: targetDateComplete,
      historical_backlog_remaining: Math.max(
        0,
        engineResult.engine_backlog_remaining - engineResult.target_date_backlog_remaining,
      ),
      historical_ambiguous_chunk_count: Math.max(
        0,
        collection.ambiguous_chunk_count - collection.target_date_ambiguous_chunk_count,
      ),
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
