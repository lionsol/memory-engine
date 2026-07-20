import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EVIDENCE_EPOCH_PATTERN,
  REQUIRED_OPERATOR_APPROVALS,
  buildEvidenceEpochId,
  buildSustainedRuntimeAuthorizationPlan,
  validateSustainedRuntimeConfig,
} from "../lib/recall/hybrid/sustained-runtime-authorization.js";

const AUTHORIZED_AT = "2026-07-20T03:00:00.000Z";
const BUILD = "a".repeat(64);
const CURRENT_CONFIG_FINGERPRINT = "c".repeat(64);
const OPENCLAW_CONFIG_FINGERPRINT = "d".repeat(64);
const PLUGIN_CONFIG_SCHEMA = JSON.parse(
  readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"),
).configSchema;

function assertSchemaShape(value, schema, path = "config") {
  if (schema?.type === "object") {
    assert.equal(value !== null && typeof value === "object" && !Array.isArray(value), true, `${path} must be an object`);
    const properties = schema.properties || {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        assert.equal(Object.hasOwn(properties, key), true, `${path}.${key} is not allowed by manifest schema`);
      }
    }
    for (const [key, item] of Object.entries(value)) {
      if (properties[key]) assertSchemaShape(item, properties[key], `${path}.${key}`);
    }
    return;
  }
  if (schema?.type === "array") {
    assert.equal(Array.isArray(value), true, `${path} must be an array`);
    for (const [index, item] of value.entries()) assertSchemaShape(item, schema.items, `${path}[${index}]`);
    return;
  }
  if (schema?.type === "boolean") assert.equal(typeof value, "boolean", `${path} must be boolean`);
  if (schema?.type === "string") assert.equal(typeof value, "string", `${path} must be string`);
  if (schema?.type === "integer") assert.equal(Number.isInteger(value), true, `${path} must be integer`);
}

function currentConfig() {
  return {
    autoRecall: {
      enabled: false,
      topK: 3,
      timeoutMs: 8000,
      agentAllowlist: ["edi"],
      triggerAllowlist: ["user"],
      chatTypeAllowlist: ["interactive_user_chat"],
      messageRoleAllowlist: ["user"],
      cardFirstRuntime: { enabled: false },
    },
    kgFailClosedMode: "legacy_fallback",
    kgFailClosedCanary: { enabled: false, agentIds: [], sessionIds: [], token_count: 0 },
    recentFailClosedMode: "legacy_fallback",
    recentFailClosedCanary: { enabled: false, agentIds: [], sessionIds: [], token_count: 0 },
    productionEvidenceWindow: { enabled: false, epochId: null },
    hybridRetrieval: { recall: {}, ranking: {}, confidence: {} },
  };
}

function configReport(config = currentConfig(), overrides = {}) {
  return {
    schema_version: 1,
    checked_at: AUTHORIZED_AT,
    valid: true,
    errors: [],
    effective_config: config,
    rollout_config_fingerprint: CURRENT_CONFIG_FINGERPRINT,
    ...overrides,
  };
}

function backupManifest(overrides = {}) {
  return {
    schema_version: 1,
    created_at: AUTHORIZED_AT,
    status: "ready",
    valid: true,
    backup_path: "/tmp/openclaw-pre-a7.json",
    live_config_path: "/home/lionsol/.openclaw/openclaw.json",
    config_sha256: "e".repeat(64),
    live_config_sha256: "e".repeat(64),
    byte_count: 1024,
    live_byte_count: 1024,
    backup_matches_live_config: true,
    openclaw_config_fingerprint: OPENCLAW_CONFIG_FINGERPRINT,
    effective_config_fingerprint: CURRENT_CONFIG_FINGERPRINT,
    active_memory_enabled: false,
    kg_mode: "legacy_fallback",
    recent_mode: "legacy_fallback",
    auto_recall_enabled: false,
    production_evidence_enabled: false,
    blockers: [],
    ...overrides,
  };
}

function runtimeParity(overrides = {}) {
  return {
    schema_version: 1,
    checked_at: AUTHORIZED_AT,
    source_runtime_equal: true,
    difference_count: 0,
    runtime_build_identity: BUILD,
    ...overrides,
  };
}

function forecast(overrides = {}) {
  return {
    schema_version: 1,
    status: "ready",
    ready: true,
    as_of: AUTHORIZED_AT,
    blockers: [],
    history_days: 30,
    invalid_provenance_count: 0,
    invalid_origin_evidence_count: 0,
    unknown_origin_count: 0,
    projected_natural_observation_count: 600,
    natural_observed_by_surface: {
      auto_recall: 360,
      memory_engine_search: 120,
      memory_engine_action_search: 120,
    },
    projected_observed_by_surface: {
      auto_recall: 360,
      memory_engine_search: 120,
      memory_engine_action_search: 120,
    },
    active_days_by_surface: {
      auto_recall: 24,
      memory_engine_search: 15,
      memory_engine_action_search: 15,
    },
    maximum_gap_hours_by_surface: {
      auto_recall: 48,
      memory_engine_search: 72,
      memory_engine_action_search: 72,
    },
    ...overrides,
  };
}

