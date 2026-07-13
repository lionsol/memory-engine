import { statSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const STORAGE_KEYS = ["text", "blob", "integer", "real", "null", "other"];
const RECENT_PATH_FILTER = `
  c.path NOT LIKE 'memory/generated-smart-add/%'
  AND (
    c.path LIKE 'memory/smart-add/%'
    OR c.path LIKE 'memory/episodes/%'
  )
`;
const LIKE_BASE_FILTER = "c.path NOT LIKE 'memory/generated-smart-add/%'";

function emptyStorageClasses() {
  return Object.fromEntries(STORAGE_KEYS.map(key => [key, 0]));
}

function storageKey(value) {
  if (value === "text" || value === "blob" || value === "integer" || value === "real" || value === "null") {
    return value;
  }
  return "other";
}

function sqliteValueStorageClass(value) {
  if (value === null || value === undefined) return "null";
  if (Buffer.isBuffer(value)) return "blob";
  if (typeof value === "string") return "text";
  if (typeof value === "bigint") return "integer";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "real";
  return "other";
}

function idBytes(value) {
  return Buffer.byteLength(value, "utf8");
}

function safeCount(value) {
  return Number(value || 0);
}

function isArchivedLikeLegacy(value) {
  return Number(value ?? 0) !== 0;
}

function databaseList(db) {
  return db.prepare("PRAGMA database_list").all().map(row => ({
    name: String(row.name),
    file: String(row.file || ""),
  }));
}

function topologyFor(db) {
  const list = databaseList(db);
  return {
    readonly: db.readonly === true,
    database_names: list.map(row => row.name),
  };
}

function fileSnapshot(path) {
  if (!path) return null;
  const stat = statSync(path);
  return {
    basename: basename(path),
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeMs),
    inode: Number(stat.ino),
  };
}

function sameFileSnapshot(a, b) {
  if (!a || !b) return true;
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.inode === b.inode;
}

function dataVersion(db) {
  return Number(db.prepare("PRAGMA data_version").get()?.data_version ?? 0);
}

function rowsByStorageClass(db, table, column, where = "1 = 1") {
  return db.prepare(`
    SELECT typeof(${column}) AS storage_class, COUNT(*) AS count
    FROM ${table}
    WHERE ${where}
    GROUP BY typeof(${column})
    ORDER BY storage_class
  `).all();
}

export function classifySqliteStorageRows(rows = []) {
  const storageClasses = emptyStorageClasses();
  let total = 0;
  for (const row of rows || []) {
    const key = storageKey(String(row.storage_class));
    const count = safeCount(row.count ?? row.row_count);
    storageClasses[key] += count;
    total += count;
  }
  return {
    total,
    storage_classes: storageClasses,
    text_only: total === storageClasses.text,
    non_text_count: total - storageClasses.text,
  };
}

function classifyValues(values = []) {
  const storageClasses = emptyStorageClasses();
  for (const value of values) storageClasses[storageKey(sqliteValueStorageClass(value))] += 1;
  const total = values.length;
  return {
    total,
    storage_classes: storageClasses,
    text_only: total === storageClasses.text,
    non_text_count: total - storageClasses.text,
  };
}

function tableSchema(db, table, column) {
  const schemaRow = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const tableListRow = db.prepare("PRAGMA table_list").all().find(row => row.name === table);
  const columnInfo = columns.find(row => row.name === column);
  if (!schemaRow?.sql || !columnInfo) {
    return {
      declared_type: null,
      table_strict: false,
      future_text_only_enforced: false,
      present: false,
    };
  }
  const createSql = String(schemaRow.sql || "");
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hasTypeofCheck = new RegExp(`typeof\\s*\\(\\s*${escaped}\\s*\\)\\s*=\\s*['"]text['"]`, "i").test(createSql);
  const declaredType = String(columnInfo.type || "").toUpperCase();
  const tableStrict = Number(tableListRow?.strict || 0) === 1;
  return {
    declared_type: declaredType,
    table_strict: tableStrict,
    future_text_only_enforced: (tableStrict && declaredType === "TEXT") || hasTypeofCheck,
    present: true,
  };
}

