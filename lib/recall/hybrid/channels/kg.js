import { buildLikeFallbackPatterns } from "../../../../query-utils.js";
import { selectIsolatedKgRows } from "./kg-query.js";
import { evaluateKgFailClosedShadow } from "../kg-fail-closed-shadow.js";

function uniqueById(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!item || !item.id) continue;
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return Array.from(map.values());
}

function selectLegacyKgRows(withDb, likePatterns, ftsTopK) {
  return withDb(db => {
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
}

export async function collectKgCandidates(ctx) {
  const {
    withDb,
    withCoreDb,
    withEngineDb,
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
    kgAccessMode = "legacy",
    kgIsolationRequested = false,
    kgIsolationFallbackReason = null,
    kgFailClosedDecision = null,
  } = ctx;

  try {
    const canaryActive = kgFailClosedDecision?.mode === "fail_closed_canary"
      && kgFailClosedDecision?.enabled === true
      && kgFailClosedDecision?.in_scope === true;
    if (canaryActive) {
      debug.kg_runtime_mode = "fail_closed_canary";
      debug.kg_fail_closed_applied = false;
      debug.kg_fail_closed_would_have_used_fallback = false;
      debug.kg_fail_closed_fallback_suppressed = false;
      debug.kg_fail_closed_empty_candidate = false;
      debug.kg_fail_closed_candidate_loss_ratio = null;
    }
    if (queryTerms.length > 0 || exactFragments.length > 0) {
      const likePatterns = buildLikeFallbackPatterns(normalizedQuery || strippedQuery, Math.max(4, likePatternTopN));
      if (likePatterns.length > 0) {
        let kgRows;
        let isolatedRowsForShadow = null;
        let shadowRequested = false;
        let fallbackRequired = false;
        let fallbackReason = kgIsolationFallbackReason || "text_id_invariant_failed";
        if (kgIsolationRequested && kgAccessMode !== "isolated") {
          fallbackRequired = true;
        }

        if (kgAccessMode === "isolated") {
          const isolatedRows = selectIsolatedKgRows({ withEngineDb, withCoreDb }, likePatterns, ftsTopK);
          isolatedRowsForShadow = isolatedRows;
          if (!isolatedRows.safe) {
            fallbackRequired = true;
            fallbackReason = isolatedRows.fallback_reason;
            if (kgIsolationRequested) {
              shadowRequested = true;
            }
          } else {
            if (kgIsolationRequested) debug.kg_access_mode = "isolated";
            kgRows = isolatedRows.rows;
          }
        } else {
          fallbackRequired = true;
        }

        if (fallbackRequired) {
          debug.kg_access_mode = "legacy_fallback";
          debug.kg_isolated_fallback_reason = fallbackReason;
          if (canaryActive && kgIsolationRequested) {
            kgRows = [];
            shadowRequested = false;
            debug.kg_access_mode = "isolated_blocked";
            debug.kg_fail_closed_applied = true;
            debug.kg_fail_closed_would_have_used_fallback = true;
            debug.kg_fail_closed_fallback_suppressed = true;
            debug.kg_fail_closed_empty_candidate = true;
          } else {
            kgRows = selectLegacyKgRows(withDb, likePatterns, ftsTopK);
          }
        }

        if (shadowRequested) {
          const shadow = evaluateKgFailClosedShadow({
            isolatedResult: isolatedRowsForShadow?.rows || [],
            fallbackResult: kgRows,
            context: { reason: debug.kg_isolated_fallback_reason },
          });
          debug.kg_shadow_mode = shadow.decision.mode;
          debug.kg_shadow_would_fail_closed = shadow.risk.would_change_result;
          debug.kg_shadow_dropped_candidate_count = shadow.evidence.dropped_candidate_count;
          debug.kg_shadow_candidate_loss_ratio = shadow.risk.candidate_loss_ratio;
          debug.kg_shadow_overlap_count = shadow.evidence.overlap_count;
        }

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
