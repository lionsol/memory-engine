import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHybridSearchRuntime,
  createHybridRuntimeContext,
  normalizeHybridRuntimeContext,
  recordHybridRuntimeObservation,
} from "../lib/recall/hybrid/runtime-context.js";
import {
  createMemoryEngineExecute,
  createMemoryEngineSearchExecute,
} from "../lib/tools/memory-engine-actions.js";

function noop() {}

test("hybrid runtime context freezes explicit dependency groups", () => {
  const withDb = noop;
  const context = createHybridRuntimeContext({
    dataAccess: { withDb },
    retrievalPolicy: {
      apiConfig: { memoryEngine: {} },
      categoryMap: { preference: { conf: 0.8 } },
      kgFailClosedMode: "legacy_fallback",
    },
    telemetry: { recordMemoryEvent: noop },
  });

  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.dataAccess), true);
  assert.equal(Object.isFrozen(context.retrievalPolicy), true);
  assert.equal(Object.isFrozen(context.telemetry), true);
  assert.equal(context.dataAccess.withDb, withDb);
  assert.equal(normalizeHybridRuntimeContext(context), context);
  assert.equal(typeof context.retrievalPolicy.hybridSearch, "function");
  assert.equal(typeof context.telemetry.recordHybridSearchObservation, "function");
});

test("legacy flat runtime normalizes into dataAccess retrievalPolicy and telemetry", () => {
  const runtime = {
    api: { config: { marker: true } },
    withDb: noop,
    withHybridDbAccessScope: noop,
    getLancedbTable: noop,
    getMemorySearchManager: noop,
    calcRealtimeConf: noop,
    syncIndexIfNeeded: noop,
    CATEGORY_MAP: { raw_log: {} },
    generateEmbedding: noop,
    recordMemoryEvent: noop,
    hybridObservationSurface: "legacy_surface",
  };
  const context = normalizeHybridRuntimeContext(runtime);
  const attemptedOverride = () => "wrong-db";
  const flattened = buildHybridSearchRuntime(context, {
    withDb: attemptedOverride,
    trustedRuntimeContext: { source: "test" },
  });

  assert.equal(context.dataAccess.withDb, runtime.withDb);
  assert.equal(context.retrievalPolicy.apiConfig, runtime.api.config);
  assert.equal(context.retrievalPolicy.categoryMap, runtime.CATEGORY_MAP);
  assert.equal(context.telemetry.hybridObservationSurface, "legacy_surface");
  assert.equal(flattened.withDb, runtime.withDb);
  assert.notEqual(flattened.withDb, attemptedOverride);
  assert.equal(flattened.categoryMap, runtime.CATEGORY_MAP);
  assert.deepEqual(flattened.trustedRuntimeContext, { source: "test" });
});

test("grouped runtime drives both search tool surfaces through one context", async () => {
  const calls = [];
  const context = createHybridRuntimeContext({
    dataAccess: {
      withDb: noop,
      withHybridDbAccessScope: noop,
      getLancedbTable: () => null,
      getMemorySearchManager: noop,
    },
    retrievalPolicy: {
      apiConfig: { marker: true },
      calcRealtimeConf: noop,
      syncIndexIfNeeded: noop,
      categoryMap: { raw_log: {} },
      generateEmbedding: noop,
      async hybridSearch(query, options, runtime) {
        calls.push({ query, options, runtime });
        return {
          pool: 1,
          channels: ["fts"],
          channel_sizes: { fts: 1 },
          debug: {},
          results: [{ id: "memory-1", text: query }],
        };
      },
    },
    telemetry: {
      recordMemoryEvent: noop,
      recordHybridSearchObservation: () => true,
    },
  });
  const actionSearch = createMemoryEngineExecute({ action: {}, hybrid: context });
  const searchTool = createMemoryEngineSearchExecute({ hybrid: context });

  const fromAction = await actionSearch("action-call", { action: "search", text: "shared", top_k: 2 });
  const fromTool = await searchTool("search-call", { query: "shared", top_k: 2 });

  assert.deepEqual(fromAction.results, fromTool.results);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].runtime.withDb, context.dataAccess.withDb);
  assert.equal(calls[0].runtime.cfg, context.retrievalPolicy.apiConfig);
});

test("observation uses telemetry group and resolves tool traffic origin", () => {
  const calls = [];
  const context = createHybridRuntimeContext({
    telemetry: {
      recordMemoryEvent: noop,
      hybridObservationSurface: "memory_engine_search",
      resolveTrafficOriginContext(toolCallId, surface) {
        return { toolCallId, surface, source: "before_tool_call" };
      },
      recordHybridSearchObservation(payload) {
        calls.push(payload);
        return true;
      },
    },
  });

  assert.equal(recordHybridRuntimeObservation(context, {
    result: { results: [] },
    toolCallId: "tool-1",
    traceId: "tool-1",
    recordMemoryEvent: () => {
      throw new Error("call-level telemetry override must be ignored");
    },
  }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].surface, "memory_engine_search");
  assert.equal(calls[0].recordMemoryEvent, noop);
  assert.deepEqual(calls[0].trafficOriginContext, {
    toolCallId: "tool-1",
    surface: "memory_engine_search",
    source: "before_tool_call",
  });
});