export function evaluateRecentTextIdInvariant({ globalCoreStorage, globalEngineStorage, recentCoreStorage, archivedEngineStorage } = {}) {
  const failures = [];
  if (!globalCoreStorage?.text_only) failures.push("global_core_ids_non_text");
  if (!globalEngineStorage?.text_only) failures.push("global_engine_ids_non_text");
  if (!recentCoreStorage?.text_only) failures.push("recent_core_ids_non_text");
  if (!archivedEngineStorage?.text_only) failures.push("archived_engine_ids_non_text");
  return {
    passed: failures.length === 0,
    failures,
  };
}

function coreRecentRows(coreDb) {
  return coreDb.prepare(`
    SELECT
      c.id,
      typeof(c.id) AS id_storage_class,
      c.path,
      c.updated_at
    FROM chunks c
    WHERE ${RECENT_PATH_FILTER}
    ORDER BY c.updated_at DESC, c.id ASC
  `).all();
}

function allCoreIdRows(coreDb) {
  return coreDb.prepare(`
    SELECT id, typeof(id) AS id_storage_class
    FROM chunks
  `).all();
}

function coreLikeBaseRows(coreDb) {
  return coreDb.prepare(`
    SELECT c.id, typeof(c.id) AS id_storage_class
    FROM chunks c
    WHERE ${LIKE_BASE_FILTER}
  `).all();
}

function generatedSmartAddCount(coreDb) {
  return safeCount(coreDb.prepare(`
    SELECT COUNT(*) AS count
    FROM chunks c
    WHERE c.path LIKE 'memory/generated-smart-add/%'
  `).get()?.count);
}

function engineRows(engineDb) {
  return engineDb.prepare(`
    SELECT
      chunk_id,
      typeof(chunk_id) AS id_storage_class,
      is_archived
    FROM memory_confidence
  `).all();
}

function pathBucket(path) {
  const text = String(path || "");
  if (text.startsWith("memory/episodes/")) return "episode_path_count";
  if (text.startsWith("memory/smart-add/")) return "smart_add_path_count";
  if (text.startsWith("memory/generated-smart-add/")) return "generated_smart_add_excluded_count";
  return "other_path_count";
}

function buildTextEngineMap(rows) {
  const map = new Map();
  const duplicates = new Set();
  for (const row of rows) {
    if (typeof row.chunk_id !== "string") continue;
    if (map.has(row.chunk_id)) duplicates.add(row.chunk_id);
    else map.set(row.chunk_id, row);
  }
  return { map, duplicateCount: duplicates.size };
}

function uniqueTextCount(values) {
  return new Set(values.filter(value => typeof value === "string")).size;
}

function duplicateTextCount(values) {
  const seen = new Set();
  let duplicates = 0;
  for (const value of values) {
    if (typeof value !== "string") continue;
    if (seen.has(value)) duplicates += 1;
    else seen.add(value);
  }
  return duplicates;
}

function timestampDistribution(coreDb) {
  const base = coreDb.prepare(`
    SELECT
      COUNT(DISTINCT updated_at) AS distinct_timestamp_count,
      COALESCE(SUM(CASE WHEN updated_at IS NULL THEN 1 ELSE 0 END), 0) AS null_timestamp_count
    FROM chunks c
    WHERE ${RECENT_PATH_FILTER}
  `).get();
  const tieRows = coreDb.prepare(`
    SELECT COUNT(*) AS row_count
    FROM chunks c
    WHERE ${RECENT_PATH_FILTER}
    GROUP BY updated_at
    HAVING COUNT(*) > 1
  `).all();
  const nullTie = coreDb.prepare(`
    SELECT COUNT(*) AS row_count
    FROM chunks c
    WHERE ${RECENT_PATH_FILTER}
      AND updated_at IS NULL
  `).get();
  return {
    distinct_timestamp_count: safeCount(base?.distinct_timestamp_count),
    tie_group_count: tieRows.length,
    rows_in_tie_groups: tieRows.reduce((sum, row) => sum + safeCount(row.row_count), 0),
    max_tie_group_size: tieRows.reduce((max, row) => Math.max(max, safeCount(row.row_count)), 0),
    null_timestamp_count: safeCount(base?.null_timestamp_count),
    null_timestamp_tie_size: safeCount(nullTie?.row_count) > 1 ? safeCount(nullTie?.row_count) : 0,
  };
}

