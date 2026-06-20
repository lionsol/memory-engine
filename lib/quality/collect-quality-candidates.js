import { withEngineDb } from "../db/engine-db.js";
import { tableExists } from "../db/schema.js";
import {
  getPathFamily,
} from "./path-family.js";
import { attachEventStatsByPrefix } from "./event-prefix-join.js";
import { classifyQualityScope } from "./quality-scope.js";
import { readUnifiedMemoryEvents } from "../../console/services/metrics-service.js";

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeBoolInt(value) {
  return Number(value || 0) ? 1 : 0;
}

function monthKeyFromUnixSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "unknown";
  return new Date(seconds * 1000).toISOString().slice(0, 7);
}

function incrementCount(map, key, by = 1) {
  const name = String(key ?? "unknown");
  map[name] = (map[name] || 0) + by;
}

function getTableColumns(db, schemaName, tableName) {
  try {
    return db.prepare(`PRAGMA ${schemaName}.table_info(${tableName})`).all()
      .map(row => String(row.name || ""));
  } catch {
    return [];
  }
}

function buildChunkSelect(columns) {
  const has = name => columns.includes(name);
  const selectColumn = (name, fallback = "NULL") => (
    has(name) ? `c.${name} AS ${name}` : `${fallback} AS ${name}`
  );

  return [
    "c.id AS id",
    "c.path AS path",
    selectColumn("source"),
    "c.text AS text",
    selectColumn("updated_at"),
    selectColumn("start_line"),
    selectColumn("end_line"),
    selectColumn("hash"),
    "mc.confidence AS confidence",
    "mc.initial_confidence AS initial_confidence",
    "mc.last_confidence_update AS last_confidence_update",
    "mc.base_tau AS base_tau",
    "mc.hit_count AS hit_count",
    "mc.is_archived AS is_archived",
    "mc.is_protected AS is_protected",
    "mc.conflict_flag AS conflict_flag",
    "mc.category AS category",
    "mc.kg_data AS kg_data",
    "CASE WHEN mc.chunk_id IS NULL THEN 0 ELSE 1 END AS has_confidence_record",
  ].join(",\n        ");
}

function buildChunkWhereClause({ includeArchived, includeStatsHistory, pathPrefix, category }) {
  const where = [
    "(c.path LIKE 'memory/%' OR c.path = 'MEMORY.md')",
  ];

  if (!includeStatsHistory) {
    where.push("c.path <> 'memory/stats-history.md'");
  }

  if (!includeArchived) {
    where.push("(mc.is_archived IS NULL OR mc.is_archived = 0)");
  }

  if (pathPrefix) {
    where.push("c.path LIKE @pathPrefixLike");
  }

  if (category) {
    where.push("mc.category = @category");
  }

  return where.join("\n        AND ");
}

function readCandidateRows(db, options) {
  const chunkColumns = getTableColumns(db, "core", "chunks");
  const selectSql = buildChunkSelect(chunkColumns);
  const whereSql = buildChunkWhereClause(options);

  return db.prepare(`
      SELECT
        ${selectSql}
      FROM core.chunks c
      LEFT JOIN memory_confidence mc ON mc.chunk_id = c.id
      WHERE ${whereSql}
      ORDER BY c.updated_at DESC, c.id ASC
    `).all({
    pathPrefixLike: options.pathPrefix ? `${options.pathPrefix}%` : null,
    category: options.category ?? null,
  });
}

function readChunkIdentityRows(db) {
  return db.prepare(`
      SELECT c.id AS id
      FROM core.chunks c
      WHERE c.path LIKE 'memory/%' OR c.path = 'MEMORY.md'
      ORDER BY c.id ASC
    `).all();
}

function readConfidenceRows(db) {
  if (!tableExists(db, "memory_confidence")) return [];
  return db.prepare(`
      SELECT
        chunk_id,
        initial_confidence,
        confidence,
        last_confidence_update,
        base_tau,
        hit_count,
        is_archived,
        is_protected,
        conflict_flag,
        category,
        kg_data
      FROM memory_confidence
      ORDER BY chunk_id ASC
    `).all();
}

function aggregateUnifiedEventRows(rows) {
  const byMemoryId = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const memoryId = String(row?.memory_id ?? "");
    if (!memoryId) continue;
    const entry = byMemoryId.get(memoryId) || {
      memory_id: memoryId,
      total_count: 0,
      retrieved_count: 0,
      injected_count: 0,
      last_retrieved_at: null,
      last_injected_at: null,
    };
    entry.total_count += 1;
    if (row?.event_type === "memory_candidate_retrieved") {
      entry.retrieved_count += 1;
      entry.last_retrieved_at = row?.created_at ?? entry.last_retrieved_at;
    }
    if (row?.event_type === "memory_injected") {
      entry.injected_count += 1;
      entry.last_injected_at = row?.created_at ?? entry.last_injected_at;
    }
    byMemoryId.set(memoryId, entry);
  }
  return Array.from(byMemoryId.values())
    .sort((a, b) => String(a.memory_id).localeCompare(String(b.memory_id)));
}