function boundary(overrides = {}) {
  return {
    schema_version: 1,
    checked_at: AUTHORIZED_AT,
    status: "clean",
    active_memory_enabled: false,
    blockers: [],
    ...overrides,
  };
}

function preflight(overrides = {}) {
  return {
    schema_version: 1,
    checked_at: AUTHORIZED_AT,
    status: "clean",
    openclaw_runtime_version: "2026.7.1",
    openclaw_config_file_path: "/home/lionsol/.openclaw/openclaw.json",
    openclaw_config_file_sha256: "e".repeat(64),
    openclaw_config_file_byte_count: 1024,
    openclaw_config_fingerprint: OPENCLAW_CONFIG_FINGERPRINT,
    runtime_build_identity: BUILD,
    rollout_config_fingerprint: CURRENT_CONFIG_FINGERPRINT,
    effective_config_report: configReport(),
    runtime_boundary: boundary(),
    blockers: [],
    ...overrides,
  };
}

function approvals() {
  return Object.fromEntries(REQUIRED_OPERATOR_APPROVALS.map(key => [key, true]));
}

test("epoch id is unique-format, timestamped, commit-bound, and revisioned", () => {
  const epoch = buildEvidenceEpochId({ authorizedAt: AUTHORIZED_AT, head: "15923c53b3a7937", revision: 1 });
  assert.equal(epoch, "b8-a7-sustained-20260720T030000Z-15923c5-r01");
  assert.match(epoch, EVIDENCE_EPOCH_PATTERN);
});

test("technically ready plan still requires every explicit operator approval", () => {
  const plan = buildSustainedRuntimeAuthorizationPlan({
    runtimePreflight: preflight(),
    runtimeParity: runtimeParity(),
    trafficForecast: forecast(),
    configBackupManifest: backupManifest(),
    authorizedAt: AUTHORIZED_AT,
    head: "15923c5",
  });
  assert.equal(plan.decision, "ready_for_operator_approval");
  assert.equal(plan.execution_authorized, false);
  assert.equal(plan.technical_ready, true);
  assert.equal(plan.approval_blockers.length, REQUIRED_OPERATOR_APPROVALS.length);
  assert.equal(plan.proposed_effective_config.autoRecall.timeoutMs, 4000);
  assert.equal(plan.proposed_effective_config.productionEvidenceWindow.enabled, true);
  assert.equal(plan.baseline_template.runtime_build_identity, BUILD);
  assert.equal(plan.baseline_template.openclaw_runtime_version, "2026.7.1");
  assert.equal(plan.baseline_template.active, false);
  assert.equal(plan.activation_baseline, null);
  assert.equal(validateSustainedRuntimeConfig(plan.proposed_effective_config).valid, true);
});

test("config application plan is a manifest-valid merge patch without derived effective fields", () => {
  const plan = buildSustainedRuntimeAuthorizationPlan({
    runtimePreflight: preflight(),
    runtimeParity: runtimeParity(),
    trafficForecast: forecast(),
    configBackupManifest: backupManifest(),
    authorizedAt: AUTHORIZED_AT,
    head: "15923c5",
  });
  assert.equal(plan.config_application_plan.mode, "merge_patch");
  assert.equal(plan.config_application_plan.target_path, "plugins.entries.memory-engine.config");
  assert.equal(plan.config_application_plan.post_apply_verification, "memoryEngine.sustainedRuntimePreflight");
  assert.equal(
    plan.config_application_plan.expected_effective_rollout_config_fingerprint,
    plan.proposed_rollout_config_fingerprint_report.fingerprint,
  );
  assert.equal(Object.hasOwn(plan.config_application_plan.patch, "hybridRetrieval"), false);
  assert.equal(Object.hasOwn(plan.config_application_plan.patch.kgFailClosedCanary, "tokens"), false);
  assert.equal(Object.hasOwn(plan.config_application_plan.patch.recentFailClosedCanary, "tokens"), false);
  assertSchemaShape(plan.config_application_plan.patch, PLUGIN_CONFIG_SCHEMA);
});

