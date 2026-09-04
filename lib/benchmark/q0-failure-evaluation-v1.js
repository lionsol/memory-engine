export const Q0_FAILURE_EVALUATION_SCHEMA = 'memory_engine_q0_failure_evaluation_v1';

export const Q0_CASE_PROVENANCE = Object.freeze([
  'PRODUCTION_OBSERVED',
  'PRODUCTION_REPLAY',
  'BENCHMARK_DERIVED',
  'TARGETED_SYNTHETIC',
]);

export const Q0_EVALUATION_SCOPES = Object.freeze([
  'END_TO_END_OBSERVED',
  'TRIGGER_ONLY',
  'RETRIEVAL_FROM_MATERIALIZED_MEMORY',
  'DISCLOSURE_ONLY',
  'ANSWER_USE_ONLY',
]);

export const Q0_STAGES = Object.freeze([
  'write',
  'trigger',
  'candidate',
  'rank',
  'disclosure',
  'answer_use',
]);

export const Q0_STAGE_STATES = Object.freeze([
  'PASS',
  'FAIL',
  'UNKNOWN',
  'NOT_EVALUATED',
  'OUT_OF_SCOPE',
  'BYPASSED_BY_FIXTURE',
]);

export const Q0_FAILURE_CLASSES = Object.freeze([
  'WRITE_MISS',
  'TRIGGER_MISS',
  'CANDIDATE_MISS',
  'RANK_MISS',
  'USE_MISS',
]);

export const Q0_ADJUDICATION_STATUSES = Object.freeze([
  'CLASSIFIED',
  'NO_LOSS',
  'INSUFFICIENT_EVIDENCE',
]);

export const Q0_LOSS_AUTHORITIES = Object.freeze([
  'END_TO_END',
  'SCOPED',
]);

const Q0_STAGE_MODES = Object.freeze({
  IN_SCOPE: 'IN_SCOPE',
  OUT_OF_SCOPE: 'OUT_OF_SCOPE',
  BYPASSED_BY_FIXTURE: 'BYPASSED_BY_FIXTURE',
});

const Q0_SCOPE_STAGE_MODES = Object.freeze({
  END_TO_END_OBSERVED: Object.freeze({
    write: Q0_STAGE_MODES.IN_SCOPE,
    trigger: Q0_STAGE_MODES.IN_SCOPE,
    candidate: Q0_STAGE_MODES.IN_SCOPE,
    rank: Q0_STAGE_MODES.IN_SCOPE,
    disclosure: Q0_STAGE_MODES.IN_SCOPE,
    answer_use: Q0_STAGE_MODES.IN_SCOPE,
  }),
  TRIGGER_ONLY: Object.freeze({
    write: Q0_STAGE_MODES.OUT_OF_SCOPE,
    trigger: Q0_STAGE_MODES.IN_SCOPE,
    candidate: Q0_STAGE_MODES.OUT_OF_SCOPE,
    rank: Q0_STAGE_MODES.OUT_OF_SCOPE,
    disclosure: Q0_STAGE_MODES.OUT_OF_SCOPE,
    answer_use: Q0_STAGE_MODES.OUT_OF_SCOPE,
  }),
  RETRIEVAL_FROM_MATERIALIZED_MEMORY: Object.freeze({
    write: Q0_STAGE_MODES.BYPASSED_BY_FIXTURE,
    trigger: Q0_STAGE_MODES.OUT_OF_SCOPE,
    candidate: Q0_STAGE_MODES.IN_SCOPE,
    rank: Q0_STAGE_MODES.IN_SCOPE,
    disclosure: Q0_STAGE_MODES.OUT_OF_SCOPE,
    answer_use: Q0_STAGE_MODES.OUT_OF_SCOPE,
  }),
  DISCLOSURE_ONLY: Object.freeze({
    write: Q0_STAGE_MODES.OUT_OF_SCOPE,
    trigger: Q0_STAGE_MODES.OUT_OF_SCOPE,
    candidate: Q0_STAGE_MODES.OUT_OF_SCOPE,
    rank: Q0_STAGE_MODES.OUT_OF_SCOPE,
    disclosure: Q0_STAGE_MODES.IN_SCOPE,
    answer_use: Q0_STAGE_MODES.OUT_OF_SCOPE,
  }),
  ANSWER_USE_ONLY: Object.freeze({
    write: Q0_STAGE_MODES.OUT_OF_SCOPE,
    trigger: Q0_STAGE_MODES.OUT_OF_SCOPE,
    candidate: Q0_STAGE_MODES.OUT_OF_SCOPE,
    rank: Q0_STAGE_MODES.OUT_OF_SCOPE,
    disclosure: Q0_STAGE_MODES.OUT_OF_SCOPE,
    answer_use: Q0_STAGE_MODES.IN_SCOPE,
  }),
});

