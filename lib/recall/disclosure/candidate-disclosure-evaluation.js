import {
  DISCLOSURE_DECISIONS,
  isRecord,
} from "./disclosure-types.js";

export const CANDIDATE_DISCLOSURE_EVALUATION_SCHEMA_VERSION = 1;
export const CANDIDATE_DISCLOSURE_ANNOTATOR = "retrieval_disclosure_planner_v1";
export const CANDIDATE_DISCLOSURE_EXPECTED_DISCLOSURES = Object.freeze(["NONE", "CARD"]);

export const CANDIDATE_DISCLOSURE_FAMILIES = Object.freeze([
  "decision_rationale",
  "project_state",
  "preference_lookup",
  "workflow_rule",
  "entity_background",
  "temporal_reference",
  "mixed_scope",
  "supplied_text_boundary",
  "conflict_boundary",
  "stale_memory",
  "duplicate_memory",
  "unsafe_memory",
]);

export const CANDIDATE_DISCLOSURE_FIXTURE_CONTRACT = Object.freeze({
  expected_count: 48,
  expected_families: CANDIDATE_DISCLOSURE_FAMILIES,
  rows_per_family: 4,
  answer_bearing_rows_per_family: 2,
  non_answer_bearing_rows_per_family: 2,
});

const ROW_FIELDS = [
  "schema_version",
  "turn_id",
  "family",
  "query",
  "candidates",
  "label_confidence",
  "annotator",
];

const CANDIDATE_FIELDS = ["candidate_id", "retrieval", "label"];
const RETRIEVAL_FIELDS = ["rank", "sources", "final_score"];
const LABEL_FIELDS = ["answer_bearing", "safe_to_disclose", "expected_disclosure"];
const FULL_CONTENT_FIELDS = new Set([
  "body",
  "content",
  "full_content",
  "full_text",
  "raw",
  "raw_text",
  "source_text",
  "text",
]);
const FULL_CONTENT_DECISIONS = new Set(["DISCLOSE_RAW", "AUTO_GET_FULL"]);

function diagnostic(code, path) {
  return { code, path };
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function addUnknownFieldDiagnostics(value, allowedFields, path, diagnostics) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowedFields.includes(key)) diagnostics.push(diagnostic("unknown_field", `${path}.${key}`));
  }
}

function requireFields(value, fields, path, diagnostics) {
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("object_required", path));
    return false;
  }
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) diagnostics.push(diagnostic("required_field_missing", `${path}.${field}`));
  }
  return true;
}

function validateRetrieval(retrieval, path, diagnostics) {
  if (!requireFields(retrieval, RETRIEVAL_FIELDS, path, diagnostics)) return;
  addUnknownFieldDiagnostics(retrieval, RETRIEVAL_FIELDS, path, diagnostics);

  if (!Number.isSafeInteger(retrieval.rank) || retrieval.rank < 1) {
    diagnostics.push(diagnostic("invalid_rank", `${path}.rank`));
  }
  if (!Array.isArray(retrieval.sources) || retrieval.sources.length === 0) {
    diagnostics.push(diagnostic("invalid_sources", `${path}.sources`));
  } else {
    retrieval.sources.forEach((source, index) => {
      if (!nonEmptyString(source)) diagnostics.push(diagnostic("invalid_source", `${path}.sources[${index}]`));
    });
  }
  if (typeof retrieval.final_score !== "number" || !Number.isFinite(retrieval.final_score)) {
    diagnostics.push(diagnostic("invalid_final_score", `${path}.final_score`));
  }
}

function validateLabel(label, path, diagnostics) {
  if (!requireFields(label, LABEL_FIELDS, path, diagnostics)) return;
  addUnknownFieldDiagnostics(label, LABEL_FIELDS, path, diagnostics);
  for (const field of ["answer_bearing", "safe_to_disclose"]) {
    if (typeof label[field] !== "boolean") diagnostics.push(diagnostic("invalid_boolean", `${path}.${field}`));
  }
  if (!CANDIDATE_DISCLOSURE_EXPECTED_DISCLOSURES.includes(label.expected_disclosure)) {
    diagnostics.push(diagnostic("invalid_expected_disclosure", `${path}.expected_disclosure`));
  } else if (typeof label.safe_to_disclose === "boolean") {
    const expected = label.safe_to_disclose ? "CARD" : "NONE";
    if (label.expected_disclosure !== expected) {
      diagnostics.push(diagnostic("expected_disclosure_safety_mismatch", `${path}.expected_disclosure`));
    }
  }
}

