import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  REDACTED_CARD_HOLDOUT_ANNOTATOR,
  REDACTED_CARD_HOLDOUT_DATASET_ID,
  REDACTED_CARD_HOLDOUT_FAMILIES,
  validateRedactedCardHoldoutFixture,
  validateRedactedCardHoldoutRow,
} from "../../lib/recall/disclosure/redacted-card-holdout.js";

const FIXTURE_PATH = new URL("../../test/fixtures/redacted-card-holdout.v1.jsonl", import.meta.url);
const C1_FIXTURE_PATH = new URL("../../test/fixtures/memory-projection-holdout.v1.jsonl", import.meta.url);
const D2_FIXTURE_PATH = new URL("../../test/fixtures/retrieval-disclosure-holdout.v2.jsonl", import.meta.url);
const VALIDATOR_PATH = new URL("../../lib/recall/disclosure/redacted-card-holdout.js", import.meta.url);
const FREEZE_RECORD_PATH = new URL("../../docs/redacted-card-holdout-v1-freeze.md", import.meta.url);
const EXPECTED_FIXTURE_SHA256 = "55d1d876b111bc7e3dcc7dcadb6761721cb6b05568edc27cc0ff1d81de5a5d48";
const EXPECTED_C1_FIXTURE_SHA256 = "cd0af809fc1e774dd9d782d5a9c20fa231f5a406f62006c4f7a6a66a0747d919";
const EXPECTED_D2_FIXTURE_SHA256 = "d372ebac9bf4d80aaac85dfb0d43eacec792291871b744b7812009ac06d071bd";

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("redacted-card holdout has exact independent schema and balance", () => {
  const rows = readJsonl(FIXTURE_PATH);
  const result = validateRedactedCardHoldoutFixture(rows);
  const familyCounts = Object.fromEntries(REDACTED_CARD_HOLDOUT_FAMILIES.map(family => [
    family,
    rows.filter(row => row.family === family).length,
  ]));
  const answerBearingCounts = Object.fromEntries(REDACTED_CARD_HOLDOUT_FAMILIES.map(family => [
    family,
    rows.filter(row => row.family === family && row.label.answer_bearing === true).length,
  ]));
  const nonAnswerBearingCounts = Object.fromEntries(REDACTED_CARD_HOLDOUT_FAMILIES.map(family => [
    family,
    rows.filter(row => row.family === family && row.label.answer_bearing === false).length,
  ]));
  const coveredFields = new Set(rows.flatMap(row => row.redaction_plan.directives.map(directive => directive.field)));

  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(rows.length, 12);
  assert.equal(sha256(FIXTURE_PATH), EXPECTED_FIXTURE_SHA256);
  assert.deepEqual([...new Set(rows.map(row => row.dataset_id))], [REDACTED_CARD_HOLDOUT_DATASET_ID]);
  assert.deepEqual(Object.keys(familyCounts), [...REDACTED_CARD_HOLDOUT_FAMILIES]);
  assert.deepEqual(Object.values(familyCounts), [2, 2, 2, 2, 2, 2]);
  assert.deepEqual(Object.values(answerBearingCounts), [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(Object.values(nonAnswerBearingCounts), [1, 1, 1, 1, 1, 1]);
  assert.equal(new Set(rows.map(row => row.case_id)).size, 12);
  assert.deepEqual([...coveredFields].sort(), ["salience_reason", "source_hint", "summary", "title"]);
  assert.equal(rows.every(row => row.label.expected_structural_compatibility === true), true);
  assert.equal(rows.every(row => row.label.surface_safety.forbidden_literals.length > 0), true);
  assert.equal(rows.filter(row => row.label.answer_bearing).every(row => (
    row.label.semantic_preservation.required === true &&
    row.label.semantic_preservation.required_literals.length > 0
  )), true);
  assert.equal(rows.filter(row => !row.label.answer_bearing).every(row => (
    row.label.semantic_preservation.required === false &&
    row.label.semantic_preservation.required_literals.length === 0
  )), true);
  assert.equal(rows.every(row => row.label_confidence === "high"), true);
  assert.equal(rows.every(row => row.annotator === REDACTED_CARD_HOLDOUT_ANNOTATOR), true);
});

test("holdout labels contain acceptance constraints but no expected output or capability", () => {
  const rows = readJsonl(FIXTURE_PATH);
  const forbiddenKeys = [
    "expected_candidate_payload",
    "expected_full_projected_artifact",
    "expected_projection_artifact",
    "expected_output",
    "replacement",
    "expected_capability",
    "expected_disclosure_authority",
  ];
  for (const row of rows) {
    for (const key of forbiddenKeys) {
      assert.equal(Object.hasOwn(row.label, key), false, `${row.case_id}:${key}`);
    }
    assert.equal(Object.hasOwn(row, "capability"), false, row.case_id);
    assert.equal(Object.hasOwn(row, "safe_to_disclose"), false, row.case_id);
  }
  const serialized = JSON.stringify(rows);
  for (const literal of [
    "UNIT_SECRET_RED_9001",
    "UNIT_SECRET_RED_9002",
    "UNIT_ANSWER_ANCHOR_RED_01",
  ]) {
    assert.equal(serialized.includes(literal), false, literal);
  }
});

test("validator fails closed for output and authority label additions", () => {
  const valid = readJsonl(FIXTURE_PATH)[0];

  const outputLabel = structuredClone(valid);
  outputLabel.label.expected_output = { summary: "[REDACTED]" };
  assert.equal(validateRedactedCardHoldoutRow(outputLabel).valid, false);

  const capabilityLabel = structuredClone(valid);
  capabilityLabel.label.expected_capability = "CARD_DISCLOSABLE";
  assert.equal(validateRedactedCardHoldoutRow(capabilityLabel).valid, false);
});

test("C.1 and D.2 frozen fixtures remain byte-identical", () => {
  assert.equal(sha256(C1_FIXTURE_PATH), EXPECTED_C1_FIXTURE_SHA256);
  assert.equal(sha256(D2_FIXTURE_PATH), EXPECTED_D2_FIXTURE_SHA256);
  assert.notEqual(FIXTURE_PATH.href, C1_FIXTURE_PATH.href);
  assert.notEqual(FIXTURE_PATH.href, D2_FIXTURE_PATH.href);
});

test("holdout validator has no prototype, evaluator, authority, storage, or network dependency", () => {
  const source = readFileSync(VALIDATOR_PATH, "utf8");
  for (const forbidden of [
    "redacted-card-prototype.js",
    "projection-aware-evaluator.js",
    "projection-artifact.js",
    "disclosure-capability-shadow-evaluator.js",
    "disclosure-selector.js",
    "admissibility-policy.js",
    "better-sqlite3",
    "node:sqlite",
    "readFileSync",
    "fetch(",
    "http://",
    "https://",
    "test/fixtures",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test("freeze record binds the independent C.6 contract", () => {
  const record = readFileSync(FREEZE_RECORD_PATH, "utf8");
  for (const value of [
    "redacted-card-holdout-v1",
    "schema_version | `1`",
    "test/fixtures/redacted-card-holdout.v1.jsonl",
    EXPECTED_FIXTURE_SHA256,
    "row_count | `12`",
    "family_count | `6`",
    "rows_per_family | `2`",
    "answer_bearing_per_family | `1`",
    "non_answer_bearing_per_family | `1`",
    "redacted_card_holdout_v1_synthetic",
    "INDEPENDENT REDACTED_CARD HOLDOUT FROZEN / NOT YET EVALUATED",
    "fresh_post_prototype_holdout_contract",
    "prototype implementation was completed before this fixture",
    "C.1 holdout was not reused",
    "C.5 unit literals were not reused",
    "fixture stores acceptance constraints, not expected output",
    "No evaluation execution occurred.",
  ]) {
    assert.equal(record.includes(value), true, `missing freeze metadata: ${value}`);
  }
});
