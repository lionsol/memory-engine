import test from "node:test";
import assert from "node:assert/strict";

import { createCandidateCounts, createHybridDebug } from "../lib/recall/hybrid/debug.js";
import {
  compareRecentCanaryRuns,
  executeRecentCanaryShadow,
} from "../lib/recall/hybrid/recent-canary-shadow.js";

function makeSummary(overrides = {}) {
  return {
    access_mode: "isolated",
    fallback_reason: null,
    warning_classes: [],
    error_classification: null,
    candidate_counts: { like_raw: 0, recent_raw: 1, episode_raw: 0, recent_fallback_raw: 0 },
    raw_counts: { like_fallback: 0, recent: 1, episode: 0, recent_fallback: 0 },
    ordered_ids: { like_fallback: [], recent: ["A"], episode: [], recent_fallback: [] },
    raw_fingerprints: { like_fallback: [], recent: ["raw-A"], episode: [], recent_fallback: [] },
    normalized_fingerprints: { like_fallback: [], recent: ["norm-A"], episode: [], recent_fallback: [] },
    channel_membership: ["recent"],
    final_order_ids: ["A"],
    query_counts: {
      legacy_core_query_count: 0,
      legacy_engine_query_count: 0,
      isolated_archived_engine_query_count: 1,
      isolated_core_query_count: 1,
      isolated_metadata_engine_query_count: 1,
      isolated_engine_query_count_total: 2,
    },
    ...overrides,
  };
}

test("recent canary shadow comparison classifies mismatches, guarded fallback, and errors", () => {
  assert.equal(compareRecentCanaryRuns({
    legacy: makeSummary({ access_mode: "legacy" }),
    isolated: makeSummary(),
  }).classification, "equivalent");

  assert.equal(compareRecentCanaryRuns({
    legacy: makeSummary({ final_order_ids: ["A", "B"], ordered_ids: { like_fallback: [], recent: ["A", "B"], episode: [], recent_fallback: [] } }),
    isolated: makeSummary({ final_order_ids: ["B", "A"], ordered_ids: { like_fallback: [], recent: ["B", "A"], episode: [], recent_fallback: [] } }),
  }).classification, "mismatch_order");

  assert.equal(compareRecentCanaryRuns({
    legacy: makeSummary({ raw_fingerprints: { like_fallback: [], recent: ["raw-A"], episode: [], recent_fallback: [] } }),
    isolated: makeSummary({ raw_fingerprints: { like_fallback: [], recent: ["raw-B"], episode: [], recent_fallback: [] } }),
  }).classification, "mismatch_raw");

  assert.equal(compareRecentCanaryRuns({
    legacy: makeSummary({ normalized_fingerprints: { like_fallback: [], recent: ["norm-A"], episode: [], recent_fallback: [] } }),
    isolated: makeSummary({ normalized_fingerprints: { like_fallback: [], recent: ["norm-B"], episode: [], recent_fallback: [] } }),
  }).classification, "mismatch_normalized");

  assert.equal(compareRecentCanaryRuns({
    legacy: makeSummary(),
    isolated: makeSummary({ candidate_counts: { like_raw: 0, recent_raw: 2, episode_raw: 0, recent_fallback_raw: 0 } }),
  }).classification, "mismatch_counts");

  assert.equal(compareRecentCanaryRuns({
    legacy: makeSummary({ channel_membership: ["recent"] }),
    isolated: makeSummary({ channel_membership: ["recent", "episode"] }),
  }).classification, "mismatch_channels");

  assert.equal(compareRecentCanaryRuns({
    legacy: makeSummary({ ordered_ids: { like_fallback: [], recent: [], episode: [], recent_fallback: [] }, final_order_ids: [], candidate_counts: { like_raw: 0, recent_raw: 0, episode_raw: 0, recent_fallback_raw: 0 }, raw_counts: { like_fallback: 0, recent: 0, episode: 0, recent_fallback: 0 } }),
    isolated: makeSummary({ ordered_ids: { like_fallback: [], recent: [], episode: [], recent_fallback: [] }, final_order_ids: [], candidate_counts: { like_raw: 0, recent_raw: 0, episode_raw: 0, recent_fallback_raw: 0 }, raw_counts: { like_fallback: 0, recent: 0, episode: 0, recent_fallback: 0 } }),
  }).classification, "no_positive_candidate_evidence");

  assert.equal(compareRecentCanaryRuns({
    legacy: makeSummary({ access_mode: "legacy" }),
    isolated: makeSummary({ access_mode: "guarded_fallback" }),
  }).classification, "guarded_fallback");

  assert.equal(compareRecentCanaryRuns({
    legacy: makeSummary({ access_mode: "legacy", error_classification: "recent_error" }),
    isolated: makeSummary(),
  }).classification, "legacy_error");

  assert.equal(compareRecentCanaryRuns({
    legacy: makeSummary({ access_mode: "legacy" }),
    isolated: makeSummary({ error_classification: "recent_error" }),
  }).classification, "isolated_error");
});

