import {
  buildFtsFallbackQuery,
  normalizeFtsQuery,
  stripPromptMetadataPrefix,
} from "../../query-utils.js";
import {
  isAutoRecallRecallIntentArray,
  isAutoRecallTaskIntent,
} from "./auto-recall-intent-contract.js";

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

const MAX_CHANNEL_PROVENANCE_IDS = 32;
const MAX_FUSION_PROVENANCE_IDS = 8;
const BOUNDED_MEMORY_ID_LENGTH = 16;
const MAX_DIRECT_CARD_DIAGNOSTIC_ITEMS = 3;
const MAX_DIRECT_CARD_DIAGNOSTIC_STRING_LENGTH = 96;

const DIRECT_CARD_DIAGNOSTIC_KEYS = [
  "direct_card_event_sender_is_owner",
  "direct_card_owner_audience_authenticated",
  "direct_card_selected_count",
  "direct_card_capability_results",
  "direct_card_selections",
  "direct_card_boundary_error",
];

function toBoundedMemoryId(value) {
  const rawId = value && typeof value === "object" ? value.id : value;
  if (typeof rawId !== "string" && typeof rawId !== "number") return null;
  const id = String(rawId).slice(0, BOUNDED_MEMORY_ID_LENGTH);
  return id || null;
}

function projectBoundedIds(value, limit) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, limit)
    .map(toBoundedMemoryId)
    .filter(Boolean);
}

function projectChannelCandidateProvenance(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const projected = {};
  for (const [channel, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const ids = projectBoundedIds(entry.ids, MAX_CHANNEL_PROVENANCE_IDS);
    const rawCount = Number(entry.count);
    const count = Number.isSafeInteger(rawCount) && rawCount >= 0 ? rawCount : ids.length;
    const boundedIds = ids.slice(0, Math.min(count, MAX_CHANNEL_PROVENANCE_IDS));
    projected[channel] = {
      count,
      captured_count: boundedIds.length,
      truncated: count > boundedIds.length,
      ids: boundedIds,
    };
  }
  return projected;
}

function projectFusionCandidateProvenance(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { pre_rerank_ids: [], post_rerank_ids: [] };
  }
  return {
    pre_rerank_ids: projectBoundedIds(value.pre_rerank_ids, MAX_FUSION_PROVENANCE_IDS),
    post_rerank_ids: projectBoundedIds(value.post_rerank_ids, MAX_FUSION_PROVENANCE_IDS),
  };
}

function projectDirectCardDiagnosticMemoryId(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const id = String(value).slice(0, BOUNDED_MEMORY_ID_LENGTH);
  return id || null;
}

function projectDirectCardDiagnosticString(value) {
  if (typeof value !== "string") return null;
  const compact = value
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!compact || !/^[A-Za-z0-9_:-]+$/u.test(compact)) return null;
  return compact.slice(0, MAX_DIRECT_CARD_DIAGNOSTIC_STRING_LENGTH);
}

function projectDirectCardDiagnosticRecords(value, fields) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_DIRECT_CARD_DIAGNOSTIC_ITEMS)
    .map(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const projected = {};
      const memoryId = projectDirectCardDiagnosticMemoryId(item.memory_id);
      if (memoryId !== null) projected.memory_id = memoryId;
      for (const field of fields) {
        const bounded = projectDirectCardDiagnosticString(item[field]);
        if (bounded !== null) projected[field] = bounded;
      }
      return Object.keys(projected).length > 0 ? projected : null;
    })
    .filter(Boolean);
}

function projectDirectCardSelectedCount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER);
}

function projectDirectCardDiagnostics(debugInfo = {}) {
  if (!DIRECT_CARD_DIAGNOSTIC_KEYS.some(key => Object.hasOwn(debugInfo, key))) return {};

  const ownerAudienceAuthenticated = debugInfo.direct_card_owner_audience_authenticated;
  const boundaryError = debugInfo.direct_card_boundary_error;
  return {
    direct_card_event_sender_is_owner: debugInfo.direct_card_event_sender_is_owner === true,
    direct_card_owner_audience_authenticated:
      ownerAudienceAuthenticated === true || ownerAudienceAuthenticated === false
        ? ownerAudienceAuthenticated
        : null,
    direct_card_selected_count: projectDirectCardSelectedCount(debugInfo.direct_card_selected_count),
    direct_card_capability_results: projectDirectCardDiagnosticRecords(
      debugInfo.direct_card_capability_results,
      ["capability", "reason"],
    ),
    direct_card_selections: projectDirectCardDiagnosticRecords(
      debugInfo.direct_card_selections,
      ["decision", "reason"],
    ),
    direct_card_boundary_error: boundaryError === null || boundaryError === undefined
      ? null
      : projectDirectCardDiagnosticString(boundaryError) || "direct_card_boundary_error",
  };
}

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
  const channelCandidateProvenance = Object.hasOwn(debugInfo, "channel_candidate_provenance")
    ? projectChannelCandidateProvenance(debugInfo.channel_candidate_provenance)
    : undefined;
  const fusionCandidateProvenance = Object.hasOwn(debugInfo, "fusion_candidate_provenance")
    ? projectFusionCandidateProvenance(debugInfo.fusion_candidate_provenance)
    : undefined;
  const boundedTaskIntent = Object.hasOwn(debugInfo, "task_intent")
    ? (isAutoRecallTaskIntent(debugInfo.task_intent) ? debugInfo.task_intent : null)
    : undefined;
  const boundedRecallIntent = Object.hasOwn(debugInfo, "recall_intent")
    ? (isAutoRecallRecallIntentArray(debugInfo.recall_intent) ? [...debugInfo.recall_intent] : [])
    : undefined;
  const directCardDiagnostics = projectDirectCardDiagnostics(debugInfo);
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
    ...(channelCandidateProvenance !== undefined
      ? { channel_candidate_provenance: channelCandidateProvenance }
      : {}),
    ...(fusionCandidateProvenance !== undefined
      ? { fusion_candidate_provenance: fusionCandidateProvenance }
      : {}),
    candidate_count_before_gate: Number(debugInfo.candidate_count_before_gate ?? result?.results?.length ?? 0),
    candidate_count_after_gate: Number(debugInfo.candidate_count_after_gate ?? result?.results?.length ?? 0),
    rejected_candidates: rejectedCandidates,
    gate_decisions: gateDecisions,
    injected_count: Number(debugInfo.injected_count ?? 0),
    ...directCardDiagnostics,
    ...(boundedTaskIntent !== undefined ? { task_intent: boundedTaskIntent } : {}),
    ...(boundedRecallIntent !== undefined ? { recall_intent: boundedRecallIntent } : {}),
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
