import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildHybridSearchObservation,
  recordHybridSearchObservation,
} from "../lib/recall/hybrid-observation.js";
import {
  createMemoryEngineExecute,
  createMemoryEngineSearchExecute,
} from "../lib/tools/memory-engine-actions.js";

function createRuntime(recorded, overrides = {}) {
  return {
    api: { config: {} },
    autoRouteCategory: () => "raw_log",
    dateStrInTimeZone: () => "2026-07-18",
    SMART_ADD_TIME_ZONE: "Asia/Shanghai",
    resolve: (...parts) => parts.join("/"),
    WORKSPACE: "/tmp/workspace",
    SMART_ADD_DIR: "memory/smart-add",
    buildSmartAddFingerprint: () => "fingerprint",
    appendSmartAdd: () => ({ appended: true }),
    syncIndexIfNeeded: async () => ({ synced: false }),
    catParams: () => ({ conf: 0.5, tau: 7 }),
    withDb: fn => fn({
      prepare: () => ({ all: () => [], get: () => null, run: () => ({}) }),
      transaction: callback => callback,
    }),
    getLancedbTable: () => null,
    generateEmbedding: async () => [],
    recordMemoryEvent: event => recorded.push(event),
    getMemorySearchManager: async () => ({ manager: null }),
    calcRealtimeConf: ({ confidence = 0 }) => Number(confidence || 0),
    existsSync: () => false,
    readFileSync: () => "",
    KG_PATH: "/tmp/workspace/knowledge-graph.json",
    resolvePrefixes: () => [],
    batchReinforce: () => 0,
    CATEGORY_MAP: {},
    calcTau: () => 0,
    hybridSearch: async () => ({
      pool: ["fts", "kg", "recent"],
      channels: { fts: [], kg: [], recent: [] },
      channel_sizes: { fts: 0, kg: 0, recent: 0 },
      debug: {
        kg_access_mode: "isolated",
        recent_access_mode: "isolated",
      },
      results: [],
    }),
    ...overrides,
  };
}

test("hybrid observation preserves canonical fields and derives fallback from access mode", () => {
  const observation = buildHybridSearchObservation({
    surface: "memory_engine_search",
    completedAtMs: Date.parse("2026-07-18T10:00:00Z"),
    result: {
      channel_sizes: { kg: 2, recent: 1 },
      results: [{ id: "opaque-id" }],
      debug: {
        kg_access_mode: "legacy_fallback",
        kg_isolated_fallback_reason: "text_id_invariant_failed",
        recent_access_mode: "isolated",
        kg_shadow_mode: "shadow_fail_closed",
        kg_shadow_would_fail_closed: true,
        kg_shadow_dropped_candidate_count: 1,
        kg_shadow_candidate_loss_ratio: 0.333,
        kg_shadow_overlap_count: 2,
        legacy_db_fallback_used: false,
        query: "must not persist",
      },
    },
  });

  assert.deepEqual(observation, {
    schema_version: 1,
    surface: "memory_engine_search",
    search_executed: true,
    legacy_db_fallback_used: true,
    legacy_db_fallback_channels: ["kg"],
    kg_candidate_count: 2,
    recent_candidate_count: 1,
    result_count: 1,
    channel_error_count: 0,
    completed_at: "2026-07-18T10:00:00.000Z",
    evidence_epoch_id: null,
    runtime_build_identity: null,
    rollout_config_fingerprint: null,
    production_evidence_enabled: false,
    traffic_origin: "unknown",
    traffic_origin_evidence: {
      source: "untrusted_context",
      agent_id_present: false,
      run_id_present: false,
      session_id_present: false,
      tool_call_id_present: false,
      trigger: null,
    },
    traffic_origin_valid: false,
    traffic_origin_reasons: ["missing_trusted_context"],
    traffic_origin_schema_version: 1,
    kg_shadow_mode: "shadow_fail_closed",
    kg_shadow_would_fail_closed: true,
    kg_shadow_dropped_candidate_count: 1,
    kg_shadow_candidate_loss_ratio: 0.333,
    kg_shadow_overlap_count: 2,
    kg_runtime_mode: null,
    kg_rollout_scope: null,
    kg_scope_required: null,
    kg_fail_closed_applied: null,
    kg_fail_closed_would_have_used_fallback: null,
    kg_fail_closed_fallback_suppressed: null,
    kg_fail_closed_scope_match: null,
    kg_fail_closed_empty_candidate: null,
    kg_fail_closed_candidate_loss_ratio: null,
    recent_shadow_mode: null,
    recent_shadow_would_fail_closed: null,
    recent_shadow_dropped_candidate_count: null,
    recent_shadow_candidate_loss_ratio: null,
    recent_shadow_overlap_count: null,
    recent_shadow_risk_level: null,
    recent_runtime_mode: null,
    recent_rollout_scope: null,
    recent_scope_required: null,
    recent_fail_closed_applied: null,
    recent_fail_closed_fallback_suppressed: null,
    recent_fail_closed_scope_match: null,
    recent_fail_closed_empty_candidate: null,
    kg_access_mode: "legacy_fallback",
    kg_isolated_fallback_reason: "text_id_invariant_failed",
    recent_access_mode: "isolated",
  });
  assert.equal(JSON.stringify(observation).includes("opaque-id"), false);
  assert.equal(JSON.stringify(observation).includes("must not persist"), false);
});

