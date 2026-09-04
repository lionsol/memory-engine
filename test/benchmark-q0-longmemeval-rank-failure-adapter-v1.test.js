import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeLongMemEvalCase,
} from '../lib/benchmark/longmemeval-v1.js';
import {
  Q0_LONGMEMEVAL_RETRIEVAL_DEPTHS,
  adaptQ0LongMemEvalRankFailureCase,
  adaptQ0LongMemEvalRankFailureDataset,
  evaluateQ0LongMemEvalRankEvidence,
} from '../lib/benchmark/q0-longmemeval-rank-failure-adapter-v1.js';

const BENCHMARK_NOW_SEC = 1_800_000_000;

function makeRecord({
  question_id = 'q0e2b-test',
  question_type = 'single_hop',
  question = 'alphaevidence',
  answer = 'answer text that must not be emitted',
  sessionIds = ['noise', 'gold'],
  sessionTexts = ['unrelated context', 'alphaevidence'],
  answerSessionIds = ['gold'],
  turnsBySession = null,
} = {}) {
  const haystack_sessions = turnsBySession || sessionTexts.map((content, index) => [
    {
      role: 'user',
      content,
      has_answer: answerSessionIds.includes(sessionIds[index]),
    },
    {
      role: 'assistant',
      content: 'acknowledged',
    },
  ]);
  const haystack_dates = sessionIds.map((_, index) => (
    '2025/01/0' + String(index + 1) + ' (Thu) 12:00'
  ));

  return {
    question_id,
    question_type,
    question,
    answer,
    question_date: '2025/01/10 (Fri) 12:00',
    haystack_session_ids: sessionIds,
    haystack_dates,
    haystack_sessions,
    answer_session_ids: answerSessionIds,
  };
}

function rankFailureRecord() {
  const sessions = [
    ['gold-a', 'rankneedle rankneedle rankneedle rankneedle'],
    ['noise-1', 'rankneedle rankneedle rankneedle'],
    ['noise-2', 'rankneedle rankneedle rankneedle'],
    ['noise-3', 'rankneedle rankneedle rankneedle'],
    ['gold-b', 'rankneedle'],
  ];
  return makeRecord({
    question_id: 'q0e2b_rank_failure',
    question: 'rankneedle',
    sessionIds: sessions.map(([id]) => id),
    sessionTexts: sessions.map(([, text]) => text),
    answerSessionIds: ['gold-a', 'gold-b'],
  });
}

test('gold entirely in top3 produces scoped retrieval NO_LOSS', async () => {
  const result = await adaptQ0LongMemEvalRankFailureCase(makeRecord({
    question_id: 'q0e2b_gold_top3',
    question: 'alphaevidence',
  }), { benchmarkNowSec: BENCHMARK_NOW_SEC });

  assert.equal(result.valid, true);
  assert.equal(result.skipped, false);
  assert.equal(result.diagnostics.top3_prefix_consistent, true);
  assert.equal(result.diagnostics.all_gold_in_top3, true);
  assert.equal(result.diagnostics.all_gold_in_top50, true);
  assert.equal(result.q0_case.provenance, 'BENCHMARK_DERIVED');
  assert.equal(result.q0_case.evaluation_scope, 'RETRIEVAL_FROM_MATERIALIZED_MEMORY');
  assert.equal(result.q0_case.effective_top_k, 3);
  assert.equal(result.q0_case.stages.candidate.state, 'PASS');
  assert.equal(result.q0_case.stages.rank.state, 'PASS');
  assert.equal(result.q0_adjudication.adjudication_status, 'NO_LOSS');
  assert.equal(result.q0_adjudication.failure_class, null);
  assert.equal(result.q0_adjudication.loss_authority, null);
  assert.equal(result.runs.top3.top_k, Q0_LONGMEMEVAL_RETRIEVAL_DEPTHS.production_top_k);
  assert.equal(result.runs.top50.top_k, Q0_LONGMEMEVAL_RETRIEVAL_DEPTHS.breadth_top_k);
  assert.equal(result.runs.top3.benchmark_now_sec, BENCHMARK_NOW_SEC);
  assert.equal(result.runs.top50.benchmark_now_sec, BENCHMARK_NOW_SEC);
  assert.equal('retrieved_session_ids' in result.runs.top3, false);
});