test("complete approvals produce an executable plan but do not execute it", () => {
  const plan = buildSustainedRuntimeAuthorizationPlan({
    runtimePreflight: preflight(),
    runtimeParity: runtimeParity(),
    trafficForecast: forecast(),
    configBackupManifest: backupManifest(),
    authorizedAt: AUTHORIZED_AT,
    head: "15923c5",
    operatorApprovals: approvals(),
  });
  assert.equal(plan.decision, "authorized_plan_ready");
  assert.equal(plan.execution_authorized, true);
  assert.deepEqual(plan.rollback_plan.monitor_exit_codes_requiring_rollback, [2, 64]);
  assert.equal(plan.rollback_plan.mode, "dry_run_only");
  assert.equal(plan.rollback_plan.exact_config_backup.config_sha256, "e".repeat(64));
  assert.equal(plan.rollback_plan.exact_config_backup.backup_path, "/tmp/openclaw-pre-a7.json");
  assert.equal(plan.rollback_plan.exact_config_backup.backup_matches_live_config, true);
});

test("authorization rejects missing, stale, or mismatched exact config backup manifests", () => {
  const missing = buildSustainedRuntimeAuthorizationPlan({
    runtimePreflight: preflight(),
    runtimeParity: runtimeParity(),
    trafficForecast: forecast(),
    authorizedAt: AUTHORIZED_AT,
    head: "15923c5",
  });
  assert.ok(missing.technical_blockers.some(item => item.code === "config_backup_manifest_missing"));

  const stale = buildSustainedRuntimeAuthorizationPlan({
    runtimePreflight: preflight(),
    runtimeParity: runtimeParity(),
    trafficForecast: forecast(),
    configBackupManifest: backupManifest({ created_at: "2026-07-20T01:00:00.000Z" }),
    authorizedAt: AUTHORIZED_AT,
    head: "15923c5",
  });
  assert.ok(stale.technical_blockers.some(item => item.code === "config_backup_stale"));

  const mismatch = buildSustainedRuntimeAuthorizationPlan({
    runtimePreflight: preflight(),
    runtimeParity: runtimeParity(),
    trafficForecast: forecast(),
    configBackupManifest: backupManifest({ effective_config_fingerprint: "f".repeat(64) }),
    authorizedAt: AUTHORIZED_AT,
    head: "15923c5",
  });
  assert.ok(mismatch.technical_blockers.some(item => item.code === "config_backup_preflight_fingerprint_mismatch"));

  const liveMismatch = buildSustainedRuntimeAuthorizationPlan({
    runtimePreflight: preflight(),
    runtimeParity: runtimeParity(),
    trafficForecast: forecast(),
    configBackupManifest: backupManifest({
      live_config_sha256: "d".repeat(64),
      backup_matches_live_config: false,
    }),
    authorizedAt: AUTHORIZED_AT,
    head: "15923c5",
  });
  assert.ok(liveMismatch.technical_blockers.some(item => item.code === "config_backup_live_sha256_mismatch"));
  assert.ok(liveMismatch.technical_blockers.some(item => item.code === "config_backup_live_bytes_not_verified"));
});

test("traffic insufficiency, parity drift, and active-memory preflight conflict block authorization", () => {
  const plan = buildSustainedRuntimeAuthorizationPlan({
    runtimePreflight: preflight({
      status: "blocked",
      runtime_boundary: boundary({
        status: "conflict",
        active_memory_enabled: true,
        blockers: ["active_memory_enabled"],
      }),
      blockers: ["runtime_boundary_conflict", "active_memory_enabled"],
    }),
    runtimeParity: runtimeParity({ source_runtime_equal: false, difference_count: 1 }),
    trafficForecast: forecast({ status: "blocked", ready: false, blockers: ["tool traffic low"] }),
    authorizedAt: AUTHORIZED_AT,
    head: "15923c5",
    operatorApprovals: approvals(),
  });
  assert.equal(plan.decision, "blocked");
  assert.ok(plan.technical_blockers.some(item => item.code === "runtime_source_parity_drift"));
  assert.ok(plan.technical_blockers.some(item => item.code === "natural_traffic_forecast_not_ready"));
  assert.ok(plan.technical_blockers.some(item => item.code === "active_memory_conflict"));
});

test("authorization rejects missing, stale, invalid, or internally inconsistent preflight reports", () => {
  const missing = buildSustainedRuntimeAuthorizationPlan({
    runtimeParity: runtimeParity(),
    trafficForecast: forecast(),
    authorizedAt: AUTHORIZED_AT,
    head: "15923c5",
  });
  assert.ok(missing.technical_blockers.some(item => item.code === "runtime_preflight_report_missing"));

  const stale = buildSustainedRuntimeAuthorizationPlan({
    runtimePreflight: preflight({ checked_at: "2026-07-19T00:00:00.000Z" }),
    runtimeParity: runtimeParity(),
    trafficForecast: forecast(),
    authorizedAt: AUTHORIZED_AT,
    head: "15923c5",
  });
  assert.ok(stale.technical_blockers.some(item => item.code === "runtime_preflight_stale"));

  const invalid = buildSustainedRuntimeAuthorizationPlan({
    runtimePreflight: preflight({
      effective_config_report: configReport(currentConfig(), { valid: false, errors: ["bad"] }),
    }),
    runtimeParity: runtimeParity(),
    trafficForecast: forecast(),
    authorizedAt: AUTHORIZED_AT,
    head: "15923c5",
  });
  assert.ok(invalid.technical_blockers.some(item => item.code === "current_effective_config_invalid"));
});

