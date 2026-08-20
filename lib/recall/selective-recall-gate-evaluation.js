import { evaluateAutoRecallPolicyDataset } from "./auto-recall-policy-evaluation.js";
import { applySelectiveRecallGateToV1, SELECTIVE_RECALL_GATE_DECISIONS } from "./selective-recall-gate.js";

function matrix(results) {
  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  for (const result of results) {
    const expected = result.expected_should_recall;
    const actual = result.should_recall;
    if (expected === true && actual === true) truePositive += 1;
    else if (expected === false && actual === false) trueNegative += 1;
    else if (expected === false && actual === true) falsePositive += 1;
    else if (expected === true && actual === false) falseNegative += 1;
  }
  return { true_positive: truePositive, true_negative: trueNegative, false_positive: falsePositive, false_negative: falseNegative };
}

export function evaluateSelectiveRecallGateDataset(rows, options = {}) {
  const base = evaluateAutoRecallPolicyDataset(rows, options);
  const results = rows.map((row, index) => {
    const baseResult = base.results[index];
    const applied = applySelectiveRecallGateToV1(row.prompt, baseResult.v1.should_recall);
    return {
      turn_id: row.turn_id,
      family: row.family,
      expected_should_recall: row.expected_should_recall,
      v1_should_recall: baseResult.v1.should_recall,
      gate_decision: applied.decision,
      gate_reason: applied.reason,
      should_recall: applied.should_recall,
      override_applied: applied.decision === SELECTIVE_RECALL_GATE_DECISIONS.SAFE_SKIP && baseResult.v1.should_recall === true,
    };
  });

  const v1 = base.confusion_matrices.v1_current;
  const candidate = matrix(results);
  const introducedFalseNegatives = results.filter(result => (
    result.expected_should_recall === true
    && result.v1_should_recall === true
    && result.should_recall === false
  ));
  const removedFalsePositives = results.filter(result => (
    result.expected_should_recall === false
    && result.v1_should_recall === true
    && result.should_recall === false
  ));

  return {
    mode: "offline_selective_recall_gate_c1",
    evidence_role: "known_corpus_design_regression",
    validation: base.validation,
    summary: base.summary,
    confusion_matrices: {
      v1_current: v1,
      selective_candidate: candidate,
    },
    diagnostics: {
      safe_skip_count: results.filter(result => result.gate_decision === SELECTIVE_RECALL_GATE_DECISIONS.SAFE_SKIP).length,
      abstain_count: results.filter(result => result.gate_decision === SELECTIVE_RECALL_GATE_DECISIONS.ABSTAIN).length,
      override_count: results.filter(result => result.override_applied).length,
      false_positive_reduced_count: removedFalsePositives.length,
      introduced_false_negative_count: introducedFalseNegatives.length,
      false_positive_reduced_case_ids: removedFalsePositives.map(result => result.turn_id),
      introduced_false_negative_case_ids: introducedFalseNegatives.map(result => result.turn_id),
    },
    gates: {
      no_new_false_negative: introducedFalseNegatives.length === 0,
      false_positive_reduction: candidate.false_positive < v1.false_positive,
    },
    authority: "OFFLINE ONLY / NOT RUNTIME AUTHORIZED",
    independent_readiness_evidence: false,
    results,
    side_effects: {
      db_writes: false,
      dataset_file_mutation: false,
      memory_file_mutation: false,
      retrieval: false,
      injection: false,
      llm: false,
      network: false,
      runtime_report_files: false,
    },
  };
}
