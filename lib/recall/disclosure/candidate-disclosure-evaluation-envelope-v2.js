import { createRecallCandidateEnvelope } from "./candidate-envelope.js";
import { isRecord } from "./disclosure-types.js";

export const CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_SCHEMA_VERSION = 2;
export const CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_DATASET_ID = "retrieval-disclosure-holdout-v2";
export const CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_ANNOTATOR = "retrieval_disclosure_holdout_v2";
export const CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_EVIDENCE_ROLE = "future_evaluation_contract";
export const CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_EXPECTED_DISCLOSURES = Object.freeze(["NONE", "CARD"]);

export const CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_FAMILIES = Object.freeze([
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

export const CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_CONTRACT = Object.freeze({
  schema_version: CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_SCHEMA_VERSION,
  dataset_id: CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_DATASET_ID,
  expected_count: 48,
  expected_families: CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_FAMILIES,
  rows_per_family: 4,
  answer_bearing_rows_per_family: 2,
  non_answer_bearing_rows_per_family: 2,
  label_confidence: "high",
  annotator: CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_ANNOTATOR,
  evidence_role: CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_EVIDENCE_ROLE,
});

export const CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_LIFECYCLE_STATES = Object.freeze([
  "active",
  "candidate",
  "needs_review",
  "archived",
  "quarantined",
  "deleted_shadow",
  "stale_index_candidate",
]);

export const CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_ARTIFACT_STATES = Object.freeze([
  "safe",
  "raw_log",
  "tool_output",
  "dreaming",
  "diagnostic",
  "unsafe",
]);

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
const CANDIDATE_FIELDS = ["candidate_id", "canonical_context", "retrieval", "label"];
const CANONICAL_CONTEXT_FIELDS = ["lifecycle", "scope", "risk_flags", "artifact_state", "projection_valid"];
const LIFECYCLE_FIELDS = ["state", "archived", "quarantined", "deleted_shadow", "stale_index_candidate"];
const SCOPE_FIELDS = ["scope", "agent_scope"];
const RETRIEVAL_FIELDS = ["rank", "sources", "final_score"];
const LABEL_FIELDS = ["answer_bearing", "safe_to_disclose", "expected_disclosure"];
const BOOLEAN_LIFECYCLE_FIELDS = ["archived", "quarantined", "deleted_shadow", "stale_index_candidate"];

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

function validateLifecycle(lifecycle, path, diagnostics) {
  if (!requireFields(lifecycle, LIFECYCLE_FIELDS, path, diagnostics)) return;
  addUnknownFieldDiagnostics(lifecycle, LIFECYCLE_FIELDS, path, diagnostics);
  if (!CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_LIFECYCLE_STATES.includes(lifecycle.state)) {
    diagnostics.push(diagnostic("invalid_lifecycle", `${path}.state`));
  }
  for (const field of BOOLEAN_LIFECYCLE_FIELDS) {
    if (typeof lifecycle[field] !== "boolean") diagnostics.push(diagnostic("invalid_boolean", `${path}.${field}`));
  }
}

function validateScope(scope, path, diagnostics) {
  if (!requireFields(scope, SCOPE_FIELDS, path, diagnostics)) return;
  addUnknownFieldDiagnostics(scope, SCOPE_FIELDS, path, diagnostics);
  for (const field of SCOPE_FIELDS) {
    if (!nonEmptyString(scope[field])) diagnostics.push(diagnostic("invalid_scope", `${path}.${field}`));
  }
}

function validateCanonicalContext(context, path, diagnostics) {
  if (!requireFields(context, CANONICAL_CONTEXT_FIELDS, path, diagnostics)) return;
  addUnknownFieldDiagnostics(context, CANONICAL_CONTEXT_FIELDS, path, diagnostics);
  validateLifecycle(context.lifecycle, `${path}.lifecycle`, diagnostics);
  validateScope(context.scope, `${path}.scope`, diagnostics);
  if (!Array.isArray(context.risk_flags)) {
    diagnostics.push(diagnostic("invalid_risk_flags", `${path}.risk_flags`));
  } else {
    context.risk_flags.forEach((flag, index) => {
      if (!nonEmptyString(flag)) diagnostics.push(diagnostic("invalid_risk_flag", `${path}.risk_flags[${index}]`));
    });
  }
  if (!CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_ARTIFACT_STATES.includes(context.artifact_state)) {
    diagnostics.push(diagnostic("invalid_artifact_state", `${path}.artifact_state`));
  }
  if (typeof context.projection_valid !== "boolean") {
    diagnostics.push(diagnostic("invalid_boolean", `${path}.projection_valid`));
  }
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
  if (!CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_EXPECTED_DISCLOSURES.includes(label.expected_disclosure)) {
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
  validateCanonicalContext(candidate.canonical_context, `${path}.canonical_context`, diagnostics);
  validateRetrieval(candidate.retrieval, `${path}.retrieval`, diagnostics);
  validateLabel(candidate.label, `${path}.label`, diagnostics);
}

export function validateCandidateDisclosureEnvelopeV2(row) {
  const diagnostics = [];
  if (!requireFields(row, ROW_FIELDS, "row", diagnostics)) return { valid: false, diagnostics };
  addUnknownFieldDiagnostics(row, ROW_FIELDS, "row", diagnostics);
  if (row.schema_version !== CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_SCHEMA_VERSION) {
    diagnostics.push(diagnostic("invalid_schema_version", "row.schema_version"));
  }
  if (row.dataset_id !== CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_DATASET_ID) {
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
        if (candidateIds.has(candidate.candidate_id)) diagnostics.push(diagnostic("duplicate_candidate_id", `row.candidates[${index}].candidate_id`));
        candidateIds.add(candidate.candidate_id);
      }
    });
  }
  if (row.label_confidence !== "high") diagnostics.push(diagnostic("invalid_label_confidence", "row.label_confidence"));
  if (row.annotator !== CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_ANNOTATOR) diagnostics.push(diagnostic("invalid_annotator", "row.annotator"));
  return { valid: diagnostics.length === 0, diagnostics };
}

