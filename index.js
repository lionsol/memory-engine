import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { getMemorySearchManager } from "openclaw/plugin-sdk/memory-core-engine-runtime";
import lancedb from '@lancedb/lancedb';
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
import { appendSmartAdd } from "./session-checkpoint.js";
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
import { collectIndexedFiles, readIndexedPathState } from "./lib/sync/index-sync.js";
import { hybridSearch as runHybridSearch } from "./lib/recall/hybrid-search.js";
import { createMemoryEngineExecute } from "./lib/tools/memory-engine-actions.js";
import { generateEmbedding } from "./lib/siliconflow-runtime.js";

const KG_PATH = resolve(HOME_DIR, ".openclaw/workspace/knowledge-graph.json");
const LANCEDB_PATH = resolve(HOME_DIR, ".openclaw/memory/lancedb");
const LANCEDB_READY_TIMEOUT_MS = 400;
const MEMORY_SUPPLEMENT_SENTINEL = "MEMORY_SUPPLEMENT_SENTINEL";
const MEMORY_SUPPLEMENT_BOUNDARY_START = "<!-- MEMORY_ENGINE_SUPPLEMENT_START -->";
const MEMORY_SUPPLEMENT_BOUNDARY_END = "<!-- MEMORY_ENGINE_SUPPLEMENT_END -->";

// ── LanceDB globals (initialized in register) ──
let lancedbTable = null;
let lancedbReadyPromise = null;
const lancedbReadyState = {
  state: process.env.MEMORY_ENGINE_DISABLE_LANCEDB === "1" ? "disabled" : "pending",
  error: null,
};
const indexSyncState = {
  lastSyncAt: 0,
  lastMaxMtimeMs: 0,
};
let memoryStorageReady = false;

/**
 * Initialize LanceDB: connect and ensure the chunks table exists.
 */
async function initLanceDB() {
  if (lancedbReadyState.state === "disabled") {
    lancedbTable = null;
    return false;
  }
  lancedbReadyState.state = "pending";
  lancedbReadyState.error = null;
  try {
    const db = await lancedb.connect(LANCEDB_PATH);
    const tableNames = await db.tableNames();
    if (tableNames.includes('chunks')) {
      lancedbTable = await db.openTable('chunks');
    } else {
      lancedbTable = await db.createTable('chunks', [
        { id: crypto.randomUUID(), text: "", vector: new Array(2560).fill(0), timestamp: Date.now() }
      ]);
    }
    lancedbReadyState.state = "ready";
    console.log("[memory-engine] LanceDB initialized at", LANCEDB_PATH);
    return true;
  } catch (e) {
    lancedbReadyState.state = "failed";
    lancedbReadyState.error = e?.message ? String(e.message) : String(e);
    lancedbTable = null;
    console.warn("[memory-engine] LanceDB init skipped:", e.message);
    return false;
  }
}

function ensureLanceDBReady() {
  if (lancedbReadyState.state === "disabled") return Promise.resolve(false);
  if (!lancedbReadyPromise) {
    lancedbReadyPromise = initLanceDB()
      .catch(() => false)
      .finally(() => {
        // Keep the settled promise for later callers.
      });
  }
  return lancedbReadyPromise;
}

async function getLanceDBRuntime({ timeoutMs = LANCEDB_READY_TIMEOUT_MS } = {}) {
  if (lancedbReadyState.state === "disabled") {
    return { table: null, readyState: "disabled", initError: null, timedOut: false };
  }

  let timedOut = false;
  const readyPromise = ensureLanceDBReady();
  if (lancedbReadyState.state === "pending") {
    await Promise.race([
      readyPromise,
      new Promise(resolve => setTimeout(() => {
        timedOut = true;
        resolve();
      }, Math.max(0, Number(timeoutMs) || 0))),
    ]);
  } else {
    await readyPromise;
  }

  return {
    table: lancedbReadyState.state === "ready" ? lancedbTable : null,
    readyState: lancedbReadyState.state,
    initError: lancedbReadyState.error || null,
    timedOut,
  };
}

const CATEGORY_MAP = {
  temporary:       { conf: 0.40, tau: 2.0 },
  raw_log:         { conf: 0.50, tau: 7.0 },
  episodic:        { conf: 0.70, tau: 30.0 },
  preference:      { conf: 0.70, tau: 30.0 },
  kg_node:         { conf: 0.85, tau: 90.0 },
  user_identity:   { conf: 0.95, tau: 365.0 },
};

