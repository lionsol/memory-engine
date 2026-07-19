import {
  evaluateHybridFallbackEvidenceWindow,
  PRODUCTION_SURFACES,
} from "./fallback-evidence-window.js";
import { validateProductionHybridObservationProvenance } from "./hybrid-observation-provenance.js";

export const DEFAULT_FULL_FAIL_CLOSED_ROLLOUT_THRESHOLDS = Object.freeze({
  minimum_window_days: 30,
  minimum_observations: 500,
  minimum_surface_observations: 100,
  require_full_surface_coverage: true,
  require_zero_fallback_events: true,
  require_zero_scope_mismatch: true,
  require_full_observation: true,
  require_supported_schema_only: true,
});

const FULL_MODE = "full_fail_closed";
const SCOPED_MODE = "scoped_canary";
const LEGACY_MODE = "legacy_fallback";
const UNKNOWN_MODE = "unknown";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function addIssue(list, code, actual, threshold) {
  if (list.some(issue => issue.code === code)) return;
  const issue = { code };
  if (actual !== undefined) issue.actual = actual;
  if (threshold !== undefined) issue.threshold = threshold;
  list.push(issue);
}

function normalizeThresholds(input = {}) {
  const merged = {
    ...DEFAULT_FULL_FAIL_CLOSED_ROLLOUT_THRESHOLDS,
    ...(isObject(input) ? input : {}),
  };
  const thresholds = {};
  const invalid = [];
  for (const [key, value] of Object.entries(merged)) {
    const valid = key.startsWith("require_")
      ? typeof value === "boolean"
      : typeof value === "number" && Number.isFinite(value) && value >= 0;
    if (!valid) invalid.push(key);
    thresholds[key] = value;
  }
  return { thresholds, invalid };
}

function readValue(row, metadata, key) {
  if (row && row[key] !== undefined) return row[key];
  return metadata?.[key];
}

function surfaceFor(row, metadata) {
  const value = readValue(row, metadata, "surface");
  return typeof value === "string" && value.trim() ? value.trim() : "unknown";
}

function numericPositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function booleanTrue(value) {
  return value === true;
}

function booleanFalse(value) {
  return value === false;
}

function channelFacts(row, metadata, channel) {
  const isKg = channel === "kg";
  const accessMode = readValue(row, metadata, isKg ? "kg_access_mode" : "recent_access_mode");
  const runtimeMode = readValue(row, metadata, isKg ? "kg_runtime_mode" : "recent_runtime_mode");
  const rolloutScope = readValue(row, metadata, isKg ? "kg_rollout_scope" : "recent_rollout_scope");
  const scopeRequired = readValue(row, metadata, isKg ? "kg_scope_required" : "recent_scope_required");
  const applied = readValue(row, metadata, isKg ? "kg_fail_closed_applied" : "recent_fail_closed_applied");
  const scopeMatch = readValue(row, metadata, isKg ? "kg_fail_closed_scope_match" : "recent_fail_closed_scope_match");
  const fallbackCount = readValue(row, metadata, isKg ? "kg_fallback_events" : "recent_fallback_events");
  const fallback = isKg
    ? accessMode === "legacy_fallback"
      || runtimeMode === "legacy_fallback"
      || numericPositive(fallbackCount)
    : accessMode === "guarded_fallback"
      || runtimeMode === "legacy_fallback"
      || numericPositive(fallbackCount);
  const explicitFull = runtimeMode === FULL_MODE
    && rolloutScope === "full"
    && scopeRequired === false;
  const explicitScoped = runtimeMode === "fail_closed_canary"
    || rolloutScope === SCOPED_MODE
    || (accessMode === "isolated_blocked" && booleanTrue(applied) && booleanTrue(scopeMatch));
  const appliedFailClosed = booleanTrue(applied);

  if (fallback) return { mode: LEGACY_MODE, fallback: true, appliedFailClosed, scopeMatch, rolloutScope };
  if (explicitFull) return { mode: FULL_MODE, fallback: false, appliedFailClosed, scopeMatch, rolloutScope };
  if (explicitScoped) return { mode: SCOPED_MODE, fallback: false, appliedFailClosed, scopeMatch, rolloutScope };
  if (appliedFailClosed || accessMode === "isolated_blocked" || runtimeMode === "shadow_fail_closed") {
    return { mode: UNKNOWN_MODE, fallback: false, appliedFailClosed, scopeMatch, rolloutScope };
  }
  return { mode: UNKNOWN_MODE, fallback: false, appliedFailClosed, scopeMatch, rolloutScope };
}

