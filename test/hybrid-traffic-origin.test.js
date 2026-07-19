import test from "node:test";
import assert from "node:assert/strict";
import {
  createHybridTrafficOriginRegistry,
  resolveHybridTrafficOrigin,
  TRAFFIC_ORIGIN_SCHEMA_VERSION,
} from "../lib/recall/hybrid/traffic-origin.js";
import { buildHybridSearchObservation } from "../lib/recall/hybrid-observation.js";

const userContext = {
  source: "before_prompt_build",
  agentId: "edi",
  runId: "run-1",
  sessionId: "session-1",
  trigger: "user",
};

test("trusted AutoRecall user hook is natural_user_turn", () => {
  const result = resolveHybridTrafficOrigin({
    surface: "auto_recall",
    trustedRuntimeContext: userContext,
  });
  assert.equal(result.origin, "natural_user_turn");
  assert.equal(result.valid, true);
  assert.equal(result.schema_version, TRAFFIC_ORIGIN_SCHEMA_VERSION);
});

test("AutoRecall non-user trigger is never natural", () => {
  const result = resolveHybridTrafficOrigin({
    surface: "auto_recall",
    trustedRuntimeContext: { ...userContext, trigger: "heartbeat" },
  });
  assert.equal(result.origin, "unknown");
  assert.equal(result.valid, false);
});

test("tool origin requires trusted model-selection evidence", () => {
  const result = resolveHybridTrafficOrigin({
    surface: "memory_engine_search",
    trustedRuntimeContext: {
      source: "before_tool_call",
      agentId: "edi",
      runId: "run-1",
      sessionId: "session-1",
      toolCallId: "tool-1",
    },
  });
  assert.equal(result.origin, "natural_agent_tool_call");

  const unobservable = resolveHybridTrafficOrigin({
    surface: "memory_engine_search",
    trustedRuntimeContext: {
      source: "before_tool_call",
      agentId: "edi",
      sessionId: "session-1",
      toolCallId: "tool-1",
    },
  });
  assert.equal(unobservable.origin, "unknown");
  assert.ok(unobservable.reasons.includes("ambiguous_tool_origin"));
});

test("trusted operator and healthcheck wrappers stay outside the natural denominator", () => {
  const probe = resolveHybridTrafficOrigin({
    surface: "memory_engine_action_search",
    trustedRuntimeContext: {
      source: "before_tool_call",
      agentId: "edi",
      sessionId: "session-1",
      toolCallId: "http-1",
    },
  });
  const healthcheck = resolveHybridTrafficOrigin({
    surface: "memory_engine_action_search",
    trustedRuntimeContext: {
      source: "scheduled_healthcheck_wrapper",
      agentId: "edi",
      sessionId: "session-1",
      toolCallId: "health-1",
    },
  });
  assert.equal(probe.origin, "operator_verification_probe");
  assert.equal(healthcheck.origin, "scheduled_healthcheck");
});

test("host-shaped before_tool_call context does not require trigger or unsupported hints", () => {
  const result = resolveHybridTrafficOrigin({
    surface: "memory_engine_search",
    trustedRuntimeContext: {
      source: "before_tool_call",
      agentId: "edi",
      runId: "run-1",
      sessionKey: "session-1",
      toolCallId: "tool-1",
    },
  });
  assert.equal(result.origin, "natural_agent_tool_call");
  assert.equal(result.evidence.source, "before_tool_call_agent");
});

test("ambiguous and RPC tool invocations are not natural", () => {
  const rpc = resolveHybridTrafficOrigin({
    surface: "memory_engine_search",
    trustedRuntimeContext: {
      source: "before_tool_call",
      agentId: "edi",
      sessionId: "session-1",
      toolCallId: "rpc-1",
    },
  });
  const ambiguous = resolveHybridTrafficOrigin({
    surface: "memory_engine_search",
    trustedRuntimeContext: {
      source: "before_tool_call",
      agentId: "edi",
      sessionId: "session-1",
      toolCallId: "manual-1",
    },
  });
  assert.equal(rpc.origin, "operator_verification_probe");
  assert.equal(rpc.evidence.tool_call_transport, "rpc");
  assert.equal(ambiguous.origin, "unknown");
});

