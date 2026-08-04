import test from "node:test";
import assert from "node:assert/strict";

import {
  createFtsChannelContext,
  createHybridChannelRuntime,
  createKgChannelContext,
  createRecentChannelContext,
  createVectorChannelContext,
} from "../lib/recall/hybrid/channel-runtime.js";

function createFixture() {
  const channels = {};
  const debug = {};
  const candidateCounts = {};
  const values = {
    withDb: () => "legacy",
    withCoreDb: () => "core",
    withEngineDb: () => "engine",
    getLancedbRuntime: () => "lance-runtime",
    getLancedbTable: () => "lance-table",
    getMemorySearchManager: () => "manager",
    normalizeCandidate: value => value,
    filterForRerank: () => true,
    enrichLexicalCandidate: value => value,
    inferCategoryFromChunk: () => "episodic",
    lexicalMatchScore: () => 1,
    computeRecencyBoost: () => 0,
    normalizeUnixSeconds: value => value,
    toFiniteNumber: value => Number(value),
    generateEmbedding: () => [1],
    toDebugErrorMessage: error => String(error?.message || error),
    warnHybridSearchOnce() {},
    warnVectorChannelOnce() {},
  };

  const runtime = createHybridChannelRuntime({
    dataAccess: {
      withDb: values.withDb,
      withCoreDb: values.withCoreDb,
      withEngineDb: values.withEngineDb,
      confidenceMap: new Map([["id", { confidence: 0.8 }]]),
      chunkMetaMap: new Map([["id", { path: "memory/a.md" }]]),
      getLancedbRuntime: values.getLancedbRuntime,
      getLancedbTable: values.getLancedbTable,
      getMemorySearchManager: values.getMemorySearchManager,
    },
    query: {
      normalizedQuery: "memory engine",
      strippedQuery: "memory-engine",
      fallbackFtsQuery: "memory OR engine",
      fallbackRerankTerms: ["memory", "engine"],
      queryTerms: ["memory", "engine"],
      exactFragments: ["memory-engine"],
    },
    limits: {
      likePatternTopN: 8,
      ftsTopK: 20,
      likeTopK: 30,
      recentTopK: 120,
      recentRerankTopK: 20,
      recentFallbackTopK: 20,
      vectorTopK: 30,
      vectorReadyTimeoutMs: 400,
    },
    rankingPolicy: {
      nowSec: 1_700_000_000,
      rankingConfig: { rrfK: 60 },
      categoryMap: { episodic: {} },
      normalizeCandidate: values.normalizeCandidate,
      filterForRerank: values.filterForRerank,
      enrichLexicalCandidate: values.enrichLexicalCandidate,
      inferCategoryFromChunk: values.inferCategoryFromChunk,
      lexicalMatchScore: values.lexicalMatchScore,
      computeRecencyBoost: values.computeRecencyBoost,
      normalizeUnixSeconds: values.normalizeUnixSeconds,
      toFiniteNumber: values.toFiniteNumber,
    },
    accessPolicy: {
      ftsAccessMode: "isolated",
      kgAccessMode: "isolated",
      kgIsolationRequested: true,
      kgIsolationFallbackReason: null,
      kgFailClosedDecision: { mode: "legacy_fallback" },
      recentAccessMode: "isolated",
      recentIsolationRequested: true,
      recentIsolationFallbackReason: null,
      recentFailClosedDecision: { mode: "legacy_fallback" },
      recentTextIdInvariant: { safe: true },
      recentIsolationTopology: { safe: true },
      recentCanaryDecision: { mode: "off" },
    },
    vectorRuntime: {
      generateEmbedding: values.generateEmbedding,
      cfg: { memory: {} },
    },
    telemetry: {
      toDebugErrorMessage: values.toDebugErrorMessage,
      warnHybridSearchOnce: values.warnHybridSearchOnce,
      warnVectorChannelOnce: values.warnVectorChannelOnce,
    },
    state: { channels, debug, candidateCounts },
  });

  return { runtime, channels, debug, candidateCounts, values };
}

test("hybrid channel runtime freezes immutable groups but keeps request state mutable", () => {
  const { runtime, channels } = createFixture();

  for (const name of [
    "dataAccess",
    "query",
    "limits",
    "rankingPolicy",
    "accessPolicy",
    "vectorRuntime",
    "telemetry",
  ]) {
    assert.equal(Object.isFrozen(runtime[name]), true, name);
  }
  assert.equal(Object.isFrozen(runtime), true);
  assert.equal(Object.isFrozen(runtime.state), false);

  channels.vector = [{ id: "v1" }];
  assert.equal(runtime.state.channels.vector.length, 1);
});

test("collector views expose only their channel dependency subset", () => {
  const { runtime, values } = createFixture();
  const fts = createFtsChannelContext(runtime);
  const kg = createKgChannelContext(runtime);
  const vector = createVectorChannelContext(runtime, { shouldSkipVector: true });
  const recent = createRecentChannelContext(runtime, { ftsIsEmpty: true });

  assert.equal(fts.withCoreDb, values.withCoreDb);
  assert.deepEqual(fts.fallbackRerankTerms, ["memory", "engine"]);
  assert.equal(Object.hasOwn(fts, "withEngineDb"), false);
  assert.equal(Object.hasOwn(fts, "getLancedbRuntimeRuntime"), false);

  assert.equal(kg.withEngineDb, values.withEngineDb);
  assert.equal(Object.hasOwn(kg, "vectorTopK"), false);
  assert.equal(Object.hasOwn(kg, "recentCanaryDecision"), false);

  assert.equal(vector.getLancedbRuntimeRuntime, values.getLancedbRuntime);
  assert.equal(vector.shouldSkipVector, true);
  assert.equal(Object.hasOwn(vector, "withDb"), false);
  assert.equal(Object.hasOwn(vector, "kgAccessMode"), false);

  assert.equal(recent.withCoreDb, values.withCoreDb);
  assert.equal(recent.ftsIsEmpty, true);
  assert.equal(Object.hasOwn(recent, "getLancedbTableRuntime"), false);
  assert.equal(Object.hasOwn(recent, "kgFailClosedDecision"), false);
});

test("collector views share one request state and derive vector presence lazily", () => {
  const { runtime, channels, debug, candidateCounts } = createFixture();
  const fts = createFtsChannelContext(runtime);
  const recent = createRecentChannelContext(runtime, { ftsIsEmpty: false });

  assert.equal(fts.channels, channels);
  assert.equal(fts.debug, debug);
  assert.equal(fts.candidateCounts, candidateCounts);
  assert.equal(recent.channels, channels);
  assert.equal(recent.uniqueVectorChannels(), false);

  channels.vector = [{ id: "vector-1" }];
  assert.equal(recent.uniqueVectorChannels(), true);
});
