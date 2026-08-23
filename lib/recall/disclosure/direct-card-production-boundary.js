import { getCanonicalMemoriesByIds } from "../../canonical/read-adapter.js";
import { projectCanonicalMemoryToOwnerDisclosureCardArtifact } from "./owner-attestable-projection.js";
import { createDisclosureAttestationAuthorityProvider } from "./owner-attestation.js";
import { evaluateDirectCardCapability, isOwnerAudienceAuthenticated } from "./disclosure-capability.js";
import { selectDirectCardCandidates } from "./disclosure-selector.js";

const MAX_DIRECT_CARD_CANDIDATES = 32;

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function boundedSources(value) {
  if (Array.isArray(value)) return value.map(item => String(item || "").trim()).filter(Boolean).slice(0, 8);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function retrievalEvidence(candidate, index) {
  const candidateRank = finiteNumber(candidate?.rank);
  const evidence = {
    rank: Number.isSafeInteger(candidateRank) && candidateRank >= 1 ? candidateRank : index + 1,
    sources: boundedSources(candidate?.sources),
  };
  for (const [target, fields] of [
    ["vector_score", ["vector_score", "vectorScore", "semantic_score", "semanticScore"]],
    ["fts_score", ["fts_score", "ftsScore"]],
    ["rrf_score", ["rrf_score", "rrfScore"]],
    ["final_score", ["final_score", "finalScore"]],
  ]) {
    for (const field of fields) {
      const value = finiteNumber(candidate?.[field]);
      if (value !== undefined) {
        evidence[target] = value;
        break;
      }
    }
  }
  if (evidence.sources.length > 0) evidence.channel_count = evidence.sources.length;
  return evidence;
}

function identity(candidate) {
  return {
    memory_id: nonEmptyString(candidate?.memory_id) ? candidate.memory_id : null,
    canonical_id: nonEmptyString(candidate?.canonical_id) ? candidate.canonical_id : null,
  };
}

function initialCapability(candidate, index, reason = "invalid_candidate_identity") {
  return {
    candidate_index: index,
    ...identity(candidate),
    capability: "RETRIEVAL_ONLY",
    reason,
  };
}

function withholdSelection(candidate, index, reason) {
  return {
    candidate_index: index,
    ...identity(candidate),
    decision: "WITHHOLD",
    reason,
  };
}

function capabilityRecord(candidate, index, capability, reason) {
  return {
    candidate_index: index,
    ...identity(candidate),
    capability,
    reason,
  };
}

function safeReason(error, fallback) {
  const reason = typeof error?.reason === "string" ? error.reason : "";
  return reason && reason.length <= 96 && /^[a-z0-9_:-]+$/u.test(reason) ? reason : fallback;
}

/**
 * Production-only DIRECT_CARD boundary. Canonical source text exists only in
 * this bounded read/projection callback and is never returned to callers.
 */
export async function evaluateDirectCardProductionBoundary({
  event,
  candidates = [],
  runtimeAgentScope,
  agentScope,
  withHybridDbAccessScope,
} = {}) {
  const boundedCandidates = (Array.isArray(candidates) ? candidates : [])
    .slice(0, MAX_DIRECT_CARD_CANDIDATES);
  const ownerAudienceAuthenticated = isOwnerAudienceAuthenticated(event);
  const capabilityResults = boundedCandidates.map((candidate, index) => (
    initialCapability(candidate, index, ownerAudienceAuthenticated
      ? "invalid_candidate_identity"
      : "owner_audience_not_authenticated")
  ));

  if (!ownerAudienceAuthenticated) {
    return {
      ownerAudienceAuthenticated: false,
      capabilityResults,
      selections: boundedCandidates.map((candidate, index) => (
        withholdSelection(candidate, index, "owner_audience_not_authenticated")
      )),
      selected: [],
    };
  }

  const readable = boundedCandidates
    .map((candidate, index) => ({ candidate, index, ...identity(candidate) }))
    .filter(item => nonEmptyString(item.memory_id) && nonEmptyString(item.canonical_id));

  if (readable.length === 0) {
    return {
      ownerAudienceAuthenticated: true,
      capabilityResults,
      selections: boundedCandidates.map((candidate, index) => (
        withholdSelection(candidate, index, "invalid_candidate_identity")
      )),
      selected: [],
    };
  }

  const selectorInputs = boundedCandidates.map((candidate, index) => ({
    ...identity(candidate),
    retrieval: retrievalEvidence(candidate, index),
    capability: "RETRIEVAL_ONLY",
    capability_reason: capabilityResults[index].reason,
  }));

  const setCapability = (index, capability, reason, card) => {
    const candidate = boundedCandidates[index];
    capabilityResults[index] = capabilityRecord(candidate, index, capability, reason);
    selectorInputs[index] = {
      ...selectorInputs[index],
      capability,
      capability_reason: reason,
    };
    if (card) selectorInputs[index].card = card;
    else delete selectorInputs[index].card;
  };

  try {
    if (typeof withHybridDbAccessScope !== "function") {
      throw Object.assign(new Error("isolated readonly scope unavailable"), { reason: "invalid_db_topology" });
    }

    await withHybridDbAccessScope(async access => {
      if (typeof access?.withCoreDb !== "function" || typeof access?.withEngineDb !== "function") {
        for (const item of readable) setCapability(item.index, "RETRIEVAL_ONLY", "invalid_db_topology");
        return;
      }

      const batch = getCanonicalMemoriesByIds(
        readable.map(item => item.memory_id),
        {
          withCoreDb: access.withCoreDb,
          withEngineDb: access.withEngineDb,
        },
      );
      if (!batch.ok) {
        for (const item of readable) {
          setCapability(item.index, "RETRIEVAL_ONLY", batch.reason || "canonical_read_failed");
        }
        return;
      }

      const authorityProvider = createDisclosureAttestationAuthorityProvider({
        withEngineDbReadonly: access.withEngineDb,
      });

      for (const [batchIndex, item] of readable.entries()) {
        const resolved = batch.results[batchIndex];
        if (!resolved?.ok || !resolved.memory) {
          setCapability(item.index, "RETRIEVAL_ONLY", resolved?.reason || "canonical_read_failed");
          continue;
        }

        const canonicalMemory = resolved.memory;
        if (canonicalMemory.memory_id !== item.memory_id || canonicalMemory.canonical_id !== item.canonical_id) {
          setCapability(item.index, "RETRIEVAL_ONLY", "canonical_identity_mismatch");
          continue;
        }

        let projectionArtifact;
        try {
          projectionArtifact = projectCanonicalMemoryToOwnerDisclosureCardArtifact(canonicalMemory);
        } catch (error) {
          setCapability(item.index, "RETRIEVAL_ONLY", safeReason(error, "invalid_projection_artifact"));
          continue;
        }

        let attestationEvidence;
        try {
          attestationEvidence = authorityProvider.getSafeToDiscloseEvidence({
            canonicalMemory,
            projectionArtifact,
          });
        } catch {
          attestationEvidence = { safe_to_disclose: false, reason: "attestation_store_unavailable" };
        }

        const capability = evaluateDirectCardCapability({
          event,
          ownerAudienceAuthenticated: true,
          canonicalMemory,
          projectionArtifact,
          attestationEvidence,
          runtimeAgentScope: runtimeAgentScope ?? agentScope,
        });
        setCapability(
          item.index,
          capability.capability,
          capability.reason,
          capability.capability === "CARD_DISCLOSABLE" ? projectionArtifact.payload : undefined,
        );
      }
    });
  } catch (error) {
    for (const item of readable) {
      setCapability(item.index, "RETRIEVAL_ONLY", safeReason(error, "direct_card_boundary_error"));
    }
  }

  const selected = selectDirectCardCandidates(selectorInputs);
  const selections = selected.map((selection, index) => ({
    candidate_index: index,
    ...selection,
  }));
  return {
    ownerAudienceAuthenticated: true,
    capabilityResults,
    selections,
    selected: selections.filter(selection => selection.decision === "DISCLOSE_CARD"),
  };
}

export { MAX_DIRECT_CARD_CANDIDATES };
