#!/usr/bin/env node

const { createRequire } = require("node:module");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const Database = require("better-sqlite3");

const requireJson = createRequire(__filename);
const BETTER_SQLITE3_VERSION = requireJson("better-sqlite3/package.json").version;

const RECENT_LEGACY_SQL = `
  SELECT c.id, c.text, c.path, c.updated_at,
    mc.confidence as confidence,
    mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,
    COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,
    COALESCE(mc.conflict_flag, 0) as conflict_flag, mc.category as category,
    COALESCE(mc.is_archived, 0) as is_archived
  FROM chunks c
  LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
  WHERE COALESCE(mc.is_archived, 0) = 0
    AND c.path NOT LIKE 'memory/generated-smart-add/%'
    AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
  ORDER BY c.updated_at DESC
  LIMIT ?
`;

const RECENT_FALLBACK_LEGACY_SQL = RECENT_LEGACY_SQL;

const RECENT_LIKE_LEGACY_SQL = (patternCount) => `
  SELECT c.id, c.text, c.path, c.updated_at,
    mc.confidence as confidence,
    mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,
    COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,
    COALESCE(mc.conflict_flag, 0) as conflict_flag, mc.category as category,
    COALESCE(mc.is_archived, 0) as is_archived
  FROM chunks c
  LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
  WHERE COALESCE(mc.is_archived, 0) = 0
    AND c.path NOT LIKE 'memory/generated-smart-add/%'
    AND (${Array.from({ length: patternCount }, () => "(c.path LIKE ? OR c.text LIKE ?)").join(" OR ")})
  ORDER BY c.updated_at DESC
  LIMIT ?
`;

const CORE_FIRST_RECENT_SQL = `
  SELECT
    c.id,
    c.text,
    c.path,
    c.updated_at
  FROM chunks c
  WHERE c.path NOT LIKE 'memory/generated-smart-add/%'
    AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(?) AS archived
      WHERE c.id = CAST(archived.value AS TEXT)
    )
  ORDER BY c.updated_at DESC
  LIMIT ?
`;

const CORE_FIRST_LIKE_SQL = (patternCount) => `
  SELECT
    c.id,
    c.text,
    c.path,
    c.updated_at
  FROM chunks c
  WHERE c.path NOT LIKE 'memory/generated-smart-add/%'
    AND (${Array.from({ length: patternCount }, () => "(c.path LIKE ? OR c.text LIKE ?)").join(" OR ")})
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(?) AS archived
      WHERE c.id = CAST(archived.value AS TEXT)
    )
  ORDER BY c.updated_at DESC
  LIMIT ?
`;

const ENGINE_FIRST_ACTIVE_SQL = `
  SELECT
    chunk_id,
    typeof(chunk_id) AS chunk_id_storage_class,
    confidence,
    last_confidence_update,
    COALESCE(base_tau, 7.0) AS base_tau,
    COALESCE(hit_count, 0) AS hit_count,
    COALESCE(is_protected, 0) AS is_protected,
    COALESCE(conflict_flag, 0) AS conflict_flag,
    category,
    COALESCE(is_archived, 0) AS is_archived
  FROM memory_confidence
  WHERE COALESCE(is_archived, 0) = 0
`;

const CORE_JOIN_ENGINE_IDS_SQL = `
  SELECT
    c.id,
    c.text,
    c.path,
    c.updated_at
  FROM json_each(?) AS candidate
  JOIN chunks c
    ON c.id = CAST(candidate.value AS TEXT)
  WHERE c.path NOT LIKE 'memory/generated-smart-add/%'
    AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
  ORDER BY c.updated_at DESC
  LIMIT ?
`;

const CORE_JOIN_ENGINE_IDS_LIKE_SQL = (patternCount) => `
  SELECT
    c.id,
    c.text,
    c.path,
    c.updated_at
  FROM json_each(?) AS candidate
  JOIN chunks c
    ON c.id = CAST(candidate.value AS TEXT)
  WHERE c.path NOT LIKE 'memory/generated-smart-add/%'
    AND (${Array.from({ length: patternCount }, () => "(c.path LIKE ? OR c.text LIKE ?)").join(" OR ")})
  ORDER BY c.updated_at DESC
  LIMIT ?
`;

const DETERMINISTIC_RECENT_SQL = `
  SELECT c.id
  FROM chunks c
  LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
  WHERE COALESCE(mc.is_archived, 0) = 0
    AND c.path NOT LIKE 'memory/generated-smart-add/%'
    AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
  ORDER BY c.updated_at DESC, c.id ASC
  LIMIT ?
`;

async function getDeps() {
  const [
    queryUtils,
    recentChannel,
    debugMod,
    normalizeMod,
    fusionMod,
  ] = await Promise.all([
    import("../query-utils.js"),
    import("../lib/recall/hybrid/channels/recent.js"),
    import("../lib/recall/hybrid/debug.js"),
    import("../lib/recall/hybrid/normalize-candidate.js"),
    import("../lib/recall/hybrid/fusion.js"),
  ]);
  return {
    ...queryUtils,
    ...recentChannel,
    ...debugMod,
    ...normalizeMod,
    ...fusionMod,
  };
}

function escapeSqlitePath(path) {
  return String(path).replace(/'/g, "''");
}

function sqliteVersion(db) {
  return String(db.prepare("SELECT sqlite_version() AS version").get().version);
}

function lexicalMatchScore(haystack, terms) {
  if (!Array.isArray(terms) || terms.length === 0) return 0;
  const raw = String(haystack || "").toLowerCase();
  let matched = 0;
  for (const term of terms) {
    if (!term) continue;
    if (raw.includes(term)) matched += 1;
  }
  if (matched === 0) return 0;
  return Math.round((matched / terms.length) * 10000) / 10000;
}

function uniqueById(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!item || !Object.hasOwn(item, "id")) continue;
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return [...map.values()];
}

function dbNames(db) {
  return db.prepare("PRAGMA database_list").all().map((row) => String(row.name));
}

function isArchivedLikeLegacySql(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "bigint") return value !== 0n;
  return true;
}

function makeEngineMetadataMap(rows = []) {
  const map = new Map();
  for (const row of rows) {
    if (typeof row.chunk_id !== "string") continue;
    if (!map.has(row.chunk_id)) map.set(row.chunk_id, row);
  }
  return map;
}

