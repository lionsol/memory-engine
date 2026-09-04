import {
  evaluateAutoRecallPolicyHoldoutV2B5Jsonl,
  evaluateAutoRecallPolicyHoldoutV2B5Rows,
} from '../recall/auto-recall-policy-holdout-v2b5.js';
import {
  Q0_CASE_PROVENANCE,
  Q0_EVALUATION_SCOPES,
  Q0_FAILURE_CLASSES,
  Q0_STAGE_STATES,
  Q0_FAILURE_EVALUATION_SCHEMA,
  adjudicateQ0FailureEvaluationCase,
  aggregateQ0FailureEvaluationResults,
} from './q0-failure-evaluation-v1.js';

export const Q0_TRIGGER_FAILURE_ADAPTER_V1_SCHEMA = 'memory_engine_q0_trigger_failure_adapter_v1';

export const Q0_TRIGGER_FAILURE_SOURCE = Object.freeze({
  fixture: 'auto-recall-policy-holdout.v2b5',
  total: 48,
  expected_recall_yes: 24,
  expected_recall_no: 24,
});

const SOURCE_CONTRACT_INVALID = 'SOURCE_V2B5_CONTRACT_INVALID';
const SOURCE_EVALUATION_FAILED = 'SOURCE_V2B5_EVALUATION_FAILED';
const SOURCE_PARSE_ERROR = 'SOURCE_V2B5_PARSE_ERROR';

const isBoolean = (value) => typeof value === 'boolean';

const safeOpaqueSegment = (value, fallback = 'unknown') => {
  const segment = typeof value === 'string'
    ? value.replace(/[^A-Za-z0-9._:-]/gu, '_').slice(0, 96)
    : '';
  return segment || fallback;
};

const outOfScopeStage = () => ({
  state: 'OUT_OF_SCOPE',
  evidence_complete: null,
});

const buildQ0Case = (result) => {
  const actual = result?.v2_runtime_candidate?.should_recall;
  const triggerState = isBoolean(actual)
    ? actual ? 'PASS' : 'FAIL'
    : 'UNKNOWN';
  const turnId = safeOpaqueSegment(result?.turn_id);
  const family = safeOpaqueSegment(result?.family);

  return {
    schema: Q0_FAILURE_EVALUATION_SCHEMA,
    case_id: 'q0e2a-trigger-v2b5-' + turnId,
    provenance: 'TARGETED_SYNTHETIC',
    evaluation_scope: 'TRIGGER_ONLY',
    source_ref: 'auto-recall-policy-holdout.v2b5:' + turnId,
    case_ref: 'family:' + family,
    stages: {
      write: outOfScopeStage(),
      trigger: {
        state: triggerState,
        evidence_complete: isBoolean(actual) ? true : false,
      },
      candidate: outOfScopeStage(),
      rank: outOfScopeStage(),
      disclosure: outOfScopeStage(),
      answer_use: outOfScopeStage(),
    },
  };
};

const emptyQ0Report = (valid, errors) => ({
  schema: Q0_TRIGGER_FAILURE_ADAPTER_V1_SCHEMA,
  valid,
  errors,
  source_fixture: Q0_TRIGGER_FAILURE_SOURCE.fixture,
  source_contract: {
    total: Q0_TRIGGER_FAILURE_SOURCE.total,
    expected_recall_yes: Q0_TRIGGER_FAILURE_SOURCE.expected_recall_yes,
    expected_recall_no: Q0_TRIGGER_FAILURE_SOURCE.expected_recall_no,
  },
  selected_case_count: 0,
  trigger_fail_count: 0,
  trigger_pass_count: 0,
  trigger_unknown_count: 0,
  family_breakdown: [],
  q0_cases: [],
  q0_adjudications: [],
  q0_aggregate: aggregateQ0FailureEvaluationResults([]),
});

const sourceReportIsValid = (report) => (
  report?.validation?.valid === true
  && report?.readiness?.dataset_contract_valid === true
  && report?.dataset?.total === Q0_TRIGGER_FAILURE_SOURCE.total
  && report?.dataset?.yes === Q0_TRIGGER_FAILURE_SOURCE.expected_recall_yes
  && report?.dataset?.no === Q0_TRIGGER_FAILURE_SOURCE.expected_recall_no
  && Array.isArray(report?.results)
  && report.results.length === Q0_TRIGGER_FAILURE_SOURCE.total
);

