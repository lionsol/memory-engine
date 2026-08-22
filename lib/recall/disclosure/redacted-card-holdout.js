export const REDACTED_CARD_HOLDOUT_SCHEMA_VERSION = 1;
export const REDACTED_CARD_HOLDOUT_DATASET_ID = "redacted-card-holdout-v1";
export const REDACTED_CARD_HOLDOUT_FAMILIES = Object.freeze([
  "summary_single",
  "summary_multiple_occurrences",
  "title_summary_multi_field",
  "salience_reason",
  "source_hint_path",
  "risk_metadata_preservation",
]);
export const REDACTED_CARD_HOLDOUT_ANNOTATOR = "redacted_card_holdout_v1_synthetic";

const DISCLOSURE_CARD_SURFACE = "DISCLOSURE_CARD";
const MAX_DIRECTIVES = 32;
const MAX_LITERAL_LENGTH = 256;
const PLAN_FIELDS = new Set(["schema_version", "directives"]);
const DIRECTIVE_FIELDS = new Set(["field", "literal"]);
const PRESENTATION_FIELDS = new Set([
  "title",
  "summary",
  "salience_reason",
  "source_hint",
]);
const ROW_FIELDS = new Set([
  "schema_version",
  "dataset_id",
  "case_id",
  "family",
  "projection_surface",
  "canonical_memory",
  "runtime_candidate",
  "redaction_plan",
  "label",
  "label_confidence",
  "annotator",
]);
const LABEL_FIELDS = new Set([
  "answer_bearing",
  "expected_structural_compatibility",
  "surface_safety",
  "semantic_preservation",
]);
const SURFACE_SAFETY_FIELDS = new Set(["forbidden_literals"]);
const SEMANTIC_FIELDS = new Set(["required_literals", "required"]);
const CANONICAL_REQUIRED_FIELDS = new Set([
  "schema_version",
  "canonical_id",
  "memory_id",
  "source",
  "classification",
  "temporal",
  "lifecycle",
  "content_ref",
]);
const RUNTIME_REQUIRED_FIELDS = new Set([
  "id",
  "path",
  "text",
  "category",
  "kind",
  "confidence",
  "final_score",
  "sources",
  "retrieval_rank",
  "trace_id",
  "risk_flags",
  "card",
]);
const RUNTIME_CARD_FIELDS = new Set(["title", "summary", "salience_reason"]);

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function boundedSyntheticLiteral(value) {
  return nonEmptyString(value) &&
    value.length <= MAX_LITERAL_LENGTH &&
    /^RCH1_[A-Z0-9_]+$/u.test(value);
}

function addDiagnostic(diagnostics, code, path) {
  if (diagnostics.length >= 64) return;
  diagnostics.push({
    code: typeof code === "string" ? code.slice(0, 80) : "invalid_row",
    path: typeof path === "string" ? path.slice(0, 160) : "row",
  });
}

function hasOnlyFields(value, allowedFields) {
  return isRecord(value) &&
    Object.keys(value).length === allowedFields.size &&
    Object.keys(value).every(key => allowedFields.has(key));
}

function validateLiteralList(value, path, diagnostics, { requireNonEmpty = true } = {}) {
  if (!Array.isArray(value) || (requireNonEmpty && value.length === 0)) {
    addDiagnostic(diagnostics, "invalid_literal_list", path);
    return;
  }
  const seen = new Set();
  for (const [index, literal] of value.entries()) {
    if (!boundedSyntheticLiteral(literal)) {
      addDiagnostic(diagnostics, "invalid_synthetic_literal", `${path}[${index}]`);
      continue;
    }
    if (seen.has(literal)) addDiagnostic(diagnostics, "duplicate_literal", `${path}[${index}]`);
    seen.add(literal);
  }
}

function validateCanonicalMemory(canonicalMemory, diagnostics) {
  if (!hasOnlyFields(canonicalMemory, CANONICAL_REQUIRED_FIELDS)) {
    addDiagnostic(diagnostics, "invalid_canonical_memory_shape", "canonical_memory");
    return;
  }
  if (canonicalMemory.schema_version !== 1 ||
      !nonEmptyString(canonicalMemory.canonical_id) ||
      !nonEmptyString(canonicalMemory.memory_id)) {
    addDiagnostic(diagnostics, "invalid_canonical_identity", "canonical_memory");
  }

  const source = canonicalMemory.source;
  if (!isRecord(source) ||
      source.system !== "synthetic_evaluation" ||
      source.core_source !== "synthetic" ||
      !nonEmptyString(source.record_id) ||
      !nonEmptyString(source.path) ||
      !source.path.startsWith("synthetic/redacted-card-holdout-v1/") ||
      typeof source.text !== "string") {
    addDiagnostic(diagnostics, "invalid_synthetic_source", "canonical_memory.source");
  }

  const classification = canonicalMemory.classification;
  if (!isRecord(classification) ||
      !nonEmptyString(classification.category) ||
      !nonEmptyString(classification.kind)) {
    addDiagnostic(diagnostics, "invalid_canonical_classification", "canonical_memory.classification");
  }

  if (!isRecord(canonicalMemory.temporal) || !isRecord(canonicalMemory.lifecycle)) {
    addDiagnostic(diagnostics, "invalid_canonical_lifecycle", "canonical_memory.lifecycle");
  }
  const contentRef = canonicalMemory.content_ref;
  if (!isRecord(contentRef) ||
      contentRef.mode !== "core_chunk" ||
      !nonEmptyString(contentRef.content_hash)) {
    addDiagnostic(diagnostics, "invalid_canonical_content_ref", "canonical_memory.content_ref");
  }
}

