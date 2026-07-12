#!/usr/bin/env node
const Database = require("better-sqlite3");
const { existsSync, mkdirSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { performance } = require("node:perf_hooks");

const LEGACY_KG_SQL = `
  SELECT c.id, c.text, c.path, c.updated_at,
    mc.confidence AS confidence,
    mc.last_confidence_update,
    COALESCE(mc.base_tau, 7.0) AS base_tau,
    COALESCE(mc.hit_count, 0) AS hit_count,
    COALESCE(mc.is_protected, 0) AS is_protected,
    COALESCE(mc.conflict_flag, 0) AS conflict_flag,
    mc.category AS category,
    COALESCE(mc.is_archived, 0) AS is_archived,
    mc.kg_data AS kg_data
  FROM memory_confidence mc
  JOIN chunks c ON c.id = mc.chunk_id
  WHERE COALESCE(mc.is_archived, 0) = 0
    AND mc.kg_data IS NOT NULL
    AND mc.kg_data != ''
    AND (__WHERE__)
  ORDER BY c.updated_at DESC
  LIMIT ?
`;

const ENGINE_KG_CANDIDATE_SQL = `
  SELECT
    chunk_id,
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
  WHERE COALESCE(is_archived, 0) = 0
    AND kg_data IS NOT NULL
    AND kg_data != ''
    AND (__WHERE__)
`;

const CORE_KG_JSON_EXISTS_SQL = `
  SELECT
    c.id,
    c.text,
    c.path,
    c.updated_at
  FROM chunks c
  WHERE EXISTS (
    SELECT 1
    FROM json_each(?) AS candidate
    WHERE CAST(candidate.value AS TEXT) = c.id
  )
  ORDER BY c.updated_at DESC
  LIMIT ?
`;

const CORE_KG_JSON_EXISTS_TIEBREAKER_SQL = CORE_KG_JSON_EXISTS_SQL.replace(
  "ORDER BY c.updated_at DESC",
  "ORDER BY c.updated_at DESC, c.id ASC",
);

const CORE_KG_JSON_JOIN_SQL = `
  SELECT
    c.id,
    c.text,
    c.path,
    c.updated_at
  FROM json_each(?) AS candidate
  JOIN chunks c
    ON c.id = CAST(candidate.value AS TEXT)
  ORDER BY c.updated_at DESC
  LIMIT ?
`;

const CORE_KG_JSON_JOIN_TIEBREAKER_SQL = CORE_KG_JSON_JOIN_SQL.replace(
  "ORDER BY c.updated_at DESC",
  "ORDER BY c.updated_at DESC, c.id ASC",
);

function withWhere(sql, alias, patternCount) {
  const column = alias ? `${alias}.kg_data` : "kg_data";
  const where = Array.from({ length: patternCount }, () => `${column} LIKE ?`).join(" OR ");
  return sql.replace("__WHERE__", where);
}

function escapeAttachPath(path) {
  return path.replace(/'/g, "''");
}

function createCoreSchema(db) {
  db.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      path TEXT NOT NULL,
      updated_at INTEGER
    );
  `);
}

function createEngineSchema(db) {
  db.exec(`
    CREATE TABLE memory_confidence (
      chunk_id TEXT PRIMARY KEY,
      confidence REAL,
      last_confidence_update INTEGER,
      base_tau REAL,
      hit_count INTEGER,
      is_protected INTEGER,
      conflict_flag INTEGER,
      category TEXT,
      is_archived INTEGER,
      kg_data TEXT
    );
  `);
}

function insertCore(db, id, updatedAt, text = `text ${id}`) {
  db.prepare("INSERT INTO chunks (id, text, path, updated_at) VALUES (?, ?, ?, ?)")
    .run(id, text, `memory/kg/${id}.md`, updatedAt);
}

function insertEngine(db, id, kgData, overrides = {}) {
  db.prepare(`
    INSERT INTO memory_confidence (
      chunk_id, confidence, last_confidence_update, base_tau, hit_count,
      is_protected, conflict_flag, category, is_archived, kg_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.confidence ?? 0.8,
    overrides.last_confidence_update ?? 11,
    Object.hasOwn(overrides, "base_tau") ? overrides.base_tau : 7,
    Object.hasOwn(overrides, "hit_count") ? overrides.hit_count : 2,
    Object.hasOwn(overrides, "is_protected") ? overrides.is_protected : 0,
    Object.hasOwn(overrides, "conflict_flag") ? overrides.conflict_flag : 0,
    Object.hasOwn(overrides, "category") ? overrides.category : "raw_log",
    Object.hasOwn(overrides, "is_archived") ? overrides.is_archived : 0,
    kgData,
  );
}

function openLegacyDb(enginePath, corePath) {
  const db = new Database(enginePath, { readonly: true, fileMustExist: true });
  db.exec(`ATTACH DATABASE '${escapeAttachPath(corePath)}' AS core`);
  return db;
}

function mergeRows(coreRows, engineRows) {
  const metadata = new Map();
  for (const row of engineRows) {
    if (typeof row.chunk_id === "string" && !metadata.has(row.chunk_id)) metadata.set(row.chunk_id, row);
  }
  return coreRows.map(row => {
    const engine = metadata.get(row.id);
    return {
      id: row.id,
      text: row.text,
      path: row.path,
      updated_at: row.updated_at,
      confidence: engine.confidence,
      last_confidence_update: engine.last_confidence_update,
      base_tau: engine.base_tau,
      hit_count: engine.hit_count,
      is_protected: engine.is_protected,
      conflict_flag: engine.conflict_flag,
      category: engine.category,
      is_archived: engine.is_archived,
      kg_data: engine.kg_data,
    };
  });
}

function selectLegacy({ enginePath, corePath, patterns, limit, explicitTieBreaker = false, explain = false }) {
  const db = openLegacyDb(enginePath, corePath);
  try {
    let sql = withWhere(LEGACY_KG_SQL, "mc", patterns.length);
    if (explicitTieBreaker) sql = sql.replace("ORDER BY c.updated_at DESC", "ORDER BY c.updated_at DESC, c.id ASC");
    if (explain) return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...patterns, limit);
    return db.prepare(sql).all(...patterns, limit);
  } finally {
    db.close();
  }
}

