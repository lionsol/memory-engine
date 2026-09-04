import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCOMO_EVIDENCE_STRICT_V1,
  normalizeLocomoCase,
  scoreLocomoSessionMetrics,
} from "../lib/benchmark/locomo-v1.js";
import {
  normalizeLongMemEvalCase,
  scoreLongMemEvalSessionMetrics,
} from "../lib/benchmark/longmemeval-v1.js";
import {
  Q1_ANSWER_EVIDENCE_COVERAGE_STATUS,
  Q1_CASE_PROVENANCE,
  Q1_METRIC_REGISTRY,
  Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
  aggregateQ1EvidenceRankingAt3,
  aggregateQ1InjectionReview,
  aggregateQ1TriggerDecision,
  getQ1AnswerEvidenceCoverageStatus,
  scoreQ1AnswerEvidenceCoverage,
  scoreQ1EvidenceRankingAt3,
  scoreQ1InjectionReviewItem,
  scoreQ1Top3Safety,
  scoreQ1TriggerDecision,
  summarizeQ1LatencyWindow,
  validateQ1MetricProvenance,
} from "../lib/benchmark/q1-product-metric-contract-v1.js";

function rank(gold, retrieved, metadata = {}) {
  return scoreQ1EvidenceRankingAt3({
    gold_evidence_ids: gold,
    ranked_retrieved_ids: retrieved,
    ...metadata,
  });
}

function longFixture(evidence) {
  return {
    question_id: "q1",
    question_type: "multi-session",
    question: "Where did Alice move?",
    answer: "Kyoto",
    question_date: "2025/01/10 (Fri) 00:00",
    haystack_session_ids: ["s1", "s2", "s3"],
    haystack_dates: [
      "2025/01/01 (Wed) 00:00",
      "2025/01/05 (Sun) 00:00",
      "2025/01/07 (Tue) 00:00",
    ],
    haystack_sessions: [
      [{ role: "user", content: "Alice used to live in Osaka." }],
      [{ role: "user", content: "Alice moved to Kyoto." }],
      [{ role: "user", content: "Alice visited Kyoto again." }],
    ],
    answer_session_ids: evidence,
  };
}

function locomoFixture(evidence) {
  return {
    sample_id: "conv-q1",
    conversation: {
      speaker_a: "Alice",
      speaker_b: "Bob",
      session_1_date_time: "1:00 pm on 1 May, 2023",
      session_1: [
        { speaker: "Alice", dia_id: "D1:1", text: "Alice visited Kyoto." },
        { speaker: "Bob", dia_id: "D1:2", text: "That sounds memorable." },
      ],
      session_2_date_time: "2:00 pm on 2 May, 2023",
      session_2: [
        { speaker: "Bob", dia_id: "D2:1", text: "Bob moved to Osaka." },
        { speaker: "Alice", dia_id: "D2:2", text: "I will remember that." },
      ],
    },
    qa: [{ question: "Where did they go?", answer: "Kyoto", evidence, category: 1 }],
  };
}

test("exports the Q1 schema, Q0-compatible provenance, and metric registry", () => {
  assert.equal(Q1_PRODUCT_METRIC_CONTRACT_SCHEMA, "memory_engine_q1_product_metric_contract_v1");
  assert.deepEqual(Q1_CASE_PROVENANCE, [
    "PRODUCTION_OBSERVED",
    "PRODUCTION_REPLAY",
    "BENCHMARK_DERIVED",
    "TARGETED_SYNTHETIC",
  ]);
  assert.ok(Object.isFrozen(Q1_CASE_PROVENANCE));
  assert.ok(Q1_METRIC_REGISTRY.evidence_ranking_at_3.includes("ndcg@3"));
  assert.ok(Q1_METRIC_REGISTRY.answer_use.includes("answer_evidence_coverage"));
});

test("scores partial evidence coverage and keeps top3 full recall distinct from feasibility", () => {
  const score = rank(["a", "b", "c", "d"], ["a", "x", "b"]);
  assert.equal(score["recall_any@3"], 1);
  assert.equal(score["recall_all@3"], 0);
  assert.equal(score["evidence_coverage@3"], 0.5);
  assert.equal(score["budget_feasible@3"], false);
  assert.equal(score["recall_all@3_feasible"], null);

  const regression = rank(["a", "b", "c", "d"], ["a", "b", "c"]);
  assert.equal(regression["recall_any@3"], 1);
  assert.equal(regression["recall_all@3"], 0);
  assert.equal(regression["evidence_coverage@3"], 0.75);
  assert.equal(regression["budget_feasible@3"], false);
  assert.equal(regression["recall_all@3_feasible"], null);
});

