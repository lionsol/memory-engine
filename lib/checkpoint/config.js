const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { getRuntime } = require("./runtime");

const configCache = new Map();
const DEFAULT_CHECKPOINT_PRIMARY_PROVIDER = "deepseek";
const DEFAULT_CHECKPOINT_FALLBACK_PROVIDER = "siliconflow";
const VALID_PRIMARY_PROVIDERS = new Set(["deepseek", "siliconflow"]);
const VALID_FALLBACK_PROVIDERS = new Set(["deepseek", "siliconflow", "none"]);

function getConfig() {
  const { configJsonPath } = getRuntime();
  if (!configCache.has(configJsonPath)) {
    try {
      configCache.set(configJsonPath, JSON.parse(readFileSync(configJsonPath, "utf-8")));
    } catch (_) {
      configCache.set(configJsonPath, {});
    }
  }
  return configCache.get(configJsonPath);
}

function getSFKey() {
  try {
    return getConfig().models?.providers?.siliconflow?.apiKey || "";
  } catch (e) {
    return "";
  }
}

function getSFBaseUrl() {
  try {
    return getConfig().models?.providers?.siliconflow?.baseUrl || "https://api.siliconflow.cn/v1";
  } catch (e) {
    return "https://api.siliconflow.cn/v1";
  }
}

function getDSKey() {
  try {
    const keyPath = resolve(getRuntime().workspaceDir, "../credentials/deepseek-api-key");
    const key = readFileSync(keyPath, "utf-8").trim();
    if (key) return key;
  } catch (e) { /* file not found */ }
  try {
    return getConfig().models?.providers?.deepseek?.apiKey || process.env.DEEPSEEK_API_KEY || "";
  } catch (e) {
    return "";
  }
}

function getDSBaseUrl() {
  try {
    return getConfig().models?.providers?.deepseek?.baseUrl || "https://api.deepseek.com";
  } catch (e) {
    return "https://api.deepseek.com";
  }
}

function resolveCheckpointProviders(env = process.env, logger = console) {
  const warnings = [];
  const rawPrimary = env?.MEMORY_ENGINE_CHECKPOINT_PRIMARY_PROVIDER;
  const rawFallback = env?.MEMORY_ENGINE_CHECKPOINT_FALLBACK_PROVIDER;

  let primaryProvider = DEFAULT_CHECKPOINT_PRIMARY_PROVIDER;
  if (rawPrimary !== undefined) {
    if (VALID_PRIMARY_PROVIDERS.has(rawPrimary)) {
      primaryProvider = rawPrimary;
    } else {
      warnings.push(
        `[checkpoint] Invalid MEMORY_ENGINE_CHECKPOINT_PRIMARY_PROVIDER=${JSON.stringify(rawPrimary)}; using default ${DEFAULT_CHECKPOINT_PRIMARY_PROVIDER}`,
      );
    }
  }

  let fallbackProvider = DEFAULT_CHECKPOINT_FALLBACK_PROVIDER;
  if (rawFallback !== undefined) {
    if (VALID_FALLBACK_PROVIDERS.has(rawFallback)) {
      fallbackProvider = rawFallback;
    } else {
      warnings.push(
        `[checkpoint] Invalid MEMORY_ENGINE_CHECKPOINT_FALLBACK_PROVIDER=${JSON.stringify(rawFallback)}; using default ${DEFAULT_CHECKPOINT_FALLBACK_PROVIDER}`,
      );
    }
  }

  if (logger && typeof logger.warn === "function") {
    for (const warning of warnings) logger.warn(warning);
  }

  return {
    primaryProvider,
    fallbackProvider,
    warnings,
  };
}

module.exports = {
  getConfig,
  getSFKey,
  getSFBaseUrl,
  getDSKey,
  getDSBaseUrl,
  resolveCheckpointProviders,
};
