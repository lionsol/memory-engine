export const PROJECTION_AWARE_HOLDOUT_SCHEMA_VERSION = 1;
export const PROJECTION_AWARE_HOLDOUT_DATASET_ID = "memory-projection-holdout-v1";
export const PROJECTION_AWARE_HOLDOUT_ANNOTATOR = "memory_projection_holdout_v1";
export const PROJECTION_AWARE_HOLDOUT_EVIDENCE_ROLE = "future_projection_aware_holdout";
export const PROJECTION_AWARE_HOLDOUT_PROJECTION_SURFACE = "DISCLOSURE_CARD";

export const PROJECTION_AWARE_HOLDOUT_FAMILIES = Object.freeze([
  "direct_safe",
  "redactable_secret",
  "raw_log",
  "tool_output",
  "sensitive_source",
  "capability_blocked",
]);

export const PROJECTION_AWARE_HOLDOUT_CAPABILITIES = Object.freeze([
  "RETRIEVAL_ONLY",
  "INTERNAL_CONTEXT",
  "CARD_DISCLOSABLE",
]);

export const PROJECTION_AWARE_HOLDOUT_DISCLOSURE_AUTHORITIES = Object.freeze([
  "NONE",
  "CARD",
]);

export const PROJECTION_AWARE_HOLDOUT_CAPABILITY_BLOCKERS = Object.freeze([
  "none",
  "lifecycle",
  "cross_scope",
]);

export const PROJECTION_AWARE_HOLDOUT_CONTRACT = Object.freeze({
  schema_version: PROJECTION_AWARE_HOLDOUT_SCHEMA_VERSION,
  dataset_id: PROJECTION_AWARE_HOLDOUT_DATASET_ID,
  expected_count: 24,
  expected_families: PROJECTION_AWARE_HOLDOUT_FAMILIES,
  rows_per_family: 4,
  answer_bearing_rows_per_family: 2,
  non_answer_bearing_rows_per_family: 2,
  projection_surface: PROJECTION_AWARE_HOLDOUT_PROJECTION_SURFACE,
  label_confidence: "high",
  annotator: PROJECTION_AWARE_HOLDOUT_ANNOTATOR,
  evidence_role: PROJECTION_AWARE_HOLDOUT_EVIDENCE_ROLE,
  literal_normalization: "NFKC; CRLF/CR to LF; horizontal whitespace runs to one space; trim; uppercase",
});

const ROW_FIELDS = [
  "schema_version",
  "dataset_id",
  "case_id",
  "family",
  "canonical_memory",
  "runtime_candidate",
  "policy_context",
  "projection_surface",
  "label",
  "label_confidence",
  "annotator",
];
const CANONICAL_MEMORY_FIELDS = [
  "schema_version",
  "canonical_id",
  "memory_id",
  "source",
  "classification",
  "temporal",
  "lifecycle",
  "content_ref",
];
const CANONICAL_SOURCE_FIELDS = [
  "system",
  "record_type",
  "record_id",
  "path",
  "core_source",
  "line_start",
  "line_end",
  "text",
  "core_hash",
  "updated_at",
];
const CANONICAL_CLASSIFICATION_FIELDS = [
  "category",
  "category_authority",
  "kind",
  "kind_basis",
];
const CANONICAL_TEMPORAL_FIELDS = ["episode_date", "episode_date_basis"];
const CANONICAL_LIFECYCLE_FIELDS = [
  "management",
  "category",
  "initial_confidence",
  "confidence",
  "last_confidence_update",
  "base_tau_days",
  "hit_count",
  "archived",
  "protected",
  "conflict",
];
const CANONICAL_CONTENT_REF_FIELDS = ["mode", "content_hash"];
const RUNTIME_CANDIDATE_FIELDS = [
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
];
const POLICY_CONTEXT_FIELDS = [
  "scope",
  "agent_scope",
  "risk_flags",
  "artifact_state",
  "lifecycle_state",
  "current_safe_to_disclose",
  "capability_blocker",
];
const LABEL_FIELDS = [
  "answer_bearing",
  "expected_projection_valid",
  "surface_safety",
  "semantic_preservation",
  "current_v1_1",
];
const SURFACE_SAFETY_FIELDS = ["forbidden_literals"];
const SEMANTIC_PRESERVATION_FIELDS = ["required_literals", "required"];
const CURRENT_V1_1_FIELDS = ["expected_capability", "expected_disclosure_authority"];

