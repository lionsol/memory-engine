const { SANDBOX_OPERATIONS } = require("./constants.js");

const MAX_INNER_TIMEOUT_MS = 900_000;
const MAX_OUTER_TIMEOUT_MS = 930_000;
const DEFAULT_TIMEOUT = Object.freeze({ inner_timeout_ms: 120_000, outer_timeout_ms: 120_000 });
const CLOSED_TIMEOUTS = Object.freeze({
  "capability-probe": Object.freeze({ inner_timeout_ms: 120_000, outer_timeout_ms: 30_000 }),
  "npm.ci_candidate": Object.freeze({ inner_timeout_ms: 300_000, outer_timeout_ms: 330_000 }),
});

function assertBoundedTimeout(value, label = "timeout", maximum = MAX_INNER_TIMEOUT_MS) {
  const numeric = typeof value === "number" ? value : (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN);
  if (!Number.isSafeInteger(numeric) || numeric <= 0 || numeric > maximum) throw new Error(`${label} must be a bounded positive integer`);
  return numeric;
}

function getSandboxTimeoutPolicy(operation) {
  if (operation !== "capability-probe" && !SANDBOX_OPERATIONS.includes(operation)) throw new Error(`unregistered sandbox timeout operation:${operation}`);
  const selected = CLOSED_TIMEOUTS[operation] || DEFAULT_TIMEOUT;
  const inner_timeout_ms = assertBoundedTimeout(selected.inner_timeout_ms, `${operation} inner timeout`);
  const outer_timeout_ms = assertBoundedTimeout(selected.outer_timeout_ms, `${operation} outer timeout`, MAX_OUTER_TIMEOUT_MS);
  if (operation === "npm.ci_candidate" && outer_timeout_ms !== inner_timeout_ms + 30_000) throw new Error("npm.ci_candidate timeout ordering invalid");
  if (operation !== "capability-probe" && outer_timeout_ms < inner_timeout_ms) throw new Error(`${operation} timeout ordering invalid`);
  return Object.freeze({ inner_timeout_ms, outer_timeout_ms });
}

module.exports = { MAX_INNER_TIMEOUT_MS, MAX_OUTER_TIMEOUT_MS, assertBoundedTimeout, getSandboxTimeoutPolicy };
