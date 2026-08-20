import test from "node:test";
import assert from "node:assert/strict";

import {
  createSelectiveRecallGateC2Contract,
  evaluateSelectiveRecallGateC2Rows,
  SELECTIVE_RECALL_GATE_C2_CONTRACT,
  SELECTIVE_RECALL_GATE_C2_EVIDENCE_ROLE,
  SELECTIVE_RECALL_GATE_C2_READINESS_GATES,
  validateSelectiveRecallGateC2Dataset,
} from "../lib/recall/selective-recall-gate-c2-evaluation.js";

function row(turnId, family, expected, prompt) {
  return {
    schema_version: 1,
    turn_id: turnId,
    family,
    prompt,
    expected_should_recall: expected,
    label_confidence: "high",
    annotator: "v2c2_planner_holdout",
  };
}

function contractFor(rows) {
  const families = [...new Set(rows.map(item => item.family))];
  return createSelectiveRecallGateC2Contract({
    expected_count: rows.length,
    expected_yes: rows.filter(item => item.expected_should_recall === true).length,
    expected_no: rows.filter(item => item.expected_should_recall === false).length,
    expected_family_count: families.length,
    rows_per_family: 1,
    allowed_families: families,
  });
}

test("C2 default contract freezes the future 48-row behavioral shape", () => {
  assert.equal(SELECTIVE_RECALL_GATE_C2_CONTRACT.schema_version, 1);
  assert.equal(SELECTIVE_RECALL_GATE_C2_CONTRACT.expected_count, 48);
  assert.equal(SELECTIVE_RECALL_GATE_C2_CONTRACT.expected_yes, 24);
  assert.equal(SELECTIVE_RECALL_GATE_C2_CONTRACT.expected_no, 24);
  assert.equal(SELECTIVE_RECALL_GATE_C2_CONTRACT.expected_family_count, 12);
  assert.equal(SELECTIVE_RECALL_GATE_C2_CONTRACT.rows_per_family, 4);
  assert.equal(SELECTIVE_RECALL_GATE_C2_CONTRACT.allowed_families, null);
  assert.equal(SELECTIVE_RECALL_GATE_C2_CONTRACT.label_confidence, "high");
  assert.equal(SELECTIVE_RECALL_GATE_C2_CONTRACT.annotator, "v2c2_planner_holdout");
  assert.equal(SELECTIVE_RECALL_GATE_C2_READINESS_GATES.minimum_false_positive_reduced, 2);
  assert.equal(SELECTIVE_RECALL_GATE_C2_READINESS_GATES.minimum_false_positive_reduction_rate, 0.1);
});

test("C2 accepts behavioral rows without task or recall intent labels", () => {
  const rows = [row("c2-no", "synthetic_no", false, "只分析这份日志，不补充背景。")];
  const validation = validateSelectiveRecallGateC2Dataset(rows, contractFor(rows));
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.row_errors, []);
});

test("SAFE_SKIP on expected NO is counted as safe and accurate", () => {
  const rows = [row("c2-safe-no", "synthetic_no", false, "只分析这份日志，不补充背景。")];
  const report = evaluateSelectiveRecallGateC2Rows(rows, { contract: contractFor(rows) });
  assert.equal(report.validation.valid, true);
  assert.equal(report.results[0].gate_decision, "SAFE_SKIP");
  assert.equal(report.diagnostics.safe_skip_count, 1);
  assert.equal(report.diagnostics.safe_skip_expected_no_count, 1);
  assert.equal(report.diagnostics.unsafe_safe_skip_count, 0);
  assert.equal(report.diagnostics.safe_skip_precision, 1);
});

test("SAFE_SKIP on expected YES fails both independent safety checks", () => {
  const rows = [row("c2-unsafe-yes", "synthetic_yes", true, "只分析这份日志，不补充背景。")];
  const report = evaluateSelectiveRecallGateC2Rows(rows, { contract: contractFor(rows) });
  assert.equal(report.diagnostics.safe_skip_expected_yes_count, 1);
  assert.equal(report.diagnostics.unsafe_safe_skip_count, 1);
  assert.equal(report.diagnostics.introduced_false_negative_count, 1);
  assert.equal(report.readiness.hard_safety_gate_pass, false);
  assert.equal(report.readiness.gates.unsafe_safe_skip_zero, false);
  assert.equal(report.readiness.gates.introduced_false_negative_zero, false);
});

