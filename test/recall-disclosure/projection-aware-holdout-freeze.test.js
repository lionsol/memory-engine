import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  PROJECTION_AWARE_HOLDOUT_ANNOTATOR,
  PROJECTION_AWARE_HOLDOUT_CAPABILITIES,
  PROJECTION_AWARE_HOLDOUT_CONTRACT,
  PROJECTION_AWARE_HOLDOUT_DATASET_ID,
  PROJECTION_AWARE_HOLDOUT_DISCLOSURE_AUTHORITIES,
  PROJECTION_AWARE_HOLDOUT_FAMILIES,
  PROJECTION_AWARE_HOLDOUT_PROJECTION_SURFACE,
  normalizeProjectionLiteral,
  validateProjectionAwareHoldoutFixture,
  validateProjectionAwareHoldoutRow,
} from "../../lib/recall/disclosure/projection-aware-holdout.js";

const FIXTURE_PATH = new URL("../../test/fixtures/memory-projection-holdout.v1.jsonl", import.meta.url);
const D2_FIXTURE_PATH = new URL("../../test/fixtures/retrieval-disclosure-holdout.v2.jsonl", import.meta.url);
const VALIDATOR_PATH = new URL("../../lib/recall/disclosure/projection-aware-holdout.js", import.meta.url);
const FREEZE_RECORD_PATH = new URL("../../docs/memory-projection-holdout-v1-freeze.md", import.meta.url);
const EXPECTED_FIXTURE_SHA256 = "cd0af809fc1e774dd9d782d5a9c20fa231f5a406f62006c4f7a6a66a0747d919";
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

test("projection-aware holdout has the exact independent schema and balance", () => {
  const rows = readJsonl(FIXTURE_PATH);
  const result = validateProjectionAwareHoldoutFixture(rows);
  const familyCounts = Object.fromEntries(PROJECTION_AWARE_HOLDOUT_FAMILIES.map(family => [
    family,
    rows.filter(row => row.family === family).length,
  ]));
  const answerBearingCounts = Object.fromEntries(PROJECTION_AWARE_HOLDOUT_FAMILIES.map(family => [
    family,
    rows.filter(row => row.family === family && row.label.answer_bearing === true).length,
  ]));
  const nonAnswerBearingCounts = Object.fromEntries(PROJECTION_AWARE_HOLDOUT_FAMILIES.map(family => [
    family,
    rows.filter(row => row.family === family && row.label.answer_bearing === false).length,
  ]));

  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(rows.length, 24);
  assert.equal(sha256(FIXTURE_PATH), EXPECTED_FIXTURE_SHA256);
  assert.deepEqual([...new Set(rows.map(row => row.dataset_id))], [PROJECTION_AWARE_HOLDOUT_DATASET_ID]);
  assert.deepEqual(Object.keys(familyCounts), [...PROJECTION_AWARE_HOLDOUT_FAMILIES]);
  assert.deepEqual(Object.values(familyCounts), [4, 4, 4, 4, 4, 4]);
  assert.deepEqual(Object.values(answerBearingCounts), [2, 2, 2, 2, 2, 2]);
  assert.deepEqual(Object.values(nonAnswerBearingCounts), [2, 2, 2, 2, 2, 2]);
  assert.equal(new Set(rows.map(row => row.case_id)).size, 24);
  assert.equal(rows.every(row => row.schema_version === 1), true);
  assert.equal(rows.every(row => row.projection_surface === PROJECTION_AWARE_HOLDOUT_PROJECTION_SURFACE), true);
  assert.equal(rows.every(row => row.label_confidence === "high"), true);
  assert.equal(rows.every(row => row.annotator === PROJECTION_AWARE_HOLDOUT_ANNOTATOR), true);
  assert.deepEqual(PROJECTION_AWARE_HOLDOUT_CONTRACT.expected_families, PROJECTION_AWARE_HOLDOUT_FAMILIES);
});

