import { withEngineDb } from "../db/engine-db.js";
import { tableExists } from "../db/schema.js";
import {
  getPathFamily,
  isActiveMemoryPath,
  isDefaultIncludedPathFamily,
} from "./path-family.js";
import { attachEventStatsByPrefix } from "./event-prefix-join.js";

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

function readEventRows(db) {
  if (!tableExists(db, "memory_events")) return [];
  return db.prepare(`
      SELECT
        memory_id,
        COUNT(*) AS total_count,
        SUM(CASE WHEN event_type = 'memory_candidate_retrieved' THEN 1 ELSE 0 END) AS retrieved_count,
        SUM(CASE WHEN event_type = 'memory_injected' THEN 1 ELSE 0 END) AS injected_count,
        MAX(CASE WHEN event_type = 'memory_candidate_retrieved' THEN created_at END) AS last_retrieved_at,
        MAX(CASE WHEN event_type = 'memory_injected' THEN created_at END) AS last_injected_at
      FROM memory_events
      WHERE memory_id IS NOT NULL AND memory_id <> ''
      GROUP BY memory_id
      ORDER BY memory_id ASC
    `).all();
}

function readEventTypeDistribution(db) {
  if (!tableExists(db, "memory_events")) return {};
  const rows = db.prepare(`
      SELECT event_type, COUNT(*) AS count
      FROM memory_events
      GROUP BY event_type
      ORDER BY event_type ASC
    `).all();
  return Object.fromEntries(rows.map(row => [String(row.event_type || "unknown"), toCount(row.count)]));
}

function readMemoryEventsCount(db) {
  if (!tableExists(db, "memory_events")) return 0;
  return toCount(db.prepare("SELECT COUNT(*) AS c FROM memory_events").get()?.c);
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

function applyPathFamilyFilters(candidates, options) {
  return candidates.filter(candidate => {
    const family = getPathFamily(candidate.path);
    if (options.pathFamily && family !== options.pathFamily) return false;
    if (options.includeStatsHistory && family === "stats-history") return true;
    if (options.scope === "active-memory" && !options.pathFamily && !isDefaultIncludedPathFamily(family)) {
      return false;
    }
    if (options.scope === "active-memory" && !options.pathFamily && !isActiveMemoryPath(candidate.path)) {
      return false;
    }
    return true;
  }).map(candidate => ({
    ...candidate,
    path_family: getPathFamily(candidate.path),
  }));
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
    const filteredCandidates = applyPathFamilyFilters(candidateRows, normalizedOptions);
    const confidenceRows = readConfidenceRows(db);
    const eventAggRows = readEventRows(db);
    const eventTypeDistribution = readEventTypeDistribution(db);
    const joined = attachEventStatsByPrefix(filteredCandidates, eventAggRows);

    const pathFamilyDistribution = {};
    for (const candidate of joined.candidates) {
      incrementCount(pathFamilyDistribution, candidate.path_family);
    }

    const chunksWithoutConfidenceCount = joined.candidates
      .filter(candidate => !candidate.has_confidence_record)
      .length;

    const citeSignals = toCount(eventTypeDistribution.memory_injected)
      + eventAggRows.reduce((sum, row) => sum + toCount(row.injected_count), 0);
    const retrievedSignals = toCount(eventTypeDistribution.memory_candidate_retrieved)
      || joined.candidates.reduce((sum, row) => sum + toCount(row.retrieved_count), 0);

    const orphanDiagnostics = buildOrphanDiagnostics(confidenceRows, allChunkRows, eventAggRows);

    return {
      scope: normalizedOptions.scope,
      candidates: joined.candidates,
      diagnostics: {
        chunks_count: joined.candidates.length,
        memory_confidence_count: confidenceRows.length,
        memory_events_count: readMemoryEventsCount(db),
        ...orphanDiagnostics,
        chunks_without_confidence_count: chunksWithoutConfidenceCount,
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
      },
    };
  }, { readonly: true });
}
