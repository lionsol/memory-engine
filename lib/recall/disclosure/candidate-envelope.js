import {
  DISCLOSURE_CARD_FIELDS,
  DISCLOSURE_POLICY_FIELDS,
  isRecord,
  RECALL_CANDIDATE_ENVELOPE_SCHEMA_VERSION,
  RETRIEVAL_EVIDENCE_KEYS,
} from "./disclosure-types.js";

const CANONICAL_SOURCE_FIELDS = [
  "system",
  "record_type",
  "record_id",
  "path",
  "core_source",
  "line_start",
  "line_end",
  "core_hash",
  "updated_at",
];

const CANONICAL_CLASSIFICATION_FIELDS = [
  "category",
  "category_authority",
  "kind",
  "kind_basis",
  "scope",
  "agent_scope",
  "lifecycle_state",
];

const CANONICAL_TEMPORAL_FIELDS = [
  "episode_date",
  "episode_date_basis",
];

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
  "state",
];

const CANONICAL_CONTENT_REF_FIELDS = [
  "mode",
  "content_hash",
];

function copyFields(source, fields) {
  if (!isRecord(source)) return {};
  const result = {};
  for (const field of fields) {
    if (Object.hasOwn(source, field) && source[field] !== undefined) result[field] = source[field];
  }
  return result;
}

function copyStringArray(value) {
  if (!Array.isArray(value)) return undefined;
  const result = [];
  const seen = new Set();
  for (const item of value) {
    const text = String(item || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function normalizeEvidenceValue(key, value) {
  if (key === "sources") {
    if (Array.isArray(value)) return copyStringArray(value);
    if (typeof value === "string" && value.trim()) return [value.trim()];
    return undefined;
  }
  if (["exact_match", "channel_agreement"].includes(key)) {
    return typeof value === "boolean" ? value : undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

export function normalizeRetrievalEvidence(value = {}) {
  const source = isRecord(value) ? value : {};
  const result = {};
  for (const key of RETRIEVAL_EVIDENCE_KEYS) {
    if (!Object.hasOwn(source, key)) continue;
    const normalized = normalizeEvidenceValue(key, source[key]);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

function normalizeCanonicalMemory(canonicalMemory) {
  if (!isRecord(canonicalMemory)) throw new TypeError("canonicalMemory must be an object");
  const memoryId = canonicalMemory.memory_id;
  const canonicalId = canonicalMemory.canonical_id;
  if (typeof memoryId !== "string" || !memoryId.trim()) throw new TypeError("canonicalMemory.memory_id is required");
  if (typeof canonicalId !== "string" || !canonicalId.trim()) throw new TypeError("canonicalMemory.canonical_id is required");

  return {
    schema_version: canonicalMemory.schema_version,
    memory_id: memoryId,
    canonical_id: canonicalId,
    source: copyFields(canonicalMemory.source, CANONICAL_SOURCE_FIELDS),
    classification: copyFields(canonicalMemory.classification, CANONICAL_CLASSIFICATION_FIELDS),
    temporal: copyFields(canonicalMemory.temporal, CANONICAL_TEMPORAL_FIELDS),
    lifecycle: copyFields(canonicalMemory.lifecycle, CANONICAL_LIFECYCLE_FIELDS),
    content_ref: copyFields(canonicalMemory.content_ref, CANONICAL_CONTENT_REF_FIELDS),
  };
}

function rawCardProjection(cardProjection) {
  if (!isRecord(cardProjection)) return {};
  if (isRecord(cardProjection.memory_card)) return cardProjection.memory_card;
  if (isRecord(cardProjection.card)) return cardProjection.card;
  return cardProjection;
}

export function normalizeDisclosureCard(cardProjection = {}) {
  const source = rawCardProjection(cardProjection);
  const result = copyFields(source, DISCLOSURE_CARD_FIELDS);
  if (Object.hasOwn(source, "risk_flags")) {
    const riskFlags = copyStringArray(source.risk_flags);
    if (riskFlags) result.risk_flags = riskFlags;
  }
  return result;
}

function rawPolicyProjection(cardProjection, canonicalMemory) {
  if (isRecord(cardProjection?.policy)) return cardProjection.policy;
  if (isRecord(cardProjection?.memory_object?.policy)) return cardProjection.memory_object.policy;
  if (isRecord(cardProjection?.card?.policy)) return cardProjection.card.policy;
  if (isRecord(canonicalMemory?.policy)) return canonicalMemory.policy;
  return {};
}

function normalizePolicy(cardProjection, canonicalMemory, card) {
  const result = copyFields(rawPolicyProjection(cardProjection, canonicalMemory), DISCLOSURE_POLICY_FIELDS);
  if (!Object.hasOwn(result, "disclosure_level") && typeof card.disclosure_level === "string") {
    result.disclosure_level = card.disclosure_level;
  }
  if (!Object.hasOwn(result, "can_inject_card") && typeof card.disclosure_level === "string") {
    result.can_inject_card = ["memory_card", "short_summary"].includes(card.disclosure_level);
  }
  return result;
}

function splitRetrievalEvidence(retrievalEvidence) {
  const source = isRecord(retrievalEvidence) ? retrievalEvidence : {};
  const retrieval = isRecord(source.retrieval) ? source.retrieval : source;
  const evidence = isRecord(source.evidence) ? source.evidence : source;
  return {
    retrieval: normalizeRetrievalEvidence(retrieval),
    evidence: normalizeRetrievalEvidence(evidence),
  };
}

/**
 * Builds a read-only, non-persistent boundary between canonical memory and
 * later disclosure policy. The canonical view deliberately omits source.text
 * and other full-body fields; card disclosure is the only content surface.
 */
export function createRecallCandidateEnvelope({
  canonicalMemory,
  retrievalEvidence = {},
  cardProjection = {},
} = {}) {
  const canonical = normalizeCanonicalMemory(canonicalMemory);
  const card = normalizeDisclosureCard(cardProjection);
  const { retrieval, evidence } = splitRetrievalEvidence(retrievalEvidence);

  return {
    schema_version: RECALL_CANDIDATE_ENVELOPE_SCHEMA_VERSION,
    memory_id: canonical.memory_id,
    canonical_id: canonical.canonical_id,
    canonical,
    retrieval,
    evidence,
    policy: normalizePolicy(cardProjection, canonicalMemory, card),
    card,
  };
}
