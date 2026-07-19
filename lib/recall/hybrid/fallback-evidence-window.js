import {
  PRODUCTION_HYBRID_OBSERVATION_SURFACES,
  validateProductionHybridObservationProvenance,
} from "./hybrid-observation-provenance.js";

const DEFAULT_EVIDENCE_WINDOW_THRESHOLDS = Object.freeze({
  minimum_window_days: 14,
  minimum_observations: 100,
  minimum_surface_observations: 20,
});

const PRODUCTION_SURFACES = PRODUCTION_HYBRID_OBSERVATION_SURFACES;

function asNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function parseJsonMetadata(row) {
  if (row?.metadata_json === undefined || row?.metadata_json === null) {
    return row?.metadata && typeof row.metadata === "object" ? row.metadata : row;
  }
  if (typeof row.metadata_json === "object" && row.metadata_json !== null) return row.metadata_json;
  if (typeof row.metadata_json !== "string") return null;
  try {
    const parsed = JSON.parse(row.metadata_json);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function readValue(row, metadata, key) {
  return row?.[key] !== undefined ? row[key] : metadata?.[key];
}

function normalizeSurface(row, metadata) {
  const value = readValue(row, metadata, "surface");
  return typeof value === "string" && value.trim() ? value.trim() : "unknown";
}

function parseTimestamp(value) {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 1e12 ? value * 1000 : value;
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const parsed = Date.parse(normalized.endsWith("Z") ? normalized : `${normalized}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function observationTimestamp(row, metadata) {
  const candidates = [
    readValue(row, metadata, "completed_at"),
    readValue(row, metadata, "created_at"),
  ];
  for (const value of candidates) {
    const timestamp = parseTimestamp(value);
    if (timestamp !== null) return timestamp;
  }
  return null;
}

function addCount(counts, value) {
  counts[value] = (counts[value] || 0) + 1;
}

function sortedCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])),
  );
}

function resolveThresholds(input = {}, positional = {}) {
  const merged = {
    ...DEFAULT_EVIDENCE_WINDOW_THRESHOLDS,
    ...(input && typeof input === "object" ? input : {}),
    ...(positional && typeof positional === "object" ? positional : {}),
  };
  return {
    minimum_window_days: asNonNegativeNumber(
      merged.minimum_window_days,
      DEFAULT_EVIDENCE_WINDOW_THRESHOLDS.minimum_window_days,
    ),
    minimum_observations: asNonNegativeNumber(
      merged.minimum_observations,
      DEFAULT_EVIDENCE_WINDOW_THRESHOLDS.minimum_observations,
    ),
    minimum_surface_observations: asNonNegativeNumber(
      merged.minimum_surface_observations,
      DEFAULT_EVIDENCE_WINDOW_THRESHOLDS.minimum_surface_observations,
    ),
  };
}

function toShare(count, total) {
  return total > 0 ? count / total : 0;
}

export function evaluateHybridFallbackEvidenceWindow(
  {
    observations = [],
    now: _now,
    thresholds: inputThresholds = {},
  } = {},
  positionalThresholds = {},
) {
  const thresholds = resolveThresholds(inputThresholds, positionalThresholds);
  const rows = Array.isArray(observations) ? observations : [];
  const bySurface = {};
  const productionBySurface = {};
  const excludedSurfaces = {};
  const timestamps = [];
  let totalEvents = 0;
  let productionEvents = 0;
  let invalidObservationEvents = 0;
  let invalidProvenanceObservationEvents = 0;
  const invalidProvenanceObservationIds = [];
  const invalidProvenanceReasons = {};
  let missingTimestampEvents = 0;
  let unknownSurfaceEvents = 0;
  let unsupportedSchemaVersionEvents = 0;
  let missingSchemaVersionEvents = 0;
  let fallbackEvents = 0;
  let kgFallbackEvents = 0;
  let recentFallbackEvents = 0;
  let bothFallbackEvents = 0;
  let fullyObservedEvents = 0;
  let kgAttemptedEvents = 0;
  let recentAttemptedEvents = 0;

  for (const row of rows) {
    if (!row || typeof row !== "object" || row.event_type !== "hybrid_search_observation") continue;
    totalEvents += 1;
    const metadata = parseJsonMetadata(row);
    if (!metadata) {
      invalidObservationEvents += 1;
      continue;
    }

    const surface = normalizeSurface(row, metadata);
    addCount(bySurface, surface);
    const isProductionSurface = PRODUCTION_SURFACES.includes(surface);
    if (!isProductionSurface) {
      addCount(excludedSurfaces, surface);
      if (surface === "unknown" || !["cli_search"].includes(surface)) unknownSurfaceEvents += 1;
      continue;
    }

    const provenance = validateProductionHybridObservationProvenance(row);
    if (!provenance.valid) {
      invalidProvenanceObservationEvents += 1;
      if (provenance.row_id !== null && provenance.row_id !== undefined) {
        invalidProvenanceObservationIds.push(provenance.row_id);
      }
      for (const reason of provenance.reasons) addCount(invalidProvenanceReasons, reason);
      if (provenance.reasons.includes("missing_schema_version")) missingSchemaVersionEvents += 1;
      if (provenance.reasons.includes("unsupported_schema_version")) unsupportedSchemaVersionEvents += 1;
      if (provenance.reasons.includes("invalid_completed_at")) missingTimestampEvents += 1;
      addCount(excludedSurfaces, surface);
      continue;
    }

    productionEvents += 1;
    addCount(productionBySurface, surface);
    const timestamp = observationTimestamp(row, metadata);
    if (timestamp === null) missingTimestampEvents += 1;
    else timestamps.push(timestamp);

    const rawSchemaVersion = readValue(row, metadata, "schema_version");
    if (rawSchemaVersion === undefined || rawSchemaVersion === null || rawSchemaVersion === "") {
      missingSchemaVersionEvents += 1;
    } else if (Number(rawSchemaVersion) !== 1 || !Number.isFinite(Number(rawSchemaVersion))) {
      unsupportedSchemaVersionEvents += 1;
    }

    const hasKgMode = Object.hasOwn(metadata, "kg_access_mode") || row.kg_access_mode !== undefined;
    const hasRecentMode = Object.hasOwn(metadata, "recent_access_mode") || row.recent_access_mode !== undefined;
    const kgMode = readValue(row, metadata, "kg_access_mode");
    const recentMode = readValue(row, metadata, "recent_access_mode");
    if (hasKgMode) kgAttemptedEvents += 1;
    if (hasRecentMode) recentAttemptedEvents += 1;
    if (hasKgMode && hasRecentMode) fullyObservedEvents += 1;

    const kgFallback = kgMode === "legacy_fallback";
    const recentFallback = recentMode === "guarded_fallback";
    if (kgFallback) kgFallbackEvents += 1;
    if (recentFallback) recentFallbackEvents += 1;
    if (kgFallback || recentFallback) fallbackEvents += 1;
    if (kgFallback && recentFallback) bothFallbackEvents += 1;
  }

  timestamps.sort((a, b) => a - b);
  const firstObservedAt = timestamps.length > 0 ? timestamps[0] : null;
  const lastObservedAt = timestamps.length > 0 ? timestamps[timestamps.length - 1] : null;
  const durationDays = firstObservedAt === null || lastObservedAt === null
    ? 0
    : (lastObservedAt - firstObservedAt) / 86400000;
  const surfaceDeficits = PRODUCTION_SURFACES
    .filter(surface => (productionBySurface[surface] || 0) < thresholds.minimum_surface_observations)
    .map(surface => `surface_observations_below_threshold:${surface}`);
  const gaps = [];
  if (missingTimestampEvents > 0) gaps.push("missing_timestamp_events");
  if (missingSchemaVersionEvents > 0) gaps.push("missing_schema_version_events");
  if (productionEvents < thresholds.minimum_observations) gaps.push("production_observations_below_threshold");
  gaps.push(...surfaceDeficits);
  if (durationDays < thresholds.minimum_window_days) gaps.push("observation_window_below_threshold");

  const blockers = [];
  if (invalidObservationEvents > 0) blockers.push("invalid_observation_format");
  if (invalidProvenanceObservationEvents > 0) blockers.push("invalid_observation_provenance");
  if (unknownSurfaceEvents > 0) blockers.push("unknown_surface_contamination");
  if (unsupportedSchemaVersionEvents > 0) blockers.push("unsupported_schema_version");
  if (fallbackEvents > 0) blockers.push("fallback_events_present");
  const sufficientWindow = durationDays >= thresholds.minimum_window_days;
  const sufficientEvents = productionEvents >= thresholds.minimum_observations;
  const sufficientSurfaceEvents = surfaceDeficits.length === 0;
  const decision = blockers.length > 0
    ? "blocked"
    : gaps.length > 0
      ? "insufficient_evidence"
      : "ready";

  return {
    schema_version: 1,
    window: {
      first_observed_at: firstObservedAt === null ? null : new Date(firstObservedAt).toISOString(),
      last_observed_at: lastObservedAt === null ? null : new Date(lastObservedAt).toISOString(),
      duration_days: durationDays,
    },
    counts: {
      total_events: totalEvents,
      production_events: productionEvents,
      by_surface: sortedCounts(bySurface),
      production_by_surface: sortedCounts(productionBySurface),
      excluded_surfaces: sortedCounts(excludedSurfaces),
      invalid_observation_events: invalidObservationEvents,
      invalid_provenance_observation_events: invalidProvenanceObservationEvents,
      invalid_provenance_observation_ids: invalidProvenanceObservationIds,
      invalid_provenance_reason_distribution: sortedCounts(invalidProvenanceReasons),
      missing_timestamp_events: missingTimestampEvents,
      missing_schema_version_events: missingSchemaVersionEvents,
      unsupported_schema_version_events: unsupportedSchemaVersionEvents,
      fallback_events: fallbackEvents,
      kg_fallback_events: kgFallbackEvents,
      recent_fallback_events: recentFallbackEvents,
      both_fallback_events: bothFallbackEvents,
    },
    coverage: {
      sufficient_window: sufficientWindow,
      sufficient_events: sufficientEvents,
      sufficient_surface_events: sufficientSurfaceEvents,
    },
    gaps,
    blockers,
    decision,
    thresholds,
    generated_at: new Date().toISOString(),

    // These fields let the snapshot feed B5 without changing its API.
    window_days: durationDays,
    observation_window_days: durationDays,
    observed_hybrid_events: productionEvents,
    fully_observed_events: fullyObservedEvents,
    partial_observed_events: productionEvents - fullyObservedEvents,
    fallback_rate: toShare(fallbackEvents, productionEvents),
    kg_fallback_events: kgFallbackEvents,
    recent_fallback_events: recentFallbackEvents,
    both_fallback_events: bothFallbackEvents,
    production_observed_by_surface: sortedCounts(productionBySurface),
    excluded_from_production_by_surface: sortedCounts(excludedSurfaces),
    unknown_surface_events: unknownSurfaceEvents,
    invalid_provenance_observation_count: invalidProvenanceObservationEvents,
    invalid_provenance_observation_ids: invalidProvenanceObservationIds,
    invalid_provenance_reason_distribution: sortedCounts(invalidProvenanceReasons),
    missing_schema_version_events: missingSchemaVersionEvents,
    unsupported_schema_version_events: unsupportedSchemaVersionEvents,
    kg_attempted_events: kgAttemptedEvents,
    recent_attempted_events: recentAttemptedEvents,
    search_executed_events: productionEvents,
    search_not_executed_events: 0,
    observation_start_at: firstObservedAt === null ? null : new Date(firstObservedAt).toISOString(),
  };
}

export function createHybridFallbackEvidenceSnapshot(input = {}, thresholds = {}) {
  return evaluateHybridFallbackEvidenceWindow(input, thresholds);
}

export { DEFAULT_EVIDENCE_WINDOW_THRESHOLDS, PRODUCTION_SURFACES };
