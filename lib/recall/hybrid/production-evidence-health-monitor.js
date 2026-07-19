import {
  evaluateHybridFallbackEvidenceWindow,
  DEFAULT_EVIDENCE_WINDOW_THRESHOLDS,
} from "./fallback-evidence-window.js";
import {
  buildFullFailClosedRolloutEvidence,
  DEFAULT_FULL_FAIL_CLOSED_ROLLOUT_THRESHOLDS,
} from "./full-fail-closed-rollout-evidence.js";
import {
  evaluateProductionEvidenceContinuity,
  validateProductionEvidenceContinuityThresholds,
} from "./production-evidence-continuity.js";
import {
  evaluateProductionEvidenceIdentity,
  isSha256Identity,
} from "./production-evidence-identity.js";
import {
  PRODUCTION_HYBRID_OBSERVATION_SURFACES,
  canonicalIsoTimestamp,
  parseHybridObservationMetadata,
  validateProductionHybridObservationProvenance,
} from "./hybrid-observation-provenance.js";
import { validateHybridTrafficOriginEvidence } from "./traffic-origin.js";

export const DEFAULT_PRODUCTION_EVIDENCE_MONITOR_THRESHOLDS = Object.freeze({
  maximum_latest_observation_age_hours: 26,
  maximum_healthcheck_age_hours: 26,
  maximum_runtime_parity_age_hours: 26,
  maximum_product_health_age_hours: 26,
});

