import {
  buildLikeFallbackPatterns,
  buildFtsFallbackQuery,
  extractQueryTokens,
  normalizeFtsQuery,
  rankFtsFallbackCandidates,
  sanitizeFtsQuery,
  stripPromptMetadataPrefix,
} from "../../query-utils.js";

function extractCategoryFromText(text = "") {
  const match = String(text || "").match(/(?:^|\n)Category:\s*([a-z_]+)/i);
  return match?.[1] ? String(match[1]).toLowerCase() : "";
}

function inferCategoryFromChunk(path = "", text = "", categoryMap = null) {
  const fromText = extractCategoryFromText(text);
  if (fromText && categoryMap && categoryMap[fromText]) return fromText;
  if (String(path).startsWith("memory/episodes/")) return "episodic";
  return "raw_log";
}

function deriveCandidateSources({ path = "", category = "", text = "" }) {
  const tags = [];
  const p = String(path);
  const c = String(category).toLowerCase();
  const t = String(text).toLowerCase();
  if (p.startsWith("memory/smart-add/")) tags.push("smart-add");
  if (p.startsWith("memory/episodes/") || c === "episodic") tags.push("episodic");
  if (/session\s*checkpoint|session[_ -]?key|session[_ -]?id/.test(t) || /session[-_]?checkpoint/i.test(p)) {
    tags.push("session_checkpoint");
  }
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
  return Math.round((matched / terms.length) * 10000) / 10000;
}

function computeRecencyBoost(createdAtSec, nowSec) {
  if (!createdAtSec || !Number.isFinite(createdAtSec)) return 0;
  const ageDays = Math.max(0, (nowSec - createdAtSec) / 86400);
  // Keep recency as a tie-breaker, not the dominant ranking signal.
  const boost = 0.06 * Math.exp(-ageDays / 2.5);
  return Math.round(boost * 10000) / 10000;
}

function computeCategoryBoost(category, text = "") {
  const cat = String(category || "").toLowerCase();
  if (cat === "episodic") return 0.12;
  const raw = String(text || "").toLowerCase();
  if (raw.includes("session checkpoint") || raw.includes("session-checkpoint")) return 0.1;
  return 0;
}

