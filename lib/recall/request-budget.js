import { monotonicNow } from "./hybrid/debug.js";

export const AUTO_RECALL_CANCELLATION_CODE = "AUTO_RECALL_REQUEST_CANCELLED";

const MAX_REQUEST_BUDGET_MS = 60_000;

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

  const cancel = (stage = "deadline") => {
    if (disposed || cancelled) return false;
    cancelled = true;
    cancellationStage = String(stage || "cancelled").slice(0, 64);
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
    if (!isCancelled()) return;
    const error = new Error(AUTO_RECALL_CANCELLATION_CODE);
    error.code = AUTO_RECALL_CANCELLATION_CODE;
    error.stage = String(stage || cancellationStage || "cancelled").slice(0, 64);
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
export function awaitWithAutoRecallBudget(value, budget, stage = "request") {
  const operation = Promise.resolve(value);
  if (!budget) return operation;
  if (budget.isCancelled()) {
    operation.catch(() => {});
    budget.throwIfCancelled(stage);
  }
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
      error.stage = String(stage || "cancelled").slice(0, 64);
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
        error.stage = String(stage || "cancelled").slice(0, 64);
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
