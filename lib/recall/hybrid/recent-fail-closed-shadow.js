function candidateId(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return candidateId(value.id ?? value.chunk_id);
  const id = String(value).trim();
  return id ? id : null;
}

function uniqueCandidateIds(rows = []) {
  const ids = [];
  const seen = new Set();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const id = candidateId(row);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function resolveRisk(context = {}, droppedIds = []) {
  const archivedIds = uniqueCandidateIds(context.archived_candidate_ids);
  const archivedSet = new Set(archivedIds);
  if (droppedIds.some(id => archivedSet.has(id))) return "high";
  if (context.metadata_merge_mismatch === true) return "medium";
  return "low";
}

export function evaluateRecentFailClosedShadow({
  isolatedResult = [],
  fallbackResult = [],
  context = {},
} = {}) {
  const isolatedIds = uniqueCandidateIds(isolatedResult);
  const fallbackIds = uniqueCandidateIds(fallbackResult);
  const isolatedSet = new Set(isolatedIds);
  const overlapCount = fallbackIds.filter(id => isolatedSet.has(id)).length;
  const droppedIds = fallbackIds.filter(id => !isolatedSet.has(id));
  const fallbackOnlyCount = droppedIds.length;
  const candidateLossRatio = round3(fallbackOnlyCount / Math.max(fallbackIds.length, 1));

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
      fallback_only_count: fallbackOnlyCount,
    },
    risk: {
      would_change_result: fallbackOnlyCount > 0,
      candidate_loss_ratio: candidateLossRatio,
      recent_specific_risk: resolveRisk(context, droppedIds),
    },
  };
}
