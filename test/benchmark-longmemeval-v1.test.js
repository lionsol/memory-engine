import assert from "node:assert/strict";
import test from "node:test";

import {
  LONGMEMEVAL_V1_SCHEMA,
  buildLongMemEvalAddRequests,
  buildLongMemEvalSearchRequest,
  normalizeLongMemEvalCase,
  scoreLongMemEvalSessionMetrics,
  scoreLongMemEvalSessionRetrieval,
  summarizeLongMemEvalDataset,
} from "../lib/benchmark/longmemeval-v1.js";

function fixture(overrides = {}) {
  return {
    question_id: "q1",
    question_type: "multi-session",
    question: "Where did Alice move?",
    answer: "Kyoto",
    question_date: "2025/01/10 (Fri) 00:00",
    haystack_session_ids: ["s1", "s2"],
    haystack_dates: ["2025/01/01 (Wed) 00:00", "2025/01/05 (Sun) 00:00"],
    haystack_sessions: [
      [
        { role: "user", content: "Alice used to live in Osaka." },
        { role: "assistant", content: "Got it." },
      ],
      [
        { role: "user", content: "Alice moved to Kyoto.", has_answer: true },
        { role: "assistant", content: "I will remember that." },
      ],
    ],
    answer_session_ids: ["s2"],
    ...overrides,
  };
}

test("normalizes a LongMemEval case without exposing answer labels in search", () => {
  const item = normalizeLongMemEvalCase(fixture());
  assert.equal(item.schema, LONGMEMEVAL_V1_SCHEMA);
  assert.equal(item.question_type, "multi-session");
  assert.equal(item.expected_answer, "Kyoto");
  assert.deepEqual(item.evidence_session_ids, ["s2"]);
  assert.equal(item.sessions[1].turns[0].has_answer, true);

  const search = buildLongMemEvalSearchRequest(item, { topK: 7 });
  assert.deepEqual(search, {
    request_id: "benchmark:v1:q1:search",
    user_id: "benchmark:v1:q1",
    query: "Where did Alice move?",
    top_k: 7,
    question_date: "2025/01/10 (Fri) 00:00",
  });
  assert.equal("expected_answer" in search, false);
  assert.equal("evidence_session_ids" in search, false);
});

test("accepts official empty turn content without weakening role validation", () => {
  const item = normalizeLongMemEvalCase(fixture({
    haystack_sessions: [
      [
        { role: "user", content: "" },
        { role: "assistant", content: "Got it." },
      ],
      fixture().haystack_sessions[1],
    ],
  }));
  assert.equal(item.sessions[0].turns[0].content, "");
  assert.throws(
    () => normalizeLongMemEvalCase(fixture({
      haystack_sessions: [
        [{ role: "user", content: null }],
        fixture().haystack_sessions[1],
      ],
    })),
    /content_must_be_string/,
  );
});

test("builds stable per-session Add envelopes", () => {
  const requests = buildLongMemEvalAddRequests(fixture());
  assert.equal(requests.length, 2);
  assert.equal(requests[0].user_id, "benchmark:v1:q1");
  assert.equal(requests[1].session_id, "s2");
  assert.equal(requests[1].messages[0].source_id, "q1:s2:0");
  assert.equal("evidence_label" in requests[1].messages[0], false);
  assert.equal("has_answer" in requests[1].messages[0], false);
  assert.equal(requests[1].messages[0].content, "Alice moved to Kyoto.");
  assert.equal(requests[1].timestamp_ms, Date.UTC(2025, 0, 5, 0, 0));
});

test("scores session recall, precision and reciprocal rank", () => {
  const score = scoreLongMemEvalSessionRetrieval(fixture(), ["s1", "s2", "s9"]);
  assert.equal(score.session_recall, 1);
  assert.equal(score.session_precision, 1 / 3);
  assert.equal(score.any_evidence_hit, true);
  assert.equal(score.all_evidence_found, true);
  assert.equal(score.reciprocal_rank, 1 / 2);
  assert.deepEqual(score.hit_session_ids, ["s2"]);
});

test("computes LongMemEval-style session metrics at standard k", () => {
  const score = scoreLongMemEvalSessionMetrics(fixture(), ["s1", "s9", "s2"], { ks: [1, 3] });
  assert.deepEqual(score.metrics, {
    "recall_any@1": 0,
    "recall_all@1": 0,
    "ndcg_any@1": 0,
    "recall_any@3": 1,
    "recall_all@3": 1,
    "ndcg_any@3": 1 / Math.log2(3),
  });
});

test("LongMemEval metrics preserve duplicate corpus occurrences in ranking depth", () => {
  const score = scoreLongMemEvalSessionMetrics(fixture(), ["s1", "s1", "s2"], { ks: [2, 3] });
  assert.equal(score.metrics["recall_any@2"], 0);
  assert.equal(score.metrics["recall_all@2"], 0);
  assert.equal(score.metrics["ndcg_any@2"], 0);
  assert.equal(score.metrics["recall_any@3"], 1);
  assert.equal(score.metrics["recall_all@3"], 1);
  assert.equal(score.metrics["ndcg_any@3"], 1 / Math.log2(3));
});

test("normalizes upstream task aliases", () => {
  const item = normalizeLongMemEvalCase(fixture({ question_type: "knowledge_update" }));
  assert.equal(item.question_type, "knowledge-update");
});

test("rejects malformed evidence references", () => {
  assert.throws(
    () => normalizeLongMemEvalCase(fixture({ answer_session_ids: ["missing"] })),
    /answer_session_not_in_haystack:missing/,
  );
});

test("summarizes dataset composition", () => {
  const summary = summarizeLongMemEvalDataset([
    fixture(),
    fixture({ question_id: "q2_abs", question_type: "single_hop", answer_session_ids: [] }),
  ]);
  assert.equal(summary.cases, 2);
  assert.equal(summary.sessions, 4);
  assert.equal(summary.turns, 8);
  assert.equal(summary.evidence_sessions, 1);
  assert.equal(summary.abstention_cases, 1);
  assert.equal(summary.retrieval_no_user_target_cases, 0);
  assert.equal(summary.retrieval_scored_cases, 1);
  assert.deepEqual(summary.by_question_type, {
    "multi-session": 1,
    "single-session-user": 1,
  });
});
