import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import rollbackCli from "../bin/verify-sustained-runtime-rollback.js";
import { verifySustainedRuntimeRollback } from "../lib/recall/hybrid/sustained-runtime-rollback-verification.js";
import { REQUIRED_OPERATOR_APPROVALS } from "../lib/recall/hybrid/sustained-runtime-authorization.js";
import { fingerprintRolloutConfig } from "../lib/recall/hybrid/production-evidence-identity.js";

const AUTHORIZED_AT = "2026-07-20T03:00:00.000Z";
const ACTIVATED_AT = "2026-07-20T03:10:00.000Z";
const CHECKED_AT = "2026-07-20T04:00:00.000Z";
const BUILD = "a".repeat(64);
const BACKUP_HASH = "b".repeat(64);
const BACKUP_FINGERPRINT = "c".repeat(64);
const LIVE_CONFIG_PATH = "/home/lionsol/.openclaw/openclaw.json";
const EPOCH = "b8-a7-sustained-20260720T030000Z-15923c5-r01";

function sustainedConfig() {
  return {
    autoRecall: {
      enabled: true,
      topK: 3,
      timeoutMs: 4000,
      agentAllowlist: ["edi"],
      triggerAllowlist: ["user"],
      chatTypeAllowlist: ["interactive_user_chat"],
      messageRoleAllowlist: ["user"],
      cardFirstRuntime: { enabled: false },
    },
    kgFailClosedMode: "full_fail_closed",
    kgFailClosedCanary: { enabled: false, agentIds: [], sessionIds: [], tokens: [] },
    recentFailClosedMode: "full_fail_closed",
    recentFailClosedCanary: { enabled: false, agentIds: [], sessionIds: [], tokens: [] },
    productionEvidenceWindow: { enabled: true, epochId: EPOCH },
    hybridRetrieval: { recall: {}, ranking: {}, confidence: {} },
  };
}

const ACTIVE_ROLLOUT_FINGERPRINT = fingerprintRolloutConfig(sustainedConfig()).fingerprint;

function authorizationPlan(overrides = {}) {
  return {
    schema_version: 1,
    decision: "authorized_plan_ready",
    execution_authorized: true,
    generated_at: AUTHORIZED_AT,
    technical_ready: true,
    operator_approvals_complete: true,
    technical_blockers: [],
    approval_blockers: [],
    required_operator_approvals: [...REQUIRED_OPERATOR_APPROVALS],
    activation_baseline: null,
    config_backup_manifest: {
      schema_version: 1,
      status: "ready",
      live_config_path: LIVE_CONFIG_PATH,
      live_config_sha256: BACKUP_HASH,
      live_byte_count: 1000,
      effective_config_fingerprint: BACKUP_FINGERPRINT,
    },
    runtime_preflight: {
      schema_version: 1,
      status: "clean",
      openclaw_config_file_path: LIVE_CONFIG_PATH,
      openclaw_config_file_sha256: BACKUP_HASH,
      openclaw_config_file_byte_count: 1000,
      rollout_config_fingerprint: BACKUP_FINGERPRINT,
    },
    proposed_effective_config: sustainedConfig(),
    proposed_rollout_config_fingerprint_report: {
      valid: true,
      fingerprint: ACTIVE_ROLLOUT_FINGERPRINT,
    },
    config_application_plan: {
      mode: "merge_patch",
      target_path: "plugins.entries.memory-engine.config",
      patch: { productionEvidenceWindow: { enabled: true, epochId: EPOCH } },
      expected_effective_rollout_config_fingerprint: ACTIVE_ROLLOUT_FINGERPRINT,
    },
    baseline_template: {
      schema_version: 1,
      active: false,
      evidence_epoch_id: EPOCH,
      runtime_build_identity: BUILD,
      rollout_config_fingerprint: ACTIVE_ROLLOUT_FINGERPRINT,
      expected_kg_mode: "full_fail_closed",
      expected_recent_mode: "full_fail_closed",
      openclaw_runtime_version: "2026.7.1",
      authorized_at: AUTHORIZED_AT,
      activation_baseline_finalization_required: true,
    },
    rollback_plan: {
      exact_config_backup: {
        backup_path: "/tmp/openclaw-pre-a7.json",
        live_config_path: LIVE_CONFIG_PATH,
        config_sha256: BACKUP_HASH,
        live_config_sha256: BACKUP_HASH,
        byte_count: 1000,
        live_byte_count: 1000,
        backup_matches_live_config: true,
        openclaw_config_fingerprint: "d".repeat(64),
        effective_config_fingerprint: BACKUP_FINGERPRINT,
      },
    },
    ...overrides,
  };
}