test("feasible two-evidence case exposes feasible full recall", () => {
  const score = rank(["a", "b"], ["x", "a", "b"]);
  assert.equal(score["budget_feasible@3"], true);
  assert.equal(score["recall_all@3"], 1);
  assert.equal(score["recall_all@3_feasible"], 1);
  assert.equal(score["first_relevant_rank@3"], 2);
});

test("duplicate retrieved relevant IDs earn one NDCG gain and one coverage hit", () => {
  const score = rank(["a", "b"], ["a", "a", "b"]);
  const ideal = 1 + 1 / Math.log2(3);
  assert.equal(score["evidence_coverage@3"], 1);
  assert.equal(score["ndcg@3"], (1 + 1 / Math.log2(4)) / ideal);
  assert.equal(rank(["a"], ["a", "a", "a"])["ndcg@3"], 1);
});

test("first relevant rank aggregate includes rank 1, rank 2, rank 3, and MISS", () => {
  const aggregate = aggregateQ1EvidenceRankingAt3([
    rank(["a"], ["a"]),
    rank(["a"], ["x", "a"]),
    rank(["a"], ["x", "y", "a"]),
    rank(["a"], ["x", "y", "z"]),
  ]);
  assert.deepEqual(aggregate["first_relevant_rank@3"], {
    rank_1: 1,
    rank_2: 1,
    rank_3: 1,
    miss: 1,
  });
  assert.deepEqual(aggregate.first_relevant_rank_distribution, aggregate["first_relevant_rank@3"]);
});

test("cross-session subset is based on distinct gold evidence count", () => {
  const aggregate = aggregateQ1EvidenceRankingAt3([
    rank(["a", "a"], ["a"]),
    rank(["a", "b"], ["a", "x", "b"]),
    rank(["a", "b", "c"], ["x", "a", "b"]),
  ]);
  assert.equal(aggregate.cross_session_case_count, 2);
  assert.equal(aggregate["cross_session_evidence_coverage@3"], (1 + 2 / 3) / 2);
});

test("empty or invalid gold is unscoreable and excluded from macro denominators", () => {
  const empty = rank([], ["a"]);
  const invalid = rank([""], ["a"]);
  assert.equal(empty.scoreable, false);
  assert.equal(invalid.scoreable, false);
  const aggregate = aggregateQ1EvidenceRankingAt3([empty, invalid]);
  assert.equal(aggregate.scoreable_case_count, 0);
  assert.equal(aggregate.unknown_or_unscoreable_case_count, 2);
  assert.equal(aggregate["recall_any@3"], null);
  assert.equal(aggregate["ndcg@3"], null);
});

test("ranking aggregate zero denominators return null rather than zero", () => {
  const empty = aggregateQ1EvidenceRankingAt3([]);
  assert.equal(empty.scoreable_case_count, 0);
  assert.equal(empty["recall_any@3"], null);
  assert.equal(empty["recall_all@3_feasible"], null);
  assert.equal(empty["cross_session_evidence_coverage@3"], null);
});

test("trigger TP TN FP FN formulas use expected and actual booleans", () => {
  const aggregate = aggregateQ1TriggerDecision([
    scoreQ1TriggerDecision({ expected_should_recall: true, actual_should_recall: true }),
    scoreQ1TriggerDecision({ expected_should_recall: false, actual_should_recall: false }),
    scoreQ1TriggerDecision({ expected_should_recall: false, actual_should_recall: true }),
    scoreQ1TriggerDecision({ expected_should_recall: true, actual_should_recall: false }),
  ]);
  assert.deepEqual(
    [aggregate.TP, aggregate.TN, aggregate.FP, aggregate.FN],
    [1, 1, 1, 1],
  );
  assert.equal(aggregate.trigger_recall, 0.5);
  assert.equal(aggregate.unnecessary_recall_rate, 0.5);
  assert.equal(aggregate.trigger_precision, 0.5);
  assert.equal(aggregate.labeled_positive_count, 2);
  assert.equal(aggregate.labeled_negative_count, 2);
});

test("unknown trigger actual is reported and excluded from TN/FN", () => {
  const unknown = scoreQ1TriggerDecision({ expected_should_recall: true, actual_should_recall: null });
  const aggregate = aggregateQ1TriggerDecision([
    unknown,
    scoreQ1TriggerDecision({ expected_should_recall: false, actual_should_recall: null }),
    scoreQ1TriggerDecision({ expected_should_recall: false, actual_should_recall: false }),
  ]);
  assert.equal(aggregate.unknown_decision_count, 2);
  assert.equal(aggregate.TP, 0);
  assert.equal(aggregate.FN, 0);
  assert.equal(aggregate.TN, 1);
  assert.equal(aggregate.trigger_recall, null);
  assert.equal(aggregate.unnecessary_recall_rate, 0);
});