function withDb(fn) {
  return withEngineDb(fn, { readonly: false });
}

function calcTau(hits, baseTau) {
  if (baseTau >= 365.0) return baseTau;
  return baseTau + (365.0 - baseTau) * (1 - Math.exp(-0.3 * hits));
}

function catParams(category, isProtected) {
  if (isProtected || category === "user_identity") return { conf: 0.95, tau: 365.0 };
  return CATEGORY_MAP[category] || CATEGORY_MAP.raw_log;
}

/**
 * Auto-route text to an appropriate category via regex rules.
 * Only overrides when no explicit category was passed (or raw_log default).
 */
function autoRouteCategory(text, metadata = {}) {
  if (metadata.category && metadata.category !== 'raw_log') {
    return metadata.category;
  }
  if (/api[_-]?key|voice[_-]?id|model\s*[:=]|\/[a-z0-9_\/\.-]+\.[a-z]{2,5}|[a-f0-9]{32,}/i.test(text)) {
    return 'preference';
  }
  if (/我是|我叫|我的名字|我的职业|我在.*工作|我住在/.test(text)) {
    return 'user_identity';
  }
  if (/暂时|临时|一次性|仅这次|就现在|当前会话|测试一下|试试看/.test(text)) {
    return 'temporary';
  }
  if (/我喜欢|我习惯|我偏好|我常用|我一般|我倾向于|记住|别忘了|以后都|下次|我的设置/.test(text)) {
    return 'preference';
  }
  if (/决定|结论|总结|教训|经验|最终选择|定下来|确定了/.test(text)) {
    return 'preference';
  }
  return 'raw_log';
}

