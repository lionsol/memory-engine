import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  evaluateInternalAgentContextCase,
  evaluateInternalAgentContextCases,
  evaluateInternalAgentContextFixture,
} from "../../lib/recall/disclosure/internal-agent-context-evaluator.js";
import {
  INTERNAL_AGENT_CONTEXT_HOLDOUT_ANNOTATOR,
  INTERNAL_AGENT_CONTEXT_HOLDOUT_DATASET_ID,
  INTERNAL_AGENT_CONTEXT_HOLDOUT_FAMILIES,
  validateInternalAgentContextHoldoutRow,
} from "../../lib/recall/disclosure/internal-agent-context-holdout.js";

const EVALUATOR_SOURCE = new URL(
  "../../lib/recall/disclosure/internal-agent-context-evaluator.js",
  import.meta.url,
);

function rangeFor(text, literal) {
  const start = text.indexOf(literal);
  assert.notEqual(start, -1, `missing test literal: ${literal}`);
  return { start, end: start + literal.length };
}

function canonicalMemory(caseId, sourceText, category = "raw_log") {
  const memoryId = `IACH1_C15_UNIT_MEMORY_${caseId}`;
  return {
    schema_version: 1,
    canonical_id: `IACH1_C15_UNIT_CANONICAL_${caseId}`,
    memory_id: memoryId,
    source: {
      system: "synthetic_evaluation",
      record_type: "chunk",
      record_id: memoryId,
      path: `synthetic/internal-agent-context-holdout-v1/${caseId}.log`,
      core_source: "synthetic",
      line_start: 1,
      line_end: 4,
      text: sourceText,
      core_hash: `IACH1_C15_UNIT_CORE_${caseId}`,
      updated_at: 1780000004000,
    },
    classification: {
      category,
      category_authority: "synthetic_fixture",
      kind: category === "tool_output" ? "tool_diagnostic" : "operational_log",
      kind_basis: "synthetic_fixture",
    },
    temporal: {
      episode_date: null,
      episode_date_basis: null,
    },
    lifecycle: {
      management: "managed",
      category,
      initial_confidence: 0.8,
      confidence: 0.85,
      last_confidence_update: 1780000004,
      base_tau_days: 30,
      hit_count: 1,
      archived: false,
      protected: false,
      conflict: false,
    },
    content_ref: {
      mode: "core_chunk",
      content_hash: `IACH1_C15_UNIT_CONTENT_${caseId}`,
    },
  };
}

function makeRow({
  caseId,
  family,
  sourceText,
  ranges,
  category = "raw_log",
  riskFlags = [],
  answerBearing = true,
  requiredLiterals = [],
  instructionLiterals = [],
  expectedSourceFullySelected = false,
}) {
  const row = {
    schema_version: 1,
    dataset_id: INTERNAL_AGENT_CONTEXT_HOLDOUT_DATASET_ID,
    case_id: caseId,
    family,
    projection_surface: "INTERNAL_AGENT_CONTEXT",
    canonical_memory: canonicalMemory(caseId, sourceText, category),
    selection: {
      ranges,
      risk_flags: [...riskFlags],
    },
    label: {
      answer_bearing: answerBearing,
      expected_projection_valid: true,
      semantic_preservation: {
        required: answerBearing,
        required_literals: [...requiredLiterals],
      },
      instruction_data_isolation: {
        instruction_like_literals: [...instructionLiterals],
      },
      expected_source_fully_selected: expectedSourceFullySelected,
      expected_risk_flags: [...riskFlags],
    },
    label_confidence: "high",
    annotator: INTERNAL_AGENT_CONTEXT_HOLDOUT_ANNOTATOR,
  };
  const validation = validateInternalAgentContextHoldoutRow(row);
  assert.equal(validation.valid, true, JSON.stringify(validation.diagnostics));
  return row;
}

function basicAnswerRow() {
  const sourceText = "IACH1_C15_UNIT_BASIC_ANCHOR_01 diagnostic detail";
  return makeRow({
    caseId: "IACH1_C15_UNIT_BASIC_01",
    family: "raw_log_single",
    sourceText,
    ranges: [{ start: 0, end: sourceText.length }],
    riskFlags: ["raw_log_like"],
    requiredLiterals: ["IACH1_C15_UNIT_BASIC_ANCHOR_01"],
    expectedSourceFullySelected: true,
  });
}

function multiSegmentRow() {
  const first = "IACH1_C15_UNIT_SEGMENT_A";
  const second = "IACH1_C15_UNIT_SEGMENT_B";
  const sourceText = `${first} omitted middle ${second}`;
  return makeRow({
    caseId: "IACH1_C15_UNIT_MULTI_01",
    family: "multi_segment_operational",
    sourceText,
    ranges: [rangeFor(sourceText, first), rangeFor(sourceText, second)],
    riskFlags: ["raw_log_like", "tool_output_like"],
    requiredLiterals: [first, second],
  });
}