function summarizeArchivedPayload(engineRowsList) {
  const archived = engineRowsList.filter(row => isArchivedLikeLegacy(row.is_archived));
  const allText = archived.every(row => typeof row.chunk_id === "string");
  if (!allText) {
    return {
      row_count: archived.length,
      unique_id_count: null,
      all_text: false,
      duplicate_id_count: null,
      json_utf8_bytes: null,
      max_id_utf8_bytes: null,
      average_id_utf8_bytes: null,
    };
  }
  const ids = archived.map(row => row.chunk_id);
  const uniqueIds = [...new Set(ids)];
  const byteLengths = uniqueIds.map(idBytes);
  return {
    row_count: archived.length,
    unique_id_count: uniqueIds.length,
    all_text: true,
    duplicate_id_count: ids.length - uniqueIds.length,
    json_utf8_bytes: Buffer.byteLength(JSON.stringify(uniqueIds), "utf8"),
    max_id_utf8_bytes: byteLengths.length ? Math.max(...byteLengths) : 0,
    average_id_utf8_bytes: byteLengths.length
      ? Number((byteLengths.reduce((sum, value) => sum + value, 0) / byteLengths.length).toFixed(2))
      : 0,
  };
}

function summarizeLimitWindow(coreRows, engineMap, limit) {
  const naiveRows = coreRows.slice(0, limit);
  const naiveActiveRows = naiveRows.filter(row => {
    const engine = typeof row.id === "string" ? engineMap.get(row.id) : null;
    return !engine || !isArchivedLikeLegacy(engine.is_archived);
  });
  const legacyRows = coreRows
    .filter(row => {
      const engine = typeof row.id === "string" ? engineMap.get(row.id) : null;
      return !engine || !isArchivedLikeLegacy(engine.is_archived);
    })
    .slice(0, limit);
  return {
    limit,
    naive_core_window: {
      raw_count: naiveRows.length,
      active_count_under_legacy_semantics: naiveActiveRows.length,
      archived_excluded_count: naiveRows.length - naiveActiveRows.length,
      missing_confidence_count: naiveRows.filter(row => typeof row.id === "string" && !engineMap.has(row.id)).length,
      null_updated_at_count: naiveRows.filter(row => row.updated_at == null).length,
      order_contract: "updated_at_desc_id_asc",
    },
    legacy_semantic_window: {
      raw_count: legacyRows.length,
      active_count_under_legacy_semantics: legacyRows.length,
      archived_excluded_count: null,
      missing_confidence_count: legacyRows.filter(row => typeof row.id === "string" && !engineMap.has(row.id)).length,
      null_updated_at_count: legacyRows.filter(row => row.updated_at == null).length,
      order_contract: "updated_at_desc_id_asc",
    },
  };
}

export function summarizeRecentCandidateDomain({ coreRows = [], engineRows: engineRowsList = [] } = {}) {
  const { map: engineMap, duplicateCount: duplicateEngineTextIdCount } = buildTextEngineMap(engineRowsList);
  const domain = {
    core_row_count: coreRows.length,
    active_row_count_under_legacy_semantics: 0,
    archived_excluded_count: 0,
    missing_confidence_count: 0,
    confidence_present_count: 0,
    generated_smart_add_excluded_count: 0,
    episode_path_count: 0,
    smart_add_path_count: 0,
    other_path_count: 0,
    null_updated_at_count: 0,
    non_null_updated_at_count: 0,
  };
  for (const row of coreRows) {
    domain[pathBucket(row.path)] += 1;
    if (row.updated_at == null) domain.null_updated_at_count += 1;
    else domain.non_null_updated_at_count += 1;

    const engine = typeof row.id === "string" ? engineMap.get(row.id) : null;
    if (!engine) {
      domain.missing_confidence_count += 1;
      domain.active_row_count_under_legacy_semantics += 1;
      continue;
    }
    domain.confidence_present_count += 1;
    if (isArchivedLikeLegacy(engine.is_archived)) domain.archived_excluded_count += 1;
    else domain.active_row_count_under_legacy_semantics += 1;
  }
  return { domain, duplicateEngineTextIdCount };
}

