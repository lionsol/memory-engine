export const PRODUCTION_TOP_K_MIN = 1;
export const PRODUCTION_TOP_K_MAX = 50;
export const PRODUCTION_DEFAULT_TOP_K = 5;
export const INVALID_TOP_K = "INVALID_TOP_K";
export const INVALID_TOP_K_POLICY = "INVALID_TOP_K_POLICY";

function isSafeTopK(value, min, max) {
  return typeof value === "number"
    && Number.isFinite(value)
    && Number.isSafeInteger(value)
    && value >= min
    && value <= max;
}

export function createTrustedTopKPolicy({
  max = PRODUCTION_TOP_K_MAX,
  defaultValue = PRODUCTION_DEFAULT_TOP_K,
} = {}) {
  if (!Number.isSafeInteger(max) || max < PRODUCTION_TOP_K_MIN) {
    throw new Error(INVALID_TOP_K_POLICY);
  }
  if (!isSafeTopK(defaultValue, PRODUCTION_TOP_K_MIN, max)) {
    throw new Error(INVALID_TOP_K_POLICY);
  }
  return Object.freeze({
    min: PRODUCTION_TOP_K_MIN,
    max,
    default: defaultValue,
  });
}

export const PRODUCTION_TOP_K_POLICY = createTrustedTopKPolicy();

export function resolveTopKPolicy(runtime = {}) {
  if (!Object.hasOwn(runtime || {}, "topKPolicy") || runtime.topKPolicy === undefined) {
    return PRODUCTION_TOP_K_POLICY;
  }
  const policy = runtime?.topKPolicy;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error(INVALID_TOP_K_POLICY);
  }
  return createTrustedTopKPolicy({
    max: policy.max,
    defaultValue: policy.default ?? PRODUCTION_DEFAULT_TOP_K,
  });
}

export function validateTopK(value, options = {}) {
  const resolvedPolicy = options.policy || PRODUCTION_TOP_K_POLICY;
  const defaultValue = options.defaultValue === undefined
    ? resolvedPolicy.default
    : options.defaultValue;
  if (value === undefined) {
    return {
      valid: true,
      supplied: false,
      value: defaultValue,
      error: null,
    };
  }
  if (!isSafeTopK(value, resolvedPolicy.min, resolvedPolicy.max)) {
    return {
      valid: false,
      supplied: true,
      value: null,
      error: INVALID_TOP_K,
    };
  }
  return {
    valid: true,
    supplied: true,
    value,
    error: null,
  };
}

export function normalizeTopK(value, options = {}) {
  const result = validateTopK(value, options);
  if (!result.valid) throw new Error(result.error || INVALID_TOP_K);
  return result.value;
}