function mergeRecentRow(coreRow, engineRow) {
  return {
    id: coreRow.id,
    text: coreRow.text,
    path: coreRow.path,
    updated_at: coreRow.updated_at,
    confidence: engineRow?.confidence ?? null,
    last_confidence_update: engineRow?.last_confidence_update ?? null,
    base_tau: engineRow?.base_tau ?? 7.0,
    hit_count: engineRow?.hit_count ?? 0,
    is_protected: engineRow?.is_protected ?? 0,
    conflict_flag: engineRow?.conflict_flag ?? 0,
    category: engineRow?.category ?? null,
    is_archived: engineRow?.is_archived ?? 0,
  };
}

function normalizeRowSummary(row) {
  if (!row) return null;
  const summary = {};
  for (const key of [
    "id",
    "text",
    "path",
    "updated_at",
    "confidence",
    "last_confidence_update",
    "base_tau",
    "hit_count",
    "is_protected",
    "conflict_flag",
    "category",
    "is_archived",
    "confidence_realtime",
    "confidence_mode",
    "hits",
    "similarity",
    "semantic_score",
    "created_at",
    "source_type",
  ]) {
    summary[key] = Object.hasOwn(row, key) ? row[key] : null;
  }
  return summary;
}

function rowsEquivalent(a = [], b = []) {
  return JSON.stringify(a.map(normalizeRowSummary)) === JSON.stringify(b.map(normalizeRowSummary));
}

function idsOf(rows = []) {
  return rows.map((row) => {
    if (Buffer.isBuffer(row.id)) return { storage: "blob", hex: row.id.toString("hex") };
    return row.id;
  });
}

function branchInventory() {
  const source = readFileSync(join(__dirname, "../lib/recall/hybrid/channels/recent.js"), "utf8");
  return [
    {
      branch: "like_fallback",
      trigger: "ftsIsEmpty === true and buildLikeFallbackPatterns(normalizedQuery, likePatternTopN).length > 0",
      sql_tables: ["chunks", "memory_confidence"],
      join_type: "LEFT JOIN",
      filters: [
        "COALESCE(mc.is_archived, 0) = 0",
        "c.path NOT LIKE 'memory/generated-smart-add/%'",
        "OR of (c.path LIKE ? OR c.text LIKE ?)",
      ],
      ordering: source.includes("ORDER BY c.updated_at DESC") ? ["c.updated_at DESC"] : [],
      limit_position: "SQL before JS filtering",
      post_processing: [
        "candidateCounts.like_raw",
        "normalizeCandidate",
        "filterForRerank",
        "uniqueById",
      ],
    },
    {
      branch: "recent_scored",
      trigger: "always runs",
      sql_tables: ["chunks", "memory_confidence"],
      join_type: "LEFT JOIN",
      filters: [
        "COALESCE(mc.is_archived, 0) = 0",
        "c.path NOT LIKE 'memory/generated-smart-add/%'",
        "(c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')",
      ],
      ordering: ["c.updated_at DESC"],
      limit_position: "SQL before JS filtering",
      post_processing: [
        "candidateCounts.recent_raw",
        "lexicalMatchScore > 0",
        "computeRecencyBoost",
        "normalizeCandidate",
        "filterForRerank",
        "sort semantic_score DESC",
        "slice recentRerankTopK",
        "uniqueById",
      ],
    },
    {
      branch: "episode_projection",
      trigger: "post-processing of scored recent rows when category is episodic or path starts memory/episodes/",
      sql_tables: [],
      join_type: "none",
      filters: [
        "row.category === 'episodic' OR path starts with memory/episodes/",
      ],
      ordering: ["preserves scoredRecent order"],
      limit_position: "JS after exclusion",
      post_processing: [
        "episode bonus similarity adjustment",
        "slice recentRerankTopK",
      ],
    },
    {
      branch: "recent_fallback",
      trigger: "ftsIsEmpty === true",
      sql_tables: ["chunks", "memory_confidence"],
      join_type: "LEFT JOIN",
      filters: [
        "COALESCE(mc.is_archived, 0) = 0",
        "c.path NOT LIKE 'memory/generated-smart-add/%'",
        "(c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')",
      ],
      ordering: ["c.updated_at DESC"],
      limit_position: "SQL before JS filtering",
      post_processing: [
        "candidateCounts.recent_fallback_raw",
        "inferCategoryFromChunk fallback",
        "computeRecencyBoost",
        "normalizeCandidate",
        "filterForRerank",
        "uniqueById",
      ],
    },
  ];
}

function createFixtureRoot() {
  return mkdtempSync(join(tmpdir(), "memory-engine-recent-probe-"));
}

