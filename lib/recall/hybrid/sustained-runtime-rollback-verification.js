import {
  PRODUCTION_HYBRID_OBSERVATION_SURFACES,
  canonicalIsoTimestamp,
  parseHybridObservationMetadata,
  validateProductionHybridObservationProvenance,
} from "./hybrid-observation-provenance.js";
import {
  validateBaseline,
  validateRuntimeParity,
} from "./production-evidence-health-monitor.js";
import { validateAuthorizationPlanForActivation } from "./sustained-runtime-activation-baseline.js";
import { validateRuntimePreflightForAuthorization } from "./sustained-runtime-authorization.js";
import { validateHybridTrafficOriginEvidence } from "./traffic-origin.js";

const TOOL_SURFACES = Object.freeze([
  "memory_engine_search",
  "memory_engine_action_search",
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function issue(code, actual = undefined) {
  return actual === undefined ? { code } : { code, actual };
}

function addUnique(list, value) {
  if (!list.some(item => JSON.stringify(item) === JSON.stringify(value))) list.push(value);
}

function verifyActivationBaseline({ authorizationPlan, activationBaselineReport, checkedAt, blockers }) {
  if (!isPlainObject(activationBaselineReport)) {
    addUnique(blockers, issue("activation_baseline_report_missing"));
    return null;
  }
  if (activationBaselineReport.schema_version !== 1) {
    addUnique(blockers, issue("activation_baseline_report_schema_invalid", activationBaselineReport.schema_version));
  }
  if (activationBaselineReport.status !== "active_baseline_ready"
    || activationBaselineReport.active_baseline_ready !== true) {
    addUnique(blockers, issue("activation_baseline_report_not_ready", activationBaselineReport.status));
  }
  if (!Array.isArray(activationBaselineReport.blockers) || activationBaselineReport.blockers.length > 0) {
    addUnique(blockers, issue("activation_baseline_report_blockers_present", activationBaselineReport.blockers));
  }
  const baseline = activationBaselineReport.baseline;
  const baselineValidation = validateBaseline(baseline);
  if (!baselineValidation.valid || baseline?.active !== true) {
    for (const finding of baselineValidation.errors) addUnique(blockers, finding);
    addUnique(blockers, issue("activation_baseline_invalid"));
    return null;
  }
  const checkedAtValue = canonicalIsoTimestamp(activationBaselineReport.checked_at);
  if (!checkedAtValue || checkedAtValue !== baseline.activated_at) {
    addUnique(blockers, issue("activation_baseline_checked_at_mismatch", activationBaselineReport.checked_at));
  }
  if (Date.parse(baseline.activated_at) > Date.parse(checkedAt)) {
    addUnique(blockers, issue("activation_baseline_from_future"));
  }
  for (const finding of validateAuthorizationPlanForActivation(authorizationPlan, baseline.activated_at)) {
    addUnique(blockers, finding);
  }
  const template = authorizationPlan?.baseline_template;
  for (const key of [
    "evidence_epoch_id",
    "runtime_build_identity",
    "rollout_config_fingerprint",
    "openclaw_runtime_version",
    "authorized_at",
  ]) {
    if (baseline[key] !== template?.[key]) addUnique(blockers, issue(`activation_baseline_${key}_mismatch`, baseline[key]));
  }
  if (baseline.authorization_plan_generated_at !== authorizationPlan?.generated_at) {
    addUnique(blockers, issue("activation_baseline_plan_timestamp_mismatch", baseline.authorization_plan_generated_at));
  }
  if (baseline.openclaw_config_file_path !== authorizationPlan?.config_backup_manifest?.live_config_path) {
    addUnique(blockers, issue("activation_baseline_live_config_path_mismatch", baseline.openclaw_config_file_path));
  }
  return baseline;
}

function verifyRestoredConfig({ authorizationPlan, restoredConfigManifest, checkedAt, blockers }) {
  const expected = authorizationPlan?.rollback_plan?.exact_config_backup;
  if (!isPlainObject(expected)) addUnique(blockers, issue("authorization_exact_config_backup_missing"));
  if (!isPlainObject(restoredConfigManifest)) {
    addUnique(blockers, issue("restored_config_manifest_missing"));
    return;
  }
  if (restoredConfigManifest.valid !== true || restoredConfigManifest.status !== "ready") {
    addUnique(blockers, issue("restored_config_manifest_not_ready", restoredConfigManifest.status));
  }
  if (!Array.isArray(restoredConfigManifest.blockers) || restoredConfigManifest.blockers.length > 0) {
    addUnique(blockers, issue("restored_config_manifest_blockers_present", restoredConfigManifest.blockers));
  }
  for (const key of [
    "backup_path",
    "live_config_path",
    "config_sha256",
    "live_config_sha256",
    "byte_count",
    "live_byte_count",
    "openclaw_config_fingerprint",
    "effective_config_fingerprint",
  ]) {
    if (expected?.[key] !== restoredConfigManifest[key]) {
      addUnique(blockers, issue(`restored_config_${key}_mismatch`, restoredConfigManifest[key]));
    }
  }
  if (expected?.backup_matches_live_config !== true
    || restoredConfigManifest.backup_matches_live_config !== true) {
    addUnique(blockers, issue("restored_config_live_bytes_not_verified"));
  }
  if (restoredConfigManifest.kg_mode !== "legacy_fallback") addUnique(blockers, issue("restored_kg_mode_not_legacy", restoredConfigManifest.kg_mode));
  if (restoredConfigManifest.recent_mode !== "legacy_fallback") addUnique(blockers, issue("restored_recent_mode_not_legacy", restoredConfigManifest.recent_mode));
  if (restoredConfigManifest.auto_recall_enabled !== false) addUnique(blockers, issue("restored_auto_recall_not_disabled", restoredConfigManifest.auto_recall_enabled));
  if (restoredConfigManifest.production_evidence_enabled !== false) addUnique(blockers, issue("restored_evidence_window_not_disabled", restoredConfigManifest.production_evidence_enabled));
  if (restoredConfigManifest.active_memory_enabled !== false) addUnique(blockers, issue("restored_active_memory_conflict", restoredConfigManifest.active_memory_enabled));
  const restoredAt = canonicalIsoTimestamp(restoredConfigManifest.created_at);
  if (!restoredAt) addUnique(blockers, issue("restored_config_created_at_invalid", restoredConfigManifest.created_at));
  else {
    const ageHours = (Date.parse(checkedAt) - Date.parse(restoredAt)) / 3_600_000;
    if (ageHours < 0) addUnique(blockers, issue("restored_config_from_future"));
    if (ageHours > 1) addUnique(blockers, issue("restored_config_manifest_stale", ageHours));
  }
  return restoredAt;
}

function verifyRuntime({ authorizationPlan, activeBaseline, runtimePreflight, runtimeParity, checkedAt, blockers }) {
  const baseline = activeBaseline;
  const preflight = validateRuntimePreflightForAuthorization(runtimePreflight, checkedAt);
  for (const finding of preflight.blockers) addUnique(blockers, finding);
  if (runtimePreflight?.runtime_build_identity !== baseline?.runtime_build_identity) {
    addUnique(blockers, issue("rollback_runtime_build_identity_mismatch"));
  }
  if (runtimePreflight?.openclaw_runtime_version !== baseline?.openclaw_runtime_version) {
    addUnique(blockers, issue("rollback_openclaw_runtime_version_mismatch"));
  }
  const expectedBackup = authorizationPlan?.rollback_plan?.exact_config_backup;
  const expectedFingerprint = expectedBackup?.effective_config_fingerprint;
  if (runtimePreflight?.openclaw_config_file_path !== expectedBackup?.live_config_path) {
    addUnique(blockers, issue("rollback_openclaw_config_file_path_mismatch"));
  }
  if (runtimePreflight?.openclaw_config_file_sha256 !== expectedBackup?.config_sha256) {
    addUnique(blockers, issue("rollback_openclaw_config_file_sha256_mismatch"));
  }
  if (runtimePreflight?.openclaw_config_file_byte_count !== expectedBackup?.byte_count) {
    addUnique(blockers, issue("rollback_openclaw_config_file_byte_count_mismatch"));
  }
  if (runtimePreflight?.openclaw_config_fingerprint !== expectedBackup?.openclaw_config_fingerprint) {
    addUnique(blockers, issue("rollback_openclaw_config_fingerprint_mismatch"));
  }
  if (runtimePreflight?.rollout_config_fingerprint !== expectedFingerprint) {
    addUnique(blockers, issue("rollback_runtime_config_fingerprint_mismatch"));
  }
  const config = preflight.config;
  if (config?.kgFailClosedMode !== "legacy_fallback") addUnique(blockers, issue("rollback_preflight_kg_mode_not_legacy", config?.kgFailClosedMode));
  if (config?.recentFailClosedMode !== "legacy_fallback") addUnique(blockers, issue("rollback_preflight_recent_mode_not_legacy", config?.recentFailClosedMode));
  if (config?.autoRecall?.enabled !== false) addUnique(blockers, issue("rollback_preflight_auto_recall_not_disabled", config?.autoRecall?.enabled));
  if (config?.productionEvidenceWindow?.enabled !== false) addUnique(blockers, issue("rollback_preflight_evidence_window_not_disabled", config?.productionEvidenceWindow?.enabled));

  const parityValidation = validateRuntimeParity(runtimeParity);
  if (!parityValidation.valid) for (const finding of parityValidation.errors) addUnique(blockers, finding);
  if (parityValidation.valid) {
    const parityAt = canonicalIsoTimestamp(runtimeParity.checked_at);
    const parityAgeHours = parityAt ? (Date.parse(checkedAt) - Date.parse(parityAt)) / 3_600_000 : null;
    if (parityAgeHours !== null && parityAgeHours < 0) addUnique(blockers, issue("rollback_runtime_parity_from_future"));
    if (parityAgeHours !== null && parityAgeHours > 1) addUnique(blockers, issue("rollback_runtime_parity_stale", parityAgeHours));
    if (runtimeParity.source_runtime_equal !== true || runtimeParity.difference_count !== 0) addUnique(blockers, issue("rollback_runtime_source_parity_drift"));
    if (runtimeParity.runtime_build_identity !== baseline?.runtime_build_identity) addUnique(blockers, issue("rollback_parity_build_identity_mismatch"));
    if (runtimeParity.runtime_build_identity !== runtimePreflight?.runtime_build_identity) addUnique(blockers, issue("rollback_preflight_parity_identity_mismatch"));
  }
}

function verifyRollbackObservations(observations, blockers, { notBefore, checkedAt } = {}) {
  const probeCounts = Object.fromEntries(TOOL_SURFACES.map(surface => [surface, 0]));
  let qualifyingCount = 0;
  for (const row of Array.isArray(observations) ? observations : []) {
    if (row?.event_type !== "hybrid_search_observation") continue;
    const provenance = validateProductionHybridObservationProvenance(row);
    if (!provenance.valid) {
      addUnique(blockers, issue("rollback_observation_invalid_provenance", provenance.reasons));
      continue;
    }
    const metadata = parseHybridObservationMetadata(row);
    const completedAt = canonicalIsoTimestamp(metadata?.completed_at);
    if (!completedAt) {
      addUnique(blockers, issue("rollback_observation_completed_at_invalid", metadata?.completed_at));
      continue;
    }
    if (notBefore && Date.parse(completedAt) < Date.parse(notBefore)) addUnique(blockers, issue("rollback_observation_before_restore", completedAt));
    if (checkedAt && Date.parse(completedAt) > Date.parse(checkedAt)) addUnique(blockers, issue("rollback_observation_from_future", completedAt));
    const surface = metadata?.surface;
    if (!PRODUCTION_HYBRID_OBSERVATION_SURFACES.includes(surface)) {
      addUnique(blockers, issue("rollback_unknown_surface", surface));
      continue;
    }
    qualifyingCount += 1;
    if (surface === "auto_recall") addUnique(blockers, issue("rollback_auto_recall_observation_present"));
    if (metadata.production_evidence_enabled === true || metadata.evidence_epoch_id) addUnique(blockers, issue("rollback_production_evidence_residue", surface));
    if (metadata.kg_runtime_mode !== "legacy_fallback") addUnique(blockers, issue("rollback_kg_mode_residue", metadata.kg_runtime_mode));
    if (metadata.recent_runtime_mode !== "legacy_fallback") addUnique(blockers, issue("rollback_recent_mode_residue", metadata.recent_runtime_mode));
    if (metadata.kg_rollout_scope === "full" || metadata.recent_rollout_scope === "full") addUnique(blockers, issue("rollback_full_scope_residue", surface));
    if (metadata.kg_fail_closed_fallback_suppressed === true || metadata.recent_fail_closed_fallback_suppressed === true) {
      addUnique(blockers, issue("rollback_fallback_suppression_residue", surface));
    }
    if (Number(metadata.channel_error_count || 0) !== 0) addUnique(blockers, issue("rollback_channel_error_present", metadata.channel_error_count));
    if (TOOL_SURFACES.includes(surface)) {
      const origin = validateHybridTrafficOriginEvidence({
        surface,
        origin: metadata.traffic_origin,
        evidence: metadata.traffic_origin_evidence,
        valid: metadata.traffic_origin_valid,
        reasons: metadata.traffic_origin_reasons,
      });
      if (!origin.valid || metadata.traffic_origin !== "operator_verification_probe") {
        addUnique(blockers, issue(`rollback_probe_origin_invalid:${surface}`));
      } else probeCounts[surface] += 1;
    }
  }
  if (qualifyingCount === 0) addUnique(blockers, issue("rollback_observations_missing"));
  for (const surface of TOOL_SURFACES) {
    if (probeCounts[surface] === 0) addUnique(blockers, issue(`rollback_probe_missing:${surface}`));
  }
  return { qualifyingCount, probeCounts };
}

function verifySafetySmoke(safetySmoke, blockers, checkedAt) {
  const summary = safetySmoke?.summary;
  if (!isPlainObject(summary)) {
    addUnique(blockers, issue("rollback_safety_smoke_missing"));
    return;
  }
  if (safetySmoke?.stage !== "F1-D-B8-A5") addUnique(blockers, issue("rollback_safety_smoke_stage_invalid", safetySmoke?.stage));
  if (summary.mode !== "synthetic_in_memory_safety_smoke") addUnique(blockers, issue("rollback_safety_smoke_mode_invalid", summary.mode));
  const sideEffects = safetySmoke?.side_effects;
  if (!isPlainObject(sideEffects)
    || sideEffects.real_db_access !== false
    || sideEffects.synthetic_in_memory_sqlite !== true
    || sideEffects.openclaw_runtime !== false
    || sideEffects.config_mutation !== false) {
    addUnique(blockers, issue("rollback_safety_smoke_boundary_invalid"));
  }
  if (summary.status !== "pass") addUnique(blockers, issue("rollback_safety_smoke_failed", summary.status));
  if (!Number.isInteger(summary.check_count) || summary.check_count < 1) addUnique(blockers, issue("rollback_safety_smoke_check_count_invalid", summary.check_count));
  if (summary.passed_count !== summary.check_count || summary.failed_count !== 0) addUnique(blockers, issue("rollback_safety_smoke_not_all_passed"));
  if (!Array.isArray(summary.failed_check_ids) || summary.failed_check_ids.length > 0) addUnique(blockers, issue("rollback_safety_smoke_failed_ids_present", summary.failed_check_ids));
  const generatedAt = canonicalIsoTimestamp(safetySmoke?.generated_at);
  if (!generatedAt) addUnique(blockers, issue("rollback_safety_smoke_generated_at_invalid", safetySmoke?.generated_at));
  else {
    const ageHours = (Date.parse(checkedAt) - Date.parse(generatedAt)) / 3_600_000;
    if (ageHours < 0) addUnique(blockers, issue("rollback_safety_smoke_from_future"));
    if (ageHours > 1) addUnique(blockers, issue("rollback_safety_smoke_stale", ageHours));
  }
}

export function verifySustainedRuntimeRollback({
  authorizationPlan,
  activationBaselineReport,
  restoredConfigManifest,
  runtimePreflight,
  runtimeParity,
  rollbackObservations = [],
  safetySmoke,
  checkedAt = new Date().toISOString(),
} = {}) {
  const checkedAtIso = canonicalIsoTimestamp(checkedAt);
  if (!checkedAtIso) throw new TypeError("checkedAt must be a canonical UTC ISO timestamp");
  const blockers = [];
  if (!isPlainObject(authorizationPlan)) addUnique(blockers, issue("authorization_plan_missing"));
  else {
    if (authorizationPlan.schema_version !== 1) addUnique(blockers, issue("authorization_plan_schema_invalid", authorizationPlan.schema_version));
    if (authorizationPlan.decision !== "authorized_plan_ready" || authorizationPlan.execution_authorized !== true) {
      addUnique(blockers, issue("authorization_plan_not_authorized", authorizationPlan.decision));
    }
  }
  const activeBaseline = verifyActivationBaseline({
    authorizationPlan,
    activationBaselineReport,
    checkedAt: checkedAtIso,
    blockers,
  });
  const restoredAt = verifyRestoredConfig({
    authorizationPlan,
    restoredConfigManifest,
    checkedAt: checkedAtIso,
    blockers,
  });
  if (restoredAt && activeBaseline?.activated_at
    && Date.parse(restoredAt) < Date.parse(activeBaseline.activated_at)) {
    addUnique(blockers, issue("rollback_restore_before_activation", restoredAt));
  }
  verifyRuntime({ authorizationPlan, activeBaseline, runtimePreflight, runtimeParity, checkedAt: checkedAtIso, blockers });
  const observationSummary = verifyRollbackObservations(rollbackObservations, blockers, {
    notBefore: restoredAt,
    checkedAt: checkedAtIso,
  });
  verifySafetySmoke(safetySmoke, blockers, checkedAtIso);
  return {
    schema_version: 1,
    checked_at: checkedAtIso,
    status: blockers.length === 0 ? "rollback_verified" : "blocked",
    rollback_verified: blockers.length === 0,
    evidence_epoch_reusable: false,
    closed_evidence_epoch_id: activeBaseline?.evidence_epoch_id ?? null,
    blockers,
    restored_config_sha256: restoredConfigManifest?.config_sha256 ?? null,
    runtime_build_identity: runtimePreflight?.runtime_build_identity ?? null,
    openclaw_runtime_version: runtimePreflight?.openclaw_runtime_version ?? null,
    rollback_observation_count: observationSummary.qualifyingCount,
    rollback_probe_counts: observationSummary.probeCounts,
    safety_smoke_status: safetySmoke?.summary?.status ?? null,
    safety_smoke_passed_count: safetySmoke?.summary?.passed_count ?? null,
    safety_smoke_check_count: safetySmoke?.summary?.check_count ?? null,
  };
}

export {
  TOOL_SURFACES,
  isPlainObject,
  verifyActivationBaseline,
  verifyRollbackObservations,
  verifySafetySmoke,
};
