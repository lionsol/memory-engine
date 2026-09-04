import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Q0_CASE_PROVENANCE,
  Q0_EVALUATION_SCOPES,
  Q0_FAILURE_EVALUATION_SCHEMA,
  Q0_FAILURE_CLASSES,
  Q0_STAGE_STATES,
  Q0_STAGES,
  adjudicateQ0FailureEvaluationCase,
  aggregateQ0FailureEvaluationResults,
  validateQ0FailureEvaluationCase,
} from '../lib/benchmark/q0-failure-evaluation-v1.js';

const stage = (state, evidenceComplete = null) => ({
  state,
  evidence_complete: evidenceComplete,
});

const scopeMode = Object.freeze({
  END_TO_END_OBSERVED: {
    write: 'NOT_EVALUATED',
    trigger: 'NOT_EVALUATED',
    candidate: 'NOT_EVALUATED',
    rank: 'NOT_EVALUATED',
    disclosure: 'NOT_EVALUATED',
    answer_use: 'NOT_EVALUATED',
  },
  TRIGGER_ONLY: {
    write: 'OUT_OF_SCOPE',
    trigger: 'NOT_EVALUATED',
    candidate: 'OUT_OF_SCOPE',
    rank: 'OUT_OF_SCOPE',
    disclosure: 'OUT_OF_SCOPE',
    answer_use: 'OUT_OF_SCOPE',
  },
  RETRIEVAL_FROM_MATERIALIZED_MEMORY: {
    write: 'BYPASSED_BY_FIXTURE',
    trigger: 'OUT_OF_SCOPE',
    candidate: 'NOT_EVALUATED',
    rank: 'NOT_EVALUATED',
    disclosure: 'OUT_OF_SCOPE',
    answer_use: 'OUT_OF_SCOPE',
  },
  DISCLOSURE_ONLY: {
    write: 'OUT_OF_SCOPE',
    trigger: 'OUT_OF_SCOPE',
    candidate: 'OUT_OF_SCOPE',
    rank: 'OUT_OF_SCOPE',
    disclosure: 'NOT_EVALUATED',
    answer_use: 'OUT_OF_SCOPE',
  },
  ANSWER_USE_ONLY: {
    write: 'OUT_OF_SCOPE',
    trigger: 'OUT_OF_SCOPE',
    candidate: 'OUT_OF_SCOPE',
    rank: 'OUT_OF_SCOPE',
    disclosure: 'OUT_OF_SCOPE',
    answer_use: 'NOT_EVALUATED',
  },
});

const makeCase = ({
  case_id = 'q0-test-case',
  provenance = 'PRODUCTION_OBSERVED',
  evaluation_scope = 'END_TO_END_OBSERVED',
  effective_top_k = 3,
  stages = {},
} = {}) => ({
  schema: Q0_FAILURE_EVALUATION_SCHEMA,
  case_id,
  provenance,
  evaluation_scope,
  source_ref: 'opaque-source-ref',
  case_ref: 'opaque-case-ref',
  stages: Object.fromEntries(
    Q0_STAGES.map((name) => [
      name,
      stages[name] ?? stage(scopeMode[evaluation_scope][name]),
    ]),
  ),
  ...(effective_top_k === undefined ? {} : { effective_top_k }),
});

const passAll = (evaluation_scope = 'END_TO_END_OBSERVED') => (
  Object.fromEntries(
    Q0_STAGES.map((name) => {
      const defaultState = scopeMode[evaluation_scope][name];
      return [
        name,
        defaultState === 'NOT_EVALUATED'
          ? stage('PASS', true)
          : stage(defaultState),
      ];
    }),
  )
);

test('exports frozen Q0-E1 vocabulary and ordered stages', () => {
  assert.deepEqual(Q0_CASE_PROVENANCE, [
    'PRODUCTION_OBSERVED',
    'PRODUCTION_REPLAY',
    'BENCHMARK_DERIVED',
    'TARGETED_SYNTHETIC',
  ]);
  assert.deepEqual(Q0_EVALUATION_SCOPES, [
    'END_TO_END_OBSERVED',
    'TRIGGER_ONLY',
    'RETRIEVAL_FROM_MATERIALIZED_MEMORY',
    'DISCLOSURE_ONLY',
    'ANSWER_USE_ONLY',
  ]);
  assert.deepEqual(Q0_STAGES, [
    'write',
    'trigger',
    'candidate',
    'rank',
    'disclosure',
    'answer_use',
  ]);
  assert.deepEqual(Q0_STAGE_STATES, [
    'PASS',
    'FAIL',
    'UNKNOWN',
    'NOT_EVALUATED',
    'OUT_OF_SCOPE',
    'BYPASSED_BY_FIXTURE',
  ]);
  assert.ok(Object.isFrozen(Q0_CASE_PROVENANCE));
  assert.ok(Object.isFrozen(Q0_EVALUATION_SCOPES));
});

