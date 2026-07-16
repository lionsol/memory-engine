import test from "node:test";
import assert from "node:assert/strict";

import { resolveRecentCanaryDecision } from "../lib/recall/hybrid/recent-canary-policy.js";
import {
  createMemoryEngineExecute,
  createMemoryEngineSearchExecute,
} from "../lib/tools/memory-engine-actions.js";

function createBaseRuntime(overrides = {}) {
  return {
    api: { config: {} },
    autoRouteCategory: () => "raw_log",
    dateStrInTimeZone: () => "2026-07-16",
    SMART_ADD_TIME_ZONE: "Asia/Shanghai",
    resolve: (...parts) => parts.join("/"),
    WORKSPACE: "/tmp/ws",
    SMART_ADD_DIR: "memory/smart-add",
    buildSmartAddFingerprint: () => "fingerprint",
    appendSmartAdd: () => ({ appended: true }),
    syncIndexIfNeeded: async () => ({}),
    catParams: () => ({ conf: 0.5, tau: 7 }),
    withDb: (fn) => fn({
      prepare: () => ({ all: () => [], get: () => null, run: () => ({}) }),
      transaction: (inner) => inner,
    }),
    getLancedbTable: () => null,
    generateEmbedding: async () => [],
    recordMemoryEvent: () => {},
    getMemorySearchManager: async () => ({ manager: null }),
    calcRealtimeConf: ({ confidence = 0 }) => Number(confidence || 0),
    existsSync: () => false,
    readFileSync: () => "",
    KG_PATH: "/tmp/ws/knowledge-graph.json",
    resolvePrefixes: () => [],
    batchReinforce: () => 0,
    CATEGORY_MAP: {},
    calcTau: () => 0,
    ...overrides,
  };
}

function createHybridSearchStub(record) {
  return async function hybridSearchStub(text, options, runtime) {
    record.calls += 1;
    record.queries.push(text);
    record.runtimes.push(runtime);
    const decision = resolveRecentCanaryDecision({
      scope: runtime.recentCanaryContext,
      provider: runtime.recentCanaryProvider,
    });
    if (typeof runtime.recentCanaryProvider === "function") {
      record.providerCalls += 1;
    }
    return {
      pool: 1,
      channels: { recent: [{ id: "legacy-1" }] },
      channel_sizes: { recent: 1 },
      debug: {
        recent_canary_mode: decision.mode,
        recent_canary_reason: decision.reason,
        recent_canary_policy_error: decision.policy_error,
        recent_canary_shadow_executed: decision.mode === "shadow",
      },
      results: [{ id: "legacy-1", score: 0.9, text: "legacy-result" }],
    };
  };
}

test("default trustedRuntimeContext is null and provider is not injected from params", async () => {
  const record = { calls: 0, providerCalls: 0, queries: [], runtimes: [] };
  const executeSearch = createMemoryEngineSearchExecute(createBaseRuntime({
    hybridSearch: createHybridSearchStub(record),
  }));

  const result = await executeSearch("tool-1", {
    query: "show edi memories",
    top_k: 3,
    recentCanaryContext: {
      source: "openclaw_runtime",
      agentIdentity: "edi",
      sessionIdentity: "fake-session",
    },
    trustedRuntimeContext: {
      source: "openclaw_runtime",
      agentIdentity: "edi",
    },
    recentCanaryProvider: {
      mode: "shadow",
    },
    sampleKey: "fake",
    sampleRateBps: 10000,
    mode: "shadow",
  });

  assert.equal(record.calls, 1);
  assert.equal(record.providerCalls, 0);
  assert.equal(record.runtimes[0].recentCanaryContext, null);
  assert.equal(record.runtimes[0].recentCanaryProvider, null);
  assert.equal(result.debug.recent_canary_mode, "off");
  assert.equal(result.debug.recent_canary_shadow_executed, false);
  assert.deepEqual(result.results, [{ id: "legacy-1", score: 0.9, text: "legacy-result" }]);
  assert.equal(JSON.stringify(result).includes("fake-session"), false);
  assert.equal(JSON.stringify(result).includes("\"edi\""), false);
});