const LIFECYCLE_STATES = new Set([
  "active",
  "candidate",
  "needs_review",
  "archived",
  "quarantined",
  "deleted_shadow",
  "stale_index_candidate",
]);
const ARTIFACT_STATES = new Set([
  "safe",
  "raw_log",
  "tool_output",
  "dreaming",
  "diagnostic",
  "unsafe",
]);
const SCOPES = new Set(["shared", "project", "task", "user", "private", "personal", "confidential"]);
const AGENT_SCOPES = new Set(["shared", "main", "cross_agent", "untrusted"]);
const POLICY_RISK_FLAGS = new Set([
  "sensitive",
  "private",
  "personal",
  "personal_data",
  "confidential",
  "secret",
  "raw_log_like",
  "unsafe_artifact",
  "tool_output_like",
  "cross_agent_scope",
  "untrusted",
]);
const RUNTIME_RISK_FLAGS = new Set([
  "raw_log_like",
  "tool_output_like",
  "sensitive_source",
]);
const CAPABILITY_TO_AUTHORITY = Object.freeze({
  RETRIEVAL_ONLY: "NONE",
  INTERNAL_CONTEXT: "NONE",
  CARD_DISCLOSABLE: "CARD",
});
const FAMILY_EXPECTATIONS = Object.freeze({
  direct_safe: {
    artifact_state: "safe",
    capability: "CARD_DISCLOSABLE",
    current_safe_to_disclose: true,
    blocker: "none",
    forbidden_literals: 0,
  },
  redactable_secret: {
    artifact_state: "safe",
    capability: "INTERNAL_CONTEXT",
    current_safe_to_disclose: false,
    blocker: "none",
    forbidden_literals: 1,
  },
  raw_log: {
    artifact_state: "raw_log",
    capability: "RETRIEVAL_ONLY",
    current_safe_to_disclose: false,
    blocker: "none",
    forbidden_literals: 1,
  },
  tool_output: {
    artifact_state: "tool_output",
    capability: "RETRIEVAL_ONLY",
    current_safe_to_disclose: false,
    blocker: "none",
    forbidden_literals: 1,
  },
  sensitive_source: {
    artifact_state: "safe",
    capability: "INTERNAL_CONTEXT",
    current_safe_to_disclose: false,
    blocker: "none",
    forbidden_literals: 1,
  },
  capability_blocked: {
    artifact_state: "safe",
    capability: "RETRIEVAL_ONLY",
    current_safe_to_disclose: true,
    blocker: null,
    forbidden_literals: 0,
  },
});
const REAL_PATH_PATTERN = /(?:~\/(?:\.openclaw|\.config)|\/home\/|\/Users\/|[A-Za-z]:\\Users\\|\/var\/lib\/|memory-engine\.sqlite|main\.sqlite)/iu;
const SYNTHETIC_CASE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)+$/u;
const SYNTHETIC_LITERAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_:-]*$/u;
const MAX_DIAGNOSTICS = 256;

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function diagnostic(code, path) {
  return { code, path };
}

function addDiagnostic(diagnostics, code, path) {
  if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(diagnostic(code, path));
}

function addUnknownFieldDiagnostics(value, allowedFields, path, diagnostics) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowedFields.includes(key)) addDiagnostic(diagnostics, "unknown_field", `${path}.${key}`);
  }
}

function requireFields(value, fields, path, diagnostics) {
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, "object_required", path);
    return false;
  }
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) addDiagnostic(diagnostics, "required_field_missing", `${path}.${field}`);
  }
  return true;
}

function enumValue(value, allowed, path, diagnostics, code = "invalid_enum") {
  if (!allowed.has(value)) addDiagnostic(diagnostics, code, path);
}

