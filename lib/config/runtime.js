import { getDefaultMemoryEngineConfig } from "./defaults.js";

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deepMerge(base, override) {
  if (Array.isArray(base)) {
    return Array.isArray(override) ? [...override] : [...base];
  }
  if (!isPlainObject(base)) {
    return override === undefined ? base : override;
  }

  const out = {};
  const keys = new Set([
    ...Object.keys(base),
    ...Object.keys(isPlainObject(override) ? override : {}),
  ]);
  for (const key of keys) {
    const baseValue = base[key];
    const overrideValue = isPlainObject(override) ? override[key] : undefined;
    if (overrideValue === undefined) {
      if (Array.isArray(baseValue)) out[key] = [...baseValue];
      else if (isPlainObject(baseValue)) out[key] = deepMerge(baseValue, undefined);
      else out[key] = baseValue;
      continue;
    }
    if (Array.isArray(baseValue) || Array.isArray(overrideValue)) {
      out[key] = Array.isArray(overrideValue) ? [...overrideValue] : Array.isArray(baseValue) ? [...baseValue] : overrideValue;
      continue;
    }
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      out[key] = deepMerge(baseValue, overrideValue);
      continue;
    }
    if (isPlainObject(overrideValue)) {
      out[key] = deepMerge({}, overrideValue);
      continue;
    }
    out[key] = overrideValue;
  }
  return out;
}

function extractMemoryEngineConfig(apiOrConfig) {
  if (!isPlainObject(apiOrConfig)) return {};
  const fromApi = isPlainObject(apiOrConfig.config) ? apiOrConfig.config.memoryEngine : undefined;
  const direct = apiOrConfig.memoryEngine;
  const directEngineConfig = (
    apiOrConfig.archive !== undefined ||
    apiOrConfig.confidence !== undefined ||
    apiOrConfig.recall !== undefined ||
    apiOrConfig.ranking !== undefined ||
    apiOrConfig.metrics !== undefined ||
    apiOrConfig.timezone !== undefined
  ) ? apiOrConfig : undefined;
  const merged = isPlainObject(fromApi) && isPlainObject(direct)
    ? deepMerge(fromApi, direct)
    : isPlainObject(fromApi)
      ? deepMerge({}, fromApi)
      : isPlainObject(direct)
        ? deepMerge({}, direct)
        : isPlainObject(directEngineConfig)
          ? deepMerge({}, directEngineConfig)
          : {};

  const rootConfig = isPlainObject(apiOrConfig.config) ? apiOrConfig.config : apiOrConfig;
  const archiveThreshold = rootConfig.archiveThreshold;
  if (archiveThreshold !== undefined) {
    merged.archive = deepMerge(merged.archive || {}, { threshold: archiveThreshold });
  }
  return merged;
}

export function getMemoryEngineConfig(apiOrConfig) {
  const defaults = getDefaultMemoryEngineConfig();
  const override = extractMemoryEngineConfig(apiOrConfig);
  return deepMerge(defaults, override);
}
