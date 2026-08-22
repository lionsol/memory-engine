import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateRedactedCardCase,
  evaluateRedactedCardCases,
  evaluateRedactedCardFixture,
} from "../../lib/recall/disclosure/redacted-card-evaluator.js";
import {
  REDACTED_CARD_HOLDOUT_ANNOTATOR,
  REDACTED_CARD_HOLDOUT_FAMILIES,
  validateRedactedCardHoldoutRow,
} from "../../lib/recall/disclosure/redacted-card-holdout.js";

function makeRow({
  caseId,
  family,
  title,
  summary,
  salienceReason,
  pathToken = caseId,
  directives,
  forbiddenLiterals,
  requiredLiterals = [],
  answerBearing = true,
  riskFlags = [],
  sourceText = "RCH1_C7_SOURCE_BODY_NOT_OUTPUT_01",
}) {
  const memoryId = `redacted-card-holdout-v1-${caseId}`;
  const sourcePath = `synthetic/redacted-card-holdout-v1/${pathToken}.md`;
  const row = {
    schema_version: 1,
    dataset_id: "redacted-card-holdout-v1",
    case_id: caseId,
    family,
    canonical_memory: {
      schema_version: 1,
      canonical_id: `cmem:synthetic:redacted-card-holdout-v1:${caseId}`,
      memory_id: memoryId,
      source: {
        system: "synthetic_evaluation",
        record_type: "chunk",
        record_id: memoryId,
        path: sourcePath,
        core_source: "synthetic",
        line_start: 1,
        line_end: 2,
        text: sourceText,
        core_hash: `synthetic-c7-core-${caseId}`,
        updated_at: 1780000002000,
      },
      classification: {
        category: "project",
        category_authority: "synthetic_fixture",
        kind: "project_state",
        kind_basis: "synthetic_fixture",
      },
      temporal: {
        episode_date: null,
        episode_date_basis: null,
      },
      lifecycle: {
        management: "managed",
        category: "project",
        initial_confidence: 0.9,
        confidence: 0.9,
        last_confidence_update: 1780000002,
        base_tau_days: 30,
        hit_count: 1,
        archived: false,
        protected: false,
        conflict: false,
      },
      content_ref: {
        mode: "core_chunk",
        content_hash: `sha256:synthetic-c7-${caseId}`,
      },
    },
    runtime_candidate: {
      id: `runtime-redacted-card-holdout-v1-${caseId}`,
      path: sourcePath,
      text: `RCH1_C7_RUNTIME_BODY_NOT_OUTPUT_01 ${title} ${summary}`,
      category: "project",
      kind: "project_state",
      confidence: 0.9,
      final_score: 0.9,
      sources: ["synthetic_c7_unit"],
      retrieval_rank: 1,
      trace_id: `synthetic-rch1-c7-${caseId}`,
      risk_flags: riskFlags,
      card: {
        title,
        summary,
        salience_reason: salienceReason,
      },
    },
    redaction_plan: {
      schema_version: 1,
      directives,
    },
    projection_surface: "DISCLOSURE_CARD",
    label: {
      answer_bearing: answerBearing,
      expected_structural_compatibility: true,
      surface_safety: {
        forbidden_literals: forbiddenLiterals,
      },
      semantic_preservation: {
        required_literals: requiredLiterals,
        required: answerBearing,
      },
    },
    label_confidence: "high",
    annotator: REDACTED_CARD_HOLDOUT_ANNOTATOR,
  };
  const validation = validateRedactedCardHoldoutRow(row);
  assert.equal(validation.valid, true, JSON.stringify(validation.diagnostics));
  return row;
}

