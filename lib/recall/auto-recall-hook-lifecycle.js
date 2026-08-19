import { randomUUID as createRandomUUID } from "node:crypto";

import {
  explainAutoRecallSkip,
  formatAutoRecallCardContext,
  formatAutoRecallContext,
  parseCitedMemoryIds,
  shouldInjectCandidate,
  shouldUseAutoRecallCardRuntime,
} from "../../auto-recall.js";
import { stripPromptMetadataPrefix } from "../../query-utils.js";
import {
  batchReinforce as defaultBatchReinforce,
  buildRecallCompletedMetadata,
  gateThresholdForCategory,
  resolvePrefixes as defaultResolvePrefixes,
} from "../memory-confidence.js";
import {
  buildReinforcementAllowedIds,
  filterCitedIdsForReinforcement,
} from "./auto-recall-reinforcement.js";
import { buildAutoRecallDebugMetadata } from "./auto-recall-debug-metadata.js";
import { analyzeAutoRecallIntent } from "./auto-recall-intent.js";
import { evaluateAutoRecallRuntimeGate } from "./auto-recall-runtime-gate.js";
import { createAutoRecallTurnStateManager } from "./auto-recall-turn-state.js";
import {
  buildHybridSearchRuntime,
  recordHybridRuntimeObservation,
} from "./hybrid/runtime-context.js";
import { createHybridTrafficOriginRegistry } from "./hybrid/traffic-origin.js";

const MEMORY_SUPPLEMENT_SENTINEL = "MEMORY_SUPPLEMENT_SENTINEL";
const MEMORY_SUPPLEMENT_BOUNDARY_START = "<!-- MEMORY_ENGINE_SUPPLEMENT_START -->";
const MEMORY_SUPPLEMENT_BOUNDARY_END = "<!-- MEMORY_ENGINE_SUPPLEMENT_END -->";

export function resolveAutoRecallHookSessionId(event, ctx) {
  return event?.sessionId ||
    event?.session_id ||
    event?.sessionKey ||
    ctx?.sessionId ||
    ctx?.sessionKey ||
    ctx?.runId ||
    null;
}

function buildMemoryPromptSupplement(turnState, params) {
  const sessionId = resolveAutoRecallHookSessionId(params, params?.ctx || params);
  const injected = sessionId ? (turnState.getTurnStateBySession(sessionId)?.injectedIds || []) : [];
  return [
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
}

function recordSkippedRecall({
  recordMemoryEvent,
  prompt,
  result = null,
  skipReason,
  sessionId,
  traceId,
  startedAt,
  now,
}) {
  recordMemoryEvent({
    event_type: "auto_recall_debug",
    session_id: sessionId,
    trace_id: traceId,
    source: "autoRecall",
    metadata_json: buildAutoRecallDebugMetadata(prompt, result, skipReason),
  });
  recordMemoryEvent({
    event_type: "recall_completed",
    session_id: sessionId,
    trace_id: traceId,
    latency_ms: now() - startedAt,
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
}

function requireFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`createAutoRecallHookLifecycle requires ${name}`);
  }
  return value;
}