test("top3 safety requires explicit labels and counts stale/conflict union once", () => {
  const report = scoreQ1Top3Safety({
    candidates: [
      { id: "a", stale: true, stale_authority: "canonical-supersession", conflict: true, conflict_authority: "gold" },
      { id: "b", stale: false, conflict: false },
    ],
  });
  assert.equal(report.served_top3_count, 2);
  assert.equal(report.top3_fill_rate, 2 / 3);
  assert.equal(report.stale_top3_slot_rate, 0.5);
  assert.equal(report.conflict_top3_slot_rate, 0.5);
  assert.equal(report.stale_or_conflict_top3_slot_rate, 0.5);
  assert.equal(report.safety_evidence_status, "MEASURED");
});

test("top3 safety is insufficient when a label or true-label authority is missing", () => {
  const missingLabel = scoreQ1Top3Safety([{ id: "a", stale: false }]);
  assert.equal(missingLabel.safety_evidence_status, "INSUFFICIENT_EVIDENCE");
  assert.equal(missingLabel.stale_top3_slot_rate, null);
  const missingAuthority = scoreQ1Top3Safety([{ id: "a", stale: true, conflict: false }]);
  assert.equal(missingAuthority.safety_evidence_status, "INSUFFICIENT_EVIDENCE");
  assert.equal(missingAuthority.conflict_top3_slot_rate, null);
});

test("empty top3 reports no safety evidence but has zero fill", () => {
  const report = scoreQ1Top3Safety([]);
  assert.equal(report.served_top3_count, 0);
  assert.equal(report.top3_fill_rate, 0);
  assert.equal(report.stale_top3_slot_rate, null);
  assert.equal(report.conflict_top3_slot_rate, null);
  assert.equal(report.stale_or_conflict_top3_slot_rate, null);
});

test("latency uses nearest-rank p50 and p95 and retains completion/error counts", () => {
  const report = summarizeQ1LatencyWindow({
    started_trace_count: 10,
    completed_latency_samples: [40, 10, 30, 20],
    incomplete_trace_count: 2,
    error_or_timeout_count: 1,
  });
  assert.equal(report.latency_sample_count, 4);
  assert.equal(report.recall_latency_p50_ms, 20);
  assert.equal(report.recall_latency_p95_ms, 40);
  assert.equal(report.incomplete_trace_count, 2);
  assert.equal(report.incomplete_trace_rate, 0.2);
  assert.equal(report.error_or_timeout_count, 1);
  assert.equal(report.error_or_timeout_rate, 0.1);
});

test("latency with no valid samples returns null percentiles, not zero", () => {
  const report = summarizeQ1LatencyWindow({
    started_trace_count: 2,
    completed_latency_samples: [-1, "bad"],
    incomplete_trace_count: 1,
    error_or_timeout_count: 0,
  });
  assert.equal(report.latency_sample_count, 0);
  assert.equal(report.recall_latency_p50_ms, null);
  assert.equal(report.recall_latency_p95_ms, null);
  assert.equal(report.invalid_latency_sample_count, 2);
});

test("latency with missing completed samples remains incomplete and has null percentiles", () => {
  const report = summarizeQ1LatencyWindow({
    started_trace_count: 1,
    incomplete_trace_count: 1,
    error_or_timeout_count: 0,
  });
  assert.equal(report.latency_sample_count, 0);
  assert.equal(report.recall_latency_p50_ms, null);
  assert.equal(report.recall_latency_p95_ms, null);
  assert.equal(report.latency_evidence_status, "INCOMPLETE_EVIDENCE");
});

test("item-level context pollution uses a union numerator", () => {
  const report = aggregateQ1InjectionReview([
    { irrelevant: true, severe_context_conflict: false, stale_or_superseded_inappropriate: false },
    { irrelevant: false, severe_context_conflict: true, stale_or_superseded_inappropriate: true },
    { irrelevant: false, severe_context_conflict: false, stale_or_superseded_inappropriate: false },
  ]);
  assert.equal(report.reviewed_injection_count, 3);
  assert.equal(report.irrelevant_injection_rate, 1 / 3);
  assert.equal(report.context_pollution_unique_count, 2);
  assert.equal(report.context_pollution_rate, 2 / 3);
});

test("aggregate-only pollution cannot fabricate an exact union", () => {
  const report = aggregateQ1InjectionReview({
    reviewed_injection_count: 10,
    irrelevant_count: 2,
    severe_context_conflict_count: 3,
    stale_or_superseded_inappropriate_count: 4,
  });
  assert.equal(report.irrelevant_injection_rate, 0.2);
  assert.equal(report.context_pollution_rate, "NOT_MEASURABLE");
  assert.equal(report.context_pollution_unique_count, null);
  assert.equal(report.aggregate_overlap_reconstructed, false);
});

