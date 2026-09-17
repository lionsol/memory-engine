import {
  buildFtsFallbackQuery,
  extractExactQueryFragments,
  extractFtsFallbackTerms,
  normalizeFtsQuery,
  stripPromptMetadataPrefix,
} from "../../query-utils.js";
import {
  resolveEffectiveHybridRuntimeConfig,
} from "../config/effective-hybrid-runtime-config.js";
import {
  createCandidateCounts,
  createHybridDebug,
  createHybridWarnings,
  toDebugErrorMessage,
} from "./hybrid/debug.js";
import {
  inferCategoryFromChunk,
  inferCategoryFromPath as inferCategoryFromPathHelper,
  isCandidateAllowedForRerank,
  normalizeExternalMemory,
  normalizeUnixSeconds,
  round4,
  toFiniteNumber,
} from "./hybrid/normalize-candidate.js";
import {
  computeLexicalConfidence,
  enrichLexicalCandidate,
  tokenizeQuery,
} from "./hybrid/lexical.js";
import {
  computeRecencyBoost,
  fuseChannels,
} from "./hybrid/fusion.js";
import { collectFtsCandidates } from "./hybrid/channels/fts.js";
import { collectKgCandidates } from "./hybrid/channels/kg.js";
import { collectRecentCandidates } from "./hybrid/channels/recent.js";
import { collectVectorCandidates } from "./hybrid/channels/vector.js";
import {
  createFtsChannelContext,
  createHybridChannelRuntime,
  createKgChannelContext,
  createRecentChannelContext,
  createVectorChannelContext,
} from "./hybrid/channel-runtime.js";
import {
  HYBRID_ISOLATED_DB_SCOPE_REQUIRED,
  runWithHybridDbAccessScope,
} from "./hybrid/db-access.js";
import { getCanonicalMemoriesByIds } from "../canonical/read-adapter.js";
import { projectHybridResultFromCanonical } from "./hybrid/canonical-result.js";
import { resolveRecentCanaryDecision } from "./hybrid/recent-canary-policy.js";
import { evaluateRecentFailClosedPolicy } from "./hybrid/recent-fail-closed-policy.js";
import { resolveKgFailClosedDecision } from "./hybrid/kg-fail-closed-policy.js";
import {
  evaluateKgTextIdInvariant,
  resolveKgAccessDecision,
} from "./hybrid/kg-id-invariant.js";
import {
  evaluateRecentTextIdInvariant,
  inspectRecentIsolationTopology,
  resolveRecentAccessDecision,
} from "./hybrid/recent-access.js";
import {
  PRODUCTION_DEFAULT_TOP_K,
  normalizeTopK,
  resolveTopKPolicy,
} from "./top-k-policy.js";
import {
  executeOfflineHybridRerankProfile,
  validateOfflineHybridRerankProfile,
} from "./hybrid/offline-rerank-profile.js";
import { executeExplicitSearchRerankProfile } from "./hybrid/explicit-search-rerank-profile.js";

export const inferCategoryFromPath = inferCategoryFromPathHelper;

export function validateSearchNowSec(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("hybrid_search_now_sec_must_be_positive_safe_integer");
  }
  return value;
}

export function resolveSearchNowSec(value, nowMs = Date.now) {
  if (value !== undefined) return validateSearchNowSec(value);
  const currentMs = nowMs();
  if (typeof currentMs !== "number" || !Number.isFinite(currentMs)) {
    throw new Error("hybrid_search_clock_unavailable");
  }
  return validateSearchNowSec(Math.floor(currentMs / 1000));
}

function lexicalMatchScore(haystack, terms) {
  if (!Array.isArray(terms) || terms.length === 0) return 0;
  const raw = String(haystack || "").toLowerCase();
  let matched = 0;
  for (const term of terms) {
    if (!term) continue;
    if (raw.includes(term)) matched += 1;
  }
  if (matched === 0) return 0;
  return round4(matched / terms.length);
}

const {
  warnVectorChannelOnce,
  warnHybridSearchOnce,
} = createHybridWarnings();

const MAX_CHANNEL_PROVENANCE_IDS = 32;
const MAX_FUSION_PROVENANCE_IDS = 8;
const BOUNDED_MEMORY_ID_LENGTH = 16;

