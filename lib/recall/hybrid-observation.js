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

export function buildHybridSearchObservation({
  surface,
  result = {},
  completedAtMs = Date.now(),
} = {}) {
  const debug = result?.debug && typeof result.debug === "object" ? result.debug : {};
  const channelSizes = result?.channel_sizes || debug.channel_sizes || {};
  const fallbackChannelList = fallbackChannels(debug);
  const completedAt = Number(completedAtMs);
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
    kg_shadow_mode: debug.kg_shadow_mode ?? null,
    kg_shadow_would_fail_closed: debug.kg_shadow_would_fail_closed ?? null,
    kg_shadow_dropped_candidate_count: debug.kg_shadow_dropped_candidate_count ?? null,
    kg_shadow_candidate_loss_ratio: debug.kg_shadow_candidate_loss_ratio ?? null,
    kg_shadow_overlap_count: debug.kg_shadow_overlap_count ?? null,
    kg_runtime_mode: debug.kg_runtime_mode ?? null,
    kg_fail_closed_applied: debug.kg_fail_closed_applied ?? null,
    kg_fail_closed_would_have_used_fallback: debug.kg_fail_closed_would_have_used_fallback ?? null,
    kg_fail_closed_fallback_suppressed: debug.kg_fail_closed_fallback_suppressed ?? null,
    kg_fail_closed_empty_candidate: debug.kg_fail_closed_empty_candidate ?? null,
    kg_fail_closed_candidate_loss_ratio: debug.kg_fail_closed_candidate_loss_ratio ?? null,
    recent_shadow_mode: debug.recent_shadow_mode ?? null,
    recent_shadow_would_fail_closed: debug.recent_shadow_would_fail_closed ?? null,
    recent_shadow_dropped_candidate_count: debug.recent_shadow_dropped_candidate_count ?? null,
    recent_shadow_candidate_loss_ratio: debug.recent_shadow_candidate_loss_ratio ?? null,
    recent_shadow_overlap_count: debug.recent_shadow_overlap_count ?? null,
    recent_shadow_risk_level: debug.recent_shadow_risk_level ?? null,
  };
  for (const key of [
    "kg_access_mode",
    "kg_isolated_fallback_reason",
    "recent_access_mode",
    "recent_isolated_fallback_reason",
  ]) {
    if (Object.hasOwn(debug, key)) metadata[key] = debug[key];
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
} = {}) {
  if (typeof recordMemoryEvent !== "function") return false;
  const metadata = buildHybridSearchObservation({ surface, result, completedAtMs });
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
