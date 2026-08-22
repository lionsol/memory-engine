import {
  CANONICAL_VECTOR_PROJECTION_VERSION,
  CANONICAL_VECTOR_TEXT_MAX_CHARS,
  projectCanonicalMemoryToVectorProjection,
} from "./vector-projection.js";
import { projectCanonicalMemoryToMemoryCard } from "../recall/auto-recall-memory-card.js";

export const PROJECTION_ARTIFACT_SCHEMA_VERSION = 1;

export const PROJECTION_SURFACES = Object.freeze([
  "VECTOR_INDEX",
  "INTERNAL_AGENT_CONTEXT",
  "DISCLOSURE_CARD",
  "RAW_REFERENCE",
]);

export const PROJECTION_KINDS = Object.freeze({
  VECTOR_INDEX: "canonical_vector_v1",
  INTERNAL_AGENT_CONTEXT: "canonical_internal_agent_context_v1",
  DISCLOSURE_CARD: "legacy_memory_card_v1",
});

export const INTERNAL_AGENT_CONTEXT_PAYLOAD_SCHEMA_VERSION = 1;
export const INTERNAL_AGENT_CONTEXT_MAX_SEGMENTS = 4;
export const INTERNAL_AGENT_CONTEXT_MAX_SEGMENT_CHARS = 1024;
export const INTERNAL_AGENT_CONTEXT_MAX_TOTAL_SELECTED_CHARS = 2048;
export const INTERNAL_AGENT_CONTEXT_MAX_RISK_FLAGS = 16;
export const INTERNAL_AGENT_CONTEXT_MAX_RISK_FLAG_CHARS = 64;

const IMPLEMENTED_SURFACES = new Set([
  "VECTOR_INDEX",
  "INTERNAL_AGENT_CONTEXT",
  "DISCLOSURE_CARD",
]);
const PROJECTION_ARTIFACT_FIELDS = new Set([
  "projection_schema_version",
  "projection_kind",
  "memory_id",
  "canonical_id",
  "source_content_hash",
  "surface",
  "payload",
  "provenance",
]);
const DISCLOSURE_CARD_MAX = Object.freeze({
  title: 80,
  summary: 240,
  salience_reason: 180,
  source_hint: 512,
});

const FORBIDDEN_AUTHORITY_FIELDS = new Set([
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
]);

const FORBIDDEN_DISCLOSURE_BODY_FIELDS = new Set([
  "body",
  "content",
  "full_content",
  "raw_text",
  "source_text",
  "text",
]);

const VECTOR_PAYLOAD_FIELDS = new Set([
  "projection_version",
  "text",
  "embedding_input",
  "text_truncated",
  "source_text_length",
]);

const DISCLOSURE_CARD_PAYLOAD_FIELDS = new Set([
  "schema_version",
  "card_id",
  "title",
  "summary",
  "salience_reason",
  "source_hint",
  "category",
  "kind",
  "confidence_score",
  "risk_flags",
]);
const INTERNAL_AGENT_CONTEXT_SELECTION_FIELDS = new Set([
  "ranges",
  "risk_flags",
]);
const INTERNAL_AGENT_CONTEXT_RANGE_FIELDS = new Set(["start", "end"]);
const INTERNAL_AGENT_CONTEXT_PAYLOAD_FIELDS = new Set([
  "schema_version",
  "content_role",
  "category",
  "kind",
  "risk_flags",
  "source_text_length",
  "selected_char_count",
  "segment_count",
  "source_fully_selected",
  "segments",
]);
const INTERNAL_AGENT_CONTEXT_SEGMENT_FIELDS = new Set(["start", "end", "text"]);
const INTERNAL_AGENT_CONTEXT_PROVENANCE_FIELDS = new Set([
  "canonical_schema_version",
  "adapter",
  "selection_mode",
]);
const INTERNAL_AGENT_CONTEXT_PROVENANCE_ADAPTER =
  "canonical_internal_agent_context_extract_v1";
const INTERNAL_AGENT_CONTEXT_PROVENANCE_SELECTION_MODE =
  "caller_supplied_char_ranges";
