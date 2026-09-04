import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  aggregateQ1EvidenceRankingAt3,
  scoreQ1EvidenceRankingAt3,
  summarizeQ1LatencyWindow,
} from "../lib/benchmark/q1-product-metric-contract-v1.js";
import {
  LONGMEMEVAL_DATASET_SHA256,
  LONGMEMEVAL_Q1_BENCHMARK_NOW_SEC,
  LONGMEMEVAL_Q1_TOP_K,
  LOCOMO_Q1_DATASET_SHA256,
  LOCOMO_Q1_BENCHMARK_NOW_SEC,
  LOCOMO_Q1_TOP_K,
  LOCOMO_Q1_DATASET_NAME,
  Q1_CURRENT_BASELINE_SCHEMA,
  Q1_CURRENT_BASELINE_VERSION,
  Q1_CURRENT_BASELINE_EXPECTED,
  assertQ1CurrentBaselineEnvelope,
  buildQ1CurrentBaselineEnvelope,
  runQ1CurrentOfflineBaseline,
  scoreQ1LocomoStrictSessionCase,
  scoreQ1LongMemEvalCase,
  validateQ1CurrentBaselineEnvelope,
  validateQ1CurrentBaselineSourceIdentity,
} from "../lib/benchmark/q1-current-baseline-v1.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(repoRoot, "test/fixtures/q1-current-baseline-v1.json");
const baseline = JSON.parse(readFileSync(fixturePath, "utf8"));

function longCase({
  questionId = "q1-long-case",
  questionType = "single_hop",
  evidence = ["s-answer"],
  answerText = "answer",
} = {}) {
  return {
    question_id: questionId,
    question_type: questionType,
    question: "Where is the answer?",
    answer: answerText,
    question_date: "2025/01/10 (Fri) 12:00",
    haystack_session_ids: ["s-noise", "s-answer", "s-other"],
    haystack_dates: [
      "2024/12/20 (Fri) 12:00",
      "2025/01/09 (Thu) 09:00",
      "2025/01/09 (Thu) 10:00",
    ],
    haystack_sessions: [
      [
        { role: "user", content: "unrelated context" },
        { role: "assistant", content: "not the answer" },
      ],
      [
        { role: "user", content: "the answer-bearing context", has_answer: true },
        { role: "assistant", content: "noted" },
      ],
      [
        { role: "user", content: "other context" },
        { role: "assistant", content: "okay" },
      ],
    ],
    answer_session_ids: evidence,
  };
}

function locomoCase({ evidence = ["D1:1"], category = 4 } = {}) {
  return {
    sample_id: "q1-locomo-case",
    conversation: {
      speaker_a: "Alice",
      speaker_b: "Bob",
      session_1_date_time: "1:00 pm on 1 May, 2023",
      session_1: [
        { speaker: "Alice", dia_id: "D1:1", text: "Alice visited Kyoto." },
        { speaker: "Bob", dia_id: "D1:2", text: "They discussed Osaka." },
      ],
      session_2_date_time: "2:00 pm on 2 May, 2023",
      session_2: [
        { speaker: "Alice", dia_id: "D2:1", text: "Alice returned later." },
      ],
    },
    qa: [{ question: "Where did Alice visit?", answer: "Kyoto", evidence, category }],
  };
}

function q1Metadata(source = "synthetic-q1") {
  return {
    provenance: "BENCHMARK_DERIVED",
    source_identity: {
      dataset: source,
      dataset_sha256: "a".repeat(64),
      retrieval_profile: "synthetic_profile",
      top_k: 3,
      benchmark_now_sec: 1,
    },
    dataset_identity: source,
  };
}

test("LongMemEval binding uses official session gold and ranked retrieved sessions", () => {
  const bound = scoreQ1LongMemEvalCase(
    longCase(),
    { retrieved_session_ids: ["s-noise", "s-answer"] },
  );
  assert.deepEqual(bound.q1.gold_evidence_ids, ["s-answer"]);
  assert.deepEqual(bound.q1.ranked_retrieved_ids, ["s-noise", "s-answer"]);
  assert.equal(bound.q1["recall_any@3"], bound.legacy.metrics["recall_any@3"]);
  assert.equal(bound.q1["recall_all@3"], bound.legacy.metrics["recall_all@3"]);
});

