import runtimeDescriptor from "./descriptor.cjs";
import { getMemoryEngineConfig } from "../config/runtime.js";
import { getDefaultMemoryEngineConfig } from "../config/defaults.js";
import { resolveEffectiveHybridRuntimeConfig } from "../config/effective-hybrid-runtime-config.js";
import businessTime from "../business-time.cjs";
import { createRuntimeConfigValidationStatus } from "./config-validation.js";

const { createMemoryEngineRuntimeDescriptor } = runtimeDescriptor;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolvePluginEntryConfig(apiConfig, pluginEntryConfig) {
  if (pluginEntryConfig !== undefined) return pluginEntryConfig;
  return apiConfig?.plugins?.entries?.["memory-engine"]?.config;
}

function sanitizeMemoryEngineConfig(rawConfig, effectiveRuntimeConfig) {
  const defaults = getDefaultMemoryEngineConfig();
  const raw = isObject(rawConfig) ? rawConfig : {};
  const hybrid = effectiveRuntimeConfig?.hybridRetrieval || {};
  const safeSection = (section, normalized) => ({
    ...defaults[section],
    ...(isObject(raw[section]) ? raw[section] : {}),
    ...(isObject(normalized) ? normalized : {}),
  });

  return {
    ...raw,
    confidence: safeSection("confidence", hybrid.confidence),
    recall: safeSection("recall", hybrid.recall),
    ranking: safeSection("ranking", hybrid.ranking),
  };
}

export function createMemoryEngineConfigContext({
  apiConfig = null,
  pluginConfig = null,
  pluginEntryConfig = undefined,
  pathOverrides = {},
  env = process.env,
  timeZone = undefined,
} = {}) {
  const resolvedPluginEntryConfig = resolvePluginEntryConfig(apiConfig, pluginEntryConfig);
  const rawMemoryEngineConfig = getMemoryEngineConfig(apiConfig);
  const explicitTimeZone = timeZone !== undefined ? timeZone : pathOverrides.timeZone;
  const canonicalTimeZone = businessTime.resolveBusinessTimeZone({
    explicitTimeZone,
    env,
    config: rawMemoryEngineConfig,
  });
  const descriptor = createMemoryEngineRuntimeDescriptor({
    pathOverrides: { ...pathOverrides, timeZone: canonicalTimeZone },
    env,
  });
  const paths = descriptor.paths;
  const effectiveRuntimeConfig = resolveEffectiveHybridRuntimeConfig({
    pluginConfig,
    pluginEntryConfig: resolvedPluginEntryConfig,
    apiConfig,
  });
  const memoryEngineConfig = sanitizeMemoryEngineConfig(rawMemoryEngineConfig, effectiveRuntimeConfig);
  const validation = createRuntimeConfigValidationStatus(effectiveRuntimeConfig);

  return {
    descriptor,
    paths,
    config: {
      apiConfig,
      pluginConfig,
      pluginEntryConfig: resolvedPluginEntryConfig ?? null,
      memoryEngineConfig,
      effectiveRuntimeConfig,
      validation,
      smartAddTimeZone: canonicalTimeZone,
      embeddingRuntimeConfig: isObject(apiConfig)
        ? apiConfig
        : isObject(resolvedPluginEntryConfig)
          ? resolvedPluginEntryConfig
          : null,
    },
  };
}
