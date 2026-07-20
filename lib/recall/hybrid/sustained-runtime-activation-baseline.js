import { canonicalIsoTimestamp } from "./hybrid-observation-provenance.js";
import { validateRuntimeParity } from "./production-evidence-health-monitor.js";
import {
  MAXIMUM_RUNTIME_PREFLIGHT_AGE_HOURS,
  REQUIRED_OPERATOR_APPROVALS,
  validateRuntimePreflightForAuthorization,
  validateSustainedRuntimeConfig,
} from "./sustained-runtime-authorization.js";
import {
  fingerprintRolloutConfig,
  isSha256Identity,
} from "./production-evidence-identity.js";

export const MAXIMUM_AUTHORIZATION_PLAN_AGE_HOURS = 1;
export const ACTIVATION_BASELINE_SOURCE = "sustained_runtime_activation_finalizer";

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function issue(code, actual = undefined, expected = undefined) {
  const value = { code };
  if (actual !== undefined) value.actual = actual;
  if (expected !== undefined) value.expected = expected;
  return value;
}

function addUnique(list, value) {
  if (!list.some(item => JSON.stringify(item) === JSON.stringify(value))) list.push(value);
}

function sameStringArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function validateAuthorizationPlanForActivation(authorizationPlan, activatedAtIso) {
  const blockers = [];
  if (!isPlainObject(authorizationPlan)) return [issue("authorization_plan_missing")];
  if (authorizationPlan.schema_version !== 1) blockers.push(issue("authorization_plan_schema_invalid", authorizationPlan.schema_version));
  if (authorizationPlan.decision !== "authorized_plan_ready" || authorizationPlan.execution_authorized !== true) {
    blockers.push(issue("authorization_plan_not_authorized", authorizationPlan.decision));
  }
  if (authorizationPlan.technical_ready !== true) blockers.push(issue("authorization_plan_not_technically_ready"));
  if (authorizationPlan.operator_approvals_complete !== true) blockers.push(issue("authorization_plan_approvals_incomplete"));
  if (!Array.isArray(authorizationPlan.technical_blockers) || authorizationPlan.technical_blockers.length > 0) {
    blockers.push(issue("authorization_plan_technical_blockers_present", authorizationPlan.technical_blockers));
  }
  if (!Array.isArray(authorizationPlan.approval_blockers) || authorizationPlan.approval_blockers.length > 0) {
    blockers.push(issue("authorization_plan_approval_blockers_present", authorizationPlan.approval_blockers));
  }
  if (!sameStringArray(authorizationPlan.required_operator_approvals, REQUIRED_OPERATOR_APPROVALS)) {
    blockers.push(issue("authorization_plan_required_approvals_mismatch"));
  }
  const generatedAt = canonicalIsoTimestamp(authorizationPlan.generated_at);
  if (!generatedAt) blockers.push(issue("authorization_plan_generated_at_invalid", authorizationPlan.generated_at));
  else {
    const ageHours = (Date.parse(activatedAtIso) - Date.parse(generatedAt)) / 3_600_000;
    if (ageHours < 0) blockers.push(issue("authorization_plan_from_future"));
    if (ageHours > MAXIMUM_AUTHORIZATION_PLAN_AGE_HOURS) blockers.push(issue("authorization_plan_stale", ageHours));
  }
  if (authorizationPlan.activation_baseline !== null) blockers.push(issue("authorization_plan_activation_baseline_must_be_null"));

  const template = authorizationPlan.baseline_template;
  const application = authorizationPlan.config_application_plan;
  const proposedConfig = authorizationPlan.proposed_effective_config;
  const fingerprintReport = authorizationPlan.proposed_rollout_config_fingerprint_report;
  if (!isPlainObject(application)
    || application.mode !== "merge_patch"
    || application.target_path !== "plugins.entries.memory-engine.config"
    || !isPlainObject(application.patch)) {
    blockers.push(issue("authorization_plan_config_application_invalid"));
  }
  const proposedValidation = validateSustainedRuntimeConfig(proposedConfig);
  if (!proposedValidation.valid) blockers.push(issue("authorization_plan_proposed_config_invalid", proposedValidation.errors));
  const recomputed = fingerprintRolloutConfig(proposedConfig);
  const expectedFingerprint = template?.rollout_config_fingerprint;
  if (!recomputed.valid || recomputed.fingerprint !== expectedFingerprint) {
    blockers.push(issue("authorization_plan_proposed_config_fingerprint_mismatch", recomputed.fingerprint));
  }
  if (application?.expected_effective_rollout_config_fingerprint !== expectedFingerprint) {
    blockers.push(issue("authorization_plan_application_fingerprint_mismatch", application?.expected_effective_rollout_config_fingerprint));
  }
  if (fingerprintReport?.valid !== true || fingerprintReport?.fingerprint !== expectedFingerprint) {
    blockers.push(issue("authorization_plan_fingerprint_report_mismatch", fingerprintReport?.fingerprint));
  }

  const backup = authorizationPlan.config_backup_manifest;
  const preflight = authorizationPlan.runtime_preflight;
  if (!isPlainObject(backup) || backup.status !== "ready") blockers.push(issue("authorization_plan_config_backup_invalid"));
  if (!isPlainObject(preflight) || preflight.status !== "clean") blockers.push(issue("authorization_plan_runtime_preflight_invalid"));
  if (backup?.live_config_path !== preflight?.openclaw_config_file_path) blockers.push(issue("authorization_plan_live_config_path_mismatch"));
  if (backup?.live_config_sha256 !== preflight?.openclaw_config_file_sha256) blockers.push(issue("authorization_plan_live_config_sha256_mismatch"));
  if (backup?.live_byte_count !== preflight?.openclaw_config_file_byte_count) blockers.push(issue("authorization_plan_live_config_byte_count_mismatch"));
  if (backup?.effective_config_fingerprint !== preflight?.rollout_config_fingerprint) blockers.push(issue("authorization_plan_preflight_rollout_fingerprint_mismatch"));
  return blockers;
}

