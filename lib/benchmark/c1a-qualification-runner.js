import { createHash } from "node:crypto";

import { rerankCandidates, RERANK_STATUS } from "../recall/rerank/relevance-reranker.js";
import {
  preflightSiliconFlowRerankInput,
  qwen3Utf8ByteTokenUpperBound,
} from "../recall/rerank/siliconflow-rerank-adapter.js";

export const C1A_MAX_PROVIDER_REQUESTS = 328;
export const C1A_MAX_INPUT_TOKENS = 6_000_000;
export const C1A_ADAPTER_DEADLINE_MS = 2500;

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function usageInputTokens(usage) {
  const value = usage?.input_tokens ?? usage?.billed_input_tokens;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function createC1AExecutionBudget({
  maxRequests = C1A_MAX_PROVIDER_REQUESTS,
  maxInputTokens = C1A_MAX_INPUT_TOKENS,
  maxCostUsd = null,
  inputPriceUsdPerMillion = null,
} = {}) {
  if ((maxCostUsd === null) !== (inputPriceUsdPerMillion === null)) {
    throw fail("C1A_COST_BUDGET_CONFIGURATION_INCOMPLETE");
  }
  if (maxCostUsd !== null && (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0)) {
    throw fail("C1A_COST_BUDGET_INVALID");
  }
  if (inputPriceUsdPerMillion !== null
      && (!Number.isFinite(inputPriceUsdPerMillion) || inputPriceUsdPerMillion < 0)) {
    throw fail("C1A_INPUT_PRICE_INVALID");
  }
  let requests = 0;
  let nextReservationId = 1;
  let estimatedInputTokens = 0;
  let reportedInputTokens = 0;
  let accountedInputTokens = 0;
  let conservativeRetainedInputTokens = 0;
  const reservations = new Map();

  function costFor(tokens) {
    return maxCostUsd === null ? null : (tokens / 1_000_000) * inputPriceUsdPerMillion;
  }

  return Object.freeze({
    reserve(estimatedTokens) {
      if (!Number.isSafeInteger(estimatedTokens) || estimatedTokens < 0) {
        throw fail("C1A_ESTIMATED_TOKEN_COUNT_INVALID");
      }
      if (requests + 1 > maxRequests) throw fail("C1A_REQUEST_BUDGET_EXCEEDED");
      const nextAccountedTokens = accountedInputTokens + estimatedTokens;
      if (nextAccountedTokens > maxInputTokens) throw fail("C1A_INPUT_TOKEN_BUDGET_EXCEEDED");
      if (maxCostUsd !== null && costFor(nextAccountedTokens) > maxCostUsd) {
        throw fail("C1A_COST_BUDGET_EXCEEDED");
      }
      const id = nextReservationId;
      nextReservationId += 1;
      requests += 1;
      estimatedInputTokens += estimatedTokens;
      accountedInputTokens = nextAccountedTokens;
      reservations.set(id, { estimatedTokens, settled: false });
      return Object.freeze({ id, estimated_input_tokens: estimatedTokens });
    },
    settle(reservation, usage) {
      const id = reservation?.id;
      const current = reservations.get(id);
      if (!Number.isSafeInteger(id) || !current) throw fail("C1A_RESERVATION_INVALID");
      if (current.settled) throw fail("C1A_RESERVATION_ALREADY_SETTLED");
      const inputTokens = usageInputTokens(usage);
      if (inputTokens === null) {
        current.settled = true;
        conservativeRetainedInputTokens += current.estimatedTokens;
        return Object.freeze({
          source: "conservative_upper_bound",
          accounted_input_tokens: current.estimatedTokens,
        });
      }

      const nextAccountedTokens = accountedInputTokens - current.estimatedTokens + inputTokens;
      if (nextAccountedTokens > maxInputTokens) {
        throw fail("C1A_REPORTED_INPUT_TOKEN_BUDGET_EXCEEDED");
      }
      if (maxCostUsd !== null && costFor(nextAccountedTokens) > maxCostUsd) {
        throw fail("C1A_REPORTED_COST_BUDGET_EXCEEDED");
      }
      current.settled = true;
      reportedInputTokens += inputTokens;
      accountedInputTokens = nextAccountedTokens;
      return Object.freeze({
        source: "provider_reported",
        accounted_input_tokens: inputTokens,
      });
    },
    snapshot() {
      const unsettledReservationCount = [...reservations.values()].filter(item => !item.settled).length;
      return {
        requests,
        estimated_input_tokens: estimatedInputTokens,
        reported_input_tokens: reportedInputTokens,
        accounted_input_tokens: accountedInputTokens,
        conservative_retained_input_tokens: conservativeRetainedInputTokens,
        unsettled_reservation_count: unsettledReservationCount,
        max_requests: maxRequests,
        max_input_tokens: maxInputTokens,
        estimated_cost_usd: costFor(estimatedInputTokens),
        reported_cost_usd: costFor(reportedInputTokens),
        accounted_cost_usd: costFor(accountedInputTokens),
        max_cost_usd: maxCostUsd,
        input_price_usd_per_million: inputPriceUsdPerMillion,
      };
    },
  });
}

function validatePool(candidates, controlOrder) {
  if (!Array.isArray(candidates)) throw fail("C1A_CANDIDATES_MUST_BE_ARRAY");
  const ids = candidates.map(candidate => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw fail("C1A_CANDIDATE_INVALID");
    if (typeof candidate.id !== "string" || candidate.id.length === 0) throw fail("C1A_CANDIDATE_ID_INVALID");
    if (typeof candidate.text !== "string") throw fail("C1A_CANDIDATE_TEXT_INVALID");
    return candidate.id;
  });
  if (new Set(ids).size !== ids.length) throw fail("C1A_CANDIDATE_ID_DUPLICATE");
  if (!Array.isArray(controlOrder) || controlOrder.length !== ids.length) throw fail("C1A_CONTROL_ORDER_INVALID");
  if (controlOrder.some((id, index) => id !== ids[index])) throw fail("C1A_CONTROL_ORDER_POOL_MISMATCH");
  return ids;
}

