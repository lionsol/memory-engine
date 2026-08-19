import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  AUTO_RECALL_POLICY_EVALUATION_DATASET_CONTRACT,
  AUTO_RECALL_POLICY_EVALUATION_FAMILIES,
  evaluateAutoRecallPolicyDataset,
  evaluateAutoRecallPolicyDatasetJsonl,
  mapRecallIntentToCandidatePolicy,
} from "../lib/recall/auto-recall-policy-evaluation.js";
import { AUTO_RECALL_RECALL_INTENTS } from "../lib/recall/auto-recall-intent-contract.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(repoRoot, "test/fixtures/auto-recall-policy-eval.v2b1.jsonl");
const scriptPath = resolve(repoRoot, "bin/evaluate-auto-recall-policy-v2b1.js");

function fixtureContent() {
  return readFileSync(fixturePath, "utf8");
}

function fixtureReport() {
  return evaluateAutoRecallPolicyDatasetJsonl(
    fixtureContent(),
    AUTO_RECALL_POLICY_EVALUATION_DATASET_CONTRACT,
  );
}

test("v2-B1 candidate mapping is none-exclusive and evaluation-only", () => {
  assert.deepEqual(mapRecallIntentToCandidatePolicy(["none"]), {
    valid: true,
    should_recall: false,
    reason: "no_memory_intent",
    error: null,
  });

  for (const intent of AUTO_RECALL_RECALL_INTENTS.filter(value => value !== "none")) {
    const result = mapRecallIntentToCandidatePolicy([intent]);
    assert.equal(result.valid, true, intent);
    assert.equal(result.should_recall, true, intent);
    assert.equal(result.reason, "historical_memory_intent", intent);
  }

  for (const invalid of [[], ["none", "project_state"], ["not_a_recall_intent"]]) {
    const result = mapRecallIntentToCandidatePolicy(invalid);
    assert.equal(result.valid, false);
    assert.equal(result.should_recall, null);
    assert.equal(result.error, "invalid_recall_intent_contract");
  }
});

test("v2-B1 fixture is independent, balanced, and covers all required families", () => {
  const report = fixtureReport();
  assert.equal(report.validation.valid, true);
  assert.equal(report.summary.total, 36);
  assert.equal(report.summary.expected_yes, 18);
  assert.equal(report.summary.expected_no, 18);
  assert.deepEqual(
    Object.keys(report.validation.summary.family_counts).sort(),
    [...AUTO_RECALL_POLICY_EVALUATION_FAMILIES].sort(),
  );
  for (const family of AUTO_RECALL_POLICY_EVALUATION_FAMILIES) {
    assert.equal(report.validation.summary.family_counts[family], 4, family);
  }
});

test("three-way policy metrics separate current, oracle, and runtime-candidate behavior", () => {
  const report = fixtureReport();
  assert.deepEqual(report.confusion_matrices.v1_current, {
    total: 36,
    scored: 36,
    invalid: 0,
    true_positive: 18,
    true_negative: 5,
    false_positive: 13,
    false_negative: 0,
    accuracy: 0.6389,
    precision: 0.5806,
    recall: 1,
  });
  assert.deepEqual(report.confusion_matrices.v2_oracle_policy, {
    total: 36,
    scored: 36,
    invalid: 0,
    true_positive: 18,
    true_negative: 18,
    false_positive: 0,
    false_negative: 0,
    accuracy: 1,
    precision: 1,
    recall: 1,
  });
  assert.deepEqual(report.confusion_matrices.v2_runtime_candidate, {
    total: 36,
    scored: 36,
    invalid: 0,
    true_positive: 18,
    true_negative: 18,
    false_positive: 0,
    false_negative: 0,
    accuracy: 1,
    precision: 1,
    recall: 1,
  });
  assert.equal(report.policy.authority, "evaluation_only");
  assert.equal(report.policy.task_intent_authority, false);
});

