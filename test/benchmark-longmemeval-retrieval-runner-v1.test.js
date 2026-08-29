import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";

import {
  LONGMEMEVAL_RETRIEVAL_PROFILE,
  aggregateLongMemEvalRetrievalResults,
  buildOfficialLongMemEvalSessionDocument,
  createBenchmarkHybridRuntime,
  materializeLongMemEvalCaseDatabases,
  runLongMemEvalRetrievalCase,
  runLongMemEvalRetrievalDataset,
} from "../lib/benchmark/longmemeval-retrieval-runner-v1.js";
import { normalizeLongMemEvalCase } from "../lib/benchmark/longmemeval-v1.js";

function fixture(overrides = {}) {
  return {
    question_id: "bench_q1",
    question_type: "single_hop",
    question: "Where is the kyotofact location?",
    answer: "Kyoto",
    question_date: "2025/01/10 (Fri) 12:00",
    haystack_session_ids: ["s-old", "s-answer", "s-noise"],
    haystack_dates: [
      "2024/12/20 (Fri) 12:00",
      "2025/01/09 (Thu) 09:00",
      "2025/01/09 (Thu) 10:00",
    ],
    haystack_sessions: [
      [
        { role: "user", content: "This is unrelated osakafact context." },
        { role: "assistant", content: "Noted." },
      ],
      [
        { role: "user", content: "The kyotofact location is Kyoto.", has_answer: true },
        { role: "assistant", content: "I will remember the location." },
      ],
      [
        { role: "user", content: "Completely unrelated sapporofact context." },
        { role: "assistant", content: "Okay." },
      ],
    ],
    answer_session_ids: ["s-answer"],
    ...overrides,
  };
}

test("official session document uses only user turns and carries no gold labels", () => {
  const text = buildOfficialLongMemEvalSessionDocument({
    turns: [
      { role: "user", content: "user fact", has_answer: true },
      { role: "assistant", content: "assistant secret", has_answer: true },
      { role: "user", content: "second user fact", has_answer: false },
    ],
  });
  assert.equal(text, "user fact second user fact");
  assert.equal(text.includes("assistant secret"), false);
  assert.equal(text.includes("has_answer"), false);
});

test("benchmark hybrid runtime keeps neutral confidence by default and accepts B6 binding", () => {
  const materialized = materializeLongMemEvalCaseDatabases(
    normalizeLongMemEvalCase(fixture()),
    { benchmarkNowSec: 1_800_000_000 },
  );
  const adapters = [];
  try {
    const defaultAdapter = createBenchmarkHybridRuntime(materialized, { topK: 3 });
    adapters.push(defaultAdapter);
    assert.equal(defaultAdapter.runtime.cfg.confidence.min, 0);

    const productionAdapter = createBenchmarkHybridRuntime(materialized, {
      topK: 3,
      minConfidence: 0.15,
    });
    adapters.push(productionAdapter);
    assert.equal(productionAdapter.runtime.cfg.confidence.min, 0.15);
  } finally {
    for (const adapter of adapters.reverse()) adapter.close();
    rmSync(materialized.root, { recursive: true, force: true });
  }
});

test("isolated lexical profile runs production hybridSearch and retrieves the evidence session", async () => {
  const result = await runLongMemEvalRetrievalCase(fixture(), {
    topK: 3,
    benchmarkNowSec: 1_800_000_000,
  });

  assert.equal(result.profile, LONGMEMEVAL_RETRIEVAL_PROFILE);
  assert.equal(result.skipped, false);
  assert.equal(result.retrieved_session_ids[0], "s-answer");
  assert.equal(result.metrics["recall_any@1"], 1);
  assert.equal(result.metrics["recall_all@1"], 1);
  assert.equal(result.metrics["ndcg_any@1"], 1);
  assert.equal(result.metrics["recall_any@5"], null);
  assert.equal(result.diagnostic_metrics.reciprocal_rank, 1);
  assert.deepEqual(result.diagnostics.channels, ["fts"]);
  assert.equal(result.diagnostics.vector_skipped, true);
  assert.equal(result.diagnostics.vector_skip_reason, "lexical_confidence_threshold_met");
  assert.equal(result.diagnostics.canonical_result_projection.dropped_count, 0);
  assert.equal(result.diagnostics.canonical_result_projection.resolved_count >= 1, true);
});