test("V1 false plus SAFE_SKIP still records unsafe skip without inventing an introduced FN", () => {
  const rows = [row("c2-v1-false-yes", "synthetic_yes", true, "只润色下面这段文字。")];
  const report = evaluateSelectiveRecallGateC2Rows(rows, { contract: contractFor(rows) });
  assert.equal(report.results[0].v1_should_recall, false);
  assert.equal(report.results[0].gate_decision, "SAFE_SKIP");
  assert.equal(report.diagnostics.unsafe_safe_skip_count, 1);
  assert.equal(report.diagnostics.introduced_false_negative_count, 0);
  assert.equal(report.readiness.hard_safety_gate_pass, false);
});

test("ABSTAIN preserves V1 exactly", () => {
  const prompt = "我们手头这条开发线现在走到哪了？";
  const rows = [row("c2-abstain", "synthetic_history", true, prompt)];
  const report = evaluateSelectiveRecallGateC2Rows(rows, { contract: contractFor(rows) });
  const result = report.results[0];
  assert.equal(result.gate_decision, "ABSTAIN");
  assert.equal(result.selective_should_recall, result.v1_should_recall);
  assert.equal(result.safe_skip_changed_v1, false);
});

test("useful SAFE_SKIP reduces V1 false positives and evaluates utility gates", () => {
  const rows = [
    row("c2-useful-no-a", "synthetic_no_a", false, "只分析这份日志，不补充背景。"),
    row("c2-useful-no-b", "synthetic_no_b", false, "只看当前日志。"),
  ];
  const report = evaluateSelectiveRecallGateC2Rows(rows, { contract: contractFor(rows) });
  assert.equal(report.confusion_matrices.v1_current.false_positive, 2);
  assert.equal(report.confusion_matrices.selective_candidate.false_positive, 0);
  assert.equal(report.diagnostics.override_count, 2);
  assert.equal(report.diagnostics.false_positive_reduced_count, 2);
  assert.equal(report.diagnostics.false_positive_reduction_rate, 1);
  assert.equal(report.readiness.utility_gate_pass, true);
});

test("diagnostics stay bounded and never contain prompt bodies", () => {
  const prompt = "SECRET_PROMPT_BODY_7f9c 只分析这份日志，不补充背景。";
  const rows = [row("c2-bounded", "synthetic_no", false, prompt)];
  const report = evaluateSelectiveRecallGateC2Rows(rows, { contract: contractFor(rows) });
  assert.equal(JSON.stringify(report.diagnostics).includes(prompt), false);
  assert.deepEqual(Object.keys(report.diagnostics.unsafe_safe_skip_cases[0] || {}), []);
  assert.equal(report.evidence_role, SELECTIVE_RECALL_GATE_C2_EVIDENCE_ROLE);
  assert.equal(report.independent_readiness_evidence, false);
  assert.equal(report.authority, "OFFLINE ONLY / NOT RUNTIME AUTHORIZED");
});

test("invalid C2 schema is rejected without requiring semantic labels", () => {
  const rows = [{
    schema_version: 2,
    turn_id: "c2-invalid",
    family: "synthetic_no",
    prompt: "只分析这份日志。",
    expected_should_recall: false,
    label_confidence: "medium",
    annotator: "wrong-annotator",
  }];
  const report = evaluateSelectiveRecallGateC2Rows(rows, {
    contract: createSelectiveRecallGateC2Contract({
      expected_count: 1,
      expected_yes: 0,
      expected_no: 1,
      expected_family_count: 1,
      rows_per_family: 1,
      allowed_families: ["synthetic_no"],
    }),
  });
  assert.equal(report.validation.valid, false);
  assert.equal(report.validation.row_errors.length, 1);
  assert.equal(report.readiness.dataset_contract_valid, false);
  assert.equal(report.readiness.hard_safety_gate_pass, false);
});

test("explicit future family allowlist is enforced", () => {
  const rows = [
    row("c2-family-a", "family_a", false, "只分析当前输入。"),
    row("c2-family-b", "family_b", false, "只看当前日志。"),
  ];
  const contract = createSelectiveRecallGateC2Contract({
    expected_count: 2,
    expected_yes: 0,
    expected_no: 2,
    expected_family_count: 2,
    rows_per_family: 1,
    allowed_families: ["family_a", "family_b"],
  });
  assert.equal(validateSelectiveRecallGateC2Dataset(rows, contract).valid, true);
  rows[1].family = "not_allowed";
  assert.equal(validateSelectiveRecallGateC2Dataset(rows, contract).valid, false);
});