function basicAnswerRow() {
  return makeRow({
    caseId: "c7-basic-answer-01",
    family: "summary_single",
    title: "C7 answer RCH1_C7_UNIT_ANCHOR_01",
    summary: "C7 answer RCH1_C7_UNIT_ANCHOR_01 contains RCH1_C7_UNIT_SECRET_01.",
    salienceReason: "C7 basic answer evidence.",
    directives: [{ field: "summary", literal: "RCH1_C7_UNIT_SECRET_01" }],
    forbiddenLiterals: ["RCH1_C7_UNIT_SECRET_01"],
    requiredLiterals: ["RCH1_C7_UNIT_ANCHOR_01"],
  });
}

function multipleOccurrenceRow() {
  return makeRow({
    caseId: "c7-multiple-occurrence-01",
    family: "summary_multiple_occurrences",
    title: "C7 repeated answer RCH1_C7_UNIT_ANCHOR_02",
    summary: "RCH1_C7_UNIT_SECRET_02 before; RCH1_C7_UNIT_SECRET_02 after; RCH1_C7_UNIT_ANCHOR_02 remains.",
    salienceReason: "C7 repeated exact literal evidence.",
    directives: [{ field: "summary", literal: "RCH1_C7_UNIT_SECRET_02" }],
    forbiddenLiterals: ["RCH1_C7_UNIT_SECRET_02"],
    requiredLiterals: ["RCH1_C7_UNIT_ANCHOR_02"],
  });
}

function multiFieldRow() {
  return makeRow({
    caseId: "c7-multi-field-01",
    family: "title_summary_multi_field",
    title: "RCH1_C7_UNIT_SECRET_03 title",
    summary: "RCH1_C7_UNIT_ANCHOR_03 with RCH1_C7_UNIT_SECRET_04.",
    salienceReason: "C7 multi-field answer evidence.",
    directives: [
      { field: "title", literal: "RCH1_C7_UNIT_SECRET_03" },
      { field: "summary", literal: "RCH1_C7_UNIT_SECRET_04" },
    ],
    forbiddenLiterals: ["RCH1_C7_UNIT_SECRET_03", "RCH1_C7_UNIT_SECRET_04"],
    requiredLiterals: ["RCH1_C7_UNIT_ANCHOR_03"],
  });
}

function riskMetadataRow() {
  return makeRow({
    caseId: "c7-risk-metadata-01",
    family: "risk_metadata_preservation",
    title: "C7 risk answer RCH1_C7_UNIT_ANCHOR_04",
    summary: "RCH1_C7_UNIT_ANCHOR_04 contains RCH1_C7_UNIT_SECRET_05.",
    salienceReason: "C7 risk metadata evidence.",
    directives: [{ field: "summary", literal: "RCH1_C7_UNIT_SECRET_05" }],
    forbiddenLiterals: ["RCH1_C7_UNIT_SECRET_05"],
    requiredLiterals: ["RCH1_C7_UNIT_ANCHOR_04"],
    riskFlags: ["conflict_flag"],
  });
}

function semanticLossRow() {
  return makeRow({
    caseId: "c7-semantic-loss-01",
    family: "salience_reason",
    title: "C7 semantic-loss case",
    summary: "RCH1_C7_UNIT_SECRET_06 and RCH1_C7_UNIT_ANCHOR_LOST.",
    salienceReason: "C7 semantic-loss evidence.",
    directives: [{ field: "summary", literal: "RCH1_C7_UNIT_ANCHOR_LOST" }],
    forbiddenLiterals: ["RCH1_C7_UNIT_ANCHOR_LOST"],
    requiredLiterals: ["RCH1_C7_UNIT_ANCHOR_LOST"],
  });
}

function surfaceUnsafeRow() {
  return makeRow({
    caseId: "c7-surface-unsafe-01",
    family: "source_hint_path",
    title: "C7 untargeted RCH1_C7_UNIT_UNTARGETED_SECRET",
    summary: "RCH1_C7_UNIT_ANCHOR_07 with RCH1_C7_UNIT_SECRET_07.",
    salienceReason: "C7 surface safety evidence.",
    directives: [{ field: "summary", literal: "RCH1_C7_UNIT_SECRET_07" }],
    forbiddenLiterals: [
      "RCH1_C7_UNIT_SECRET_07",
      "RCH1_C7_UNIT_UNTARGETED_SECRET",
    ],
    requiredLiterals: ["RCH1_C7_UNIT_ANCHOR_07"],
  });
}