test("official LongMemEval skips become unknown cases rather than zero misses", () => {
  const scored = scoreQ1LongMemEvalCase(longCase(), {
    retrieved_session_ids: ["s-answer"],
  }).q1;
  const skipped = scoreQ1LongMemEvalCase(longCase({
    questionId: "q1-long-abs",
    evidence: [],
  }), { retrieved_session_ids: [] }).q1;
  const aggregate = aggregateQ1EvidenceRankingAt3([scored, skipped]);
  assert.equal(skipped.scoreable, false);
  assert.equal(skipped.metrics["recall_any@3"], null);
  assert.equal(aggregate.scoreable_case_count, 1);
  assert.equal(aggregate.unknown_or_unscoreable_case_count, 1);
  assert.equal(aggregate["recall_any@3"], 1);
});

test("LongMemEval Q1 recall is compatible with the legacy recall formulas", () => {
  const bound = scoreQ1LongMemEvalCase(longCase({
    evidence: ["s-answer", "s-other"],
  }), { retrieved_session_ids: ["s-answer", "s-noise"] });
  assert.equal(bound.q1["recall_any@3"], bound.legacy.metrics["recall_any@3"]);
  assert.equal(bound.q1["recall_all@3"], bound.legacy.metrics["recall_all@3"]);
});

test("LongMemEval legacy NDCG remains a separate metric-definition comparison", () => {
  const bound = scoreQ1LongMemEvalCase(
    longCase({ evidence: ["s-answer", "s-other"] }),
    { retrieved_session_ids: ["s-noise", "s-answer", "s-other"] },
  );
  assert.notEqual(bound.q1["ndcg@3"], bound.legacy.metrics["ndcg_any@3"]);
  assert.equal(baseline.tracks.longmemeval_lexical_session.legacy_compatibility.ndcg_definition_compatible, false);
  assert.equal(
    baseline.tracks.longmemeval_lexical_session.legacy_compatibility.ndcg_definition,
    "standard_binary_dcg_log2_rank_plus_1",
  );
});

test("Q1 budget-feasible and infeasible counts remain distinct in aggregation", () => {
  const infeasible = scoreQ1EvidenceRankingAt3({
    ...q1Metadata("budget-fixture"),
    gold_evidence_ids: ["a", "b", "c", "d"],
    ranked_retrieved_ids: ["a", "b", "c"],
  });
  const feasible = scoreQ1EvidenceRankingAt3({
    ...q1Metadata("budget-fixture"),
    gold_evidence_ids: ["a", "b"],
    ranked_retrieved_ids: ["a", "b", "noise"],
  });
  const aggregate = aggregateQ1EvidenceRankingAt3([infeasible, feasible]);
  assert.equal(infeasible["recall_any@3"], 1);
  assert.equal(infeasible["recall_all@3"], 0);
  assert.equal(infeasible["evidence_coverage@3"], 0.75);
  assert.equal(infeasible["budget_feasible@3"], false);
  assert.equal(infeasible["recall_all@3_feasible"], null);
  assert.equal(feasible["budget_feasible@3"], true);
  assert.equal(feasible["recall_all@3_feasible"], 1);
  assert.equal(aggregate.budget_feasible_case_count, 1);
  assert.equal(aggregate.budget_infeasible_case_count, 1);
});

test("LongMemEval question-type breakdown remains separately attributable", () => {
  const track = baseline.tracks.longmemeval_lexical_session;
  const values = Object.values(track.by_question_type);
  assert.ok(values.length > 1);
  assert.equal(
    values.reduce((sum, item) => sum + item.q1.scoreable_case_count + item.q1.unknown_or_unscoreable_case_count, 0),
    track.denominator.source_case_count,
  );
  for (const item of values) {
    assert.equal(item.q1.aggregation_refused, false);
    assert.equal(item.provenance, undefined);
  }
  assert.equal(track.source_identity.dataset, "LongMemEval-S");
});

