import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { generateEmbedding } from "../lib/siliconflow-runtime.js";
import {
  awaitWithAutoRecallBudget,
  createAutoRecallRequestBudget,
} from "../lib/recall/request-budget.js";
import { createAutoRecallHookLifecycle } from "../lib/recall/auto-recall-hook-lifecycle.js";
import { createHybridRuntimeContext } from "../lib/recall/hybrid/runtime-context.js";
import { hybridSearch } from "../lib/recall/hybrid-search.js";

function requestFixture({ onRequest = null, responseBody = JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }) } = {}) {
  const state = { calls: 0, destroys: 0, requests: [] };
  const requestImpl = (_url, options, onResponse) => {
    state.calls += 1;
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => {
      state.requests.push({ request, options, onResponse, responseBody });
      onRequest?.({ request, options, onResponse, responseBody, state });
    };
    request.destroy = () => {
      state.destroys += 1;
      request.destroyed = true;
    };
    return request;
  };
  return { requestImpl, state };
}

function makeBudgetDb() {
  let recentQueries = 0;
  return {
    get recentQueries() {
      return recentQueries;
    },
    prepare(sql) {
      const query = String(sql);
      return {
        all() {
          if (query.includes("FROM memory_confidence")) return [{
            chunk_id: "chunk-1234567890abcdef",
            confidence: 0.9,
            last_confidence_update: 0,
            base_tau: 7,
            hit_count: 1,
            is_protected: 0,
            conflict_flag: 0,
            category: "raw_log",
            is_archived: 0,
          }];
          if (query.includes("SELECT id FROM chunks")) return [{ id: "chunk-1234567890abcdef" }];
          if (query.includes("ORDER BY c.updated_at DESC")) {
            recentQueries += 1;
            return [];
          }
          return [];
        },
        get() {
          return { 1: 1 };
        },
      };
    },
    exec() {},
  };
}

function makeApi(events) {
  const hooks = [];
  return {
    api: {
      config: null,
      logger: { warn() {} },
      on(name, handler, options) {
        hooks.push({ name, handler, options });
      },
      registerMemoryPromptSupplement() {},
    },
    hooks,
    events,
  };
}

function makeRuntime({ generateEmbeddingRuntime, db, managerSearch = null, lancedbTable = null }) {
  return createHybridRuntimeContext({
    dataAccess: {
      withHybridDbAccessScope: async run => run({
        withCoreDb: callback => callback(db),
        withEngineDb: callback => callback(db),
        capabilities: {
          isolatedFts: true,
          isolatedKg: true,
          isolatedRecent: true,
        },
      }),
      getLancedbRuntime: async () => ({ table: lancedbTable, readyState: lancedbTable ? "ready" : "disabled" }),
      getLancedbTable: () => lancedbTable,
      getMemorySearchManager: async () => ({
        manager: managerSearch ? { search: managerSearch } : null,
      }),
    },
    retrievalPolicy: {
      apiConfig: null,
      calcRealtimeConf: row => row.confidence,
      syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
      categoryMap: {},
      generateEmbedding: generateEmbeddingRuntime,
      vectorReadyTimeoutMs: 50,
      kgFailClosedMode: "legacy_fallback",
      recentFailClosedMode: "legacy_fallback",
    },
    telemetry: {
      recordMemoryEvent: () => {},
    },
  });
}

test("real SiliconFlow embedding adapter aborts before request and destroys a hung request", async () => {
  const preAborted = new AbortController();
  preAborted.abort(new Error("cancelled"));
  const pre = requestFixture();
  await assert.rejects(
    generateEmbedding("query", {
      cfg: { models: { providers: { siliconflow: { apiKey: "test-key" } } } },
      signal: preAborted.signal,
      requestImpl: pre.requestImpl,
    }),
    error => error.code === "AUTO_RECALL_REQUEST_CANCELLED",
  );
  assert.equal(pre.state.calls, 0);

  const controller = new AbortController();
  const hung = requestFixture();
  const pending = generateEmbedding("query", {
    cfg: { models: { providers: { siliconflow: { apiKey: "test-key" } } } },
    signal: controller.signal,
    requestImpl: hung.requestImpl,
  });
  controller.abort(new Error("cancelled"));
  await assert.rejects(pending, error => error.code === "AUTO_RECALL_REQUEST_CANCELLED");
  assert.equal(hung.state.calls, 1);
  assert.equal(hung.state.destroys, 1);
});

test("mid-body abort settles once and ignores a late successful response", async () => {
  const controller = new AbortController();
  const fixture = requestFixture({
    onRequest: ({ onResponse, state }) => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.destroy = () => { state.destroys += 1; };
      onResponse(response);
      response.emit("data", '{"data":[');
      controller.abort(new Error("cancelled"));
      response.emit("data", '{"embedding":[1,2]}]}');
      response.emit("end");
    },
  });
  await assert.rejects(
    generateEmbedding("query", {
      cfg: { models: { providers: { siliconflow: { apiKey: "test-key" } } } },
      signal: controller.signal,
      requestImpl: fixture.requestImpl,
    }),
    error => error.code === "AUTO_RECALL_REQUEST_CANCELLED",
  );
  assert.equal(fixture.state.calls, 1);
  assert.equal(fixture.state.destroys, 2);
});

