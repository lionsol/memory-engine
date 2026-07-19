import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { getMemorySearchManager } from "openclaw/plugin-sdk/memory-core-engine-runtime";
import { buildSmartAddFingerprint } from "./smart-add-fingerprint.js";
import { dateStrInTimeZone } from "./date-utils.js";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import {
  explainAutoRecallSkip,
  formatAutoRecallCardContext,
  formatAutoRecallContext,
  parseCitedMemoryIds,
  shouldInjectCandidate,
  shouldUseAutoRecallCardRuntime,
} from "./auto-recall.js";
import {
  buildFtsFallbackQuery,
  normalizeFtsQuery,
  stripPromptMetadataPrefix,
} from "./query-utils.js";
import { appendSmartAdd } from "./smart-add.js";
import {
  HOME_DIR,
  INDEX_SYNC_WATCH_DIRS,
  SMART_ADD_DIR,
  WORKSPACE,
  getSharedMemoryManager,
} from "./memory-manager-runtime.js";
import { ensureEngineWritable, withEngineDb, withEngineDbSession } from "./lib/db/engine-db.js";
import { withCoreDbReadonly, withEngineDbIsolated } from "./lib/db/isolated-dbs.js";
import { getMemoryEngineConfig } from "./lib/config/runtime.js";
import { getSmartAddTimeZone } from "./lib/config/helpers.js";
import { resolveEffectiveHybridRuntimeConfig } from "./lib/config/effective-hybrid-runtime-config.js";
import { insertMemoryEvent } from "./lib/db/events.js";
import { ensureMemoryEngineTables, migrateLegacyMemoryEventsFromCore } from "./lib/db/schema.js";
import {
  createBackfillConfidenceForIndexedChunks,
  createIndexSyncRuntime,
} from "./lib/index-sync-runtime.js";
import { createLanceDbRuntime, DEFAULT_LANCEDB_READY_TIMEOUT_MS } from "./lib/lancedb-runtime.js";
import {
  autoRouteCategory,
  batchReinforce,
  buildRecallCompletedMetadata,
  calcRealtimeConf,
  calcTau,
  CATEGORY_MAP,
  catParams,
  gateThresholdForCategory,
  inferCategoryFromChunk,
  resolvePrefixes,
} from "./lib/memory-confidence.js";
import {
  buildReinforcementAllowedIds,
  filterCitedIdsForReinforcement,
} from "./lib/recall/auto-recall-reinforcement.js";
import { analyzeAutoRecallIntent } from "./lib/recall/auto-recall-intent.js";
import { evaluateAutoRecallRuntimeGate } from "./lib/recall/auto-recall-runtime-gate.js";
import { createAutoRecallTurnStateManager } from "./lib/recall/auto-recall-turn-state.js";
import { collectIndexedFiles, readIndexedPathState } from "./lib/sync/index-sync.js";
import { hybridSearch as runHybridSearch } from "./lib/recall/hybrid-search.js";
import { recordHybridSearchObservation } from "./lib/recall/hybrid-observation.js";
import { createProductionEvidenceIdentityContext } from "./lib/recall/hybrid/production-evidence-identity.js";
import { createIsolatedHybridDbAccessScope } from "./lib/recall/hybrid/db-access.js";
import { createMemoryEngineExecute } from "./lib/tools/memory-engine-actions.js";
import {
  createMemoryEngineGetExecute,
  createMemoryEngineSearchExecute,
} from "./lib/tools/memory-engine-actions.js";
import { registerMemoryEngineTools } from "./lib/tools/register-memory-engine-tools.js";
import { generateEmbedding } from "./lib/siliconflow-runtime.js";

const KG_PATH = resolve(HOME_DIR, ".openclaw/workspace/knowledge-graph.json");
const LANCEDB_PATH = resolve(HOME_DIR, ".openclaw/memory/lancedb");
const MEMORY_SUPPLEMENT_SENTINEL = "MEMORY_SUPPLEMENT_SENTINEL";
const MEMORY_SUPPLEMENT_BOUNDARY_START = "<!-- MEMORY_ENGINE_SUPPLEMENT_START -->";
const MEMORY_SUPPLEMENT_BOUNDARY_END = "<!-- MEMORY_ENGINE_SUPPLEMENT_END -->";
let memoryStorageReady = false;
const {
  ensureLanceDBReady,
  getLanceDBRuntime,
  getLancedbTable,
} = createLanceDbRuntime({
  dbPath: LANCEDB_PATH,
  readyTimeoutMs: DEFAULT_LANCEDB_READY_TIMEOUT_MS,
});

function withDb(fn, options = {}) {
  return withEngineDb(fn, { readonly: false, ...options });
}

withDb.scoped = function scopedWithDb(run) {
  return withEngineDbSession(session => run((fn, options = {}) => withDb(fn, { ...options, session })));
};