function validateRuntimeCandidate(runtimeCandidate, diagnostics) {
  if (!hasOnlyFields(runtimeCandidate, RUNTIME_REQUIRED_FIELDS)) {
    addDiagnostic(diagnostics, "invalid_runtime_candidate_shape", "runtime_candidate");
    return;
  }
  if (!nonEmptyString(runtimeCandidate.id) ||
      !nonEmptyString(runtimeCandidate.path) ||
      !runtimeCandidate.path.startsWith("synthetic/redacted-card-holdout-v1/") ||
      typeof runtimeCandidate.text !== "string" ||
      runtimeCandidate.category !== "project" ||
      runtimeCandidate.kind !== "project_state" ||
      !Number.isFinite(runtimeCandidate.confidence) ||
      !Number.isFinite(runtimeCandidate.final_score) ||
      !Array.isArray(runtimeCandidate.sources) ||
      !Number.isSafeInteger(runtimeCandidate.retrieval_rank) ||
      !nonEmptyString(runtimeCandidate.trace_id) ||
      !runtimeCandidate.trace_id.startsWith("synthetic-rch1-") ||
      !Array.isArray(runtimeCandidate.risk_flags) ||
      !runtimeCandidate.risk_flags.every(nonEmptyString)) {
    addDiagnostic(diagnostics, "invalid_runtime_candidate", "runtime_candidate");
  }
  if (!hasOnlyFields(runtimeCandidate.card, RUNTIME_CARD_FIELDS) ||
      !nonEmptyString(runtimeCandidate.card.title) ||
      !nonEmptyString(runtimeCandidate.card.summary) ||
      !nonEmptyString(runtimeCandidate.card.salience_reason)) {
    addDiagnostic(diagnostics, "invalid_runtime_card", "runtime_candidate.card");
  }
}

function validateRedactionPlan(redactionPlan, diagnostics) {
  if (!hasOnlyFields(redactionPlan, PLAN_FIELDS) ||
      redactionPlan.schema_version !== REDACTED_CARD_HOLDOUT_SCHEMA_VERSION ||
      !Array.isArray(redactionPlan.directives) ||
      redactionPlan.directives.length === 0 ||
      redactionPlan.directives.length > MAX_DIRECTIVES) {
    addDiagnostic(diagnostics, "invalid_redaction_plan", "redaction_plan");
    return [];
  }
  const literals = [];
  for (const [index, directive] of redactionPlan.directives.entries()) {
    if (!hasOnlyFields(directive, DIRECTIVE_FIELDS) ||
        typeof directive.field !== "string" ||
        !PRESENTATION_FIELDS.has(directive.field) ||
        !boundedSyntheticLiteral(directive.literal)) {
      addDiagnostic(diagnostics, "invalid_redaction_plan", `redaction_plan.directives[${index}]`);
      continue;
    }
    literals.push(directive.literal);
  }
  return literals;
}

function validateLabel(label, answerBearing, planLiterals, diagnostics) {
  if (!hasOnlyFields(label, LABEL_FIELDS)) {
    addDiagnostic(diagnostics, "invalid_label_shape", "label");
    return;
  }
  if (typeof label.answer_bearing !== "boolean" || label.answer_bearing !== answerBearing) {
    addDiagnostic(diagnostics, "invalid_answer_bearing_label", "label.answer_bearing");
  }
  if (label.expected_structural_compatibility !== true) {
    addDiagnostic(diagnostics, "invalid_expected_structural_compatibility", "label.expected_structural_compatibility");
  }
  if (!hasOnlyFields(label.surface_safety, SURFACE_SAFETY_FIELDS)) {
    addDiagnostic(diagnostics, "invalid_surface_safety_label", "label.surface_safety");
  } else {
    validateLiteralList(label.surface_safety.forbidden_literals, "label.surface_safety.forbidden_literals", diagnostics);
    const forbidden = new Set(label.surface_safety.forbidden_literals);
    for (const literal of planLiterals) {
      if (!forbidden.has(literal)) addDiagnostic(diagnostics, "plan_literal_not_frozen_as_forbidden", "label.surface_safety.forbidden_literals");
    }
  }
  if (!hasOnlyFields(label.semantic_preservation, SEMANTIC_FIELDS)) {
    addDiagnostic(diagnostics, "invalid_semantic_label", "label.semantic_preservation");
    return;
  }
  if (typeof label.semantic_preservation.required !== "boolean" ||
      label.semantic_preservation.required !== answerBearing) {
    addDiagnostic(diagnostics, "invalid_semantic_required_label", "label.semantic_preservation.required");
  }
  validateLiteralList(
    label.semantic_preservation.required_literals,
    "label.semantic_preservation.required_literals",
    diagnostics,
    { requireNonEmpty: answerBearing },
  );
}

