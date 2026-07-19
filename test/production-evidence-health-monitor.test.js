import test from "node:test";
import assert from "node:assert/strict";
import { evaluateProductionEvidenceHealth } from "../lib/recall/hybrid/production-evidence-health-monitor.js";

const BASELINE = {
  schema_version: 1,
  active: true,
  evidence_epoch_id: "epoch-1",
  runtime_build_identity: "a".repeat(64),
  rollout_config_fingerprint: "b".repeat(64),
  expected_kg_mode: "full_fail_closed",
  expected_recent_mode: "full_fail_closed",
  authorized_at: "2026-06-30T00:00:00.000Z",
};

const PARITY = {
  schema_version: 1,
  checked_at: "2026-07-02T01:00:00.000Z",
  source_runtime_equal: true,
  difference_count: 0,
  runtime_build_identity: BASELINE.runtime_build_identity,
};

const HEALTH = {
  schema_version: 1,
  checked_at: "2026-07-02T01:00:00.000Z",
  status: "healthy",
  blockers: [],
};

function originEvidence(origin) {
  if (origin === "natural_user_turn") return {
    source: "before_prompt_build",
    agent_id_present: true,
    run_id_present: true,
    session_id_present: true,
    tool_call_id_present: false,
    trigger: "user",
  };
  if (origin === "natural_agent_tool_call") return {
    source: "before_tool_call_agent",
    agent_id_present: true,
    run_id_present: true,
    session_id_present: true,
    tool_call_id_present: true,
  };
  return {
    source: origin === "scheduled_healthcheck" ? "scheduled_healthcheck_wrapper" : "gateway_tools_invoke",
    agent_id_present: true,
    run_id_present: false,
    session_id_present: true,
    tool_call_id_present: true,
    ...(origin === "operator_verification_probe" ? { tool_call_transport: "http" } : {}),
  };
}

function row(surface, timestamp, {
  origin = surface === "auto_recall" ? "natural_user_turn" : "natural_agent_tool_call",
  identity = {},
  marker = {},
  metadata = {},
} = {}) {
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
      production_evidence_enabled: true,
      evidence_epoch_id: BASELINE.evidence_epoch_id,
      runtime_build_identity: BASELINE.runtime_build_identity,
      rollout_config_fingerprint: BASELINE.rollout_config_fingerprint,
      traffic_origin: origin,
      traffic_origin_schema_version: 1,
      traffic_origin_evidence: originEvidence(origin),
      traffic_origin_valid: true,
      traffic_origin_reasons: [],
      kg_access_mode: "isolated",
      recent_access_mode: "isolated",
      kg_fallback_events: 0,
      recent_fallback_events: 0,
      legacy_db_fallback_used: false,
      legacy_db_fallback_channels: [],
      kg_runtime_mode: "full_fail_closed",
      kg_rollout_scope: "full",
      kg_scope_required: false,
      kg_fail_closed_applied: true,
      kg_fail_closed_scope_match: null,
      recent_runtime_mode: "full_fail_closed",
      recent_rollout_scope: "full",
      recent_scope_required: false,
      recent_fail_closed_applied: true,
      recent_fail_closed_scope_match: null,
      channel_error_count: 0,
      ...identity,
      ...marker,
      ...metadata,
    },
  };
}

function rowsForDays(days = 2, options = {}) {
  const surfaces = ["auto_recall", "memory_engine_search", "memory_engine_action_search"];
  const rows = [];
  for (let day = 0; day < days; day += 1) {
    for (const surface of surfaces) {
      rows.push(row(surface, `2026-07-${String(day + 1).padStart(2, "0")}T00:00:00.000Z`, options));
    }
  }
  if (options.includeHealthcheck !== false) {
    rows.push(row("memory_engine_search", `2026-07-${String(days).padStart(2, "0")}T00:30:00.000Z`, {
      ...options,
      origin: "scheduled_healthcheck",
    }));
  }
  return rows;
}

function evaluate(observations, overrides = {}) {
  return evaluateProductionEvidenceHealth({
    observations,
    baseline: overrides.baseline || BASELINE,
    runtimeParity: overrides.runtimeParity || PARITY,
    productHealth: overrides.productHealth || HEALTH,
    continuityThresholds: overrides.continuityThresholds,
    monitorThresholds: overrides.monitorThresholds,
    asOf: overrides.asOf || "2026-07-02T02:00:00.000Z",
  });
}

test("clean short window is healthy_collecting, not rollback", () => {
  const report = evaluate(rowsForDays());
  assert.equal(report.status, "healthy_collecting");
  assert.equal(report.rollback_required, false);
  assert.equal(report.continuity_status, "continuity_collecting");
  assert.equal(report.latest_healthcheck_at, "2026-07-02T00:30:00.000Z");
});

