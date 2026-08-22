export const INTERNAL_AGENT_CONTEXT_HOLDOUT_SCHEMA_VERSION = 1;
export const INTERNAL_AGENT_CONTEXT_HOLDOUT_DATASET_ID = "internal-agent-context-holdout-v1";
export const INTERNAL_AGENT_CONTEXT_HOLDOUT_ANNOTATOR = "internal_agent_context_holdout_v1_synthetic";
export const INTERNAL_AGENT_CONTEXT_HOLDOUT_PROJECTION_SURFACE = "INTERNAL_AGENT_CONTEXT";

export const INTERNAL_AGENT_CONTEXT_HOLDOUT_FAMILIES = Object.freeze([
  "raw_log_single",
  "tool_output_single",
  "multi_segment_operational",
  "instruction_like_evidence",
  "full_source_selection",
  "risk_metadata_preservation",
]);

export const INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_SEGMENTS = 4;
export const INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_SEGMENT_CHARS = 1024;
export const INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_TOTAL_SELECTED_CHARS = 2048;
export const INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_RISK_FLAGS = 16;
export const INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_RISK_FLAG_CHARS = 64;

const MAX_DIAGNOSTICS = 64;
const MAX_LITERAL_LENGTH = 256;
const RAW_OR_TOOL_CATEGORIES = new Set(["raw_log", "tool_output"]);
const ROW_FIELDS = new Set([
  "schema_version",
  "dataset_id",
  "case_id",
  "family",
  "projection_surface",
  "canonical_memory",
  "selection",
  "label",
  "label_confidence",
  "annotator",
]);
const CANONICAL_MEMORY_FIELDS = new Set([
  "schema_version",
  "canonical_id",
  "memory_id",
  "source",
  "classification",
  "temporal",
  "lifecycle",
  "content_ref",
]);
const CANONICAL_SOURCE_FIELDS = new Set([
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
]);
const CANONICAL_CLASSIFICATION_FIELDS = new Set([
  "category",
  "category_authority",
  "kind",
  "kind_basis",
]);
const CANONICAL_TEMPORAL_FIELDS = new Set(["episode_date", "episode_date_basis"]);
const CANONICAL_LIFECYCLE_FIELDS = new Set([
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
]);
const CANONICAL_CONTENT_REF_FIELDS = new Set(["mode", "content_hash"]);
const SELECTION_FIELDS = new Set(["ranges", "risk_flags"]);
const RANGE_FIELDS = new Set(["start", "end"]);
const LABEL_FIELDS = new Set([
  "answer_bearing",
  "expected_projection_valid",
  "semantic_preservation",
  "instruction_data_isolation",
  "expected_source_fully_selected",
  "expected_risk_flags",
]);
const SEMANTIC_FIELDS = new Set(["required", "required_literals"]);
const INSTRUCTION_FIELDS = new Set(["instruction_like_literals"]);

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasExactFields(value, allowedFields) {
  return isRecord(value) &&
    Object.keys(value).length === allowedFields.size &&
    Object.keys(value).every(key => allowedFields.has(key));
}

function addDiagnostic(diagnostics, code, path) {
  if (diagnostics.length >= MAX_DIAGNOSTICS) return;
  diagnostics.push({
    code: typeof code === "string" ? code.slice(0, 80) : "invalid_holdout",
    path: typeof path === "string" ? path.slice(0, 160) : "row",
  });
}

function boundedLiteral(value) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_LITERAL_LENGTH &&
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value);
}

function hasUnsafeSelectedCharacter(value) {
  for (const character of value) {
    if (character === "\t" || character === "\n" || character === "\r") continue;
    if (/\p{C}/u.test(character)) return true;
  }
  return false;
}

function validateLiteralList(value, path, diagnostics, { required = false, requireIachNamespace = false } = {}) {
  if (!Array.isArray(value) || (required && value.length === 0) || value.length > 16) {
    addDiagnostic(diagnostics, "invalid_literal_list", path);
    return;
  }
  const seen = new Set();
  for (const [index, literal] of value.entries()) {
    if (!boundedLiteral(literal) || (requireIachNamespace && !literal.startsWith("IACH1_"))) {
      addDiagnostic(diagnostics, "invalid_synthetic_literal", `${path}[${index}]`);
      continue;
    }
    if (seen.has(literal)) addDiagnostic(diagnostics, "duplicate_literal", `${path}[${index}]`);
    seen.add(literal);
  }
}

