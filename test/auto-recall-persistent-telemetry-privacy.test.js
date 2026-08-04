import test from "node:test";
import assert from "node:assert/strict";

import { createAutoRecallHookLifecycle } from "../lib/recall/auto-recall-hook-lifecycle.js";
import { createHybridRuntimeContext } from "../lib/recall/hybrid/runtime-context.js";

const SENSITIVE_VALUES = [
  "CLIENT_NAME_SOL_PRIVATE_88421",
  "CASE_FACT_SECRET_77531",
  "MEMORY_BODY_SECRET_66318",
  "CLIENT_FILE_PATH_SECRET_55209",
];

const FORBIDDEN_KEYS = new Set([
  "prompt",
  "query_original",
  "query_stripped",
  "query_normalized",
  "fts_query_final",
  "focused_query",
  "preview",
  "text",
  "content",
  "path",
  "source_path",
  "file_path",
  "assistant_answer",
  "lastAssistantMessage",
]);

function createApi() {
  const hooks = [];
  return {
    api: {
      config: null,
      logger: { warn() {} },
      on(name, handler, options) {
        hooks.push({ name, handler, options: options || null });
      },
      registerMemoryPromptSupplement() {},
    },
    hooks,
  };
}

function createHybridContext(events, hybridSearch) {
  return createHybridRuntimeContext({
    dataAccess: {
      withDb: fn => fn({}),
      withHybridDbAccessScope: run => run({}),
      getLancedbTable: () => null,
      getLancedbRuntime: async () => ({ table: null, readyState: "ready" }),
      getMemorySearchManager: async () => ({ manager: null, error: null }),
    },
    retrievalPolicy: {
      apiConfig: null,
      calcRealtimeConf: () => 0.8,
      syncIndexIfNeeded: () => null,
      categoryMap: {},
      generateEmbedding: async () => [],
      hybridSearch,
      vectorReadyTimeoutMs: 400,
      kgFailClosedMode: "legacy_fallback",
      recentFailClosedMode: "legacy_fallback",
    },
    telemetry: {
      recordMemoryEvent: event => events.push(event),
    },
  });
}

function createLifecycle(options = {}) {
  const events = [];
  const fixture = createApi();
  const lifecycle = createAutoRecallHookLifecycle({
    api: fixture.api,
    autoRecallConfig: { enabled: false, topK: 2, timeoutMs: 500, ...(options.autoRecallConfig || {}) },
    recordMemoryEvent: event => events.push(event),
    withDb: fn => fn({}),
    resolvePrefixes: options.resolvePrefixes || ((_db, ids) => ids),
    batchReinforce: options.batchReinforce || (() => 0),
    now: options.now || (() => 1_700_000_000_000),
    randomUUID: options.randomUUID || (() => "trace-privacy"),
  });
  return { ...fixture, lifecycle, events };
}

function assertNoForbiddenKeys(value, location = "metadata") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.equal(FORBIDDEN_KEYS.has(key), false, `${location}.${key} is not allowed`);
    assertNoForbiddenKeys(child, `${location}.${key}`);
  }
}

function assertContentFreeEvents(events) {
  for (const event of events) {
    if (event.metadata_json !== undefined) assertNoForbiddenKeys(event.metadata_json, event.event_type);
  }
  const serialized = JSON.stringify(events);
  for (const value of SENSITIVE_VALUES) assert.equal(serialized.includes(value), false, value);
}

function sensitivePrompt() {
  return [
    "结合项目历史，请检查 memory-engine 5.20+ 对 CLIENT_NAME_SOL_PRIVATE_88421 和 CASE_FACT_SECRET_77531 的兼容性。",
    "请勿泄露 MEMORY_BODY_SECRET_66318；文件 CLIENT_FILE_PATH_SECRET_55209 只作为测试路径。",
    ...Array.from({ length: 32 }, (_, index) => `历史上下文补充 ${index}，仅用于触发 focused-query。`),
  ].join("\n");
}