test("diagnostics provide bounded classifier and policy deltas without prompt bodies", () => {
  const report = fixtureReport();
  assert.equal(report.diagnostics.task_intent_mismatch_count, 0);
  assert.equal(report.diagnostics.recall_intent_mismatch_count, 0);
  assert.equal(report.diagnostics.v1_false_positive_count, 13);
  assert.equal(report.diagnostics.v1_false_negative_count, 0);
  assert.equal(report.diagnostics.oracle_false_positive_count, 0);
  assert.equal(report.diagnostics.oracle_false_negative_count, 0);
  assert.equal(report.diagnostics.runtime_candidate_false_positive_count, 0);
  assert.equal(report.diagnostics.runtime_candidate_false_negative_count, 0);
  assert.equal(report.diagnostics.v1_to_runtime_changed_count, 13);
  assert.equal(report.diagnostics.false_positive_reduced_count, 13);
  assert.equal(report.diagnostics.false_negative_added_count, 0);
  assert.equal(report.diagnostics.root_cause_counts.CLASSIFIER_GAP, 0);
  assert.equal(report.diagnostics.root_cause_counts.POLICY_MAPPING_GAP, 0);
  assert.equal(report.diagnostics.root_cause_counts.FALSE_POSITIVE_REMOVED, 13);
  assert.equal(report.diagnostics.root_cause_counts.FALSE_NEGATIVE_INTRODUCED, 0);
  assert.equal(JSON.stringify(report).includes("memory-engine L2 现在还剩什么"), false);
  assert.equal(report.side_effects.db_writes, false);
  assert.equal(report.side_effects.network, false);
  assert.equal(report.side_effects.llm, false);
  assert.equal(report.side_effects.retrieval, false);
});

test("root-cause decomposition distinguishes mapping and classifier gaps", () => {
  const rows = [
    {
      turn_id: "decomp_policy_mapping_gap",
      family: "fresh_current_analysis",
      schema_version: 1,
      prompt: "请润色这段文本。",
      task_intent: "rewrite_current_text",
      recall_intent: ["none"],
      expected_should_recall: true,
    },
    {
      turn_id: "decomp_classifier_gap",
      family: "implicit_project_state",
      schema_version: 1,
      prompt: "普通问题",
      task_intent: "answer_question",
      recall_intent: ["project_state", "task_state"],
      expected_should_recall: true,
    },
    {
      turn_id: "decomp_false_positive_removed",
      family: "ambiguous_minimal_pairs",
      schema_version: 1,
      prompt: "这个方案怎么样？",
      task_intent: "answer_question",
      recall_intent: ["none"],
      expected_should_recall: false,
    },
    {
      turn_id: "decomp_false_negative_introduced",
      family: "ambiguous_minimal_pairs",
      schema_version: 1,
      prompt: "普通问题",
      task_intent: "answer_question",
      recall_intent: ["prior_decision", "project_state"],
      expected_should_recall: true,
    },
  ];
  const report = evaluateAutoRecallPolicyDataset(rows);
  const byId = new Map(report.results.map(result => [result.turn_id, result]));

  assert.deepEqual(byId.get("decomp_policy_mapping_gap").root_causes, ["POLICY_MAPPING_GAP"]);
  assert.deepEqual(byId.get("decomp_classifier_gap").root_causes, [
    "CLASSIFIER_GAP",
    "FALSE_NEGATIVE_INTRODUCED",
  ]);
  assert.deepEqual(byId.get("decomp_false_positive_removed").root_causes, ["FALSE_POSITIVE_REMOVED"]);
  assert.deepEqual(byId.get("decomp_false_negative_introduced").root_causes, [
    "CLASSIFIER_GAP",
    "FALSE_NEGATIVE_INTRODUCED",
  ]);
});

test("invalid dataset rows remain diagnosable instead of aborting the report", () => {
  const report = evaluateAutoRecallPolicyDataset([{
    turn_id: "invalid_policy_contract",
    family: "fresh_current_analysis",
    schema_version: 1,
    prompt: "普通问题",
    task_intent: "answer_question",
    recall_intent: ["none", "project_state"],
    expected_should_recall: false,
  }]);
  assert.equal(report.validation.valid, false);
  assert.equal(report.validation.row_errors.length, 1);
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].valid, false);
  assert.equal(report.results[0].v2_oracle.error, "invalid_recall_intent_contract");
});

test("offline evaluator CLI emits JSON without side effects", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.equal((result.stderr || "").trim(), "");
  const report = JSON.parse(result.stdout);
  assert.equal(report.summary.total, 36);
  assert.equal(report.summary.expected_yes, 18);
  assert.equal(report.summary.expected_no, 18);
  assert.equal(report.policy.authority, "evaluation_only");
  assert.equal(report.side_effects.db_writes, false);
  assert.equal(report.side_effects.runtime_report_files, false);
});
