import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateProductionEvidenceHealth,
  freshnessStatus,
  validateBaseline,
  validateProductHealth,
  validateRuntimeParity,
} from "../lib/recall/hybrid/production-evidence-health-monitor.js";

const BASELINE = {
  schema_version: 1,
  active: true,
  activation_source: "sustained_runtime_activation_finalizer",
  authorization_plan_generated_at: "2026-06-30T00:00:00.000Z",
  evidence_epoch_id: "epoch-1",
  runtime_build_identity: "a".repeat(64),
  rollout_config_fingerprint: "b".repeat(64),
  expected_kg_mode: "full_fail_closed",
  expected_recent_mode: "full_fail_closed",
  openclaw_runtime_version: "2026.7.1",
  openclaw_config_file_path: "/home/lionsol/.openclaw/openclaw.json",
  openclaw_config_file_sha256: "c".repeat(64),
  openclaw_config_file_byte_count: 1024,
  openclaw_config_fingerprint: "d".repeat(64),
  authorized_at: "2026-06-30T00:00:00.000Z",
  activated_at: "2026-06-30T00:05:00.000Z",
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
    ...(origin === "scheduled_healthcheck" ? { healthcheck_run_id: "healthcheck-run-1" } : {}),
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
    for (const surface of ["memory_engine_search", "memory_engine_action_search"]) {
      rows.push(row(surface, `2026-07-${String(days).padStart(2, "0")}T00:30:00.000Z`, {
        ...options,
        origin: "scheduled_healthcheck",
      }));
    }
  }
  return rows;
}

