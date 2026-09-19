import test from "node:test";
import assert from "node:assert/strict";

import { createAutoRecallHookLifecycle } from "../lib/recall/auto-recall-hook-lifecycle.js";
import {
  Q6_SHADOW_AUTORECALL_DECISION_SCHEMA_V1,
  buildQ6ShadowAutoRecallDecisionV1,
  resolveAutoRecallShadowScope,
} from "../lib/recall/auto-recall-shadow.js";
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
      withHybridDbAccessScope: run => run({
        withCoreDb: fn => fn({}),
        withEngineDb: fn => fn({}),
      }),
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

function candidate() {
  return {
    id: "abcdef1234567890",
    memory_id: "abcdef1234567890-full",
    canonical_id: "canonical-abcdef1234567890",
    path: "memory/smart-add/2026-09-19.md",
    text: "兼容性结论：OpenClaw memory-engine 在 5.20+ 可用",
    category: "episodic",
    confidence: 0.82,
    final_score: 0.12,
    sources: ["fts"],
  };
}

function directCardSelection(memory) {
  const selection = {
    candidate_index: 0,
    memory_id: memory.memory_id,
    canonical_id: memory.canonical_id,
    decision: "DISCLOSE_CARD",
    reason: "card_capability_and_retrieval_evidence_pass",
    card: {
      schema_version: 1,
      card_id: "card-abcdef",
      title: "Compatibility",
      summary: "SECRET_CARD_SUMMARY_SHOULD_NOT_ENTER_Q6_ENVELOPE",
      salience_reason: "Relevant compatibility memory",
      source_hint: "memory/smart-add/2026-09-19.md:1",
      category: "episodic",
      kind: "fact",
      confidence_score: 0.82,
      risk_flags: [],
    },
  };
  return {
    ownerAudienceAuthenticated: true,
    capabilityResults: [{
      candidate_index: 0,
      memory_id: memory.memory_id,
      canonical_id: memory.canonical_id,
      capability: "CARD_DISCLOSABLE",
      reason: "card_allowed",
    }],
    selections: [selection],
    selected: [selection],
  };
}

function createLifecycle({
  autoRecallConfig,
  hybridSearch,
  evaluateDirectCardBoundary,
  batchReinforce = () => 0,
} = {}) {
  const events = [];
  const fixture = createApi();
  const lifecycle = createAutoRecallHookLifecycle({
    api: fixture.api,
    autoRecallConfig,
    recordMemoryEvent: event => events.push(event),
    withDb: fn => fn({}),
    batchReinforce,
    now: () => 1_700_000_000_000,
    randomUUID: () => "trace-q6",
    evaluateDirectCardBoundary,
  });
  lifecycle.register(createHybridContext(events, hybridSearch));
  return { ...fixture, lifecycle, events };
}

function beforePrompt(fixture) {
  return fixture.hooks.find(item => item.name === "before_prompt_build").handler;
}

function activeConfig(overrides = {}) {
  return {
    enabled: true,
    topK: 3,
    timeoutMs: 500,
    agentAllowlist: ["edi"],
    triggerAllowlist: ["user"],
    chatTypeAllowlist: ["interactive_user_chat"],
    messageRoleAllowlist: ["user"],
    cardFirstRuntime: { enabled: true },
    shadow: { enabled: false, sessionAllowlist: [] },
    ...overrides,
  };
}

test("Q6 shadow scope is exact-session and disabled by default", () => {
  assert.deepEqual(resolveAutoRecallShadowScope({}, "session-a"), {
    active: false,
    reason: "shadow_disabled",
  });
  assert.equal(
    resolveAutoRecallShadowScope({
      shadow: { enabled: true, sessionAllowlist: ["session-a"] },
    }, "session-a").active,
    true,
  );
  assert.equal(
    resolveAutoRecallShadowScope({
      shadow: { enabled: true, sessionAllowlist: ["session-a"] },
    }, "SESSION-A").reason,
    "shadow_session_not_allowlisted",
  );
});

test("Q6 shadow envelope is bounded and excludes card or memory content", () => {
  const memory = candidate();
  const directCard = directCardSelection(memory);
  const envelope = buildQ6ShadowAutoRecallDecisionV1({
    runtimeGate: { allowed: true, agentId: "edi", trigger: "user" },
    searchExecuted: true,
    focusedQueryUsed: false,
    originalInputChars: 42,
    focusedQueryChars: 42,
    candidates: [memory],
    candidateCount: 1,
    candidateCountAfterGate: 1,
    gateDecisions: [{
      id: memory.id,
      injected: true,
      category: memory.category,
      final_score: memory.final_score,
    }],
    capabilityResults: directCard.capabilityResults,
    selections: directCard.selections,
    wouldInjectEntries: [{ memory, selection: directCard.selected[0] }],
  });

  assert.equal(envelope.schema, Q6_SHADOW_AUTORECALL_DECISION_SCHEMA_V1);
  assert.equal(envelope.mode, "shadow");
  assert.equal(envelope.apply_suppressed, true);
  assert.equal(envelope.would_inject_count, 1);
  assert.deepEqual(envelope.would_inject_ids, ["abcdef1234567890"]);
  assert.equal(envelope.candidate_decisions[0].would_inject, true);
  assert.equal(envelope.candidate_decisions[0].capability, "CARD_DISCLOSABLE");
  assert.deepEqual(envelope.timings, {
    retrieval_ms: 0,
    decision_ms: 0,
    total_ms: 0,
  });
  const serialized = JSON.stringify(envelope);
  assert.equal(serialized.includes(memory.text), false);
  assert.equal(serialized.includes(directCard.selected[0].card.summary), false);
  assert.equal(serialized.includes(directCard.selected[0].card.source_hint), false);
});

