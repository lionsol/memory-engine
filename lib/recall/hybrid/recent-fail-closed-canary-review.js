const DEFAULT_RECENT_CANARY_REVIEW_THRESHOLDS = Object.freeze({
  minimum_applied_events: 50,
  max_empty_candidate_rate: 0.01,
  max_candidate_loss_ratio: 0.05,
  max_high_risk_events: 0,
  max_medium_risk_events: 0,
  max_scope_mismatch_rate: 0.05,
});

const RISK_LEVELS = new Set(["low", "medium", "high"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asObject(value) {
  return isObject(value) ? value : {};
}

function sourceFor(input, key) {
  const report = asObject(input);
  const nested = report.recent_fail_closed_canary_runtime;
  if (isObject(nested) && Object.hasOwn(nested, key)) return { value: nested[key], present: true };
  return { value: report[key], present: Object.hasOwn(report, key) };
}

function shadowValue(input, key, aliases = []) {
  const report = asObject(input);
  const nested = report.recent_fail_closed_shadow;
  const sources = [isObject(nested) ? nested : null, report];
  for (const source of sources) {
    if (!source) continue;
    for (const name of [key, ...aliases]) {
      if (Object.hasOwn(source, name)) return { value: source[name], present: true };
    }
  }
  return { value: undefined, present: false };
}

function numericField(source, { integer = false, ratio = false } = {}) {
  if (!source.present) return { value: null, valid: true, present: false };
  const value = source.value;
  const valid = typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && (!integer || Number.isInteger(value))
    && (!ratio || value <= 1);
  return { value: valid ? value : null, valid, present: true };
}

function addIssue(list, code, actual, threshold) {
  const issue = { code };
  if (actual !== undefined) issue.actual = actual;
  if (threshold !== undefined) issue.threshold = threshold;
  if (!list.some(item => item.code === code)) list.push(issue);
}

function normalizeThresholds(input = {}) {
  const values = { ...DEFAULT_RECENT_CANARY_REVIEW_THRESHOLDS, ...asObject(input) };
  const thresholds = {};
  const invalid = [];
  for (const [key, value] of Object.entries(values)) {
    const number = value;
    const isRatio = key.includes("ratio");
    if (typeof number !== "number"
      || !Number.isFinite(number)
      || number < 0
      || (isRatio && number > 1)) invalid.push(key);
    thresholds[key] = number;
  }
  return { thresholds, invalid };
}

function normalizeRuntimeMetrics(input) {
  const report = asObject(input);
  const nested = report.recent_fail_closed_canary_runtime;
  const invalidSource = input !== undefined && input !== null && !isObject(input);
  const invalidNested = nested !== undefined && !isObject(nested);
  const fields = [
    "enabled_events",
    "scope_match_events",
    "applied_events",
    "suppressed_fallback_events",
    "empty_candidate_events",
  ];
  const values = {};
  let present = false;
  let invalid = invalidSource || invalidNested;
  for (const key of fields) {
    const field = sourceFor(input, key);
    const normalized = numericField(field, { integer: true });
    values[key] = normalized.value;
    present ||= normalized.present;
    invalid ||= !normalized.valid;
  }
  return { ...values, present, invalid };
}

function normalizeShadowMetrics(input) {
  const report = asObject(input);
  const nested = report.recent_fail_closed_shadow;
  const invalidSource = input !== undefined && input !== null && !isObject(input);
  const invalidNested = nested !== undefined && !isObject(nested);
  let invalid = invalidSource || invalidNested;
  let present = false;
  const values = {};
  const fields = [
    ["evaluated_events", ["events"]],
    ["max_candidate_loss_ratio", []],
    ["high_risk_events", []],
    ["medium_risk_events", []],
    ["low_risk_events", []],
  ];
  for (const [key, aliases] of fields) {
    const field = shadowValue(input, key, aliases);
    const normalized = numericField(field, { integer: key !== "max_candidate_loss_ratio", ratio: key === "max_candidate_loss_ratio" });
    values[key] = normalized.value;
    present ||= normalized.present;
    invalid ||= !normalized.valid;
  }

  const distributionSource = shadowValue(input, "risk_level_distribution");
  if (distributionSource.present) {
    present = true;
    if (!isObject(distributionSource.value)) {
      invalid = true;
    } else {
      for (const [level, value] of Object.entries(distributionSource.value)) {
        if (!RISK_LEVELS.has(level)) {
          invalid = true;
          continue;
        }
        const normalized = numericField({ value, present: true }, { integer: true });
        if (!normalized.valid) invalid = true;
        if (!Object.hasOwn(asObject(input), `${level}_risk_events`)
          && (!isObject(nested) || !Object.hasOwn(nested, `${level}_risk_events`))) {
          values[`${level}_risk_events`] = normalized.value;
        }
      }
    }
  }

  return { ...values, present, invalid };
}

function buildEvidence(runtime, shadow, rates) {
  return {
    runtime: {
      enabled_events: runtime.enabled_events,
      scope_match_events: runtime.scope_match_events,
      applied_events: runtime.applied_events,
      suppressed_fallback_events: runtime.suppressed_fallback_events,
      empty_candidate_events: runtime.empty_candidate_events,
      empty_candidate_rate: rates.empty_candidate_rate,
      scope_mismatch_rate: rates.scope_mismatch_rate,
    },
    shadow: {
      evaluated_events: shadow.evaluated_events,
      max_candidate_loss_ratio: shadow.max_candidate_loss_ratio,
      high_risk_events: shadow.high_risk_events,
      medium_risk_events: shadow.medium_risk_events,
      low_risk_events: shadow.low_risk_events,
    },
  };
}

export function evaluateRecentFailClosedCanaryReview({
  runtimeMetrics = {},
  shadowMetrics = {},
  thresholds: thresholdInput = {},
} = {}) {
  const { thresholds, invalid: invalidThresholds } = normalizeThresholds(thresholdInput);
  const runtime = normalizeRuntimeMetrics(runtimeMetrics);
  const shadow = normalizeShadowMetrics(shadowMetrics);
  const blockers = [];
  const evidenceGaps = [];
  const warnings = [];

  if (invalidThresholds.length > 0) addIssue(blockers, "invalid_thresholds", invalidThresholds);
  if (runtime.invalid) addIssue(blockers, "invalid_runtime_metrics");
  if (shadow.invalid) addIssue(blockers, "invalid_shadow_metrics");

  const enabled = runtime.enabled_events;
  const scopeMatch = runtime.scope_match_events;
  const applied = runtime.applied_events;
  const suppressed = runtime.suppressed_fallback_events;
  const empty = runtime.empty_candidate_events;
  const scopeMismatchRate = enabled > 0 && scopeMatch !== null
    ? (enabled - scopeMatch) / enabled
    : null;
  const emptyCandidateRate = applied > 0 && empty !== null ? empty / applied : null;
  const rates = {
    empty_candidate_rate: emptyCandidateRate,
    scope_mismatch_rate: scopeMismatchRate,
  };

  if (runtime.present && !runtime.invalid) {
    if (enabled !== null && scopeMatch !== null && scopeMatch > enabled) {
      addIssue(blockers, "invalid_runtime_metrics");
    }
    if (enabled !== null && applied !== null && applied > enabled) {
      addIssue(blockers, "runtime_telemetry_inconsistent");
    }
    if (scopeMatch !== null && applied !== null && applied > scopeMatch) {
      addIssue(blockers, "runtime_telemetry_inconsistent");
    }
    if (empty !== null && applied !== null && empty > applied) {
      addIssue(blockers, "invalid_runtime_metrics");
    }
    if ((applied > 0 && suppressed === 0) || (suppressed > 0 && applied === 0)
      || (applied > 0 && suppressed > 0 && applied !== suppressed)) {
      addIssue(blockers, "runtime_telemetry_inconsistent");
    }
  }

  if (scopeMismatchRate !== null && scopeMismatchRate > thresholds.max_scope_mismatch_rate) {
    addIssue(blockers, "scope_mismatch_rate_exceeded", scopeMismatchRate, thresholds.max_scope_mismatch_rate);
  }
  if (emptyCandidateRate !== null && emptyCandidateRate > thresholds.max_empty_candidate_rate) {
    addIssue(blockers, "empty_candidate_rate_exceeded", emptyCandidateRate, thresholds.max_empty_candidate_rate);
  }
  if (shadow.max_candidate_loss_ratio !== null
    && shadow.max_candidate_loss_ratio > thresholds.max_candidate_loss_ratio) {
    addIssue(blockers, "candidate_loss_ratio_exceeded", shadow.max_candidate_loss_ratio, thresholds.max_candidate_loss_ratio);
  }
  if (shadow.high_risk_events !== null && shadow.high_risk_events > thresholds.max_high_risk_events) {
    addIssue(blockers, "high_risk_events_exceeded", shadow.high_risk_events, thresholds.max_high_risk_events);
  }
  if (shadow.medium_risk_events !== null && shadow.medium_risk_events > thresholds.max_medium_risk_events) {
    addIssue(blockers, "medium_risk_events_exceeded", shadow.medium_risk_events, thresholds.max_medium_risk_events);
  }

  if (!runtime.present) addIssue(evidenceGaps, "missing_runtime_telemetry");
  else if ([enabled, scopeMatch, applied, suppressed, empty].some(value => value === null)) {
    addIssue(evidenceGaps, "missing_runtime_telemetry");
  }
  if (!shadow.present) addIssue(evidenceGaps, "missing_shadow_telemetry");
  if (shadow.evaluated_events === null || shadow.evaluated_events === 0) {
    addIssue(evidenceGaps, "missing_shadow_observations");
  }
  if (shadow.present && shadow.max_candidate_loss_ratio === null) {
    addIssue(evidenceGaps, "missing_shadow_telemetry");
  }
  if (applied === null || applied < thresholds.minimum_applied_events) {
    addIssue(evidenceGaps, "insufficient_applied_events", applied, thresholds.minimum_applied_events);
  }
  if (enabled !== null && enabled > 0 && (scopeMatch === null || scopeMatch < thresholds.minimum_applied_events)) {
    addIssue(evidenceGaps, "insufficient_scope_match_events", scopeMatch, thresholds.minimum_applied_events);
  }

  if (scopeMismatchRate !== null && scopeMismatchRate > 0) warnings.push("scope_mismatch_observed");
  if (emptyCandidateRate !== null && emptyCandidateRate > 0) warnings.push("empty_candidates_observed");
  if (shadow.max_candidate_loss_ratio !== null && shadow.max_candidate_loss_ratio > 0) {
    warnings.push("candidate_loss_observed");
  }

  let status = "healthy";
  let recommendation = "continue_canary";
  if (blockers.length > 0) {
    status = "rollback_required";
    recommendation = "rollback";
  } else if (evidenceGaps.length > 0) {
    status = "insufficient_data";
    recommendation = "collect_more_data";
  }

  return {
    schema_version: 1,
    status,
    recommendation,
    blockers,
    evidence_gaps: evidenceGaps,
    warnings,
    evidence: buildEvidence(runtime, shadow, rates),
    thresholds,
  };
}

export { DEFAULT_RECENT_CANARY_REVIEW_THRESHOLDS };
