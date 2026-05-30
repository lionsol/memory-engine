import {
  buildLikeFallbackPatterns,
  buildFtsFallbackQuery,
  extractQueryTokens,
  normalizeFtsQuery,
  rankFtsFallbackCandidates,
  stripPromptMetadataPrefix,
} from "../../query-utils.js";
import { getMemoryEngineConfig } from "../config/runtime.js";

const DEFAULT_EXTERNAL_CATEGORY_KEYS = Object.keys(
  getMemoryEngineConfig(null)?.ranking?.categoryBoost?.external || {}
);

function round4(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeUnixSeconds(value) {
  const n = toFiniteNumber(value);
  if (n === null || n <= 0) return 0;
  // Handle millisecond timestamps from LanceDB rows.
  return n > 100000000000 ? Math.floor(n / 1000) : Math.floor(n);
}

function extractCategoryFromText(text = "") {
  const match = String(text || "").match(/(?:^|\n)Category:\s*([a-z_]+)/i);
  return match?.[1] ? String(match[1]).toLowerCase() : "";
}

export function inferCategoryFromPath(path = "") {
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

function inferCategoryFromChunk(path = "", text = "", categoryMap = null, fallback = "external") {
  const fromText = extractCategoryFromText(text);
  if (fromText) {
    if (!categoryMap || categoryMap[fromText]) return fromText;
    if (DEFAULT_EXTERNAL_CATEGORY_KEYS.includes(fromText)) return fromText;
  }
  const fromPath = inferCategoryFromPath(path);
  if (fromPath !== "external") return fromPath;
  return fallback;
}

function deriveCandidateSources({ path = "", category = "", text = "", confidence_mode = "" }) {
  const tags = [];
  const p = String(path || "");
  const c = String(category || "").toLowerCase();
  const t = String(text || "").toLowerCase();
  if (p.startsWith("memory/smart-add/")) tags.push("smart-add");
  if (p.startsWith("memory/episodes/") || c === "episodic") tags.push("episodic");
  if (/session\s*checkpoint|session[_ -]?key|session[_ -]?id/.test(t) || /session[-_]?checkpoint/i.test(p)) {
    tags.push("session_checkpoint");
  }
  if (confidence_mode === "external") tags.push("external");
  return tags;
}

function tokenizeQuery(text, maxTerms = 10) {
  return extractQueryTokens(text, maxTerms);
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

function computeRecencyBoost(createdAtSec, nowSec, rankingConfig = {}) {
  if (!createdAtSec || !Number.isFinite(createdAtSec)) return 0;
  const ageDays = Math.max(0, (nowSec - createdAtSec) / 86400);
  const recencyCfg = rankingConfig?.recencyBoost || {};
  const base = toFiniteNumber(recencyCfg.base) ?? 0.06;
  const decayDays = toFiniteNumber(recencyCfg.decayDays) ?? 2.5;
  const safeDecay = decayDays > 0 ? decayDays : 2.5;
  const boost = base * Math.exp(-ageDays / safeDecay);
  return round4(boost);
}

function computeManagedCategoryBoost(category, text = "", rankingConfig = {}) {
  const managedCfg = rankingConfig?.categoryBoost?.managed || {};
  const cat = String(category || "").toLowerCase();
  const episodicBoost = Number(managedCfg.episodic);
  const sessionCheckpointBoost = Number(managedCfg.sessionCheckpoint);
  if (cat === "episodic") return Number.isFinite(episodicBoost) ? episodicBoost : 0.12;
  const raw = String(text || "").toLowerCase();
  if (raw.includes("session checkpoint") || raw.includes("session-checkpoint")) {
    return Number.isFinite(sessionCheckpointBoost) ? sessionCheckpointBoost : 0.1;
  }
  return 0;
}

function resolveEffectiveMinConfidence(cfg = null, engineConfig = null) {
  const mergedConfig = engineConfig || getMemoryEngineConfig(cfg);
  const fromCfg = cfg?.memory?.minConfidence ?? cfg?.autoRecall?.minConfidence ?? mergedConfig?.confidence?.min;
  const fromEnv = process.env.MEMORY_ENGINE_MIN_CONFIDENCE;
  const resolved = toFiniteNumber(fromCfg ?? fromEnv);
  if (resolved === null) return toFiniteNumber(mergedConfig?.confidence?.min) ?? 0.15;
  return Math.max(0, Math.min(1, resolved));
}

function normalizeExternalMemory(row = {}, {
  nowSec,
  calcRealtimeConf,
  categoryMap = null,
} = {}) {
  const id = String(row.id || row.chunk_id || "").trim();
  if (!id) return null;
  const text = String(row.text || "");
  const path = String(row.path || "");
  const similarity = round4(toFiniteNumber(row.similarity) ?? 0);
  const createdAt = normalizeUnixSeconds(row.created_at ?? row.updated_at ?? row.timestamp);
  const rawConfidence = toFiniteNumber(row.confidence);
  const hasManagedConfidence = rawConfidence !== null;
  const mode = hasManagedConfidence ? "managed" : "external";
  const explicitCategory = row.category ? String(row.category).toLowerCase() : "";
  const inferredCategory = inferCategoryFromChunk(
    path,
    text,
    categoryMap,
    mode === "external" ? "external" : "raw_log"
  );
  const category = explicitCategory || inferredCategory;

  if (mode === "external") {
    return {
      id,
      text: text.slice(0, 600),
      path,
      category,
      semantic_score: similarity,
      similarity,
      confidence: null,
      confidence_mode: "external",
      source_type: "openclaw-core",
      hit_count: Number(row.hit_count || 0),
      hits: Number(row.hit_count || 0),
      is_protected: Number(row.is_protected || 0),
      conflict_flag: Number(row.conflict_flag || 0),
      is_archived: Number(row.is_archived || 0),
      decay_eligible: false,
      archive_eligible: false,
      external_badge: true,
      created_at: createdAt,
    };
  }

  let realtimeConf = toFiniteNumber(row.confidence_realtime);
  if (realtimeConf === null && typeof calcRealtimeConf === "function") {
    try {
      realtimeConf = toFiniteNumber(calcRealtimeConf({
        ...row,
        confidence: rawConfidence,
      }, nowSec));
    } catch {
      realtimeConf = rawConfidence;
    }
  }
  if (realtimeConf === null) realtimeConf = rawConfidence;
  realtimeConf = Math.max(0, Math.min(1, Number(realtimeConf)));
  const isProtected = Number(row.is_protected || 0);
  const isArchived = Number(row.is_archived || 0);

  return {
    id,
    text: text.slice(0, 600),
    path,
    category,
    semantic_score: similarity,
    similarity,
    confidence: round4(realtimeConf),
    confidence_mode: "managed",
    source_type: "memory-engine-managed",
    hit_count: Number(row.hit_count || 0),
    hits: Number(row.hit_count || 0),
    is_protected: isProtected,
    conflict_flag: Number(row.conflict_flag || 0),
    is_archived: isArchived,
    decay_eligible: isProtected === 0 && isArchived === 0,
    archive_eligible: isProtected === 0 && isArchived === 0,
    external_badge: false,
    created_at: createdAt,
  };
}

function isCandidateAllowedForRerank(item, minConfidence) {
  if (!item || !item.id) return false;
  if (item.confidence_mode === "external") return true;
  const conf = toFiniteNumber(item.confidence);
  if (conf === null) return false;
  return conf >= minConfidence;
}

function categoryBoost(item, rankingConfig = {}) {
  if (item?.confidence_mode === "external") {
    const externalSourceBoost = rankingConfig?.categoryBoost?.external || {};
    const fallbackExternalBoost = Number(externalSourceBoost.external);
    const key = String(item?.category || "external").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(externalSourceBoost, key)) {
      const value = Number(externalSourceBoost[key]);
      return Number.isFinite(value) ? value : 0;
    }
    return Number.isFinite(fallbackExternalBoost) ? fallbackExternalBoost : 0.03;
  }
  return computeManagedCategoryBoost(item?.category, item?.text, rankingConfig);
}

function confidenceBoost(item, rankingConfig = {}) {
  if (item?.confidence_mode === "external") return 0;
  const conf = toFiniteNumber(item?.confidence);
  if (conf === null) return 0;
  const weight = toFiniteNumber(rankingConfig?.confidenceWeight) ?? 0.1;
  return round4(conf * weight);
}

function externalBoost(item, rankingConfig = {}) {
  if (item?.confidence_mode !== "external") return 0;
  const excluded = Array.isArray(rankingConfig?.externalBoost?.excludedCategories)
    ? rankingConfig.externalBoost.excludedCategories
    : ["dreaming", "stats"];
  const category = String(item?.category || "external").toLowerCase();
  if (excluded.includes(category)) return 0;
  const value = toFiniteNumber(rankingConfig?.externalBoost?.value);
  return value === null ? 0.05 : value;
}

function scoreCandidate(item) {
  return round4(
    (toFiniteNumber(item?.semanticScore) ?? 0) +
    (toFiniteNumber(item?.rrfScore) ?? 0) +
    (toFiniteNumber(item?.categoryBoost) ?? 0) +
    (toFiniteNumber(item?.recencyBoost) ?? 0) +
    (toFiniteNumber(item?.confidenceBoost) ?? 0) +
    (toFiniteNumber(item?.externalBoost) ?? 0)
  );
}

const warnedVectorChannelFailures = new Set();

function warnVectorChannelOnce(message, error = null) {
  const key = String(message || "unknown");
  if (warnedVectorChannelFailures.has(key)) return;
  warnedVectorChannelFailures.add(key);
  const detail = error?.message ? `: ${error.message}` : "";
  console.warn(`[memory-engine] hybridSearch vector channel unavailable (${message})${detail}`);
}

function toDebugErrorMessage(error) {
  if (!error) return "unknown error";
  if (error?.message) return String(error.message);
  return String(error);
}

async function collectLanceRows(rawLance) {
  if (!rawLance) return [];
  if (typeof rawLance[Symbol.asyncIterator] === "function") {
    const rows = [];
    for await (const batch of rawLance) {
      for (const row of batch) rows.push(row);
    }
    return rows;
  }
  if (Array.isArray(rawLance)) return rawLance;
  return [];
}

function uniqueById(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!item || !item.id) continue;
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return Array.from(map.values());
}

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
  } = runtime;
  if (typeof withDb !== "function") throw new Error("hybridSearch runtime.withDb is required");
  if (typeof calcRealtimeConf !== "function") throw new Error("hybridSearch runtime.calcRealtimeConf is required");
  if (typeof syncIndexIfNeeded !== "function") throw new Error("hybridSearch runtime.syncIndexIfNeeded is required");
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
  const channels = {};
  const rawQuery = String(text || "");
  const strippedQuery = stripPromptMetadataPrefix(rawQuery);
  const normalizedQuery = normalizeFtsQuery(strippedQuery);
  const fallbackFtsQuery = buildFtsFallbackQuery(strippedQuery);
  const queryTerms = tokenizeQuery(normalizedQuery);
  const candidateCounts = {
    vector_raw: 0,
    vector_after_conf_filter: 0,
    fts_raw_primary: 0,
    fts_raw_final: 0,
    like_raw: 0,
    recent_raw: 0,
    episode_raw: 0,
    recent_fallback_raw: 0,
  };
  const debug = {
    query_original: rawQuery,
    query_stripped: strippedQuery,
    query_normalized: normalizedQuery,
    fts_query_final: normalizedQuery,
    vector_query: strippedQuery,
    query_terms: queryTerms,
    candidate_counts_before_filtering: candidateCounts,
    fallbacks_triggered: [],
    vector_backend: "disabled",
    vector_backend_attempted: null,
    vector_ready_state: "disabled",
    vector_stage: "ready_check",
    vector_error: null,
    vector_ms: null,
    vector_query_length: strippedQuery.length,
    strict_count: 0,
    fallback_count: 0,
    post_rerank_topK: [],
    min_confidence: minConfidence,
  };
  const vectorStartMs = Date.now();
  debug.vector_backend_attempted = "lancedb";

  try {
    debug.sync = await syncIndexIfNeeded("hybridSearch");
  } catch (e) {
    debug.sync = { synced: false, reason: "sync_error", error: e.message };
  }

  const confidenceRows = withDb(db => db.prepare(
    "SELECT chunk_id, confidence, last_confidence_update, base_tau, hit_count, is_protected, conflict_flag, category, is_archived FROM memory_confidence"
  ).all());
  const confidenceMap = new Map(confidenceRows.map(row => [row.chunk_id, row]));
  const chunkRows = withDb(db => db.prepare("SELECT id, path, updated_at FROM chunks").all());
  const chunkMetaMap = new Map(chunkRows.map(row => [row.id, row]));

  const normalizeCandidate = row => normalizeExternalMemory(row, {
    nowSec,
    calcRealtimeConf,
    categoryMap,
  });
  const filterForRerank = item => isCandidateAllowedForRerank(item, minConfidence);

  let lancedbTable = null;
  let lancedbReadyState = "disabled";
  let lancedbInitError = null;
  let lancedbTimedOut = false;

  if (typeof getLancedbRuntimeRuntime === "function") {
    try {
      const runtimeInfo = await getLancedbRuntimeRuntime({ timeoutMs: vectorReadyTimeoutMs });
      if (runtimeInfo && typeof runtimeInfo === "object" && !Array.isArray(runtimeInfo)) {
        lancedbTable = runtimeInfo.table || null;
        lancedbReadyState = String(runtimeInfo.readyState || (lancedbTable ? "ready" : "disabled"));
        if (runtimeInfo.initError !== undefined && runtimeInfo.initError !== null) {
          lancedbInitError = String(runtimeInfo.initError);
        }
        lancedbTimedOut = Boolean(runtimeInfo.timedOut);
      } else {
        lancedbTable = runtimeInfo || null;
        lancedbReadyState = lancedbTable ? "ready" : "disabled";
      }
    } catch (e) {
      lancedbReadyState = "failed";
      lancedbInitError = e?.message ? String(e.message) : String(e);
      warnVectorChannelOnce("lancedb_runtime_error", e);
    }
  } else if (typeof getLancedbTableRuntime === "function") {
    lancedbTable = getLancedbTableRuntime();
    lancedbReadyState = lancedbTable ? "ready" : "disabled";
  }

  debug.vector_ready_state = lancedbReadyState;
  if (lancedbReadyState === "failed" && lancedbInitError) {
    debug.vector_init_error = lancedbInitError;
  }

  let vectorHandled = false;
  if (!lancedbTable) {
    if (lancedbReadyState === "pending" && lancedbTimedOut) {
      warnVectorChannelOnce("lancedb_pending_timeout");
    } else if (lancedbReadyState === "failed") {
      warnVectorChannelOnce("lancedb_init_failed", lancedbInitError ? new Error(lancedbInitError) : null);
    } else {
      warnVectorChannelOnce("lancedb_table_null");
    }
    debug.vector_stage = "fallback";
  } else if (typeof generateEmbeddingRuntime !== "function") {
    warnVectorChannelOnce("lancedb_embedding_unavailable");
    debug.vector_stage = "fallback";
    debug.vector_error = "embedding runtime unavailable";
  } else {
    debug.vector_stage = "embedding";
    let queryVec = null;
    let embeddingFailed = false;
    try {
      queryVec = await generateEmbeddingRuntime(strippedQuery);
    } catch (e) {
      embeddingFailed = true;
      debug.vector_error = toDebugErrorMessage(e);
      warnVectorChannelOnce("lancedb_embedding_error", e);
    }
    if (!embeddingFailed && queryVec !== null && queryVec !== undefined) {
      const isArrayLikeVector = Array.isArray(queryVec) || ArrayBuffer.isView(queryVec);
      const queryVecLength = Number(queryVec.length || 0);
      if (!isArrayLikeVector) {
        debug.vector_error = "invalid embedding dimension";
        warnVectorChannelOnce("lancedb_embedding_invalid_dimension");
      } else if (queryVecLength === 0) {
        debug.vector_error = "empty embedding";
        warnVectorChannelOnce("lancedb_embedding_empty");
      } else if (!Array.from(queryVec).every(v => Number.isFinite(v))) {
        debug.vector_error = "invalid embedding dimension";
        warnVectorChannelOnce("lancedb_embedding_invalid_dimension");
      } else {
        debug.vector_stage = "lancedb_search";
        try {
          const rawLance = await lancedbTable.search(queryVec).limit(vectorTopK).execute();
          const lanceRows = await collectLanceRows(rawLance);
          vectorHandled = true;
          debug.vector_backend = "lancedb";
          candidateCounts.vector_raw = lanceRows.length;
          if (lanceRows.length > 0) {
            const scored = uniqueById(
              lanceRows
                .map(row => {
                  const id = String(row?.id || "").trim();
                  if (!id) return null;
                  const meta = confidenceMap.get(id) || {};
                  const chunkMeta = chunkMetaMap.get(id) || {};
                  return normalizeCandidate({
                    id,
                    text: String(row?.text || ""),
                    path: chunkMeta.path || "",
                    created_at: chunkMeta.updated_at || row?.timestamp || 0,
                    similarity: row?._distance !== undefined ? (1 - Number(row._distance)) : 0.6,
                    ...meta,
                  });
                })
                .filter(Boolean)
                .filter(item => Number.isFinite(item.semantic_score))
                .filter(filterForRerank)
                .sort((a, b) => b.semantic_score - a.semantic_score)
                .slice(0, vectorTopK)
            );
            candidateCounts.vector_after_conf_filter = scored.length;
            if (scored.length > 0) channels.vector = scored;
          }
        } catch (e) {
          debug.vector_error = toDebugErrorMessage(e);
          warnVectorChannelOnce("lancedb_search_error", e);
        }
      }
    } else if (!embeddingFailed) {
      debug.vector_error = "empty embedding";
      warnVectorChannelOnce("lancedb_embedding_empty");
    }
  }

  if (!vectorHandled) {
    if (debug.vector_stage === "ready_check") {
      debug.vector_stage = "fallback";
    }
    let vectorManager = null;
    try {
      const managerResult = cfg
        ? await getMemorySearchManagerFn({ cfg })
        : await getMemorySearchManagerFn();
      vectorManager = managerResult?.manager || null;
      if (!vectorManager) {
        warnVectorChannelOnce("manager_missing", managerResult?.error ? new Error(String(managerResult.error)) : null);
      }
    } catch (e) {
      warnVectorChannelOnce("manager_init_error", e);
    }

    if (vectorManager) {
      try {
        const raw = await vectorManager.search(strippedQuery, { limit: vectorTopK });
        const candidates = raw?.entries || raw || [];
        debug.vector_backend = "memory-core-sqlite";
        candidateCounts.vector_raw = candidates.length;
        const scored = uniqueById(
          candidates
            .map(c => {
              const id = c.id || c.chunkId;
              if (!id) return null;
              const meta = confidenceMap.get(id) || {};
              const chunkMeta = chunkMetaMap.get(id) || {};
              return normalizeCandidate({
                id,
                text: c.text || c.content || "",
                path: chunkMeta.path || "",
                created_at: chunkMeta.updated_at || 0,
                similarity: c.similarity ?? c.score ?? 0.5,
                ...meta,
              });
            })
            .filter(Boolean)
            .filter(item => Number.isFinite(item.semantic_score))
            .filter(filterForRerank)
            .sort((a, b) => b.semantic_score - a.semantic_score)
            .slice(0, vectorTopK)
        );
        candidateCounts.vector_after_conf_filter = scored.length;
        if (scored.length > 0) channels.vector = scored;
      } catch (e) {
        warnVectorChannelOnce("search_error", e);
      }
    }
  }
  debug.vector_ms = Date.now() - vectorStartMs;

  let ftsIsEmpty = true;
  try {
    if (normalizedQuery) {
      const ftsSelectSql = `
        SELECT c.id, c.text,
          c.path,
          c.updated_at,
          mc.confidence as confidence,
          mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,
          COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,
          COALESCE(mc.conflict_flag, 0) as conflict_flag, mc.category as category,
          COALESCE(mc.is_archived, 0) as is_archived
        FROM chunks_fts f
        JOIN chunks c ON c.id = f.id
        LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
        WHERE chunks_fts MATCH ?
          AND COALESCE(mc.is_archived, 0) = 0
        ORDER BY bm25(chunks_fts, 0)
        LIMIT ${ftsTopK}
      `;
      const strictRows = withDb(db => db.prepare(ftsSelectSql).all(normalizedQuery));
      candidateCounts.fts_raw_primary = strictRows.length;
      debug.strict_count = strictRows.length;
      if (strictRows.length > 0) {
        ftsIsEmpty = false;
        debug.fts_query_final = normalizedQuery;
        channels.fts = uniqueById(
          strictRows
            .map(row => normalizeCandidate({
              ...row,
              similarity: 0.5,
              created_at: row.updated_at || 0,
            }))
            .filter(Boolean)
            .filter(filterForRerank)
        );
        candidateCounts.fts_raw_final = channels.fts.length;
      } else if (fallbackFtsQuery && fallbackFtsQuery !== normalizedQuery) {
        const fallbackRows = withDb(db => db.prepare(ftsSelectSql).all(fallbackFtsQuery));
        debug.fallback_count = fallbackRows.length;
        debug.fts_query_final = fallbackFtsQuery;
        if (fallbackRows.length > 0) {
          const reranked = rankFtsFallbackCandidates(fallbackRows, {
            rawQuery: strippedQuery,
            queryTerms,
            nowSec,
            topK: ftsTopK,
          });
          debug.post_rerank_topK = reranked.post_rerank_topK;
          channels.fts = uniqueById(
            reranked.ranked
              .map(row => normalizeCandidate({
                ...row,
                similarity: row.fallback_score,
                created_at: row.updated_at || 0,
              }))
              .filter(Boolean)
              .filter(filterForRerank)
          );
        }
        candidateCounts.fts_raw_final = Array.isArray(channels.fts) ? channels.fts.length : 0;
        ftsIsEmpty = candidateCounts.fts_raw_final === 0;
      } else {
        candidateCounts.fts_raw_final = 0;
      }
    }
  } catch {}

  if (ftsIsEmpty) {
    debug.fallbacks_triggered.push("fts_empty");
    try {
      const likePatterns = buildLikeFallbackPatterns(normalizedQuery, likePatternTopN);
      debug.like_patterns = likePatterns;
      if (likePatterns.length > 0) {
        const likeRows = withDb(db => {
          const where = likePatterns.map(() => "(c.path LIKE ? OR c.text LIKE ?)").join(" OR ");
          const sql = `
            SELECT c.id, c.text, c.path, c.updated_at,
              mc.confidence as confidence,
              mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,
              COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,
              COALESCE(mc.conflict_flag, 0) as conflict_flag, mc.category as category,
              COALESCE(mc.is_archived, 0) as is_archived
            FROM chunks c
            LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
            WHERE COALESCE(mc.is_archived, 0) = 0
              AND (${where})
            ORDER BY c.updated_at DESC
            LIMIT ${likeTopK}
          `;
          const params = likePatterns.flatMap(pattern => [pattern, pattern]);
          return db.prepare(sql).all(...params);
        });
        candidateCounts.like_raw = likeRows.length;
        if (likeRows.length > 0) {
          debug.fallbacks_triggered.push("like_search");
          channels.like = uniqueById(
            likeRows
              .map(row => {
                const lexical = lexicalMatchScore(`${row.path}\n${row.text}`, queryTerms);
                return normalizeCandidate({
                  ...row,
                  similarity: (toFiniteNumber(rankingConfig?.fallbackBaseScore?.like) ?? 0.3) + lexical,
                  created_at: row.updated_at || 0,
                });
              })
              .filter(Boolean)
              .filter(filterForRerank)
          );
        }
      }
    } catch {}
  }

  try {
    const recentRows = withDb(db => db.prepare(`
      SELECT c.id, c.text, c.path, c.updated_at,
        mc.confidence as confidence,
        mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,
        COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,
        COALESCE(mc.conflict_flag, 0) as conflict_flag, mc.category as category,
        COALESCE(mc.is_archived, 0) as is_archived
      FROM chunks c
      LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
      WHERE COALESCE(mc.is_archived, 0) = 0
        AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
      ORDER BY c.updated_at DESC
      LIMIT ${recentTopK}
    `).all());
    candidateCounts.recent_raw = recentRows.length;
    const scoredRecent = uniqueById(
      recentRows
        .map(row => {
          const lexical = lexicalMatchScore(`${row.path}\n${row.text}`, queryTerms);
          if (lexical <= 0) return null;
          const recency = computeRecencyBoost(normalizeUnixSeconds(row.updated_at), nowSec, rankingConfig);
          return normalizeCandidate({
            ...row,
            category: row.category || inferCategoryFromChunk(row.path, row.text, categoryMap, "raw_log"),
            similarity: (toFiniteNumber(rankingConfig?.fallbackBaseScore?.recent) ?? 0.35) + lexical + recency,
            created_at: row.updated_at || 0,
          });
        })
        .filter(Boolean)
        .filter(filterForRerank)
        .sort((a, b) => b.semantic_score - a.semantic_score)
        .slice(0, recentRerankTopK)
    );
    if (scoredRecent.length > 0) channels.recent = scoredRecent;

    const episodeRows = scoredRecent
      .filter(row => row.category === "episodic" || String(row.path).startsWith("memory/episodes/"))
      .map(row => normalizeCandidate({
        ...row,
        similarity: row.semantic_score + (toFiniteNumber(rankingConfig?.fallbackBaseScore?.episodeBonus) ?? 0.08),
      }))
      .filter(Boolean)
      .slice(0, recentRerankTopK);
    candidateCounts.episode_raw = episodeRows.length;
    if (episodeRows.length > 0) channels.episode = episodeRows;
  } catch {}

  if (ftsIsEmpty) {
    if (candidateCounts.like_raw === 0 && Array.isArray(channels.vector) && channels.vector.length > 0) {
      debug.fallbacks_triggered.push("vector_only");
    }
    try {
      const recentFallbackRows = withDb(db => db.prepare(`
        SELECT c.id, c.text, c.path, c.updated_at,
          mc.confidence as confidence,
          mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,
          COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,
          COALESCE(mc.conflict_flag, 0) as conflict_flag, mc.category as category,
          COALESCE(mc.is_archived, 0) as is_archived
        FROM chunks c
        LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
        WHERE COALESCE(mc.is_archived, 0) = 0
          AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
        ORDER BY c.updated_at DESC
        LIMIT ${recentFallbackTopK}
      `).all());
      candidateCounts.recent_fallback_raw = recentFallbackRows.length;
      if (recentFallbackRows.length > 0) {
        debug.fallbacks_triggered.push("recent_episodic");
        channels.recent_fallback = uniqueById(
          recentFallbackRows
            .map(row => {
              const category = row.category || inferCategoryFromChunk(row.path, row.text, categoryMap, "raw_log");
              const recency = computeRecencyBoost(normalizeUnixSeconds(row.updated_at), nowSec, rankingConfig);
              return normalizeCandidate({
                ...row,
                category,
                similarity: (toFiniteNumber(rankingConfig?.fallbackBaseScore?.recentFallback) ?? 0.25) + recency,
                created_at: row.updated_at || 0,
              });
            })
            .filter(Boolean)
            .filter(filterForRerank)
        );
      }
    } catch {}
  }

  const names = Object.keys(channels).filter(name => Array.isArray(channels[name]) && channels[name].length > 0);
  if (names.length === 0) return { pool: 0, results: [], channels: [], note: "no channels returned results" };

  const fusion = new Map();
  for (const [chName, rankedItems] of Object.entries(channels)) {
    rankedItems.forEach((item, idx) => {
      const exist = fusion.get(item.id) || {
        id: item.id,
        text: item.text,
        category: item.category,
        confidence_mode: item.confidence_mode,
        source_type: item.source_type,
        decay_eligible: item.decay_eligible,
        archive_eligible: item.archive_eligible,
        external_badge: item.external_badge,
        channels: [],
        semantic_sources: [],
        sources: [],
        semanticScore: item.semantic_score || 0,
        rrfScore: 0,
        recencyBoost: 0,
        categoryBoost: 0,
        confidenceBoost: 0,
        externalBoost: 0,
        finalScore: 0,
        similarity: item.similarity,
        confidence: item.confidence,
        hits: item.hit_count,
        created_at: item.created_at || 0,
        path: item.path || "",
      };
      if (!exist.channels.includes(chName)) exist.channels.push(chName);
      const semanticTags = deriveCandidateSources(item);
      for (const tag of semanticTags) {
        if (!exist.semantic_sources.includes(tag)) exist.semantic_sources.push(tag);
      }
      exist.rrfScore += 1 / (rrfK + idx + 1);
      exist.semanticScore = Math.max(exist.semanticScore, item.semantic_score || 0);
      if (!exist.path && item.path) exist.path = item.path;
      if (!exist.category && item.category) exist.category = item.category;
      if (!exist.confidence_mode && item.confidence_mode) exist.confidence_mode = item.confidence_mode;
      if (!exist.source_type && item.source_type) exist.source_type = item.source_type;
      if (exist.confidence === null || exist.confidence === undefined) exist.confidence = item.confidence;
      if (!exist.created_at && item.created_at) exist.created_at = item.created_at;
      fusion.set(item.id, exist);
    });
  }

  const fused = Array.from(fusion.values()).map(item => {
    item.semanticScore = round4(item.semanticScore);
    item.rrfScore = round4(item.rrfScore);
    item.recencyBoost = computeRecencyBoost(item.created_at, nowSec, rankingConfig);
    item.categoryBoost = round4(categoryBoost(item, rankingConfig));
    item.confidenceBoost = confidenceBoost(item, rankingConfig);
    item.externalBoost = externalBoost(item, rankingConfig);
    item.finalScore = scoreCandidate(item);
    item.sources = [...new Set([...item.channels, ...item.semantic_sources])];
    return item;
  });

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
}
