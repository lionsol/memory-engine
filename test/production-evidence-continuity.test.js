import test from "node:test";
import assert from "node:assert/strict";
import { evaluateProductionEvidenceContinuity } from "../lib/recall/hybrid/production-evidence-continuity.js";

const identity = {
  production_evidence_enabled: true,
  evidence_epoch_id: "epoch-1",
  runtime_build_identity: "a".repeat(64),
  rollout_config_fingerprint: "b".repeat(64),
};

function observation(surface, timestamp, origin = surface === "auto_recall" ? "natural_user_turn" : "natural_agent_tool_call", overrides = {}) {
  const evidence = origin === "natural_user_turn"
    ? {
      source: "before_prompt_build",
      agent_id_present: true,
      run_id_present: true,
      session_id_present: true,
      tool_call_id_present: false,
      trigger: "user",
    }
    : origin === "natural_agent_tool_call"
      ? {
        source: "before_tool_call_agent",
        agent_id_present: true,
        run_id_present: true,
        session_id_present: true,
        tool_call_id_present: true,
        trigger: null,
      }
      : origin === "operator_verification_probe"
        ? {
          source: "gateway_tools_invoke",
          agent_id_present: true,
          run_id_present: false,
          session_id_present: true,
          tool_call_id_present: true,
          tool_call_transport: "http",
          trigger: null,
        }
        : {
          source: origin === "scheduled_healthcheck" ? "scheduled_healthcheck_wrapper" : "before_tool_call",
          agent_id_present: origin === "scheduled_healthcheck",
          run_id_present: false,
          session_id_present: origin === "scheduled_healthcheck",
          tool_call_id_present: origin === "scheduled_healthcheck",
          trigger: null,
        };
  return {
    event_type: "hybrid_search_observation",
    source: `hybrid.${surface}`,
    trace_id: `${surface}-${timestamp}`,
    session_id: surface === "auto_recall" ? "session-1" : null,
    metadata_json: {
      schema_version: 1,
      surface,
      search_executed: true,
      completed_at: timestamp,
      traffic_origin: origin,
      traffic_origin_schema_version: 1,
      traffic_origin_evidence: evidence,
      traffic_origin_valid: origin !== "unknown",
      traffic_origin_reasons: origin === "unknown" ? ["unknown_fixture_origin"] : [],
      ...identity,
      ...overrides,
    },
  };
}

function smallThresholds(overrides = {}) {
  return {
    minimum_window_days: 0,
    minimum_active_utc_days: 1,
    minimum_active_day_ratio: 0,
    maximum_observation_gap_hours: 72,
    minimum_observations: 1,
    minimum_surface_observations: 1,
    minimum_surface_active_days: 1,
    ...overrides,
  };
}

function allSurfaces(timestamp, overrides = {}) {
  return [
    observation("auto_recall", timestamp, "natural_user_turn", overrides),
    observation("memory_engine_search", timestamp, "natural_agent_tool_call", overrides),
    observation("memory_engine_action_search", timestamp, "natural_agent_tool_call", overrides),
  ];
}

test("empty evidence is structurally blocked", () => {
  const result = evaluateProductionEvidenceContinuity({
    observations: [],
    thresholds: smallThresholds(),
  });
  assert.equal(result.status, "blocked");
  assert.ok(result.evidence_gaps.some(item => item.code === "observations_below_threshold"));
});

test("natural rows count by surface while probes and healthchecks stay separate", () => {
  const result = evaluateProductionEvidenceContinuity({
    observations: [
      ...allSurfaces("2026-07-01T00:00:00.000Z"),
      observation("memory_engine_search", "2026-07-02T00:00:00.000Z", "operator_verification_probe"),
      observation("memory_engine_search", "2026-07-03T00:00:00.000Z", "scheduled_healthcheck"),
    ],
    thresholds: smallThresholds({ minimum_observations: 3 }),
  });
  assert.equal(result.status, "continuity_ready");
  assert.equal(result.natural_observation_count, 3);
  assert.equal(result.probe_observation_count, 1);
  assert.equal(result.healthcheck_observation_count, 1);
  assert.equal(result.natural_observed_by_surface.memory_engine_search, 1);
  assert.equal(result.active_utc_days, 1);
});

