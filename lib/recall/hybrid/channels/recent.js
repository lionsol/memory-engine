import { buildLikeFallbackPatterns } from "../../../../query-utils.js";

function uniqueById(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!item || !item.id) continue;
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return Array.from(map.values());
}

export async function collectRecentCandidates(ctx) {
  const {
    withDb,
    channels,
    debug,
    candidateCounts,
    ftsIsEmpty,
    normalizedQuery,
    likePatternTopN,
    likeTopK,
    queryTerms,
    rankingConfig,
    normalizeCandidate,
    filterForRerank,
    recentTopK,
    recentRerankTopK,
    recentFallbackTopK,
    inferCategoryFromChunk,
    categoryMap,
    lexicalMatchScore,
    computeRecencyBoost,
    normalizeUnixSeconds,
    toFiniteNumber,
    toDebugErrorMessage,
    warnHybridSearchOnce,
    uniqueVectorChannels,
  } = ctx;

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
          const recency = computeRecencyBoost(normalizeUnixSeconds(row.updated_at), ctx.nowSec, rankingConfig);
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
    if (candidateCounts.like_raw === 0 && uniqueVectorChannels()) {
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
              const recency = computeRecencyBoost(normalizeUnixSeconds(row.updated_at), ctx.nowSec, rankingConfig);
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
}
