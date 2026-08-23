import {
  explainProjectionArtifactValidation,
  PROJECTION_ARTIFACT_SCHEMA_VERSION,
  PROJECTION_KINDS,
} from "../../canonical/projection-artifact.js";
import {
  deriveDisclosureAttestationBinding,
  DISCLOSURE_ATTESTATION_AUTHORITY_KIND,
  DISCLOSURE_ATTESTATION_AUDIENCE_SCOPE,
  DISCLOSURE_ATTESTATION_POLICY_VERSION,
  DISCLOSURE_ATTESTATION_PROJECTION_ADAPTER_VERSION,
  DISCLOSURE_ATTESTATION_SCHEMA_VERSION,
  DISCLOSURE_ATTESTATION_SURFACE,
} from "./owner-attestation.js";
import {
  OWNER_DISCLOSURE_PRESENTATION_INPUT_VERSION,
  OWNER_DISCLOSURE_PROJECTION_ADAPTER_VERSION,
  OWNER_DISCLOSURE_PROJECTION_SURFACE,
} from "./owner-attestable-projection.js";

export const DIRECT_CARD_CAPABILITY_STATES = Object.freeze([
  "RETRIEVAL_ONLY",
  "CARD_DISCLOSABLE",
]);

const BLOCKING_LIFECYCLE_STATES = new Set([
  "candidate",
  "needs_review",
  "archived",
  "quarantined",
  "deleted_shadow",
  "stale_index_candidate",
]);

const BLOCKING_LIFECYCLE_FLAGS = [
  "candidate",
  "needs_review",
  "archived",
  "quarantined",
  "deleted_shadow",
  "stale_index_candidate",
];

const BLOCKING_RISK_FLAGS = new Set([
  "raw_log_like",
  "tool_output_like",
  "dreaming_artifact",
  "low_confidence",
  "archived",
  "quarantined",
  "stale_index_candidate",
  "conflict_flag",
  "cross_agent_scope",
  "sensitive_source",
  "unsafe_artifact",
  "untrusted",
  "sensitive",
  "private",
  "personal",
  "personal_data",
  "confidential",
  "secret",
]);

const UNSAFE_CATEGORIES = new Set(["raw_log", "dreaming"]);
const UNSAFE_KINDS = new Set(["diagnostic"]);
const BLOCKING_SCOPE_VALUES = new Set(["unknown", "cross_agent", "untrusted"]);

const AUTHORITY_FIELDS = [
  "memory_id",
  "canonical_id",
  "source_content_hash",
  "surface",
  "projection_schema_version",
  "projection_kind",
  "projection_hash",
  "projection_adapter_version",
  "authority_kind",
  "audience_scope",
  "attestation_schema_version",
  "policy_version",
  "attestation_id",
];

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function flagIsSet(value) {
  return value === true || Number(value || 0) === 1;
}

function capabilityResult(capability, reason, extra = {}) {
  return { capability, reason, ...extra };
}

function retrievalOnly(reason) {
  return capabilityResult("RETRIEVAL_ONLY", reason);
}

export function isOwnerAudienceAuthenticated(event) {
  return event?.senderIsOwner === true;
}

function validateCanonicalMemory(canonicalMemory) {
  if (!isRecord(canonicalMemory)) return "invalid_canonical_memory";
  if (canonicalMemory.schema_version !== 1) return "invalid_canonical_schema";
  if (!nonEmptyString(canonicalMemory.memory_id)) return "invalid_canonical_identity";
  if (!nonEmptyString(canonicalMemory.canonical_id)) return "invalid_canonical_identity";
  if (canonicalMemory.canonical_id !== `cmem:core:${canonicalMemory.memory_id}`) {
    return "canonical_identity_mismatch";
  }
  if (!isRecord(canonicalMemory.source) || typeof canonicalMemory.source.text !== "string" || canonicalMemory.source.text.length === 0) {
    return "invalid_canonical_source";
  }
  if (!isRecord(canonicalMemory.classification)) return "invalid_canonical_classification";
  if (!isRecord(canonicalMemory.lifecycle)) return "invalid_canonical_lifecycle";
  if (!isRecord(canonicalMemory.content_ref) || !nonEmptyString(canonicalMemory.content_ref.content_hash)) {
    return "invalid_canonical_content_hash";
  }
  if (canonicalMemory.source.record_id !== undefined && canonicalMemory.source.record_id !== canonicalMemory.memory_id) {
    return "canonical_source_identity_mismatch";
  }
  return null;
}

