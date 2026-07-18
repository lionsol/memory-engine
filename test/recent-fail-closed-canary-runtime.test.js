import test from "node:test";
import assert from "node:assert/strict";

import { collectRecentCandidates } from "../lib/recall/hybrid/channels/recent.js";
import { evaluateRecentFailClosedPolicy } from "../lib/recall/hybrid/recent-fail-closed-policy.js";

const legacyRow = {
  id: "legacy",
  text: "alpha legacy candidate",
  path: "memory/smart-add/legacy.md",
  updated_at: 100,
  confidence: 0.8,
  last_confidence_update: 100,
  base_tau: 7,
  hit_count: 1,
  is_protected: 0,
  conflict_flag: 0,
  category: "raw_log",
  is_archived: 0,
};

function makeContext(recentFailClosedDecision) {
  const records = [];
  const channels = {};
  const candidateCounts = {
    like_raw: 0,
    recent_raw: 0,
    episode_raw: 0,
    recent_fallback_raw: 0,
  };
  const debug = { fallbacks_triggered: [] };
  const db = {
    prepare() {
      return { all: () => [legacyRow] };
    },
  };

  return {
    records,
    ctx: {
      channels,
      debug,
      candidateCounts,
      ftsIsEmpty: false,
      recentAccessMode: "guarded_fallback",
      recentIsolationRequested: true,
      recentIsolationFallbackReason: "isolated_recent_guard_failed",
      recentFailClosedDecision,
      normalizedQuery: "alpha",
      queryTerms: ["alpha"],
      recentTopK: 5,
      recentRerankTopK: 5,
      recentFallbackTopK: 5,
      likePatternTopN: 8,
      rankingConfig: {},
      categoryMap: null,
      nowSec: 200,
      withDb(run) {
        records.push("legacy");
        return run(db);
      },
      uniqueVectorChannels: () => false,
      warnHybridSearchOnce: () => {},
      toDebugErrorMessage: error => String(error?.message || error),
      normalizeCandidate: row => ({ ...row, semantic_score: 1 }),
      filterForRerank: () => true,
      inferCategoryFromChunk: () => "raw_log",
      lexicalMatchScore: () => 1,
      computeRecencyBoost: () => 0,
      normalizeUnixSeconds: value => Number(value) || 0,
      toFiniteNumber: value => Number(value),
    },
  };
}

function policy(mode, context = {}, canary = {}) {
  return evaluateRecentFailClosedPolicy({
    runtimeContext: context,
    config: { mode, canary },
  });
}

const trustedContext = {
  source: "openclaw_runtime",
  agentIdentity: "agent-a",
  sessionIdentity: "session-a",
};

const enabledCanary = {
  enabled: true,
  agentIds: ["agent-a"],
  sessionIds: ["session-a"],
};

test("default legacy mode executes the fallback", async () => {
  const { ctx, records } = makeContext(policy("legacy_fallback"));
  await collectRecentCandidates(ctx);
  assert.deepEqual(records, ["legacy"]);
  assert.deepEqual(ctx.channels.recent.map(row => row.id), ["legacy"]);
  assert.equal(ctx.debug.recent_runtime_mode, "legacy_fallback");
  assert.equal(ctx.debug.recent_fail_closed_applied, null);
  assert.equal(ctx.debug.recent_fail_closed_fallback_suppressed, null);
});

test("shadow fail-closed mode executes fallback and records shadow telemetry", async () => {
  const { ctx, records } = makeContext(policy("shadow_fail_closed"));
  await collectRecentCandidates(ctx);
  assert.deepEqual(records, ["legacy"]);
  assert.deepEqual(ctx.channels.recent.map(row => row.id), ["legacy"]);
  assert.equal(ctx.debug.recent_runtime_mode, "shadow_fail_closed");
  assert.equal(ctx.debug.recent_shadow_mode, "shadow_fail_closed");
  assert.equal(ctx.debug.recent_fail_closed_applied, null);
});

test("matching scoped canary suppresses the Recent fallback", async () => {
  const decision = policy("fail_closed_canary", trustedContext, enabledCanary);
  assert.equal(decision.eligible, true);
  const { ctx, records } = makeContext(decision);
  await collectRecentCandidates(ctx);
  assert.deepEqual(records, []);
  assert.equal(ctx.channels.recent, undefined);
  assert.equal(ctx.debug.recent_access_mode, "isolated_blocked");
  assert.equal(ctx.debug.recent_runtime_mode, "fail_closed_canary");
  assert.equal(ctx.debug.recent_fail_closed_applied, true);
  assert.equal(ctx.debug.recent_fail_closed_fallback_suppressed, true);
  assert.equal(ctx.debug.recent_fail_closed_scope_match, true);
  assert.equal(ctx.debug.recent_fail_closed_empty_candidate, true);
});

test("scope mismatch preserves the legacy fallback", async () => {
  const decision = policy("fail_closed_canary", {
    ...trustedContext,
    agentIdentity: "other-agent",
  }, enabledCanary);
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "scope_mismatch");
  const { ctx, records } = makeContext(decision);
  await collectRecentCandidates(ctx);
  assert.deepEqual(records, ["legacy"]);
  assert.deepEqual(ctx.channels.recent.map(row => row.id), ["legacy"]);
  assert.equal(ctx.debug.recent_fail_closed_scope_match, false);
  assert.equal(ctx.debug.recent_fail_closed_applied, null);
});

test("switching back to legacy mode restores fallback immediately", async () => {
  const { ctx, records } = makeContext(policy("legacy_fallback", trustedContext, enabledCanary));
  await collectRecentCandidates(ctx);
  assert.deepEqual(records, ["legacy"]);
  assert.equal(ctx.debug.recent_runtime_mode, "legacy_fallback");
});