test("shared budget cancels the real AutoRecall to Hybrid/vector/embedding chain without fallback or positive writes", async () => {
  const events = [];
  const apiFixture = makeApi(events);
  const db = makeBudgetDb();
  const embedding = requestFixture({
    onRequest: ({ state }) => {
      // The transport is intentionally never completed; cancellation must
      // destroy it and prevent the manager/recent fallback from running.
      state.lateResponse = true;
    },
  });
  let embeddingOptions = null;
  const generateEmbeddingRuntime = (text, options) => {
    embeddingOptions = options;
    return generateEmbedding(text, {
    cfg: { models: { providers: { siliconflow: { apiKey: "test-key" } } } },
    requestImpl: embedding.requestImpl,
    ...options,
    });
  };
  const runtime = makeRuntime({
    generateEmbeddingRuntime,
    db,
    managerSearch: async () => [{ id: "fallback", text: "late fallback", similarity: 1 }],
    lancedbTable: {
      search() {
        return { limit: () => ({ execute: async () => [] }) };
      },
    },
  });
  const lifecycle = createAutoRecallHookLifecycle({
    api: apiFixture.api,
    autoRecallConfig: { enabled: true, topK: 2, timeoutMs: 100 },
    recordMemoryEvent: event => events.push(event),
    withDb: callback => callback(db),
    batchReinforce: () => {
      throw new Error("reinforcement must not run");
    },
    randomUUID: () => "trace-budget-cancel",
  });
  lifecycle.register(runtime);
  const hook = apiFixture.hooks.find(item => item.name === "before_prompt_build").handler;
  await hook({ prompt: "find the memory", runId: "run-cancel" }, {
    agentId: "edi",
    runId: "run-cancel",
    sessionId: "session-cancel",
    trigger: "user",
  });

  assert.equal(embedding.state.calls, 1);
  assert.equal(embedding.state.destroys, 1);
  assert.equal(typeof embeddingOptions?.signal?.addEventListener, "function");
  assert.equal(Number.isFinite(embeddingOptions?.deadlineMs), true);
  assert.equal(db.recentQueries, 0);
  assert.equal(events.some(event => event.event_type === "memory_candidate_retrieved"), false);
  assert.equal(events.some(event => event.event_type === "memory_injected"), false);
  assert.equal(events.some(event => event.event_type === "memory_reinforced"), false);
  assert.equal(events.some(event => event.event_type === "recall_completed"), false);
  assert.equal(events.filter(event => event.metadata_json?.debug_type === "auto_recall_cancellation").length, 1);
  const cancellation = events.find(event => event.metadata_json?.debug_type === "auto_recall_cancellation");
  assert.equal(cancellation.trace_id, "trace-budget-cancel");
  assert.equal(cancellation.metadata_json.cancellation_stage, "embedding");
  assert.equal(Number.isFinite(cancellation.metadata_json.hybrid_vector_timings.vector_embedding_wait_ms), true);
  assert.equal(cancellation.metadata_json.hybrid_vector_timings.vector_embedding_wait_ms >= 0, true);
  assert.equal(lifecycle.turnState.getTurnState("run-cancel"), null);
});

test("cancelled budget does not start a queued operation", async () => {
  let starts = 0;
  const budget = createAutoRecallRequestBudget(100);
  budget.cancel("lancedb_search");
  assert.throws(
    () => awaitWithAutoRecallBudget(() => {
      starts += 1;
      return Promise.resolve([]);
    }, budget, "lancedb_search"),
    error => error.code === "AUTO_RECALL_REQUEST_CANCELLED",
  );
  assert.equal(starts, 0);
  budget.dispose();
});