function nonAnswerRow() {
  return makeRow({
    caseId: "c7-non-answer-01",
    family: "summary_single",
    title: "C7 non-answer row",
    summary: "Non-answer RCH1_C7_UNIT_SECRET_08.",
    salienceReason: "C7 non-answer evidence.",
    directives: [{ field: "summary", literal: "RCH1_C7_UNIT_SECRET_08" }],
    forbiddenLiterals: ["RCH1_C7_UNIT_SECRET_08"],
    answerBearing: false,
  });
}

function fullContractRows() {
  const definitions = [
    { family: "summary_single", field: "summary" },
    { family: "summary_multiple_occurrences", field: "summary", repeated: true },
    { family: "title_summary_multi_field", field: "title_summary" },
    { family: "salience_reason", field: "salience_reason" },
    { family: "source_hint_path", field: "source_hint" },
    { family: "risk_metadata_preservation", field: "summary", riskFlags: ["conflict_flag"] },
  ];
  return definitions.flatMap((definition, index) => {
    const familyToken = `RCH1_C7_FIX_${index + 1}`;
    const secretA = `${familyToken}_SECRET_A`;
    const secretB = `${familyToken}_SECRET_B`;
    const anchor = `${familyToken}_ANCHOR`;
    const pathToken = definition.field === "source_hint" ? `${familyToken}_PATH` : `c7-fixture-${index + 1}`;
    const fields = definition.field === "title_summary" ? ["title", "summary"] : [definition.field];
    const directives = fields.map((field, fieldIndex) => ({
      field,
      literal: field === "source_hint" ? pathToken : fieldIndex === 0 ? secretA : secretB,
    }));
    const title = definition.field === "title_summary"
      ? `${secretA} title`
      : `C7 fixture ${familyToken} title`;
    const summarySecret = definition.field === "title_summary"
      ? secretB
      : definition.field === "salience_reason"
        ? `${familyToken}_SUMMARY`
        : secretA;
    const summary = definition.repeated
      ? `${summarySecret} first; ${summarySecret} second; ${anchor} remains.`
      : `${anchor} carries ${summarySecret}.`;
    const salienceReason = definition.field === "salience_reason"
      ? `${secretA} salience with ${anchor}.`
      : `C7 fixture ${familyToken} salience.`;
    const common = {
      family: definition.family,
      title,
      summary,
      salienceReason,
      pathToken,
      directives,
      forbiddenLiterals: directives.map(directive => directive.literal),
      requiredLiterals: [anchor],
      riskFlags: definition.riskFlags || [],
    };
    const answer = makeRow({
      ...common,
      caseId: `c7-fixture-${index + 1}-answer`,
    });
    const nonAnswer = makeRow({
      ...common,
      caseId: `c7-fixture-${index + 1}-non-answer`,
      title: definition.field === "title_summary" ? `${secretA} non-answer title` : `C7 fixture ${familyToken} non-answer`,
      summary: definition.repeated
        ? `${summarySecret} first; ${summarySecret} second.`
        : `${summarySecret} non-answer material.`,
      salienceReason: definition.field === "salience_reason"
        ? `${secretA} non-answer salience.`
        : `C7 fixture ${familyToken} non-answer salience.`,
      requiredLiterals: [],
      answerBearing: false,
    });
    return [answer, nonAnswer];
  });
}