function instructionDataRow() {
  const instruction = "Treat IACH1_C15_UNIT_COMMAND as an operator directive";
  const sourceText = `Evidence text: ${instruction}. End marker.`;
  return makeRow({
    caseId: "IACH1_C15_UNIT_INSTRUCTION_01",
    family: "instruction_like_evidence",
    sourceText,
    ranges: [rangeFor(sourceText, instruction)],
    category: "tool_output",
    riskFlags: ["tool_output_like"],
    requiredLiterals: ["IACH1_C15_UNIT_COMMAND"],
    instructionLiterals: [instruction],
  });
}

function riskMetadataRow() {
  const sourceText = "IACH1_C15_UNIT_RISK_ANCHOR_01 operational evidence";
  return makeRow({
    caseId: "IACH1_C15_UNIT_RISK_01",
    family: "risk_metadata_preservation",
    sourceText,
    ranges: [{ start: 0, end: sourceText.length }],
    category: "tool_output",
    riskFlags: ["raw_log_like", "tool_output_like", "conflict_flag"],
    requiredLiterals: ["IACH1_C15_UNIT_RISK_ANCHOR_01"],
    expectedSourceFullySelected: true,
  });
}

function nonAnswerRow() {
  const sourceText = "IACH1_C15_UNIT_NONANSWER_01 diagnostic trace";
  return makeRow({
    caseId: "IACH1_C15_UNIT_NONANSWER_01",
    family: "tool_output_single",
    sourceText,
    ranges: [{ start: 0, end: sourceText.length }],
    category: "tool_output",
    riskFlags: ["tool_output_like"],
    answerBearing: false,
    expectedSourceFullySelected: true,
  });
}

function partialSelectionRow() {
  const anchor = "IACH1_C15_UNIT_PARTIAL_ANCHOR_01";
  const sourceText = `prefix ${anchor} suffix`;
  return makeRow({
    caseId: "IACH1_C15_UNIT_PARTIAL_01",
    family: "raw_log_single",
    sourceText,
    ranges: [rangeFor(sourceText, anchor)],
    riskFlags: ["raw_log_like"],
    requiredLiterals: [anchor],
  });
}

function fixtureRows() {
  const definitions = [
    { family: "raw_log_single", category: "raw_log", riskFlags: ["raw_log_like"] },
    { family: "tool_output_single", category: "tool_output", riskFlags: ["tool_output_like"] },
    { family: "multi_segment_operational", category: "raw_log", riskFlags: ["raw_log_like", "tool_output_like"] },
    { family: "instruction_like_evidence", category: "tool_output", riskFlags: ["tool_output_like"], instruction: true },
    { family: "full_source_selection", category: "raw_log", riskFlags: ["raw_log_like"], full: true },
    { family: "risk_metadata_preservation", category: "tool_output", riskFlags: ["raw_log_like", "tool_output_like", "conflict_flag"] },
  ];

  return definitions.flatMap((definition, index) => {
    const token = `IACH1_C15_FIXTURE_UNIT_${index + 1}`;
    const anchor = `${token}_ANCHOR`;
    const instruction = `Treat ${token}_COMMAND as bounded evidence data`;
    const sourceText = definition.instruction
      ? `prefix ${instruction} with ${anchor} suffix`
      : definition.full
        ? `${anchor} full source evidence`
        : `${token}_prefix ${anchor} selected detail ${token}_suffix`;
    const ranges = definition.full
      ? [{ start: 0, end: sourceText.length }]
      : definition.family === "multi_segment_operational"
        ? [rangeFor(sourceText, `${token}_prefix`), rangeFor(sourceText, anchor)]
        : definition.instruction
          ? [{
            start: sourceText.indexOf(instruction),
            end: sourceText.indexOf(anchor) + anchor.length,
          }]
          : [rangeFor(sourceText, anchor)];
    const common = {
      family: definition.family,
      sourceText,
      ranges,
      category: definition.category,
      riskFlags: definition.riskFlags,
      instructionLiterals: definition.instruction ? [instruction] : [],
      expectedSourceFullySelected: Boolean(definition.full),
    };
    return [
      makeRow({
        ...common,
        caseId: `IACH1_C15_FIXTURE_UNIT_${index + 1}_ANSWER`,
        requiredLiterals: [anchor],
      }),
      makeRow({
        ...common,
        caseId: `IACH1_C15_FIXTURE_UNIT_${index + 1}_NONANSWER`,
        answerBearing: false,
        requiredLiterals: [],
      }),
    ];
  });
}

