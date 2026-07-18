import {
  buildFtsFallbackQuery,
  extractExactQueryFragments,
  normalizeFtsQuery,
  stripPromptMetadataPrefix,
} from "../../query-utils.js";
import { getDefaultMemoryEngineConfig } from "../config/defaults.js";
import { getMemoryEngineConfig } from "../config/runtime.js";
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
  resolveLexicalConfidenceThreshold,
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
import { runWithHybridDbAccessScope } from "./hybrid/db-access.js";
import { resolveRecentCanaryDecision } from "./hybrid/recent-canary-policy.js";
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

export const inferCategoryFromPath = inferCategoryFromPathHelper;

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

function resolveEffectiveMinConfidence(cfg = null, engineConfig = null) {
  const mergedConfig = engineConfig || getMemoryEngineConfig(cfg);
  const fromCfg = cfg?.memory?.minConfidence ?? cfg?.autoRecall?.minConfidence ?? mergedConfig?.confidence?.min;
  const fromEnv = process.env.MEMORY_ENGINE_MIN_CONFIDENCE;
  const resolved = toFiniteNumber(fromCfg ?? fromEnv);
  if (resolved === null) {
    return toFiniteNumber(mergedConfig?.confidence?.min)
      ?? toFiniteNumber(getDefaultMemoryEngineConfig()?.confidence?.min)
      ?? 0;
  }
  return Math.max(0, Math.min(1, resolved));
}

const {
  warnVectorChannelOnce,
  warnHybridSearchOnce,
} = createHybridWarnings();