test("first and last observations do not prove active continuity", () => {
  const result = evaluateProductionEvidenceContinuity({
    observations: [
      ...allSurfaces("2026-07-01T00:00:00.000Z"),
      ...allSurfaces("2026-07-31T00:00:00.000Z"),
    ],
    thresholds: smallThresholds({
      minimum_window_days: 30,
      minimum_active_utc_days: 24,
      minimum_surface_active_days: 15,
    }),
  });
  assert.equal(result.status, "continuity_collecting");
  assert.equal(result.active_utc_days, 2);
  assert.ok(result.evidence_gaps.some(item => item.code === "active_days_below_threshold"));
  assert.ok(result.maximum_observation_gap_hours >= 719);
});

test("a gap above threshold is an evidence gap and probes cannot fill it", () => {
  const result = evaluateProductionEvidenceContinuity({
    observations: [
      ...allSurfaces("2026-07-01T00:00:00.000Z"),
      observation("memory_engine_search", "2026-07-04T00:00:00.000Z", "operator_verification_probe"),
      ...allSurfaces("2026-07-05T00:00:00.000Z"),
    ],
    thresholds: smallThresholds({ maximum_observation_gap_hours: 48 }),
  });
  assert.equal(result.status, "continuity_collecting");
  assert.ok(result.evidence_gaps.some(item => item.code === "maximum_gap_above_threshold"));
  assert.equal(result.active_utc_days, 2);
});

test("mixed identity blocks continuity", () => {
  const result = evaluateProductionEvidenceContinuity({
    observations: [
      ...allSurfaces("2026-07-01T00:00:00.000Z"),
      ...allSurfaces("2026-07-02T00:00:00.000Z", { evidence_epoch_id: "epoch-2" }),
    ],
    thresholds: smallThresholds(),
  });
  assert.equal(result.status, "blocked");
  assert.ok(result.continuity_blockers.some(item => item.code === "mixed_evidence_epoch"));
});

test("unknown origin and natural origin surface mismatch block continuity", () => {
  const unknown = evaluateProductionEvidenceContinuity({
    observations: [observation("memory_engine_search", "2026-07-01T00:00:00.000Z", "unknown")],
    thresholds: smallThresholds(),
  });
  assert.equal(unknown.status, "blocked");
  assert.ok(unknown.continuity_blockers.some(item => item.code === "unknown_traffic_origin"));

  const mismatch = evaluateProductionEvidenceContinuity({
    observations: [observation("auto_recall", "2026-07-01T00:00:00.000Z", "natural_agent_tool_call")],
    thresholds: smallThresholds(),
  });
  assert.equal(mismatch.status, "blocked");
  assert.ok(mismatch.continuity_blockers.some(item => item.code === "natural_origin_surface_mismatch"));
});

test("origin evidence must match the claimed natural origin", () => {
  const row = observation("memory_engine_search", "2026-07-01T00:00:00.000Z", "natural_agent_tool_call", {
    traffic_origin_evidence: { source: "bogus" },
  });
  const result = evaluateProductionEvidenceContinuity({
    observations: [row],
    thresholds: smallThresholds(),
  });
  assert.equal(result.status, "blocked");
  assert.ok(result.continuity_blockers.some(item => item.code === "origin_evidence_shape_invalid"));
  assert.ok(result.continuity_blockers.some(item => item.code === "origin_evidence_mismatch"));
});

