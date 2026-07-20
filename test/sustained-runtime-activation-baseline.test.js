import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import baselineCli from "../bin/finalize-sustained-runtime-activation-baseline.js";
import { finalizeSustainedRuntimeActivationBaseline } from "../lib/recall/hybrid/sustained-runtime-activation-baseline.js";
import { REQUIRED_OPERATOR_APPROVALS } from "../lib/recall/hybrid/sustained-runtime-authorization.js";
import { fingerprintRolloutConfig } from "../lib/recall/hybrid/production-evidence-identity.js";

const AUTHORIZED_AT = "2026-07-20T03:00:00.000Z";
const ACTIVATED_AT = "2026-07-20T03:05:00.000Z";
const BUILD = "a".repeat(64);
const PRE_ACTIVATION_ROLLOUT = "e".repeat(64);
const HOST_CONFIG = "c".repeat(64);
const EPOCH = "b8-a7-sustained-20260720T030000Z-15923c5-r01";

function sustainedConfig(overrides = {}) {
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
    kgFailClosedCanary: { enabled: false, agentIds: [], sessionIds: [], token_count: 0 },
    recentFailClosedMode: "full_fail_closed",
    recentFailClosedCanary: { enabled: false, agentIds: [], sessionIds: [], token_count: 0 },
    productionEvidenceWindow: { enabled: true, epochId: EPOCH },
    hybridRetrieval: { recall: {}, ranking: {}, confidence: {} },
    ...overrides,
  };
}

function proposedConfig() {
  return {
    ...sustainedConfig(),
    kgFailClosedCanary: { enabled: false, agentIds: [], sessionIds: [], tokens: [] },
    recentFailClosedCanary: { enabled: false, agentIds: [], sessionIds: [], tokens: [] },
  };
}

const ROLLOUT = fingerprintRolloutConfig(proposedConfig()).fingerprint;
const LIVE_CONFIG_PATH = "/home/lionsol/.openclaw/openclaw.json";
const PRE_ACTIVATION_CONFIG_SHA = "f".repeat(64);

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
      live_config_sha256: PRE_ACTIVATION_CONFIG_SHA,
      live_byte_count: 1024,
      effective_config_fingerprint: PRE_ACTIVATION_ROLLOUT,
    },
    runtime_preflight: {
      schema_version: 1,
      status: "clean",
      openclaw_config_file_path: LIVE_CONFIG_PATH,
      openclaw_config_file_sha256: PRE_ACTIVATION_CONFIG_SHA,
      openclaw_config_file_byte_count: 1024,
      rollout_config_fingerprint: PRE_ACTIVATION_ROLLOUT,
    },
    proposed_effective_config: proposedConfig(),
    proposed_rollout_config_fingerprint_report: {
      valid: true,
      fingerprint: ROLLOUT,
    },
    config_application_plan: {
      mode: "merge_patch",
      target_path: "plugins.entries.memory-engine.config",
      patch: { productionEvidenceWindow: { enabled: true, epochId: EPOCH } },
      expected_effective_rollout_config_fingerprint: ROLLOUT,
    },
    baseline_template: {
      schema_version: 1,
      active: false,
      evidence_epoch_id: EPOCH,
      runtime_build_identity: BUILD,
      rollout_config_fingerprint: ROLLOUT,
      expected_kg_mode: "full_fail_closed",
      expected_recent_mode: "full_fail_closed",
      openclaw_runtime_version: "2026.7.1",
      authorized_at: AUTHORIZED_AT,
      activation_baseline_finalization_required: true,
    },
    ...overrides,
  };
}

