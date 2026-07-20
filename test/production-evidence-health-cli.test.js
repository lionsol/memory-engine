import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { auditProductionEvidenceHealth, exitCodeForStatus, parseArgs } from "../bin/audit-production-evidence-health.js";

const baseline = {
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
const parity = {
  schema_version: 1,
  checked_at: "2026-07-02T01:00:00.000Z",
  source_runtime_equal: true,
  difference_count: 0,
  runtime_build_identity: baseline.runtime_build_identity,
};
const health = {
  schema_version: 1,
  checked_at: "2026-07-02T01:00:00.000Z",
  status: "healthy",
  blockers: [],
};

function row(surface, origin = surface === "auto_recall" ? "natural_user_turn" : "natural_agent_tool_call") {
  const evidence = origin === "natural_user_turn"
    ? { source: "before_prompt_build", agent_id_present: true, run_id_present: true, session_id_present: true, tool_call_id_present: false, trigger: "user" }
    : origin === "scheduled_healthcheck"
      ? { source: "scheduled_healthcheck_wrapper", agent_id_present: true, run_id_present: false, session_id_present: true, tool_call_id_present: true, healthcheck_run_id: "healthcheck-run-cli" }
      : { source: "before_tool_call_agent", agent_id_present: true, run_id_present: true, session_id_present: true, tool_call_id_present: true };
  return {
    event_type: "hybrid_search_observation",
    source: `hybrid.${surface}`,
    trace_id: `trace-${surface}`,
    session_id: surface === "auto_recall" ? "session-1" : null,
    metadata_json: {
      schema_version: 1,
      surface,
      search_executed: true,
      completed_at: "2026-07-02T00:00:00.000Z",
      production_evidence_enabled: true,
      evidence_epoch_id: baseline.evidence_epoch_id,
      runtime_build_identity: baseline.runtime_build_identity,
      rollout_config_fingerprint: baseline.rollout_config_fingerprint,
      traffic_origin: origin,
      traffic_origin_schema_version: 1,
      traffic_origin_evidence: evidence,
      traffic_origin_valid: true,
      traffic_origin_reasons: [],
      kg_access_mode: "isolated",
      recent_access_mode: "isolated",
      kg_runtime_mode: "full_fail_closed",
      kg_rollout_scope: "full",
      kg_scope_required: false,
      kg_fail_closed_scope_match: null,
      recent_runtime_mode: "full_fail_closed",
      recent_rollout_scope: "full",
      recent_scope_required: false,
      recent_fail_closed_scope_match: null,
      legacy_db_fallback_used: false,
      legacy_db_fallback_channels: [],
      channel_error_count: 0,
    },
  };
}

function fixture(name, value) {
  const root = mkdtempSync(resolve(tmpdir(), "production-evidence-health-cli-"));
  const path = resolve(root, name);
  writeFileSync(path, value);
  return path;
}

function args(observationsPath, overrides = {}) {
  const selectedBaseline = Object.hasOwn(overrides, "baseline") ? overrides.baseline : baseline;
  const selectedParity = Object.hasOwn(overrides, "parity") ? overrides.parity : parity;
  const selectedHealth = Object.hasOwn(overrides, "health") ? overrides.health : health;
  return [
    "--observations", observationsPath,
    "--baseline", fixture("baseline.json", JSON.stringify(selectedBaseline)),
    "--runtime-parity", fixture("parity.json", JSON.stringify(selectedParity)),
    "--product-health", fixture("health.json", JSON.stringify(selectedHealth)),
    "--as-of", overrides.asOf || "2026-07-02T02:00:00.000Z",
    ...(overrides.pretty ? ["--pretty"] : []),
  ];
}

test("CLI accepts JSON and JSONL report inputs and pretty output", async () => {
  const rows = [
    row("auto_recall"),
    row("memory_engine_search"),
    row("memory_engine_action_search"),
    row("memory_engine_search", "scheduled_healthcheck"),
    row("memory_engine_action_search", "scheduled_healthcheck"),
  ];
  const json = fixture("observations.json", JSON.stringify(rows));
  const result = await auditProductionEvidenceHealth(args(json, { pretty: true }));
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.status, "healthy_collecting");
  assert.match(result.output, /\n  "status":/);

  const jsonl = fixture("observations.jsonl", `${rows.map(item => JSON.stringify(item)).join("\n")}\n`);
  const jsonlResult = await auditProductionEvidenceHealth(args(jsonl));
  assert.equal(jsonlResult.report.status, "healthy_collecting");
});

test("CLI maps statuses and rejects unknown or malformed input", async () => {
  assert.equal(exitCodeForStatus("ready_for_removal_gate"), 0);
  assert.equal(exitCodeForStatus("healthy_collecting"), 1);
  assert.equal(exitCodeForStatus("insufficient_evidence"), 1);
  assert.equal(exitCodeForStatus("blocked_rollback_required"), 2);
  assert.throws(() => parseArgs(["--unknown"]));
  assert.throws(() => parseArgs(["--observations", "x"]));
  const observations = fixture("observations.json", JSON.stringify([]));
  await assert.rejects(() => auditProductionEvidenceHealth(args(observations, { baseline: null })), /baseline JSON must be an object/);
  await assert.rejects(() => auditProductionEvidenceHealth(args(observations, { asOf: "not-iso" })), /ISO timestamp/);
});

test("CLI rejects non-canonical UTC timestamps with input error semantics", async () => {
  const observations = fixture("observations.json", JSON.stringify([row("auto_recall")]));
  for (const value of ["July 1, 2026", "2026-07-01", "2026-07-01T00:00:00Z", "2026-07-01T08:00:00+08:00", " 2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z "]) {
    await assert.rejects(() => auditProductionEvidenceHealth(args(observations, { asOf: value })), /canonical UTC ISO timestamp/);
  }
  await assert.rejects(() => auditProductionEvidenceHealth(args(observations, {
    baseline: { ...baseline, authorized_at: "2026-07-01" },
  })), /invalid_baseline_authorized_at/);
  await assert.rejects(() => auditProductionEvidenceHealth(args(observations, {
    parity: { ...parity, checked_at: "2026-07-01T00:00:00Z" },
  })), /invalid_runtime_parity_checked_at/);
  await assert.rejects(() => auditProductionEvidenceHealth(args(observations, {
    health: { ...health, checked_at: "2026-07-01T08:00:00+08:00" },
  })), /invalid_product_health_checked_at/);
});

test("CLI rejects primitive threshold documents before evaluation", async () => {
  const observations = fixture("observations.json", JSON.stringify([row("auto_recall")]));
  for (const value of [null, 5, true, []]) {
    const thresholds = fixture("thresholds.json", JSON.stringify(value));
    await assert.rejects(() => auditProductionEvidenceHealth([
      ...args(observations),
      "--monitor-thresholds", thresholds,
    ]), /thresholds JSON must be an object/);
  }
});

test("CLI rejects invalid continuity threshold documents as input errors", async () => {
  const observations = fixture("observations.json", JSON.stringify([row("auto_recall")]));
  for (const value of [{ minimum_active_day_ratio: 1.2 }, { minimum_observations: 1.5 }, { unknown_threshold: 1 }]) {
    const thresholds = fixture("continuity-thresholds.json", JSON.stringify(value));
    await assert.rejects(() => auditProductionEvidenceHealth([
      ...args(observations),
      "--continuity-thresholds", thresholds,
    ]), /invalid_threshold|unknown_threshold/);
  }
});