function addModeCount(counts, mode) {
  counts[mode] = (counts[mode] || 0) + 1;
}

function summarizeModes(counts) {
  const modes = Object.keys(counts).filter(mode => counts[mode] > 0);
  if (modes.length === 0 || (modes.length === 1 && modes[0] === UNKNOWN_MODE)) return UNKNOWN_MODE;
  if (modes.length === 1) return modes[0];
  return "mixed";
}

function sortedCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])),
  );
}

function generatedTimestamp(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return new Date().toISOString();
}

function fixedSurfaceCounts(input = {}) {
  return Object.fromEntries(PRODUCTION_SURFACES.map(surface => [surface, Number(input[surface]) || 0]));
}

function controlledRunFacts(observations) {
  let channelErrorEvents = 0;

  for (const row of observations) {
    if (!isObject(row) || row.event_type !== "hybrid_search_observation") continue;
    const provenance = validateProductionHybridObservationProvenance(row);
    if (!provenance.valid) continue;
    const metadata = provenance.metadata;
    const surface = surfaceFor(row, metadata);
    if (!PRODUCTION_SURFACES.includes(surface)) continue;
    const channelErrorCount = Number(readValue(row, metadata, "channel_error_count"));
    if (Number.isFinite(channelErrorCount) && channelErrorCount > 0) {
      channelErrorEvents += channelErrorCount;
    }
  }

  return { channelErrorEvents };
}

function controlledRunCoverage({
  productionObservedBySurface,
  classified,
  observationCount,
  partialObservedEvents,
  unknownSurfaceEvents,
  missingSchemaVersionEvents,
  unsupportedSchemaVersionEvents,
  invalidProvenanceObservationCount,
  channelErrorEvents,
  invalidObservationEvents,
}) {
  const missingSurfaces = PRODUCTION_SURFACES.filter(
    surface => productionObservedBySurface[surface] < 1,
  );
  const blockers = [];

  for (const surface of missingSurfaces) {
    addIssue(blockers, `missing_surface:${surface}`, productionObservedBySurface[surface], 1);
  }
  if (observationCount > 0 && classified.kgMode !== FULL_MODE) {
    addIssue(blockers, "kg_full_fail_closed_marker_missing", classified.kgMode, FULL_MODE);
  }
  if (observationCount > 0 && classified.recentMode !== FULL_MODE) {
    addIssue(blockers, "recent_full_fail_closed_marker_missing", classified.recentMode, FULL_MODE);
  }
  if (classified.kgScopedCanaryEvents > 0 || classified.recentScopedCanaryEvents > 0) {
    addIssue(
      blockers,
      "canary_leakage_present",
      classified.kgScopedCanaryEvents + classified.recentScopedCanaryEvents,
      0,
    );
  }
  if (classified.kgFallbackEvents > 0 || classified.recentFallbackEvents > 0) {
    addIssue(blockers, "fallback_events_present", classified.kgFallbackEvents + classified.recentFallbackEvents, 0);
  }
  if (channelErrorEvents > 0) addIssue(blockers, "channel_errors_present", channelErrorEvents, 0);
  if (invalidObservationEvents > 0) addIssue(blockers, "invalid_observation_format", invalidObservationEvents, 0);
  if (invalidProvenanceObservationCount > 0) {
    addIssue(blockers, "invalid_provenance_present", invalidProvenanceObservationCount, 0);
  }
  if (unknownSurfaceEvents > 0) addIssue(blockers, "unknown_surface_present", unknownSurfaceEvents, 0);
  if (missingSchemaVersionEvents > 0 || unsupportedSchemaVersionEvents > 0) {
    addIssue(blockers, "invalid_schema_present");
  }
  if (partialObservedEvents > 0) addIssue(blockers, "partial_observations_present", partialObservedEvents, 0);

  const nonSurfaceBlockers = blockers.filter(issue => !issue.code.startsWith("missing_surface:"));
  const status = nonSurfaceBlockers.length > 0
    ? "blocked"
    : missingSurfaces.length > 0
      ? "incomplete"
      : "complete";

  return {
    status,
    missingSurfaces,
    blockers,
    eligible: status === "complete",
  };
}

