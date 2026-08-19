import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  AUTO_RECALL_POLICY_EVALUATION_DATASET_CONTRACT,
  AUTO_RECALL_POLICY_HOLDOUT_V2B3_CONTRACT,
  AUTO_RECALL_POLICY_HOLDOUT_V2B3_FAMILIES,
  validateAutoRecallPolicyEvaluationDataset,
} from "../lib/recall/auto-recall-policy-evaluation.js";
import {
  assessAutoRecallPolicyHoldoutV2B3,
  buildAutoRecallPolicyHoldoutV2B3Diagnostics,
  evaluateAutoRecallPolicyHoldoutV2B3Jsonl,
  evaluateAutoRecallPolicyHoldoutV2B3Rows,
} from "../lib/recall/auto-recall-policy-holdout-v2b3.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(repoRoot, "test/fixtures/auto-recall-policy-holdout.v2b3.jsonl");
const scriptPath = resolve(repoRoot, "bin/evaluate-auto-recall-policy-v2b3.js");

function fixtureContent() {
  return readFileSync(fixturePath, "utf8");
}

function fixtureRows() {
  return fixtureContent().trim().split(/\r?\n/u).map(line => JSON.parse(line));
}

function fixtureReport() {
  return evaluateAutoRecallPolicyHoldoutV2B3Jsonl(fixtureContent());
}

test("v2-B3 fixture is exactly frozen, balanced, and family-complete", () => {
  const rows = fixtureRows();
  const ids = new Set(rows.map(row => row.turn_id));
  const familyCounts = new Map();
  for (const row of rows) {
    familyCounts.set(row.family, (familyCounts.get(row.family) || 0) + 1);
    assert.equal(row.schema_version, 1);
    assert.equal(row.label_confidence, "high");
    assert.equal(row.annotator, "v2b3_planner_holdout");
    assert.equal(row.disclosure_level, row.expected_should_recall ? "memory_card" : "none");
    assert.equal(row.recall_intent.includes("none"), row.recall_intent.length === 1);
  }

  assert.equal(rows.length, 48);
  assert.equal(ids.size, 48);
  assert.equal(rows.filter(row => row.expected_should_recall).length, 24);
  assert.equal(rows.filter(row => !row.expected_should_recall).length, 24);
  assert.deepEqual([...familyCounts.keys()], AUTO_RECALL_POLICY_HOLDOUT_V2B3_FAMILIES);
  for (const family of AUTO_RECALL_POLICY_HOLDOUT_V2B3_FAMILIES) {
    assert.equal(familyCounts.get(family), 4, family);
  }
});

test("B3 evaluator accepts its family contract while B1 keeps its default contract", () => {
  const row = {
    turn_id: "b3_contract_probe",
    family: "implicit_project_state_holdout",
    schema_version: 1,
    prompt: "当前项目还剩哪些工作？",
    task_intent: "answer_question",
    recall_intent: ["project_state", "task_state"],
    expected_should_recall: true,
  };
  const b3 = validateAutoRecallPolicyEvaluationDataset([row], {
    ...AUTO_RECALL_POLICY_HOLDOUT_V2B3_CONTRACT,
    expected_count: 1,
    expected_yes: 1,
    expected_no: 0,
    required_families: ["implicit_project_state_holdout"],
    allowed_families: ["implicit_project_state_holdout"],
  });
  const b1 = validateAutoRecallPolicyEvaluationDataset([row], {
    ...AUTO_RECALL_POLICY_EVALUATION_DATASET_CONTRACT,
    expected_count: 1,
    expected_yes: 1,
    expected_no: 0,
    required_families: ["current_input_transformation"],
  });
  assert.equal(b3.valid, true);
  assert.equal(b1.valid, false);
  assert.equal(b1.row_errors[0].errors.includes("family_unknown"), true);
});

test("B3 report separates oracle, runtime, semantic-only, and policy errors", () => {
  const report = fixtureReport();
  assert.equal(report.b3_evaluator_status, "PASS");
  assert.equal(report.validation.valid, true);
  assert.deepEqual(report.dataset, {
    total: 48,
    yes: 24,
    no: 24,
    family_counts: report.validation.summary.family_counts,
  });
  assert.deepEqual(report.confusion_matrices.v2_oracle_policy, {
    total: 48,
    scored: 48,
    invalid: 0,
    true_positive: 24,
    true_negative: 24,
    false_positive: 0,
    false_negative: 0,
    accuracy: 1,
    precision: 1,
    recall: 1,
  });
  assert.deepEqual(report.confusion_matrices.v2_runtime_candidate, {
    total: 48,
    scored: 48,
    invalid: 0,
    true_positive: 7,
    true_negative: 19,
    false_positive: 5,
    false_negative: 17,
    accuracy: 0.5417,
    precision: 0.5833,
    recall: 0.2917,
  });
  assert.equal(report.diagnostics.task_intent_mismatch_count, 14);
  assert.equal(report.diagnostics.recall_intent_mismatch_count, 25);
  assert.equal(report.diagnostics.semantic_only_mismatch_count, 11);
  assert.equal(report.diagnostics.policy_decision_error_count, 22);
  assert.equal(report.diagnostics.runtime_false_positive_count, 5);
  assert.equal(report.diagnostics.runtime_false_negative_count, 17);
  assert.equal(report.readiness.dataset_contract_valid, true);
  assert.equal(report.readiness.oracle_gate_pass, true);
  assert.equal(report.readiness.quantitative_gate_pass, false);
  assert.equal(report.readiness.family_gate_pass, false);
  assert.equal(report.readiness.overall_status, "PASS_WITH_FINDINGS / HOLDOUT NOT READY");
  assert.equal(report.readiness.candidate_policy_status, "NOT RUNTIME AUTHORIZED");
  assert.equal(JSON.stringify(report).includes("memory-engine 目前卡在哪一环"), false);
});

