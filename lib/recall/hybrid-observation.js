import { resolveHybridTrafficOrigin, TRAFFIC_ORIGIN_SCHEMA_VERSION } from "./hybrid/traffic-origin.js";

const HYBRID_OBSERVATION_SCHEMA_VERSION = 1;

function fallbackChannels(debug = {}) {
  const channels = [];
  if (debug.kg_access_mode === "legacy_fallback") channels.push("kg");
  if (debug.recent_access_mode === "guarded_fallback") channels.push("recent");
  return channels;
}

function channelErrorCount(debug = {}) {
  return ["fts_error", "kg_error", "recent_error", "vector_error"]
    .reduce((count, key) => count + (debug[key] ? 1 : 0), 0);
}

function boundedFiniteNumber(value, { integer = false, minimum = 0, maximum = 1_000_000 } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const number = value;
  if (integer && !Number.isSafeInteger(number)) return null;
  if (number < minimum || number > maximum) return null;
  return number;
}

function boundedToken(value, maximumLength = 96) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) return null;
  return /^[A-Za-z0-9._:/-]+$/.test(normalized) ? normalized : null;
}

function boundedAdapterIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    provider: boundedToken(value.provider),
    model: boundedToken(value.model),
    revision: value.revision === null ? null : boundedToken(value.revision),
  };
}

function boundedReasonCounts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, count] of Object.entries(value)) {
    const reason = boundedToken(key);
    const boundedCount = boundedFiniteNumber(count, { integer: true, maximum: 50 });
    if (reason !== null && boundedCount !== null) result[reason] = boundedCount;
  }
  return result;
}

function boundedExplicitSearchRerankObservation(debug = {}) {
  const source = debug?.explicit_search_rerank;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const limits = source.limits && typeof source.limits === "object" ? source.limits : {};
  const canonicalPool = source.canonical_pool && typeof source.canonical_pool === "object"
    ? source.canonical_pool
    : {};
  const finalServing = source.final_serving && typeof source.final_serving === "object"
    ? source.final_serving
    : {};
  const rerank = source.rerank && typeof source.rerank === "object" ? source.rerank : {};
  const timings = source.timings && typeof source.timings === "object" ? source.timings : {};
  return {
    profile: boundedToken(source.profile),
    mode: boundedToken(source.mode),
    limits: {
      candidate_depth: boundedFiniteNumber(limits.candidate_depth, { integer: true, maximum: 50 }),
      max_code_points_per_candidate: boundedFiniteNumber(limits.max_code_points_per_candidate, { integer: true, maximum: 8000 }),
      max_total_code_points: boundedFiniteNumber(limits.max_total_code_points, { integer: true, maximum: 400000 }),
      deadline_ms: boundedFiniteNumber(limits.deadline_ms, { integer: true, maximum: 60000 }),
    },
    canonical_pool: {
      bounded_candidate_count: boundedFiniteNumber(canonicalPool.bounded_candidate_count, { integer: true, maximum: 50 }),
      eligible_candidate_count: boundedFiniteNumber(canonicalPool.eligible_candidate_count, { integer: true, maximum: 50 }),
      requested_count: boundedFiniteNumber(canonicalPool.requested_count, { integer: true, maximum: 50 }),
      resolved_count: boundedFiniteNumber(canonicalPool.resolved_count, { integer: true, maximum: 50 }),
      valid_count: boundedFiniteNumber(canonicalPool.valid_count, { integer: true, maximum: 50 }),
      excluded_count: boundedFiniteNumber(canonicalPool.excluded_count, { integer: true, maximum: 50 }),
      excluded_reasons: boundedReasonCounts(canonicalPool.excluded_reasons),
    },
    final_serving: {
      top_k: boundedFiniteNumber(finalServing.top_k, { integer: true, maximum: 50 }),
      served_count: boundedFiniteNumber(finalServing.served_count, { integer: true, maximum: 50 }),
      top_k_truncation_count: boundedFiniteNumber(finalServing.top_k_truncation_count, { integer: true, maximum: 50 }),
    },
    rerank: {
      status: boundedToken(rerank.status),
      reason: boundedToken(rerank.reason),
      configured_adapter_identity: boundedAdapterIdentity(rerank.configured_adapter_identity),
      observed_adapter_identity: boundedAdapterIdentity(rerank.observed_adapter_identity),
    },
    timings: {
      canonical_read_elapsed_ms: boundedFiniteNumber(timings.canonical_read_elapsed_ms, { maximum: 60000 }),
      projection_elapsed_ms: boundedFiniteNumber(timings.projection_elapsed_ms, { maximum: 60000 }),
      rerank_elapsed_ms: boundedFiniteNumber(timings.rerank_elapsed_ms, { maximum: 60000 }),
      total_profile_elapsed_ms: boundedFiniteNumber(timings.total_profile_elapsed_ms, { maximum: 60000 }),
    },
  };
}

