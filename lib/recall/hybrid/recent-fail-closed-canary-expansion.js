const DEFAULT_RECENT_CANARY_EXPANSION_THRESHOLDS = Object.freeze({
  minimum_applied_events: 500,
  minimum_window_days: 30,
  max_candidate_loss_ratio: 0.02,
  max_empty_candidate_rate: 0.005,
  max_scope_mismatch_rate: 0,
  required_stable_reviews: 3,
});

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asObject(value) {
  return isObject(value) ? value : {};
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegative(value) {
  const number = numeric(value);
  return number !== null && number >= 0 ? number : null;
}

function ratio(value) {
  const number = numeric(value);
  return number !== null && number >= 0 && number <= 1 ? number : null;
}

function addIssue(list, code, actual, threshold) {
  const issue = { code };
  if (actual !== undefined) issue.actual = actual;
  if (threshold !== undefined) issue.threshold = threshold;
  if (!list.some(item => item.code === code)) list.push(issue);
}

function normalizeThresholds(input = {}) {
  const values = { ...DEFAULT_RECENT_CANARY_EXPANSION_THRESHOLDS, ...asObject(input) };
  const thresholds = {};
  const invalid = [];
  for (const [key, value] of Object.entries(values)) {
    const normalized = numeric(value);
    const valid = normalized !== null
      && normalized >= 0
      && (!key.includes("ratio") && !key.includes("rate") || normalized <= 1);
    if (!valid) invalid.push(key);
    thresholds[key] = normalized;
  }
  return { thresholds, invalid };
}

function readNested(report, sections, keys) {
  const root = asObject(report);
  for (const section of sections) {
    const value = root[section];
    if (!isObject(value)) continue;
    for (const key of keys) {
      if (Object.hasOwn(value, key)) return value[key];
    }
  }
  for (const key of keys) {
    if (Object.hasOwn(root, key)) return root[key];
  }
  return undefined;
}

function normalizeRolloutMetrics(input, review = {}) {
  const report = asObject(input);
  const reviewEvidence = asObject(asObject(review).evidence);
  const runtimeEvidence = asObject(reviewEvidence.runtime);
  const shadowEvidence = asObject(reviewEvidence.shadow);
  const windowEvidence = asObject(asObject(reviewEvidence.window));

  const appliedEvents = firstDefined(
    readNested(report, ["recent_fail_closed_canary_runtime", "runtime"], ["applied_events"]),
    runtimeEvidence.applied_events,
  );
  const windowDays = firstDefined(
    readNested(report, ["evidence_window", "window"], ["window_days", "duration_days"]),
    windowEvidence.duration_days,
  );
  const lossRatio = firstDefined(
    readNested(report, ["recent_fail_closed_shadow", "shadow"], ["max_candidate_loss_ratio", "candidate_loss_ratio"]),
    shadowEvidence.max_candidate_loss_ratio,
  );
  const emptyRate = firstDefined(
    readNested(report, ["recent_fail_closed_canary_runtime", "runtime"], ["empty_candidate_rate"]),
    runtimeEvidence.empty_candidate_rate,
  );
  const scopeMismatchRate = firstDefined(
    readNested(report, ["recent_fail_closed_canary_runtime", "runtime"], ["scope_mismatch_rate"]),
    runtimeEvidence.scope_mismatch_rate,
  );
  const highRiskEvents = firstDefined(
    readNested(report, ["recent_fail_closed_shadow", "shadow"], ["high_risk_events"]),
    shadowEvidence.high_risk_events,
  );
  const mediumRiskEvents = firstDefined(
    readNested(report, ["recent_fail_closed_shadow", "shadow"], ["medium_risk_events"]),
    shadowEvidence.medium_risk_events,
  );
  const stableReviews = firstDefined(
    readNested(report, ["rollout", "review"], ["stable_reviews", "stable_review_count"]),
    0,
  );

  const values = {
    applied_events: nonNegative(appliedEvents),
    window_days: nonNegative(windowDays),
    candidate_loss_ratio: ratio(lossRatio),
    empty_candidate_rate: ratio(emptyRate),
    scope_mismatch_rate: ratio(scopeMismatchRate),
    high_risk_events: nonNegative(highRiskEvents),
    medium_risk_events: nonNegative(mediumRiskEvents),
    stable_reviews: nonNegative(stableReviews),
  };
  const supplied = {
    applied_events: appliedEvents !== undefined,
    window_days: windowDays !== undefined,
    candidate_loss_ratio: lossRatio !== undefined,
    empty_candidate_rate: emptyRate !== undefined,
    scope_mismatch_rate: scopeMismatchRate !== undefined,
    high_risk_events: highRiskEvents !== undefined,
    medium_risk_events: mediumRiskEvents !== undefined,
    stable_reviews: stableReviews !== undefined,
  };
  const invalid = Object.entries(values).some(([key, value]) => supplied[key] && value === null);
  return { ...values, supplied, invalid };
}

function readinessClass(readiness) {
  return asObject(asObject(readiness).decision).class || null;
}

function reviewStatus(review) {
  return asObject(review).status || null;
}

function buildEvidence(metrics, readiness, review) {
  return {
    applied_events: metrics.applied_events,
    window_days: metrics.window_days,
    candidate_loss_ratio: metrics.candidate_loss_ratio,
    empty_candidate_rate: metrics.empty_candidate_rate,
    scope_mismatch_rate: metrics.scope_mismatch_rate,
    high_risk_events: metrics.high_risk_events,
    medium_risk_events: metrics.medium_risk_events,
    stable_reviews: metrics.stable_reviews,
    readiness: readinessClass(readiness),
    review: reviewStatus(review),
  };
}

export function evaluateRecentFailClosedCanaryExpansion({
  readiness = {},
  review = {},
  rolloutMetrics = {},
  thresholds: thresholdInput = {},
} = {}) {
  const { thresholds, invalid: invalidThresholds } = normalizeThresholds(thresholdInput);
  const metrics = normalizeRolloutMetrics(rolloutMetrics, review);
  const blockers = [];
  const evidenceGaps = [];
  const reviewValue = reviewStatus(review);
  const readinessValue = readinessClass(readiness);

  if (invalidThresholds.length > 0) addIssue(blockers, "invalid_thresholds", invalidThresholds);
  if (metrics.invalid) addIssue(blockers, "invalid_rollout_metrics");

  const reviewBlockers = Array.isArray(asObject(review).blockers) ? asObject(review).blockers : [];
  if (reviewValue === "rollback_required" || reviewBlockers.length > 0) {
    addIssue(blockers, "recent_canary_review_rollback_required");
  }
  if (reviewValue !== null && !["healthy", "insufficient_data", "rollback_required"].includes(reviewValue)) {
    addIssue(evidenceGaps, "invalid_review_status");
  }
  if (readinessValue === null) addIssue(evidenceGaps, "missing_readiness_evidence");

  if (metrics.high_risk_events !== null && metrics.high_risk_events > 0) {
    addIssue(blockers, "high_risk_events_present", metrics.high_risk_events, 0);
  }
  if (metrics.medium_risk_events !== null && metrics.medium_risk_events > 0) {
    addIssue(blockers, "medium_risk_events_present", metrics.medium_risk_events, 0);
  }
  if (metrics.candidate_loss_ratio !== null
    && metrics.candidate_loss_ratio > thresholds.max_candidate_loss_ratio) {
    addIssue(blockers, "candidate_loss_ratio_exceeded", metrics.candidate_loss_ratio, thresholds.max_candidate_loss_ratio);
  }
  if (metrics.empty_candidate_rate !== null
    && metrics.empty_candidate_rate > thresholds.max_empty_candidate_rate) {
    addIssue(blockers, "empty_candidate_rate_exceeded", metrics.empty_candidate_rate, thresholds.max_empty_candidate_rate);
  }
  if (!metrics.supplied.applied_events || metrics.applied_events === null
    || metrics.applied_events < thresholds.minimum_applied_events) {
    addIssue(evidenceGaps, "applied_events_below_expansion_threshold", metrics.applied_events, thresholds.minimum_applied_events);
  }
  if (!metrics.supplied.window_days || metrics.window_days === null
    || metrics.window_days < thresholds.minimum_window_days) {
    addIssue(evidenceGaps, "evidence_window_below_expansion_threshold", metrics.window_days, thresholds.minimum_window_days);
  }
  if (!metrics.supplied.candidate_loss_ratio) addIssue(evidenceGaps, "candidate_loss_telemetry_missing");
  if (!metrics.supplied.empty_candidate_rate) addIssue(evidenceGaps, "empty_candidate_telemetry_missing");
  if (!metrics.supplied.scope_mismatch_rate) addIssue(evidenceGaps, "scope_mismatch_telemetry_missing");
  if (!metrics.supplied.high_risk_events || !metrics.supplied.medium_risk_events) {
    addIssue(evidenceGaps, "risk_telemetry_missing");
  }
  if (reviewValue === "insufficient_data") addIssue(evidenceGaps, "review_insufficient_data");
  if (readinessValue !== "ready_for_canary") addIssue(evidenceGaps, "readiness_not_ready_for_canary");

  const scopeMismatchPreventsExpansion = metrics.scope_mismatch_rate !== null
    && metrics.scope_mismatch_rate > thresholds.max_scope_mismatch_rate;
  const canExpand = blockers.length === 0
    && evidenceGaps.length === 0
    && !scopeMismatchPreventsExpansion
    && metrics.stable_reviews >= thresholds.required_stable_reviews;
  const stableReviewsShort = metrics.stable_reviews < thresholds.required_stable_reviews;
  if (blockers.length > 0) {
    return {
      schema_version: 1,
      decision: "rollback",
      blockers,
      evidence_gaps: evidenceGaps,
      evidence: buildEvidence(metrics, readiness, review),
      thresholds,
    };
  }

  if (evidenceGaps.length > 0) {
    return {
      schema_version: 1,
      decision: "insufficient_data",
      blockers,
      evidence_gaps: evidenceGaps,
      evidence: buildEvidence(metrics, readiness, review),
      thresholds,
    };
  }

  if (stableReviewsShort || scopeMismatchPreventsExpansion) {
    return {
      schema_version: 1,
      decision: "continue_current_canary",
      blockers,
      evidence_gaps: evidenceGaps,
      evidence: buildEvidence(metrics, readiness, review),
      thresholds,
    };
  }

  return {
    schema_version: 1,
    decision: canExpand ? "expand" : "continue_current_canary",
    blockers,
    evidence_gaps: canExpand ? evidenceGaps : [...evidenceGaps, { code: "expansion_requirements_not_satisfied" }],
    evidence: buildEvidence(metrics, readiness, review),
    thresholds,
  };
}

export { DEFAULT_RECENT_CANARY_EXPANSION_THRESHOLDS };