test("skip telemetry is content-free while preserving skip structure", async () => {
  const fixture = createLifecycle({
    autoRecallConfig: { enabled: true, sessionAllowlist: ["allowed-session"] },
  });
  fixture.lifecycle.register(createHybridContext(fixture.events, async () => {
    throw new Error("skip path must not execute Hybrid Search");
  }));

  const beforePrompt = fixture.hooks.find(item => item.name === "before_prompt_build").handler;
  await beforePrompt({
    prompt: sensitivePrompt(),
    runId: "run-skip-privacy",
    sessionId: "blocked-session",
  }, {
    agentId: "edi",
    trigger: "user",
    runId: "run-skip-privacy",
    sessionId: "blocked-session",
  });

  assert.equal(fixture.events.some(event => event.event_type === "auto_recall_debug"), true);
  assert.equal(fixture.events.some(event => event.event_type === "recall_completed"), true);
  assertContentFreeEvents(fixture.events);
});

test("search telemetry projects only structured fields and preserves counts and IDs", async () => {
  const fixture = createLifecycle({ autoRecallConfig: { enabled: true } });
  const injected = {
    id: "safe-injected-id",
    path: `memory/${SENSITIVE_VALUES[3]}/case.md`,
    text: `memory-engine 5.20+ 兼容性结论 ${SENSITIVE_VALUES[2]}`,
    category: "episodic",
    confidence: 0.82,
    confidence_mode: "managed",
    source_type: "memory-engine-managed",
    sources: ["fts"],
    final_score: 0.91,
    semantic_score: 0.8,
    rrf_score: 0.4,
  };
  const rejected = {
    id: "safe-rejected-id",
    path: `memory/${SENSITIVE_VALUES[3]}/raw.log`,
    text: `memory-engine 兼容性旧日志 ${SENSITIVE_VALUES[1]}`,
    category: "raw_log",
    confidence: 0.2,
    confidence_mode: "managed",
    source_type: "memory-engine-managed",
    sources: ["fts"],
    final_score: 0.1,
  };
  const hybridContext = createHybridContext(fixture.events, async () => ({
    pool: "hybrid",
    channels: ["fts"],
    channel_sizes: { fts: 2 },
    results: [injected, rejected],
    debug: {
      query_original: sensitivePrompt(),
      query_stripped: "结合项目历史，请检查 memory-engine 5.20+ 兼容性。",
      query_normalized: SENSITIVE_VALUES[1],
      fts_query_final: SENSITIVE_VALUES[2],
      focused_query: SENSITIVE_VALUES[3],
      strict_count: 1,
      fallback_count: 0,
      post_rerank_topK: [{
        id: injected.id,
        rank: 1,
        category: injected.category,
        score: 0.91,
        final_score: injected.final_score,
        semantic_score: injected.semantic_score,
        rrf_score: injected.rrf_score,
        confidence: injected.confidence,
        confidence_mode: injected.confidence_mode,
        source_type: injected.source_type,
        sources: injected.sources,
        preview: injected.text,
        path: injected.path,
      }],
      candidate_count_before_filtering: { fts_raw_primary: 2 },
    },
  }));
  fixture.lifecycle.register(hybridContext);

  const beforePrompt = fixture.hooks.find(item => item.name === "before_prompt_build").handler;
  await beforePrompt({
    prompt: sensitivePrompt(),
    runId: "run-search-privacy",
    sessionId: "search-session",
  }, {
    agentId: "edi",
    trigger: "user",
    runId: "run-search-privacy",
    sessionId: "search-session",
  });

  const eventTypes = new Set(fixture.events.map(event => event.event_type));
  for (const eventType of [
    "recall_started",
    "auto_recall_debug",
    "hybrid_search_observation",
    "memory_candidate_retrieved",
    "memory_injected",
    "recall_completed",
  ]) assert.equal(eventTypes.has(eventType), true, eventType);
  assertContentFreeEvents(fixture.events);

  const debugEvents = fixture.events.filter(event => event.event_type === "auto_recall_debug");
  assert.equal(debugEvents.length >= 2, true);
  const recallDebug = debugEvents.find(event => event.metadata_json?.debug_type !== "gate_decision");
  assert.equal(recallDebug.metadata_json.candidate_count, 2);
  assert.equal(recallDebug.metadata_json.injected_count, 1);
  assert.equal(recallDebug.metadata_json.post_rerank_topK[0].id, injected.id);
  assert.equal(recallDebug.metadata_json.post_rerank_topK[0].category, "episodic");
  assert.equal(recallDebug.metadata_json.rejected_candidates[0].id, rejected.id);
  assert.equal(recallDebug.metadata_json.gate_decisions[0].id, injected.id);
  assert.equal(recallDebug.metadata_json.original_input_chars > 0, true);
  assert.equal(recallDebug.metadata_json.focused_query_chars > 0, true);
});
