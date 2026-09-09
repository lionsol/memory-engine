import { projectCanonicalRerankTexts } from "./canonical-text-projector.js";
import { rerankCandidates } from "./relevance-reranker.js";

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
 * @returns {Promise<{memories: Array<object>, orderedIds: string[], status: string, reason: string, scores: Record<string, number|null>, usage: unknown, adapterIdentity: unknown, elapsedMs: number, projectionMetadata: Array<object>, totalCodePoints: number}>}
 */
export async function rerankCanonicalMemories({
  query,
  memories,
  maxCodePointsPerCandidate,
  maxTotalCodePoints,
  deadlineMs,
  adapter,
} = {}) {
  const projection = projectCanonicalRerankTexts({
    memories,
    maxCodePointsPerCandidate,
    maxTotalCodePoints,
  });
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
    elapsedMs: reranked.elapsedMs,
    projectionMetadata: projection.metadata,
    totalCodePoints: projection.totalCodePoints,
  };
}