export async function hybridSearch(text, { topK = 5 } = {}, runtime = {}) {
  const {
    withDb,
    calcRealtimeConf,
    syncIndexIfNeeded,
    categoryMap = null,
    getMemorySearchManager: getMemorySearchManagerRuntime = null,
  } = runtime;
  if (typeof withDb !== "function") throw new Error("hybridSearch runtime.withDb is required");
  if (typeof calcRealtimeConf !== "function") throw new Error("hybridSearch runtime.calcRealtimeConf is required");
  if (typeof syncIndexIfNeeded !== "function") throw new Error("hybridSearch runtime.syncIndexIfNeeded is required");
  const getMemorySearchManagerFn = typeof getMemorySearchManagerRuntime === "function"
    ? getMemorySearchManagerRuntime
    : (await import("openclaw/plugin-sdk/memory-core-engine-runtime")).getMemorySearchManager;

  const k = topK || 5;
  const nowSec = Math.floor(Date.now() / 1000);
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
    strict_count: 0,
    fallback_count: 0,
    post_rerank_topK: [],
  };

  try {
    debug.sync = await syncIndexIfNeeded("hybridSearch");
  } catch (e) {
    debug.sync = { synced: false, reason: "sync_error", error: e.message };
  }

  try {
    const { manager } = await getMemorySearchManagerFn({});
    if (manager) {
      const raw = await manager.search(strippedQuery, { limit: 30 });
      const candidates = raw?.entries || raw || [];
      candidateCounts.vector_raw = candidates.length;
      const scored = withDb(db => {
        const confRows = db.prepare(`SELECT chunk_id, confidence, last_confidence_update, base_tau, hit_count, is_protected, conflict_flag, category, is_archived FROM memory_confidence`).all();
        const confMap = new Map(confRows.map(r => [r.chunk_id, r]));
        const tsRows = db.prepare("SELECT id, path, updated_at FROM chunks").all();
        const tsMap = new Map(tsRows.map(r => [r.id, r.updated_at || 0]));
        const pathMap = new Map(tsRows.map(r => [r.id, r.path || ""]));
        const res = [];
        for (const c of candidates) {
          const id = c.id || c.chunkId;
          if (!id) continue;
          const meta = confMap.get(id);
          if (!meta || meta.is_archived) continue;
          const rtConf = meta.is_protected ? meta.confidence : calcRealtimeConf(meta, nowSec);
          res.push({
            id,
            text: (c.text || c.content || "").slice(0, 600),
            category: meta.category,
            similarity: Math.round((c.similarity ?? c.score ?? 0.5) * 10000) / 10000,
            confidence_realtime: Math.round(rtConf * 10000) / 10000,
            hit_count: meta.hit_count,
            created_at: tsMap.get(id) || 0,
            path: pathMap.get(id) || "",
          });
        }
        res.sort((a, b) => b.similarity - a.similarity);
        return res.slice(0, 30);
      });
      candidateCounts.vector_after_conf_filter = scored.length;
      if (scored.length > 0) channels.vector = scored;
    }
  } catch (e) {}

  let ftsIsEmpty = true;
  try {
    if (normalizedQuery) {
      const ftsSelectSql = `
        SELECT c.id, c.text,
          c.path,
          c.updated_at,
          COALESCE(mc.confidence, 0.5) as confidence,
          mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,
          COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,
          COALESCE(mc.conflict_flag, 0) as conflict_flag, COALESCE(mc.category, 'raw_log') as category
        FROM chunks_fts f
        JOIN chunks c ON c.id = f.id
        LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
        WHERE chunks_fts MATCH ?
          AND COALESCE(mc.is_archived, 0) = 0
        ORDER BY bm25(chunks_fts, 0)
        LIMIT 20
      `;
      const strictRows = withDb(db => db.prepare(ftsSelectSql).all(normalizedQuery));
      candidateCounts.fts_raw_primary = strictRows.length;
      debug.strict_count = strictRows.length;
      if (strictRows.length > 0) {
        ftsIsEmpty = false;
        candidateCounts.fts_raw_final = strictRows.length;
        debug.fts_query_final = normalizedQuery;
        channels.fts = strictRows.map(row => ({
          id: row.id,
          text: row.text.slice(0, 600),
          category: row.category,
          similarity: 0.5,
          confidence_realtime: row.is_protected ? row.confidence : Math.round(calcRealtimeConf(row, nowSec) * 10000) / 10000,
          hit_count: row.hit_count,
          created_at: row.updated_at || 0,
          path: row.path || "",
        }));
      } else if (fallbackFtsQuery && fallbackFtsQuery !== normalizedQuery) {
        const fallbackRows = withDb(db => db.prepare(ftsSelectSql).all(fallbackFtsQuery));
        debug.fallback_count = fallbackRows.length;
        candidateCounts.fts_raw_final = fallbackRows.length;
        debug.fts_query_final = fallbackFtsQuery;
        ftsIsEmpty = fallbackRows.length === 0;
        if (fallbackRows.length > 0) {
          const reranked = rankFtsFallbackCandidates(fallbackRows, {
            rawQuery: strippedQuery,
            queryTerms,
            nowSec,
            topK: 20,
          });
          debug.post_rerank_topK = reranked.post_rerank_topK;
          channels.fts = reranked.ranked.map(row => ({
            id: row.id,
            text: String(row.text || "").slice(0, 600),
            category: row.category,
            similarity: row.fallback_score,
            confidence_realtime: row.is_protected ? row.confidence : Math.round(calcRealtimeConf(row, nowSec) * 10000) / 10000,
            hit_count: row.hit_count,
            created_at: row.updated_at || 0,
            path: row.path || "",
          }));
        }
      } else {
        candidateCounts.fts_raw_final = strictRows.length;
      }
    }
  } catch (e) {}

  if (ftsIsEmpty) {
    debug.fallbacks_triggered.push("fts_empty");
    try {
      const likePatterns = buildLikeFallbackPatterns(normalizedQuery, 8);
      debug.like_patterns = likePatterns;
      if (likePatterns.length > 0) {
        const likeRows = withDb(db => {
          const where = likePatterns.map(() => "(c.path LIKE ? OR c.text LIKE ?)").join(" OR ");
          const sql = `
            SELECT c.id, c.text, c.path, c.updated_at,
              COALESCE(mc.confidence, 0.5) as confidence,
              mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,
              COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,
              COALESCE(mc.conflict_flag, 0) as conflict_flag, COALESCE(mc.category, 'raw_log') as category
            FROM chunks c
            LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
            WHERE COALESCE(mc.is_archived, 0) = 0
              AND (${where})
            ORDER BY c.updated_at DESC
            LIMIT 30
          `;
          const params = likePatterns.flatMap(pattern => [pattern, pattern]);
          return db.prepare(sql).all(...params);
        });
        candidateCounts.like_raw = likeRows.length;
        if (likeRows.length > 0) {
          debug.fallbacks_triggered.push("like_search");
          channels.like = likeRows.map(row => {
            const lexical = lexicalMatchScore(`${row.path}\n${row.text}`, queryTerms);
            return {
              id: row.id,
              text: row.text.slice(0, 600),
              category: row.category,
              similarity: Math.round((0.3 + lexical) * 10000) / 10000,
              confidence_realtime: row.is_protected ? row.confidence : Math.round(calcRealtimeConf(row, nowSec) * 10000) / 10000,
              hit_count: row.hit_count,
              created_at: row.updated_at || 0,
              path: row.path || "",
            };
          });
        }
      }
    } catch {}
  }

  try {
    const recentRows = withDb(db => db.prepare(`
      SELECT c.id, c.text, c.path, c.updated_at,
        COALESCE(mc.confidence, 0.5) as confidence,
        mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,
        COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,
        COALESCE(mc.conflict_flag, 0) as conflict_flag, COALESCE(mc.category, 'raw_log') as category
      FROM chunks c
      LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
      WHERE COALESCE(mc.is_archived, 0) = 0
        AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
      ORDER BY c.updated_at DESC
      LIMIT 120
    `).all());
    candidateCounts.recent_raw = recentRows.length;
    const scoredRecent = recentRows
      .map(row => {
        const category = row.category || inferCategoryFromChunk(row.path, row.text, categoryMap);
        const lexical = lexicalMatchScore(`${row.path}\n${row.text}`, queryTerms);
        if (lexical <= 0) return null;
        const recency = computeRecencyBoost(row.updated_at || 0, nowSec);
        return {
          id: row.id,
          text: row.text.slice(0, 600),
          category,
          similarity: Math.round((0.35 + lexical + recency) * 10000) / 10000,
          confidence_realtime: row.is_protected ? row.confidence : Math.round(calcRealtimeConf(row, nowSec) * 10000) / 10000,
          hit_count: row.hit_count,
          created_at: row.updated_at || 0,
          path: row.path || "",
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 20);
    if (scoredRecent.length > 0) channels.recent = scoredRecent;

    const episodeRows = scoredRecent
      .filter(row => row.category === "episodic" || String(row.path).startsWith("memory/episodes/"))
      .map(row => ({ ...row, similarity: Math.round((row.similarity + 0.08) * 10000) / 10000 }))
      .slice(0, 20);
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
          COALESCE(mc.confidence, 0.5) as confidence,
          mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,
          COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,
          COALESCE(mc.conflict_flag, 0) as conflict_flag, COALESCE(mc.category, 'raw_log') as category
        FROM chunks c
        LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
        WHERE COALESCE(mc.is_archived, 0) = 0
          AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
        ORDER BY c.updated_at DESC
        LIMIT 20
      `).all());
      candidateCounts.recent_fallback_raw = recentFallbackRows.length;
      if (recentFallbackRows.length > 0) {
        debug.fallbacks_triggered.push("recent_episodic");
        channels.recent_fallback = recentFallbackRows.map(row => {
          const category = row.category || inferCategoryFromChunk(row.path, row.text, categoryMap);
          const recency = computeRecencyBoost(row.updated_at || 0, nowSec);
          return {
            id: row.id,
            text: row.text.slice(0, 600),
            category,
            similarity: Math.round((0.25 + recency) * 10000) / 10000,
            confidence_realtime: row.is_protected ? row.confidence : Math.round(calcRealtimeConf(row, nowSec) * 10000) / 10000,
            hit_count: row.hit_count,
            created_at: row.updated_at || 0,
            path: row.path || "",
          };
        });
      }
    } catch {}
  }

  const names = Object.keys(channels);
  if (names.length === 0) return { pool: 0, results: [], channels: [], note: "no channels returned results" };

  const fusion = new Map();
  for (const [chName, rankedItems] of Object.entries(channels)) {
    rankedItems.forEach((item, idx) => {
      const exist = fusion.get(item.id) || {
        id: item.id,
        text: item.text,
        category: item.category,
        channels: [],
        semantic_sources: [],
        sources: [],
        rrfScore: 0,
        recencyBoost: 0,
        categoryBoost: 0,
        finalScore: 0,
        similarity: item.similarity,
        confidence_realtime: item.confidence_realtime,
        hits: item.hit_count,
        created_at: item.created_at || 0,
        path: item.path || "",
      };
      if (!exist.channels.includes(chName)) exist.channels.push(chName);
      const semanticTags = deriveCandidateSources(item);
      for (const tag of semanticTags) {
        if (!exist.semantic_sources.includes(tag)) exist.semantic_sources.push(tag);
      }
      exist.rrfScore += 1 / (60 + idx + 1);
      if (!exist.path && item.path) exist.path = item.path;
      if (!exist.category && item.category) exist.category = item.category;
      fusion.set(item.id, exist);
    });
  }

  const fused = Array.from(fusion.values()).map(item => {
    item.rrfScore = Math.round(item.rrfScore * 10000) / 10000;
    item.recencyBoost = computeRecencyBoost(item.created_at, nowSec);
    item.categoryBoost = computeCategoryBoost(item.category, item.text);
    item.finalScore = Math.round((item.rrfScore + item.recencyBoost + item.categoryBoost) * 10000) / 10000;
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
      rrf_score: item.rrfScore,
      recency_boost: item.recencyBoost,
      category_boost: item.categoryBoost,
      category: item.category,
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
    channel_sizes: Object.fromEntries(Object.entries(channels).map(([name, items]) => [name, items.length])),
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
    rrf_score: item.rrfScore,
    recency_boost: item.recencyBoost,
    category_boost: item.categoryBoost,
    final_score: item.finalScore,
    sources: item.sources,
    similarity: item.similarity,
    confidence: item.confidence_realtime,
    hits: item.hits,
    created_at: item.created_at || 0,
  }));

  return {
    pool: fusedSorted.length,
    channels: names,
    channel_sizes: Object.fromEntries(Object.entries(channels).map(([name, items]) => [name, items.length])),
    debug: debugInfo,
    results,
  };
}
