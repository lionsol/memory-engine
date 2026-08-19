import {
  AUTO_RECALL_POLICY_HOLDOUT_V2B3_CONTRACT,
  AUTO_RECALL_POLICY_HOLDOUT_V2B3_FAMILIES,
  evaluateAutoRecallPolicyDataset,
  evaluateAutoRecallPolicyDatasetJsonl,
} from "./auto-recall-policy-evaluation.js";

const B3_RUNTIME_MIN_PRECISION = 0.9;
const B3_RUNTIME_MIN_RECALL = 0.9;
const B3_RUNTIME_MAX_FALSE_POSITIVES = 2;
const B3_RUNTIME_MAX_FALSE_NEGATIVES = 2;
const B3_MAX_FAMILY_DECISION_ERRORS = 1;

function isBoolean(value) {
  return typeof value === "boolean";
}

function descriptor(result, reason) {
  return {
    turn_id: result.turn_id,
    family: result.family,
    reason: String(reason || "unspecified").slice(0, 96),
  };
}

function isPolicyDecisionError(result) {
  const expected = result?.expected?.should_recall;
  const actual = result?.v2_runtime_candidate?.should_recall;
  return isBoolean(expected) && isBoolean(actual) && expected !== actual;
}

function isClassificationMismatch(result) {
  return result?.classification?.task_intent_match === false
    || result?.classification?.recall_intent_match === false;
}

function matrixForResults(results) {
  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  for (const result of results) {
    const expected = result?.expected?.should_recall;
    const actual = result?.v2_runtime_candidate?.should_recall;
    if (expected === true && actual === true) truePositive += 1;
    else if (expected === false && actual === false) trueNegative += 1;
    else if (expected === false && actual === true) falsePositive += 1;
    else if (expected === true && actual === false) falseNegative += 1;
  }
  return { truePositive, trueNegative, falsePositive, falseNegative };
}

export function buildAutoRecallPolicyHoldoutV2B3Diagnostics(report) {
  const results = Array.isArray(report?.results) ? report.results : [];
  const taskMismatches = results.filter(result => result?.classification?.task_intent_match === false);
  const recallMismatches = results.filter(result => result?.classification?.recall_intent_match === false);
  const policyDecisionErrors = results.filter(isPolicyDecisionError);
  const semanticOnlyMismatches = results.filter(result => (
    isClassificationMismatch(result) && !isPolicyDecisionError(result)
  ));
  const runtimeFalsePositive = results.filter(result => (
    result?.expected?.should_recall === false
    && result?.v2_runtime_candidate?.should_recall === true
  ));
  const runtimeFalseNegative = results.filter(result => (
    result?.expected?.should_recall === true
    && result?.v2_runtime_candidate?.should_recall === false
  ));

  return {
    task_intent_mismatch_count: taskMismatches.length,
    recall_intent_mismatch_count: recallMismatches.length,
    semantic_intent_mismatch_count: taskMismatches.length + recallMismatches.length,
    semantic_only_mismatch_count: semanticOnlyMismatches.length,
    policy_decision_error_count: policyDecisionErrors.length,
    runtime_false_positive_count: runtimeFalsePositive.length,
    runtime_false_negative_count: runtimeFalseNegative.length,
    runtime_false_positive_case_ids: runtimeFalsePositive.map(result => result.turn_id),
    runtime_false_negative_case_ids: runtimeFalseNegative.map(result => result.turn_id),
    semantic_only_mismatch_case_ids: semanticOnlyMismatches.map(result => result.turn_id),
    semantic_only_mismatch_cases: semanticOnlyMismatches.map(result => descriptor(result, "semantic_intent_mismatch")),
    task_classifier_mismatch_cases: taskMismatches.map(result => descriptor(result, "task_intent_mismatch")),
    recall_classifier_mismatch_cases: recallMismatches.map(result => descriptor(result, "recall_intent_mismatch")),
  };
}

function familyMetrics(results, families) {
  return families.map(family => {
    const familyResults = results.filter(result => result.family === family);
    const matrix = matrixForResults(familyResults);
    return {
      family,
      total: familyResults.length,
      true_positive: matrix.truePositive,
      true_negative: matrix.trueNegative,
      false_positive: matrix.falsePositive,
      false_negative: matrix.falseNegative,
      decision_error_count: matrix.falsePositive + matrix.falseNegative,
      task_mismatch: familyResults.filter(result => result.classification.task_intent_match === false).length,
      recall_mismatch: familyResults.filter(result => result.classification.recall_intent_match === false).length,
    };
  });
}

