import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { createIsolatedHybridDbAccessScope } from "../lib/recall/hybrid/db-access.js";
import {
  MEMORY_EXPLICIT_RERANK_CONFIG_INVALID,
} from "../lib/recall/hybrid/explicit-search-rerank-profile.js";
import {
  createMemoryEngineExecute,
  createMemoryEngineSearchExecute,
} from "../lib/tools/memory-engine-actions.js";

function createBaseRuntime(overrides = {}) {
  let lancedbCalls = 0;
  const runtime = {
    api: { config: {} },
    autoRouteCategory: () => "raw_log",
    dateStrInTimeZone: () => "2026-09-12",
    SMART_ADD_TIME_ZONE: "Asia/Shanghai",
    resolve: (...parts) => parts.join("/"),
    WORKSPACE: "/tmp/ws",
    SMART_ADD_DIR: "memory/smart-add",
    buildSmartAddFingerprint: () => "fingerprint",
    appendSmartAdd: () => ({ appended: true }),
    syncIndexIfNeeded: async () => ({}),
    catParams: () => ({ conf: 0.5, tau: 7 }),
    withDb: fn => fn({
      prepare: () => ({ all: () => [], get: () => null, run: () => ({}) }),
      transaction: inner => inner,
    }),
    getLancedbTable: () => {
      lancedbCalls += 1;
      return null;
    },
    generateEmbedding: async () => [],
    recordMemoryEvent: () => {},
    getMemorySearchManager: async () => ({ manager: null }),
    calcRealtimeConf: ({ confidence = 0 }) => Number(confidence || 0),
    existsSync: () => false,
    readFileSync: () => "",
    KG_PATH: "/tmp/ws/knowledge-graph.json",
    batchReinforce: () => 0,
    CATEGORY_MAP: {},
    calcTau: () => 0,
    ...overrides,
  };
  Object.defineProperty(runtime, "lancedbCalls", {
    get: () => lancedbCalls,
  });
  return runtime;
}

function trustedPolicy(overrides = {}) {
  return {
    enabled: true,
    mode: "rerank",
    candidateDepth: 3,
    maxCodePointsPerCandidate: 8000,
    maxTotalCodePoints: 400000,
    deadlineMs: 100,
    adapterIdentity: { provider: "fake", model: "action-r3", revision: null },
    adapter: async () => ({ scores: [] }),
    ...overrides,
  };
}

function searchResult(debug = {}) {
  return {
    pool: 2,
    channels: ["vector"],
    channel_sizes: { vector: 2 },
    debug,
    results: [
      {
        id: "bounded-id",
        memory_id: "full-memory-id-001",
        canonical_id: "cmem:core:full-memory-id-001",
        text: "preview",
      },
    ],
  };
}