test("LoCoMo Q1 binding uses strict session evidence, not dialog evidence", () => {
  const bound = scoreQ1LocomoStrictSessionCase(locomoCase(), ["session_1"]);
  assert.deepEqual(bound.question.evidence_session_ids, ["session_1"]);
  assert.deepEqual(bound.q1.gold_evidence_ids, ["session_1"]);
  assert.equal(bound.q1["recall_any@3"], 1);
  assert.equal(bound.q1["recall_all@3"], bound.legacy.metrics["recall_all@3"]);
});

test("LoCoMo Q1 binding preserves the time-frozen profile, clock, and pinned dataset", () => {
  const identity = baseline.tracks.locomo_lexical_strict_session.source_identity;
  assert.equal(identity.dataset, LOCOMO_Q1_DATASET_NAME);
  assert.equal(identity.dataset_sha256, LOCOMO_Q1_DATASET_SHA256);
  assert.equal(identity.retrieval_profile, "production_hybrid_lexical_dialog_locomo_time_frozen_v2");
  assert.equal(identity.top_k, LOCOMO_Q1_TOP_K);
  assert.equal(identity.benchmark_now_sec, LOCOMO_Q1_BENCHMARK_NOW_SEC);
  assert.equal(identity.q1_metric_level, "session");
  assert.equal(identity.evidence_policy, "locomo_evidence_strict_v1");
});

test("LoCoMo Q1 recall and NDCG agree with the strict session scorer", () => {
  const bound = scoreQ1LocomoStrictSessionCase(
    locomoCase({ evidence: ["D1:1"] }),
    ["session_2", "session_1"],
  );
  for (const [q1Key, legacyKey] of [
    ["recall_any@3", "recall_any@3"],
    ["recall_all@3", "recall_all@3"],
    ["ndcg@3", "ndcg_any@3"],
  ]) {
    assert.equal(bound.q1[q1Key], bound.legacy.metrics[legacyKey], q1Key);
  }
  const compatibility = baseline.tracks.locomo_lexical_strict_session.compatibility;
  assert.equal(compatibility.recall_any_mismatch_count, 0);
  assert.equal(compatibility.recall_all_mismatch_count, 0);
  assert.equal(compatibility.ndcg_mismatch_count, 0);
});

test("LoCoMo category breakdown is bounded and separately attributable", () => {
  const track = baseline.tracks.locomo_lexical_strict_session;
  assert.deepEqual(Object.keys(track.by_category), ["1", "2", "3", "4", "5"]);
  assert.equal(
    Object.values(track.by_category).reduce(
      (sum, item) => sum + item.q1.scoreable_case_count + item.q1.unknown_or_unscoreable_case_count,
      0,
    ),
    track.denominator.qa_count,
  );
  assert.equal(track.denominator.strict_metric_case_count, 1972);
  assert.equal(track.denominator.retrieval_latency_attempt_count, 1978);
});

test("full frozen v2b5 trigger matrix is bound through the Q1 trigger metrics", () => {
  const track = baseline.tracks.trigger_v2b5;
  assert.deepEqual(track.runtime_candidate_confusion_matrix, {
    TP: 3,
    TN: 17,
    FP: 7,
    FN: 21,
    UNKNOWN: 0,
  });
  assert.equal(track.q1.labeled_turn_count, 48);
  assert.equal(track.q1.TP, 3);
  assert.equal(track.q1.TN, 17);
  assert.equal(track.q1.FP, 7);
  assert.equal(track.q1.FN, 21);
  assert.equal(track.q1.unknown_decision_count, 0);
});

test("Q1 trigger rates use the required denominators", () => {
  const q1 = baseline.tracks.trigger_v2b5.q1;
  assert.equal(q1.trigger_recall, 3 / 24);
  assert.equal(q1.unnecessary_recall_rate, 7 / 24);
  assert.equal(q1.trigger_precision, 3 / 10);
  assert.equal(q1.labeled_positive_count, 24);
  assert.equal(q1.labeled_negative_count, 24);
});

