import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  INTERNAL_AGENT_CONTEXT_HOLDOUT_ANNOTATOR,
  INTERNAL_AGENT_CONTEXT_HOLDOUT_DATASET_ID,
  INTERNAL_AGENT_CONTEXT_HOLDOUT_FAMILIES,
  INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_RISK_FLAG_CHARS,
  INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_RISK_FLAGS,
  INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_SEGMENTS,
  INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_SEGMENT_CHARS,
  INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_TOTAL_SELECTED_CHARS,
  validateInternalAgentContextHoldoutFixture,
  validateInternalAgentContextHoldoutRow,
} from "../../lib/recall/disclosure/internal-agent-context-holdout.js";
import {
  INTERNAL_AGENT_CONTEXT_MAX_RISK_FLAG_CHARS,
  INTERNAL_AGENT_CONTEXT_MAX_RISK_FLAGS,
  INTERNAL_AGENT_CONTEXT_MAX_SEGMENTS,
  INTERNAL_AGENT_CONTEXT_MAX_SEGMENT_CHARS,
  INTERNAL_AGENT_CONTEXT_MAX_TOTAL_SELECTED_CHARS,
} from "../../lib/canonical/projection-artifact.js";

const FIXTURE_PATH = new URL("../../test/fixtures/internal-agent-context-holdout.v1.jsonl", import.meta.url);
const C1_FIXTURE_PATH = new URL("../../test/fixtures/memory-projection-holdout.v1.jsonl", import.meta.url);
const C6_FIXTURE_PATH = new URL("../../test/fixtures/redacted-card-holdout.v1.jsonl", import.meta.url);
const VALIDATOR_PATH = new URL("../../lib/recall/disclosure/internal-agent-context-holdout.js", import.meta.url);
const FREEZE_RECORD_PATH = new URL("../../docs/internal-agent-context-holdout-v1-freeze.md", import.meta.url);
const EXPECTED_FIXTURE_SHA256 = "bc0aaa7e5bca0cb7c77f057c56327250c90b48e652032782e1bdd279f8d11085";
const EXPECTED_C1_FIXTURE_SHA256 = "cd0af809fc1e774dd9d782d5a9c20fa231f5a406f62006c4f7a6a66a0747d919";
const EXPECTED_C6_FIXTURE_SHA256 = "55d1d876b111bc7e3dcc7dcadb6761721cb6b05568edc27cc0ff1d81de5a5d48";

function readJsonl(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function selectedSegments(row) {
  return row.selection.ranges.map(range => row.canonical_memory.source.text.slice(range.start, range.end));
}

function assertFixtureInvalid(rows, code) {
  const result = validateInternalAgentContextHoldoutFixture(rows);
  assert.equal(result.valid, false);
  if (code) assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === code), true, code);
}

