const DEFAULT_KG_SHADOW_THRESHOLDS = Object.freeze({
  max_candidate_loss_ratio: 0.05,
  max_would_fail_closed_rate: 0,
});

function candidateId(candidate) {
  if (candidate === null || candidate === undefined) return null;
  if (typeof candidate === "object") {
    const value = candidate.id ?? candidate.chunk_id;
    return value === null || value === undefined ? null : String(value);
  }
  return String(candidate);
}

function uniqueCandidateIds(candidates) {
  const ids = [];
  const seen = new Set();
  for (const candidate of (Array.isArray(candidates) ? candidates : [])) {
    const id = candidateId(candidate);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function asRatio(value) {
  return Number(Number(value).toFixed(3));
}

export function evaluateKgFailClosedShadow({
  isolatedResult = [],
  fallbackResult = [],
  context: _context = {},
} = {}) {
  const isolatedIds = uniqueCandidateIds(isolatedResult);
  const fallbackIds = uniqueCandidateIds(fallbackResult);
  const isolatedSet = new Set(isolatedIds);
  const droppedIds = fallbackIds.filter(id => !isolatedSet.has(id));
  const overlapCount = fallbackIds.filter(id => isolatedSet.has(id)).length;
  const candidateLossRatio = asRatio(droppedIds.length / Math.max(fallbackIds.length, 1));

  return {
    schema_version: 1,
    decision: {
      mode: "shadow_fail_closed",
    },
    evidence: {
      isolated_candidate_count: isolatedIds.length,
      fallback_candidate_count: fallbackIds.length,
      dropped_candidate_count: droppedIds.length,
      dropped_ids: droppedIds,
      overlap_count: overlapCount,
      fallback_only_count: droppedIds.length,
    },
    risk: {
      would_change_result: droppedIds.length > 0,
      candidate_loss_ratio: candidateLossRatio,
    },
  };
}

export { DEFAULT_KG_SHADOW_THRESHOLDS };