function createHybridFixture() {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-explicit-search-r3-"));
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
  const insertFts = core.prepare("INSERT INTO chunks_fts (id, text) VALUES (?, ?)");
  const canonicalTexts = new Map();
  for (const [id, text, similarity] of [
    ["explicit-a", `CANONICAL FULL TEXT explicit-a ${"a".repeat(300)}`, 0.9],
    ["explicit-b", `CANONICAL FULL TEXT explicit-b ${"b".repeat(300)}`, 0.8],
    ["explicit-outside", `CANONICAL FULL TEXT explicit-outside ${"o".repeat(300)}`, 0.1],
  ]) {
    canonicalTexts.set(id, text);
    insertCore.run(id, `memory/${id}.md`, `hash-${id}`, text, Math.round(similarity * 100));
    insertFts.run(id, `preview ${id}`);
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
    ) VALUES (?, 0.99, 0.99, 10, 7, 1, 0, 0, 'project', 0, NULL)
  `);
  for (const id of ["explicit-a", "explicit-b", "explicit-outside"]) insertEngine.run(id);
  engine.close();

  return {
    root,
    coreDbPath,
    engineDbPath,
    entries: [
      { id: "explicit-a", text: "preview-a", similarity: 0.9 },
      { id: "explicit-b", text: "preview-b", similarity: 0.8 },
      { id: "explicit-outside", text: "preview-outside", similarity: 0.1 },
    ],
    canonicalTexts,
  };
}

test("absent and disabled trusted policy preserve the legacy path with no R3 namespace", async () => {
  for (const explicitSearchRerankPolicy of [undefined, { enabled: false, mode: "invalid" }]) {
    const calls = [];
    const runtime = createBaseRuntime({
      explicitSearchRerankPolicy,
      hybridSearch: async (text, options, hybridRuntime) => {
        calls.push({ text, options, profile: hybridRuntime.explicitSearchRerankProfile });
        return searchResult({ legacy: true });
      },
    });
    const executeAction = createMemoryEngineExecute(runtime);
    const executeSearch = createMemoryEngineSearchExecute(runtime);

    const actionResult = await executeAction("action-call", {
      action: "search",
      text: "legacy query",
      top_k: 2,
      rerank: "model-controlled",
      candidateDepth: 50,
      deadlineMs: 1,
      adapter: "not-a-function",
      provider: "wrong-provider",
      endpoint: "https://must-not-be-read",
    });
    const searchResultValue = await executeSearch("search-call", {
      query: "legacy query",
      top_k: 2,
      rerank: "model-controlled",
      candidateDepth: 1,
      deadlineMs: 1,
      adapter: "not-a-function",
      provider: "wrong-provider",
      endpoint: "https://must-not-be-read",
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].profile, undefined);
    assert.equal(calls[1].profile, undefined);
    assert.deepEqual(actionResult.debug, { legacy: true });
    assert.deepEqual(searchResultValue.results, [{
      id: "bounded-id",
      memory_id: "full-memory-id-001",
      canonical_id: "cmem:core:full-memory-id-001",
      text: "preview",
    }]);
    assert.equal(runtime.lancedbCalls, 2);
  }
});

test("both explicit search surfaces receive the same trusted R3 profile and ignore model parameters", async () => {
  const seen = [];
  let adapterCalls = 0;
  const runtime = createBaseRuntime({
    explicitSearchRerankPolicy: trustedPolicy({
      mode: "control",
      adapter: async () => {
        adapterCalls += 1;
        return { scores: [] };
      },
    }),
    hybridSearch: async (text, options, hybridRuntime) => {
      seen.push({ text, options, profile: hybridRuntime.explicitSearchRerankProfile });
      return searchResult({ explicit_search_rerank: { profile: "trusted" } });
    },
  });
  const executeAction = createMemoryEngineExecute(runtime);
  const executeSearch = createMemoryEngineSearchExecute(runtime);

  const actionResult = await executeAction("action-call", {
    action: "search",
    text: "same query",
    top_k: 2,
    mode: "rerank",
    candidateDepth: 50,
    deadlineMs: 1,
    adapter: "model-adapter",
    provider: "model-provider",
  });
  const searchResultValue = await executeSearch("search-call", {
    query: "same query",
    top_k: 2,
    mode: "control",
    candidateDepth: 1,
    deadlineMs: 60000,
    adapter: "other-model-adapter",
    provider: "other-provider",
  });

  assert.equal(adapterCalls, 0);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map(call => call.text), ["same query", "same query"]);
  assert.deepEqual(seen.map(call => call.options), [{ topK: 2 }, { topK: 2 }]);
  assert.deepEqual(seen.map(call => ({
    profile: call.profile.profile,
    mode: call.profile.mode,
    candidateDepth: call.profile.candidateDepth,
    deadlineMs: call.profile.deadlineMs,
    adapterIdentity: call.profile.adapterIdentity,
  })), [
    {
      profile: "q3_explicit_search_bounded_rerank_v1",
      mode: "control",
      candidateDepth: 3,
      deadlineMs: 100,
      adapterIdentity: { provider: "fake", model: "action-r3", revision: null },
    },
    {
      profile: "q3_explicit_search_bounded_rerank_v1",
      mode: "control",
      candidateDepth: 3,
      deadlineMs: 100,
      adapterIdentity: { provider: "fake", model: "action-r3", revision: null },
    },
  ]);
  assert.deepEqual(
    searchResultValue.results.map(item => item.memory_id),
    actionResult.results.map(item => item.memory_id),
  );
  assert.equal(actionResult.debug.explicit_search_rerank.profile, "trusted");
});

test("enabled incomplete or invalid trusted policy fails before DB search and cannot be repaired by model params", async () => {
  const invalidPolicies = [
    { enabled: true },
    trustedPolicy({ candidateDepth: 1 }),
    trustedPolicy({ maxCodePointsPerCandidate: 0 }),
    trustedPolicy({ maxTotalCodePoints: 400001 }),
    trustedPolicy({ deadlineMs: 60001 }),
    trustedPolicy({ adapterIdentity: { provider: "", model: "bad", revision: null } }),
    trustedPolicy({ adapter: null }),
  ];

  for (const explicitSearchRerankPolicy of invalidPolicies) {
    let hybridCalls = 0;
    const runtime = createBaseRuntime({
      explicitSearchRerankPolicy,
      hybridSearch: async () => {
        hybridCalls += 1;
        return searchResult();
      },
    });
    const executeSearch = createMemoryEngineSearchExecute(runtime);
    const result = await executeSearch("invalid-policy", {
      query: "invalid-policy",
      top_k: 2,
      candidateDepth: 50,
      deadlineMs: 60000,
      adapter: () => ({}),
      provider: "model-cannot-fix",
    });

    assert.deepEqual(result, {
      results: [],
      error: MEMORY_EXPLICIT_RERANK_CONFIG_INVALID,
      code: MEMORY_EXPLICIT_RERANK_CONFIG_INVALID,
    });
    assert.equal(hybridCalls, 0);
    assert.equal(runtime.lancedbCalls, 0);
  }
});

test("legacy action config errors are structured before LanceDB acquisition", async () => {
  let hybridCalls = 0;
  const runtime = createBaseRuntime({
    explicitSearchRerankPolicy: { enabled: true },
    hybridSearch: async () => {
      hybridCalls += 1;
      return searchResult();
    },
  });
  const executeAction = createMemoryEngineExecute(runtime);
  const result = await executeAction("invalid-action-policy", {
    action: "search",
    text: "invalid-action-policy",
    top_k: 2,
    candidateDepth: 50,
  });

  assert.deepEqual(result, {
    error: MEMORY_EXPLICIT_RERANK_CONFIG_INVALID,
    code: MEMORY_EXPLICIT_RERANK_CONFIG_INVALID,
  });
  assert.equal(hybridCalls, 0);
  assert.equal(runtime.lancedbCalls, 0);
});

test("dedicated and legacy search surfaces share real R3 bounded serving semantics", async () => {
  const fixture = createHybridFixture();
  const adapterTexts = [];
  try {
    const runtime = createBaseRuntime({
      withHybridDbAccessScope: createIsolatedHybridDbAccessScope(fixture),
      getMemorySearchManager: async () => ({
        manager: {
          search: async () => ({ entries: fixture.entries }),
        },
      }),
      explicitSearchRerankPolicy: trustedPolicy({
        candidateDepth: 3,
        adapter: async (_query, texts) => {
          adapterTexts.push(texts);
          return {
            scores: texts.map((text, index) => ({
              index,
              score: text.includes("explicit-b") ? 9 : 1,
            })),
            identity: { provider: "fake", model: "action-r3", revision: null },
          };
        },
      }),
    });
    const executeAction = createMemoryEngineExecute(runtime);
    const executeSearch = createMemoryEngineSearchExecute(runtime);

    const actionResult = await executeAction("action-r3", {
      action: "search",
      text: "explicit query",
      top_k: 3,
    });
    const searchResultValue = await executeSearch("search-r3", {
      query: "explicit query",
      top_k: 3,
    });

    const actionIds = actionResult.results.map(item => item.memory_id);
    const searchIds = searchResultValue.results.map(item => item.memory_id);
    assert.deepEqual(actionIds, searchIds);
    assert.deepEqual(actionIds, ["explicit-b", "explicit-a", "explicit-outside"]);
    assert.equal(actionResult.debug.explicit_search_rerank.profile, "q3_explicit_search_bounded_rerank_v1");
    assert.equal(actionResult.debug.explicit_search_rerank.canonical_pool.excluded_count, 0);
    assert.deepEqual(actionResult.debug.explicit_search_rerank.canonical_pool.excluded_reasons, {});
    assert.equal(actionResult.debug.explicit_search_rerank.final_serving.served_count, 3);
    assert.equal(actionResult.debug.explicit_search_rerank.final_serving.top_k_truncation_count, 0);
    assert.deepEqual(adapterTexts, [
      [
        fixture.canonicalTexts.get("explicit-a"),
        fixture.canonicalTexts.get("explicit-b"),
        fixture.canonicalTexts.get("explicit-outside"),
      ],
      [
        fixture.canonicalTexts.get("explicit-a"),
        fixture.canonicalTexts.get("explicit-b"),
        fixture.canonicalTexts.get("explicit-outside"),
      ],
    ]);
    for (const fullText of fixture.canonicalTexts.values()) {
      assert.equal(JSON.stringify(actionResult).includes(fullText), false);
      assert.equal(JSON.stringify(searchResultValue).includes(fullText), false);
    }
    assert.equal(actionResult.results[0].canonical_id, "cmem:core:explicit-b");
    assert.equal(searchResultValue.results[0].canonical_id, "cmem:core:explicit-b");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
