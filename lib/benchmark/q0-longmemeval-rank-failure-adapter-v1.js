import {
  normalizeLongMemEvalCase,
} from './longmemeval-v1.js';
import {
  runLongMemEvalRetrievalCase,
} from './longmemeval-retrieval-runner-v1.js';
import {
  Q0_FAILURE_EVALUATION_SCHEMA,
  adjudicateQ0FailureEvaluationCase,
  aggregateQ0FailureEvaluationResults,
} from './q0-failure-evaluation-v1.js';

export const Q0_LONGMEMEVAL_RANK_FAILURE_ADAPTER_V1_SCHEMA = (
  'memory_engine_q0_longmemeval_rank_failure_adapter_v1'
);

export const Q0_LONGMEMEVAL_RETRIEVAL_DEPTHS = Object.freeze({
  production_top_k: 3,
  breadth_top_k: 50,
});

const INVALID_SOURCE_CASE = 'INVALID_SOURCE_CASE';
const RETRIEVAL_RUN_FAILED = 'RETRIEVAL_RUN_FAILED';
const INVALID_DATASET = 'INVALID_DATASET';

const safeOpaqueSegment = (value, fallback = 'unknown') => {
  const segment = typeof value === 'string'
    ? value.replace(/[^A-Za-z0-9._:-]/gu, '_').slice(0, 96)
    : '';
  return segment || fallback;
};

const uniqueStrings = (values) => [...new Set(
  (Array.isArray(values) ? values : []).filter(value => typeof value === 'string' && value),
)];

const sameOrderedArray = (left, right) => (
  Array.isArray(left)
  && Array.isArray(right)
  && left.length === right.length
  && left.every((value, index) => value === right[index])
);

const outOfScopeStage = () => ({
  state: 'OUT_OF_SCOPE',
  evidence_complete: null,
});

const buildQ0Case = ({
  item,
  candidateState,
  candidateEvidenceComplete,
  rankState,
  rankEvidenceComplete,
}) => ({
  schema: Q0_FAILURE_EVALUATION_SCHEMA,
  case_id: 'q0e2b-longmemeval-' + safeOpaqueSegment(item.question_id),
  provenance: 'BENCHMARK_DERIVED',
  evaluation_scope: 'RETRIEVAL_FROM_MATERIALIZED_MEMORY',
  source_ref: 'longmemeval:' + safeOpaqueSegment(item.question_id),
  case_ref: 'question_type:' + safeOpaqueSegment(item.question_type),
  effective_top_k: Q0_LONGMEMEVAL_RETRIEVAL_DEPTHS.production_top_k,
  stages: {
    write: {
      state: 'BYPASSED_BY_FIXTURE',
      evidence_complete: null,
    },
    trigger: outOfScopeStage(),
    candidate: {
      state: candidateState,
      evidence_complete: candidateEvidenceComplete,
    },
    rank: {
      state: rankState,
      evidence_complete: rankEvidenceComplete,
    },
    disclosure: outOfScopeStage(),
    answer_use: outOfScopeStage(),
  },
});

const summarizeRun = (result, topK, benchmarkNowSec) => ({
  top_k: topK,
  benchmark_now_sec: benchmarkNowSec,
  skipped: result?.skipped === true,
  skip_reason: result?.skip_reason || null,
  retrieved_session_count: Array.isArray(result?.retrieved_session_ids)
    ? result.retrieved_session_ids.length
    : 0,
});

/**
 * Convert the two bounded runner results into Q0 stage evidence. The normal
 * adapter path supplies results produced by runLongMemEvalRetrievalCase;
 * keeping this mapper pure also makes the prefix gate directly testable.
 */
