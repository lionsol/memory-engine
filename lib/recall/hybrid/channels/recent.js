import { buildLikeFallbackPatterns } from "../../../../query-utils.js";
import {
  guardRecentMetadataRows,
  loadArchivedIds,
  mergeRecentMetadataRows,
  selectIsolatedRecentFallbackRows,
  selectRecentMetadataRows,
  selectIsolatedRecentScoredRows,
  selectIsolatedRecentLikeRows,
} from "../recent-access.js";
import { executeRecentCanaryShadow } from "../recent-canary-shadow.js";
import { evaluateRecentFailClosedShadow } from "../recent-fail-closed-shadow.js";

function uniqueById(items = []) {
  const map = new Map();
  for (const item of items) {
    if (!item || !item.id) continue;
    if (!map.has(item.id)) map.set(item.id, item);
  }
  return Array.from(map.values());
}

function recordCanaryRows(ctx, entry) {
  if (!ctx.recentCanaryRecorder || !entry) return;
  ctx.recentCanaryRecorder.rows.push(entry);
}

function incrementCanaryQueryCount(ctx, key) {
  if (!ctx.recentCanaryRecorder?.query_counts || !key) return;
  ctx.recentCanaryRecorder.query_counts[key] = Number(ctx.recentCanaryRecorder.query_counts[key] || 0) + 1;
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
        incrementCanaryQueryCount(ctx, "legacy_core_query_count");
        incrementCanaryQueryCount(ctx, "legacy_engine_query_count");
        recordCanaryRows(ctx, { db: "legacy", branch: "like_fallback", rows: likeRows });
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
    incrementCanaryQueryCount(ctx, "legacy_core_query_count");
    incrementCanaryQueryCount(ctx, "legacy_engine_query_count");
    recordCanaryRows(ctx, { db: "legacy", branch: "recent_scored", rows: recentRows });
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
      incrementCanaryQueryCount(ctx, "legacy_core_query_count");
      incrementCanaryQueryCount(ctx, "legacy_engine_query_count");
      recordCanaryRows(ctx, { db: "legacy", branch: "recent_fallback", rows: recentFallbackRows });
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

function recentShadowCandidates(channels = {}) {
  return ["like", "recent", "episode", "recent_fallback"]
    .flatMap(name => Array.isArray(channels[name]) ? channels[name] : []);
}

function clearRecentCandidates(ctx) {
  for (const name of ["like", "recent", "episode", "recent_fallback"]) {
    delete ctx.channels[name];
  }
  ctx.candidateCounts.like_raw = 0;
  ctx.candidateCounts.recent_raw = 0;
  ctx.candidateCounts.episode_raw = 0;
  ctx.candidateCounts.recent_fallback_raw = 0;
}

function initializeRecentFailClosedDebug(ctx) {
  const decision = ctx.recentFailClosedDecision || {};
  const requestedCanary = decision.requested_mode === "fail_closed_canary";
  ctx.debug.recent_runtime_mode = decision.mode || "legacy_fallback";
  ctx.debug.recent_rollout_scope = decision.rollout_scope || "none";
  ctx.debug.recent_scope_required = decision.scope_required === true;
  ctx.debug.recent_fail_closed_applied = null;
  ctx.debug.recent_fail_closed_fallback_suppressed = null;
  ctx.debug.recent_fail_closed_scope_match = requestedCanary
    ? decision.in_scope === true
    : null;
  ctx.debug.recent_fail_closed_empty_candidate = null;
}

function applyRecentFailClosed(ctx) {
  const decision = ctx.recentFailClosedDecision || {};
  const fullFailClosed = decision.mode === "full_fail_closed";
  clearRecentCandidates(ctx);
  ctx.debug.recent_access_mode = "isolated_blocked";
  ctx.debug.recent_isolated_fallback_reason = ctx.recentIsolationFallbackReason || null;
  ctx.debug.recent_runtime_mode = fullFailClosed ? "full_fail_closed" : "fail_closed_canary";
  ctx.debug.recent_rollout_scope = fullFailClosed ? "full" : "scoped_canary";
  ctx.debug.recent_scope_required = fullFailClosed ? false : true;
  ctx.debug.recent_fail_closed_applied = true;
  ctx.debug.recent_fail_closed_fallback_suppressed = true;
  ctx.debug.recent_fail_closed_scope_match = fullFailClosed ? null : true;
  ctx.debug.recent_fail_closed_empty_candidate = true;
  return undefined;
}

async function collectLegacyRecentCandidatesWithShadow(ctx, isolatedRows = [], context = {}) {
  await collectLegacyRecentCandidates(ctx);
  const shadow = evaluateRecentFailClosedShadow({
    isolatedResult: isolatedRows,
    fallbackResult: recentShadowCandidates(ctx.channels),
    context,
  });
  ctx.debug.recent_shadow_mode = shadow.decision.mode;
  ctx.debug.recent_shadow_would_fail_closed = shadow.risk.would_change_result;
  ctx.debug.recent_shadow_dropped_candidate_count = shadow.evidence.dropped_candidate_count;
  ctx.debug.recent_shadow_candidate_loss_ratio = shadow.risk.candidate_loss_ratio;
  ctx.debug.recent_shadow_overlap_count = shadow.evidence.overlap_count;
  ctx.debug.recent_shadow_risk_level = shadow.risk.recent_specific_risk;
}

async function collectLegacyRecentCandidatesWithPolicy(ctx, isolatedRows = [], context = {}) {
  if (ctx.recentFailClosedDecision?.eligible === true) {
    return applyRecentFailClosed(ctx);
  }
  return collectLegacyRecentCandidatesWithShadow(ctx, isolatedRows, context);
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
    incrementCanaryQueryCount(ctx, "isolated_archived_engine_query_count");
    recordCanaryRows(ctx, { db: "engine", branch: "archived_engine", rows: archived.rows });
    debug.recent_isolated_engine_query_count += 1;

    if (!archived.ok) {
      setRecentIsolatedDebug(ctx, {
        recent_access_mode: "guarded_fallback",
        recent_isolated_fallback_reason: archived.fallback_reason,
      });
      return collectLegacyRecentCandidatesWithPolicy(ctx, []);
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
      incrementCanaryQueryCount(ctx, "isolated_core_query_count");
      recordCanaryRows(ctx, { db: "core", branch: "like_fallback", rows: likeSelected.rows });
      debug.recent_isolated_core_query_count += 1;
      if (!isTextIdRows(likeSelected.rows)) {
        setRecentIsolatedDebug(ctx, {
          recent_access_mode: "guarded_fallback",
          recent_isolated_fallback_reason: "isolated_recent_core_candidate_id_invariant_failed",
        });
        return collectLegacyRecentCandidatesWithPolicy(ctx, Object.values(branchRows).flat(), {});
      }
      branchRows.like = likeSelected.rows;
      result.counts.like_raw = likeSelected.rows.length;
    }

    const recentSelected = selectIsolatedRecentScoredRows(ctx, archived.archived_json, recentTopK);
    incrementCanaryQueryCount(ctx, "isolated_core_query_count");
    recordCanaryRows(ctx, { db: "core", branch: "recent_scored", rows: recentSelected.rows });
    debug.recent_isolated_core_query_count += 1;
    if (!isTextIdRows(recentSelected.rows)) {
      setRecentIsolatedDebug(ctx, {
        recent_access_mode: "guarded_fallback",
        recent_isolated_fallback_reason: "isolated_recent_core_candidate_id_invariant_failed",
      });
      return collectLegacyRecentCandidatesWithPolicy(ctx, Object.values(branchRows).flat(), {});
    }
    branchRows.recent = recentSelected.rows;
    result.counts.recent_raw = recentSelected.rows.length;

    if (ftsIsEmpty) {
      const recentFallbackSelected = selectIsolatedRecentFallbackRows(ctx, archived.archived_json, recentFallbackTopK);
      incrementCanaryQueryCount(ctx, "isolated_core_query_count");
      recordCanaryRows(ctx, { db: "core", branch: "recent_fallback", rows: recentFallbackSelected.rows });
      debug.recent_isolated_core_query_count += 1;
      if (!isTextIdRows(recentFallbackSelected.rows)) {
        setRecentIsolatedDebug(ctx, {
          recent_access_mode: "guarded_fallback",
          recent_isolated_fallback_reason: "isolated_recent_core_candidate_id_invariant_failed",
        });
        return collectLegacyRecentCandidatesWithPolicy(ctx, Object.values(branchRows).flat(), {});
      }
      branchRows.recent_fallback = recentFallbackSelected.rows;
      result.counts.recent_fallback_raw = recentFallbackSelected.rows.length;
    }

    const selectedIds = [...new Set(Object.values(branchRows).flatMap(rows => rows.map(row => row.id)))];
    const metadataRows = selectRecentMetadataRows({ withEngineDb }, selectedIds);
    if (selectedIds.length > 0) {
      incrementCanaryQueryCount(ctx, "isolated_metadata_engine_query_count");
      recordCanaryRows(ctx, { db: "engine", branch: "metadata_engine", rows: metadataRows });
    }
    debug.recent_isolated_metadata_query_count += selectedIds.length > 0 ? 1 : 0;
    const metadataGuard = guardRecentMetadataRows(metadataRows);
    if (!metadataGuard.ok) {
      setRecentIsolatedDebug(ctx, {
        recent_access_mode: "guarded_fallback",
        recent_isolated_fallback_reason: metadataGuard.fallback_reason,
      });
      return collectLegacyRecentCandidatesWithPolicy(ctx, Object.values(branchRows).flat(), {
        metadata_merge_mismatch: true,
      });
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
  initializeRecentFailClosedDebug(ctx);
  const fullFailClosedActive = ctx.recentFailClosedDecision?.mode === "full_fail_closed"
    && ctx.recentFailClosedDecision?.eligible === true;

  if (ctx.recentCanaryDecision?.mode === "shadow") {
    return executeRecentCanaryShadow(ctx, {
      collectRecentCandidates: innerCtx => collectRecentCandidates({
        ...innerCtx,
        recentCanaryDecision: null,
      }),
    });
  }

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
    return collectLegacyRecentCandidatesWithPolicy(ctx, [], {
      metadata_merge_mismatch: String(ctx.recentIsolationFallbackReason || "").includes("metadata"),
    });
  }

  if (fullFailClosedActive) {
    return collectLegacyRecentCandidatesWithPolicy(ctx, [], {
      metadata_merge_mismatch: false,
    });
  }

  return collectLegacyRecentCandidates(ctx);
}
