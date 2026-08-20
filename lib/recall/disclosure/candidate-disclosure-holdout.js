import { isRecord } from "./disclosure-types.js";

export const CANDIDATE_DISCLOSURE_HOLDOUT_SCHEMA_VERSION = 1;
export const CANDIDATE_DISCLOSURE_HOLDOUT_DATASET_ID = "retrieval-disclosure-holdout-v1";
export const CANDIDATE_DISCLOSURE_HOLDOUT_ANNOTATOR = "retrieval_disclosure_holdout_v1";
export const CANDIDATE_DISCLOSURE_HOLDOUT_EVIDENCE_ROLE = "future_independent_holdout";
export const CANDIDATE_DISCLOSURE_HOLDOUT_EXPECTED_DISCLOSURES = Object.freeze(["NONE", "CARD"]);

export const CANDIDATE_DISCLOSURE_HOLDOUT_FAMILIES = Object.freeze([
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

export const CANDIDATE_DISCLOSURE_HOLDOUT_CONTRACT = Object.freeze({
  schema_version: CANDIDATE_DISCLOSURE_HOLDOUT_SCHEMA_VERSION,
  dataset_id: CANDIDATE_DISCLOSURE_HOLDOUT_DATASET_ID,
  expected_count: 48,
  expected_families: CANDIDATE_DISCLOSURE_HOLDOUT_FAMILIES,
  rows_per_family: 4,
  answer_bearing_rows_per_family: 2,
  non_answer_bearing_rows_per_family: 2,
  label_confidence: "high",
  annotator: CANDIDATE_DISCLOSURE_HOLDOUT_ANNOTATOR,
  evidence_role: CANDIDATE_DISCLOSURE_HOLDOUT_EVIDENCE_ROLE,
});

const ROW_FIELDS = [
  "schema_version",
  "dataset_id",
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
  if (!CANDIDATE_DISCLOSURE_HOLDOUT_EXPECTED_DISCLOSURES.includes(label.expected_disclosure)) {
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

export function validateCandidateDisclosureHoldoutRow(row) {
  const diagnostics = [];
  if (!requireFields(row, ROW_FIELDS, "row", diagnostics)) return { valid: false, diagnostics };
  addUnknownFieldDiagnostics(row, ROW_FIELDS, "row", diagnostics);

  if (row.schema_version !== CANDIDATE_DISCLOSURE_HOLDOUT_SCHEMA_VERSION) {
    diagnostics.push(diagnostic("invalid_schema_version", "row.schema_version"));
  }
  if (row.dataset_id !== CANDIDATE_DISCLOSURE_HOLDOUT_DATASET_ID) {
    diagnostics.push(diagnostic("invalid_dataset_id", "row.dataset_id"));
  }
  for (const field of ["turn_id", "family", "query"]) {
    if (!nonEmptyString(row[field])) diagnostics.push(diagnostic("invalid_string", `row.${field}`));
  }
  if (!Array.isArray(row.candidates) || row.candidates.length === 0) {
    diagnostics.push(diagnostic("invalid_candidates", "row.candidates"));
  } else {
    const candidateIds = new Set();
    row.candidates.forEach((candidate, index) => {
      validateCandidate(candidate, `row.candidates[${index}]`, diagnostics);
      if (nonEmptyString(candidate?.candidate_id)) {
        if (candidateIds.has(candidate.candidate_id)) {
          diagnostics.push(diagnostic("duplicate_candidate_id", `row.candidates[${index}].candidate_id`));
        }
        candidateIds.add(candidate.candidate_id);
      }
    });
  }
  if (row.label_confidence !== "high") diagnostics.push(diagnostic("invalid_label_confidence", "row.label_confidence"));
  if (row.annotator !== CANDIDATE_DISCLOSURE_HOLDOUT_ANNOTATOR) diagnostics.push(diagnostic("invalid_annotator", "row.annotator"));

  return { valid: diagnostics.length === 0, diagnostics };
}

export function validateCandidateDisclosureHoldoutRows(rows) {
  if (!Array.isArray(rows)) return { valid: false, diagnostics: [diagnostic("rows_array_required", "rows")] };
  const diagnostics = [];
  const datasetIds = new Set();
  const turnIds = new Set();

  rows.forEach((row, index) => {
    const result = validateCandidateDisclosureHoldoutRow(row);
    diagnostics.push(...result.diagnostics.map(item => ({
      ...item,
      path: `rows[${index}].${item.path.replace(/^row\.?/, "")}`,
    })));
    if (nonEmptyString(row?.dataset_id)) datasetIds.add(row.dataset_id);
    if (nonEmptyString(row?.turn_id)) {
      if (turnIds.has(row.turn_id)) diagnostics.push(diagnostic("duplicate_turn_id", `rows[${index}].turn_id`));
      turnIds.add(row.turn_id);
    }
  });

  if (datasetIds.size !== 1 || !datasetIds.has(CANDIDATE_DISCLOSURE_HOLDOUT_DATASET_ID)) {
    diagnostics.push(diagnostic("dataset_id_not_unique", "rows.dataset_id"));
  }
  return { valid: diagnostics.length === 0, diagnostics };
}

export function validateCandidateDisclosureHoldoutFixture(
  rows,
  contract = CANDIDATE_DISCLOSURE_HOLDOUT_CONTRACT,
) {
  const base = validateCandidateDisclosureHoldoutRows(rows);
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