test("mixed LongMemEval and LoCoMo ranking aggregates are refused", () => {
  const left = scoreQ1EvidenceRankingAt3({
    ...q1Metadata("LongMemEval-S"),
    gold_evidence_ids: ["a"],
    ranked_retrieved_ids: ["a"],
  });
  const right = scoreQ1EvidenceRankingAt3({
    ...q1Metadata("LoCoMo"),
    gold_evidence_ids: ["a"],
    ranked_retrieved_ids: ["a"],
  });
  const aggregate = aggregateQ1EvidenceRankingAt3([left, right]);
  assert.equal(aggregate.aggregation_refused, true);
  assert.equal(aggregate.aggregation_status, "REFUSED_INCOMPATIBLE_PROVENANCE");
  assert.equal(aggregate["recall_any@3"], null);
});

test("trigger decisions are not pooled into evidence-ranking metrics", () => {
  const ranking = scoreQ1EvidenceRankingAt3({
    ...q1Metadata("ranking-source"),
    gold_evidence_ids: ["a"],
    ranked_retrieved_ids: ["a"],
  });
  const triggerLike = {
    schema: "memory_engine_q1_product_metric_contract_v1",
    metric_family: "trigger_decision",
    expected_should_recall: true,
    actual_should_recall: true,
    classification: "TP",
    provenance: "TARGETED_SYNTHETIC",
    source_identity: { fixture: "trigger-source" },
  };
  const aggregate = aggregateQ1EvidenceRankingAt3([ranking, triggerLike]);
  assert.equal(aggregate.aggregation_refused, true);
  assert.equal(aggregate["recall_any@3"], null);
});

test("production safety, injection quality, and production latency remain unavailable", () => {
  assert.equal(
    baseline.unavailable.production_top3_safety.status,
    "NOT_EVALUATED_CURRENT_AUTHORITY",
  );
  assert.equal(
    baseline.unavailable.production_injection_quality.status,
    "NOT_EVALUATED_CURRENT_AUTHORITY",
  );
  assert.equal(
    baseline.unavailable.production_recall_latency.status,
    "NOT_EVALUATED_CURRENT_AUTHORITY",
  );
  assert.equal(baseline.interpretation.production_prevalence_claim, false);
  assert.equal(baseline.interpretation.cross_source_pooling, false);
});

test("answer evidence coverage remains unavailable under the current authority", () => {
  assert.equal(
    baseline.unavailable.answer_evidence_coverage.status,
    "NOT_MEASURABLE_WITH_CURRENT_AUTHORITY",
  );
});

test("offline benchmark latency is labeled separately from production latency", () => {
  const longLatency = baseline.tracks.longmemeval_lexical_session.latency;
  const locomoLatency = baseline.tracks.locomo_lexical_strict_session.latency;
  assert.equal(baseline.tracks.longmemeval_lexical_session.provenance, "BENCHMARK_DERIVED");
  assert.equal(baseline.tracks.locomo_lexical_strict_session.provenance, "BENCHMARK_DERIVED");
  assert.equal(longLatency.latency_sample_count, 419);
  assert.equal(longLatency.started_trace_count, 419);
  assert.equal(locomoLatency.latency_sample_count, 1978);
  assert.equal(locomoLatency.started_trace_count, 1978);
  assert.equal(longLatency.incomplete_trace_count, 0);
  assert.equal(locomoLatency.error_or_timeout_count, 0);
  assert.equal(baseline.unavailable.production_recall_latency.status, "NOT_EVALUATED_CURRENT_AUTHORITY");
});

test("Q1 latency uses nearest-rank p50 and p95 and retains completion counts", () => {
  const summary = summarizeQ1LatencyWindow({
    ...q1Metadata("latency-fixture"),
    started_trace_count: 5,
    completed_latency_samples: [50, 10, 30, 20, 100],
    incomplete_trace_count: 0,
    error_or_timeout_count: 0,
  });
  assert.equal(summary.latency_sample_count, 5);
  assert.equal(summary.recall_latency_p50_ms, 30);
  assert.equal(summary.recall_latency_p95_ms, 100);
  assert.equal(summary.incomplete_trace_count, 0);
  assert.equal(summary.error_or_timeout_count, 0);
});