function classifyCandidateChunkId(value) {
  if (value === null) {
    return {
      accepted: false,
      storage_class: "null",
    };
  }
  if (Buffer.isBuffer(value)) {
    return {
      accepted: false,
      storage_class: "blob",
    };
  }
  if (typeof value !== "string") {
    return {
      accepted: false,
      storage_class: typeof value,
    };
  }
  return {
    accepted: true,
    storage_class: "text",
    id: value,
  };
}

function selectEngineCandidates(engine, patterns) {
  const engineSql = withWhere(ENGINE_KG_CANDIDATE_SQL, "", patterns.length);
  const engineRows = engine.prepare(engineSql).all(...patterns);
  const candidateIds = [];
  const idDecisions = [];
  const seen = new Set();
  for (const row of engineRows) {
    const classified = classifyCandidateChunkId(row.chunk_id);
    const decision = { ...classified, duplicate: false };
    if (!classified.accepted) {
      idDecisions.push(decision);
      continue;
    }
    if (seen.has(classified.id)) {
      idDecisions.push({ ...decision, accepted: false, duplicate: true });
      continue;
    }
    seen.add(classified.id);
    candidateIds.push(classified.id);
    idDecisions.push(decision);
  }
  return {
    engineRows,
    candidateIds,
    idDecisions,
    acceptedTextCount: idDecisions.filter(item => item.accepted && item.storage_class === "text").length,
    skippedNonTextCount: idDecisions.filter(item => !item.accepted && !item.duplicate && item.storage_class !== "text").length,
    duplicateSkipCount: idDecisions.filter(item => item.duplicate).length,
  };
}

function coreSqlFor(strategy, explicitTieBreaker = false) {
  if (strategy === "join") return explicitTieBreaker ? CORE_KG_JSON_JOIN_TIEBREAKER_SQL : CORE_KG_JSON_JOIN_SQL;
  return explicitTieBreaker ? CORE_KG_JSON_EXISTS_TIEBREAKER_SQL : CORE_KG_JSON_EXISTS_SQL;
}

function selectIsolated({ enginePath, corePath, patterns, limit, explicitTieBreaker = false, explain = false, strategy = "exists" }) {
  const engine = new Database(enginePath, { readonly: true, fileMustExist: true });
  const core = new Database(corePath, { readonly: true, fileMustExist: true });
  try {
    const {
      engineRows,
      candidateIds,
      idDecisions,
      acceptedTextCount,
      skippedNonTextCount,
      duplicateSkipCount,
    } = selectEngineCandidates(engine, patterns);
    const json = JSON.stringify(candidateIds);
    const coreSql = coreSqlFor(strategy, explicitTieBreaker);
    if (explain) return core.prepare(`EXPLAIN QUERY PLAN ${coreSql}`).all(json, limit);
    const coreRows = core.prepare(coreSql).all(json, limit);
    return {
      rows: mergeRows(coreRows, engineRows),
      candidateIds,
      idDecisions,
      acceptedTextCount,
      skippedNonTextCount,
      duplicateSkipCount,
      engineRowCount: engineRows.length,
      candidateIdCount: candidateIds.length,
      uniqueCandidateIdCount: new Set(candidateIds).size,
      jsonBytes: Buffer.byteLength(json),
      coreDatabaseList: core.prepare("PRAGMA database_list").all().map(row => row.name),
      engineDatabaseList: engine.prepare("PRAGMA database_list").all().map(row => row.name),
    };
  } finally {
    core.close();
    engine.close();
  }
}