function validateStringArray(value, path, diagnostics, { allowed = null, literals = false } = {}) {
  if (!Array.isArray(value)) {
    addDiagnostic(diagnostics, "array_required", path);
    return;
  }
  const seen = new Set();
  value.forEach((item, index) => {
    if (!nonEmptyString(item)) {
      addDiagnostic(diagnostics, "invalid_string", `${path}[${index}]`);
      return;
    }
    if (allowed && !allowed.has(item)) addDiagnostic(diagnostics, "invalid_enum", `${path}[${index}]`);
    if (literals && !SYNTHETIC_LITERAL_PATTERN.test(item)) {
      addDiagnostic(diagnostics, "invalid_synthetic_literal", `${path}[${index}]`);
    }
    const normalized = literals ? normalizeProjectionLiteral(item) : item;
    if (seen.has(normalized)) addDiagnostic(diagnostics, "duplicate_value", `${path}[${index}]`);
    seen.add(normalized);
  });
}

function validateFiniteNumber(value, path, diagnostics, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    addDiagnostic(diagnostics, "invalid_number", path);
  }
}

function validateBoolean(value, path, diagnostics) {
  if (typeof value !== "boolean") addDiagnostic(diagnostics, "invalid_boolean", path);
}

function validateExactString(value, expected, path, diagnostics, code = "invalid_string") {
  if (value !== expected) addDiagnostic(diagnostics, code, path);
}

function hasRealPath(value) {
  if (typeof value === "string") return REAL_PATH_PATTERN.test(value);
  if (Array.isArray(value)) return value.some(hasRealPath);
  if (isRecord(value)) return Object.values(value).some(hasRealPath);
  return false;
}

export function normalizeProjectionLiteral(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+/gu, " ")
    .trim()
    .toUpperCase();
}

function containsProjectionLiteral(value, literal) {
  return normalizeProjectionLiteral(value).includes(normalizeProjectionLiteral(literal));
}