const INTERNAL_AGENT_CONTEXT_ALLOWED_CONTENT_ROLE = "untrusted_evidence";
const INTERNAL_AGENT_CONTEXT_UNSAFE_CHARACTER = /\p{C}/u;

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function result(valid, reason = "valid") {
  return { valid, reason };
}

function canonicalAuthority(canonicalMemory) {
  if (!isRecord(canonicalMemory)) return null;
  if (!nonEmptyString(canonicalMemory.memory_id)) return null;
  if (!nonEmptyString(canonicalMemory.canonical_id)) return null;
  if (!isRecord(canonicalMemory.content_ref) || !nonEmptyString(canonicalMemory.content_ref.content_hash)) return null;
  if (!isRecord(canonicalMemory.classification)) return null;
  return {
    memory_id: canonicalMemory.memory_id,
    canonical_id: canonicalMemory.canonical_id,
    source_content_hash: canonicalMemory.content_ref.content_hash,
    schema_version: canonicalMemory.schema_version ?? null,
    category: canonicalMemory.classification.category ?? null,
    kind: canonicalMemory.classification.kind ?? null,
  };
}

function canonicalSourceText(canonicalMemory) {
  if (!isRecord(canonicalMemory?.source) ||
      typeof canonicalMemory.source.text !== "string" ||
      canonicalMemory.source.text.length === 0) {
    return null;
  }
  return canonicalMemory.source.text;
}

function hasUnsafeInternalContextCharacter(value) {
  for (const character of value) {
    if (character === "\t" || character === "\n" || character === "\r") continue;
    if (INTERNAL_AGENT_CONTEXT_UNSAFE_CHARACTER.test(character)) return true;
  }
  return false;
}

function validateInternalContextRiskFlags(riskFlags) {
  if (!Array.isArray(riskFlags) || riskFlags.length > INTERNAL_AGENT_CONTEXT_MAX_RISK_FLAGS) {
    return result(false, "invalid_internal_context_risk_flags");
  }
  const seen = new Set();
  for (const flag of riskFlags) {
    if (!nonEmptyString(flag) || flag.length > INTERNAL_AGENT_CONTEXT_MAX_RISK_FLAG_CHARS) {
      return result(false, "invalid_internal_context_risk_flag");
    }
    if (seen.has(flag)) return result(false, "duplicate_internal_context_risk_flag");
    seen.add(flag);
  }
  return result(true);
}

function containsForbiddenKey(value, forbiddenKeys) {
  if (Array.isArray(value)) return value.some(item => containsForbiddenKey(item, forbiddenKeys));
  if (!isRecord(value)) return false;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) return true;
    if (containsForbiddenKey(child, forbiddenKeys)) return true;
  }
  return false;
}

function hasOnlyFields(value, allowedFields) {
  return Object.keys(value).every(key => allowedFields.has(key));
}

function hasExactFields(value, allowedFields) {
  return isRecord(value) &&
    Object.keys(value).length === allowedFields.size &&
    Object.keys(value).every(key => allowedFields.has(key));
}

function validBoundedString(value, max) {
  return nonEmptyString(value) && value.length <= max;
}

function validateVectorPayload(payload) {
  if (!isRecord(payload) || !hasOnlyFields(payload, VECTOR_PAYLOAD_FIELDS)) {
    return result(false, "invalid_vector_payload");
  }
  if (payload.projection_version !== CANONICAL_VECTOR_PROJECTION_VERSION) {
    return result(false, "invalid_vector_projection_version");
  }
  if (typeof payload.text !== "string" || payload.text.length > CANONICAL_VECTOR_TEXT_MAX_CHARS) {
    return result(false, "invalid_vector_text");
  }
  if (payload.embedding_input !== payload.text) return result(false, "invalid_vector_embedding_input");
  if (typeof payload.text_truncated !== "boolean") return result(false, "invalid_vector_truncation_flag");
  if (!Number.isSafeInteger(payload.source_text_length) || payload.source_text_length < payload.text.length) {
    return result(false, "invalid_vector_source_length");
  }
  return result(true);
}