export function evaluateQ0LongMemEvalRankEvidence(item, {
  top3Result = null,
  top50Result = null,
  benchmarkNowSec = null,
} = {}) {
  const top3Ids = Array.isArray(top3Result?.retrieved_session_ids)
    ? top3Result.retrieved_session_ids
    : [];
  const top50Ids = Array.isArray(top50Result?.retrieved_session_ids)
    ? top50Result.retrieved_session_ids
    : [];
  const goldIds = uniqueStrings(item?.evidence_session_ids);
  const top3PrefixConsistent = top3Result?.skipped !== true
    && top50Result?.skipped !== true
    && sameOrderedArray(top3Ids, top50Ids.slice(0, Q0_LONGMEMEVAL_RETRIEVAL_DEPTHS.production_top_k));
  const allGoldInTop3 = goldIds.length > 0
    && goldIds.every(id => top3Ids.includes(id));
  const allGoldInTop50 = goldIds.length > 0
    && goldIds.every(id => top50Ids.includes(id));
  const candidatePass = top3PrefixConsistent && allGoldInTop50;
  const candidateState = candidatePass ? 'PASS' : 'UNKNOWN';
  const rankState = candidatePass
    ? allGoldInTop3 ? 'PASS' : 'FAIL'
    : 'NOT_EVALUATED';
  const rankEvidenceComplete = candidatePass;
  const q0Case = buildQ0Case({
    item,
    candidateState,
    candidateEvidenceComplete: candidatePass,
    rankState,
    rankEvidenceComplete,
  });

  return {
    runs: {
      top3: summarizeRun(
        top3Result,
        Q0_LONGMEMEVAL_RETRIEVAL_DEPTHS.production_top_k,
        benchmarkNowSec,
      ),
      top50: summarizeRun(
        top50Result,
        Q0_LONGMEMEVAL_RETRIEVAL_DEPTHS.breadth_top_k,
        benchmarkNowSec,
      ),
    },
    diagnostics: {
      evidence_count: goldIds.length,
      observed_top3_session_count: top3Ids.length,
      observed_top50_session_count: top50Ids.length,
      all_gold_in_top3: allGoldInTop3,
      all_gold_in_top50: allGoldInTop50,
      top3_prefix_consistent: top3PrefixConsistent,
    },
    q0_case: q0Case,
    q0_adjudication: adjudicateQ0FailureEvaluationCase(q0Case),
  };
}

const emptyCaseResult = (errors) => ({
  schema: Q0_LONGMEMEVAL_RANK_FAILURE_ADAPTER_V1_SCHEMA,
  valid: false,
  errors: [...new Set(errors)],
  question_id: null,
  question_type: null,
  skipped: false,
  skip_reason: null,
  benchmark_now_sec: null,
  runs: {
    top3: null,
    top50: null,
  },
  diagnostics: null,
  q0_case: null,
  q0_adjudication: null,
});

/**
 * Adapt one normalized LongMemEval case through the existing isolated runner.
 *
 * The gold session set is read only after both retrieval runs and is never
 * passed to materialization, search, ranking, or prompt construction.
 */
export async function adaptQ0LongMemEvalRankFailureCase(record, {
  benchmarkNowSec = Math.floor(Date.now() / 1000),
} = {}) {
  let item;
  try {
    item = normalizeLongMemEvalCase(record);
  } catch {
    return emptyCaseResult([INVALID_SOURCE_CASE]);
  }

  let top3Result;
  try {
    top3Result = await runLongMemEvalRetrievalCase(item, {
      topK: Q0_LONGMEMEVAL_RETRIEVAL_DEPTHS.production_top_k,
      benchmarkNowSec,
    });
  } catch {
    return {
      ...emptyCaseResult([RETRIEVAL_RUN_FAILED]),
      question_id: safeOpaqueSegment(item.question_id),
      question_type: item.question_type,
      benchmark_now_sec: benchmarkNowSec,
    };
  }

  if (top3Result.skipped === true) {
    return {
      schema: Q0_LONGMEMEVAL_RANK_FAILURE_ADAPTER_V1_SCHEMA,
      valid: true,
      errors: [],
      question_id: safeOpaqueSegment(item.question_id),
      question_type: item.question_type,
      skipped: true,
      skip_reason: top3Result.skip_reason || 'unknown',
      benchmark_now_sec: benchmarkNowSec,
      runs: {
        top3: summarizeRun(
          top3Result,
          Q0_LONGMEMEVAL_RETRIEVAL_DEPTHS.production_top_k,
          benchmarkNowSec,
        ),
        top50: null,
      },
      diagnostics: null,
      q0_case: null,
      q0_adjudication: null,
    };
  }

  let top50Result;
  try {
    top50Result = await runLongMemEvalRetrievalCase(item, {
      topK: Q0_LONGMEMEVAL_RETRIEVAL_DEPTHS.breadth_top_k,
      benchmarkNowSec,
    });
  } catch {
    return {
      ...emptyCaseResult([RETRIEVAL_RUN_FAILED]),
      question_id: safeOpaqueSegment(item.question_id),
      question_type: item.question_type,
      benchmark_now_sec: benchmarkNowSec,
      runs: {
        top3: summarizeRun(
          top3Result,
          Q0_LONGMEMEVAL_RETRIEVAL_DEPTHS.production_top_k,
          benchmarkNowSec,
        ),
        top50: null,
      },
    };
  }

  const mappedEvidence = evaluateQ0LongMemEvalRankEvidence(item, {
    top3Result,
    top50Result,
    benchmarkNowSec,
  });

  return {
    schema: Q0_LONGMEMEVAL_RANK_FAILURE_ADAPTER_V1_SCHEMA,
    valid: true,
    errors: [],
    question_id: safeOpaqueSegment(item.question_id),
    question_type: item.question_type,
    skipped: false,
    skip_reason: null,
    benchmark_now_sec: benchmarkNowSec,
    ...mappedEvidence,
  };
}