function validateCandidate(candidate, path, diagnostics) {
  if (!requireFields(candidate, CANDIDATE_FIELDS, path, diagnostics)) return;
  addUnknownFieldDiagnostics(candidate, CANDIDATE_FIELDS, path, diagnostics);
  if (!nonEmptyString(candidate.candidate_id)) diagnostics.push(diagnostic("invalid_candidate_id", `${path}.candidate_id`));
  validateRetrieval(candidate.retrieval, `${path}.retrieval`, diagnostics);
  validateLabel(candidate.label, `${path}.label`, diagnostics);
}

export function validateCandidateDisclosureRow(row) {
  const diagnostics = [];
  if (!requireFields(row, ROW_FIELDS, "row", diagnostics)) return { valid: false, diagnostics };
  addUnknownFieldDiagnostics(row, ROW_FIELDS, "row", diagnostics);

  if (row.schema_version !== CANDIDATE_DISCLOSURE_EVALUATION_SCHEMA_VERSION) {
    diagnostics.push(diagnostic("invalid_schema_version", "row.schema_version"));
  }
  for (const field of ["turn_id", "family", "query"]) {
    if (!nonEmptyString(row[field])) diagnostics.push(diagnostic("invalid_string", `row.${field}`));
  }
  if (!Array.isArray(row.candidates)) {
    diagnostics.push(diagnostic("invalid_candidates", "row.candidates"));
  } else {
    const candidateIds = new Set();
    row.candidates.forEach((candidate, index) => {
      validateCandidate(candidate, `row.candidates[${index}]`, diagnostics);
      if (nonEmptyString(candidate?.candidate_id)) {
        if (candidateIds.has(candidate.candidate_id)) diagnostics.push(diagnostic("duplicate_candidate_id", `row.candidates[${index}].candidate_id`));
        candidateIds.add(candidate.candidate_id);
      }
    });
  }
  if (row.label_confidence !== "high") diagnostics.push(diagnostic("invalid_label_confidence", "row.label_confidence"));
  if (row.annotator !== CANDIDATE_DISCLOSURE_ANNOTATOR) diagnostics.push(diagnostic("invalid_annotator", "row.annotator"));

  return { valid: diagnostics.length === 0, diagnostics };
}

export function validateCandidateDisclosureRows(rows) {
  if (!Array.isArray(rows)) return { valid: false, diagnostics: [diagnostic("rows_array_required", "rows")] };
  const diagnostics = [];
  rows.forEach((row, index) => {
    const result = validateCandidateDisclosureRow(row);
    diagnostics.push(...result.diagnostics.map(item => ({ ...item, path: `rows[${index}].${item.path.replace(/^row\.?/, "")}` })));
  });
  const turnIds = new Set();
  rows.forEach((row, index) => {
    if (!nonEmptyString(row?.turn_id)) return;
    if (turnIds.has(row.turn_id)) diagnostics.push(diagnostic("duplicate_turn_id", `rows[${index}].turn_id`));
    turnIds.add(row.turn_id);
  });
  return { valid: diagnostics.length === 0, diagnostics };
}

