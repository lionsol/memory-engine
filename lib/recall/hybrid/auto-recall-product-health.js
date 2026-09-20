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

const MAX_REJECTION_REASON_LENGTH = 128;
const HYBRID_STAGE_LATENCY_NAMES = Object.freeze([
  "setup",
  "kg",
  "fts",
  "vector",
  "recent",
  "finalize",
  "total",
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

function percentileNearestRank(values, percentile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)];
}

function percentile95(values) {
  return percentileNearestRank(values, 0.95);
}

function summarizeLatency(values) {
  return {
    sample_count: values.length,
    p50: percentileNearestRank(values, 0.5),
    p95: percentile95(values),
    max: values.length > 0 ? Math.max(...values) : null,
  };
}

function summarizeHybridStageLatency(entries) {
  return Object.fromEntries(HYBRID_STAGE_LATENCY_NAMES.map(name => {
    const values = entries
      .map(([, timings]) => finiteNonNegative(timings?.[`${name}_ms`]))
      .filter(value => value !== null);
    return [name, summarizeLatency(values)];
  }));
}

function finiteNonNegative(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function decisionMemoryId(decision) {
  const value = decision?.memory_id ?? decision?.id;
  return typeof value === "string" && value ? value : null;
}

function rejectionReason(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, MAX_REJECTION_REASON_LENGTH) : null;
}

function decisionRejectionReason(decision, rejectedCandidateById = new Map()) {
  const direct = rejectionReason(decision?.rejected_reason)
    || rejectionReason(decision?.rejection_reason)
    || rejectionReason(decision?.reason);
  if (direct) return direct;
  const candidate = decisionMemoryId(decision)
    ? rejectedCandidateById.get(decisionMemoryId(decision))
    : null;
  return rejectionReason(candidate?.rejected_reason)
    || rejectionReason(candidate?.rejection_reason)
    || rejectionReason(candidate?.reason);
}

function isAllowedGateDecision(decision) {
  return Boolean(decision)
    && decision.injected === true
    && decision.allowed !== false
    && !rejectionReason(decision.rejection_reason)
    && !rejectionReason(decision.rejected_reason);
}

function hasShadowWouldInject(metadata) {
  if (finiteNonNegative(metadata?.would_inject_count) > 0) return true;
  if (Array.isArray(metadata?.would_inject_ids) && metadata.would_inject_ids.length > 0) return true;
  if (metadata?.would_inject === true) return true;
  return Array.isArray(metadata?.candidate_decisions)
    && metadata.candidate_decisions.some(item => item?.would_inject === true);
}

function sortedReasonCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort((left, right) => left[0].localeCompare(right[0])),
  );
}