test("registration-owned registry stores and consumes trusted contexts", () => {
  const registry = createHybridTrafficOriginRegistry({ ttlMs: 1000 });
  assert.equal(registry.recordBeforeToolCall({
    event: { toolName: "memory_engine_search", toolCallId: "tool-1" },
    ctx: { agentId: "edi", runId: "run-1", sessionId: "session-1" },
    surface: "memory_engine_search",
  }), true);
  const context = registry.consume("tool-1", "memory_engine_search");
  assert.equal(context.source, "before_tool_call");
  assert.equal(registry.consume("tool-1", "memory_engine_search"), null);
});

test("same tool call id collides only within the TTL", () => {
  let currentTime = 0;
  const registry = createHybridTrafficOriginRegistry({ ttlMs: 1000, now: () => currentTime });
  const input = {
    event: { toolName: "memory_engine_search", toolCallId: "tool-1" },
    ctx: { agentId: "edi", runId: "run-1", sessionId: "session-1" },
    surface: "memory_engine_search",
  };
  registry.recordBeforeToolCall(input);
  registry.recordBeforeToolCall(input);
  const collided = registry.consume("tool-1", "memory_engine_search");
  assert.equal(resolveHybridTrafficOrigin({
    surface: "memory_engine_search",
    trustedRuntimeContext: collided,
  }).origin, "unknown");

  currentTime = 1001;
  registry.recordBeforeToolCall(input);
  const reused = registry.consume("tool-1", "memory_engine_search");
  assert.equal(reused.registry_reason, null);
  assert.equal(resolveHybridTrafficOrigin({
    surface: "memory_engine_search",
    trustedRuntimeContext: reused,
  }).origin, "natural_agent_tool_call");
});

test("expired entries are not consumable and scheduled entries share collision rules", () => {
  let currentTime = 0;
  const registry = createHybridTrafficOriginRegistry({ ttlMs: 1000, now: () => currentTime });
  registry.recordBeforeToolCall({
    event: { toolCallId: "expired" },
    ctx: { agentId: "edi", runId: "run-1", sessionId: "session-1" },
    surface: "memory_engine_search",
  });
  currentTime = 1001;
  assert.equal(registry.consume("expired", "memory_engine_search"), null);

  currentTime = 0;
  registry.recordScheduledHealthcheck({
    toolCallId: "health-1",
    agentId: "edi",
    sessionId: "session-1",
  });
  registry.recordBeforeToolCall({
    event: { toolCallId: "health-1" },
    ctx: { agentId: "edi", runId: "run-1", sessionId: "session-1" },
    surface: "memory_engine_search",
  });
  const collision = registry.consume("health-1", "memory_engine_search");
  assert.equal(resolveHybridTrafficOrigin({
    surface: "memory_engine_search",
    trustedRuntimeContext: collision,
  }).origin, "unknown");
});

test("registry capacity evicts the oldest entry without creating false natural origin", () => {
  const registry = createHybridTrafficOriginRegistry({ maxEntries: 2 });
  for (const toolCallId of ["tool-1", "tool-2", "tool-3"]) {
    registry.recordBeforeToolCall({
      event: { toolCallId },
      ctx: { agentId: "edi", runId: `run-${toolCallId}`, sessionId: "session-1" },
      surface: "memory_engine_search",
    });
  }
  assert.equal(registry.consume("tool-1", "memory_engine_search"), null);
  assert.equal(registry.consume("tool-2", "memory_engine_search")?.source, "before_tool_call");
});

test("missing trusted context is unknown and tool parameters cannot provide it", () => {
  const result = resolveHybridTrafficOrigin({
    surface: "memory_engine_search",
    invocationContext: {
      traffic_origin: "natural_agent_tool_call",
      query: "user-controlled",
    },
  });
  assert.equal(result.origin, "unknown");
  assert.equal(result.valid, false);
});

test("observation records origin fields without recording query content", () => {
  const observation = buildHybridSearchObservation({
    surface: "auto_recall",
    completedAtMs: Date.parse("2026-07-01T00:00:00.000Z"),
    trafficOriginContext: userContext,
    result: {
      results: [],
      debug: { query: "must not persist" },
    },
  });
  assert.equal(observation.traffic_origin, "natural_user_turn");
  assert.equal(observation.traffic_origin_schema_version, 1);
  assert.equal(observation.traffic_origin_valid, true);
  assert.deepEqual(observation.traffic_origin_reasons, []);
  assert.equal(JSON.stringify(observation).includes("must not persist"), false);
});