function validateOwnerProjection(projectionArtifact, canonicalMemory) {
  const validation = explainProjectionArtifactValidation(projectionArtifact, canonicalMemory);
  if (!validation.valid) return validation.reason;
  if (projectionArtifact.projection_schema_version !== PROJECTION_ARTIFACT_SCHEMA_VERSION) {
    return "projection_schema_mismatch";
  }
  if (projectionArtifact.surface !== OWNER_DISCLOSURE_PROJECTION_SURFACE ||
      projectionArtifact.surface !== DISCLOSURE_ATTESTATION_SURFACE) {
    return "projection_surface_mismatch";
  }
  if (projectionArtifact.projection_kind !== PROJECTION_KINDS.DISCLOSURE_CARD) {
    return "projection_kind_mismatch";
  }
  if (!isRecord(projectionArtifact.provenance) ||
      projectionArtifact.provenance.adapter !== OWNER_DISCLOSURE_PROJECTION_ADAPTER_VERSION ||
      projectionArtifact.provenance.adapter !== DISCLOSURE_ATTESTATION_PROJECTION_ADAPTER_VERSION ||
      projectionArtifact.provenance.presentation_input !== OWNER_DISCLOSURE_PRESENTATION_INPUT_VERSION) {
    return "projection_adapter_mismatch";
  }
  return null;
}

function validateAuthorityEvidence(attestationEvidence, canonicalMemory, projectionArtifact) {
  if (attestationEvidence?.safe_to_disclose !== true) {
    return attestationEvidence?.reason || "attestation_not_safe";
  }
  if (!isRecord(attestationEvidence.authority)) return "invalid_attestation_authority";

  let expected;
  try {
    expected = deriveDisclosureAttestationBinding(canonicalMemory, projectionArtifact);
  } catch {
    return "invalid_attestation_binding";
  }
  if (!expected.valid) return expected.reason;

  const authority = attestationEvidence.authority;
  if (Object.keys(authority).length !== AUTHORITY_FIELDS.length ||
      AUTHORITY_FIELDS.some(field => !Object.hasOwn(authority, field))) {
    return "invalid_attestation_authority";
  }
  for (const field of AUTHORITY_FIELDS) {
    if (authority[field] !== expected.binding[field]) return `${field}_mismatch`;
  }
  if (authority.authority_kind !== DISCLOSURE_ATTESTATION_AUTHORITY_KIND) return "authority_kind_mismatch";
  if (authority.audience_scope !== DISCLOSURE_ATTESTATION_AUDIENCE_SCOPE) return "audience_scope_mismatch";
  if (authority.policy_version !== DISCLOSURE_ATTESTATION_POLICY_VERSION) return "policy_version_mismatch";
  if (authority.attestation_schema_version !== DISCLOSURE_ATTESTATION_SCHEMA_VERSION) {
    return "attestation_schema_mismatch";
  }
  return null;
}

function lifecycleState(canonicalMemory) {
  const lifecycle = canonicalMemory.lifecycle || {};
  const classification = canonicalMemory.classification || {};
  for (const value of [
    lifecycle.state,
    lifecycle.lifecycle_state,
    lifecycle.status,
    classification.lifecycle_state,
  ]) {
    const state = normalized(value);
    if (state) return state;
  }
  return "active";
}

function hasBlockingLifecycle(canonicalMemory) {
  const lifecycle = canonicalMemory.lifecycle || {};
  const classification = canonicalMemory.classification || {};
  const state = lifecycleState(canonicalMemory);
  if (state !== "active" || BLOCKING_LIFECYCLE_STATES.has(state)) return true;
  return BLOCKING_LIFECYCLE_FLAGS.some(flag => (
    flagIsSet(lifecycle[flag]) || flagIsSet(classification[flag]) || flagIsSet(canonicalMemory[flag])
  ));
}

function allRiskFlags(canonicalMemory, projectionArtifact) {
  const values = [
    canonicalMemory.risk_flags,
    canonicalMemory.classification?.risk_flags,
    canonicalMemory.lifecycle?.risk_flags,
    projectionArtifact?.payload?.risk_flags,
  ];
  const flags = new Set(values.flatMap(value => Array.isArray(value) ? value : [])
    .map(normalized)
    .filter(Boolean));
  if (flagIsSet(canonicalMemory.lifecycle?.conflict) ||
      flagIsSet(canonicalMemory.lifecycle?.conflict_flag) ||
      flagIsSet(canonicalMemory.classification?.conflict_flag) ||
      flagIsSet(canonicalMemory.conflict_flag)) {
    flags.add("conflict_flag");
  }
  return flags;
}

