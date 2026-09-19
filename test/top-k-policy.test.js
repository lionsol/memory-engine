import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createMemoryEngineExecute,
  createMemoryEngineSearchExecute,
} from "../lib/tools/memory-engine-actions.js";
import { registerMemoryEngineTools } from "../lib/tools/register-memory-engine-tools.js";
import {
  resolveEffectiveHybridRuntimeConfig,
} from "../lib/config/effective-hybrid-runtime-config.js";
import { hybridSearch } from "../lib/recall/hybrid-search.js";
import {
  buildHybridSearchRuntime,
  normalizeHybridRuntimeContext,
} from "../lib/recall/hybrid/runtime-context.js";
import {
  INVALID_TOP_K,
  PRODUCTION_DEFAULT_TOP_K,
  PRODUCTION_TOP_K_MAX,
  PRODUCTION_TOP_K_MIN,
  createTrustedTopKPolicy,
  normalizeTopK,
  validateTopK,
} from "../lib/recall/top-k-policy.js";

function makeToolRuntime(overrides = {}) {
  const calls = {
    hybrid: 0,
    lancedb: 0,
  };
  const runtime = {
    calls,
    getLancedbTable() {
      calls.lancedb += 1;
      return null;
    },
    calcRealtimeConf: () => 0,
    recordHybridSearchObservation: () => true,
    async hybridSearch(text, options) {
      calls.hybrid += 1;
      calls.lastHybrid = { text, options };
      return {
        pool: [],
        channels: {},
        channel_sizes: {},
        debug: {},
        results: [],
      };
    },
    ...overrides,
  };
  return runtime;
}

function boundaryRuntime(calls, topKPolicy) {
  return {
    ...(topKPolicy ? { topKPolicy } : {}),
    calcRealtimeConf: () => 0,
    withHybridDbAccessScope: async () => {
      calls.scope += 1;
      calls.downstream += 1;
      throw new Error("DOWNSTREAM_RETRIEVAL_REACHED");
    },
  };
}

test("production top_k policy is finite integer 1..50 with a missing-value default", () => {
  assert.deepEqual(validateTopK(undefined), {
    valid: true,
    supplied: false,
    value: PRODUCTION_DEFAULT_TOP_K,
    error: null,
  });
  for (const value of [PRODUCTION_TOP_K_MIN, PRODUCTION_TOP_K_MAX]) {
    assert.equal(validateTopK(value).valid, true, String(value));
  }

  for (const value of [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "5",
    "10",
    null,
    "",
    false,
    [],
    {},
    51,
    100,
    1_000_000,
  ]) {
    const result = validateTopK(value);
    assert.equal(result.valid, false, `${String(value)} should be invalid`);
    assert.equal(result.error, INVALID_TOP_K);
    assert.throws(() => normalizeTopK(value), error => error.message === INVALID_TOP_K);
  }
});

test("public tool schemas share the exported production top_k contract", () => {
  const registrations = [];
  registerMemoryEngineTools({
    registerTool(tool, options) {
      const resolved = typeof tool === "function"
        ? tool({ sessionId: "top-k-schema-test" })
        : tool;
      registrations.push({ tool: resolved, options });
    },
  }, {
    memoryEngine: async () => ({}),
    memoryEngineSearch: async () => ({}),
    memoryEngineGet: async () => ({}),
  });

  for (const name of ["memory_engine", "memory_engine_search"]) {
    const registration = registrations.find(item => item.tool?.name === name);
    assert.ok(registration, `${name} registration missing`);
    assert.deepEqual(registration.tool.parameters.properties.top_k, {
      type: "integer",
      minimum: PRODUCTION_TOP_K_MIN,
      maximum: PRODUCTION_TOP_K_MAX,
      default: PRODUCTION_DEFAULT_TOP_K,
    });
  }

  const broadRegistration = registrations.find(item => item.tool?.name === "memory_engine");
  assert.equal(Object.hasOwn(broadRegistration.tool.parameters.properties, "deep"), false);

  const manifest = JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"));
  const manifestTopK = manifest.configSchema.properties.autoRecall.properties.topK;
  assert.equal(manifestTopK.type, "integer");
  assert.equal(manifestTopK.minimum, PRODUCTION_TOP_K_MIN);
  assert.equal(manifestTopK.maximum, PRODUCTION_TOP_K_MAX);
  assert.equal(manifestTopK.default, 3);
});

test("trusted top_k policy survives production runtime-context construction", () => {
  const policy = createTrustedTopKPolicy({ max: 100 });
  const context = normalizeHybridRuntimeContext({ topKPolicy: policy });
  const runtime = buildHybridSearchRuntime(context);

  assert.equal(runtime.topKPolicy, policy);
  assert.equal(runtime.topKPolicy.max, 100);
});

