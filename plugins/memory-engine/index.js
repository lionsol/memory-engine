import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { getMemorySearchManager } from "openclaw/plugin-sdk/memory-core-engine-runtime";
import { buildSmartAddFingerprint } from "./smart-add-fingerprint.js";
import { dateStrInTimeZone } from "./date-utils.js";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { explainAutoRecallSkip, formatAutoRecallContext, parseCitedMemoryIds, shouldInjectCandidate } from "./auto-recall.js";
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
import { ensureEngineWritable, withEngineDb } from "./lib/db/engine-db.js";
import { getMemoryEngineConfig } from "./lib/config/runtime.js";
import { getSmartAddTimeZone } from "./lib/config/helpers.js";
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
import { collectIndexedFiles, readIndexedPathState } from "./lib/sync/index-sync.js";
import { hybridSearch as runHybridSearch } from "./lib/recall/hybrid-search.js";
import { createMemoryEngineExecute } from "./lib/tools/memory-engine-actions.js";
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

function withDb(fn) {
  return withEngineDb(fn, { readonly: false });
}

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

function buildAutoRecallDebugMetadata(prompt, result, skipReason = null) {
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
    skipped: Boolean(skipReason),
    skip_reason: skipReason || null,
    candidate_counts_before_filtering: debugInfo.candidate_counts_before_filtering || {},
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
});