export async function hybridSearch(text, { topK = 5 } = {}, runtime = {}) {
  const {
    withDb,
    calcRealtimeConf,
    syncIndexIfNeeded,
    categoryMap = null,
    cfg = null,
    getLancedbTable: getLancedbTableRuntime = null,
    getLancedbRuntime: getLancedbRuntimeRuntime = null,
    vectorReadyTimeoutMs = 400,
    generateEmbedding: generateEmbeddingRuntime = null,
    getMemorySearchManager: getMemorySearchManagerRuntime = null,
    kgFailClosedMode = undefined,
    kgFailClosedCanary = null,
    trustedRuntimeContext = null,
  } = runtime;
  if (typeof runtime.withHybridDbAccessScope !== "function" && typeof withDb !== "function") {
    throw new Error("hybridSearch runtime.withDb is required");
  }
  if (typeof calcRealtimeConf !== "function") throw new Error("hybridSearch runtime.calcRealtimeConf is required");
  if (typeof syncIndexIfNeeded !== "function") throw new Error("hybridSearch runtime.syncIndexIfNeeded is required");
  return runWithHybridDbAccessScope(runtime, async ({ withCoreDb, withEngineDb, withLegacyDb, capabilities }) => {
  const getMemorySearchManagerFn = typeof getMemorySearchManagerRuntime === "function"
    ? getMemorySearchManagerRuntime
    : (await import("openclaw/plugin-sdk/memory-core-engine-runtime")).getMemorySearchManager;
  const engineConfig = getMemoryEngineConfig(cfg);
  const recallConfig = engineConfig.recall || {};
  const rankingConfig = engineConfig.ranking || {};
  const recallDefaultTopK = Math.max(1, Number(recallConfig.topK) || 5);
  const k = Math.max(1, Number(topK || recallDefaultTopK) || recallDefaultTopK);
  const vectorTopK = Math.max(1, Number(recallConfig.vectorTopK) || 30);
  const ftsTopK = Math.max(1, Number(recallConfig.ftsTopK) || 20);
  const likePatternTopN = Math.max(1, Number(recallConfig.likePatternTopN) || 8);
  const likeTopK = Math.max(1, Number(recallConfig.likeTopK) || 30);
  const recentTopK = Math.max(1, Number(recallConfig.recentTopK) || 120);
  const recentRerankTopK = Math.max(1, Number(recallConfig.recentRerankTopK) || 20);
  const recentFallbackTopK = Math.max(1, Number(recallConfig.recentFallbackTopK) || recentRerankTopK);
  const rrfK = Math.max(1, Number(rankingConfig.rrfK) || 60);
  const nowSec = Math.floor(Date.now() / 1000);
  const minConfidence = resolveEffectiveMinConfidence(cfg, engineConfig);
  const lexicalConfidenceThreshold = resolveLexicalConfidenceThreshold(cfg, engineConfig);
  const channels = {};
  const rawQuery = String(text || "");
  const strippedQuery = stripPromptMetadataPrefix(rawQuery);
  const normalizedQuery = normalizeFtsQuery(strippedQuery);
  const fallbackFtsQuery = buildFtsFallbackQuery(strippedQuery);
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
  });

  try {
    debug.sync = await syncIndexIfNeeded("hybridSearch");
  } catch (e) {
    debug.sync = { synced: false, reason: "sync_error", error: e.message };
  }

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
  const kgFailClosedDecision = resolveKgFailClosedDecision({
    mode: kgFailClosedMode,
    canary: kgFailClosedCanary,
    context: trustedRuntimeContext,
  });
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
  const channelCtx = {
    withDb: withLegacyDb,
    withCoreDb,
    withEngineDb,
    ftsAccessMode: capabilities?.isolatedFts === true ? "isolated" : "legacy",
    kgAccessMode: kgAccessDecision.mode,
    kgIsolationRequested: kgAccessDecision.requested,
    kgIsolationFallbackReason: kgAccessDecision.fallback_reason,
    kgFailClosedDecision,
    kgTextIdInvariant,
    recentAccessMode: recentAccessDecision.mode,
    recentIsolationRequested: recentAccessDecision.requested,
    recentIsolationFallbackReason: recentAccessDecision.fallback_reason,
    recentTextIdInvariant,
    recentIsolationTopology,
    recentCanaryDecision,
    channels,
    debug,
    candidateCounts,
    normalizedQuery,
    strippedQuery,
    fallbackFtsQuery,
    queryTerms,
    exactFragments,
    likePatternTopN,
    ftsTopK,
    likeTopK,
    recentTopK,
    recentRerankTopK,
    recentFallbackTopK,
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
    toDebugErrorMessage,
    warnHybridSearchOnce,
    warnVectorChannelOnce,
    confidenceMap,
    chunkMetaMap,
    vectorTopK,
    vectorReadyTimeoutMs,
    generateEmbeddingRuntime,
    getLancedbRuntimeRuntime,
    getLancedbTableRuntime,
    getMemorySearchManagerFn,
    cfg,
    uniqueVectorChannels: () => Array.isArray(channels.vector) && channels.vector.length > 0,
  };
  debug.recent_canary_mode = recentCanaryDecision.mode;
  debug.recent_canary_reason = recentCanaryDecision.reason;
  debug.recent_canary_scope_class = recentCanaryDecision.scope_class;
  debug.recent_canary_sampled = recentCanaryDecision.sampled === true;
  debug.recent_canary_shadow_executed = false;
  debug.recent_canary_served_mode = "legacy";
  debug.recent_canary_policy_error = recentCanaryDecision.policy_error === true;

  await collectKgCandidates(channelCtx);
  const { ftsIsEmpty } = await collectFtsCandidates(channelCtx);

  const lexicalChannels = {};
  if (Array.isArray(channels.kg) && channels.kg.length > 0) lexicalChannels.kg = channels.kg;
  if (Array.isArray(channels.fts) && channels.fts.length > 0) lexicalChannels.fts = channels.fts;
  const lexicalFusion = fuseChannels(lexicalChannels, { rrfK, nowSec, rankingConfig });
  const lexicalFusedSorted = [...lexicalFusion.fused].sort((a, b) => b.finalScore - a.finalScore);
  Object.assign(debug, computeLexicalConfidence(lexicalFusedSorted));

  const shouldSkipVector = debug.lexical_confidence >= lexicalConfidenceThreshold && lexicalFusedSorted.length > 0;
  await collectVectorCandidates({ ...channelCtx, shouldSkipVector });
  await collectRecentCandidates({ ...channelCtx, ftsIsEmpty });

  const { names, fused } = fuseChannels(channels, { rrfK, nowSec, rankingConfig });
  if (names.length === 0) {
    return {
      pool: 0,
      results: [],
      channels: [],
      channel_sizes: {},
      debug: {
        ...debug,
        channel_sizes: {},
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
    source_breakdown: sourceBreakdown,
    category_breakdown: categoryBreakdown,
    pre_rerank_top: preRerank,
    post_rerank_top: postRerank,
  };

  const results = fusedSorted.slice(0, k).map(item => ({
    id: item.id.slice(0, 16),
    text: item.text.slice(0, 240),
    path: item.path || "",
    category: item.category,
    confidence_mode: item.confidence_mode,
    source_type: item.source_type,
    external_badge: item.external_badge,
    decay_eligible: item.decay_eligible,
    archive_eligible: item.archive_eligible,
    semantic_score: item.semanticScore,
    rrf_score: item.rrfScore,
    recency_boost: item.recencyBoost,
    category_boost: item.categoryBoost,
    confidence_boost: item.confidenceBoost,
    external_boost: item.externalBoost,
    final_score: item.finalScore,
    sources: item.sources,
    similarity: item.similarity,
    confidence: item.confidence,
    hits: item.hits,
    created_at: item.created_at || 0,
  }));

  return {
    pool: fusedSorted.length,
    channels: names,
    channel_sizes: Object.fromEntries(names.map(name => [name, channels[name].length])),
    debug: debugInfo,
    results,
  };
  });
}
