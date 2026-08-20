import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  parseSelectiveRecallGateHoldoutV2C2Jsonl,
  SELECTIVE_RECALL_GATE_HOLDOUT_V2C2_CONTRACT,
  SELECTIVE_RECALL_GATE_HOLDOUT_V2C2_FAMILIES,
} from "../lib/recall/selective-recall-gate-holdout-v2c2.js";

const FIXTURE_PATH = "test/fixtures/selective-recall-gate-holdout.v2c2.jsonl";
const REQUIRED_KEYS = [
  "annotator",
  "expected_should_recall",
  "family",
  "label_confidence",
  "prompt",
  "schema_version",
  "turn_id",
];

test("C2 fresh fixture is exactly the Planner-specified static contract", () => {
  const parsed = parseSelectiveRecallGateHoldoutV2C2Jsonl(
    readFileSync(FIXTURE_PATH, "utf8"),
  );
  assert.deepEqual(parsed.parse_errors, []);
  assert.equal(parsed.validation.valid, true);
  assert.equal(parsed.rows.length, 48);
  assert.equal(parsed.validation.summary.expected_yes, 24);
  assert.equal(parsed.validation.summary.expected_no, 24);
  assert.deepEqual(
    Object.keys(parsed.validation.summary.family_counts).sort(),
    [...SELECTIVE_RECALL_GATE_HOLDOUT_V2C2_FAMILIES].sort(),
  );
  assert.equal(SELECTIVE_RECALL_GATE_HOLDOUT_V2C2_CONTRACT.expected_count, 48);
  assert.equal(SELECTIVE_RECALL_GATE_HOLDOUT_V2C2_CONTRACT.expected_family_count, 12);
  assert.equal(SELECTIVE_RECALL_GATE_HOLDOUT_V2C2_CONTRACT.rows_per_family, 4);
});

test("C2 fixture has unique IDs and a 2/2 behavioral balance in every family", () => {
  const parsed = parseSelectiveRecallGateHoldoutV2C2Jsonl(
    readFileSync(FIXTURE_PATH, "utf8"),
  );
  const ids = new Set(parsed.rows.map(row => row.turn_id));
  assert.equal(ids.size, 48);

  for (const family of SELECTIVE_RECALL_GATE_HOLDOUT_V2C2_FAMILIES) {
    const rows = parsed.rows.filter(row => row.family === family);
    assert.equal(rows.length, 4, family);
    assert.equal(rows.filter(row => row.expected_should_recall === true).length, 2, family);
    assert.equal(rows.filter(row => row.expected_should_recall === false).length, 2, family);
  }
});

test("C2 fixture rows contain only minimal behavioral labels", () => {
  const parsed = parseSelectiveRecallGateHoldoutV2C2Jsonl(
    readFileSync(FIXTURE_PATH, "utf8"),
  );
  for (const row of parsed.rows) {
    assert.deepEqual(Object.keys(row).sort(), REQUIRED_KEYS);
    assert.equal(row.schema_version, 1);
    assert.equal(row.label_confidence, "high");
    assert.equal(row.annotator, "v2c2_planner_holdout");
    assert.equal("task_intent" in row, false);
    assert.equal("recall_intent" in row, false);
  }
});

test("C2 static wrapper has no decision-evaluation or gate execution call", () => {
  const source = readFileSync("lib/recall/selective-recall-gate-holdout-v2c2.js", "utf8");
  for (const forbidden of [
    "evaluateSelectiveRecallGateC2Rows",
    "evaluateSelectiveRecallGateC2Jsonl",
    "classifySelectiveRecallGate",
    "applySelectiveRecallGateToV1",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