function hasScopeViolation(canonicalMemory, runtimeAgentScope, riskFlags) {
  const classification = canonicalMemory.classification || {};
  const explicitScope = normalized(
    classification.scope ?? canonicalMemory.scope?.scope ?? canonicalMemory.scope,
  );
  if (BLOCKING_SCOPE_VALUES.has(explicitScope)) return true;
  if (canonicalMemory.scope_allowed === false || canonicalMemory.scope_violation === true) return true;
  if (classification.scope_allowed === false || classification.scope_violation === true) return true;
  if (riskFlags.has("cross_agent_scope")) return true;

  const objectAgentScope = normalized(
    classification.agent_scope ?? canonicalMemory.agent_scope,
  );
  if (objectAgentScope && BLOCKING_SCOPE_VALUES.has(objectAgentScope)) return true;
  const runtimeScope = normalized(runtimeAgentScope);
  if (!runtimeScope) return true;
  if (objectAgentScope && objectAgentScope !== "shared" && objectAgentScope !== "unknown" && objectAgentScope !== runtimeScope) {
    return true;
  }
  return false;
}

function hasUnsafeSource(canonicalMemory) {
  const classification = canonicalMemory.classification || {};
  const source = canonicalMemory.source || {};
  const category = normalized(classification.category);
  const kind = normalized(classification.kind);
  const path = normalized(source.path);
  const text = String(source.text || "");

  if (UNSAFE_CATEGORIES.has(category) || UNSAFE_KINDS.has(kind)) return true;
  if (/(?:^|\/)(?:raw[-_ ]?logs?|tool[-_ ]?outputs?|dreaming)(?:[./_-]|$)/iu.test(path)) return true;
  if (/\braw[_ -]?log\b|\bLOG_LINE\b|\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/iu.test(text)) return true;
  if (/\b(?:ERROR|WARN|Traceback|stack trace|at Object\.|Exception|SyntaxError|TypeError)\b/iu.test(text)) return true;
  return false;
}

function hasUnsafeRisk(canonicalMemory, projectionArtifact, riskFlags) {
  if ([...riskFlags].some(flag => BLOCKING_RISK_FLAGS.has(flag))) return true;
  const confidence = Number(canonicalMemory.lifecycle?.confidence);
  if (Number.isFinite(confidence) && confidence < 0.2) return true;
  return hasUnsafeSource(canonicalMemory) || Boolean(projectionArtifact?.payload?.risk_flags?.includes("raw_log_like"));
}

function boundedAuthorityEvidence(authority) {
  if (!isRecord(authority)) return undefined;
  return Object.fromEntries(AUTHORITY_FIELDS.map(field => [field, authority[field]]));
}

/**
 * Calculates the production DIRECT_CARD capability from independent inputs.
 * It never reads a database, projects source, or selects a card.
 */
export function evaluateDirectCardCapability({
  event,
  ownerAudienceAuthenticated = isOwnerAudienceAuthenticated(event),
  canonicalMemory,
  projectionArtifact,
  attestationEvidence,
  runtimeAgentScope,
  agentScope,
} = {}) {
  const audienceAuthenticated = event === undefined
    ? ownerAudienceAuthenticated === true
    : isOwnerAudienceAuthenticated(event);
  if (!audienceAuthenticated) return retrievalOnly("owner_audience_not_authenticated");

  const canonicalError = validateCanonicalMemory(canonicalMemory);
  if (canonicalError) return retrievalOnly(canonicalError);

  const projectionError = validateOwnerProjection(projectionArtifact, canonicalMemory);
  if (projectionError) return retrievalOnly(projectionError);

  const authorityError = validateAuthorityEvidence(attestationEvidence, canonicalMemory, projectionArtifact);
  if (authorityError) return retrievalOnly(authorityError);

  if (hasBlockingLifecycle(canonicalMemory)) return retrievalOnly("blocked_lifecycle");

  const riskFlags = allRiskFlags(canonicalMemory, projectionArtifact);
  if (hasScopeViolation(canonicalMemory, runtimeAgentScope ?? agentScope, riskFlags)) {
    return retrievalOnly("scope_denied");
  }
  if (hasUnsafeRisk(canonicalMemory, projectionArtifact, riskFlags)) {
    return retrievalOnly("unsafe_risk");
  }

  return capabilityResult("CARD_DISCLOSABLE", "all_direct_card_authorities_pass", {
    authority: boundedAuthorityEvidence(attestationEvidence.authority),
  });
}