function ids(rows) {
  return rows.map(row => row.id);
}

function stableSequences(sequences) {
  return sequences.every(seq => JSON.stringify(seq) === JSON.stringify(sequences[0]));
}

function rowsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function idsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function createBasicFixture(root) {
  const corePath = join(root, "basic-core.sqlite");
  const enginePath = join(root, "basic-engine.sqlite");
  const core = new Database(corePath);
  const engine = new Database(enginePath);
  try {
    createCoreSchema(core);
    createEngineSchema(engine);
    for (let i = 0; i < 10; i += 1) {
      const id = `match-${i}`;
      insertEngine(engine, id, `alpha match ${i}`);
      if (![0, 2, 4].includes(i)) insertCore(core, id, 2000 - i);
    }
    insertEngine(engine, "archived", "alpha archived", { is_archived: 1 });
    insertCore(core, "archived", 3000);
    insertEngine(engine, "null-archived", "alpha null archived", { is_archived: null });
    insertCore(core, "null-archived", 2500);
    insertEngine(engine, "empty-kg", "", { is_archived: 0 });
    insertCore(core, "empty-kg", 2600);
    insertEngine(engine, "null-kg", null, { is_archived: 0 });
    insertCore(core, "null-kg", 2700);
    insertEngine(engine, "unicode", "雪 quote' slash\\ Case_token under_score", { hit_count: null, base_tau: null, category: null });
    insertCore(core, "unicode", 2400, "unicode text");
    insertEngine(engine, "unmatched", "does-not-match");
    insertCore(core, "unmatched", 2800);
    insertEngine(engine, null, "alpha null id", { is_archived: 0 });
    insertEngine(engine, Buffer.from("null"), "alpha blob id", { is_archived: 0 });
    insertEngine(engine, "null", "alpha text null id", { is_archived: 0 });
    insertCore(core, "null", 2300);
  } finally {
    core.close();
    engine.close();
  }
  return { corePath, enginePath };
}

function createTieFixture(root, name, { coreOrder, engineOrder, index = false }) {
  const corePath = join(root, `${name}-core.sqlite`);
  const enginePath = join(root, `${name}-engine.sqlite`);
  const core = new Database(corePath);
  const engine = new Database(enginePath);
  try {
    createCoreSchema(core);
    createEngineSchema(engine);
    for (const id of coreOrder) insertCore(core, id, 1000, `tie ${id}`);
    for (const id of engineOrder) insertEngine(engine, id, "tie alpha");
    if (index) core.exec("CREATE INDEX idx_chunks_updated ON chunks(updated_at DESC)");
  } finally {
    core.close();
    engine.close();
  }
  return { corePath, enginePath };
}

function runTieCase(root, name, options) {
  const fixture = createTieFixture(root, name, options);
  const patterns = ["%alpha%"];
  const legacySequences = [];
  const existsSequences = [];
  const joinSequences = [];
  for (let i = 0; i < 20; i += 1) {
    legacySequences.push(ids(selectLegacy({ ...fixture, patterns, limit: 2 })));
    existsSequences.push(ids(selectIsolated({ ...fixture, patterns, limit: 2, strategy: "exists" }).rows));
    joinSequences.push(ids(selectIsolated({ ...fixture, patterns, limit: 2, strategy: "join" }).rows));
  }
  const legacyExplicit = ids(selectLegacy({ ...fixture, patterns, limit: 2, explicitTieBreaker: true }));
  const existsExplicit = ids(selectIsolated({ ...fixture, patterns, limit: 2, explicitTieBreaker: true, strategy: "exists" }).rows);
  const joinExplicit = ids(selectIsolated({ ...fixture, patterns, limit: 2, explicitTieBreaker: true, strategy: "join" }).rows);
  return {
    name,
    legacy_ids: legacySequences[0],
    exists_ids: existsSequences[0],
    join_ids: joinSequences[0],
    isolated_ids: existsSequences[0],
    legacy_exists_equal: idsEqual(legacySequences[0], existsSequences[0]),
    legacy_join_equal: idsEqual(legacySequences[0], joinSequences[0]),
    equal: idsEqual(legacySequences[0], existsSequences[0]),
    legacy_stable: stableSequences(legacySequences),
    exists_stable: stableSequences(existsSequences),
    join_stable: stableSequences(joinSequences),
    isolated_stable: stableSequences(existsSequences),
    legacy_plan: selectLegacy({ ...fixture, patterns, limit: 2, explain: true }).map(row => row.detail),
    core_exists_plan: selectIsolated({ ...fixture, patterns, limit: 2, explain: true, strategy: "exists" }).map(row => row.detail),
    core_join_plan: selectIsolated({ ...fixture, patterns, limit: 2, explain: true, strategy: "join" }).map(row => row.detail),
    isolated_plan: selectIsolated({ ...fixture, patterns, limit: 2, explain: true, strategy: "exists" }).map(row => row.detail),
    explicit_tiebreaker_legacy_ids: legacyExplicit,
    explicit_tiebreaker_exists_ids: existsExplicit,
    explicit_tiebreaker_join_ids: joinExplicit,
    explicit_tiebreaker_isolated_ids: existsExplicit,
    explicit_tiebreaker_equal: idsEqual(legacyExplicit, existsExplicit) && idsEqual(legacyExplicit, joinExplicit),
  };
}