test("uniform but unauthorized epoch blocks active monitoring", () => {
  const report = evaluate(rowsForDays(2, { identity: { evidence_epoch_id: "other-epoch" } }));
  assert.equal(report.status, "blocked_rollback_required");
  assert.ok(report.stop_conditions.some(item => item.code === "baseline_identity_mismatch"));
});

test("fallback event is an immediate stop condition", () => {
  const report = evaluate(rowsForDays(2, { metadata: {
    legacy_db_fallback_used: true,
    legacy_db_fallback_channels: ["kg"],
  } }));
  assert.equal(report.status, "blocked_rollback_required");
  assert.ok(report.stop_conditions.some(item => item.code === "fallback_events_present"));
});

test("missing full marker and scope leakage require rollback", () => {
  const missing = evaluate(rowsForDays(2, { marker: { kg_runtime_mode: undefined } }));
  assert.equal(missing.status, "blocked_rollback_required");
  assert.ok(missing.stop_conditions.some(item => item.code === "kg_full_fail_closed_mode_not_observable"));

  const scoped = evaluate(rowsForDays(2, {
    marker: {
      kg_runtime_mode: "full_fail_closed",
      kg_rollout_scope: "full",
      kg_scope_required: false,
      kg_fail_closed_scope_match: true,
      kg_access_mode: "isolated_blocked",
    },
  }));
  assert.equal(scoped.status, "blocked_rollback_required");
  assert.ok(scoped.stop_conditions.some(item => item.code === "canary_leakage_present" || item.code === "kg_mode_mismatch"));
});

test("parity, product health, and monitor freshness stop active monitoring", () => {
  const parity = evaluate(rowsForDays(), { runtimeParity: { ...PARITY, source_runtime_equal: false } });
  assert.equal(parity.status, "blocked_rollback_required");
  assert.ok(parity.stop_conditions.some(item => item.code === "runtime_source_parity_drift"));

  const product = evaluate(rowsForDays(), { productHealth: { ...HEALTH, status: "rollback_required", blockers: ["quality_regression"] } });
  assert.equal(product.status, "blocked_rollback_required");
  assert.ok(product.stop_conditions.some(item => item.code === "product_health_rollback_required"));

  const stale = evaluate(rowsForDays(), {
    asOf: "2026-07-10T00:00:00.000Z",
    runtimeParity: { ...PARITY, checked_at: "2026-07-02T01:00:00.000Z" },
    productHealth: { ...HEALTH, checked_at: "2026-07-02T01:00:00.000Z" },
  });
  assert.equal(stale.status, "blocked_rollback_required");
  assert.ok(stale.stop_conditions.some(item => item.code === "healthcheck_stale"));
});

test("operator probes do not satisfy the natural denominator", () => {
  const observations = rowsForDays(2, { origin: "operator_verification_probe" });
  const report = evaluate(observations);
  assert.equal(report.status, "healthy_collecting");
  assert.equal(report.evidence.continuity.natural_observation_count, 0);
  assert.ok(report.evidence_gaps.some(item => item.code === "no_qualifying_natural_observations"));
  assert.equal(report.ready_for_removal_gate, false);
});

test("complete identity, continuity, full rollout, and fresh monitor evidence is ready for the removal gate", () => {
  const observations = rowsForDays(31, { includeHealthcheck: false });
  for (let day = 0; day < 31; day += 1) {
    const date = `2026-07-${String(day + 1).padStart(2, "0")}`;
    for (let index = 1; index < 17; index += 1) {
      for (const surface of ["auto_recall", "memory_engine_search", "memory_engine_action_search"]) {
        observations.push(row(surface, `${date}T00:${String(index).padStart(2, "0")}:00.000Z`));
      }
    }
  }
  observations.push(row("memory_engine_search", "2026-08-01T00:30:00.000Z", { origin: "scheduled_healthcheck" }));
  const report = evaluate(observations, {
    asOf: "2026-08-01T01:00:00.000Z",
    runtimeParity: { ...PARITY, checked_at: "2026-08-01T00:40:00.000Z" },
    productHealth: { ...HEALTH, checked_at: "2026-08-01T00:40:00.000Z" },
  });
  assert.equal(report.status, "ready_for_removal_gate");
  assert.equal(report.rollback_required, false);
  assert.equal(report.ready_for_removal_gate, true);
});

test("inactive baseline stays insufficient and never authorizes removal", () => {
  const report = evaluate([], { baseline: { ...BASELINE, active: false } });
  assert.equal(report.status, "insufficient_evidence");
  assert.equal(report.ready_for_removal_gate, false);
});
