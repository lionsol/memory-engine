import test from "node:test";
import assert from "node:assert/strict";

import { hybridSearch } from "../lib/recall/hybrid-search.js";

function makeRow(id, {
  text = `query ${id} body`,
  path = `memory/smart-add/${id}.md`,
  updated_at = 1000,
  confidence = 0.82,
  category = "raw_log",
  is_archived = 0,
} = {}) {
  return {
    id,
    chunk_id: id,
    text,
    path,
    updated_at,
    confidence,
    last_confidence_update: 0,
    base_tau: 7,
    hit_count: 3,
    is_protected: 0,
    conflict_flag: 0,
    category,
    is_archived,
  };
}

function createHybridRuntime({
  legacyRecentIds = ["legacy-1"],
  isolatedRecentIds = ["legacy-1"],
  ftsIds = ["fts-1"],
  provider = null,
  providerScope = null,
  isolatedRecentCapability = true,
  failIsolatedCore = false,
} = {}) {
  const allIds = [...new Set([...legacyRecentIds, ...isolatedRecentIds, ...ftsIds])];
  const confidenceRows = allIds.map((id, index) => makeRow(id, { updated_at: 1000 - index }));
  const chunkRows = confidenceRows.map(row => ({ id: row.id, path: row.path, updated_at: row.updated_at }));
  const rowById = new Map(confidenceRows.map(row => [row.id, row]));
  const queryLog = [];

  function buildDb(name) {
    return {
      readonly: true,
      prepare(sql) {
        const query = String(sql);
        return {
          all(...args) {
            queryLog.push({ name, query, args });
            if (query.includes("PRAGMA database_list")) return [{ name: "main" }];
            if (query.includes("SELECT chunk_id, confidence") && query.includes("FROM memory_confidence") && !query.includes("json_each")) {
              return confidenceRows.map(row => ({
                chunk_id: row.id,
                confidence: row.confidence,
                last_confidence_update: row.last_confidence_update,
                base_tau: row.base_tau,
                hit_count: row.hit_count,
                is_protected: row.is_protected,
                conflict_flag: row.conflict_flag,
                category: row.category,
                is_archived: row.is_archived,
              }));
            }
            if (query.includes("SELECT id, path, updated_at FROM chunks")) {
              return chunkRows;
            }
            if (query.includes("chunks_fts")) {
              return ftsIds.map(id => rowById.get(id));
            }
            if (query.includes("SELECT chunk_id") && query.includes("COALESCE(is_archived, 0) = 1")) {
              return [];
            }
            if (query.includes("FROM chunks c") && query.includes("LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id")) {
              return legacyRecentIds.map(id => rowById.get(id));
            }
            if (query.includes("FROM chunks c")) {
              if (failIsolatedCore) throw new Error("isolated core failure");
              return isolatedRecentIds.map(id => rowById.get(id));
            }
            if (query.includes("json_each")) {
              const selectedIds = JSON.parse(String(args[0] || "[]"));
              return selectedIds.map(id => rowById.get(id)).filter(Boolean).map(row => ({
                chunk_id: row.id,
                confidence: row.confidence,
                last_confidence_update: row.last_confidence_update,
                base_tau: row.base_tau,
                hit_count: row.hit_count,
                is_protected: row.is_protected,
                conflict_flag: row.conflict_flag,
                category: row.category,
                is_archived: row.is_archived,
              }));
            }
            return [];
          },
          get(...args) {
            queryLog.push({ name, query, args, get: true });
            if (query.includes("PRAGMA data_version")) return { data_version: 1 };
            return null;
          },
        };
      },
    };
  }

  const legacyDb = buildDb("legacy");
  const coreDb = buildDb("core");
  const engineDb = buildDb("engine");
  const access = {
    withLegacyDb: run => run(legacyDb),
    withCoreDb: run => run(coreDb),
    withEngineDb: run => run(engineDb),
    capabilities: { isolatedRecent: isolatedRecentCapability },
  };

  const runtime = {
    withHybridDbAccessScope: async run => run(access),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getMemorySearchManager: async () => ({ manager: { search: async () => ({ entries: [] }) } }),
    recentCanaryProvider: provider,
    recentCanaryContext: providerScope,
  };
  return { runtime, queryLog };
}

function stripCanaryDebug(debug = {}) {
  const next = { ...debug };
  for (const key of Object.keys(next)) {
    if (key.startsWith("recent_canary_")) delete next[key];
  }
  if (Number.isFinite(next.vector_ms)) next.vector_ms = 0;
  return next;
}

test("hybrid recent canary defaults off and explicit off matches default behavior", async () => {
  const base = createHybridRuntime({
    legacyRecentIds: ["legacy-1"],
    isolatedRecentIds: ["legacy-1", "isolated-1"],
    provider: null,
  });
  const off = createHybridRuntime({
    legacyRecentIds: ["legacy-1"],
    isolatedRecentIds: ["legacy-1", "isolated-1"],
    provider: () => ({ mode: "off", scopeClass: "internal" }),
    providerScope: { scopeClass: "internal", sampleKey: "sample-1" },
  });

  const baseResult = await hybridSearch("query", { topK: 5 }, base.runtime);
  const offResult = await hybridSearch("query", { topK: 5 }, off.runtime);

  assert.equal(baseResult.debug.recent_canary_mode, "off");
  assert.equal(baseResult.debug.recent_canary_shadow_executed, false);
  assert.equal(offResult.debug.recent_canary_mode, "off");
  assert.deepEqual(baseResult.results, offResult.results);
  assert.deepEqual(baseResult.channels, offResult.channels);
  assert.deepEqual(baseResult.channel_sizes, offResult.channel_sizes);
  assert.deepEqual(stripCanaryDebug(baseResult.debug), stripCanaryDebug(offResult.debug));
});

