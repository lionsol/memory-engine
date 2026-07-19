import {
  PRODUCTION_HYBRID_OBSERVATION_SURFACES,
  validateProductionHybridObservationProvenance,
} from "./hybrid-observation-provenance.js";

const PRODUCTION_SURFACES = PRODUCTION_HYBRID_OBSERVATION_SURFACES;

const TOOL_SURFACES = new Set([
  "memory_engine_action_search",
  "memory_engine_search",
]);

const SUPPORTED_CHANNELS = new Set(["kg", "recent"]);
const SUPPORTED_SCHEMA_VERSIONS = new Set([1]);

function addIssue(list, code, actual = undefined) {
  if (list.some(issue => issue.code === code)) return;
  const issue = { code };
  if (actual !== undefined) issue.actual = actual;
  list.push(issue);
}

function sortedCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])),
  );
}

function generatedTimestamp(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return new Date().toISOString();
}

function channelKeys(channel) {
  return {
    accessMode: `${channel}_access_mode`,
    runtimeMode: `${channel}_runtime_mode`,
    rolloutScope: `${channel}_rollout_scope`,
    scopeRequired: `${channel}_scope_required`,
    scopeMatch: `${channel}_fail_closed_scope_match`,
    applied: `${channel}_fail_closed_applied`,
    wouldFallback: `${channel}_fail_closed_would_have_used_fallback`,
    fallbackSuppressed: `${channel}_fail_closed_fallback_suppressed`,
  };
}

function otherChannel(channel) {
  return channel === "kg" ? "recent" : "kg";
}

function normalizeFallbackChannels(value) {
  return Array.isArray(value)
    ? value.filter(item => typeof item === "string" && item.trim()).map(item => item.trim())
    : [];
}

function isScopeHit(metadata, channel) {
  const keys = channelKeys(channel);
  return metadata.surface === "auto_recall"
    && metadata[keys.runtimeMode] === "fail_closed_canary"
    && metadata[keys.rolloutScope] === "scoped_canary"
    && metadata[keys.scopeRequired] === true
    && metadata[keys.scopeMatch] === true;
}

function isFallbackOpportunity(metadata, channel) {
  const keys = channelKeys(channel);
  return metadata[keys.wouldFallback] === true
    || metadata[keys.applied] === true
    || metadata[keys.accessMode] === "isolated_blocked";
}

function isSuppressionSuccess(metadata, channel) {
  const keys = channelKeys(channel);
  const fallbackChannels = normalizeFallbackChannels(metadata.legacy_db_fallback_channels);
  return metadata[keys.applied] === true
    && metadata[keys.fallbackSuppressed] === true
    && metadata[keys.accessMode] === "isolated_blocked"
    && !fallbackChannels.includes(channel);
}

function hasTargetFullMarker(metadata, channel) {
  const keys = channelKeys(channel);
  return metadata[keys.runtimeMode] === "full_fail_closed"
    || metadata[keys.rolloutScope] === "full"
    || metadata[keys.scopeRequired] === false;
}

function hasOtherChannelRollout(metadata, channel) {
  const keys = channelKeys(otherChannel(channel));
  return metadata[keys.runtimeMode] === "fail_closed_canary"
    || metadata[keys.runtimeMode] === "full_fail_closed"
    || metadata[keys.rolloutScope] === "scoped_canary"
    || metadata[keys.rolloutScope] === "full"
    || metadata[keys.scopeMatch] === true
    || metadata[keys.applied] === true;
}