test("Q6 shadow envelope retains gate-rejected candidates without inventing capability", () => {
  const memory = candidate();
  const directCard = directCardSelection(memory);
  const envelope = buildQ6ShadowAutoRecallDecisionV1({
    runtimeGate: { allowed: true, agentId: "edi", trigger: "user" },
    searchExecuted: true,
    candidates: [memory, {
      id: "rejected123456789",
      category: "raw_log",
      final_score: 0.01,
    }],
    candidateCount: 2,
    candidateCountAfterGate: 1,
    gateDecisions: [{
      id: memory.id,
      injected: true,
      category: memory.category,
      final_score: memory.final_score,
    }, {
      id: "rejected123456789",
      injected: false,
      rejection_reason: "raw_log_final_score_below_minimum",
      category: "raw_log",
      final_score: 0.01,
    }],
    capabilityResults: directCard.capabilityResults,
    selections: directCard.selections,
    wouldInjectEntries: [{ memory, selection: directCard.selected[0] }],
  });

  assert.equal(envelope.candidate_decisions.length, 2);
  assert.equal(envelope.candidate_decisions[0].capability, "CARD_DISCLOSABLE");
  assert.equal(envelope.candidate_decisions[0].would_inject, true);
  assert.equal(envelope.candidate_decisions[1].gate_pass, false);
  assert.equal(envelope.candidate_decisions[1].gate_reason, "raw_log_final_score_below_minimum");
  assert.equal(envelope.candidate_decisions[1].capability, null);
  assert.equal(envelope.candidate_decisions[1].selection_decision, null);
  assert.equal(envelope.candidate_decisions[1].would_inject, false);
});

test("exact-session Q6 shadow matches active card decision but suppresses apply and reinforcement authority", async () => {
  const memory = candidate();
  let activeSearchCalls = 0;
  let shadowSearchCalls = 0;
  let activeBoundaryCalls = 0;
  let shadowBoundaryCalls = 0;
  let shadowReinforceCalls = 0;

  const active = createLifecycle({
    autoRecallConfig: activeConfig(),
    hybridSearch: async () => {
      activeSearchCalls += 1;
      return {
        results: [memory],
        debug: {
          query_stripped: "5.20+ 和 memory-engine 兼容性",
          strict_count: 1,
          fallback_count: 0,
          post_rerank_topK: [{ id: memory.id, score: memory.final_score }],
        },
      };
    },
    evaluateDirectCardBoundary: async () => {
      activeBoundaryCalls += 1;
      return directCardSelection(memory);
    },
  });

  const activeResult = await beforePrompt(active)({
    prompt: "5.20+ 和 memory-engine 兼容性",
    runId: "run-active",
    sessionId: "session-active",
    senderIsOwner: true,
  }, {
    agentId: "edi",
    trigger: "user",
    runId: "run-active",
    sessionId: "session-active",
  });

  assert.match(activeResult.prependContext, /memory cards/i);
  const activeInjected = active.events
    .filter(event => event.event_type === "memory_injected")
    .map(event => event.memory_id);
  assert.deepEqual(activeInjected, ["abcdef1234567890"]);
  assert.equal(activeSearchCalls, 1);
  assert.equal(activeBoundaryCalls, 1);

  const shadow = createLifecycle({
    autoRecallConfig: activeConfig({
      shadow: { enabled: true, sessionAllowlist: ["session-shadow"] },
    }),
    hybridSearch: async () => {
      shadowSearchCalls += 1;
      return {
        results: [memory],
        debug: {
          query_stripped: "5.20+ 和 memory-engine 兼容性",
          strict_count: 1,
          fallback_count: 0,
          post_rerank_topK: [{ id: memory.id, score: memory.final_score }],
        },
      };
    },
    evaluateDirectCardBoundary: async () => {
      shadowBoundaryCalls += 1;
      return directCardSelection(memory);
    },
    batchReinforce: () => {
      shadowReinforceCalls += 1;
      return 1;
    },
  });

  const shadowResult = await beforePrompt(shadow)({
    prompt: "5.20+ 和 memory-engine 兼容性",
    runId: "run-shadow",
    sessionId: "session-shadow",
    senderIsOwner: true,
  }, {
    agentId: "edi",
    trigger: "user",
    runId: "run-shadow",
    sessionId: "session-shadow",
  });

  assert.equal(shadowResult, undefined);
  assert.equal(shadowSearchCalls, 1);
  assert.equal(shadowBoundaryCalls, 1);
  assert.equal(shadow.events.some(event => event.event_type === "memory_injected"), false);

  const q6Event = shadow.events.find(
    event => event.event_type === "auto_recall_debug" &&
      event.metadata_json?.debug_type === "q6_shadow_decision",
  );
  assert.ok(q6Event);
  assert.deepEqual(q6Event.metadata_json.would_inject_ids, activeInjected);
  assert.equal(q6Event.metadata_json.would_inject_count, 1);
  assert.equal(q6Event.metadata_json.apply_suppressed, true);
  assert.deepEqual(q6Event.metadata_json.timings, {
    retrieval_ms: 0,
    decision_ms: 0,
    total_ms: 0,
  });

  const completed = shadow.events.find(event => event.event_type === "recall_completed");
  assert.equal(completed.injected_count, 0);
  assert.equal(completed.metadata_json.injected_count, 0);

  const shadowState = shadow.lifecycle.turnState.getTurnState("run-shadow");
  assert.deepEqual(shadowState.injectedIds, []);
  assert.deepEqual(shadowState.reinforcementAllowedIds, []);
  assert.deepEqual(shadowState.reinforcementAllowedExactIds, []);
  assert.match(shadow.getSupplement()({ sessionId: "session-shadow" }).join("\n"), /MEMORY_SUPPLEMENT_INJECTED_COUNT: 0/);

  const finalize = shadow.hooks.find(item => item.name === "before_agent_finalize").handler;
  await finalize({
    runId: "run-shadow",
    sessionId: "session-shadow",
    lastAssistantMessage: 'cited_memory_ids: ["abcdef1234567890"]',
  }, {
    runId: "run-shadow",
    sessionId: "session-shadow",
  });
  assert.equal(shadowReinforceCalls, 0);

  const serializedEvents = JSON.stringify(shadow.events);
  assert.equal(serializedEvents.includes(memory.text), false);
  assert.equal(
    serializedEvents.includes("SECRET_CARD_SUMMARY_SHOULD_NOT_ENTER_Q6_ENVELOPE"),
    false,
  );
});

