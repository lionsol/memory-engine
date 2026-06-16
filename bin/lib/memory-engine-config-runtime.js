const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const FALLBACK_CONFIG = {
  timezone: {
    business: "Asia/Shanghai",
  },
};

let getMemoryEngineConfigPromise = null;

function asPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeConfigInput(cfg = null) {
  if (asPlainObject(cfg) && asPlainObject(cfg.cfg)) return cfg.cfg;
  return cfg;
}

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

async function importModuleByPath(absolutePath) {
  const url = pathToFileURL(absolutePath).href;
  return import(url);
}

async function loadGetMemoryEngineConfig() {
  if (getMemoryEngineConfigPromise) return getMemoryEngineConfigPromise;

  getMemoryEngineConfigPromise = (async () => {
    const moduleCandidates = [
      resolve(__dirname, "../../lib/config/helpers.js"),
      resolve(__dirname, "../../lib/config/runtime.js"),
    ];

    for (const modulePath of moduleCandidates) {
      try {
        const mod = await importModuleByPath(modulePath);
        const fn =
          mod?.getMemoryEngineConfig
          || mod?.default?.getMemoryEngineConfig;
        if (typeof fn === "function") return fn;
      } catch {
        // Try next candidate.
      }
    }

    return () => cloneConfig(FALLBACK_CONFIG);
  })();

  return getMemoryEngineConfigPromise;
}

async function getMemoryEngineRuntimeConfig(cfg = null) {
  const normalized = normalizeConfigInput(cfg);
  try {
    const getMemoryEngineConfig = await loadGetMemoryEngineConfig();
    const resolved = getMemoryEngineConfig(normalized);
    if (asPlainObject(resolved)) return resolved;
  } catch {
    // fall through to default
  }
  return cloneConfig(FALLBACK_CONFIG);
}

async function getSmartAddTimeZoneRuntime(cfg = null) {
  if (process.env.MEMORY_ENGINE_TIME_ZONE) {
    return process.env.MEMORY_ENGINE_TIME_ZONE;
  }
  const config = await getMemoryEngineRuntimeConfig(cfg);
  return config?.timezone?.business || "Asia/Shanghai";
}

module.exports = {
  getMemoryEngineRuntimeConfig,
  getSmartAddTimeZoneRuntime,
};