test('gold entirely in top50 but not top3 produces scoped RANK_MISS', async () => {
  const result = await adaptQ0LongMemEvalRankFailureCase(
    rankFailureRecord(),
    { benchmarkNowSec: BENCHMARK_NOW_SEC },
  );

  assert.equal(result.valid, true);
  assert.equal(result.skipped, false);
  assert.equal(result.diagnostics.top3_prefix_consistent, true);
  assert.equal(result.diagnostics.all_gold_in_top50, true);
  assert.equal(result.diagnostics.all_gold_in_top3, false);
  assert.equal(result.q0_case.stages.candidate.state, 'PASS');
  assert.equal(result.q0_case.stages.candidate.evidence_complete, true);
  assert.equal(result.q0_case.stages.rank.state, 'FAIL');
  assert.equal(result.q0_case.stages.rank.evidence_complete, true);
  assert.equal(result.q0_adjudication.adjudication_status, 'CLASSIFIED');
  assert.equal(result.q0_adjudication.failure_class, 'RANK_MISS');
  assert.equal(result.q0_adjudication.loss_authority, 'SCOPED');
});

test('multi-session evidence uses Recall-all rather than any-hit ranking', async () => {
  const result = await adaptQ0LongMemEvalRankFailureCase(
    rankFailureRecord(),
    { benchmarkNowSec: BENCHMARK_NOW_SEC },
  );

  assert.equal(result.diagnostics.evidence_count, 2);
  assert.equal(result.diagnostics.all_gold_in_top3, false);
  assert.equal(result.diagnostics.all_gold_in_top50, true);
  assert.equal(result.q0_adjudication.failure_class, 'RANK_MISS');
});