const buildFamilyBreakdown = (results) => {
  const families = new Map();
  for (const result of results) {
    const family = safeOpaqueSegment(result?.family);
    if (!families.has(family)) {
      families.set(family, {
        family,
        selected: 0,
        trigger_fail: 0,
        trigger_pass: 0,
        trigger_unknown: 0,
      });
    }
    const entry = families.get(family);
    entry.selected += 1;
    const actual = result?.v2_runtime_candidate?.should_recall;
    if (actual === false) entry.trigger_fail += 1;
    else if (actual === true) entry.trigger_pass += 1;
    else entry.trigger_unknown += 1;
  }
  return [...families.values()].sort((left, right) => left.family.localeCompare(right.family));
};

const adaptValidatedSourceReport = (report) => {
  if (!sourceReportIsValid(report)) {
    const errors = [SOURCE_CONTRACT_INVALID];
    if ((report?.validation?.parse_errors || []).length > 0) {
      errors.push(SOURCE_PARSE_ERROR);
    }
    return emptyQ0Report(false, errors);
  }

  const selectedResults = report.results.filter(result => (
    result?.expected?.should_recall === true
  ));
  const q0Cases = selectedResults.map(buildQ0Case);
  const q0Adjudications = q0Cases.map(adjudicateQ0FailureEvaluationCase);
  const q0Aggregate = aggregateQ0FailureEvaluationResults(q0Cases);
  const triggerFailCount = selectedResults.filter(result => (
    result?.v2_runtime_candidate?.should_recall === false
  )).length;
  const triggerPassCount = selectedResults.filter(result => (
    result?.v2_runtime_candidate?.should_recall === true
  )).length;
  const triggerUnknownCount = selectedResults.length - triggerFailCount - triggerPassCount;

  return {
    schema: Q0_TRIGGER_FAILURE_ADAPTER_V1_SCHEMA,
    valid: true,
    errors: [],
    source_fixture: Q0_TRIGGER_FAILURE_SOURCE.fixture,
    source_contract: {
      total: Q0_TRIGGER_FAILURE_SOURCE.total,
      expected_recall_yes: Q0_TRIGGER_FAILURE_SOURCE.expected_recall_yes,
      expected_recall_no: Q0_TRIGGER_FAILURE_SOURCE.expected_recall_no,
    },
    source_evaluator: {
      valid: report.validation.valid,
      evaluator_status: report.b5_evaluator_status,
      dataset_contract_valid: report.readiness.dataset_contract_valid,
    },
    selected_case_count: q0Cases.length,
    trigger_fail_count: triggerFailCount,
    trigger_pass_count: triggerPassCount,
    trigger_unknown_count: triggerUnknownCount,
    family_breakdown: buildFamilyBreakdown(selectedResults),
    q0_cases: q0Cases,
    q0_adjudications: q0Adjudications,
    q0_aggregate: q0Aggregate,
  };
};

const adaptWithEvaluator = (evaluate) => {
  try {
    return adaptValidatedSourceReport(evaluate());
  } catch {
    return emptyQ0Report(false, [SOURCE_EVALUATION_FAILED]);
  }
};

/**
 * Evaluate the frozen v2b5 JSONL with its existing evaluator, then adapt only
 * expected-recall rows into bounded Q0 trigger cases.
 */
export function adaptQ0TriggerFailuresFromV2B5Jsonl(content) {
  return adaptWithEvaluator(() => evaluateAutoRecallPolicyHoldoutV2B5Jsonl(content));
}

/**
 * Row form is useful for in-memory fixture tests; it uses the same frozen
 * v2b5 evaluator and never accepts caller-supplied policy decisions.
 */
export function adaptQ0TriggerFailuresFromV2B5Rows(rows) {
  return adaptWithEvaluator(() => evaluateAutoRecallPolicyHoldoutV2B5Rows(rows));
}

export {
  Q0_CASE_PROVENANCE,
  Q0_EVALUATION_SCOPES,
  Q0_FAILURE_CLASSES,
  Q0_STAGE_STATES,
};
