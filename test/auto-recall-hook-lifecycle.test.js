import test from "node:test";
import assert from "node:assert/strict";

import { createAutoRecallHookLifecycle } from "../lib/recall/auto-recall-hook-lifecycle.js";
import { createHybridRuntimeContext } from "../lib/recall/hybrid/runtime-context.js";

function createApi() {
  const hooks = [];
  let supplement = null;
  return {
    api: {
      config: null,
      logger: { warn() {} },
      on(name, handler, options) {
        hooks.push({ name, handler, options: options || null });
      },
      registerMemoryPromptSupplement(handler) {
        supplement = handler;
      },
    },
    hooks,
    getSupplement: () => supplement,
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
    autoRecallConfig: { enabled: false, topK: 3, timeoutMs: 500, ...(options.autoRecallConfig || {}) },
    recordMemoryEvent: event => events.push(event),
    withDb: fn => fn({}),
    batchReinforce: options.batchReinforce || (() => 0),
    now: options.now || (() => 1_700_000_000_000),
    randomUUID: options.randomUUID || (() => "trace-1"),
  });
  return { ...fixture, lifecycle, events };
}

test("disabled lifecycle registers only natural tool-origin hook and prompt supplement", async () => {
  const fixture = createLifecycle();

  assert.equal(fixture.lifecycle.register({}), true);
  assert.equal(fixture.lifecycle.register({}), false);
  assert.deepEqual(fixture.hooks.map(item => item.name), ["before_tool_call"]);
  assert.equal(typeof fixture.getSupplement(), "function");
  assert.match(fixture.getSupplement()({ sessionId: "session-1" }).join("\n"), /MEMORY_SUPPLEMENT_INJECTED_COUNT: 0/);

  await fixture.hooks[0].handler({
    toolName: "memory_engine_search",
    toolCallId: "tool-1",
  }, {
    agentId: "edi",
    runId: "run-1",
    sessionId: "session-1",
    toolCallId: "tool-1",
  });

  const origin = fixture.lifecycle.resolveTrafficOriginContext("tool-1", "memory_engine_search");
  assert.equal(origin.source, "before_tool_call");
  assert.equal(origin.toolCallId, "tool-1");
});

test("enabled lifecycle registers stable hook order and cleans bridge state on finalize", async () => {
  const fixture = createLifecycle({ autoRecallConfig: { enabled: true } });
  fixture.lifecycle.register({});

  assert.deepEqual(fixture.hooks.map(item => item.name), [
    "before_tool_call",
    "before_prompt_build",
    "before_tool_call",
    "before_agent_finalize",
  ]);
  assert.deepEqual(fixture.hooks[1].options, { timeoutMs: 500 });

  fixture.lifecycle.turnState.createTurnState({
    runId: "run-1",
    sessionId: "session-1",
    traceId: "trace-1",
  });
  const scopeHook = fixture.hooks[2].handler;
  await scopeHook({
    toolName: "memory_engine_get",
    toolCallId: "tool-get-1",
    runId: "run-1",
  }, {
    runId: "run-1",
    sessionId: "session-1",
  });
  fixture.lifecycle.onMemoryEngineGetSuccess("abcdef1234567890", { _toolCallId: "tool-get-1" });

  assert.deepEqual(
    [...fixture.lifecycle.turnState.getTurnState("run-1").memoryEngineGetIds],
    ["abcdef1234567890"],
  );
  assert.match(fixture.getSupplement()({ sessionId: "session-1" }).join("\n"), /MEMORY_SUPPLEMENT_INJECTED_COUNT: 0/);

  const finalize = fixture.hooks[3].handler;
  await finalize({ runId: "run-1", lastAssistantMessage: "no citations" }, { runId: "run-1" });

  assert.equal(fixture.lifecycle.turnState.getTurnState("run-1"), null);
  assert.equal(fixture.lifecycle.turnState.getToolInvocationScope("tool-get-1"), null);
});

test("runtime gate rejection records skip telemetry without executing Hybrid search", async () => {
  let hybridCalls = 0;
  const fixture = createLifecycle({ autoRecallConfig: { enabled: true } });
  const hybridContext = createHybridContext(fixture.events, async () => {
    hybridCalls += 1;
    return { results: [], debug: {} };
  });
  fixture.lifecycle.register(hybridContext);

  const beforePrompt = fixture.hooks.find(item => item.name === "before_prompt_build").handler;
  const result = await beforePrompt({ prompt: "memory-engine 当前状态" }, {
    runId: "run-denied",
    sessionId: "session-denied",
    trigger: "user",
  });

  assert.equal(result, undefined);
  assert.equal(hybridCalls, 0);
  assert.equal(fixture.events.filter(event => event.event_type === "auto_recall_debug").length, 1);
  const completed = fixture.events.find(event => event.event_type === "recall_completed");
  assert.equal(completed.metadata_json.skipped, true);
  assert.equal(completed.metadata_json.skip_reason, "denied_missing_agent_id");
});