export function preflightC1AQualificationCase({
  query,
  candidates,
  controlOrder,
  queryEgress,
  candidateEgress = {},
  tokenCounter = qwen3Utf8ByteTokenUpperBound,
} = {}) {
  if (typeof query !== "string" || query.trim().length === 0) throw fail("C1A_QUERY_REQUIRED");
  validatePool(candidates, controlOrder);
  if (typeof tokenCounter !== "function") throw fail("C1A_TOKEN_COUNTER_REQUIRED");

  if (queryEgress !== "ALLOW") {
    return Object.freeze({
      eligible: false,
      reason: "query_egress_not_allowed",
      estimated_request_tokens: 0,
      nonempty_candidate_count: 0,
    });
  }

  const nonEmpty = candidates.filter(candidate => candidate.text.length > 0);
  if (nonEmpty.length === 0) {
    return Object.freeze({
      eligible: false,
      reason: "all_text_empty",
      estimated_request_tokens: 0,
      nonempty_candidate_count: 0,
    });
  }

  if (nonEmpty.some(candidate => candidateEgress[candidate.id] !== "ALLOW")) {
    return Object.freeze({
      eligible: false,
      reason: "candidate_egress_not_allowed",
      estimated_request_tokens: 0,
      nonempty_candidate_count: nonEmpty.length,
    });
  }

  try {
    const tokenPreflight = preflightSiliconFlowRerankInput({
      query,
      documents: nonEmpty.map(candidate => candidate.text),
      tokenCounter,
    });
    return Object.freeze({
      eligible: true,
      reason: null,
      estimated_request_tokens: tokenPreflight.estimatedRequestTokens,
      nonempty_candidate_count: nonEmpty.length,
    });
  } catch {
    return Object.freeze({
      eligible: false,
      reason: "provider_budget_rejected",
      estimated_request_tokens: 0,
      nonempty_candidate_count: nonEmpty.length,
    });
  }
}

function boundedEvidence({ caseId, status, reason, orderedIds, topK, eligible, attempted, usage = null, elapsedMs = 0, adapterIdentity = null }) {
  return {
    case_id: caseId,
    status,
    provider_status: status,
    reason,
    eligible,
    attempted,
    structurally_invalid_response: reason === "invalid_response",
    ordered_ids: [...orderedIds],
    top3_ids: orderedIds.slice(0, topK),
    ordered_ids_sha256: sha256Json(orderedIds),
    usage,
    elapsed_ms: elapsedMs,
    adapter_elapsed_ms: elapsedMs,
    adapter_identity: adapterIdentity,
  };
}

export async function runC1AQualificationCase({
  caseId,
  query,
  candidates,
  controlOrder,
  queryEgress,
  candidateEgress = {},
  adapter,
  tokenCounter = qwen3Utf8ByteTokenUpperBound,
  budget,
  topK = 3,
  deadlineMs = C1A_ADAPTER_DEADLINE_MS,
} = {}) {
  if (typeof caseId !== "string" || caseId.length === 0) throw fail("C1A_CASE_ID_REQUIRED");
  const ids = validatePool(candidates, controlOrder);
  if (!Number.isSafeInteger(topK) || topK < 1 || topK > 50) throw fail("C1A_TOP_K_INVALID");
  if (typeof adapter !== "function") throw fail("C1A_ADAPTER_REQUIRED");
  if (!budget || typeof budget.reserve !== "function" || typeof budget.settle !== "function") {
    throw fail("C1A_EXECUTION_BUDGET_REQUIRED");
  }

  const preflight = preflightC1AQualificationCase({
    query,
    candidates,
    controlOrder,
    queryEgress,
    candidateEgress,
    tokenCounter,
  });
  if (!preflight.eligible) {
    return boundedEvidence({
      caseId,
      status: "bypassed",
      reason: preflight.reason,
      orderedIds: controlOrder,
      topK,
      eligible: false,
      attempted: false,
    });
  }

  const reservation = budget.reserve(preflight.estimated_request_tokens);
  const reranked = await rerankCandidates({
    query,
    candidates,
    deadlineMs,
    adapter,
  });
  budget.settle(reservation, reranked.usage);

  const applied = reranked.status === RERANK_STATUS.APPLIED;
  const orderedIds = applied ? reranked.orderedIds : controlOrder;
  return boundedEvidence({
    caseId,
    status: applied ? "applied" : (reranked.status === RERANK_STATUS.FALLBACK ? "fallback" : "bypassed"),
    reason: reranked.reason,
    orderedIds,
    topK,
    eligible: true,
    attempted: true,
    usage: reranked.usage,
    elapsedMs: reranked.elapsedMs,
    adapterIdentity: reranked.adapterIdentity,
  });
}