function containsInSelectedSegments(segments, literal) {
  return segments.some(segment => segment.text.includes(literal));
}

function validateCanonicalMemory(canonicalMemory, diagnostics) {
  if (!hasExactFields(canonicalMemory, CANONICAL_MEMORY_FIELDS)) {
    addDiagnostic(diagnostics, "invalid_canonical_memory_shape", "canonical_memory");
    return null;
  }
  if (canonicalMemory.schema_version !== 1 ||
      !nonEmptyString(canonicalMemory.canonical_id) ||
      !canonicalMemory.canonical_id.includes("IACH1_") ||
      !nonEmptyString(canonicalMemory.memory_id) ||
      !canonicalMemory.memory_id.includes("IACH1_")) {
    addDiagnostic(diagnostics, "invalid_canonical_identity", "canonical_memory");
  }

  const source = canonicalMemory.source;
  if (!hasExactFields(source, CANONICAL_SOURCE_FIELDS) ||
      source.system !== "synthetic_evaluation" ||
      source.core_source !== "synthetic" ||
      !nonEmptyString(source.record_id) ||
      !source.record_id.includes("IACH1_") ||
      !nonEmptyString(source.path) ||
      !source.path.startsWith("synthetic/internal-agent-context-holdout-v1/") ||
      !Number.isSafeInteger(source.line_start) ||
      !Number.isSafeInteger(source.line_end) ||
      source.line_start < 1 ||
      source.line_end < source.line_start ||
      typeof source.text !== "string" ||
      source.text.length === 0 ||
      !nonEmptyString(source.core_hash) ||
      !Number.isSafeInteger(source.updated_at)) {
    addDiagnostic(diagnostics, "invalid_synthetic_source", "canonical_memory.source");
  }

  const classification = canonicalMemory.classification;
  if (!hasExactFields(classification, CANONICAL_CLASSIFICATION_FIELDS) ||
      !RAW_OR_TOOL_CATEGORIES.has(classification.category) ||
      !nonEmptyString(classification.kind) ||
      !nonEmptyString(classification.category_authority) ||
      !nonEmptyString(classification.kind_basis)) {
    addDiagnostic(diagnostics, "invalid_canonical_classification", "canonical_memory.classification");
  }

  if (!hasExactFields(canonicalMemory.temporal, CANONICAL_TEMPORAL_FIELDS) ||
      canonicalMemory.temporal.episode_date !== null ||
      canonicalMemory.temporal.episode_date_basis !== null) {
    addDiagnostic(diagnostics, "invalid_canonical_temporal", "canonical_memory.temporal");
  }

  const lifecycle = canonicalMemory.lifecycle;
  if (!hasExactFields(lifecycle, CANONICAL_LIFECYCLE_FIELDS) ||
      lifecycle.management !== "managed" ||
      lifecycle.category !== canonicalMemory.classification?.category ||
      !Number.isFinite(lifecycle.initial_confidence) ||
      !Number.isFinite(lifecycle.confidence) ||
      !Number.isSafeInteger(lifecycle.last_confidence_update) ||
      !Number.isFinite(lifecycle.base_tau_days) ||
      !Number.isSafeInteger(lifecycle.hit_count) ||
      typeof lifecycle.archived !== "boolean" ||
      typeof lifecycle.protected !== "boolean" ||
      typeof lifecycle.conflict !== "boolean") {
    addDiagnostic(diagnostics, "invalid_canonical_lifecycle", "canonical_memory.lifecycle");
  }

  const contentRef = canonicalMemory.content_ref;
  if (!hasExactFields(contentRef, CANONICAL_CONTENT_REF_FIELDS) ||
      contentRef.mode !== "core_chunk" ||
      !nonEmptyString(contentRef.content_hash)) {
    addDiagnostic(diagnostics, "invalid_canonical_content_ref", "canonical_memory.content_ref");
  }

  return typeof source?.text === "string" && source.text.length > 0 ? source.text : null;
}

