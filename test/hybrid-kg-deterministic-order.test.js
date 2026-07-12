import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectKgCandidates } from "../lib/recall/hybrid/channels/kg.js";
import { createCandidateCounts, createHybridDebug, createHybridWarnings } from "../lib/recall/hybrid/debug.js";

function createFixtureRoot() {
  return mkdtempSync(join(tmpdir(), "memory-engine-kg-deterministic-"));
}

function createDb(root) {
  const dbPath = join(root, "kg.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      text TEXT,
      path TEXT,
      updated_at INTEGER
    );

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
  return db;
}

function insertChunk(db, id, updatedAt, text = `text ${id}`) {
  db.prepare("INSERT INTO chunks (id, text, path, updated_at) VALUES (?, ?, ?, ?)")
    .run(id, text, `memory/kg/${id}.md`, updatedAt);
}

function insertConfidence(db, id, kgData, isArchived = 0) {
  db.prepare(`
    INSERT INTO memory_confidence (
      chunk_id, confidence, last_confidence_update, base_tau, hit_count,
      is_protected, conflict_flag, category, is_archived, kg_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, 0.82, 0, 7, 3, 0, 0, "raw_log", isArchived, kgData);
}

function buildCtx(db, {
  rawQuery = "alpha",
  queryTerms = ["alpha"],
  ftsTopK = 10,
} = {}) {
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
    withDb: fn => fn(db),
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

async function collectIds(db, options) {
  const ctx = buildCtx(db, options);
  await collectKgCandidates(ctx);
  return {
    ids: ctx.channels.kg.map(row => row.id),
    ctx,
  };
}

function controlIds(db, sql, patterns, limit) {
  return db.prepare(sql).all(...patterns, limit).map(row => row.id);
}

const BASELINE_SQL = `
  SELECT c.id
  FROM memory_confidence mc
  JOIN chunks c ON c.id = mc.chunk_id
  WHERE COALESCE(mc.is_archived, 0) = 0
    AND mc.kg_data IS NOT NULL
    AND mc.kg_data != ''
    AND (mc.kg_data LIKE ?)
  ORDER BY c.updated_at DESC
  LIMIT ?
`;

const DETERMINISTIC_SQL = `
  SELECT c.id
  FROM memory_confidence mc
  JOIN chunks c ON c.id = mc.chunk_id
  WHERE COALESCE(mc.is_archived, 0) = 0
    AND mc.kg_data IS NOT NULL
    AND mc.kg_data != ''
    AND (mc.kg_data LIKE ?)
  ORDER BY c.updated_at DESC, c.id ASC
  LIMIT ?
`;

test("KG deterministic order uses id ASC for equal updated_at with opposite insert orders", async () => {
  const root = createFixtureRoot();
  const db = createDb(root);
  try {
    for (const id of ["C", "B", "A"]) insertChunk(db, id, 1000, `alpha text ${id}`);
    for (const id of ["A", "B", "C"]) insertConfidence(db, id, "alpha match");
    const { ids, ctx } = await collectIds(db, { ftsTopK: 2 });
    assert.deepEqual(ids, ["A", "B"]);
    assert.equal(ctx.candidateCounts.kg_raw, 2);
    assert.equal(ctx.candidateCounts.kg_after_conf_filter, 2);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("KG deterministic order is stable when engine/core insert orders are reversed", async () => {
  const root = createFixtureRoot();
  const db = createDb(root);
  try {
    for (const id of ["A", "B", "C"]) insertChunk(db, id, 1000, `alpha text ${id}`);
    for (const id of ["C", "B", "A"]) insertConfidence(db, id, "alpha match");
    const { ids } = await collectIds(db, { ftsTopK: 2 });
    assert.deepEqual(ids, ["A", "B"]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("KG deterministic order is stable with updated_at index", async () => {
  const root = createFixtureRoot();
  const db = createDb(root);
  try {
    for (const id of ["C", "B", "A"]) insertChunk(db, id, 1000, `alpha text ${id}`);
    for (const id of ["A", "B", "C"]) insertConfidence(db, id, "alpha match");
    db.exec("CREATE INDEX idx_chunks_updated ON chunks(updated_at DESC)");
    const { ids } = await collectIds(db, { ftsTopK: 2 });
    assert.deepEqual(ids, ["A", "B"]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("KG deterministic order does not change non-tie updated_at ordering", async () => {
  const root = createFixtureRoot();
  const db = createDb(root);
  try {
    insertChunk(db, "Z", 3000, "alpha text Z");
    insertChunk(db, "A", 2000, "alpha text A");
    insertChunk(db, "M", 1000, "alpha text M");
    insertConfidence(db, "Z", "alpha match");
    insertConfidence(db, "A", "alpha match");
    insertConfidence(db, "M", "alpha match");
    const { ids } = await collectIds(db, { ftsTopK: 3 });
    assert.deepEqual(ids, ["Z", "A", "M"]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("KG deterministic order applies before LIMIT", async () => {
  const root = createFixtureRoot();
  const db = createDb(root);
  try {
    for (const id of ["D", "C", "B", "A"]) insertChunk(db, id, 1000, `alpha text ${id}`);
    for (const id of ["D", "C", "B", "A"]) insertConfidence(db, id, "alpha match");
    const { ids } = await collectIds(db, { ftsTopK: 2 });
    assert.deepEqual(ids, ["A", "B"]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("KG deterministic order ignores archived and missing-core rows before LIMIT", async () => {
  const root = createFixtureRoot();
  const db = createDb(root);
  try {
    insertChunk(db, "C", 1000, "alpha text C");
    insertChunk(db, "B", 1000, "alpha text B");
    insertChunk(db, "A", 1000, "alpha text A");
    insertChunk(db, "0-archived", 5000, "alpha archived");
    insertConfidence(db, "A", "alpha match");
    insertConfidence(db, "B", "alpha match");
    insertConfidence(db, "C", "alpha match");
    insertConfidence(db, "0-archived", "alpha archived", 1);
    insertConfidence(db, "00-missing", "alpha missing");
    const { ids } = await collectIds(db, { ftsTopK: 2 });
    assert.deepEqual(ids, ["A", "B"]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("KG deterministic order sorts NULL updated_at after numeric timestamps and ties by id", async () => {
  const root = createFixtureRoot();
  const db = createDb(root);
  try {
    insertChunk(db, "B", 1000, "alpha text B");
    insertChunk(db, "A", 1000, "alpha text A");
    insertChunk(db, "D", null, "alpha text D");
    insertChunk(db, "C", null, "alpha text C");
    for (const id of ["A", "B", "C", "D"]) insertConfidence(db, id, "alpha match");
    const { ids } = await collectIds(db, { ftsTopK: 4 });
    assert.deepEqual(ids, ["A", "B", "C", "D"]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("KG deterministic order matches SQLite control ordering for special text ids", async () => {
  const root = createFixtureRoot();
  const db = createDb(root);
  try {
    for (const id of ["alpha", "Alpha", "雪", "quote'", "slash\\", "space id"]) {
      insertChunk(db, id, 1000, `alpha text ${id}`);
      insertConfidence(db, id, "alpha special");
    }
    const patterns = ["%alpha%"];
    const expectedIds = controlIds(db, DETERMINISTIC_SQL, patterns, 10);
    const { ids } = await collectIds(db, { ftsTopK: 10 });
    assert.deepEqual(ids, expectedIds);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("KG deterministic SQL differs from baseline ORDER BY updated_at DESC on a tie fixture", async () => {
  const root = createFixtureRoot();
  const db = createDb(root);
  try {
    for (const id of ["C", "B", "A"]) insertChunk(db, id, 1000, `alpha text ${id}`);
    for (const id of ["A", "B", "C"]) insertConfidence(db, id, "alpha match");
    db.exec("CREATE INDEX idx_chunks_updated ON chunks(updated_at DESC)");
    const baselineIds = controlIds(db, BASELINE_SQL, ["%alpha%"], 2);
    const deterministicIds = controlIds(db, DETERMINISTIC_SQL, ["%alpha%"], 2);
    assert.deepEqual(deterministicIds, ["A", "B"]);
    assert.notDeepEqual(baselineIds, deterministicIds);
    const { ids } = await collectIds(db, { ftsTopK: 2 });
    assert.deepEqual(ids, deterministicIds);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