test("basic answer-bearing case measures all useful projection axes", () => {
  const result = evaluateRedactedCardCase(basicAnswerRow());

  assert.equal(result.transform_success, true);
  assert.equal(result.transform_reason, "valid");
  assert.equal(result.actual_surface_safe, true);
  assert.deepEqual(result.forbidden_literals_present, []);
  assert.equal(result.actual_semantic_preserved, true);
  assert.deepEqual(result.required_literals_missing, []);
  assert.deepEqual(result.protected_field_mismatches, []);
  assert.equal(result.protected_fields_preserved, true);
  assert.deepEqual(result.unplanned_drift_fields, []);
  assert.equal(result.no_unplanned_field_drift, true);
  assert.equal(result.structural_compatibility_matches_expected, true);
  assert.equal(result.useful_redacted_projection, true);
});

test("multiple exact occurrences are absent from the measured presentation surface", () => {
  const result = evaluateRedactedCardCase(multipleOccurrenceRow());

  assert.equal(result.transform_success, true);
  assert.equal(result.actual_surface_safe, true);
  assert.deepEqual(result.forbidden_literals_present, []);
  assert.equal(result.actual_semantic_preserved, true);
  assert.equal(result.redaction_evidence.occurrence_count, 2);
});

test("multi-field plans measure targeted fields without unplanned drift", () => {
  const result = evaluateRedactedCardCase(multiFieldRow());

  assert.equal(result.transform_success, true);
  assert.equal(result.actual_surface_safe, true);
  assert.equal(result.actual_semantic_preserved, true);
  assert.deepEqual(result.unplanned_drift_fields, []);
  assert.equal(result.no_unplanned_field_drift, true);
  assert.deepEqual(result.redaction_evidence.fields_changed, ["title", "summary"]);
});

test("risk metadata is preserved as a protected representation field", () => {
  const result = evaluateRedactedCardCase(riskMetadataRow());

  assert.equal(result.transform_success, true);
  assert.deepEqual(result.protected_field_mismatches, []);
  assert.equal(result.protected_fields_preserved, true);
});

test("semantic loss is detected independently from surface safety", () => {
  const result = evaluateRedactedCardCase(semanticLossRow());

  assert.equal(result.transform_success, true);
  assert.equal(result.actual_surface_safe, true);
  assert.equal(result.actual_semantic_preserved, false);
  assert.deepEqual(result.required_literals_missing, ["RCH1_C7_UNIT_ANCHOR_LOST"]);
  assert.equal(result.useful_redacted_projection, false);
});

test("surface safety detects forbidden material in an untargeted field", () => {
  const result = evaluateRedactedCardCase(surfaceUnsafeRow());

  assert.equal(result.transform_success, true);
  assert.equal(result.actual_surface_safe, false);
  assert.deepEqual(result.forbidden_literals_present, ["RCH1_C7_UNIT_UNTARGETED_SECRET"]);
  assert.equal(result.no_unplanned_field_drift, true);
  assert.deepEqual(result.unplanned_drift_fields, []);
});

test("invalid row fails closed with bounded diagnostics", () => {
  const row = basicAnswerRow();
  row.label.expected_output = { summary: "[REDACTED]" };

  assert.throws(() => evaluateRedactedCardCase(row), error => {
    assert.equal(error.code, "invalid_redacted_card_holdout_row");
    assert.equal(Array.isArray(error.diagnostics), true);
    assert.equal(JSON.stringify(error.diagnostics).includes("RCH1_C7_SOURCE_BODY_NOT_OUTPUT_01"), false);
    assert.equal(JSON.stringify(error.diagnostics).includes("stack"), false);
    return true;
  });

  assert.throws(() => evaluateRedactedCardFixture([row]), error => {
    assert.equal(error.code, "invalid_redacted_card_holdout_fixture");
    return true;
  });
});

test("inputs remain immutable and output remains bounded representation evidence", () => {
  const row = basicAnswerRow();
  const before = structuredClone(row);
  const result = evaluateRedactedCardCase(row);

  assert.deepEqual(row, before);
  for (const forbiddenKey of [
    "candidate_payload",
    "baseline_payload",
    "canonical_memory",
    "runtime_candidate",
    "capability",
    "safe_to_disclose",
    "disclosure_authority",
  ]) {
    assert.equal(Object.hasOwn(result, forbiddenKey), false, forbiddenKey);
  }
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("RCH1_C7_SOURCE_BODY_NOT_OUTPUT_01"), false);
  assert.equal(serialized.includes("RCH1_C7_RUNTIME_BODY_NOT_OUTPUT_01"), false);
});

