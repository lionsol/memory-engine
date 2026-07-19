import {
  PRODUCTION_HYBRID_OBSERVATION_SURFACES,
  parseHybridObservationMetadata,
  validateProductionHybridObservationProvenance,
} from "./hybrid-observation-provenance.js";
import { isSha256Identity } from "./production-evidence-identity.js";
import {
  isTrafficOrigin,
  TRAFFIC_ORIGIN_SCHEMA_VERSION,
  validateHybridTrafficOriginEvidence,
} from "./traffic-origin.js";

export const DEFAULT_PRODUCTION_EVIDENCE_CONTINUITY_THRESHOLDS = Object.freeze({
  minimum_window_days: 30,
  minimum_active_utc_days: 24,
  minimum_active_day_ratio: 0.8,
  maximum_observation_gap_hours: 72,
  minimum_observations: 500,
  minimum_surface_observations: 100,
  minimum_surface_active_days: 15,
});

const DAY_MS = 24 * 60 * 60 * 1000;
const ORIGIN_KEYS = new Set([
  "natural_user_turn",
  "natural_agent_tool_call",
  "operator_verification_probe",
  "scheduled_healthcheck",
  "unknown",
]);
const INTEGER_THRESHOLD_KEYS = new Set([
  "minimum_observations",
  "minimum_surface_observations",
  "minimum_active_utc_days",
  "minimum_surface_active_days",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function issue(code, actual, threshold) {
  const value = { code };
  if (actual !== undefined) value.actual = actual;
  if (threshold !== undefined) value.threshold = threshold;
  return value;
}

function addIssue(list, value) {
  if (!list.some(item => JSON.stringify(item) === JSON.stringify(value))) list.push(value);
}

export function validateProductionEvidenceContinuityThresholds(input) {
  if (input === undefined) return { valid: true, errors: [] };
  if (!isObject(input)) return { valid: false, errors: [{ code: "invalid_thresholds", actual: input }] };
  const errors = [];
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(DEFAULT_PRODUCTION_EVIDENCE_CONTINUITY_THRESHOLDS, key)) {
      errors.push({ code: "unknown_threshold", actual: key });
      continue;
    }
    const value = input[key];
    const invalidInteger = INTEGER_THRESHOLD_KEYS.has(key) && !Number.isInteger(value);
    const invalidRatio = key === "minimum_active_day_ratio" && value > 1;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || invalidInteger || invalidRatio) {
      errors.push({ code: "invalid_threshold", actual: key });
    }
  }
  return { valid: errors.length === 0, errors };
}

function normalizeThresholds(input, blockers) {
  const thresholds = { ...DEFAULT_PRODUCTION_EVIDENCE_CONTINUITY_THRESHOLDS };
  const validation = validateProductionEvidenceContinuityThresholds(input);
  for (const error of validation.errors) addIssue(blockers, issue(error.code, error.actual));
  if (!validation.valid) return thresholds;
  for (const key of Object.keys(thresholds)) {
    if (Object.hasOwn(input || {}, key)) thresholds[key] = input[key];
  }
  return thresholds;
}

function isoDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function dateSpanDays(firstTimestamp, lastTimestamp) {
  if (!Number.isFinite(firstTimestamp) || !Number.isFinite(lastTimestamp)) return 0;
  return Math.max(0, Math.floor((Date.UTC(
    new Date(lastTimestamp).getUTCFullYear(),
    new Date(lastTimestamp).getUTCMonth(),
    new Date(lastTimestamp).getUTCDate(),
  ) - Date.UTC(
    new Date(firstTimestamp).getUTCFullYear(),
    new Date(firstTimestamp).getUTCMonth(),
    new Date(firstTimestamp).getUTCDate(),
  )) / DAY_MS) + 1);
}

function maxGapHours(rows) {
  const timestamps = rows.map(row => row.timestamp).sort((left, right) => left - right);
  let maximum = 0;
  for (let index = 1; index < timestamps.length; index += 1) {
    maximum = Math.max(maximum, (timestamps[index] - timestamps[index - 1]) / (60 * 60 * 1000));
  }
  return Number(maximum.toFixed(6));
}

function emptySurfaceCounts() {
  return Object.fromEntries(PRODUCTION_HYBRID_OBSERVATION_SURFACES.map(surface => [surface, 0]));
}

function emptySurfaceArrays() {
  return Object.fromEntries(PRODUCTION_HYBRID_OBSERVATION_SURFACES.map(surface => [surface, []]));
}