function validateRiskFlags(value, path, diagnostics) {
  if (!Array.isArray(value) || value.length > INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_RISK_FLAGS) {
    addDiagnostic(diagnostics, "invalid_risk_flags", path);
    return;
  }
  const seen = new Set();
  for (const [index, flag] of value.entries()) {
    if (!nonEmptyString(flag) || flag.length > INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_RISK_FLAG_CHARS) {
      addDiagnostic(diagnostics, "invalid_risk_flag", `${path}[${index}]`);
      continue;
    }
    if (seen.has(flag)) addDiagnostic(diagnostics, "duplicate_risk_flag", `${path}[${index}]`);
    seen.add(flag);
  }
}

function validateSelection(selection, sourceText, diagnostics) {
  if (!hasExactFields(selection, SELECTION_FIELDS)) {
    addDiagnostic(diagnostics, "invalid_selection_shape", "selection");
    return { segments: [], sourceFullySelected: false, riskFlags: [] };
  }
  if (!Array.isArray(selection.ranges) ||
      selection.ranges.length < 1 ||
      selection.ranges.length > INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_SEGMENTS) {
    addDiagnostic(diagnostics, "invalid_range_count", "selection.ranges");
  }
  validateRiskFlags(selection.risk_flags, "selection.risk_flags", diagnostics);

  const segments = [];
  let selectedCharCount = 0;
  let previousStart = null;
  let previousEnd = null;
  if (!Array.isArray(selection.ranges)) {
    return { segments, sourceFullySelected: false, riskFlags: selection.risk_flags };
  }
  for (const [index, range] of selection.ranges.entries()) {
    const path = `selection.ranges[${index}]`;
    if (!hasExactFields(range, RANGE_FIELDS) ||
        !Number.isSafeInteger(range.start) ||
        !Number.isSafeInteger(range.end) ||
        range.start < 0 ||
        range.start >= range.end ||
        range.end > sourceText.length) {
      addDiagnostic(diagnostics, "invalid_internal_context_range", path);
      continue;
    }
    if (previousStart !== null && range.start < previousStart) {
      addDiagnostic(diagnostics, "internal_context_range_order", path);
    }
    if (previousEnd !== null && range.start < previousEnd) {
      addDiagnostic(diagnostics, "internal_context_range_overlap", path);
    }
    if (range.end - range.start > INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_SEGMENT_CHARS) {
      addDiagnostic(diagnostics, "internal_context_segment_too_large", path);
    }
    const text = sourceText.slice(range.start, range.end);
    if (hasUnsafeSelectedCharacter(text)) {
      addDiagnostic(diagnostics, "invalid_internal_context_control_character", path);
    }
    selectedCharCount += text.length;
    segments.push({ start: range.start, end: range.end, text });
    previousStart = range.start;
    previousEnd = range.end;
  }
  if (selectedCharCount > INTERNAL_AGENT_CONTEXT_HOLDOUT_MAX_TOTAL_SELECTED_CHARS) {
    addDiagnostic(diagnostics, "internal_context_total_too_large", "selection.ranges");
  }
  const sourceFullySelected = segments.length > 0 &&
    segments[0].start === 0 &&
    segments.at(-1).end === sourceText.length &&
    selectedCharCount === sourceText.length;
  return { segments, sourceFullySelected, riskFlags: selection.risk_flags };
}

