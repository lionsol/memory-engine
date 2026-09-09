import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { createIsolatedHybridDbAccessScope } from "../lib/recall/hybrid/db-access.js";
import { hybridSearch } from "../lib/recall/hybrid-search.js";

const IDS = Object.freeze({
  a: "canonical-memory-a-full-id",
  b: "canonical-memory-b-full-id",
  c: "canonical-memory-c-full-id",
  d: "canonical-memory-d-full-id",
  archived: "canonical-memory-archived-id",
  missing: "canonical-memory-missing-id",
});

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-offline-rerank-profile-"));
  const coreDbPath = join(root, "core.sqlite");
  const engineDbPath = join(root, "engine.sqlite");
  const core = new Database(coreDbPath);
  core.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT,
      text TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE chunks_fts USING fts5(id, text);
  `);
  const insertCore = core.prepare(`
    INSERT INTO chunks (id, path, source, start_line, end_line, hash, text, updated_at)
    VALUES (?, ?, 'memory', 1, 1, ?, ?, ?)
  `);
  for (const [key, text, updatedAt] of [
    ["a", "CANONICAL FULL TEXT A - must stay internal", 10],
    ["b", "CANONICAL FULL TEXT B - must stay internal", 9],
    ["c", "CANONICAL FULL TEXT C - must stay internal", 8],
    ["d", "CANONICAL FULL TEXT D - must stay internal", 7],
    ["archived", "CANONICAL ARCHIVED FULL TEXT", 6],
  ]) {
    insertCore.run(IDS[key], `memory/${key}.md`, `hash-${key}`, text, updatedAt);
  }
  const insertFts = core.prepare("INSERT INTO chunks_fts (id, text) VALUES (?, ?)");
  for (const key of ["a", "b", "c", "d", "archived"]) {
    insertFts.run(IDS[key], `preview ${key}`);
  }
  core.close();

  const engine = new Database(engineDbPath);
  engine.exec(`
    CREATE TABLE memory_confidence (
      chunk_id TEXT PRIMARY KEY,
      initial_confidence REAL NOT NULL,
      confidence REAL NOT NULL,
      last_confidence_update INTEGER NOT NULL,
      base_tau REAL NOT NULL,
      hit_count INTEGER NOT NULL,
      is_protected INTEGER NOT NULL,
      conflict_flag INTEGER NOT NULL,
      category TEXT NOT NULL,
      is_archived INTEGER NOT NULL,
      kg_data TEXT
    );
  `);
  const insertEngine = engine.prepare(`
    INSERT INTO memory_confidence (
      chunk_id, initial_confidence, confidence, last_confidence_update,
      base_tau, hit_count, is_protected, conflict_flag, category, is_archived, kg_data
    ) VALUES (?, 0.99, 0.99, 10, 7, 1, 0, 0, 'project', ?, NULL)
  `);
  for (const key of ["a", "b", "c", "d"]) insertEngine.run(IDS[key], 0);
  insertEngine.run(IDS.archived, 1);
  engine.close();
  return { root, coreDbPath, engineDbPath };
}

function createRuntime(fixture, entries, overrides = {}) {
  return {
    withHybridDbAccessScope: createIsolatedHybridDbAccessScope(fixture),
    calcRealtimeConf: row => Number(row.confidence || 0),
    getMemorySearchManager: async () => ({
      manager: {
        search: async () => ({ entries }),
      },
    }),
    ...overrides,
  };
}

function vectorEntries() {
  return [
    { id: IDS.a, text: "preview a", similarity: 0.9 },
    { id: IDS.b, text: "preview b", similarity: 0.8 },
    { id: IDS.c, text: "preview c", similarity: 0.7 },
    { id: IDS.d, text: "preview d", similarity: 0.6 },
    { id: IDS.archived, text: "preview archived", similarity: 0.99 },
    { id: IDS.missing, text: "preview missing", similarity: 0.95 },
  ];
}

function profile(adapter, overrides = {}) {
  return {
    candidateDepth: 5,
    maxCodePointsPerCandidate: 200,
    maxTotalCodePoints: 2_000,
    deadlineMs: 100,
    executeRerank: true,
    adapter,
    ...overrides,
  };
}

test("without the internal profile, Hybrid keeps the existing result and debug shape", async () => {
  const fixture = createFixture();
  try {
    const runtime = createRuntime(fixture, vectorEntries());
    const first = await hybridSearch("offline-profile-query", { topK: 3 }, runtime);
    const second = await hybridSearch("offline-profile-query", { topK: 3 }, runtime);

    assert.deepEqual(first.results, second.results);
    assert.equal(first.debug.offline_rerank, undefined);
    assert.deepEqual(first.results.map(result => result.memory_id), [IDS.a, IDS.b]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("offline profile uses candidateDepth, excludes archived/missing candidates, and lets the fourth valid candidate enter topK", async () => {
  const fixture = createFixture();
  const adapterTexts = [];
  try {
    const runtime = createRuntime(fixture, vectorEntries(), {
      offlineRerankProfile: profile(async (_query, texts) => {
        adapterTexts.push(...texts);
        return {
          scores: texts.map((text, index) => ({
            index,
            score: text.includes("FULL TEXT D") ? 1 : 0.1 - index / 100,
          })),
          identity: "fake-offline-reranker",
          usage: { total_tokens: texts.length },
        };
      }),
    });
    const result = await hybridSearch("offline-profile-query", { topK: 3 }, runtime);

    assert.deepEqual(adapterTexts, [
      "CANONICAL FULL TEXT A - must stay internal",
      "CANONICAL FULL TEXT B - must stay internal",
      "CANONICAL FULL TEXT C - must stay internal",
      "CANONICAL FULL TEXT D - must stay internal",
    ]);
    assert.deepEqual(result.results.map(item => item.memory_id), [IDS.d, IDS.a, IDS.b]);
    assert.equal(result.results.some(item => item.memory_id === IDS.archived), false);
    assert.equal(result.results.some(item => item.memory_id === IDS.missing), false);
    assert.equal(result.results.some(item => item.text.includes("CANONICAL FULL TEXT")), false);
    assert.equal(JSON.stringify(result).includes("CANONICAL FULL TEXT D"), false);
    const {
      projection_metadata: projectionMetadata,
      projection_total_code_points: projectionTotalCodePoints,
      ...offlineDebug
    } = result.debug.offline_rerank;
    assert.deepEqual(offlineDebug, {
      profile: "q3_offline_canonical_rerank_v1",
      candidate_depth: 5,
      valid_candidate_count: 4,
      excluded_count: 1,
      excluded_reasons: { core_not_found: 1 },
      rerank_status: "applied",
      rerank_reason: "complete",
      scores: {
        [IDS.a]: 0.1,
        [IDS.b]: 0.1 - 1 / 100,
        [IDS.c]: 0.1 - 2 / 100,
        [IDS.d]: 1,
      },
      usage: { total_tokens: 4 },
      adapter_identity: "fake-offline-reranker",
      rerank_elapsed_ms: result.debug.offline_rerank.rerank_elapsed_ms,
    });
    assert.equal(Number.isFinite(result.debug.offline_rerank.rerank_elapsed_ms), true);
    assert.deepEqual(projectionMetadata.map(item => item.id), [
      IDS.a,
      IDS.b,
      IDS.c,
      IDS.d,
    ]);
    assert.equal(projectionTotalCodePoints > 0, true);
    assert.equal(result.results[0].final_score < result.results[1].final_score, true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("control and rerank use the same valid canonical candidate set", async () => {
  const fixture = createFixture();
  try {
    const controlRuntime = createRuntime(fixture, vectorEntries(), {
      offlineRerankProfile: profile(() => {
        throw new Error("disabled profile must not call adapter");
      }, { executeRerank: false }),
    });
    const control = await hybridSearch("offline-profile-query", { topK: 3 }, controlRuntime);
    assert.deepEqual(control.results.map(item => item.memory_id), [IDS.a, IDS.b, IDS.c]);
    assert.equal(control.debug.offline_rerank.valid_candidate_count, 4);
    assert.equal(control.debug.offline_rerank.excluded_count, 1);
    assert.equal(control.debug.offline_rerank.rerank_reason, "profile_rerank_disabled");

    const rerankRuntime = createRuntime(fixture, vectorEntries(), {
      offlineRerankProfile: profile(async (_query, texts) => ({
        scores: texts.map((_, index) => ({ index, score: index === 3 ? 9 : 1 })),
      })),
    });
    const reranked = await hybridSearch("offline-profile-query", { topK: 3 }, rerankRuntime);
    assert.equal(reranked.debug.offline_rerank.valid_candidate_count, 4);
    assert.equal(reranked.debug.offline_rerank.excluded_count, control.debug.offline_rerank.excluded_count);
    assert.deepEqual(reranked.results.map(item => item.memory_id), [IDS.d, IDS.a, IDS.b]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("invalid response and timeout fall back to the same-profile control order", async () => {
  const fixture = createFixture();
  try {
    const invalid = await hybridSearch("offline-profile-query", { topK: 3 }, createRuntime(fixture, vectorEntries(), {
      offlineRerankProfile: profile(async () => ({
        scores: [{ index: 0, score: 1 }],
        usage: { total_tokens: 7 },
      })),
    }));
    assert.equal(invalid.debug.offline_rerank.rerank_reason, "invalid_response");
    assert.deepEqual(invalid.results.map(item => item.memory_id), [IDS.a, IDS.b, IDS.c]);

    let resolveLate;
    const late = new Promise(resolve => { resolveLate = resolve; });
    const timeout = await hybridSearch("offline-profile-query", { topK: 3 }, createRuntime(fixture, vectorEntries(), {
      offlineRerankProfile: profile(async () => late, { deadlineMs: 10 }),
    }));
    assert.equal(timeout.debug.offline_rerank.rerank_reason, "timeout");
    assert.deepEqual(timeout.results.map(item => item.memory_id), [IDS.a, IDS.b, IDS.c]);
    resolveLate({ scores: [{ index: 0, score: 9 }, { index: 1, score: 8 }, { index: 2, score: 7 }, { index: 3, score: 6 }] });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(timeout.results.map(item => item.memory_id), [IDS.a, IDS.b, IDS.c]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("invalid profile parameters reject before opening the database", async () => {
  const fixture = createFixture();
  let adapterCalls = 0;
  try {
    await assert.rejects(
      () => hybridSearch("offline-profile-query", { topK: 3 }, createRuntime(fixture, vectorEntries(), {
        offlineRerankProfile: profile(async () => {
          adapterCalls += 1;
          return { scores: [] };
        }, { candidateDepth: 2 }),
      })),
      /candidate_depth_must_be_integer_between_top_k_and_50/,
    );
    assert.equal(adapterCalls, 0);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("control still validates the text budget before any adapter call", async () => {
  const fixture = createFixture();
  let adapterCalls = 0;
  try {
    await assert.rejects(
      () => hybridSearch("offline-profile-query", { topK: 3 }, createRuntime(fixture, vectorEntries(), {
        offlineRerankProfile: profile(async () => {
          adapterCalls += 1;
          return { scores: [] };
        }, { executeRerank: false, maxTotalCodePoints: 1 }),
      })),
      /canonical_rerank_text_total_code_points_exceeds_budget/,
    );
    assert.equal(adapterCalls, 0);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