function validateCanonicalMemory(canonical, caseId, path, diagnostics) {
  if (!requireFields(canonical, CANONICAL_MEMORY_FIELDS, path, diagnostics)) return;
  addUnknownFieldDiagnostics(canonical, CANONICAL_MEMORY_FIELDS, path, diagnostics);
  validateExactString(canonical.schema_version, 1, `${path}.schema_version`, diagnostics, "invalid_schema_version");
  if (!nonEmptyString(canonical.memory_id)) addDiagnostic(diagnostics, "invalid_memory_id", `${path}.memory_id`);
  if (!nonEmptyString(canonical.canonical_id)) addDiagnostic(diagnostics, "invalid_canonical_id", `${path}.canonical_id`);
  validateExactString(
    canonical.memory_id,
    `memory-projection-holdout-v1-${caseId}`,
    `${path}.memory_id`,
    diagnostics,
    "synthetic_identity_mismatch",
  );
  validateExactString(
    canonical.canonical_id,
    `cmem:synthetic:memory-projection-holdout-v1:${caseId}`,
    `${path}.canonical_id`,
    diagnostics,
    "synthetic_identity_mismatch",
  );

  const sourcePath = `${path}.source`;
  if (requireFields(canonical.source, CANONICAL_SOURCE_FIELDS, sourcePath, diagnostics)) {
    addUnknownFieldDiagnostics(canonical.source, CANONICAL_SOURCE_FIELDS, sourcePath, diagnostics);
    validateExactString(canonical.source.system, "synthetic_evaluation", `${sourcePath}.system`, diagnostics, "not_synthetic_source");
    validateExactString(canonical.source.record_type, "chunk", `${sourcePath}.record_type`, diagnostics);
    validateExactString(canonical.source.record_id, canonical.memory_id, `${sourcePath}.record_id`, diagnostics, "synthetic_identity_mismatch");
    validateExactString(
      canonical.source.path,
      `synthetic/memory-projection-holdout-v1/${caseId}.md`,
      `${sourcePath}.path`,
      diagnostics,
      "synthetic_path_mismatch",
    );
    validateExactString(canonical.source.core_source, "synthetic", `${sourcePath}.core_source`, diagnostics, "not_synthetic_source");
    for (const field of ["line_start", "line_end"]) {
      if (!Number.isSafeInteger(canonical.source[field]) || canonical.source[field] < 1) {
        addDiagnostic(diagnostics, "invalid_line_number", `${sourcePath}.${field}`);
      }
    }
    if (
      Number.isSafeInteger(canonical.source.line_start) &&
      Number.isSafeInteger(canonical.source.line_end) &&
      canonical.source.line_end < canonical.source.line_start
    ) {
      addDiagnostic(diagnostics, "invalid_line_range", sourcePath);
    }
    if (!nonEmptyString(canonical.source.text)) addDiagnostic(diagnostics, "invalid_source_text", `${sourcePath}.text`);
    if (!nonEmptyString(canonical.source.core_hash)) addDiagnostic(diagnostics, "invalid_core_hash", `${sourcePath}.core_hash`);
    validateFiniteNumber(canonical.source.updated_at, `${sourcePath}.updated_at`, diagnostics);
  }

  const classificationPath = `${path}.classification`;
  if (requireFields(canonical.classification, CANONICAL_CLASSIFICATION_FIELDS, classificationPath, diagnostics)) {
    addUnknownFieldDiagnostics(canonical.classification, CANONICAL_CLASSIFICATION_FIELDS, classificationPath, diagnostics);
    for (const field of CANONICAL_CLASSIFICATION_FIELDS) {
      if (!nonEmptyString(canonical.classification[field])) addDiagnostic(diagnostics, "invalid_string", `${classificationPath}.${field}`);
    }
  }

  const temporalPath = `${path}.temporal`;
  if (requireFields(canonical.temporal, CANONICAL_TEMPORAL_FIELDS, temporalPath, diagnostics)) {
    addUnknownFieldDiagnostics(canonical.temporal, CANONICAL_TEMPORAL_FIELDS, temporalPath, diagnostics);
    for (const field of CANONICAL_TEMPORAL_FIELDS) {
      if (canonical.temporal[field] !== null && !nonEmptyString(canonical.temporal[field])) {
        addDiagnostic(diagnostics, "invalid_temporal_value", `${temporalPath}.${field}`);
      }
    }
  }

  const lifecyclePath = `${path}.lifecycle`;
  if (requireFields(canonical.lifecycle, CANONICAL_LIFECYCLE_FIELDS, lifecyclePath, diagnostics)) {
    addUnknownFieldDiagnostics(canonical.lifecycle, CANONICAL_LIFECYCLE_FIELDS, lifecyclePath, diagnostics);
    validateExactString(canonical.lifecycle.management, "managed", `${lifecyclePath}.management`, diagnostics);
    if (!nonEmptyString(canonical.lifecycle.category)) addDiagnostic(diagnostics, "invalid_string", `${lifecyclePath}.category`);
    validateFiniteNumber(canonical.lifecycle.initial_confidence, `${lifecyclePath}.initial_confidence`, diagnostics, { min: 0, max: 1 });
    validateFiniteNumber(canonical.lifecycle.confidence, `${lifecyclePath}.confidence`, diagnostics, { min: 0, max: 1 });
    validateFiniteNumber(canonical.lifecycle.last_confidence_update, `${lifecyclePath}.last_confidence_update`, diagnostics);
    validateFiniteNumber(canonical.lifecycle.base_tau_days, `${lifecyclePath}.base_tau_days`, diagnostics, { min: 0 });
    if (!Number.isSafeInteger(canonical.lifecycle.hit_count) || canonical.lifecycle.hit_count < 0) {
      addDiagnostic(diagnostics, "invalid_hit_count", `${lifecyclePath}.hit_count`);
    }
    for (const field of ["archived", "protected", "conflict"]) validateBoolean(canonical.lifecycle[field], `${lifecyclePath}.${field}`, diagnostics);
  }

  const contentRefPath = `${path}.content_ref`;
  if (requireFields(canonical.content_ref, CANONICAL_CONTENT_REF_FIELDS, contentRefPath, diagnostics)) {
    addUnknownFieldDiagnostics(canonical.content_ref, CANONICAL_CONTENT_REF_FIELDS, contentRefPath, diagnostics);
    validateExactString(canonical.content_ref.mode, "core_chunk", `${contentRefPath}.mode`, diagnostics);
    if (!/^sha256:[A-Za-z0-9_-]+$/u.test(String(canonical.content_ref.content_hash || ""))) {
      addDiagnostic(diagnostics, "invalid_content_hash", `${contentRefPath}.content_hash`);
    }
  }
}