function validateLabel(label, answerBearing, selectionResult, family, diagnostics) {
  if (!hasExactFields(label, LABEL_FIELDS)) {
    addDiagnostic(diagnostics, "invalid_label_shape", "label");
    return;
  }
  if (typeof label.answer_bearing !== "boolean" || label.answer_bearing !== answerBearing) {
    addDiagnostic(diagnostics, "invalid_answer_bearing_label", "label.answer_bearing");
  }
  if (label.expected_projection_valid !== true) {
    addDiagnostic(diagnostics, "invalid_expected_projection_valid", "label.expected_projection_valid");
  }

  if (!hasExactFields(label.semantic_preservation, SEMANTIC_FIELDS)) {
    addDiagnostic(diagnostics, "invalid_semantic_label", "label.semantic_preservation");
  } else {
    if (label.semantic_preservation.required !== answerBearing) {
      addDiagnostic(diagnostics, "invalid_semantic_required", "label.semantic_preservation.required");
    }
    validateLiteralList(
      label.semantic_preservation.required_literals,
      "label.semantic_preservation.required_literals",
      diagnostics,
      { required: answerBearing, requireIachNamespace: true },
    );
    if (!answerBearing && Array.isArray(label.semantic_preservation.required_literals) &&
        label.semantic_preservation.required_literals.length !== 0) {
      addDiagnostic(diagnostics, "non_answer_semantic_literals_not_empty", "label.semantic_preservation.required_literals");
    }
    if (Array.isArray(label.semantic_preservation.required_literals)) {
      for (const [index, literal] of label.semantic_preservation.required_literals.entries()) {
        if (!containsInSelectedSegments(selectionResult.segments, literal)) {
          addDiagnostic(diagnostics, "required_literal_not_in_selected_slice", `label.semantic_preservation.required_literals[${index}]`);
        }
      }
    }
  }

  if (!hasExactFields(label.instruction_data_isolation, INSTRUCTION_FIELDS)) {
    addDiagnostic(diagnostics, "invalid_instruction_data_label", "label.instruction_data_isolation");
  } else {
    const instructionLiterals = label.instruction_data_isolation.instruction_like_literals;
    validateLiteralList(instructionLiterals, "label.instruction_data_isolation.instruction_like_literals", diagnostics);
    if (family === "instruction_like_evidence" &&
        (!Array.isArray(instructionLiterals) || instructionLiterals.length === 0)) {
      addDiagnostic(diagnostics, "instruction_literals_required", "label.instruction_data_isolation.instruction_like_literals");
    }
    if (Array.isArray(instructionLiterals)) {
      for (const [index, literal] of instructionLiterals.entries()) {
        if (!containsInSelectedSegments(selectionResult.segments, literal)) {
          addDiagnostic(diagnostics, "instruction_literal_not_in_selected_slice", `label.instruction_data_isolation.instruction_like_literals[${index}]`);
        }
      }
    }
  }

  if (typeof label.expected_source_fully_selected !== "boolean" ||
      label.expected_source_fully_selected !== selectionResult.sourceFullySelected) {
    addDiagnostic(diagnostics, "source_full_selection_mismatch", "label.expected_source_fully_selected");
  }
  if (!Array.isArray(label.expected_risk_flags) ||
      label.expected_risk_flags.length !== selectionResult.riskFlags.length ||
      label.expected_risk_flags.some((flag, index) => flag !== selectionResult.riskFlags[index])) {
    addDiagnostic(diagnostics, "invalid_expected_risk_flags", "label.expected_risk_flags");
  }
}

