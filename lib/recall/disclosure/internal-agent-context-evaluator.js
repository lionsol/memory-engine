import {
  explainProjectionArtifactValidation,
  INTERNAL_AGENT_CONTEXT_MAX_RISK_FLAGS,
  INTERNAL_AGENT_CONTEXT_MAX_RISK_FLAG_CHARS,
  INTERNAL_AGENT_CONTEXT_MAX_SEGMENTS,
  INTERNAL_AGENT_CONTEXT_MAX_SEGMENT_CHARS,
  INTERNAL_AGENT_CONTEXT_MAX_TOTAL_SELECTED_CHARS,
  projectCanonicalMemoryToInternalAgentContextArtifact,
} from "../../canonical/projection-artifact.js";
import {
  INTERNAL_AGENT_CONTEXT_HOLDOUT_FAMILIES,
  validateInternalAgentContextHoldoutFixture,
  validateInternalAgentContextHoldoutRow,
} from "./internal-agent-context-holdout.js";

const CONTENT_ROLE = "untrusted_evidence";
const PROVENANCE_ADAPTER = "canonical_internal_agent_context_extract_v1";
const PROVENANCE_SELECTION_MODE = "caller_supplied_char_ranges";
const PROVENANCE_FIELDS = new Set([
  "canonical_schema_version",
  "adapter",
  "selection_mode",
]);
const AUTHORITY_KEYS = new Set([
  "capability",
  "disclosure_capability",
  "safe_to_disclose",
  "can_inject_card",
  "can_get_full_content",
  "can_reinforce_on_citation",
  "scope_allowed",
  "scope_violation",
  "raw_access",
  "raw_disclosure",
  "get_token",
  "disclosure_level",
  "execution_authority",
  "instruction_role",
  "tool_call",
  "selector",
  "selector_result",
]);
const SIDE_EFFECTS = Object.freeze({
  retrieval: false,
  db_writes: false,
  data_mutation: false,
  selector: false,
  capability: false,
  network: false,
  llm: false,
  runtime: false,
});

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sideEffects() {
  return { ...SIDE_EFFECTS };
}

function ratio(numerator, denominator) {
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(4));
}

function boundedReason(value, fallback) {
  if (typeof value === "string" && /^[a-z0-9_:-]+$/u.test(value)) {
    return value.slice(0, 96);
  }
  return fallback;
}

function boundedDiagnostics(diagnostics = []) {
  return diagnostics.slice(0, 32).map(item => ({
    code: boundedReason(item?.code, "invalid_holdout"),
    path: typeof item?.path === "string" ? item.path.slice(0, 240) : "row",
  }));
}

function invalidRowError(diagnostics = []) {
  const error = new TypeError("internal agent context case must pass the frozen holdout row contract");
  error.code = "invalid_internal_agent_context_holdout_row";
  error.diagnostics = boundedDiagnostics(diagnostics);
  return error;
}

function invalidFixtureError(diagnostics = []) {
  const error = new TypeError("internal agent context fixture must pass the frozen holdout contract");
  error.code = "invalid_internal_agent_context_holdout_fixture";
  error.diagnostics = boundedDiagnostics(diagnostics);
  return error;
}

function assertValidRow(row) {
  let validation;
  try {
    validation = validateInternalAgentContextHoldoutRow(row);
  } catch {
    throw invalidRowError();
  }
  if (!validation.valid) throw invalidRowError(validation.diagnostics);
  return row;
}

function assertValidFixture(rows) {
  let validation;
  try {
    validation = validateInternalAgentContextHoldoutFixture(rows);
  } catch {
    throw invalidFixtureError();
  }
  if (!validation.valid) throw invalidFixtureError(validation.diagnostics);
  return rows;
}

function exactFields(value, fields) {
  return isRecord(value) &&
    Object.keys(value).length === fields.size &&
    Object.keys(value).every(field => fields.has(field));
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]));
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]));
  }
  return false;
}

