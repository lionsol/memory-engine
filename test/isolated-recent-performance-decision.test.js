import test from "node:test";
import assert from "node:assert/strict";

import {
  compareSqlRewriteStrategies,
  deriveRecentPerformanceDecision,
} from "../lib/recall/hybrid/recent-performance-probe.js";

function cell(branch, limit, p95_ms, median_ms = p95_ms, extra = {}) {
  return {
    branch,
    limit,
    semantic_equivalent: true,
    database_stable: true,
    valid_measurement_count: 7,
    p95_ms,
    median_ms,
    core_query_count: 1,
    engine_query_count: 2,
    metadata_query_count: 1,
    rows_read_from_core: 100,
    text_bytes: 0,
    path_bytes: 0,
    error: null,
    ...extra,
  };
}

function branchEquivalence(all = true, overrides = {}) {
  return {
    like_fallback: all,
    recent_scored: all,
    recent_fallback: all,
    episode_projection: all,
    ...overrides,
  };
}

const productionLimits = {
  recent_scored: 120,
  like_fallback: 30,
  recent_fallback: 20,
};

test("compareSqlRewriteStrategies ignores object key order and favors B on the provided real-safe fixture", () => {
  const bCells = [
    cell("recent_scored", 20, 48.49),
    cell("recent_scored", 100, 53.02),
    cell("recent_scored", 120, 46.2),
    cell("recent_scored", 500, 78.58),
    cell("like_fallback", 20, 62.25),
    cell("like_fallback", 30, 62.78),
    cell("like_fallback", 100, 86.73),
    cell("like_fallback", 500, 79.57),
    cell("recent_fallback", 20, 42.16),
    cell("recent_fallback", 100, 53.12),
    cell("recent_fallback", 500, 66.37),
  ];
  const cCells = [
    cell("recent_scored", 20, 52.72),
    cell("recent_scored", 100, 53.22),
    cell("recent_scored", 120, 52.45),
    cell("recent_scored", 500, 64.1),
    cell("like_fallback", 20, 62.45),
    cell("like_fallback", 30, 65.56),
    cell("like_fallback", 100, 69.35),
    cell("like_fallback", 500, 103.96),
    cell("recent_fallback", 20, 48.25),
    cell("recent_fallback", 100, 48.73),
    cell("recent_fallback", 500, 66.44),
  ];
  const comparison = compareSqlRewriteStrategies({
    strategyBCells: [...bCells].reverse(),
    strategyCCells: cCells,
    productionLimits,
  });
  assert.equal(comparison.comparable_cell_count, 11);
  assert.equal(comparison.b_worst_p95_ms, 86.73);
  assert.equal(comparison.c_worst_p95_ms, 103.96);

  const decision = deriveRecentPerformanceDecision({
    privacyValidation: { passed: true },
    productionLimits,
    strategyB: { branch_equivalent: branchEquivalence(true), cells: bCells },
    strategyC: { branch_equivalent: branchEquivalence(true), cells: cCells },
    strategyD: { branch_equivalent: branchEquivalence(true), cells: [] },
    strategyE: { applicable: false, branch_equivalent: branchEquivalence(true), cells: [] },
  });
  assert.equal(decision.class, "recommended_sql_rewrite");
  assert.equal(decision.strategy, "strategy_b_not_in");
});