test('gold absent from top50 remains candidate UNKNOWN and never CANDIDATE_MISS', async () => {
  const result = await adaptQ0LongMemEvalRankFailureCase(makeRecord({
    question_id: 'q0e2b_gold_absent',
    question: 'visibleneedle',
    sessionIds: ['gold-hidden', 'noise'],
    sessionTexts: ['unrelated historical evidence', 'visibleneedle appears here'],
    answerSessionIds: ['gold-hidden'],
  }), { benchmarkNowSec: BENCHMARK_NOW_SEC });

  assert.equal(result.valid, true);
  assert.equal(result.diagnostics.all_gold_in_top50, false);
  assert.equal(result.q0_case.stages.candidate.state, 'UNKNOWN');
  assert.equal(result.q0_case.stages.candidate.evidence_complete, false);
  assert.equal(result.q0_case.stages.rank.state, 'NOT_EVALUATED');
  assert.equal(result.q0_case.stages.rank.evidence_complete, false);
  assert.equal(result.q0_adjudication.adjudication_status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(result.q0_adjudication.failure_class, null);
});

test('top3/top50 prefix mismatch fails closed without guessing composition', () => {
  const item = normalizeLongMemEvalCase(makeRecord({
    question_id: 'q0e2b_prefix_mismatch',
    sessionIds: ['gold', 'noise-a', 'noise-b'],
    sessionTexts: ['alphaevidence', 'alphaevidence', 'alphaevidence'],
    answerSessionIds: ['gold'],
  }));
  const mapped = evaluateQ0LongMemEvalRankEvidence(item, {
    benchmarkNowSec: BENCHMARK_NOW_SEC,
    top3Result: {
      skipped: false,
      retrieved_session_ids: ['gold', 'noise-a', 'noise-b'],
    },
    top50Result: {
      skipped: false,
      retrieved_session_ids: ['gold', 'noise-b', 'noise-a'],
    },
  });

  assert.equal(mapped.diagnostics.top3_prefix_consistent, false);
  assert.equal(mapped.diagnostics.all_gold_in_top50, true);
  assert.equal(mapped.q0_case.stages.candidate.state, 'UNKNOWN');
  assert.equal(mapped.q0_case.stages.rank.state, 'NOT_EVALUATED');
  assert.equal(mapped.q0_adjudication.adjudication_status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(mapped.q0_adjudication.failure_class, null);
  assert.equal(mapped.q0_adjudication.loss_authority, null);
});

test('official abstention is skipped and does not become a Q0 case', async () => {
  const result = await adaptQ0LongMemEvalRankFailureCase(makeRecord({
    question_id: 'q0e2b_abs',
    answerSessionIds: [],
  }), { benchmarkNowSec: BENCHMARK_NOW_SEC });

  assert.equal(result.valid, true);
  assert.equal(result.skipped, true);
  assert.equal(result.skip_reason, 'official_retrieval_abstention');
  assert.equal(result.q0_case, null);
  assert.equal(result.q0_adjudication, null);
  assert.equal(result.runs.top50, null);
});

test('assistant-only evidence is skipped by the official user-target rule', async () => {
  const result = await adaptQ0LongMemEvalRankFailureCase(makeRecord({
    question_id: 'q0e2b_assistant_only',
    question: 'assistantneedle',
    sessionTexts: ['assistantneedle', 'other'],
    answerSessionIds: ['noise'],
    turnsBySession: [
      [
        { role: 'user', content: 'current user request', has_answer: false },
        { role: 'assistant', content: 'assistantneedle', has_answer: true },
      ],
      [
        { role: 'user', content: 'other request', has_answer: false },
        { role: 'assistant', content: 'other response', has_answer: false },
      ],
    ],
  }), { benchmarkNowSec: BENCHMARK_NOW_SEC });

  assert.equal(result.valid, true);
  assert.equal(result.skipped, true);
  assert.equal(result.skip_reason, 'official_retrieval_no_user_target');
  assert.equal(result.q0_case, null);
});

test('dataset keeps rank miss, no loss, insufficient evidence, and skips separate', async () => {
  const report = await adaptQ0LongMemEvalRankFailureDataset([
    makeRecord({ question_id: 'q0e2b_dataset_no_loss' }),
    rankFailureRecord(),
    makeRecord({
      question_id: 'q0e2b_dataset_insufficient',
      question: 'visibleneedle',
      sessionIds: ['gold-hidden', 'noise'],
      sessionTexts: ['unrelated historical evidence', 'visibleneedle appears here'],
      answerSessionIds: ['gold-hidden'],
    }),
    makeRecord({
      question_id: 'q0e2b_dataset_abs',
      answerSessionIds: [],
    }),
  ], { benchmarkNowSec: BENCHMARK_NOW_SEC });

  assert.equal(report.valid, true);
  assert.equal(report.source_case_count, 4);
  assert.equal(report.scored_case_count, 3);
  assert.equal(report.skipped_case_count, 1);
  assert.equal(report.skipped_by_reason.official_retrieval_abstention, 1);
  assert.equal(report.rank_miss_count, 1);
  assert.equal(report.retrieval_no_loss_count, 1);
  assert.equal(report.insufficient_evidence_count, 1);
  assert.equal(report.prefix_inconsistent_count, 0);
  assert.equal(report.q0_cases.length, 3);
  assert.equal(report.q0_adjudications.length, 3);
  assert.equal(report.q0_aggregate.counts.failure_class.RANK_MISS, 1);
  assert.equal(report.q0_aggregate.counts.adjudication_status.NO_LOSS, 1);
  assert.equal(report.q0_aggregate.counts.adjudication_status.INSUFFICIENT_EVIDENCE, 1);
  assert.equal(
    Object.values(report.q0_aggregate.production_observed_end_to_end_first_loss_distribution)
      .every(count => count === 0),
    true,
  );
});

test('all classified adapter failures are benchmark-derived scoped RANK_MISS cases', async () => {
  const report = await adaptQ0LongMemEvalRankFailureDataset([
    rankFailureRecord(),
    rankFailureRecord({}),
  ], { benchmarkNowSec: BENCHMARK_NOW_SEC });
  const classifiedFailures = report.q0_adjudications.filter(
    result => result.adjudication_status === 'CLASSIFIED',
  );

  assert.equal(classifiedFailures.length, 2);
  assert.equal(classifiedFailures.every(result => result.failure_class === 'RANK_MISS'), true);
  assert.equal(classifiedFailures.every(result => result.loss_authority === 'SCOPED'), true);
  assert.equal(report.q0_cases.every(caseItem => (
    caseItem.provenance === 'BENCHMARK_DERIVED'
    && caseItem.evaluation_scope === 'RETRIEVAL_FROM_MATERIALIZED_MEMORY'
    && caseItem.effective_top_k === 3
  )), true);
});

test('invalid LongMemEval source record fails closed', async () => {
  const single = await adaptQ0LongMemEvalRankFailureCase({});
  const dataset = await adaptQ0LongMemEvalRankFailureDataset([{}]);

  assert.equal(single.valid, false);
  assert.deepEqual(single.errors, ['INVALID_SOURCE_CASE']);
  assert.equal(single.q0_case, null);
  assert.equal(dataset.valid, false);
  assert.equal(dataset.q0_cases.length, 0);
  assert.equal(dataset.q0_adjudications.length, 0);
});

test('adapter output contains no question, answer, session, or memory text', async () => {
  const record = makeRecord({
    question_id: 'q0e2b_privacy',
    question: 'q0e2b_unique_question_text',
    answer: 'q0e2b_unique_answer_text',
  });
  const result = await adaptQ0LongMemEvalRankFailureCase(record, {
    benchmarkNowSec: BENCHMARK_NOW_SEC,
  });
  const output = JSON.stringify(result);

  assert.equal(output.includes(record.question), false);
  assert.equal(output.includes(record.answer), false);
  assert.equal(output.includes('retrieved_session_ids'), false);
  assert.equal('question' in result.q0_case, false);
  assert.equal('answer' in result.q0_case, false);
});