export function finalizeSustainedRuntimeActivationBaseline({
  authorizationPlan,
  runtimePreflight,
  runtimeParity,
  activatedAt = new Date().toISOString(),
} = {}) {
  const blockers = [];
  const activatedAtIso = canonicalIsoTimestamp(activatedAt);
  if (!activatedAtIso) throw new TypeError("activatedAt must be a canonical UTC ISO timestamp");

  for (const blocker of validateAuthorizationPlanForActivation(authorizationPlan, activatedAtIso)) {
    addUnique(blockers, blocker);
  }

  const template = authorizationPlan?.baseline_template;
  if (!isPlainObject(template)) {
    addUnique(blockers, issue("baseline_template_missing"));
  } else {
    if (template.schema_version !== 1) addUnique(blockers, issue("baseline_template_schema_invalid", template.schema_version));
    if (template.active !== false) addUnique(blockers, issue("baseline_template_must_be_inactive", template.active));
    if (!canonicalIsoTimestamp(template.authorized_at)) addUnique(blockers, issue("baseline_template_authorized_at_invalid", template.authorized_at));
    if (!isSha256Identity(template.runtime_build_identity)) addUnique(blockers, issue("baseline_template_runtime_identity_invalid"));
    if (!isSha256Identity(template.rollout_config_fingerprint)) addUnique(blockers, issue("baseline_template_rollout_fingerprint_invalid"));
    if (typeof template.evidence_epoch_id !== "string" || !template.evidence_epoch_id.trim()) addUnique(blockers, issue("baseline_template_epoch_invalid"));
    if (typeof template.openclaw_runtime_version !== "string" || !template.openclaw_runtime_version.trim()) {
      addUnique(blockers, issue("baseline_template_openclaw_version_invalid"));
    }
    if (template.activation_baseline_finalization_required !== true) {
      addUnique(blockers, issue("baseline_template_finalization_flag_missing"));
    }
    if (canonicalIsoTimestamp(template.authorized_at)
      && Date.parse(activatedAtIso) < Date.parse(template.authorized_at)) {
      addUnique(blockers, issue("activation_before_authorization"));
    }
  }

  const preflightReview = validateRuntimePreflightForAuthorization(runtimePreflight, activatedAtIso);
  for (const blocker of preflightReview.blockers) addUnique(blockers, blocker);
  const config = preflightReview.config;
  const configValidation = validateSustainedRuntimeConfig(config);
  for (const blocker of configValidation.errors) addUnique(blockers, blocker);

  if (runtimePreflight?.runtime_build_identity !== template?.runtime_build_identity) {
    addUnique(blockers, issue("activation_runtime_build_identity_mismatch", runtimePreflight?.runtime_build_identity, template?.runtime_build_identity));
  }
  if (runtimePreflight?.rollout_config_fingerprint !== template?.rollout_config_fingerprint) {
    addUnique(blockers, issue("activation_rollout_config_fingerprint_mismatch", runtimePreflight?.rollout_config_fingerprint, template?.rollout_config_fingerprint));
  }
  if (runtimePreflight?.openclaw_runtime_version !== template?.openclaw_runtime_version) {
    addUnique(blockers, issue("activation_openclaw_runtime_version_mismatch", runtimePreflight?.openclaw_runtime_version, template?.openclaw_runtime_version));
  }
  if (typeof runtimePreflight?.openclaw_config_file_path !== "string" || !runtimePreflight.openclaw_config_file_path.trim()) {
    addUnique(blockers, issue("activation_openclaw_config_file_path_invalid", runtimePreflight?.openclaw_config_file_path));
  }
  const authorizedLiveConfigPath = authorizationPlan?.config_backup_manifest?.live_config_path;
  if (runtimePreflight?.openclaw_config_file_path !== authorizedLiveConfigPath) {
    addUnique(blockers, issue("activation_openclaw_config_file_path_mismatch", runtimePreflight?.openclaw_config_file_path, authorizedLiveConfigPath));
  }
  if (!isSha256Identity(runtimePreflight?.openclaw_config_file_sha256)) {
    addUnique(blockers, issue("activation_openclaw_config_file_sha256_invalid", runtimePreflight?.openclaw_config_file_sha256));
  }
  if (!Number.isInteger(runtimePreflight?.openclaw_config_file_byte_count)
    || runtimePreflight.openclaw_config_file_byte_count <= 0) {
    addUnique(blockers, issue("activation_openclaw_config_file_byte_count_invalid", runtimePreflight?.openclaw_config_file_byte_count));
  }
  if (!isSha256Identity(runtimePreflight?.openclaw_config_fingerprint)) {
    addUnique(blockers, issue("activation_openclaw_config_fingerprint_invalid", runtimePreflight?.openclaw_config_fingerprint));
  }
  if (config?.productionEvidenceWindow?.enabled !== true
    || config?.productionEvidenceWindow?.epochId !== template?.evidence_epoch_id) {
    addUnique(blockers, issue("activation_evidence_epoch_mismatch", config?.productionEvidenceWindow));
  }
  if (config?.kgFailClosedMode !== "full_fail_closed") addUnique(blockers, issue("activation_kg_mode_not_full", config?.kgFailClosedMode));
  if (config?.recentFailClosedMode !== "full_fail_closed") addUnique(blockers, issue("activation_recent_mode_not_full", config?.recentFailClosedMode));
  if (config?.autoRecall?.enabled !== true) addUnique(blockers, issue("activation_auto_recall_not_enabled", config?.autoRecall?.enabled));

  const parityValidation = validateRuntimeParity(runtimeParity);
  if (!parityValidation.valid) {
    for (const blocker of parityValidation.errors) addUnique(blockers, blocker);
  } else {
    if (runtimeParity.source_runtime_equal !== true || runtimeParity.difference_count !== 0) {
      addUnique(blockers, issue("activation_runtime_source_parity_drift"));
    }
    if (runtimeParity.runtime_build_identity !== template?.runtime_build_identity) {
      addUnique(blockers, issue("activation_parity_build_identity_mismatch"));
    }
    if (runtimeParity.runtime_build_identity !== runtimePreflight?.runtime_build_identity) {
      addUnique(blockers, issue("activation_preflight_parity_identity_mismatch"));
    }
    const parityAt = canonicalIsoTimestamp(runtimeParity.checked_at);
    if (parityAt) {
      const ageHours = (Date.parse(activatedAtIso) - Date.parse(parityAt)) / 3_600_000;
      if (ageHours < 0) addUnique(blockers, issue("activation_runtime_parity_from_future"));
      if (ageHours > MAXIMUM_RUNTIME_PREFLIGHT_AGE_HOURS) {
        addUnique(blockers, issue("activation_runtime_parity_stale", ageHours));
      }
    }
  }

  const ready = blockers.length === 0;
  const baseline = ready
    ? {
      schema_version: 1,
      active: true,
      activation_source: ACTIVATION_BASELINE_SOURCE,
      authorization_plan_generated_at: authorizationPlan.generated_at,
      evidence_epoch_id: template.evidence_epoch_id,
      runtime_build_identity: template.runtime_build_identity,
      rollout_config_fingerprint: template.rollout_config_fingerprint,
      openclaw_runtime_version: template.openclaw_runtime_version,
      openclaw_config_file_path: runtimePreflight.openclaw_config_file_path,
      openclaw_config_file_sha256: runtimePreflight.openclaw_config_file_sha256,
      openclaw_config_file_byte_count: runtimePreflight.openclaw_config_file_byte_count,
      openclaw_config_fingerprint: runtimePreflight.openclaw_config_fingerprint,
      expected_kg_mode: "full_fail_closed",
      expected_recent_mode: "full_fail_closed",
      authorized_at: template.authorized_at,
      activated_at: activatedAtIso,
    }
    : null;

  return {
    schema_version: 1,
    checked_at: activatedAtIso,
    status: ready ? "active_baseline_ready" : "blocked",
    active_baseline_ready: ready,
    blockers,
    baseline,
  };
}

export {
  isPlainObject,
  validateAuthorizationPlanForActivation,
};
