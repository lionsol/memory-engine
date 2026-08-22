import { createHash } from "node:crypto";

import { explainProjectionArtifactValidation } from "../../canonical/projection-artifact.js";

export const REDACTION_EVIDENCE_SCHEMA_VERSION = 1;
export const REDACTION_EVIDENCE_AUTHORITY_KINDS = Object.freeze([
  "STRUCTURED_SOURCE_ANNOTATION",
  "EXPLICIT_REDACTION_DIRECTIVE",
  "DETERMINISTIC_DETECTOR_EVIDENCE",
]);

const DISCLOSURE_CARD_SURFACE = "DISCLOSURE_CARD";
const MAX_DIRECTIVES = 32;
const MAX_LITERAL_LENGTH = 256;
const MAX_EVIDENCE_REF_LENGTH = 256;
const PRESENTATION_FIELDS = new Set([
  "title",
  "summary",
  "salience_reason",
  "source_hint",
]);
const EVIDENCE_FIELDS = new Set([
  "schema_version",
  "memory_id",
  "canonical_id",
  "source_content_hash",
  "surface",
  "baseline_projection_hash",
  "directives",
]);
const DIRECTIVE_FIELDS = new Set([
  "field",
  "literal",
  "authority_kind",
  "evidence_ref",
]);
const AUTHORITY_PREFIXES = Object.freeze({
  STRUCTURED_SOURCE_ANNOTATION: "annotation:",
  EXPLICIT_REDACTION_DIRECTIVE: "directive:",
  DETERMINISTIC_DETECTOR_EVIDENCE: "detector:",
});
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const PRINTABLE_REFERENCE = /^[\x21-\x7e]+$/u;

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

function validation(valid, reason = "valid") {
  return { valid, reason };
}

function boundedError(reason) {
  const error = new TypeError(`invalid structured redaction evidence: ${reason}`);
  error.reason = reason;
  return error;
}

function validateBaselineProjection(projectionArtifact, canonicalMemory) {
  const baselineValidation = explainProjectionArtifactValidation(
    projectionArtifact,
    canonicalMemory,
  );
  if (!isRecord(projectionArtifact)) {
    return validation(false, "invalid_baseline_projection");
  }
  if (projectionArtifact?.surface !== DISCLOSURE_CARD_SURFACE) {
    return validation(false, "unsupported_redaction_evidence_surface");
  }
  if (!baselineValidation.valid) return validation(false, "invalid_baseline_projection");
  return validation(true);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(item => canonicalize(item));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, canonicalize(value[key])]),
  );
}

function baselineHashMaterial(projectionArtifact) {
  return canonicalize({
    projection_schema_version: projectionArtifact.projection_schema_version,
    projection_kind: projectionArtifact.projection_kind,
    memory_id: projectionArtifact.memory_id,
    canonical_id: projectionArtifact.canonical_id,
    source_content_hash: projectionArtifact.source_content_hash,
    surface: projectionArtifact.surface,
    payload: projectionArtifact.payload,
  });
}

function validLiteral(value) {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_LITERAL_LENGTH;
}

function validEvidenceRef(value, authorityKind) {
  if (typeof value !== "string" ||
      value.length === 0 ||
      value.length > MAX_EVIDENCE_REF_LENGTH ||
      !PRINTABLE_REFERENCE.test(value)) {
    return false;
  }
  const prefix = AUTHORITY_PREFIXES[authorityKind];
  return typeof prefix === "string" &&
    value.startsWith(prefix) &&
    value.length > prefix.length;
}

function validateDirective(directive, baselinePayload, seenDirectives) {
  if (!hasExactFields(directive, DIRECTIVE_FIELDS)) {
    return validation(false, "invalid_redaction_directive");
  }
  if (typeof directive.field !== "string" || !PRESENTATION_FIELDS.has(directive.field)) {
    return validation(false, "redaction_field_not_allowed");
  }
  if (!validLiteral(directive.literal)) {
    return validation(false, "invalid_redaction_literal");
  }
  if (!REDACTION_EVIDENCE_AUTHORITY_KINDS.includes(directive.authority_kind)) {
    return validation(false, "invalid_authority_kind");
  }
  const directiveKey = `${directive.field}\u0000${directive.literal}`;
  if (seenDirectives.has(directiveKey)) {
    return validation(false, "duplicate_redaction_directive");
  }
  seenDirectives.add(directiveKey);
  if (!validEvidenceRef(directive.evidence_ref, directive.authority_kind)) {
    return validation(false, "invalid_evidence_ref");
  }
  if (directive.evidence_ref.includes(directive.literal)) {
    return validation(false, "evidence_ref_contains_redaction_literal");
  }
  if (typeof baselinePayload?.[directive.field] !== "string" ||
      !baselinePayload[directive.field].includes(directive.literal)) {
    return validation(false, "redaction_target_not_found_in_baseline");
  }
  return validation(true);
}