test("cancelled budget does not start the real LanceDB search callback", async () => {
  const db = makeBudgetDb();
  const budget = createAutoRecallRequestBudget(1_000);
  let searchCalls = 0;
  const table = {
    search() {
      searchCalls += 1;
      return { limit: () => ({ execute: async () => [] }) };
    },
  };
  const runtimeInfo = { readyState: "ready" };
  Object.defineProperty(runtimeInfo, "table", {
    get() {
      budget.cancel("lancedb_search");
      return table;
    },
  });

  const result = await hybridSearch("query", { topK: 2 }, {
    requestBudget: budget,
    withHybridDbAccessScope: async run => run({
      withCoreDb: callback => callback(db),
      withEngineDb: callback => callback(db),
      capabilities: { isolatedFts: true, isolatedKg: true, isolatedRecent: true },
    }),
    calcRealtimeConf: row => row.confidence,
    generateEmbedding: async () => [0.1, 0.2],
    getLancedbRuntime: async () => runtimeInfo,
    getMemorySearchManager: async () => ({ manager: null }),
    syncIndexIfNeeded: async () => ({ synced: false }),
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(result.debug.request_cancelled, true);
  assert.equal(result.debug.cancellation_stage, "lancedb_search");
  assert.equal(searchCalls, 0);
  budget.dispose();
});

test("budget helper supports independent concurrent invocations and cleans its timer", async () => {
  const timers = new Set();
  const budget = createAutoRecallRequestBudget(100, {
    setTimeoutFn: callback => {
      const timer = { unref() {}, callback };
      timers.add(timer);
      return timer;
    },
    clearTimeoutFn: timer => timers.delete(timer),
  });
  assert.equal(budget.isCancelled(), false);
  budget.dispose();
  assert.equal(timers.size, 0);
  const left = createAutoRecallRequestBudget(0);
  const right = createAutoRecallRequestBudget(100);
  assert.equal(left.isCancelled(), true);
  assert.equal(right.isCancelled(), false);
  right.dispose();
});

test("normal unbudgeted embedding remains unchanged", async () => {
  const fixture = requestFixture({
    onRequest: ({ onResponse, responseBody }) => {
      const response = new EventEmitter();
      response.statusCode = 200;
      onResponse(response);
      response.emit("data", responseBody);
      response.emit("end");
    },
  });
  const value = await generateEmbedding("query", {
    cfg: { models: { providers: { siliconflow: { apiKey: "test-key" } } } },
    requestImpl: fixture.requestImpl,
  });
  assert.deepEqual(value, [0.1, 0.2]);
  assert.equal(fixture.state.destroys, 0);
});

test("hybrid vector timing fields are finite and bounded on a normal path", async () => {
  const db = makeBudgetDb();
  const fixture = requestFixture({
    onRequest: ({ onResponse, responseBody }) => {
      const response = new EventEmitter();
      response.statusCode = 200;
      onResponse(response);
      response.emit("data", responseBody);
      response.emit("end");
    },
  });
  const result = await hybridSearch("query", { topK: 2 }, {
    withHybridDbAccessScope: async run => run({
      withCoreDb: callback => callback(db),
      withEngineDb: callback => callback(db),
      capabilities: { isolatedFts: true, isolatedKg: true, isolatedRecent: true },
    }),
    calcRealtimeConf: row => row.confidence,
    generateEmbedding: (text, options) => generateEmbedding(text, {
      cfg: { models: { providers: { siliconflow: { apiKey: "test-key" } } } },
      requestImpl: fixture.requestImpl,
      ...options,
    }),
    getLancedbRuntime: async () => ({
      readyState: "ready",
      table: {
        search: () => ({
          limit: () => ({ execute: async () => [{
            id: "chunk-1234567890abcdef",
            text: "vector text",
            _distance: 0.1,
          }] }),
        }),
      },
    }),
    getMemorySearchManager: async () => ({ manager: null }),
    syncIndexIfNeeded: async () => ({ synced: false }),
  });
  for (const key of [
    "vector_ready_wait_ms",
    "vector_embedding_wait_ms",
    "vector_lancedb_search_ms",
    "vector_lancedb_collect_ms",
    "vector_candidate_postprocess_ms",
  ]) {
    assert.equal(Number.isFinite(result.debug[key]), true, key);
    assert.ok(result.debug[key] >= 0 && result.debug[key] <= 3_600_000, key);
  }
});

test("late LanceDB resolution is detached without fallback or candidate consumption", async () => {
  const db = makeBudgetDb();
  let managerCalls = 0;
  const budget = createAutoRecallRequestBudget(100);
  const result = await hybridSearch("query", { topK: 2 }, {
    requestBudget: budget,
    withHybridDbAccessScope: async run => run({
      withCoreDb: callback => callback(db),
      withEngineDb: callback => callback(db),
      capabilities: { isolatedFts: true, isolatedKg: true, isolatedRecent: true },
    }),
    calcRealtimeConf: row => row.confidence,
    generateEmbedding: async () => [0.1, 0.2],
    getLancedbRuntime: async () => ({
      readyState: "ready",
      table: {
        search: () => ({
          limit: () => ({
            execute: () => new Promise(resolve => setTimeout(() => resolve([{
              id: "late",
              text: "late candidate",
              _distance: 0.1,
            }]), 150)),
          }),
        }),
      },
    }),
    getMemorySearchManager: async () => ({
      manager: {
        search: async () => {
          managerCalls += 1;
          return [{ id: "fallback", text: "fallback", similarity: 1 }];
        },
      },
    }),
    syncIndexIfNeeded: async () => ({ synced: false }),
  });
  budget.dispose();
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(result.debug.request_cancelled, true);
  assert.equal(result.results.length, 0);
  assert.equal(managerCalls, 0);
});