function activationBaselineReport(overrides = {}) {
  return {
    schema_version: 1,
    checked_at: ACTIVATED_AT,
    status: "active_baseline_ready",
    active_baseline_ready: true,
    blockers: [],
    baseline: {
      schema_version: 1,
      active: true,
      activation_source: "sustained_runtime_activation_finalizer",
      authorization_plan_generated_at: AUTHORIZED_AT,
      evidence_epoch_id: EPOCH,
      runtime_build_identity: BUILD,
      rollout_config_fingerprint: ACTIVE_ROLLOUT_FINGERPRINT,
      openclaw_runtime_version: "2026.7.1",
      openclaw_config_file_path: LIVE_CONFIG_PATH,
      openclaw_config_file_sha256: "e".repeat(64),
      openclaw_config_file_byte_count: 1200,
      openclaw_config_fingerprint: "f".repeat(64),
      expected_kg_mode: "full_fail_closed",
      expected_recent_mode: "full_fail_closed",
      authorized_at: AUTHORIZED_AT,
      activated_at: ACTIVATED_AT,
    },
    ...overrides,
  };
}

function restoredConfig(overrides = {}) {
  return {
    schema_version: 1,
    created_at: CHECKED_AT,
    status: "ready",
    valid: true,
    backup_path: "/tmp/openclaw-pre-a7.json",
    live_config_path: LIVE_CONFIG_PATH,
    config_sha256: BACKUP_HASH,
    live_config_sha256: BACKUP_HASH,
    byte_count: 1000,
    live_byte_count: 1000,
    backup_matches_live_config: true,
    openclaw_config_fingerprint: "d".repeat(64),
    effective_config_fingerprint: BACKUP_FINGERPRINT,
    active_memory_enabled: false,
    kg_mode: "legacy_fallback",
    recent_mode: "legacy_fallback",
    auto_recall_enabled: false,
    production_evidence_enabled: false,
    blockers: [],
    ...overrides,
  };
}

function legacyConfig() {
  return {
    autoRecall: { enabled: false },
    kgFailClosedMode: "legacy_fallback",
    recentFailClosedMode: "legacy_fallback",
    productionEvidenceWindow: { enabled: false, epochId: null },
  };
}

function runtimePreflight(overrides = {}) {
  return {
    schema_version: 1,
    checked_at: CHECKED_AT,
    status: "clean",
    openclaw_runtime_version: "2026.7.1",
    openclaw_config_file_path: LIVE_CONFIG_PATH,
    openclaw_config_file_sha256: BACKUP_HASH,
    openclaw_config_file_byte_count: 1000,
    openclaw_config_fingerprint: "d".repeat(64),
    runtime_build_identity: BUILD,
    rollout_config_fingerprint: BACKUP_FINGERPRINT,
    effective_config_report: {
      schema_version: 1,
      checked_at: CHECKED_AT,
      valid: true,
      errors: [],
      effective_config: legacyConfig(),
      rollout_config_fingerprint: BACKUP_FINGERPRINT,
    },
    runtime_boundary: {
      schema_version: 1,
      checked_at: CHECKED_AT,
      status: "clean",
      active_memory_enabled: false,
      blockers: [],
    },
    blockers: [],
    ...overrides,
  };
}

function parity(overrides = {}) {
  return {
    schema_version: 1,
    checked_at: CHECKED_AT,
    source_runtime_equal: true,
    difference_count: 0,
    runtime_build_identity: BUILD,
    ...overrides,
  };
}

function probe(id, surface, overrides = {}) {
  const metadata = {
    schema_version: 1,
    surface,
    search_executed: true,
    completed_at: CHECKED_AT,
    production_evidence_enabled: false,
    evidence_epoch_id: null,
    traffic_origin_schema_version: 1,
    traffic_origin: "operator_verification_probe",
    traffic_origin_valid: true,
    traffic_origin_reasons: [],
    traffic_origin_evidence: {
      source: "gateway_tools_invoke",
      agent_id_present: true,
      run_id_present: false,
      session_id_present: true,
      tool_call_id_present: true,
      tool_call_transport: "rpc",
      trigger: null,
    },
    kg_runtime_mode: "legacy_fallback",
    recent_runtime_mode: "legacy_fallback",
    kg_rollout_scope: null,
    recent_rollout_scope: null,
    kg_fail_closed_fallback_suppressed: false,
    recent_fail_closed_fallback_suppressed: false,
    channel_error_count: 0,
    ...overrides,
  };
  return {
    id,
    event_type: "hybrid_search_observation",
    source: `hybrid.${surface}`,
    trace_id: `trace-${id}`,
    session_id: null,
    created_at: "2026-07-20 04:00:00",
    metadata_json: metadata,
  };
}

function observations() {
  return [
    probe(1, "memory_engine_search"),
    probe(2, "memory_engine_action_search"),
  ];
}

function smoke(overrides = {}) {
  return {
    stage: "F1-D-B8-A5",
    generated_at: CHECKED_AT,
    side_effects: {
      real_db_access: false,
      synthetic_in_memory_sqlite: true,
      openclaw_runtime: false,
      config_mutation: false,
    },
    summary: {
      mode: "synthetic_in_memory_safety_smoke",
      status: "pass",
      check_count: 10,
      passed_count: 10,
      failed_count: 0,
      failed_check_ids: [],
      ...overrides,
    },
  };
}

