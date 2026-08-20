import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_ANNOTATOR,
  CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_CONTRACT,
  CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_DATASET_ID,
  CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_FAMILIES,
  validateCandidateDisclosureEnvelopeV2Fixture,
} from "../../lib/recall/disclosure/candidate-disclosure-evaluation-envelope-v2.js";

const V1_FIXTURE_PATH = new URL("../../test/fixtures/retrieval-disclosure-holdout.v1.jsonl", import.meta.url);
const V2_FIXTURE_PATH = new URL("../../test/fixtures/retrieval-disclosure-holdout.v2.jsonl", import.meta.url);
const FREEZE_RECORD_PATH = new URL("../../docs/retrieval-disclosure-holdout-v2-freeze.md", import.meta.url);
const EXPECTED_V1_FIXTURE_SHA256 = "7b9a1ced3c78584f9b746e63a03a90d9ba3f9bda58a3b72986a7f89bf9df055a";
const EXPECTED_V2_FIXTURE_SHA256 = "d372ebac9bf4d80aaac85dfb0d43eacec792291871b744b7812009ac06d071bd";

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("v2 holdout freeze identity and static contract are exact", () => {
  const rows = readJsonl(V2_FIXTURE_PATH);
  const result = validateCandidateDisclosureEnvelopeV2Fixture(rows);
  const familyCounts = Object.fromEntries(CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_FAMILIES.map(family => [
    family,
    rows.filter(row => row.family === family).length,
  ]));
  const candidates = rows.flatMap(row => row.candidates);
  const candidateIds = candidates.map(candidate => candidate.candidate_id);

  assert.equal(sha256(V2_FIXTURE_PATH), EXPECTED_V2_FIXTURE_SHA256);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(rows.length, 48);
  assert.equal(new Set(rows.map(row => row.dataset_id)).size, 1);
  assert.equal(rows.every(row => row.dataset_id === CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_DATASET_ID), true);
  assert.deepEqual(Object.keys(familyCounts), [...CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_FAMILIES]);
  assert.deepEqual(Object.values(familyCounts), Array(12).fill(4));
  assert.equal(candidates.length, 48);
  assert.equal(candidates.filter(candidate => candidate.label.answer_bearing).length, 24);
  assert.equal(new Set(rows.map(row => row.turn_id)).size, 48);
  assert.equal(new Set(candidateIds).size, candidateIds.length);
  assert.equal(rows.every(row => row.schema_version === 2), true);
  assert.equal(rows.every(row => row.label_confidence === "high"), true);
  assert.equal(rows.every(row => row.annotator === CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_ANNOTATOR), true);
  assert.deepEqual(CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_CONTRACT.expected_families, CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_FAMILIES);
});

test("freeze record binds the v2 identity and evidence boundary", () => {
  const record = readFileSync(FREEZE_RECORD_PATH, "utf8");

  for (const value of [
    "retrieval-disclosure-holdout-v2",
    "schema_version | `2`",
    "test/fixtures/retrieval-disclosure-holdout.v2.jsonl",
    EXPECTED_V2_FIXTURE_SHA256,
    "row_count | `48`",
    "family_count | `12`",
    "candidate_count | `48`",
    "answer_bearing_count | `24`",
    "retrieval_disclosure_holdout_v2",
    "future_independent_holdout",
    "evaluated | `false`",
    "runtime_authorized | `false`",
    "freeze_commit",
  ]) {
    assert.equal(record.includes(value), true, `missing freeze metadata: ${value}`);
  }

  assert.equal(record.includes("No selector or evaluator was executed against the v2 fixture"), true);
});

test("v1 historical fixture identity remains unchanged", () => {
  assert.equal(sha256(V1_FIXTURE_PATH), EXPECTED_V1_FIXTURE_SHA256);
});
