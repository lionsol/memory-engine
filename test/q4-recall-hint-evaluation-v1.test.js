import test from "node:test";
import assert from "node:assert/strict";

import {
  Q4_RECALL_HINT_EVALUATION_SCHEMA,
  evaluateQ4RecallHintCases,
} from "../lib/benchmark/q4-recall-hint-evaluation-v1.js";

function run(pool, top3, latency, accounting = {}) {
  return {
    candidate_pool_ids: pool,
    ranked_top3_ids: top3,
    latency_ms: latency,
    provider_calls: accounting.provider_calls ?? 0,
    extra_embedding_calls: accounting.extra_embedding_calls ?? 0,
    extra_vector_search_calls: accounting.extra_vector_search_calls ?? 0,
    provider_input_tokens: accounting.provider_input_tokens ?? 0,
    provider_output_tokens: accounting.provider_output_tokens ?? 0,
    hint_status: accounting.hint_status ?? "not_applicable",
    fallback: accounting.fallback === true,
  };
}

function syntheticCases() {
  return [
    {
      case_id: "dev-entity-1",
      split: "development",
      family: "entity_reference",
      gold_evidence_ids: ["g1"],
      baseline: run(["x1", "g1"], ["x1", "g1"], 10),
      hint: run(["g1", "x1"], ["g1", "x1"], 18, {
        provider_calls: 1,
        extra_embedding_calls: 1,
        extra_vector_search_calls: 1,
        provider_input_tokens: 20,
        provider_output_tokens: 8,
        hint_status: "applied",
      }),
    },
    {
      case_id: "acc-entity-1",
      split: "acceptance",
      family: "entity_reference",
      gold_evidence_ids: ["g2"],
      baseline: run(["x2", "x3"], ["x2", "x3"], 12),
      hint: run(["g2", "x2", "x3"], ["g2", "x2", "x3"], 24, {
        provider_calls: 1,
        extra_embedding_calls: 1,
        extra_vector_search_calls: 1,
        provider_input_tokens: 18,
        provider_output_tokens: 6,
        hint_status: "applied",
      }),
    },
    {
      case_id: "acc-temporal-fallback",
      split: "acceptance",
      family: "temporal_relation",
      gold_evidence_ids: ["g3"],
      baseline: run(["g3", "x4"], ["g3", "x4"], 11),
      hint: run(["g3", "x4"], ["g3", "x4"], 14, {
        provider_calls: 1,
        hint_status: "provider_timeout",
        fallback: true,
      }),
    },
    {
      case_id: "acc-multifacet-1",
      split: "acceptance",
      family: "multi_facet",
      gold_evidence_ids: ["g4", "g5"],
      baseline: run(["g4", "x5", "x6"], ["g4", "x5", "x6"], 13),
      hint: run(["g4", "g5", "x5", "x6"], ["g4", "g5", "x5"], 27, {
        provider_calls: 1,
        extra_embedding_calls: 2,
        extra_vector_search_calls: 2,
        provider_input_tokens: 24,
        provider_output_tokens: 9,
        hint_status: "applied",
      }),
    },
    {
      case_id: "acc-protection-1",
      split: "acceptance",
      family: "protection",
      gold_evidence_ids: ["g6"],
      baseline: run(["g6", "x7", "x8"], ["g6", "x7", "x8"], 9),
      hint: run(["g6", "x7", "x8"], ["g6", "x7", "x8"], 16, {
        provider_calls: 1,
        extra_embedding_calls: 1,
        extra_vector_search_calls: 1,
        provider_input_tokens: 15,
        provider_output_tokens: 5,
        hint_status: "applied",
      }),
    },
  ];
}

test("Q4-C evaluator reports pool completeness, final @3 quality, paired transitions, cost, and fallback", () => {
  const result = evaluateQ4RecallHintCases(syntheticCases());

  assert.equal(result.schema, Q4_RECALL_HINT_EVALUATION_SCHEMA);
  assert.equal(result.top_k, 3);
  assert.equal(result.candidate_depth, 20);
  assert.equal(result.case_count, 5);
  assert.equal(result.development.case_count, 1);
  assert.equal(result.acceptance.case_count, 4);

  assert.equal(result.acceptance.baseline.pool_miss_count, 2);
  assert.equal(result.acceptance.hint.pool_miss_count, 0);
  assert.equal(result.acceptance.delta.pool_miss_count, -2);
  assert.equal(result.acceptance.delta.pool_evidence_coverage > 0, true);
  assert.equal(result.acceptance.delta.recall_all_at_3 > 0, true);
  assert.equal(result.acceptance.paired["recall_all@3"].improved, 2);
  assert.equal(result.acceptance.paired["recall_all@3"].regressed, 0);
  assert.equal(result.acceptance.paired["recall_all@3"].unchanged, 2);

  assert.equal(result.acceptance.cost.provider_calls, 4);
  assert.equal(result.acceptance.cost.extra_embedding_calls, 4);
  assert.equal(result.acceptance.cost.extra_vector_search_calls, 4);
  assert.equal(result.acceptance.cost.fallback_count, 1);
  assert.equal(result.acceptance.cost.fallback_rate, 0.25);
  assert.equal(result.acceptance.hint.latency_p95_ms, 27);
  assert.equal(result.protection.paired["recall_all@3"].regressed, 0);
  assert.equal(result.technical_stop_conditions.status, "PASS");
});

test("Q4-C evaluator keeps fallback cases in aggregate rather than filtering them out", () => {
  const result = evaluateQ4RecallHintCases(syntheticCases());
  const fallback = result.rows.find(row => row.case_id === "acc-temporal-fallback");
  assert.equal(fallback.accounting.fallback, true);
  assert.equal(fallback.hint.final.metrics["recall_all@3"], 1);
  assert.equal(result.acceptance.case_count, 4);
});

test("Q4-C technical stop conditions fail on acceptance or protection regression", () => {
  const cases = syntheticCases();
  const protection = cases.find(row => row.case_id === "acc-protection-1");
  protection.hint = run(["x7", "x8"], ["x7", "x8"], 16, {
    provider_calls: 1,
    extra_embedding_calls: 1,
    extra_vector_search_calls: 1,
    hint_status: "applied",
  });

  const result = evaluateQ4RecallHintCases(cases);
  assert.equal(result.technical_stop_conditions.status, "STOP");
  assert.equal(result.technical_stop_conditions.reasons.includes("protection_pool_coverage_regressed"), true);
  assert.equal(result.technical_stop_conditions.reasons.includes("protection_pool_miss_increased"), true);
  assert.equal(result.technical_stop_conditions.reasons.includes("protection_recall_any_regression_observed"), true);
  assert.equal(result.technical_stop_conditions.reasons.includes("protection_recall_all_regression_observed"), true);
});

test("Q4-C evaluator enforces fixed pool/topK and added-call budgets", () => {
  const tooDeep = syntheticCases();
  tooDeep[0].hint.candidate_pool_ids = Array.from({ length: 21 }, (_, index) => `c${index}`);
  assert.throws(
    () => evaluateQ4RecallHintCases(tooDeep),
    /candidate_pool_exceeds_depth/,
  );

  const tooManyCalls = syntheticCases();
  tooManyCalls[0].hint.extra_embedding_calls = 3;
  assert.throws(
    () => evaluateQ4RecallHintCases(tooManyCalls),
    /extra_embedding_budget_exceeded/,
  );
});