test("non-shadow sessions retain the active card-first path", async () => {
  const memory = candidate();
  let searchCalls = 0;
  const fixture = createLifecycle({
    autoRecallConfig: activeConfig({
      shadow: { enabled: true, sessionAllowlist: ["different-session"] },
    }),
    hybridSearch: async () => {
      searchCalls += 1;
      return {
        results: [memory],
        debug: { query_stripped: "5.20+ 和 memory-engine 兼容性" },
      };
    },
    evaluateDirectCardBoundary: async () => directCardSelection(memory),
  });

  const result = await beforePrompt(fixture)({
    prompt: "5.20+ 和 memory-engine 兼容性",
    runId: "run-nonshadow",
    sessionId: "ordinary-session",
    senderIsOwner: true,
  }, {
    agentId: "edi",
    trigger: "user",
    runId: "run-nonshadow",
    sessionId: "ordinary-session",
  });

  assert.equal(searchCalls, 1);
  assert.match(result.prependContext, /memory cards/i);
  assert.equal(
    fixture.events.some(event => event.metadata_json?.debug_type === "q6_shadow_decision"),
    false,
  );
  assert.equal(fixture.events.some(event => event.event_type === "memory_injected"), true);
});

test("shadow structural skips remain retrieval-free and record would-inject zero", async () => {
  let searchCalls = 0;
  const fixture = createLifecycle({
    autoRecallConfig: activeConfig({
      shadow: { enabled: true, sessionAllowlist: ["session-shadow-skip"] },
    }),
    hybridSearch: async () => {
      searchCalls += 1;
      return { results: [], debug: {} };
    },
    evaluateDirectCardBoundary: async () => {
      throw new Error("boundary must not run");
    },
  });

  const result = await beforePrompt(fixture)({
    prompt: "hello",
    runId: "run-shadow-skip",
    sessionId: "session-shadow-skip",
    senderIsOwner: true,
  }, {
    agentId: "edi",
    trigger: "user",
    runId: "run-shadow-skip",
    sessionId: "session-shadow-skip",
  });

  assert.equal(result, undefined);
  assert.equal(searchCalls, 0);
  const q6Event = fixture.events.find(event => event.metadata_json?.debug_type === "q6_shadow_decision");
  assert.ok(q6Event);
  assert.equal(q6Event.metadata_json.shadow_status, "skipped");
  assert.equal(q6Event.metadata_json.structural_skip_reason, "greeting");
  assert.equal(q6Event.metadata_json.search_executed, false);
  assert.equal(q6Event.metadata_json.would_inject_count, 0);
});