function validateRuntimeCandidate(candidate, canonical, caseId, path, diagnostics) {
  if (!requireFields(candidate, RUNTIME_CANDIDATE_FIELDS, path, diagnostics)) return;
  addUnknownFieldDiagnostics(candidate, RUNTIME_CANDIDATE_FIELDS, path, diagnostics);
  validateExactString(candidate.id, `runtime-projection-holdout-v1-${caseId}`, `${path}.id`, diagnostics, "synthetic_identity_mismatch");
  validateExactString(
    candidate.path,
    `synthetic/memory-projection-holdout-v1/${caseId}.md`,
    `${path}.path`,
    diagnostics,
    "synthetic_path_mismatch",
  );
  for (const field of ["text", "category", "kind", "trace_id"]) {
    if (!nonEmptyString(candidate[field])) addDiagnostic(diagnostics, "invalid_string", `${path}.${field}`);
  }
  if (candidate.category !== canonical?.classification?.category) addDiagnostic(diagnostics, "runtime_canonical_category_mismatch", `${path}.category`);
  if (candidate.kind !== canonical?.classification?.kind) addDiagnostic(diagnostics, "runtime_canonical_kind_mismatch", `${path}.kind`);
  validateFiniteNumber(candidate.confidence, `${path}.confidence`, diagnostics, { min: 0, max: 1 });
  validateFiniteNumber(candidate.final_score, `${path}.final_score`, diagnostics, { min: 0, max: 1 });
  if (!Number.isSafeInteger(candidate.retrieval_rank) || candidate.retrieval_rank < 1) {
    addDiagnostic(diagnostics, "invalid_retrieval_rank", `${path}.retrieval_rank`);
  }
  validateStringArray(candidate.sources, `${path}.sources`, diagnostics);
  validateStringArray(candidate.risk_flags, `${path}.risk_flags`, diagnostics, { allowed: RUNTIME_RISK_FLAGS });
}

function validatePolicyContext(context, family, path, diagnostics) {
  if (!requireFields(context, POLICY_CONTEXT_FIELDS, path, diagnostics)) return;
  addUnknownFieldDiagnostics(context, POLICY_CONTEXT_FIELDS, path, diagnostics);
  enumValue(context.scope, SCOPES, `${path}.scope`, diagnostics, "invalid_scope");
  enumValue(context.agent_scope, AGENT_SCOPES, `${path}.agent_scope`, diagnostics, "invalid_agent_scope");
  validateStringArray(context.risk_flags, `${path}.risk_flags`, diagnostics, { allowed: POLICY_RISK_FLAGS });
  enumValue(context.artifact_state, ARTIFACT_STATES, `${path}.artifact_state`, diagnostics, "invalid_artifact_state");
  enumValue(context.lifecycle_state, LIFECYCLE_STATES, `${path}.lifecycle_state`, diagnostics, "invalid_lifecycle_state");
  validateBoolean(context.current_safe_to_disclose, `${path}.current_safe_to_disclose`, diagnostics);
  enumValue(context.capability_blocker, new Set(PROJECTION_AWARE_HOLDOUT_CAPABILITY_BLOCKERS), `${path}.capability_blocker`, diagnostics, "invalid_capability_blocker");

  const expected = FAMILY_EXPECTATIONS[family];
  if (!expected) return;
  validateExactString(context.artifact_state, expected.artifact_state, `${path}.artifact_state`, diagnostics, "family_policy_mismatch");
  if (expected.blocker === null) {
    if (context.capability_blocker === "none") addDiagnostic(diagnostics, "family_policy_mismatch", `${path}.capability_blocker`);
  } else {
    validateExactString(context.capability_blocker, expected.blocker, `${path}.capability_blocker`, diagnostics, "family_policy_mismatch");
  }
  if (context.current_safe_to_disclose !== expected.current_safe_to_disclose) {
    addDiagnostic(diagnostics, "family_policy_mismatch", `${path}.current_safe_to_disclose`);
  }
  if (family === "capability_blocked") {
    if (context.capability_blocker === "lifecycle" && !["archived", "quarantined", "deleted_shadow", "stale_index_candidate"].includes(context.lifecycle_state)) {
      addDiagnostic(diagnostics, "invalid_lifecycle_blocker", `${path}.lifecycle_state`);
    }
    if (context.capability_blocker === "cross_scope" && context.agent_scope !== "cross_agent") {
      addDiagnostic(diagnostics, "invalid_cross_scope_blocker", `${path}.agent_scope`);
    }
  } else if (context.lifecycle_state !== "active") {
    addDiagnostic(diagnostics, "unexpected_policy_lifecycle", `${path}.lifecycle_state`);
  }
}