function calcRealtimeConf(row, now) {
  if (row.is_protected) return row.confidence;
  if (!row.last_confidence_update) return row.confidence;
  const deltaDays = (now - row.last_confidence_update) / 86400;
  const tau = calcTau(row.hit_count, row.base_tau);
  let c = row.confidence * Math.exp(-deltaDays / tau);
  if (row.conflict_flag) c -= 0.5;
  return Math.max(0, c);
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

function buildRecallCompletedMetadata({
  skipped = false,
  skip_reason = null,
  candidate_count = 0,
  candidate_count_before_gate = 0,
  candidate_count_after_gate = 0,
  strict_count = 0,
  fallback_count = 0,
  post_rerank_count = 0,
  injected_count = 0,
} = {}) {
  return {
    skipped: Boolean(skipped),
    skip_reason: skip_reason || null,
    candidate_count: Number(candidate_count) || 0,
    candidate_count_before_gate: Number(candidate_count_before_gate) || 0,
    candidate_count_after_gate: Number(candidate_count_after_gate) || 0,
    strict_count: Number(strict_count) || 0,
    fallback_count: Number(fallback_count) || 0,
    post_rerank_count: Number(post_rerank_count) || 0,
    injected_count: Number(injected_count) || 0,
  };
}

function gateThresholdForCategory(category, minCoverage = null) {
  const normalized = String(category || "raw_log").toLowerCase();
  const finalScoreMin =
    normalized === "raw_log" ? 0.05 :
    normalized === "episodic" ? 0.02 :
    null;
  return {
    final_score_min: finalScoreMin,
    min_coverage: Number.isFinite(minCoverage) ? Number(minCoverage) : null,
  };
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
    "vector_error",
    "vector_warning",
    "vector_ms",
    "vector_query_length",
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

function batchReinforce(db, ids, nowSec) {
  const stmt = db.prepare([
    "UPDATE memory_confidence SET",
    "hit_count = hit_count + 1,",
    "confidence = MIN(1.0, confidence + 0.1),",
    "last_confidence_update = ?",
    "WHERE chunk_id = ?"
  ].join(" "));
  const txn = db.transaction(() => {
    let count = 0;
    for (const id of ids) {
      stmt.run(nowSec, id);
      if (stmt.changes > 0) count++;
    }
    return count;
  });
  return txn();
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

function resolvePrefixes(db, prefixes) {
  const results = [];
  for (const pf of prefixes) {
    const rows = db.prepare([
      "SELECT chunk_id FROM memory_confidence WHERE chunk_id LIKE ? || '%' LIMIT 1"
    ].join(" ")).all(pf);
    if (rows.length > 0) results.push(rows[0].chunk_id);
  }
  return results;
}

function extractCategoryFromText(text = "") {
  const match = String(text || "").match(/(?:^|\n)Category:\s*([a-z_]+)/i);
  return match?.[1] ? String(match[1]).toLowerCase() : "";
}

function inferCategoryFromPath(path = "") {
  const normalized = String(path || "").replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
  if (!normalized) return "external";
  if (normalized === "memory.md") return "core_profile";
  if (normalized.startsWith("memory/projects/")) return "project";
  if (/^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(normalized)) return "daily_journal";
  if (normalized.startsWith("memory/dreaming/")) return "dreaming";
  if (normalized === "memory/stats-history.md") return "stats";
  if (normalized.startsWith("memory/episodes/")) return "episodic";
  if (normalized.startsWith("memory/smart-add/")) return "raw_log";
  return "external";
}

function inferCategoryFromChunk(path = "", text = "", fallback = "raw_log") {
  const fromText = extractCategoryFromText(text);
  if (fromText && CATEGORY_MAP[fromText]) return fromText;
  const fromPath = inferCategoryFromPath(path);
  if (fromPath !== "external") return fromPath;
  return fallback;
}

function backfillConfidenceForIndexedChunks(db, nowSec) {
  const rows = db.prepare(`
    SELECT c.id, c.path, c.text
    FROM chunks c
    LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
    WHERE mc.chunk_id IS NULL
      AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
    ORDER BY c.updated_at DESC
    LIMIT 500
  `).all();
  if (rows.length === 0) return { scanned: 0, inserted: 0 };

  const insert = db.prepare([
    "INSERT OR IGNORE INTO memory_confidence",
    "(chunk_id, initial_confidence, confidence, last_confidence_update,",
    "base_tau, hit_count, is_archived, is_protected, conflict_flag, category)",
    "VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?)"
  ].join(" "));
  let inserted = 0;
  const txn = db.transaction(() => {
    for (const row of rows) {
      const category = inferCategoryFromChunk(row.path, row.text);
      const { conf, tau } = catParams(category, false);
      const info = insert.run(row.id, conf, conf, nowSec, tau, category);
      if (info.changes > 0) inserted += 1;
    }
  });
  txn();
  return { scanned: rows.length, inserted };
}

async function syncIndexIfNeeded(reason = "autoRecall") {
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const scannedFiles = collectIndexedFiles(WORKSPACE, INDEX_SYNC_WATCH_DIRS);
  const stats = {
    fileCount: scannedFiles.length,
    maxMtimeMs: scannedFiles.reduce((m, f) => Math.max(m, f.mtimeMs), 0),
  };
  const scannedPaths = scannedFiles.map(f => f.relPath);
  const changed = stats.maxMtimeMs > indexSyncState.lastMaxMtimeMs;
  const needsInitialSync = indexSyncState.lastSyncAt === 0;
  const beforeState = withDb(db => readIndexedPathState(db, scannedPaths));

  if (!changed && !needsInitialSync) {
    return withDb(db => ({
      synced: false,
      reason: "fresh",
      memory_root: WORKSPACE,
      watch_dirs: [...INDEX_SYNC_WATCH_DIRS],
      files: stats.fileCount,
      scanned_paths: scannedPaths,
      indexed_paths_before: beforeState.paths,
      indexed_paths_after: beforeState.paths,
      skipped_paths: scannedPaths.filter(p => !beforeState.paths.includes(p)),
      updated_at: beforeState.updatedAt,
      changed_paths: [],
      manager_dirty_before: null,
      force_sync: false,
      backfill: backfillConfidenceForIndexedChunks(db, nowSec),
    }));
  }

  const previousMaxMtimeMs = indexSyncState.lastMaxMtimeMs;
  const changedPaths = scannedFiles
    .filter(f => f.mtimeMs > previousMaxMtimeMs)
    .map(f => f.relPath);
  indexSyncState.lastMaxMtimeMs = Math.max(indexSyncState.lastMaxMtimeMs, stats.maxMtimeMs);
  try {
    const { manager } = await getSharedMemoryManager();
    if (manager) {
      const managerStatusBefore = typeof manager.status === "function" ? manager.status() : null;
      const managerDirtyBefore = Boolean(managerStatusBefore?.dirty);
      const forceSync = changed && !managerDirtyBefore;
      await manager.sync(forceSync ? { reason, force: true } : { reason });
      indexSyncState.lastSyncAt = nowMs;
      const afterState = withDb(db => readIndexedPathState(db, scannedPaths));
      return withDb(db => ({
        synced: true,
        reason,
        memory_root: WORKSPACE,
        watch_dirs: [...INDEX_SYNC_WATCH_DIRS],
        files: stats.fileCount,
        scanned_paths: scannedPaths,
        indexed_paths_before: beforeState.paths,
        indexed_paths_after: afterState.paths,
        skipped_paths: scannedPaths.filter(p => !afterState.paths.includes(p)),
        updated_at: afterState.updatedAt,
        changed_paths: changedPaths,
        manager_dirty_before: managerDirtyBefore,
        force_sync: forceSync,
        backfill: backfillConfidenceForIndexedChunks(db, nowSec),
      }));
    }
  } catch {}

  const fallbackAfterState = withDb(db => readIndexedPathState(db, scannedPaths));
  return withDb(db => ({
    synced: false,
    reason: "manager_unavailable",
    memory_root: WORKSPACE,
    watch_dirs: [...INDEX_SYNC_WATCH_DIRS],
    files: stats.fileCount,
    scanned_paths: scannedPaths,
    indexed_paths_before: beforeState.paths,
    indexed_paths_after: fallbackAfterState.paths,
    skipped_paths: scannedPaths.filter(p => !fallbackAfterState.paths.includes(p)),
    updated_at: fallbackAfterState.updatedAt,
    changed_paths: changedPaths,
    manager_dirty_before: null,
    force_sync: false,
    backfill: backfillConfidenceForIndexedChunks(db, nowSec),
  }));
}

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
            getLancedbTable: () => lancedbTable,
            getLancedbRuntime: getLanceDBRuntime,
            vectorReadyTimeoutMs: LANCEDB_READY_TIMEOUT_MS,
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
          console.log(`[memory-engine] autoRecall: prompt="${prompt.slice(0,60)}" hits=${hits} topK=${autoRecallTopK}`);
          const debugInfo = result?.debug || {};
          const postRerankCount = Array.isArray(debugInfo.post_rerank_topK) ? debugInfo.post_rerank_topK.length : 0;
          recordMemoryEvent({
            event_type: "auto_recall_debug",
            session_id: sessionId,
            trace_id: traceId,
            source: "autoRecall",
            metadata_json: buildAutoRecallDebugMetadata(prompt, result),
          });
          console.log(
            `[memory-engine] autoRecall.debug query original="${String(debugInfo.query_original || "").slice(0, 160)}" normalized="${String(debugInfo.query_normalized || "").slice(0, 160)}" fts_final="${String(debugInfo.fts_query_final || "").slice(0, 160)}" vector_query="${String(debugInfo.vector_query || "").slice(0, 160)}"`
          );
          console.log(
            `[memory-engine] autoRecall.debug strict_count=${debugInfo.strict_count ?? 0} fallback_count=${debugInfo.fallback_count ?? 0} candidate_counts_before_filtering=${JSON.stringify(debugInfo.candidate_counts_before_filtering || {})} fallbacks=${JSON.stringify(debugInfo.fallbacks_triggered || [])} gate_before=${debugInfo.candidate_count_before_gate ?? hits} gate_after=${debugInfo.candidate_count_after_gate ?? hits} rejected=${Array.isArray(debugInfo.rejected_candidates) ? debugInfo.rejected_candidates.length : 0}`
          );
          if (Array.isArray(debugInfo.post_rerank_topK) && debugInfo.post_rerank_topK.length > 0) {
            console.log(`[memory-engine] autoRecall.debug post_rerank_topK=${JSON.stringify(debugInfo.post_rerank_topK)}`);
          }
          console.log(`[memory-engine] autoRecall.debug channels=${JSON.stringify(result?.channel_sizes || {})} source_breakdown=${JSON.stringify(debugInfo.source_breakdown || {})} category_breakdown=${JSON.stringify(debugInfo.category_breakdown || {})} sync=${JSON.stringify(debugInfo.sync || {})}`);
          if (Array.isArray(debugInfo.pre_rerank_top)) {
            console.log(`[memory-engine] autoRecall.debug pre_rerank_top=${JSON.stringify(debugInfo.pre_rerank_top)}`);
          }
          if (Array.isArray(debugInfo.post_rerank_top)) {
            console.log(`[memory-engine] autoRecall.debug post_rerank_top=${JSON.stringify(debugInfo.post_rerank_top)}`);
          }
          if (hits > 0) {
            console.log(`[memory-engine] autoRecall.debug query="${prompt.slice(0, 160)}" candidates=${result.results.map(r => r.id).join(",")}`);
            result.results.slice(0, 5).forEach((r, i) => {
              const id = String(r.id || "").slice(0, 16);
              const c = r.category || "?";
              const conf = r.confidence ?? r.confidence_realtime ?? "?";
              const confMode = r.confidence_mode || "managed";
              const sourceType = r.source_type || "memory-engine-managed";
              const externalBadge = Boolean(r.external_badge);
              const decayEligible = Boolean(r.decay_eligible);
              const archiveEligible = Boolean(r.archive_eligible);
              const finalScore = r.final_score ?? r.rrf_score ?? "?";
              const rrfScore = r.rrf_score ?? "?";
              const semanticScore = r.semantic_score ?? r.similarity ?? 0;
              const recencyBoost = r.recency_boost ?? 0;
              const categoryBoost = r.category_boost ?? 0;
              const confidenceBoost = r.confidence_boost ?? 0;
              const externalBoost = r.external_boost ?? 0;
              const createdAt = r.created_at ? new Date(r.created_at * 1000).toISOString() : "n/a";
              console.log(`  #${i+1} [${id}] finalScore=${finalScore} semanticScore=${semanticScore} rrfScore=${rrfScore} recencyBoost=${recencyBoost} categoryBoost=${categoryBoost} confidenceBoost=${confidenceBoost} externalBoost=${externalBoost} cat=${c} conf=${conf} confidenceMode=${confMode} sourceType=${sourceType} externalBadge=${externalBadge} decayEligible=${decayEligible} archiveEligible=${archiveEligible} createdAt=${createdAt} preview="${(r.text||"").slice(0,100)}"`);
            });
          }
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
          console.log(`[memory-engine] AUTO_RECALL_GATE_ACTIVE trace_id=${traceId} total_candidates=${gateDecisions.length} gated_injected=${Math.min(gatedResults.length, autoRecallTopK)}`);
          gateDecisions.forEach(item => {
            console.log(
              `[memory-engine] autoRecall.gate decision id=${String(item?.id || "")} injected=${Boolean(item?.injected)} rejection_reason=${item?.rejection_reason || "none"} rejected_reason=${item?.rejected_reason || "none"} matched_key_classes=${JSON.stringify(item?.matched_key_classes || [])} threshold_used=${JSON.stringify(item?.threshold_used || null)} category=${String(item?.category || "raw_log")} final_score=${Number(item?.final_score ?? 0)}`
            );
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
      console.log(`[memory-engine] supplement.injected memory_count=${injected.length} preview="${supplement.slice(0, 4).join(" | ").slice(0, 180)}"`);
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
      getLancedbTable: () => lancedbTable,
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

    // Image Vision tool — 识别图片内容
    api.registerTool({
      name: "image_vision",
      label: "图片识别",
      description: "识别图片中的物体、场景、人物、动作等非文字内容。调用 Qwen3-VL-32B-Instruct (SiliconFlow)。传入图片路径和可选问句。",
      parameters: {
        type: "object",
        properties: {
          image_path: {
            type: "string",
            description: "图片文件路径（绝对路径或相对于工作区的路径）",
          },
          question: {
            type: "string",
            description: "问句，如省略则默认让模型描述图片内容",
          },
        },
        required: ["image_path"],
      },
      async execute(_id, params) {
        try {
          const imagePath = String(params?.image_path || "");
          const result = imagePath
            ? `image_vision disabled for local dev install: ${imagePath}`
            : "image_vision disabled for local dev install";
          return { content: [{ type: "text", text: result.trim() }] };
        } catch (e) {
          return { content: [{ type: "text", text: `图片识别失败: ${e.message}` }] };
        }
      },
    });
  },
});
