const { existsSync } = require("node:fs");
const { homedir } = require("node:os");
const { dirname, resolve } = require("node:path");

const DEFAULT_TIME_ZONE = "Asia/Shanghai";
const SMART_ADD_RELATIVE_DIR = "memory/smart-add";
const INDEX_SYNC_WATCH_DIRS = Object.freeze([
  "memory/smart-add",
  "memory/episodes",
]);

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return undefined;
}

function resolveMemoryEnginePaths(options = {}, env = process.env) {
  const homeDir = resolve(String(firstDefined(options.homeDir, homedir())));
  const openclawDir = resolve(String(firstDefined(
    options.openclawDir,
    env.OPENCLAW_HOME,
    resolve(homeDir, ".openclaw"),
  )));
  const agentId = String(firstDefined(
    options.agentId,
    env.MEMORY_ENGINE_AGENT_ID,
    env.OPENCLAW_AGENT_ID,
    "main",
  ));
  const workspaceDir = resolve(String(firstDefined(
    options.workspaceDir,
    env.MEMORY_ENGINE_WORKSPACE_DIR,
    env.OPENCLAW_WORKSPACE,
    resolve(openclawDir, "workspace"),
  )));
  const memoryDir = resolve(String(firstDefined(
    options.memoryDir,
    resolve(workspaceDir, "memory"),
  )));
  const agentCoreDbPath = resolve(openclawDir, `agents/${agentId}/agent/openclaw-agent.sqlite`);
  const legacyCoreDbPath = resolve(openclawDir, "memory/main.sqlite");
  const defaultCoreDbPath = existsSync(agentCoreDbPath) ? agentCoreDbPath : legacyCoreDbPath;
  const coreDbPath = resolve(String(firstDefined(
    options.coreDbPath,
    env.MEMORY_ENGINE_CORE_DB_PATH,
    env.MEMORY_ENGINE_CORE_DB,
    env.CORE_DB_PATH,
    defaultCoreDbPath,
  )));
  const engineDbPath = resolve(String(firstDefined(
    options.engineDbPath,
    env.MEMORY_ENGINE_DB_PATH,
    env.MEMORY_ENGINE_DB,
    env.ENGINE_DB_PATH,
    resolve(openclawDir, "memory/memory-engine/memory-engine.sqlite"),
  )));
  const lancedbDir = resolve(String(firstDefined(
    options.lancedbDir,
    env.MEMORY_ENGINE_LANCEDB_DIR,
    resolve(openclawDir, "memory/lancedb"),
  )));
  const sessionsDir = resolve(String(firstDefined(
    options.sessionsDir,
    env.MEMORY_ENGINE_SESSIONS_DIR,
    resolve(openclawDir, `agents/${agentId}/sessions`),
  )));
  const configJsonPath = resolve(String(firstDefined(
    options.configJsonPath,
    env.OPENCLAW_CONFIG_PATH,
    resolve(openclawDir, "openclaw.json"),
  )));
  const smartAddDir = resolve(String(firstDefined(
    options.smartAddDir,
    resolve(memoryDir, "smart-add"),
  )));
  const generatedSmartAddDir = resolve(String(firstDefined(
    options.generatedSmartAddDir,
    resolve(memoryDir, "generated-smart-add"),
  )));
  const episodesDir = resolve(String(firstDefined(
    options.episodesDir,
    resolve(memoryDir, "episodes"),
  )));
  const kgPath = resolve(String(firstDefined(
    options.kgPath,
    env.MEMORY_ENGINE_KG_PATH,
    resolve(workspaceDir, "knowledge-graph.json"),
  )));
  const timeZone = String(firstDefined(
    options.timeZone,
    env.MEMORY_ENGINE_TIME_ZONE,
    DEFAULT_TIME_ZONE,
  ));

  return {
    homeDir,
    openclawDir,
    agentId,
    workspaceDir,
    memoryDir,
    smartAddDir,
    generatedSmartAddDir,
    episodesDir,
    sessionsDir,
    coreDbPath,
    engineDbPath,
    engineDbDir: dirname(engineDbPath),
    lancedbDir,
    configJsonPath,
    kgPath,
    timeZone,
  };
}

module.exports = {
  DEFAULT_TIME_ZONE,
  INDEX_SYNC_WATCH_DIRS,
  SMART_ADD_RELATIVE_DIR,
  resolveMemoryEnginePaths,
};
