import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectKgCandidates } from "../lib/recall/hybrid/channels/kg.js";
import {
  CORE_KG_JSON_JOIN_SQL,
  selectIsolatedKgRows,
} from "../lib/recall/hybrid/channels/kg-query.js";
import { createCandidateCounts, createHybridDebug, createHybridWarnings } from "../lib/recall/hybrid/debug.js";

function createFixtureRoot() {
  return mkdtempSync(join(tmpdir(), "memory-engine-kg-isolated-"));
}

function createCoreDb(root) {
  const db = new Database(join(root, "core.sqlite"));
  db.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      text TEXT,
      path TEXT,
      updated_at INTEGER
    );
  `);
  return db;
}

function createEngineDb(root, { duplicateFriendly = false } = {}) {
  const db = new Database(join(root, "engine.sqlite"));
  db.exec(`
    CREATE TABLE memory_confidence (
      ${duplicateFriendly ? "row_id INTEGER PRIMARY KEY AUTOINCREMENT," : "chunk_id TEXT PRIMARY KEY,"}
      ${duplicateFriendly ? "chunk_id TEXT," : ""}
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
  return db;
}

function insertChunk(db, id, updatedAt, text = `text ${String(id)}`) {
  db.prepare("INSERT INTO chunks (id, text, path, updated_at) VALUES (?, ?, ?, ?)")
    .run(id, text, `memory/kg/${String(id)}.md`, updatedAt);
}