export function validateInternalAgentContextHoldoutRow(row) {
  const diagnostics = [];
  if (!hasExactFields(row, ROW_FIELDS)) {
    addDiagnostic(diagnostics, "invalid_row_shape", "row");
    return { valid: false, diagnostics };
  }
  if (row.schema_version !== INTERNAL_AGENT_CONTEXT_HOLDOUT_SCHEMA_VERSION ||
      row.dataset_id !== INTERNAL_AGENT_CONTEXT_HOLDOUT_DATASET_ID ||
      !nonEmptyString(row.case_id) ||
      !row.case_id.includes("IACH1_") ||
      !INTERNAL_AGENT_CONTEXT_HOLDOUT_FAMILIES.includes(row.family) ||
      row.projection_surface !== INTERNAL_AGENT_CONTEXT_HOLDOUT_PROJECTION_SURFACE) {
    addDiagnostic(diagnostics, "invalid_row_identity", "row");
  }
  if (row.label_confidence !== "high") addDiagnostic(diagnostics, "invalid_label_confidence", "label_confidence");
  if (row.annotator !== INTERNAL_AGENT_CONTEXT_HOLDOUT_ANNOTATOR) addDiagnostic(diagnostics, "invalid_annotator", "annotator");

  const sourceText = validateCanonicalMemory(row.canonical_memory, diagnostics);
  const selectionResult = sourceText === null
    ? { segments: [], sourceFullySelected: false, riskFlags: [] }
    : validateSelection(row.selection, sourceText, diagnostics);

  if (sourceText === null && !hasExactFields(row.selection, SELECTION_FIELDS)) {
    addDiagnostic(diagnostics, "invalid_selection_shape", "selection");
  }

  if (!isRecord(row.label)) {
    addDiagnostic(diagnostics, "invalid_label_shape", "label");
  } else {
    validateLabel(row.label, row.label.answer_bearing, selectionResult, row.family, diagnostics);
  }

  if (row.family === "raw_log_single" &&
      (row.selection?.ranges?.length !== 1 || !row.selection?.risk_flags?.includes("raw_log_like"))) {
    addDiagnostic(diagnostics, "raw_log_family_selection_mismatch", "family");
  }
  if (row.family === "tool_output_single" &&
      (row.selection?.ranges?.length !== 1 || !row.selection?.risk_flags?.includes("tool_output_like"))) {
    addDiagnostic(diagnostics, "tool_output_family_selection_mismatch", "family");
  }
  if (row.family === "multi_segment_operational" &&
      (!Array.isArray(row.selection?.ranges) || row.selection.ranges.length < 2)) {
    addDiagnostic(diagnostics, "multi_segment_family_selection_mismatch", "family");
  }
  if (row.family === "instruction_like_evidence" &&
      (!Array.isArray(row.label?.instruction_data_isolation?.instruction_like_literals) ||
       row.label.instruction_data_isolation.instruction_like_literals.length === 0)) {
    addDiagnostic(diagnostics, "instruction_family_label_mismatch", "family");
  }
  if (row.family === "full_source_selection" && row.label?.expected_source_fully_selected !== true) {
    addDiagnostic(diagnostics, "full_source_family_label_mismatch", "family");
  }
  if (row.family === "risk_metadata_preservation" &&
      (!Array.isArray(row.selection?.risk_flags) || row.selection.risk_flags.length < 2)) {
    addDiagnostic(diagnostics, "risk_metadata_family_selection_mismatch", "family");
  }

  return { valid: diagnostics.length === 0, diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS) };
}

export function validateInternalAgentContextHoldoutFixture(rows) {
  const diagnostics = [];
  if (!Array.isArray(rows)) {
    addDiagnostic(diagnostics, "rows_array_required", "rows");
    return { valid: false, diagnostics };
  }
  if (rows.length !== 12) addDiagnostic(diagnostics, "invalid_row_count", "rows");
  const caseIds = new Set();
  for (const [index, row] of rows.entries()) {
    const result = validateInternalAgentContextHoldoutRow(row);
    for (const diagnostic of result.diagnostics) {
      addDiagnostic(diagnostics, diagnostic.code, `rows[${index}].${diagnostic.path}`);
    }
    if (nonEmptyString(row?.case_id)) {
      if (caseIds.has(row.case_id)) addDiagnostic(diagnostics, "duplicate_case_id", `rows[${index}].case_id`);
      caseIds.add(row.case_id);
    }
  }

  for (const family of INTERNAL_AGENT_CONTEXT_HOLDOUT_FAMILIES) {
    const familyRows = rows.filter(row => row?.family === family);
    if (familyRows.length !== 2) addDiagnostic(diagnostics, "invalid_family_row_count", `families.${family}`);
    if (familyRows.filter(row => row?.label?.answer_bearing === true).length !== 1) {
      addDiagnostic(diagnostics, "invalid_family_answer_bearing_balance", `families.${family}`);
    }
    if (familyRows.filter(row => row?.label?.answer_bearing === false).length !== 1) {
      addDiagnostic(diagnostics, "invalid_family_non_answer_bearing_balance", `families.${family}`);
    }
  }

  const actualFamilies = new Set(rows.map(row => row?.family).filter(nonEmptyString));
  for (const family of actualFamilies) {
    if (!INTERNAL_AGENT_CONTEXT_HOLDOUT_FAMILIES.includes(family)) {
      addDiagnostic(diagnostics, "unknown_family", `families.${family}`);
    }
  }
  return { valid: diagnostics.length === 0, diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS) };
}