test("hybrid recent canary provider errors fail closed without shadow queries", async () => {
  const fixture = createHybridRuntime({
    provider() {
      throw new Error("provider failure");
    },
    providerScope: { scopeClass: "internal", sampleKey: "sample-1" },
  });
  const result = await hybridSearch("query", { topK: 5 }, fixture.runtime);
  assert.equal(result.debug.recent_canary_mode, "off");
  assert.equal(result.debug.recent_canary_policy_error, true);
  assert.equal(result.debug.recent_canary_shadow_executed, false);
  assert.equal(result.debug.recent_canary_isolated_core_query_count ?? 0, 0);
  assert.equal(result.debug.recent_canary_isolated_engine_query_count ?? 0, 0);
});

test("hybrid recent canary shadow serves legacy results only and keeps isolated-only ids out of final results/debug", async () => {
  const offFixture = createHybridRuntime({
    legacyRecentIds: ["legacy-1"],
    isolatedRecentIds: ["legacy-1", "isolated-1"],
    provider: () => ({ mode: "off", scopeClass: "internal" }),
    providerScope: { scopeClass: "internal", sampleKey: "sample-1" },
    isolatedRecentCapability: false,
  });
  const shadowFixture = createHybridRuntime({
    legacyRecentIds: ["legacy-1"],
    isolatedRecentIds: ["legacy-1", "isolated-1"],
    provider: () => ({ mode: "shadow", scopeClass: "internal", sampleRateBasisPoints: 10000 }),
    providerScope: { scopeClass: "internal", sampleKey: "sample-1" },
  });

  const offResult = await hybridSearch("query", { topK: 5 }, offFixture.runtime);
  const shadowResult = await hybridSearch("query", { topK: 5 }, shadowFixture.runtime);

  assert.equal(shadowResult.debug.recent_canary_mode, "shadow");
  assert.equal(shadowResult.debug.recent_canary_shadow_executed, true);
  assert.equal(shadowResult.debug.recent_canary_served_mode, "legacy");
  assert.equal(shadowResult.debug.recent_canary_classification, "mismatch_counts");
  assert.deepEqual(shadowResult.results, offResult.results);
  assert.deepEqual(shadowResult.channels, offResult.channels);
  assert.deepEqual(shadowResult.channel_sizes, offResult.channel_sizes);
  assert.equal(JSON.stringify(shadowResult.results).includes("isolated-1"), false);
  assert.equal(JSON.stringify(shadowResult.debug).includes("isolated-1"), false);
  assert.equal(JSON.stringify(shadowResult.debug).includes("sample-1"), false);
  assert.equal(shadowResult.debug.recent_canary_legacy_core_query_count >= 1, true);
  assert.equal(shadowResult.debug.recent_canary_legacy_engine_query_count >= 1, true);
  assert.equal(shadowResult.debug.recent_canary_isolated_core_query_count >= 1, true);
  assert.equal(shadowResult.debug.recent_canary_isolated_engine_query_count >= 1, true);
});

test("hybrid recent canary shadow returns legacy empty result even when isolated finds candidates", async () => {
  const shadowFixture = createHybridRuntime({
    legacyRecentIds: [],
    isolatedRecentIds: ["isolated-1"],
    ftsIds: [],
    provider: () => ({ mode: "shadow", scopeClass: "internal", sampleRateBasisPoints: 10000 }),
    providerScope: { scopeClass: "internal", sampleKey: "sample-1" },
  });
  const result = await hybridSearch("query", { topK: 5 }, shadowFixture.runtime);
  assert.deepEqual(result.results, []);
  assert.equal(result.pool, 0);
  assert.equal(result.debug.recent_canary_served_mode, "legacy");
  assert.equal(result.debug.recent_canary_classification, "mismatch_counts");
});

test("hybrid recent canary shadow isolates isolated SQL errors from served legacy results", async () => {
  const shadowFixture = createHybridRuntime({
    legacyRecentIds: ["legacy-1"],
    isolatedRecentIds: ["legacy-1"],
    provider: () => ({ mode: "shadow", scopeClass: "internal", sampleRateBasisPoints: 10000 }),
    providerScope: { scopeClass: "internal", sampleKey: "sample-1" },
    failIsolatedCore: true,
  });
  const result = await hybridSearch("query", { topK: 5 }, shadowFixture.runtime);
  assert.equal(result.results.some(item => item.id === "legacy-1".slice(0, 16)), true);
  assert.equal(result.debug.recent_canary_classification, "isolated_error");
  assert.equal(result.debug.recent_canary_isolated_error, true);
  assert.equal(result.debug.recent_canary_served_mode, "legacy");
});
