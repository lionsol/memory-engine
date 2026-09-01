import { hybridSearch } from "../hybrid-search.js";
import { recordHybridSearchObservation } from "../hybrid-observation.js";

const HYBRID_RUNTIME_CONTEXT = Symbol("memoryEngineHybridRuntimeContext");

function freezeGroup(value = {}) {
  return Object.freeze({ ...(value || {}) });
}

export function createHybridRuntimeContext({
  dataAccess = {},
  retrievalPolicy = {},
  telemetry = {},
} = {}) {
  return Object.freeze({
    [HYBRID_RUNTIME_CONTEXT]: true,
    dataAccess: freezeGroup(dataAccess),
    retrievalPolicy: freezeGroup({
      ...retrievalPolicy,
      hybridSearch: retrievalPolicy?.hybridSearch || hybridSearch,
    }),
    telemetry: freezeGroup({
      ...telemetry,
      recordHybridSearchObservation: telemetry?.recordHybridSearchObservation || recordHybridSearchObservation,
    }),
  });
}

export function normalizeHybridRuntimeContext(runtime = {}) {
  if (runtime?.[HYBRID_RUNTIME_CONTEXT] === true) return runtime;
  if (runtime?.dataAccess || runtime?.retrievalPolicy || runtime?.telemetry) {
    return createHybridRuntimeContext({
      dataAccess: runtime.dataAccess,
      retrievalPolicy: runtime.retrievalPolicy,
      telemetry: runtime.telemetry,
    });
  }

  return createHybridRuntimeContext({
    dataAccess: {
      withDb: runtime.withDb,
      withHybridDbAccessScope: runtime.withHybridDbAccessScope,
      getLancedbTable: runtime.getLancedbTable,
      getLancedbRuntime: runtime.getLancedbRuntime,
      getMemorySearchManager: runtime.getMemorySearchManager,
    },
    retrievalPolicy: {
      apiConfig: runtime.apiConfig ?? runtime.api?.config ?? null,
      calcRealtimeConf: runtime.calcRealtimeConf,
      syncIndexIfNeeded: runtime.syncIndexIfNeeded,
      categoryMap: runtime.categoryMap ?? runtime.CATEGORY_MAP,
      generateEmbedding: runtime.generateEmbedding,
      hybridSearch: runtime.hybridSearch ?? hybridSearch,
      vectorReadyTimeoutMs: runtime.vectorReadyTimeoutMs,
      recentCanaryProvider: runtime.recentCanaryProvider,
      resolveRecentCanaryContext: runtime.resolveRecentCanaryContext,
      trustedRuntimeContext: runtime.trustedRuntimeContext,
      kgFailClosedMode: runtime.kgFailClosedMode,
      kgFailClosedCanary: runtime.kgFailClosedCanary,
      recentFailClosedMode: runtime.recentFailClosedMode,
      recentFailClosedCanary: runtime.recentFailClosedCanary,
      topKPolicy: runtime.topKPolicy,
    },
    telemetry: {
      recordMemoryEvent: runtime.recordMemoryEvent,
      resolveTrafficOriginContext: runtime.resolveTrafficOriginContext,
      hybridObservationSurface: runtime.hybridObservationSurface,
      recordHybridSearchObservation: runtime.recordHybridSearchObservation || recordHybridSearchObservation,
    },
  });
}

export function buildHybridSearchRuntime(runtime, overrides = {}) {
  const context = normalizeHybridRuntimeContext(runtime);
  const { dataAccess, retrievalPolicy } = context;
  return {
    withDb: dataAccess.withDb,
    withHybridDbAccessScope: dataAccess.withHybridDbAccessScope,
    calcRealtimeConf: retrievalPolicy.calcRealtimeConf,
    syncIndexIfNeeded: retrievalPolicy.syncIndexIfNeeded,
    categoryMap: retrievalPolicy.categoryMap,
    cfg: retrievalPolicy.apiConfig ?? null,
    getLancedbTable: overrides.getLancedbTable || dataAccess.getLancedbTable,
    getLancedbRuntime: dataAccess.getLancedbRuntime,
    vectorReadyTimeoutMs: retrievalPolicy.vectorReadyTimeoutMs,
    generateEmbedding: retrievalPolicy.generateEmbedding,
    getMemorySearchManager: dataAccess.getMemorySearchManager,
    recentCanaryProvider: Object.hasOwn(overrides, "recentCanaryProvider")
      ? overrides.recentCanaryProvider
      : retrievalPolicy.recentCanaryProvider,
    recentCanaryContext: overrides.recentCanaryContext,
    trustedRuntimeContext: Object.hasOwn(overrides, "trustedRuntimeContext")
      ? overrides.trustedRuntimeContext
      : retrievalPolicy.trustedRuntimeContext,
    kgFailClosedMode: retrievalPolicy.kgFailClosedMode,
    kgFailClosedCanary: retrievalPolicy.kgFailClosedCanary,
    recentFailClosedMode: retrievalPolicy.recentFailClosedMode,
    recentFailClosedCanary: retrievalPolicy.recentFailClosedCanary,
    topKPolicy: retrievalPolicy.topKPolicy,
  };
}

export function recordHybridRuntimeObservation(runtime, details = {}) {
  const context = normalizeHybridRuntimeContext(runtime);
  const { telemetry } = context;
  const {
    toolCallId = null,
    trafficOriginContext: explicitTrafficOriginContext,
    ...observation
  } = details;
  const surface = observation.surface || telemetry.hybridObservationSurface || null;
  const trafficOriginContext = explicitTrafficOriginContext !== undefined
    ? explicitTrafficOriginContext
    : typeof telemetry.resolveTrafficOriginContext === "function"
      ? telemetry.resolveTrafficOriginContext(toolCallId, surface)
      : null;
  return telemetry.recordHybridSearchObservation({
    ...observation,
    recordMemoryEvent: telemetry.recordMemoryEvent,
    surface,
    trafficOriginContext,
  });
}