test("assistant-only evidence is skipped by the official retrieval aggregate policy", async () => {
  const record = fixture({
    question_id: "bench_assistant_only",
    question_type: "assistant_previnfo",
    question: "What was the assistantonlyneedle?",
    haystack_sessions: [
      [
        { role: "user", content: "Please tell me something." },
        { role: "assistant", content: "assistantonlyneedle is violet.", has_answer: true },
      ],
      [
        { role: "user", content: "Noise context." },
        { role: "assistant", content: "Other answer." },
      ],
      [
        { role: "user", content: "More noise." },
        { role: "assistant", content: "Other response." },
      ],
    ],
    answer_session_ids: ["s-old"],
  });

  const result = await runLongMemEvalRetrievalCase(record, {
    topK: 3,
    benchmarkNowSec: 1_800_000_000,
  });
  assert.equal(result.skipped, true);
  assert.equal(result.skip_reason, "official_retrieval_no_user_target");
  assert.equal(result.metrics, null);
  assert.equal(result.diagnostics, null);
});

test("duplicate source session ids remain distinct corpus occurrences", async () => {
  const result = await runLongMemEvalRetrievalCase(fixture({
    haystack_session_ids: ["s-noise", "s-answer", "s-noise"],
  }), {
    topK: 3,
    benchmarkNowSec: 1_800_000_000,
  });
  assert.equal(result.skipped, false);
  assert.equal(result.corpus_sessions, 3);
  assert.equal(result.retrieved_session_ids[0], "s-answer");
});

test("official retrieval abstention cases are skipped without scoring", async () => {
  const result = await runLongMemEvalRetrievalCase(fixture({
    question_id: "bench_q_abs",
    answer_session_ids: [],
  }));
  assert.equal(result.skipped, true);
  assert.equal(result.skip_reason, "official_retrieval_abstention");
  assert.equal(result.metrics, null);
  assert.deepEqual(result.retrieved_session_ids, []);
});

test("aggregate metrics exclude official skipped cases and expose skip reasons", () => {
  const summary = aggregateLongMemEvalRetrievalResults([
    {
      question_type: "single-session-user",
      skipped: false,
      metrics: {
        "recall_any@1": 1,
        "recall_all@1": 1,
        "ndcg_any@1": 1,
      },
      latency_ms: 10,
      corpus_sessions: 3,
    },
    {
      question_type: "single-session-user",
      skipped: true,
      skip_reason: "official_retrieval_abstention",
      metrics: null,
      latency_ms: 0,
      corpus_sessions: 3,
    },
    {
      question_type: "single-session-assistant",
      skipped: true,
      skip_reason: "official_retrieval_no_user_target",
      metrics: null,
      latency_ms: 0,
      corpus_sessions: 3,
    },
  ]);
  assert.equal(summary.cases, 3);
  assert.equal(summary.scored_cases, 1);
  assert.equal(summary.skipped_cases, 2);
  assert.deepEqual(summary.skipped_by_reason, {
    official_retrieval_abstention: 1,
    official_retrieval_no_user_target: 1,
  });
  assert.equal(summary.metrics["recall_any@1"], 1);
  assert.equal(summary.by_question_type["single-session-user"].cases, 1);
});

test("dataset runner applies a bounded limit and returns a stable summary", async () => {
  const output = await runLongMemEvalRetrievalDataset([
    fixture(),
    fixture({ question_id: "bench_q2", question: "Where is osakafact context?", answer_session_ids: ["s-old"] }),
  ], {
    limit: 1,
    topK: 3,
    benchmarkNowSec: 1_800_000_000,
  });

  assert.equal(output.results.length, 1);
  assert.equal(output.summary.cases, 1);
  assert.equal(output.summary.scored_cases, 1);
  assert.equal(output.summary.profile, LONGMEMEVAL_RETRIEVAL_PROFILE);
  assert.equal(output.run.top_k, 3);
  assert.equal(output.run.requested_limit, 1);
});