test("missing latency samples remain null instead of becoming zero", () => {
  const summary = summarizeQ1LatencyWindow({
    ...q1Metadata("missing-latency-fixture"),
    started_trace_count: 2,
    completed_latency_samples: [],
    incomplete_trace_count: 1,
    error_or_timeout_count: 1,
  });
  assert.equal(summary.recall_latency_p50_ms, null);
  assert.equal(summary.recall_latency_p95_ms, null);
  assert.equal(summary.incomplete_trace_count, 1);
  assert.equal(summary.incomplete_trace_rate, 0.5);
  assert.equal(summary.error_or_timeout_count, 1);
  assert.equal(summary.error_or_timeout_rate, 0.5);
});

test("the committed baseline fixture contains no raw benchmark payload", () => {
  const validation = validateQ1CurrentBaselineEnvelope(baseline);
  assert.equal(validation.valid, true, validation.errors.join(","));
  const serialized = JSON.stringify(baseline);
  for (const key of [
    "question_id",
    "retrieved_session_ids",
    "retrieved_dialog_ids",
    "retrieved_ids",
    "prompt",
    "conversation",
    "answer",
    "embedding",
    "tool_results",
  ]) {
    assert.equal(serialized.includes(`"${key}"`), false, key);
  }
  assert.equal(serialized.includes("Where did Alice"), false);
  assert.equal(serialized.includes("session_1"), false);
});

test("malformed source identity fails closed", () => {
  const invalid = validateQ1CurrentBaselineSourceIdentity({
    dataset: "LongMemEval-S",
    dataset_sha256: "wrong",
  }, ["dataset", "dataset_sha256", "retrieval_profile"]);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.includes("missing:retrieval_profile"));
  assert.ok(invalid.errors.includes("dataset_sha256_invalid"));
});

test("input dataset identity mismatch fails before retrieval starts", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-q1-baseline-mismatch-"));
  const wrong = join(root, "wrong.json");
  writeFileSync(wrong, JSON.stringify({ not: "the pinned dataset" }));
  try {
    await assert.rejects(
      () => runQ1CurrentOfflineBaseline({ longmemevalPath: wrong }),
      /q1_baseline_longmemeval_sha256_mismatch/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the bounded fixture is exactly reproduced by the envelope builder", () => {
  const regenerated = buildQ1CurrentBaselineEnvelope({
    longmemeval: baseline.tracks.longmemeval_lexical_session,
    locomo: baseline.tracks.locomo_lexical_strict_session,
    trigger: baseline.tracks.trigger_v2b5,
  });
  assert.deepEqual(regenerated, baseline);
  assert.equal(baseline.schema, Q1_CURRENT_BASELINE_SCHEMA);
  assert.equal(baseline.baseline_version, Q1_CURRENT_BASELINE_VERSION);
  assert.equal(baseline.q1_metric_contract_schema, "memory_engine_q1_product_metric_contract_v1");
  assert.deepEqual(Q1_CURRENT_BASELINE_EXPECTED.trigger, { TP: 3, TN: 17, FP: 7, FN: 21, UNKNOWN: 0 });
});

test("pinned source constants remain explicit and bounded", () => {
  assert.equal(LONGMEMEVAL_DATASET_SHA256.length, 64);
  assert.equal(LOCOMO_Q1_DATASET_SHA256.length, 64);
  assert.equal(LONGMEMEVAL_Q1_TOP_K, 3);
  assert.equal(LOCOMO_Q1_TOP_K, 3);
  assert.equal(LONGMEMEVAL_Q1_BENCHMARK_NOW_SEC, 1_800_000_000);
  assert.equal(LOCOMO_Q1_BENCHMARK_NOW_SEC, 1_705_066_861);
});

test("baseline envelope assertion rejects a newly introduced pooled field", () => {
  const invalid = JSON.parse(JSON.stringify(baseline));
  invalid.overall_recall = 0.5;
  const validation = validateQ1CurrentBaselineEnvelope(invalid);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(error => error.includes("cross_source_pooling_key")));
  assert.throws(() => assertQ1CurrentBaselineEnvelope(invalid), /q1_baseline_envelope_invalid/);
});
