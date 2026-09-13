import { getCanonicalMemoriesByIds } from "../../canonical/read-adapter.js";
import {
  CANONICAL_RERANK_MAX_CODE_POINTS_PER_CANDIDATE,
  CANONICAL_RERANK_MAX_TOTAL_CODE_POINTS,
  projectCanonicalRerankTexts,
} from "../rerank/canonical-text-projector.js";
import {
  RERANK_MAX_CANDIDATES,
  RERANK_MAX_DEADLINE_MS,
  RERANK_STATUS,
} from "../rerank/relevance-reranker.js";
import {
  CANONICAL_RERANK_PROJECTION_ERROR,
  rerankCanonicalMemories,
} from "../rerank/canonical-rerank-orchestrator.js";
import { projectHybridResultFromCanonical } from "./canonical-result.js";

export const EXPLICIT_SEARCH_RERANK_PROFILE_ID = "q3_explicit_search_bounded_rerank_v1";
export const MEMORY_EXPLICIT_RERANK_CONFIG_INVALID = "MEMORY_EXPLICIT_RERANK_CONFIG_INVALID";
export const MEMORY_EXPLICIT_RERANK_CANONICAL_READ_FAILED = "MEMORY_EXPLICIT_RERANK_CANONICAL_READ_FAILED";
export const MEMORY_EXPLICIT_RERANK_PROJECTION_REJECTED = "MEMORY_EXPLICIT_RERANK_PROJECTION_REJECTED";

const UNKNOWN_ADAPTER_IDENTITY = Object.freeze({
  provider: null,
  model: null,
  revision: null,
});