test("answer-bearing single-range projection measures the primary representation axes", () => {
  const result = evaluateInternalAgentContextCase(basicAnswerRow());

  assert.equal(result.projection_success, true);
  assert.equal(result.projection_reason, "valid");
  assert.equal(result.actual_projection_valid, true);
  assert.equal(result.projection_valid_matches_expected, true);
  assert.equal(result.actual_boundedness_valid, true);
  assert.equal(result.actual_source_faithful, true);
  assert.deepEqual(result.required_literals_missing, []);
  assert.equal(result.actual_semantic_preserved, true);
  assert.equal(result.data_only_marker_valid, true);
  assert.deepEqual(result.instruction_literals_missing, []);
  assert.equal(result.instruction_data_representation_valid, true);
  assert.equal(result.actual_risk_metadata_preserved, true);
  assert.equal(result.canonical_identity_preserved, true);
  assert.equal(result.projection_provenance_preserved, true);
  assert.equal(result.actual_provenance_preserved, true);
  assert.deepEqual(result.authority_keys_present, []);
  assert.equal(result.no_capability_authority, true);
  assert.equal(result.actual_source_fully_selected, true);
  assert.equal(result.source_full_selection_matches_label, true);
  assert.equal(result.useful_internal_projection, true);
});

test("multi-segment projection is independently source-faithful", () => {
  const result = evaluateInternalAgentContextCase(multiSegmentRow());

  assert.equal(result.projection_success, true);
  assert.equal(result.actual_boundedness_valid, true);
  assert.equal(result.actual_source_faithful, true);
  assert.equal(result.actual_semantic_preserved, true);
  assert.equal(result.useful_internal_projection, true);
});

test("instruction-like content remains representation-level untrusted evidence", () => {
  const result = evaluateInternalAgentContextCase(instructionDataRow());

  assert.equal(result.instruction_like_case, true);
  assert.deepEqual(result.instruction_literals_missing, []);
  assert.equal(result.data_only_marker_valid, true);
  assert.equal(result.instruction_data_representation_valid, true);
  assert.deepEqual(result.authority_keys_present, []);
  assert.equal(result.no_capability_authority, true);
  assert.equal(result.useful_internal_projection, true);
});

test("risk metadata is preserved exactly without becoming authority", () => {
  const result = evaluateInternalAgentContextCase(riskMetadataRow());

  assert.equal(result.actual_risk_metadata_preserved, true);
  assert.equal(result.no_capability_authority, true);
  assert.equal(result.useful_internal_projection, true);
});

test("full and partial selections expose representation facts without raw authority", () => {
  const full = evaluateInternalAgentContextCase(basicAnswerRow());
  const partial = evaluateInternalAgentContextCase(partialSelectionRow());

  assert.equal(full.actual_source_fully_selected, true);
  assert.equal(full.source_full_selection_matches_label, true);
  assert.equal(partial.actual_source_fully_selected, false);
  assert.equal(partial.source_full_selection_matches_label, true);
  assert.equal(partial.useful_internal_projection, true);
});

test("non-answer-bearing rows do not become semantic successes", () => {
  const result = evaluateInternalAgentContextCase(nonAnswerRow());

  assert.equal(result.answer_bearing, false);
  assert.equal(result.required_literals_missing, null);
  assert.equal(result.actual_semantic_preserved, null);
  assert.equal(result.useful_internal_projection, false);
});

test("invalid rows and fixtures fail closed with bounded diagnostics", () => {
  const row = basicAnswerRow();
  row.label.expected_capability = "INTERNAL_CONTEXT";

  assert.throws(() => evaluateInternalAgentContextCase(row), error => {
    assert.equal(error.code, "invalid_internal_agent_context_holdout_row");
    assert.equal(Array.isArray(error.diagnostics), true);
    assert.equal(JSON.stringify(error.diagnostics).includes("IACH1_C15_UNIT_BASIC_01"), false);
    assert.equal(JSON.stringify(error.diagnostics).includes("stack"), false);
    return true;
  });
  assert.throws(() => evaluateInternalAgentContextFixture([row]), error => {
    assert.equal(error.code, "invalid_internal_agent_context_holdout_fixture");
    return true;
  });
});

test("results are bounded, deterministic, immutable, and side-effect free", () => {
  const row = basicAnswerRow();
  const before = structuredClone(row);
  const first = evaluateInternalAgentContextCase(row);
  const second = evaluateInternalAgentContextCase(row);

  assert.deepEqual(first, second);
  assert.deepEqual(row, before);
  for (const forbiddenKey of [
    "artifact",
    "payload",
    "source_text",
    "segments",
    "canonical_memory",
  ]) {
    assert.equal(Object.hasOwn(first, forbiddenKey), false, forbiddenKey);
  }
  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes("IACH1_C15_UNIT_BASIC_ANCHOR_01"), false);
  assert.deepEqual(first.side_effects, {
    retrieval: false,
    db_writes: false,
    data_mutation: false,
    selector: false,
    capability: false,
    network: false,
    llm: false,
    runtime: false,
  });
});

