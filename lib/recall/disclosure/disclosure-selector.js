import { explainAdmissibility } from "./admissibility-policy.js";
import { normalizeDisclosureCard } from "./candidate-envelope.js";
import {
  ADMISSIBILITY_DECISIONS,
  DISCLOSURE_DECISIONS,
  isRecord,
} from "./disclosure-types.js";

const SCORE_FIELDS = ["vector_score", "fts_score", "rrf_score", "final_score"];

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