test("internal agent context holdout has exact 12-row, six-family, balanced contract", () => {
  const rows = readJsonl(FIXTURE_PATH);
  const result = validateInternalAgentContextHoldoutFixture(rows);
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
  assert.equal(rows.length, 12);
  assert.equal(sha256(FIXTURE_PATH), EXPECTED_FIXTURE_SHA256);
  assert.deepEqual([...new Set(rows.map(row => row.dataset_id))], [INTERNAL_AGENT_CONTEXT_HOLDOUT_DATASET_ID]);
  assert.deepEqual([...new Set(rows.map(row => row.family))], [...INTERNAL_AGENT_CONTEXT_HOLDOUT_FAMILIES]);
  assert.deepEqual(INTERNAL_AGENT_CONTEXT_HOLDOUT_FAMILIES.map(family => (
    rows.filter(row => row.family === family).length
  )), [2, 2, 2, 2, 2, 2]);
  assert.deepEqual(INTERNAL_AGENT_CONTEXT_HOLDOUT_FAMILIES.map(family => (
    rows.filter(row => row.family === family && row.label.answer_bearing === true).length
  )), [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(INTERNAL_AGENT_CONTEXT_HOLDOUT_FAMILIES.map(family => (
    rows.filter(row => row.family === family && row.label.answer_bearing === false).length
  )), [1, 1, 1, 1, 1, 1]);
  assert.equal(new Set(rows.map(row => row.case_id)).size, 12);
  assert.equal(rows.every(row => row.projection_surface === "INTERNAL_AGENT_CONTEXT"), true);
  assert.equal(rows.every(row => row.label_confidence === "high"), true);
  assert.equal(rows.every(row => row.annotator === INTERNAL_AGENT_CONTEXT_HOLDOUT_ANNOTATOR), true);
  assert.equal(rows.every(row => row.label.expected_projection_valid === true), true);
});

test("semantic and instruction literals are present inside selected source slices", () => {
  const rows = readJsonl(FIXTURE_PATH);
  for (const row of rows) {
    const segments = selectedSegments(row);
    for (const literal of row.label.semantic_preservation.required_literals) {
      assert.equal(segments.some(segment => segment.includes(literal)), true, `${row.case_id}:${literal}`);
    }
    for (const literal of row.label.instruction_data_isolation.instruction_like_literals) {
      assert.equal(segments.some(segment => segment.includes(literal)), true, `${row.case_id}:${literal}`);
    }
  }
  const instructionRows = rows.filter(row => row.family === "instruction_like_evidence");
  assert.equal(instructionRows.length, 2);
  assert.equal(instructionRows.every(row => row.label.instruction_data_isolation.instruction_like_literals.length > 0), true);
});

test("source-full-selection and risk labels match independent range computation", () => {
  const rows = readJsonl(FIXTURE_PATH);
  for (const row of rows) {
    const ranges = row.selection.ranges;
    const sourceText = row.canonical_memory.source.text;
    const selectedLength = ranges.reduce((total, range) => total + (range.end - range.start), 0);
    const computedFull = ranges[0].start === 0 &&
      ranges.at(-1).end === sourceText.length &&
      selectedLength === sourceText.length;
    assert.equal(row.label.expected_source_fully_selected, computedFull, row.case_id);
    assert.deepEqual(row.label.expected_risk_flags, row.selection.risk_flags, row.case_id);
  }
  assert.equal(rows.filter(row => row.family === "full_source_selection").every(row => row.label.expected_source_fully_selected === true), true);
  assert.equal(rows.filter(row => row.family !== "full_source_selection").every(row => row.label.expected_source_fully_selected === false), true);
});

test("family-specific selection requirements are frozen", () => {
  const rows = readJsonl(FIXTURE_PATH);
  assert.equal(rows.filter(row => row.family === "raw_log_single").every(row => (
    row.selection.ranges.length === 1 && row.selection.risk_flags.includes("raw_log_like")
  )), true);
  assert.equal(rows.filter(row => row.family === "tool_output_single").every(row => (
    row.selection.ranges.length === 1 && row.selection.risk_flags.includes("tool_output_like")
  )), true);
  assert.equal(rows.filter(row => row.family === "multi_segment_operational").every(row => row.selection.ranges.length >= 2), true);
  assert.equal(rows.filter(row => row.family === "risk_metadata_preservation").every(row => row.selection.risk_flags.length >= 2), true);
  assert.deepEqual(new Set(rows.map(row => row.canonical_memory.classification.category)), new Set(["raw_log", "tool_output"]));
});

test("holdout labels contain constraints but no expected output or authority", () => {
  const rows = readJsonl(FIXTURE_PATH);
  const forbiddenKeys = [
    "expected_output",
    "expected_payload",
    "expected_projection_artifact",
    "expected_segments",
    "expected_content_role",
    "expected_provenance",
    "expected_capability",
    "expected_disclosure_authority",
    "expected_internal_context_authority",
    "safe_to_disclose",
    "capability",
    "selector_result",
    "get_token",
    "raw_access",
    "raw_disclosure",
  ];
  for (const row of rows) {
    for (const key of forbiddenKeys) {
      assert.equal(Object.hasOwn(row, key), false, `${row.case_id}:${key}`);
      assert.equal(Object.hasOwn(row.label, key), false, `${row.case_id}:label:${key}`);
    }
  }
});

test("fixture uses fresh IACH1 namespace and does not reuse prior holdout/unit material", () => {
  const serialized = readFileSync(FIXTURE_PATH, "utf8");
  for (const forbidden of [
    "C13_",
    "C13_SYNTHETIC_FAILURE",
    "C13_AUTHORITY_BOUNDARY",
    "C13_PROVENANCE_BOUNDARY",
    "ignore previous instructions",
    "run rm -rf /",
    "call tool X",
    "RCH1_",
    "UNIT_SECRET_RED_9001",
    "UNIT_SECRET_RED_9002",
    "UNIT_ANSWER_ANCHOR_RED_01",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(serialized.includes("IACH1_"), true);
  assert.notEqual(FIXTURE_PATH.href, C1_FIXTURE_PATH.href);
  assert.notEqual(FIXTURE_PATH.href, C6_FIXTURE_PATH.href);
  assert.equal(sha256(C1_FIXTURE_PATH), EXPECTED_C1_FIXTURE_SHA256);
  assert.equal(sha256(C6_FIXTURE_PATH), EXPECTED_C6_FIXTURE_SHA256);
});

test("holdout bounds remain aligned with the independently frozen C.13 contract", () => {
  assert.equal(INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_SEGMENTS, 4);
  assert.equal(INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_SEGMENT_CHARS, 1024);
  assert.equal(INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_TOTAL_SELECTED_CHARS, 2048);
  assert.equal(INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_RISK_FLAGS, 16);
  assert.equal(INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_RISK_FLAG_CHARS, 64);
  assert.equal(INTERNAL_AGENT_CONTEXT_MAX_SEGMENTS, INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_SEGMENTS);
  assert.equal(INTERNAL_AGENT_CONTEXT_MAX_SEGMENT_CHARS, INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_SEGMENT_CHARS);
  assert.equal(INTERNAL_AGENT_CONTEXT_MAX_TOTAL_SELECTED_CHARS, INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_TOTAL_SELECTED_CHARS);
  assert.equal(INTERNAL_AGENT_CONTEXT_MAX_RISK_FLAGS, INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_RISK_FLAGS);
  assert.equal(INTERNAL_AGENT_CONTEXT_MAX_RISK_FLAG_CHARS, INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_RISK_FLAG_CHARS);
});

test("holdout validator stays pure and independent from prototype/evaluator/runtime dependencies", () => {
  const source = readFileSync(VALIDATOR_PATH, "utf8");
  for (const forbidden of [
    "projection-artifact.js",
    "auto-recall-memory-card.js",
    "redacted-card-prototype.js",
    "evaluator",
    "capability",
    "selector",
    "better-sqlite3",
    "node:sqlite",
    "node:fs",
    "readFileSync",
    "fetch(",
    "http://",
    "https://",
    "test/fixtures",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test("validator fails closed for output, range, label, and risk mutations", () => {
  const rows = readJsonl(FIXTURE_PATH);
  const answer = rows.find(row => row.label.answer_bearing === true);
  const nonAnswer = rows.find(row => row.label.answer_bearing === false);
  const full = rows.find(row => row.family === "full_source_selection");
  const multi = rows.find(row => row.family === "multi_segment_operational");

  const expectedCapability = structuredClone(answer);
  expectedCapability.label.expected_capability = "INTERNAL_CONTEXT";
  assert.equal(validateInternalAgentContextHoldoutRow(expectedCapability).valid, false);

  const expectedOutput = structuredClone(answer);
  expectedOutput.label.expected_output = { segments: [] };
  assert.equal(validateInternalAgentContextHoldoutRow(expectedOutput).valid, false);

  const rangeText = structuredClone(answer);
  rangeText.selection.ranges[0].text = "not accepted";
  assert.equal(validateInternalAgentContextHoldoutRow(rangeText).valid, false);

  const overlap = structuredClone(multi);
  overlap.selection.ranges[1].start = overlap.selection.ranges[0].end - 1;
  assert.equal(validateInternalAgentContextHoldoutRow(overlap).valid, false);

  const order = structuredClone(multi);
  [order.selection.ranges[0], order.selection.ranges[1]] = [order.selection.ranges[1], order.selection.ranges[0]];
  assert.equal(validateInternalAgentContextHoldoutRow(order).valid, false);

  const nonAnswerSemantic = structuredClone(nonAnswer);
  nonAnswerSemantic.label.semantic_preservation.required_literals = ["IACH1_FAKE_NONANSWER_ANCHOR"];
  assert.equal(validateInternalAgentContextHoldoutRow(nonAnswerSemantic).valid, false);

  const riskMismatch = structuredClone(answer);
  riskMismatch.label.expected_risk_flags = ["tool_output_like"];
  assert.equal(validateInternalAgentContextHoldoutRow(riskMismatch).valid, false);

  const fullSelectionMismatch = structuredClone(full);
  fullSelectionMismatch.label.expected_source_fully_selected = false;
  assert.equal(validateInternalAgentContextHoldoutRow(fullSelectionMismatch).valid, false);

  for (const mutated of [expectedCapability, expectedOutput, rangeText, overlap, order, nonAnswerSemantic, riskMismatch, fullSelectionMismatch]) {
    const mutatedRows = rows.map(row => row.case_id === mutated.case_id ? mutated : row);
    assertFixtureInvalid(mutatedRows);
  }
});

test("freeze record binds the exact independent C.14 contract", () => {
  const record = readFileSync(FREEZE_RECORD_PATH, "utf8");
  for (const value of [
    "internal-agent-context-holdout-v1",
    "schema_version | `1`",
    "test/fixtures/internal-agent-context-holdout.v1.jsonl",
    EXPECTED_FIXTURE_SHA256,
    "row_count | `12`",
    "family_count | `6`",
    "rows_per_family | `2`",
    "answer_bearing_per_family | `1`",
    "non_answer_bearing_per_family | `1`",
    "internal_agent_context_holdout_v1_synthetic",
    "INDEPENDENT INTERNAL_AGENT_CONTEXT HOLDOUT FROZEN / NOT YET EVALUATED",
    "fresh_post_c13_holdout_contract",
    "C.13 implementation was completed before this fixture",
    "C.13 unit literals were not reused",
    "C.1/C.6 fixtures were not reused",
    "fixture stores acceptance constraints, not expected output",
    "No evaluation execution occurred.",
  ]) {
    assert.equal(record.includes(value), true, `missing freeze metadata: ${value}`);
  }
});