function classifyRows(observations) {
  const kgModeCounts = {};
  const recentModeCounts = {};
  let kgFailClosedEvents = 0;
  let recentFailClosedEvents = 0;
  let kgFallbackEvents = 0;
  let recentFallbackEvents = 0;
  let kgScopedCanaryEvents = 0;
  let recentScopedCanaryEvents = 0;
  let scopeMismatchEvents = 0;

  for (const row of observations) {
    if (!isObject(row) || row.event_type !== "hybrid_search_observation") continue;
    const provenance = validateProductionHybridObservationProvenance(row);
    if (!provenance.valid) continue;
    const metadata = provenance.metadata;
    const surface = surfaceFor(row, metadata);
    if (!PRODUCTION_SURFACES.includes(surface)) continue;

    const kg = channelFacts(row, metadata, "kg");
    const recent = channelFacts(row, metadata, "recent");
    addModeCount(kgModeCounts, kg.mode);
    addModeCount(recentModeCounts, recent.mode);
    if (kg.appliedFailClosed) kgFailClosedEvents += 1;
    if (recent.appliedFailClosed) recentFailClosedEvents += 1;
    if (kg.fallback) kgFallbackEvents += 1;
    if (recent.fallback) recentFallbackEvents += 1;
    if (kg.mode === SCOPED_MODE) kgScopedCanaryEvents += 1;
    if (recent.mode === SCOPED_MODE) recentScopedCanaryEvents += 1;
    if (booleanFalse(kg.scopeMatch) || booleanFalse(recent.scopeMatch)) scopeMismatchEvents += 1;
  }

  return {
    kgModeCounts,
    recentModeCounts,
    kgMode: summarizeModes(kgModeCounts),
    recentMode: summarizeModes(recentModeCounts),
    kgFailClosedEvents,
    recentFailClosedEvents,
    kgFallbackEvents,
    recentFallbackEvents,
    kgScopedCanaryEvents,
    recentScopedCanaryEvents,
    scopeMismatchEvents,
  };
}

