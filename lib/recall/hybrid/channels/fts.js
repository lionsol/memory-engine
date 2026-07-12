import { rankFtsFallbackCandidates } from "../../../../query-utils.js";
import {
  archivedIdsFromConfidenceMap,
  selectIsolatedFtsRows,
} from "./fts-query.js";

function uniqueById(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!item || !item.id) continue;
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return Array.from(map.values());
}

export async function collectFtsCandidates(ctx) {
  const {
    withDb,
    withCoreDb,
    ftsAccessMode = "legacy",
    confidenceMap = new Map(),
    channels,
    debug,
    candidateCounts,
    normalizedQuery,
    fallbackFtsQuery,
    strippedQuery,
    queryTerms,
    exactFragments,
    nowSec,
    ftsTopK,
    normalizeCandidate,
    filterForRerank,
    enrichLexicalCandidate,
    toDebugErrorMessage,
    warnHybridSearchOnce,
  } = ctx;

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
          AND c.path NOT LIKE 'memory/generated-smart-add/%'
          AND COALESCE(mc.is_archived, 0) = 0
        ORDER BY bm25(chunks_fts, 0)
        LIMIT ?
      `;
      const archivedJson = ftsAccessMode === "isolated"
        ? JSON.stringify(archivedIdsFromConfidenceMap(confidenceMap))
        : null;
      const selectRows = query => ftsAccessMode === "isolated"
        ? selectIsolatedFtsRows({ withCoreDb, confidenceMap }, query, archivedJson, ftsTopK)
        : withDb(db => db.prepare(ftsSelectSql).all(query, ftsTopK));
      const strictRows = selectRows(normalizedQuery);
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
        const fallbackRows = selectRows(fallbackFtsQuery);
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

  return { ftsIsEmpty };
}