function collectAuthorityKeys(value, keys = new Set()) {
  if (Array.isArray(value)) {
    value.forEach(item => collectAuthorityKeys(item, keys));
    return keys;
  }
  if (!isRecord(value)) return keys;
  for (const [key, child] of Object.entries(value)) {
    if (AUTHORITY_KEYS.has(key)) keys.add(key);
    collectAuthorityKeys(child, keys);
  }
  return keys;
}

function candidateProjection(row) {
  let artifact;
  try {
    artifact = projectCanonicalMemoryToInternalAgentContextArtifact(
      row.canonical_memory,
      row.selection,
    );
  } catch (error) {
    return {
      artifact: null,
      projection_success: false,
      projection_reason: boundedReason(error?.reason, "projection_failed"),
      validation: null,
    };
  }

  if (!isRecord(artifact)) {
    return {
      artifact: null,
      projection_success: false,
      projection_reason: "projection_failed",
      validation: null,
    };
  }

  let validation;
  try {
    validation = explainProjectionArtifactValidation(artifact, row.canonical_memory);
  } catch {
    validation = { valid: false, reason: "projection_validation_failed" };
  }
  return {
    artifact,
    projection_success: true,
    projection_reason: validation.valid === true
      ? "valid"
      : boundedReason(validation.reason, "projection_invalid"),
    validation,
  };
}

function boundednessEvidence(artifact, canonicalMemory) {
  const payload = artifact?.payload;
  const sourceText = canonicalMemory?.source?.text;
  if (!isRecord(payload) || typeof sourceText !== "string" || !Array.isArray(payload.segments)) {
    return { valid: null, sourceFullySelected: null };
  }

  let valid = true;
  let selectedCharCount = 0;
  let previousStart = null;
  let previousEnd = null;
  for (const segment of payload.segments) {
    if (!isRecord(segment) ||
        !Number.isSafeInteger(segment.start) ||
        !Number.isSafeInteger(segment.end) ||
        segment.start < 0 ||
        segment.start >= segment.end ||
        segment.end > sourceText.length ||
        typeof segment.text !== "string") {
      valid = false;
      continue;
    }
    const segmentLength = segment.end - segment.start;
    if (segmentLength !== segment.text.length ||
        segmentLength > INTERNAL_AGENT_CONTEXT_MAX_SEGMENT_CHARS) {
      valid = false;
    }
    if (previousStart !== null && segment.start < previousStart) valid = false;
    if (previousEnd !== null && segment.start < previousEnd) valid = false;
    selectedCharCount += segment.text.length;
    if (selectedCharCount > INTERNAL_AGENT_CONTEXT_MAX_TOTAL_SELECTED_CHARS) valid = false;
    previousStart = segment.start;
    previousEnd = segment.end;
  }

  if (payload.segments.length < 1 || payload.segments.length > INTERNAL_AGENT_CONTEXT_MAX_SEGMENTS) {
    valid = false;
  }
  if (payload.segment_count !== payload.segments.length ||
      payload.selected_char_count !== selectedCharCount ||
      payload.source_text_length !== sourceText.length) {
    valid = false;
  }
  const sourceFullySelected = payload.segments.length > 0 &&
    payload.segments[0]?.start === 0 &&
    payload.segments.at(-1)?.end === sourceText.length &&
    selectedCharCount === sourceText.length;
  if (payload.source_fully_selected !== sourceFullySelected) valid = false;
  return { valid, sourceFullySelected };
}

function sourceFaithfulness(artifact, row) {
  const segments = artifact?.payload?.segments;
  const sourceText = row.canonical_memory?.source?.text;
  const ranges = row.selection?.ranges;
  if (!Array.isArray(segments) || !Array.isArray(ranges) || typeof sourceText !== "string") return null;
  if (segments.length !== ranges.length) return false;
  return segments.every((segment, index) => {
    const range = ranges[index];
    return isRecord(segment) && isRecord(range) &&
      segment.start === range.start &&
      segment.end === range.end &&
      segment.text === sourceText.slice(range.start, range.end);
  });
}

