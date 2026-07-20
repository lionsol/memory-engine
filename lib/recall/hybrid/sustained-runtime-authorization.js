import { canonicalIsoTimestamp } from "./hybrid-observation-provenance.js";
import {
  DEFAULT_PRODUCTION_EVIDENCE_CONTINUITY_THRESHOLDS,
  validateProductionEvidenceContinuityThresholds,
} from "./production-evidence-continuity.js";
import {
  isSha256Identity,
  fingerprintRolloutConfig,
} from "./production-evidence-identity.js";
import {
  validateProductionEvidenceMonitorThresholds,
  validateRuntimeParity,
} from "./production-evidence-health-monitor.js";

export const SUSTAINED_RUNTIME_AUTHORIZATION_SCHEMA_VERSION = 1;
export const EVIDENCE_EPOCH_PATTERN = /^b8-a7-sustained-\d{8}T\d{6}Z-[a-f0-9]{7}-r\d{2}$/;

export const MAXIMUM_RUNTIME_PREFLIGHT_AGE_HOURS = 1;

export const DEFAULT_SUSTAINED_MONITOR_THRESHOLDS = Object.freeze({
  maximum_latest_observation_age_hours: 72,
  maximum_healthcheck_age_hours: 14,
  maximum_runtime_parity_age_hours: 14,
  maximum_product_health_age_hours: 14,
});