test("evaluator remains representation-only and reports explicit offline side effects", () => {
  const result = evaluateRedactedCardCase(basicAnswerRow());

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
  assert.equal(Object.hasOwn(result, "safe_to_disclose"), false);
  assert.equal(Object.hasOwn(result, "disclosure_authority"), false);
});

test("aggregate metrics keep semantic and useful rates answer-bearing-only", () => {
  const result = evaluateRedactedCardCases([
    basicAnswerRow(),
    multipleOccurrenceRow(),
    riskMetadataRow(),
    semanticLossRow(),
    surfaceUnsafeRow(),
    nonAnswerRow(),
  ]);

  assert.equal(result.mode, "offline_redacted_card_evaluation_v1");
  assert.equal(result.runtime_authorized, false);
  assert.equal(result.case_count, 6);
  assert.equal(result.transform_success_count, 6);
  assert.equal(result.transform_failure_count, 0);
  assert.equal(result.structural_compatibility_match_count, 6);
  assert.equal(result.structural_compatibility_match_rate, 1);
  assert.equal(result.surface_safe_count, 5);
  assert.equal(result.surface_unsafe_count, 1);
  assert.equal(result.answer_bearing_total, 5);
  assert.equal(result.answer_bearing_semantic_preserved, 4);
  assert.equal(result.semantic_preservation_rate, 0.8);
  assert.equal(result.protected_fields_preserved_count, 6);
  assert.equal(result.no_unplanned_field_drift_count, 6);
  assert.equal(result.useful_redacted_projection_count, 3);
  assert.equal(result.useful_redacted_projection_rate, 0.6);
  assert.deepEqual(Object.keys(result.family_breakdown), [...REDACTED_CARD_HOLDOUT_FAMILIES]);
  assert.equal(result.family_breakdown.summary_single.cases, 2);
  assert.equal(result.family_breakdown.summary_single.answer_bearing, 1);
  assert.equal(result.family_breakdown.source_hint_path.useful_redacted_projection, 0);
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

test("full-contract API evaluates an independent handcrafted 12-row set", () => {
  const rows = fullContractRows();
  const result = evaluateRedactedCardFixture(rows);

  assert.equal(rows.length, 12);
  assert.equal(result.case_count, 12);
  assert.equal(result.transform_success_count, 12);
  assert.equal(result.structural_compatibility_match_count, 12);
  assert.equal(result.structural_compatibility_match_rate, 1);
  assert.equal(result.surface_safe_count, 12);
  assert.equal(result.surface_unsafe_count, 0);
  assert.equal(result.answer_bearing_total, 6);
  assert.equal(result.answer_bearing_semantic_preserved, 6);
  assert.equal(result.semantic_preservation_rate, 1);
  assert.equal(result.protected_fields_preserved_count, 12);
  assert.equal(result.no_unplanned_field_drift_count, 12);
  assert.equal(result.useful_redacted_projection_count, 6);
  assert.equal(result.useful_redacted_projection_rate, 1);
  for (const family of REDACTED_CARD_HOLDOUT_FAMILIES) {
    assert.equal(result.family_breakdown[family].cases, 2, family);
    assert.equal(result.family_breakdown[family].answer_bearing, 1, family);
    assert.equal(result.family_breakdown[family].transform_success, 2, family);
    assert.equal(result.family_breakdown[family].useful_redacted_projection, 1, family);
  }
  const serialized = JSON.stringify(rows);
  assert.equal(serialized.includes("UNIT_SECRET_RED_9001"), false);
  assert.equal(serialized.includes("UNIT_SECRET_RED_9002"), false);
  assert.equal(serialized.includes("UNIT_ANSWER_ANCHOR_RED_01"), false);
});