export function buildHybridSearchObservation({
  surface,
  result = {},
  completedAtMs = Date.now(),
  trafficOriginContext = null,
} = {}) {
  const debug = result?.debug && typeof result.debug === "object" ? result.debug : {};
  const channelSizes = result?.channel_sizes || debug.channel_sizes || {};
  const fallbackChannelList = fallbackChannels(debug);
  const completedAt = Number(completedAtMs);
  const trafficOrigin = resolveHybridTrafficOrigin({
    surface,
    trustedRuntimeContext: trafficOriginContext,
  });
  const metadata = {
    schema_version: HYBRID_OBSERVATION_SCHEMA_VERSION,
    surface: typeof surface === "string" && surface.trim() ? surface.trim() : "unknown",
    search_executed: true,
    legacy_db_fallback_used: fallbackChannelList.length > 0,
    legacy_db_fallback_channels: fallbackChannelList,
    kg_candidate_count: Number(channelSizes.kg) || 0,
    recent_candidate_count: Number(channelSizes.recent) || 0,
    result_count: Array.isArray(result?.results) ? result.results.length : 0,
    channel_error_count: channelErrorCount(debug),
    completed_at: Number.isFinite(completedAt) ? new Date(completedAt).toISOString() : new Date().toISOString(),
    traffic_origin: trafficOrigin.origin,
    traffic_origin_evidence: trafficOrigin.evidence,
    traffic_origin_valid: trafficOrigin.valid,
    traffic_origin_reasons: trafficOrigin.reasons,
    traffic_origin_schema_version: TRAFFIC_ORIGIN_SCHEMA_VERSION,
    kg_shadow_mode: debug.kg_shadow_mode ?? null,
    kg_shadow_would_fail_closed: debug.kg_shadow_would_fail_closed ?? null,
    kg_shadow_dropped_candidate_count: debug.kg_shadow_dropped_candidate_count ?? null,
    kg_shadow_candidate_loss_ratio: debug.kg_shadow_candidate_loss_ratio ?? null,
    kg_shadow_overlap_count: debug.kg_shadow_overlap_count ?? null,
    kg_runtime_mode: debug.kg_runtime_mode ?? null,
    kg_rollout_scope: debug.kg_rollout_scope ?? null,
    kg_scope_required: debug.kg_scope_required ?? null,
    kg_fail_closed_applied: debug.kg_fail_closed_applied ?? null,
    kg_fail_closed_would_have_used_fallback: debug.kg_fail_closed_would_have_used_fallback ?? null,
    kg_fail_closed_fallback_suppressed: debug.kg_fail_closed_fallback_suppressed ?? null,
    kg_fail_closed_scope_match: debug.kg_fail_closed_scope_match ?? null,
    kg_fail_closed_empty_candidate: debug.kg_fail_closed_empty_candidate ?? null,
    kg_fail_closed_candidate_loss_ratio: debug.kg_fail_closed_candidate_loss_ratio ?? null,
    recent_shadow_mode: debug.recent_shadow_mode ?? null,
    recent_shadow_would_fail_closed: debug.recent_shadow_would_fail_closed ?? null,
    recent_shadow_dropped_candidate_count: debug.recent_shadow_dropped_candidate_count ?? null,
    recent_shadow_candidate_loss_ratio: debug.recent_shadow_candidate_loss_ratio ?? null,
    recent_shadow_overlap_count: debug.recent_shadow_overlap_count ?? null,
    recent_shadow_risk_level: debug.recent_shadow_risk_level ?? null,
    recent_runtime_mode: debug.recent_runtime_mode ?? null,
    recent_rollout_scope: debug.recent_rollout_scope ?? null,
    recent_scope_required: debug.recent_scope_required ?? null,
    recent_fail_closed_applied: debug.recent_fail_closed_applied ?? null,
    recent_fail_closed_fallback_suppressed: debug.recent_fail_closed_fallback_suppressed ?? null,
    recent_fail_closed_scope_match: debug.recent_fail_closed_scope_match ?? null,
    recent_fail_closed_empty_candidate: debug.recent_fail_closed_empty_candidate ?? null,
  };
  for (const key of [
    "kg_access_mode",
    "kg_isolated_fallback_reason",
    "recent_access_mode",
    "recent_isolated_fallback_reason",
  ]) {
    if (Object.hasOwn(debug, key)) metadata[key] = debug[key];
  }
  const explicitSearchRerank = boundedExplicitSearchRerankObservation(debug);
  if (explicitSearchRerank) metadata.explicit_search_rerank = explicitSearchRerank;
  if (debug.recall_hint && typeof debug.recall_hint === "object") {
    const recallHint = {
      mode: debug.recall_hint.mode ?? "none",
      status: debug.recall_hint.status ?? "provider_error",
      canary_in_scope: debug.hint_canary_in_scope === true,
      canary_reason: debug.hint_canary_reason ?? null,
      vector_execution_mode: debug.hint_vector_execution_mode === "parallel"
        ? "parallel"
        : "sequential",
      expansion_count: Number.isSafeInteger(debug.hint_expansion_count)
        ? Math.max(0, Math.min(2, debug.hint_expansion_count))
        : 0,
    };
    if (Number.isFinite(debug.hint_provider_latency_ms)) {
      recallHint.provider_latency_ms = Math.max(0, Math.min(60_000, debug.hint_provider_latency_ms));
    }
    if (Number.isSafeInteger(debug.hint_provider_input_tokens)) {
      recallHint.provider_input_tokens = Math.max(0, Math.min(100_000, debug.hint_provider_input_tokens));
    }
    if (Number.isSafeInteger(debug.hint_provider_output_tokens)) {
      recallHint.provider_output_tokens = Math.max(0, Math.min(10_000, debug.hint_provider_output_tokens));
    }
    metadata.recall_hint = recallHint;
  }
  return metadata;
}

export function recordHybridSearchObservation({
  recordMemoryEvent,
  surface,
  result,
  completedAtMs = Date.now(),
  sessionId = null,
  traceId = null,
  trafficOriginContext = null,
} = {}) {
  if (typeof recordMemoryEvent !== "function") return false;
  const metadata = buildHybridSearchObservation({
    surface,
    result,
    completedAtMs,
    trafficOriginContext,
  });
  try {
    recordMemoryEvent({
      event_type: "hybrid_search_observation",
      session_id: sessionId,
      trace_id: traceId,
      source: `hybrid.${metadata.surface}`,
      metadata_json: metadata,
    });
    return true;
  } catch {
    return false;
  }
}

export { HYBRID_OBSERVATION_SCHEMA_VERSION };