function crossDbRelationship({ coreRows, allCoreRows = [], engineRows: engineRowsList, invariantPassed }) {
  if (!invariantPassed) {
    return { analysis_status: "skipped_non_text_ids" };
  }
  const recentIds = coreRows.map(row => row.id).filter(value => typeof value === "string");
  const recentIdSet = new Set(recentIds);
  const { map: engineMap, duplicateCount: duplicateEngineTextIdCount } = buildTextEngineMap(engineRowsList);
  let recentIdsWithConfidence = 0;
  let recentIdsArchived = 0;
  let recentIdsActiveWithConfidence = 0;
  for (const id of new Set(recentIds)) {
    const engine = engineMap.get(id);
    if (!engine) continue;
    recentIdsWithConfidence += 1;
    if (isArchivedLikeLegacy(engine.is_archived)) recentIdsArchived += 1;
    else recentIdsActiveWithConfidence += 1;
  }
  const engineTextIds = engineRowsList.map(row => row.chunk_id).filter(value => typeof value === "string");
  const coreTextIds = new Set(allCoreRows.map(row => row.id).filter(value => typeof value === "string"));
  return {
    analysis_status: "completed",
    recent_core_unique_id_count: recentIdSet.size,
    recent_ids_with_confidence: recentIdsWithConfidence,
    recent_ids_missing_confidence: recentIdSet.size - recentIdsWithConfidence,
    recent_ids_archived: recentIdsArchived,
    recent_ids_active_with_confidence: recentIdsActiveWithConfidence,
    engine_ids_missing_core_global: [...new Set(engineTextIds)].filter(id => !coreTextIds.has(id)).length,
    duplicate_core_id_count: duplicateTextCount(recentIds),
    duplicate_engine_id_count: duplicateEngineTextIdCount,
  };
}

export function resolveRecentIsolationReadinessDecision({ topologyValid, stable, invariant, crossDbAnalysis, schemaContract } = {}) {
  if (!topologyValid) {
    return {
      class: "fail_topology",
      reason: "invalid_readonly_topology",
      isolated_recent_implementation_allowed: false,
      production_enablement_recommended: false,
    };
  }
  if (!stable) {
    return {
      class: "inconclusive",
      reason: "database_changed_during_audit",
      isolated_recent_implementation_allowed: false,
      production_enablement_recommended: false,
    };
  }
  if (!invariant?.passed) {
    return {
      class: "fail_non_text_ids",
      reason: invariant?.failures?.join(",") || "non_text_ids",
      isolated_recent_implementation_allowed: false,
      production_enablement_recommended: false,
    };
  }
  if (crossDbAnalysis?.analysis_status !== "completed") {
    return {
      class: "fail_data_integrity",
      reason: "cross_db_analysis_not_completed",
      isolated_recent_implementation_allowed: false,
      production_enablement_recommended: false,
    };
  }
  if (crossDbAnalysis.duplicate_core_id_count > 0 || crossDbAnalysis.duplicate_engine_id_count > 0) {
    return {
      class: "fail_data_integrity",
      reason: "duplicate_ids",
      isolated_recent_implementation_allowed: false,
      production_enablement_recommended: false,
    };
  }
  return {
    class: "pass_current_snapshot",
    reason: "current_recent_text_id_gate_passed",
    isolated_recent_implementation_allowed: true,
    production_enablement_recommended: false,
    schema_future_text_only_enforced: Boolean(schemaContract?.schema_enforces_future_text_only),
  };
}