const CANONICAL_PROJECTION_FAILURE_REASONS = [
  "core_not_found",
  "core_ambiguous",
  "core_malformed",
  "engine_ambiguous",
  "engine_malformed",
  "invalid_db_topology",
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nowMs() {
  return typeof performance?.now === "function" ? performance.now() : Date.now();
}

function elapsedMs(startedAt) {
  return Math.max(0, Math.round(nowMs() - startedAt));
}

function configError(reason) {
  const error = new TypeError(MEMORY_EXPLICIT_RERANK_CONFIG_INVALID);
  error.code = MEMORY_EXPLICIT_RERANK_CONFIG_INVALID;
  error.reason = reason;
  return error;
}

function requireOwn(policy, field) {
  if (!Object.hasOwn(policy, field)) throw configError(`missing_${field}`);
  return policy[field];
}

function validateAdapterIdentity(value) {
  if (!isRecord(value)) throw configError("adapter_identity_must_be_record");
  if (typeof value.provider !== "string" || value.provider.trim().length === 0) {
    throw configError("adapter_identity_provider_must_be_nonempty_string");
  }
  if (typeof value.model !== "string" || value.model.trim().length === 0) {
    throw configError("adapter_identity_model_must_be_nonempty_string");
  }
  if (value.revision !== null && typeof value.revision !== "string") {
    throw configError("adapter_identity_revision_must_be_string_or_null");
  }
  return {
    provider: value.provider,
    model: value.model,
    revision: value.revision,
  };
}

/**
 * Normalize only trusted runtime policy. This function intentionally has no
 * production defaults: an enabled policy must provide its complete shape.
 */
export function normalizeExplicitSearchRerankPolicy(policy, topK) {
  if (policy === undefined || policy === null) return null;
  if (!isRecord(policy)) throw configError("policy_must_be_record");
  if (policy.enabled === false) return null;
  if (policy.enabled !== true) throw configError("enabled_must_be_boolean_true_or_false");
  if (policy.mode !== "control" && policy.mode !== "rerank") {
    throw configError("mode_must_be_control_or_rerank");
  }
  if (!Number.isSafeInteger(topK) || topK < 1) throw configError("top_k_is_invalid");

  const candidateDepth = requireOwn(policy, "candidateDepth");
  if (
    !Number.isSafeInteger(candidateDepth)
    || candidateDepth < topK
    || candidateDepth > RERANK_MAX_CANDIDATES
  ) {
    throw configError("candidate_depth_must_be_integer_between_top_k_and_50");
  }

  const maxCodePointsPerCandidate = requireOwn(policy, "maxCodePointsPerCandidate");
  if (
    !Number.isSafeInteger(maxCodePointsPerCandidate)
    || maxCodePointsPerCandidate <= 0
    || maxCodePointsPerCandidate > CANONICAL_RERANK_MAX_CODE_POINTS_PER_CANDIDATE
  ) {
    throw configError("max_code_points_per_candidate_is_invalid");
  }

  const maxTotalCodePoints = requireOwn(policy, "maxTotalCodePoints");
  if (
    !Number.isSafeInteger(maxTotalCodePoints)
    || maxTotalCodePoints <= 0
    || maxTotalCodePoints > CANONICAL_RERANK_MAX_TOTAL_CODE_POINTS
  ) {
    throw configError("max_total_code_points_is_invalid");
  }

  const deadlineMs = requireOwn(policy, "deadlineMs");
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > RERANK_MAX_DEADLINE_MS) {
    throw configError("deadline_ms_is_invalid");
  }

  const adapterIdentity = validateAdapterIdentity(requireOwn(policy, "adapterIdentity"));
  const adapter = requireOwn(policy, "adapter");
  if (typeof adapter !== "function") throw configError("adapter_must_be_function");

  return Object.freeze({
    profile: EXPLICIT_SEARCH_RERANK_PROFILE_ID,
    mode: policy.mode,
    candidateDepth,
    maxCodePointsPerCandidate,
    maxTotalCodePoints,
    deadlineMs,
    adapterIdentity: Object.freeze(adapterIdentity),
    adapter,
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
    memory.source?.record_type !== "chunk"
    || memory.source?.record_id !== memory.memory_id
    || typeof memory.source?.text !== "string"
  ) return "canonical_source_invalid";

  const lifecycle = memory.lifecycle;
  if (!isRecord(lifecycle)) return "canonical_lifecycle_invalid";
  if (lifecycle.management === "managed" && lifecycle.archived !== false) {
    return "canonical_archived";
  }
  if (lifecycle.management === "external" && lifecycle.archived !== null) {
    return "canonical_lifecycle_invalid";
  }
  if (lifecycle.management !== "managed" && lifecycle.management !== "external") {
    return "canonical_lifecycle_invalid";
  }
  return null;
}

function finalProjectionSummary(count) {
  return {
    attempted: true,
    requested_count: count,
    resolved_count: count,
    dropped_count: 0,
    dropped_reasons: Object.fromEntries(CANONICAL_PROJECTION_FAILURE_REASONS.map(reason => [reason, 0])),
    category_mismatch_count: 0,
    path_mismatch_count: 0,
    management_mismatch_count: 0,
  };
}

function isUnknownAdapterIdentity(identity) {
  return isRecord(identity)
    && Object.keys(identity).length === 3
    && identity.provider === null
    && identity.model === null
    && identity.revision === null;
}

function observedAdapterIdentity(identity) {
  return normalizeObservedAdapterIdentity(identity).identity;
}

function normalizeObservedAdapterIdentity(identity) {
  if (identity === undefined || identity === null || isUnknownAdapterIdentity(identity)) {
    return {
      present: false,
      valid: true,
      identity: null,
    };
  }
  if (!isRecord(identity)) {
    return {
      present: true,
      valid: false,
      identity: {
        provider: null,
        model: null,
        revision: null,
      },
    };
  }

  const bounded = {
    provider: typeof identity.provider === "string" ? identity.provider : null,
    model: typeof identity.model === "string" ? identity.model : null,
    revision: identity.revision === null || typeof identity.revision === "string"
      ? identity.revision
      : null,
  };
  return {
    present: true,
    valid: Object.hasOwn(identity, "provider")
      && Object.hasOwn(identity, "model")
      && Object.hasOwn(identity, "revision")
      && typeof bounded.provider === "string"
      && bounded.provider.trim().length > 0
      && typeof bounded.model === "string"
      && bounded.model.trim().length > 0
      && (bounded.revision === null || typeof bounded.revision === "string"),
    identity: bounded,
  };
}

function adapterIdentityMatches(configured, observed) {
  if (!observed.present) return true;
  return observed.valid
    && observed.identity.provider === configured.provider
    && observed.identity.model === configured.model
    && observed.identity.revision === configured.revision;
}

function controlResult(ids, reason, {
  status = RERANK_STATUS.BYPASSED,
  usage = null,
  adapterIdentity = UNKNOWN_ADAPTER_IDENTITY,
  elapsed = 0,
} = {}) {
  return {
    orderedIds: ids,
    status,
    reason,
    scores: Object.fromEntries(ids.map(id => [id, null])),
    usage,
    adapterIdentity,
    elapsedMs: elapsed,
  };
}

function debugFor(profile, {
  boundedCandidateCount,
  eligibleCandidateCount,
  canonicalResolvedCount,
  canonicalValidCount,
  canonicalExcludedCount,
  excludedReasons,
  topK,
  servedCount,
  topKTruncationCount,
  rerank,
  timings,
}) {
  return {
    profile: EXPLICIT_SEARCH_RERANK_PROFILE_ID,
    mode: profile.mode,
    limits: {
      candidate_depth: profile.candidateDepth,
      max_code_points_per_candidate: profile.maxCodePointsPerCandidate,
      max_total_code_points: profile.maxTotalCodePoints,
      deadline_ms: profile.deadlineMs,
    },
    canonical_pool: {
      bounded_candidate_count: boundedCandidateCount,
      eligible_candidate_count: eligibleCandidateCount,
      requested_count: eligibleCandidateCount,
      resolved_count: canonicalResolvedCount,
      valid_count: canonicalValidCount,
      excluded_count: canonicalExcludedCount,
      excluded_reasons: { ...excludedReasons },
    },
    final_serving: {
      top_k: topK,
      served_count: servedCount,
      top_k_truncation_count: topKTruncationCount,
    },
    rerank: {
      status: rerank.status,
      reason: rerank.reason,
      configured_adapter_identity: profile.adapterIdentity,
      observed_adapter_identity: observedAdapterIdentity(rerank.adapterIdentity),
      usage: rerank.usage,
      score_state: rerank.status === RERANK_STATUS.APPLIED
        ? "mapped"
        : rerank.status === RERANK_STATUS.FALLBACK || rerank.status === RERANK_STATUS.BYPASSED
          ? "all_null"
          : "not_available",
    },
    timings: {
      canonical_read_elapsed_ms: timings.canonicalReadElapsedMs,
      projection_elapsed_ms: timings.projectionElapsedMs,
      rerank_elapsed_ms: timings.rerankElapsedMs,
      total_profile_elapsed_ms: timings.totalProfileElapsedMs,
    },
  };
}

function errorDebug(profile, counts, rerank, timings) {
  return debugFor(profile, {
    ...counts,
    topK: counts.topK,
    servedCount: 0,
    topKTruncationCount: 0,
    rerank,
    timings,
  });
}

function projectionRejectedResult(profile, {
  boundedCandidateCount,
  eligibleCandidateCount,
  canonicalResolvedCount,
  canonicalValidCount,
  canonicalExcludedCount,
  excludedReasons,
  topK,
  canonicalReadElapsedMs,
  projectionElapsedMs,
  profileStartedAt,
}) {
  const rerank = controlResult([], "projection_rejected");
  return {
    ok: false,
    error: MEMORY_EXPLICIT_RERANK_PROJECTION_REJECTED,
    code: MEMORY_EXPLICIT_RERANK_PROJECTION_REJECTED,
    results: [],
    debug: errorDebug(profile, {
      boundedCandidateCount,
      eligibleCandidateCount,
      canonicalResolvedCount,
      canonicalValidCount,
      canonicalExcludedCount,
      excludedReasons,
      topK,
    }, {
      ...rerank,
      status: "not_attempted",
      reason: "projection_rejected",
    }, {
      canonicalReadElapsedMs,
      projectionElapsedMs,
      rerankElapsedMs: 0,
      totalProfileElapsedMs: elapsedMs(profileStartedAt),
    }),
    canonicalProjection: null,
  };
}

function projectResults(orderedIds, itemById, memoryById) {
  return orderedIds.map(id => projectHybridResultFromCanonical(
    itemById.get(id),
    memoryById.get(id),
  ));
}

/**
 * Serve the explicit-search-only R3 profile after existing Hybrid fusion.
 * The caller supplies trusted, normalized policy and isolated DB accessors.
 */
export async function executeExplicitSearchRerankProfile({
  query,
  fusedSorted,
  topK,
  profile,
  withCoreDb,
  withEngineDb,
} = {}) {
  const profileStartedAt = nowMs();
  const boundedPool = fusedSorted.slice(0, profile.candidateDepth);
  const eligiblePool = boundedPool;
  const excludedReasons = createExclusionReasons();
  const canonicalReadStartedAt = nowMs();
  const batch = getCanonicalMemoriesByIds(
    eligiblePool.map(item => item.id),
    { withCoreDb, withEngineDb },
  );
  const canonicalReadElapsedMs = elapsedMs(canonicalReadStartedAt);

  if (!batch.ok) {
    for (let index = 0; index < eligiblePool.length; index += 1) {
      recordExclusion(excludedReasons, batch.reason || "canonical_read_failure");
    }
    const rerank = controlResult([], "canonical_read_failed");
    const debug = errorDebug(profile, {
      boundedCandidateCount: boundedPool.length,
      eligibleCandidateCount: eligiblePool.length,
      canonicalResolvedCount: 0,
      canonicalValidCount: 0,
      canonicalExcludedCount: eligiblePool.length,
      excludedReasons,
      topK,
    }, {
      ...rerank,
      status: "not_attempted",
      reason: "canonical_read_failed",
    }, {
      canonicalReadElapsedMs,
      projectionElapsedMs: 0,
      rerankElapsedMs: 0,
      totalProfileElapsedMs: elapsedMs(profileStartedAt),
    });
    return {
      ok: false,
      error: MEMORY_EXPLICIT_RERANK_CANONICAL_READ_FAILED,
      code: MEMORY_EXPLICIT_RERANK_CANONICAL_READ_FAILED,
      results: [],
      debug,
      canonicalProjection: null,
    };
  }

  const valid = [];
  let canonicalResolvedCount = 0;
  let canonicalExcludedCount = 0;
  for (const [index, item] of eligiblePool.entries()) {
    const resolved = batch.results[index];
    if (resolved?.ok && resolved.memory) canonicalResolvedCount += 1;
    const invalidReason = canonicalValidity(item, resolved);
    if (invalidReason) {
      canonicalExcludedCount += 1;
      recordExclusion(excludedReasons, invalidReason);
      continue;
    }
    valid.push({ item, memory: resolved.memory });
  }

  const validIds = valid.map(entry => entry.memory.memory_id);
  let reranked;
  let projectionElapsedMs = 0;
  if (profile.mode === "control") {
    const projectionStartedAt = nowMs();
    try {
      projectCanonicalRerankTexts({
        memories: valid.map(entry => entry.memory),
        maxCodePointsPerCandidate: profile.maxCodePointsPerCandidate,
        maxTotalCodePoints: profile.maxTotalCodePoints,
      });
    } catch {
      return projectionRejectedResult(profile, {
        boundedCandidateCount: boundedPool.length,
        eligibleCandidateCount: eligiblePool.length,
        canonicalResolvedCount,
        canonicalValidCount: valid.length,
        canonicalExcludedCount,
        excludedReasons,
        topK,
        canonicalReadElapsedMs,
        projectionElapsedMs: elapsedMs(projectionStartedAt),
        profileStartedAt,
      });
    }
    projectionElapsedMs = elapsedMs(projectionStartedAt);
    reranked = controlResult(validIds, "control_mode");
  } else {
    const rerankStartedAt = nowMs();
    try {
      reranked = await rerankCanonicalMemories({
        query,
        memories: valid.map(entry => entry.memory),
        maxCodePointsPerCandidate: profile.maxCodePointsPerCandidate,
        maxTotalCodePoints: profile.maxTotalCodePoints,
        deadlineMs: profile.deadlineMs,
        adapter: profile.adapter,
      });
      projectionElapsedMs = Number.isFinite(reranked.projectionElapsedMs)
        ? reranked.projectionElapsedMs
        : 0;
    } catch (error) {
      if (error?.code === CANONICAL_RERANK_PROJECTION_ERROR) {
        return projectionRejectedResult(profile, {
          boundedCandidateCount: boundedPool.length,
          eligibleCandidateCount: eligiblePool.length,
          canonicalResolvedCount,
          canonicalValidCount: valid.length,
          canonicalExcludedCount,
          excludedReasons,
          topK,
          canonicalReadElapsedMs,
          projectionElapsedMs: Number.isFinite(error.projectionElapsedMs)
            ? error.projectionElapsedMs
            : 0,
          profileStartedAt,
        });
      }
      reranked = controlResult(validIds, "adapter_error", {
        status: RERANK_STATUS.FALLBACK,
      });
    }
    const observed = normalizeObservedAdapterIdentity(reranked.adapterIdentity);
    reranked = {
      ...reranked,
      adapterIdentity: observed.identity || UNKNOWN_ADAPTER_IDENTITY,
    };
    if (!adapterIdentityMatches(profile.adapterIdentity, observed)) {
      reranked = controlResult(validIds, "adapter_identity_conflict", {
        status: RERANK_STATUS.FALLBACK,
        usage: reranked.usage,
        adapterIdentity: observed.identity || UNKNOWN_ADAPTER_IDENTITY,
        elapsed: reranked.elapsedMs || elapsedMs(rerankStartedAt),
      });
    } else if (reranked.status === RERANK_STATUS.FALLBACK) {
      reranked = controlResult(validIds, reranked.reason, {
        status: RERANK_STATUS.FALLBACK,
        usage: reranked.usage,
        adapterIdentity: reranked.adapterIdentity,
        elapsed: reranked.elapsedMs,
      });
    }
  }

  const itemById = new Map(valid.map(entry => [entry.memory.memory_id, entry.item]));
  const memoryById = new Map(valid.map(entry => [entry.memory.memory_id, entry.memory]));
  const selectedIds = reranked.orderedIds.slice(0, topK);
  const results = projectResults(selectedIds, itemById, memoryById);
  const topKTruncationCount = Math.max(0, valid.length - selectedIds.length);
  const debug = debugFor(profile, {
    boundedCandidateCount: boundedPool.length,
    eligibleCandidateCount: eligiblePool.length,
    canonicalResolvedCount,
    canonicalValidCount: valid.length,
    canonicalExcludedCount,
    excludedReasons,
    topK,
    servedCount: results.length,
    topKTruncationCount,
    rerank: reranked,
    timings: {
      canonicalReadElapsedMs,
      projectionElapsedMs,
      rerankElapsedMs: reranked.elapsedMs,
      totalProfileElapsedMs: elapsedMs(profileStartedAt),
    },
  });

  return {
    ok: true,
    results,
    debug,
    canonicalProjection: finalProjectionSummary(results.length),
  };
}
