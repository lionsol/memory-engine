import { createCandidateCounts } from "./debug.js";
import {
  canonicalizeRecentShadowCandidate,
  canonicalizeRecentShadowRawRow,
  fingerprintRecentShadowValue,
} from "./recent-shadow-audit.js";
import { mergeRecentMetadataRows } from "./recent-access.js";

function nowNs() {
  return process.hrtime.bigint();
}

function durationMs(startNs, endNs = nowNs()) {
  return Number(endNs - startNs) / 1e6;
}

function round4(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 10000) / 10000;
}

function compareLists(left = [], right = []) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function copyRows(rows = []) {
  return Array.isArray(rows) ? rows.map(row => ({ ...row })) : [];
}

function createShadowRecorder() {
  return {
    rows: [],
    warning_classes: [],
    query_counts: {
      legacy_core_query_count: 0,
      legacy_engine_query_count: 0,
      isolated_archived_engine_query_count: 0,
      isolated_core_query_count: 0,
      isolated_metadata_engine_query_count: 0,
    },
  };
}

function cloneDebug(debug = {}) {
  const cloned = {
    ...debug,
    fallbacks_triggered: Array.isArray(debug.fallbacks_triggered)
      ? [...debug.fallbacks_triggered]
      : [],
  };
  for (const key of Object.keys(cloned)) {
    if (key.startsWith("recent_")) delete cloned[key];
  }
  return cloned;
}

function createWarningRecorder(baseWarn, recorder, delegate = false) {
  return (message, error = null) => {
    recorder.warning_classes.push(String(message || "unknown_warning"));
    if (delegate && typeof baseWarn === "function") {
      baseWarn(message, error);
    }
  };
}

function cloneRecentContext(ctx, overrides = {}) {
  const recorder = createShadowRecorder();
  const channels = {};
  if (Array.isArray(ctx.channels?.vector)) channels.vector = [...ctx.channels.vector];
  return {
    ctx: {
      ...ctx,
      channels,
      debug: cloneDebug(ctx.debug),
      candidateCounts: createCandidateCounts(),
      recentCanaryRecorder: recorder,
      recentCanaryDecision: null,
      warnHybridSearchOnce: createWarningRecorder(ctx.warnHybridSearchOnce, recorder, overrides.delegateWarnings === true),
      ...overrides,
    },
    recorder,
  };
}

function branchRawRows(trace, branch) {
  return trace
    .filter(entry => entry.branch === branch && Array.isArray(entry.rows))
    .flatMap(entry => entry.rows);
}

function mergedIsolatedBranchRows(trace, branch) {
  const coreRows = trace
    .filter(entry => entry.db === "core" && entry.branch === branch && Array.isArray(entry.rows))
    .flatMap(entry => entry.rows);
  const metadataRows = trace
    .filter(entry => entry.db === "engine" && entry.branch === "metadata_engine" && Array.isArray(entry.rows))
    .flatMap(entry => entry.rows);
  return mergeRecentMetadataRows(coreRows, metadataRows);
}

function rawRowsForBranch(trace, branch, accessMode) {
  return accessMode === "isolated"
    ? mergedIsolatedBranchRows(trace, branch)
    : branchRawRows(trace, branch);
}

function candidateRowsForBranch(channels, branch) {
  const key = branch === "like_fallback" ? "like" : branch;
  return Array.isArray(channels?.[key]) ? channels[key] : [];
}

function fingerprintRawRows(rows = []) {
  return rows.map(row => fingerprintRecentShadowValue(canonicalizeRecentShadowRawRow(row)));
}

function fingerprintCandidates(rows = []) {
  return rows.map(row => fingerprintRecentShadowValue(canonicalizeRecentShadowCandidate(row)));
}

function ids(rows = []) {
  return rows.map(row => String(row?.id || ""));
}