const FAILURE_CLASS_BY_STAGE = Object.freeze({
  write: 'WRITE_MISS',
  trigger: 'TRIGGER_MISS',
  candidate: 'CANDIDATE_MISS',
  rank: 'RANK_MISS',
  disclosure: 'USE_MISS',
  answer_use: 'USE_MISS',
});

const USE_LOSS_STAGE_BY_STAGE = Object.freeze({
  disclosure: 'DISCLOSURE',
  answer_use: 'ANSWER_USE',
});

const INVALID_OR_MISSING = 'INVALID_OR_MISSING';
const UNCLASSIFIED = 'UNCLASSIFIED';

const isRecord = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
);

const isEnumValue = (value, values) => (
  typeof value === 'string' && values.includes(value)
);

const isBoundedString = (value, maxLength = 256) => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= maxLength
  && !/[\u0000-\u001f\u007f]/u.test(value)
);

const isCompleteBoolean = (value) => value === true || value === false || value === null;

const isValidTopK = (value) => (
  typeof value === 'number'
  && Number.isFinite(value)
  && Number.isInteger(value)
  && value >= 1
);

const sortedUnique = (values) => [...new Set(values)].sort();

const expectedStageMode = (scope, stage) => Q0_SCOPE_STAGE_MODES[scope]?.[stage] ?? null;

const stageStateMatchesScope = (state, mode) => {
  if (mode === Q0_STAGE_MODES.IN_SCOPE) {
    return state !== 'OUT_OF_SCOPE' && state !== 'BYPASSED_BY_FIXTURE';
  }
  if (mode === Q0_STAGE_MODES.OUT_OF_SCOPE) {
    return state === 'OUT_OF_SCOPE';
  }
  return state === 'BYPASSED_BY_FIXTURE';
};

const createValidationError = (code) => code;

const safeCaseId = (input) => (
  isBoundedString(input?.case_id, 128) ? input.case_id : null
);

/**
 * Validate a case without inspecting or returning its raw evidence payload.
 *
 * The validator intentionally accepts only opaque bounded references in place
 * of query, transcript, memory text, and tool-result content.
 */
