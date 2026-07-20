import test from "node:test";
import assert from "node:assert/strict";
import { buildNaturalTrafficForecast } from "../lib/recall/hybrid/natural-traffic-forecast.js";

const AS_OF = "2026-07-30T23:00:00.000Z";

function observation(id, surface, completedAt, origin = "natural_agent_tool_call") {
  const natural = origin === "natural_agent_tool_call";
  return {
    id,
    event_type: "hybrid_search_observation",
    source: `hybrid.${surface}`,
    trace_id: `trace-${id}`,
    session_id: null,
    created_at: completedAt.replace("T", " ").replace(".000Z", ""),
    metadata_json: {
      schema_version: 1,
      surface,
      search_executed: true,
      completed_at: completedAt,
      traffic_origin_schema_version: 1,
      traffic_origin: origin,
      traffic_origin_valid: true,
      traffic_origin_reasons: [],
      traffic_origin_evidence: natural
        ? {
          source: "before_tool_call_agent",
          agent_id_present: true,
          run_id_present: true,
          session_id_present: true,
          tool_call_id_present: true,
          trigger: null,
        }
        : {
          source: "gateway_tools_invoke",
          agent_id_present: true,
          run_id_present: false,
          session_id_present: true,
          tool_call_id_present: true,
          tool_call_transport: "rpc",
          trigger: null,
        },
    },
  };
}

function healthyHistory() {
  const rows = [];
  let id = 0;
  for (let day = 1; day <= 30; day += 1) {
    for (let index = 0; index < 10; index += 1) {
      const hour = String(index).padStart(2, "0");
      rows.push(observation(++id, "memory_engine_search", `2026-07-${String(day).padStart(2, "0")}T${hour}:00:00.000Z`));
      rows.push(observation(++id, "memory_engine_action_search", `2026-07-${String(day).padStart(2, "0")}T${hour}:30:00.000Z`));
    }
  }
  return rows;
}

test("natural traffic forecast becomes ready only from validated natural tool traffic", () => {
  const report = buildNaturalTrafficForecast({ observations: healthyHistory(), asOf: AS_OF });
  assert.equal(report.ready, true);
  assert.equal(report.projected_natural_observation_count >= 600, true);
  assert.equal(report.projected_observed_by_surface.memory_engine_search >= 120, true);
  assert.equal(report.projected_observed_by_surface.memory_engine_action_search >= 120, true);
  assert.equal(report.excluded_operator_probe_count, 0);
});

test("leading and trailing silence are included in per-surface gap readiness", () => {
  const rows = healthyHistory().filter(row => Number(row.metadata_json.completed_at.slice(8, 10)) <= 15);
  const report = buildNaturalTrafficForecast({ observations: rows, asOf: AS_OF });
  assert.equal(report.ready, false);
  assert.equal(report.maximum_gap_hours_by_surface.memory_engine_search > 72, true);
  assert.equal(report.maximum_gap_hours_by_surface.memory_engine_action_search > 72, true);
  assert.ok(report.blockers.includes("tool_surface_gap_above_threshold:memory_engine_search"));
  assert.ok(report.blockers.includes("tool_surface_gap_above_threshold:memory_engine_action_search"));
});

test("operator probes cannot manufacture the denominator", () => {
  const probes = healthyHistory().map((row, index) => observation(
    index + 1,
    row.metadata_json.surface,
    row.metadata_json.completed_at,
    "operator_verification_probe",
  ));
  const report = buildNaturalTrafficForecast({ observations: probes, asOf: AS_OF });
  assert.equal(report.ready, false);
  assert.equal(report.natural_observation_count, 0);
  assert.equal(report.excluded_operator_probe_count, probes.length);
  assert.ok(report.blockers.includes("projected_total_natural_observations_below_threshold"));
});

test("zero threshold overrides cannot create structural traffic readiness", () => {
  const report = buildNaturalTrafficForecast({
    observations: [],
    asOf: AS_OF,
    thresholds: {
      lookback_days: 0,
      projection_days: 0,
      minimum_history_days: 0,
      minimum_projected_total_natural_observations: 0,
      minimum_projected_memory_engine_search_observations: 0,
      minimum_projected_memory_engine_action_search_observations: 0,
      minimum_tool_surface_active_days: 0,
      maximum_tool_surface_gap_hours: 0,
    },
  });
  assert.equal(report.ready, false);
  assert.ok(report.blockers.includes("no_qualifying_natural_observations"));
  assert.ok(report.blockers.includes("missing_natural_tool_surface:memory_engine_search"));
  assert.ok(report.blockers.includes("missing_natural_tool_surface:memory_engine_action_search"));
});

test("synthetic and manual markers cannot be disguised as natural traffic", () => {
  const rows = healthyHistory();
  rows[0].synthetic_fixture = true;
  rows[1].metadata_json.manually_inserted = true;
  const report = buildNaturalTrafficForecast({ observations: rows, asOf: AS_OF });
  assert.equal(report.ready, false);
  assert.equal(report.invalid_provenance_count, 2);
  assert.ok(report.blockers.includes("invalid_provenance_present"));
});

test("invalid origin evidence blocks the forecast instead of being counted", () => {
  const rows = healthyHistory();
  rows[0].metadata_json.traffic_origin_evidence.run_id_present = false;
  const report = buildNaturalTrafficForecast({ observations: rows, asOf: AS_OF });
  assert.equal(report.ready, false);
  assert.equal(report.invalid_origin_evidence_count, 1);
  assert.ok(report.blockers.includes("invalid_origin_evidence_present"));
});
