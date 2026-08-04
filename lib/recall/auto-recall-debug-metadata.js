import {
  buildFtsFallbackQuery,
  normalizeFtsQuery,
  stripPromptMetadataPrefix,
} from "../../query-utils.js";

function projectFields(value, fields) {
  if (!value || typeof value !== "object") return {};
  const projected = {};
  for (const field of fields) {
    if (value[field] !== undefined) projected[field] = value[field];
  }
  return projected;
}

const POST_RERANK_FIELDS = [
  "id",
  "rank",
  "category",
  "score",
  "final_score",
  "semantic_score",
  "rrf_score",
  "confidence",
  "confidence_mode",
  "source_type",
  "external_badge",
  "decay_eligible",
  "archive_eligible",
  "sources",
];

const REJECTED_CANDIDATE_FIELDS = [
  "id",
  "category",
  "reason",
  "rejected_reason",
  "deny_reasons",
  "risk_reasons",
  "reinforcement_allowed",
  "matched_key_classes",
  "final_score",
  "threshold_used",
];

const GATE_DECISION_FIELDS = [
  "id",
  "injected",
  "allowed",
  "rejection_reason",
  "rejected_reason",
  "deny_reasons",
  "risk_reasons",
  "reinforcement_allowed",
  "matched_key_classes",
  "threshold_used",
  "category",
  "final_score",
];

