import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectKgCandidates, compareKgCandidateRelevance } from "../lib/recall/hybrid/channels/kg.js";
import { createCandidateCounts, createHybridDebug, createHybridWarnings } from "../lib/recall/hybrid/debug.js";
import { fuseChannels } from "../lib/recall/hybrid/fusion.js";

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
  enrichLexicalCandidate = row => ({
    ...row,
    token_coverage: 1,
    exact_bonus: 0,
    structured_match_bonus: 0,
  }),
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
    enrichLexicalCandidate,
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

test("KG deterministic order uses id ASC for equal updated_at with opposite insert orders", async () => {
  const root = createFixtureRoot();
  const db = createDb(root);
  try {
    for (const id of ["C", "B", "A"]) insertChunk(db, id, 1000, `alpha text ${id}`);
    for (const id of ["A", "B", "C"]) insertConfidence(db, id, "alpha match");
    const { ids, ctx } = await collectIds(db, { ftsTopK: 2 });
    assert.deepEqual(ids, ["A", "B"]);
    assert.equal(ctx.candidateCounts.kg_raw, 3);
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

test("KG relevance ordering happens before ftsTopK truncation and feeds RRF rank", async () => {
  const root = createFixtureRoot();
  const db = createDb(root);
  try {
    insertChunk(db, "new-low-1", 3000, "alpha low one");
    insertChunk(db, "new-low-2", 2000, "alpha low two");
    insertChunk(db, "old-best", 1000, "alpha best");
    for (const id of ["new-low-1", "new-low-2", "old-best"]) insertConfidence(db, id, "alpha match");
    const relevance = new Map([
      ["new-low-1", { lexical_signal_score: 0.2, structured_match_bonus: 0.1, exact_bonus: 0, token_coverage: 0.2, semantic_score: 0.9 }],
      ["new-low-2", { lexical_signal_score: 0.1, structured_match_bonus: 0.1, exact_bonus: 0, token_coverage: 0.1, semantic_score: 0.9 }],
      ["old-best", { lexical_signal_score: 0.95, structured_match_bonus: 0, exact_bonus: 0, token_coverage: 0.95, semantic_score: 0.1 }],
    ]);
    const { ids, ctx } = await collectIds(db, {
      ftsTopK: 2,
      enrichLexicalCandidate: row => ({ ...row, ...relevance.get(row.id) }),
    });
    assert.equal(ctx.candidateCounts.kg_raw, 3);
    assert.equal(ctx.candidateCounts.kg_after_conf_filter, 2);
    assert.deepEqual(ids, ["old-best", "new-low-1"]);

    const { fused } = fuseChannels({ kg: ctx.channels.kg }, {
      rrfK: 60,
      nowSec: 1710000000,
      rankingConfig: {},
    });
    assert.equal(fused.find(item => item.id === "old-best").rrfScore > fused.find(item => item.id === "new-low-1").rrfScore, true);
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

test("KG deterministic id tie-break is stable for special text ids", async () => {
  const root = createFixtureRoot();
  const db = createDb(root);
  try {
    for (const id of ["alpha", "Alpha", "雪", "quote'", "slash\\", "space id"]) {
      insertChunk(db, id, 1000, `alpha text ${id}`);
      insertConfidence(db, id, "alpha special");
    }
    const { ids } = await collectIds(db, { ftsTopK: 10 });
    assert.deepEqual(ids, ["Alpha", "alpha", "quote'", "slash\\", "space id", "雪"]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("KG comparator follows relevance fields before recency and id", () => {
  const candidate = (overrides = {}) => ({
    id: "z",
    lexical_signal_score: 0,
    structured_match_bonus: 0,
    exact_bonus: 0,
    token_coverage: 0,
    semantic_score: 0,
    created_at: 100,
    ...overrides,
  });
  const priorityPairs = [
    [{ lexical_signal_score: 0.9, created_at: 1 }, { lexical_signal_score: 0.8, created_at: 999 }],
    [{ structured_match_bonus: 0.9 }, { structured_match_bonus: 0.8 }],
    [{ exact_bonus: 0.9 }, { exact_bonus: 0.8 }],
    [{ token_coverage: 0.9 }, { token_coverage: 0.8 }],
    [{ semantic_score: 0.9 }, { semantic_score: 0.8 }],
    [{ created_at: 200 }, { created_at: 100 }],
    [{ id: "a" }, { id: "b" }],
  ];
  for (const [higher, lower] of priorityPairs) {
    assert.equal(compareKgCandidateRelevance(candidate(higher), candidate(lower)) < 0, true);
  }
  const invalidComparison = compareKgCandidateRelevance(
    candidate({ lexical_signal_score: Number.NaN, id: "a" }),
    candidate({ lexical_signal_score: 0, id: "b" }),
  );
  assert.equal(Number.isFinite(invalidComparison), true);
  assert.equal(invalidComparison < 0, true);
});

test("KG relevance comparator is independent of updated_at row order", async () => {
  const root = createFixtureRoot();
  const db = createDb(root);
  try {
    insertChunk(db, "recent-low", 3000, "alpha recent");
    insertChunk(db, "old-high", 1000, "alpha old");
    insertConfidence(db, "recent-low", "alpha recent");
    insertConfidence(db, "old-high", "alpha old");
    db.exec("CREATE INDEX idx_chunks_updated ON chunks(updated_at DESC)");
    const { ids } = await collectIds(db, {
      ftsTopK: 2,
      enrichLexicalCandidate: row => ({
        ...row,
        lexical_signal_score: row.id === "old-high" ? 0.9 : 0.1,
        structured_match_bonus: 0,
        exact_bonus: 0,
        token_coverage: row.id === "old-high" ? 0.9 : 0.1,
        semantic_score: 0,
      }),
    });
    assert.deepEqual(ids, ["old-high", "recent-low"]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