function validateDisclosureCardPayload(payload, canonical) {
  if (!isRecord(payload)) return result(false, "invalid_disclosure_card_payload");
  if (containsForbiddenKey(payload, FORBIDDEN_DISCLOSURE_BODY_FIELDS)) {
    return result(false, "forbidden_full_body_field");
  }
  if (!hasOnlyFields(payload, DISCLOSURE_CARD_PAYLOAD_FIELDS)) {
    return result(false, "invalid_disclosure_card_payload");
  }
  if (payload.schema_version !== 1) return result(false, "invalid_disclosure_card_schema");
  if (!nonEmptyString(payload.card_id)) return result(false, "invalid_disclosure_card_id");
  if (!validBoundedString(payload.title, DISCLOSURE_CARD_MAX.title)) return result(false, "invalid_disclosure_card_title");
  if (!validBoundedString(payload.summary, DISCLOSURE_CARD_MAX.summary)) return result(false, "invalid_disclosure_card_summary");
  if (!validBoundedString(payload.salience_reason, DISCLOSURE_CARD_MAX.salience_reason)) {
    return result(false, "invalid_disclosure_card_salience");
  }
  if (typeof payload.source_hint !== "string" || payload.source_hint.length > DISCLOSURE_CARD_MAX.source_hint) {
    return result(false, "invalid_disclosure_card_source_hint");
  }
  if (typeof payload.category !== "string" || payload.category !== canonical.category) {
    return result(false, "canonical_category_mismatch");
  }
  if (typeof payload.kind !== "string" || payload.kind !== canonical.kind) {
    return result(false, "canonical_kind_mismatch");
  }
  if (payload.confidence_score !== null && !Number.isFinite(payload.confidence_score)) {
    return result(false, "invalid_disclosure_card_confidence");
  }
  if (!Array.isArray(payload.risk_flags) || !payload.risk_flags.every(flag => nonEmptyString(flag))) {
    return result(false, "invalid_disclosure_card_risk_flags");
  }
  return result(true);
}

export function validateInternalAgentContextPayload(payload, canonicalMemory) {
  const canonical = canonicalAuthority(canonicalMemory);
  if (!canonical) return result(false, "invalid_canonical_authority");
  const sourceText = canonicalSourceText(canonicalMemory);
  if (sourceText === null) return result(false, "invalid_internal_context_source");
  if (!isRecord(payload) || containsForbiddenKey(payload, FORBIDDEN_AUTHORITY_FIELDS)) {
    return result(false, containsForbiddenKey(payload, FORBIDDEN_AUTHORITY_FIELDS)
      ? "projection_contains_authority_field"
      : "invalid_internal_context_payload");
  }
  if (!hasExactFields(payload, INTERNAL_AGENT_CONTEXT_PAYLOAD_FIELDS)) {
    return result(false, "invalid_internal_context_payload");
  }
  if (payload.schema_version !== INTERNAL_AGENT_CONTEXT_PAYLOAD_SCHEMA_VERSION) {
    return result(false, "invalid_internal_context_schema");
  }
  if (payload.content_role !== INTERNAL_AGENT_CONTEXT_ALLOWED_CONTENT_ROLE) {
    return result(false, "invalid_internal_context_content_role");
  }
  if (typeof payload.category !== "string" || payload.category !== canonical.category) {
    return result(false, "canonical_category_mismatch");
  }
  if (typeof payload.kind !== "string" || payload.kind !== canonical.kind) {
    return result(false, "canonical_kind_mismatch");
  }
  const riskValidation = validateInternalContextRiskFlags(payload.risk_flags);
  if (!riskValidation.valid) return riskValidation;
  if (payload.source_text_length !== sourceText.length) {
    return result(false, "internal_context_source_length_mismatch");
  }
  if (!Array.isArray(payload.segments) ||
      payload.segments.length === 0 ||
      payload.segments.length > INTERNAL_AGENT_CONTEXT_MAX_SEGMENTS) {
    return result(false, "invalid_internal_context_payload");
  }

  let selectedCharCount = 0;
  let previousStart = null;
  let previousEnd = null;
  for (const segment of payload.segments) {
    if (!hasExactFields(segment, INTERNAL_AGENT_CONTEXT_SEGMENT_FIELDS)) {
      return result(false, "invalid_internal_context_segment");
    }
    if (!Number.isSafeInteger(segment.start) ||
        !Number.isSafeInteger(segment.end) ||
        segment.start < 0 ||
        segment.start >= segment.end ||
        segment.end > sourceText.length) {
      return result(false, "invalid_internal_context_range");
    }
    if (previousStart !== null && segment.start < previousStart) {
      return result(false, "internal_context_range_order");
    }
    if (previousEnd !== null && segment.start < previousEnd) {
      return result(false, "internal_context_range_overlap");
    }
    const segmentLength = segment.end - segment.start;
    if (segmentLength > INTERNAL_AGENT_CONTEXT_MAX_SEGMENT_CHARS) {
      return result(false, "internal_context_segment_too_large");
    }
    const expectedText = sourceText.slice(segment.start, segment.end);
    if (typeof segment.text !== "string" || segment.text !== expectedText) {
      return result(false, "internal_context_source_mismatch");
    }
    if (hasUnsafeInternalContextCharacter(segment.text)) {
      return result(false, "invalid_internal_context_control_character");
    }
    selectedCharCount += segment.text.length;
    if (selectedCharCount > INTERNAL_AGENT_CONTEXT_MAX_TOTAL_SELECTED_CHARS) {
      return result(false, "internal_context_total_too_large");
    }
    previousStart = segment.start;
    previousEnd = segment.end;
  }

  if (payload.selected_char_count !== selectedCharCount) {
    return result(false, "internal_context_selected_char_count_mismatch");
  }
  if (payload.segment_count !== payload.segments.length) {
    return result(false, "internal_context_segment_count_mismatch");
  }
  const sourceFullySelected = payload.segments[0].start === 0 &&
    payload.segments.at(-1).end === sourceText.length &&
    selectedCharCount === sourceText.length;
  if (payload.source_fully_selected !== sourceFullySelected) {
    return result(false, "internal_context_full_selection_mismatch");
  }
  return result(true);
}

