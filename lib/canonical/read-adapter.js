import {
  composeCanonicalMemoryObject,
  validateCanonicalCoreRow,
  validateCanonicalEngineRow,
} from "./memory-object.js";

export const CORE_CANONICAL_LOOKUP_SQL = [
  "SELECT",
  "  id,",
  "  path,",
  "  source,",
  "  start_line,",
  "  end_line,",
  "  hash,",
  "  text,",
  "  updated_at",
  "FROM chunks",
  "WHERE id = ?",
  "LIMIT 2",
].join(" ");

export const ENGINE_CANONICAL_LOOKUP_SQL = [
  "SELECT",
  "  chunk_id,",
  "  initial_confidence,",
  "  confidence,",
  "  last_confidence_update,",
  "  base_tau,",
  "  hit_count,",
  "  is_archived,",
  "  is_protected,",
  "  conflict_flag,",
  "  category",
  "FROM memory_confidence",
  "WHERE chunk_id = ?",
  "LIMIT 2",
].join(" ");

function topologyFailure() {
  const error = new Error("invalid isolated readonly database topology");
  error.reason = "invalid_db_topology";
  return error;
}

function assertReadonlyIsolatedTopology(db) {
  if (!db || db.readonly !== true || typeof db.prepare !== "function") {
    throw topologyFailure();
  }

  let databaseList;
  try {
    databaseList = db.prepare("PRAGMA database_list").all();
  } catch {
    throw topologyFailure();
  }

  const persistentNames = databaseList
    .map(row => String(row?.name || ""))
    .filter(name => name !== "temp");
  if (persistentNames.length !== 1 || persistentNames[0] !== "main") {
    throw topologyFailure();
  }
  return true;
}

function failureResult(reason) {
  return {
    ok: false,
    memory: null,
    reason,
  };
}

function reasonFromError(error, fallback) {
  return [
    "invalid_memory_id",
    "core_not_found",
    "core_ambiguous",
    "core_malformed",
    "engine_ambiguous",
    "engine_malformed",
    "invalid_db_topology",
  ].includes(error?.reason)
    ? error.reason
    : fallback;
}

function readRows(withDb, sql, memoryId, fallbackReason) {
  if (typeof withDb !== "function") throw topologyFailure();
  return withDb((db) => {
    assertReadonlyIsolatedTopology(db);
    if (typeof db.prepare !== "function") throw topologyFailure();
    const statement = db.prepare(sql);
    if (!statement || typeof statement.all !== "function") {
      const error = new Error("readonly database query is unavailable");
      error.reason = fallbackReason;
      throw error;
    }
    return statement.all(memoryId);
  });
}

export function getCanonicalMemoryById(memoryId, {
  withCoreDb,
  withEngineDb,
} = {}) {
  if (typeof memoryId !== "string" || memoryId.trim().length === 0) {
    return failureResult("invalid_memory_id");
  }

  let coreRows;
  try {
    coreRows = readRows(withCoreDb, CORE_CANONICAL_LOOKUP_SQL, memoryId, "core_malformed");
  } catch (error) {
    return failureResult(reasonFromError(error, "core_malformed"));
  }

  if (!Array.isArray(coreRows)) return failureResult("core_malformed");
  if (coreRows.length === 0) return failureResult("core_not_found");
  if (coreRows.length > 1) return failureResult("core_ambiguous");

  const coreRow = coreRows[0];
  try {
    validateCanonicalCoreRow(coreRow);
  } catch (error) {
    return failureResult(reasonFromError(error, "core_malformed"));
  }

  let engineRows;
  try {
    engineRows = readRows(withEngineDb, ENGINE_CANONICAL_LOOKUP_SQL, memoryId, "engine_malformed");
  } catch (error) {
    return failureResult(reasonFromError(error, "engine_malformed"));
  }

  if (!Array.isArray(engineRows)) return failureResult("engine_malformed");
  if (engineRows.length > 1) return failureResult("engine_ambiguous");

  const engineRow = engineRows.length === 1 ? engineRows[0] : null;
  try {
    if (engineRow) validateCanonicalEngineRow(engineRow, memoryId);
    return {
      ok: true,
      memory: composeCanonicalMemoryObject(coreRow, engineRow),
    };
  } catch (error) {
    return failureResult(reasonFromError(error, engineRow ? "engine_malformed" : "core_malformed"));
  }
}
