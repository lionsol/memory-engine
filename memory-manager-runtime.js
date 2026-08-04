import { existsSync, readFileSync } from "fs";
import runtimePaths from "./lib/runtime/paths.cjs";

const {
  INDEX_SYNC_WATCH_DIRS: SHARED_INDEX_SYNC_WATCH_DIRS,
  SMART_ADD_RELATIVE_DIR,
  resolveMemoryEnginePaths,
} = runtimePaths;
const DEFAULT_PATHS = resolveMemoryEnginePaths();

export const HOME_DIR = DEFAULT_PATHS.homeDir;
export const CORE_DB_PATH = DEFAULT_PATHS.coreDbPath;
export const ENGINE_DB_PATH = DEFAULT_PATHS.engineDbPath;
export const ENGINE_DB_DIR = DEFAULT_PATHS.engineDbDir;
// Backward compatibility for existing imports; prefer CORE_DB_PATH in new code.
export const DB_PATH = CORE_DB_PATH;
export const WORKSPACE = DEFAULT_PATHS.workspaceDir;
export const SMART_ADD_DIR = SMART_ADD_RELATIVE_DIR;
export const SMART_ADD_PATH = DEFAULT_PATHS.smartAddDir;
export const KG_PATH = DEFAULT_PATHS.kgPath;
export const LANCEDB_DIR = DEFAULT_PATHS.lancedbDir;
export const INDEX_SYNC_WATCH_DIRS = [...SHARED_INDEX_SYNC_WATCH_DIRS];

export const DEFAULT_AGENT_ID = process.env.OPENCLAW_AGENT_ID || "main";
export const OPENCLAW_CONFIG_PATH = DEFAULT_PATHS.configJsonPath;
export const OPENCLAW_MEMORY_RUNTIME_SPECIFIER = "openclaw/plugin-sdk/memory-core-engine-runtime";

function normalizeRuntimeImportError(error) {
  const message = String(error?.message || error || "");
  const missingPackage = error?.code === "ERR_MODULE_NOT_FOUND"
    || /Cannot find package 'openclaw' imported from/i.test(message);
  if (missingPackage) {
    return [
      "openclaw runtime package unavailable",
      "sync-memory-index requires the OpenClaw harness runtime or the openclaw plugin SDK package",
    ].join("; ");
  }
  return message || "openclaw memory-core-engine-runtime unavailable";
}

async function resolveMemorySearchManager() {
  const mod = await import(OPENCLAW_MEMORY_RUNTIME_SPECIFIER);
  if (typeof mod?.getMemorySearchManager !== "function") {
    throw new Error("openclaw memory-core-engine-runtime unavailable");
  }
  return mod.getMemorySearchManager;
}

export function loadOpenClawConfig(configPath = OPENCLAW_CONFIG_PATH) {
  if (!existsSync(configPath)) {
    return { cfg: null, configPath, error: `openclaw config not found: ${configPath}` };
  }

  try {
    const raw = readFileSync(configPath, "utf8");
    return { cfg: JSON.parse(raw), configPath, error: null };
  } catch (error) {
    return {
      cfg: null,
      configPath,
      error: `failed to read openclaw config (${configPath}): ${String(error?.message || error)}`,
    };
  }
}

export async function getSharedMemoryManager({ purpose, cfg, agentId, allowImplicit = true } = {}) {
  let getMemorySearchManager = null;
  try {
    getMemorySearchManager = await resolveMemorySearchManager();
  } catch (error) {
    return {
      manager: null,
      source: "config",
      cfg: null,
      agentId: null,
      configPath: null,
      error: normalizeRuntimeImportError(error),
    };
  }

  const implicitParams = purpose ? { purpose } : {};
  let implicitError = null;

  if (allowImplicit) {
    try {
      const implicit = await getMemorySearchManager(implicitParams);
      if (implicit?.manager) {
        return {
          manager: implicit.manager,
          source: "implicit",
          cfg: null,
          agentId: null,
          configPath: null,
          error: implicit.error || null,
        };
      }
      implicitError = implicit?.error ? String(implicit.error) : null;
    } catch (error) {
      implicitError = String(error?.message || error);
    }
  }

  const cfgResult = cfg
    ? { cfg, configPath: null, error: null }
    : loadOpenClawConfig();
  if (!cfgResult.cfg) {
    return {
      manager: null,
      source: "config",
      cfg: null,
      agentId: null,
      configPath: cfgResult.configPath || null,
      error: implicitError || cfgResult.error || "memory manager unavailable",
    };
  }

  const resolvedAgentId = agentId || DEFAULT_AGENT_ID;
  const explicitParams = {
    cfg: cfgResult.cfg,
    agentId: resolvedAgentId,
    ...(purpose ? { purpose } : {}),
  };

  try {
    const explicit = await getMemorySearchManager(explicitParams);
    if (explicit?.manager) {
      return {
        manager: explicit.manager,
        source: "config",
        cfg: cfgResult.cfg,
        agentId: resolvedAgentId,
        configPath: cfgResult.configPath || null,
        error: explicit.error || null,
      };
    }
    return {
      manager: null,
      source: "config",
      cfg: cfgResult.cfg,
      agentId: resolvedAgentId,
      configPath: cfgResult.configPath || null,
      error: explicit?.error || implicitError || "memory manager unavailable",
    };
  } catch (error) {
    return {
      manager: null,
      source: "config",
      cfg: cfgResult.cfg,
      agentId: resolvedAgentId,
      configPath: cfgResult.configPath || null,
      error: String(error?.message || error) || implicitError || "memory manager unavailable",
    };
  }
}