function recordMemoryEvent(event) {
  if (!memoryStorageReady) return;
  try {
    withDb(db => {
      insertMemoryEvent(db, event, { defaultSource: null });
    });
  } catch (e) {
    console.warn("[memory-engine] memory event write failed:", e.message);
  }
}

function buildAutoRecallDebugMetadata(prompt, result, skipReason = null, options) {
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
  const strippedPrompt = stripPromptMetadataPrefix(prompt);
  const normalizedQuery = String(debugInfo.query_normalized || normalizeFtsQuery(strippedPrompt));
  const finalFtsQuery = String(
    debugInfo.fts_query_final ||
    buildFtsFallbackQuery(strippedPrompt) ||
    normalizedQuery
  );
  const postRerankTopK = Array.isArray(debugInfo.post_rerank_topK) ? debugInfo.post_rerank_topK : [];
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
    query_original: String(prompt || ""),
    query_stripped: String(debugInfo.query_stripped || strippedPrompt),
    query_normalized: normalizedQuery,
    fts_query_final: finalFtsQuery,
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
    rejected_candidates: Array.isArray(debugInfo.rejected_candidates) ? debugInfo.rejected_candidates : [],
    gate_decisions: Array.isArray(debugInfo.gate_decisions) ? debugInfo.gate_decisions : [],
    injected_count: Number(debugInfo.injected_count ?? 0),
    recall_intent_should_recall: debugInfo.recall_intent_should_recall ?? null,
    recall_intent_reason: debugInfo.recall_intent_reason ?? null,
    long_input_detected: debugInfo.long_input_detected ?? null,
    generic_task_detected: debugInfo.generic_task_detected ?? null,
    focused_query: debugInfo.focused_query ?? null,
    focused_query_chars: debugInfo.focused_query_chars ?? null,
    original_input_chars: debugInfo.original_input_chars ?? null,
    skipped_by_recall_intent: debugInfo.skipped_by_recall_intent ?? false,
    skipped: Boolean(skipReason),
    skip_reason: skipReason || null,
    candidate_counts_before_filtering: debugInfo.candidate_counts_before_filtering || {},
    ...buildAutoRecallHybridAccessMetadata(debugInfo, options && options.searchExecuted === true),
  };
}

function resolveHookSessionId(event, ctx) {
  return event?.sessionId ||
    event?.session_id ||
    event?.sessionKey ||
    ctx?.sessionId ||
    ctx?.sessionKey ||
    ctx?.runId ||
    null;
}

const backfillConfidenceForIndexedChunks = createBackfillConfidenceForIndexedChunks({
  catParams,
  inferCategoryFromChunk,
  withCoreDb: fn => withCoreDbReadonly(fn),
  withEngineDb: fn => withEngineDbIsolated(fn, { readonly: false }),
});

const syncIndexIfNeeded = createIndexSyncRuntime({
  memoryRoot: WORKSPACE,
  watchDirs: INDEX_SYNC_WATCH_DIRS,
  withCoreDb: fn => withCoreDbReadonly(fn),
  withEngineDb: fn => withEngineDbIsolated(fn, { readonly: false }),
  getSharedMemoryManager,
  collectIndexedFiles,
  readIndexedPathState,
  backfillConfidenceForIndexedChunks,
});

