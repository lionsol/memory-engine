import { projectCanonicalRerankTexts } from "./canonical-text-projector.js";
import { rerankCandidates } from "./relevance-reranker.js";

export const CANONICAL_RERANK_PROJECTION_ERROR = "CANONICAL_RERANK_PROJECTION_ERROR";

function nowMs() {
  return typeof performance?.now === "function" ? performance.now() : Date.now();
}

function elapsedMs(startedAt) {
  return Math.max(0, Math.round(nowMs() - startedAt));
}

function mapOrderedMemories(memories, orderedIds) {
  const byId = new Map(memories.map(memory => [memory.memory_id, memory]));
  if (orderedIds.length !== memories.length || new Set(orderedIds).size !== memories.length) {
    throw new Error("canonical_rerank_order_mapping_incomplete");
  }

  return orderedIds.map(id => {
    const memory = byId.get(id);
    if (!memory) throw new Error("canonical_rerank_order_mapping_unknown_id");
    return memory;
  });
}

/**
 * Compose the pure canonical text projection with the standalone reranker.
 * The caller remains responsible for candidate eligibility and authorization.
 *
 * @param {{query: string, memories: Array<object>, maxCodePointsPerCandidate: number, maxTotalCodePoints: number, deadlineMs: number, adapter: Function}} input
 * @returns {Promise<{memories: Array<object>, orderedIds: string[], status: string, reason: string, scores: Record<string, number|null>, usage: unknown, adapterIdentity: unknown, adapterErrorCode: string|null, elapsedMs: number, projectionElapsedMs: number, projectionMetadata: Array<object>, totalCodePoints: number}>}
 */
export async function rerankCanonicalMemories({
  query,
  memories,
  maxCodePointsPerCandidate,
  maxTotalCodePoints,
  deadlineMs,
  adapter,
} = {}) {
  const projectionStartedAt = nowMs();
  let projection;
  try {
    projection = projectCanonicalRerankTexts({
      memories,
      maxCodePointsPerCandidate,
      maxTotalCodePoints,
    });
  } catch (error) {
    if (error && typeof error === "object") {
      error.code = CANONICAL_RERANK_PROJECTION_ERROR;
      error.projectionElapsedMs = elapsedMs(projectionStartedAt);
      throw error;
    }
    const projectionError = new Error(String(error || "canonical_rerank_projection_failed"));
    projectionError.code = CANONICAL_RERANK_PROJECTION_ERROR;
    projectionError.projectionElapsedMs = elapsedMs(projectionStartedAt);
    throw projectionError;
  }
  const projectionElapsedMs = elapsedMs(projectionStartedAt);
  const reranked = await rerankCandidates({
    query,
    candidates: projection.candidates,
    deadlineMs,
    adapter,
  });

  return {
    memories: mapOrderedMemories(memories, reranked.orderedIds),
    orderedIds: reranked.orderedIds,
    status: reranked.status,
    reason: reranked.reason,
    scores: reranked.scores,
    usage: reranked.usage,
    adapterIdentity: reranked.adapterIdentity,
    adapterErrorCode: reranked.adapterErrorCode,
    elapsedMs: reranked.elapsedMs,
    projectionElapsedMs,
    projectionMetadata: projection.metadata,
    totalCodePoints: projection.totalCodePoints,
  };
}
