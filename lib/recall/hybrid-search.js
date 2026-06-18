import {
  buildLikeFallbackPatterns,
  buildFtsFallbackQuery,
  extractExactQueryFragments,
  normalizeFtsQuery,
  rankFtsFallbackCandidates,
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
  const runWithDbScope = typeof withDb.scoped === "function"
    ? withDb.scoped.bind(withDb)
    : (run) => run((fn, options = {}) => withDb(fn, options));

  return runWithDbScope(async (withDb) => {
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

  try {
    if (queryTerms.length > 0 || exactFragments.length > 0) {
      const likePatterns = buildLikeFallbackPatterns(normalizedQuery || strippedQuery, Math.max(4, likePatternTopN));
      if (likePatterns.length > 0) {
        const kgRows = withDb(db => {
          const where = likePatterns.map(() => "mc.kg_data LIKE ?").join(" OR ");
          const sql = `
            SELECT c.id, c.text, c.path, c.updated_at,
              mc.confidence as confidence,
              mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,
              COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,
              COALESCE(mc.conflict_flag, 0) as conflict_flag, mc.category as category,
              COALESCE(mc.is_archived, 0) as is_archived, mc.kg_data as kg_data
            FROM memory_confidence mc
            JOIN chunks c ON c.id = mc.chunk_id
            WHERE COALESCE(mc.is_archived, 0) = 0
              AND mc.kg_data IS NOT NULL
              AND mc.kg_data != ''
              AND (${where})
            ORDER BY c.updated_at DESC
            LIMIT ?
          `;
          return db.prepare(sql).all(...likePatterns, ftsTopK);
        });
        candidateCounts.kg_raw = kgRows.length;
        const scoredKg = uniqueById(
          kgRows
            .map(row => normalizeCandidate({
              ...row,
              category: row.category || inferCategoryFromChunk(row.path, row.text, categoryMap, "kg_node"),
              similarity: 0.45 + lexicalMatchScore(`${row.path}\n${row.text}\n${row.kg_data || ""}`, queryTerms),
              created_at: row.updated_at || 0,
            }))
            .filter(Boolean)
            .filter(filterForRerank)
            .map(item => enrichLexicalCandidate(item, { queryTerms, exactFragments }))
            .filter(item => item.token_coverage > 0 || item.exact_bonus > 0 || item.structured_match_bonus > 0)
            .slice(0, ftsTopK)
        );
        candidateCounts.kg_after_conf_filter = scoredKg.length;
        if (scoredKg.length > 0) channels.kg = scoredKg;
      }
    }
  } catch (e) {
    debug.kg_error = toDebugErrorMessage(e);
    warnHybridSearchOnce("kg_search_error", e);
  }

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
        LIMIT ?
      `;
      const strictRows = withDb(db => db.prepare(ftsSelectSql).all(normalizedQuery, ftsTopK));
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
            .map(item => enrichLexicalCandidate(item, { queryTerms, exactFragments }))
        );
        candidateCounts.fts_raw_final = channels.fts.length;
      } else if (fallbackFtsQuery && fallbackFtsQuery !== normalizedQuery) {
        const fallbackRows = withDb(db => db.prepare(ftsSelectSql).all(fallbackFtsQuery, ftsTopK));
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
              .map(item => enrichLexicalCandidate(item, { queryTerms, exactFragments }))
          );
        }
        candidateCounts.fts_raw_final = Array.isArray(channels.fts) ? channels.fts.length : 0;
        ftsIsEmpty = candidateCounts.fts_raw_final === 0;
      } else {
        candidateCounts.fts_raw_final = 0;
      }
    }
  } catch (e) {
    debug.fts_error = toDebugErrorMessage(e);
    warnHybridSearchOnce("fts_search_error", e);
  }

  const lexicalChannels = {};
  if (Array.isArray(channels.kg) && channels.kg.length > 0) lexicalChannels.kg = channels.kg;
  if (Array.isArray(channels.fts) && channels.fts.length > 0) lexicalChannels.fts = channels.fts;
  const lexicalFusion = fuseChannels(lexicalChannels, { rrfK, nowSec, rankingConfig });
  const lexicalFusedSorted = [...lexicalFusion.fused].sort((a, b) => b.finalScore - a.finalScore);
  Object.assign(debug, computeLexicalConfidence(lexicalFusedSorted));

  const shouldSkipVector = debug.lexical_confidence >= lexicalConfidenceThreshold && lexicalFusedSorted.length > 0;

  let lancedbTable = null;
  let lancedbReadyState = "disabled";
  let lancedbInitError = null;
  let lancedbTimedOut = false;
  const vectorStartMs = Date.now();
  debug.vector_backend_attempted = shouldSkipVector ? null : "lancedb";

  if (shouldSkipVector) {
    debug.vector_skipped = true;
    debug.vector_skip_reason = "lexical_confidence_threshold_met";
    debug.vector_stage = "skipped";
    debug.vector_ready_state = "skipped";
    debug.vector_backend = "skipped";
    debug.vector_ms = Date.now() - vectorStartMs;
  } else {
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
  }

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
            LIMIT ?
          `;
          const params = [...likePatterns.flatMap(pattern => [pattern, pattern]), likeTopK];
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
    } catch (e) {
      debug.like_error = toDebugErrorMessage(e);
      warnHybridSearchOnce("like_search_error", e);
    }
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
      LIMIT ?
    `).all(recentTopK));
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
  } catch (e) {
    debug.recent_error = toDebugErrorMessage(e);
    warnHybridSearchOnce("recent_search_error", e);
  }

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
        LIMIT ?
      `).all(recentFallbackTopK));
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
    } catch (e) {
      debug.recent_fallback_error = toDebugErrorMessage(e);
      warnHybridSearchOnce("recent_fallback_search_error", e);
    }
  }

  const { names, fused } = fuseChannels(channels, { rrfK, nowSec, rankingConfig });
  if (names.length === 0) return { pool: 0, results: [], channels: [], note: "no channels returned results" };

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