export function buildFullFailClosedRolloutEvidence({
  observations = [],
  thresholds: thresholdInput = {},
  generatedAt,
} = {}) {
  const { thresholds, invalid: invalidThresholds } = normalizeThresholds(thresholdInput);
  const blockers = [];
  const evidenceGaps = [];
  const warnings = [];
  const rows = Array.isArray(observations) ? observations : [];
  if (!Array.isArray(observations)) addIssue(blockers, "invalid_observation_input");
  if (invalidThresholds.length > 0) addIssue(blockers, "invalid_observation_input", invalidThresholds);

  const windowReport = evaluateHybridFallbackEvidenceWindow({
    observations: rows,
    thresholds: {
      minimum_window_days: thresholds.minimum_window_days,
      minimum_observations: thresholds.minimum_observations,
      minimum_surface_observations: thresholds.minimum_surface_observations,
    },
  });
  const classified = classifyRows(rows);
  const controlledFacts = controlledRunFacts(rows);
  const productionObservedBySurface = fixedSurfaceCounts(windowReport.production_observed_by_surface);
  const observationCount = windowReport.observed_hybrid_events || 0;
  const partialObservedEvents = windowReport.partial_observed_events || 0;
  const fullyObservedEvents = windowReport.fully_observed_events || 0;
  const unknownSurfaceEvents = windowReport.unknown_surface_events || 0;
  const missingSchemaVersionEvents = windowReport.missing_schema_version_events || 0;
  const unsupportedSchemaVersionEvents = windowReport.unsupported_schema_version_events || 0;
  const invalidProvenanceObservationCount = windowReport.invalid_provenance_observation_count || 0;
  const invalidProvenanceObservationIds = windowReport.invalid_provenance_observation_ids || [];
  const invalidProvenanceReasonDistribution = windowReport.invalid_provenance_reason_distribution || {};
  const controlledCoverage = controlledRunCoverage({
    productionObservedBySurface,
    classified,
    observationCount,
    partialObservedEvents,
    unknownSurfaceEvents,
    missingSchemaVersionEvents,
    unsupportedSchemaVersionEvents,
    invalidProvenanceObservationCount,
    channelErrorEvents: controlledFacts.channelErrorEvents,
    invalidObservationEvents: windowReport.counts?.invalid_observation_events || 0,
  });

  if (invalidProvenanceObservationCount > 0) {
    addIssue(blockers, "invalid_observation_provenance_present", invalidProvenanceObservationCount, 0);
  }
  if (windowReport.counts?.fallback_events > 0 || classified.kgFallbackEvents > 0 || classified.recentFallbackEvents > 0) {
    addIssue(blockers, "production_fallback_events_present");
  }
  if (unknownSurfaceEvents > 0) addIssue(blockers, "unknown_production_surfaces_present", unknownSurfaceEvents, 0);
  if (missingSchemaVersionEvents > 0 || unsupportedSchemaVersionEvents > 0) {
    addIssue(blockers, "invalid_observation_schema_present");
  }
  if (thresholds.require_full_observation && partialObservedEvents > 0) {
    addIssue(blockers, "partial_observations_present", partialObservedEvents, 0);
  }
  if (thresholds.require_zero_scope_mismatch && classified.scopeMismatchEvents > 0) {
    addIssue(blockers, "scope_mismatch_events_present", classified.scopeMismatchEvents, 0);
  }
  if (classified.kgMode === "mixed" && classified.kgFallbackEvents > 0) {
    addIssue(blockers, "mixed_rollout_with_legacy_fallback");
  }
  if (classified.recentMode === "mixed" && classified.recentFallbackEvents > 0) {
    addIssue(blockers, "mixed_rollout_with_legacy_fallback");
  }

  if (observationCount === 0) addIssue(evidenceGaps, "production_observations_missing");
  else if (observationCount < thresholds.minimum_observations) {
    addIssue(evidenceGaps, "production_observations_below_threshold", observationCount, thresholds.minimum_observations);
  }
  if (windowReport.window_days < thresholds.minimum_window_days) {
    addIssue(evidenceGaps, "production_window_below_threshold", windowReport.window_days, thresholds.minimum_window_days);
  }
  if (windowReport.counts?.missing_timestamp_events > 0) {
    addIssue(evidenceGaps, "production_timestamp_evidence_missing", windowReport.counts.missing_timestamp_events);
  }
  if (thresholds.require_full_surface_coverage) {
    for (const surface of PRODUCTION_SURFACES) {
      if (productionObservedBySurface[surface] < thresholds.minimum_surface_observations) {
        addIssue(
          evidenceGaps,
          `surface_observations_below_threshold:${surface}`,
          productionObservedBySurface[surface],
          thresholds.minimum_surface_observations,
        );
      }
    }
  }
  if (classified.kgMode === UNKNOWN_MODE) addIssue(evidenceGaps, "kg_full_fail_closed_mode_not_observable");
  else if (classified.kgMode === SCOPED_MODE || classified.kgMode === "mixed") {
    addIssue(evidenceGaps, "kg_full_fail_closed_rollout_not_completed");
  }
  if (classified.recentMode === UNKNOWN_MODE) addIssue(evidenceGaps, "recent_full_fail_closed_mode_not_observable");
  else if (classified.recentMode === SCOPED_MODE || classified.recentMode === "mixed") {
    addIssue(evidenceGaps, "recent_full_fail_closed_rollout_not_completed");
  }

  const hasPartialMode = [classified.kgMode, classified.recentMode].some(
    mode => mode === SCOPED_MODE || mode === "mixed",
  );
  let status = "full_fail_closed_confirmed";
  if (blockers.length > 0) status = "blocked";
  else if (hasPartialMode) status = "partial_rollout";
  else if (evidenceGaps.length > 0 || classified.kgMode !== FULL_MODE || classified.recentMode !== FULL_MODE) {
    status = "insufficient_evidence";
  }

  if (windowReport.excluded_from_production_by_surface?.cli_search) {
    warnings.push({
      code: "cli_surface_excluded",
      actual: windowReport.excluded_from_production_by_surface.cli_search,
    });
  }

  return {
    schema_version: 1,
    status,
    target_mode: FULL_MODE,
    kg_mode: classified.kgMode,
    recent_mode: classified.recentMode,
    observation_count: observationCount,
    window_days: windowReport.window_days,
    production_observed_by_surface: productionObservedBySurface,
    kg_fail_closed_events: classified.kgFailClosedEvents,
    recent_fail_closed_events: classified.recentFailClosedEvents,
    kg_fallback_events: classified.kgFallbackEvents,
    recent_fallback_events: classified.recentFallbackEvents,
    kg_scoped_canary_events: classified.kgScopedCanaryEvents,
    recent_scoped_canary_events: classified.recentScopedCanaryEvents,
    channel_error_events: controlledFacts.channelErrorEvents,
    scope_mismatch_events: classified.scopeMismatchEvents,
    fully_observed_events: fullyObservedEvents,
    partial_observed_events: partialObservedEvents,
    unknown_surface_events: unknownSurfaceEvents,
    missing_schema_version_events: missingSchemaVersionEvents,
    unsupported_schema_version_events: unsupportedSchemaVersionEvents,
    controlled_run_surface_coverage_status: controlledCoverage.status,
    missing_controlled_run_surfaces: controlledCoverage.missingSurfaces,
    controlled_run_closeout_eligible: controlledCoverage.eligible,
    controlled_run_blockers: controlledCoverage.blockers,
    invalid_provenance_observation_count: invalidProvenanceObservationCount,
    invalid_provenance_observation_ids: invalidProvenanceObservationIds,
    invalid_provenance_reason_distribution: invalidProvenanceReasonDistribution,
    blockers,
    evidence_gaps: evidenceGaps,
    warnings,
    evidence: {
      observation_window: windowReport.window,
      surfaces: {
        production_observed_by_surface: productionObservedBySurface,
        excluded_from_production_by_surface: windowReport.excluded_from_production_by_surface || {},
      },
      kg: {
        modes: sortedCounts(classified.kgModeCounts),
        fail_closed_events: classified.kgFailClosedEvents,
        fallback_events: classified.kgFallbackEvents,
        scoped_canary_events: classified.kgScopedCanaryEvents,
      },
      recent: {
        modes: sortedCounts(classified.recentModeCounts),
        fail_closed_events: classified.recentFailClosedEvents,
        fallback_events: classified.recentFallbackEvents,
        scoped_canary_events: classified.recentScopedCanaryEvents,
        channel_error_events: controlledFacts.channelErrorEvents,
      },
      controlled_run: {
        surface_coverage_status: controlledCoverage.status,
        missing_surfaces: controlledCoverage.missingSurfaces,
        closeout_eligible: controlledCoverage.eligible,
        blockers: controlledCoverage.blockers,
      },
      schema: {
        missing_schema_version_events: missingSchemaVersionEvents,
        unsupported_schema_version_events: unsupportedSchemaVersionEvents,
      },
      provenance: {
        invalid_observation_count: invalidProvenanceObservationCount,
        invalid_observation_ids: invalidProvenanceObservationIds,
        reason_distribution: invalidProvenanceReasonDistribution,
      },
    },
    thresholds,
    generated_at: generatedTimestamp(generatedAt),
  };
}
