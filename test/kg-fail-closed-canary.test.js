import test from "node:test";
import assert from "node:assert/strict";

import { collectKgCandidates } from "../lib/recall/hybrid/channels/kg.js";
import { buildHybridSearchObservation } from "../lib/recall/hybrid-observation.js";
import {
  KG_FAIL_CLOSED_DEFAULT_MODE,
  resolveKgFailClosedDecision,
} from "../lib/recall/hybrid/kg-fail-closed-policy.js";
import { createCandidateCounts, createHybridDebug, createHybridWarnings } from "../lib/recall/hybrid/debug.js";

function makeRow(id = "legacy-1") {
  return {
    id,
    text: "legacy result",
    path: "memory/kg/result.md",
    updated_at: 1,
    confidence: 0.8,
    last_confidence_update: 0,
    base_tau: 7,
    hit_count: 1,
    is_protected: 0,
    conflict_flag: 0,
    category: "kg_node",
    is_archived: 0,
    kg_data: "alpha",
  };
}

function buildContext({ decision = null, legacyCalls = [] } = {}) {
  const candidateCounts = createCandidateCounts();
  const debug = createHybridDebug({
    rawQuery: "alpha",
    strippedQuery: "alpha",
    normalizedQuery: "alpha",
    queryTerms: ["alpha"],
    candidateCounts,
    minConfidence: 0,
    lexicalConfidenceThreshold: 0.7,
  });
  const { warnHybridSearchOnce } = createHybridWarnings();
  return {
    withDb: fn => {
      legacyCalls.push("legacy");
      return fn({
        prepare: () => ({ all: () => [makeRow()] }),
      });
    },
    withCoreDb: fn => fn({ prepare: () => ({ all: () => [] }) }),
    withEngineDb: fn => fn({ prepare: () => ({ all: () => [] }) }),
    kgAccessMode: "legacy",
    kgIsolationRequested: true,
    kgIsolationFallbackReason: "text_id_invariant_failed",
    kgFailClosedDecision: decision,
    channels: {},
    debug,
    candidateCounts,
    normalizedQuery: "alpha",
    strippedQuery: "alpha",
    likePatternTopN: 8,
    ftsTopK: 10,
    queryTerms: ["alpha"],
    exactFragments: [],
    categoryMap: null,
    normalizeCandidate: row => row,
    filterForRerank: () => true,
    enrichLexicalCandidate: row => ({ ...row, token_coverage: 1, exact_bonus: 0, structured_match_bonus: 0 }),
    inferCategoryFromChunk: () => "kg_node",
    lexicalMatchScore: () => 0,
    toDebugErrorMessage: error => error.message,
    warnHybridSearchOnce,
  };
}

async function runCollection(ctx) {
  await collectKgCandidates(ctx);
  return ctx;
}

test("default legacy mode preserves the fallback query", async () => {
  const legacyCalls = [];
  const ctx = await runCollection(buildContext({ legacyCalls }));
  assert.deepEqual(legacyCalls, ["legacy"]);
  assert.equal(ctx.channels.kg.length, 1);
  assert.equal(ctx.debug.kg_fail_closed_applied, undefined);
});

test("shadow mode keeps fallback results and exposes shadow telemetry", async () => {
  const legacyCalls = [];
  const decision = resolveKgFailClosedDecision({ mode: "shadow_fail_closed" });
  const ctx = await runCollection(buildContext({ decision, legacyCalls }));
  assert.equal(decision.mode, "shadow_fail_closed");
  assert.deepEqual(legacyCalls, ["legacy"]);
  assert.equal(ctx.channels.kg.length, 1);
  assert.equal(ctx.debug.kg_fail_closed_applied, undefined);
});