/**
 * Computes the identity-bound hash of a validated DISCLOSURE_CARD baseline.
 * Provenance is intentionally excluded so adapter provenance changes do not
 * invalidate an otherwise identical representation.
 */
export function computeDisclosureCardBaselineProjectionHash(
  projectionArtifact,
  canonicalMemory,
) {
  const baseline = validateBaselineProjection(projectionArtifact, canonicalMemory);
  if (!baseline.valid) throw boundedError(baseline.reason);

  return createHash("sha256")
    .update(JSON.stringify(baselineHashMaterial(projectionArtifact)), "utf8")
    .digest("hex");
}

export function explainStructuredRedactionEvidenceValidation(
  evidence,
  canonicalMemory,
  baselineProjectionArtifact,
) {
  const baseline = validateBaselineProjection(baselineProjectionArtifact, canonicalMemory);
  if (!baseline.valid) return baseline;

  if (!hasExactFields(evidence, EVIDENCE_FIELDS)) {
    return validation(false, "invalid_redaction_evidence_envelope");
  }
  if (evidence.schema_version !== REDACTION_EVIDENCE_SCHEMA_VERSION) {
    return validation(false, "invalid_redaction_evidence_schema_version");
  }
  if (!nonEmptyString(evidence.memory_id)) {
    return validation(false, "invalid_evidence_identity");
  }
  if (evidence.memory_id !== canonicalMemory.memory_id) {
    return validation(false, "canonical_memory_id_mismatch");
  }
  if (!nonEmptyString(evidence.canonical_id)) {
    return validation(false, "invalid_evidence_identity");
  }
  if (evidence.canonical_id !== canonicalMemory.canonical_id) {
    return validation(false, "canonical_id_mismatch");
  }
  if (!nonEmptyString(evidence.source_content_hash)) {
    return validation(false, "invalid_evidence_identity");
  }
  if (evidence.source_content_hash !== canonicalMemory.content_ref?.content_hash) {
    return validation(false, "source_content_hash_mismatch");
  }
  if (evidence.surface !== DISCLOSURE_CARD_SURFACE) {
    return validation(false, "unsupported_redaction_evidence_surface");
  }

  if (!SHA256_HEX.test(evidence.baseline_projection_hash)) {
    return validation(false, "invalid_baseline_projection_hash");
  }
  const currentBaselineHash = computeDisclosureCardBaselineProjectionHash(
    baselineProjectionArtifact,
    canonicalMemory,
  );
  if (evidence.baseline_projection_hash !== currentBaselineHash) {
    return validation(false, "baseline_projection_hash_mismatch");
  }

  if (!Array.isArray(evidence.directives) ||
      evidence.directives.length === 0 ||
      evidence.directives.length > MAX_DIRECTIVES) {
    return validation(false, "invalid_redaction_directives");
  }
  const seenDirectives = new Set();
  for (const directive of evidence.directives) {
    const directiveValidation = validateDirective(
      directive,
      baselineProjectionArtifact.payload,
      seenDirectives,
    );
    if (!directiveValidation.valid) return directiveValidation;
  }
  return validation(true);
}

export function validateStructuredRedactionEvidence(
  evidence,
  canonicalMemory,
  baselineProjectionArtifact,
) {
  return explainStructuredRedactionEvidenceValidation(
    evidence,
    canonicalMemory,
    baselineProjectionArtifact,
  ).valid;
}

export function assertValidStructuredRedactionEvidence(
  evidence,
  canonicalMemory,
  baselineProjectionArtifact,
) {
  const result = explainStructuredRedactionEvidenceValidation(
    evidence,
    canonicalMemory,
    baselineProjectionArtifact,
  );
  if (!result.valid) throw boundedError(result.reason);
  return evidence;
}