export function createAutoRecallHookLifecycle({
  api,
  autoRecallConfig,
  apiConfig = api?.config || null,
  recordMemoryEvent,
  withDb,
  resolvePrefixes = defaultResolvePrefixes,
  batchReinforce = defaultBatchReinforce,
  now = () => Date.now(),
  randomUUID = createRandomUUID,
  turnState = createAutoRecallTurnStateManager(),
  trafficOriginRegistry = createHybridTrafficOriginRegistry(),
} = {}) {
  const writeEvent = requireFunction(recordMemoryEvent, "recordMemoryEvent");
  const runWithDb = requireFunction(withDb, "withDb");
  const resolveMemoryPrefixes = requireFunction(resolvePrefixes, "resolvePrefixes");
  const reinforceBatch = requireFunction(batchReinforce, "batchReinforce");
  const currentTime = requireFunction(now, "now");
  const createTraceId = requireFunction(randomUUID, "randomUUID");
  let registered = false;

  const resolveTrafficOriginContext = (toolCallId, surface = null) => (
    trafficOriginRegistry.consume(toolCallId, surface)
  );

  const onMemoryEngineGetSuccess = (memoryId, params) => {
    const toolCallId = params?._toolCallId || null;
    const scope = toolCallId ? turnState.getToolInvocationScope(toolCallId) : null;
    if (!scope?.runId) {
      writeEvent({
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
    turnState.recordMemoryEngineGet({
      runId: scope.runId,
      memoryId,
    });
    turnState.deleteToolInvocationScope(toolCallId);
  };

  const register = (hybridRuntimeContext) => {
    if (registered) return false;
    registered = true;

    if (typeof api?.on === "function") {
      api.on("before_tool_call", async (event, ctx) => {
        const toolName = event?.toolName || ctx?.toolName || null;
        if (toolName !== "memory_engine" && toolName !== "memory_engine_search") return;
        trafficOriginRegistry.recordBeforeToolCall({
          event,
          ctx,
          surface: toolName === "memory_engine_search"
            ? "memory_engine_search"
            : "memory_engine_action_search",
        });
      });
    }

    if (autoRecallConfig?.enabled && typeof api?.on === "function") {
      const autoRecallTopK = autoRecallConfig.topK;
      const autoRecallTimeoutMs = autoRecallConfig.timeoutMs;
      console.log(`[memory-engine] autoRecall hook registered topK=${autoRecallTopK} timeoutMs=${autoRecallTimeoutMs}`);

      api.on("before_prompt_build", async (event, ctx) => {
        try {
          turnState.cleanupExpired();
          const prompt = String(event?.prompt || "").trim();
          const traceId = createTraceId();
          const startedAt = currentTime();
          const sessionId = resolveAutoRecallHookSessionId(event, ctx);
          const runKey = ctx?.runId || event?.runId || null;
          if (runKey) {
            turnState.createTurnState({
              runId: runKey,
              sessionId,
              traceId,
            });
          }

          const runtimeGate = evaluateAutoRecallRuntimeGate({ event, ctx, config: autoRecallConfig });
          if (!runtimeGate.allowed) {
            recordSkippedRecall({
              recordMemoryEvent: writeEvent,
              prompt,
              skipReason: runtimeGate.reason,
              sessionId,
              traceId,
              startedAt,
              now: currentTime,
            });
            return;
          }

          const skipReason = explainAutoRecallSkip(prompt);
          if (skipReason) {
            recordSkippedRecall({
              recordMemoryEvent: writeEvent,
              prompt,
              skipReason,
              sessionId,
              traceId,
              startedAt,
              now: currentTime,
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
            const intentResult = {
              results: [],
              debug: {
                recall_intent_should_recall: recallIntent.should_recall,
                recall_intent_reason: !recallIntent.should_recall ? recallIntent.intent_reason : "focused_query_empty",
                long_input_detected: recallIntent.long_input_detected,
                generic_task_detected: recallIntent.generic_task_detected,
                task_intent: recallIntent.task_intent,
                recall_intent: recallIntent.recall_intent,
                focused_query: recallIntent.focused_query,
                focused_query_chars: recallIntent.focused_query_chars,
                original_input_chars: recallIntent.original_input_chars,
                skipped_by_recall_intent: true,
              },
            };
            recordSkippedRecall({
              recordMemoryEvent: writeEvent,
              prompt,
              result: intentResult,
              skipReason: intentSkipReason,
              sessionId,
              traceId,
              startedAt,
              now: currentTime,
            });
            return;
          }

          writeEvent({
            event_type: "recall_started",
            session_id: sessionId,
            trace_id: traceId,
            source: "autoRecall",
            metadata_json: {
              prompt_chars: prompt.length,
              topK: autoRecallTopK,
              focused_query_chars: String(searchPrompt || "").length,
              focused_query_used: searchPrompt !== prompt,
              recall_intent_reason: recallIntent.intent_reason,
              task_intent: recallIntent.task_intent,
              recall_intent: recallIntent.recall_intent,
            },
          });
          const autoRecallTrustedRuntimeContext = {
            source: "openclaw_runtime",
            agentIdentity: ctx?.agentIdentity ?? ctx?.agentId ?? event?.agentId ?? null,
            sessionIdentity: sessionId,
            requestIdentity: traceId,
            agentId: ctx?.agentId ?? ctx?.agent_id ?? ctx?.agentIdentity ?? event?.agentId ?? null,
            runId: runKey,
            sessionId,
            trigger: ctx?.trigger ?? event?.trigger ?? null,
          };
          const result = await hybridRuntimeContext.retrievalPolicy.hybridSearch(
            searchPrompt,
            { topK: autoRecallTopK },
            buildHybridSearchRuntime(hybridRuntimeContext, {
              trustedRuntimeContext: autoRecallTrustedRuntimeContext,
            }),
          );
          recordHybridRuntimeObservation(hybridRuntimeContext, {
            surface: "auto_recall",
            result,
            sessionId,
            traceId,
            trafficOriginContext: {
              source: "before_prompt_build",
              agentId: autoRecallTrustedRuntimeContext.agentId,
              runId: runKey,
              sessionId,
              trigger: autoRecallTrustedRuntimeContext.trigger,
            },
          });
          result.debug = {
            ...(result?.debug || {}),
            recall_intent_should_recall: recallIntent.should_recall,
            recall_intent_reason: recallIntent.intent_reason,
            long_input_detected: recallIntent.long_input_detected,
            generic_task_detected: recallIntent.generic_task_detected,
            task_intent: recallIntent.task_intent,
            recall_intent: recallIntent.recall_intent,
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
              threshold_used: gateThresholdForCategory(category, gate?.min_coverage, apiConfig),
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
          writeEvent({
            event_type: "auto_recall_debug",
            session_id: sessionId,
            trace_id: traceId,
            source: "autoRecall",
            metadata_json: buildAutoRecallDebugMetadata(prompt, result, null, { searchExecuted: true }),
          });
          const sessionIdForEvents = resolveAutoRecallHookSessionId(event, ctx);
          result.results.slice(0, Math.max(3, autoRecallTopK)).forEach((memory, index) => {
            const id = String(memory.id || "").slice(0, 16);
            writeEvent({
              event_type: "memory_candidate_retrieved",
              session_id: sessionIdForEvents,
              trace_id: traceId,
              memory_id: id,
              final_score: memory.final_score ?? memory.rrf_score,
              source: "autoRecall",
              metadata_json: {
                rank: index + 1,
                category: memory.category,
                confidence: memory.confidence,
                confidence_mode: memory.confidence_mode || "managed",
                source_type: memory.source_type || "memory-engine-managed",
                external_badge: Boolean(memory.external_badge),
                decay_eligible: Boolean(memory.decay_eligible),
                archive_eligible: Boolean(memory.archive_eligible),
                sources: memory.sources,
              },
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
            writeEvent({
              event_type: "recall_completed",
              session_id: sessionIdForEvents,
              trace_id: traceId,
              latency_ms: currentTime() - startedAt,
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
            writeEvent({
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
          const injectedIds = gatedResults.slice(0, autoRecallTopK).map(memory => String(memory.id || "").slice(0, 16));
          const reinforcementAllowedIds = gatedResults
            .slice(0, autoRecallTopK)
            .filter(memory => gateDecisionById.get(String(memory.id || "").slice(0, 16))?.reinforcement_allowed !== false)
            .map(memory => String(memory.id || "").slice(0, 16));
          gatedResults.slice(0, autoRecallTopK).forEach(memory => {
            const id = String(memory.id || "").slice(0, 16);
            const decision = gateDecisionById.get(id);
            const category = String(memory.category || decision?.category || "raw_log").toLowerCase();
            const thresholdUsed = decision?.threshold_used || gateThresholdForCategory(category, null, apiConfig);
            const finalScoreRaw = Number(memory.final_score ?? memory.finalScore ?? memory.rrf_score ?? decision?.final_score ?? 0);
            const finalScore = Number.isFinite(finalScoreRaw) ? Number(finalScoreRaw.toFixed(6)) : 0;
            writeEvent({
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
                confidence: memory.confidence,
                confidence_mode: memory.confidence_mode || "managed",
                source_type: memory.source_type || "memory-engine-managed",
                external_badge: Boolean(memory.external_badge),
                decay_eligible: Boolean(memory.decay_eligible),
                archive_eligible: Boolean(memory.archive_eligible),
                card_first_runtime_enabled: cardFirstRuntimeEnabled,
                disclosure_mode: cardFirstRuntimeEnabled ? "memory_card" : "raw_text",
              },
            });
          });
          writeEvent({
            event_type: "recall_completed",
            session_id: sessionIdForEvents,
            trace_id: traceId,
            latency_ms: currentTime() - startedAt,
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
            turnState.updateTurnRecallState({
              runId: runKey,
              sessionId: sessionIdForEvents,
              traceId,
              injectedIds,
              reinforcementAllowedIds,
            });
          }
          return { prependContext };
        } catch (error) {
          api.logger?.warn?.(`memory-engine autoRecall skipped: ${error.message}`);
          return;
        }
      }, { timeoutMs: autoRecallTimeoutMs });

      api.on("before_tool_call", async (event, ctx) => {
        try {
          turnState.cleanupExpired();
          if (event?.toolName !== "memory_engine_get") return;
          const toolCallId = event?.toolCallId || ctx?.toolCallId || null;
          const runId = ctx?.runId || event?.runId || null;
          if (!toolCallId || !runId) return;
          turnState.recordToolInvocationScope({
            toolCallId,
            runId,
            sessionId: ctx?.sessionId || resolveAutoRecallHookSessionId(event, ctx),
          });
        } catch (error) {
          api.logger?.warn?.(`memory-engine autoRecall tool scope bridge skipped: ${error.message}`);
        }
      });

      api.on("before_agent_finalize", async (event, ctx) => {
        const runId = event?.runId || ctx?.runId || null;
        try {
          turnState.cleanupExpired();
          const text = event?.lastAssistantMessage || "";
          const citedIds = parseCitedMemoryIds(text);
          if (citedIds.length === 0) return;
          const sessionId = resolveAutoRecallHookSessionId(event, ctx);
          const activeTurnState = turnState.getTurnState(runId);
          const allowlist = buildReinforcementAllowedIds({
            traceState: activeTurnState,
            currentTurnMemoryEngineGetIds: [...(activeTurnState?.memoryEngineGetIds || [])],
          });
          const filtered = filterCitedIdsForReinforcement(citedIds, allowlist.reinforcement_allowed_ids);
          const idsToReinforce = filtered.reinforced_ids;
          writeEvent({
            event_type: "auto_recall_debug",
            session_id: sessionId,
            trace_id: activeTurnState?.traceId || event?.runId || ctx?.runId || null,
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
          const fullIds = runWithDb(db => {
            const resolved = resolveMemoryPrefixes(db, idsToReinforce);
            if (resolved.length > 0) reinforceBatch(db, resolved, Math.floor(currentTime() / 1000));
            return resolved;
          });
          const reinforcedShortIds = fullIds.map(id => String(id || "").slice(0, 16));
          for (const id of fullIds) {
            const metadata = {
              cited_memory_ids: citedIds.map(value => String(value || "").slice(0, 16)),
              auto_recall_reinforcement_allowed_ids: allowlist.auto_recall_reinforcement_allowed_ids,
              current_turn_memory_engine_get_ids: allowlist.current_turn_memory_engine_get_ids,
              reinforcement_allowed_ids: allowlist.reinforcement_allowed_ids,
              reinforced_ids: reinforcedShortIds,
              ignored_cited_ids: filtered.ignored_cited_ids,
              ignored_reasons: filtered.ignored_reasons,
              runId: event?.runId || ctx?.runId || null,
            };
            writeEvent({
              event_type: "memory_cited",
              session_id: sessionId,
              trace_id: activeTurnState?.traceId || event?.runId || ctx?.runId || null,
              memory_id: id.slice(0, 16),
              cited_count: 1,
              source: "autoRecall.finalize",
              metadata_json: metadata,
            });
            writeEvent({
              event_type: "memory_reinforced",
              session_id: sessionId,
              trace_id: activeTurnState?.traceId || event?.runId || ctx?.runId || null,
              memory_id: id.slice(0, 16),
              source: "autoRecall.finalize",
              metadata_json: { ...metadata },
            });
          }
        } catch (error) {
          api.logger?.warn?.(`memory-engine autoRecall citation finalize skipped: ${error.message}`);
        } finally {
          if (runId) {
            turnState.deleteTurnState(runId);
            turnState.deleteToolInvocationScopesByRunId(runId);
          }
        }
      });
    }

    if (typeof api?.registerMemoryPromptSupplement === "function") {
      api.registerMemoryPromptSupplement(params => buildMemoryPromptSupplement(turnState, params));
    }
    return true;
  };

  return Object.freeze({
    register,
    resolveTrafficOriginContext,
    onMemoryEngineGetSuccess,
    turnState,
  });
}
