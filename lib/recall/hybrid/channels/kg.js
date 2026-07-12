import { buildLikeFallbackPatterns } from "../../../../query-utils.js";

function uniqueById(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!item || !item.id) continue;
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return Array.from(map.values());
}

export async function collectKgCandidates(ctx) {
  const {
    withDb,
    channels,
    debug,
    candidateCounts,
    normalizedQuery,
    strippedQuery,
    likePatternTopN,
    ftsTopK,
    queryTerms,
    exactFragments,
    categoryMap,
    normalizeCandidate,
    filterForRerank,
    enrichLexicalCandidate,
    inferCategoryFromChunk,
    lexicalMatchScore,
    toDebugErrorMessage,
    warnHybridSearchOnce,
  } = ctx;

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
            ORDER BY c.updated_at DESC, c.id ASC
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
}