export default definePluginEntry({
  id: "memory-engine",
  name: "Memory Engine",
  description: "Smart memory with confidence scoring, time-decay, and lifecycle management.",
  contracts: {
    tools: true,
  },
  register(api) {
    // Ensure confidence table exists at startup
    try {
      withDb(db => {
        ensureMemoryEngineTables(db);
        const migration = migrateLegacyMemoryEventsFromCore(db);
        if ((migration?.migrated || 0) > 0) {
          console.log(`[memory-engine] migrated ${migration.migrated} legacy memory_events rows from core DB`);
        }
      });
      memoryStorageReady = ensureEngineWritable();
    } catch (e) {
      console.error("[memory-engine] failed to init confidence table:", e.message);
      memoryStorageReady = false;
    }

    // Initialize LanceDB readiness as early as possible.
    void ensureLanceDBReady();

    const autoRecallTurnState = createAutoRecallTurnStateManager();
    const withHybridDbAccessScope = createIsolatedHybridDbAccessScope({
      withLegacyDb: withDb,
    });
    const memoryEngineConfig = getMemoryEngineConfig(api?.config || null);
    const smartAddTimeZone = getSmartAddTimeZone(api?.config || null);
    const pluginEntryConfig = api.config?.plugins?.entries?.["memory-engine"]?.config;
    const effectiveRuntimeConfigResult = resolveEffectiveHybridRuntimeConfig({
      pluginConfig: api.pluginConfig,
      pluginEntryConfig,
      apiConfig: api.config,
      memoryEngineConfig,
    });
    const {
      valid: effectiveRuntimeConfigValid,
      errors: effectiveRuntimeConfigErrors,
      ...effectiveRuntimeConfig
    } = effectiveRuntimeConfigResult;
    const productionEvidenceIdentityContext = createProductionEvidenceIdentityContext({
      config: effectiveRuntimeConfig,
      configErrors: effectiveRuntimeConfigValid ? [] : effectiveRuntimeConfigErrors,
    });
    const embeddingRuntimeConfig = api.config || pluginEntryConfig || null;
    const generateEmbeddingRuntime = text => generateEmbedding(text, {
      cfg: embeddingRuntimeConfig,
      apiConfig: api.config || null,
    });
    const autoRecallConfig = effectiveRuntimeConfig.autoRecall;
    const kgFailClosedMode = effectiveRuntimeConfig.kgFailClosedMode;
    const kgFailClosedCanary = effectiveRuntimeConfig.kgFailClosedCanary;
    const recentFailClosedMode = effectiveRuntimeConfig.recentFailClosedMode;
    const recentFailClosedCanary = effectiveRuntimeConfig.recentFailClosedCanary;
    const trustedToolTrafficOrigins = new Map();
    const resolveTrafficOriginContext = toolCallId => {
      if (!toolCallId) return null;
      const context = trustedToolTrafficOrigins.get(toolCallId) || null;
      trustedToolTrafficOrigins.delete(toolCallId);
      return context;
    };
    if (typeof api.on === "function") {
      api.on("before_tool_call", async (event, ctx) => {
        const toolName = event?.toolName || ctx?.toolName || null;
        if (toolName !== "memory_engine" && toolName !== "memory_engine_search") return;
        const toolCallId = event?.toolCallId || ctx?.toolCallId || null;
        if (!toolCallId) return;
        if (trustedToolTrafficOrigins.size >= 1024) {
          const oldest = trustedToolTrafficOrigins.keys().next().value;
          trustedToolTrafficOrigins.delete(oldest);
        }
        trustedToolTrafficOrigins.set(toolCallId, {
          source: "openclaw_runtime",
          agentId: ctx?.agentId ?? ctx?.agent_id ?? ctx?.agentIdentity ?? null,
          runId: ctx?.runId ?? ctx?.run_id ?? event?.runId ?? null,
          sessionId: ctx?.sessionId ?? ctx?.session_id ?? ctx?.sessionKey ?? null,
          trigger: ctx?.trigger ?? event?.trigger ?? null,
          toolExecutionSource: ctx?.toolExecutionSource
            ?? ctx?.tool_execution_source
            ?? ctx?.invocationSource
            ?? ctx?.invocation_source
            ?? event?.toolExecutionSource
            ?? event?.invocationSource
            ?? null,
        });
      });
    }
    if (autoRecallConfig.enabled && typeof api.on === "function") {
      const autoRecallTopK = autoRecallConfig.topK;
      const autoRecallTimeoutMs = autoRecallConfig.timeoutMs;
      console.log(`[memory-engine] autoRecall hook registered topK=${autoRecallTopK} timeoutMs=${autoRecallTimeoutMs}`);
      api.on("before_prompt_build", async (event, ctx) => {
        try {
          autoRecallTurnState.cleanupExpired();
          const prompt = String(event?.prompt || "").trim();
          const traceId = crypto.randomUUID();
          const startedAt = Date.now();
          const sessionId = resolveHookSessionId(event, ctx);
          const runKey = ctx?.runId || event?.runId || null;
          if (runKey) {
            autoRecallTurnState.createTurnState({
              runId: runKey,
              sessionId,
              traceId,
            });
          }

          const runtimeGate = evaluateAutoRecallRuntimeGate({ event, ctx, config: autoRecallConfig });
          if (!runtimeGate.allowed) {
            const skipDebugMetadata = buildAutoRecallDebugMetadata(prompt, null, runtimeGate.reason);
            recordMemoryEvent({
              event_type: "auto_recall_debug",
              session_id: sessionId,
              trace_id: traceId,
              source: "autoRecall",
              metadata_json: skipDebugMetadata,
            });
            recordMemoryEvent({
              event_type: "recall_completed",
              session_id: sessionId,
              trace_id: traceId,
              latency_ms: Date.now() - startedAt,
              candidate_count: 0,
              injected_count: 0,
              source: "autoRecall",
              metadata_json: buildRecallCompletedMetadata({
                skipped: true,
                skip_reason: runtimeGate.reason,
                candidate_count: 0,
                strict_count: 0,
                fallback_count: 0,
                post_rerank_count: 0,
              }),
            });
            return;
          }

          const skipReason = explainAutoRecallSkip(prompt);
          if (skipReason) {
            const skipDebugMetadata = buildAutoRecallDebugMetadata(prompt, null, skipReason);
            recordMemoryEvent({
              event_type: "auto_recall_debug",
              session_id: sessionId,
              trace_id: traceId,
              source: "autoRecall",
              metadata_json: skipDebugMetadata,
            });
            recordMemoryEvent({
              event_type: "recall_completed",
              session_id: sessionId,
              trace_id: traceId,
              latency_ms: Date.now() - startedAt,
              candidate_count: 0,
              injected_count: 0,
              source: "autoRecall",
              metadata_json: buildRecallCompletedMetadata({
                skipped: true,
                skip_reason: skipReason,
                candidate_count: 0,
                strict_count: 0,
                fallback_count: 0,
                post_rerank_count: 0,
              }),
            });
            return;
          }
          const recallIntent = analyzeAutoRecallIntent(prompt);
          const searchPrompt = recallIntent.long_input_detected && recallIntent.should_recall
            ? recallIntent.focused_query
            : prompt;
          if (!recallIntent.should_recall || !String(searchPrompt || "").trim()) {
            const intentSkipReason = !recallIntent.should_recall
              ? recallIntent.intent_reason
              : "focused_query_empty";
            const intentDebugMetadata = buildAutoRecallDebugMetadata(prompt, {
              results: [],
              debug: {
                recall_intent_should_recall: recallIntent.should_recall,
                recall_intent_reason: !recallIntent.should_recall ? recallIntent.intent_reason : "focused_query_empty",
                long_input_detected: recallIntent.long_input_detected,
                generic_task_detected: recallIntent.generic_task_detected,
                focused_query: recallIntent.focused_query,
                focused_query_chars: recallIntent.focused_query_chars,
                original_input_chars: recallIntent.original_input_chars,
                skipped_by_recall_intent: true,
              },
            }, intentSkipReason);
            recordMemoryEvent({
              event_type: "auto_recall_debug",
              session_id: sessionId,
              trace_id: traceId,
              source: "autoRecall",
              metadata_json: intentDebugMetadata,
            });
            recordMemoryEvent({
              event_type: "recall_completed",
              session_id: sessionId,
              trace_id: traceId,
              latency_ms: Date.now() - startedAt,
              candidate_count: 0,
              injected_count: 0,
              source: "autoRecall",
              metadata_json: buildRecallCompletedMetadata({
                skipped: true,
                skip_reason: intentSkipReason,
                candidate_count: 0,
                strict_count: 0,
                fallback_count: 0,
                post_rerank_count: 0,
              }),
            });
            return;
          }
          recordMemoryEvent({ event_type: "recall_started", session_id: sessionId, trace_id: traceId, source: "autoRecall", metadata_json: { prompt: prompt.slice(0, 500), topK: autoRecallTopK, focused_query: searchPrompt, recall_intent_reason: recallIntent.intent_reason } });
          const result = await runHybridSearch(searchPrompt, { topK: autoRecallTopK }, {
            withDb,
            withHybridDbAccessScope,
            calcRealtimeConf,
            syncIndexIfNeeded,
            categoryMap: CATEGORY_MAP,
            cfg: api.config || null,
            getLancedbTable,
            getLancedbRuntime: getLanceDBRuntime,
            vectorReadyTimeoutMs: DEFAULT_LANCEDB_READY_TIMEOUT_MS,
            generateEmbedding: generateEmbeddingRuntime,
            getMemorySearchManager,
            kgFailClosedMode,
            kgFailClosedCanary,
            recentFailClosedMode,
            recentFailClosedCanary,
            trustedRuntimeContext: {
              source: "openclaw_runtime",
              agentIdentity: ctx?.agentIdentity ?? ctx?.agentId ?? event?.agentId ?? null,
              sessionIdentity: sessionId,
              requestIdentity: traceId,
              agentId: ctx?.agentId ?? ctx?.agent_id ?? ctx?.agentIdentity ?? event?.agentId ?? null,
              runId: runKey,
              sessionId,
              trigger: ctx?.trigger ?? event?.trigger ?? null,
            },
          });
          recordHybridSearchObservation({
            recordMemoryEvent,
            surface: "auto_recall",
            result,
            sessionId,
            traceId,
            identityContext: productionEvidenceIdentityContext,
            trafficOriginContext: {
              source: "openclaw_runtime",
              agentId: ctx?.agentId ?? ctx?.agent_id ?? ctx?.agentIdentity ?? event?.agentId ?? null,
              runId: runKey,
              sessionId,
              trigger: ctx?.trigger ?? event?.trigger ?? null,
            },
          });
          result.debug = {
            ...(result?.debug || {}),
            recall_intent_should_recall: recallIntent.should_recall,
            recall_intent_reason: recallIntent.intent_reason,
            long_input_detected: recallIntent.long_input_detected,
            generic_task_detected: recallIntent.generic_task_detected,
            focused_query: recallIntent.focused_query,
            focused_query_chars: recallIntent.focused_query_chars,
            original_input_chars: recallIntent.original_input_chars,
            skipped_by_recall_intent: false,
          };
          const hits = result?.results?.length || 0;
          const gateDebug = {
            candidate_count_before_gate: hits,
            candidate_count_after_gate: 0,
            rejected_candidates: [],
            gate_decisions: [],
            injected_count: 0,
          };
          const gateQuery = String(result?.debug?.query_stripped || stripPromptMetadataPrefix(searchPrompt));
          const gatedResults = (Array.isArray(result?.results) ? result.results : []).filter(candidate => {
            const gate = shouldInjectCandidate(candidate, gateQuery, gateDebug);
            const category = String(candidate?.category || "raw_log").toLowerCase();
            const id = String(candidate?.id || "").slice(0, 16);
            const finalScoreRaw = Number(candidate?.final_score ?? candidate?.finalScore ?? candidate?.rrf_score ?? 0);
            const finalScore = Number.isFinite(finalScoreRaw) ? Number(finalScoreRaw.toFixed(6)) : 0;
            const decision = {
              id,
              injected: Boolean(gate?.inject),
              allowed: gate?.allowed !== false,
              rejection_reason: gate?.reason || null,
              rejected_reason: gate?.rejected_reason || gate?.reason || null,
              deny_reasons: Array.isArray(gate?.deny_reasons) ? gate.deny_reasons : [],
              risk_reasons: Array.isArray(gate?.risk_reasons) ? gate.risk_reasons : [],
              reinforcement_allowed: gate?.reinforcement_allowed !== false,
              matched_key_classes: Array.isArray(gate?.matched_key_classes) ? gate.matched_key_classes : [],
              threshold_used: gateThresholdForCategory(category, gate?.min_coverage, api.config || null),
              category,
              final_score: finalScore,
            };
            gateDebug.gate_decisions.push(decision);
            if (gate?.inject) return true;
            gateDebug.rejected_candidates.push({
              id,
              category,
              reason: gate?.reason || "gated",
              rejected_reason: gate?.rejected_reason || gate?.reason || "gated",
              deny_reasons: Array.isArray(gate?.deny_reasons) ? gate.deny_reasons : [],
              risk_reasons: Array.isArray(gate?.risk_reasons) ? gate.risk_reasons : [],
              reinforcement_allowed: gate?.reinforcement_allowed !== false,
              matched_key_classes: Array.isArray(gate?.matched_key_classes) ? gate.matched_key_classes : [],
              preview: String(candidate?.text || "").slice(0, 120),
            });
            return false;
          });
          gateDebug.candidate_count_after_gate = gatedResults.length;
          gateDebug.injected_count = Math.min(gatedResults.length, autoRecallTopK);
          const cardFirstRuntimeEnabled = shouldUseAutoRecallCardRuntime(autoRecallConfig, runtimeGate);
          result.debug = {
            ...(result?.debug || {}),
            ...gateDebug,
            card_first_runtime_enabled: cardFirstRuntimeEnabled,
            auto_recall_disclosure_mode: cardFirstRuntimeEnabled ? "memory_card" : "raw_text",
          };
          const debugInfo = result?.debug || {};
          const postRerankCount = Array.isArray(debugInfo.post_rerank_topK) ? debugInfo.post_rerank_topK.length : 0;
          recordMemoryEvent({
            event_type: "auto_recall_debug",
            session_id: sessionId,
            trace_id: traceId,
            source: "autoRecall",
            metadata_json: buildAutoRecallDebugMetadata(prompt, result, null, { searchExecuted: true }),
          });
          const sessionIdForEvents = resolveHookSessionId(event, ctx);
          result.results.slice(0, Math.max(3, autoRecallTopK)).forEach((r, i) => {
            const id = String(r.id || "").slice(0, 16);
            recordMemoryEvent({
              event_type: "memory_candidate_retrieved",
              session_id: sessionIdForEvents,
              trace_id: traceId,
              memory_id: id,
              final_score: r.final_score ?? r.rrf_score,
              source: "autoRecall",
              metadata_json: {
                rank: i + 1,
                category: r.category,
                confidence: r.confidence,
                confidence_mode: r.confidence_mode || "managed",
                source_type: r.source_type || "memory-engine-managed",
                external_badge: Boolean(r.external_badge),
                decay_eligible: Boolean(r.decay_eligible),
                archive_eligible: Boolean(r.archive_eligible),
                sources: r.sources,
                preview: (r.text || "").slice(0, 200),
              }
            });
          });
          const prependContext = cardFirstRuntimeEnabled
            ? formatAutoRecallCardContext(gatedResults, {
              topK: autoRecallTopK,
              agentScope: runtimeGate.agentId || "unknown",
              agentId: runtimeGate.agentId || "unknown",
              traceId,
            })
            : formatAutoRecallContext(gatedResults, { topK: autoRecallTopK });
          if (!prependContext) {
            recordMemoryEvent({
              event_type: "recall_completed",
              session_id: sessionIdForEvents,
              trace_id: traceId,
              latency_ms: Date.now() - startedAt,
              candidate_count: hits,
              injected_count: 0,
              source: "autoRecall",
              metadata_json: buildRecallCompletedMetadata({
                skipped: false,
                skip_reason: null,
                candidate_count: hits,
                candidate_count_before_gate: Number(debugInfo.candidate_count_before_gate ?? hits),
                candidate_count_after_gate: Number(debugInfo.candidate_count_after_gate ?? 0),
                strict_count: Number(debugInfo.strict_count ?? 0),
                fallback_count: Number(debugInfo.fallback_count ?? 0),
                post_rerank_count: postRerankCount,
                injected_count: 0,
              }),
            });
            return;
          }
          const gateDecisions = Array.isArray(debugInfo.gate_decisions) ? debugInfo.gate_decisions : [];
          const gateDecisionById = new Map(gateDecisions.map(item => [String(item?.id || ""), item]));
          gateDecisions.forEach(item => {
            recordMemoryEvent({
              event_type: "auto_recall_debug",
              session_id: sessionIdForEvents,
              trace_id: traceId,
              memory_id: String(item?.id || null),
              source: "autoRecall",
              metadata_json: {
                debug_type: "gate_decision",
                injected: Boolean(item?.injected),
                allowed: item?.allowed !== false,
                rejection_reason: item?.rejection_reason || null,
                rejected_reason: item?.rejected_reason || item?.rejection_reason || null,
                deny_reasons: Array.isArray(item?.deny_reasons) ? item.deny_reasons : [],
                risk_reasons: Array.isArray(item?.risk_reasons) ? item.risk_reasons : [],
                reinforcement_allowed: item?.reinforcement_allowed !== false,
                matched_key_classes: Array.isArray(item?.matched_key_classes) ? item.matched_key_classes : [],
                threshold_used: item?.threshold_used || null,
                category: String(item?.category || "raw_log"),
                final_score: Number(item?.final_score ?? 0),
              },
            });
          });
          const injectedIds = gatedResults.slice(0, autoRecallTopK).map(r => String(r.id || "").slice(0, 16));
          const reinforcementAllowedIds = gatedResults
            .slice(0, autoRecallTopK)
            .filter(r => gateDecisionById.get(String(r.id || "").slice(0, 16))?.reinforcement_allowed !== false)
            .map(r => String(r.id || "").slice(0, 16));
          gatedResults.slice(0, autoRecallTopK).forEach(r => {
            const id = String(r.id || "").slice(0, 16);
            const decision = gateDecisionById.get(id);
            const category = String(r.category || decision?.category || "raw_log").toLowerCase();
            const thresholdUsed = decision?.threshold_used || gateThresholdForCategory(category, null, api.config || null);
            const finalScoreRaw = Number(r.final_score ?? r.finalScore ?? r.rrf_score ?? decision?.final_score ?? 0);
            const finalScore = Number.isFinite(finalScoreRaw) ? Number(finalScoreRaw.toFixed(6)) : 0;
            recordMemoryEvent({
              event_type: "memory_injected",
              session_id: sessionIdForEvents,
              trace_id: traceId,
              memory_id: id,
              final_score: finalScore,
              source: "autoRecall",
              metadata_json: {
                injected: true,
                rejection_reason: null,
                deny_reasons: Array.isArray(decision?.deny_reasons) ? decision.deny_reasons : [],
                risk_reasons: Array.isArray(decision?.risk_reasons) ? decision.risk_reasons : [],
                reinforcement_allowed: decision?.reinforcement_allowed !== false,
                threshold_used: thresholdUsed,
                category,
                final_score: finalScore,
                confidence: r.confidence,
                confidence_mode: r.confidence_mode || "managed",
                source_type: r.source_type || "memory-engine-managed",
                external_badge: Boolean(r.external_badge),
                decay_eligible: Boolean(r.decay_eligible),
                archive_eligible: Boolean(r.archive_eligible),
                preview: (r.text || "").slice(0, 200),
                card_first_runtime_enabled: cardFirstRuntimeEnabled,
                disclosure_mode: cardFirstRuntimeEnabled ? "memory_card" : "raw_text",
              }
            });
          });
          recordMemoryEvent({
            event_type: "recall_completed",
            session_id: sessionIdForEvents,
            trace_id: traceId,
            latency_ms: Date.now() - startedAt,
            candidate_count: hits,
            injected_count: Math.min(gatedResults.length, autoRecallTopK),
            source: "autoRecall",
            metadata_json: buildRecallCompletedMetadata({
              skipped: false,
              skip_reason: null,
              candidate_count: hits,
              candidate_count_before_gate: Number(debugInfo.candidate_count_before_gate ?? hits),
              candidate_count_after_gate: Number(debugInfo.candidate_count_after_gate ?? gatedResults.length),
              strict_count: Number(debugInfo.strict_count ?? 0),
              fallback_count: Number(debugInfo.fallback_count ?? 0),
              post_rerank_count: postRerankCount,
              injected_count: Math.min(gatedResults.length, autoRecallTopK),
            }),
          });
          if (runKey) {
            autoRecallTurnState.updateTurnRecallState({
              runId: runKey,
              sessionId: sessionIdForEvents,
              traceId,
              injectedIds,
              reinforcementAllowedIds,
            });
          }
          return { prependContext };
        } catch (e) {
          api.logger?.warn?.(`memory-engine autoRecall skipped: ${e.message}`);
          return;
        }
      }, { timeoutMs: autoRecallTimeoutMs });

      api.on("before_tool_call", async (event, ctx) => {
        try {
          autoRecallTurnState.cleanupExpired();
          if (event?.toolName !== "memory_engine_get") return;
          const toolCallId = event?.toolCallId || ctx?.toolCallId || null;
          const runId = ctx?.runId || event?.runId || null;
          if (!toolCallId || !runId) return;
          autoRecallTurnState.recordToolInvocationScope({
            toolCallId,
            runId,
            sessionId: ctx?.sessionId || resolveHookSessionId(event, ctx),
          });
        } catch (e) {
          api.logger?.warn?.(`memory-engine autoRecall tool scope bridge skipped: ${e.message}`);
        }
      });

      api.on("before_agent_finalize", async (event, ctx) => {
        const runId = event?.runId || ctx?.runId || null;
        try {
          autoRecallTurnState.cleanupExpired();
          const text = event?.lastAssistantMessage || "";
          const citedIds = parseCitedMemoryIds(text);
          if (citedIds.length === 0) return;
          const sessionId = resolveHookSessionId(event, ctx);
          const turnState = autoRecallTurnState.getTurnState(runId);
          const allowlist = buildReinforcementAllowedIds({
            traceState: turnState,
            currentTurnMemoryEngineGetIds: [...(turnState?.memoryEngineGetIds || [])],
          });
          const filtered = filterCitedIdsForReinforcement(citedIds, allowlist.reinforcement_allowed_ids);
          const idsToReinforce = filtered.reinforced_ids;
          recordMemoryEvent({
            event_type: "auto_recall_debug",
            session_id: sessionId,
            trace_id: turnState?.traceId || event?.runId || ctx?.runId || null,
            source: "autoRecall.finalize",
            metadata_json: {
              debug_type: "reinforcement_gate",
              cited_memory_ids: citedIds.map(id => String(id || "").slice(0, 16)),
              auto_recall_reinforcement_allowed_ids: allowlist.auto_recall_reinforcement_allowed_ids,
              current_turn_memory_engine_get_ids: allowlist.current_turn_memory_engine_get_ids,
              reinforcement_allowed_ids: allowlist.reinforcement_allowed_ids,
              reinforced_ids: filtered.reinforced_ids,
              ignored_cited_ids: filtered.ignored_cited_ids,
              ignored_reasons: filtered.ignored_reasons,
            },
          });
          if (idsToReinforce.length === 0) return;
          const fullIds = withDb(db => {
            const resolved = resolvePrefixes(db, idsToReinforce);
            if (resolved.length > 0) batchReinforce(db, resolved, Math.floor(Date.now() / 1000));
            return resolved;
          });
          const reinforcedShortIds = fullIds.map(id => String(id || "").slice(0, 16));
          for (const id of fullIds) {
            recordMemoryEvent({
              event_type: "memory_cited",
              session_id: sessionId,
              trace_id: turnState?.traceId || event?.runId || ctx?.runId || null,
              memory_id: id.slice(0, 16),
              cited_count: 1,
              source: "autoRecall.finalize",
              metadata_json: {
                cited_memory_ids: citedIds.map(value => String(value || "").slice(0, 16)),
                auto_recall_reinforcement_allowed_ids: allowlist.auto_recall_reinforcement_allowed_ids,
                current_turn_memory_engine_get_ids: allowlist.current_turn_memory_engine_get_ids,
                reinforcement_allowed_ids: allowlist.reinforcement_allowed_ids,
                reinforced_ids: reinforcedShortIds,
                ignored_cited_ids: filtered.ignored_cited_ids,
                ignored_reasons: filtered.ignored_reasons,
                runId: event?.runId || ctx?.runId || null,
              }
            });
            recordMemoryEvent({
              event_type: "memory_reinforced",
              session_id: sessionId,
              trace_id: turnState?.traceId || event?.runId || ctx?.runId || null,
              memory_id: id.slice(0, 16),
              source: "autoRecall.finalize",
              metadata_json: {
                cited_memory_ids: citedIds.map(value => String(value || "").slice(0, 16)),
                auto_recall_reinforcement_allowed_ids: allowlist.auto_recall_reinforcement_allowed_ids,
                current_turn_memory_engine_get_ids: allowlist.current_turn_memory_engine_get_ids,
                reinforcement_allowed_ids: allowlist.reinforcement_allowed_ids,
                reinforced_ids: reinforcedShortIds,
                ignored_cited_ids: filtered.ignored_cited_ids,
                ignored_reasons: filtered.ignored_reasons,
                runId: event?.runId || ctx?.runId || null,
              }
            });
          }
        } catch (e) {
          api.logger?.warn?.(`memory-engine autoRecall citation finalize skipped: ${e.message}`);
        } finally {
          if (runId) {
            autoRecallTurnState.deleteTurnState(runId);
            autoRecallTurnState.deleteToolInvocationScopesByRunId(runId);
          }
        }
      });
    }

    // Register memory prompt supplement — guides agent to cite memory IDs
    api.registerMemoryPromptSupplement((_params) => {
      const sessionId = resolveHookSessionId(_params, _params?.ctx || _params);
      const injected = sessionId ? (autoRecallTurnState.getTurnStateBySession(sessionId)?.injectedIds || []) : [];
      const supplement = [
        MEMORY_SUPPLEMENT_BOUNDARY_START,
        `${MEMORY_SUPPLEMENT_SENTINEL}: active`,
        `MEMORY_SUPPLEMENT_INJECTED_COUNT: ${injected.length}`,
        "## Memory Engine - 记忆置信度系统",
        "",
        "### 工作流",
        "1. **搜索记忆** → `memory_engine_search` query=`你的问题`",
        "2. **查看详情** → `memory_engine_get` id=`搜索结果中的id`",
        "3. **引用强化** → 如果你用了搜索结果来回答，必须调 `memory_engine` action=`cite`, chunk_ids=[结果中的id]",
        "4. **存储新记忆** → 需要长期记住的事实，用 `memory_engine` action=`add`",
        "",
        "规则：引用搜索结果却不调 `cite`，那些记忆会随时间衰减消失。",
        "每次 `cite` 让记忆更牢固（hit+1, conf+0.1, 半衰期延长）。",
        MEMORY_SUPPLEMENT_BOUNDARY_END,
      ];
      return supplement;
    });

    const executeMemoryEngineAction = createMemoryEngineExecute({
      api,
      autoRouteCategory,
      dateStrInTimeZone,
      SMART_ADD_TIME_ZONE: smartAddTimeZone,
      resolve,
      WORKSPACE,
      SMART_ADD_DIR,
      buildSmartAddFingerprint,
      appendSmartAdd,
      syncIndexIfNeeded,
      catParams,
      withDb,
      withHybridDbAccessScope,
      getLancedbTable,
      generateEmbedding: generateEmbeddingRuntime,
      recordMemoryEvent,
      getMemorySearchManager,
      kgFailClosedMode,
      kgFailClosedCanary,
      recentFailClosedMode,
      recentFailClosedCanary,
      productionEvidenceIdentityContext,
      resolveTrafficOriginContext,
      calcRealtimeConf,
      existsSync,
      readFileSync,
      KG_PATH,
      resolvePrefixes,
      batchReinforce,
      CATEGORY_MAP,
      calcTau,
    });
    const executeMemoryEngineSearch = createMemoryEngineSearchExecute({
      api,
      withDb,
      withHybridDbAccessScope,
      calcRealtimeConf,
      syncIndexIfNeeded,
      CATEGORY_MAP,
      getLancedbTable,
      generateEmbedding: generateEmbeddingRuntime,
      getMemorySearchManager,
      recordMemoryEvent,
      kgFailClosedMode,
      kgFailClosedCanary,
      recentFailClosedMode,
      recentFailClosedCanary,
      productionEvidenceIdentityContext,
      resolveTrafficOriginContext,
    });
    const executeMemoryEngineGet = createMemoryEngineGetExecute({
      withDb,
      calcRealtimeConf,
      CATEGORY_MAP,
      onMemoryEngineGetSuccess: (memoryId, params) => {
        const toolCallId = params?._toolCallId || null;
        const scope = toolCallId ? autoRecallTurnState.getToolInvocationScope(toolCallId) : null;
        if (!scope?.runId) {
          recordMemoryEvent({
            event_type: "auto_recall_debug",
            session_id: scope?.sessionId || null,
            trace_id: null,
            source: "autoRecall.tool_bridge",
            metadata_json: {
              debug_type: "memory_engine_get_scope_missing",
              reason: toolCallId ? "tool_call_scope_not_found" : "tool_call_id_missing",
              tool_call_id: toolCallId,
              memory_id: String(memoryId || "").slice(0, 16),
            },
          });
          return;
        }
        autoRecallTurnState.recordMemoryEngineGet({
          runId: scope.runId,
          memoryId,
        });
        autoRecallTurnState.deleteToolInvocationScope(toolCallId);
      },
    });

    registerMemoryEngineTools(api, {
      memoryEngine: executeMemoryEngineAction,
      memoryEngineSearch: executeMemoryEngineSearch,
      memoryEngineGet: executeMemoryEngineGet,
    });


  },
});