function createFixture({ root, chunks = [], confidenceRows = [], createUpdatedIndex = false }) {
  const corePath = join(root, "core.sqlite");
  const enginePath = join(root, "engine.sqlite");
  const core = new Database(corePath);
  core.exec(`
    CREATE TABLE chunks (
      id,
      text TEXT,
      path TEXT,
      updated_at
    );
  `);
  if (createUpdatedIndex) core.exec("CREATE INDEX idx_chunks_updated ON chunks(updated_at DESC);");
  const insertChunk = core.prepare("INSERT INTO chunks (id, text, path, updated_at) VALUES (?, ?, ?, ?)");
  for (const row of chunks) insertChunk.run(row.id, row.text, row.path, row.updated_at);
  core.close();

  const engine = new Database(enginePath);
  engine.exec(`
    CREATE TABLE memory_confidence (
      chunk_id,
      confidence REAL,
      last_confidence_update INTEGER,
      base_tau REAL,
      hit_count INTEGER,
      is_protected INTEGER,
      conflict_flag INTEGER,
      category TEXT,
      is_archived,
      kg_data TEXT
    );
  `);
  const insertConfidence = engine.prepare(`
    INSERT INTO memory_confidence (
      chunk_id, confidence, last_confidence_update, base_tau, hit_count,
      is_protected, conflict_flag, category, is_archived, kg_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of confidenceRows) {
    insertConfidence.run(
      row.chunk_id,
      row.confidence ?? null,
      row.last_confidence_update ?? null,
      row.base_tau ?? null,
      row.hit_count ?? null,
      row.is_protected ?? null,
      row.conflict_flag ?? null,
      row.category ?? null,
      row.is_archived ?? null,
      row.kg_data ?? null,
    );
  }
  engine.close();
  return { corePath, enginePath };
}

function createStorageMatrixFixture({ root, coreIdSql, engineIdSql }) {
  const corePath = join(root, "core.sqlite");
  const enginePath = join(root, "engine.sqlite");
  const core = new Database(corePath);
  core.exec(`
    CREATE TABLE chunks (
      id,
      text TEXT,
      path TEXT,
      updated_at
    );
  `);
  core.exec(`
    INSERT INTO chunks (id, text, path, updated_at)
    VALUES (${coreIdSql}, 'storage matrix text', 'memory/smart-add/storage.md', 100)
  `);
  core.close();

  const engine = new Database(enginePath);
  engine.exec(`
    CREATE TABLE memory_confidence (
      chunk_id,
      confidence REAL,
      last_confidence_update INTEGER,
      base_tau REAL,
      hit_count INTEGER,
      is_protected INTEGER,
      conflict_flag INTEGER,
      category TEXT,
      is_archived,
      kg_data TEXT
    );
  `);
  engine.exec(`
    INSERT INTO memory_confidence (
      chunk_id, confidence, last_confidence_update, base_tau, hit_count,
      is_protected, conflict_flag, category, is_archived, kg_data
    ) VALUES (
      ${engineIdSql}, 0.82, 0, 7.0, 3,
      0, 0, 'raw_log', 0, 'unused'
    )
  `);
  engine.close();
  return { corePath, enginePath };
}

function openHandles({ corePath, enginePath }) {
  const legacyDb = new Database(enginePath, { readonly: true, fileMustExist: true });
  legacyDb.exec(`ATTACH DATABASE '${escapeSqlitePath(corePath)}' AS core`);
  const isolatedEngineDb = new Database(enginePath, { readonly: true, fileMustExist: true });
  const isolatedCoreDb = new Database(corePath, { readonly: true, fileMustExist: true });
  return { legacyDb, isolatedEngineDb, isolatedCoreDb };
}

function closeHandles(handles = {}) {
  for (const db of [handles.legacyDb, handles.isolatedEngineDb, handles.isolatedCoreDb]) {
    if (db?.open) db.close();
  }
}

function selectLegacyRecentRows(legacyDb, limit) {
  return legacyDb.prepare(RECENT_LEGACY_SQL.replaceAll("FROM chunks", "FROM core.chunks")).all(limit);
}

function selectLegacyRecentFallbackRows(legacyDb, limit) {
  return legacyDb.prepare(RECENT_FALLBACK_LEGACY_SQL.replaceAll("FROM chunks", "FROM core.chunks")).all(limit);
}

function selectLegacyLikeRows(legacyDb, patterns, limit) {
  const sql = RECENT_LIKE_LEGACY_SQL(patterns.length).replaceAll("FROM chunks", "FROM core.chunks");
  return legacyDb.prepare(sql).all(...patterns.flatMap((pattern) => [pattern, pattern]), limit);
}

function selectEngineRows(isolatedEngineDb) {
  return isolatedEngineDb.prepare(`
    SELECT
      chunk_id,
      typeof(chunk_id) AS chunk_id_storage_class,
      confidence,
      last_confidence_update,
      COALESCE(base_tau, 7.0) AS base_tau,
      COALESCE(hit_count, 0) AS hit_count,
      COALESCE(is_protected, 0) AS is_protected,
      COALESCE(conflict_flag, 0) AS conflict_flag,
      category,
      COALESCE(is_archived, 0) AS is_archived,
      kg_data
    FROM memory_confidence
  `).all();
}

function postProcessLikeRows(rows, deps, { queryTerms, rankingConfig = {}, nowSec, minConfidence = 0.15 } = {}) {
  const normalizeCandidate = (row) => deps.normalizeExternalMemory(row, {
    nowSec,
    calcRealtimeConf: candidate => candidate.confidence,
    categoryMap: null,
  });
  return uniqueById(
    rows
      .map((row) => {
        const lexical = lexicalMatchScore(`${row.path}\n${row.text}`, queryTerms);
        return normalizeCandidate({
          ...row,
          similarity: (deps.toFiniteNumber(rankingConfig?.fallbackBaseScore?.like) ?? 0.3) + lexical,
          created_at: row.updated_at || 0,
        });
      })
      .filter(Boolean)
      .filter((item) => deps.isCandidateAllowedForRerank(item, minConfidence))
  );
}

function postProcessRecentRows(rows, deps, { queryTerms, rankingConfig = {}, nowSec, minConfidence = 0.15 } = {}) {
  const normalizeCandidate = (row) => deps.normalizeExternalMemory(row, {
    nowSec,
    calcRealtimeConf: candidate => candidate.confidence,
    categoryMap: null,
  });
  return uniqueById(
    rows
      .map((row) => {
        const lexical = lexicalMatchScore(`${row.path}\n${row.text}`, queryTerms);
        if (lexical <= 0) return null;
        const recency = deps.computeRecencyBoost(deps.normalizeUnixSeconds(row.updated_at), nowSec, rankingConfig);
        return normalizeCandidate({
          ...row,
          category: row.category || deps.inferCategoryFromChunk(row.path, row.text, null, "raw_log"),
          similarity: (deps.toFiniteNumber(rankingConfig?.fallbackBaseScore?.recent) ?? 0.35) + lexical + recency,
          created_at: row.updated_at || 0,
        });
      })
      .filter(Boolean)
      .filter((item) => deps.isCandidateAllowedForRerank(item, minConfidence))
      .sort((a, b) => b.semantic_score - a.semantic_score)
      .slice(0, 20)
  );
}

function postProcessRecentFallbackRows(rows, deps, { rankingConfig = {}, nowSec, minConfidence = 0.15 } = {}) {
  const normalizeCandidate = (row) => deps.normalizeExternalMemory(row, {
    nowSec,
    calcRealtimeConf: candidate => candidate.confidence,
    categoryMap: null,
  });
  return uniqueById(
    rows
      .map((row) => {
        const category = row.category || deps.inferCategoryFromChunk(row.path, row.text, null, "raw_log");
        const recency = deps.computeRecencyBoost(deps.normalizeUnixSeconds(row.updated_at), nowSec, rankingConfig);
        return normalizeCandidate({
          ...row,
          category,
          similarity: (deps.toFiniteNumber(rankingConfig?.fallbackBaseScore?.recentFallback) ?? 0.25) + recency,
          created_at: row.updated_at || 0,
        });
      })
      .filter(Boolean)
      .filter((item) => deps.isCandidateAllowedForRerank(item, minConfidence))
  );
}

function strategyARecent({ isolatedCoreDb, isolatedEngineDb, limit }) {
  const coreRows = isolatedCoreDb.prepare(`
    SELECT id, text, path, updated_at
    FROM chunks
    WHERE path NOT LIKE 'memory/generated-smart-add/%'
      AND (path LIKE 'memory/smart-add/%' OR path LIKE 'memory/episodes/%')
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit);
  const engineRows = selectEngineRows(isolatedEngineDb);
  const engineMap = makeEngineMetadataMap(engineRows);
  const merged = coreRows
    .map((row) => mergeRecentRow(row, engineMap.get(row.id)))
    .filter((row) => !isArchivedLikeLegacySql(row.is_archived));
  return { raw_rows: merged, candidate_ids: idsOf(merged) };
}