test("authorization rejects preflight and source/runtime parity identity mismatch", () => {
  const mismatch = buildSustainedRuntimeAuthorizationPlan({
    runtimePreflight: preflight({ runtime_build_identity: "d".repeat(64) }),
    runtimeParity: runtimeParity(),
    trafficForecast: forecast(),
    authorizedAt: AUTHORIZED_AT,
    head: "15923c5",
  });
  assert.ok(mismatch.technical_blockers.some(item => item.code === "runtime_preflight_parity_identity_mismatch"));

  const fingerprintMismatch = buildSustainedRuntimeAuthorizationPlan({
    runtimePreflight: preflight({
      effective_config_report: configReport(currentConfig(), { rollout_config_fingerprint: "d".repeat(64) }),
    }),
    runtimeParity: runtimeParity(),
    trafficForecast: forecast(),
    authorizedAt: AUTHORIZED_AT,
    head: "15923c5",
  });
  assert.ok(fingerprintMismatch.technical_blockers.some(item => item.code === "runtime_preflight_config_fingerprint_mismatch"));

  const timestampMismatch = buildSustainedRuntimeAuthorizationPlan({
    runtimePreflight: preflight({
      effective_config_report: configReport(currentConfig(), { checked_at: "2026-07-20T02:59:00.000Z" }),
      runtime_boundary: boundary({ checked_at: "2026-07-20T02:58:00.000Z" }),
    }),
    runtimeParity: runtimeParity(),
    trafficForecast: forecast(),
    authorizedAt: AUTHORIZED_AT,
    head: "15923c5",
  });
  assert.ok(timestampMismatch.technical_blockers.some(item => item.code === "runtime_preflight_config_timestamp_mismatch"));
  assert.ok(timestampMismatch.technical_blockers.some(item => item.code === "runtime_preflight_boundary_timestamp_mismatch"));
});

test("authorization rejects stale or structurally incomplete forecast reports", () => {
  const plan = buildSustainedRuntimeAuthorizationPlan({
    runtimePreflight: preflight(),
    runtimeParity: runtimeParity(),
    trafficForecast: forecast({
      as_of: "2026-07-18T00:00:00.000Z",
      projected_observed_by_surface: {},
      natural_observed_by_surface: {},
    }),
    authorizedAt: AUTHORIZED_AT,
    head: "15923c5",
  });
  assert.equal(plan.decision, "blocked");
  assert.ok(plan.technical_blockers.some(item => item.code === "natural_traffic_forecast_stale"));
  assert.ok(plan.technical_blockers.some(item => item.code.includes("projected_surface_observations_missing")));
});

test("authorization rejects weaker continuity and freshness thresholds", () => {
  const plan = buildSustainedRuntimeAuthorizationPlan({
    runtimePreflight: preflight(),
    runtimeParity: runtimeParity(),
    trafficForecast: forecast(),
    authorizedAt: AUTHORIZED_AT,
    head: "15923c5",
    continuityThresholds: { minimum_observations: 1 },
    monitorThresholds: { maximum_healthcheck_age_hours: 24 },
  });
  assert.equal(plan.decision, "blocked");
  assert.ok(plan.technical_blockers.some(item => item.code === "continuity_threshold_weakened:minimum_observations"));
  assert.ok(plan.technical_blockers.some(item => item.code === "monitor_threshold_weakened:maximum_healthcheck_age_hours"));
});

test("authorization cannot start from an already active or non-legacy runtime", () => {
  const config = currentConfig();
  config.productionEvidenceWindow = { enabled: true, epochId: "old" };
  config.kgFailClosedMode = "full_fail_closed";
  const plan = buildSustainedRuntimeAuthorizationPlan({
    runtimePreflight: preflight({ effective_config_report: configReport(config) }),
    runtimeParity: runtimeParity(),
    trafficForecast: forecast(),
    authorizedAt: AUTHORIZED_AT,
    head: "15923c5",
  });
  assert.equal(plan.decision, "blocked");
  assert.ok(plan.technical_blockers.some(item => item.code === "production_evidence_window_already_active"));
  assert.ok(plan.technical_blockers.some(item => item.code === "current_kg_mode_not_legacy"));
});
