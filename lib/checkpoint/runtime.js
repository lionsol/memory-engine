const { homedir } = require("node:os");
const { resolve } = require("node:path");

const HOME = homedir();
const DEFAULT_CORE_DB_PATH = resolve(HOME, ".openclaw/memory/main.sqlite");
const DEFAULT_WORKSPACE = resolve(HOME, ".openclaw/workspace");
const DEFAULT_SESSIONS_DIR = resolve(HOME, ".openclaw/agents/main/sessions");
const DEFAULT_CONFIG_JSON = resolve(HOME, ".openclaw/openclaw.json");
const DEFAULT_ME_DB_PATH = resolve(HOME, ".openclaw/memory/memory-engine/memory-engine.sqlite");
const DEFAULT_TIME_ZONE = "Asia/Shanghai";

let runtimeOverrides = null;
let runtimeFallbacks = {};

function getRuntime() {
  const overrides = runtimeOverrides || {};
  const workspaceDir = overrides.workspaceDir || process.env.MEMORY_ENGINE_WORKSPACE_DIR || DEFAULT_WORKSPACE;
  const memoryDir = overrides.memoryDir || process.env.MEMORY_ENGINE_MEMORY_DIR || resolve(workspaceDir, "memory");
  const coreDbPath = overrides.coreDbPath
    || process.env.MEMORY_ENGINE_CORE_DB_PATH
    || process.env.MEMORY_ENGINE_CORE_DB
    || DEFAULT_CORE_DB_PATH;
  const engineDbPath = overrides.engineDbPath
    || process.env.MEMORY_ENGINE_DB_PATH
    || process.env.MEMORY_ENGINE_DB
    || DEFAULT_ME_DB_PATH;

  return {
    workspaceDir,
    memoryDir,
    smartAddDir: overrides.smartAddDir || resolve(memoryDir, "smart-add"),
    episodesDir: overrides.episodesDir || resolve(memoryDir, "episodes"),
    checkpointLegacyDailyMirror: overrides.checkpointLegacyDailyMirror === true,
    sessionsDir: overrides.sessionsDir || process.env.MEMORY_ENGINE_SESSIONS_DIR || DEFAULT_SESSIONS_DIR,
    coreDbPath,
    engineDbPath,
    configJsonPath: overrides.configJsonPath || process.env.OPENCLAW_CONFIG_PATH || DEFAULT_CONFIG_JSON,
    timeZone: overrides.timeZone || process.env.MEMORY_ENGINE_TIME_ZONE || DEFAULT_TIME_ZONE,
    now: overrides.now || (() => Date.now()),
    llmNightlyExtract: overrides.llmNightlyExtract || runtimeFallbacks.llmNightlyExtract,
    readCheckpointRawLogs: overrides.readCheckpointRawLogs
      || overrides.readYesterdayRawLogs
      || runtimeFallbacks.readCheckpointRawLogs
      || runtimeFallbacks.readYesterdayRawLogs
      || ((options = {}) => {
        const reader = overrides.readYesterdayRawLogs || runtimeFallbacks.readYesterdayRawLogs;
        return typeof reader === "function" ? reader(options) : [];
      }),
    readYesterdayRawLogs: overrides.readYesterdayRawLogs || runtimeFallbacks.readYesterdayRawLogs,
    repairOrphanVectors: overrides.repairOrphanVectors || runtimeFallbacks.repairOrphanVectors,
    resolveConfigConflicts: overrides.resolveConfigConflicts || runtimeFallbacks.resolveConfigConflicts,
  };
}

function installRuntimeFallbacks(fallbacks = {}) {
  runtimeFallbacks = { ...runtimeFallbacks, ...(fallbacks || {}) };
}

async function withRuntime(overrides, fn) {
  const prev = runtimeOverrides;
  runtimeOverrides = { ...(prev || {}), ...(overrides || {}) };
  try {
    return await fn();
  } finally {
    runtimeOverrides = prev;
  }
}

module.exports = {
  getRuntime,
  installRuntimeFallbacks,
  withRuntime,
};