function strategyBRecent({ isolatedCoreDb, isolatedEngineDb, limit }) {
  const engineRows = selectEngineRows(isolatedEngineDb);
  const archivedIds = [];
  for (const row of engineRows) {
    if (typeof row.chunk_id !== "string") continue;
    if (!isArchivedLikeLegacySql(row.is_archived)) continue;
    if (!archivedIds.includes(row.chunk_id)) archivedIds.push(row.chunk_id);
  }
  const coreRows = isolatedCoreDb.prepare(CORE_FIRST_RECENT_SQL).all(JSON.stringify(archivedIds), limit);
  const engineMap = makeEngineMetadataMap(engineRows);
  const merged = coreRows.map((row) => mergeRecentRow(row, engineMap.get(row.id)));
  return { archived_ids_json: archivedIds, raw_rows: merged, candidate_ids: idsOf(merged) };
}

function strategyCLegacyEngineFirst({ isolatedCoreDb, isolatedEngineDb, limit }) {
  const engineRows = isolatedEngineDb.prepare(ENGINE_FIRST_ACTIVE_SQL).all();
  const candidateIds = [];
  for (const row of engineRows) {
    if (typeof row.chunk_id !== "string") continue;
    if (candidateIds.includes(row.chunk_id)) continue;
    candidateIds.push(row.chunk_id);
  }
  const coreRows = isolatedCoreDb.prepare(CORE_JOIN_ENGINE_IDS_SQL).all(JSON.stringify(candidateIds), limit);
  const engineMap = makeEngineMetadataMap(engineRows);
  const merged = coreRows.map((row) => mergeRecentRow(row, engineMap.get(row.id)));
  return { candidate_ids_json: candidateIds, raw_rows: merged, candidate_ids: idsOf(merged) };
}

