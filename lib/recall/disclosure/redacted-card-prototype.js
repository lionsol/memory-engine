import {
  explainProjectionArtifactValidation,
  projectCanonicalMemoryToDisclosureCardArtifact,
} from "../../canonical/projection-artifact.js";

const STRATEGY = "REDACTED_CARD";
const STRATEGY_SCHEMA_VERSION = 1;
const DISCLOSURE_CARD_SURFACE = "DISCLOSURE_CARD";
const REPLACEMENT = "[REDACTED]";
const MAX_DIRECTIVES = 32;
const MAX_LITERAL_LENGTH = 256;
const PRESENTATION_FIELDS = new Set([
  "title",
  "summary",
  "salience_reason",
  "source_hint",
]);
const DIRECTIVE_FIELDS = new Set(["field", "literal"]);
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

function emptyEvidence(directiveCount = 0) {
  return {
    directive_count: directiveCount,
    applied_directive_count: 0,
    occurrence_count: 0,
    fields_changed: [],
  };
}

function failure(reason, directiveCount = 0, evidence = emptyEvidence(directiveCount)) {
  return {
    strategy: STRATEGY,
    strategy_schema_version: STRATEGY_SCHEMA_VERSION,
    surface: DISCLOSURE_CARD_SURFACE,
    candidate_payload: null,
    redaction_evidence: evidence,
    structural_compatibility: {
      valid: false,
      reason,
    },
    side_effects: sideEffects(),
  };
}

function success(candidatePayload, evidence) {
  return {
    strategy: STRATEGY,
    strategy_schema_version: STRATEGY_SCHEMA_VERSION,
    surface: DISCLOSURE_CARD_SURFACE,
    candidate_payload: candidatePayload,
    redaction_evidence: evidence,
    structural_compatibility: {
      valid: true,
      reason: "valid",
    },
    side_effects: sideEffects(),
  };
}

function validDirectiveKeys(directive) {
  return Object.keys(directive).every(key => DIRECTIVE_FIELDS.has(key)) &&
    Object.keys(directive).length === DIRECTIVE_FIELDS.size;
}

function validateRedactionPlan(redactionPlan) {
  if (!isRecord(redactionPlan) ||
      redactionPlan.schema_version !== 1 ||
      !Array.isArray(redactionPlan.directives) ||
      redactionPlan.directives.length === 0 ||
      redactionPlan.directives.length > MAX_DIRECTIVES) {
    return { valid: false, reason: "invalid_redaction_plan", directives: [] };
  }

  const directives = [];
  for (const directive of redactionPlan.directives) {
    if (!isRecord(directive) || !validDirectiveKeys(directive)) {
      return { valid: false, reason: "invalid_redaction_plan", directives: [] };
    }
    if (typeof directive.field !== "string" || directive.field.length === 0) {
      return { valid: false, reason: "invalid_redaction_plan", directives: [] };
    }
    if (!PRESENTATION_FIELDS.has(directive.field)) {
      return { valid: false, reason: "redaction_field_not_allowed", directives: [] };
    }
    if (typeof directive.literal !== "string" ||
        directive.literal.trim().length === 0 ||
        directive.literal.length > MAX_LITERAL_LENGTH) {
      return { valid: false, reason: "invalid_redaction_plan", directives: [] };
    }
    directives.push({
      field: directive.field,
      literal: directive.literal,
    });
  }
  return { valid: true, directives };
}

function cloneCardPayload(payload) {
  return {
    ...payload,
    risk_flags: [...payload.risk_flags],
  };
}

function countExactOccurrences(value, literal) {
  let count = 0;
  let offset = 0;
  while (offset <= value.length) {
    const index = value.indexOf(literal, offset);
    if (index === -1) break;
    count += 1;
    offset = index + literal.length;
  }
  return count;
}

function applyExactRedaction(value, literal) {
  return value.split(literal).join(REPLACEMENT);
}

function boundedBaselineFailure() {
  return failure("baseline_projection_failed");
}

/**
 * Applies a caller-supplied, exact, field-specific redaction plan to a
 * disclosure-card representation. This is a representation-only prototype;
 * it does not create a new ProjectionArtifact kind or any authorization.
 */
export function projectRedactedCardCandidate(
  canonicalMemory,
  runtimeCandidate,
  redactionPlan,
  options = {},
) {
  let baseline;
  try {
    baseline = projectCanonicalMemoryToDisclosureCardArtifact(
      canonicalMemory,
      runtimeCandidate,
      options,
    );
  } catch {
    return boundedBaselineFailure();
  }

  const plan = validateRedactionPlan(redactionPlan);
  const directiveCount = Array.isArray(redactionPlan?.directives)
    ? redactionPlan.directives.length
    : 0;
  if (!plan.valid) return failure(plan.reason, directiveCount);

  const candidatePayload = cloneCardPayload(baseline.payload);
  const fieldsChanged = [];
  let occurrenceCount = 0;
  let appliedDirectiveCount = 0;

  for (const directive of plan.directives) {
    const fieldValue = candidatePayload[directive.field];
    if (typeof fieldValue !== "string") {
      return failure("redaction_target_not_found", directiveCount);
    }
    const occurrences = countExactOccurrences(fieldValue, directive.literal);
    if (occurrences === 0) {
      return failure("redaction_target_not_found", directiveCount);
    }
    candidatePayload[directive.field] = applyExactRedaction(fieldValue, directive.literal);
    occurrenceCount += occurrences;
    appliedDirectiveCount += 1;
    if (!fieldsChanged.includes(directive.field)) fieldsChanged.push(directive.field);
  }

  const candidateArtifact = {
    ...baseline,
    payload: candidatePayload,
  };
  const compatibility = explainProjectionArtifactValidation(candidateArtifact, canonicalMemory);
  const evidence = {
    directive_count: directiveCount,
    applied_directive_count: appliedDirectiveCount,
    occurrence_count: occurrenceCount,
    fields_changed: fieldsChanged,
  };
  if (!compatibility.valid) return failure("candidate_projection_invalid", directiveCount, evidence);

  return success(candidatePayload, evidence);
}
