const DEFAULT_RECENT_CANARY_THRESHOLDS = Object.freeze({
  minimum_window_days: 14,
  minimum_observations: 100,
  minimum_surface_observations: 20,
  max_candidate_loss_ratio: 0.05,
  max_high_risk_events: 0,
  max_medium_risk_events: 0,
});

const PRODUCTION_SURFACES = Object.freeze([
  "auto_recall",
  "memory_engine_action_search",
  "memory_engine_search",
]);

const VALID_RISK_LEVELS = new Set(["low", "medium", "high"]);

function asNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function asNullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function pushUnique(values, value) {
  if (typeof value === "string" && value && !values.includes(value)) values.push(value);
}

function resolveThresholds(input = {}) {
  const merged = {
    ...DEFAULT_RECENT_CANARY_THRESHOLDS,
    ...asObject(input),
  };
  return {
    minimum_window_days: asNonNegativeNumber(
      merged.minimum_window_days,
      DEFAULT_RECENT_CANARY_THRESHOLDS.minimum_window_days,
    ),
    minimum_observations: asNonNegativeNumber(
      merged.minimum_observations,
      DEFAULT_RECENT_CANARY_THRESHOLDS.minimum_observations,
    ),
    minimum_surface_observations: asNonNegativeNumber(
      merged.minimum_surface_observations,
      DEFAULT_RECENT_CANARY_THRESHOLDS.minimum_surface_observations,
    ),
    max_candidate_loss_ratio: asNonNegativeNumber(
      merged.max_candidate_loss_ratio,
      DEFAULT_RECENT_CANARY_THRESHOLDS.max_candidate_loss_ratio,
    ),
    max_high_risk_events: asNonNegativeNumber(
      merged.max_high_risk_events,
      DEFAULT_RECENT_CANARY_THRESHOLDS.max_high_risk_events,
    ),
    max_medium_risk_events: asNonNegativeNumber(
      merged.max_medium_risk_events,
      DEFAULT_RECENT_CANARY_THRESHOLDS.max_medium_risk_events,
    ),
  };
}

function normalizeWindow(evidenceWindow) {
  const report = asObject(evidenceWindow);
  const window = asObject(report.window);
  const counts = asObject(report.counts);
  const productionBySurface = asObject(
    counts.production_by_surface || report.production_observed_by_surface,
  );
  const durationDays = asNullableNumber(
    window.duration_days ?? report.observation_window_days ?? report.window_days,
  );
  const productionEvents = asNullableNumber(
    counts.production_events ?? report.observed_hybrid_events,
  );
  const unknownSurfaceEvents = asNullableNumber(
    counts.unknown_surface_events ?? report.unknown_surface_events,
  );
  const unsupportedSchemaVersionEvents = asNullableNumber(
    counts.unsupported_schema_version_events ?? report.unsupported_schema_version_events,
  );
  const invalidObservationEvents = asNullableNumber(
    counts.invalid_observation_events ?? report.invalid_observation_events,
  );
  const blockers = Array.isArray(report.blockers) ? report.blockers.filter(value => typeof value === "string") : [];
  const gaps = Array.isArray(report.gaps) ? report.gaps.filter(value => typeof value === "string") : [];

  return {
    first_observed_at: window.first_observed_at ?? report.first_observed_at ?? null,
    last_observed_at: window.last_observed_at ?? report.last_observed_at ?? null,
    duration_days: durationDays,
    production_events: productionEvents,
    production_by_surface: productionBySurface,
    unknown_surface_events: unknownSurfaceEvents,
    unsupported_schema_version_events: unsupportedSchemaVersionEvents,
    invalid_observation_events: invalidObservationEvents,
    blockers,
    gaps,
    decision: typeof report.decision === "string" ? report.decision : null,
  };
}

function normalizeRiskDistribution(shadow) {
  const raw = shadow.risk_level_distribution;
  if (raw === undefined || raw === null) return { status: "missing", counts: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { status: "invalid", counts: {} };
  }

  const counts = {};
  for (const [level, value] of Object.entries(raw)) {
    if (!VALID_RISK_LEVELS.has(level)) return { status: "invalid", counts: {} };
    const count = Number(value);
    if (!Number.isFinite(count) || count < 0) return { status: "invalid", counts: {} };
    counts[level] = count;
  }
  return { status: "valid", counts };
}

function normalizeShadowMetrics(input) {
  const report = asObject(input);
  const shadow = asObject(report.recent_fail_closed_shadow || report);
  const events = asNullableNumber(shadow.events);
  const maxCandidateLossRatio = asNullableNumber(shadow.max_candidate_loss_ratio);
  const riskDistribution = normalizeRiskDistribution(shadow);
  const suppressionEvents = asNonNegativeNumber(
    shadow.suppressed_fallback_events
      ?? shadow.recent_fail_closed_fallback_suppressed_events
      ?? shadow.recent_fail_closed_suppressed_events,
  );
  const appliedEvents = asNonNegativeNumber(
    shadow.recent_fail_closed_applied_events ?? shadow.applied_events,
  );

  return {
    events,
    would_fail_closed_events: asNonNegativeNumber(shadow.would_fail_closed_events),
    average_candidate_loss_ratio: asNullableNumber(shadow.average_candidate_loss_ratio),
    max_candidate_loss_ratio: maxCandidateLossRatio,
    risk_level_distribution: riskDistribution.counts,
    high_risk_events: riskDistribution.counts.high || 0,
    medium_risk_events: riskDistribution.counts.medium || 0,
    low_risk_events: riskDistribution.counts.low || 0,
    risk_status: riskDistribution.status,
    suppression_events: suppressionEvents,
    applied_events: appliedEvents,
  };
}

