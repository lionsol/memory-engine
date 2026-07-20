import { getMemoryEngineConfig } from "../../config/runtime.js";
import { resolveEffectiveHybridRuntimeConfig } from "../../config/effective-hybrid-runtime-config.js";
import { canonicalIsoTimestamp } from "./hybrid-observation-provenance.js";
import { fingerprintRolloutConfig } from "./production-evidence-identity.js";

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

function sanitizeCanary(canary) {
  if (!isPlainObject(canary)) return canary;
  const copy = clone(canary);
  const tokens = Array.isArray(copy.tokens) ? copy.tokens : [];
  delete copy.tokens;
  copy.token_count = tokens.length;
  return copy;
}

export function sanitizeEffectiveConfigForAuthorization(config) {
  if (!isPlainObject(config)) return null;
  const sanitized = clone(config);
  sanitized.kgFailClosedCanary = sanitizeCanary(sanitized.kgFailClosedCanary);
  sanitized.recentFailClosedCanary = sanitizeCanary(sanitized.recentFailClosedCanary);
  return sanitized;
}

export function buildEffectiveRuntimeConfigReport({
  openclawConfig,
  checkedAt = new Date().toISOString(),
} = {}) {
  const checkedAtIso = canonicalIsoTimestamp(checkedAt);
  if (!checkedAtIso) throw new TypeError("checkedAt must be a canonical UTC ISO timestamp");
  if (!isPlainObject(openclawConfig)) {
    return {
      schema_version: 1,
      checked_at: checkedAtIso,
      valid: false,
      errors: ["invalid_openclaw_config"],
      effective_config: null,
      rollout_config_fingerprint: null,
    };
  }
  const inputErrors = [];
  const entries = openclawConfig.plugins?.entries;
  if (!isPlainObject(entries)) inputErrors.push("invalid_object:plugins.entries");
  const entry = isPlainObject(entries) ? entries["memory-engine"] : undefined;
  if (!isPlainObject(entry)) inputErrors.push("missing_or_invalid_plugin_entry:memory-engine");
  if (isPlainObject(entry) && entry.enabled !== true) inputErrors.push("memory_engine_plugin_not_explicitly_enabled");
  if (isPlainObject(entry) && entry.config !== undefined && !isPlainObject(entry.config)) {
    inputErrors.push("invalid_object:plugins.entries.memory-engine.config");
  }
  if (inputErrors.length > 0) {
    return {
      schema_version: 1,
      checked_at: checkedAtIso,
      valid: false,
      errors: inputErrors,
      effective_config: null,
      rollout_config_fingerprint: null,
    };
  }
  const pluginEntryConfig = entry.config;
  const result = resolveEffectiveHybridRuntimeConfig({
    pluginConfig: pluginEntryConfig,
    pluginEntryConfig,
    apiConfig: openclawConfig,
    memoryEngineConfig: getMemoryEngineConfig(openclawConfig),
  });
  const { valid, errors, ...effectiveConfig } = result;
  const fingerprint = valid ? fingerprintRolloutConfig(effectiveConfig) : null;
  return {
    schema_version: 1,
    checked_at: checkedAtIso,
    valid: valid && fingerprint?.valid === true,
    errors: [
      ...(Array.isArray(errors) ? errors : []),
      ...(fingerprint && !fingerprint.valid ? fingerprint.errors : []),
    ],
    effective_config: sanitizeEffectiveConfigForAuthorization(effectiveConfig),
    rollout_config_fingerprint: fingerprint?.fingerprint || null,
  };
}

export { clone, isPlainObject, sanitizeCanary };