const MONITOR_THRESHOLD_KEYS = new Set(Object.keys(DEFAULT_PRODUCTION_EVIDENCE_MONITOR_THRESHOLDS));
const COLLECTING_ONLY_CONTINUITY_BLOCKERS = new Set([
  "no_qualifying_natural_observations",
]);
const COLLECTING_ONLY_PREFIXES = [
  "missing_natural_surface:",
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlainObject(value) {
  return isObject(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function issue(code, actual, threshold) {
  const result = { code };
  if (actual !== undefined) result.actual = actual;
  if (threshold !== undefined) result.threshold = threshold;
  return result;
}

function addUnique(list, value) {
  if (!list.some(item => JSON.stringify(item) === JSON.stringify(value))) list.push(value);
}

function canonicalIso(value) {
  return canonicalIsoTimestamp(value);
}

function normalizeMonitorThresholds(input) {
  if (input === undefined) return { valid: true, thresholds: { ...DEFAULT_PRODUCTION_EVIDENCE_MONITOR_THRESHOLDS }, errors: [] };
  if (!isPlainObject(input)) return { valid: false, thresholds: { ...DEFAULT_PRODUCTION_EVIDENCE_MONITOR_THRESHOLDS }, errors: [issue("invalid_monitor_thresholds", input)] };
  const errors = [];
  for (const [key, value] of Object.entries(input)) {
    if (!MONITOR_THRESHOLD_KEYS.has(key)) {
      errors.push(issue("unknown_monitor_threshold", key));
    } else if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      errors.push(issue("invalid_monitor_threshold", key));
    }
  }
  return {
    valid: errors.length === 0,
    thresholds: { ...DEFAULT_PRODUCTION_EVIDENCE_MONITOR_THRESHOLDS, ...input },
    errors,
  };
}

export function validateProductionEvidenceMonitorThresholds(input) {
  return normalizeMonitorThresholds(input);
}

function validateBaseline(value) {
  const errors = [];
  if (!isPlainObject(value)) return { valid: false, errors: [issue("invalid_baseline")] };
  if (value.schema_version !== 1) errors.push(issue("invalid_baseline_schema", value.schema_version, 1));
  if (value.active !== true && value.active !== false) errors.push(issue("invalid_baseline_active", value.active));
  if (typeof value.evidence_epoch_id !== "string" || !value.evidence_epoch_id.trim()) {
    errors.push(issue("invalid_baseline_epoch"));
  }
  for (const key of ["runtime_build_identity", "rollout_config_fingerprint"]) {
    if (!isSha256Identity(value[key])) errors.push(issue(`invalid_baseline_${key}`));
  }
  if (value.expected_kg_mode !== "full_fail_closed") errors.push(issue("invalid_baseline_expected_kg_mode", value.expected_kg_mode));
  if (value.expected_recent_mode !== "full_fail_closed") errors.push(issue("invalid_baseline_expected_recent_mode", value.expected_recent_mode));
  if (!canonicalIso(value.authorized_at)) errors.push(issue("invalid_baseline_authorized_at", value.authorized_at));
  return { valid: errors.length === 0, errors };
}

function validateRuntimeParity(value) {
  const errors = [];
  if (!isPlainObject(value)) return { valid: false, errors: [issue("invalid_runtime_parity_report")] };
  if (value.schema_version !== 1) errors.push(issue("invalid_runtime_parity_schema", value.schema_version, 1));
  if (!canonicalIso(value.checked_at)) errors.push(issue("invalid_runtime_parity_checked_at", value.checked_at));
  if (typeof value.source_runtime_equal !== "boolean") errors.push(issue("invalid_source_runtime_equal", value.source_runtime_equal));
  if (!Number.isInteger(value.difference_count) || value.difference_count < 0) errors.push(issue("invalid_runtime_difference_count", value.difference_count));
  if (!isSha256Identity(value.runtime_build_identity)) errors.push(issue("invalid_runtime_parity_identity"));
  return { valid: errors.length === 0, errors };
}

function validateProductHealth(value) {
  const errors = [];
  if (!isPlainObject(value)) return { valid: false, errors: [issue("invalid_product_health_report")] };
  if (value.schema_version !== 1) errors.push(issue("invalid_product_health_schema", value.schema_version, 1));
  if (!canonicalIso(value.checked_at)) errors.push(issue("invalid_product_health_checked_at", value.checked_at));
  if (!["healthy", "rollback_required", "not_evaluated"].includes(value.status)) {
    errors.push(issue("invalid_product_health_status", value.status));
  }
  if (!Array.isArray(value.blockers) || value.blockers.some(blocker => typeof blocker !== "string" && !isPlainObject(blocker))) {
    errors.push(issue("invalid_product_health_blockers"));
  }
  return { valid: errors.length === 0, errors };
}

function ageHours(timestamp, asOfTimestamp) {
  if (timestamp === null || asOfTimestamp === null) return null;
  return Number(((asOfTimestamp - timestamp) / (60 * 60 * 1000)).toFixed(6));
}

function freshnessStatus(timestamp, asOfTimestamp, threshold) {
  if (timestamp === null || asOfTimestamp === null) return "missing";
  if (timestamp > asOfTimestamp) return "future";
  return ageHours(timestamp, asOfTimestamp) > threshold ? "stale" : "fresh";
}

function readCheckedAt(report) {
  const timestamp = canonicalIso(report?.checked_at);
  return timestamp ? Date.parse(timestamp) : null;
}

function isProductionSurface(surface) {
  return PRODUCTION_HYBRID_OBSERVATION_SURFACES.includes(surface);
}

export function partitionAuthorizedEvidenceObservations({ observations = [], baseline, asOf } = {}) {
  const authorizedObservations = [];
  const observationsBeforeAuthorization = [];
  const observationsAfterAsOf = [];
  const invalidTimestampObservations = [];
  const authorizedAt = canonicalIso(baseline?.authorized_at);
  const asOfTimestamp = canonicalIso(asOf);
  for (const row of Array.isArray(observations) ? observations : []) {
    if (!isObject(row) || row.event_type !== "hybrid_search_observation") {
      authorizedObservations.push(row);
      continue;
    }
    const metadata = parseHybridObservationMetadata(row);
    const timestamp = canonicalIso(metadata?.completed_at);
    if (!timestamp) {
      invalidTimestampObservations.push(row);
      authorizedObservations.push(row);
      continue;
    }
    const production = metadata?.production_evidence_enabled === true
      && isProductionSurface(metadata?.surface);
    const sameEpoch = Boolean(baseline?.evidence_epoch_id)
      && metadata?.evidence_epoch_id === baseline.evidence_epoch_id;
    if (production && sameEpoch && authorizedAt && timestamp < authorizedAt) {
      observationsBeforeAuthorization.push(row);
    } else if (production && sameEpoch && asOfTimestamp && timestamp > asOfTimestamp) {
      observationsAfterAsOf.push(row);
    } else {
      authorizedObservations.push(row);
    }
  }
  return {
    authorizedObservations,
    observationsBeforeAuthorization,
    observationsAfterAsOf,
    invalidTimestampObservations,
  };
}

function healthcheckTimestamp(observations) {
  let latest = null;
  for (const row of Array.isArray(observations) ? observations : []) {
    const metadata = parseHybridObservationMetadata(row);
    if (metadata?.traffic_origin !== "scheduled_healthcheck") continue;
    const evidence = validateHybridTrafficOriginEvidence({
      surface: metadata.surface,
      origin: metadata.traffic_origin,
      evidence: metadata.traffic_origin_evidence,
      valid: metadata.traffic_origin_valid,
      reasons: metadata.traffic_origin_reasons,
    });
    const timestamp = canonicalIso(metadata.completed_at);
    if (evidence.valid && timestamp) {
      const value = Date.parse(timestamp);
      if (value > (latest ?? -Infinity)) latest = value;
    }
  }
  return latest;
}

export function collectCanonicalTimes(observations) {
  const latestBySurface = Object.fromEntries(PRODUCTION_HYBRID_OBSERVATION_SURFACES.map(surface => [surface, null]));
  let latest = null;
  let latestHealthcheck = null;
  for (const row of Array.isArray(observations) ? observations : []) {
    if (!isObject(row) || row.event_type !== "hybrid_search_observation") continue;
    const provenance = validateProductionHybridObservationProvenance(row);
    if (!provenance.valid) continue;
    const metadata = parseHybridObservationMetadata(row);
    if (metadata?.production_evidence_enabled !== true) continue;
    const timestampValue = canonicalIso(metadata.completed_at);
    if (!timestampValue) continue;
    const timestamp = Date.parse(timestampValue);
    const surface = metadata.surface;
    if (timestamp > (latestBySurface[surface] ?? -Infinity)) latestBySurface[surface] = timestamp;
    if (timestamp > (latest ?? -Infinity)) latest = timestamp;
    if (metadata.traffic_origin === "scheduled_healthcheck"
      && validateHybridTrafficOriginEvidence({
        surface,
        origin: metadata.traffic_origin,
        evidence: metadata.traffic_origin_evidence,
        valid: metadata.traffic_origin_valid,
        reasons: metadata.traffic_origin_reasons,
      }).valid) {
      if (timestamp > (latestHealthcheck ?? -Infinity)) latestHealthcheck = timestamp;
    }
  }
  return { latest, latestBySurface, latestHealthcheck };
}

function addContinuityFindings({ continuity, stopConditions, evidenceGaps }) {
  for (const finding of continuity?.evidence_gaps || []) addUnique(evidenceGaps, finding);
  for (const finding of continuity?.continuity_blockers || continuity?.blockers || []) {
    const code = finding?.code;
    if (typeof code !== "string") {
      addUnique(stopConditions, issue("continuity_blocker_unclassified", finding));
    } else if (COLLECTING_ONLY_CONTINUITY_BLOCKERS.has(code) || COLLECTING_ONLY_PREFIXES.some(prefix => code.startsWith(prefix))) {
      addUnique(evidenceGaps, finding);
    } else {
      addUnique(stopConditions, issue(code, finding.actual, finding.threshold));
    }
  }
}

function addReportBlockers(stopConditions, report, fallbackCode) {
  for (const finding of report?.blockers || []) {
    const code = typeof finding === "string" ? finding : finding?.code;
    addUnique(stopConditions, issue(code || fallbackCode, typeof finding === "string" ? undefined : finding?.actual));
  }
}

function addReportGaps(evidenceGaps, report) {
  for (const finding of report?.evidence_gaps || report?.gaps || []) {
    addUnique(evidenceGaps, typeof finding === "string" ? issue(finding) : finding);
  }
}

function summary(report, fields) {
  if (!isObject(report)) return null;
  return Object.fromEntries(fields.filter(field => Object.hasOwn(report, field)).map(field => [field, report[field]]));
}

export function evaluateProductionEvidenceHealth({
  observations = [],
  baseline,
  runtimeParity,
  productHealth,
  continuityThresholds,
  monitorThresholds,
  asOf,
} = {}) {
  const asOfIsoCandidate = asOf === undefined
    ? new Date().toISOString()
    : canonicalIso(asOf);
  const asOfTimestamp = asOfIsoCandidate ? Date.parse(asOfIsoCandidate) : null;
  const asOfIso = asOfIsoCandidate;
  const stopConditions = [];
  const evidenceGaps = [];
  const warnings = [];
  const baselineValidation = validateBaseline(baseline);
  const parityValidation = validateRuntimeParity(runtimeParity);
  const productValidation = validateProductHealth(productHealth);
  const monitorValidation = normalizeMonitorThresholds(monitorThresholds);

  if (!asOfIso) addUnique(stopConditions, issue("invalid_as_of", asOf));
  if (!baselineValidation.valid) for (const error of baselineValidation.errors) addUnique(stopConditions, error);
  if (!monitorValidation.valid) for (const error of monitorValidation.errors) addUnique(stopConditions, error);

  const baselineActive = baselineValidation.valid && baseline.active === true;
  const partition = partitionAuthorizedEvidenceObservations({
    observations,
    baseline,
    asOf: asOfIso,
  });
  const authorizedObservations = partition.authorizedObservations;
  const identity = evaluateProductionEvidenceIdentity({ observations: authorizedObservations });
  const continuity = evaluateProductionEvidenceContinuity({
    observations: authorizedObservations,
    thresholds: continuityThresholds,
  });
  const fallback = evaluateHybridFallbackEvidenceWindow({
    observations: authorizedObservations,
    thresholds: {
      minimum_window_days: DEFAULT_EVIDENCE_WINDOW_THRESHOLDS.minimum_window_days,
      minimum_observations: DEFAULT_EVIDENCE_WINDOW_THRESHOLDS.minimum_observations,
      minimum_surface_observations: DEFAULT_EVIDENCE_WINDOW_THRESHOLDS.minimum_surface_observations,
    },
  });
  const fullRollout = buildFullFailClosedRolloutEvidence({
    observations: authorizedObservations,
    thresholds: DEFAULT_FULL_FAIL_CLOSED_ROLLOUT_THRESHOLDS,
  });

  const baselineIdentityMatch = baselineValidation.valid
    && identity.evidence_epoch_ids.length === 1
    && identity.runtime_build_identities.length === 1
    && identity.rollout_config_fingerprints.length === 1
    && identity.evidence_epoch_ids[0] === baseline.evidence_epoch_id
    && identity.runtime_build_identities[0] === baseline.runtime_build_identity
    && identity.rollout_config_fingerprints[0] === baseline.rollout_config_fingerprint;

  if (baselineActive) {
    if (asOfTimestamp === null) addUnique(stopConditions, issue("invalid_as_of", asOf));
    const authorizedAtTimestamp = Date.parse(baseline.authorized_at);
    if (authorizedAtTimestamp > asOfTimestamp) addUnique(stopConditions, issue("baseline_authorized_after_as_of"));
    if (partition.observationsBeforeAuthorization.length > 0) {
      addUnique(stopConditions, issue("observation_before_authorization", partition.observationsBeforeAuthorization.length));
    }
    if (partition.observationsAfterAsOf.length > 0) {
      addUnique(stopConditions, issue("observation_after_as_of", partition.observationsAfterAsOf.length));
    }
    if (partition.invalidTimestampObservations.length > 0) {
      addUnique(stopConditions, issue("invalid_observation_timestamp", partition.invalidTimestampObservations.length));
    }
    if (identity.mixed_epoch) addUnique(stopConditions, issue("mixed_evidence_epoch"));
    if (identity.mixed_runtime_build) addUnique(stopConditions, issue("mixed_runtime_build"));
    if (identity.mixed_rollout_config) addUnique(stopConditions, issue("mixed_rollout_config"));
    if (identity.observation_count > 0 && !baselineIdentityMatch) addUnique(stopConditions, issue("baseline_identity_mismatch"));
    addReportBlockers(stopConditions, identity, "identity_blocked");
    addContinuityFindings({ continuity, stopConditions, evidenceGaps });
    addReportBlockers(stopConditions, fallback, "fallback_evidence_blocked");
    addReportGaps(evidenceGaps, fallback);
    addReportBlockers(stopConditions, fullRollout, "full_rollout_blocked");
    addReportGaps(evidenceGaps, fullRollout);
    for (const code of [
      "channel_errors_present",
      "partial_observations_present",
      "unknown_surface_present",
      "invalid_schema_present",
      "invalid_provenance_present",
      "fallback_events_present",
      "scope_mismatch_events_present",
      "canary_leakage_present",
    ]) {
      if ((fullRollout.controlled_run_blockers || []).some(finding => (finding?.code || finding) === code)) {
        addUnique(stopConditions, issue(code));
      }
    }
    for (const code of [
      "kg_full_fail_closed_mode_not_observable",
      "recent_full_fail_closed_mode_not_observable",
      "kg_full_fail_closed_rollout_not_completed",
      "recent_full_fail_closed_rollout_not_completed",
    ]) {
      if ((fullRollout.evidence_gaps || []).some(finding => (finding?.code || finding) === code)) {
        addUnique(stopConditions, issue(code));
      }
    }
    if (fullRollout.kg_mode !== baseline.expected_kg_mode) addUnique(stopConditions, issue("kg_mode_mismatch", fullRollout.kg_mode, baseline.expected_kg_mode));
    if (fullRollout.recent_mode !== baseline.expected_recent_mode) addUnique(stopConditions, issue("recent_mode_mismatch", fullRollout.recent_mode, baseline.expected_recent_mode));
    if (fullRollout.kg_scoped_canary_events > 0 || fullRollout.recent_scoped_canary_events > 0) {
      addUnique(stopConditions, issue("canary_leakage_present"));
    }

    if (!parityValidation.valid) for (const error of parityValidation.errors) addUnique(stopConditions, error);
    if (!productValidation.valid) for (const error of productValidation.errors) addUnique(stopConditions, error);
    if (parityValidation.valid) {
      if (runtimeParity.source_runtime_equal !== true || runtimeParity.difference_count !== 0) addUnique(stopConditions, issue("runtime_source_parity_drift"));
      if (runtimeParity.runtime_build_identity !== baseline.runtime_build_identity) addUnique(stopConditions, issue("runtime_parity_identity_mismatch"));
    }
    if (productValidation.valid) {
      if (productHealth.status === "rollback_required") addUnique(stopConditions, issue("product_health_rollback_required"));
      if (productHealth.status === "not_evaluated") addUnique(stopConditions, issue("product_health_not_evaluated"));
      if (productHealth.status === "healthy" && productHealth.blockers.length > 0) addUnique(stopConditions, issue("product_health_blockers_present"));
    }

    const times = collectCanonicalTimes(authorizedObservations);
    const parityTimestamp = readCheckedAt(runtimeParity);
    const productTimestamp = readCheckedAt(productHealth);
    const outOfWindowHealthcheckTimestamp = healthcheckTimestamp([
      ...partition.observationsBeforeAuthorization,
      ...partition.observationsAfterAsOf,
    ]);
    if (parityTimestamp !== null && parityTimestamp < authorizedAtTimestamp) {
      addUnique(stopConditions, issue("runtime_parity_before_authorization"));
    }
    if (productTimestamp !== null && productTimestamp < authorizedAtTimestamp) {
      addUnique(stopConditions, issue("product_health_before_authorization"));
    }
    if (outOfWindowHealthcheckTimestamp !== null) {
      if (outOfWindowHealthcheckTimestamp < authorizedAtTimestamp) {
        addUnique(stopConditions, issue("healthcheck_before_authorization"));
      } else if (asOfTimestamp !== null && outOfWindowHealthcheckTimestamp > asOfTimestamp) {
        addUnique(stopConditions, issue("healthcheck_future"));
      }
    }
    const parityStatus = parityValidation.valid
      ? freshnessStatus(parityTimestamp, asOfTimestamp, monitorValidation.thresholds.maximum_runtime_parity_age_hours)
      : "invalid";
    const productStatus = productValidation.valid
      ? freshnessStatus(productTimestamp, asOfTimestamp, monitorValidation.thresholds.maximum_product_health_age_hours)
      : "invalid";
    const latestStatus = freshnessStatus(times.latest, asOfTimestamp, monitorValidation.thresholds.maximum_latest_observation_age_hours);
    const healthcheckStatus = freshnessStatus(times.latestHealthcheck, asOfTimestamp, monitorValidation.thresholds.maximum_healthcheck_age_hours);
    if (latestStatus !== "fresh") addUnique(stopConditions, issue("canonical_observation_stale", latestStatus));
    for (const surface of PRODUCTION_HYBRID_OBSERVATION_SURFACES) {
      const status = freshnessStatus(times.latestBySurface[surface], asOfTimestamp, monitorValidation.thresholds.maximum_latest_observation_age_hours);
      if (status !== "fresh") addUnique(stopConditions, issue(`surface_observation_stale:${surface}`, status));
    }
    if (parityStatus !== "fresh") addUnique(stopConditions, issue(`runtime_parity_${parityStatus}`));
    if (productStatus !== "fresh") addUnique(stopConditions, issue(`product_health_${productStatus}`));
    if (healthcheckStatus !== "fresh") addUnique(stopConditions, issue(`healthcheck_${healthcheckStatus}`));

    const monitorFreshnessStatus = [latestStatus, parityStatus, productStatus, healthcheckStatus].every(status => status === "fresh")
      ? "fresh"
      : "stale";
    const ready = baselineIdentityMatch
      && identity.status === "identity_ready"
      && continuity.status === "continuity_ready"
      && fullRollout.status === "full_fail_closed_confirmed"
      && fallback.decision === "ready"
      && runtimeParity.source_runtime_equal === true
      && runtimeParity.difference_count === 0
      && productHealth.status === "healthy"
      && stopConditions.length === 0;

    const status = stopConditions.length > 0
      ? "blocked_rollback_required"
      : ready
        ? "ready_for_removal_gate"
        : continuity.natural_observation_count > 0 || identity.observation_count > 0
          ? "healthy_collecting"
          : "insufficient_evidence";
    const latestBySurface = Object.fromEntries(Object.entries(times.latestBySurface).map(([surface, timestamp]) => [surface, timestamp === null ? null : new Date(timestamp).toISOString()]));
    const latestAgeBySurface = Object.fromEntries(Object.entries(times.latestBySurface).map(([surface, timestamp]) => [surface, ageHours(timestamp, asOfTimestamp)]));
    return {
      schema_version: 1,
      status,
      rollback_required: status === "blocked_rollback_required",
      as_of: asOfIso,
      baseline_status: "active",
      baseline_identity_match: baselineIdentityMatch,
      authorized_at: baseline.authorized_at,
      authorized_window_observation_count: authorizedObservations.length,
      observation_before_authorization_count: partition.observationsBeforeAuthorization.length,
      observation_after_as_of_count: partition.observationsAfterAsOf.length,
      identity_status: identity.status,
      continuity_status: continuity.status,
      full_rollout_status: fullRollout.status,
      fallback_status: fallback.decision,
      runtime_parity_status: parityStatus,
      product_health_status: productValidation.valid ? productHealth.status : "invalid",
      monitor_freshness_status: monitorFreshnessStatus,
      latest_canonical_observation_at: times.latest === null ? null : new Date(times.latest).toISOString(),
      latest_canonical_observation_age_hours: ageHours(times.latest, asOfTimestamp),
      latest_observation_at_by_surface: latestBySurface,
      latest_observation_age_hours_by_surface: latestAgeBySurface,
      latest_healthcheck_at: times.latestHealthcheck === null ? null : new Date(times.latestHealthcheck).toISOString(),
      latest_healthcheck_age_hours: ageHours(times.latestHealthcheck, asOfTimestamp),
      runtime_parity_age_hours: ageHours(parityTimestamp, asOfTimestamp),
      product_health_age_hours: ageHours(productTimestamp, asOfTimestamp),
      stop_conditions: stopConditions,
      evidence_gaps: evidenceGaps,
      warnings,
      ready_for_removal_gate: ready,
      evidence: {
        baseline: summary(baseline, ["schema_version", "active", "evidence_epoch_id", "runtime_build_identity", "rollout_config_fingerprint", "expected_kg_mode", "expected_recent_mode", "authorized_at"]),
        identity: summary(identity, ["observation_count", "qualifying_observation_count", "evidence_epoch_ids", "runtime_build_identities", "rollout_config_fingerprints"]),
        continuity: summary(continuity, ["natural_observation_count", "natural_observed_by_surface", "natural_window_days", "active_utc_days", "maximum_observation_gap_hours"]),
        full_rollout: summary(fullRollout, ["observation_count", "window_days", "kg_mode", "recent_mode", "kg_fallback_events", "recent_fallback_events", "channel_error_events"]),
        fallback: summary(fallback, ["window_days", "observed_hybrid_events", "fallback_rate", "kg_fallback_events", "recent_fallback_events"]),
        runtime_parity: summary(runtimeParity, ["checked_at", "source_runtime_equal", "difference_count", "runtime_build_identity"]),
        product_health: summary(productHealth, ["checked_at", "status", "blockers"]),
      },
      thresholds: {
        continuity: continuity.thresholds,
        monitor: monitorValidation.thresholds,
      },
    };
  }

  if (baselineValidation.valid && baseline.active === false) addUnique(evidenceGaps, issue("baseline_not_active"));
  if (identity.observation_count === 0) addUnique(evidenceGaps, issue("no_qualifying_observations"));
  return {
    schema_version: 1,
    status: stopConditions.length > 0 ? "blocked_rollback_required" : "insufficient_evidence",
    rollback_required: stopConditions.length > 0,
    as_of: asOfIso,
    baseline_status: baselineValidation.valid ? "inactive" : "invalid",
    baseline_identity_match: false,
    authorized_at: baselineValidation.valid ? baseline.authorized_at : null,
    authorized_window_observation_count: partition.authorizedObservations.length,
    observation_before_authorization_count: partition.observationsBeforeAuthorization.length,
    observation_after_as_of_count: partition.observationsAfterAsOf.length,
    identity_status: identity.status,
    continuity_status: continuity.status,
    full_rollout_status: "not_evaluated",
    fallback_status: "not_evaluated",
    runtime_parity_status: "not_evaluated",
    product_health_status: "not_evaluated",
    monitor_freshness_status: "not_evaluated",
    latest_canonical_observation_at: null,
    latest_canonical_observation_age_hours: null,
    latest_observation_at_by_surface: Object.fromEntries(PRODUCTION_HYBRID_OBSERVATION_SURFACES.map(surface => [surface, null])),
    latest_observation_age_hours_by_surface: Object.fromEntries(PRODUCTION_HYBRID_OBSERVATION_SURFACES.map(surface => [surface, null])),
    latest_healthcheck_at: null,
    latest_healthcheck_age_hours: null,
    runtime_parity_age_hours: null,
    product_health_age_hours: null,
    stop_conditions: stopConditions,
    evidence_gaps: evidenceGaps,
    warnings,
    ready_for_removal_gate: false,
    evidence: {
      baseline: summary(baseline, ["schema_version", "active", "evidence_epoch_id", "runtime_build_identity", "rollout_config_fingerprint", "expected_kg_mode", "expected_recent_mode", "authorized_at"]),
      identity: summary(identity, ["observation_count", "qualifying_observation_count", "evidence_epoch_ids", "runtime_build_identities", "rollout_config_fingerprints"]),
    },
    thresholds: {
      continuity: continuity.thresholds,
      monitor: monitorValidation.thresholds,
    },
  };
}

export {
  isPlainObject,
  freshnessStatus,
  validateBaseline,
  validateRuntimeParity,
  validateProductHealth,
  validateProductionEvidenceContinuityThresholds,
};
