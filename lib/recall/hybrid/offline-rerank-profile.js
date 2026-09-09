import { getCanonicalMemoriesByIds } from "../../canonical/read-adapter.js";
import {
  CANONICAL_RERANK_MAX_CODE_POINTS_PER_CANDIDATE,
  CANONICAL_RERANK_MAX_TOTAL_CODE_POINTS,
  projectCanonicalRerankTexts,
} from "../rerank/canonical-text-projector.js";
import { rerankCanonicalMemories } from "../rerank/canonical-rerank-orchestrator.js";
import {
  RERANK_MAX_CANDIDATES,
  RERANK_MAX_DEADLINE_MS,
  RERANK_STATUS,
} from "../rerank/relevance-reranker.js";
import { projectHybridResultFromCanonical } from "./canonical-result.js";

export const OFFLINE_HYBRID_RERANK_PROFILE_ID = "q3_offline_canonical_rerank_v1";

const UNKNOWN_ADAPTER_IDENTITY = Object.freeze({
  provider: null,
  model: null,
  revision: null,
});

function profileError(reason) {
  throw new TypeError(`offline_hybrid_rerank_${reason}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateOfflineHybridRerankProfile(profile, topK) {
  if (!isRecord(profile)) profileError("profile_must_be_record");
  if (!Number.isSafeInteger(topK) || topK < 0) profileError("top_k_must_be_safe_integer");
  if (
    !Number.isSafeInteger(profile.candidateDepth) ||
    profile.candidateDepth < topK ||
    profile.candidateDepth > RERANK_MAX_CANDIDATES
  ) {
    profileError("candidate_depth_must_be_integer_between_top_k_and_50");
  }
  if (
    !Number.isSafeInteger(profile.maxCodePointsPerCandidate) ||
    profile.maxCodePointsPerCandidate <= 0 ||
    profile.maxCodePointsPerCandidate > CANONICAL_RERANK_MAX_CODE_POINTS_PER_CANDIDATE
  ) {
    profileError("max_code_points_per_candidate_is_invalid");
  }
  if (
    !Number.isSafeInteger(profile.maxTotalCodePoints) ||
    profile.maxTotalCodePoints <= 0 ||
    profile.maxTotalCodePoints > CANONICAL_RERANK_MAX_TOTAL_CODE_POINTS
  ) {
    profileError("max_total_code_points_is_invalid");
  }
  if (
    !Number.isFinite(profile.deadlineMs) ||
    profile.deadlineMs <= 0 ||
    profile.deadlineMs > RERANK_MAX_DEADLINE_MS
  ) {
    profileError("deadline_ms_is_invalid");
  }
  if (typeof profile.executeRerank !== "boolean") profileError("execute_rerank_must_be_boolean");
  if (typeof profile.adapter !== "function") profileError("adapter_must_be_function");

  return Object.freeze({
    candidateDepth: profile.candidateDepth,
    maxCodePointsPerCandidate: profile.maxCodePointsPerCandidate,
    maxTotalCodePoints: profile.maxTotalCodePoints,
    deadlineMs: profile.deadlineMs,
    executeRerank: profile.executeRerank,
    adapter: profile.adapter,
  });
}

function createExclusionReasons() {
  return {};
}

function recordExclusion(reasons, reason) {
  reasons[reason] = (reasons[reason] || 0) + 1;
}

function canonicalValidity(item, resolved) {
  if (!resolved?.ok || !resolved.memory) return resolved?.reason || "canonical_invalid";
  const memory = resolved.memory;
  if (memory.memory_id !== item.id) return "canonical_identity_mismatch";
  if (
    memory.source?.record_type !== "chunk" ||
    memory.source?.record_id !== memory.memory_id ||
    typeof memory.source?.text !== "string"
  ) return "canonical_source_invalid";
  if (memory.lifecycle?.management === "managed" && memory.lifecycle.archived !== false) {
    return "canonical_archived";
  }
  return null;
}

function controlRerankResult(ids) {
  const scores = {};
  for (const id of ids) scores[id] = null;
  return {
    orderedIds: ids,
    status: RERANK_STATUS.BYPASSED,
    reason: "profile_rerank_disabled",
    scores,
    usage: null,
    adapterIdentity: UNKNOWN_ADAPTER_IDENTITY,
    elapsedMs: 0,
  };
}

function canonicalProjectionSummary(requestedCount, resolvedCount, droppedCount = 0) {
  return {
    attempted: true,
    requested_count: requestedCount,
    resolved_count: resolvedCount,
    dropped_count: droppedCount,
    dropped_reasons: {
      core_not_found: 0,
      core_ambiguous: 0,
      core_malformed: 0,
      engine_ambiguous: 0,
      engine_malformed: 0,
      invalid_db_topology: 0,
    },
    category_mismatch_count: 0,
    path_mismatch_count: 0,
    management_mismatch_count: 0,
  };
}

function profileDebug(profile, validCount, excludedCount, excludedReasons, reranked) {
  return {
    profile: OFFLINE_HYBRID_RERANK_PROFILE_ID,
    candidate_depth: profile.candidateDepth,
    valid_candidate_count: validCount,
    excluded_count: excludedCount,
    excluded_reasons: excludedReasons,
    rerank_status: reranked.status,
    rerank_reason: reranked.reason,
    scores: reranked.scores,
    usage: reranked.usage,
    adapter_identity: reranked.adapterIdentity,
    rerank_elapsed_ms: reranked.elapsedMs,
  };
}

/**
 * Run the bounded offline profile after Hybrid fusion. The caller supplies
 * already scoped DB accessors; channel collection has applied the existing
 * Hybrid eligibility filter before fusion.
 */
export async function executeOfflineHybridRerankProfile({
  query,
  fusedSorted,
  topK,
  profile,
  withCoreDb,
  withEngineDb,
} = {}) {
  const selectedPool = fusedSorted.slice(0, profile.candidateDepth);
  const excludedReasons = createExclusionReasons();
  // Every channel applies the existing filterForRerank before fusion. Fused
  // items intentionally do not carry raw is_archived, so do not re-run that
  // filter here and accidentally reject eligible managed candidates.
  const eligibleItems = selectedPool;

  const batch = getCanonicalMemoriesByIds(
    eligibleItems.map(item => item.id),
    { withCoreDb, withEngineDb },
  );
  if (!batch.ok) {
    for (let index = 0; index < eligibleItems.length; index += 1) {
      recordExclusion(excludedReasons, batch.reason || "canonical_read_failure");
    }
    const control = {
      ...controlRerankResult([]),
      reason: "canonical_read_failure",
    };
    return {
      ok: false,
      results: [],
      canonicalProjection: canonicalProjectionSummary(eligibleItems.length, 0, eligibleItems.length),
      debug: profileDebug(profile, 0, selectedPool.length, excludedReasons, control),
      projectionMetadata: [],
      totalCodePoints: 0,
      canonicalReadFailure: batch.reason || "canonical_read_failure",
    };
  }

  const valid = [];
  for (const [index, item] of eligibleItems.entries()) {
    const resolved = batch.results[index];
    const invalidReason = canonicalValidity(item, resolved);
    if (invalidReason) {
      recordExclusion(excludedReasons, invalidReason);
      continue;
    }
    valid.push({ item, memory: resolved.memory });
  }

  const validMemories = valid.map(entry => entry.memory);
  let projectionMetadata;
  let totalCodePoints;
  let reranked;
  if (profile.executeRerank) {
    reranked = await rerankCanonicalMemories({
      query,
      memories: validMemories,
      maxCodePointsPerCandidate: profile.maxCodePointsPerCandidate,
      maxTotalCodePoints: profile.maxTotalCodePoints,
      deadlineMs: profile.deadlineMs,
      adapter: profile.adapter,
    });
    projectionMetadata = reranked.projectionMetadata;
    totalCodePoints = reranked.totalCodePoints;
  } else {
    const projection = projectCanonicalRerankTexts({
      memories: validMemories,
      maxCodePointsPerCandidate: profile.maxCodePointsPerCandidate,
      maxTotalCodePoints: profile.maxTotalCodePoints,
    });
    projectionMetadata = projection.metadata;
    totalCodePoints = projection.totalCodePoints;
    reranked = controlRerankResult(valid.map(entry => entry.memory.memory_id));
  }

  const itemById = new Map(valid.map(entry => [entry.memory.memory_id, entry.item]));
  const memoryById = new Map(valid.map(entry => [entry.memory.memory_id, entry.memory]));
  const selectedIds = reranked.orderedIds.slice(0, topK);
  const results = selectedIds.map(id => projectHybridResultFromCanonical(
    itemById.get(id),
    memoryById.get(id),
  ));

  return {
    ok: true,
    results,
    canonicalProjection: canonicalProjectionSummary(valid.length, results.length),
    debug: profileDebug(
      profile,
      valid.length,
      selectedPool.length - valid.length,
      excludedReasons,
      reranked,
    ),
    projectionMetadata,
    totalCodePoints,
    canonicalReadFailure: null,
  };
}