function validateInternalContextSelection(selection, sourceText) {
  if (!hasExactFields(selection, INTERNAL_AGENT_CONTEXT_SELECTION_FIELDS)) {
    return result(false, "invalid_internal_context_selection");
  }
  if (!Array.isArray(selection.ranges) ||
      selection.ranges.length === 0 ||
      selection.ranges.length > INTERNAL_AGENT_CONTEXT_MAX_SEGMENTS) {
    return result(false, "invalid_internal_context_selection");
  }
  const riskValidation = validateInternalContextRiskFlags(selection.risk_flags);
  if (!riskValidation.valid) return riskValidation;

  let selectedCharCount = 0;
  let previousStart = null;
  let previousEnd = null;
  const segments = [];
  for (const range of selection.ranges) {
    if (!hasExactFields(range, INTERNAL_AGENT_CONTEXT_RANGE_FIELDS) ||
        !Number.isSafeInteger(range.start) ||
        !Number.isSafeInteger(range.end) ||
        range.start < 0 ||
        range.start >= range.end ||
        range.end > sourceText.length) {
      return result(false, "invalid_internal_context_range");
    }
    if (previousStart !== null && range.start < previousStart) {
      return result(false, "internal_context_range_order");
    }
    if (previousEnd !== null && range.start < previousEnd) {
      return result(false, "internal_context_range_overlap");
    }
    const segmentLength = range.end - range.start;
    if (segmentLength > INTERNAL_AGENT_CONTEXT_MAX_SEGMENT_CHARS) {
      return result(false, "internal_context_segment_too_large");
    }
    const text = sourceText.slice(range.start, range.end);
    if (hasUnsafeInternalContextCharacter(text)) {
      return result(false, "invalid_internal_context_control_character");
    }
    selectedCharCount += text.length;
    if (selectedCharCount > INTERNAL_AGENT_CONTEXT_MAX_TOTAL_SELECTED_CHARS) {
      return result(false, "internal_context_total_too_large");
    }
    segments.push({
      start: range.start,
      end: range.end,
      text,
    });
    previousStart = range.start;
    previousEnd = range.end;
  }

  return {
    valid: true,
    reason: "valid",
    segments,
    selectedCharCount,
    sourceFullySelected: segments[0].start === 0 &&
      segments.at(-1).end === sourceText.length &&
      selectedCharCount === sourceText.length,
  };
}