const emptyDatasetReport = (sourceCaseCount, errors) => ({
  schema: Q0_LONGMEMEVAL_RANK_FAILURE_ADAPTER_V1_SCHEMA,
  valid: false,
  errors: [...new Set(errors)],
  source_case_count: sourceCaseCount,
  scored_case_count: 0,
  skipped_case_count: 0,
  skipped_by_reason: {},
  rank_miss_count: 0,
  retrieval_no_loss_count: 0,
  insufficient_evidence_count: 0,
  prefix_inconsistent_count: 0,
  question_type_breakdown: {},
  q0_cases: [],
  q0_adjudications: [],
  q0_aggregate: aggregateQ0FailureEvaluationResults([]),
});

const buildQuestionTypeBreakdown = (results) => {
  const groups = new Map();
  for (const result of results) {
    const questionType = result.question_type || 'UNKNOWN';
    if (!groups.has(questionType)) {
      groups.set(questionType, {
        source_cases: 0,
        scored_cases: 0,
        skipped_cases: 0,
        rank_miss: 0,
        retrieval_no_loss: 0,
        insufficient_evidence: 0,
      });
    }
    const group = groups.get(questionType);
    group.source_cases += 1;
    if (result.skipped === true) {
      group.skipped_cases += 1;
      continue;
    }
    if (!result.valid) continue;
    group.scored_cases += 1;
    if (result.q0_adjudication?.failure_class === 'RANK_MISS') group.rank_miss += 1;
    if (result.q0_adjudication?.adjudication_status === 'NO_LOSS') group.retrieval_no_loss += 1;
    if (result.q0_adjudication?.adjudication_status === 'INSUFFICIENT_EVIDENCE') {
      group.insufficient_evidence += 1;
    }
  }
  return Object.fromEntries(
    [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
};

/**
 * Adapt every record while retaining only bounded retrieval diagnostics and
 * Q0-E1 cases. Any invalid source record makes the dataset report fail closed
 * and suppresses all classifiable Q0 cases.
 */
export async function adaptQ0LongMemEvalRankFailureDataset(records, {
  benchmarkNowSec = Math.floor(Date.now() / 1000),
} = {}) {
  if (!Array.isArray(records)) {
    return emptyDatasetReport(0, [INVALID_DATASET]);
  }

  const results = [];
  for (const record of records) {
    results.push(await adaptQ0LongMemEvalRankFailureCase(record, { benchmarkNowSec }));
  }

  const invalidResults = results.filter(result => result.valid !== true);
  if (invalidResults.length > 0) {
    return emptyDatasetReport(
      results.length,
      [...new Set(invalidResults.flatMap(result => result.errors))],
    );
  }

  const skipped = results.filter(result => result.skipped === true);
  const scored = results.filter(result => result.skipped !== true);
  const q0Cases = scored.map(result => result.q0_case).filter(Boolean);
  const q0Adjudications = scored.map(result => result.q0_adjudication).filter(Boolean);
  const q0Aggregate = aggregateQ0FailureEvaluationResults(q0Cases);
  const skippedByReason = {};
  for (const result of skipped) {
    const reason = result.skip_reason || 'unknown';
    skippedByReason[reason] = (skippedByReason[reason] || 0) + 1;
  }
  const rankMissCount = q0Adjudications.filter(result => result.failure_class === 'RANK_MISS').length;
  const retrievalNoLossCount = q0Adjudications.filter(
    result => result.adjudication_status === 'NO_LOSS',
  ).length;
  const insufficientEvidenceCount = q0Adjudications.filter(
    result => result.adjudication_status === 'INSUFFICIENT_EVIDENCE',
  ).length;
  const prefixInconsistentCount = scored.filter(
    result => result.diagnostics?.top3_prefix_consistent === false,
  ).length;

  return {
    schema: Q0_LONGMEMEVAL_RANK_FAILURE_ADAPTER_V1_SCHEMA,
    valid: true,
    errors: [],
    source_case_count: results.length,
    scored_case_count: scored.length,
    skipped_case_count: skipped.length,
    skipped_by_reason: skippedByReason,
    rank_miss_count: rankMissCount,
    retrieval_no_loss_count: retrievalNoLossCount,
    insufficient_evidence_count: insufficientEvidenceCount,
    prefix_inconsistent_count: prefixInconsistentCount,
    question_type_breakdown: buildQuestionTypeBreakdown(results),
    q0_cases: q0Cases,
    q0_adjudications: q0Adjudications,
    q0_aggregate: q0Aggregate,
  };
}
