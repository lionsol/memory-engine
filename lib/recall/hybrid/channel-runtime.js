function freezeGroup(value = {}) {
  return Object.freeze({ ...(value || {}) });
}

export function createHybridChannelRuntime({
  dataAccess = {},
  query = {},
  limits = {},
  rankingPolicy = {},
  accessPolicy = {},
  vectorRuntime = {},
  telemetry = {},
  state = {},
} = {}) {
  return Object.freeze({
    dataAccess: freezeGroup(dataAccess),
    query: freezeGroup(query),
    limits: freezeGroup(limits),
    rankingPolicy: freezeGroup(rankingPolicy),
    accessPolicy: freezeGroup(accessPolicy),
    vectorRuntime: freezeGroup(vectorRuntime),
    telemetry: freezeGroup(telemetry),
    state,
  });
}

function stateView(runtime) {
  return {
    channels: runtime.state.channels,
    debug: runtime.state.debug,
    candidateCounts: runtime.state.candidateCounts,
  };
}

export function createFtsChannelContext(runtime) {
  const { dataAccess, query, limits, rankingPolicy, accessPolicy, telemetry } = runtime;
  return {
    ...stateView(runtime),
    withCoreDb: dataAccess.withCoreDb,
    confidenceMap: dataAccess.confidenceMap,
    ftsAccessMode: "isolated",
    normalizedQuery: query.normalizedQuery,
    fallbackFtsQuery: query.fallbackFtsQuery,
    fallbackRerankTerms: query.fallbackRerankTerms,
    strippedQuery: query.strippedQuery,
    queryTerms: query.queryTerms,
    exactFragments: query.exactFragments,
    nowSec: rankingPolicy.nowSec,
    ftsTopK: limits.ftsTopK,
    normalizeCandidate: rankingPolicy.normalizeCandidate,
    filterForRerank: rankingPolicy.filterForRerank,
    enrichLexicalCandidate: rankingPolicy.enrichLexicalCandidate,
    toDebugErrorMessage: telemetry.toDebugErrorMessage,
    warnHybridSearchOnce: telemetry.warnHybridSearchOnce,
  };
}

export function createKgChannelContext(runtime) {
  const { dataAccess, query, limits, rankingPolicy, accessPolicy, telemetry } = runtime;
  return {
    ...stateView(runtime),
    withCoreDb: dataAccess.withCoreDb,
    withEngineDb: dataAccess.withEngineDb,
    normalizedQuery: query.normalizedQuery,
    strippedQuery: query.strippedQuery,
    queryTerms: query.queryTerms,
    exactFragments: query.exactFragments,
    likePatternTopN: limits.likePatternTopN,
    ftsTopK: limits.ftsTopK,
    categoryMap: rankingPolicy.categoryMap,
    normalizeCandidate: rankingPolicy.normalizeCandidate,
    filterForRerank: rankingPolicy.filterForRerank,
    enrichLexicalCandidate: rankingPolicy.enrichLexicalCandidate,
    inferCategoryFromChunk: rankingPolicy.inferCategoryFromChunk,
    lexicalMatchScore: rankingPolicy.lexicalMatchScore,
    kgAccessMode: accessPolicy.kgAccessMode,
    kgIsolationRequested: accessPolicy.kgIsolationRequested,
    kgIsolationFallbackReason: accessPolicy.kgIsolationFallbackReason,
    kgFailClosedDecision: accessPolicy.kgFailClosedDecision,
    legacyFallbackAllowed: false,
    toDebugErrorMessage: telemetry.toDebugErrorMessage,
    warnHybridSearchOnce: telemetry.warnHybridSearchOnce,
  };
}

export function createVectorChannelContext(runtime, { shouldSkipVector = false } = {}) {
  const { dataAccess, query, limits, rankingPolicy, vectorRuntime, telemetry } = runtime;
  return {
    ...stateView(runtime),
    shouldSkipVector,
    getLancedbRuntimeRuntime: dataAccess.getLancedbRuntime,
    getLancedbTableRuntime: dataAccess.getLancedbTable,
    getMemorySearchManagerFn: dataAccess.getMemorySearchManager,
    confidenceMap: dataAccess.confidenceMap,
    chunkMetaMap: dataAccess.chunkMetaMap,
    strippedQuery: query.strippedQuery,
    vectorTopK: limits.vectorTopK,
    vectorReadyTimeoutMs: limits.vectorReadyTimeoutMs,
    normalizeCandidate: rankingPolicy.normalizeCandidate,
    filterForRerank: rankingPolicy.filterForRerank,
    generateEmbeddingRuntime: vectorRuntime.generateEmbedding,
    vectorQueryPlan: vectorRuntime.vectorQueryPlan,
    recallHintVectorExecutionMode: vectorRuntime.recallHintVectorExecutionMode,
    cfg: vectorRuntime.cfg,
    toDebugErrorMessage: telemetry.toDebugErrorMessage,
    warnVectorChannelOnce: telemetry.warnVectorChannelOnce,
  };
}

export function createRecentChannelContext(runtime, { ftsIsEmpty = false } = {}) {
  const { dataAccess, query, limits, rankingPolicy, accessPolicy, telemetry } = runtime;
  return {
    ...stateView(runtime),
    withCoreDb: dataAccess.withCoreDb,
    withEngineDb: dataAccess.withEngineDb,
    normalizedQuery: query.normalizedQuery,
    queryTerms: query.queryTerms,
    likePatternTopN: limits.likePatternTopN,
    likeTopK: limits.likeTopK,
    recentTopK: limits.recentTopK,
    recentRerankTopK: limits.recentRerankTopK,
    recentFallbackTopK: limits.recentFallbackTopK,
    rankingConfig: rankingPolicy.rankingConfig,
    categoryMap: rankingPolicy.categoryMap,
    normalizeCandidate: rankingPolicy.normalizeCandidate,
    filterForRerank: rankingPolicy.filterForRerank,
    inferCategoryFromChunk: rankingPolicy.inferCategoryFromChunk,
    lexicalMatchScore: rankingPolicy.lexicalMatchScore,
    computeRecencyBoost: rankingPolicy.computeRecencyBoost,
    normalizeUnixSeconds: rankingPolicy.normalizeUnixSeconds,
    toFiniteNumber: rankingPolicy.toFiniteNumber,
    nowSec: rankingPolicy.nowSec,
    recentAccessMode: accessPolicy.recentAccessMode,
    recentIsolationRequested: accessPolicy.recentIsolationRequested,
    recentIsolationFallbackReason: accessPolicy.recentIsolationFallbackReason,
    recentFailClosedDecision: accessPolicy.recentFailClosedDecision,
    legacyFallbackAllowed: false,
    recentTextIdInvariant: accessPolicy.recentTextIdInvariant,
    recentIsolationTopology: accessPolicy.recentIsolationTopology,
    recentCanaryDecision: accessPolicy.recentCanaryDecision,
    ftsIsEmpty,
    uniqueVectorChannels: () => Array.isArray(runtime.state.channels.vector)
      && runtime.state.channels.vector.length > 0,
    toDebugErrorMessage: telemetry.toDebugErrorMessage,
    warnHybridSearchOnce: telemetry.warnHybridSearchOnce,
  };
}