function createLargeFixture(root) {
  const corePath = join(root, "large-core.sqlite");
  const enginePath = join(root, "large-engine.sqlite");
  const core = new Database(corePath);
  const engine = new Database(enginePath);
  try {
    createCoreSchema(core);
    createEngineSchema(engine);
    for (let i = 0; i < 2000; i += 1) {
      const id = `large-${String(i).padStart(4, "0")}`;
      insertEngine(engine, id, "large alpha candidate");
      if (i % 3 === 0) insertCore(core, id, 5000 - i);
    }
  } finally {
    core.close();
    engine.close();
  }
  return { corePath, enginePath };
}

function measure(fn, iterations = 5) {
  fn();
  const timings = [];
  let value;
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    value = fn();
    timings.push(performance.now() - start);
  }
  return { value, ms: Number(median(timings).toFixed(3)) };
}

function measureLarge(root) {
  const fixture = createLargeFixture(root);
  const patterns = ["%alpha%"];
  const legacy = measure(() => selectLegacy({ ...fixture, patterns, limit: 5 }));
  const exists = measure(() => selectIsolated({ ...fixture, patterns, limit: 5, strategy: "exists" }));
  const join = measure(() => selectIsolated({ ...fixture, patterns, limit: 5, strategy: "join" }));
  return {
    large_candidate_count: exists.value.engineRowCount,
    json_bytes: exists.value.jsonBytes,
    large_legacy_ms_median: legacy.ms,
    large_exists_ms_median: exists.ms,
    large_join_ms_median: join.ms,
    large_legacy_ms: legacy.ms,
    large_core_ms: exists.ms,
    large_exists_ids_equal: idsEqual(ids(legacy.value), ids(exists.value.rows)),
    large_join_ids_equal: idsEqual(ids(legacy.value), ids(join.value.rows)),
    large_ids_equal: idsEqual(ids(legacy.value), ids(exists.value.rows)) && idsEqual(ids(legacy.value), ids(join.value.rows)),
  };
}

function createNonTextFixture(root) {
  const corePath = join(root, "non-text-core.sqlite");
  const enginePath = join(root, "non-text-engine.sqlite");
  const core = new Database(corePath);
  const engine = new Database(enginePath);
  try {
    createCoreSchema(core);
    createEngineSchema(engine);
    insertEngine(engine, null, "alpha null sql id");
    insertEngine(engine, Buffer.from("null"), "alpha blob id");
    insertEngine(engine, "null", "alpha text null id");
    insertEngine(engine, "valid-text", "alpha valid text id");
    insertCore(core, "null", 2000);
    insertCore(core, "valid-text", 1000);
  } finally {
    core.close();
    engine.close();
  }
  return { corePath, enginePath };
}

function describeIdValue(value) {
  if (value === null) return { storage_class: "null" };
  if (Buffer.isBuffer(value)) return { storage_class: "blob", hex: value.toString("hex") };
  if (typeof value === "string") return { storage_class: "text", id: value };
  return { storage_class: typeof value, value };
}