export function validateCandidateDisclosureFixture(rows, contract = CANDIDATE_DISCLOSURE_FIXTURE_CONTRACT) {
  const base = validateCandidateDisclosureRows(rows);
  const diagnostics = [...base.diagnostics];
  if (!Array.isArray(rows)) return { valid: false, diagnostics };

  if (rows.length !== contract.expected_count) diagnostics.push(diagnostic("invalid_row_count", "rows"));
  const expectedFamilies = Array.isArray(contract.expected_families) ? contract.expected_families : [];
  const actualFamilies = new Set(rows.map(row => row?.family).filter(nonEmptyString));
  for (const family of expectedFamilies) {
    const familyRows = rows.filter(row => row?.family === family);
    if (familyRows.length !== contract.rows_per_family) diagnostics.push(diagnostic("invalid_family_row_count", `families.${family}`));
    const answerBearingRows = familyRows.filter(row => row?.candidates?.some(candidate => candidate?.label?.answer_bearing === true)).length;
    const nonAnswerBearingRows = familyRows.filter(row => row?.candidates?.every(candidate => candidate?.label?.answer_bearing === false)).length;
    if (answerBearingRows !== contract.answer_bearing_rows_per_family) diagnostics.push(diagnostic("invalid_family_answer_bearing_balance", `families.${family}`));
    if (nonAnswerBearingRows !== contract.non_answer_bearing_rows_per_family) diagnostics.push(diagnostic("invalid_family_non_answer_bearing_balance", `families.${family}`));
  }
  for (const family of actualFamilies) {
    if (!expectedFamilies.includes(family)) diagnostics.push(diagnostic("unknown_family", `families.${family}`));
  }
  return { valid: diagnostics.length === 0, diagnostics };
}

function selectionRowsFor(rows, output, diagnostics) {
  if (!Array.isArray(output)) {
    diagnostics.push(diagnostic("selector_output_array_required", "selector_output"));
    return rows.map(() => []);
  }
  if (rows.length === 1 && output.every(item => isRecord(item) && Object.hasOwn(item, "candidate_id"))) return [output];
  if (output.length !== rows.length) diagnostics.push(diagnostic("selector_output_row_count_mismatch", "selector_output"));
  return rows.map((_, index) => {
    const rowOutput = output[index];
    if (Array.isArray(rowOutput)) return rowOutput;
    if (isRecord(rowOutput) && Array.isArray(rowOutput.selections)) return rowOutput.selections;
    if (isRecord(rowOutput) && Array.isArray(rowOutput.results)) return rowOutput.results;
    diagnostics.push(diagnostic("selector_output_row_required", `selector_output[${index}]`));
    return [];
  });
}

function containsFullContent(value) {
  if (!isRecord(value)) return false;
  if (FULL_CONTENT_DECISIONS.has(value.decision) || value.disclosure_level === "full_content_on_get") return true;
  if (Object.keys(value).some(key => FULL_CONTENT_FIELDS.has(key))) return true;
  return isRecord(value.card) && Object.keys(value.card).some(key => FULL_CONTENT_FIELDS.has(key));
}

function ratio(numerator, denominator) {
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(4));
}

function emptyMetrics() {
  return {
    unsafe_disclosure_count: 0,
    unauthorized_full_content_count: 0,
    answer_bearing_total: 0,
    answer_bearing_disclosed: 0,
    answer_bearing_disclosure_recall: null,
    candidate_pool_size: 0,
    selected_card_count: 0,
    withheld_count: 0,
    irrelevant_disclosure_count: 0,
    disclosure_reduction_rate: null,
  };
}
/**
 * Evaluates candidate labels against already-produced selector output. It
 * never invokes retrieval, intent analysis, or the selector itself.
 */