const syncIndexIfNeeded = createIndexSyncRuntime({
  memoryRoot: WORKSPACE,
  watchDirs: INDEX_SYNC_WATCH_DIRS,
  withDb,
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


    const autoRecallTraceByRun = new Map();
    const autoRecallTraceBySession = new Map();
    const memoryEngineConfig = getMemoryEngineConfig(api?.config || null);
    const smartAddTimeZone = getSmartAddTimeZone(api?.config || null);
    const pluginEntryConfig = api.config?.plugins?.entries?.["memory-engine"]?.config;
    const embeddingRuntimeConfig = api.config || pluginEntryConfig || null;
    const generateEmbeddingRuntime = text => generateEmbedding(text, {
      cfg: embeddingRuntimeConfig,
      apiConfig: api.config || null,
    });
    const autoRecallConfig =
      api.pluginConfig?.autoRecall ||
      pluginEntryConfig?.autoRecall ||
      api.config?.autoRecall ||
      {};
    if (autoRecallConfig.enabled && typeof api.on === "function") {
      const autoRecallTopK = Math.max(
        1,
        Number(autoRecallConfig.topK ?? memoryEngineConfig?.recall?.topK ?? 3) || 3
      );
      const autoRecallTimeoutMs = Math.max(1000, Number(autoRecallConfig.timeoutMs || 8000));
      console.log(`[memory-engine] autoRecall hook registered topK=${autoRecallTopK} timeoutMs=${autoRecallTimeoutMs}`);
      api.on("before_prompt_build", async (event, ctx) => {
        try {
          const prompt = String(event?.prompt || "").trim();
          const traceId = crypto.randomUUID();
          const startedAt = Date.now();
          const sessionId = resolveHookSessionId(event, ctx);
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
          recordMemoryEvent({ event_type: "recall_started", session_id: sessionId, trace_id: traceId, source: "autoRecall", metadata_json: { prompt: prompt.slice(0, 500), topK: autoRecallTopK } });
          const result = await runHybridSearch(prompt, { topK: autoRecallTopK }, {
            withDb,
            calcRealtimeConf,
            syncIndexIfNeeded,
            categoryMap: CATEGORY_MAP,
            cfg: api.config || null,
            getLancedbTable,
            getLancedbRuntime: getLanceDBRuntime,
            vectorReadyTimeoutMs: DEFAULT_LANCEDB_READY_TIMEOUT_MS,
            generateEmbedding: generateEmbeddingRuntime,
            getMemorySearchManager,
          });
          const hits = result?.results?.length || 0;
          const gateDebug = {
            candidate_count_before_gate: hits,
            candidate_count_after_gate: 0,
            rejected_candidates: [],
            gate_decisions: [],
            injected_count: 0,
          };
          const gateQuery = String(result?.debug?.query_stripped || stripPromptMetadataPrefix(prompt));
          const gatedResults = (Array.isArray(result?.results) ? result.results : []).filter(candidate => {
            const gate = shouldInjectCandidate(candidate, gateQuery, gateDebug);
            const category = String(candidate?.category || "raw_log").toLowerCase();
            const id = String(candidate?.id || "").slice(0, 16);
            const finalScoreRaw = Number(candidate?.final_score ?? candidate?.finalScore ?? candidate?.rrf_score ?? 0);
            const finalScore = Number.isFinite(finalScoreRaw) ? Number(finalScoreRaw.toFixed(6)) : 0;
            const decision = {
              id,
              injected: Boolean(gate?.inject),
              rejection_reason: gate?.reason || null,
              rejected_reason: gate?.rejected_reason || gate?.reason || null,
              matched_key_classes: Array.isArray(gate?.matched_key_classes) ? gate.matched_key_classes : [],
              threshold_used: gateThresholdForCategory(category, gate?.min_coverage),
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
              matched_key_classes: Array.isArray(gate?.matched_key_classes) ? gate.matched_key_classes : [],
              preview: String(candidate?.text || "").slice(0, 120),
            });
            return false;
          });
          gateDebug.candidate_count_after_gate = gatedResults.length;
          gateDebug.injected_count = Math.min(gatedResults.length, autoRecallTopK);
          result.debug = {
            ...(result?.debug || {}),
            ...gateDebug,
          };
          const debugInfo = result?.debug || {};
          const postRerankCount = Array.isArray(debugInfo.post_rerank_topK) ? debugInfo.post_rerank_topK.length : 0;
          recordMemoryEvent({
            event_type: "auto_recall_debug",
            session_id: sessionId,
            trace_id: traceId,
            source: "autoRecall",
            metadata_json: buildAutoRecallDebugMetadata(prompt, result),
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
          const prependContext = formatAutoRecallContext(gatedResults, { topK: autoRecallTopK });
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
                rejection_reason: item?.rejection_reason || null,
                rejected_reason: item?.rejected_reason || item?.rejection_reason || null,
                matched_key_classes: Array.isArray(item?.matched_key_classes) ? item.matched_key_classes : [],
                threshold_used: item?.threshold_used || null,
                category: String(item?.category || "raw_log"),
                final_score: Number(item?.final_score ?? 0),
              },
            });
          });
          const injectedIds = gatedResults.slice(0, autoRecallTopK).map(r => String(r.id || "").slice(0, 16));
          gatedResults.slice(0, autoRecallTopK).forEach(r => {
            const id = String(r.id || "").slice(0, 16);
            const decision = gateDecisionById.get(id);
            const category = String(r.category || decision?.category || "raw_log").toLowerCase();
            const thresholdUsed = decision?.threshold_used || gateThresholdForCategory(category, null);
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
          const traceState = { traceId, sessionId: sessionIdForEvents, injectedIds };
          const runKey = ctx?.runId || event?.runId;
          if (runKey) autoRecallTraceByRun.set(runKey, traceState);
          if (sessionIdForEvents) autoRecallTraceBySession.set(sessionIdForEvents, traceState);
          return { prependContext };
        } catch (e) {
          api.logger?.warn?.(`memory-engine autoRecall skipped: ${e.message}`);
          return;
        }
      }, { timeoutMs: autoRecallTimeoutMs });

      api.on("before_agent_finalize", async (event, ctx) => {
        try {
          const text = event?.lastAssistantMessage || "";
          const citedIds = parseCitedMemoryIds(text);
          if (citedIds.length === 0) return;
          const sessionId = resolveHookSessionId(event, ctx);
          const traceState =
            autoRecallTraceByRun.get(event?.runId || ctx?.runId) ||
            autoRecallTraceBySession.get(sessionId);
          const allowed = new Set(traceState?.injectedIds || []);
          const idsToReinforce = citedIds.filter(id => allowed.size === 0 || allowed.has(id.slice(0, 16)));
          if (idsToReinforce.length === 0) return;
          const fullIds = withDb(db => {
            const resolved = resolvePrefixes(db, idsToReinforce);
            if (resolved.length > 0) batchReinforce(db, resolved, Math.floor(Date.now() / 1000));
            return resolved;
          });
          for (const id of fullIds) {
            recordMemoryEvent({
              event_type: "memory_cited",
              session_id: sessionId,
              trace_id: traceState?.traceId || event?.runId || ctx?.runId || null,
              memory_id: id.slice(0, 16),
              cited_count: 1,
              source: "autoRecall.finalize",
              metadata_json: { cited_memory_ids: citedIds, runId: event?.runId || ctx?.runId || null }
            });
            recordMemoryEvent({
              event_type: "memory_reinforced",
              session_id: sessionId,
              trace_id: traceState?.traceId || event?.runId || ctx?.runId || null,
              memory_id: id.slice(0, 16),
              source: "autoRecall.finalize"
            });
          }
        } catch (e) {
          api.logger?.warn?.(`memory-engine autoRecall citation finalize skipped: ${e.message}`);
        }
      });
    }

    // Register memory prompt supplement — guides agent to cite memory IDs
    api.registerMemoryPromptSupplement((_params) => {
      const sessionId = resolveHookSessionId(_params, _params?.ctx || _params);
      const injected = sessionId ? (autoRecallTraceBySession.get(sessionId)?.injectedIds || []) : [];
      const supplement = [
        MEMORY_SUPPLEMENT_BOUNDARY_START,
        `${MEMORY_SUPPLEMENT_SENTINEL}: active`,
        `MEMORY_SUPPLEMENT_INJECTED_COUNT: ${injected.length}`,
        "## Memory Engine - 记忆置信度系统",
        "",
        "### 工作流",
        "1. **搜索记忆** → `memory_engine` action=`search`, text=`你的问题`",
        "2. **引用强化** → 如果你用了上一步的搜索结果来回答，必须调 `memory_engine` action=`cite`, chunk_ids=[结果中的id]",
        "3. **存储新记忆** → 需要长期记住的事实，用 `memory_engine` action=`add`",
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
      getLancedbTable,
      generateEmbedding: generateEmbeddingRuntime,
      recordMemoryEvent,
      getMemorySearchManager,
      calcRealtimeConf,
      existsSync,
      readFileSync,
      KG_PATH,
      resolvePrefixes,
      batchReinforce,
      CATEGORY_MAP,
      calcTau,
    });

    api.registerTool({
      name: "memory_engine",
      label: "Memory Engine",
      description: [
        `智能记忆系统 — 置信度评分 + 时间衰减 + 引用强化。\n`,
        `\n=== 最常用操作 ===\n`,
        `search -> 搜索记忆。写 text=你的查询。返回结果带 id/confidence/score。\n`,
        `cite   -> 引用强化。把 search 返回的 id 放入 chunk_ids 数组。巩固记忆。\n`,
        `add    -> 存新记忆。写 text=内容，推荐指定 category（见下）。\n`,
        `\n=== 其他操作 ===\n`,
        `status -> 查看统计。\n`,
        `archive -> 标记低置信度记忆为已归档。\n`,
        `update -> 手动更新某条记忆的字段。\n`,
        `\n=== category 建议 ===\n`,
        `user_identity: 用户身份/职业/核心特征（protected, 不衰减）\n`,
        `preference: 用户偏好/习惯（τ=30天）\n`,
        `kg_node: 知识图谱结构结论（τ=90天）\n`,
        `raw_log: 日常对话/未提炼想法（τ=7天, 默认）\n`,
        `temporary: 临时/一次性（τ=2天）\n`,
        `episodic: 情节摘要（τ=30天）\n`,
        `\n重要：用 search 后必须 cite（或 update --hit），否则记忆会衰减。`,
      ].join(''),
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["add", "search", "cite", "update", "status", "archive", "kg-bridge", "detect-conflicts"],
          },
          text: { type: "string" },
          category: {
            type: "string",
            enum: ["temporary", "raw_log", "episodic", "preference", "kg_node", "user_identity"],
          },
          protected: { type: "boolean" },
          chunk_id: { type: "string" },
          chunk_ids: {
            type: "array",
            items: { type: "string" },
            description: "List of chunk ID prefixes to cite/reinforce",
          },
          hit: { type: "boolean" },
          deep: { type: "boolean", description: "Use LLM for semantic contradiction check (slow path)" },
          top_k: { type: "number", default: 5 },
        },
        required: ["action"],
      },

      execute: executeMemoryEngineAction,
    });


  },
});