function strategyDPerId({ isolatedCoreDb, isolatedEngineDb, limit }) {
  const coreRows = isolatedCoreDb.prepare(`
    SELECT id, text, path, updated_at
    FROM chunks
    WHERE path NOT LIKE 'memory/generated-smart-add/%'
      AND (path LIKE 'memory/smart-add/%' OR path LIKE 'memory/episodes/%')
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit);
  const stmt = isolatedEngineDb.prepare(`
    SELECT
      confidence,
      last_confidence_update,
      COALESCE(base_tau, 7.0) AS base_tau,
      COALESCE(hit_count, 0) AS hit_count,
      COALESCE(is_protected, 0) AS is_protected,
      COALESCE(conflict_flag, 0) AS conflict_flag,
      category,
      COALESCE(is_archived, 0) AS is_archived
    FROM memory_confidence
    WHERE chunk_id = ?
    LIMIT 1
  `);
  const merged = [];
  let queryCount = 1;
  for (const row of coreRows) {
    queryCount += 1;
    const engineRow = stmt.get(row.id) || null;
    const mergedRow = mergeRecentRow(row, engineRow);
    if (!isArchivedLikeLegacySql(mergedRow.is_archived)) merged.push(mergedRow);
  }
  return { query_count: queryCount, raw_rows: merged, candidate_ids: idsOf(merged), equivalent: false, recommended: false };
}

function strategyBLike({ isolatedCoreDb, isolatedEngineDb, patterns, limit }) {
  const engineRows = selectEngineRows(isolatedEngineDb);
  const archivedIds = [];
  for (const row of engineRows) {
    if (typeof row.chunk_id !== "string") continue;
    if (!isArchivedLikeLegacySql(row.is_archived)) continue;
    if (!archivedIds.includes(row.chunk_id)) archivedIds.push(row.chunk_id);
  }
  const sql = CORE_FIRST_LIKE_SQL(patterns.length);
  const params = [...patterns.flatMap((pattern) => [pattern, pattern]), JSON.stringify(archivedIds), limit];
  const coreRows = isolatedCoreDb.prepare(sql).all(...params);
  const engineMap = makeEngineMetadataMap(engineRows);
  const merged = coreRows.map((row) => mergeRecentRow(row, engineMap.get(row.id)));
  return { archived_ids_json: archivedIds, raw_rows: merged, candidate_ids: idsOf(merged) };
}

function strategyCLike({ isolatedCoreDb, isolatedEngineDb, patterns, limit }) {
  const engineRows = isolatedEngineDb.prepare(ENGINE_FIRST_ACTIVE_SQL).all();
  const candidateIds = [];
  for (const row of engineRows) {
    if (typeof row.chunk_id !== "string") continue;
    if (candidateIds.includes(row.chunk_id)) continue;
    candidateIds.push(row.chunk_id);
  }
  const sql = CORE_JOIN_ENGINE_IDS_LIKE_SQL(patterns.length);
  const params = [JSON.stringify(candidateIds), ...patterns.flatMap((pattern) => [pattern, pattern]), limit];
  const coreRows = isolatedCoreDb.prepare(sql).all(...params);
  const engineMap = makeEngineMetadataMap(engineRows);
  const merged = coreRows.map((row) => mergeRecentRow(row, engineMap.get(row.id)));
  return { candidate_ids_json: candidateIds, raw_rows: merged, candidate_ids: idsOf(merged) };
}

function metadataFieldSet(rows = []) {
  const fields = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row || {})) fields.add(key);
  }
  return [...fields].sort();
}

function archivedLimitCounterexample() {
  const root = createFixtureRoot();
  try {
    const { corePath, enginePath } = createFixture({
      root,
      chunks: [
        { id: "A", text: "compatibility archived latest", path: "memory/smart-add/A.md", updated_at: 300 },
        { id: "B", text: "compatibility active B", path: "memory/smart-add/B.md", updated_at: 200 },
        { id: "C", text: "compatibility active C", path: "memory/smart-add/C.md", updated_at: 100 },
      ],
      confidenceRows: [
        { chunk_id: "A", confidence: 0.9, category: "raw_log", is_archived: 1, kg_data: "unused" },
        { chunk_id: "B", confidence: 0.8, category: "raw_log", is_archived: 0, kg_data: "unused" },
        { chunk_id: "C", confidence: 0.7, category: "raw_log", is_archived: 0, kg_data: "unused" },
      ],
    });
    const handles = openHandles({ corePath, enginePath });
    try {
      const legacyRaw = selectLegacyRecentRows(handles.legacyDb, 2);
      const strategyA = strategyARecent({ isolatedCoreDb: handles.isolatedCoreDb, isolatedEngineDb: handles.isolatedEngineDb, limit: 2 });
      const strategyB = strategyBRecent({ isolatedCoreDb: handles.isolatedCoreDb, isolatedEngineDb: handles.isolatedEngineDb, limit: 2 });
      const strategyC = strategyCLegacyEngineFirst({ isolatedCoreDb: handles.isolatedCoreDb, isolatedEngineDb: handles.isolatedEngineDb, limit: 2 });
      return {
        legacy_ids: idsOf(legacyRaw),
        strategy_a_ids: strategyA.candidate_ids,
        strategy_b_ids: strategyB.candidate_ids,
        strategy_c_ids: strategyC.candidate_ids,
        strategy_a_equivalent: rowsEquivalent(legacyRaw, strategyA.raw_rows),
        strategy_b_equivalent: rowsEquivalent(legacyRaw, strategyB.raw_rows),
        strategy_c_equivalent: rowsEquivalent(legacyRaw, strategyC.raw_rows),
      };
    } finally {
      closeHandles(handles);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function storageCase(deps, { name, coreId, engineId }) {
  const root = createFixtureRoot();
  try {
    const { corePath, enginePath } = createFixture({
      root,
      chunks: [{ id: coreId, text: `${name} storage`, path: "memory/smart-add/storage.md", updated_at: 100 }],
      confidenceRows: [{
        chunk_id: engineId,
        confidence: 0.82,
        last_confidence_update: 0,
        base_tau: 7,
        hit_count: 3,
        is_protected: 0,
        conflict_flag: 0,
        category: "raw_log",
        is_archived: 0,
        kg_data: "unused",
      }],
    });
    const handles = openHandles({ corePath, enginePath });
    try {
      const legacyRows = selectLegacyRecentRows(handles.legacyDb, 10);
      const strategyB = strategyBRecent({ isolatedCoreDb: handles.isolatedCoreDb, isolatedEngineDb: handles.isolatedEngineDb, limit: 10 });
      const coreStorage = handles.isolatedCoreDb.prepare("SELECT typeof(id) AS storage_class FROM chunks").get().storage_class;
      const engineStorage = handles.isolatedEngineDb.prepare("SELECT typeof(chunk_id) AS storage_class FROM memory_confidence").get().storage_class;
      const normalizedLegacy = postProcessRecentRows(legacyRows, deps, { queryTerms: ["storage"], nowSec: 1710003600 });
      const normalizedB = postProcessRecentRows(strategyB.raw_rows, deps, { queryTerms: ["storage"], nowSec: 1710003600 });
      return {
        case: name,
        legacy_count: legacyRows.length,
        strategy_b_count: strategyB.raw_rows.length,
        engine_storage_class: String(engineStorage),
        core_storage_class: String(coreStorage),
        transfer_supported: typeof coreId === "string" && typeof engineId === "string",
        metadata_equivalent: rowsEquivalent(legacyRows, strategyB.raw_rows),
        normalized_equivalent: rowsEquivalent(normalizedLegacy, normalizedB),
        equivalent: rowsEquivalent(legacyRows, strategyB.raw_rows) && rowsEquivalent(normalizedLegacy, normalizedB),
      };
    } finally {
      closeHandles(handles);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function storageSqlCase(deps, {
  name,
  coreIdSql,
  engineIdSql,
  expectedStorageClasses,
}) {
  const root = createFixtureRoot();
  try {
    const { corePath, enginePath } = createStorageMatrixFixture({
      root,
      coreIdSql,
      engineIdSql,
    });
    const handles = openHandles({ corePath, enginePath });
    try {
      const legacyRows = selectLegacyRecentRows(handles.legacyDb, 10);
      const strategyB = strategyBRecent({ isolatedCoreDb: handles.isolatedCoreDb, isolatedEngineDb: handles.isolatedEngineDb, limit: 10 });
      const coreStorage = handles.isolatedCoreDb.prepare("SELECT typeof(id) AS storage_class FROM chunks").get().storage_class;
      const engineStorage = handles.isolatedEngineDb.prepare("SELECT typeof(chunk_id) AS storage_class FROM memory_confidence").get().storage_class;
      const normalizedLegacy = postProcessRecentRows(legacyRows, deps, { queryTerms: ["storage"], nowSec: 1710003600 });
      const normalizedB = postProcessRecentRows(strategyB.raw_rows, deps, { queryTerms: ["storage"], nowSec: 1710003600 });
      return {
        case: name,
        fixture_valid:
          String(engineStorage) === expectedStorageClasses[0]
          && String(coreStorage) === expectedStorageClasses[1],
        expected_storage_classes: expectedStorageClasses,
        observed_storage_classes: [String(engineStorage), String(coreStorage)],
        legacy_count: legacyRows.length,
        strategy_b_count: strategyB.raw_rows.length,
        engine_storage_class: String(engineStorage),
        core_storage_class: String(coreStorage),
        transfer_supported: expectedStorageClasses[0] === "text" && expectedStorageClasses[1] === "text",
        metadata_equivalent: rowsEquivalent(legacyRows, strategyB.raw_rows),
        normalized_equivalent: rowsEquivalent(normalizedLegacy, normalizedB),
        equivalent:
          String(engineStorage) === expectedStorageClasses[0]
          && String(coreStorage) === expectedStorageClasses[1]
          ? (rowsEquivalent(legacyRows, strategyB.raw_rows) && rowsEquivalent(normalizedLegacy, normalizedB))
          : null,
      };
    } finally {
      closeHandles(handles);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function bufferMapKeyCase() {
  const a = Buffer.from("same");
  const b = Buffer.from("same");
  return {
    same_content_equal: a.equals(b),
    strict_reference_equal: a === b,
    map_get_with_distinct_buffer: new Map([[a, "metadata"]]).get(b) ?? null,
    explanation: "Buffer keys in Map compare by object identity, not by byte content.",
  };
}

function numericMapKeyCase() {
  const numberMap = new Map([[42, "metadata"]]);
  const bigintMap = new Map([[42n, "metadata"]]);
  return {
    number_key_matches_same_number: numberMap.get(42) === "metadata",
    number_key_matches_real_same_js_number: numberMap.get(42.0) === "metadata",
    bigint_number_match: bigintMap.get(42) === "metadata",
    number_integer_real_distinction_preserved: false,
    json_storage_class_preserved: false,
  };
}

async function runRecentChannelCase(deps, { legacyDb }) {
  const candidateCounts = deps.createCandidateCounts();
  const debug = deps.createHybridDebug({
    rawQuery: "compatibility",
    strippedQuery: "compatibility",
    normalizedQuery: "compatibility",
    queryTerms: ["compatibility"],
    candidateCounts,
    minConfidence: 0.15,
    lexicalConfidenceThreshold: 0.7,
  });
  const channels = { vector: [{ id: "vector-1" }] };
  const warnings = [];
  const { warnHybridSearchOnce } = deps.createHybridWarnings();
  const recordWarn = (message, error = null) => {
    warnings.push({ message, error: error?.message || null });
    warnHybridSearchOnce(message, error);
  };
  const ctx = {
    withDb: (fn) => fn({
      prepare(sql) {
        return legacyDb.prepare(String(sql).replaceAll("FROM chunks", "FROM core.chunks"));
      },
    }),
    channels,
    debug,
    candidateCounts,
    ftsIsEmpty: true,
    normalizedQuery: "compatibility",
    likePatternTopN: 8,
    likeTopK: 30,
    queryTerms: ["compatibility"],
    rankingConfig: {},
    normalizeCandidate: (row) => deps.normalizeExternalMemory(row, {
      nowSec: 1710003600,
      calcRealtimeConf: candidate => candidate.confidence,
      categoryMap: null,
    }),
    filterForRerank: (item) => deps.isCandidateAllowedForRerank(item, 0.15),
    recentTopK: 120,
    recentRerankTopK: 20,
    recentFallbackTopK: 20,
    inferCategoryFromChunk: deps.inferCategoryFromChunk,
    categoryMap: null,
    lexicalMatchScore,
    computeRecencyBoost: deps.computeRecencyBoost,
    normalizeUnixSeconds: deps.normalizeUnixSeconds,
    toFiniteNumber: deps.toFiniteNumber,
    toDebugErrorMessage: deps.toDebugErrorMessage,
    warnHybridSearchOnce: recordWarn,
    uniqueVectorChannels: () => true,
    nowSec: 1710003600,
  };
  await deps.collectRecentCandidates(ctx);
  return {
    candidate_counts: { ...candidateCounts },
    debug_fallbacks: [...debug.fallbacks_triggered],
    warning_keys: warnings.map((item) => item.message),
    channels_present: Object.keys(channels).filter((key) => Array.isArray(channels[key]) && channels[key].length > 0).sort(),
    recent_ids: idsOf(channels.recent || []),
    like_ids: idsOf(channels.like || []),
    recent_fallback_ids: idsOf(channels.recent_fallback || []),
  };
}

function tieProbe({ createIndex = false, coreOrder = ["C", "B", "A"], engineOrder = ["A", "B", "C"], limit = 2 }) {
  const root = createFixtureRoot();
  try {
    const chunks = coreOrder.map((id) => ({ id, text: `${id} compatibility`, path: `memory/smart-add/${id}.md`, updated_at: 1000 }));
    const confidenceRows = engineOrder.map((id) => ({
      chunk_id: id,
      confidence: 0.9,
      last_confidence_update: 0,
      base_tau: 7,
      hit_count: 1,
      is_protected: 0,
      conflict_flag: 0,
      category: "raw_log",
      is_archived: 0,
      kg_data: "unused",
    }));
    const { corePath, enginePath } = createFixture({ root, chunks, confidenceRows, createUpdatedIndex: createIndex });
    const handles = openHandles({ corePath, enginePath });
    try {
      const legacyIds = idsOf(selectLegacyRecentRows(handles.legacyDb, limit));
      const strategyBIds = idsOf(strategyBRecent({ isolatedCoreDb: handles.isolatedCoreDb, isolatedEngineDb: handles.isolatedEngineDb, limit }).raw_rows);
      const deterministicIds = handles.legacyDb.prepare(DETERMINISTIC_RECENT_SQL.replaceAll("FROM chunks", "FROM core.chunks")).all(limit).map((row) => row.id);
      return { legacy_ids: legacyIds, strategy_b_ids: strategyBIds, deterministic_ids: deterministicIds };
    } finally {
      closeHandles(handles);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function likeSemanticsProbe(deps) {
  const root = createFixtureRoot();
  try {
    const { corePath, enginePath } = createFixture({
      root,
      chunks: [
        { id: "alpha", text: "Case under_score 雪 quote' slash\\ text", path: "memory/smart-add/Alpha.md", updated_at: 5 },
        { id: "beta", text: "plain text", path: "memory/smart-add/plain.md", updated_at: 4 },
      ],
      confidenceRows: [{ chunk_id: "alpha", confidence: 0.8, category: "raw_log", is_archived: 0, kg_data: "x" }],
    });
    const handles = openHandles({ corePath, enginePath });
    try {
      const cases = ["%Case%", "%Case_%", "%under_score%", "%雪%", "%quote'%", "%slash\\%"];
      return {
        applicable: true,
        cases: cases.map((pattern) => {
          const patterns = [pattern];
          const legacy = selectLegacyLikeRows(handles.legacyDb, patterns, 10);
          const b = strategyBLike({ isolatedCoreDb: handles.isolatedCoreDb, isolatedEngineDb: handles.isolatedEngineDb, patterns, limit: 10 }).raw_rows;
          const c = strategyCLike({ isolatedCoreDb: handles.isolatedCoreDb, isolatedEngineDb: handles.isolatedEngineDb, patterns, limit: 10 }).raw_rows;
          return {
            pattern_class: pattern,
            legacy_ids: idsOf(legacy),
            strategy_b_ids: idsOf(b),
            strategy_c_ids: idsOf(c),
            strategy_b_equal: rowsEquivalent(legacy, b),
            strategy_c_equal: rowsEquivalent(legacy, c),
          };
        }),
      };
    } finally {
      closeHandles(handles);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function recentMainFixtureReport(deps) {
  const root = createFixtureRoot();
  try {
    const { corePath, enginePath } = createFixture({
      root,
      chunks: [
        { id: "A", text: "compatibility active A", path: "memory/smart-add/A.md", updated_at: 100 },
        { id: "B", text: "compatibility active B", path: "memory/episodes/B.md", updated_at: 90 },
        { id: "C", text: "compatibility archived C", path: "memory/smart-add/C.md", updated_at: 110 },
        { id: "MISSING", text: "compatibility missing confidence", path: "memory/smart-add/MISSING.md", updated_at: 95 },
        { id: "GEN", text: "compatibility generated", path: "memory/generated-smart-add/GEN.md", updated_at: 120 },
      ],
      confidenceRows: [
        { chunk_id: "A", confidence: 0.82, last_confidence_update: 0, base_tau: 7, hit_count: 3, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 0, kg_data: "unused" },
        { chunk_id: "B", confidence: 0.8, last_confidence_update: 0, base_tau: 7, hit_count: 2, is_protected: 0, conflict_flag: 0, category: null, is_archived: 0, kg_data: "unused" },
        { chunk_id: "C", confidence: 0.91, last_confidence_update: 0, base_tau: 7, hit_count: 4, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 1, kg_data: "unused" },
      ],
    });
    const handles = openHandles({ corePath, enginePath });
    try {
      const legacyRaw = selectLegacyRecentRows(handles.legacyDb, 10);
      const strategyA = strategyARecent({ isolatedCoreDb: handles.isolatedCoreDb, isolatedEngineDb: handles.isolatedEngineDb, limit: 10 });
      const strategyB = strategyBRecent({ isolatedCoreDb: handles.isolatedCoreDb, isolatedEngineDb: handles.isolatedEngineDb, limit: 10 });
      const strategyC = strategyCLegacyEngineFirst({ isolatedCoreDb: handles.isolatedCoreDb, isolatedEngineDb: handles.isolatedEngineDb, limit: 10 });
      const strategyD = strategyDPerId({ isolatedCoreDb: handles.isolatedCoreDb, isolatedEngineDb: handles.isolatedEngineDb, limit: 10 });
      const normalizedLegacy = postProcessRecentRows(legacyRaw, deps, { queryTerms: ["compatibility"], nowSec: 1710003600 });
      const normalizedA = postProcessRecentRows(strategyA.raw_rows, deps, { queryTerms: ["compatibility"], nowSec: 1710003600 });
      const normalizedB = postProcessRecentRows(strategyB.raw_rows, deps, { queryTerms: ["compatibility"], nowSec: 1710003600 });
      const normalizedC = postProcessRecentRows(strategyC.raw_rows, deps, { queryTerms: ["compatibility"], nowSec: 1710003600 });
      const fallbackLegacy = selectLegacyRecentFallbackRows(handles.legacyDb, 10);
      const normalizedFallback = postProcessRecentFallbackRows(fallbackLegacy, deps, { nowSec: 1710003600 });
      const channelLevelCase = await runRecentChannelCase(deps, { legacyDb: handles.legacyDb });
      return {
        topology: {
          legacy_names: dbNames(handles.legacyDb),
          isolated_engine_names: dbNames(handles.isolatedEngineDb),
          isolated_core_names: dbNames(handles.isolatedCoreDb),
        },
        legacy_raw_ids: idsOf(legacyRaw),
        legacy_normalized_ids: idsOf(normalizedLegacy),
        fallback_normalized_ids: idsOf(normalizedFallback),
        strategies: {
          legacy: { raw_ids: idsOf(legacyRaw), normalized_ids: idsOf(normalizedLegacy), raw_count: legacyRaw.length, normalized_count: normalizedLegacy.length },
          naive_core_limit_then_filter: {
            raw_ids: strategyA.candidate_ids,
            normalized_ids: idsOf(normalizedA),
            raw_count: strategyA.raw_rows.length,
            normalized_count: normalizedA.length,
            equivalent: rowsEquivalent(legacyRaw, strategyA.raw_rows) && rowsEquivalent(normalizedLegacy, normalizedA),
          },
          core_first_archived_json_exclusion: {
            raw_ids: strategyB.candidate_ids,
            normalized_ids: idsOf(normalizedB),
            raw_count: strategyB.raw_rows.length,
            normalized_count: normalizedB.length,
            equivalent: rowsEquivalent(legacyRaw, strategyB.raw_rows) && rowsEquivalent(normalizedLegacy, normalizedB),
          },
          engine_first_ids: {
            raw_ids: strategyC.candidate_ids,
            normalized_ids: idsOf(normalizedC),
            raw_count: strategyC.raw_rows.length,
            normalized_count: normalizedC.length,
            equivalent: rowsEquivalent(legacyRaw, strategyC.raw_rows) && rowsEquivalent(normalizedLegacy, normalizedC),
          },
          per_id_lookup: strategyD,
        },
        raw_fields: metadataFieldSet(legacyRaw),
        normalized_fields: metadataFieldSet(normalizedLegacy),
        missing_confidence_case: {
          legacy_returns_row: legacyRaw.some((row) => row.id === "MISSING"),
          core_first_returns_row: strategyB.raw_rows.some((row) => row.id === "MISSING"),
          engine_first_returns_row: strategyC.raw_rows.some((row) => row.id === "MISSING"),
          metadata_equivalent: rowsEquivalent(
            legacyRaw.filter((row) => row.id === "MISSING"),
            strategyB.raw_rows.filter((row) => row.id === "MISSING"),
          ),
          legacy_row: normalizeRowSummary(legacyRaw.find((row) => row.id === "MISSING")),
          core_first_row: normalizeRowSummary(strategyB.raw_rows.find((row) => row.id === "MISSING")),
          normalized_legacy_row: normalizeRowSummary(normalizedLegacy.find((row) => row.id === "MISSING")),
          normalized_core_first_row: normalizeRowSummary(normalizedB.find((row) => row.id === "MISSING")),
        },
        metadata_equivalence: {
          raw_strategy_b_equal: rowsEquivalent(legacyRaw, strategyB.raw_rows),
          normalized_strategy_b_equal: rowsEquivalent(normalizedLegacy, normalizedB),
          raw_strategy_c_equal: rowsEquivalent(legacyRaw, strategyC.raw_rows),
          normalized_strategy_c_equal: rowsEquivalent(normalizedLegacy, normalizedC),
        },
        channel_level_case: channelLevelCase,
      };
    } finally {
      closeHandles(handles);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function buildProbeReport() {
  const deps = await getDeps();
  const inventory = branchInventory();
  const fixtureRoot = createFixtureRoot();
  let handles;
  try {
    const baseFixture = createFixture({
      root: fixtureRoot,
      chunks: [{ id: "version", text: "x", path: "memory/smart-add/x.md", updated_at: 1 }],
      confidenceRows: [],
    });
    handles = openHandles(baseFixture);
    const mainFixture = await recentMainFixtureReport(deps);
    const likeSemantics = likeSemanticsProbe(deps);
    const archivedLimitCase = archivedLimitCounterexample();
    const tieNoIndex = tieProbe({ createIndex: false, coreOrder: ["C", "B", "A"], engineOrder: ["A", "B", "C"] });
    const tieWithIndex = tieProbe({ createIndex: true, coreOrder: ["A", "B", "C"], engineOrder: ["C", "B", "A"] });
    const storageCases = {
      text_text: storageSqlCase(deps, {
        name: "text_text",
        coreIdSql: "'text-id'",
        engineIdSql: "'text-id'",
        expectedStorageClasses: ["text", "text"],
      }),
      blob_blob: storageSqlCase(deps, {
        name: "blob_blob",
        coreIdSql: "X'626c6f622d6964'",
        engineIdSql: "X'626c6f622d6964'",
        expectedStorageClasses: ["blob", "blob"],
      }),
      text_blob: storageSqlCase(deps, {
        name: "text_blob",
        coreIdSql: "X'6d697865642d6964'",
        engineIdSql: "'mixed-id'",
        expectedStorageClasses: ["text", "blob"],
      }),
      blob_text: storageSqlCase(deps, {
        name: "blob_text",
        coreIdSql: "'mixed-id'",
        engineIdSql: "X'6d697865642d6964'",
        expectedStorageClasses: ["blob", "text"],
      }),
      null_engine: storageSqlCase(deps, {
        name: "null_engine",
        coreIdSql: "'null-engine'",
        engineIdSql: "NULL",
        expectedStorageClasses: ["null", "text"],
      }),
      integer_integer: storageSqlCase(deps, {
        name: "integer_integer",
        coreIdSql: "42",
        engineIdSql: "42",
        expectedStorageClasses: ["integer", "integer"],
      }),
      real_real: storageSqlCase(deps, {
        name: "real_real",
        coreIdSql: "42.5",
        engineIdSql: "42.5",
        expectedStorageClasses: ["real", "real"],
      }),
      integer_text: storageSqlCase(deps, {
        name: "integer_text",
        coreIdSql: "'42'",
        engineIdSql: "42",
        expectedStorageClasses: ["integer", "text"],
      }),
      text_integer: storageSqlCase(deps, {
        name: "text_integer",
        coreIdSql: "42",
        engineIdSql: "'42'",
        expectedStorageClasses: ["text", "integer"],
      }),
    };

    const legacyRecentOrderContract = {
      deterministic: RECENT_LEGACY_SQL.includes("ORDER BY c.updated_at DESC, c.id ASC"),
      reason: RECENT_LEGACY_SQL.includes("ORDER BY c.updated_at DESC, c.id ASC")
        ? "explicit_secondary_tie_breaker_present"
        : "missing_secondary_tie_breaker",
      observed_order: tieNoIndex.legacy_ids,
      recommended_order: ["c.updated_at DESC", "c.id ASC"],
      no_index_case: tieNoIndex,
      indexed_case: tieWithIndex,
    };

    const recentStrategies = mainFixture.strategies;
    const missingConfidenceCase = mainFixture.missing_confidence_case;
    const metadataEquivalence = mainFixture.metadata_equivalence;

    const textIdFoundationalEquivalence =
      storageCases.text_text.equivalent
      && missingConfidenceCase.legacy_returns_row
      && missingConfidenceCase.core_first_returns_row
      && missingConfidenceCase.metadata_equivalent
      && archivedLimitCase.strategy_b_equivalent
      && likeSemantics.cases.every((item) => item.strategy_b_equal);
    const storageMatrixFullyValid = Object.values(storageCases).every((item) => item.fixture_valid === true);
    const sqliteStorageClassEquivalence =
      storageMatrixFullyValid
      && Object.values(storageCases).every((item) => item.equivalent === true);
    const foundationalEquivalence =
      textIdFoundationalEquivalence
      && sqliteStorageClassEquivalence
      && legacyRecentOrderContract.deterministic;

    const migrationPrerequisites = [];
    if (!legacyRecentOrderContract.deterministic) migrationPrerequisites.push("deterministic recent tie ordering");
    if (!sqliteStorageClassEquivalence) migrationPrerequisites.push("TEXT-only Core/Engine ID invariant");

    return {
      probe: "isolated_recent_equivalence",
      sqlite_version: sqliteVersion(handles.legacyDb),
      better_sqlite3_version: BETTER_SQLITE3_VERSION,
      recent_branch_inventory: inventory,
      legacy_recent_order_contract: legacyRecentOrderContract,
      strategies: recentStrategies,
      storage_class_cases: storageCases,
      storage_matrix_fixture: {
        purpose: "synthetic_full_sqlite_storage_class_domain",
        matches_production_declared_affinity: false,
      },
      buffer_map_key_case: bufferMapKeyCase(),
      numeric_map_key_case: numericMapKeyCase(),
      missing_confidence_case: missingConfidenceCase,
      archived_limit_case: archivedLimitCase,
      like_semantics: likeSemantics,
      metadata_equivalence: metadataEquivalence,
      channel_level_case: mainFixture.channel_level_case,
      text_id_foundational_equivalence: textIdFoundationalEquivalence,
      sqlite_storage_class_equivalence: sqliteStorageClassEquivalence,
      foundational_equivalence: foundationalEquivalence,
      recommendation_class: foundationalEquivalence ? "A" : "C",
      conditional_recommendation_class: textIdFoundationalEquivalence && !legacyRecentOrderContract.deterministic ? "B" : (textIdFoundationalEquivalence ? "A" : "C"),
      preferred_strategy: "none",
      conditional_preferred_strategy: textIdFoundationalEquivalence ? "core_first_archived_json_exclusion" : "none",
      migration_prerequisites: migrationPrerequisites,
      required_invariant: {
        engine_chunk_id_storage_class: "text",
        core_chunk_id_storage_class: "text",
        verified_on_real_db: false,
      },
      topology: {
        legacy: { database_names: dbNames(handles.legacyDb) },
        isolated_engine: { database_names: dbNames(handles.isolatedEngineDb) },
        isolated_core: { database_names: dbNames(handles.isolatedCoreDb) },
      },
      raw_field_inventory: mainFixture.raw_fields,
      normalized_field_inventory: mainFixture.normalized_fields,
    };
  } finally {
    try { closeHandles(handles); } catch {}
    try { rmSync(fixtureRoot, { recursive: true, force: true }); } catch {}
  }
}

async function runIsolatedRecentEquivalenceProbe() {
  return buildProbeReport();
}

async function main() {
  const report = await runIsolatedRecentEquivalenceProbe();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
    process.exit(1);
  });
}

module.exports = {
  runIsolatedRecentEquivalenceProbe,
};