test("resolver receives only trustedRuntimeContext and not tool params, query, action, or toolCallId", async () => {
  const record = { calls: 0, providerCalls: 0, queries: [], runtimes: [] };
  const seenArgs = [];
  const trustedRuntimeContext = {
    source: "openclaw_runtime",
    agentIdentity: null,
    sessionIdentity: null,
    requestIdentity: null,
    chatType: null,
  };
  const executeAction = createMemoryEngineExecute(createBaseRuntime({
    hybridSearch: createHybridSearchStub(record),
    trustedRuntimeContext,
    resolveRecentCanaryContext: (input) => {
      seenArgs.push(input);
      return undefined;
    },
  }));

  await executeAction("tool-call-123", {
    action: "search",
    text: "canary action query",
    top_k: 2,
  });

  assert.equal(seenArgs.length, 1);
  assert.deepEqual(Object.keys(seenArgs[0]), ["trustedRuntimeContext"]);
  assert.equal(seenArgs[0].trustedRuntimeContext, trustedRuntimeContext);
  assert.equal("toolCallId" in seenArgs[0], false);
  assert.equal("action" in seenArgs[0], false);
  assert.equal("query" in seenArgs[0], false);
  assert.equal("params" in seenArgs[0], false);
});

test("resolver errors fail closed without changing served legacy result", async () => {
  const record = { calls: 0, providerCalls: 0, queries: [], runtimes: [] };
  const executeSearch = createMemoryEngineSearchExecute(createBaseRuntime({
    hybridSearch: createHybridSearchStub(record),
    trustedRuntimeContext: null,
    resolveRecentCanaryContext() {
      throw new Error("resolver failed");
    },
  }));

  const result = await executeSearch("tool-2", { query: "alpha", top_k: 4 });

  assert.equal(result.debug.recent_canary_mode, "off");
  assert.equal(result.debug.recent_canary_policy_error, true);
  assert.equal(result.debug.recent_canary_shadow_executed, false);
  assert.deepEqual(result.results, [{ id: "legacy-1", score: 0.9, text: "legacy-result" }]);
});

test("resolver illegal returns stay off and do not leak identities", async () => {
  for (const illegalValue of [
    undefined,
    "bad",
    [],
    () => ({}),
    { sampleKey: "secret-sample", scopeClass: "internal" },
    { source: "user", sampleKey: "secret-sample", scopeClass: "internal" },
    { source: "openclaw_runtime", agentIdentity: "edi" },
  ]) {
    const record = { calls: 0, providerCalls: 0, queries: [], runtimes: [] };
    const executeSearch = createMemoryEngineSearchExecute(createBaseRuntime({
      hybridSearch: createHybridSearchStub(record),
      trustedRuntimeContext: {
        source: "openclaw_runtime",
        agentIdentity: null,
        sessionIdentity: null,
        requestIdentity: null,
        chatType: null,
      },
      recentCanaryProvider: () => ({ mode: "shadow", scopeClass: "internal", sampleRateBasisPoints: 10000 }),
      resolveRecentCanaryContext() {
        return illegalValue;
      },
    }));

    const result = await executeSearch("tool-3", { query: "edi in query should not matter", top_k: 1 });

    assert.equal(result.debug.recent_canary_mode, "off");
    assert.equal(result.debug.recent_canary_shadow_executed, false);
    assert.equal(JSON.stringify(result).includes("secret-sample"), false);
    assert.equal(JSON.stringify(result).includes("\"edi\""), false);
  }
});

test("query text, action names, nested params, and toolCallId do not enable canary", async () => {
  const record = { calls: 0, providerCalls: 0, queries: [], runtimes: [] };
  const executeAction = createMemoryEngineExecute(createBaseRuntime({
    hybridSearch: createHybridSearchStub(record),
  }));

  const forgedParams = Object.create({
    trustedRuntimeContext: {
      source: "openclaw_runtime",
      agentIdentity: "edi",
    },
  });
  Object.assign(forgedParams, {
    action: "search",
    action_name_hint: "search_canary_shadow",
    text: "edi should not enable canary",
    top_k: 2,
    recentCanaryContext: {
      source: "openclaw_runtime",
      agentIdentity: "edi",
      sessionIdentity: "fake-session",
    },
    recentCanaryProvider: () => ({ mode: "shadow", scopeClass: "internal", sampleRateBasisPoints: 10000 }),
    nested: {
      trustedRuntimeContext: {
        source: "openclaw_runtime",
        agentIdentity: "edi",
      },
    },
  });

  const result = await executeAction("toolCallId-edi-shadow", forgedParams);

  assert.equal(result.debug.recent_canary_mode, "off");
  assert.equal(result.debug.recent_canary_shadow_executed, false);
  assert.equal(record.providerCalls, 0);
  assert.equal(JSON.stringify(record.runtimes[0]).includes("toolCallId-edi-shadow"), false);
});