test("session-scoped lifecycle rejects ordinary sessions before Hybrid search", async () => {
  let hybridCalls = 0;
  const fixture = createLifecycle({
    autoRecallConfig: { enabled: true, sessionAllowlist: ["h5-canary-session"] },
  });
  const hybridContext = createHybridContext(fixture.events, async () => {
    hybridCalls += 1;
    return { results: [], debug: {} };
  });
  fixture.lifecycle.register(hybridContext);

  const beforePrompt = fixture.hooks.find(item => item.name === "before_prompt_build").handler;
  const result = await beforePrompt({
    prompt: "memory-engine 当前状态",
    runId: "run-ordinary",
    sessionId: "ordinary-session",
  }, {
    agentId: "edi",
    trigger: "user",
    runId: "run-ordinary",
    sessionId: "ordinary-session",
  });

  assert.equal(result, undefined);
  assert.equal(hybridCalls, 0);
  const completed = fixture.events.find(event => event.event_type === "recall_completed");
  assert.equal(completed.metadata_json.skipped, true);
  assert.equal(completed.metadata_json.skip_reason, "denied_by_session_allowlist");
  assert.equal(fixture.events.some(event => event.event_type === "memory_injected"), false);
});

test("intent-skipped recall exposes bounded task and recall metadata", async () => {
  const fixture = createLifecycle({ autoRecallConfig: { enabled: true } });
  const hybridContext = createHybridContext(fixture.events, async () => {
    throw new Error("intent skip path must not execute Hybrid Search");
  });
  fixture.lifecycle.register(hybridContext);

  const beforePrompt = fixture.hooks.find(item => item.name === "before_prompt_build").handler;
  await beforePrompt({
    prompt: `请润色下面这段文字，保持原意。\n${"LOG_LINE body\n".repeat(80)}`,
    runId: "run-intent-skip",
    sessionId: "session-intent-skip",
  }, {
    agentId: "edi",
    trigger: "user",
    runId: "run-intent-skip",
    sessionId: "session-intent-skip",
  });

  const debug = fixture.events.find(event => event.event_type === "auto_recall_debug");
  assert.equal(debug.metadata_json.task_intent, "rewrite_current_text");
  assert.deepEqual(debug.metadata_json.recall_intent, ["none"]);
  assert.equal(debug.metadata_json.skipped_by_recall_intent, true);
});

test("allowed prompt executes Hybrid and stores injected reinforcement state", async () => {
  const fixture = createLifecycle({
    autoRecallConfig: { enabled: true, topK: 2, sessionAllowlist: ["session-allowed"] },
  });
  const candidate = {
    id: "abcdef1234567890",
    memory_id: "abcdef1234567890-full",
    path: "memory/smart-add/2026-05-26.md",
    text: "兼容性结论：OpenClaw memory-engine 在 5.20+ 可用",
    category: "episodic",
    confidence: 0.82,
    final_score: 0.12,
    sources: ["fts"],
  };
  const hybridContext = createHybridContext(fixture.events, async () => ({
    pool: "hybrid",
    channels: ["fts"],
    channel_sizes: { fts: 1 },
    results: [candidate],
    debug: {
      query_stripped: "5.20+ 和 memory-engine 兼容性",
      strict_count: 1,
      fallback_count: 0,
      post_rerank_topK: [{ id: candidate.id, score: candidate.final_score }],
    },
  }));
  fixture.lifecycle.register(hybridContext);

  const beforePrompt = fixture.hooks.find(item => item.name === "before_prompt_build").handler;
  const result = await beforePrompt({
    prompt: "5.20+ 和 memory-engine 兼容性",
    runId: "run-allowed",
    sessionId: "session-allowed",
  }, {
    agentId: "edi",
    trigger: "user",
    runId: "run-allowed",
    sessionId: "session-allowed",
  });

  assert.match(result.prependContext, /abcdef1234567890/);
  const state = fixture.lifecycle.turnState.getTurnState("run-allowed");
  assert.deepEqual(state.injectedIds, ["abcdef1234567890"]);
  assert.deepEqual(state.reinforcementAllowedIds, ["abcdef1234567890"]);
  assert.deepEqual(state.reinforcementAllowedExactIds, ["abcdef1234567890-full"]);
  assert.equal(fixture.events.some(event => event.event_type === "hybrid_search_observation"), true);
  assert.equal(fixture.events.some(event => event.event_type === "memory_candidate_retrieved"), true);
  assert.equal(fixture.events.some(event => event.event_type === "memory_injected"), true);
  assert.equal(fixture.events.some(event => event.event_type === "recall_completed"), true);
  const started = fixture.events.find(event => event.event_type === "recall_started");
  assert.equal(Object.hasOwn(started.metadata_json, "prompt"), false);
  assert.equal(Object.hasOwn(started.metadata_json, "focused_query"), false);
  assert.equal(started.metadata_json.task_intent, "answer_question");
  assert.deepEqual(started.metadata_json.recall_intent, ["none"]);
  const retrieved = fixture.events.find(event => event.event_type === "memory_candidate_retrieved");
  assert.equal(Object.hasOwn(retrieved.metadata_json, "preview"), false);
  const injectedEvent = fixture.events.find(event => event.event_type === "memory_injected");
  assert.equal(Object.hasOwn(injectedEvent.metadata_json, "preview"), false);
  const recallDebug = fixture.events.find(event => event.event_type === "auto_recall_debug");
  assert.equal(recallDebug.metadata_json.task_intent, "answer_question");
  assert.deepEqual(recallDebug.metadata_json.recall_intent, ["none"]);
  assert.match(fixture.getSupplement()({ sessionId: "session-allowed" }).join("\n"), /MEMORY_SUPPLEMENT_INJECTED_COUNT: 1/);
});