test("recent canary shadow serves legacy state only and keeps isolated-only ids out of live context", async () => {
  const candidateCounts = createCandidateCounts();
  const debug = createHybridDebug({
    rawQuery: "query",
    strippedQuery: "query",
    normalizedQuery: "query",
    queryTerms: ["query"],
    candidateCounts,
    minConfidence: 0,
    lexicalConfidenceThreshold: 0.7,
  });
  const liveCtx = {
    channels: {},
    debug,
    candidateCounts,
    recentAccessMode: "isolated",
    recentIsolationRequested: true,
    recentIsolationFallbackReason: null,
    warnHybridSearchOnce() {},
  };

  await executeRecentCanaryShadow(liveCtx, {
    async collectRecentCandidates(localCtx) {
      localCtx.debug.recent_access_mode = localCtx.recentAccessMode;
      if (localCtx.recentAccessMode === "legacy") {
        localCtx.candidateCounts.recent_raw = 1;
        localCtx.channels.recent = [{ id: "legacy-1", text: "legacy" }];
        localCtx.recentCanaryRecorder.rows.push({ db: "legacy", branch: "recent_scored", rows: [{ id: "legacy-1", text: "legacy" }] });
        localCtx.recentCanaryRecorder.query_counts.legacy_core_query_count += 1;
        localCtx.recentCanaryRecorder.query_counts.legacy_engine_query_count += 1;
        return;
      }

      localCtx.candidateCounts.recent_raw = 2;
      localCtx.channels.recent = [
        { id: "legacy-1", text: "legacy" },
        { id: "isolated-1", text: "isolated only" },
      ];
      localCtx.recentCanaryRecorder.rows.push({ db: "core", branch: "recent_scored", rows: [{ id: "legacy-1" }, { id: "isolated-1" }] });
      localCtx.recentCanaryRecorder.rows.push({ db: "engine", branch: "metadata_engine", rows: [{ chunk_id: "legacy-1" }, { chunk_id: "isolated-1" }] });
      localCtx.recentCanaryRecorder.query_counts.isolated_core_query_count += 1;
      localCtx.recentCanaryRecorder.query_counts.isolated_archived_engine_query_count += 1;
      localCtx.recentCanaryRecorder.query_counts.isolated_metadata_engine_query_count += 1;
    },
  });

  assert.deepEqual(liveCtx.channels.recent.map(item => item.id), ["legacy-1"]);
  assert.equal(JSON.stringify(liveCtx.channels).includes("isolated-1"), false);
  assert.equal(liveCtx.debug.recent_canary_served_mode, "legacy");
  assert.equal(liveCtx.debug.recent_canary_shadow_executed, true);
  assert.equal(liveCtx.debug.recent_canary_classification, "mismatch_counts");
  assert.equal(liveCtx.debug.recent_canary_legacy_core_query_count, 1);
  assert.equal(liveCtx.debug.recent_canary_legacy_engine_query_count, 1);
  assert.equal(liveCtx.debug.recent_canary_isolated_core_query_count, 1);
  assert.equal(liveCtx.debug.recent_canary_isolated_engine_query_count, 2);
  assert.equal(liveCtx.debug.recent_canary_legacy_ms >= 0, true);
  assert.equal(liveCtx.debug.recent_canary_isolated_ms >= 0, true);
  assert.equal(liveCtx.debug.recent_canary_comparison_ms >= 0, true);
  assert.equal(liveCtx.debug.recent_canary_overhead_ms >= 0, true);
});