function literalPresence(segments, literals) {
  if (!Array.isArray(segments) || !Array.isArray(literals)) return null;
  return literals.filter(literal => !segments.some(segment => (
    typeof segment?.text === "string" && segment.text.includes(literal)
  )));
}

function provenanceEvidence(artifact, canonicalMemory) {
  if (!isRecord(artifact) || !isRecord(artifact.provenance)) {
    return {
      canonicalIdentityPreserved: null,
      projectionProvenancePreserved: null,
      actualProvenancePreserved: null,
    };
  }
  const canonicalIdentityPreserved = artifact.memory_id === canonicalMemory.memory_id &&
    artifact.canonical_id === canonicalMemory.canonical_id &&
    artifact.source_content_hash === canonicalMemory.content_ref.content_hash;
  const provenance = artifact.provenance;
  const projectionProvenancePreserved = exactFields(provenance, PROVENANCE_FIELDS) &&
    provenance.canonical_schema_version === canonicalMemory.schema_version &&
    provenance.adapter === PROVENANCE_ADAPTER &&
    provenance.selection_mode === PROVENANCE_SELECTION_MODE;
  return {
    canonicalIdentityPreserved,
    projectionProvenancePreserved,
    actualProvenancePreserved: canonicalIdentityPreserved && projectionProvenancePreserved,
  };
}

function evaluateCase(row) {
  const projection = candidateProjection(row);
  const actualProjectionValid = projection.projection_success
    ? projection.validation?.valid === true
    : null;
  const projectionValidMatchesExpected = actualProjectionValid === row.label.expected_projection_valid;
  const measurable = actualProjectionValid === true;
  const boundedness = measurable
    ? boundednessEvidence(projection.artifact, row.canonical_memory)
    : { valid: null, sourceFullySelected: null };
  const actualSourceFaithful = measurable
    ? sourceFaithfulness(projection.artifact, row)
    : null;
  const segments = measurable ? projection.artifact.payload.segments : null;
  const requiredLiteralsMissing = row.label.answer_bearing === true
    ? literalPresence(segments, row.label.semantic_preservation.required_literals)
    : null;
  const actualSemanticPreserved = row.label.answer_bearing === true && requiredLiteralsMissing !== null
    ? requiredLiteralsMissing.length === 0
    : null;
  const instructionLiterals = row.label.instruction_data_isolation.instruction_like_literals;
  const instructionLiteralsMissing = literalPresence(segments, instructionLiterals);
  const authorityKeys = measurable
    ? [...collectAuthorityKeys(projection.artifact)].sort()
    : null;
  const noCapabilityAuthority = authorityKeys === null ? null : authorityKeys.length === 0;
  const dataOnlyMarkerValid = measurable
    ? projection.artifact.payload.content_role === CONTENT_ROLE
    : null;
  const instructionDataRepresentationValid = measurable
    ? dataOnlyMarkerValid === true &&
      noCapabilityAuthority === true &&
      instructionLiteralsMissing.length === 0
    : null;
  const actualRiskMetadataPreserved = measurable
    ? deepEqual(projection.artifact.payload.risk_flags, row.label.expected_risk_flags)
    : null;
  const provenance = measurable
    ? provenanceEvidence(projection.artifact, row.canonical_memory)
    : {
      canonicalIdentityPreserved: null,
      projectionProvenancePreserved: null,
      actualProvenancePreserved: null,
    };
  const actualSourceFullySelected = measurable ? boundedness.sourceFullySelected : null;
  const sourceFullSelectionMatchesLabel = actualSourceFullySelected === null
    ? null
    : actualSourceFullySelected === row.label.expected_source_fully_selected;
  const usefulInternalProjection = row.label.answer_bearing === true &&
    projection.projection_success === true &&
    actualProjectionValid === true &&
    boundedness.valid === true &&
    actualSourceFaithful === true &&
    actualSemanticPreserved === true &&
    dataOnlyMarkerValid === true &&
    instructionDataRepresentationValid === true &&
    actualRiskMetadataPreserved === true &&
    provenance.actualProvenancePreserved === true &&
    noCapabilityAuthority === true &&
    sourceFullSelectionMatchesLabel === true;

  return {
    case_id: row.case_id,
    family: row.family,
    answer_bearing: row.label.answer_bearing,
    instruction_like_case: instructionLiterals.length > 0,
    projection_success: projection.projection_success,
    projection_reason: projection.projection_reason,
    actual_projection_valid: actualProjectionValid,
    projection_valid_matches_expected: projectionValidMatchesExpected,
    actual_boundedness_valid: boundedness.valid,
    actual_source_faithful: actualSourceFaithful,
    required_literals_missing: requiredLiteralsMissing,
    actual_semantic_preserved: actualSemanticPreserved,
    data_only_marker_valid: dataOnlyMarkerValid,
    instruction_literals_missing: instructionLiteralsMissing,
    instruction_data_representation_valid: instructionDataRepresentationValid,
    actual_risk_metadata_preserved: actualRiskMetadataPreserved,
    canonical_identity_preserved: provenance.canonicalIdentityPreserved,
    projection_provenance_preserved: provenance.projectionProvenancePreserved,
    actual_provenance_preserved: provenance.actualProvenancePreserved,
    authority_keys_present: authorityKeys,
    no_capability_authority: noCapabilityAuthority,
    actual_source_fully_selected: actualSourceFullySelected,
    source_full_selection_matches_label: sourceFullSelectionMatchesLabel,
    useful_internal_projection: usefulInternalProjection,
    side_effects: sideEffects(),
  };
}