function summarizeRun(localCtx, recorder) {
  const accessMode = String(localCtx.debug?.recent_access_mode || localCtx.recentAccessMode || "legacy");
  const rawRows = {
    like_fallback: rawRowsForBranch(recorder.rows, "like_fallback", accessMode),
    recent: rawRowsForBranch(recorder.rows, "recent_scored", accessMode),
    episode: candidateRowsForBranch(localCtx.channels, "episode"),
    recent_fallback: rawRowsForBranch(recorder.rows, "recent_fallback", accessMode),
  };
  const channelMembership = ["like", "recent", "episode", "recent_fallback"]
    .filter(name => candidateRowsForBranch(localCtx.channels, name).length > 0);
  const finalOrderIds = ["like", "recent", "episode", "recent_fallback"]
    .flatMap(name => ids(candidateRowsForBranch(localCtx.channels, name)));

  return {
    access_mode: accessMode,
    fallback_reason: localCtx.debug?.recent_isolated_fallback_reason ?? null,
    warning_classes: [...recorder.warning_classes],
    error_classification: localCtx.debug?.recent_error ? "recent_error" : null,
    candidate_counts: {
      like_raw: Number(localCtx.candidateCounts.like_raw || 0),
      recent_raw: Number(localCtx.candidateCounts.recent_raw || 0),
      episode_raw: Number(localCtx.candidateCounts.episode_raw || 0),
      recent_fallback_raw: Number(localCtx.candidateCounts.recent_fallback_raw || 0),
    },
    raw_counts: {
      like_fallback: rawRows.like_fallback.length,
      recent: rawRows.recent.length,
      episode: rawRows.episode.length,
      recent_fallback: rawRows.recent_fallback.length,
    },
    ordered_ids: {
      like_fallback: ids(candidateRowsForBranch(localCtx.channels, "like")),
      recent: ids(candidateRowsForBranch(localCtx.channels, "recent")),
      episode: ids(candidateRowsForBranch(localCtx.channels, "episode")),
      recent_fallback: ids(candidateRowsForBranch(localCtx.channels, "recent_fallback")),
    },
    raw_fingerprints: {
      like_fallback: fingerprintRawRows(rawRows.like_fallback),
      recent: fingerprintRawRows(rawRows.recent),
      episode: fingerprintCandidates(rawRows.episode),
      recent_fallback: fingerprintRawRows(rawRows.recent_fallback),
    },
    normalized_fingerprints: {
      like_fallback: fingerprintCandidates(candidateRowsForBranch(localCtx.channels, "like")),
      recent: fingerprintCandidates(candidateRowsForBranch(localCtx.channels, "recent")),
      episode: fingerprintCandidates(candidateRowsForBranch(localCtx.channels, "episode")),
      recent_fallback: fingerprintCandidates(candidateRowsForBranch(localCtx.channels, "recent_fallback")),
    },
    channel_membership: channelMembership,
    final_order_ids: finalOrderIds,
    query_counts: {
      legacy_core_query_count: Number(recorder.query_counts.legacy_core_query_count || 0),
      legacy_engine_query_count: Number(recorder.query_counts.legacy_engine_query_count || 0),
      isolated_archived_engine_query_count: Number(recorder.query_counts.isolated_archived_engine_query_count || 0),
      isolated_core_query_count: Number(recorder.query_counts.isolated_core_query_count || 0),
      isolated_metadata_engine_query_count: Number(recorder.query_counts.isolated_metadata_engine_query_count || 0),
      isolated_engine_query_count_total:
        Number(recorder.query_counts.isolated_archived_engine_query_count || 0)
        + Number(recorder.query_counts.isolated_metadata_engine_query_count || 0),
    },
  };
}

function hasPositiveCandidateEvidence(run) {
  return Object.values(run.ordered_ids).some(value => Array.isArray(value) && value.length > 0);
}

export function compareRecentCanaryRuns({
  legacy,
  isolated,
} = {}) {
  const result = {
    ordered_ids_equal: compareLists(legacy?.ordered_ids, isolated?.ordered_ids),
    raw_fingerprints_equal: compareLists(legacy?.raw_fingerprints, isolated?.raw_fingerprints),
    normalized_fingerprints_equal: compareLists(legacy?.normalized_fingerprints, isolated?.normalized_fingerprints),
    candidate_counts_equal: compareLists(legacy?.candidate_counts, isolated?.candidate_counts),
    raw_counts_equal: compareLists(legacy?.raw_counts, isolated?.raw_counts),
    channel_membership_equal: compareLists(legacy?.channel_membership, isolated?.channel_membership),
    final_order_equal: compareLists(legacy?.final_order_ids, isolated?.final_order_ids),
    warning_classification_equal: compareLists(legacy?.warning_classes, isolated?.warning_classes),
    error_classification_equal: compareLists(legacy?.error_classification, isolated?.error_classification),
  };

  if (legacy?.error_classification) {
    return { ...result, classification: "legacy_error", equivalent: false };
  }
  if (isolated?.error_classification) {
    return { ...result, classification: "isolated_error", equivalent: false };
  }
  if (isolated?.access_mode === "guarded_fallback") {
    return { ...result, classification: "guarded_fallback", equivalent: false };
  }
  if (!hasPositiveCandidateEvidence(legacy) && !hasPositiveCandidateEvidence(isolated)) {
    return { ...result, classification: "no_positive_candidate_evidence", equivalent: false };
  }
  if (!result.raw_counts_equal || !result.candidate_counts_equal) {
    return { ...result, classification: "mismatch_counts", equivalent: false };
  }
  if (!result.channel_membership_equal) {
    return { ...result, classification: "mismatch_channels", equivalent: false };
  }
  if (!result.raw_fingerprints_equal) {
    return { ...result, classification: "mismatch_raw", equivalent: false };
  }
  if (!result.ordered_ids_equal || !result.final_order_equal) {
    return { ...result, classification: "mismatch_order", equivalent: false };
  }
  if (!result.normalized_fingerprints_equal) {
    return { ...result, classification: "mismatch_normalized", equivalent: false };
  }
  return { ...result, classification: "equivalent", equivalent: true };
}

