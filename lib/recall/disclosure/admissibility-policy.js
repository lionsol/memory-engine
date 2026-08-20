import {
  ADMISSIBILITY_DECISIONS,
  DISCLOSURE_BLOCKING_LIFECYCLE_STATES,
  DISCLOSURE_BLOCKING_RISK_FLAGS,
  DISCLOSURE_CARD_LEVELS,
  isRecord,
  RECALL_CANDIDATE_ENVELOPE_SCHEMA_VERSION,
} from "./disclosure-types.js";

const REQUIRED_CANONICAL_SECTIONS = ["source", "classification", "lifecycle", "content_ref"];
const FULL_BODY_FIELDS = new Set(["body", "content", "raw_text", "source_text", "text"]);
const UNSAFE_CATEGORIES = new Set(["raw_log", "dreaming"]);
const UNSAFE_KINDS = new Set(["diagnostic"]);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function cardFor(candidate) {
  return isRecord(candidate?.card) ? candidate.card : {};
}

function canonicalFor(candidate) {
  return isRecord(candidate?.canonical) ? candidate.canonical : {};
}

function policyFor(candidate) {
  return isRecord(candidate?.policy) ? candidate.policy : {};
}

function riskFlagsFor(candidate) {
  const cardFlags = Array.isArray(cardFor(candidate).risk_flags) ? cardFor(candidate).risk_flags : [];
  const canonicalFlags = Array.isArray(canonicalFor(candidate).risk_flags) ? canonicalFor(candidate).risk_flags : [];
  return new Set([...cardFlags, ...canonicalFlags].map(flag => String(flag || "").trim()).filter(Boolean));
}

function invalidProjection(candidate) {
  if (!isRecord(candidate) || candidate.schema_version !== RECALL_CANDIDATE_ENVELOPE_SCHEMA_VERSION) return "invalid_candidate_envelope";
  if (!nonEmptyString(candidate.memory_id) || !nonEmptyString(candidate.canonical_id)) return "invalid_candidate_identity";

  const canonical = canonicalFor(candidate);
  if (canonical.memory_id !== candidate.memory_id || canonical.canonical_id !== candidate.canonical_id) return "canonical_identity_mismatch";
  if (canonical.schema_version !== undefined && canonical.schema_version !== 1) return "invalid_canonical_projection";
  if (REQUIRED_CANONICAL_SECTIONS.some(section => !isRecord(canonical[section]))) return "invalid_canonical_projection";

  const sourceRecordId = canonical.source.record_id;
  if (sourceRecordId !== undefined && sourceRecordId !== candidate.memory_id) return "canonical_source_identity_mismatch";

  const card = cardFor(candidate);
  if (card.schema_version !== 1 || !nonEmptyString(card.card_id) || card.memory_id !== candidate.memory_id) return "invalid_card_projection";
  if (!nonEmptyString(card.title) || !nonEmptyString(card.summary) || !Array.isArray(card.risk_flags)) return "invalid_card_projection";
  if (Object.keys(card).some(field => FULL_BODY_FIELDS.has(field))) return "card_contains_full_body";
  if (!DISCLOSURE_CARD_LEVELS.includes(card.disclosure_level)) return "card_disclosure_not_allowed";

  const policy = policyFor(candidate);
  if (policy.disclosure_level !== undefined && policy.disclosure_level !== card.disclosure_level) return "policy_card_level_mismatch";
  if (policy.can_inject_card === false) return "policy_withholds_card";
  return null;
}

function blockedLifecycle(candidate) {
  const canonical = canonicalFor(candidate);
  const classification = canonical.classification || {};
  const lifecycle = canonical.lifecycle || {};
  const state = String(classification.lifecycle_state || lifecycle.state || "").trim().toLowerCase();
  if (state && (state !== "active" || DISCLOSURE_BLOCKING_LIFECYCLE_STATES.includes(state))) return true;
  return ["archived", "quarantined", "deleted_shadow", "stale_index_candidate"].some(
    field => lifecycle[field] === true || Number(lifecycle[field] || 0) === 1,
  );
}

function scopeViolation(candidate, options = {}) {
  const canonical = canonicalFor(candidate);
  const classification = canonical.classification || {};
  const policy = policyFor(candidate);
  const flags = riskFlagsFor(candidate);
  if (flags.has("cross_agent_scope")) return true;
  if (policy.scope_allowed === false || policy.scope_violation === true) return true;

  const requestedAgentScope = String(options.agentScope || options.scope || "").trim().toLowerCase();
  const objectAgentScope = String(classification.agent_scope || "").trim().toLowerCase();
  if (
    requestedAgentScope
    && objectAgentScope
    && objectAgentScope !== "unknown"
    && objectAgentScope !== "shared"
    && objectAgentScope !== requestedAgentScope
  ) return true;

  const scope = String(classification.scope || "").trim().toLowerCase();
  return ["unknown", "cross_agent", "untrusted"].includes(scope);
}

function unsafeArtifact(candidate) {
  const canonical = canonicalFor(candidate);
  const classification = canonical.classification || {};
  const source = canonical.source || {};
  const flags = riskFlagsFor(candidate);
  if (DISCLOSURE_BLOCKING_RISK_FLAGS.some(flag => flags.has(flag))) return true;
  if (UNSAFE_CATEGORIES.has(String(classification.category || "").trim().toLowerCase())) return true;
  if (UNSAFE_KINDS.has(String(classification.kind || "").trim().toLowerCase())) return true;
  return /(?:^|\/)(?:raw[-_ ]?logs?|tool[-_ ]?output|dreaming)(?:\/|$)/i.test(String(source.path || ""));
}

export function explainAdmissibility(candidate, options = {}) {
  const projectionError = invalidProjection(candidate);
  if (projectionError) return { decision: ADMISSIBILITY_DECISIONS.DENY, reason: projectionError };
  if (blockedLifecycle(candidate)) return { decision: ADMISSIBILITY_DECISIONS.DENY, reason: "blocked_lifecycle" };
  if (scopeViolation(candidate, options)) return { decision: ADMISSIBILITY_DECISIONS.DENY, reason: "scope_violation" };
  if (unsafeArtifact(candidate)) return { decision: ADMISSIBILITY_DECISIONS.DENY, reason: "unsafe_artifact" };
  return { decision: ADMISSIBILITY_DECISIONS.ALLOW, reason: "admissible" };
}

export function evaluateAdmissibility(candidate, options = {}) {
  return explainAdmissibility(candidate, options).decision;
}