test("dedicated and broad search reject invalid top_k before retrieval", async () => {
  for (const value of [0, 51, 1.5, "5", null, false, Number.POSITIVE_INFINITY]) {
    const dedicatedRuntime = makeToolRuntime();
    const executeSearch = createMemoryEngineSearchExecute(dedicatedRuntime);
    const dedicatedResult = await executeSearch("dedicated-invalid", {
      query: "query",
      top_k: value,
    });
    assert.deepEqual(dedicatedResult, {
      results: [],
      error: INVALID_TOP_K,
      code: INVALID_TOP_K,
    });
    assert.equal(dedicatedRuntime.calls.hybrid, 0);
    assert.equal(dedicatedRuntime.calls.lancedb, 0);

    const actionRuntime = makeToolRuntime();
    const executeAction = createMemoryEngineExecute(actionRuntime);
    const actionResult = await executeAction("action-invalid", {
      action: "search",
      text: "query",
      top_k: value,
    });
    assert.deepEqual(actionResult, {
      error: INVALID_TOP_K,
      code: INVALID_TOP_K,
    });
    assert.equal(actionRuntime.calls.hybrid, 0);
    assert.equal(actionRuntime.calls.lancedb, 0);
  }
});

test("public search omission uses policy default without changing the result path", async () => {
  const runtime = makeToolRuntime();
  const executeSearch = createMemoryEngineSearchExecute(runtime);

  const result = await executeSearch("missing-default", { query: "query" });

  assert.deepEqual(result, { results: [] });
  assert.equal(runtime.calls.hybrid, 1);
  assert.deepEqual(runtime.calls.lastHybrid.options, { topK: PRODUCTION_DEFAULT_TOP_K });
});

test("effective AutoRecall and memory-engine config reject invalid top_k without clamping", () => {
  for (const value of [3, 50]) {
    const autoRecall = resolveEffectiveHybridRuntimeConfig({
      pluginConfig: { autoRecall: { topK: value } },
    });
    assert.equal(autoRecall.valid, true, autoRecall.errors.join(", "));
    assert.equal(autoRecall.autoRecall.topK, value);

    const memoryConfig = resolveEffectiveHybridRuntimeConfig({
      memoryEngineConfig: { recall: { topK: value } },
    });
    assert.equal(memoryConfig.valid, true, memoryConfig.errors.join(", "));
    assert.equal(memoryConfig.hybridRetrieval.recall.topK, value);
    assert.equal(memoryConfig.autoRecall.topK, value);
  }

  for (const value of [51, 1.5, "5", Number.POSITIVE_INFINITY, null]) {
    const autoRecall = resolveEffectiveHybridRuntimeConfig({
      pluginConfig: { autoRecall: { topK: value } },
    });
    assert.equal(autoRecall.valid, false, `AutoRecall ${String(value)}`);
    assert.equal(autoRecall.errors.includes("invalid_top_k:autoRecall.topK"), true);
    assert.equal(autoRecall.autoRecall.topK, PRODUCTION_DEFAULT_TOP_K);

    const memoryConfig = resolveEffectiveHybridRuntimeConfig({
      memoryEngineConfig: { recall: { topK: value } },
    });
    assert.equal(memoryConfig.valid, false, `memory config ${String(value)}`);
    assert.equal(memoryConfig.errors.includes("invalid_top_k:memoryEngineConfig.recall.topK"), true);
    assert.equal(memoryConfig.hybridRetrieval.recall.topK, PRODUCTION_DEFAULT_TOP_K);
  }
});

test("production hybrid rejects oversized breadth before any retrieval channel opens", async () => {
  const calls = { scope: 0, downstream: 0 };

  await assert.rejects(
    hybridSearch("query", { topK: 100 }, boundaryRuntime(calls)),
    error => error.message === INVALID_TOP_K,
  );
  assert.deepEqual(calls, { scope: 0, downstream: 0 });
});

test("trusted benchmark top_k policy can accept AML 100 while production rejects it", async () => {
  const productionCalls = { scope: 0, downstream: 0 };
  await assert.rejects(
    hybridSearch("query", { topK: 100 }, boundaryRuntime(productionCalls)),
    error => error.message === INVALID_TOP_K,
  );
  assert.equal(productionCalls.scope, 0);

  const benchmarkCalls = { scope: 0, downstream: 0 };
  const benchmarkPolicy = createTrustedTopKPolicy({ max: 100 });
  await assert.rejects(
    hybridSearch("query", { topK: 100 }, boundaryRuntime(benchmarkCalls, benchmarkPolicy)),
    error => error.message === "DOWNSTREAM_RETRIEVAL_REACHED",
  );
  assert.deepEqual(benchmarkCalls, { scope: 1, downstream: 1 });
});