function validateSurfaceSafety(surfaceSafety, sourceText, runtimeText, family, path, diagnostics) {
  if (!requireFields(surfaceSafety, SURFACE_SAFETY_FIELDS, path, diagnostics)) return;
  addUnknownFieldDiagnostics(surfaceSafety, SURFACE_SAFETY_FIELDS, path, diagnostics);
  validateStringArray(surfaceSafety.forbidden_literals, `${path}.forbidden_literals`, diagnostics, { literals: true });
  const expected = FAMILY_EXPECTATIONS[family];
  const forbiddenLiterals = Array.isArray(surfaceSafety.forbidden_literals) ? surfaceSafety.forbidden_literals : [];
  if (expected && expected.forbidden_literals === 0 && forbiddenLiterals.length !== 0) {
    addDiagnostic(diagnostics, "family_safety_mismatch", `${path}.forbidden_literals`);
  }
  if (expected && expected.forbidden_literals > 0 && forbiddenLiterals.length === 0) {
    addDiagnostic(diagnostics, "family_safety_mismatch", `${path}.forbidden_literals`);
  }
  for (const [index, literal] of forbiddenLiterals.entries()) {
    if (!containsProjectionLiteral(sourceText, literal) || !containsProjectionLiteral(runtimeText, literal)) {
      addDiagnostic(diagnostics, "literal_not_present_in_projection_input", `${path}.forbidden_literals[${index}]`);
    }
  }
}

function validateSemanticPreservation(semantic, sourceText, runtimeText, answerBearing, path, diagnostics) {
  if (!requireFields(semantic, SEMANTIC_PRESERVATION_FIELDS, path, diagnostics)) return;
  addUnknownFieldDiagnostics(semantic, SEMANTIC_PRESERVATION_FIELDS, path, diagnostics);
  validateStringArray(semantic.required_literals, `${path}.required_literals`, diagnostics, { literals: true });
  validateBoolean(semantic.required, `${path}.required`, diagnostics);
  const requiredLiterals = Array.isArray(semantic.required_literals) ? semantic.required_literals : [];
  if (semantic.required === true && requiredLiterals.length === 0) {
    addDiagnostic(diagnostics, "required_semantic_anchor_missing", `${path}.required_literals`);
  }
  if (semantic.required === false && requiredLiterals.length > 0) {
    addDiagnostic(diagnostics, "unexpected_semantic_anchors", `${path}.required_literals`);
  }
  if (answerBearing === true && semantic.required !== true) {
    addDiagnostic(diagnostics, "answer_bearing_requires_semantic_preservation", `${path}.required`);
  }
  if (answerBearing === false && semantic.required !== false) {
    addDiagnostic(diagnostics, "non_answer_bearing_requires_no_semantic_preservation", `${path}.required`);
  }
  for (const [index, literal] of requiredLiterals.entries()) {
    if (!containsProjectionLiteral(sourceText, literal) || !containsProjectionLiteral(runtimeText, literal)) {
      addDiagnostic(diagnostics, "semantic_anchor_not_present_in_projection_input", `${path}.required_literals[${index}]`);
    }
  }
}

