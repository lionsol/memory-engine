import runtimeDescriptor from "./descriptor.cjs";
import { getMemoryEngineConfig } from "../config/runtime.js";
import { getSmartAddTimeZone } from "../config/helpers.js";
import { resolveEffectiveHybridRuntimeConfig } from "../config/effective-hybrid-runtime-config.js";

const { createMemoryEngineRuntimeDescriptor } = runtimeDescriptor;

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
} = {}) {
  const descriptor = createMemoryEngineRuntimeDescriptor({ pathOverrides, env });
  const paths = descriptor.paths;
  const resolvedPluginEntryConfig = resolvePluginEntryConfig(apiConfig, pluginEntryConfig);
  const memoryEngineConfig = getMemoryEngineConfig(apiConfig);
  const effectiveRuntimeConfig = resolveEffectiveHybridRuntimeConfig({
    pluginConfig,
    pluginEntryConfig: resolvedPluginEntryConfig,
    apiConfig,
    memoryEngineConfig,
  });

  return {
    descriptor,
    paths,
    config: {
      apiConfig,
      pluginConfig,
      pluginEntryConfig: resolvedPluginEntryConfig ?? null,
      memoryEngineConfig,
      effectiveRuntimeConfig,
      smartAddTimeZone: getSmartAddTimeZone(apiConfig),
      embeddingRuntimeConfig: apiConfig || resolvedPluginEntryConfig || null,
    },
  };
}