export function evaluateCandidateDisclosureFixture(rows = [], disclosureSelectorOutput = []) {
  const validation = validateCandidateDisclosureRows(rows);
  const selectorDiagnostics = [];
  const selectionRows = selectionRowsFor(Array.isArray(rows) ? rows : [], disclosureSelectorOutput, selectorDiagnostics);
  const metrics = emptyMetrics();
  const diagnostics = {
    unsafe_disclosures: [],
    unauthorized_full_content: [],
    irrelevant_disclosures: [],
    selector_contract: selectorDiagnostics,
  };

  if (!Array.isArray(rows)) {
    return {
      mode: "offline_candidate_disclosure_evaluation_v1",
      evidence_role: "synthetic_candidate_fixture",
      validation: { valid: false, diagnostics: [...validation.diagnostics, ...selectorDiagnostics] },
      ...metrics,
      metrics,
      gates: { unsafe_disclosure_zero: false, unauthorized_full_content_zero: false, hard_safety: false },
      diagnostics,
      authority: "OFFLINE ONLY / NOT RUNTIME AUTHORIZED",
      independent_readiness_evidence: false,
    };
  }

  for (const [rowIndex, row] of rows.entries()) {
    const selections = Array.isArray(selectionRows[rowIndex]) ? selectionRows[rowIndex] : [];
    const selectionById = new Map();
    selections.forEach((selection, selectionIndex) => {
      if (!isRecord(selection) || !nonEmptyString(selection.candidate_id)) {
        selectorDiagnostics.push(diagnostic("selector_candidate_id_required", `selector_output[${rowIndex}][${selectionIndex}]`));
        return;
      }
      if (selectionById.has(selection.candidate_id)) {
        selectorDiagnostics.push(diagnostic("selector_duplicate_candidate_id", `selector_output[${rowIndex}][${selectionIndex}].candidate_id`));
        return;
      }
      if (![DISCLOSURE_DECISIONS.WITHHOLD, DISCLOSURE_DECISIONS.DISCLOSE_CARD].includes(selection.decision)) {
        selectorDiagnostics.push(diagnostic("selector_invalid_decision", `selector_output[${rowIndex}][${selectionIndex}].decision`));
      }
      selectionById.set(selection.candidate_id, selection);
    });

    const candidateIds = new Set((Array.isArray(row.candidates) ? row.candidates : []).map(candidate => candidate?.candidate_id));
    for (const selectionId of selectionById.keys()) {
      if (!candidateIds.has(selectionId)) selectorDiagnostics.push(diagnostic("selector_unknown_candidate_id", `selector_output[${rowIndex}]`));
    }

    for (const candidate of Array.isArray(row.candidates) ? row.candidates : []) {
      const selection = selectionById.get(candidate.candidate_id) || { decision: DISCLOSURE_DECISIONS.WITHHOLD };
      metrics.candidate_pool_size += 1;
      if (candidate.label?.answer_bearing === true) metrics.answer_bearing_total += 1;
      const cardDisclosed = selection.decision === DISCLOSURE_DECISIONS.DISCLOSE_CARD;
      if (cardDisclosed) {
        metrics.selected_card_count += 1;
        if (candidate.label?.answer_bearing === true) metrics.answer_bearing_disclosed += 1;
        if (candidate.label?.answer_bearing !== true) {
          metrics.irrelevant_disclosure_count += 1;
          diagnostics.irrelevant_disclosures.push({ turn_id: row.turn_id, family: row.family, candidate_id: candidate.candidate_id });
        }
        if (candidate.label?.safe_to_disclose === false) {
          metrics.unsafe_disclosure_count += 1;
          diagnostics.unsafe_disclosures.push({ turn_id: row.turn_id, family: row.family, candidate_id: candidate.candidate_id, reason: "safe_to_disclose_false" });
        }
      } else if (selection.decision === DISCLOSURE_DECISIONS.WITHHOLD) {
        metrics.withheld_count += 1;
      }
      if (containsFullContent(selection)) {
        metrics.unauthorized_full_content_count += 1;
        diagnostics.unauthorized_full_content.push({ turn_id: row.turn_id, family: row.family, candidate_id: candidate.candidate_id, reason: "full_content_surface" });
      }
    }
  }

  metrics.answer_bearing_disclosure_recall = ratio(metrics.answer_bearing_disclosed, metrics.answer_bearing_total);
  metrics.disclosure_reduction_rate = ratio(metrics.candidate_pool_size - metrics.selected_card_count, metrics.candidate_pool_size);
  const combinedDiagnostics = [...validation.diagnostics, ...selectorDiagnostics];
  const validationResult = { valid: combinedDiagnostics.length === 0, diagnostics: combinedDiagnostics };
  const gates = {
    unsafe_disclosure_zero: metrics.unsafe_disclosure_count === 0,
    unauthorized_full_content_zero: metrics.unauthorized_full_content_count === 0,
  };
  gates.hard_safety = validationResult.valid && gates.unsafe_disclosure_zero && gates.unauthorized_full_content_zero;

  return {
    mode: "offline_candidate_disclosure_evaluation_v1",
    evidence_role: "synthetic_candidate_fixture",
    validation: validationResult,
    ...metrics,
    metrics,
    gates,
    diagnostics,
    authority: "OFFLINE ONLY / NOT RUNTIME AUTHORIZED",
    independent_readiness_evidence: false,
    side_effects: {
      db_writes: false,
      data_mutation: false,
      retrieval: false,
      injection: false,
      reinforcement: false,
      llm: false,
      network: false,
    },
  };
}