function fullWindowRows() {
  const observations = rowsForDays(31, { includeHealthcheck: false });
  for (let day = 0; day < 31; day += 1) {
    const date = `2026-07-${String(day + 1).padStart(2, "0")}`;
    for (let index = 1; index < 17; index += 1) {
      for (const surface of ["auto_recall", "memory_engine_search", "memory_engine_action_search"]) {
        observations.push(row(surface, `${date}T00:${String(index).padStart(2, "0")}:00.000Z`));
      }
    }
  }
  for (const surface of ["memory_engine_search", "memory_engine_action_search"]) {
    observations.push(row(surface, "2026-08-01T00:30:00.000Z", { origin: "scheduled_healthcheck" }));
  }
  return observations;
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

test("pre-activation observations are excluded and stop the active epoch", () => {
  const report = evaluate(rowsForDays(2), {
    baseline: {
      ...BASELINE,
      authorization_plan_generated_at: "2026-07-01T23:55:00.000Z",
      authorized_at: "2026-07-01T23:55:00.000Z",
      activated_at: "2026-07-02T00:00:00.000Z",
    },
    asOf: "2026-07-02T02:00:00.000Z",
  });
  assert.equal(report.status, "blocked_rollback_required");
  assert.ok(report.stop_conditions.some(item => item.code === "observation_before_evidence_start"));
  assert.equal(report.observation_before_evidence_start_count, 3);
  assert.equal(report.authorized_window_observation_count, 5);
});

test("future observations and reports are never fresh", () => {
  const report = evaluate(rowsForDays(2), {
    asOf: "2026-06-30T23:00:00.000Z",
  });
  assert.equal(report.status, "blocked_rollback_required");
  assert.ok(report.stop_conditions.some(item => item.code === "observation_after_as_of"));
  assert.ok(report.stop_conditions.some(item => item.code === "runtime_parity_future"));
  assert.ok(report.stop_conditions.some(item => item.code === "product_health_future"));
  assert.equal(freshnessStatus(Date.parse("2026-07-02T00:00:00.000Z"), Date.parse("2026-07-01T00:00:00.000Z"), 26), "future");
});

test("activation and report timestamps obey the same evidence window", () => {
  const asOfBeforeActivation = evaluate(rowsForDays(2), {
    baseline: {
      ...BASELINE,
      authorization_plan_generated_at: "2026-07-02T23:55:00.000Z",
      authorized_at: "2026-07-02T23:55:00.000Z",
      activated_at: "2026-07-03T00:00:00.000Z",
    },
    asOf: "2026-07-02T02:00:00.000Z",
  });
  assert.ok(asOfBeforeActivation.stop_conditions.some(item => item.code === "baseline_evidence_start_after_as_of"));

  const parityBefore = evaluate(rowsForDays(2), {
    baseline: {
      ...BASELINE,
      authorization_plan_generated_at: "2026-07-01T23:55:00.000Z",
      authorized_at: "2026-07-01T23:55:00.000Z",
      activated_at: "2026-07-02T00:00:00.000Z",
    },
    runtimeParity: { ...PARITY, checked_at: "2026-07-01T23:00:00.000Z" },
    asOf: "2026-07-02T02:00:00.000Z",
  });
  assert.ok(parityBefore.stop_conditions.some(item => item.code === "runtime_parity_before_evidence_start"));

  const productBefore = evaluate(rowsForDays(2), {
    baseline: {
      ...BASELINE,
      authorization_plan_generated_at: "2026-07-01T23:55:00.000Z",
      authorized_at: "2026-07-01T23:55:00.000Z",
      activated_at: "2026-07-02T00:00:00.000Z",
    },
    productHealth: { ...HEALTH, checked_at: "2026-07-01T23:00:00.000Z" },
    asOf: "2026-07-02T02:00:00.000Z",
  });
  assert.ok(productBefore.stop_conditions.some(item => item.code === "product_health_before_evidence_start"));

  const healthcheckBefore = evaluate(rowsForDays(2), {
    baseline: {
      ...BASELINE,
      authorization_plan_generated_at: "2026-07-02T23:55:00.000Z",
      authorized_at: "2026-07-02T23:55:00.000Z",
      activated_at: "2026-07-03T00:00:00.000Z",
    },
    asOf: "2026-07-03T02:00:00.000Z",
  });
  assert.ok(healthcheckBefore.stop_conditions.some(item => item.code === "healthcheck_before_evidence_start"));
});

test("invalid external timestamps and hand-written active baselines fail the active monitor", () => {
  assert.equal(validateBaseline({ ...BASELINE, authorized_at: "2026-07-01" }).valid, false);
  assert.equal(validateBaseline({ ...BASELINE, activation_source: undefined }).valid, false);
  assert.equal(validateBaseline({ ...BASELINE, authorization_plan_generated_at: "2026-06-29T00:00:00.000Z" }).valid, false);
  assert.equal(validateRuntimeParity({ ...PARITY, checked_at: "2026-07-01T00:00:00Z" }).valid, false);
  assert.equal(validateProductHealth({ ...HEALTH, checked_at: "2026-07-01T08:00:00+08:00" }).valid, false);
  const report = evaluate(rowsForDays(), { asOf: "July 1, 2026" });
  assert.equal(report.status, "blocked_rollback_required");
  assert.ok(report.stop_conditions.some(item => item.code === "invalid_as_of"));
});

test("partial scheduled healthcheck run cannot satisfy freshness", () => {
  const observations = rowsForDays(2, { includeHealthcheck: false });
  observations.push(row("memory_engine_search", "2026-07-02T00:30:00.000Z", {
    origin: "scheduled_healthcheck",
  }));
  const report = evaluate(observations);
  assert.equal(report.status, "blocked_rollback_required");
  assert.equal(report.latest_healthcheck_at, null);
  assert.ok(report.stop_conditions.some(item => item.code === "healthcheck_missing"));
});

test("impossible scheduled healthcheck evidence cannot satisfy freshness", () => {
  const observations = rowsForDays();
  const healthcheck = observations.at(-1).metadata_json;
  healthcheck.traffic_origin_evidence = {
    source: "scheduled_healthcheck_wrapper",
    agent_id_present: false,
    run_id_present: false,
    session_id_present: false,
    tool_call_id_present: false,
  };
  const report = evaluate(observations);
  assert.equal(report.status, "blocked_rollback_required");
  assert.ok(report.stop_conditions.some(item => item.code === "origin_evidence_mismatch"));
  assert.equal(report.latest_healthcheck_at, null);
  assert.ok(report.stop_conditions.some(item => item.code === "healthcheck_missing"));
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
  assert.equal(parity.runtime_parity_status, "drift");

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
  assert.equal(stale.runtime_parity_status, "clean");
  assert.equal(stale.runtime_parity_freshness_status, "stale");
  assert.notEqual(stale.monitor_freshness_status, "fresh");
});

test("operator probes do not satisfy the natural denominator", () => {
  const observations = rowsForDays(2, { origin: "operator_verification_probe" });
  for (const observation of observations) {
    if (observation.metadata_json.surface === "auto_recall") {
      observation.metadata_json.traffic_origin = "natural_user_turn";
      observation.metadata_json.traffic_origin_evidence = originEvidence("natural_user_turn");
    }
  }
  const report = evaluate(observations);
  assert.equal(report.status, "healthy_collecting");
  assert.equal(report.evidence.continuity.natural_observation_count, 2);
  assert.ok(report.evidence_gaps.some(item => item.code.startsWith("surface_observations_below_threshold:")));
  assert.equal(report.ready_for_removal_gate, false);
});

test("complete identity, continuity, full rollout, and fresh monitor evidence is ready for the removal gate", () => {
  const observations = fullWindowRows();
  const report = evaluate(observations, {
    asOf: "2026-08-01T01:00:00.000Z",
    runtimeParity: { ...PARITY, checked_at: "2026-08-01T00:40:00.000Z" },
    productHealth: { ...HEALTH, checked_at: "2026-08-01T00:40:00.000Z" },
  });
  assert.equal(report.status, "ready_for_removal_gate");
  assert.equal(report.rollback_required, false);
  assert.equal(report.ready_for_removal_gate, true);
  assert.equal(report.runtime_parity_status, "clean");
  assert.equal(report.runtime_parity_freshness_status, "fresh");
  assert.equal(report.product_health_status, "healthy");
  assert.equal(report.product_health_freshness_status, "fresh");
  assert.equal(report.monitor_freshness_status, "fresh");
  assert.deepEqual(Object.values(report.observation_freshness_status_by_surface), ["fresh", "fresh", "fresh"]);
});

test("scheduled healthcheck on AutoRecall cannot make a complete window removal-ready", () => {
  const observations = fullWindowRows();
  const healthcheck = observations.at(-1);
  healthcheck.source = "hybrid.auto_recall";
  healthcheck.session_id = "session-1";
  healthcheck.metadata_json.surface = "auto_recall";
  const report = evaluate(observations, {
    asOf: "2026-08-01T01:00:00.000Z",
    runtimeParity: { ...PARITY, checked_at: "2026-08-01T00:40:00.000Z" },
    productHealth: { ...HEALTH, checked_at: "2026-08-01T00:40:00.000Z" },
  });
  assert.equal(report.status, "blocked_rollback_required");
  assert.equal(report.ready_for_removal_gate, false);
  assert.ok(report.stop_conditions.some(item => item.code === "origin_evidence_mismatch"));
  assert.equal(report.latest_healthcheck_at, null);
  assert.ok(report.stop_conditions.some(item => item.code === "healthcheck_missing"));
});

test("inactive baseline stays insufficient and never authorizes removal", () => {
  const report = evaluate([], { baseline: { ...BASELINE, active: false } });
  assert.equal(report.status, "insufficient_evidence");
  assert.equal(report.ready_for_removal_gate, false);
});