function runNonTextCase(root) {
  const fixture = createNonTextFixture(root);
  const patterns = ["%alpha%"];
  const engine = new Database(fixture.enginePath, { readonly: true, fileMustExist: true });
  try {
    const storageRows = engine.prepare(`
      SELECT typeof(chunk_id) AS storage_class, chunk_id
      FROM memory_confidence
      ORDER BY rowid
    `).all();
    const {
      engineRows,
      candidateIds,
      idDecisions,
      acceptedTextCount,
      skippedNonTextCount,
      duplicateSkipCount,
    } = selectEngineCandidates(engine, patterns);
    const legacyIds = ids(selectLegacy({ ...fixture, patterns, limit: 10 }));
    const existsIds = ids(selectIsolated({ ...fixture, patterns, limit: 10, strategy: "exists" }).rows);
    const joinIds = ids(selectIsolated({ ...fixture, patterns, limit: 10, strategy: "join" }).rows);
    return {
      engine_storage_classes: storageRows.map(row => row.storage_class),
      engine_row_count: engineRows.length,
      accepted_text_count: acceptedTextCount,
      skipped_non_text_count: skippedNonTextCount,
      duplicate_skip_count: duplicateSkipCount,
      accepted_source_storage_classes: idDecisions.filter(item => item.accepted).map(item => item.storage_class),
      skipped_source_storage_classes: idDecisions.filter(item => !item.accepted && !item.duplicate).map(item => item.storage_class),
      id_decisions: idDecisions,
      candidate_ids: candidateIds,
      null_key_skipped: idDecisions.some(item => item.storage_class === "null" && item.accepted === false),
      blob_key_skipped: idDecisions.some(item => item.storage_class === "blob" && item.accepted === false),
      text_null_preserved: candidateIds.includes("null"),
      legacy_ids: legacyIds,
      exists_ids: existsIds,
      join_ids: joinIds,
      isolated_ids: existsIds,
      equal: idsEqual(legacyIds, existsIds) && idsEqual(legacyIds, joinIds),
    };
  } finally {
    engine.close();
  }
}

function createBlobBlobFixture(root) {
  const corePath = join(root, "blob-blob-core.sqlite");
  const enginePath = join(root, "blob-blob-engine.sqlite");
  const core = new Database(corePath);
  const engine = new Database(enginePath);
  try {
    createCoreSchema(core);
    createEngineSchema(engine);
    insertEngine(engine, Buffer.from("blob-only"), "alpha blob match");
    core.prepare("INSERT INTO chunks (id, text, path, updated_at) VALUES (?, ?, ?, ?)")
      .run(Buffer.from("blob-only"), "blob text", "memory/kg/blob-only.md", 5000);
  } finally {
    core.close();
    engine.close();
  }
  return { corePath, enginePath };
}

function runBlobBlobCase(root) {
  const fixture = createBlobBlobFixture(root);
  const patterns = ["%alpha%"];
  const engine = new Database(fixture.enginePath, { readonly: true, fileMustExist: true });
  const core = new Database(fixture.corePath, { readonly: true, fileMustExist: true });
  const legacy = openLegacyDb(fixture.enginePath, fixture.corePath);
  try {
    const { idDecisions } = selectEngineCandidates(engine, patterns);
    const legacyRows = legacy.prepare(`
        SELECT c.id, c.text, c.path, c.updated_at, mc.kg_data,
          typeof(mc.chunk_id) AS engine_storage_class,
          typeof(c.id) AS core_storage_class
        FROM memory_confidence mc
        JOIN chunks c ON c.id = mc.chunk_id
        WHERE COALESCE(mc.is_archived, 0) = 0
          AND mc.kg_data LIKE ?
        ORDER BY c.updated_at DESC, c.id ASC
      `).all(...patterns);
    const existsRows = selectIsolated({ ...fixture, patterns, limit: 10, strategy: "exists" }).rows;
    const joinRows = selectIsolated({ ...fixture, patterns, limit: 10, strategy: "join" }).rows;
    const blobDecision = idDecisions.find(item => item.storage_class === "blob");
    return {
      legacy_match_count: legacyRows.length,
      isolated_exists_match_count: existsRows.length,
      isolated_join_match_count: joinRows.length,
      legacy_engine_storage_class: legacyRows[0]?.engine_storage_class ?? null,
      legacy_core_storage_class: legacyRows[0]?.core_storage_class ?? null,
      classifier_storage_class: blobDecision?.storage_class ?? null,
      classifier_accepted: blobDecision?.accepted ?? null,
      classifier_value: describeIdValue(Buffer.from("blob-only")),
      equal: legacyRows.length === existsRows.length && legacyRows.length === joinRows.length,
    };
  } finally {
    legacy.close();
    core.close();
    engine.close();
  }
}

function runLikeCases(fixture) {
  const cases = [
    { name: "alpha", patterns: ["%alpha%"] },
    { name: "ascii_case", patterns: ["%Case%"] },
    { name: "underscore_wildcard", patterns: ["%Case_%"] },
    { name: "literal_under_score", patterns: ["%under_score%"] },
    { name: "unicode", patterns: ["%雪%"] },
    { name: "quote", patterns: ["%quote'%"] },
    { name: "backslash", patterns: ["%slash\\%"] },
  ];
  return cases.map(item => {
    const legacyIds = ids(selectLegacy({ ...fixture, patterns: item.patterns, limit: 10 }));
    const existsIds = ids(selectIsolated({ ...fixture, patterns: item.patterns, limit: 10, strategy: "exists" }).rows);
    const joinIds = ids(selectIsolated({ ...fixture, patterns: item.patterns, limit: 10, strategy: "join" }).rows);
    return {
      name: item.name,
      patterns: item.patterns,
      legacy_ids: legacyIds,
      exists_ids: existsIds,
      join_ids: joinIds,
      equal: idsEqual(legacyIds, existsIds) && idsEqual(legacyIds, joinIds),
    };
  });
}