function validateInternalAgentContextProvenance(provenance, canonical) {
  if (!hasExactFields(provenance, INTERNAL_AGENT_CONTEXT_PROVENANCE_FIELDS)) {
    return result(false, "invalid_internal_context_provenance");
  }
  if (provenance.canonical_schema_version !== canonical.schema_version ||
      provenance.adapter !== INTERNAL_AGENT_CONTEXT_PROVENANCE_ADAPTER ||
      provenance.selection_mode !== INTERNAL_AGENT_CONTEXT_PROVENANCE_SELECTION_MODE) {
    return result(false, "invalid_internal_context_provenance");
  }
  return result(true);
}

function artifactEnvelope(canonicalMemory, { projectionKind, surface, payload, provenance }) {
  const canonical = canonicalAuthority(canonicalMemory);
  if (!canonical) throw new TypeError("projection artifact requires canonical identity, classification, and content hash");
  return {
    projection_schema_version: PROJECTION_ARTIFACT_SCHEMA_VERSION,
    projection_kind: projectionKind,
    memory_id: canonical.memory_id,
    canonical_id: canonical.canonical_id,
    source_content_hash: canonical.source_content_hash,
    surface,
    payload,
    provenance: {
      canonical_schema_version: canonical.schema_version,
      ...provenance,
    },
  };
}

export function explainProjectionArtifactValidation(artifact, canonicalMemory) {
  const canonical = canonicalAuthority(canonicalMemory);
  if (!canonical) return result(false, "invalid_canonical_authority");
  if (!isRecord(artifact)) return result(false, "invalid_projection_artifact");
  if (containsForbiddenKey(artifact, FORBIDDEN_AUTHORITY_FIELDS)) {
    return result(false, "projection_contains_authority_field");
  }
  if (!hasOnlyFields(artifact, PROJECTION_ARTIFACT_FIELDS)) {
    return result(false, "invalid_projection_artifact_envelope");
  }
  if (artifact.projection_schema_version !== PROJECTION_ARTIFACT_SCHEMA_VERSION) {
    return result(false, "invalid_projection_schema_version");
  }
  if (!PROJECTION_SURFACES.includes(artifact.surface)) return result(false, "unknown_projection_surface");
  if (!IMPLEMENTED_SURFACES.has(artifact.surface)) return result(false, "surface_not_implemented");
  if (!nonEmptyString(artifact.projection_kind)) return result(false, "invalid_projection_kind");
  if (!isRecord(artifact.payload) || !isRecord(artifact.provenance)) return result(false, "invalid_projection_envelope");
  if (artifact.memory_id !== canonical.memory_id || artifact.canonical_id !== canonical.canonical_id) {
    return result(false, "canonical_identity_mismatch");
  }
  if (artifact.source_content_hash !== canonical.source_content_hash) {
    return result(false, "canonical_content_hash_mismatch");
  }
  if (artifact.surface === "VECTOR_INDEX") {
    if (artifact.projection_kind !== PROJECTION_KINDS.VECTOR_INDEX) return result(false, "surface_projection_kind_mismatch");
    return validateVectorPayload(artifact.payload);
  }

  if (artifact.surface === "INTERNAL_AGENT_CONTEXT") {
    if (artifact.projection_kind !== PROJECTION_KINDS.INTERNAL_AGENT_CONTEXT) {
      return result(false, "surface_projection_kind_mismatch");
    }
    const provenanceValidation = validateInternalAgentContextProvenance(artifact.provenance, canonical);
    if (!provenanceValidation.valid) return provenanceValidation;
    return validateInternalAgentContextPayload(artifact.payload, canonicalMemory);
  }

  if (artifact.surface === "DISCLOSURE_CARD") {
    if (artifact.projection_kind !== PROJECTION_KINDS.DISCLOSURE_CARD) return result(false, "surface_projection_kind_mismatch");
    return validateDisclosureCardPayload(artifact.payload, canonical);
  }

  return result(false, "surface_not_implemented");
}

export function validateProjectionArtifact(artifact, canonicalMemory) {
  return explainProjectionArtifactValidation(artifact, canonicalMemory).valid;
}

