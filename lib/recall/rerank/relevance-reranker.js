/**
 * Standalone, provider-independent relevance rerank boundary.
 *
 * The adapter receives (query, non-empty candidate texts, AbortSignal) and
 * returns { scores: [{ index, score }], identity?, usage? }. The index is
 * relative to the submitted non-empty texts.
 */

export const RERANK_MAX_CANDIDATES = 50;
export const RERANK_MAX_DEADLINE_MS = 60_000;

export const RERANK_STATUS = Object.freeze({
  APPLIED: "applied",
  BYPASSED: "bypassed",
  FALLBACK: "fallback",
});

export const RERANK_REASON = Object.freeze({
  ALL_TEXT_EMPTY: "all_text_empty",
  ADAPTER_ERROR: "adapter_error",
  COMPLETE: "complete",
  EMPTY_CANDIDATES: "empty_candidates",
  INVALID_RESPONSE: "invalid_response",
  MIXED_EMPTY_TEXT: "mixed_empty_text",
  TIMEOUT: "timeout",
});

const UNKNOWN_ADAPTER_IDENTITY = Object.freeze({
  provider: null,
  model: null,
  revision: null,
});

function nowMs() {
  return typeof performance?.now === "function" ? performance.now() : Date.now();
}

function elapsedMs(startedAt) {
  return Math.max(0, Math.round(nowMs() - startedAt));
}

function validationError(code) {
  return new TypeError(code);
}

function validateInput({ query, candidates, deadlineMs, adapter }) {
  if (typeof query !== "string" || query.trim().length === 0) {
    throw validationError("rerank_query_must_be_nonempty_string");
  }
  if (!Array.isArray(candidates)) {
    throw validationError("rerank_candidates_must_be_array");
  }
  if (candidates.length > RERANK_MAX_CANDIDATES) {
    throw new RangeError("rerank_candidate_count_exceeds_50");
  }
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > RERANK_MAX_DEADLINE_MS) {
    throw new RangeError("rerank_deadline_ms_must_be_positive_and_at_most_60000");
  }
  if (typeof adapter !== "function") {
    throw validationError("rerank_adapter_must_be_function");
  }

  const ids = new Set();
  const normalized = candidates.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw validationError(`rerank_candidate_${index}_must_be_record`);
    }
    if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) {
      throw validationError(`rerank_candidate_${index}_id_must_be_nonempty_string`);
    }
    if (ids.has(candidate.id)) {
      throw validationError("rerank_candidate_ids_must_be_unique");
    }
    ids.add(candidate.id);
    if (typeof candidate.text !== "string") {
      throw validationError(`rerank_candidate_${index}_text_must_be_string`);
    }
    return { id: candidate.id, text: candidate.text, index };
  });

  return normalized;
}

function identityFrom(adapter, response = null) {
  const observed = response?.adapterIdentity
    ?? response?.identity
    ?? adapter.adapterIdentity
    ?? adapter.identity;
  if (observed === undefined || observed === null) return UNKNOWN_ADAPTER_IDENTITY;
  return observed;
}

function scoresById(candidates, scoredByIndex = new Map()) {
  const scores = {};
  for (const candidate of candidates) {
    const score = scoredByIndex.get(candidate.index);
    Object.defineProperty(scores, candidate.id, {
      configurable: true,
      enumerable: true,
      value: score === undefined ? null : score,
      writable: true,
    });
  }
  return scores;
}

function boundedAdapterErrorCode(value) {
  return typeof value === "string" && /^[A-Z0-9_]{1,96}$/u.test(value)
    ? value
    : null;
}

function resultFor({
  candidates,
  status,
  reason,
  startedAt,
  adapterIdentity,
  usage = null,
  adapterErrorCode = null,
  scoredByIndex,
}) {
  return {
    orderedIds: candidates.map(candidate => candidate.id),
    status,
    reason,
    scores: scoresById(candidates, scoredByIndex),
    elapsedMs: elapsedMs(startedAt),
    adapterIdentity,
    usage,
    adapterErrorCode: boundedAdapterErrorCode(adapterErrorCode),
  };
}

function fallbackResult({
  candidates,
  reason,
  startedAt,
  adapter,
  response = null,
  adapterErrorCode = null,
}) {
  return resultFor({
    candidates,
    status: RERANK_STATUS.FALLBACK,
    reason,
    startedAt,
    adapterIdentity: identityFrom(adapter, response),
    usage: response !== null && response !== undefined && Object.hasOwn(response, "usage")
      ? response.usage
      : null,
    adapterErrorCode: adapterErrorCode ?? response?.adapterErrorCode ?? null,
    scoredByIndex: new Map(),
  });
}