test("B3 readiness uses inclusive quantitative thresholds and family concentration", () => {
  const familyCounts = Object.fromEntries(
    AUTO_RECALL_POLICY_HOLDOUT_V2B3_FAMILIES.map(family => [family, 4]),
  );
  const base = {
    validation: {
      valid: true,
      summary: { total: 48, expected_yes: 24, expected_no: 24, family_counts: familyCounts },
    },
    results: [],
    confusion_matrices: {
      v2_oracle_policy: { false_positive: 0, false_negative: 0, invalid: 0 },
      v2_runtime_candidate: { precision: 0.9, recall: 0.9, false_positive: 2, false_negative: 2 },
    },
  };
  const boundary = assessAutoRecallPolicyHoldoutV2B3(base);
  assert.equal(boundary.readiness.quantitative_gate_pass, true);
  assert.equal(boundary.readiness.family_gate_pass, true);
  assert.equal(boundary.readiness.overall_status, "PASS / READY FOR POLICY AUTHORITY REVIEW");

  const concentrated = assessAutoRecallPolicyHoldoutV2B3({
    ...base,
    results: [
      { family: AUTO_RECALL_POLICY_HOLDOUT_V2B3_FAMILIES[0], expected: { should_recall: true }, v2_runtime_candidate: { should_recall: false }, classification: {} },
      { family: AUTO_RECALL_POLICY_HOLDOUT_V2B3_FAMILIES[0], expected: { should_recall: true }, v2_runtime_candidate: { should_recall: false }, classification: {} },
    ],
  });
  assert.equal(concentrated.readiness.family_gate_pass, false);
  assert.equal(concentrated.readiness.overall_status, "PASS_WITH_FINDINGS / HOLDOUT NOT READY");

  const belowBoundary = assessAutoRecallPolicyHoldoutV2B3({
    ...base,
    confusion_matrices: {
      ...base.confusion_matrices,
      v2_runtime_candidate: { precision: 0.8999, recall: 0.9, false_positive: 2, false_negative: 2 },
    },
  });
  assert.equal(belowBoundary.readiness.quantitative_gate_pass, false);
});

test("semantic subtype mismatch is not counted as policy decision error when the boolean decision agrees", () => {
  const diagnostics = buildAutoRecallPolicyHoldoutV2B3Diagnostics({
    results: [
      {
        turn_id: "semantic_only",
        family: "implicit_project_state_holdout",
        expected: { should_recall: true },
        v2_runtime_candidate: { should_recall: true },
        classification: { task_intent_match: false, recall_intent_match: true },
      },
      {
        turn_id: "policy_error",
        family: "implicit_project_state_holdout",
        expected: { should_recall: true },
        v2_runtime_candidate: { should_recall: false },
        classification: { task_intent_match: true, recall_intent_match: false },
      },
    ],
  });
  assert.deepEqual(diagnostics.semantic_only_mismatch_case_ids, ["semantic_only"]);
  assert.equal(diagnostics.semantic_only_mismatch_count, 1);
  assert.equal(diagnostics.policy_decision_error_count, 1);
});

test("invalid oracle contract blocks B3 readiness instead of becoming a classifier result", () => {
  const family = "implicit_project_state_holdout";
  const report = evaluateAutoRecallPolicyHoldoutV2B3Rows([{
    turn_id: "invalid_b3_oracle",
    family,
    schema_version: 1,
    prompt: "当前项目还剩哪些工作？",
    task_intent: "answer_question",
    recall_intent: ["none", "project_state"],
    expected_should_recall: true,
  }], {
    contract: {
      ...AUTO_RECALL_POLICY_HOLDOUT_V2B3_CONTRACT,
      expected_count: 1,
      expected_yes: 1,
      expected_no: 0,
      required_families: [family],
      allowed_families: [family],
    },
  });
  assert.equal(report.validation.valid, false);
  assert.equal(report.readiness.oracle_gate_pass, false);
  assert.equal(report.readiness.overall_status, "BLOCKED / HOLDOUT CONTRACT INVALID");
});

test("B3 CLI is read-only and emits the frozen evaluation report", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.equal((result.stderr || "").trim(), "");
  const report = JSON.parse(result.stdout);
  assert.equal(report.dataset.total, 48);
  assert.equal(report.dataset.yes, 24);
  assert.equal(report.dataset.no, 24);
  assert.equal(report.b3_evaluator_status, "PASS");
  assert.equal(report.side_effects.db_writes, false);
  assert.equal(report.side_effects.network, false);
  assert.equal(report.side_effects.runtime_report_files, false);
});