function validateCurrentV1_1(current, policyContext, family, path, diagnostics) {
  if (!requireFields(current, CURRENT_V1_1_FIELDS, path, diagnostics)) return;
  addUnknownFieldDiagnostics(current, CURRENT_V1_1_FIELDS, path, diagnostics);
  enumValue(current.expected_capability, new Set(PROJECTION_AWARE_HOLDOUT_CAPABILITIES), `${path}.expected_capability`, diagnostics, "invalid_capability");
  enumValue(current.expected_disclosure_authority, new Set(PROJECTION_AWARE_HOLDOUT_DISCLOSURE_AUTHORITIES), `${path}.expected_disclosure_authority`, diagnostics, "invalid_disclosure_authority");
  if (CAPABILITY_TO_AUTHORITY[current.expected_capability] !== current.expected_disclosure_authority) {
    addDiagnostic(diagnostics, "capability_disclosure_mismatch", `${path}.expected_disclosure_authority`);
  }
  const expected = FAMILY_EXPECTATIONS[family];
  if (expected && expected.capability !== current.expected_capability) {
    addDiagnostic(diagnostics, "family_capability_mismatch", `${path}.expected_capability`);
  }
  if (current.expected_disclosure_authority === "CARD" && policyContext.current_safe_to_disclose !== true) {
    addDiagnostic(diagnostics, "card_authority_requires_current_safe_to_disclose", `${path}.expected_disclosure_authority`);
  }
  if (family === "capability_blocked" && current.expected_capability === "CARD_DISCLOSABLE") {
    addDiagnostic(diagnostics, "capability_blocker_cannot_grant_card_authority", `${path}.expected_capability`);
  }
}

export function validateProjectionAwareHoldoutRow(row) {
  const diagnostics = [];
  if (!requireFields(row, ROW_FIELDS, "row", diagnostics)) return { valid: false, diagnostics };
  addUnknownFieldDiagnostics(row, ROW_FIELDS, "row", diagnostics);
  validateExactString(row.schema_version, PROJECTION_AWARE_HOLDOUT_SCHEMA_VERSION, "row.schema_version", diagnostics, "invalid_schema_version");
  validateExactString(row.dataset_id, PROJECTION_AWARE_HOLDOUT_DATASET_ID, "row.dataset_id", diagnostics, "invalid_dataset_id");
  if (!nonEmptyString(row.case_id) || !SYNTHETIC_CASE_PATTERN.test(row.case_id)) addDiagnostic(diagnostics, "invalid_case_id", "row.case_id");
  enumValue(row.family, new Set(PROJECTION_AWARE_HOLDOUT_FAMILIES), "row.family", diagnostics, "invalid_family");
  validateExactString(row.projection_surface, PROJECTION_AWARE_HOLDOUT_PROJECTION_SURFACE, "row.projection_surface", diagnostics, "invalid_projection_surface");
  validateExactString(row.label_confidence, PROJECTION_AWARE_HOLDOUT_CONTRACT.label_confidence, "row.label_confidence", diagnostics, "invalid_label_confidence");
  validateExactString(row.annotator, PROJECTION_AWARE_HOLDOUT_ANNOTATOR, "row.annotator", diagnostics, "invalid_annotator");

  if (hasRealPath(row)) addDiagnostic(diagnostics, "real_path_or_production_data_forbidden", "row");
  validateCanonicalMemory(row.canonical_memory, row.case_id, "row.canonical_memory", diagnostics);
  validateRuntimeCandidate(row.runtime_candidate, row.canonical_memory, row.case_id, "row.runtime_candidate", diagnostics);
  validatePolicyContext(row.policy_context, row.family, "row.policy_context", diagnostics);

  const sourceText = row.canonical_memory?.source?.text || "";
  const runtimeText = row.runtime_candidate?.text || "";
  if (!requireFields(row.label, LABEL_FIELDS, "row.label", diagnostics)) return { valid: false, diagnostics };
  addUnknownFieldDiagnostics(row.label, LABEL_FIELDS, "row.label", diagnostics);
  validateBoolean(row.label.answer_bearing, "row.label.answer_bearing", diagnostics);
  validateBoolean(row.label.expected_projection_valid, "row.label.expected_projection_valid", diagnostics);
  validateSurfaceSafety(row.label.surface_safety, sourceText, runtimeText, row.family, "row.label.surface_safety", diagnostics);
  validateSemanticPreservation(row.label.semantic_preservation, sourceText, runtimeText, row.label.answer_bearing, "row.label.semantic_preservation", diagnostics);
  validateCurrentV1_1(row.label.current_v1_1, row.policy_context || {}, row.family, "row.label.current_v1_1", diagnostics);

  return { valid: diagnostics.length === 0, diagnostics };
}