test("per-surface continuity includes leading and trailing window gaps", () => {
  const rows = [
    observation("auto_recall", "2026-06-30T00:00:00.000Z"),
    observation("auto_recall", "2026-07-01T00:00:00.000Z"),
    observation("memory_engine_search", "2026-07-01T00:00:00.000Z"),
    observation("memory_engine_action_search", "2026-07-01T00:00:00.000Z"),
    observation("memory_engine_search", "2026-07-15T00:00:00.000Z"),
    observation("memory_engine_action_search", "2026-07-15T00:00:00.000Z"),
    ...[...Array(29)].flatMap((_, index) => [
      observation("auto_recall", `2026-07-${String(index + 2).padStart(2, "0")}T00:00:00.000Z`),
    ]),
    observation("auto_recall", "2026-07-31T00:00:00.000Z"),
  ];
  const result = evaluateProductionEvidenceContinuity({
    observations: rows,
    thresholds: smallThresholds({
      minimum_window_days: 30,
      minimum_active_utc_days: 1,
      minimum_active_day_ratio: 0,
      maximum_observation_gap_hours: 72,
      minimum_surface_observations: 1,
      minimum_surface_active_days: 1,
    }),
  });
  assert.equal(result.status, "continuity_collecting");
  assert.ok(result.evidence_gaps.some(item => item.code === "surface_gap_above_threshold:memory_engine_search"));
  assert.ok(result.evidence_gaps.some(item => item.code === "surface_gap_above_threshold:memory_engine_action_search"));
  assert.ok(result.effective_maximum_gap_hours_by_surface.memory_engine_search > 72);
  assert.ok(result.leading_gap_hours_by_surface.memory_engine_search > 0);
  assert.ok(result.trailing_gap_hours_by_surface.memory_engine_search > 0);
});

test("zero thresholds cannot bypass structural readiness", () => {
  const result = evaluateProductionEvidenceContinuity({
    observations: [],
    thresholds: {
      minimum_window_days: 0,
      minimum_active_utc_days: 0,
      minimum_active_day_ratio: 0,
      maximum_observation_gap_hours: 0,
      minimum_observations: 0,
      minimum_surface_observations: 0,
      minimum_surface_active_days: 0,
    },
  });
  assert.notEqual(result.status, "continuity_ready");
  assert.ok(result.continuity_blockers.some(item => item.code === "no_qualifying_natural_observations"));
  assert.ok(result.continuity_blockers.some(item => item.code === "missing_natural_surface:auto_recall"));
});

test("threshold validation rejects unknown and invalid values", () => {
  const result = evaluateProductionEvidenceContinuity({
    observations: [],
    thresholds: {
      minimum_active_day_ratio: 2,
      minimum_observations: 1.5,
      unexpected: 1,
    },
  });
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.some(item => item.code === "unknown_threshold"));
  assert.ok(result.blockers.some(item => item.code === "invalid_threshold"));
});

test("missing A7.1 identity and origin evidence never becomes natural denominator", () => {
  const row = observation("auto_recall", "2026-07-01T00:00:00.000Z");
  delete row.metadata_json.evidence_epoch_id;
  delete row.metadata_json.traffic_origin;
  const result = evaluateProductionEvidenceContinuity({ observations: [row], thresholds: smallThresholds() });
  assert.equal(result.status, "blocked");
  assert.ok(result.continuity_blockers.some(item => item.code === "invalid_identity"));
  assert.ok(result.continuity_blockers.some(item => item.code === "missing_traffic_origin"));
});

test("synthetic or manually inserted rows never enter the natural denominator", () => {
  const result = evaluateProductionEvidenceContinuity({
    observations: [observation("auto_recall", "2026-07-01T00:00:00.000Z", "natural_user_turn", {
      synthetic_fixture: true,
    })],
    thresholds: smallThresholds(),
  });
  assert.equal(result.natural_observation_count, 0);
  assert.equal(result.status, "blocked");
  assert.ok(result.continuity_blockers.some(item => (
    item.code === "invalid_provenance"
    && item.actual === "non_production_observation"
  )));
});

test("CLI search observations are excluded from production continuity", () => {
  const result = evaluateProductionEvidenceContinuity({
    observations: [{
      ...observation("memory_engine_search", "2026-07-01T00:00:00.000Z"),
      source: "hybrid.cli_search",
      metadata_json: { ...observation("memory_engine_search", "2026-07-01T00:00:00.000Z").metadata_json, surface: "cli_search" },
    }],
    thresholds: smallThresholds(),
  });
  assert.equal(result.excluded_non_production_count, 1);
  assert.equal(result.natural_observation_count, 0);
});
