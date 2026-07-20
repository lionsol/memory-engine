import { canonicalIsoTimestamp } from "./hybrid-observation-provenance.js";

export const DEFAULT_AUTO_RECALL_PRODUCT_HEALTH_THRESHOLDS = Object.freeze({
  window_hours: 24,
  maximum_incomplete_trace_count: 0,
  maximum_error_or_timeout_count: 0,
  maximum_injected_without_allowed_gate_count: 0,
  maximum_disallowed_reinforcement_injected_count: 0,
  maximum_hard_denied_artifact_injected_count: 0,
  maximum_p95_latency_ms: 3000,
  maximum_max_latency_ms: 4000,
  maximum_quality_review_age_hours: 72,
  minimum_quality_sample_size: 30,
  maximum_irrelevant_injection_rate: 0.1,
  maximum_severe_irrelevant_or_context_conflict_count: 0,
  maximum_user_reported_bad_injection_count: 0,
});

const INTEGER_THRESHOLD_KEYS = new Set([
  "maximum_incomplete_trace_count",
  "maximum_error_or_timeout_count",
  "maximum_injected_without_allowed_gate_count",
  "maximum_disallowed_reinforcement_injected_count",
  "maximum_hard_denied_artifact_injected_count",
  "minimum_quality_sample_size",
  "maximum_severe_irrelevant_or_context_conflict_count",
  "maximum_user_reported_bad_injection_count",
]);

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function safeMetadata(value) {
  if (isPlainObject(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function timestampMs(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(value => typeof value === "string" && value))];
}

function percentile95(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function normalizeThresholds(input) {
  if (input === undefined) return { valid: true, thresholds: { ...DEFAULT_AUTO_RECALL_PRODUCT_HEALTH_THRESHOLDS }, errors: [] };
  if (!isPlainObject(input)) return { valid: false, thresholds: { ...DEFAULT_AUTO_RECALL_PRODUCT_HEALTH_THRESHOLDS }, errors: ["invalid_thresholds"] };
  const errors = [];
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(DEFAULT_AUTO_RECALL_PRODUCT_HEALTH_THRESHOLDS, key)) {
      errors.push(`unknown_threshold:${key}`);
      continue;
    }
    const invalidInteger = INTEGER_THRESHOLD_KEYS.has(key) && !Number.isInteger(value);
    const invalidRatio = key === "maximum_irrelevant_injection_rate" && value > 1;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || invalidInteger || invalidRatio) {
      errors.push(`invalid_threshold:${key}`);
    }
  }
  return {
    valid: errors.length === 0,
    thresholds: { ...DEFAULT_AUTO_RECALL_PRODUCT_HEALTH_THRESHOLDS, ...input },
    errors,
  };
}

function validateQualityReview(review, checkedAtMs, thresholds, availableInjectionKeys = []) {
  const blockers = [];
  if (!isPlainObject(review)) return { valid: false, status: "missing", blockers: ["quality_review_missing"], metrics: null };
  if (review.schema_version !== 1) blockers.push("quality_review_schema_invalid");
  const reviewedAt = canonicalIsoTimestamp(review.reviewed_at);
  if (!reviewedAt) blockers.push("quality_review_timestamp_invalid");
  for (const key of [
    "sample_size",
    "irrelevant_count",
    "severe_irrelevant_or_context_conflict_count",
    "user_reported_bad_injection_count",
  ]) {
    if (!Number.isInteger(review[key]) || review[key] < 0) blockers.push(`quality_review_field_invalid:${key}`);
  }
  const sampledKeys = Array.isArray(review.sampled_injection_keys)
    ? review.sampled_injection_keys
    : null;
  if (!sampledKeys) blockers.push("quality_review_sampled_injection_keys_missing");
  else {
    if (sampledKeys.some(key => typeof key !== "string" || !key.trim() || key.trim() !== key)) {
      blockers.push("quality_review_sampled_injection_keys_invalid");
    }
    if (new Set(sampledKeys).size !== sampledKeys.length) blockers.push("quality_review_sampled_injection_keys_duplicate");
    if (Number.isInteger(review.sample_size) && sampledKeys.length !== review.sample_size) {
      blockers.push("quality_review_sampled_injection_keys_count_mismatch");
    }
  }
  if (Number.isInteger(review.sample_size)) {
    for (const key of ["irrelevant_count", "severe_irrelevant_or_context_conflict_count"]) {
      if (Number.isInteger(review[key]) && review[key] > review.sample_size) blockers.push(`quality_review_count_exceeds_sample:${key}`);
    }
  }
  if (blockers.length > 0) return { valid: false, status: "invalid", blockers, metrics: null };

  const availableKeys = uniqueStrings(availableInjectionKeys);
  const availableSet = new Set(availableKeys);
  const requiredSampleSize = Math.min(thresholds.minimum_quality_sample_size, availableKeys.length);
  const requiredKeys = availableKeys.slice(0, requiredSampleSize);
  const sampledSet = new Set(sampledKeys);
  const ageHours = Number(((checkedAtMs - Date.parse(reviewedAt)) / 3_600_000).toFixed(6));
  if (ageHours < 0) blockers.push("quality_review_from_future");
  if (ageHours > thresholds.maximum_quality_review_age_hours) blockers.push("quality_review_stale");
  if (review.sample_size < requiredSampleSize) blockers.push("quality_review_sample_below_threshold");
  if (review.sample_size > availableKeys.length) blockers.push("quality_review_sample_exceeds_available_injections");
  if (sampledKeys.some(key => !availableSet.has(key))) blockers.push("quality_review_sample_contains_unknown_injection");
  if (requiredKeys.some(key => !sampledSet.has(key))) blockers.push("quality_review_required_recent_sample_missing");
  const irrelevantRate = review.sample_size > 0 ? review.irrelevant_count / review.sample_size : 0;
  if (irrelevantRate > thresholds.maximum_irrelevant_injection_rate) {
    blockers.push("irrelevant_injection_rate_above_threshold");
  }
  if (review.severe_irrelevant_or_context_conflict_count > thresholds.maximum_severe_irrelevant_or_context_conflict_count) {
    blockers.push("severe_irrelevant_or_context_conflict_present");
  }
  if (review.user_reported_bad_injection_count > thresholds.maximum_user_reported_bad_injection_count) {
    blockers.push("user_reported_bad_injection_present");
  }
  return {
    valid: true,
    status: blockers.length === 0 ? "healthy" : "unhealthy",
    blockers,
    metrics: {
      reviewed_at: reviewedAt,
      review_age_hours: ageHours,
      sample_size: review.sample_size,
      sampled_injection_keys: [...sampledKeys],
      available_injection_count: availableKeys.length,
      required_sample_size: requiredSampleSize,
      required_recent_injection_keys: requiredKeys,
      irrelevant_count: review.irrelevant_count,
      irrelevant_injection_rate: Number(irrelevantRate.toFixed(6)),
      severe_irrelevant_or_context_conflict_count: review.severe_irrelevant_or_context_conflict_count,
      user_reported_bad_injection_count: review.user_reported_bad_injection_count,
    },
  };
}

