import { monotonicNow } from "./hybrid/debug.js";

export const AUTO_RECALL_CANCELLATION_CODE = "AUTO_RECALL_REQUEST_CANCELLED";

const MAX_REQUEST_BUDGET_MS = 60_000;
const MAX_DIAGNOSTIC_TIMING_MS = 3_600_000;

const STAGE_TIMING_KEYS = Object.freeze({
  vector_ready: "vector_ready_wait_ms",
  embedding: "vector_embedding_wait_ms",
  query_embedding: "vector_embedding_wait_ms",
  lancedb_search: "vector_lancedb_search_ms",
  lancedb_collect: "vector_lancedb_collect_ms",
  vector_candidate_postprocess: "vector_candidate_postprocess_ms",
});

function boundedTimeoutMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric < 0) return 0;
  return Math.min(MAX_REQUEST_BUDGET_MS, numeric);
}

export function createAutoRecallRequestBudget(timeoutMs, {
  now = monotonicNow,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
} = {}) {
  const durationMs = boundedTimeoutMs(timeoutMs);
  if (durationMs === null) return null;

  const startedAt = Number(now());
  const deadlineAt = startedAt + durationMs;
  const controller = new AbortController();
  let timer = null;
  let disposed = false;
  let cancelled = false;
  let cancellationStage = null;
  let activeStage = null;
  let activeStageStartedAt = startedAt;
  let cancellationDiagnostics = null;

  const normalizeStage = stage => String(stage || "request").slice(0, 64);
  const normalizeTiming = value => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return Math.min(MAX_DIAGNOSTIC_TIMING_MS, numeric);
  };

  const setActiveStage = stage => {
    if (cancelled) return activeStage;
    const normalized = normalizeStage(stage);
    if (activeStage !== normalized) {
      activeStage = normalized;
      activeStageStartedAt = Number(now());
    }
    return activeStage;
  };

  const recordCancellationDiagnostics = ({ stage, timings = {} } = {}) => {
    const normalizedStage = normalizeStage(stage || cancellationStage || activeStage || "request");
    const projectedTimings = {};
    if (timings && typeof timings === "object") {
      for (const [key, value] of Object.entries(timings)) {
        const normalized = normalizeTiming(value);
        if (normalized !== null) projectedTimings[key] = normalized;
      }
    }
    cancellationDiagnostics = {
      cancellation_stage: cancellationDiagnostics?.cancellation_stage || normalizedStage,
      timings: {
        ...(cancellationDiagnostics?.timings || {}),
        ...projectedTimings,
      },
    };
    return cancellationDiagnostics;
  };

  const cancel = (stage = "deadline") => {
    if (disposed || cancelled) return false;
    cancelled = true;
    cancellationStage = normalizeStage(stage === "deadline" ? activeStage || stage : stage);
    const timingKey = STAGE_TIMING_KEYS[cancellationStage];
    const elapsed = normalizeTiming(Number(now()) - activeStageStartedAt);
    recordCancellationDiagnostics({
      stage: cancellationStage,
      timings: timingKey && elapsed !== null ? { [timingKey]: elapsed } : {},
    });
    const error = new Error(AUTO_RECALL_CANCELLATION_CODE);
    error.code = AUTO_RECALL_CANCELLATION_CODE;
    error.stage = cancellationStage;
    try {
      controller.abort(error);
    } catch {
      // AbortController.abort is available on supported Node runtimes.
    }
    return true;
  };

  const remainingMs = () => Math.max(0, deadlineAt - Number(now()));
  const isCancelled = () => {
    if (cancelled || controller.signal.aborted) return true;
    if (remainingMs() <= 0) {
      cancel("deadline");
      return true;
    }
    return false;
  };
  const throwIfCancelled = (stage = "request") => {
    if (!cancelled) setActiveStage(stage);
    if (!isCancelled()) return;
    const error = new Error(AUTO_RECALL_CANCELLATION_CODE);
    error.code = AUTO_RECALL_CANCELLATION_CODE;
    error.stage = normalizeStage(cancellationStage || stage || "cancelled");
    throw error;
  };

  if (durationMs <= 0) {
    cancel("deadline");
  } else if (typeof setTimeoutFn === "function") {
    timer = setTimeoutFn(() => cancel("deadline"), durationMs);
    timer?.unref?.();
  }

  return {
    signal: controller.signal,
    deadlineAt,
    get cancellationStage() {
      return cancellationStage;
    },
    remainingMs,
    isCancelled,
    setActiveStage,
    recordCancellationDiagnostics,
    get cancellationDiagnostics() {
      return cancellationDiagnostics
        ? {
          cancellation_stage: cancellationDiagnostics.cancellation_stage,
          timings: { ...cancellationDiagnostics.timings },
        }
        : null;
    },
    throwIfCancelled,
    cancel,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer !== null && typeof clearTimeoutFn === "function") clearTimeoutFn(timer);
      timer = null;
    },
  };
}

export function isAutoRecallCancellation(error) {
  return error?.code === AUTO_RECALL_CANCELLATION_CODE;
}

export function requestBudgetOptions(budget, stage = "request") {
  if (!budget) return {};
  budget.throwIfCancelled(stage);
  return {
    signal: budget.signal,
    deadlineMs: budget.remainingMs(),
  };
}

/**
 * Await a possibly non-abortable operation without consuming its late result.
 * The late promise is deliberately observed so an eventual rejection cannot
 * become an unhandled rejection after the request has already cancelled.
 */
export function awaitWithAutoRecallBudget(valueOrFactory, budget, stage = "request", { trackStage = true } = {}) {
  const isFactory = typeof valueOrFactory === "function";
  if (!budget) {
    return isFactory ? Promise.resolve().then(valueOrFactory) : Promise.resolve(valueOrFactory);
  }
  if (trackStage) budget.setActiveStage(stage);
  if (budget.isCancelled()) {
    if (!isFactory) Promise.resolve(valueOrFactory).catch(() => {});
    budget.throwIfCancelled(stage);
  }
  const operation = isFactory
    ? Promise.resolve().then(() => {
      budget.throwIfCancelled(stage);
      return valueOrFactory();
    })
    : Promise.resolve(valueOrFactory);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => budget.signal.removeEventListener("abort", onAbort);
    const rejectCancelled = () => {
      if (settled) return;
      settled = true;
      cleanup();
      operation.catch(() => {});
      const error = new Error(AUTO_RECALL_CANCELLATION_CODE);
      error.code = AUTO_RECALL_CANCELLATION_CODE;
      error.stage = String(budget.cancellationStage || stage || "cancelled").slice(0, 64);
      reject(error);
    };
    const onAbort = () => rejectCancelled();
    budget.signal.addEventListener("abort", onAbort, { once: true });
    operation.then(result => {
      if (settled) return;
      settled = true;
      cleanup();
      if (budget.isCancelled()) {
        const error = new Error(AUTO_RECALL_CANCELLATION_CODE);
        error.code = AUTO_RECALL_CANCELLATION_CODE;
        error.stage = String(budget.cancellationStage || stage || "cancelled").slice(0, 64);
        reject(error);
        return;
      }
      resolve(result);
    }, error => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
  });
}
