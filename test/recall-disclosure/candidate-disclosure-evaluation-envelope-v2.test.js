import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_ANNOTATOR,
  CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_CONTRACT,
  CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_DATASET_ID,
  CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_FAMILIES,
  createCandidateDisclosureEvaluationEnvelopeV2,
  validateCandidateDisclosureEnvelopeV2,
  validateCandidateDisclosureEnvelopeV2Fixture,
} from "../../lib/recall/disclosure/candidate-disclosure-evaluation-envelope-v2.js";

const V1_FIXTURE_PATH = new URL("../../test/fixtures/retrieval-disclosure-holdout.v1.jsonl", import.meta.url);
const V2_FIXTURE_PATH = new URL("../../test/fixtures/retrieval-disclosure-holdout.v2.jsonl", import.meta.url);
const V2_ADAPTER_PATH = new URL("../../lib/recall/disclosure/candidate-disclosure-evaluation-envelope-v2.js", import.meta.url);
const EXPECTED_V1_FIXTURE_SHA256 = "7b9a1ced3c78584f9b746e63a03a90d9ba3f9bda58a3b72986a7f89bf9df055a";
const EXPECTED_V2_FIXTURE_SHA256 = "d372ebac9bf4d80aaac85dfb0d43eacec792291871b744b7812009ac06d071bd";

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line));
}

test("valid v2 evaluation-envelope row is accepted", () => {
  const row = readJsonl(V2_FIXTURE_PATH)[0];
  assert.deepEqual(validateCandidateDisclosureEnvelopeV2(row), { valid: true, diagnostics: [] });
});

test("missing canonical context is rejected", () => {
  const row = structuredClone(readJsonl(V2_FIXTURE_PATH)[0]);
  delete row.candidates[0].canonical_context;
  const result = validateCandidateDisclosureEnvelopeV2(row);

  assert.equal(result.valid, false);
  assert.equal(result.diagnostics.some(item => item.code === "required_field_missing" && item.path.endsWith("canonical_context")), true);
});

test("invalid lifecycle context is rejected", () => {
  const row = structuredClone(readJsonl(V2_FIXTURE_PATH)[0]);
  row.candidates[0].canonical_context.lifecycle.state = "not_a_lifecycle_state";
  const result = validateCandidateDisclosureEnvelopeV2(row);

  assert.equal(result.valid, false);
  assert.equal(result.diagnostics.some(item => item.code === "invalid_lifecycle"), true);
});

test("invalid disclosure consistency is rejected", () => {
  const row = structuredClone(readJsonl(V2_FIXTURE_PATH)[0]);
  row.candidates[0].label.safe_to_disclose = false;
  row.candidates[0].label.expected_disclosure = "CARD";
  const result = validateCandidateDisclosureEnvelopeV2(row);

  assert.equal(result.valid, false);
  assert.equal(result.diagnostics.some(item => item.code === "expected_disclosure_safety_mismatch"), true);
});

test("v2 fixture satisfies the 48-row and family contract", () => {
  const rows = readJsonl(V2_FIXTURE_PATH);
  const result = validateCandidateDisclosureEnvelopeV2Fixture(rows);
  const familyCounts = Object.fromEntries(CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_FAMILIES.map(family => [
    family,
    rows.filter(row => row.family === family).length,
  ]));

  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(rows.length, 48);
  assert.deepEqual([...new Set(rows.map(row => row.dataset_id))], [CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_DATASET_ID]);
  assert.deepEqual(Object.keys(familyCounts), [...CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_FAMILIES]);
  assert.deepEqual(Object.values(familyCounts), Array(12).fill(4));
  assert.equal(rows.filter(row => row.candidates.some(candidate => candidate.label.answer_bearing)).length, 24);
  assert.equal(rows.every(row => !Object.hasOwn(row, "task_intent") && !Object.hasOwn(row, "recall_intent")), true);
});

test("adapter constructs the existing Recall Candidate Envelope without selector execution", () => {
  const candidate = readJsonl(V2_FIXTURE_PATH)[0].candidates[0];
  const result = createCandidateDisclosureEvaluationEnvelopeV2(candidate);

  assert.equal(result.candidate_id, candidate.candidate_id);
  assert.deepEqual(result.label, candidate.label);
  assert.equal(result.envelope.schema_version, 1);
  assert.equal(result.envelope.memory_id, candidate.candidate_id);
  assert.equal(result.envelope.canonical.scope, undefined);
  assert.equal(result.envelope.canonical.classification.scope, candidate.canonical_context.scope.scope);
  assert.equal(result.envelope.canonical.lifecycle.state, candidate.canonical_context.lifecycle.state);
  assert.deepEqual(result.envelope.retrieval, candidate.retrieval);
  assert.deepEqual(result.envelope.card.risk_flags, candidate.canonical_context.risk_flags);
  assert.equal(Object.hasOwn(result.envelope, "label"), false);
});

test("projection_valid=false becomes an invalid card projection in the adapter", () => {
  const candidate = readJsonl(V2_FIXTURE_PATH).find(row => row.turn_id === "v2_unsafe_02").candidates[0];
  const result = createCandidateDisclosureEvaluationEnvelopeV2(candidate);

  assert.equal(candidate.canonical_context.projection_valid, false);
  assert.equal(Object.hasOwn(result.envelope.card, "summary"), false);
});

test("v1 fixture remains byte-identical and separate from v2", () => {
  const v1Hash = createHash("sha256").update(readFileSync(V1_FIXTURE_PATH)).digest("hex");
  const v2Hash = createHash("sha256").update(readFileSync(V2_FIXTURE_PATH)).digest("hex");

  assert.equal(v1Hash, EXPECTED_V1_FIXTURE_SHA256);
  assert.equal(v2Hash, EXPECTED_V2_FIXTURE_SHA256);
  assert.notEqual(v1Hash, v2Hash);
  assert.equal(CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_CONTRACT.annotator, CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_ANNOTATOR);
});

test("v2 adapter has no selector or evaluator dependency", () => {
  const source = readFileSync(V2_ADAPTER_PATH, "utf8");
  assert.equal(source.includes("selectDisclosureCandidates"), false);
  assert.equal(source.includes("evaluateCandidateDisclosureFixture"), false);
});