function toBoundedMemoryId(candidate) {
  const id = candidate && typeof candidate === "object" ? candidate.id : candidate;
  if (typeof id !== "string" && typeof id !== "number") return null;
  const boundedId = String(id).slice(0, BOUNDED_MEMORY_ID_LENGTH);
  return boundedId || null;
}

function buildChannelCandidateProvenance(channels, names) {
  return Object.fromEntries(names.map(name => {
    const candidates = Array.isArray(channels[name]) ? channels[name] : [];
    const ids = candidates
      .slice(0, MAX_CHANNEL_PROVENANCE_IDS)
      .map(toBoundedMemoryId)
      .filter(Boolean);
    return [name, {
      count: candidates.length,
      captured_count: ids.length,
      truncated: candidates.length > ids.length,
      ids,
    }];
  }));
}

function buildFusionCandidateProvenance(preRerank, postRerank) {
  return {
    pre_rerank_ids: preRerank
      .slice(0, MAX_FUSION_PROVENANCE_IDS)
      .map(toBoundedMemoryId)
      .filter(Boolean),
    post_rerank_ids: postRerank
      .slice(0, MAX_FUSION_PROVENANCE_IDS)
      .map(toBoundedMemoryId)
      .filter(Boolean),
  };
}

const RECENT_CHANNEL_NAMES = ["like", "recent", "episode", "recent_fallback"];

function hasServedRecentCandidates(channels = {}) {
  return RECENT_CHANNEL_NAMES.some(name => Array.isArray(channels[name]) && channels[name].length > 0);
}

const CANONICAL_RESULT_FAILURE_REASONS = [
  "core_not_found",
  "core_ambiguous",
  "core_malformed",
  "engine_ambiguous",
  "engine_malformed",
  "invalid_db_topology",
];

function createCanonicalResultProjectionSummary(requestedCount) {
  return {
    attempted: true,
    requested_count: requestedCount,
    resolved_count: 0,
    dropped_count: 0,
    dropped_reasons: Object.fromEntries([
      ...CANONICAL_RESULT_FAILURE_REASONS,
    ].map(reason => [reason, 0])),
    category_mismatch_count: 0,
    path_mismatch_count: 0,
    management_mismatch_count: 0,
  };
}

function recordCanonicalDrop(summary, reason) {
  const normalizedReason = CANONICAL_RESULT_FAILURE_REASONS.includes(reason)
    ? reason
    : "core_malformed";
  summary.dropped_count += 1;
  summary.dropped_reasons[normalizedReason] += 1;
}

function projectCanonicalHybridResults(servedCandidates, { withCoreDb, withEngineDb }) {
  const summary = createCanonicalResultProjectionSummary(servedCandidates.length);
  const batch = getCanonicalMemoriesByIds(
    servedCandidates.map(item => item.id),
    { withCoreDb, withEngineDb },
  );
  if (!batch.ok) {
    const reason = batch.reason || "core_malformed";
    summary.dropped_count = servedCandidates.length;
    if (summary.dropped_reasons[reason] === undefined) summary.dropped_reasons[reason] = 0;
    summary.dropped_reasons[reason] += servedCandidates.length;
    return { results: [], summary };
  }

  const results = [];
  for (const [index, item] of servedCandidates.entries()) {
    const resolved = batch.results[index];
    if (!resolved?.ok || !resolved.memory) {
      recordCanonicalDrop(summary, resolved?.reason);
      continue;
    }

    const canonical = resolved.memory;
    if (item.category !== canonical.classification.category) summary.category_mismatch_count += 1;
    if ((item.path || "") !== (canonical.source.path || "")) summary.path_mismatch_count += 1;
    const canonicalMode = canonical.lifecycle.management === "managed" ? "managed" : "external";
    if (item.confidence_mode !== canonicalMode) summary.management_mismatch_count += 1;

    try {
      results.push(projectHybridResultFromCanonical(item, canonical));
      summary.resolved_count += 1;
    } catch {
      recordCanonicalDrop(summary, "core_malformed");
    }
  }
  return { results, summary };
}