function includesHardDeniedArtifact(value) {
  const text = String(value || "").toLowerCase();
  return text.includes("suspected_tool_output")
    || text.includes("dreaming_artifact")
    || text.includes("dreaming_maintenance_log")
    || text.includes("dreaming_candidate_staging");
}

export function buildAutoRecallProductHealthReport({
  events = [],
  qualityReview,
  thresholds: thresholdInput,
  checkedAt = new Date().toISOString(),
} = {}) {
  const checkedAtIso = canonicalIsoTimestamp(checkedAt);
  if (!checkedAtIso) throw new TypeError("checkedAt must be a canonical UTC ISO timestamp");
  const checkedAtMs = Date.parse(checkedAtIso);
  const thresholdValidation = normalizeThresholds(thresholdInput);
  const thresholds = thresholdValidation.thresholds;
  const blockers = [...thresholdValidation.errors];
  if (!Array.isArray(events)) blockers.push("events_invalid");

  const windowStartMs = checkedAtMs - thresholds.window_hours * 3_600_000;
  const rows = (Array.isArray(events) ? events : [])
    .map(row => ({ row, metadata: safeMetadata(row?.metadata_json), timestamp: timestampMs(row?.created_at) }))
    .filter(item => item.timestamp !== null && item.timestamp >= windowStartMs && item.timestamp <= checkedAtMs);

  const started = new Set();
  const completed = new Set();
  const completedLatencies = [];
  const decisionByInjectionKey = new Map();
  const injections = [];
  let errorOrTimeoutCount = 0;

  for (const { row, metadata } of rows) {
    const traceId = typeof row?.trace_id === "string" && row.trace_id ? row.trace_id : null;
    const memoryId = typeof row?.memory_id === "string" && row.memory_id ? row.memory_id : null;
    if (row?.event_type === "recall_started" && traceId) started.add(traceId);
    if (row?.event_type === "recall_completed" && traceId) {
      completed.add(traceId);
      const latency = Number(row.latency_ms);
      if (Number.isFinite(latency) && latency >= 0) completedLatencies.push(latency);
      const skipReason = metadata.skip_reason;
      if (includesHardDeniedArtifact(metadata.error)
        || /(?:timeout|error|exception|failed)/i.test(String(skipReason || ""))
        || /(?:timeout|error|exception|failed)/i.test(String(metadata.error || ""))) {
        errorOrTimeoutCount += 1;
      }
    }
    if (row?.event_type === "auto_recall_debug" && metadata.debug_type === "gate_decision" && traceId && memoryId) {
      decisionByInjectionKey.set(`${traceId}:${memoryId}`, metadata);
    }
    if (row?.event_type === "memory_injected" && traceId && memoryId) {
      injections.push({
        row,
        metadata,
        traceId,
        memoryId,
        timestamp: timestampMs(row?.created_at),
        injectionKey: `${traceId}:${memoryId}`,
      });
    }
  }

  const incompleteTraceIds = [...started].filter(traceId => !completed.has(traceId));
  let injectedWithoutAllowedGateCount = 0;
  let disallowedReinforcementInjectedCount = 0;
  let hardDeniedArtifactInjectedCount = 0;
  for (const injection of injections) {
    const decision = decisionByInjectionKey.get(`${injection.traceId}:${injection.memoryId}`);
    const decisionAllowed = decision
      && decision.injected === true
      && decision.allowed !== false
      && !decision.rejection_reason
      && !decision.rejected_reason;
    if (!decisionAllowed) injectedWithoutAllowedGateCount += 1;
    if (injection.metadata.reinforcement_allowed === false || decision?.reinforcement_allowed === false) {
      disallowedReinforcementInjectedCount += 1;
    }
    const reasons = [
      ...(Array.isArray(injection.metadata.deny_reasons) ? injection.metadata.deny_reasons : []),
      ...(Array.isArray(decision?.deny_reasons) ? decision.deny_reasons : []),
      injection.metadata.rejection_reason,
      decision?.rejection_reason,
      decision?.rejected_reason,
    ];
    if (reasons.some(includesHardDeniedArtifact)) hardDeniedArtifactInjectedCount += 1;
  }

  const p95LatencyMs = percentile95(completedLatencies);
  const maxLatencyMs = completedLatencies.length > 0 ? Math.max(...completedLatencies) : null;
  const telemetryMetrics = {
    window_start: new Date(windowStartMs).toISOString(),
    window_hours: thresholds.window_hours,
    event_count: rows.length,
    recall_started_count: started.size,
    recall_completed_count: completed.size,
    incomplete_trace_count: incompleteTraceIds.length,
    error_or_timeout_count: errorOrTimeoutCount,
    injected_count: injections.length,
    injected_without_allowed_gate_count: injectedWithoutAllowedGateCount,
    disallowed_reinforcement_injected_count: disallowedReinforcementInjectedCount,
    hard_denied_artifact_injected_count: hardDeniedArtifactInjectedCount,
    p95_auto_recall_latency_ms: p95LatencyMs,
    max_auto_recall_latency_ms: maxLatencyMs,
  };

  if (completed.size === 0) blockers.push("no_completed_auto_recall_trace");
  if (incompleteTraceIds.length > thresholds.maximum_incomplete_trace_count) blockers.push("incomplete_auto_recall_trace_present");
  if (errorOrTimeoutCount > thresholds.maximum_error_or_timeout_count) blockers.push("auto_recall_error_or_timeout_present");
  if (injectedWithoutAllowedGateCount > thresholds.maximum_injected_without_allowed_gate_count) blockers.push("injected_without_allowed_gate_present");
  if (disallowedReinforcementInjectedCount > thresholds.maximum_disallowed_reinforcement_injected_count) blockers.push("disallowed_reinforcement_injected");
  if (hardDeniedArtifactInjectedCount > thresholds.maximum_hard_denied_artifact_injected_count) blockers.push("hard_denied_artifact_injected");
  if (p95LatencyMs !== null && p95LatencyMs > thresholds.maximum_p95_latency_ms) blockers.push("p95_auto_recall_latency_above_threshold");
  if (maxLatencyMs !== null && maxLatencyMs > thresholds.maximum_max_latency_ms) blockers.push("max_auto_recall_latency_above_threshold");

  const availableInjectionKeys = [...injections]
    .sort((left, right) => (right.timestamp - left.timestamp) || left.injectionKey.localeCompare(right.injectionKey))
    .map(injection => injection.injectionKey);
  const quality = validateQualityReview(qualityReview, checkedAtMs, thresholds, availableInjectionKeys);
  blockers.push(...quality.blockers);
  const uniqueBlockers = uniqueStrings(blockers);
  const evaluationUnavailable = !thresholdValidation.valid
    || !Array.isArray(events)
    || !quality.valid
    || completed.size === 0
    || quality.status === "missing"
    || quality.status === "invalid"
    || quality.blockers.includes("quality_review_stale")
    || quality.blockers.includes("quality_review_from_future")
    || quality.blockers.includes("quality_review_sample_below_threshold")
    || quality.blockers.includes("quality_review_sample_exceeds_available_injections")
    || quality.blockers.includes("quality_review_sample_contains_unknown_injection")
    || quality.blockers.includes("quality_review_required_recent_sample_missing");
  const status = evaluationUnavailable
    ? "not_evaluated"
    : uniqueBlockers.length > 0
      ? "rollback_required"
      : "healthy";

  return {
    schema_version: 1,
    checked_at: checkedAtIso,
    status,
    blockers: uniqueBlockers,
    telemetry: telemetryMetrics,
    quality_review: quality.metrics,
    thresholds,
  };
}

export { normalizeThresholds, safeMetadata, timestampMs, validateQualityReview };
