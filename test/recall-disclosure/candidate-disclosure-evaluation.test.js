import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CANDIDATE_DISCLOSURE_FAMILIES,
  CANDIDATE_DISCLOSURE_FIXTURE_CONTRACT,
  evaluateCandidateDisclosureFixture,
  validateCandidateDisclosureFixture,
  validateCandidateDisclosureRow,
} from "../../lib/recall/disclosure/candidate-disclosure-evaluation.js";

const FIXTURE_PATH = new URL("../../test/fixtures/retrieval-disclosure-evaluation.v1.jsonl", import.meta.url);

function readFixture() {
  return readFileSync(FIXTURE_PATH, "utf8")
    .split("\n")
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line));
}

function candidate({
  candidate_id = "candidate-1",
  answer_bearing = true,
  safe_to_disclose = true,
  expected_disclosure = safe_to_disclose ? "CARD" : "NONE",
} = {}) {
  return {
    candidate_id,
    retrieval: { rank: 1, sources: ["vector"], final_score: 0.91 },
    label: { answer_bearing, safe_to_disclose, expected_disclosure },
  };
}

function row(candidates = [candidate()]) {
  return {
    schema_version: 1,
    turn_id: "test-turn-1",
    family: "decision_rationale",
    query: "Which decision should be disclosed?",
    candidates,
    label_confidence: "high",
    annotator: "retrieval_disclosure_planner_v1",
  };
}

test("valid candidate disclosure row is accepted", () => {
  assert.deepEqual(validateCandidateDisclosureRow(row()), { valid: true, diagnostics: [] });
});

test("row validator rejects missing fields, enums, and booleans", () => {
  const missing = structuredClone(row());
  delete missing.query;
  const missingResult = validateCandidateDisclosureRow(missing);
  assert.equal(missingResult.valid, false);
  assert.equal(missingResult.diagnostics.some(item => item.code === "required_field_missing"), true);

  const invalidEnum = structuredClone(row([candidate({ expected_disclosure: "RAW" })]));
  const enumResult = validateCandidateDisclosureRow(invalidEnum);
  assert.equal(enumResult.valid, false);
  assert.equal(enumResult.diagnostics.some(item => item.code === "invalid_expected_disclosure"), true);

  const invalidBoolean = structuredClone(row());
  invalidBoolean.candidates[0].label.answer_bearing = "yes";
  const booleanResult = validateCandidateDisclosureRow(invalidBoolean);
  assert.equal(booleanResult.valid, false);
  assert.equal(booleanResult.diagnostics.some(item => item.code === "invalid_boolean"), true);
});

test("synthetic fixture satisfies the fixed 48-row family contract", () => {
  const rows = readFixture();
  const result = validateCandidateDisclosureFixture(rows);

  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(rows.length, CANDIDATE_DISCLOSURE_FIXTURE_CONTRACT.expected_count);
  assert.deepEqual([...new Set(rows.map(item => item.family))], [...CANDIDATE_DISCLOSURE_FAMILIES]);
  assert.deepEqual(
    rows.reduce((counts, item) => {
      counts[item.family] = (counts[item.family] || 0) + 1;
      return counts;
    }, {}),
    Object.fromEntries(CANDIDATE_DISCLOSURE_FAMILIES.map(family => [family, 4])),
  );
});

test("evaluator records safe card disclosure and answer-bearing recall", () => {
  const rows = [row([candidate(), candidate({ candidate_id: "noise", answer_bearing: false, safe_to_disclose: false })])];
  const result = evaluateCandidateDisclosureFixture(rows, [[
    { candidate_id: "candidate-1", decision: "DISCLOSE_CARD", card: { summary: "bounded card" } },
    { candidate_id: "noise", decision: "WITHHOLD" },
  ]]);

  assert.equal(result.validation.valid, true);
  assert.equal(result.unsafe_disclosure_count, 0);
  assert.equal(result.unauthorized_full_content_count, 0);
  assert.equal(result.answer_bearing_total, 1);
  assert.equal(result.answer_bearing_disclosed, 1);
  assert.equal(result.answer_bearing_disclosure_recall, 1);
  assert.equal(result.selected_card_count, 1);
  assert.equal(result.withheld_count, 1);
  assert.equal(result.irrelevant_disclosure_count, 0);
  assert.equal(result.disclosure_reduction_rate, 0.5);
  assert.equal(result.gates.hard_safety, true);
});

test("unsafe card disclosure fails the hard safety gate", () => {
  const rows = [row([candidate({ safe_to_disclose: false })])];
  const result = evaluateCandidateDisclosureFixture(rows, [[
    { candidate_id: "candidate-1", decision: "DISCLOSE_CARD", card: { summary: "unsafe card" } },
  ]]);

  assert.equal(result.unsafe_disclosure_count, 1);
  assert.equal(result.gates.unsafe_disclosure_zero, false);
  assert.equal(result.gates.hard_safety, false);
  assert.deepEqual(result.diagnostics.unsafe_disclosures, [{
    turn_id: "test-turn-1",
    family: "decision_rationale",
    candidate_id: "candidate-1",
    reason: "safe_to_disclose_false",
  }]);
});

test("full-content selector output is counted as unauthorized", () => {
  const result = evaluateCandidateDisclosureFixture([row()], [[
    { candidate_id: "candidate-1", decision: "DISCLOSE_RAW", body: "full memory body" },
  ]]);

  assert.equal(result.unauthorized_full_content_count, 1);
  assert.equal(result.gates.unauthorized_full_content_zero, false);
  assert.equal(result.gates.hard_safety, false);
});

test("diagnostics stay bounded and do not include the query body", () => {
  const sensitiveQuery = "PRIVATE QUERY BODY THAT MUST NOT APPEAR IN DIAGNOSTICS";
  const sensitiveRow = { ...row(), query: sensitiveQuery };
  const result = evaluateCandidateDisclosureFixture([sensitiveRow], [[
    { candidate_id: "candidate-1", decision: "DISCLOSE_CARD", card: { summary: "unsafe" } },
  ]]);

  assert.equal(JSON.stringify(result.diagnostics).includes(sensitiveQuery), false);
  assert.deepEqual(Object.keys(result.diagnostics), [
    "unsafe_disclosures",
    "unauthorized_full_content",
    "irrelevant_disclosures",
    "selector_contract",
  ]);
});

test("fixture labels can be evaluated offline without invoking retrieval", () => {
  const rows = readFixture();
  const selectorOutput = rows.map(item => item.candidates.map(itemCandidate => ({
    candidate_id: itemCandidate.candidate_id,
    decision: itemCandidate.label.expected_disclosure === "CARD" ? "DISCLOSE_CARD" : "WITHHOLD",
    ...(itemCandidate.label.expected_disclosure === "CARD" ? { card: { summary: "bounded card" } } : {}),
  })));
  const result = evaluateCandidateDisclosureFixture(rows, selectorOutput);

  assert.equal(result.validation.valid, true, JSON.stringify(result.validation.diagnostics));
  assert.equal(result.candidate_pool_size, 96);
  assert.equal(result.answer_bearing_total, 24);
  assert.equal(result.answer_bearing_disclosed, 16);
  assert.equal(result.answer_bearing_disclosure_recall, 0.6667);
  assert.equal(result.selected_card_count, 16);
  assert.equal(result.withheld_count, 80);
  assert.equal(result.irrelevant_disclosure_count, 0);
  assert.equal(result.gates.hard_safety, true);
  assert.equal(result.independent_readiness_evidence, false);
});