export async function runRecentIsolationReadinessAudit({
  coreDb,
  engineDb,
  coreDbPath = null,
  engineDbPath = null,
  deterministicRecentOrderComplete = true,
  beforeAfterStabilityCheck = null,
} = {}) {
  const coreFileBefore = fileSnapshot(coreDbPath);
  const engineFileBefore = fileSnapshot(engineDbPath);
  const coreDataVersionBefore = dataVersion(coreDb);
  const engineDataVersionBefore = dataVersion(engineDb);

  const topology = {
    core: topologyFor(coreDb),
    engine: topologyFor(engineDb),
  };
  const topologyValid =
    topology.core.readonly === true
    && topology.engine.readonly === true
    && topology.core.database_names.length === 1
    && topology.core.database_names[0] === "main"
    && topology.engine.database_names.length === 1
    && topology.engine.database_names[0] === "main";

  const globalCoreStorage = classifySqliteStorageRows(rowsByStorageClass(coreDb, "chunks", "id"));
  const globalEngineStorage = classifySqliteStorageRows(rowsByStorageClass(engineDb, "memory_confidence", "chunk_id"));
  const allCoreRows = allCoreIdRows(coreDb);
  const coreRows = coreRecentRows(coreDb);
  const likeRows = coreLikeBaseRows(coreDb);
  const engineRowsList = engineRows(engineDb);
  const archivedRows = engineRowsList.filter(row => isArchivedLikeLegacy(row.is_archived));
  const recentCoreStorage = classifyValues(coreRows.map(row => row.id));
  const matchingRecentIds = new Set(coreRows.map(row => row.id).filter(value => typeof value === "string"));
  const matchingEngineRows = engineRowsList.filter(row => typeof row.chunk_id === "string" && matchingRecentIds.has(row.chunk_id));
  const matchingEngineStorage = classifyValues(matchingEngineRows.map(row => row.chunk_id));
  const archivedEngineStorage = classifyValues(archivedRows.map(row => row.chunk_id));
  const likeBaseCoreStorage = classifyValues(likeRows.map(row => row.id));
  const { domain: recentDomain } = summarizeRecentCandidateDomain({ coreRows, engineRows: engineRowsList });
  recentDomain.generated_smart_add_excluded_count = generatedSmartAddCount(coreDb);

  const schemaCore = tableSchema(coreDb, "chunks", "id");
  const schemaEngine = tableSchema(engineDb, "memory_confidence", "chunk_id");
  const schemaContract = {
    core_id_declared_type: schemaCore.declared_type,
    engine_chunk_id_declared_type: schemaEngine.declared_type,
    core_table_strict: schemaCore.table_strict,
    engine_table_strict: schemaEngine.table_strict,
    core_future_text_only_enforced: schemaCore.future_text_only_enforced,
    engine_future_text_only_enforced: schemaEngine.future_text_only_enforced,
    schema_enforces_future_text_only: schemaCore.future_text_only_enforced && schemaEngine.future_text_only_enforced,
  };

  const invariant = evaluateRecentTextIdInvariant({
    globalCoreStorage,
    globalEngineStorage,
    recentCoreStorage,
    archivedEngineStorage,
  });
  const crossDbAnalysis = crossDbRelationship({
    coreRows,
    allCoreRows,
    engineRows: engineRowsList,
    invariantPassed: invariant.passed,
  });

  if (typeof beforeAfterStabilityCheck === "function") {
    await beforeAfterStabilityCheck();
  }

  const coreDataVersionAfter = dataVersion(coreDb);
  const engineDataVersionAfter = dataVersion(engineDb);
  const coreFileAfter = fileSnapshot(coreDbPath);
  const engineFileAfter = fileSnapshot(engineDbPath);
  const databaseStability = {
    stable:
      coreDataVersionBefore === coreDataVersionAfter
      && engineDataVersionBefore === engineDataVersionAfter
      && sameFileSnapshot(coreFileBefore, coreFileAfter)
      && sameFileSnapshot(engineFileBefore, engineFileAfter),
    core_data_version_before: coreDataVersionBefore,
    core_data_version_after: coreDataVersionAfter,
    engine_data_version_before: engineDataVersionBefore,
    engine_data_version_after: engineDataVersionAfter,
    core_file_changed: !sameFileSnapshot(coreFileBefore, coreFileAfter),
    engine_file_changed: !sameFileSnapshot(engineFileBefore, engineFileAfter),
  };

  const currentSnapshotTextIdInvariant = globalCoreStorage.text_only && globalEngineStorage.text_only;
  const currentRecentDataGatePassed = recentCoreStorage.text_only && archivedEngineStorage.text_only && crossDbAnalysis.analysis_status === "completed";
  const gates = {
    deterministic_recent_order_complete: Boolean(deterministicRecentOrderComplete),
    current_snapshot_text_id_invariant: currentSnapshotTextIdInvariant,
    current_recent_data_gate_passed: currentRecentDataGatePassed,
    schema_enforces_future_text_only: schemaContract.schema_enforces_future_text_only,
    guarded_isolated_recent_implementation_gate_passed:
      Boolean(deterministicRecentOrderComplete) && currentSnapshotTextIdInvariant && currentRecentDataGatePassed,
    production_enablement_gate_passed: false,
  };

  const decision = resolveRecentIsolationReadinessDecision({
    topologyValid,
    stable: databaseStability.stable,
    invariant,
    crossDbAnalysis,
    schemaContract,
  });

  return {
    audit: "memory-engine-recent-isolation-readiness",
    database_roles: {
      core: "core",
      engine: "engine",
    },
    topology,
    global_id_storage: {
      core: {
        total: globalCoreStorage.total,
        storage_classes: globalCoreStorage.storage_classes,
      },
      engine: {
        total: globalEngineStorage.total,
        storage_classes: globalEngineStorage.storage_classes,
      },
    },
    schema_contract: schemaContract,
    recent_domain: recentDomain,
    like_fallback_base_domain: {
      query_dependent: true,
      actual_like_result_not_evaluated: true,
      core_row_count: likeRows.length,
      core_id_storage: {
        total: likeBaseCoreStorage.total,
        storage_classes: likeBaseCoreStorage.storage_classes,
      },
    },
    recent_domain_id_storage: {
      core: {
        total: recentCoreStorage.total,
        storage_classes: recentCoreStorage.storage_classes,
      },
      matching_engine_rows: {
        total: matchingEngineStorage.total,
        storage_classes: matchingEngineStorage.storage_classes,
      },
      archived_engine_rows: {
        total: archivedEngineStorage.total,
        storage_classes: archivedEngineStorage.storage_classes,
      },
      like_fallback_base_core: {
        total: likeBaseCoreStorage.total,
        storage_classes: likeBaseCoreStorage.storage_classes,
      },
    },
    archived_exclusion_payload: summarizeArchivedPayload(engineRowsList),
    timestamp_distribution: timestampDistribution(coreDb),
    cross_db_relationship: crossDbAnalysis,
    recent_limit_windows: [20, 100, 500].map(limit => summarizeLimitWindow(coreRows, buildTextEngineMap(engineRowsList).map, limit)),
    database_stability: databaseStability,
    invariants: {
      global_core_ids_text_only: globalCoreStorage.text_only,
      global_engine_ids_text_only: globalEngineStorage.text_only,
      recent_core_ids_text_only: recentCoreStorage.text_only,
      archived_engine_ids_text_only: archivedEngineStorage.text_only,
      current_snapshot_text_id_invariant: currentSnapshotTextIdInvariant,
      schema_enforces_future_text_only: schemaContract.schema_enforces_future_text_only,
    },
    gates,
    decision,
  };
}

export function writeRecentIsolationReadinessReport(output, outPath) {
  writeFileSync(outPath, output, "utf8");
}
