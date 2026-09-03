const VALID_CONFIG_CODE = "MEMORY_ENGINE_CONFIG_VALID";
const INVALID_CONFIG_CODE = "MEMORY_ENGINE_CONFIG_INVALID";
const INVALID_RUNTIME_CONFIG_ERROR = "invalid_runtime_config";
const INTERNAL_ERROR_CODE_PATTERN = /^invalid_(?:object|array|number|boolean|mode|top_k):[A-Za-z][A-Za-z0-9_.]*$/;

function normalizeErrorCodes(errors) {
  if (!Array.isArray(errors)) return [];
  const sourceErrors = errors.filter(error => typeof error === "string" && error.length > 0);
  const safeErrors = sourceErrors.filter(error => INTERNAL_ERROR_CODE_PATTERN.test(error));
  if (sourceErrors.some(error => !INTERNAL_ERROR_CODE_PATTERN.test(error))) {
    safeErrors.push(INVALID_RUNTIME_CONFIG_ERROR);
  }
  return [...new Set(safeErrors)].sort();
}

export function createRuntimeConfigValidationStatus(effectiveRuntimeConfig = {}) {
  const errors = normalizeErrorCodes(effectiveRuntimeConfig?.errors);
  const valid = effectiveRuntimeConfig?.valid === true && errors.length === 0;
  const frozenErrors = Object.freeze(errors);
  return Object.freeze({
    code: valid ? VALID_CONFIG_CODE : INVALID_CONFIG_CODE,
    valid,
    fallback_applied: !valid,
    error_count: frozenErrors.length,
    errors: frozenErrors,
  });
}

export function formatRuntimeConfigValidationWarning(validation) {
  if (!validation || validation.valid === true) return null;
  const errorCodes = normalizeErrorCodes(validation.errors);
  return [
    `[memory-engine] ${INVALID_CONFIG_CODE}`,
    `fallback_applied=${validation.fallback_applied === true}`,
    `error_count=${errorCodes.length}`,
    `errors=${errorCodes.join(",") || "none"}`,
  ].join(" ");
}

export function emitRuntimeConfigValidationWarning(validation, {
  logger = null,
  consoleWarn = console.warn,
} = {}) {
  const message = formatRuntimeConfigValidationWarning(validation);
  if (!message) return false;
  if (logger && typeof logger.warn === "function") {
    logger.warn(message);
  } else {
    consoleWarn(message);
  }
  return true;
}
