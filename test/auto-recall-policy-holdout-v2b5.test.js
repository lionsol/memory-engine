import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  AUTO_RECALL_POLICY_EVALUATION_DATASET_CONTRACT,
  AUTO_RECALL_POLICY_HOLDOUT_V2B5_CONTRACT,
  AUTO_RECALL_POLICY_HOLDOUT_V2B5_FAMILIES,
  validateAutoRecallPolicyEvaluationDataset,
} from "../lib/recall/auto-recall-policy-evaluation.js";
import {
  assessAutoRecallPolicyHoldoutV2B5,
  buildAutoRecallPolicyHoldoutV2B5Diagnostics,
  evaluateAutoRecallPolicyHoldoutV2B5Jsonl,
  evaluateAutoRecallPolicyHoldoutV2B5Rows,
} from "../lib/recall/auto-recall-policy-holdout-v2b5.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(repoRoot, "test/fixtures/auto-recall-policy-holdout.v2b5.jsonl");
const scriptPath = resolve(repoRoot, "bin/evaluate-auto-recall-policy-v2b5.js");

function fixtureContent() {
  return readFileSync(fixturePath, "utf8");
}

function fixtureRows() {
  return fixtureContent().trim().split(/\r?\n/u).map(line => JSON.parse(line));
}

function fixtureReport() {
  return evaluateAutoRecallPolicyHoldoutV2B5Jsonl(fixtureContent());
}

test("v2-B5 fixture is exactly frozen, balanced, and family-complete", () => {
  const physicalLines = fixtureContent().trimEnd().split(/\r?\n/u);
  const rows = fixtureRows();
  const ids = new Set(rows.map(row => row.turn_id));
  const familyCounts = new Map();

  for (const row of rows) {
    familyCounts.set(row.family, (familyCounts.get(row.family) || 0) + 1);
    assert.equal(row.schema_version, 1);
    assert.equal(row.label_confidence, "high");
    assert.equal(row.annotator, "v2b5_planner_holdout");
    assert.equal(row.disclosure_level, row.expected_should_recall ? "memory_card" : "none");
    assert.equal(row.recall_intent.includes("none"), row.recall_intent.length === 1);
    assert.equal(row.recall_intent[0] === "none", row.expected_should_recall === false);
  }

  assert.equal(physicalLines.length, 48);
  assert.equal(rows.length, 48);
  assert.equal(ids.size, 48);
  assert.equal(rows.filter(row => row.expected_should_recall).length, 24);
  assert.equal(rows.filter(row => !row.expected_should_recall).length, 24);
  assert.deepEqual([...familyCounts.keys()], AUTO_RECALL_POLICY_HOLDOUT_V2B5_FAMILIES);
  for (const family of AUTO_RECALL_POLICY_HOLDOUT_V2B5_FAMILIES) {
    assert.equal(familyCounts.get(family), 4, family);
  }

  const markdownQuote = rows.find(row => row.turn_id === "v2b5_q2_markdown_quote_summary");
  assert.match(markdownQuote.prompt, /\n> Earlier we chose option B/u);
});

test("B5 family contract is accepted while B1 default family contract rejects it", () => {
  const row = {
    turn_id: "b5_contract_probe",
    family: AUTO_RECALL_POLICY_HOLDOUT_V2B5_FAMILIES[0],
    schema_version: 1,
    prompt: "当前开发线还剩哪些工作？",
    task_intent: "answer_question",
    recall_intent: ["project_state", "task_state"],
    disclosure_level: "memory_card",
    expected_should_recall: true,
    label_confidence: "high",
    annotator: "v2b5_planner_holdout",
  };
  const b5 = validateAutoRecallPolicyEvaluationDataset([row], {
    ...AUTO_RECALL_POLICY_HOLDOUT_V2B5_CONTRACT,
    expected_count: 1,
    expected_yes: 1,
    expected_no: 0,
    required_families: [AUTO_RECALL_POLICY_HOLDOUT_V2B5_FAMILIES[0]],
    allowed_families: [AUTO_RECALL_POLICY_HOLDOUT_V2B5_FAMILIES[0]],
  });
  const b1 = validateAutoRecallPolicyEvaluationDataset([row], {
    ...AUTO_RECALL_POLICY_EVALUATION_DATASET_CONTRACT,
    expected_count: 1,
    expected_yes: 1,
    expected_no: 0,
    required_families: ["current_input_transformation"],
  });
  assert.equal(b5.valid, true);
  assert.equal(b1.valid, false);
  assert.equal(b1.row_errors[0].errors.includes("family_unknown"), true);
});