test("finalize reinforces only current-turn allowed ids and always clears state", async () => {
  const reinforced = [];
  const fixture = createLifecycle({
    autoRecallConfig: { enabled: true },
    batchReinforce: (_db, ids, nowSec) => {
      reinforced.push({ ids, nowSec });
      return ids.length;
    },
  });
  fixture.lifecycle.register({});
  fixture.lifecycle.turnState.createTurnState({
    runId: "run-2",
    sessionId: "session-2",
    traceId: "trace-2",
  });
  fixture.lifecycle.turnState.updateTurnRecallState({
    runId: "run-2",
    sessionId: "session-2",
    traceId: "trace-2",
    injectedIds: ["abcdef1234567890"],
    reinforcementAllowedIds: ["abcdef1234567890"],
    reinforcementAllowedExactIds: ["abcdef1234567890-full"],
  });

  const finalize = fixture.hooks.find(item => item.name === "before_agent_finalize").handler;
  await finalize({
    runId: "run-2",
    sessionId: "session-2",
    lastAssistantMessage: 'used memory\ncited_memory_ids: ["abcdef1234567890"]',
  }, { runId: "run-2", sessionId: "session-2" });

  assert.deepEqual(reinforced, [{
    ids: ["abcdef1234567890-full"],
    nowSec: 1_700_000_000,
  }]);
  assert.equal(fixture.events.some(event => event.event_type === "memory_cited"), true);
  assert.equal(fixture.events.some(event => event.event_type === "memory_reinforced"), true);
  assert.equal(fixture.lifecycle.turnState.getTurnState("run-2"), null);
});

test("finalize ignores prose hex strings without explicit citation metadata", async () => {
  const reinforced = [];
  const fixture = createLifecycle({
    autoRecallConfig: { enabled: true },
    batchReinforce: (_db, ids, nowSec) => {
      reinforced.push({ ids, nowSec });
      return ids.length;
    },
  });
  fixture.lifecycle.register({});
  fixture.lifecycle.turnState.createTurnState({
    runId: "run-no-citation",
    sessionId: "session-no-citation",
    traceId: "trace-no-citation",
  });
  const scopeHook = fixture.hooks[2].handler;
  await scopeHook({
    toolName: "memory_engine_get",
    toolCallId: "tool-no-citation",
    runId: "run-no-citation",
  }, {
    runId: "run-no-citation",
    sessionId: "session-no-citation",
  });
  fixture.lifecycle.onMemoryEngineGetSuccess("abcdef1234567890", { _toolCallId: "tool-no-citation" });

  const finalize = fixture.hooks.find(item => item.name === "before_agent_finalize").handler;
  await finalize({
    runId: "run-no-citation",
    sessionId: "session-no-citation",
    lastAssistantMessage: "SHA 16b564a433300dce\ncandidate d6a91685ad9a172f",
  }, { runId: "run-no-citation", sessionId: "session-no-citation" });

  assert.deepEqual(reinforced, []);
  assert.equal(fixture.events.some(event => event.metadata_json?.debug_type === "reinforcement_gate"), false);
  assert.equal(fixture.events.some(event => event.event_type === "memory_cited"), false);
  assert.equal(fixture.events.some(event => event.event_type === "memory_reinforced"), false);
  assert.equal(fixture.lifecycle.turnState.getTurnState("run-no-citation"), null);
  assert.equal(fixture.lifecycle.turnState.getToolInvocationScope("tool-no-citation"), null);
});
