import { explainAdmissibility } from "./admissibility-policy.js";
import { normalizeDisclosureCard } from "./candidate-envelope.js";
import {
  ADMISSIBILITY_DECISIONS,
  DISCLOSURE_DECISIONS,
  isRecord,
} from "./disclosure-types.js";

const SCORE_FIELDS = ["vector_score", "fts_score", "rrf_score", "final_score"];
const DIRECT_CARD_FIELDS = [
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
];
const DIRECT_CARD_FORBIDDEN_FIELDS = new Set([
  "body",
  "content",
  "full_content",
  "raw_text",
  "source_text",
  "text",
  "get_token",
  "capability",
  "safe_to_disclose",
  "can_inject_card",
  "can_get_full_content",
  "can_reinforce_on_citation",
]);

function combinedEvidence(candidate = {}) {
  return {
    ...(isRecord(candidate.retrieval) ? candidate.retrieval : {}),
    ...(isRecord(candidate.evidence) ? candidate.evidence : {}),
  };
}

export function hasSufficientRetrievalEvidence(candidate = {}) {
  const evidence = combinedEvidence(candidate);
  const rank = Number(evidence.rank);
  if (!Number.isFinite(rank) || rank < 1) return false;
  const sources = Array.isArray(evidence.sources) ? evidence.sources.filter(Boolean) : [];
  const channelCount = Number(evidence.channel_count);
  const hasChannelEvidence = sources.length > 0 || (Number.isFinite(channelCount) && channelCount > 0);
  const hasScoreEvidence = SCORE_FIELDS.some(field => Number.isFinite(Number(evidence[field])));
  return hasChannelEvidence || hasScoreEvidence;
}

function identityFor(candidate = {}) {
  return {
    memory_id: typeof candidate.memory_id === "string" ? candidate.memory_id : null,
    canonical_id: typeof candidate.canonical_id === "string" ? candidate.canonical_id : null,
  };
}

function nonEmptyCardString(value, max) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

/**
 * Selects disclosure outcomes without sorting, retrieving, mutating, or
 * exposing the candidate envelope. Only a DISCLOSE_CARD record carries card
 * data; WITHHOLD records carry bounded identity and reason metadata.
 */
export function selectDisclosureCandidates(candidates, options = {}) {
  if (!Array.isArray(candidates)) throw new TypeError("candidates must be an array");

  return candidates.map(candidate => {
    const identity = identityFor(candidate);
    const admissibility = explainAdmissibility(candidate, options);
    if (admissibility.decision !== ADMISSIBILITY_DECISIONS.ALLOW) {
      return {
        ...identity,
        decision: DISCLOSURE_DECISIONS.WITHHOLD,
        reason: admissibility.reason,
      };
    }
    if (!hasSufficientRetrievalEvidence(candidate)) {
      return {
        ...identity,
        decision: DISCLOSURE_DECISIONS.WITHHOLD,
        reason: "insufficient_retrieval_evidence",
      };
    }

    return {
      ...identity,
      decision: DISCLOSURE_DECISIONS.DISCLOSE_CARD,
      reason: "admissible_card_with_sufficient_evidence",
      card: normalizeDisclosureCard(candidate.card),
    };
  });
}

function normalizeDirectCard(card) {
  if (!isRecord(card)) return null;
  if (Object.keys(card).some(field => DIRECT_CARD_FORBIDDEN_FIELDS.has(field))) return null;
  if (Object.keys(card).some(field => !DIRECT_CARD_FIELDS.includes(field))) return null;
  if (card.schema_version !== 1 ||
      !nonEmptyCardString(card.card_id, 256) ||
      !nonEmptyCardString(card.title, 80) ||
      !nonEmptyCardString(card.summary, 240) ||
      !nonEmptyCardString(card.salience_reason, 180) ||
      typeof card.source_hint !== "string" || card.source_hint.length > 512 ||
      !nonEmptyCardString(card.category, 80) ||
      !nonEmptyCardString(card.kind, 80) ||
      (card.confidence_score !== null && !Number.isFinite(card.confidence_score)) ||
      !Array.isArray(card.risk_flags) || card.risk_flags.length > 16 ||
      card.risk_flags.some(flag => !nonEmptyCardString(flag, 80))) {
    return null;
  }
  return {
    schema_version: card.schema_version,
    card_id: card.card_id,
    title: card.title,
    summary: card.summary,
    salience_reason: card.salience_reason,
    source_hint: card.source_hint,
    category: card.category,
    kind: card.kind,
    confidence_score: card.confidence_score,
    risk_flags: [...card.risk_flags],
  };
}

/**
 * Production DIRECT_CARD selector. Capability is an input authority; this
 * entry point may only select an already-authorized bounded card.
 */
export function selectDirectCardCandidates(candidates) {
  if (!Array.isArray(candidates)) throw new TypeError("candidates must be an array");

  return candidates.map(candidate => {
    const identity = identityFor(candidate);
    if (!identity.memory_id || !identity.canonical_id) {
      return { ...identity, decision: DISCLOSURE_DECISIONS.WITHHOLD, reason: "invalid_candidate_identity" };
    }
    if (candidate?.capability !== "CARD_DISCLOSABLE") {
      return {
        ...identity,
        decision: DISCLOSURE_DECISIONS.WITHHOLD,
        reason: "capability_not_card_disclosable",
      };
    }
    if (!hasSufficientRetrievalEvidence(candidate)) {
      return { ...identity, decision: DISCLOSURE_DECISIONS.WITHHOLD, reason: "insufficient_retrieval_evidence" };
    }
    const card = normalizeDirectCard(candidate.card);
    if (!card) {
      return { ...identity, decision: DISCLOSURE_DECISIONS.WITHHOLD, reason: "invalid_direct_card_payload" };
    }
    return {
      ...identity,
      decision: DISCLOSURE_DECISIONS.DISCLOSE_CARD,
      reason: "card_capability_and_retrieval_evidence_pass",
      card,
    };
  });
}

export const selectProductionDirectCardCandidates = selectDirectCardCandidates;
