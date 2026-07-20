import {
  PRODUCTION_HYBRID_OBSERVATION_SURFACES,
  canonicalIsoTimestamp,
  parseHybridObservationMetadata,
  validateProductionHybridObservationProvenance,
} from "./hybrid-observation-provenance.js";
import { validateHybridTrafficOriginEvidence } from "./traffic-origin.js";

export const DEFAULT_NATURAL_TRAFFIC_FORECAST_THRESHOLDS = Object.freeze({
  lookback_days: 30,
  projection_days: 30,
  minimum_history_days: 30,
  minimum_projected_total_natural_observations: 600,
  minimum_projected_memory_engine_search_observations: 120,
  minimum_projected_memory_engine_action_search_observations: 120,
  minimum_tool_surface_active_days: 15,
  maximum_tool_surface_gap_hours: 72,
});

const DAY_MS = 86_400_000;
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

function normalizeThresholds(input) {
  const thresholds = { ...DEFAULT_NATURAL_TRAFFIC_FORECAST_THRESHOLDS };
  const errors = [];
  if (input === undefined) return { valid: true, thresholds, errors };
  if (!isPlainObject(input)) return { valid: false, thresholds, errors: ["invalid_thresholds"] };
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(thresholds, key)) errors.push(`unknown_threshold:${key}`);
    else if (typeof value !== "number" || !Number.isFinite(value) || value < 0) errors.push(`invalid_threshold:${key}`);
    else thresholds[key] = value;
  }
  return { valid: errors.length === 0, thresholds, errors };
}

function maxGapHours(timestamps, windowStartMs, windowEndMs) {
  const sorted = [...timestamps].sort((left, right) => left - right);
  if (sorted.length === 0) return Number(((windowEndMs - windowStartMs) / 3_600_000).toFixed(6));
  let maximum = Math.max(
    (sorted[0] - windowStartMs) / 3_600_000,
    (windowEndMs - sorted.at(-1)) / 3_600_000,
  );
  for (let index = 1; index < sorted.length; index += 1) {
    maximum = Math.max(maximum, (sorted[index] - sorted[index - 1]) / 3_600_000);
  }
  return Number(Math.max(0, maximum).toFixed(6));
}

function activeDays(timestamps) {
  return new Set(timestamps.map(timestamp => new Date(timestamp).toISOString().slice(0, 10))).size;
}

function emptySurfaceObject(factory) {
  return Object.fromEntries(PRODUCTION_HYBRID_OBSERVATION_SURFACES.map(surface => [surface, factory()]));
}

