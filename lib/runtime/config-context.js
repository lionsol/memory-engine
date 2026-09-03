import runtimeDescriptor from "./descriptor.cjs";
import { getMemoryEngineConfig } from "../config/runtime.js";
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

export function createMemoryEngineConfigContext({
  apiConfig = null,
  pluginConfig = null,
  pluginEntryConfig = undefined,
  pathOverrides = {},
  env = process.env,
  timeZone = undefined,
} = {}) {
  const resolvedPluginEntryConfig = resolvePluginEntryConfig(apiConfig, pluginEntryConfig);
  const memoryEngineConfig = getMemoryEngineConfig(apiConfig);
  const explicitTimeZone = timeZone !== undefined ? timeZone : pathOverrides.timeZone;
  const canonicalTimeZone = businessTime.resolveBusinessTimeZone({
    explicitTimeZone,
    env,
    config: memoryEngineConfig,
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