test("full fail-closed mode suppresses fallback without canary context", async () => {
  const legacyCalls = [];
  const decision = resolveKgFailClosedDecision({ mode: "full_fail_closed" });
  assert.deepEqual({
    mode: decision.mode,
    eligible: decision.eligible,
    in_scope: decision.in_scope,
    scope_required: decision.scope_required,
    rollout_scope: decision.rollout_scope,
    fallback_behavior: decision.fallback_behavior,
  }, {
    mode: "full_fail_closed",
    eligible: true,
    in_scope: true,
    scope_required: false,
    rollout_scope: "full",
    fallback_behavior: "suppressed",
  });
  const ctx = await runCollection(buildContext({ decision, legacyCalls }));
  assert.deepEqual(legacyCalls, []);
  assert.equal(ctx.channels.kg, undefined);
  assert.equal(ctx.debug.kg_runtime_mode, "full_fail_closed");
  assert.equal(ctx.debug.kg_rollout_scope, "full");
  assert.equal(ctx.debug.kg_scope_required, false);
  assert.equal(ctx.debug.kg_fail_closed_scope_match, null);
  assert.equal(ctx.debug.kg_fail_closed_applied, true);
  assert.equal(ctx.debug.kg_fail_closed_fallback_suppressed, true);
  const observation = buildHybridSearchObservation({
    surface: "memory_engine_search",
    result: { debug: ctx.debug, channel_sizes: {}, results: [] },
  });
  assert.equal(observation.kg_runtime_mode, "full_fail_closed");
  assert.equal(observation.kg_rollout_scope, "full");
  assert.equal(observation.kg_scope_required, false);
});

test("scoped canary suppresses the fallback and serves no KG candidates", async () => {
  const legacyCalls = [];
  const decision = resolveKgFailClosedDecision({
    mode: "fail_closed_canary",
    canary: { enabled: true, agentIds: ["edi"], sessions: ["test-session"] },
    context: {
      source: "openclaw_runtime",
      agentIdentity: "edi",
      sessionIdentity: "test-session",
    },
  });
  const ctx = await runCollection(buildContext({ decision, legacyCalls }));
  assert.equal(decision.mode, "fail_closed_canary");
  assert.deepEqual(legacyCalls, []);
  assert.equal(ctx.channels.kg, undefined);
  assert.equal(ctx.debug.kg_fail_closed_applied, true);
  assert.equal(ctx.debug.kg_fail_closed_would_have_used_fallback, true);
  assert.equal(ctx.debug.kg_fail_closed_fallback_suppressed, true);
  assert.equal(ctx.debug.kg_fail_closed_empty_candidate, true);
  const observation = buildHybridSearchObservation({
    surface: "memory_engine_search",
    result: { debug: ctx.debug, channel_sizes: {}, results: [] },
  });
  assert.equal(observation.kg_runtime_mode, "fail_closed_canary");
  assert.equal(observation.kg_fail_closed_applied, true);
  assert.equal(observation.kg_fail_closed_fallback_suppressed, true);
  assert.equal(observation.legacy_db_fallback_used, false);
});

test("scope mismatch falls back and switching mode back rolls back immediately", async () => {
  const canary = { enabled: true, agentIds: ["edi"] };
  const mismatch = resolveKgFailClosedDecision({
    mode: "fail_closed_canary",
    canary,
    context: { source: "openclaw_runtime", agentIdentity: "other" },
  });
  assert.equal(mismatch.mode, KG_FAIL_CLOSED_DEFAULT_MODE);
  const mismatchCalls = [];
  const mismatchCtx = await runCollection(buildContext({ decision: mismatch, legacyCalls: mismatchCalls }));
  assert.deepEqual(mismatchCalls, ["legacy"]);
  assert.equal(mismatchCtx.channels.kg.length, 1);

  const rollback = resolveKgFailClosedDecision({ mode: "legacy_fallback" });
  const rollbackCalls = [];
  const rollbackCtx = await runCollection(buildContext({ decision: rollback, legacyCalls: rollbackCalls }));
  assert.deepEqual(rollbackCalls, ["legacy"]);
  assert.equal(rollbackCtx.channels.kg.length, 1);
});
