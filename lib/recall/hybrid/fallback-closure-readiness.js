const DEFAULT_CLOSURE_THRESHOLDS = Object.freeze({
  minimum_observations: 100,
  minimum_surface_observations: 20,
  minimum_window_days: 14,
  require_full_observation: true,
  require_zero_fallback: true,
});

const DECISION_CLASSES = new Set([
  "blocked",
  "insufficient_evidence",
  "ready_for_shadow_fail_closed",
  "ready_for_fail_closed_canary",
  "ready_for_removal",
]);

const PRODUCTION_SURFACES = Object.freeze([
  "auto_recall",
  "memory_engine_action_search",
  "memory_engine_search",
]);

function asNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function asBoolean(value) {
  return value === true;
}

function readDecision(report) {
  const decision = report?.decision;
  return decision && typeof decision === "object" ? decision : {};
}

function normalizeDecisionClass(report) {
  const value = readDecision(report).class;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function classifyAuditEvidence(report, expectedClass) {
  const decisionClass = normalizeDecisionClass(report);
  if (decisionClass === null) return { status: "missing", decision_class: null };
  if (decisionClass === expectedClass) return { status: "passed", decision_class: decisionClass };
  return { status: "failed", decision_class: decisionClass };
}

function normalizeCanaryStatus(report, channel) {
  const explicitStatuses = [
    report?.[`${channel}_canary_status`],
    report?.canary?.status,
    report?.fail_closed_canary?.status,
    report?.canary?.[`${channel}_status`],
    report?.fail_closed_canary?.[`${channel}_status`],
  ];
  for (const value of explicitStatuses) {
    if (typeof value !== "string") continue;
    const normalized = value.trim().toLowerCase();
    if (["passed", "pass", "success", "succeeded"].includes(normalized)) return "passed";
    if (["failed", "fail", "error"].includes(normalized)) return "failed";
    if (["running", "in_progress", "pending"].includes(normalized)) return "running";
  }

  const passedFlags = [
    report?.[`${channel}_canary_passed`],
    report?.fail_closed_canary_passed,
    report?.canary?.passed,
    report?.canary?.[`${channel}_passed`],
    report?.fail_closed_canary?.passed,
    report?.fail_closed_canary?.[`${channel}_passed`],
  ];
  return passedFlags.some(asBoolean) ? "passed" : "missing";
}

function resolveThresholds(inputThresholds = {}, positionalThresholds = {}) {
  const merged = {
    ...DEFAULT_CLOSURE_THRESHOLDS,
    ...(inputThresholds && typeof inputThresholds === "object" ? inputThresholds : {}),
    ...(positionalThresholds && typeof positionalThresholds === "object" ? positionalThresholds : {}),
  };
  return {
    ...merged,
    minimum_observations: asNonNegativeNumber(
      merged.minimum_observations,
      DEFAULT_CLOSURE_THRESHOLDS.minimum_observations,
    ),
    minimum_surface_observations: asNonNegativeNumber(
      merged.minimum_surface_observations,
      DEFAULT_CLOSURE_THRESHOLDS.minimum_surface_observations,
    ),
    minimum_window_days: asNonNegativeNumber(
      merged.minimum_window_days,
      DEFAULT_CLOSURE_THRESHOLDS.minimum_window_days,
    ),
    require_full_observation: merged.require_full_observation !== false,
    require_zero_fallback: merged.require_zero_fallback !== false,
  };
}

function metricSummary(hybridObservability = {}) {
  return hybridObservability && typeof hybridObservability === "object"
    ? hybridObservability
    : {};
}

function buildEvidence(hybrid, kgAudit, recentAudit) {
  return {
    hybrid_observation: {
      observed_hybrid_events: asNonNegativeNumber(hybrid.observed_hybrid_events),
      production_observed_by_surface: hybrid.production_observed_by_surface || {},
      excluded_from_production_by_surface: hybrid.excluded_from_production_by_surface || {},
      fully_observed_events: asNonNegativeNumber(hybrid.fully_observed_events),
      partial_observed_events: asNonNegativeNumber(hybrid.partial_observed_events),
      fallback_events: asNonNegativeNumber(hybrid.fallback_events),
      kg_fallback_events: asNonNegativeNumber(hybrid.kg_fallback_events),
      recent_fallback_events: asNonNegativeNumber(hybrid.recent_fallback_events),
      unknown_surface_events: asNonNegativeNumber(hybrid.unknown_surface_events),
      missing_schema_version_events: asNonNegativeNumber(hybrid.missing_schema_version_events),
      unsupported_schema_version_events: asNonNegativeNumber(hybrid.unsupported_schema_version_events),
      observation_schema_versions: hybrid.observation_schema_versions || {},
      observation_window_days: asNonNegativeNumber(
        hybrid.observation_window_days ?? hybrid.window_days,
      ),
      search_executed_events: asNonNegativeNumber(hybrid.search_executed_events),
      search_not_executed_events: asNonNegativeNumber(hybrid.search_not_executed_events),
    },
    kg_audit: {
      status: classifyAuditEvidence(kgAudit, "pass").status,
      decision: readDecision(kgAudit),
      canary_status: normalizeCanaryStatus(kgAudit, "kg"),
    },
    recent_audit: {
      status: classifyAuditEvidence(recentAudit, "pass_canary_readiness").status,
      decision: readDecision(recentAudit),
      canary_status: normalizeCanaryStatus(recentAudit, "recent"),
    },
  };
}

function firstReason(blockers, evidenceGaps, fallback) {
  return blockers[0] || evidenceGaps[0] || fallback;
}

export function evaluateHybridFallbackClosureReadiness(
  {
    hybridObservability = {},
    kgAudit = {},
    recentAudit = {},
    thresholds: inputThresholds = {},
  } = {},
  positionalThresholds = {},
) {
  const thresholds = resolveThresholds(inputThresholds, positionalThresholds);
  const hybrid = metricSummary(hybridObservability);
  const kgAuditEvidence = classifyAuditEvidence(kgAudit, "pass");
  const recentAuditEvidence = classifyAuditEvidence(recentAudit, "pass_canary_readiness");
  const kgCanaryStatus = normalizeCanaryStatus(kgAudit, "kg");
  const recentCanaryStatus = normalizeCanaryStatus(recentAudit, "recent");
  const observedEvents = asNonNegativeNumber(hybrid.observed_hybrid_events);
  const fullyObservedEvents = asNonNegativeNumber(hybrid.fully_observed_events);
  const partialEvents = asNonNegativeNumber(hybrid.partial_observed_events);
  const fallbackEvents = asNonNegativeNumber(hybrid.fallback_events);
  const kgFallbackEvents = asNonNegativeNumber(hybrid.kg_fallback_events);
  const recentFallbackEvents = asNonNegativeNumber(hybrid.recent_fallback_events);
  const unknownSurfaceEvents = asNonNegativeNumber(hybrid.unknown_surface_events);
  const missingSchemaEvents = asNonNegativeNumber(hybrid.missing_schema_version_events);
  const unsupportedSchemaEvents = asNonNegativeNumber(hybrid.unsupported_schema_version_events);
  const productionBySurface = hybrid.production_observed_by_surface || {};
  const observationWindowDays = asNonNegativeNumber(
    hybrid.observation_window_days ?? hybrid.window_days,
  );
  const blockers = [];
  const evidenceGaps = [];

  if (kgAuditEvidence.status === "failed") blockers.push("kg_audit_failed");
  if (recentAuditEvidence.status === "failed") blockers.push("recent_audit_failed");
  if (kgAuditEvidence.status === "missing") evidenceGaps.push("kg_audit_missing");
  if (recentAuditEvidence.status === "missing") evidenceGaps.push("recent_audit_missing");
  if (observedEvents === 0) evidenceGaps.push("production_observations_missing");
  if (thresholds.require_zero_fallback
    && (fallbackEvents > 0 || kgFallbackEvents > 0 || recentFallbackEvents > 0)) {
    blockers.push("fallback_events_present");
  }
  if (thresholds.require_full_observation
    && (partialEvents > 0 || fullyObservedEvents !== observedEvents)) {
    blockers.push("partial_observations_present");
  }
  if (unknownSurfaceEvents > 0) blockers.push("unknown_surface_events_present");
  if (missingSchemaEvents > 0) blockers.push("missing_schema_version_events_present");
  if (unsupportedSchemaEvents > 0) blockers.push("unsupported_schema_version_events_present");
  if (kgCanaryStatus === "failed") blockers.push("kg_fail_closed_canary_failed");
  if (recentCanaryStatus === "failed") blockers.push("recent_fail_closed_canary_failed");

  const surfaceDeficits = PRODUCTION_SURFACES
    .filter(surface => asNonNegativeNumber(productionBySurface[surface]) < thresholds.minimum_surface_observations)
    .map(surface => `surface_observations_below_threshold:${surface}`);
  evidenceGaps.push(...surfaceDeficits);
  if (observedEvents < thresholds.minimum_observations) {
    evidenceGaps.push("production_evidence_below_threshold");
  }

  const foundationalEvidenceGap = evidenceGaps.length > 0;
  if (kgAuditEvidence.status === "passed" && kgCanaryStatus === "missing") {
    evidenceGaps.push("kg_fail_closed_canary_missing");
  } else if (kgAuditEvidence.status === "passed" && kgCanaryStatus === "running") {
    evidenceGaps.push("kg_fail_closed_canary_running");
  }
  if (recentAuditEvidence.status === "passed" && recentCanaryStatus === "missing") {
    evidenceGaps.push("recent_fail_closed_canary_missing");
  } else if (recentAuditEvidence.status === "passed" && recentCanaryStatus === "running") {
    evidenceGaps.push("recent_fail_closed_canary_running");
  }
  if (observationWindowDays < thresholds.minimum_window_days) {
    evidenceGaps.push("production_window_below_threshold");
  }

  let decisionClass = "blocked";
  if (blockers.length === 0) {
    if (foundationalEvidenceGap) {
      decisionClass = "insufficient_evidence";
    } else if (observationWindowDays < thresholds.minimum_window_days) {
      decisionClass = "ready_for_shadow_fail_closed";
    } else if (kgCanaryStatus !== "passed" || recentCanaryStatus !== "passed") {
      decisionClass = "ready_for_fail_closed_canary";
    } else {
      decisionClass = "ready_for_removal";
    }
  }

  return {
    schema_version: 1,
    decision: {
      class: DECISION_CLASSES.has(decisionClass) ? decisionClass : "blocked",
      reason: firstReason(
        blockers,
        evidenceGaps,
        "all_current_readiness_requirements_satisfied",
      ),
    },
    evidence: buildEvidence(hybrid, kgAudit, recentAudit),
    blockers,
    evidence_gaps: evidenceGaps,
    thresholds: {
      ...thresholds,
      production_surfaces: [...PRODUCTION_SURFACES],
    },
    generated_at: new Date().toISOString(),
  };
}

export { DEFAULT_CLOSURE_THRESHOLDS, PRODUCTION_SURFACES };