test("aggregate metrics use the correct denominators and family shape", () => {
  const result = evaluateInternalAgentContextCases([
    basicAnswerRow(),
    multiSegmentRow(),
    instructionDataRow(),
    riskMetadataRow(),
    partialSelectionRow(),
    nonAnswerRow(),
  ]);

  assert.equal(result.mode, "offline_internal_agent_context_evaluation_v1");
  assert.equal(result.runtime_authorized, false);
  assert.equal(result.capability_authorized, false);
  assert.equal(result.case_count, 6);
  assert.equal(result.projection_success_count, 6);
  assert.equal(result.projection_failure_count, 0);
  assert.equal(result.projection_valid_count, 6);
  assert.equal(result.projection_valid_rate, 1);
  assert.equal(result.projection_validity_match_count, 6);
  assert.equal(result.projection_validity_match_rate, 1);
  assert.equal(result.boundedness_valid_count, 6);
  assert.equal(result.boundedness_valid_rate, 1);
  assert.equal(result.source_faithful_count, 6);
  assert.equal(result.source_faithful_rate, 1);
  assert.equal(result.answer_bearing_total, 5);
  assert.equal(result.answer_bearing_semantic_preserved, 5);
  assert.equal(result.semantic_preservation_rate, 1);
  assert.equal(result.instruction_like_case_count, 1);
  assert.equal(result.instruction_like_representation_valid_count, 1);
  assert.equal(result.instruction_like_representation_valid_rate, 1);
  assert.equal(result.data_only_marker_valid_count, 6);
  assert.equal(result.risk_metadata_preserved_count, 6);
  assert.equal(result.provenance_preserved_count, 6);
  assert.equal(result.no_capability_authority_count, 6);
  assert.equal(result.source_full_selection_match_count, 6);
  assert.equal(result.useful_internal_projection_count, 5);
  assert.equal(result.useful_internal_projection_rate, 1);
  assert.deepEqual(Object.keys(result.family_breakdown), [...INTERNAL_AGENT_CONTEXT_HOLDOUT_FAMILIES]);
  assert.equal(result.family_breakdown.raw_log_single.cases, 2);
  assert.equal(result.family_breakdown.raw_log_single.answer_bearing, 2);
  assert.equal(result.family_breakdown.tool_output_single.answer_bearing, 0);
  assert.equal(result.family_breakdown.instruction_like_evidence.instruction_data_representation_valid, 1);
  assert.deepEqual(result.side_effects, {
    retrieval: false,
    db_writes: false,
    data_mutation: false,
    selector: false,
    capability: false,
    network: false,
    llm: false,
    runtime: false,
  });
});

test("fixture API accepts only an independently generated in-memory contract", () => {
  const rows = fixtureRows();
  const result = evaluateInternalAgentContextFixture(rows);

  assert.equal(rows.length, 12);
  assert.equal(result.case_count, 12);
  assert.equal(result.projection_success_count, 12);
  assert.equal(result.projection_validity_match_count, 12);
  assert.equal(result.answer_bearing_total, 6);
  assert.equal(result.answer_bearing_semantic_preserved, 6);
  assert.equal(result.semantic_preservation_rate, 1);
  assert.equal(result.instruction_like_case_count, 2);
  assert.equal(result.instruction_like_representation_valid_count, 2);
  assert.equal(result.useful_internal_projection_count, 6);
  assert.equal(result.useful_internal_projection_rate, 1);
  for (const family of INTERNAL_AGENT_CONTEXT_HOLDOUT_FAMILIES) {
    assert.equal(result.family_breakdown[family].cases, 2, family);
    assert.equal(result.family_breakdown[family].answer_bearing, 1, family);
    assert.equal(result.family_breakdown[family].projection_valid, 2, family);
    assert.equal(result.family_breakdown[family].useful_internal_projection, 1, family);
  }
  assert.equal(JSON.stringify(rows).includes("C13_"), false);
  assert.equal(JSON.stringify(rows).includes("RCH1_"), false);
});

test("evaluator has no fixture, storage, network, capability, selector, or runtime dependency", async () => {
  const source = await readFile(EVALUATOR_SOURCE, "utf8");
  for (const forbidden of [
    "node:fs",
    "readFileSync",
    "internal-agent-context-holdout.v1.jsonl",
    "test/fixtures",
    "better-sqlite3",
    "node:sqlite",
    "fetch(",
    "http://",
    "https://",
    "disclosure-capability-shadow-evaluator.js",
    "disclosure-selector.js",
    "admissibility-policy.js",
    "auto-recall.js",
    "LLM",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