function validateScores(response, submittedCount) {
  const scores = Array.isArray(response) ? response : response?.scores;
  if (!Array.isArray(scores) || scores.length !== submittedCount) return null;

  const byIndex = new Map();
  for (const item of scores) {
    if (!item || typeof item !== "object" || !Number.isInteger(item.index)) return null;
    if (item.index < 0 || item.index >= submittedCount || byIndex.has(item.index)) return null;
    if (typeof item.score !== "number" || !Number.isFinite(item.score)) return null;
    byIndex.set(item.index, item.score);
  }
  return byIndex.size === submittedCount ? byIndex : null;
}

function sortSubmitted(submitted, scoredByIndex) {
  return submitted
    .map((candidate, submittedIndex) => ({
      candidate,
      submittedIndex,
      score: scoredByIndex.get(submittedIndex),
    }))
    .sort((left, right) => right.score - left.score || left.submittedIndex - right.submittedIndex)
    .map(item => item.candidate);
}

/**
 * @param {{query: string, candidates: Array<{id: string, text: string}>, deadlineMs: number, adapter: Function}} input
 * @returns {Promise<{orderedIds: string[], status: string, reason: string, scores: Record<string, number|null>, elapsedMs: number, adapterIdentity: unknown, usage: unknown, adapterErrorCode: string|null}>}
 */
export async function rerankCandidates({ query, candidates, deadlineMs, adapter } = {}) {
  const startedAt = nowMs();
  const normalized = validateInput({ query, candidates, deadlineMs, adapter });

  if (normalized.length === 0) {
    return resultFor({
      candidates: normalized,
      status: RERANK_STATUS.BYPASSED,
      reason: RERANK_REASON.EMPTY_CANDIDATES,
      startedAt,
      adapterIdentity: identityFrom(adapter),
      scoredByIndex: new Map(),
    });
  }

  const submitted = normalized.filter(candidate => candidate.text.length > 0);
  if (submitted.length === 0) {
    return resultFor({
      candidates: normalized,
      status: RERANK_STATUS.BYPASSED,
      reason: RERANK_REASON.ALL_TEXT_EMPTY,
      startedAt,
      adapterIdentity: identityFrom(adapter),
      scoredByIndex: new Map(),
    });
  }

  const controller = new AbortController();
  let timer;
  let timedOut = false;
  const adapterPromise = Promise.resolve().then(() => adapter(
    query,
    submitted.map(candidate => candidate.text),
    controller.signal,
  ));
  const settledAdapter = adapterPromise.then(
    response => ({ kind: "response", response }),
    error => ({ kind: "error", error }),
  );
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      resolve({ kind: "timeout" });
    }, deadlineMs);
  });

  const outcome = await Promise.race([settledAdapter, timeout]);
  clearTimeout(timer);

  if (outcome.kind === "timeout" || timedOut) {
    return fallbackResult({
      candidates: normalized,
      reason: RERANK_REASON.TIMEOUT,
      startedAt,
      adapter,
    });
  }
  if (outcome.kind === "error") {
    return fallbackResult({
      candidates: normalized,
      reason: RERANK_REASON.ADAPTER_ERROR,
      startedAt,
      adapter,
      adapterErrorCode: outcome.error?.code ?? null,
    });
  }

  const scoredBySubmittedIndex = validateScores(outcome.response, submitted.length);
  if (!scoredBySubmittedIndex) {
    return fallbackResult({
      candidates: normalized,
      reason: RERANK_REASON.INVALID_RESPONSE,
      startedAt,
      adapter,
      response: outcome.response,
    });
  }

  const scoredByOriginalIndex = new Map(
    submitted.map((candidate, submittedIndex) => [
      candidate.index,
      scoredBySubmittedIndex.get(submittedIndex),
    ]),
  );
  const orderedIds = [
    ...sortSubmitted(submitted, scoredBySubmittedIndex).map(candidate => candidate.id),
    ...normalized.filter(candidate => candidate.text.length === 0).map(candidate => candidate.id),
  ];

  return {
    orderedIds,
    status: RERANK_STATUS.APPLIED,
    reason: submitted.length === normalized.length
      ? RERANK_REASON.COMPLETE
      : RERANK_REASON.MIXED_EMPTY_TEXT,
    scores: scoresById(normalized, scoredByOriginalIndex),
    elapsedMs: elapsedMs(startedAt),
    adapterIdentity: identityFrom(adapter, outcome.response),
    usage: outcome.response && Object.hasOwn(outcome.response, "usage")
      ? outcome.response.usage
      : null,
    adapterErrorCode: null,
  };
}