function summarizeGateDiagnostics(traceIds, canonicalGateDecisionsByTrace) {
  let decisionTraceCount = 0;
  let passTraceCount = 0;
  let fullRejectTraceCount = 0;
  let unknownTraceCount = 0;
  const rejectionReasonCounts = {};
  const fullRejectReasonCounts = {};

  for (const traceId of traceIds) {
    const evidence = canonicalGateDecisionsByTrace.get(traceId);
    const decisions = Array.isArray(evidence?.decisions) ? evidence.decisions : [];
    if (decisions.length === 0) {
      unknownTraceCount += 1;
      continue;
    }

    decisionTraceCount += 1;
    const rejectedCandidateById = new Map(
      (Array.isArray(evidence.rejectedCandidates) ? evidence.rejectedCandidates : [])
        .map(candidate => [decisionMemoryId(candidate), candidate])
        .filter(([id]) => id),
    );
    const rejectedReasons = decisions
      .filter(decision => !isAllowedGateDecision(decision))
      .map(decision => decisionRejectionReason(decision, rejectedCandidateById))
      .filter(Boolean);
    for (const reason of rejectedReasons) {
      rejectionReasonCounts[reason] = (rejectionReasonCounts[reason] || 0) + 1;
    }

    if (decisions.some(isAllowedGateDecision)) {
      passTraceCount += 1;
      continue;
    }
    fullRejectTraceCount += 1;
    for (const reason of rejectedReasons) {
      fullRejectReasonCounts[reason] = (fullRejectReasonCounts[reason] || 0) + 1;
    }
  }

  return {
    decision_trace_count: decisionTraceCount,
    pass_trace_count: passTraceCount,
    full_reject_trace_count: fullRejectTraceCount,
    unknown_trace_count: unknownTraceCount,
    rejection_reason_counts: sortedReasonCounts(rejectionReasonCounts),
    full_reject_reason_counts: sortedReasonCounts(fullRejectReasonCounts),
  };
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
  windowStart,
} = {}) {
  const checkedAtIso = canonicalIsoTimestamp(checkedAt);
  if (!checkedAtIso) throw new TypeError("checkedAt must be a canonical UTC ISO timestamp");
  const checkedAtMs = Date.parse(checkedAtIso);
  const explicitWindowStart = windowStart !== undefined;
  const windowStartIso = explicitWindowStart ? canonicalIsoTimestamp(windowStart) : null;
  if (explicitWindowStart && !windowStartIso) {
    throw new TypeError("windowStart must be a canonical UTC ISO timestamp");
  }
  const explicitWindowStartMs = explicitWindowStart ? Date.parse(windowStartIso) : null;
  if (explicitWindowStart && explicitWindowStartMs > checkedAtMs) {
    throw new TypeError("windowStart must not be after checkedAt");
  }
  const thresholdValidation = normalizeThresholds(thresholdInput);
  const thresholds = thresholdValidation.thresholds;
  const blockers = [...thresholdValidation.errors];
  if (!Array.isArray(events)) blockers.push("events_invalid");

  const evidenceWindowStartMs = explicitWindowStart
    ? explicitWindowStartMs
    : checkedAtMs - thresholds.window_hours * 3_600_000;
  const rows = (Array.isArray(events) ? events : [])
    .map(row => ({ row, metadata: safeMetadata(row?.metadata_json), timestamp: timestampMs(row?.created_at) }))
    .filter(item => item.timestamp !== null && item.timestamp >= evidenceWindowStartMs && item.timestamp <= checkedAtMs);

  const started = new Set();
  const completed = new Set();
  const completedByTrace = new Map();
  const completedLatencies = [];
  const aggregateGateDecisionsByTrace = new Map();
  const aggregateDebugByTrace = new Map();
  const aggregateStageTimingsByTrace = new Map();
  const individualGateDecisionsByTrace = new Map();
  const injections = [];
  const shadowDecisionTraces = new Set();
  const shadowWouldInjectTraces = new Set();
  let errorOrTimeoutCount = 0;

  for (const { row, metadata } of rows) {
    const traceId = typeof row?.trace_id === "string" && row.trace_id ? row.trace_id : null;
    const memoryId = typeof row?.memory_id === "string" && row.memory_id ? row.memory_id : null;
    if (row?.event_type === "recall_started" && traceId) started.add(traceId);
    if (row?.event_type === "recall_completed" && traceId) {
      completed.add(traceId);
      completedByTrace.set(traceId, { row, metadata });
      const latency = Number(row.latency_ms);
      if (Number.isFinite(latency) && latency >= 0) completedLatencies.push(latency);
      const skipReason = metadata.skip_reason;
      if (includesHardDeniedArtifact(metadata.error)
        || /(?:timeout|error|exception|failed)/i.test(String(skipReason || ""))
        || /(?:timeout|error|exception|failed)/i.test(String(metadata.error || ""))) {
        errorOrTimeoutCount += 1;
      }
    }
    if (row?.event_type === "auto_recall_debug" && traceId) {
      if (metadata.debug_type === "q6_shadow_decision" && metadata.mode === "shadow") {
        shadowDecisionTraces.add(traceId);
        if (hasShadowWouldInject(metadata)) shadowWouldInjectTraces.add(traceId);
      }
      if (Array.isArray(metadata.gate_decisions)) {
        if (!aggregateGateDecisionsByTrace.has(traceId)) {
          aggregateGateDecisionsByTrace.set(traceId, {
            decisions: metadata.gate_decisions,
            rejectedCandidates: Array.isArray(metadata.rejected_candidates)
              ? metadata.rejected_candidates
              : [],
          });
        }
        if (!aggregateDebugByTrace.has(traceId)) aggregateDebugByTrace.set(traceId, metadata);
        if (isPlainObject(metadata.hybrid_stage_timings) && !aggregateStageTimingsByTrace.has(traceId)) {
          aggregateStageTimingsByTrace.set(traceId, metadata.hybrid_stage_timings);
        }
      } else if (metadata.debug_type === "gate_decision" && memoryId) {
        if (!individualGateDecisionsByTrace.has(traceId)) individualGateDecisionsByTrace.set(traceId, []);
        individualGateDecisionsByTrace.get(traceId).push({ ...metadata, id: memoryId });
      }
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
  const executedCompletedTraceIds = [...started].filter(traceId => completed.has(traceId));
  const explicitlySkippedCompletedTraceIds = [...completed].filter(traceId => (
    !started.has(traceId) && completedByTrace.get(traceId)?.metadata?.skipped === true
  ));
  const unclassifiedCompletedTraceIds = [...completed].filter(traceId => (
    !started.has(traceId) && !explicitlySkippedCompletedTraceIds.includes(traceId)
  ));
  const executedCompletedLatencyByTrace = new Map(
    executedCompletedTraceIds.map(traceId => [
      traceId,
      finiteNonNegative(completedByTrace.get(traceId)?.row?.latency_ms),
    ]),
  );
  const executedCompletedLatencies = [...executedCompletedLatencyByTrace.values()]
    .filter(value => value !== null);
  const nonShadowExecutedCompletedLatencies = [...executedCompletedLatencyByTrace]
    .filter(([traceId]) => !shadowDecisionTraces.has(traceId))
    .map(([, latency]) => latency)
    .filter(value => value !== null);
  const shadowExecutedCompletedLatencies = [...executedCompletedLatencyByTrace]
    .filter(([traceId]) => shadowDecisionTraces.has(traceId))
    .map(([, latency]) => latency)
    .filter(value => value !== null);
  const vectorLatencyByTrace = new Map(
    [...aggregateDebugByTrace].map(([traceId, metadata]) => [
      traceId,
      finiteNonNegative(metadata.vector_ms),
    ]),
  );
  const vectorLatencies = [...vectorLatencyByTrace.values()]
    .filter(value => value !== null);
  const nonShadowVectorLatencies = [...vectorLatencyByTrace]
    .filter(([traceId]) => !shadowDecisionTraces.has(traceId))
    .map(([, latency]) => latency)
    .filter(value => value !== null);
  const shadowVectorLatencies = [...vectorLatencyByTrace]
    .filter(([traceId]) => shadowDecisionTraces.has(traceId))
    .map(([, latency]) => latency)
    .filter(value => value !== null);
  const hybridStageTimingEntries = [...aggregateStageTimingsByTrace];
  const nonShadowHybridStageTimingEntries = hybridStageTimingEntries
    .filter(([traceId]) => !shadowDecisionTraces.has(traceId));
  const shadowHybridStageTimingEntries = hybridStageTimingEntries
    .filter(([traceId]) => shadowDecisionTraces.has(traceId));
  const hybridStageLatency = summarizeHybridStageLatency(hybridStageTimingEntries);
  const nonShadowHybridStageLatency = summarizeHybridStageLatency(nonShadowHybridStageTimingEntries);
  const shadowHybridStageLatency = summarizeHybridStageLatency(shadowHybridStageTimingEntries);

  const canonicalGateDecisionsByTrace = new Map();
  for (const [traceId, aggregate] of aggregateGateDecisionsByTrace) {
    canonicalGateDecisionsByTrace.set(traceId, aggregate);
  }
  for (const [traceId, decisions] of individualGateDecisionsByTrace) {
    if (!canonicalGateDecisionsByTrace.has(traceId)) {
      canonicalGateDecisionsByTrace.set(traceId, { decisions, rejectedCandidates: [] });
    }
  }

  const gateEvidenceTraceIds = [...canonicalGateDecisionsByTrace]
    .filter(([, evidence]) => Array.isArray(evidence?.decisions) && evidence.decisions.length > 0)
    .map(([traceId]) => traceId);
  const gateRelevantTraceIds = new Set([
    ...started,
    ...gateEvidenceTraceIds,
  ]);
  const nonShadowGateTraceIds = [...gateRelevantTraceIds]
    .filter(traceId => !shadowDecisionTraces.has(traceId));
  const shadowGateTraceIds = [...gateRelevantTraceIds]
    .filter(traceId => shadowDecisionTraces.has(traceId));
  const gateDiagnostics = summarizeGateDiagnostics(gateRelevantTraceIds, canonicalGateDecisionsByTrace);
  const nonShadowGateDiagnostics = summarizeGateDiagnostics(
    nonShadowGateTraceIds,
    canonicalGateDecisionsByTrace,
  );
  const shadowGateDiagnostics = summarizeGateDiagnostics(
    shadowGateTraceIds,
    canonicalGateDecisionsByTrace,
  );
  const nonShadowStartedCount = [...started].filter(traceId => !shadowDecisionTraces.has(traceId)).length;
  const shadowStartedCount = [...started].filter(traceId => shadowDecisionTraces.has(traceId)).length;
  const nonShadowCompletedTraceIds = executedCompletedTraceIds
    .filter(traceId => !shadowDecisionTraces.has(traceId));
  const shadowCompletedTraceIds = executedCompletedTraceIds
    .filter(traceId => shadowDecisionTraces.has(traceId));
  const nonShadowIncompleteCount = incompleteTraceIds
    .filter(traceId => !shadowDecisionTraces.has(traceId)).length;
  const shadowIncompleteCount = incompleteTraceIds
    .filter(traceId => shadowDecisionTraces.has(traceId)).length;

  const decisionByInjectionKey = new Map();
  for (const [traceId, evidence] of canonicalGateDecisionsByTrace) {
    for (const decision of Array.isArray(evidence.decisions) ? evidence.decisions : []) {
      const memoryId = decisionMemoryId(decision);
      if (memoryId) decisionByInjectionKey.set(`${traceId}:${memoryId}`, decision);
    }
  }

  let injectedWithoutAllowedGateCount = 0;
  let disallowedReinforcementInjectedCount = 0;
  let hardDeniedArtifactInjectedCount = 0;
  for (const injection of injections) {
    const decision = decisionByInjectionKey.get(`${injection.traceId}:${injection.memoryId}`);
    const decisionAllowed = isAllowedGateDecision(decision);
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
    window_start: explicitWindowStart ? windowStartIso : new Date(evidenceWindowStartMs).toISOString(),
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
    analysis_window: {
      start: explicitWindowStart ? windowStartIso : new Date(evidenceWindowStartMs).toISOString(),
      end: checkedAtIso,
      source: explicitWindowStart ? "explicit" : "threshold_window_hours",
    },
    reconstruction: {
      executed_started_count: started.size,
      executed_completed_count: executedCompletedTraceIds.length,
      executed_incomplete_count: incompleteTraceIds.length,
      explicitly_skipped_completed_count: explicitlySkippedCompletedTraceIds.length,
      unclassified_completed_count: unclassifiedCompletedTraceIds.length,
      executed_completed_hook_latency_ms: summarizeLatency(executedCompletedLatencies),
      vector_latency_ms: summarizeLatency(vectorLatencies),
      hybrid_stage_latency_ms: hybridStageLatency,
      gate: gateDiagnostics,
      shadow: {
        decision_trace_count: shadowDecisionTraces.size,
        would_inject_trace_count: shadowWouldInjectTraces.size,
        executed_started_count: shadowStartedCount,
        executed_completed_count: shadowCompletedTraceIds.length,
        executed_incomplete_count: shadowIncompleteCount,
        executed_completed_hook_latency_ms: summarizeLatency(shadowExecutedCompletedLatencies),
        vector_latency_ms: summarizeLatency(shadowVectorLatencies),
        hybrid_stage_latency_ms: shadowHybridStageLatency,
        gate: shadowGateDiagnostics,
      },
      non_shadow: {
        executed_started_count: nonShadowStartedCount,
        executed_completed_count: nonShadowCompletedTraceIds.length,
        executed_incomplete_count: nonShadowIncompleteCount,
        executed_completed_hook_latency_ms: summarizeLatency(nonShadowExecutedCompletedLatencies),
        vector_latency_ms: summarizeLatency(nonShadowVectorLatencies),
        hybrid_stage_latency_ms: nonShadowHybridStageLatency,
        gate: nonShadowGateDiagnostics,
      },
    },
  };
}

export { normalizeThresholds, safeMetadata, timestampMs, validateQualityReview };