function emptyFamilyBreakdown() {
  return Object.fromEntries(INTERNAL_AGENT_CONTEXT_HOLDOUT_FAMILIES.map(family => [family, {
    cases: 0,
    answer_bearing: 0,
    projection_valid: 0,
    boundedness_valid: 0,
    source_faithful: 0,
    semantic_preserved: 0,
    instruction_data_representation_valid: 0,
    risk_metadata_preserved: 0,
    provenance_preserved: 0,
    no_capability_authority: 0,
    useful_internal_projection: 0,
  }]));
}

function aggregateMetrics(results) {
  const caseCount = results.length;
  const answerBearingTotal = results.filter(result => result.answer_bearing === true).length;
  const instructionLikeCaseCount = results.filter(result => result.instruction_like_case === true).length;
  const projectionValid = results.filter(result => result.actual_projection_valid === true).length;
  const projectionValidityMatches = results.filter(result => result.projection_valid_matches_expected === true).length;
  const boundednessValid = results.filter(result => result.actual_boundedness_valid === true).length;
  const sourceFaithful = results.filter(result => result.actual_source_faithful === true).length;
  const semanticPreserved = results.filter(result => result.actual_semantic_preserved === true).length;
  const instructionRepresentationValid = results.filter(result => (
    result.instruction_like_case === true &&
    result.instruction_data_representation_valid === true
  )).length;
  const dataOnlyMarkerValid = results.filter(result => result.data_only_marker_valid === true).length;
  const riskPreserved = results.filter(result => result.actual_risk_metadata_preserved === true).length;
  const provenancePreserved = results.filter(result => result.actual_provenance_preserved === true).length;
  const noCapabilityAuthority = results.filter(result => result.no_capability_authority === true).length;
  const sourceFullSelectionMatches = results.filter(result => result.source_full_selection_matches_label === true).length;
  const useful = results.filter(result => result.useful_internal_projection === true).length;
  const metrics = {
    case_count: caseCount,
    projection_success_count: results.filter(result => result.projection_success === true).length,
    projection_failure_count: results.filter(result => result.projection_success === false).length,
    projection_valid_count: projectionValid,
    projection_valid_rate: ratio(projectionValid, caseCount),
    projection_validity_match_count: projectionValidityMatches,
    projection_validity_match_rate: ratio(projectionValidityMatches, caseCount),
    boundedness_valid_count: boundednessValid,
    boundedness_valid_rate: ratio(boundednessValid, caseCount),
    source_faithful_count: sourceFaithful,
    source_faithful_rate: ratio(sourceFaithful, caseCount),
    answer_bearing_total: answerBearingTotal,
    answer_bearing_semantic_preserved: semanticPreserved,
    semantic_preservation_rate: ratio(semanticPreserved, answerBearingTotal),
    instruction_like_case_count: instructionLikeCaseCount,
    instruction_like_representation_valid_count: instructionRepresentationValid,
    instruction_like_representation_valid_rate: ratio(instructionRepresentationValid, instructionLikeCaseCount),
    data_only_marker_valid_count: dataOnlyMarkerValid,
    data_only_marker_valid_rate: ratio(dataOnlyMarkerValid, caseCount),
    risk_metadata_preserved_count: riskPreserved,
    risk_metadata_preserved_rate: ratio(riskPreserved, caseCount),
    provenance_preserved_count: provenancePreserved,
    provenance_preserved_rate: ratio(provenancePreserved, caseCount),
    no_capability_authority_count: noCapabilityAuthority,
    no_capability_authority_rate: ratio(noCapabilityAuthority, caseCount),
    source_full_selection_match_count: sourceFullSelectionMatches,
    source_full_selection_match_rate: ratio(sourceFullSelectionMatches, caseCount),
    useful_internal_projection_count: useful,
    useful_internal_projection_rate: ratio(useful, answerBearingTotal),
    family_breakdown: emptyFamilyBreakdown(),
  };

  results.forEach(result => {
    const family = metrics.family_breakdown[result.family];
    if (!family) return;
    family.cases += 1;
    if (result.answer_bearing === true) family.answer_bearing += 1;
    if (result.actual_projection_valid === true) family.projection_valid += 1;
    if (result.actual_boundedness_valid === true) family.boundedness_valid += 1;
    if (result.actual_source_faithful === true) family.source_faithful += 1;
    if (result.actual_semantic_preserved === true) family.semantic_preserved += 1;
    if (result.instruction_data_representation_valid === true) family.instruction_data_representation_valid += 1;
    if (result.actual_risk_metadata_preserved === true) family.risk_metadata_preserved += 1;
    if (result.actual_provenance_preserved === true) family.provenance_preserved += 1;
    if (result.no_capability_authority === true) family.no_capability_authority += 1;
    if (result.useful_internal_projection === true) family.useful_internal_projection += 1;
  });

  return metrics;
}

