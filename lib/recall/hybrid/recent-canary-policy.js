import { createHash } from "node:crypto";

export const RECENT_CANARY_ALLOWED_MODES = Object.freeze(["off", "shadow"]);
export const RECENT_CANARY_DEFAULT_SAMPLE_RATE_BPS = 0;

function sha256Hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function normalizeSampleRateBasisPoints(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return RECENT_CANARY_DEFAULT_SAMPLE_RATE_BPS;
  }
  return Math.min(10000, parsed);
}

export function resolveRecentCanarySampleBucket(sampleKey, salt = "recent-canary-shadow-v1") {
  const rawKey = typeof sampleKey === "string" ? sampleKey.trim() : "";
  if (!rawKey) return null;
  const digest = sha256Hex(`${salt}:${rawKey}`);
  return Number.parseInt(digest.slice(0, 8), 16) % 10000;
}

function baseDecision(overrides = {}) {
  return {
    mode: "off",
    reason: "provider_unavailable",
    scope_class: null,
    sampled: false,
    sample_bucket: null,
    sample_rate_basis_points: RECENT_CANARY_DEFAULT_SAMPLE_RATE_BPS,
    policy_error: false,
    ...overrides,
  };
}

export function resolveRecentCanaryDecision({
  scope = null,
  provider = null,
} = {}) {
  if (provider == null) return baseDecision({ reason: "provider_unavailable" });
  if (typeof provider !== "function") return baseDecision({ reason: "provider_invalid" });

  let resolved;
  try {
    resolved = provider({ scope });
  } catch {
    return baseDecision({
      reason: "provider_error",
      policy_error: true,
    });
  }

  if (!resolved || typeof resolved !== "object") {
    return baseDecision({ reason: "provider_empty" });
  }

  const requestedMode = typeof resolved.mode === "string" ? resolved.mode : "off";
  if (!RECENT_CANARY_ALLOWED_MODES.includes(requestedMode)) {
    return baseDecision({ reason: "mode_not_allowed" });
  }

  const scopeClass = typeof resolved.scopeClass === "string" && resolved.scopeClass.trim()
    ? resolved.scopeClass.trim()
    : null;
  if (requestedMode === "off") {
    return baseDecision({
      reason: typeof resolved.reason === "string" && resolved.reason.trim()
        ? resolved.reason.trim()
        : "provider_off",
      scope_class: scopeClass,
    });
  }

  const sampleKey = typeof scope?.sampleKey === "string" && scope.sampleKey.trim()
    ? scope.sampleKey.trim()
    : null;
  const sampleRateBasisPoints = normalizeSampleRateBasisPoints(
    resolved.sampleRateBasisPoints ?? resolved.sampleRateBps ?? RECENT_CANARY_DEFAULT_SAMPLE_RATE_BPS,
  );
  const sampleBucket = resolveRecentCanarySampleBucket(sampleKey);

  if (!scopeClass) {
    return baseDecision({
      reason: "scope_insufficient",
      sample_rate_basis_points: sampleRateBasisPoints,
      sample_bucket: sampleBucket,
    });
  }
  if (!sampleKey) {
    return baseDecision({
      reason: "missing_sample_key",
      scope_class: scopeClass,
      sample_rate_basis_points: sampleRateBasisPoints,
      sample_bucket: sampleBucket,
    });
  }

  const sampled = sampleBucket !== null && sampleBucket < sampleRateBasisPoints;
  if (sampled !== true) {
    return baseDecision({
      reason: "not_sampled",
      scope_class: scopeClass,
      sample_rate_basis_points: sampleRateBasisPoints,
      sample_bucket: sampleBucket,
    });
  }

  return {
    mode: "shadow",
    reason: typeof resolved.reason === "string" && resolved.reason.trim()
      ? resolved.reason.trim()
      : "sampled_shadow",
    scope_class: scopeClass,
    sampled: true,
    sample_bucket: sampleBucket,
    sample_rate_basis_points: sampleRateBasisPoints,
    policy_error: false,
  };
}