export function buildAutoRecallDebugMetadata(prompt, result, skipReason = null, options) {
  function summarizeLegacyDbFallback(debugInfo = {}) {
    const channels = [];
    if (debugInfo.kg_access_mode === "legacy_fallback") channels.push("kg");
    if (debugInfo.recent_access_mode === "guarded_fallback") channels.push("recent");
    return {
      legacy_db_fallback_used: channels.length > 0,
      legacy_db_fallback_channels: channels,
    };
  }

  function buildAutoRecallHybridAccessMetadata(debugInfo = {}, searchExecuted = false) {
    if (!searchExecuted || !debugInfo || typeof debugInfo !== "object") return {};

    const metadata = {};
    const fallbackReasonAliases = {
      kg_isolated_fallback_reason: "kg_isolation_fallback_reason",
      recent_isolated_fallback_reason: "recent_isolation_fallback_reason",
    };
    for (const key of [
      "kg_access_mode",
      "kg_isolated_fallback_reason",
      "recent_access_mode",
      "recent_isolated_fallback_reason",
    ]) {
      if (Object.hasOwn(debugInfo, key) && debugInfo[key] !== undefined) {
        metadata[key] = debugInfo[key];
        if (fallbackReasonAliases[key]) metadata[fallbackReasonAliases[key]] = debugInfo[key];
      }
    }

    if (
      Object.hasOwn(debugInfo, "kg_access_mode") &&
      !Object.hasOwn(debugInfo, "kg_isolated_fallback_reason")
    ) {
      metadata.kg_isolated_fallback_reason = null;
      metadata.kg_isolation_fallback_reason = null;
    }
    if (
      Object.hasOwn(debugInfo, "recent_access_mode") &&
      !Object.hasOwn(debugInfo, "recent_isolated_fallback_reason")
    ) {
      metadata.recent_isolated_fallback_reason = null;
      metadata.recent_isolation_fallback_reason = null;
    }

    return {
      ...metadata,
      ...summarizeLegacyDbFallback(debugInfo),
    };
  }

  const debugInfo = result?.debug || {};
  const promptText = String(prompt || "");
  const strippedPrompt = stripPromptMetadataPrefix(promptText);
  const normalizedQuery = String(debugInfo.query_normalized || normalizeFtsQuery(strippedPrompt));
  const finalFtsQuery = String(
    debugInfo.fts_query_final ||
    buildFtsFallbackQuery(strippedPrompt) ||
    normalizedQuery
  );
  const queryStripped = String(debugInfo.query_stripped || strippedPrompt);
  const postRerankTopK = Array.isArray(debugInfo.post_rerank_topK)
    ? debugInfo.post_rerank_topK.map(item => projectFields(item, POST_RERANK_FIELDS))
    : [];
  const rejectedCandidates = Array.isArray(debugInfo.rejected_candidates)
    ? debugInfo.rejected_candidates.map(item => projectFields(item, REJECTED_CANDIDATE_FIELDS))
    : [];
  const gateDecisions = Array.isArray(debugInfo.gate_decisions)
    ? debugInfo.gate_decisions.map(item => projectFields(item, GATE_DECISION_FIELDS))
    : [];
  const passthroughVectorFields = {};
  for (const key of [
    "vector_backend_attempted",
    "vector_ready_state",
    "vector_stage",
    "vector_skipped",
    "vector_skip_reason",
    "vector_error",
    "vector_warning",
    "vector_ms",
    "vector_query_length",
    "card_first_runtime_enabled",
    "auto_recall_disclosure_mode",
    "lexical_candidate_count",
    "lexical_top_score",
    "lexical_confidence",
  ]) {
    if (debugInfo[key] !== undefined) passthroughVectorFields[key] = debugInfo[key];
  }
  if (debugInfo.vector_init_error !== undefined) passthroughVectorFields.vector_init_error = debugInfo.vector_init_error;
  return {
    original_input_chars: Number(debugInfo.original_input_chars ?? promptText.length),
    query_stripped_chars: queryStripped.length,
    query_normalized_chars: normalizedQuery.length,
    fts_query_chars: finalFtsQuery.length,
    ...(debugInfo.fts_rerank_term_source !== undefined
      ? { fts_rerank_term_source: debugInfo.fts_rerank_term_source }
      : {}),
    ...(debugInfo.fts_rerank_term_count !== undefined
      ? { fts_rerank_term_count: Number(debugInfo.fts_rerank_term_count) }
      : {}),
    ...(debugInfo.fts_preselection_strategy !== undefined
      ? { fts_preselection_strategy: debugInfo.fts_preselection_strategy }
      : {}),
    ...(debugInfo.fts_preselection_global_count !== undefined
      ? { fts_preselection_global_count: Number(debugInfo.fts_preselection_global_count) }
      : {}),
    ...(debugInfo.fts_preselection_probe_query_count !== undefined
      ? { fts_preselection_probe_query_count: Number(debugInfo.fts_preselection_probe_query_count) }
      : {}),
    ...(debugInfo.fts_preselection_probe_raw_count !== undefined
      ? { fts_preselection_probe_raw_count: Number(debugInfo.fts_preselection_probe_raw_count) }
      : {}),
    ...(debugInfo.fts_preselection_union_count !== undefined
      ? { fts_preselection_union_count: Number(debugInfo.fts_preselection_union_count) }
      : {}),
    ...(debugInfo.fts_preselection_probe_per_term_limit !== undefined
      ? { fts_preselection_probe_per_term_limit: Number(debugInfo.fts_preselection_probe_per_term_limit) }
      : {}),
    ...(debugInfo.fts_preselection_post_rerank_count !== undefined
      ? { fts_preselection_post_rerank_count: Number(debugInfo.fts_preselection_post_rerank_count) }
      : {}),
    vector_backend: debugInfo.vector_backend ?? null,
    vector_ready_state: debugInfo.vector_ready_state ?? null,
    ...passthroughVectorFields,
    fallbacks_triggered: Array.isArray(debugInfo.fallbacks_triggered) ? debugInfo.fallbacks_triggered : [],
    candidate_count: Number(result?.results?.length || 0),
    strict_count: Number(debugInfo.strict_count ?? 0),
    fallback_count: Number(debugInfo.fallback_count ?? 0),
    post_rerank_count: postRerankTopK.length,
    post_rerank_topK: postRerankTopK,
    candidate_count_before_gate: Number(debugInfo.candidate_count_before_gate ?? result?.results?.length ?? 0),
    candidate_count_after_gate: Number(debugInfo.candidate_count_after_gate ?? result?.results?.length ?? 0),
    rejected_candidates: rejectedCandidates,
    gate_decisions: gateDecisions,
    injected_count: Number(debugInfo.injected_count ?? 0),
    recall_intent_should_recall: debugInfo.recall_intent_should_recall ?? null,
    recall_intent_reason: debugInfo.recall_intent_reason ?? null,
    long_input_detected: debugInfo.long_input_detected ?? null,
    generic_task_detected: debugInfo.generic_task_detected ?? null,
    focused_query_chars: Number(
      debugInfo.focused_query_chars ?? (
        debugInfo.focused_query === undefined || debugInfo.focused_query === null
          ? 0
          : String(debugInfo.focused_query).length
      ),
    ),
    skipped_by_recall_intent: debugInfo.skipped_by_recall_intent ?? false,
    skipped: Boolean(skipReason),
    skip_reason: skipReason || null,
    candidate_counts_before_filtering: debugInfo.candidate_counts_before_filtering || {},
    ...buildAutoRecallHybridAccessMetadata(debugInfo, options && options.searchExecuted === true),
  };
}