test("B5 report carries fresh evidence role, bounded diagnostics, and no runtime authority", () => {
  const report = fixtureReport();
  assert.equal(report.b5_evaluator_status, "PASS");
  assert.equal(report.evidence_role, "fresh_independent_holdout_v2b5");
  assert.equal(report.candidate_policy_status, "NOT RUNTIME AUTHORIZED");
  assert.equal(report.validation.valid, true);
  assert.deepEqual(report.dataset, {
    total: 48,
    yes: 24,
    no: 24,
    family_counts: report.validation.summary.family_counts,
  });
  assert.equal(report.family_metrics.length, 12);
  assert.equal(report.readiness.independent_readiness_evidence, true);
  assert.equal(typeof report.readiness.oracle_gate_pass, "boolean");
  assert.equal(typeof report.readiness.quantitative_gate_pass, "boolean");
  assert.equal(typeof report.readiness.family_gate_pass, "boolean");
  assert.equal(report.readiness.candidate_policy_status, "NOT RUNTIME AUTHORIZED");
  assert.equal(report.side_effects.db_writes, false);
  assert.equal(report.side_effects.network, false);
  assert.equal(report.side_effects.runtime_report_files, false);
});

test("B5 readiness thresholds are inclusive and family errors are bounded", () => {
  const familyCounts = Object.fromEntries(
    AUTO_RECALL_POLICY_HOLDOUT_V2B5_FAMILIES.map(family => [family, 4]),
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
  const boundary = assessAutoRecallPolicyHoldoutV2B5(base);
  assert.equal(boundary.readiness.oracle_gate_pass, true);
  assert.equal(boundary.readiness.quantitative_gate_pass, true);
  assert.equal(boundary.readiness.family_gate_pass, true);
  assert.equal(boundary.readiness.overall_status, "PASS / READY FOR POLICY AUTHORITY REVIEW");

  const concentrated = assessAutoRecallPolicyHoldoutV2B5({
    ...base,
    results: [
      {
        family: AUTO_RECALL_POLICY_HOLDOUT_V2B5_FAMILIES[0],
        expected: { should_recall: true },
        v2_runtime_candidate: { should_recall: false },
        classification: {},
      },
      {
        family: AUTO_RECALL_POLICY_HOLDOUT_V2B5_FAMILIES[0],
        expected: { should_recall: true },
        v2_runtime_candidate: { should_recall: false },
        classification: {},
      },
    ],
  });
  assert.equal(concentrated.readiness.family_gate_pass, false);
  assert.equal(concentrated.readiness.overall_status, "PASS_WITH_FINDINGS / HOLDOUT NOT READY");

  const belowBoundary = assessAutoRecallPolicyHoldoutV2B5({
    ...base,
    confusion_matrices: {
      ...base.confusion_matrices,
      v2_runtime_candidate: { precision: 0.8999, recall: 0.9, false_positive: 2, false_negative: 2 },
    },
  });
  assert.equal(belowBoundary.readiness.quantitative_gate_pass, false);
  assert.equal(belowBoundary.readiness.overall_status, "PASS_WITH_FINDINGS / HOLDOUT NOT READY");
});

test("semantic subtype mismatch is separate from boolean policy error", () => {
  const diagnostics = buildAutoRecallPolicyHoldoutV2B5Diagnostics({
    results: [
      {
        turn_id: "semantic_only",
        family: AUTO_RECALL_POLICY_HOLDOUT_V2B5_FAMILIES[0],
        expected: { should_recall: true },
        v2_runtime_candidate: { should_recall: true },
        classification: { task_intent_match: false, recall_intent_match: true },
      },
      {
        turn_id: "policy_error",
        family: AUTO_RECALL_POLICY_HOLDOUT_V2B5_FAMILIES[0],
        expected: { should_recall: true },
        v2_runtime_candidate: { should_recall: false },
        classification: { task_intent_match: true, recall_intent_match: false },
      },
    ],
  });
  assert.deepEqual(diagnostics.semantic_only_mismatch_case_ids, ["semantic_only"]);
  assert.equal(diagnostics.semantic_only_mismatch_count, 1);
  assert.equal(diagnostics.policy_decision_error_count, 1);
  assert.deepEqual(diagnostics.runtime_false_negative_case_ids, ["policy_error"]);
});

test("invalid oracle contract blocks B5 readiness", () => {
  const family = AUTO_RECALL_POLICY_HOLDOUT_V2B5_FAMILIES[0];
  const report = evaluateAutoRecallPolicyHoldoutV2B5Rows([{
    turn_id: "invalid_b5_oracle",
    family,
    schema_version: 1,
    prompt: "当前项目还剩哪些工作？",
    task_intent: "answer_question",
    recall_intent: ["none", "project_state"],
    disclosure_level: "memory_card",
    expected_should_recall: true,
    label_confidence: "high",
    annotator: "v2b5_planner_holdout",
  }], {
    contract: {
      ...AUTO_RECALL_POLICY_HOLDOUT_V2B5_CONTRACT,
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

test("B5 CLI is read-only and emits the holdout report", () => {
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
  assert.equal(report.b5_evaluator_status, "PASS");
  assert.equal(report.evidence_role, "fresh_independent_holdout_v2b5");
  assert.equal(report.side_effects.db_writes, false);
  assert.equal(report.side_effects.network, false);
  assert.equal(report.side_effects.runtime_report_files, false);
});