test("decision favors B or C when materially faster and uses simplicity tiebreak within tolerance", () => {
  const bFast = deriveRecentPerformanceDecision({
    privacyValidation: { passed: true },
    productionLimits,
    strategyB: { branch_equivalent: branchEquivalence(true), cells: [cell("recent_scored", 120, 30), cell("like_fallback", 30, 30), cell("recent_fallback", 20, 30), cell("episode_projection", 120, 30)] },
    strategyC: { branch_equivalent: branchEquivalence(true), cells: [cell("recent_scored", 120, 60), cell("like_fallback", 30, 60), cell("recent_fallback", 20, 60), cell("episode_projection", 120, 60)] },
  });
  assert.equal(bFast.strategy, "strategy_b_not_in");

  const cFast = deriveRecentPerformanceDecision({
    privacyValidation: { passed: true },
    productionLimits,
    strategyB: { branch_equivalent: branchEquivalence(true), cells: [cell("recent_scored", 120, 80), cell("like_fallback", 30, 80), cell("recent_fallback", 20, 80), cell("episode_projection", 120, 80)] },
    strategyC: { branch_equivalent: branchEquivalence(true), cells: [cell("recent_scored", 120, 40), cell("like_fallback", 30, 40), cell("recent_fallback", 20, 40), cell("episode_projection", 120, 40)] },
  });
  assert.equal(cFast.strategy, "strategy_c_materialized_cte");

  const tie = deriveRecentPerformanceDecision({
    privacyValidation: { passed: true },
    productionLimits,
    strategyB: { branch_equivalent: branchEquivalence(true), cells: [cell("recent_scored", 120, 50), cell("like_fallback", 30, 50), cell("recent_fallback", 20, 50), cell("episode_projection", 120, 50)] },
    strategyC: { branch_equivalent: branchEquivalence(true), cells: [cell("recent_scored", 120, 51), cell("like_fallback", 30, 51), cell("recent_fallback", 20, 51), cell("episode_projection", 120, 51)] },
  });
  assert.equal(tie.strategy, "strategy_b_not_in");
  assert.equal(tie.reason, "strategy_b_equivalent_and_simpler_within_tolerance");
});

test("decision disqualifies non-equivalent, unstable, privacy-failed, D, and E cases", () => {
  const privacyFail = deriveRecentPerformanceDecision({
    privacyValidation: { passed: false },
  });
  assert.equal(privacyFail.class, "fail");

  const bBad = deriveRecentPerformanceDecision({
    privacyValidation: { passed: true },
    productionLimits,
    strategyB: { branch_equivalent: branchEquivalence(true, { like_fallback: false }), cells: [cell("recent_scored", 120, 40)] },
    strategyC: { branch_equivalent: branchEquivalence(true), cells: [cell("recent_scored", 120, 41), cell("like_fallback", 30, 41), cell("recent_fallback", 20, 41), cell("episode_projection", 120, 41)] },
  });
  assert.equal(bBad.strategy, "strategy_c_materialized_cte");

  const noComparable = deriveRecentPerformanceDecision({
    privacyValidation: { passed: true },
    productionLimits,
    strategyB: { branch_equivalent: branchEquivalence(true), cells: [cell("recent_scored", 120, 600)] },
    strategyC: { branch_equivalent: branchEquivalence(true), cells: [cell("recent_scored", 120, 601)] },
  });
  assert.equal(noComparable.class, "inconclusive");

  const dAndE = deriveRecentPerformanceDecision({
    privacyValidation: { passed: true },
    productionLimits,
    strategyB: { branch_equivalent: branchEquivalence(true), cells: [cell("recent_scored", 120, 40), cell("like_fallback", 30, 40), cell("recent_fallback", 20, 40), cell("episode_projection", 120, 40)] },
    strategyC: { branch_equivalent: branchEquivalence(true), cells: [cell("recent_scored", 120, 42), cell("like_fallback", 30, 42), cell("recent_fallback", 20, 42), cell("episode_projection", 120, 42)] },
    strategyD: { branch_equivalent: branchEquivalence(true, { episode_projection: false }), cells: [] },
    strategyE: {
      applicable: true,
      branch_equivalent: branchEquivalence(true),
      cells: [
        cell("recent_scored", 120, 560.31, 560.31, { rows_read_from_core: 1280, text_bytes: 189852 }),
        cell("recent_fallback", 500, 1428.69, 1428.69, { rows_read_from_core: 3072, text_bytes: 719055 }),
      ],
    },
  });
  assert.equal(dAndE.details.strategy_d_eligible_for_recommendation, false);
  assert.equal(dAndE.details.strategy_d_disqualified_reason, "episode_projection_not_equivalent");
  assert.equal(dAndE.details.strategy_e_eligible_for_recommendation, false);
  assert.equal(dAndE.details.strategy_e_disqualified_reason, "strategy_e_disqualified_by_real_core_read_amplification");
});