function clearServedRecentState(ctx) {
  ctx.candidateCounts.like_raw = 0;
  ctx.candidateCounts.recent_raw = 0;
  ctx.candidateCounts.episode_raw = 0;
  ctx.candidateCounts.recent_fallback_raw = 0;
  delete ctx.channels.like;
  delete ctx.channels.recent;
  delete ctx.channels.episode;
  delete ctx.channels.recent_fallback;
}

function applyLegacyState(liveCtx, legacyCtx) {
  clearServedRecentState(liveCtx);
  liveCtx.candidateCounts.like_raw = Number(legacyCtx.candidateCounts.like_raw || 0);
  liveCtx.candidateCounts.recent_raw = Number(legacyCtx.candidateCounts.recent_raw || 0);
  liveCtx.candidateCounts.episode_raw = Number(legacyCtx.candidateCounts.episode_raw || 0);
  liveCtx.candidateCounts.recent_fallback_raw = Number(legacyCtx.candidateCounts.recent_fallback_raw || 0);

  if (Array.isArray(legacyCtx.channels.like) && legacyCtx.channels.like.length > 0) {
    liveCtx.channels.like = copyRows(legacyCtx.channels.like);
  }
  if (Array.isArray(legacyCtx.channels.recent) && legacyCtx.channels.recent.length > 0) {
    liveCtx.channels.recent = copyRows(legacyCtx.channels.recent);
  }
  if (Array.isArray(legacyCtx.channels.episode) && legacyCtx.channels.episode.length > 0) {
    liveCtx.channels.episode = copyRows(legacyCtx.channels.episode);
  }
  if (Array.isArray(legacyCtx.channels.recent_fallback) && legacyCtx.channels.recent_fallback.length > 0) {
    liveCtx.channels.recent_fallback = copyRows(legacyCtx.channels.recent_fallback);
  }
  Object.assign(liveCtx.debug, legacyCtx.debug);
}

export async function executeRecentCanaryShadow(ctx, { collectRecentCandidates }) {
  const legacyLocal = cloneRecentContext(ctx, {
    recentAccessMode: "legacy",
    recentIsolationRequested: false,
    recentIsolationFallbackReason: null,
    delegateWarnings: true,
  });
  const isolatedLocal = cloneRecentContext(ctx, {
    recentAccessMode: ctx.recentAccessMode,
    recentIsolationRequested: ctx.recentIsolationRequested,
    recentIsolationFallbackReason: ctx.recentIsolationFallbackReason,
    delegateWarnings: false,
  });

  const legacyStarted = nowNs();
  await collectRecentCandidates(legacyLocal.ctx);
  const legacyEnded = nowNs();

  const isolatedStarted = nowNs();
  await collectRecentCandidates(isolatedLocal.ctx);
  const isolatedEnded = nowNs();

  const comparisonStarted = nowNs();
  const legacySummary = summarizeRun(legacyLocal.ctx, legacyLocal.recorder);
  const isolatedSummary = summarizeRun(isolatedLocal.ctx, isolatedLocal.recorder);
  const comparison = compareRecentCanaryRuns({
    legacy: legacySummary,
    isolated: isolatedSummary,
  });
  const comparisonEnded = nowNs();

  applyLegacyState(ctx, legacyLocal.ctx);

  const legacyMs = round4(durationMs(legacyStarted, legacyEnded));
  const isolatedMs = round4(durationMs(isolatedStarted, isolatedEnded));
  const comparisonMs = round4(durationMs(comparisonStarted, comparisonEnded));
  const overheadMs = round4(isolatedMs + comparisonMs);

  ctx.debug.recent_canary_mode = "shadow";
  ctx.debug.recent_canary_shadow_executed = true;
  ctx.debug.recent_canary_served_mode = "legacy";
  ctx.debug.recent_canary_equivalent = comparison.equivalent;
  ctx.debug.recent_canary_classification = comparison.classification;
  ctx.debug.recent_canary_legacy_ms = legacyMs;
  ctx.debug.recent_canary_isolated_ms = isolatedMs;
  ctx.debug.recent_canary_comparison_ms = comparisonMs;
  ctx.debug.recent_canary_overhead_ms = overheadMs;
  ctx.debug.recent_canary_legacy_core_query_count = legacySummary.query_counts.legacy_core_query_count;
  ctx.debug.recent_canary_legacy_engine_query_count = legacySummary.query_counts.legacy_engine_query_count;
  ctx.debug.recent_canary_isolated_core_query_count = isolatedSummary.query_counts.isolated_core_query_count;
  ctx.debug.recent_canary_isolated_engine_query_count = isolatedSummary.query_counts.isolated_engine_query_count_total;
  ctx.debug.recent_canary_isolated_error = comparison.classification === "isolated_error";

  return {
    served_mode: "legacy",
    legacy: legacySummary,
    isolated: isolatedSummary,
    comparison,
    timings: {
      legacy_total_ms: legacyMs,
      isolated_total_ms: isolatedMs,
      shadow_comparison_ms: comparisonMs,
      shadow_total_overhead_ms: overheadMs,
    },
  };
}
