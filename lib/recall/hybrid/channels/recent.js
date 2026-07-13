import { buildLikeFallbackPatterns } from "../../../../query-utils.js";
import {
  guardRecentMetadataRows,
  loadArchivedIds,
  mergeRecentMetadataRows,
  selectIsolatedRecentDomainRows,
  selectIsolatedRecentLikeRows,
  selectRecentMetadataRows,
} from "../recent-access.js";

function uniqueById(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!item || !item.id) continue;
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return Array.from(map.values());
}

function pushTriggered(debug, name) {
  debug.fallbacks_triggered.push(name);
}

function setRecentIsolatedDebug(ctx, fields = {}) {
  if (ctx.recentIsolationRequested !== true) return;
  ctx.debug.recent_isolated_requested = true;
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) delete ctx.debug[key];
    else ctx.debug[key] = value;
  }
}

function isTextIdRows(rows = []) {
  return rows.every(row => typeof row?.id === "string");
}

function normalizeLikeRows(rows, ctx) {
  const { queryTerms, rankingConfig, normalizeCandidate, filterForRerank, lexicalMatchScore, toFiniteNumber } = ctx;
  return uniqueById(
    rows
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

function buildScoredRecent(rows, ctx) {
  const {
    queryTerms,
    rankingConfig,
    normalizeCandidate,
    filterForRerank,
    inferCategoryFromChunk,
    categoryMap,
    lexicalMatchScore,
    computeRecencyBoost,
    normalizeUnixSeconds,
    toFiniteNumber,
    nowSec,
    recentRerankTopK,
  } = ctx;

  return uniqueById(
    rows
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
}

function buildEpisodeRows(scoredRecent, ctx) {
  const { normalizeCandidate, rankingConfig, toFiniteNumber, recentRerankTopK } = ctx;
  return scoredRecent
    .filter(row => row.category === "episodic" || String(row.path).startsWith("memory/episodes/"))
    .map(row => normalizeCandidate({
      ...row,
      similarity: row.semantic_score + (toFiniteNumber(rankingConfig?.fallbackBaseScore?.episodeBonus) ?? 0.08),
    }))
    .filter(Boolean)
    .slice(0, recentRerankTopK);
}

function buildRecentFallbackRows(rows, ctx) {
  const {
    inferCategoryFromChunk,
    categoryMap,
    computeRecencyBoost,
    normalizeUnixSeconds,
    rankingConfig,
    normalizeCandidate,
    filterForRerank,
    toFiniteNumber,
    nowSec,
  } = ctx;

  return uniqueById(
    rows
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

function selectLegacyLikeRows(ctx, likePatterns) {
  const { withDb, likeTopK } = ctx;
  return withDb(db => {
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
        AND c.path NOT LIKE 'memory/generated-smart-add/%'
        AND (${where})
      ORDER BY c.updated_at DESC, c.id ASC
      LIMIT ?
    `;
    const params = [...likePatterns.flatMap(pattern => [pattern, pattern]), likeTopK];
    return db.prepare(sql).all(...params);
  });
}

function selectLegacyScoredRecentRows(ctx) {
  const { withDb } = ctx;
  return withDb(db => db.prepare(`
    SELECT c.id, c.text, c.path, c.updated_at,
      mc.confidence as confidence,
      mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,
      COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,
      COALESCE(mc.conflict_flag, 0) as conflict_flag, mc.category as category,
      COALESCE(mc.is_archived, 0) as is_archived
    FROM chunks c
    LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
    WHERE COALESCE(mc.is_archived, 0) = 0
      AND c.path NOT LIKE 'memory/generated-smart-add/%'
      AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
    ORDER BY c.updated_at DESC, c.id ASC
    LIMIT ?
  `).all(ctx.recentTopK));
}

function selectLegacyRecentFallbackRows(ctx) {
  const { withDb } = ctx;
  return withDb(db => db.prepare(`
    SELECT c.id, c.text, c.path, c.updated_at,
      mc.confidence as confidence,
      mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,
      COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,
      COALESCE(mc.conflict_flag, 0) as conflict_flag, mc.category as category,
      COALESCE(mc.is_archived, 0) as is_archived
    FROM chunks c
    LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
    WHERE COALESCE(mc.is_archived, 0) = 0
      AND c.path NOT LIKE 'memory/generated-smart-add/%'
      AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
    ORDER BY c.updated_at DESC, c.id ASC
    LIMIT ?
  `).all(ctx.recentFallbackTopK));
}

async function collectLegacyRecentCandidates(ctx) {
  const {
    channels,
    debug,
    candidateCounts,
    ftsIsEmpty,
    normalizedQuery,
    likePatternTopN,
    warnHybridSearchOnce,
    uniqueVectorChannels,
  } = ctx;

  if (ftsIsEmpty) {
    pushTriggered(debug, "fts_empty");
    try {
      const likePatterns = buildLikeFallbackPatterns(normalizedQuery, likePatternTopN);
      debug.like_patterns = likePatterns;
      if (likePatterns.length > 0) {
        const likeRows = selectLegacyLikeRows(ctx, likePatterns);
        candidateCounts.like_raw = likeRows.length;
        if (likeRows.length > 0) {
          pushTriggered(debug, "like_search");
          channels.like = normalizeLikeRows(likeRows, ctx);
        }
      }
    } catch (e) {
      debug.like_error = ctx.toDebugErrorMessage(e);
      warnHybridSearchOnce("like_search_error", e);
    }
  }

  try {
    const recentRows = selectLegacyScoredRecentRows(ctx);
    candidateCounts.recent_raw = recentRows.length;
    const scoredRecent = buildScoredRecent(recentRows, ctx);
    if (scoredRecent.length > 0) channels.recent = scoredRecent;

    const episodeRows = buildEpisodeRows(scoredRecent, ctx);
    candidateCounts.episode_raw = episodeRows.length;
    if (episodeRows.length > 0) channels.episode = episodeRows;
  } catch (e) {
    debug.recent_error = ctx.toDebugErrorMessage(e);
    warnHybridSearchOnce("recent_search_error", e);
  }

  if (ftsIsEmpty) {
    if (candidateCounts.like_raw === 0 && uniqueVectorChannels()) pushTriggered(debug, "vector_only");
    try {
      const recentFallbackRows = selectLegacyRecentFallbackRows(ctx);
      candidateCounts.recent_fallback_raw = recentFallbackRows.length;
      if (recentFallbackRows.length > 0) {
        pushTriggered(debug, "recent_episodic");
        channels.recent_fallback = buildRecentFallbackRows(recentFallbackRows, ctx);
      }
    } catch (e) {
      debug.recent_fallback_error = ctx.toDebugErrorMessage(e);
      warnHybridSearchOnce("recent_fallback_search_error", e);
    }
  }
}

function assignIsolatedResult(ctx, result) {
  ctx.candidateCounts.like_raw = result.counts.like_raw;
  ctx.candidateCounts.recent_raw = result.counts.recent_raw;
  ctx.candidateCounts.episode_raw = result.counts.episode_raw;
  ctx.candidateCounts.recent_fallback_raw = result.counts.recent_fallback_raw;

  if (Array.isArray(result.channels.like) && result.channels.like.length > 0) ctx.channels.like = result.channels.like;
  if (Array.isArray(result.channels.recent) && result.channels.recent.length > 0) ctx.channels.recent = result.channels.recent;
  if (Array.isArray(result.channels.episode) && result.channels.episode.length > 0) ctx.channels.episode = result.channels.episode;
  if (Array.isArray(result.channels.recent_fallback) && result.channels.recent_fallback.length > 0) ctx.channels.recent_fallback = result.channels.recent_fallback;
}

function branchArray(ftsIsEmpty) {
  const branches = ["recent_scored"];
  if (ftsIsEmpty) {
    branches.unshift("like_fallback");
    branches.push("recent_fallback");
  }
  return branches;
}

async function collectIsolatedRecentCandidates(ctx) {
  const {
    debug,
    normalizedQuery,
    likePatternTopN,
    uniqueVectorChannels,
    withCoreDb,
    withEngineDb,
    recentTopK,
    recentFallbackTopK,
    warnHybridSearchOnce,
    candidateCounts,
    channels,
    ftsIsEmpty,
  } = ctx;

  setRecentIsolatedDebug(ctx, {
    recent_access_mode: "isolated",
    recent_isolated_engine_query_count: 0,
    recent_isolated_core_query_count: 0,
    recent_isolated_metadata_query_count: 0,
    recent_isolated_branches: branchArray(ftsIsEmpty),
  });

  const result = {
    counts: {
      like_raw: 0,
      recent_raw: 0,
      episode_raw: 0,
      recent_fallback_raw: 0,
    },
    channels: {},
  };

  try {
    if (ftsIsEmpty) pushTriggered(debug, "fts_empty");

    debug.like_patterns = ftsIsEmpty
      ? buildLikeFallbackPatterns(normalizedQuery, likePatternTopN)
      : [];

    const archived = loadArchivedIds(withEngineDb);
    debug.recent_isolated_engine_query_count += 1;

    if (!archived.ok) {
      setRecentIsolatedDebug(ctx, {
        recent_access_mode: "guarded_fallback",
        recent_isolated_fallback_reason: archived.fallback_reason,
      });
      return collectLegacyRecentCandidates(ctx);
    }

    setRecentIsolatedDebug(ctx, {
      recent_archived_row_count: archived.row_count,
      recent_archived_unique_id_count: archived.unique_id_count,
      recent_archived_duplicate_id_count: archived.duplicate_id_count,
      recent_archived_json_bytes: archived.json_utf8_bytes,
      recent_archived_max_id_bytes: archived.max_id_utf8_bytes,
      recent_archived_payload_large: archived.payload_large,
    });

    const branchRows = {};

    if (ftsIsEmpty && debug.like_patterns.length > 0) {
      const likeSelected = selectIsolatedRecentLikeRows(ctx, archived.archived_json, debug.like_patterns, ctx.likeTopK);
      debug.recent_isolated_core_query_count += 1;
      if (!isTextIdRows(likeSelected.rows)) {
        setRecentIsolatedDebug(ctx, {
          recent_access_mode: "guarded_fallback",
          recent_isolated_fallback_reason: "isolated_recent_core_candidate_id_invariant_failed",
        });
        return collectLegacyRecentCandidates(ctx);
      }
      branchRows.like = likeSelected.rows;
      result.counts.like_raw = likeSelected.rows.length;
    }

    const recentSelected = selectIsolatedRecentDomainRows(ctx, archived.archived_json, recentTopK);
    debug.recent_isolated_core_query_count += 1;
    if (!isTextIdRows(recentSelected.rows)) {
      setRecentIsolatedDebug(ctx, {
        recent_access_mode: "guarded_fallback",
        recent_isolated_fallback_reason: "isolated_recent_core_candidate_id_invariant_failed",
      });
      return collectLegacyRecentCandidates(ctx);
    }
    branchRows.recent = recentSelected.rows;
    result.counts.recent_raw = recentSelected.rows.length;

    if (ftsIsEmpty) {
      const recentFallbackSelected = selectIsolatedRecentDomainRows(ctx, archived.archived_json, recentFallbackTopK);
      debug.recent_isolated_core_query_count += 1;
      if (!isTextIdRows(recentFallbackSelected.rows)) {
        setRecentIsolatedDebug(ctx, {
          recent_access_mode: "guarded_fallback",
          recent_isolated_fallback_reason: "isolated_recent_core_candidate_id_invariant_failed",
        });
        return collectLegacyRecentCandidates(ctx);
      }
      branchRows.recent_fallback = recentFallbackSelected.rows;
      result.counts.recent_fallback_raw = recentFallbackSelected.rows.length;
    }

    const selectedIds = [...new Set(Object.values(branchRows).flatMap(rows => rows.map(row => row.id)))];
    const metadataRows = selectRecentMetadataRows({ withEngineDb }, selectedIds);
    debug.recent_isolated_metadata_query_count += selectedIds.length > 0 ? 1 : 0;
    const metadataGuard = guardRecentMetadataRows(metadataRows);
    if (!metadataGuard.ok) {
      setRecentIsolatedDebug(ctx, {
        recent_access_mode: "guarded_fallback",
        recent_isolated_fallback_reason: metadataGuard.fallback_reason,
      });
      return collectLegacyRecentCandidates(ctx);
    }

    const mergedLikeRows = Array.isArray(branchRows.like)
      ? mergeRecentMetadataRows(branchRows.like, metadataRows)
      : [];
    const mergedRecentRows = mergeRecentMetadataRows(branchRows.recent || [], metadataRows);
    const mergedRecentFallbackRows = Array.isArray(branchRows.recent_fallback)
      ? mergeRecentMetadataRows(branchRows.recent_fallback, metadataRows)
      : [];

    if (mergedLikeRows.length > 0) {
      pushTriggered(debug, "like_search");
      result.channels.like = normalizeLikeRows(mergedLikeRows, ctx);
    }

    const scoredRecent = buildScoredRecent(mergedRecentRows, ctx);
    if (scoredRecent.length > 0) result.channels.recent = scoredRecent;
    const episodeRows = buildEpisodeRows(scoredRecent, ctx);
    result.counts.episode_raw = episodeRows.length;
    if (episodeRows.length > 0) result.channels.episode = episodeRows;

    if (ftsIsEmpty && result.counts.like_raw === 0 && uniqueVectorChannels()) pushTriggered(debug, "vector_only");

    if (mergedRecentFallbackRows.length > 0) {
      pushTriggered(debug, "recent_episodic");
      result.channels.recent_fallback = buildRecentFallbackRows(mergedRecentFallbackRows, ctx);
    }

    assignIsolatedResult(ctx, result);
  } catch (e) {
    debug.recent_error = ctx.toDebugErrorMessage(e);
    warnHybridSearchOnce("recent_search_error", e);
    candidateCounts.like_raw = 0;
    candidateCounts.recent_raw = 0;
    candidateCounts.episode_raw = 0;
    candidateCounts.recent_fallback_raw = 0;
    delete channels.like;
    delete channels.recent;
    delete channels.episode;
    delete channels.recent_fallback;
  }
}

export async function collectRecentCandidates(ctx) {
  if (ctx.recentIsolationRequested === true) {
    setRecentIsolatedDebug(ctx, {
      recent_access_mode: ctx.recentAccessMode === "isolated" ? "isolated" : "guarded_fallback",
      recent_isolated_fallback_reason: ctx.recentAccessMode === "guarded_fallback"
        ? ctx.recentIsolationFallbackReason
        : undefined,
    });
  }

  if (ctx.recentAccessMode === "isolated") {
    return collectIsolatedRecentCandidates(ctx);
  }

  if (ctx.recentAccessMode === "guarded_fallback") {
    setRecentIsolatedDebug(ctx, {
      recent_access_mode: "guarded_fallback",
      recent_isolated_fallback_reason: ctx.recentIsolationFallbackReason,
    });
    return collectLegacyRecentCandidates(ctx);
  }

  return collectLegacyRecentCandidates(ctx);
}