test("rollback verifier requires exact config, clean runtime, both probes, and all-pass A5 smoke", () => {
  const report = verifySustainedRuntimeRollback({
    authorizationPlan: authorizationPlan(),
    activationBaselineReport: activationBaselineReport(),
    restoredConfigManifest: restoredConfig(),
    runtimePreflight: runtimePreflight(),
    runtimeParity: parity(),
    rollbackObservations: observations(),
    safetySmoke: smoke(),
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.status, "rollback_verified");
  assert.equal(report.rollback_verified, true);
  assert.equal(report.evidence_epoch_reusable, false);
  assert.deepEqual(report.rollback_probe_counts, {
    memory_engine_search: 1,
    memory_engine_action_search: 1,
  });
});

test("rollback verification cannot succeed without the finalized activation artifact", () => {
  const report = verifySustainedRuntimeRollback({
    authorizationPlan: authorizationPlan(),
    restoredConfigManifest: restoredConfig(),
    runtimePreflight: runtimePreflight(),
    runtimeParity: parity(),
    rollbackObservations: observations(),
    safetySmoke: smoke(),
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.rollback_verified, false);
  assert.ok(report.blockers.some(item => item.code === "activation_baseline_report_missing"));
});

test("config hash mismatch, full-mode residue, and failed smoke block rollback verification", () => {
  const rows = observations();
  rows[0].metadata_json.kg_runtime_mode = "full_fail_closed";
  rows[0].metadata_json.kg_rollout_scope = "full";
  const report = verifySustainedRuntimeRollback({
    authorizationPlan: authorizationPlan(),
    activationBaselineReport: activationBaselineReport(),
    restoredConfigManifest: restoredConfig({ config_sha256: "d".repeat(64) }),
    runtimePreflight: runtimePreflight(),
    runtimeParity: parity(),
    rollbackObservations: rows,
    safetySmoke: smoke({ status: "fail", passed_count: 9, failed_count: 1, failed_check_ids: ["one"] }),
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.status, "blocked");
  assert.equal(report.rollback_verified, false);
  assert.ok(report.blockers.some(item => item.code === "restored_config_config_sha256_mismatch"));
  assert.ok(report.blockers.some(item => item.code === "rollback_kg_mode_residue"));
  assert.ok(report.blockers.some(item => item.code === "rollback_full_scope_residue"));
  assert.ok(report.blockers.some(item => item.code === "rollback_safety_smoke_failed"));
});

test("rollback verifier consumes the real A5 snake-case timestamp and rejects camel-case replay", () => {
  const invalidSmoke = smoke();
  invalidSmoke.generatedAt = invalidSmoke.generated_at;
  delete invalidSmoke.generated_at;
  const report = verifySustainedRuntimeRollback({
    authorizationPlan: authorizationPlan(),
    activationBaselineReport: activationBaselineReport(),
    restoredConfigManifest: restoredConfig(),
    runtimePreflight: runtimePreflight(),
    runtimeParity: parity(),
    rollbackObservations: observations(),
    safetySmoke: invalidSmoke,
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.some(item => item.code === "rollback_safety_smoke_generated_at_invalid"));
});

test("missing one real tool-surface probe blocks rollback verification", () => {
  const report = verifySustainedRuntimeRollback({
    authorizationPlan: authorizationPlan(),
    activationBaselineReport: activationBaselineReport(),
    restoredConfigManifest: restoredConfig(),
    runtimePreflight: runtimePreflight(),
    runtimeParity: parity(),
    rollbackObservations: [probe(1, "memory_engine_search")],
    safetySmoke: smoke(),
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.rollback_verified, false);
  assert.ok(report.blockers.some(item => item.code === "rollback_probe_missing:memory_engine_action_search"));
});

test("rollback verifier CLI composes supplied report evidence only", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-rollback-verify-"));
  const writeJson = (name, value) => {
    const path = join(root, name);
    writeFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
    return path;
  };
  const planPath = writeJson("plan.json", authorizationPlan());
  const activationPath = writeJson("activation-baseline.json", activationBaselineReport());
  const restoredPath = writeJson("restored.json", restoredConfig());
  const preflightPath = writeJson("preflight.json", runtimePreflight());
  const parityPath = writeJson("parity.json", parity());
  const observationsPath = writeJson("observations.json", observations());
  const smokePath = writeJson("smoke.json", smoke());
  const outPath = join(root, "verification.json");
  const result = await rollbackCli.verifySustainedRuntimeRollbackCli([
    "--authorization-plan", planPath,
    "--activation-baseline", activationPath,
    "--restored-config-manifest", restoredPath,
    "--runtime-preflight", preflightPath,
    "--runtime-parity", parityPath,
    "--rollback-observations", observationsPath,
    "--safety-smoke", smokePath,
    "--checked-at", CHECKED_AT,
    "--out", outPath,
    "--pretty",
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(readFileSync(outPath, "utf8")).rollback_verified, true);
});