function round(value) {
  return Number(value.toFixed(6));
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

export function buildNaturalTrafficForecast({
  observations = [],
  thresholds: thresholdInput,
  asOf = new Date().toISOString(),
} = {}) {
  const asOfIso = canonicalIsoTimestamp(asOf);
  if (!asOfIso) throw new TypeError("asOf must be a canonical UTC ISO timestamp");
  const thresholdValidation = normalizeThresholds(thresholdInput);
  const thresholds = thresholdValidation.thresholds;
  const blockers = [...thresholdValidation.errors];
  if (!Array.isArray(observations)) blockers.push("observations_invalid");
  const asOfMs = Date.parse(asOfIso);
  const startMs = asOfMs - thresholds.lookback_days * DAY_MS;
  const naturalTimestamps = emptySurfaceObject(() => []);
  const originDistribution = {};
  let invalidProvenanceCount = 0;
  let invalidOriginEvidenceCount = 0;
  let unknownOriginCount = 0;
  let excludedProbeCount = 0;
  let excludedHealthcheckCount = 0;

  for (const row of Array.isArray(observations) ? observations : []) {
    if (row?.event_type !== "hybrid_search_observation") continue;
    const provenance = validateProductionHybridObservationProvenance(row);
    if (!provenance.valid) {
      invalidProvenanceCount += 1;
      continue;
    }
    const metadata = parseHybridObservationMetadata(row);
    if (hasNonProductionMarker(row, metadata)) {
      invalidProvenanceCount += 1;
      continue;
    }
    const completedAt = canonicalIsoTimestamp(metadata?.completed_at);
    if (!completedAt) {
      invalidProvenanceCount += 1;
      continue;
    }
    const timestamp = Date.parse(completedAt);
    if (timestamp < startMs || timestamp > asOfMs) continue;
    const origin = metadata.traffic_origin;
    originDistribution[origin || "missing"] = (originDistribution[origin || "missing"] || 0) + 1;
    const validation = validateHybridTrafficOriginEvidence({
      surface: metadata.surface,
      origin,
      evidence: metadata.traffic_origin_evidence,
      valid: metadata.traffic_origin_valid,
      reasons: metadata.traffic_origin_reasons,
    });
    if (!validation.valid) {
      invalidOriginEvidenceCount += 1;
      if (origin === "unknown" || !origin) unknownOriginCount += 1;
      continue;
    }
    if (origin === "natural_user_turn" || origin === "natural_agent_tool_call") {
      naturalTimestamps[metadata.surface].push(timestamp);
    } else if (origin === "operator_verification_probe") excludedProbeCount += 1;
    else if (origin === "scheduled_healthcheck") excludedHealthcheckCount += 1;
    else unknownOriginCount += 1;
  }

  if (invalidProvenanceCount > 0) blockers.push("invalid_provenance_present");
  if (invalidOriginEvidenceCount > 0) blockers.push("invalid_origin_evidence_present");
  if (unknownOriginCount > 0) blockers.push("unknown_origin_present");

  const allNatural = Object.values(naturalTimestamps).flat().sort((left, right) => left - right);
  const firstNaturalMs = allNatural[0] ?? null;
  const historyDays = firstNaturalMs === null
    ? 0
    : Math.min(thresholds.lookback_days, Math.max(1, ((asOfMs - firstNaturalMs) / DAY_MS) + 1));
  const projectionFactor = historyDays > 0 ? thresholds.projection_days / historyDays : 0;
  const naturalCountsBySurface = Object.fromEntries(
    Object.entries(naturalTimestamps).map(([surface, timestamps]) => [surface, timestamps.length]),
  );
  const projectedCountsBySurface = Object.fromEntries(
    Object.entries(naturalCountsBySurface).map(([surface, count]) => [surface, round(count * projectionFactor)]),
  );
  const activeDaysBySurface = Object.fromEntries(
    Object.entries(naturalTimestamps).map(([surface, timestamps]) => [surface, activeDays(timestamps)]),
  );
  const maximumGapHoursBySurface = Object.fromEntries(
    Object.entries(naturalTimestamps).map(([surface, timestamps]) => [
      surface,
      maxGapHours(timestamps, startMs, asOfMs),
    ]),
  );
  const totalNaturalCount = allNatural.length;
  const projectedTotal = round(totalNaturalCount * projectionFactor);

  if (totalNaturalCount === 0) blockers.push("no_qualifying_natural_observations");
  for (const surface of TOOL_SURFACES) {
    if (naturalCountsBySurface[surface] === 0) blockers.push(`missing_natural_tool_surface:${surface}`);
  }
  if (historyDays < thresholds.minimum_history_days) blockers.push("history_window_below_threshold");
  if (projectedTotal < thresholds.minimum_projected_total_natural_observations) blockers.push("projected_total_natural_observations_below_threshold");
  if (projectedCountsBySurface.memory_engine_search < thresholds.minimum_projected_memory_engine_search_observations) {
    blockers.push("projected_memory_engine_search_observations_below_threshold");
  }
  if (projectedCountsBySurface.memory_engine_action_search < thresholds.minimum_projected_memory_engine_action_search_observations) {
    blockers.push("projected_memory_engine_action_search_observations_below_threshold");
  }
  for (const surface of TOOL_SURFACES) {
    if (activeDaysBySurface[surface] < thresholds.minimum_tool_surface_active_days) blockers.push(`tool_surface_active_days_below_threshold:${surface}`);
    if (maximumGapHoursBySurface[surface] > thresholds.maximum_tool_surface_gap_hours) blockers.push(`tool_surface_gap_above_threshold:${surface}`);
  }

  const uniqueBlockers = [...new Set(blockers)];
  return {
    schema_version: 1,
    status: uniqueBlockers.length === 0 ? "ready" : "blocked",
    ready: uniqueBlockers.length === 0,
    as_of: asOfIso,
    window_start: new Date(startMs).toISOString(),
    history_days: round(historyDays),
    projection_factor: round(projectionFactor),
    natural_observation_count: totalNaturalCount,
    projected_natural_observation_count: projectedTotal,
    natural_observed_by_surface: naturalCountsBySurface,
    projected_observed_by_surface: projectedCountsBySurface,
    active_days_by_surface: activeDaysBySurface,
    maximum_gap_hours_by_surface: maximumGapHoursBySurface,
    origin_distribution: Object.fromEntries(Object.entries(originDistribution).sort(([left], [right]) => left.localeCompare(right))),
    excluded_operator_probe_count: excludedProbeCount,
    excluded_scheduled_healthcheck_count: excludedHealthcheckCount,
    invalid_provenance_count: invalidProvenanceCount,
    invalid_origin_evidence_count: invalidOriginEvidenceCount,
    unknown_origin_count: unknownOriginCount,
    blockers: uniqueBlockers,
    thresholds,
  };
}

export { hasNonProductionMarker, normalizeThresholds };