function buildEvidence(window, shadow) {
  return {
    window: {
      first_observed_at: window.first_observed_at,
      last_observed_at: window.last_observed_at,
      duration_days: window.duration_days,
      production_events: window.production_events,
      production_by_surface: window.production_by_surface,
    },
    shadow: {
      events: shadow.events,
      would_fail_closed_events: shadow.would_fail_closed_events,
      average_candidate_loss_ratio: shadow.average_candidate_loss_ratio,
      max_candidate_loss_ratio: shadow.max_candidate_loss_ratio,
      risk_level_distribution: shadow.risk_level_distribution,
      high_risk_events: shadow.high_risk_events,
      medium_risk_events: shadow.medium_risk_events,
      suppression_events: shadow.suppression_events,
      applied_events: shadow.applied_events,
    },
  };
}

export function evaluateRecentFailClosedCanaryReadiness({
  evidenceWindow = {},
  shadowMetrics = {},
  thresholds: inputThresholds = {},
} = {}) {
  const thresholds = resolveThresholds(inputThresholds);
  const window = normalizeWindow(evidenceWindow);
  const shadow = normalizeShadowMetrics(shadowMetrics);
  const blockers = [];
  const evidenceGaps = [];

  for (const blocker of window.blockers) pushUnique(blockers, blocker);
  if (window.decision === "blocked" && window.blockers.length === 0) {
    pushUnique(blockers, "evidence_window_blocked");
  }
  if ((window.unknown_surface_events ?? 0) > 0) pushUnique(blockers, "unknown_surface_events_present");
  if ((window.unsupported_schema_version_events ?? 0) > 0) {
    pushUnique(blockers, "unsupported_schema_version_events_present");
  }
  if ((window.invalid_observation_events ?? 0) > 0) pushUnique(blockers, "invalid_observation_format");
  if (shadow.suppression_events > 0 || shadow.applied_events > 0) {
    pushUnique(blockers, "unexpected_recent_fail_closed_suppression");
  }
  if (shadow.risk_status === "invalid") pushUnique(blockers, "invalid_recent_shadow_risk_state");
  if (shadow.high_risk_events > thresholds.max_high_risk_events) {
    pushUnique(blockers, "recent_shadow_high_risk_present");
  }
  if (shadow.medium_risk_events > thresholds.max_medium_risk_events) {
    pushUnique(blockers, "recent_shadow_medium_risk_present");
  }
  if (shadow.max_candidate_loss_ratio !== null
    && shadow.max_candidate_loss_ratio > thresholds.max_candidate_loss_ratio) {
    pushUnique(blockers, "recent_shadow_candidate_loss_above_threshold");
  }

  for (const gap of window.gaps) pushUnique(evidenceGaps, gap);
  if (window.decision === "insufficient_evidence" && window.gaps.length === 0) {
    pushUnique(evidenceGaps, "evidence_window_insufficient");
  }
  if (window.production_events === null || window.production_events === 0) {
    pushUnique(evidenceGaps, "production_observations_missing");
  } else if (window.production_events < thresholds.minimum_observations) {
    pushUnique(evidenceGaps, "production_observations_below_threshold");
  }
  for (const surface of PRODUCTION_SURFACES) {
    const count = asNonNegativeNumber(window.production_by_surface[surface]);
    if (count < thresholds.minimum_surface_observations) {
      pushUnique(evidenceGaps, `surface_observations_below_threshold:${surface}`);
    }
  }
  if (window.duration_days === null || window.duration_days < thresholds.minimum_window_days) {
    pushUnique(evidenceGaps, "observation_window_below_threshold");
  }
  if (shadow.events === null || shadow.events === 0) {
    pushUnique(evidenceGaps, "recent_shadow_telemetry_missing");
  } else {
    if (shadow.max_candidate_loss_ratio === null) pushUnique(evidenceGaps, "recent_shadow_loss_telemetry_missing");
    if (shadow.risk_status === "missing") pushUnique(evidenceGaps, "recent_shadow_risk_telemetry_missing");
  }

  let decisionClass = "blocked";
  if (blockers.length === 0) {
    decisionClass = evidenceGaps.length === 0 ? "ready_for_canary" : "insufficient_evidence";
  }

  return {
    schema_version: 1,
    decision: {
      class: decisionClass,
      reason: blockers[0] || evidenceGaps[0] || "all_recent_canary_requirements_satisfied",
    },
    blockers,
    evidence_gaps: evidenceGaps,
    evidence: buildEvidence(window, shadow),
    thresholds: {
      ...thresholds,
      production_surfaces: [...PRODUCTION_SURFACES],
    },
    generated_at: new Date().toISOString(),
  };
}

export { DEFAULT_RECENT_CANARY_THRESHOLDS, PRODUCTION_SURFACES };