function createDuplicateFixture(root) {
  const corePath = join(root, "duplicate-core.sqlite");
  const enginePath = join(root, "duplicate-engine.sqlite");
  const core = new Database(corePath);
  const engine = new Database(enginePath);
  try {
    createCoreSchema(core);
    engine.exec(`
      CREATE TABLE memory_confidence (
        chunk_id TEXT,
        confidence REAL,
        last_confidence_update INTEGER,
        base_tau REAL,
        hit_count INTEGER,
        is_protected INTEGER,
        conflict_flag INTEGER,
        category TEXT,
        is_archived INTEGER,
        kg_data TEXT
      );
    `);
    insertCore(core, "dup", 2000);
    insertCore(core, "other", 1000);
    insertEngine(engine, "dup", "alpha duplicate one");
    insertEngine(engine, "dup", "alpha duplicate two", { hit_count: 9 });
    insertEngine(engine, "other", "alpha other");
  } finally {
    core.close();
    engine.close();
  }
  return { corePath, enginePath };
}

function runDuplicateCase(root) {
  const fixture = createDuplicateFixture(root);
  const patterns = ["%alpha%"];
  const exists = selectIsolated({ ...fixture, patterns, limit: 10, strategy: "exists" });
  const join = selectIsolated({ ...fixture, patterns, limit: 10, strategy: "join" });
  const queryRowsUnique = ids(exists.rows).length === new Set(ids(exists.rows)).size
    && ids(join.rows).length === new Set(ids(join.rows)).size;
  return {
    engine_row_count: exists.engineRowCount,
    accepted_unique_count: exists.acceptedTextCount,
    duplicate_skip_count: exists.duplicateSkipCount,
    non_text_skip_count: exists.skippedNonTextCount,
    candidate_id_count: exists.candidateIdCount,
    unique_candidate_id_count: exists.uniqueCandidateIdCount,
    id_decisions: exists.idDecisions,
    exists_ids: ids(exists.rows),
    join_ids: ids(join.rows),
    exists_unique_row_ids: new Set(ids(exists.rows)).size,
    join_unique_row_ids: new Set(ids(join.rows)).size,
    query_rows_unique: queryRowsUnique,
  };
}

function checkReadonlyTopology(root) {
  const readonlyRoot = join(root, "readonly");
  mkdirSync(readonlyRoot, { recursive: true });
  const fixture = createBasicFixture(readonlyRoot);
  const core = new Database(fixture.corePath, { readonly: true, fileMustExist: true });
  const engine = new Database(fixture.enginePath, { readonly: true, fileMustExist: true });
  try {
    const coreBefore = core.prepare("SELECT COUNT(*) AS count FROM chunks").get().count;
    const engineBefore = engine.prepare("SELECT COUNT(*) AS count FROM memory_confidence").get().count;
    let coreReadonly = false;
    let engineReadonly = false;
    try {
      core.exec("UPDATE chunks SET text = 'mutated'");
    } catch (error) {
      coreReadonly = error.code === "SQLITE_READONLY";
    }
    try {
      engine.exec("UPDATE memory_confidence SET confidence = 0.1");
    } catch (error) {
      engineReadonly = error.code === "SQLITE_READONLY";
    }
    return {
      core_database_list: core.prepare("PRAGMA database_list").all().map(row => row.name),
      engine_database_list: engine.prepare("PRAGMA database_list").all().map(row => row.name),
      core_readonly: coreReadonly,
      engine_readonly: engineReadonly,
      core_unchanged: core.prepare("SELECT COUNT(*) AS count FROM chunks").get().count === coreBefore,
      engine_unchanged: engine.prepare("SELECT COUNT(*) AS count FROM memory_confidence").get().count === engineBefore,
      corePath: fixture.corePath,
      enginePath: fixture.enginePath,
    };
  } finally {
    core.close();
    engine.close();
  }
}

function sidecars(path) {
  return existsSync(`${path}-wal`) || existsSync(`${path}-shm`);
}