test('complete END_TO_END write failure is an END_TO_END WRITE_MISS', () => {
  const result = adjudicateQ0FailureEvaluationCase(makeCase({
    stages: { write: stage('FAIL', true) },
  }));

  assert.equal(result.adjudication_status, 'CLASSIFIED');
  assert.equal(result.failure_class, 'WRITE_MISS');
  assert.equal(result.first_loss_stage, 'write');
  assert.equal(result.loss_authority, 'END_TO_END');
  assert.equal(result.use_loss_stage, null);
});

test('complete TRIGGER_ONLY failure is a scoped TRIGGER_MISS', () => {
  const result = adjudicateQ0FailureEvaluationCase(makeCase({
    evaluation_scope: 'TRIGGER_ONLY',
    effective_top_k: undefined,
    stages: { trigger: stage('FAIL', true) },
  }));

  assert.equal(result.adjudication_status, 'CLASSIFIED');
  assert.equal(result.failure_class, 'TRIGGER_MISS');
  assert.equal(result.loss_authority, 'SCOPED');
});

test('materialized-memory fixture candidate failure is scoped and not end-to-end', () => {
  const result = adjudicateQ0FailureEvaluationCase(makeCase({
    evaluation_scope: 'RETRIEVAL_FROM_MATERIALIZED_MEMORY',
    stages: { candidate: stage('FAIL', true) },
  }));

  assert.equal(result.adjudication_status, 'CLASSIFIED');
  assert.equal(result.failure_class, 'CANDIDATE_MISS');
  assert.equal(result.loss_authority, 'SCOPED');
  assert.equal(result.first_loss_stage, 'candidate');
});

test('retrieval candidate PASS followed by topK=3 rank failure is a scoped RANK_MISS', () => {
  const result = adjudicateQ0FailureEvaluationCase(makeCase({
    evaluation_scope: 'RETRIEVAL_FROM_MATERIALIZED_MEMORY',
    effective_top_k: 3,
    stages: {
      candidate: stage('PASS', true),
      rank: stage('FAIL', true),
    },
  }));

  assert.equal(result.adjudication_status, 'CLASSIFIED');
  assert.equal(result.failure_class, 'RANK_MISS');
  assert.equal(result.first_loss_stage, 'rank');
  assert.equal(result.loss_authority, 'SCOPED');
});

