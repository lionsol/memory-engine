import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AUTO_RECALL_POLICY_EVALUATION_DATASET_CONTRACT,
  AUTO_RECALL_POLICY_HOLDOUT_V2B3_CONTRACT,
  AUTO_RECALL_POLICY_HOLDOUT_V2B5_CONTRACT,
  parseAutoRecallPolicyEvaluationJsonl,
} from "../lib/recall/auto-recall-policy-evaluation.js";
import { evaluateSelectiveRecallGateDataset } from "../lib/recall/selective-recall-gate-evaluation.js";

const CASES = [
  {
    name: "B1",
    path: "test/fixtures/auto-recall-policy-eval.v2b1.jsonl",
    contract: AUTO_RECALL_POLICY_EVALUATION_DATASET_CONTRACT,
    expected: { fp: 13, fn: 0, reduced: 0 },
  },
  {
    name: "B3",
    path: "test/fixtures/auto-recall-policy-holdout.v2b3.jsonl",
    contract: AUTO_RECALL_POLICY_HOLDOUT_V2B3_CONTRACT,
    expected: { fp: 17, fn: 0, reduced: 7 },
  },
  {
    name: "B5",
    path: "test/fixtures/auto-recall-policy-holdout.v2b5.jsonl",
    contract: AUTO_RECALL_POLICY_HOLDOUT_V2B5_CONTRACT,
    expected: { fp: 22, fn: 0, reduced: 1 },
  },
];

for (const item of CASES) {
  test(`C1 known-corpus regression ${item.name} preserves positives`, () => {
    const parsed = parseAutoRecallPolicyEvaluationJsonl(readFileSync(item.path, "utf8"));
    assert.deepEqual(parsed.parse_errors, []);
    const report = evaluateSelectiveRecallGateDataset(parsed.rows, item.contract);
    assert.equal(report.validation.valid, true);
    assert.equal(report.confusion_matrices.selective_candidate.false_positive, item.expected.fp);
    assert.equal(report.confusion_matrices.selective_candidate.false_negative, item.expected.fn);
    assert.equal(report.diagnostics.false_positive_reduced_count, item.expected.reduced);
    assert.equal(report.diagnostics.introduced_false_negative_count, 0);
    assert.equal(report.gates.no_new_false_negative, true);
    assert.equal(report.authority, "OFFLINE ONLY / NOT RUNTIME AUTHORIZED");
    assert.equal(report.independent_readiness_evidence, false);
  });
}

test("C1 known corpora reduce 8 V1 false positives with no introduced false negatives", () => {
  let v1FalsePositive = 0;
  let candidateFalsePositive = 0;
  let introducedFalseNegative = 0;

  for (const item of CASES) {
    const rows = parseAutoRecallPolicyEvaluationJsonl(readFileSync(item.path, "utf8")).rows;
    const report = evaluateSelectiveRecallGateDataset(rows, item.contract);
    v1FalsePositive += report.confusion_matrices.v1_current.false_positive;
    candidateFalsePositive += report.confusion_matrices.selective_candidate.false_positive;
    introducedFalseNegative += report.diagnostics.introduced_false_negative_count;
  }

  assert.equal(v1FalsePositive, 60);
  assert.equal(candidateFalsePositive, 52);
  assert.equal(v1FalsePositive - candidateFalsePositive, 8);
  assert.equal(introducedFalseNegative, 0);
});