export function assertValidProjectionArtifact(artifact, canonicalMemory) {
  const validation = explainProjectionArtifactValidation(artifact, canonicalMemory);
  if (!validation.valid) {
    const error = new TypeError(`invalid projection artifact: ${validation.reason}`);
    error.reason = validation.reason;
    throw error;
  }
  return artifact;
}

export function projectCanonicalMemoryToVectorArtifact(canonicalMemory) {
  const projection = projectCanonicalMemoryToVectorProjection(canonicalMemory);
  const artifact = artifactEnvelope(canonicalMemory, {
    projectionKind: PROJECTION_KINDS.VECTOR_INDEX,
    surface: "VECTOR_INDEX",
    payload: {
      projection_version: projection.projection_version,
      text: projection.text,
      embedding_input: projection.embedding_input,
      text_truncated: projection.text_truncated,
      source_text_length: projection.source_text_length,
    },
    provenance: {
      adapter: "canonical_vector_projection_v1",
      source_projection_version: projection.projection_version,
    },
  });
  return assertValidProjectionArtifact(artifact, canonicalMemory);
}

function internalContextProjectionError(reason) {
  const error = new TypeError(`invalid internal agent context projection: ${reason}`);
  error.reason = reason;
  return error;
}

export function projectCanonicalMemoryToInternalAgentContextArtifact(canonicalMemory, selection) {
  const canonical = canonicalAuthority(canonicalMemory);
  if (!canonical) throw internalContextProjectionError("invalid_canonical_authority");
  const sourceText = canonicalSourceText(canonicalMemory);
  if (sourceText === null) throw internalContextProjectionError("invalid_internal_context_source");

  const selectionValidation = validateInternalContextSelection(selection, sourceText);
  if (!selectionValidation.valid) {
    throw internalContextProjectionError(selectionValidation.reason);
  }

  const artifact = artifactEnvelope(canonicalMemory, {
    projectionKind: PROJECTION_KINDS.INTERNAL_AGENT_CONTEXT,
    surface: "INTERNAL_AGENT_CONTEXT",
    payload: {
      schema_version: INTERNAL_AGENT_CONTEXT_PAYLOAD_SCHEMA_VERSION,
      content_role: INTERNAL_AGENT_CONTEXT_ALLOWED_CONTENT_ROLE,
      category: canonical.category,
      kind: canonical.kind,
      risk_flags: [...selection.risk_flags],
      source_text_length: sourceText.length,
      selected_char_count: selectionValidation.selectedCharCount,
      segment_count: selectionValidation.segments.length,
      source_fully_selected: selectionValidation.sourceFullySelected,
      segments: selectionValidation.segments.map(segment => ({ ...segment })),
    },
    provenance: {
      adapter: INTERNAL_AGENT_CONTEXT_PROVENANCE_ADAPTER,
      selection_mode: INTERNAL_AGENT_CONTEXT_PROVENANCE_SELECTION_MODE,
    },
  });
  return assertValidProjectionArtifact(artifact, canonicalMemory);
}

export function projectCanonicalMemoryToDisclosureCardArtifact(canonicalMemory, runtimeCandidate = {}, options = {}) {
  const projected = projectCanonicalMemoryToMemoryCard(canonicalMemory, runtimeCandidate, options);
  const card = projected.memory_card;
  const artifact = artifactEnvelope(canonicalMemory, {
    projectionKind: PROJECTION_KINDS.DISCLOSURE_CARD,
    surface: "DISCLOSURE_CARD",
    payload: {
      schema_version: card.schema_version,
      card_id: card.card_id,
      title: card.title,
      summary: card.summary,
      salience_reason: card.salience_reason,
      source_hint: card.source_hint,
      category: card.category,
      kind: card.kind,
      confidence_score: card.confidence_score,
      risk_flags: Array.isArray(card.risk_flags) ? [...card.risk_flags] : [],
    },
    provenance: {
      adapter: "legacy_canonical_memory_card_v1",
      legacy_policy_fields_omitted: true,
      legacy_get_token_omitted: true,
    },
  });
  return assertValidProjectionArtifact(artifact, canonicalMemory);
}