export function validateQ0FailureEvaluationCase(input) {
  const errors = [];

  if (!isRecord(input)) {
    return {
      valid: false,
      errors: [createValidationError('INVALID_CASE_OBJECT')],
    };
  }

  if (input.schema !== Q0_FAILURE_EVALUATION_SCHEMA) {
    errors.push(createValidationError('INVALID_SCHEMA'));
  }

  if (!isBoundedString(input.case_id, 128)) {
    errors.push(createValidationError('INVALID_CASE_ID'));
  }

  if (!isEnumValue(input.provenance, Q0_CASE_PROVENANCE)) {
    errors.push(createValidationError('INVALID_PROVENANCE'));
  }

  if (!isEnumValue(input.evaluation_scope, Q0_EVALUATION_SCOPES)) {
    errors.push(createValidationError('INVALID_EVALUATION_SCOPE'));
  }

  for (const refField of ['source_ref', 'case_ref', 'turn_ref']) {
    if (input[refField] !== undefined && input[refField] !== null && !isBoundedString(input[refField])) {
      errors.push(createValidationError('INVALID_' + refField.toUpperCase()));
    }
  }

  const allowedTopLevelFields = new Set([
    'schema',
    'case_id',
    'provenance',
    'evaluation_scope',
    'source_ref',
    'case_ref',
    'turn_ref',
    'effective_top_k',
    'stages',
  ]);
  for (const field of Object.keys(input)) {
    if (!allowedTopLevelFields.has(field)) {
      errors.push(createValidationError('INVALID_SCHEMA'));
      break;
    }
  }

  if (!isRecord(input.stages)) {
    errors.push(createValidationError('INVALID_STAGES'));
  } else {
    const stageKeys = Object.keys(input.stages);
    if (stageKeys.some((stage) => !Q0_STAGES.includes(stage))) {
      errors.push(createValidationError('INVALID_STAGE'));
    }

    for (const stage of Q0_STAGES) {
      const stageEvidence = input.stages[stage];
      if (!isRecord(stageEvidence)) {
        errors.push(createValidationError('INVALID_STAGE_OBJECT:' + stage));
        continue;
      }

      const stageFields = Object.keys(stageEvidence);
      if (stageFields.some((field) => field !== 'state' && field !== 'evidence_complete')) {
        errors.push(createValidationError('INVALID_STAGE_SCHEMA:' + stage));
      }
      if (!isEnumValue(stageEvidence.state, Q0_STAGE_STATES)) {
        errors.push(createValidationError('INVALID_STAGE_STATE:' + stage));
      }
      if (!isCompleteBoolean(stageEvidence.evidence_complete)) {
        errors.push(createValidationError('INVALID_EVIDENCE_COMPLETE:' + stage));
      }

      const mode = expectedStageMode(input.evaluation_scope, stage);
      if (mode !== null && isEnumValue(stageEvidence.state, Q0_STAGE_STATES)
        && !stageStateMatchesScope(stageEvidence.state, mode)) {
        errors.push(createValidationError('STAGE_SCOPE_MISMATCH:' + stage));
      }
    }
  }

  const rankStage = input.stages?.rank;
  const rankIsEvaluated = rankStage
    && isEnumValue(rankStage.state, Q0_STAGE_STATES)
    && ['PASS', 'FAIL', 'UNKNOWN'].includes(rankStage.state);
  const rankIsInScope = expectedStageMode(input.evaluation_scope, 'rank') === Q0_STAGE_MODES.IN_SCOPE;

  if (rankIsInScope && rankIsEvaluated && !isValidTopK(input.effective_top_k)) {
    errors.push(createValidationError('INVALID_EFFECTIVE_TOP_K'));
  } else if (
    input.effective_top_k !== undefined
    && input.effective_top_k !== null
    && !isValidTopK(input.effective_top_k)
  ) {
    errors.push(createValidationError('INVALID_EFFECTIVE_TOP_K'));
  }

  return {
    valid: errors.length === 0,
    errors: sortedUnique(errors),
  };
}

const baseAdjudication = (input, validation) => ({
  schema: Q0_FAILURE_EVALUATION_SCHEMA,
  case_id: safeCaseId(input),
  valid: validation.valid,
  adjudication_status: 'INSUFFICIENT_EVIDENCE',
  failure_class: null,
  first_loss_stage: null,
  use_loss_stage: null,
  loss_authority: null,
  blocked_by_stage: null,
  diagnostic_reason: null,
  effective_top_k: isValidTopK(input?.effective_top_k) ? input.effective_top_k : null,
  validation_errors: validation.errors,
});

const insufficient = (result, stage, reason) => ({
  ...result,
  adjudication_status: 'INSUFFICIENT_EVIDENCE',
  blocked_by_stage: stage ?? null,
  diagnostic_reason: reason,
});

/**
 * Adjudicate only what the case scope and complete evidence establish.
 *
 * This function never converts unresolved states into false. A diagnostic
 * reason may explain why a case is insufficient, but no failure class or loss
 * authority is emitted unless the frozen contract permits that conclusion.
 */
