import test from "node:test";
import assert from "node:assert/strict";
import { projectProductionEvidenceEpoch } from "../lib/recall/hybrid/production-evidence-epoch-export.js";

const BASELINE = Object.freeze({
  schema_version: 1,
  active: true,
  activation_source: "sustained_runtime_activation_finalizer",
  authorization_plan_generated_at: "2026-07-01T00:00:00.000Z",
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
  authorized_at: "2026-07-01T00:00:00.000Z",
  activated_at: "2026-07-01T00:05:00.000Z",
});

function observation(id, overrides = {}) {
  const surface = overrides.surface ?? "memory_engine_search";
  const metadata = {
    schema_version: 1,
    surface,
    search_executed: true,
    completed_at: overrides.completed_at ?? "2026-07-02T00:00:00.000Z",
    production_evidence_enabled: overrides.production_evidence_enabled ?? true,
    evidence_epoch_id: overrides.evidence_epoch_id ?? BASELINE.evidence_epoch_id,
    runtime_build_identity: overrides.runtime_build_identity ?? BASELINE.runtime_build_identity,
    rollout_config_fingerprint: overrides.rollout_config_fingerprint ?? BASELINE.rollout_config_fingerprint,
  };
  return {
    id,
    event_type: "hybrid_search_observation",
    source: overrides.source ?? `hybrid.${surface}`,
    session_id: surface === "auto_recall" ? "session-1" : null,
    trace_id: `trace-${id}`,
    created_at: "2026-07-02 00:00:00",
    metadata_json: metadata,
  };
}

test("epoch projection selects exact baseline identity without dropping the raw audit count", () => {
  const result = projectProductionEvidenceEpoch({
    observations: [observation(1)],
    baseline: BASELINE,
    asOf: "2026-07-03T00:00:00.000Z",
  });
  assert.equal(result.report.status, "ready");
  assert.equal(result.report.raw_observation_count, 1);
  assert.equal(result.report.selected_observation_count, 1);
  assert.equal(result.report.blocking_rejection_count, 0);
});

test("mixed epoch and pre-activation rows remain explicit blockers", () => {
  const result = projectProductionEvidenceEpoch({
    observations: [
      observation(1),
      observation(2, { evidence_epoch_id: "epoch-2" }),
      observation(3, { completed_at: "2026-07-01T00:03:00.000Z" }),
    ],
    baseline: BASELINE,
    asOf: "2026-07-03T00:00:00.000Z",
  });
  assert.equal(result.report.status, "blocked");
  assert.equal(result.report.selected_observation_count, 1);
  assert.equal(result.report.blocking_rejection_count, 2);
  assert.equal(result.report.rejection_reason_distribution.evidence_epoch_mismatch, 1);
  assert.equal(result.report.rejection_reason_distribution.observation_before_evidence_start, 1);
});

test("CLI observations are excluded but unknown production surfaces block", () => {
  const cli = observation(1, { surface: "cli_search", source: "hybrid.cli_search" });
  const unknown = observation(2, { surface: "invented", source: "hybrid.invented" });
  const result = projectProductionEvidenceEpoch({
    observations: [cli, unknown],
    baseline: BASELINE,
    asOf: "2026-07-03T00:00:00.000Z",
  });
  assert.equal(result.report.excluded_non_production_count, 1);
  assert.equal(result.report.blocking_rejection_count, 1);
  assert.ok(result.report.rejections[0].reasons.some(reason => reason.includes("unknown")));
});