export async function hybridSearch(text, { topK = PRODUCTION_DEFAULT_TOP_K } = {}, runtime = {}) {
  const {
    calcRealtimeConf,
    categoryMap = null,
    cfg = null,
    getLancedbTable: getLancedbTableRuntime = null,
    getLancedbRuntime: getLancedbRuntimeRuntime = null,
    vectorReadyTimeoutMs = 400,
    generateEmbedding: generateEmbeddingRuntime = null,
    vectorQueryPlan: vectorQueryPlanRuntime = null,
    recallHintVectorExecutionMode: recallHintVectorExecutionModeRuntime = "sequential",
    recallHintDebug: recallHintDebugRuntime = null,
    getMemorySearchManager: getMemorySearchManagerRuntime = null,
    kgFailClosedMode = undefined,
    kgFailClosedCanary = null,
    recentFailClosedMode = undefined,
    recentFailClosedCanary = null,
    hybridRetrieval: hybridRetrievalRuntime = null,
    trustedRuntimeContext = null,
    offlineRerankProfile = null,
    explicitSearchRerankProfile = null,
  } = runtime;
  const topKPolicy = resolveTopKPolicy(runtime);
  const requestedTopK = normalizeTopK(topK, { policy: topKPolicy });
  const hybridRetrieval = hybridRetrievalRuntime
    || resolveEffectiveHybridRuntimeConfig({ apiConfig: cfg }).hybridRetrieval;
  const recallConfig = hybridRetrieval.recall || {};
  const configuredRecallTopK = normalizeTopK(recallConfig.topK, { policy: topKPolicy });
  const k = requestedTopK || configuredRecallTopK;
  const offlineProfile = offlineRerankProfile === null || offlineRerankProfile === undefined
    ? null
    : validateOfflineHybridRerankProfile(offlineRerankProfile, k);
  if (offlineProfile && (typeof text !== "string" || text.trim().length === 0)) {
    throw new TypeError("offline_hybrid_rerank_query_must_be_nonempty_string");
  }
  if (typeof runtime?.withHybridDbAccessScope !== "function") {
    const error = new Error(HYBRID_ISOLATED_DB_SCOPE_REQUIRED);
    error.code = HYBRID_ISOLATED_DB_SCOPE_REQUIRED;
    throw error;
  }
  if (typeof calcRealtimeConf !== "function") throw new Error("hybridSearch runtime.calcRealtimeConf is required");
  const searchClockProvided = Object.hasOwn(runtime, "searchNowSec");
  const resolvedSearchNowSec = searchClockProvided
    ? validateSearchNowSec(runtime.searchNowSec)
    : resolveSearchNowSec(undefined);
  return runWithHybridDbAccessScope(runtime, async ({ withCoreDb, withEngineDb, capabilities }) => {
  const getMemorySearchManagerFn = typeof getMemorySearchManagerRuntime === "function"
    ? getMemorySearchManagerRuntime
    : (await import("openclaw/plugin-sdk/memory-core-engine-runtime")).getMemorySearchManager;
  const rankingConfig = hybridRetrieval.ranking || {};
  const vectorTopK = recallConfig.vectorTopK;
  const ftsTopK = recallConfig.ftsTopK;
  const likePatternTopN = recallConfig.likePatternTopN;
  const likeTopK = recallConfig.likeTopK;
  const recentTopK = recallConfig.recentTopK;
  const recentRerankTopK = recallConfig.recentRerankTopK;
  const recentFallbackTopK = recallConfig.recentFallbackTopK;
  const rrfK = rankingConfig.rrfK;
  const nowSec = resolvedSearchNowSec;
  const minConfidence = hybridRetrieval.effectiveMinConfidence;
  const lexicalConfidenceThreshold = hybridRetrieval.effectiveLexicalConfidenceThreshold;
  const channels = {};
  const rawQuery = String(text || "");
  const strippedQuery = stripPromptMetadataPrefix(rawQuery);
  const normalizedQuery = normalizeFtsQuery(strippedQuery);
  const fallbackFtsQuery = buildFtsFallbackQuery(strippedQuery);
  const fallbackRerankTerms = extractFtsFallbackTerms(fallbackFtsQuery);
  const queryTerms = tokenizeQuery(normalizedQuery);
  const exactFragments = extractExactQueryFragments(strippedQuery, 8);
  const candidateCounts = createCandidateCounts();
  const debug = createHybridDebug({
    rawQuery,
    strippedQuery,
    normalizedQuery,
    queryTerms,
    candidateCounts,
    minConfidence,
    lexicalConfidenceThreshold,
    recallHintDebug: recallHintDebugRuntime,
  });
  if (searchClockProvided) debug.search_now_sec = nowSec;

  debug.sync = {
    synced: false,
    reason: "read_only_search",
  };

  const confidenceRows = withEngineDb(db => db.prepare(
    "SELECT chunk_id, confidence, last_confidence_update, base_tau, hit_count, is_protected, conflict_flag, category, is_archived FROM memory_confidence"
  ).all());
  const confidenceMap = new Map(confidenceRows.map(row => [row.chunk_id, row]));
  const chunkRows = withCoreDb(db => db.prepare("SELECT id, path, updated_at FROM chunks").all());
  const chunkMetaMap = new Map(chunkRows.map(row => [row.id, row]));
  const kgTextIdInvariant = evaluateKgTextIdInvariant({
    engineRows: confidenceRows,
    coreRows: chunkRows,
  });
  const kgAccessDecision = resolveKgAccessDecision({
    isolatedKgCapability: capabilities?.isolatedKg,
    invariant: kgTextIdInvariant,
  });
  const recentTextIdInvariant = evaluateRecentTextIdInvariant({
    engineRows: confidenceRows,
    coreRows: chunkRows,
  });
  const recentIsolationTopology = capabilities?.isolatedRecent === true
    ? inspectRecentIsolationTopology({ withCoreDb, withEngineDb })
    : null;
  const recentAccessDecision = resolveRecentAccessDecision({
    isolatedRecentCapability: capabilities?.isolatedRecent,
    invariant: recentTextIdInvariant,
    topology: recentIsolationTopology,
  });
  const recentFailClosedDecision = evaluateRecentFailClosedPolicy({
    runtimeContext: trustedRuntimeContext,
    config: {
      mode: recentFailClosedMode,
      canary: recentFailClosedCanary,
    },
  });
  const kgFailClosedDecision = resolveKgFailClosedDecision({
    mode: kgFailClosedMode,
    canary: kgFailClosedCanary,
    context: trustedRuntimeContext,
  });
  for (const [prefix, decision] of [
    ["kg", kgFailClosedDecision],
    ["recent", recentFailClosedDecision],
  ]) {
    if (decision?.eligible !== true || decision.mode !== "full_fail_closed") continue;
    debug[`${prefix}_runtime_mode`] = "full_fail_closed";
    debug[`${prefix}_rollout_scope`] = "full";
    debug[`${prefix}_scope_required`] = false;
    debug[`${prefix}_fail_closed_scope_match`] = null;
    debug[`${prefix}_fail_closed_applied`] = false;
    debug[`${prefix}_fail_closed_fallback_suppressed`] = false;
    debug[`${prefix}_fail_closed_empty_candidate`] = false;
  }
  let recentCanaryDecision = resolveRecentCanaryDecision({
    scope: runtime.recentCanaryContext,
    provider: runtime.recentCanaryProvider,
  });
  if (recentCanaryDecision.mode === "shadow" && recentAccessDecision.requested !== true) {
    recentCanaryDecision = {
      ...recentCanaryDecision,
      mode: "off",
      reason: "isolated_recent_unavailable",
      sampled: false,
    };
  }

  const normalizeCandidate = row => normalizeExternalMemory(row, {
    nowSec,
    calcRealtimeConf,
    categoryMap,
  });
  const filterForRerank = item => isCandidateAllowedForRerank(item, minConfidence);
  const channelRuntime = createHybridChannelRuntime({
    dataAccess: {
      withCoreDb,
      withEngineDb,
      confidenceMap,
      chunkMetaMap,
      getLancedbRuntime: getLancedbRuntimeRuntime,
      getLancedbTable: getLancedbTableRuntime,
      getMemorySearchManager: getMemorySearchManagerFn,
    },
    query: {
      normalizedQuery,
      strippedQuery,
      fallbackFtsQuery,
      fallbackRerankTerms,
      queryTerms,
      exactFragments,
    },
    limits: {
      likePatternTopN,
      ftsTopK,
      likeTopK,
      recentTopK,
      recentRerankTopK,
      recentFallbackTopK,
      vectorTopK,
      vectorReadyTimeoutMs,
    },
    rankingPolicy: {
      nowSec,
      rankingConfig,
      categoryMap,
      normalizeCandidate,
      filterForRerank,
      enrichLexicalCandidate,
      inferCategoryFromChunk,
      lexicalMatchScore,
      computeRecencyBoost,
      normalizeUnixSeconds,
      toFiniteNumber,
    },
    accessPolicy: {
      ftsAccessMode: "isolated",
      kgAccessMode: kgAccessDecision.mode,
      kgIsolationRequested: kgAccessDecision.requested,
      kgIsolationFallbackReason: kgAccessDecision.fallback_reason,
      kgFailClosedDecision,
      recentAccessMode: recentAccessDecision.mode,
      recentIsolationRequested: recentAccessDecision.requested,
      recentIsolationFallbackReason: recentAccessDecision.fallback_reason,
      recentFailClosedDecision,
      recentCanaryDecision,
    },
    vectorRuntime: {
      generateEmbedding: generateEmbeddingRuntime,
      vectorQueryPlan: vectorQueryPlanRuntime,
      recallHintVectorExecutionMode: recallHintVectorExecutionModeRuntime,
      cfg,
    },
    telemetry: {
      toDebugErrorMessage,
      warnHybridSearchOnce,
      warnVectorChannelOnce,
    },
    state: {
      channels,
      debug,
      candidateCounts,
    },
  });
  debug.recent_canary_mode = recentCanaryDecision.mode;
  debug.recent_canary_reason = recentCanaryDecision.reason;
  debug.recent_canary_scope_class = recentCanaryDecision.scope_class;
  debug.recent_canary_sampled = recentCanaryDecision.sampled === true;
  debug.recent_canary_shadow_executed = false;
  debug.recent_canary_served_mode = "none";
  debug.recent_canary_policy_error = recentCanaryDecision.policy_error === true;

  await collectKgCandidates(createKgChannelContext(channelRuntime));
  const { ftsIsEmpty } = await collectFtsCandidates(createFtsChannelContext(channelRuntime));

  const lexicalChannels = {};
  if (Array.isArray(channels.kg) && channels.kg.length > 0) lexicalChannels.kg = channels.kg;
  if (Array.isArray(channels.fts) && channels.fts.length > 0) lexicalChannels.fts = channels.fts;
  const lexicalFusion = fuseChannels(lexicalChannels, { rrfK, nowSec, rankingConfig });
  const lexicalFusedSorted = [...lexicalFusion.fused].sort((a, b) => b.finalScore - a.finalScore);
  Object.assign(debug, computeLexicalConfidence(lexicalFusedSorted));

  const shouldSkipVector = debug.lexical_confidence >= lexicalConfidenceThreshold && lexicalFusedSorted.length > 0;
  await collectVectorCandidates(createVectorChannelContext(channelRuntime, { shouldSkipVector }));
  await collectRecentCandidates(createRecentChannelContext(channelRuntime, { ftsIsEmpty }));
  debug.recent_canary_served_mode = recentCanaryDecision.mode === "shadow"
    ? "none"
    : recentAccessDecision.mode === "isolated" && hasServedRecentCandidates(channels)
      ? "isolated"
      : "none";

  const { names, fused } = fuseChannels(channels, { rrfK, nowSec, rankingConfig });
  const channelCandidateProvenance = buildChannelCandidateProvenance(channels, names);
  if (names.length === 0) {
    return {
      pool: 0,
      results: [],
      channels: [],
      channel_sizes: {},
      debug: {
        ...debug,
        channel_sizes: {},
        channel_candidate_provenance: {},
        fusion_candidate_provenance: {
          pre_rerank_ids: [],
          post_rerank_ids: [],
        },
        source_breakdown: {},
        category_breakdown: {},
        pre_rerank_top: [],
        post_rerank_top: [],
      },
      note: "no channels returned results",
    };
  }

  const preRerank = [...fused]
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, 8)
    .map(item => ({
      id: item.id.slice(0, 16),
      score: item.rrfScore,
      category: item.category,
      confidence_mode: item.confidence_mode,
      source_type: item.source_type,
      external_badge: item.external_badge,
      decay_eligible: item.decay_eligible,
      archive_eligible: item.archive_eligible,
      sources: item.sources,
      path: item.path,
      preview: String(item.text || "").slice(0, 100),
    }));

  const postRerank = [...fused]
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, 8)
    .map(item => ({
      id: item.id.slice(0, 16),
      score: item.finalScore,
      semantic_score: item.semanticScore,
      rrf_score: item.rrfScore,
      recency_boost: item.recencyBoost,
      category_boost: item.categoryBoost,
      confidence_boost: item.confidenceBoost,
      external_boost: item.externalBoost,
      category: item.category,
      confidence_mode: item.confidence_mode,
      source_type: item.source_type,
      external_badge: item.external_badge,
      decay_eligible: item.decay_eligible,
      archive_eligible: item.archive_eligible,
      sources: item.sources,
      path: item.path,
      preview: String(item.text || "").slice(0, 100),
    }));

  const sourceBreakdown = {};
  const categoryBreakdown = {};
  for (const item of fused) {
    for (const src of item.sources) {
      sourceBreakdown[src] = (sourceBreakdown[src] || 0) + 1;
    }
    const cat = item.category || "unknown";
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
  }

  const fusedSorted = [...fused].sort((a, b) => b.finalScore - a.finalScore);
  const debugInfo = {
    ...debug,
    channel_sizes: Object.fromEntries(names.map(name => [name, channels[name].length])),
    channel_candidate_provenance: channelCandidateProvenance,
    fusion_candidate_provenance: buildFusionCandidateProvenance(preRerank, postRerank),
    source_breakdown: sourceBreakdown,
    category_breakdown: categoryBreakdown,
    pre_rerank_top: preRerank,
    post_rerank_top: postRerank,
  };

  if (explicitSearchRerankProfile) {
    // Existing fusion diagnostics may contain short retrieval previews. The
    // explicit R3 surface has already disclosed canonical full text to the
    // trusted adapter, so keep those previews out of the returned debug
    // object as well.
    debugInfo.pre_rerank_top = debugInfo.pre_rerank_top.map(({ preview: _preview, ...item }) => item);
    debugInfo.post_rerank_top = debugInfo.post_rerank_top.map(({ preview: _preview, ...item }) => item);
    const explicit = await executeExplicitSearchRerankProfile({
      query: strippedQuery,
      fusedSorted,
      topK: k,
      profile: explicitSearchRerankProfile,
      withCoreDb,
      withEngineDb,
    });
    debugInfo.explicit_search_rerank = explicit.debug;
    if (explicit.canonicalProjection) {
      debugInfo.canonical_result_projection = explicit.canonicalProjection;
    }
    const response = {
      pool: fusedSorted.length,
      channels: names,
      channel_sizes: Object.fromEntries(names.map(name => [name, channels[name].length])),
      debug: debugInfo,
      results: explicit.results,
    };
    if (!explicit.ok) {
      response.error = explicit.error;
      response.code = explicit.code;
    }
    return response;
  }

  if (offlineProfile) {
    const offline = await executeOfflineHybridRerankProfile({
      query: strippedQuery,
      fusedSorted,
      topK: k,
      profile: offlineProfile,
      withCoreDb,
      withEngineDb,
    });
    debugInfo.offline_rerank = {
      ...offline.debug,
      projection_metadata: offline.projectionMetadata || [],
      projection_total_code_points: offline.totalCodePoints || 0,
    };
    debugInfo.canonical_result_projection = offline.canonicalProjection;
    return {
      pool: fusedSorted.length,
      channels: names,
      channel_sizes: Object.fromEntries(names.map(name => [name, channels[name].length])),
      debug: debugInfo,
      results: offline.results,
    };
  }

  const servedCandidates = fusedSorted.slice(0, k);
  const canonicalProjection = projectCanonicalHybridResults(servedCandidates, {
    withCoreDb,
    withEngineDb,
  });
  debugInfo.canonical_result_projection = canonicalProjection.summary;
  const results = canonicalProjection.results;

  return {
    pool: fusedSorted.length,
    channels: names,
    channel_sizes: Object.fromEntries(names.map(name => [name, channels[name].length])),
    debug: debugInfo,
    results,
  };
  });
}