function aggregateResult(results) {
  const metrics = aggregateMetrics(results);
  return {
    mode: "offline_internal_agent_context_evaluation_v1",
    runtime_authorized: false,
    capability_authorized: false,
    results,
    ...metrics,
    metrics,
    side_effects: sideEffects(),
  };
}

/**
 * Evaluates one caller-supplied row after validating the C.14 row contract.
 * The result contains bounded representation evidence only.
 */
export function evaluateInternalAgentContextCase(row) {
  return evaluateCase(assertValidRow(row));
}

/**
 * Evaluates caller-supplied in-memory rows without requiring full fixture
 * balance and without opening any fixture or storage source.
 */
export function evaluateInternalAgentContextCases(rows = []) {
  if (!Array.isArray(rows)) throw invalidFixtureError([
    { code: "rows_array_required", path: "rows" },
  ]);
  return aggregateResult(rows.map(row => evaluateInternalAgentContextCase(row)));
}

/**
 * Evaluates only a caller-supplied collection that passes the complete C.14
 * contract. This API never reads the frozen JSONL fixture itself.
 */
export function evaluateInternalAgentContextFixture(rows = []) {
  assertValidFixture(rows);
  return evaluateInternalAgentContextCases(rows);
}

export {
  INTERNAL_AGENT_CONTEXT_MAX_RISK_FLAGS,
  INTERNAL_AGENT_CONTEXT_MAX_RISK_FLAG_CHARS,
  INTERNAL_AGENT_CONTEXT_MAX_SEGMENTS,
  INTERNAL_AGENT_CONTEXT_MAX_SEGMENT_CHARS,
  INTERNAL_AGENT_CONTEXT_MAX_TOTAL_SELECTED_CHARS,
};