function insertConfidence(db, id, {
  confidence = 0.82,
  last_confidence_update = 0,
  base_tau = 7,
  hit_count = 3,
  is_protected = 0,
  conflict_flag = 0,
  category = "raw_log",
  is_archived = 0,
  kg_data = "alpha",
} = {}) {
  const columns = db.prepare("PRAGMA table_info(memory_confidence)").all().map(row => row.name);
  if (columns.includes("row_id")) {
    db.prepare(`
      INSERT INTO memory_confidence (
        chunk_id, confidence, last_confidence_update, base_tau, hit_count,
        is_protected, conflict_flag, category, is_archived, kg_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, confidence, last_confidence_update, base_tau, hit_count, is_protected, conflict_flag, category, is_archived, kg_data);
    return;
  }
  db.prepare(`
    INSERT INTO memory_confidence (
      chunk_id, confidence, last_confidence_update, base_tau, hit_count,
      is_protected, conflict_flag, category, is_archived, kg_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, confidence, last_confidence_update, base_tau, hit_count, is_protected, conflict_flag, category, is_archived, kg_data);
}

function openLegacy(enginePath, corePath) {
  const db = new Database(enginePath);
  db.exec(`ATTACH DATABASE '${String(corePath).replace(/'/g, "''")}' AS core`);
  return db;
}

function stripRow(row) {
  return {
    id: Buffer.isBuffer(row.id) ? row.id.toString("hex") : row.id,
    text: row.text,
    path: row.path,
    updated_at: row.updated_at,
    confidence: row.confidence,
    last_confidence_update: row.last_confidence_update,
    base_tau: row.base_tau,
    hit_count: row.hit_count,
    is_protected: row.is_protected,
    conflict_flag: row.conflict_flag,
    category: row.category,
    is_archived: row.is_archived,
    kg_data: row.kg_data,
  };
}

function buildCtx({
  withDb,
  withEngineDb,
  withCoreDb,
  rawQuery = "alpha",
  queryTerms = ["alpha"],
  ftsTopK = 10,
  kgAccessMode = "legacy",
  kgIsolationRequested = false,
  kgIsolationFallbackReason = null,
}) {
  const candidateCounts = createCandidateCounts();
  const debug = createHybridDebug({
    rawQuery,
    strippedQuery: rawQuery,
    normalizedQuery: rawQuery,
    queryTerms,
    candidateCounts,
    minConfidence: 0,
    lexicalConfidenceThreshold: 0.7,
  });
  const { warnHybridSearchOnce } = createHybridWarnings();
  return {
    withDb,
    withEngineDb,
    withCoreDb,
    kgAccessMode,
    kgIsolationRequested,
    kgIsolationFallbackReason,
    channels: {},
    debug,
    candidateCounts,
    normalizedQuery: rawQuery,
    strippedQuery: rawQuery,
    likePatternTopN: 8,
    ftsTopK,
    queryTerms,
    exactFragments: [],
    categoryMap: null,
    normalizeCandidate: row => row,
    filterForRerank: () => true,
    enrichLexicalCandidate: row => ({
      ...row,
      token_coverage: 1,
      exact_bonus: 0,
      structured_match_bonus: 0,
    }),
    inferCategoryFromChunk: () => "raw_log",
    lexicalMatchScore: () => 0,
    toDebugErrorMessage: error => error.message,
    warnHybridSearchOnce,
  };
}

async function collectRows(ctx) {
  await collectKgCandidates(ctx);
  return Array.isArray(ctx.channels.kg) ? ctx.channels.kg.map(stripRow) : [];
}

test("isolated KG matches legacy for text IDs, missing core, archived/null-empty kg_data, and metadata merge", async () => {
  const root = createFixtureRoot();
  const core = createCoreDb(root);
  const engine = createEngineDb(root);
  try {
    insertChunk(core, "A", 3000, "alpha text A");
    insertChunk(core, "B", 2000, "alpha text B");
    insertChunk(core, "C", 1000, "alpha text C");
    insertConfidence(engine, "A", { confidence: 0.91, last_confidence_update: 10, base_tau: 9, hit_count: 5, is_protected: 1, conflict_flag: 1, category: "kg_node", is_archived: 0, kg_data: "alpha node" });
    insertConfidence(engine, "B", { confidence: 0.75, last_confidence_update: 11, base_tau: 8, hit_count: 4, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 0, kg_data: "alpha branch" });
    insertConfidence(engine, "C", { confidence: 0.63, last_confidence_update: 12, base_tau: 7, hit_count: 2, is_protected: 0, conflict_flag: 0, category: "episodic", is_archived: 0, kg_data: "alpha leaf" });
    insertConfidence(engine, "missing-core", { kg_data: "alpha missing" });
    insertChunk(core, "archived", 5000, "alpha archived");
    insertConfidence(engine, "archived", { is_archived: 1, kg_data: "alpha archived" });
    insertConfidence(engine, "null-kg", { kg_data: null });
    insertConfidence(engine, "empty-kg", { kg_data: "" });
    core.close();
    engine.close();

    const legacyDb = openLegacy(join(root, "engine.sqlite"), join(root, "core.sqlite"));
    const coreDb = new Database(join(root, "core.sqlite"), { readonly: true, fileMustExist: true });
    const engineDb = new Database(join(root, "engine.sqlite"), { readonly: true, fileMustExist: true });
    const sql = { legacy: [], core: [], engine: [] };
    try {
      const legacyRows = await collectRows(buildCtx({
        withDb: fn => fn({
          prepare(statement) {
            sql.legacy.push(String(statement));
            return legacyDb.prepare(statement);
          },
        }),
        withCoreDb: fn => fn(coreDb),
        withEngineDb: fn => fn(engineDb),
      }));
      const isolatedRows = await collectRows(buildCtx({
        withDb: () => { throw new Error("legacy should not run"); },
        withCoreDb: fn => fn({
          prepare(statement) {
            sql.core.push(String(statement));
            return coreDb.prepare(statement);
          },
        }),
        withEngineDb: fn => fn({
          prepare(statement) {
            sql.engine.push(String(statement));
            return engineDb.prepare(statement);
          },
        }),
        kgAccessMode: "isolated",
        kgIsolationRequested: true,
      }));

      assert.deepEqual(isolatedRows, legacyRows);
      assert.deepEqual(isolatedRows.map(row => row.id), ["A", "B", "C"]);
      assert.equal(sql.engine.some(statement => statement.includes("typeof(chunk_id) AS chunk_id_storage_class")), true);
      assert.equal(sql.engine.some(statement => statement.includes("LIMIT")), false);
      assert.equal(sql.core.some(statement => statement.includes("json_each(?)")), true);
      assert.equal(sql.core.some(statement => statement.includes("JOIN chunks c")), true);
      assert.equal(sql.core.some(statement => statement.includes("memory_confidence")), false);
      assert.equal(sql.core.some(statement => statement.includes("ATTACH")), false);
      assert.equal(sql.core.some(statement => statement.includes("TEMP")), false);
    } finally {
      engineDb.close();
      coreDb.close();
      legacyDb.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isolated KG preserves deterministic tie ordering with and without updated_at index", async () => {
  for (const indexed of [false, true]) {
    const root = createFixtureRoot();
    const core = createCoreDb(root);
    const engine = createEngineDb(root);
    try {
      for (const id of ["C", "B", "A"]) insertChunk(core, id, 1000, `alpha text ${id}`);
      for (const id of ["A", "B", "C"]) insertConfidence(engine, id, { kg_data: "alpha tie" });
      if (indexed) core.exec("CREATE INDEX idx_chunks_updated ON chunks(updated_at DESC)");
      core.close();
      engine.close();

      const legacyDb = openLegacy(join(root, "engine.sqlite"), join(root, "core.sqlite"));
      const coreDb = new Database(join(root, "core.sqlite"), { readonly: true, fileMustExist: true });
      const engineDb = new Database(join(root, "engine.sqlite"), { readonly: true, fileMustExist: true });
      try {
        const legacyRows = await collectRows(buildCtx({
          withDb: fn => fn(legacyDb),
          withCoreDb: fn => fn(coreDb),
          withEngineDb: fn => fn(engineDb),
          ftsTopK: 2,
        }));
        const isolatedRows = await collectRows(buildCtx({
          withDb: () => { throw new Error("legacy should not run"); },
          withCoreDb: fn => fn(coreDb),
          withEngineDb: fn => fn(engineDb),
          ftsTopK: 2,
          kgAccessMode: "isolated",
          kgIsolationRequested: true,
        }));
        assert.deepEqual(legacyRows.map(row => row.id), ["A", "B"]);
        assert.deepEqual(isolatedRows, legacyRows);
      } finally {
        engineDb.close();
        coreDb.close();
        legacyDb.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("isolated KG matches legacy across LIKE wildcard and special-character cases", async () => {
  const cases = [
    { query: "alpha", ids: ["alpha"] },
    { query: "Case", ids: ["Case_1", "case-match"] },
    { query: "under_score", ids: ["under_score"] },
    { query: "雪", ids: [] },
    { query: "quote'", ids: ["quote"] },
    { query: "slash\\", ids: ["slash"] },
  ];
  const root = createFixtureRoot();
  const core = createCoreDb(root);
  const engine = createEngineDb(root);
  try {
    const rows = [
      ["alpha", "alpha plain"],
      ["Case_1", "CaseX"],
      ["case-match", "casex"],
      ["under_score", "under_score"],
      ["snow", "雪"],
      ["quote", "quote'"],
      ["slash", "slash\\"],
    ];
    for (const [id] of rows) insertChunk(core, id, 1000, `text ${id}`);
    for (const [id, kgData] of rows) insertConfidence(engine, id, { kg_data: kgData });
    core.close();
    engine.close();

    const legacyDb = openLegacy(join(root, "engine.sqlite"), join(root, "core.sqlite"));
    const coreDb = new Database(join(root, "core.sqlite"), { readonly: true, fileMustExist: true });
    const engineDb = new Database(join(root, "engine.sqlite"), { readonly: true, fileMustExist: true });
    try {
      for (const item of cases) {
        const legacyRows = await collectRows(buildCtx({
          rawQuery: item.query,
          queryTerms: [item.query],
          withDb: fn => fn(legacyDb),
          withCoreDb: fn => fn(coreDb),
          withEngineDb: fn => fn(engineDb),
        }));
        const isolatedRows = await collectRows(buildCtx({
          rawQuery: item.query,
          queryTerms: [item.query],
          withDb: () => { throw new Error("legacy should not run"); },
          withCoreDb: fn => fn(coreDb),
          withEngineDb: fn => fn(engineDb),
          kgAccessMode: "isolated",
          kgIsolationRequested: true,
        }));
        assert.deepEqual(isolatedRows.map(row => row.id), legacyRows.map(row => row.id), item.query);
        assert.deepEqual(isolatedRows.map(row => row.id), item.ids, item.query);
      }
    } finally {
      engineDb.close();
      coreDb.close();
      legacyDb.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isolated KG de-duplicates duplicate text candidate IDs and keeps first metadata row", () => {
  const root = createFixtureRoot();
  const core = createCoreDb(root);
  const engine = createEngineDb(root, { duplicateFriendly: true });
  try {
    insertChunk(core, "dup", 1000, "alpha dup");
    insertChunk(core, "unique", 900, "alpha unique");
    insertConfidence(engine, "dup", { confidence: 0.91, kg_data: "alpha dup" });
    insertConfidence(engine, "dup", { confidence: 0.22, kg_data: "alpha dup second" });
    insertConfidence(engine, "unique", { confidence: 0.55, kg_data: "alpha unique" });
    core.close();
    engine.close();

    const coreDb = new Database(join(root, "core.sqlite"), { readonly: true, fileMustExist: true });
    const engineDb = new Database(join(root, "engine.sqlite"), { readonly: true, fileMustExist: true });
    try {
      const result = selectIsolatedKgRows({
        withCoreDb: fn => fn(coreDb),
        withEngineDb: fn => fn(engineDb),
      }, ["%alpha%"], 10);
      assert.equal(result.safe, true);
      assert.deepEqual(result.candidate_ids, ["dup", "unique"]);
      assert.equal(new Set(result.rows.map(row => row.id)).size, result.rows.length);
      const dupRow = result.rows.find(row => row.id === "dup");
      assert.equal(dupRow.confidence, 0.91);
    } finally {
      engineDb.close();
      coreDb.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isolated KG fail-closes to legacy on matching BLOB candidate IDs and never runs Core JSON JOIN", async () => {
  const root = createFixtureRoot();
  const core = createCoreDb(root);
  const engine = createEngineDb(root, { duplicateFriendly: true });
  try {
    insertChunk(core, Buffer.from("blob-only"), 1000, "alpha blob");
    insertConfidence(engine, Buffer.from("blob-only"), { kg_data: "alpha blob match" });
    core.close();
    engine.close();

    const legacyDb = openLegacy(join(root, "engine.sqlite"), join(root, "core.sqlite"));
    const coreDb = new Database(join(root, "core.sqlite"), { readonly: true, fileMustExist: true });
    const engineDb = new Database(join(root, "engine.sqlite"), { readonly: true, fileMustExist: true });
    const calls = { legacy: 0, core: 0, engine: 0 };
    try {
      const ctx = buildCtx({
        withDb: fn => {
          calls.legacy += 1;
          return fn(legacyDb);
        },
        withCoreDb: fn => {
          calls.core += 1;
          return fn(coreDb);
        },
        withEngineDb: fn => {
          calls.engine += 1;
          return fn(engineDb);
        },
        kgAccessMode: "isolated",
        kgIsolationRequested: true,
      });
      const rows = await collectRows(ctx);
      assert.equal(rows.length, 1);
      assert.equal(calls.engine, 1);
      assert.equal(calls.core, 0);
      assert.equal(calls.legacy, 1);
      assert.equal(ctx.debug.kg_access_mode, "legacy_fallback");
      assert.equal(ctx.debug.kg_isolated_fallback_reason, "non_text_matching_candidate_id");
    } finally {
      engineDb.close();
      coreDb.close();
      legacyDb.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("snapshot invariant fallback uses legacy only when isolated was requested but already denied", async () => {
  const root = createFixtureRoot();
  const core = createCoreDb(root);
  const engine = createEngineDb(root);
  try {
    insertChunk(core, "A", 1000, "alpha");
    insertConfidence(engine, "A", { kg_data: "alpha" });
    core.close();
    engine.close();

    const legacyDb = openLegacy(join(root, "engine.sqlite"), join(root, "core.sqlite"));
    const coreDb = new Database(join(root, "core.sqlite"), { readonly: true, fileMustExist: true });
    const engineDb = new Database(join(root, "engine.sqlite"), { readonly: true, fileMustExist: true });
    const calls = { legacy: 0, core: 0, engine: 0 };
    try {
      const ctx = buildCtx({
        withDb: fn => {
          calls.legacy += 1;
          return fn(legacyDb);
        },
        withCoreDb: fn => {
          calls.core += 1;
          return fn(coreDb);
        },
        withEngineDb: fn => {
          calls.engine += 1;
          return fn(engineDb);
        },
        kgAccessMode: "legacy",
        kgIsolationRequested: true,
        kgIsolationFallbackReason: "text_id_invariant_failed",
      });
      const rows = await collectRows(ctx);
      assert.deepEqual(rows.map(row => row.id), ["A"]);
      assert.equal(calls.legacy, 1);
      assert.equal(calls.core, 0);
      assert.equal(calls.engine, 0);
      assert.equal(ctx.debug.kg_access_mode, "legacy_fallback");
      assert.equal(ctx.debug.kg_isolated_fallback_reason, "text_id_invariant_failed");
    } finally {
      engineDb.close();
      coreDb.close();
      legacyDb.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Core JSON JOIN SQL stays deterministic and isolated", () => {
  assert.equal(CORE_KG_JSON_JOIN_SQL.includes("json_each(?)"), true);
  assert.equal(CORE_KG_JSON_JOIN_SQL.includes("JOIN chunks c"), true);
  assert.equal(CORE_KG_JSON_JOIN_SQL.includes("ORDER BY c.updated_at DESC, c.id ASC"), true);
  assert.equal(CORE_KG_JSON_JOIN_SQL.includes("LIMIT ?"), true);
  assert.equal(CORE_KG_JSON_JOIN_SQL.includes("ATTACH"), false);
  assert.equal(CORE_KG_JSON_JOIN_SQL.includes("TEMP"), false);
  assert.equal(CORE_KG_JSON_JOIN_SQL.includes("memory_confidence"), false);
});