function addProvenanceBlockers(blockers, provenance) {
  for (const reason of provenance.reasons || []) {
    if (reason === "unknown_production_surface") addIssue(blockers, issue("unknown_surface"));
    else if (reason === "unsupported_schema_version") addIssue(blockers, issue("unsupported_schema"));
    else if (reason === "invalid_completed_at") addIssue(blockers, issue("invalid_completed_at"));
    else addIssue(blockers, issue("invalid_provenance", reason));
  }
}

function addIdentityIssues(blockers, metadata, identitySets) {
  let valid = true;
  if (metadata?.production_evidence_enabled !== true) {
    addIssue(blockers, issue("invalid_provenance", "production_evidence_not_enabled"));
    valid = false;
  }
  const epoch = typeof metadata?.evidence_epoch_id === "string" && metadata.evidence_epoch_id.trim()
    ? metadata.evidence_epoch_id.trim()
    : null;
  if (!epoch) {
    addIssue(blockers, issue("invalid_identity", "missing_evidence_epoch_id"));
    valid = false;
  }
  else identitySets.epochs.add(epoch);

  if (!isSha256Identity(metadata?.runtime_build_identity)) {
    addIssue(blockers, issue("invalid_identity", "missing_or_invalid_runtime_build_identity"));
    valid = false;
  } else identitySets.builds.add(metadata.runtime_build_identity);

  if (!isSha256Identity(metadata?.rollout_config_fingerprint)) {
    addIssue(blockers, issue("invalid_identity", "missing_or_invalid_rollout_config_fingerprint"));
    valid = false;
  } else identitySets.configs.add(metadata.rollout_config_fingerprint);
  return valid;
}

function addOriginIssues(blockers, metadata, surface) {
  const origin = metadata?.traffic_origin;
  if (!Object.hasOwn(metadata || {}, "traffic_origin")) {
    addIssue(blockers, issue("missing_traffic_origin"));
    return false;
  }
  if (!isTrafficOrigin(origin) || !ORIGIN_KEYS.has(origin)) {
    addIssue(blockers, issue("invalid_traffic_origin", origin));
    return false;
  }
  const evidence = metadata.traffic_origin_evidence;
  const validation = validateHybridTrafficOriginEvidence({
    surface,
    origin,
    evidence,
    valid: metadata.traffic_origin_valid,
    reasons: metadata.traffic_origin_reasons,
  });
  for (const reason of validation.reasons) addIssue(blockers, issue(reason, origin));
  let valid = validation.valid;
  if (metadata.traffic_origin_schema_version !== TRAFFIC_ORIGIN_SCHEMA_VERSION) {
    addIssue(blockers, issue("origin_evidence_source_invalid", metadata.traffic_origin_schema_version));
    valid = false;
  }
  if (origin === "natural_user_turn" && surface !== "auto_recall") {
    addIssue(blockers, issue("natural_origin_surface_mismatch", `${origin}:${surface}`));
    valid = false;
  }
  if (origin === "natural_agent_tool_call" && surface === "auto_recall") {
    addIssue(blockers, issue("natural_origin_surface_mismatch", `${origin}:${surface}`));
    valid = false;
  }
  return valid;
}

function hasNonProductionMarker(row, metadata) {
  const evidenceSource = metadata?.traffic_origin_evidence?.source;
  return [row, metadata].some(value => (
    value?.synthetic === true
    || value?.synthetic_fixture === true
    || value?.manually_inserted === true
    || value?.direct_wrapper === true
  )) || ["synthetic_fixture", "manual", "direct_wrapper"].includes(evidenceSource);
}

function sortedObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => left.localeCompare(right)));
}