function datasetContractValid(report, contract) {
  const summary = report?.validation?.summary || {};
  const familyCounts = summary.family_counts || {};
  const families = Array.isArray(contract?.allowed_families)
    ? contract.allowed_families
    : Array.isArray(contract?.required_families)
      ? contract.required_families
      : [];
  return report?.validation?.valid === true
    && summary.total === contract?.expected_count
    && summary.expected_yes === contract?.expected_yes
    && summary.expected_no === contract?.expected_no
    && Object.keys(familyCounts).length === families.length
    && families.every(family => familyCounts[family] === 4);
}

export function assessAutoRecallPolicyHoldoutV2B3(report, contract = AUTO_RECALL_POLICY_HOLDOUT_V2B3_CONTRACT) {
  const family_metrics = familyMetrics(
    Array.isArray(report?.results) ? report.results : [],
    Array.isArray(contract?.required_families) ? contract.required_families : AUTO_RECALL_POLICY_HOLDOUT_V2B3_FAMILIES,
  );
  const diagnostics = buildAutoRecallPolicyHoldoutV2B3Diagnostics(report);
  const dataset_contract_valid = datasetContractValid(report, contract);
  const oracle = report?.confusion_matrices?.v2_oracle_policy;
  const runtime = report?.confusion_matrices?.v2_runtime_candidate;
  const oracle_gate_pass = dataset_contract_valid
    && oracle?.false_positive === 0
    && oracle?.false_negative === 0
    && oracle?.invalid === 0;
  const quantitative_gate_pass = dataset_contract_valid
    && Number.isFinite(runtime?.precision)
    && Number.isFinite(runtime?.recall)
    && runtime.precision >= B3_RUNTIME_MIN_PRECISION
    && runtime.recall >= B3_RUNTIME_MIN_RECALL
    && runtime.false_positive <= B3_RUNTIME_MAX_FALSE_POSITIVES
    && runtime.false_negative <= B3_RUNTIME_MAX_FALSE_NEGATIVES;
  const family_gate_failures = family_metrics.filter(metric => (
    metric.decision_error_count > B3_MAX_FAMILY_DECISION_ERRORS
  ));
  const family_gate_pass = dataset_contract_valid && family_gate_failures.length === 0;
  const overall_status = !dataset_contract_valid || !oracle_gate_pass
    ? "BLOCKED / HOLDOUT CONTRACT INVALID"
    : quantitative_gate_pass && family_gate_pass
      ? "PASS / READY FOR POLICY AUTHORITY REVIEW"
      : "PASS_WITH_FINDINGS / HOLDOUT NOT READY";

  return {
    ...diagnostics,
    family_metrics,
    readiness: {
      evaluator_status: "PASS",
      dataset_contract_valid,
      oracle_gate_pass,
      quantitative_gate_pass,
      family_gate_pass,
      family_gate_failures,
      thresholds: {
        minimum_precision: B3_RUNTIME_MIN_PRECISION,
        minimum_recall: B3_RUNTIME_MIN_RECALL,
        maximum_false_positives: B3_RUNTIME_MAX_FALSE_POSITIVES,
        maximum_false_negatives: B3_RUNTIME_MAX_FALSE_NEGATIVES,
        maximum_family_decision_errors: B3_MAX_FAMILY_DECISION_ERRORS,
      },
      overall_status,
      candidate_policy_status: "NOT RUNTIME AUTHORIZED",
    },
  };
}

function finalizeReport(report, contract) {
  const assessment = assessAutoRecallPolicyHoldoutV2B3(report, contract);
  const {
    family_metrics,
    readiness,
    ...b3Diagnostics
  } = assessment;
  return {
    ...report,
    mode: "offline_auto_recall_policy_holdout_v2b3",
    dataset: {
      total: report.summary.total,
      yes: report.summary.expected_yes,
      no: report.summary.expected_no,
      family_counts: report.validation.summary.family_counts,
    },
    diagnostics: {
      ...report.diagnostics,
      ...b3Diagnostics,
    },
    family_metrics,
    readiness,
    b3_evaluator_status: "PASS",
  };
}

export function evaluateAutoRecallPolicyHoldoutV2B3Rows(rows, options = {}) {
  const contract = options.contract || AUTO_RECALL_POLICY_HOLDOUT_V2B3_CONTRACT;
  const report = evaluateAutoRecallPolicyDataset(rows, {
    ...contract,
    ...(options.evaluator_options || {}),
  });
  return finalizeReport(report, contract);
}

export function evaluateAutoRecallPolicyHoldoutV2B3Jsonl(content, options = {}) {
  const contract = options.contract || AUTO_RECALL_POLICY_HOLDOUT_V2B3_CONTRACT;
  const report = evaluateAutoRecallPolicyDatasetJsonl(content, {
    ...contract,
    ...(options.evaluator_options || {}),
  });
  return finalizeReport(report, contract);
}
