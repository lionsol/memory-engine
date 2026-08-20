import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  CANDIDATE_DISCLOSURE_HOLDOUT_ANNOTATOR,
  CANDIDATE_DISCLOSURE_HOLDOUT_CONTRACT,
  CANDIDATE_DISCLOSURE_HOLDOUT_DATASET_ID,
  CANDIDATE_DISCLOSURE_HOLDOUT_FAMILIES,
  validateCandidateDisclosureHoldoutFixture,
  validateCandidateDisclosureHoldoutRow,
} from "../../lib/recall/disclosure/candidate-disclosure-holdout.js";

const FIXTURE_PATH = new URL("../../test/fixtures/retrieval-disclosure-holdout.v1.jsonl", import.meta.url);
const VALIDATOR_PATH = new URL("../../lib/recall/disclosure/candidate-disclosure-holdout.js", import.meta.url);
const EXPECTED_FIXTURE_SHA256 = "7b9a1ced3c78584f9b746e63a03a90d9ba3f9bda58a3b72986a7f89bf9df055a";

function readFixture() {
  return readFileSync(FIXTURE_PATH, "utf8")
    .split("\n")
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line));
}

test("a valid holdout row satisfies the candidate-level schema", () => {
  const result = validateCandidateDisclosureHoldoutRow(readFixture()[0]);
  assert.deepEqual(result, { valid: true, diagnostics: [] });
});

test("row validation rejects invalid enum, boolean, and disclosure consistency", () => {
  const invalid = structuredClone(readFixture()[0]);
  invalid.candidates[0].label.expected_disclosure = "RAW";
  invalid.candidates[0].label.safe_to_disclose = "true";
  const result = validateCandidateDisclosureHoldoutRow(invalid);

  assert.equal(result.valid, false);
  assert.equal(result.diagnostics.some(item => item.code === "invalid_expected_disclosure"), true);
  assert.equal(result.diagnostics.some(item => item.code === "invalid_boolean"), true);

  const inconsistent = structuredClone(readFixture()[0]);
  inconsistent.candidates[0].label.safe_to_disclose = false;
  inconsistent.candidates[0].label.expected_disclosure = "CARD";
  const consistencyResult = validateCandidateDisclosureHoldoutRow(inconsistent);
  assert.equal(consistencyResult.valid, false);
  assert.equal(consistencyResult.diagnostics.some(item => item.code === "expected_disclosure_safety_mismatch"), true);
});

test("fixture has 48 rows, twelve balanced families, and one dataset identity", () => {
  const rows = readFixture();
  const result = validateCandidateDisclosureHoldoutFixture(rows);
  const familyCounts = Object.fromEntries(CANDIDATE_DISCLOSURE_HOLDOUT_FAMILIES.map(family => [
    family,
    rows.filter(row => row.family === family).length,
  ]));
  const answerBearingCounts = Object.fromEntries(CANDIDATE_DISCLOSURE_HOLDOUT_FAMILIES.map(family => [
    family,
    rows.filter(row => row.family === family && row.candidates.some(candidate => candidate.label.answer_bearing)).length,
  ]));

  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(rows.length, 48);
  assert.deepEqual([...new Set(rows.map(row => row.dataset_id))], [CANDIDATE_DISCLOSURE_HOLDOUT_DATASET_ID]);
  assert.deepEqual(Object.keys(familyCounts), [...CANDIDATE_DISCLOSURE_HOLDOUT_FAMILIES]);
  assert.deepEqual(Object.values(familyCounts), [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]);
  assert.deepEqual(Object.values(answerBearingCounts), [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]);
  assert.equal(new Set(rows.map(row => row.turn_id)).size, 48);
  assert.equal(rows.every(row => row.schema_version === 1), true);
  assert.equal(rows.every(row => row.label_confidence === "high"), true);
  assert.equal(rows.every(row => row.annotator === CANDIDATE_DISCLOSURE_HOLDOUT_ANNOTATOR), true);
  assert.equal(rows.every(row => !Object.hasOwn(row, "task_intent") && !Object.hasOwn(row, "recall_intent")), true);
});

test("candidate IDs are unique within each holdout row", () => {
  const invalid = structuredClone(readFixture()[0]);
  invalid.candidates[1].candidate_id = invalid.candidates[0].candidate_id;
  const result = validateCandidateDisclosureHoldoutFixture([invalid]);

  assert.equal(result.valid, false);
  assert.equal(result.diagnostics.some(item => item.code === "duplicate_candidate_id"), true);
});

test("fixture hash freezes the holdout before any evaluation", () => {
  const bytes = readFileSync(FIXTURE_PATH);
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.equal(digest, EXPECTED_FIXTURE_SHA256);
  assert.equal(CANDIDATE_DISCLOSURE_HOLDOUT_CONTRACT.evidence_role, "future_independent_holdout");
});

test("holdout validator has no selector or evaluator dependency", () => {
  const source = readFileSync(VALIDATOR_PATH, "utf8");
  assert.equal(source.includes("selectDisclosureCandidates"), false);
  assert.equal(source.includes("evaluateCandidateDisclosureFixture"), false);
});