export function validateProjectionAwareHoldoutRows(rows) {
  if (!Array.isArray(rows)) return { valid: false, diagnostics: [diagnostic("rows_array_required", "rows")] };
  const diagnostics = [];
  const datasetIds = new Set();
  const caseIds = new Set();
  rows.forEach((row, index) => {
    const result = validateProjectionAwareHoldoutRow(row);
    for (const item of result.diagnostics) {
      if (diagnostics.length >= MAX_DIAGNOSTICS) break;
      diagnostics.push({ ...item, path: `rows[${index}].${item.path.replace(/^row\.?/u, "")}` });
    }
    if (nonEmptyString(row?.dataset_id)) datasetIds.add(row.dataset_id);
    if (nonEmptyString(row?.case_id)) {
      if (caseIds.has(row.case_id)) addDiagnostic(diagnostics, "duplicate_case_id", `rows[${index}].case_id`);
      caseIds.add(row.case_id);
    }
  });
  if (datasetIds.size !== 1 || !datasetIds.has(PROJECTION_AWARE_HOLDOUT_DATASET_ID)) {
    addDiagnostic(diagnostics, "dataset_id_not_unique", "rows.dataset_id");
  }
  return { valid: diagnostics.length === 0, diagnostics };
}

export function validateProjectionAwareHoldoutFixture(
  rows,
  contract = PROJECTION_AWARE_HOLDOUT_CONTRACT,
) {
  const base = validateProjectionAwareHoldoutRows(rows);
  const diagnostics = [...base.diagnostics];
  if (!Array.isArray(rows)) return { valid: false, diagnostics };
  if (rows.length !== contract.expected_count) addDiagnostic(diagnostics, "invalid_row_count", "rows");
  const expectedFamilies = Array.isArray(contract.expected_families) ? contract.expected_families : [];
  const actualFamilies = new Set(rows.map(row => row?.family).filter(nonEmptyString));
  for (const family of expectedFamilies) {
    const familyRows = rows.filter(row => row?.family === family);
    if (familyRows.length !== contract.rows_per_family) addDiagnostic(diagnostics, "invalid_family_row_count", `families.${family}`);
    const answerBearingRows = familyRows.filter(row => row?.label?.answer_bearing === true).length;
    const nonAnswerBearingRows = familyRows.filter(row => row?.label?.answer_bearing === false).length;
    if (answerBearingRows !== contract.answer_bearing_rows_per_family) addDiagnostic(diagnostics, "invalid_family_answer_bearing_balance", `families.${family}`);
    if (nonAnswerBearingRows !== contract.non_answer_bearing_rows_per_family) addDiagnostic(diagnostics, "invalid_family_non_answer_bearing_balance", `families.${family}`);
  }
  for (const family of actualFamilies) {
    if (!expectedFamilies.includes(family)) addDiagnostic(diagnostics, "unknown_family", `families.${family}`);
  }
  const blockedAnswerCases = rows.filter(row => (
    row?.family === "capability_blocked" &&
    row?.label?.answer_bearing === true &&
    row?.label?.expected_projection_valid === true &&
    row?.label?.surface_safety?.forbidden_literals?.length === 0 &&
    row?.label?.semantic_preservation?.required === true &&
    row?.label?.current_v1_1?.expected_capability !== "CARD_DISCLOSABLE"
  ));
  if (blockedAnswerCases.length === 0) addDiagnostic(diagnostics, "missing_projection_feasible_capability_blocked_case", "families.capability_blocked");
  return { valid: diagnostics.length === 0, diagnostics };
}
