import { getMemorySearchManager } from "openclaw/plugin-sdk/memory-core-engine-runtime";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";

export const HOME_DIR = homedir();
export const DB_PATH = resolve(HOME_DIR, ".openclaw/memory/main.sqlite");
export const WORKSPACE = resolve(HOME_DIR, ".openclaw/workspace");
export const SMART_ADD_DIR = "memory/smart-add";
export const INDEX_SYNC_WATCH_DIRS = ["memory/smart-add", "memory/episodes"];

export const DEFAULT_AGENT_ID = process.env.OPENCLAW_AGENT_ID || "main";
export const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || resolve(HOME_DIR, ".openclaw/openclaw.json");

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
