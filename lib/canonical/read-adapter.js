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

const CORE_CANONICAL_BATCH_SELECT_SQL = [
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
].join(" ");

const ENGINE_CANONICAL_BATCH_SELECT_SQL = [
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
].join(" ");

function readStableEngineRowsByCoreIds(withDb, memoryIds) {
  if (typeof withDb !== "function" || !Array.isArray(memoryIds) || memoryIds.length === 0) return [];
  return withDb(db => {
    assertReadonlyIsolatedTopology(db);
    const tables = new Set(db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('memory_identity', 'memory_confidence')",
    ).all().map(row => String(row.name)));
    if (!tables.has("memory_identity") || !tables.has("memory_confidence")) return [];
    const columns = new Set(db.prepare("PRAGMA table_info(memory_confidence)").all().map(row => String(row.name)));
    if (!columns.has("entity_id")) return [];
    const placeholders = memoryIds.map(() => "?").join(", ");
    return db.prepare(`
      SELECT
        mi.core_chunk_id_snapshot AS chunk_id,
        mc.initial_confidence,
        mc.confidence,
        mc.last_confidence_update,
        mc.base_tau,
        mc.hit_count,
        mc.is_archived,
        mc.is_protected,
        mc.conflict_flag,
        mc.category
      FROM memory_identity mi
      JOIN memory_confidence mc ON mc.entity_id = mi.entity_id
      WHERE mi.core_chunk_id_snapshot IN (${placeholders})
    `).all(...memoryIds);
  });
}

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

function batchLookupSql(selectSql, column, count) {
  if (!Number.isInteger(count) || count < 1) throw topologyFailure();
  return `${selectSql} WHERE ${column} IN (${Array.from({ length: count }, () => "?").join(", ")})`;
}

function readBatchRows(withDb, sql, memoryIds, fallbackReason) {
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
    return statement.all(...memoryIds);
  });
}

function rowsById(rows, key) {
  const grouped = new Map();
  if (!Array.isArray(rows)) return grouped;
  for (const row of rows) {
    const id = row?.[key];
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(row);
  }
  return grouped;
}

function perIdFailure(memoryId, reason) {
  return {
    memory_id: memoryId,
    ok: false,
    memory: null,
    reason,
  };
}

function perIdSuccess(memoryId, memory) {
  return {
    memory_id: memoryId,
    ok: true,
    memory,
  };
}

function normalizeBatchInput(memoryIds) {
  if (!Array.isArray(memoryIds)) return null;
  if (memoryIds.some(id => typeof id !== "string" || id.trim().length === 0)) return null;
  return memoryIds;
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
  if (engineRows.length === 0) {
    try {
      engineRows = readStableEngineRowsByCoreIds(withEngineDb, [memoryId]);
    } catch (error) {
      return failureResult(reasonFromError(error, "engine_malformed"));
    }
  }
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

export function getCanonicalMemoriesByIds(memoryIds, {
  withCoreDb,
  withEngineDb,
} = {}) {
  const requestedIds = normalizeBatchInput(memoryIds);
  if (!requestedIds) {
    return {
      ok: false,
      results: [],
      reason: "invalid_memory_id",
    };
  }
  if (requestedIds.length === 0) return { ok: true, results: [] };

  const uniqueIds = [...new Set(requestedIds)];
  let coreRows;
  try {
    coreRows = readBatchRows(
      withCoreDb,
      batchLookupSql(CORE_CANONICAL_BATCH_SELECT_SQL, "id", uniqueIds.length),
      uniqueIds,
      "core_malformed",
    );
  } catch (error) {
    return {
      ok: false,
      results: [],
      reason: reasonFromError(error, "core_malformed"),
    };
  }
  if (!Array.isArray(coreRows)) {
    return {
      ok: true,
      results: requestedIds.map(memoryId => perIdFailure(memoryId, "core_malformed")),
    };
  }

  let engineRows;
  try {
    engineRows = readBatchRows(
      withEngineDb,
      batchLookupSql(ENGINE_CANONICAL_BATCH_SELECT_SQL, "chunk_id", uniqueIds.length),
      uniqueIds,
      "engine_malformed",
    );
  } catch (error) {
    return {
      ok: false,
      results: [],
      reason: reasonFromError(error, "engine_malformed"),
    };
  }
  if (!Array.isArray(engineRows)) {
    return {
      ok: true,
      results: requestedIds.map(memoryId => perIdFailure(memoryId, "engine_malformed")),
    };
  }

  const resolvedEngineIds = new Set(engineRows.map(row => String(row?.chunk_id || "")));
  const missingStableEngineIds = uniqueIds.filter(id => !resolvedEngineIds.has(String(id)));
  if (missingStableEngineIds.length > 0) {
    try {
      engineRows = [...engineRows, ...readStableEngineRowsByCoreIds(withEngineDb, missingStableEngineIds)];
    } catch (error) {
      return {
        ok: false,
        results: [],
        reason: reasonFromError(error, "engine_malformed"),
      };
    }
  }

  const coreRowsById = rowsById(coreRows, "id");
  const engineRowsById = rowsById(engineRows, "chunk_id");
  const resolvedById = new Map();

  for (const memoryId of uniqueIds) {
    const matchingCoreRows = coreRowsById.get(memoryId) || [];
    if (matchingCoreRows.length === 0) {
      resolvedById.set(memoryId, perIdFailure(memoryId, "core_not_found"));
      continue;
    }
    if (matchingCoreRows.length > 1) {
      resolvedById.set(memoryId, perIdFailure(memoryId, "core_ambiguous"));
      continue;
    }

    const coreRow = matchingCoreRows[0];
    try {
      validateCanonicalCoreRow(coreRow);
    } catch (error) {
      resolvedById.set(memoryId, perIdFailure(memoryId, reasonFromError(error, "core_malformed")));
      continue;
    }

    const matchingEngineRows = engineRowsById.get(memoryId) || [];
    if (matchingEngineRows.length > 1) {
      resolvedById.set(memoryId, perIdFailure(memoryId, "engine_ambiguous"));
      continue;
    }

    const engineRow = matchingEngineRows.length === 1 ? matchingEngineRows[0] : null;
    try {
      if (engineRow) validateCanonicalEngineRow(engineRow, memoryId);
      resolvedById.set(memoryId, perIdSuccess(
        memoryId,
        composeCanonicalMemoryObject(coreRow, engineRow),
      ));
    } catch (error) {
      resolvedById.set(memoryId, perIdFailure(
        memoryId,
        reasonFromError(error, engineRow ? "engine_malformed" : "core_malformed"),
      ));
    }
  }

  return {
    ok: true,
    results: requestedIds.map(memoryId => resolvedById.get(memoryId)),
  };
}