export function validateCandidateDisclosureEnvelopeV2Rows(rows) {
  if (!Array.isArray(rows)) return { valid: false, diagnostics: [diagnostic("rows_array_required", "rows")] };
  const diagnostics = [];
  const datasetIds = new Set();
  const turnIds = new Set();
  rows.forEach((row, index) => {
    const result = validateCandidateDisclosureEnvelopeV2(row);
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
  if (datasetIds.size !== 1 || !datasetIds.has(CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_DATASET_ID)) {
    diagnostics.push(diagnostic("dataset_id_not_unique", "rows.dataset_id"));
  }
  return { valid: diagnostics.length === 0, diagnostics };
}

export function validateCandidateDisclosureEnvelopeV2Fixture(
  rows,
  contract = CANDIDATE_DISCLOSURE_EVALUATION_ENVELOPE_V2_CONTRACT,
) {
  const base = validateCandidateDisclosureEnvelopeV2Rows(rows);
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

function artifactProjection(artifactState) {
  if (artifactState === "raw_log" || artifactState === "tool_output") {
    return { category: "raw_log", kind: "diagnostic", path: "raw-log" };
  }
  if (artifactState === "dreaming") return { category: "dreaming", kind: "dreaming", path: "dreaming" };
  if (artifactState === "diagnostic") return { category: "project", kind: "diagnostic", path: "memory" };
  if (artifactState === "unsafe") return { category: "project", kind: "project_state", path: "unsafe" };
  return { category: "project", kind: "project_state", path: "memory" };
}

/**
 * Builds the existing Recall Candidate Envelope from one validated v2
 * evaluation candidate. The label stays beside the envelope as evaluation
 * metadata and is never added to the production envelope.
 */
export function createCandidateDisclosureEvaluationEnvelopeV2(candidate) {
  if (!isRecord(candidate) || !isRecord(candidate.canonical_context)) {
    throw new TypeError("candidate.canonical_context is required");
  }
  const id = candidate.candidate_id;
  if (!nonEmptyString(id)) throw new TypeError("candidate.candidate_id is required");
  const context = candidate.canonical_context;
  const artifact = artifactProjection(context.artifact_state);
  const envelope = createRecallCandidateEnvelope({
    canonicalMemory: {
      schema_version: 1,
      memory_id: id,
      canonical_id: `cmem:evaluation-v2:${id}`,
      source: {
        system: "synthetic_evaluation",
        record_type: "candidate",
        record_id: id,
        path: `${artifact.path}/${id}`,
        core_source: "synthetic",
        line_start: 1,
        line_end: 1,
      },
      classification: {
        category: artifact.category,
        category_authority: "evaluation_context",
        kind: artifact.kind,
        kind_basis: "evaluation_context",
        scope: context.scope.scope,
        agent_scope: context.scope.agent_scope,
        lifecycle_state: context.lifecycle.state,
      },
      lifecycle: context.lifecycle,
      content_ref: {
        mode: "synthetic_evaluation",
        content_hash: `sha256:${id}`,
      },
    },
    retrievalEvidence: candidate.retrieval,
    cardProjection: {
      memory_card: {
        schema_version: 1,
        card_id: `memcard:evaluation-v2:${id}`,
        memory_id: id,
        title: "Synthetic evaluation candidate",
        summary: "Bounded synthetic card projection",
        salience_reason: "Evaluation retrieval evidence",
        source_hint: `evaluation-v2/${id}`,
        category: artifact.category,
        kind: artifact.kind,
        confidence_score: 1,
        risk_flags: context.risk_flags,
        disclosure_level: "memory_card",
      },
      policy: {
        disclosure_level: "memory_card",
        can_inject_card: true,
        can_get_full_content: false,
        can_reinforce_on_citation: false,
      },
    },
  });

  if (!context.projection_valid) {
    const invalidCard = { ...envelope.card };
    delete invalidCard.summary;
    return { candidate_id: id, label: candidate.label, envelope: { ...envelope, card: invalidCard } };
  }
  return { candidate_id: id, label: candidate.label, envelope };
}

export const createRecallCandidateEnvelopeFromEvaluationV2 = createCandidateDisclosureEvaluationEnvelopeV2;