test("recordHybridSearchObservation writes one canonical event and preserves write failures", () => {
  const events = [];
  assert.equal(recordHybridSearchObservation({
    recordMemoryEvent: event => events.push(event),
    surface: "auto_recall",
    sessionId: "session-1",
    traceId: "trace-1",
    result: { debug: { kg_access_mode: "isolated" }, results: [] },
  }), true);
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, "hybrid_search_observation");
  assert.equal(events[0].source, "hybrid.auto_recall");
  assert.equal(events[0].session_id, "session-1");
  assert.equal(events[0].trace_id, "trace-1");
  assert.equal(Object.hasOwn(events[0].metadata_json, "kg_access_mode"), true);
  assert.equal(Object.hasOwn(events[0].metadata_json, "recent_access_mode"), false);
  assert.equal(events[0].metadata_json.production_evidence_enabled, false);
  assert.equal(recordHybridSearchObservation({
    recordMemoryEvent: () => {
      throw new Error("event store unavailable");
    },
    surface: "auto_recall",
    result: {},
  }), false);
});

test("identity metadata comes only from the registration context", async () => {
  const events = [];
  const identityContext = {
    productionEvidenceEnabled: true,
    evidenceEpochId: "epoch-reviewed",
    runtimeBuildIdentity: "a".repeat(64),
    rolloutConfigFingerprint: "b".repeat(64),
  };
  const runtime = createRuntime(events, {
    productionEvidenceIdentityContext: identityContext,
  });
  const executeAction = createMemoryEngineExecute(runtime);
  await executeAction("tool-call", {
    action: "search",
    text: "query text",
    evidence_epoch_id: "forged-epoch",
    runtime_build_identity: "f".repeat(64),
  });
  assert.equal(events[0].metadata_json.production_evidence_enabled, true);
  assert.equal(events[0].metadata_json.evidence_epoch_id, "epoch-reviewed");
  assert.equal(events[0].metadata_json.runtime_build_identity, "a".repeat(64));
  assert.equal(events[0].metadata_json.rollout_config_fingerprint, "b".repeat(64));
});

test("action search and memory_engine_search emit distinct observation surfaces", async () => {
  const events = [];
  const runtime = createRuntime(events, {
    resolveTrafficOriginContext: () => ({
      source: "before_tool_call",
      agentId: "edi",
      runId: "run-1",
      sessionId: "session-1",
      toolCallId: "tool-1",
    }),
  });
  const executeAction = createMemoryEngineExecute(runtime);
  const executeSearch = createMemoryEngineSearchExecute(runtime);

  await executeAction("action-tool", { action: "search", text: "alpha", top_k: 3 });
  await executeSearch("search-tool", { query: "beta", top_k: 3 });

  assert.deepEqual(events.map(event => event.metadata_json.surface), [
    "memory_engine_action_search",
    "memory_engine_search",
  ]);
  assert.deepEqual(events.map(event => event.event_type), [
    "hybrid_search_observation",
    "hybrid_search_observation",
  ]);
  assert.deepEqual(events.map(event => event.metadata_json.traffic_origin), [
    "natural_agent_tool_call",
    "natural_agent_tool_call",
  ]);

  const cliEvents = [];
  const cliAction = createMemoryEngineExecute(createRuntime(cliEvents, {
    hybridObservationSurface: "cli_search",
  }));
  await cliAction("cli-tool", { action: "search", text: "gamma", top_k: 3 });
  assert.equal(cliEvents[0].metadata_json.surface, "cli_search");
});

test("production and CLI runtimes declare separate observation surfaces", () => {
  const indexSource = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  const cliSource = readFileSync(new URL("../lib/services/memory-engine-cli-service.js", import.meta.url), "utf8");
  assert.match(indexSource, /surface: "auto_recall"/);
  assert.match(indexSource, /createMemoryEngineSearchExecute\(\{[\s\S]*?recordMemoryEvent,/);
  assert.match(cliSource, /hybridObservationSurface: "cli_search"/);
});