function readEventRows(db) {
  return aggregateUnifiedEventRows(readUnifiedMemoryEvents(db));
}

function readEventTypeDistribution(db) {
  const counts = new Map();
  for (const row of readUnifiedMemoryEvents(db)) {
    const key = String(row?.event_type || "unknown");
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const rows = Array.from(counts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));
  return Object.fromEntries(rows.map(([eventType, count]) => [String(eventType || "unknown"), toCount(count)]));
}

function readMemoryEventsCount(db) {
  return readUnifiedMemoryEvents(db).length;
}

function normalizeCandidateRow(row) {
  return {
    id: String(row.id || ""),
    path: String(row.path || ""),
    source: row.source ?? null,
    text: row.text ?? null,
    updated_at: row.updated_at ?? null,
    start_line: row.start_line ?? null,
    end_line: row.end_line ?? null,
    hash: row.hash ?? null,
    confidence: row.confidence ?? null,
    initial_confidence: row.initial_confidence ?? null,
    last_confidence_update: row.last_confidence_update ?? null,
    base_tau: row.base_tau ?? null,
    hit_count: toCount(row.hit_count),
    is_archived: normalizeBoolInt(row.is_archived),
    is_protected: normalizeBoolInt(row.is_protected),
    conflict_flag: normalizeBoolInt(row.conflict_flag),
    category: row.category ?? null,
    kg_data: row.kg_data ?? null,
    has_confidence_record: Boolean(row.has_confidence_record),
  };
}

function annotateQualityScope(candidate) {
  const qualityScope = classifyQualityScope(candidate.path);
  return {
    ...candidate,
    path_family: getPathFamily(candidate.path),
    quality_scope_family: qualityScope.family,
    quality_scope_owner: qualityScope.owner,
    expected_confidence: qualityScope.expected_confidence,
    default_quality_score_scope: qualityScope.default_quality_score_scope,
    diagnostic_scope: qualityScope.diagnostic_scope,
    retrieval_visible: qualityScope.retrieval_visible,
    quality_scope_reason: qualityScope.reason,
  };
}

function applyPathFamilyFilters(candidates, options) {
  return candidates.filter(candidate => {
    const family = getPathFamily(candidate.path);
    if (options.pathFamily && family !== options.pathFamily) return false;
    if (options.includeStatsHistory && family === "stats-history") return true;
    if (options.scope === "active-memory" && !options.pathFamily && !candidate.default_quality_score_scope) {
      return false;
    }
    return true;
  });
}

function buildOwnershipMissingCounts(candidates) {
  const missing = candidates.filter(candidate => !candidate.has_confidence_record);
  return {
    chunks_without_confidence_count: missing.length,
    chunks_without_confidence_lifecycle_owned_count: missing.filter(candidate => candidate.quality_scope_owner === "memory_engine_lifecycle").length,
    chunks_without_confidence_core_owned_count: missing.filter(candidate => candidate.quality_scope_owner === "openclaw_core").length,
    chunks_without_confidence_generated_diagnostic_count: missing.filter(candidate => candidate.quality_scope_owner === "memory_engine_generated_or_diagnostic").length,
    chunks_without_confidence_legacy_manual_count: missing.filter(candidate => candidate.quality_scope_owner === "memory_engine_legacy_or_manual" || candidate.quality_scope_owner === "raw_or_legacy").length,
    chunks_without_confidence_unknown_count: missing.filter(candidate => candidate.quality_scope_owner === "unknown").length,
  };
}

function buildNonLifecycleRetrievalWarnings(candidates) {
  const warned = candidates
    .filter(candidate => candidate.quality_scope_owner !== "memory_engine_lifecycle")
    .filter(candidate => Number(candidate.retrieved_count || 0) > 0 || Number(candidate.injected_count || 0) > 0)
    .sort((a, b) => (
      Number(b.injected_count || 0) - Number(a.injected_count || 0)
      || Number(b.retrieved_count || 0) - Number(a.retrieved_count || 0)
      || String(a.path || "").localeCompare(String(b.path || ""))
      || String(a.id || "").localeCompare(String(b.id || ""))
    ));

  return {
    non_lifecycle_retrieved_count: warned.filter(candidate => Number(candidate.retrieved_count || 0) > 0).length,
    non_lifecycle_injected_count: warned.filter(candidate => Number(candidate.injected_count || 0) > 0).length,
    examples: warned.slice(0, 10).map(candidate => ({
      id: candidate.id,
      path: candidate.path,
      owner: candidate.quality_scope_owner,
      family: candidate.quality_scope_family,
      retrieved_count: Number(candidate.retrieved_count || 0),
      injected_count: Number(candidate.injected_count || 0),
      reason: candidate.quality_scope_reason,
    })),
  };
}