test('rank failure at a non-Q0 topK remains unclassified', () => {
  const result = adjudicateQ0FailureEvaluationCase(makeCase({
    effective_top_k: 50,
    stages: {
      write: stage('PASS', true),
      trigger: stage('PASS', true),
      candidate: stage('PASS', true),
      rank: stage('FAIL', true),
    },
  }));

  assert.equal(result.adjudication_status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(result.failure_class, null);
  assert.equal(result.loss_authority, null);
  assert.equal(result.diagnostic_reason, 'Q0_RANK_REQUIRES_EFFECTIVE_TOP_K_3');
});

test('disclosure failure maps to USE_MISS with DISCLOSURE stage', () => {
  const result = adjudicateQ0FailureEvaluationCase(makeCase({
    stages: {
      write: stage('PASS', true),
      trigger: stage('PASS', true),
      candidate: stage('PASS', true),
      rank: stage('PASS', true),
      disclosure: stage('FAIL', true),
    },
  }));

  assert.equal(result.adjudication_status, 'CLASSIFIED');
  assert.equal(result.failure_class, 'USE_MISS');
  assert.equal(result.use_loss_stage, 'DISCLOSURE');
  assert.equal(result.loss_authority, 'END_TO_END');
});

test('answer-use failure maps to USE_MISS with ANSWER_USE stage', () => {
  const result = adjudicateQ0FailureEvaluationCase(makeCase({
    stages: {
      write: stage('PASS', true),
      trigger: stage('PASS', true),
      candidate: stage('PASS', true),
      rank: stage('PASS', true),
      disclosure: stage('PASS', true),
      answer_use: stage('FAIL', true),
    },
  }));

  assert.equal(result.adjudication_status, 'CLASSIFIED');
  assert.equal(result.failure_class, 'USE_MISS');
  assert.equal(result.use_loss_stage, 'ANSWER_USE');
  assert.equal(result.loss_authority, 'END_TO_END');
});

test('an unresolved earlier stage blocks a later failure', () => {
  const result = adjudicateQ0FailureEvaluationCase(makeCase({
    stages: {
      write: stage('PASS', true),
      trigger: stage('UNKNOWN', null),
      candidate: stage('FAIL', true),
    },
  }));

  assert.equal(result.adjudication_status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(result.failure_class, null);
  assert.equal(result.loss_authority, null);
  assert.equal(result.blocked_by_stage, 'trigger');
  assert.equal(result.diagnostic_reason, 'EARLIER_STAGE_UNRESOLVED');
});

test('a FAIL with incomplete evidence cannot be classified', () => {
  const result = adjudicateQ0FailureEvaluationCase(makeCase({
    stages: {
      write: stage('PASS', true),
      trigger: stage('PASS', true),
      candidate: stage('FAIL', false),
    },
  }));

  assert.equal(result.adjudication_status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(result.failure_class, null);
  assert.equal(result.blocked_by_stage, 'candidate');
  assert.equal(result.diagnostic_reason, 'FAIL_EVIDENCE_INCOMPLETE');
});

test('BYPASSED_BY_FIXTURE cannot be used in an END_TO_END case', () => {
  const input = makeCase({
    stages: { write: stage('BYPASSED_BY_FIXTURE', null) },
  });
  const result = adjudicateQ0FailureEvaluationCase(input);

  assert.equal(result.adjudication_status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(result.valid, false);
  assert.equal(result.loss_authority, null);
  assert.ok(result.validation_errors.includes('STAGE_SCOPE_MISMATCH:write'));
});

test('all complete in-scope stages passing produces NO_LOSS', () => {
  const result = adjudicateQ0FailureEvaluationCase(makeCase({
    stages: passAll(),
  }));

  assert.equal(result.adjudication_status, 'NO_LOSS');
  assert.equal(result.failure_class, null);
  assert.equal(result.loss_authority, null);
  assert.equal(result.validation_errors.length, 0);
});

test('disclosure-only and answer-use-only scopes classify only their own stage', () => {
  const disclosureResult = adjudicateQ0FailureEvaluationCase(makeCase({
    evaluation_scope: 'DISCLOSURE_ONLY',
    effective_top_k: undefined,
    stages: { disclosure: stage('FAIL', true) },
  }));
  const answerUseResult = adjudicateQ0FailureEvaluationCase(makeCase({
    evaluation_scope: 'ANSWER_USE_ONLY',
    effective_top_k: undefined,
    stages: { answer_use: stage('FAIL', true) },
  }));

  assert.deepEqual(
    [disclosureResult.failure_class, disclosureResult.use_loss_stage, disclosureResult.loss_authority],
    ['USE_MISS', 'DISCLOSURE', 'SCOPED'],
  );
  assert.deepEqual(
    [answerUseResult.failure_class, answerUseResult.use_loss_stage, answerUseResult.loss_authority],
    ['USE_MISS', 'ANSWER_USE', 'SCOPED'],
  );
});

test('aggregate counts keep provenance and evaluation scope separate', () => {
  const cases = [
    makeCase({
      case_id: 'production-e2e-write',
      provenance: 'PRODUCTION_OBSERVED',
      stages: { write: stage('FAIL', true) },
    }),
    makeCase({
      case_id: 'replay-e2e-trigger',
      provenance: 'PRODUCTION_REPLAY',
      stages: {
        write: stage('PASS', true),
        trigger: stage('FAIL', true),
      },
    }),
    makeCase({
      case_id: 'benchmark-retrieval-candidate',
      provenance: 'BENCHMARK_DERIVED',
      evaluation_scope: 'RETRIEVAL_FROM_MATERIALIZED_MEMORY',
      stages: { candidate: stage('FAIL', true) },
    }),
    makeCase({
      case_id: 'synthetic-disclosure',
      provenance: 'TARGETED_SYNTHETIC',
      evaluation_scope: 'DISCLOSURE_ONLY',
      effective_top_k: undefined,
      stages: { disclosure: stage('FAIL', true) },
    }),
  ];
  const aggregate = aggregateQ0FailureEvaluationResults(cases);

  assert.equal(aggregate.valid, true);
  assert.equal(aggregate.total_cases, 4);
  assert.equal(aggregate.counts.provenance.PRODUCTION_OBSERVED, 1);
  assert.equal(aggregate.counts.provenance.PRODUCTION_REPLAY, 1);
  assert.equal(aggregate.counts.provenance.BENCHMARK_DERIVED, 1);
  assert.equal(aggregate.counts.provenance.TARGETED_SYNTHETIC, 1);
  assert.equal(aggregate.counts.evaluation_scope.END_TO_END_OBSERVED, 2);
  assert.equal(aggregate.counts.evaluation_scope.RETRIEVAL_FROM_MATERIALIZED_MEMORY, 1);
  assert.equal(aggregate.counts.evaluation_scope.DISCLOSURE_ONLY, 1);
  assert.equal(aggregate.counts.adjudication_status.CLASSIFIED, 4);
  assert.equal(aggregate.counts.failure_class.WRITE_MISS, 1);
  assert.equal(aggregate.counts.failure_class.TRIGGER_MISS, 1);
  assert.equal(aggregate.counts.failure_class.CANDIDATE_MISS, 1);
  assert.equal(aggregate.counts.failure_class.USE_MISS, 1);
});

test('production end-to-end distribution excludes replay, benchmark, and synthetic cases', () => {
  const aggregate = aggregateQ0FailureEvaluationResults([
    makeCase({
      case_id: 'production-write',
      provenance: 'PRODUCTION_OBSERVED',
      stages: { write: stage('FAIL', true) },
    }),
    makeCase({
      case_id: 'replay-trigger',
      provenance: 'PRODUCTION_REPLAY',
      stages: {
        write: stage('PASS', true),
        trigger: stage('FAIL', true),
      },
    }),
    makeCase({
      case_id: 'benchmark-write',
      provenance: 'BENCHMARK_DERIVED',
      stages: { write: stage('FAIL', true) },
    }),
    makeCase({
      case_id: 'synthetic-write',
      provenance: 'TARGETED_SYNTHETIC',
      stages: { write: stage('FAIL', true) },
    }),
  ]);

  assert.equal(
    aggregate.production_observed_end_to_end_first_loss_distribution.WRITE_MISS,
    1,
  );
  assert.equal(
    Object.values(aggregate.production_observed_end_to_end_first_loss_distribution)
      .reduce((total, count) => total + count, 0),
    1,
  );
});

test('invalid schema, enum, case id, stages, and topK fail closed', () => {
  const invalidCases = [
    [
      { schema: 'wrong' },
      'INVALID_SCHEMA',
    ],
    [
      { case_id: '' },
      'INVALID_CASE_ID',
    ],
    [
      { provenance: 'UNKNOWN_SOURCE' },
      'INVALID_PROVENANCE',
    ],
    [
      { evaluation_scope: 'UNKNOWN_SCOPE' },
      'INVALID_EVALUATION_SCOPE',
    ],
    [
      { stages: null },
      'INVALID_STAGES',
    ],
    [
      { effective_top_k: 50.5 },
      'INVALID_EFFECTIVE_TOP_K',
    ],
  ];

  for (const [overrides, expectedError] of invalidCases) {
    const input = { ...makeCase(), ...overrides };
    const validation = validateQ0FailureEvaluationCase(input);
    const result = adjudicateQ0FailureEvaluationCase(input);

    assert.equal(validation.valid, false, expectedError);
    assert.ok(validation.errors.includes(expectedError), expectedError);
    assert.equal(result.adjudication_status, 'INSUFFICIENT_EVIDENCE', expectedError);
    assert.equal(result.failure_class, null, expectedError);
    assert.equal(result.loss_authority, null, expectedError);
  }
});

test('candidate absence is not inferred from an unresolved candidate stage', () => {
  const result = adjudicateQ0FailureEvaluationCase(makeCase({
    evaluation_scope: 'RETRIEVAL_FROM_MATERIALIZED_MEMORY',
    stages: {
      candidate: stage('UNKNOWN', null),
      rank: stage('FAIL', true),
    },
  }));

  assert.equal(result.adjudication_status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(result.failure_class, null);
  assert.equal(result.loss_authority, null);
});

test('aggregation marks unclassified outcomes without a mixed failure-rate field', () => {
  const aggregate = aggregateQ0FailureEvaluationResults([
    makeCase({
      effective_top_k: 50,
      stages: {
        write: stage('PASS', true),
        trigger: stage('PASS', true),
        candidate: stage('PASS', true),
        rank: stage('FAIL', true),
      },
    }),
  ]);

  assert.equal(aggregate.counts.adjudication_status.INSUFFICIENT_EVIDENCE, 1);
  assert.equal(aggregate.counts.failure_class.UNCLASSIFIED, 1);
  assert.equal('production_failure_rate' in aggregate, false);
  assert.deepEqual(
    Object.keys(aggregate.production_observed_end_to_end_first_loss_distribution),
    Q0_FAILURE_CLASSES,
  );
});