export const REQUIRED_OPERATOR_APPROVALS = Object.freeze([
  "kg_full_fail_closed",
  "recent_full_fail_closed",
  "auto_recall_enabled",
  "agent_allowlist",
  "top_k",
  "timeout_ms",
  "evidence_epoch",
  "scheduled_healthcheck",
  "hourly_health_monitor",
  "report_scheduler",
  "automatic_rollback",
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function exactStringArray(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every(item => typeof item === "string" && item.trim() === item && item.length > 0)
    && new Set(value).size === value.length;
}

function issue(code, actual = undefined) {
  return actual === undefined ? { code } : { code, actual };
}

function timestampCompact(iso) {
  return iso.replace(/[-:]/g, "").replace(".000", "");
}

export function buildEvidenceEpochId({ authorizedAt, head, revision = 1 } = {}) {
  const canonical = canonicalIsoTimestamp(authorizedAt);
  if (!canonical) throw new TypeError("authorizedAt must be a canonical UTC ISO timestamp");
  const normalizedHead = typeof head === "string" ? head.trim().toLowerCase() : "";
  if (!/^[a-f0-9]{7,40}$/.test(normalizedHead)) throw new TypeError("head must be a 7-40 character lowercase hexadecimal commit id");
  if (!Number.isInteger(revision) || revision < 1 || revision > 99) throw new TypeError("revision must be an integer from 1 to 99");
  return `b8-a7-sustained-${timestampCompact(canonical)}-${normalizedHead.slice(0, 7)}-r${String(revision).padStart(2, "0")}`;
}

export function validateSustainedRuntimeConfig(config) {
  const errors = [];
  if (!isPlainObject(config)) return { valid: false, errors: [issue("invalid_config")] };
  if (config.kgFailClosedMode !== "full_fail_closed") errors.push(issue("kg_mode_not_full_fail_closed", config.kgFailClosedMode));
  if (config.recentFailClosedMode !== "full_fail_closed") errors.push(issue("recent_mode_not_full_fail_closed", config.recentFailClosedMode));
  for (const [name, canary] of [["kg", config.kgFailClosedCanary], ["recent", config.recentFailClosedCanary]]) {
    if (!isPlainObject(canary) || canary.enabled !== false) errors.push(issue(`${name}_canary_not_disabled`));
  }
  const window = config.productionEvidenceWindow;
  if (!isPlainObject(window) || window.enabled !== true) errors.push(issue("production_evidence_window_not_enabled"));
  if (!EVIDENCE_EPOCH_PATTERN.test(String(window?.epochId || ""))) errors.push(issue("invalid_evidence_epoch_id", window?.epochId));
  const autoRecall = config.autoRecall;
  if (!isPlainObject(autoRecall) || autoRecall.enabled !== true) errors.push(issue("auto_recall_not_enabled"));
  if (!exactStringArray(autoRecall?.agentAllowlist)) errors.push(issue("invalid_auto_recall_agent_allowlist"));
  if (!Array.isArray(autoRecall?.triggerAllowlist) || autoRecall.triggerAllowlist.length !== 1 || autoRecall.triggerAllowlist[0] !== "user") {
    errors.push(issue("invalid_auto_recall_trigger_allowlist"));
  }
  if (!Number.isInteger(autoRecall?.topK) || autoRecall.topK < 1) errors.push(issue("invalid_auto_recall_top_k", autoRecall?.topK));
  if (!Number.isInteger(autoRecall?.timeoutMs) || autoRecall.timeoutMs < 1000) errors.push(issue("invalid_auto_recall_timeout_ms", autoRecall?.timeoutMs));
  if (autoRecall?.cardFirstRuntime?.enabled !== false) errors.push(issue("card_first_runtime_not_disabled"));
  return { valid: errors.length === 0, errors };
}

function approvalBlockers(operatorApprovals) {
  const approvals = isPlainObject(operatorApprovals) ? operatorApprovals : {};
  return REQUIRED_OPERATOR_APPROVALS
    .filter(key => approvals[key] !== true)
    .map(key => issue(`operator_approval_required:${key}`));
}

function buildProposedConfig({ currentEffectiveConfig, epochId, agentAllowlist, topK, timeoutMs }) {
  const config = clone(currentEffectiveConfig || {});
  config.kgFailClosedMode = "full_fail_closed";
  config.kgFailClosedCanary = { enabled: false, agentIds: [], sessionIds: [], tokens: [] };
  config.recentFailClosedMode = "full_fail_closed";
  config.recentFailClosedCanary = { enabled: false, agentIds: [], sessionIds: [], tokens: [] };
  config.productionEvidenceWindow = { enabled: true, epochId };
  config.autoRecall = {
    ...(isPlainObject(config.autoRecall) ? config.autoRecall : {}),
    enabled: true,
    topK,
    timeoutMs,
    agentAllowlist: [...agentAllowlist],
    triggerAllowlist: ["user"],
    chatTypeAllowlist: ["interactive_user_chat"],
    messageRoleAllowlist: ["user"],
    cardFirstRuntime: { enabled: false },
  };
  return config;
}

function buildProposedPluginConfigPatch({ epochId, agentAllowlist, topK, timeoutMs }) {
  return {
    kgFailClosedMode: "full_fail_closed",
    kgFailClosedCanary: { enabled: false, agentIds: [], sessionIds: [] },
    recentFailClosedMode: "full_fail_closed",
    recentFailClosedCanary: { enabled: false, agentIds: [], sessionIds: [] },
    productionEvidenceWindow: { enabled: true, epochId },
    autoRecall: {
      enabled: true,
      topK,
      timeoutMs,
      agentAllowlist: [...agentAllowlist],
      triggerAllowlist: ["user"],
      chatTypeAllowlist: ["interactive_user_chat"],
      messageRoleAllowlist: ["user"],
      cardFirstRuntime: { enabled: false },
    },
  };
}

function validateAuthorizationThresholds(continuityInput, monitorInput) {
  const blockers = [];
  const continuity = {
    ...DEFAULT_PRODUCTION_EVIDENCE_CONTINUITY_THRESHOLDS,
    ...(isPlainObject(continuityInput) ? continuityInput : {}),
  };
  const continuityValidation = validateProductionEvidenceContinuityThresholds(continuityInput);
  if (!continuityValidation.valid) blockers.push(...continuityValidation.errors.map(error => issue(error.code, error.actual)));
  for (const key of [
    "minimum_window_days",
    "minimum_active_utc_days",
    "minimum_active_day_ratio",
    "minimum_observations",
    "minimum_surface_observations",
    "minimum_surface_active_days",
  ]) {
    if (continuity[key] < DEFAULT_PRODUCTION_EVIDENCE_CONTINUITY_THRESHOLDS[key]) {
      blockers.push(issue(`continuity_threshold_weakened:${key}`, continuity[key]));
    }
  }
  if (continuity.maximum_observation_gap_hours > DEFAULT_PRODUCTION_EVIDENCE_CONTINUITY_THRESHOLDS.maximum_observation_gap_hours) {
    blockers.push(issue("continuity_threshold_weakened:maximum_observation_gap_hours", continuity.maximum_observation_gap_hours));
  }

  const monitor = {
    ...DEFAULT_SUSTAINED_MONITOR_THRESHOLDS,
    ...(isPlainObject(monitorInput) ? monitorInput : {}),
  };
  const monitorValidation = validateProductionEvidenceMonitorThresholds(monitorInput);
  if (!monitorValidation.valid) blockers.push(...monitorValidation.errors);
  for (const key of Object.keys(DEFAULT_SUSTAINED_MONITOR_THRESHOLDS)) {
    if (monitor[key] > DEFAULT_SUSTAINED_MONITOR_THRESHOLDS[key]) {
      blockers.push(issue(`monitor_threshold_weakened:${key}`, monitor[key]));
    }
  }
  return { continuity, monitor, blockers };
}

function finiteMetric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function validateRuntimeBoundaryForAuthorization(runtimeBoundary, authorizedAt) {
  const blockers = [];
  if (!isPlainObject(runtimeBoundary)) return [issue("runtime_boundary_report_missing")];
  if (runtimeBoundary.schema_version !== 1) blockers.push(issue("runtime_boundary_schema_invalid", runtimeBoundary.schema_version));
  if (runtimeBoundary.status !== "clean") blockers.push(issue("runtime_boundary_not_clean", runtimeBoundary.status));
  if (runtimeBoundary.active_memory_enabled !== false) blockers.push(issue("active_memory_conflict", runtimeBoundary.active_memory_enabled));
  if (!Array.isArray(runtimeBoundary.blockers) || runtimeBoundary.blockers.length > 0) blockers.push(issue("runtime_boundary_blockers_present", runtimeBoundary.blockers));
  const checkedAt = canonicalIsoTimestamp(runtimeBoundary.checked_at);
  if (!checkedAt) blockers.push(issue("runtime_boundary_checked_at_invalid", runtimeBoundary.checked_at));
  else {
    const ageHours = (Date.parse(authorizedAt) - Date.parse(checkedAt)) / 3_600_000;
    if (ageHours < 0) blockers.push(issue("runtime_boundary_after_authorization"));
    if (ageHours > DEFAULT_SUSTAINED_MONITOR_THRESHOLDS.maximum_runtime_parity_age_hours) blockers.push(issue("runtime_boundary_stale", ageHours));
  }
  return blockers;
}

function validateTrafficForecastForAuthorization(trafficForecast, authorizedAt) {
  const blockers = [];
  if (!isPlainObject(trafficForecast)) return [issue("natural_traffic_forecast_missing")];
  if (trafficForecast.schema_version !== 1) blockers.push(issue("natural_traffic_forecast_schema_invalid", trafficForecast.schema_version));
  if (trafficForecast.ready !== true || trafficForecast.status !== "ready") blockers.push(issue("natural_traffic_forecast_not_ready", trafficForecast.blockers));
  if (!Array.isArray(trafficForecast.blockers) || trafficForecast.blockers.length > 0) blockers.push(issue("natural_traffic_forecast_blockers_present", trafficForecast.blockers));
  for (const key of ["invalid_provenance_count", "invalid_origin_evidence_count", "unknown_origin_count"]) {
    if (trafficForecast[key] !== 0) blockers.push(issue(`natural_traffic_forecast_${key}`, trafficForecast[key]));
  }
  const forecastAsOf = canonicalIsoTimestamp(trafficForecast.as_of);
  if (!forecastAsOf) blockers.push(issue("natural_traffic_forecast_as_of_invalid", trafficForecast.as_of));
  else {
    const ageHours = (Date.parse(authorizedAt) - Date.parse(forecastAsOf)) / 3_600_000;
    if (ageHours < 0) blockers.push(issue("natural_traffic_forecast_after_authorization"));
    if (ageHours > 24) blockers.push(issue("natural_traffic_forecast_stale", ageHours));
  }
  const historyDays = finiteMetric(trafficForecast.history_days);
  if (historyDays === null) blockers.push(issue("natural_traffic_forecast_history_days_missing"));
  else if (historyDays < 30) blockers.push(issue("natural_traffic_forecast_history_days_below_authorization_floor", historyDays));
  const projectedTotal = finiteMetric(trafficForecast.projected_natural_observation_count);
  if (projectedTotal === null) blockers.push(issue("projected_total_natural_observations_missing"));
  else if (projectedTotal < 600) blockers.push(issue("projected_total_natural_observations_below_authorization_floor", projectedTotal));

  const projected = trafficForecast.projected_observed_by_surface;
  const activeDays = trafficForecast.active_days_by_surface;
  const gaps = trafficForecast.maximum_gap_hours_by_surface;
  const naturalObserved = trafficForecast.natural_observed_by_surface;
  if (!isPlainObject(projected) || !isPlainObject(activeDays) || !isPlainObject(gaps) || !isPlainObject(naturalObserved)) {
    blockers.push(issue("natural_traffic_forecast_metrics_missing"));
  } else {
    for (const surface of ["memory_engine_search", "memory_engine_action_search"]) {
      const projectedCount = finiteMetric(projected[surface]);
      const activeDayCount = finiteMetric(activeDays[surface]);
      const maximumGap = finiteMetric(gaps[surface]);
      const naturalCount = finiteMetric(naturalObserved[surface]);
      if (naturalCount === null || naturalCount <= 0) blockers.push(issue(`natural_surface_observation_missing:${surface}`, naturalObserved[surface]));
      if (projectedCount === null) blockers.push(issue(`projected_surface_observations_missing:${surface}`));
      else if (projectedCount < 120) blockers.push(issue(`projected_surface_observations_below_authorization_floor:${surface}`, projectedCount));
      if (activeDayCount === null) blockers.push(issue(`surface_active_days_missing:${surface}`));
      else if (activeDayCount < 15) blockers.push(issue(`surface_active_days_below_authorization_floor:${surface}`, activeDayCount));
      if (maximumGap === null) blockers.push(issue(`surface_gap_missing:${surface}`));
      else if (maximumGap > 72) blockers.push(issue(`surface_gap_above_authorization_ceiling:${surface}`, maximumGap));
    }
  }
  return blockers;
}

function validateCurrentEffectiveConfigReport(report, authorizedAt) {
  const blockers = [];
  if (!isPlainObject(report)) return { config: null, blockers: [issue("current_effective_config_report_missing")] };
  if (report.schema_version !== 1) blockers.push(issue("current_effective_config_report_schema_invalid", report.schema_version));
  if (report.valid !== true) blockers.push(issue("current_effective_config_invalid", report.errors));
  if (!Array.isArray(report.errors) || report.errors.length > 0) blockers.push(issue("current_effective_config_errors_present", report.errors));
  if (!isPlainObject(report.effective_config)) blockers.push(issue("current_effective_config_missing"));
  if (!isSha256Identity(report.rollout_config_fingerprint)) blockers.push(issue("current_effective_config_fingerprint_invalid", report.rollout_config_fingerprint));
  const checkedAt = canonicalIsoTimestamp(report.checked_at);
  if (!checkedAt) blockers.push(issue("current_effective_config_checked_at_invalid", report.checked_at));
  else {
    const ageHours = (Date.parse(authorizedAt) - Date.parse(checkedAt)) / 3_600_000;
    if (ageHours < 0) blockers.push(issue("current_effective_config_after_authorization"));
    if (ageHours > DEFAULT_SUSTAINED_MONITOR_THRESHOLDS.maximum_runtime_parity_age_hours) blockers.push(issue("current_effective_config_stale", ageHours));
  }
  return { config: isPlainObject(report.effective_config) ? report.effective_config : null, blockers };
}

function validateRuntimePreflightForAuthorization(report, authorizedAt) {
  const blockers = [];
  if (!isPlainObject(report)) {
    return {
      config: null,
      openclawRuntimeVersion: null,
      openclawConfigFilePath: null,
      openclawConfigFileSha256: null,
      openclawConfigFileByteCount: null,
      openclawConfigFingerprint: null,
      runtimeBuildIdentity: null,
      rolloutConfigFingerprint: null,
      blockers: [issue("runtime_preflight_report_missing")],
    };
  }
  if (report.schema_version !== 1) blockers.push(issue("runtime_preflight_schema_invalid", report.schema_version));
  if (report.status !== "clean") blockers.push(issue("runtime_preflight_not_clean", report.status));
  if (!Array.isArray(report.blockers) || report.blockers.length > 0) blockers.push(issue("runtime_preflight_blockers_present", report.blockers));
  const checkedAt = canonicalIsoTimestamp(report.checked_at);
  if (!checkedAt) blockers.push(issue("runtime_preflight_checked_at_invalid", report.checked_at));
  else {
    const ageHours = (Date.parse(authorizedAt) - Date.parse(checkedAt)) / 3_600_000;
    if (ageHours < 0) blockers.push(issue("runtime_preflight_after_authorization"));
    if (ageHours > MAXIMUM_RUNTIME_PREFLIGHT_AGE_HOURS) blockers.push(issue("runtime_preflight_stale", ageHours));
  }
  const runtimeVersion = typeof report.openclaw_runtime_version === "string" && report.openclaw_runtime_version.trim()
    ? report.openclaw_runtime_version.trim()
    : null;
  if (!runtimeVersion) blockers.push(issue("openclaw_runtime_version_missing"));
  const configFilePath = typeof report.openclaw_config_file_path === "string" && report.openclaw_config_file_path.trim()
    ? report.openclaw_config_file_path.trim()
    : null;
  if (!configFilePath) blockers.push(issue("openclaw_config_file_path_missing"));
  if (!isSha256Identity(report.openclaw_config_file_sha256)) blockers.push(issue("openclaw_config_file_sha256_invalid", report.openclaw_config_file_sha256));
  if (!Number.isInteger(report.openclaw_config_file_byte_count) || report.openclaw_config_file_byte_count <= 0) {
    blockers.push(issue("openclaw_config_file_byte_count_invalid", report.openclaw_config_file_byte_count));
  }
  if (!isSha256Identity(report.openclaw_config_fingerprint)) blockers.push(issue("openclaw_config_fingerprint_invalid", report.openclaw_config_fingerprint));
  if (!isSha256Identity(report.runtime_build_identity)) blockers.push(issue("runtime_preflight_build_identity_invalid", report.runtime_build_identity));
  if (!isSha256Identity(report.rollout_config_fingerprint)) blockers.push(issue("runtime_preflight_config_fingerprint_invalid", report.rollout_config_fingerprint));

  const configReview = validateCurrentEffectiveConfigReport(report.effective_config_report, authorizedAt);
  blockers.push(...configReview.blockers);
  if (report.effective_config_report?.checked_at !== report.checked_at) {
    blockers.push(issue("runtime_preflight_config_timestamp_mismatch"));
  }
  if (report.effective_config_report?.rollout_config_fingerprint !== report.rollout_config_fingerprint) {
    blockers.push(issue("runtime_preflight_config_fingerprint_mismatch"));
  }
  const boundaryBlockers = validateRuntimeBoundaryForAuthorization(report.runtime_boundary, authorizedAt);
  blockers.push(...boundaryBlockers);
  if (report.runtime_boundary?.checked_at !== report.checked_at) {
    blockers.push(issue("runtime_preflight_boundary_timestamp_mismatch"));
  }
  return {
    config: configReview.config,
    openclawRuntimeVersion: runtimeVersion,
    openclawConfigFilePath: configFilePath,
    openclawConfigFileSha256: isSha256Identity(report.openclaw_config_file_sha256) ? report.openclaw_config_file_sha256 : null,
    openclawConfigFileByteCount: Number.isInteger(report.openclaw_config_file_byte_count) ? report.openclaw_config_file_byte_count : null,
    openclawConfigFingerprint: isSha256Identity(report.openclaw_config_fingerprint) ? report.openclaw_config_fingerprint : null,
    runtimeBuildIdentity: isSha256Identity(report.runtime_build_identity) ? report.runtime_build_identity : null,
    rolloutConfigFingerprint: isSha256Identity(report.rollout_config_fingerprint) ? report.rollout_config_fingerprint : null,
    blockers,
  };
}

function validateConfigBackupManifestForAuthorization(manifest, runtimePreflight, authorizedAt) {
  const blockers = [];
  if (!isPlainObject(manifest)) return [issue("config_backup_manifest_missing")];
  if (manifest.schema_version !== 1) blockers.push(issue("config_backup_manifest_schema_invalid", manifest.schema_version));
  if (manifest.valid !== true || manifest.status !== "ready") blockers.push(issue("config_backup_manifest_not_ready", manifest.status));
  if (!Array.isArray(manifest.blockers) || manifest.blockers.length > 0) blockers.push(issue("config_backup_manifest_blockers_present", manifest.blockers));
  if (typeof manifest.backup_path !== "string" || !manifest.backup_path.trim()) blockers.push(issue("config_backup_path_missing"));
  if (typeof manifest.live_config_path !== "string" || !manifest.live_config_path.trim()) blockers.push(issue("live_config_path_missing"));
  if (manifest.backup_path === manifest.live_config_path) blockers.push(issue("config_backup_not_independent_copy"));
  if (!isSha256Identity(manifest.config_sha256)) blockers.push(issue("config_backup_sha256_invalid", manifest.config_sha256));
  if (!isSha256Identity(manifest.live_config_sha256)) blockers.push(issue("live_config_sha256_invalid", manifest.live_config_sha256));
  if (manifest.config_sha256 !== manifest.live_config_sha256) blockers.push(issue("config_backup_live_sha256_mismatch"));
  if (!Number.isInteger(manifest.byte_count) || manifest.byte_count <= 0) blockers.push(issue("config_backup_byte_count_invalid", manifest.byte_count));
  if (!Number.isInteger(manifest.live_byte_count) || manifest.live_byte_count <= 0) blockers.push(issue("live_config_byte_count_invalid", manifest.live_byte_count));
  if (manifest.byte_count !== manifest.live_byte_count) blockers.push(issue("config_backup_live_byte_count_mismatch"));
  if (manifest.backup_matches_live_config !== true) blockers.push(issue("config_backup_live_bytes_not_verified"));
  if (!isSha256Identity(manifest.openclaw_config_fingerprint)) blockers.push(issue("config_backup_openclaw_fingerprint_invalid", manifest.openclaw_config_fingerprint));
  if (manifest.live_config_path !== runtimePreflight?.openclaw_config_file_path) blockers.push(issue("config_backup_preflight_live_path_mismatch"));
  if (manifest.live_config_sha256 !== runtimePreflight?.openclaw_config_file_sha256) blockers.push(issue("config_backup_preflight_live_sha256_mismatch"));
  if (manifest.live_byte_count !== runtimePreflight?.openclaw_config_file_byte_count) blockers.push(issue("config_backup_preflight_live_byte_count_mismatch"));
  if (!isSha256Identity(manifest.effective_config_fingerprint)) blockers.push(issue("config_backup_effective_fingerprint_invalid", manifest.effective_config_fingerprint));
  if (manifest.effective_config_fingerprint !== runtimePreflight?.rollout_config_fingerprint) blockers.push(issue("config_backup_preflight_fingerprint_mismatch"));
  if (manifest.active_memory_enabled !== false) blockers.push(issue("config_backup_active_memory_conflict", manifest.active_memory_enabled));
  if (manifest.kg_mode !== "legacy_fallback") blockers.push(issue("config_backup_kg_mode_not_legacy", manifest.kg_mode));
  if (manifest.recent_mode !== "legacy_fallback") blockers.push(issue("config_backup_recent_mode_not_legacy", manifest.recent_mode));
  if (manifest.auto_recall_enabled !== false) blockers.push(issue("config_backup_auto_recall_not_disabled", manifest.auto_recall_enabled));
  if (manifest.production_evidence_enabled !== false) blockers.push(issue("config_backup_evidence_window_not_disabled", manifest.production_evidence_enabled));
  const createdAt = canonicalIsoTimestamp(manifest.created_at);
  if (!createdAt) blockers.push(issue("config_backup_created_at_invalid", manifest.created_at));
  else {
    const ageHours = (Date.parse(authorizedAt) - Date.parse(createdAt)) / 3_600_000;
    if (ageHours < 0) blockers.push(issue("config_backup_created_after_authorization"));
    if (ageHours > 1) blockers.push(issue("config_backup_stale", ageHours));
  }
  return blockers;
}

function buildRollbackPlan(configBackupManifest) {
  return {
    schema_version: 1,
    mode: "dry_run_only",
    exact_config_backup: isPlainObject(configBackupManifest)
      ? {
        schema_version: configBackupManifest.schema_version,
        created_at: configBackupManifest.created_at,
        backup_path: configBackupManifest.backup_path,
        live_config_path: configBackupManifest.live_config_path,
        config_sha256: configBackupManifest.config_sha256,
        live_config_sha256: configBackupManifest.live_config_sha256,
        byte_count: configBackupManifest.byte_count,
        live_byte_count: configBackupManifest.live_byte_count,
        backup_matches_live_config: configBackupManifest.backup_matches_live_config,
        openclaw_config_fingerprint: configBackupManifest.openclaw_config_fingerprint,
        effective_config_fingerprint: configBackupManifest.effective_config_fingerprint,
      }
      : null,
    required_steps: [
      "freeze_final_raw_evidence_export",
      "restore_exact_pre_activation_config_backup",
      "reload_runtime_through_verified_openclaw_path",
      "close_active_baseline_and_never_reuse_epoch",
      "verify_kg_and_recent_legacy_modes",
      "verify_production_evidence_disabled",
      "verify_auto_recall_restored",
      "verify_source_runtime_parity",
      "run_operator_tool_surface_probes_outside_denominator",
      "run_a5_safety_smoke",
    ],
    monitor_exit_codes_requiring_rollback: [2, 64],
  };
}

export function buildSustainedRuntimeAuthorizationPlan({
  runtimePreflight,
  runtimeParity,
  trafficForecast,
  configBackupManifest,
  authorizedAt,
  head,
  revision = 1,
  agentAllowlist = ["edi"],
  topK = 3,
  timeoutMs = 4000,
  operatorApprovals = {},
  continuityThresholds = DEFAULT_PRODUCTION_EVIDENCE_CONTINUITY_THRESHOLDS,
  monitorThresholds = DEFAULT_SUSTAINED_MONITOR_THRESHOLDS,
} = {}) {
  const blockers = [];
  const canonicalAuthorizedAt = canonicalIsoTimestamp(authorizedAt);
  if (!canonicalAuthorizedAt) throw new TypeError("authorizedAt must be a canonical UTC ISO timestamp");
  const preflightReview = validateRuntimePreflightForAuthorization(runtimePreflight, canonicalAuthorizedAt);
  blockers.push(...preflightReview.blockers);
  const currentEffectiveConfig = preflightReview.config;
  blockers.push(...validateConfigBackupManifestForAuthorization(
    configBackupManifest,
    runtimePreflight,
    canonicalAuthorizedAt,
  ));
  if (currentEffectiveConfig?.productionEvidenceWindow?.enabled === true) blockers.push(issue("production_evidence_window_already_active"));
  if (currentEffectiveConfig?.kgFailClosedMode !== "legacy_fallback") blockers.push(issue("current_kg_mode_not_legacy", currentEffectiveConfig?.kgFailClosedMode));
  if (currentEffectiveConfig?.recentFailClosedMode !== "legacy_fallback") blockers.push(issue("current_recent_mode_not_legacy", currentEffectiveConfig?.recentFailClosedMode));
  if (currentEffectiveConfig?.autoRecall?.enabled === true) blockers.push(issue("current_auto_recall_already_enabled"));
  if (!exactStringArray(agentAllowlist)) blockers.push(issue("invalid_requested_agent_allowlist"));
  if (!Number.isInteger(topK) || topK < 1) blockers.push(issue("invalid_requested_top_k", topK));
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) blockers.push(issue("invalid_requested_timeout_ms", timeoutMs));

  const parityValidation = validateRuntimeParity(runtimeParity);
  if (!parityValidation.valid) blockers.push(...parityValidation.errors);
  if (parityValidation.valid) {
    if (runtimeParity.source_runtime_equal !== true || runtimeParity.difference_count !== 0) blockers.push(issue("runtime_source_parity_drift"));
    if (!isSha256Identity(runtimeParity.runtime_build_identity)) blockers.push(issue("runtime_build_identity_invalid"));
    if (preflightReview.runtimeBuildIdentity && runtimeParity.runtime_build_identity !== preflightReview.runtimeBuildIdentity) {
      blockers.push(issue("runtime_preflight_parity_identity_mismatch"));
    }
    const checkedAtMs = Date.parse(runtimeParity.checked_at);
    const authorizedAtMs = Date.parse(canonicalAuthorizedAt);
    const ageHours = (authorizedAtMs - checkedAtMs) / 3_600_000;
    if (ageHours < 0) blockers.push(issue("runtime_parity_after_authorization"));
    if (ageHours > DEFAULT_SUSTAINED_MONITOR_THRESHOLDS.maximum_runtime_parity_age_hours) blockers.push(issue("runtime_parity_stale", ageHours));
  }
  blockers.push(...validateTrafficForecastForAuthorization(trafficForecast, canonicalAuthorizedAt));
  const thresholdReview = validateAuthorizationThresholds(continuityThresholds, monitorThresholds);
  blockers.push(...thresholdReview.blockers);

  const epochId = buildEvidenceEpochId({ authorizedAt: canonicalAuthorizedAt, head, revision });
  const proposedConfig = buildProposedConfig({
    currentEffectiveConfig,
    epochId,
    agentAllowlist,
    topK,
    timeoutMs,
  });
  const proposedPluginConfigPatch = buildProposedPluginConfigPatch({
    epochId,
    agentAllowlist,
    topK,
    timeoutMs,
  });
  const configValidation = validateSustainedRuntimeConfig(proposedConfig);
  blockers.push(...configValidation.errors);
  const fingerprint = fingerprintRolloutConfig(proposedConfig);
  if (!fingerprint.valid || !isSha256Identity(fingerprint.fingerprint)) blockers.push(issue("proposed_rollout_config_fingerprint_invalid", fingerprint.errors));

  const approvalFindings = approvalBlockers(operatorApprovals);
  const technicalBlockers = [...new Map(blockers.map(item => [JSON.stringify(item), item])).values()];
  const approvalsComplete = approvalFindings.length === 0;
  const technicalReady = technicalBlockers.length === 0;
  const decision = !technicalReady
    ? "blocked"
    : approvalsComplete
      ? "authorized_plan_ready"
      : "ready_for_operator_approval";
  const runtimeIdentity = parityValidation.valid ? runtimeParity.runtime_build_identity : null;
  const baselineTemplate = {
    schema_version: 1,
    active: false,
    evidence_epoch_id: epochId,
    runtime_build_identity: runtimeIdentity,
    rollout_config_fingerprint: fingerprint.fingerprint,
    expected_kg_mode: "full_fail_closed",
    expected_recent_mode: "full_fail_closed",
    openclaw_runtime_version: preflightReview.openclawRuntimeVersion,
    authorized_at: canonicalAuthorizedAt,
    activation_baseline_finalization_required: true,
  };

  return {
    schema_version: SUSTAINED_RUNTIME_AUTHORIZATION_SCHEMA_VERSION,
    decision,
    execution_authorized: decision === "authorized_plan_ready",
    generated_at: new Date().toISOString(),
    technical_ready: technicalReady,
    operator_approvals_complete: approvalsComplete,
    technical_blockers: technicalBlockers,
    approval_blockers: approvalFindings,
    config_backup_manifest: isPlainObject(configBackupManifest)
      ? {
        schema_version: configBackupManifest.schema_version,
        created_at: configBackupManifest.created_at,
        status: configBackupManifest.status,
        backup_path: configBackupManifest.backup_path,
        live_config_path: configBackupManifest.live_config_path,
        config_sha256: configBackupManifest.config_sha256,
        live_config_sha256: configBackupManifest.live_config_sha256,
        byte_count: configBackupManifest.byte_count,
        live_byte_count: configBackupManifest.live_byte_count,
        backup_matches_live_config: configBackupManifest.backup_matches_live_config,
        openclaw_config_fingerprint: configBackupManifest.openclaw_config_fingerprint,
        effective_config_fingerprint: configBackupManifest.effective_config_fingerprint,
      }
      : null,
    runtime_preflight: isPlainObject(runtimePreflight)
      ? {
        schema_version: runtimePreflight.schema_version,
        checked_at: runtimePreflight.checked_at,
        status: runtimePreflight.status,
        openclaw_runtime_version: runtimePreflight.openclaw_runtime_version,
        openclaw_config_file_path: runtimePreflight.openclaw_config_file_path,
        openclaw_config_file_sha256: runtimePreflight.openclaw_config_file_sha256,
        openclaw_config_file_byte_count: runtimePreflight.openclaw_config_file_byte_count,
        openclaw_config_fingerprint: runtimePreflight.openclaw_config_fingerprint,
        runtime_build_identity: runtimePreflight.runtime_build_identity,
        rollout_config_fingerprint: runtimePreflight.rollout_config_fingerprint,
      }
      : null,
    evidence_epoch_id: epochId,
    baseline_template: baselineTemplate,
    activation_baseline: null,
    proposed_effective_config: proposedConfig,
    config_application_plan: {
      mode: "merge_patch",
      target_path: "plugins.entries.memory-engine.config",
      patch: proposedPluginConfigPatch,
      expected_effective_rollout_config_fingerprint: fingerprint.fingerprint,
      post_apply_verification: "memoryEngine.sustainedRuntimePreflight",
    },
    proposed_rollout_config_fingerprint_report: fingerprint,
    rollback_plan: buildRollbackPlan(configBackupManifest),
    thresholds: {
      continuity: clone(thresholdReview.continuity),
      monitor: clone(thresholdReview.monitor),
    },
    cadence: {
      timezone: "Asia/Singapore",
      scheduled_healthcheck_hours: 6,
      runtime_parity_hours: 6,
      product_health_hours: 6,
      observation_export_hours: 1,
      health_monitor_hours: 1,
      manual_quality_review_hours: 72,
    },
    required_operator_approvals: REQUIRED_OPERATOR_APPROVALS,
  };
}

export {
  approvalBlockers,
  buildProposedConfig,
  buildProposedPluginConfigPatch,
  buildRollbackPlan,
  clone,
  exactStringArray,
  finiteMetric,
  validateAuthorizationThresholds,
  validateConfigBackupManifestForAuthorization,
  validateCurrentEffectiveConfigReport,
  validateRuntimeBoundaryForAuthorization,
  validateRuntimePreflightForAuthorization,
  validateTrafficForecastForAuthorization,
};