test("literal acceptance is deterministic and capability authority is independent", () => {
  assert.equal(normalizeProjectionLiteral("  engine_db_isolated\r\n"), "ENGINE_DB_ISOLATED");
  assert.equal(normalizeProjectionLiteral("SECRET_ALPHA_7391"), "SECRET_ALPHA_7391");

  const rows = readJsonl(FIXTURE_PATH);
  const blockedAnswers = rows.filter(row => row.family === "capability_blocked" && row.label.answer_bearing === true);
  assert.equal(blockedAnswers.length, 2);
  for (const row of blockedAnswers) {
    assert.equal(row.label.expected_projection_valid, true);
    assert.deepEqual(row.label.surface_safety.forbidden_literals, []);
    assert.equal(row.label.semantic_preservation.required, true);
    assert.equal(row.label.current_v1_1.expected_capability, "RETRIEVAL_ONLY");
    assert.equal(row.label.current_v1_1.expected_disclosure_authority, "NONE");
    assert.equal(row.policy_context.current_safe_to_disclose, true);
    assert.notEqual(row.policy_context.capability_blocker, "none");
  }
  assert.deepEqual(PROJECTION_AWARE_HOLDOUT_CAPABILITIES, ["RETRIEVAL_ONLY", "INTERNAL_CONTEXT", "CARD_DISCLOSABLE"]);
  assert.deepEqual(PROJECTION_AWARE_HOLDOUT_DISCLOSURE_AUTHORITIES, ["NONE", "CARD"]);
});

test("invalid safety, semantic, and current capability labels fail closed", () => {
  const valid = readJsonl(FIXTURE_PATH)[0];

  const invalidSafety = structuredClone(valid);
  invalidSafety.label.surface_safety = { forbidden_literals: "SECRET_ALPHA_7391" };
  assert.equal(validateProjectionAwareHoldoutRow(invalidSafety).valid, false);

  const invalidSemantic = structuredClone(valid);
  invalidSemantic.label.semantic_preservation = { required_literals: [], required: true };
  const semanticResult = validateProjectionAwareHoldoutRow(invalidSemantic);
  assert.equal(semanticResult.valid, false);
  assert.equal(semanticResult.diagnostics.some(item => item.code === "required_semantic_anchor_missing"), true);

  const invalidCapability = structuredClone(valid);
  invalidCapability.label.current_v1_1.expected_capability = "SANITIZED_CARD";
  invalidCapability.label.current_v1_1.expected_disclosure_authority = "CARD";
  const capabilityResult = validateProjectionAwareHoldoutRow(invalidCapability);
  assert.equal(capabilityResult.valid, false);
  assert.equal(capabilityResult.diagnostics.some(item => item.code === "invalid_capability"), true);

  const inconsistentAuthority = structuredClone(valid);
  inconsistentAuthority.label.current_v1_1.expected_disclosure_authority = "NONE";
  const authorityResult = validateProjectionAwareHoldoutRow(inconsistentAuthority);
  assert.equal(authorityResult.valid, false);
  assert.equal(authorityResult.diagnostics.some(item => item.code === "capability_disclosure_mismatch"), true);
});

test("D.2 v2 fixture remains byte-identical and independent", () => {
  assert.equal(sha256(D2_FIXTURE_PATH), EXPECTED_D2_FIXTURE_SHA256);
  assert.notEqual(FIXTURE_PATH.href, D2_FIXTURE_PATH.href);
  const rows = readJsonl(FIXTURE_PATH);
  assert.equal(rows.every(row => row.dataset_id !== "retrieval-disclosure-holdout-v2"), true);
});

test("holdout validator has no projector, selector, evaluator, DB, or network dependency", () => {
  const source = readFileSync(VALIDATOR_PATH, "utf8");
  for (const forbidden of [
    "projectCanonicalMemoryToDisclosureCardArtifact",
    "projectCanonicalMemoryToMemoryCard",
    "selectDisclosureCandidates",
    "evaluateShadowDisclosure",
    "evaluateCandidateDisclosure",
    "candidate-disclosure-evaluation-envelope-v2",
    "better-sqlite3",
    "node:sqlite",
    "fetch(",
    "http://",
    "https://",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test("freeze record binds the D.3-C.1 boundary", () => {
  const record = readFileSync(FREEZE_RECORD_PATH, "utf8");
  for (const value of [
    "memory-projection-holdout-v1",
    "schema_version | `1`",
    "test/fixtures/memory-projection-holdout.v1.jsonl",
    EXPECTED_FIXTURE_SHA256,
    "row_count | `24`",
    "family_count | `6`",
    "rows_per_family | `4`",
    "answer_bearing_per_family | `2`",
    "non_answer_bearing_per_family | `2`",
    "memory_projection_holdout_v1",
    "HOLDOUT CONTRACT FROZEN / NOT YET EVALUATED",
    "D.2 v2 fixture remains byte-identical and unmodified",
    "projection evaluation has not been executed",
    "D.3-C.2",
  ]) {
    assert.equal(record.includes(value), true, `missing freeze metadata: ${value}`);
  }
});