export function adjudicateQ0FailureEvaluationCase(input) {
  const validation = validateQ0FailureEvaluationCase(input);
  const result = baseAdjudication(input, validation);

  if (!validation.valid) {
    return result;
  }

  const scopeModes = Q0_SCOPE_STAGE_MODES[input.evaluation_scope];
  let unresolvedStage = null;

  for (const stage of Q0_STAGES) {
    if (scopeModes[stage] !== Q0_STAGE_MODES.IN_SCOPE) {
      continue;
    }

    const evidence = input.stages[stage];
    if (evidence.state === 'PASS') {
      if (evidence.evidence_complete !== true) {
        unresolvedStage ??= stage;
      }
      continue;
    }

    if (evidence.state === 'FAIL') {
      if (evidence.evidence_complete !== true) {
        return insufficient(result, stage, 'FAIL_EVIDENCE_INCOMPLETE');
      }
      if (unresolvedStage !== null) {
        return insufficient(result, unresolvedStage, 'EARLIER_STAGE_UNRESOLVED');
      }

      if (stage === 'rank' && input.effective_top_k !== 3) {
        return insufficient(result, stage, 'Q0_RANK_REQUIRES_EFFECTIVE_TOP_K_3');
      }

      return {
        ...result,
        adjudication_status: 'CLASSIFIED',
        failure_class: FAILURE_CLASS_BY_STAGE[stage],
        first_loss_stage: stage,
        use_loss_stage: USE_LOSS_STAGE_BY_STAGE[stage] ?? null,
        loss_authority: input.evaluation_scope === 'END_TO_END_OBSERVED'
          ? 'END_TO_END'
          : 'SCOPED',
        blocked_by_stage: null,
        diagnostic_reason: null,
      };
    }

    if (evidence.state === 'UNKNOWN' || evidence.state === 'NOT_EVALUATED') {
      unresolvedStage ??= stage;
    }
  }

  if (unresolvedStage !== null) {
    return insufficient(result, unresolvedStage, 'REQUIRED_STAGE_UNRESOLVED');
  }

  return {
    ...result,
    adjudication_status: 'NO_LOSS',
  };
}

const createCountMap = (values) => Object.fromEntries(values.map((value) => [value, 0]));

const incrementCount = (map, value, allowedValues) => {
  const key = allowedValues.includes(value) ? value : INVALID_OR_MISSING;
  map[key] = (map[key] ?? 0) + 1;
};

/**
 * Aggregate adjudications without combining provenance or scope into one
 * production failure rate.
 */
export function aggregateQ0FailureEvaluationResults(cases) {
  if (!Array.isArray(cases)) {
    return {
      schema: Q0_FAILURE_EVALUATION_SCHEMA,
      valid: false,
      errors: ['INVALID_CASES'],
      total_cases: 0,
      counts: {
        provenance: createCountMap([...Q0_CASE_PROVENANCE, INVALID_OR_MISSING]),
        evaluation_scope: createCountMap([...Q0_EVALUATION_SCOPES, INVALID_OR_MISSING]),
        failure_class: createCountMap([...Q0_FAILURE_CLASSES, UNCLASSIFIED]),
        adjudication_status: createCountMap([...Q0_ADJUDICATION_STATUSES]),
      },
      production_observed_end_to_end_first_loss_distribution: createCountMap(Q0_FAILURE_CLASSES),
    };
  }

  const counts = {
    provenance: createCountMap([...Q0_CASE_PROVENANCE, INVALID_OR_MISSING]),
    evaluation_scope: createCountMap([...Q0_EVALUATION_SCOPES, INVALID_OR_MISSING]),
    failure_class: createCountMap([...Q0_FAILURE_CLASSES, UNCLASSIFIED]),
    adjudication_status: createCountMap(Q0_ADJUDICATION_STATUSES),
  };
  const productionDistribution = createCountMap(Q0_FAILURE_CLASSES);
  const aggregateErrors = [];
  let allCasesValid = true;

  for (const input of cases) {
    incrementCount(counts.provenance, input?.provenance, Q0_CASE_PROVENANCE);
    incrementCount(counts.evaluation_scope, input?.evaluation_scope, Q0_EVALUATION_SCOPES);

    const result = adjudicateQ0FailureEvaluationCase(input);
    if (!result.valid) {
      allCasesValid = false;
      aggregateErrors.push(...result.validation_errors);
    }
    incrementCount(counts.adjudication_status, result.adjudication_status, Q0_ADJUDICATION_STATUSES);
    incrementCount(counts.failure_class, result.failure_class ?? UNCLASSIFIED, [
      ...Q0_FAILURE_CLASSES,
      UNCLASSIFIED,
    ]);

    if (
      input?.provenance === 'PRODUCTION_OBSERVED'
      && input?.evaluation_scope === 'END_TO_END_OBSERVED'
      && result.loss_authority === 'END_TO_END'
      && result.adjudication_status === 'CLASSIFIED'
      && Q0_FAILURE_CLASSES.includes(result.failure_class)
    ) {
      productionDistribution[result.failure_class] += 1;
    }
  }

  return {
    schema: Q0_FAILURE_EVALUATION_SCHEMA,
    valid: allCasesValid,
    errors: sortedUnique(aggregateErrors),
    total_cases: cases.length,
    counts,
    production_observed_end_to_end_first_loss_distribution: productionDistribution,
  };
}
