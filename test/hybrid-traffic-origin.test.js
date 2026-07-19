import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveHybridTrafficOrigin,
  TRAFFIC_ORIGIN_SCHEMA_VERSION,
} from "../lib/recall/hybrid/traffic-origin.js";
import { buildHybridSearchObservation } from "../lib/recall/hybrid-observation.js";

const userContext = {
  source: "openclaw_runtime",
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
    trustedRuntimeContext: { ...userContext, toolExecutionSource: "model_selected" },
  });
  assert.equal(result.origin, "natural_agent_tool_call");

  const unobservable = resolveHybridTrafficOrigin({
    surface: "memory_engine_search",
    trustedRuntimeContext: userContext,
  });
  assert.equal(unobservable.origin, "unknown");
  assert.ok(unobservable.reasons.includes("tool_origin_not_observable"));
});

test("trusted operator and healthcheck wrappers stay outside the natural denominator", () => {
  const probe = resolveHybridTrafficOrigin({
    surface: "memory_engine_action_search",
    trustedRuntimeContext: { ...userContext, toolExecutionSource: "operator_verification_probe" },
  });
  const healthcheck = resolveHybridTrafficOrigin({
    surface: "memory_engine_action_search",
    trustedRuntimeContext: { ...userContext, toolExecutionSource: "scheduled_healthcheck" },
  });
  assert.equal(probe.origin, "operator_verification_probe");
  assert.equal(healthcheck.origin, "scheduled_healthcheck");
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
  assert.equal(JSON.stringify(observation).includes("must not persist"), false);
});
