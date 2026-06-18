export function createCandidateCounts() {
  return {
    kg_raw: 0,
    kg_after_conf_filter: 0,
    vector_raw: 0,
    vector_after_conf_filter: 0,
    fts_raw_primary: 0,
    fts_raw_final: 0,
    like_raw: 0,
    recent_raw: 0,
    episode_raw: 0,
    recent_fallback_raw: 0,
  };
}

export function createHybridDebug({
  rawQuery,
  strippedQuery,
  normalizedQuery,
  queryTerms,
  candidateCounts,
  minConfidence,
  lexicalConfidenceThreshold,
}) {
  return {
    query_original: rawQuery,
    query_stripped: strippedQuery,
    query_normalized: normalizedQuery,
    fts_query_final: normalizedQuery,
    vector_query: strippedQuery,
    query_terms: queryTerms,
    candidate_counts_before_filtering: candidateCounts,
    fallbacks_triggered: [],
    vector_backend: "disabled",
    vector_backend_attempted: null,
    vector_ready_state: "disabled",
    vector_stage: "ready_check",
    vector_skipped: false,
    vector_skip_reason: null,
    vector_error: null,
    vector_ms: null,
    vector_query_length: strippedQuery.length,
    strict_count: 0,
    fallback_count: 0,
    post_rerank_topK: [],
    min_confidence: minConfidence,
    lexical_candidate_count: 0,
    lexical_top_score: 0,
    lexical_confidence: 0,
    lexical_confidence_threshold: lexicalConfidenceThreshold,
  };
}

export function createHybridWarnings() {
  const warnedVectorChannelFailures = new Set();
  const warnedHybridSearchFailures = new Set();

  function warnVectorChannelOnce(message, error = null) {
    const key = String(message || "unknown");
    if (warnedVectorChannelFailures.has(key)) return;
    warnedVectorChannelFailures.add(key);
    const detail = error?.message ? `: ${error.message}` : "";
    console.warn(`[memory-engine] hybridSearch vector channel unavailable (${message})${detail}`);
  }

  function warnHybridSearchOnce(message, error = null) {
    const key = String(message || "unknown");
    if (warnedHybridSearchFailures.has(key)) return;
    warnedHybridSearchFailures.add(key);
    const detail = error?.message ? `: ${error.message}` : "";
    console.warn(`[memory-engine] hybridSearch channel degraded (${message})${detail}`);
  }

  return {
    warnVectorChannelOnce,
    warnHybridSearchOnce,
  };
}

export function toDebugErrorMessage(error) {
  if (!error) return "unknown error";
  if (error?.message) return String(error.message);
  return String(error);
}