function preflight(overrides = {}) {
  const config = sustainedConfig();
  return {
    schema_version: 1,
    checked_at: ACTIVATED_AT,
    status: "clean",
    openclaw_runtime_version: "2026.7.1",
    openclaw_config_file_path: LIVE_CONFIG_PATH,
    openclaw_config_file_sha256: "d".repeat(64),
    openclaw_config_file_byte_count: 2048,
    openclaw_config_fingerprint: HOST_CONFIG,
    runtime_build_identity: BUILD,
    rollout_config_fingerprint: ROLLOUT,
    effective_config_report: {
      schema_version: 1,
      checked_at: ACTIVATED_AT,
      valid: true,
      errors: [],
      effective_config: config,
      rollout_config_fingerprint: ROLLOUT,
    },
    runtime_boundary: {
      schema_version: 1,
      checked_at: ACTIVATED_AT,
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
    checked_at: ACTIVATED_AT,
    source_runtime_equal: true,
    difference_count: 0,
    runtime_build_identity: BUILD,
    ...overrides,
  };
}

test("post-apply preflight and parity finalize the only active baseline", () => {
  const report = finalizeSustainedRuntimeActivationBaseline({
    authorizationPlan: authorizationPlan(),
    runtimePreflight: preflight(),
    runtimeParity: parity(),
    activatedAt: ACTIVATED_AT,
  });
  assert.equal(report.status, "active_baseline_ready");
  assert.equal(report.active_baseline_ready, true);
  assert.equal(report.baseline.active, true);
  assert.equal(report.baseline.evidence_epoch_id, EPOCH);
  assert.equal(report.baseline.openclaw_config_file_sha256, "d".repeat(64));
  assert.equal(report.baseline.openclaw_config_fingerprint, HOST_CONFIG);
  assert.equal(report.baseline.activated_at, ACTIVATED_AT);
  assert.deepEqual(report.blockers, []);
});

test("activation baseline blocks config, epoch, build, and parity drift", () => {
  const badPreflight = preflight({
    openclaw_config_fingerprint: null,
    runtime_build_identity: "d".repeat(64),
    rollout_config_fingerprint: "e".repeat(64),
    effective_config_report: {
      ...preflight().effective_config_report,
      rollout_config_fingerprint: "e".repeat(64),
      effective_config: sustainedConfig({
        productionEvidenceWindow: { enabled: true, epochId: "wrong" },
      }),
    },
  });
  const report = finalizeSustainedRuntimeActivationBaseline({
    authorizationPlan: authorizationPlan(),
    runtimePreflight: badPreflight,
    runtimeParity: parity({ source_runtime_equal: false, difference_count: 1 }),
    activatedAt: ACTIVATED_AT,
  });
  assert.equal(report.status, "blocked");
  assert.equal(report.baseline, null);
  assert.ok(report.blockers.some(item => item.code === "activation_openclaw_config_fingerprint_invalid"));
  assert.ok(report.blockers.some(item => item.code === "activation_runtime_build_identity_mismatch"));
  assert.ok(report.blockers.some(item => item.code === "activation_rollout_config_fingerprint_mismatch"));
  assert.ok(report.blockers.some(item => item.code === "activation_evidence_epoch_mismatch"));
  assert.ok(report.blockers.some(item => item.code === "activation_runtime_source_parity_drift"));
});

test("activation rejects stale, internally inconsistent, or wrong-config-path authorization artifacts", () => {
  const stale = finalizeSustainedRuntimeActivationBaseline({
    authorizationPlan: authorizationPlan({ generated_at: "2026-07-20T01:00:00.000Z" }),
    runtimePreflight: preflight(),
    runtimeParity: parity(),
    activatedAt: ACTIVATED_AT,
  });
  assert.ok(stale.blockers.some(item => item.code === "authorization_plan_stale"));

  const inconsistent = finalizeSustainedRuntimeActivationBaseline({
    authorizationPlan: authorizationPlan({ technical_ready: false }),
    runtimePreflight: preflight(),
    runtimeParity: parity(),
    activatedAt: ACTIVATED_AT,
  });
  assert.ok(inconsistent.blockers.some(item => item.code === "authorization_plan_not_technically_ready"));

  const wrongPath = finalizeSustainedRuntimeActivationBaseline({
    authorizationPlan: authorizationPlan(),
    runtimePreflight: preflight({ openclaw_config_file_path: "/tmp/other-openclaw.json" }),
    runtimeParity: parity(),
    activatedAt: ACTIVATED_AT,
  });
  assert.ok(wrongPath.blockers.some(item => item.code === "activation_openclaw_config_file_path_mismatch"));
});

test("activation baseline CLI writes a report without applying configuration", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-activation-baseline-"));
  const planPath = join(root, "plan.json");
  const preflightPath = join(root, "preflight.json");
  const parityPath = join(root, "parity.json");
  const out = join(root, "baseline-report.json");
  writeFileSync(planPath, JSON.stringify(authorizationPlan()), "utf8");
  writeFileSync(preflightPath, JSON.stringify(preflight()), "utf8");
  writeFileSync(parityPath, JSON.stringify(parity()), "utf8");
  const result = await baselineCli.finalizeSustainedRuntimeActivationBaselineCli([
    "--authorization-plan", planPath,
    "--runtime-preflight", preflightPath,
    "--runtime-parity", parityPath,
    "--activated-at", ACTIVATED_AT,
    "--out", out,
    "--pretty",
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(readFileSync(out, "utf8")).baseline.active, true);
});