export function evaluateProductionEvidenceContinuity({ observations = [], thresholds: thresholdInput } = {}) {
  const blockers = [];
  const evidenceGaps = [];
  const thresholds = normalizeThresholds(thresholdInput, blockers);
  const identitySets = { epochs: new Set(), builds: new Set(), configs: new Set() };
  const naturalRows = [];
  const probeRows = [];
  const healthcheckRows = [];
  const unknownRows = [];
  const naturalBySurface = emptySurfaceArrays();
  const originDistribution = {};
  let excludedNonProductionCount = 0;

  for (const row of Array.isArray(observations) ? observations : []) {
    if (row?.event_type !== "hybrid_search_observation") continue;
    const metadata = parseHybridObservationMetadata(row);
    const surface = typeof metadata?.surface === "string" && metadata.surface.trim()
      ? metadata.surface.trim()
      : "unknown";
    if (surface === "cli_search") {
      excludedNonProductionCount += 1;
      continue;
    }
    if (!PRODUCTION_HYBRID_OBSERVATION_SURFACES.includes(surface)) {
      addIssue(blockers, issue("unknown_surface", surface));
      continue;
    }

    const provenance = validateProductionHybridObservationProvenance(row);
    if (!provenance.valid) {
      addProvenanceBlockers(blockers, provenance);
      continue;
    }
    const identityValid = addIdentityIssues(blockers, metadata, identitySets);
    const originValid = addOriginIssues(blockers, metadata, surface);
    const origin = metadata.traffic_origin;
    if (isTrafficOrigin(origin)) originDistribution[origin] = (originDistribution[origin] || 0) + 1;
    const timestamp = Date.parse(metadata.completed_at);
    const classified = { row, metadata, surface, origin, timestamp };
    if (hasNonProductionMarker(row, metadata)) {
      addIssue(blockers, issue("invalid_provenance", "non_production_observation"));
      continue;
    }
    if (!identityValid || !originValid) {
      if (origin === "unknown") unknownRows.push(classified);
      continue;
    }
    if (origin === "natural_user_turn" || origin === "natural_agent_tool_call") {
      naturalRows.push(classified);
      naturalBySurface[surface].push(classified);
    } else if (origin === "operator_verification_probe") {
      probeRows.push(classified);
    } else if (origin === "scheduled_healthcheck") {
      healthcheckRows.push(classified);
    } else {
      unknownRows.push(classified);
    }
  }

  if (identitySets.epochs.size > 1) addIssue(blockers, issue("mixed_evidence_epoch", [...identitySets.epochs].sort()));
  if (identitySets.builds.size > 1) addIssue(blockers, issue("mixed_runtime_build", [...identitySets.builds].sort()));
  if (identitySets.configs.size > 1) addIssue(blockers, issue("mixed_rollout_config", [...identitySets.configs].sort()));
  if (identitySets.epochs.size === 0) addIssue(blockers, issue("missing_single_evidence_epoch"));
  if (identitySets.builds.size === 0) addIssue(blockers, issue("missing_single_runtime_build"));
  if (identitySets.configs.size === 0) addIssue(blockers, issue("missing_single_rollout_config"));

  naturalRows.sort((left, right) => left.timestamp - right.timestamp);
  const firstTimestamp = naturalRows[0]?.timestamp ?? null;
  const lastTimestamp = naturalRows.at(-1)?.timestamp ?? null;
  const activeDays = new Set(naturalRows.map(row => isoDate(row.timestamp)));
  const calendarSpanDays = dateSpanDays(firstTimestamp, lastTimestamp);
  const naturalWindowDays = firstTimestamp === null || lastTimestamp === null
    ? 0
    : Number(((lastTimestamp - firstTimestamp) / DAY_MS).toFixed(6));
  const activeUtcDays = activeDays.size;
  const inactiveUtcDays = Math.max(0, calendarSpanDays - activeUtcDays);
  const activeDayRatio = calendarSpanDays > 0 ? activeUtcDays / calendarSpanDays : 0;
  const firstBySurface = {};
  const lastBySurface = {};
  const activeBySurface = emptySurfaceCounts();
  const internalMaxGapBySurface = emptySurfaceCounts();
  const leadingGapBySurface = emptySurfaceCounts();
  const trailingGapBySurface = emptySurfaceCounts();
  const effectiveMaxGapBySurface = emptySurfaceCounts();
  for (const surface of PRODUCTION_HYBRID_OBSERVATION_SURFACES) {
    const rows = naturalBySurface[surface].sort((left, right) => left.timestamp - right.timestamp);
    const days = new Set(rows.map(row => isoDate(row.timestamp)));
    activeBySurface[surface] = days.size;
    internalMaxGapBySurface[surface] = maxGapHours(rows);
    firstBySurface[surface] = rows[0] ? new Date(rows[0].timestamp).toISOString() : null;
    lastBySurface[surface] = rows.at(-1) ? new Date(rows.at(-1).timestamp).toISOString() : null;
    if (rows.length > 0 && firstTimestamp !== null && lastTimestamp !== null) {
      leadingGapBySurface[surface] = Number(((rows[0].timestamp - firstTimestamp) / (60 * 60 * 1000)).toFixed(6));
      trailingGapBySurface[surface] = Number(((lastTimestamp - rows.at(-1).timestamp) / (60 * 60 * 1000)).toFixed(6));
      effectiveMaxGapBySurface[surface] = Math.max(
        internalMaxGapBySurface[surface],
        leadingGapBySurface[surface],
        trailingGapBySurface[surface],
      );
    }
  }

  if (naturalRows.length === 0) addIssue(blockers, issue("no_qualifying_natural_observations"));
  for (const surface of PRODUCTION_HYBRID_OBSERVATION_SURFACES) {
    if (naturalBySurface[surface].length === 0) addIssue(blockers, issue(`missing_natural_surface:${surface}`));
  }

  if (naturalRows.length < thresholds.minimum_observations) {
    addIssue(evidenceGaps, issue("observations_below_threshold", naturalRows.length, thresholds.minimum_observations));
  }
  if (naturalWindowDays < thresholds.minimum_window_days) {
    addIssue(evidenceGaps, issue("window_below_threshold", naturalWindowDays, thresholds.minimum_window_days));
  }
  if (activeUtcDays < thresholds.minimum_active_utc_days) {
    addIssue(evidenceGaps, issue("active_days_below_threshold", activeUtcDays, thresholds.minimum_active_utc_days));
  }
  if (activeDayRatio < thresholds.minimum_active_day_ratio) {
    addIssue(evidenceGaps, issue("active_day_ratio_below_threshold", activeDayRatio, thresholds.minimum_active_day_ratio));
  }
  if (maxGapHours(naturalRows) > thresholds.maximum_observation_gap_hours) {
    addIssue(evidenceGaps, issue("maximum_gap_above_threshold", maxGapHours(naturalRows), thresholds.maximum_observation_gap_hours));
  }
  for (const surface of PRODUCTION_HYBRID_OBSERVATION_SURFACES) {
    const count = naturalBySurface[surface].length;
    if (count < thresholds.minimum_surface_observations) {
      addIssue(evidenceGaps, issue(`surface_observations_below_threshold:${surface}`, count, thresholds.minimum_surface_observations));
    }
    if (activeBySurface[surface] < thresholds.minimum_surface_active_days) {
      addIssue(evidenceGaps, issue(`surface_active_days_below_threshold:${surface}`, activeBySurface[surface], thresholds.minimum_surface_active_days));
    }
    if (effectiveMaxGapBySurface[surface] > thresholds.maximum_observation_gap_hours) {
      addIssue(evidenceGaps, issue(`surface_gap_above_threshold:${surface}`, effectiveMaxGapBySurface[surface], thresholds.maximum_observation_gap_hours));
    }
  }

  const dailyCounts = {};
  for (const row of naturalRows) {
    const day = isoDate(row.timestamp);
    dailyCounts[day] = (dailyCounts[day] || 0) + 1;
  }
  const status = blockers.length > 0
    ? "blocked"
    : evidenceGaps.length === 0
      ? "continuity_ready"
      : naturalRows.length > 0
        ? "continuity_collecting"
        : "continuity_incomplete";

  return {
    schema_version: 1,
    status,
    evidence_epoch_id: identitySets.epochs.size === 1 ? [...identitySets.epochs][0] : null,
    natural_observation_count: naturalRows.length,
    probe_observation_count: probeRows.length,
    healthcheck_observation_count: healthcheckRows.length,
    unknown_origin_observation_count: unknownRows.length,
    excluded_non_production_count: excludedNonProductionCount,
    natural_observed_by_surface: Object.fromEntries(
      Object.entries(naturalBySurface).map(([surface, rows]) => [surface, rows.length]),
    ),
    origin_distribution: sortedObject(originDistribution),
    first_natural_observed_at: firstTimestamp === null ? null : new Date(firstTimestamp).toISOString(),
    last_natural_observed_at: lastTimestamp === null ? null : new Date(lastTimestamp).toISOString(),
    natural_window_days: naturalWindowDays,
    calendar_span_days: calendarSpanDays,
    active_utc_days: activeUtcDays,
    inactive_utc_days: inactiveUtcDays,
    active_day_ratio: Number(activeDayRatio.toFixed(6)),
    maximum_observation_gap_hours: maxGapHours(naturalRows),
    active_days_by_surface: activeBySurface,
    first_observed_at_by_surface: firstBySurface,
    last_observed_at_by_surface: lastBySurface,
    leading_gap_hours_by_surface: leadingGapBySurface,
    trailing_gap_hours_by_surface: trailingGapBySurface,
    internal_maximum_gap_hours_by_surface: internalMaxGapBySurface,
    effective_maximum_gap_hours_by_surface: effectiveMaxGapBySurface,
    maximum_gap_hours_by_surface: effectiveMaxGapBySurface,
    daily_natural_observation_counts: sortedObject(dailyCounts),
    continuity_blockers: blockers,
    blockers,
    evidence_gaps: evidenceGaps,
    thresholds,
  };
}