function runProbe() {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-isolated-kg-probe-"));
  let result;
  try {
    const basic = createBasicFixture(root);
    const patterns = ["%alpha%", "%雪%", "%quote'%", "%slash\\%", "%Case_%"];
    const legacyRows = selectLegacy({ ...basic, patterns, limit: 3 });
    const existsRows = selectIsolated({ ...basic, patterns, limit: 3, strategy: "exists" });
    const joinRows = selectIsolated({ ...basic, patterns, limit: 3, strategy: "join" });
    const explicitLegacy = selectLegacy({ ...basic, patterns, limit: 3, explicitTieBreaker: true });
    const explicitExists = selectIsolated({ ...basic, patterns, limit: 3, explicitTieBreaker: true, strategy: "exists" }).rows;
    const explicitJoin = selectIsolated({ ...basic, patterns, limit: 3, explicitTieBreaker: true, strategy: "join" }).rows;
    const basicIdsEqual = idsEqual(ids(legacyRows), ids(existsRows.rows)) && idsEqual(ids(legacyRows), ids(joinRows.rows));
    const likeCases = runLikeCases(basic);
    const nonTextCase = runNonTextCase(root);
    const blobBlobCase = runBlobBlobCase(root);
    const duplicateCase = runDuplicateCase(root);
    const readonly = checkReadonlyTopology(root);
    const tieCases = [
      runTieCase(root, "same_insert_order_no_index", { coreOrder: ["A", "B", "C"], engineOrder: ["A", "B", "C"] }),
      runTieCase(root, "opposite_insert_order_no_index", { coreOrder: ["C", "B", "A"], engineOrder: ["A", "B", "C"] }),
      runTieCase(root, "opposite_insert_order_with_index", { coreOrder: ["C", "B", "A"], engineOrder: ["A", "B", "C"], index: true }),
    ];
    const large = measureLarge(root);
    const allTieEqual = tieCases.every(row => row.legacy_exists_equal && row.legacy_join_equal && row.legacy_stable && row.exists_stable && row.join_stable);
    const explicitTieEqual = tieCases.every(row => row.explicit_tiebreaker_equal)
      && idsEqual(ids(explicitLegacy), ids(explicitExists))
      && idsEqual(ids(explicitLegacy), ids(explicitJoin));
    const existsEquivalent = idsEqual(ids(legacyRows), ids(existsRows.rows)) && rowsEqual(legacyRows, existsRows.rows);
    const joinEquivalent = idsEqual(ids(legacyRows), ids(joinRows.rows)) && rowsEqual(legacyRows, joinRows.rows);
    const missingCoreEquivalent = !ids(existsRows.rows).includes("match-0")
      && !ids(existsRows.rows).includes("match-2")
      && !ids(joinRows.rows).includes("match-0")
      && !ids(joinRows.rows).includes("match-2");
    const likeEquivalent = likeCases.every(row => row.equal);
    const metadataEquivalent = rowsEqual(legacyRows, existsRows.rows) && rowsEqual(legacyRows, joinRows.rows);
    const nonTextEquivalent = nonTextCase.equal;
    const duplicateEquivalent = duplicateCase.query_rows_unique;
    const largeEquivalent = large.large_exists_ids_equal && large.large_join_ids_equal;
    const textIdFoundationalEquivalent = basicIdsEqual
      && existsEquivalent
      && joinEquivalent
      && missingCoreEquivalent
      && likeEquivalent
      && metadataEquivalent
      && nonTextEquivalent
      && duplicateEquivalent
      && largeEquivalent;
    const sqliteStorageClassEquivalent = textIdFoundationalEquivalent && blobBlobCase.equal;
    const foundationalEquivalent = sqliteStorageClassEquivalent;
    let recommendationClass;
    if (!foundationalEquivalent) recommendationClass = "C";
    else if (allTieEqual) recommendationClass = "A";
    else recommendationClass = "B";
    const recommendation = recommendationClass === "A"
      ? "Fixtures were strictly equivalent, but production migration should still add an explicit tie-order audit before switching."
      : recommendationClass === "B"
        ? "Non-tie semantics are equivalent, but updated_at ties require an explicit deterministic order before migration."
        : "Do not enable isolated KG until the TEXT-ID invariant is established or non-text IDs are supported.";
    const conditionalRecommendationClass = textIdFoundationalEquivalent
      ? allTieEqual ? "A" : "B"
      : "C";
    const conditionalRecommendation = conditionalRecommendationClass === "A"
      ? "Within a verified TEXT-only ID invariant, fixtures are strictly equivalent."
      : conditionalRecommendationClass === "B"
        ? "With a verified TEXT-only ID invariant, non-tie semantics are equivalent but updated_at ties still require deterministic ordering."
        : "Even with a TEXT-only ID invariant, foundational KG semantics are not equivalent.";
    const coreExistsPlan = selectIsolated({ ...basic, patterns, limit: 3, explain: true, strategy: "exists" }).map(row => row.detail);
    const coreJoinPlan = selectIsolated({ ...basic, patterns, limit: 3, explain: true, strategy: "join" }).map(row => row.detail);
    const strategyEvidence = {
      exists_equivalent: existsEquivalent,
      join_equivalent: joinEquivalent,
      exists_plan_nonempty: coreExistsPlan.length > 0,
      join_plan_nonempty: coreJoinPlan.length > 0,
      join_uses_chunk_id_lookup: coreJoinPlan.some(line => /SEARCH c USING .*INDEX/i.test(String(line))),
      join_not_slower_in_probe: large.large_join_ms_median <= large.large_exists_ms_median,
    };
    const preferredCoreStrategy = !foundationalEquivalent
      ? "none"
      : strategyEvidence.join_equivalent && strategyEvidence.join_plan_nonempty
        ? "json_each_join"
        : strategyEvidence.exists_equivalent && strategyEvidence.exists_plan_nonempty
          ? "json_each_exists"
          : "none";
    const conditionalPreferredCoreStrategy = !textIdFoundationalEquivalent
      ? "none"
      : strategyEvidence.join_equivalent && strategyEvidence.join_plan_nonempty
        ? "json_each_join"
        : strategyEvidence.exists_equivalent && strategyEvidence.exists_plan_nonempty
          ? "json_each_exists"
          : "none";
    result = {
      basic_equivalence: basicIdsEqual,
      exists_equivalence: existsEquivalent,
      join_equivalence: joinEquivalent,
      missing_core_equivalence: missingCoreEquivalent,
      like_equivalence: likeEquivalent,
      like_cases: likeCases,
      metadata_equivalence: metadataEquivalent,
      non_text_id_equivalence: nonTextEquivalent,
      non_text_id_case: nonTextCase,
      duplicate_id_case: duplicateCase,
      duplicate_equivalence: duplicateEquivalent,
      large_equivalence: largeEquivalent,
      text_id_foundational_equivalence: textIdFoundationalEquivalent,
      blob_blob_case: blobBlobCase,
      sqlite_storage_class_equivalence: sqliteStorageClassEquivalent,
      foundational_equivalence: foundationalEquivalent,
      candidate_id_count: existsRows.candidateIdCount,
      unique_candidate_id_count: existsRows.uniqueCandidateIdCount,
      tie_cases: tieCases,
      explicit_tiebreaker_equivalence: explicitTieEqual,
      core_exists_plan: coreExistsPlan,
      core_join_plan: coreJoinPlan,
      large_candidate_count: large.large_candidate_count,
      json_bytes: large.json_bytes,
      large_legacy_ms_median: large.large_legacy_ms_median,
      large_exists_ms_median: large.large_exists_ms_median,
      large_join_ms_median: large.large_join_ms_median,
      large_legacy_ms: large.large_legacy_ms,
      large_core_ms: large.large_core_ms,
      large_exists_ids_equal: large.large_exists_ids_equal,
      large_join_ids_equal: large.large_join_ids_equal,
      large_ids_equal: large.large_ids_equal,
      core_database_list: readonly.core_database_list,
      engine_database_list: readonly.engine_database_list,
      core_readonly: readonly.core_readonly,
      engine_readonly: readonly.engine_readonly,
      core_sidecars: sidecars(readonly.corePath),
      engine_sidecars: sidecars(readonly.enginePath),
      core_unchanged: readonly.core_unchanged,
      engine_unchanged: readonly.engine_unchanged,
      recommendation_class: recommendationClass,
      recommendation,
      conditional_recommendation_class: conditionalRecommendationClass,
      conditional_recommendation: conditionalRecommendation,
      preferred_core_strategy: preferredCoreStrategy,
      conditional_preferred_core_strategy: conditionalPreferredCoreStrategy,
      strategy_evidence: strategyEvidence,
      required_invariant: {
        engine_chunk_id_storage_class: "text",
        core_chunk_id_storage_class: "text",
        verified_on_real_db: false,
        future_audit_sql: [
          "SELECT COUNT(*) AS non_text_count FROM memory_confidence WHERE typeof(chunk_id) != 'text';",
          "SELECT COUNT(*) AS non_text_count FROM chunks WHERE typeof(id) != 'text';",
        ],
      },
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  result.temp_root_exists_after_cleanup = existsSync(root);
  return result;
}

module.exports = {
  classifyCandidateChunkId,
  CORE_KG_JSON_EXISTS_SQL,
  CORE_KG_JSON_JOIN_SQL,
  CORE_KG_JSON_SQL: CORE_KG_JSON_EXISTS_SQL,
  ENGINE_KG_CANDIDATE_SQL,
  LEGACY_KG_SQL,
  runProbe,
};

if (require.main === module) {
  console.log(JSON.stringify(runProbe(), null, 2));
}