export function validateRedactedCardHoldoutRow(row) {
  const diagnostics = [];
  if (!hasOnlyFields(row, ROW_FIELDS)) {
    addDiagnostic(diagnostics, "invalid_row_shape", "row");
    return { valid: false, diagnostics };
  }
  if (row.schema_version !== REDACTED_CARD_HOLDOUT_SCHEMA_VERSION ||
      row.dataset_id !== REDACTED_CARD_HOLDOUT_DATASET_ID ||
      !nonEmptyString(row.case_id) ||
      !REDACTED_CARD_HOLDOUT_FAMILIES.includes(row.family) ||
      row.projection_surface !== DISCLOSURE_CARD_SURFACE) {
    addDiagnostic(diagnostics, "invalid_row_identity", "row");
  }
  validateCanonicalMemory(row.canonical_memory, diagnostics);
  validateRuntimeCandidate(row.runtime_candidate, diagnostics);
  const planLiterals = validateRedactionPlan(row.redaction_plan, diagnostics);
  if (typeof row.label_confidence !== "string" || row.label_confidence !== "high") {
    addDiagnostic(diagnostics, "invalid_label_confidence", "label_confidence");
  }
  if (row.annotator !== REDACTED_CARD_HOLDOUT_ANNOTATOR) {
    addDiagnostic(diagnostics, "invalid_annotator", "annotator");
  }
  if (!isRecord(row.label)) {
    addDiagnostic(diagnostics, "invalid_label_shape", "label");
  } else {
    validateLabel(row.label, row.label.answer_bearing, planLiterals, diagnostics);
  }
  return {
    valid: diagnostics.length === 0,
    diagnostics: diagnostics.slice(0, 64),
  };
}

export function validateRedactedCardHoldoutFixture(rows) {
  const diagnostics = [];
  if (!Array.isArray(rows)) {
    addDiagnostic(diagnostics, "fixture_must_be_array", "fixture");
    return { valid: false, diagnostics };
  }
  if (rows.length !== 12) addDiagnostic(diagnostics, "invalid_row_count", "fixture");

  const caseIds = new Set();
  const familyCounts = new Map(REDACTED_CARD_HOLDOUT_FAMILIES.map(family => [family, { cases: 0, answer_bearing: 0 }]));
  const coveredFields = new Set();
  for (const [index, row] of rows.entries()) {
    const validation = validateRedactedCardHoldoutRow(row);
    for (const diagnostic of validation.diagnostics) {
      addDiagnostic(diagnostics, diagnostic.code, `rows[${index}].${diagnostic.path}`);
    }
    if (nonEmptyString(row?.case_id)) {
      if (caseIds.has(row.case_id)) addDiagnostic(diagnostics, "duplicate_case_id", `rows[${index}].case_id`);
      caseIds.add(row.case_id);
    }
    if (REDACTED_CARD_HOLDOUT_FAMILIES.includes(row?.family)) {
      const family = familyCounts.get(row.family);
      family.cases += 1;
      if (row.label?.answer_bearing === true) family.answer_bearing += 1;
    }
    if (Array.isArray(row?.redaction_plan?.directives)) {
      row.redaction_plan.directives.forEach(directive => coveredFields.add(directive.field));
    }
  }

  for (const family of REDACTED_CARD_HOLDOUT_FAMILIES) {
    const counts = familyCounts.get(family);
    if (counts.cases !== 2) addDiagnostic(diagnostics, "invalid_family_count", `family.${family}`);
    if (counts.answer_bearing !== 1) addDiagnostic(diagnostics, "invalid_family_balance", `family.${family}`);
  }
  for (const field of PRESENTATION_FIELDS) {
    if (!coveredFields.has(field)) addDiagnostic(diagnostics, "presentation_field_not_covered", `redaction_plan.${field}`);
  }

  return {
    valid: diagnostics.length === 0,
    diagnostics: diagnostics.slice(0, 64),
  };
}