function buildOrphanDiagnostics(confidenceRows, allChunkRows, eventAggRows) {
  const chunkIds = new Set(allChunkRows.map(row => row.id));
  const chunkPrefixCounts = new Map();
  for (const row of allChunkRows) {
    const prefix = String(row.id || "").slice(0, 16);
    chunkPrefixCounts.set(prefix, (chunkPrefixCounts.get(prefix) || 0) + 1);
  }
  const eventPrefixes = new Set(eventAggRows.map(row => String(row.memory_id || "")));

  const orphanMonthDistribution = {};
  const confidenceIdLengthDistribution = {};
  const orphanIds = [];
  let exactOrphan = 0;
  let trulyMissingOrphan = 0;
  let fakeOrphan = 0;
  let orphanEventPrefixSeen = 0;

  for (const row of confidenceRows) {
    const chunkId = String(row.chunk_id || "");
    incrementCount(confidenceIdLengthDistribution, String(chunkId.length));
    if (chunkIds.has(chunkId)) continue;

    exactOrphan += 1;
    orphanIds.push(chunkId);
    incrementCount(orphanMonthDistribution, monthKeyFromUnixSeconds(row.last_confidence_update));

    const prefix = chunkId.slice(0, 16);
    if (eventPrefixes.has(prefix)) orphanEventPrefixSeen += 1;

    if (chunkPrefixCounts.has(prefix)) fakeOrphan += 1;
    else trulyMissingOrphan += 1;
  }

  return {
    exact_orphan_confidence_count: exactOrphan,
    truly_missing_orphan_confidence_count: trulyMissingOrphan,
    fake_orphan_confidence_count: fakeOrphan,
    orphan_confidence_month_distribution: orphanMonthDistribution,
    orphan_confidence_event_prefix_seen_count: orphanEventPrefixSeen,
    sample_orphan_confidence_ids: orphanIds.slice(0, 10),
    confidence_id_length_distribution: confidenceIdLengthDistribution,
  };
}

export function collectQualityCandidates(options = {}) {
  const normalizedOptions = {
    includeArchived: false,
    includeStatsHistory: false,
    pathFamily: null,
    pathPrefix: null,
    category: null,
    scope: "active-memory",
    ...options,
  };

  return withEngineDb((db) => {
    const candidateRows = readCandidateRows(db, normalizedOptions).map(normalizeCandidateRow);
    const allChunkRows = readChunkIdentityRows(db);
    const scopedCandidates = candidateRows.map(annotateQualityScope);
    const filteredCandidates = applyPathFamilyFilters(scopedCandidates, normalizedOptions);
    const confidenceRows = readConfidenceRows(db);
    const eventAggRows = readEventRows(db);
    const eventTypeDistribution = readEventTypeDistribution(db);
    const joined = attachEventStatsByPrefix(filteredCandidates, eventAggRows);

    const pathFamilyDistribution = {};
    const qualityScopeFamilyDistribution = {};
    const qualityScopeOwnerDistribution = {};
    for (const candidate of joined.candidates) {
      incrementCount(pathFamilyDistribution, candidate.path_family);
      incrementCount(qualityScopeFamilyDistribution, candidate.quality_scope_family);
      incrementCount(qualityScopeOwnerDistribution, candidate.quality_scope_owner);
    }

    const missingCounts = buildOwnershipMissingCounts(joined.candidates);

    const citeSignals = toCount(eventTypeDistribution.memory_injected)
      + eventAggRows.reduce((sum, row) => sum + toCount(row.injected_count), 0);
    const retrievedSignals = toCount(eventTypeDistribution.memory_candidate_retrieved)
      || joined.candidates.reduce((sum, row) => sum + toCount(row.retrieved_count), 0);

    const orphanDiagnostics = buildOrphanDiagnostics(confidenceRows, allChunkRows, eventAggRows);
    const ownershipWarnings = buildNonLifecycleRetrievalWarnings(joined.candidates);

    return {
      scope: normalizedOptions.scope,
      candidates: joined.candidates,
      diagnostics: {
        chunks_count: joined.candidates.length,
        memory_confidence_count: confidenceRows.length,
        memory_events_count: readMemoryEventsCount(db),
        ...orphanDiagnostics,
        ...missingCounts,
        event_type_distribution: eventTypeDistribution,
        chunk_prefix_unique_count: joined.diagnostics.chunk_prefix_unique_count,
        chunk_prefix_ambiguous_count: joined.diagnostics.chunk_prefix_ambiguous_count,
        event_prefix_total_distinct: joined.diagnostics.event_prefix_total_distinct,
        event_prefix_matched_count: joined.diagnostics.event_prefix_matched_count,
        event_prefix_unmatched_count: joined.diagnostics.event_prefix_unmatched_count,
        event_prefix_ambiguous_count: joined.diagnostics.event_prefix_ambiguous_count,
        cite_signal_sparse: {
          retrieved_signal_count: retrievedSignals,
          cite_signal_count: citeSignals,
          sparse: citeSignals <= 1 || citeSignals < Math.max(1, Math.ceil(retrievedSignals * 0.1)),
        },
        path_family_distribution: pathFamilyDistribution,
        quality_scope_family_distribution: qualityScopeFamilyDistribution,
        quality_scope_owner_distribution: qualityScopeOwnerDistribution,
        non_lifecycle_recall_warnings: ownershipWarnings,
      },
    };
  }, { readonly: true });
}