test("answer evidence coverage remains unavailable with current authority", () => {
  assert.equal(getQ1AnswerEvidenceCoverageStatus(), Q1_ANSWER_EVIDENCE_COVERAGE_STATUS);
  const report = scoreQ1AnswerEvidenceCoverage();
  assert.equal(report.answer_evidence_coverage, "NOT_MEASURABLE_WITH_CURRENT_AUTHORITY");
  assert.equal(report.status, "NOT_MEASURABLE_WITH_CURRENT_AUTHORITY");
});

test("mixed provenance validation fails closed and ranking aggregate refuses pooling", () => {
  const rows = [
    rank(["a"], ["a"], { provenance: "PRODUCTION_OBSERVED", source: "live" }),
    rank(["a"], ["a"], { provenance: "BENCHMARK_DERIVED", source: "LongMemEval" }),
  ];
  const validation = validateQ1MetricProvenance(rows);
  assert.equal(validation.valid, false);
  assert.equal(validation.compatible, false);
  const aggregate = aggregateQ1EvidenceRankingAt3(rows);
  assert.equal(aggregate.aggregation_refused, true);
  assert.equal(aggregate.aggregation_status, "REFUSED_INCOMPATIBLE_PROVENANCE");
  assert.equal(aggregate["recall_any@3"], null);
  assert.equal(aggregate.by_provenance_source.length, 2);
});

test("source and dataset identity remain explicit even for one attributable group", () => {
  const aggregate = aggregateQ1EvidenceRankingAt3([
    rank(["a"], ["a"], {
      provenance: "BENCHMARK_DERIVED",
      source_identity: { dataset: "LongMemEval", dataset_sha256: "sha-long" },
      dataset_identity: { name: "LongMemEval-S", sha256: "sha-long" },
    }),
  ]);
  assert.equal(aggregate.provenance, "BENCHMARK_DERIVED");
  assert.deepEqual(aggregate.source_identity, { dataset: "LongMemEval", dataset_sha256: "sha-long" });
  assert.deepEqual(aggregate.dataset_identity, { name: "LongMemEval-S", sha256: "sha-long" });
  assert.equal(aggregate.attribution_complete, true);
  assert.equal(aggregate.valid, true);
});

test("Q1 ranking matches LongMemEval recall and ordinary NDCG formulas", () => {
  const fixtures = [
    ["any hit", ["s1"], ["s1", "x", "y"], true],
    ["all hit", ["s1", "s2"], ["s1", "s2", "x"], true],
    ["partial hit", ["s1", "s2"], ["s1", "x", "y"], false],
    ["no hit", ["s1", "s2"], ["x", "y", "z"], true],
  ];
  for (const [, evidence, retrieved, ndcgCompatible] of fixtures) {
    const record = normalizeLongMemEvalCase(longFixture(evidence));
    const existing = scoreLongMemEvalSessionMetrics(record, retrieved, { ks: [3] });
    const q1 = scoreQ1EvidenceRankingAt3({
      gold_evidence_ids: record.evidence_session_ids,
      ranked_retrieved_ids: retrieved,
    });
    assert.equal(q1["recall_any@3"], existing.metrics["recall_any@3"]);
    assert.equal(q1["recall_all@3"], existing.metrics["recall_all@3"]);
    if (ndcgCompatible) assert.equal(q1["ndcg@3"], existing.metrics["ndcg_any@3"]);
    else assert.notEqual(q1["ndcg@3"], existing.metrics["ndcg_any@3"]);
  }
});

test("Q1 ranking matches LoCoMo session recall and ordinary NDCG formulas", () => {
  const item = normalizeLocomoCase(locomoFixture(["D1:1", "D2:1"]), {
    evidencePolicy: LOCOMO_EVIDENCE_STRICT_V1,
  });
  const evidence = item.questions[0].evidence_session_ids;
  const fixtures = [
    ["any hit", ["x", "session_2", "y"]],
    ["all hit", ["session_1", "session_2", "x"]],
    ["partial hit", ["session_1", "x", "y"]],
    ["no hit", ["x", "y", "z"]],
  ];
  for (const [, retrieved] of fixtures) {
    const existing = scoreLocomoSessionMetrics(item, retrieved, { ks: [3] });
    const q1 = scoreQ1EvidenceRankingAt3({
      gold_evidence_ids: evidence,
      ranked_retrieved_ids: retrieved,
    });
    assert.equal(q1["recall_any@3"], existing.metrics["recall_any@3"]);
    assert.equal(q1["recall_all@3"], existing.metrics["recall_all@3"]);
    assert.equal(q1["ndcg@3"], existing.metrics["ndcg_any@3"]);
  }
});

test("item review scorer preserves explicit labels without runtime telemetry changes", () => {
  const item = scoreQ1InjectionReviewItem({
    irrelevant: true,
    severe_context_conflict: false,
    stale_or_superseded_inappropriate: false,
  });
  assert.equal(item.labels_complete, true);
  assert.equal(item.context_pollution, true);
  assert.equal(item.metric_family, "injection_quality");
});