function buildScopedFailClosedCanaryEvidence({
  observations = [],
  channel = "kg",
  expectedAgent = null,
  generatedAt = Date.now(),
} = {}) {
  const normalizedChannel = String(channel || "").trim().toLowerCase();
  if (!SUPPORTED_CHANNELS.has(normalizedChannel)) {
    throw new Error(`unsupported channel: ${channel}`);
  }

  const rows = Array.isArray(observations) ? observations : [];
  const bySurface = Object.fromEntries(PRODUCTION_SURFACES.map(surface => [surface, 0]));
  const schemaVersions = {};
  const valid = [];
  const executed = [];
  let invalidMetadataCount = 0;
  let nonObservationCount = 0;
  let missingSchemaVersionCount = 0;
  let unsupportedSchemaVersionCount = 0;
  let unknownSurfaceCount = 0;
  let searchNotExecutedCount = 0;
  let invalidProvenanceObservationCount = 0;
  const invalidProvenanceObservationIds = [];
  const invalidProvenanceReasonCounts = {};

  for (const row of rows) {
    if (row?.event_type !== "hybrid_search_observation") {
      nonObservationCount += 1;
      continue;
    }
    const provenance = validateProductionHybridObservationProvenance(row);
    const metadata = provenance.metadata;
    if (!metadata) invalidMetadataCount += 1;
    if (!provenance.valid) {
      invalidProvenanceObservationCount += 1;
      if (provenance.row_id !== null && provenance.row_id !== undefined) {
        invalidProvenanceObservationIds.push(provenance.row_id);
      }
      for (const reason of provenance.reasons) {
        invalidProvenanceReasonCounts[reason] = (invalidProvenanceReasonCounts[reason] || 0) + 1;
      }
      if (provenance.reasons.includes("missing_schema_version")) missingSchemaVersionCount += 1;
      if (provenance.reasons.includes("unsupported_schema_version")) unsupportedSchemaVersionCount += 1;
      if (provenance.reasons.includes("unknown_production_surface")) unknownSurfaceCount += 1;
      if (provenance.reasons.includes("search_not_executed")) searchNotExecutedCount += 1;
      continue;
    }
    const schemaVersion = metadata.schema_version;
    if (schemaVersion === undefined || schemaVersion === null) {
      missingSchemaVersionCount += 1;
    } else {
      const key = String(schemaVersion);
      schemaVersions[key] = (schemaVersions[key] || 0) + 1;
      if (!SUPPORTED_SCHEMA_VERSIONS.has(schemaVersion)) unsupportedSchemaVersionCount += 1;
    }
    const surface = typeof metadata.surface === "string" && metadata.surface.trim()
      ? metadata.surface.trim()
      : "unknown";
    const normalized = { ...metadata, surface };
    if (!Object.hasOwn(bySurface, surface)) unknownSurfaceCount += 1;
    valid.push(normalized);
    if (metadata.search_executed !== true) {
      searchNotExecutedCount += 1;
      continue;
    }
    if (Object.hasOwn(bySurface, surface)) bySurface[surface] += 1;
    executed.push(normalized);
  }

  const scopeHits = executed.filter(metadata => isScopeHit(metadata, normalizedChannel));
  const opportunities = scopeHits.filter(metadata => isFallbackOpportunity(metadata, normalizedChannel));
  const suppressionFailures = opportunities.filter(
    metadata => !isSuppressionSuccess(metadata, normalizedChannel),
  );
  const toolRows = executed.filter(metadata => TOOL_SURFACES.has(metadata.surface));
  const toolScopeViolations = toolRows.filter(metadata => {
    const keys = channelKeys(normalizedChannel);
    return metadata[keys.runtimeMode] === "fail_closed_canary"
      || metadata[keys.rolloutScope] === "scoped_canary"
      || metadata[keys.scopeMatch] === true
      || metadata[keys.applied] === true;
  });
  const targetFullViolations = valid.filter(
    metadata => hasTargetFullMarker(metadata, normalizedChannel),
  );
  const otherChannelViolations = valid.filter(
    metadata => hasOtherChannelRollout(metadata, normalizedChannel),
  );
  const channelErrorRows = valid.filter(
    metadata => Number(metadata.channel_error_count || 0) > 0,
  );

  const violations = [];
  const evidenceGaps = [];
  const warnings = [];
  if (invalidMetadataCount > 0) addIssue(violations, "invalid_observation_metadata", invalidMetadataCount);
  if (invalidProvenanceObservationCount > 0) {
    addIssue(violations, "invalid_observation_provenance", invalidProvenanceObservationCount);
  }
  if (missingSchemaVersionCount > 0) addIssue(violations, "missing_observation_schema_version", missingSchemaVersionCount);
  if (unsupportedSchemaVersionCount > 0) addIssue(violations, "unsupported_observation_schema_version", unsupportedSchemaVersionCount);
  if (unknownSurfaceCount > 0) addIssue(violations, "unknown_observation_surface", unknownSurfaceCount);
  if (toolScopeViolations.length > 0) addIssue(violations, "tool_surface_canary_scope_violation", toolScopeViolations.length);
  if (targetFullViolations.length > 0) addIssue(violations, "target_channel_full_mode_present", targetFullViolations.length);
  if (otherChannelViolations.length > 0) addIssue(violations, "other_channel_rollout_present", otherChannelViolations.length);
  if (channelErrorRows.length > 0) addIssue(violations, "channel_errors_present", channelErrorRows.length);
  if (suppressionFailures.length > 0) addIssue(violations, "fallback_suppression_failed", suppressionFailures.length);

  if (scopeHits.length === 0) addIssue(evidenceGaps, "auto_recall_canary_scope_hit_missing");
  if (scopeHits.length > 0 && opportunities.length === 0) {
    addIssue(warnings, "real_fallback_opportunity_not_observed");
  }
  if (expectedAgent) {
    addIssue(warnings, "expected_agent_not_observation_schema_verified");
  }
  if (searchNotExecutedCount > 0) {
    addIssue(warnings, "search_not_executed_observations_excluded", searchNotExecutedCount);
  }
  for (const surface of PRODUCTION_SURFACES) {
    if (bySurface[surface] === 0) addIssue(evidenceGaps, `surface_observation_missing:${surface}`);
  }

  const observedSurfaces = PRODUCTION_SURFACES.filter(surface => bySurface[surface] > 0);
  const surfaceCoverageStatus = observedSurfaces.length === PRODUCTION_SURFACES.length
    ? "complete"
    : observedSurfaces.length === 1 && observedSurfaces[0] === "auto_recall"
      ? "auto_recall_only"
      : "incomplete";
  const scopeStatus = scopeHits.length > 0 ? "confirmed" : "not_confirmed";
  const suppressionStatus = suppressionFailures.length > 0
    ? "failed"
    : opportunities.length > 0
      ? "confirmed"
      : scopeHits.length > 0
        ? "no_opportunity"
        : "not_observed";
  const isolationStatus = violations.length === 0 ? "clean" : "violation";

  let status = "canary_scope_not_confirmed";
  if (violations.length > 0) status = "canary_safety_violation";
  else if (scopeHits.length === 0) status = "canary_scope_not_confirmed";
  else if (opportunities.length > 0) status = "canary_suppression_confirmed";
  else status = "canary_scope_confirmed_no_fallback_opportunity";

  const stage2ReviewEligible = [
    "canary_suppression_confirmed",
    "canary_scope_confirmed_no_fallback_opportunity",
  ].includes(status)
    && surfaceCoverageStatus === "complete"
    && violations.length === 0;

  return {
    schema_version: 1,
    status,
    channel: normalizedChannel,
    expected_agent: typeof expectedAgent === "string" && expectedAgent.trim()
      ? expectedAgent.trim()
      : null,
    expected_agent_verification: expectedAgent
      ? "operator_supplied_not_observation_schema_verified"
      : "not_supplied",
    scope_status: scopeStatus,
    suppression_status: suppressionStatus,
    surface_coverage_status: surfaceCoverageStatus,
    isolation_status: isolationStatus,
    observation_count: valid.length,
    search_executed_observation_count: executed.length,
    input_row_count: rows.length,
    non_observation_row_count: nonObservationCount,
    production_observed_by_surface: bySurface,
    observed_surfaces: observedSurfaces,
    auto_recall_canary_scope_hit_count: scopeHits.length,
    fallback_opportunity_count: opportunities.length,
    fallback_suppression_failure_count: suppressionFailures.length,
    tool_surface_observation_count: toolRows.length,
    tool_surface_scope_violation_count: toolScopeViolations.length,
    other_channel_rollout_violation_count: otherChannelViolations.length,
    target_full_mode_violation_count: targetFullViolations.length,
    channel_error_observation_count: channelErrorRows.length,
    missing_schema_version_count: missingSchemaVersionCount,
    unsupported_schema_version_count: unsupportedSchemaVersionCount,
    unknown_surface_count: unknownSurfaceCount,
    search_not_executed_count: searchNotExecutedCount,
    invalid_provenance_observation_count: invalidProvenanceObservationCount,
    invalid_provenance_observation_ids: invalidProvenanceObservationIds,
    invalid_provenance_reason_distribution: sortedCounts(invalidProvenanceReasonCounts),
    schema_version_distribution: sortedCounts(schemaVersions),
    violations,
    evidence_gaps: evidenceGaps,
    warnings,
    stage2_review_eligible: stage2ReviewEligible,
    stage2_review_eligibility_scope: "observation_evidence_only",
    recommendation: stage2ReviewEligible
      ? "eligible_for_stage2_review"
      : "do_not_enter_stage2",
    external_preconditions: {
      a5_synthetic_safety_smoke_must_pass: true,
      runtime_baseline_restore_must_be_verified: true,
      operator_approval_required: true,
      verified_by_this_report: false,
    },
    safety_boundary: {
      synthetic_a5_remains_authoritative_for_deterministic_suppression: true,
      real_fallback_opportunity_is_enhancing_not_mandatory_for_stage2_review: true,
      do_not_induce_fallback_by_mutating_production_db_or_topology: true,
      scoped_canary_evidence_does_not_authorize_legacy_removal: true,
    },
    generated_at: generatedTimestamp(generatedAt),
  };
}

export {
  PRODUCTION_SURFACES,
  buildScopedFailClosedCanaryEvidence,
};
