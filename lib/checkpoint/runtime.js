const { AsyncLocalStorage } = require("node:async_hooks");
const { createMemoryEngineRuntimeDescriptor } = require("../runtime/descriptor.cjs");

const runtimeScope = new AsyncLocalStorage();
let runtimeFallbacks = {};

function buildScope(overrides = {}) {
  const normalizedOverrides = { ...(overrides || {}) };
  const pathOverrides = {
    ...normalizedOverrides,
    memoryDir: normalizedOverrides.memoryDir || process.env.MEMORY_ENGINE_MEMORY_DIR,
  };
  return Object.freeze({
    overrides: Object.freeze(normalizedOverrides),
    descriptor: createMemoryEngineRuntimeDescriptor({ pathOverrides }),
  });
}

const defaultScope = buildScope();

function getRuntime() {
  const scope = runtimeScope.getStore() || defaultScope;
  const overrides = scope.overrides;
  const paths = scope.descriptor.paths;

  return Object.freeze({
    descriptor: scope.descriptor,
    dbOptions: scope.descriptor.db,
    workspaceDir: paths.workspaceDir,
    memoryDir: paths.memoryDir,
    smartAddDir: paths.smartAddDir,
    generatedSmartAddDir: paths.generatedSmartAddDir,
    episodesDir: paths.episodesDir,
    checkpointLegacyDailyMirror: overrides.checkpointLegacyDailyMirror === true,
    sessionsDir: paths.sessionsDir,
    coreDbPath: paths.coreDbPath,
    engineDbPath: paths.engineDbPath,
    lancedbDir: paths.lancedbDir,
    configJsonPath: paths.configJsonPath,
    timeZone: paths.timeZone,
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
    flushCheckpointRawLog: overrides.flushCheckpointRawLog || runtimeFallbacks.flushCheckpointRawLog || (() => null),
    repairOrphanVectors: overrides.repairOrphanVectors || runtimeFallbacks.repairOrphanVectors,
    resolveConfigConflicts: overrides.resolveConfigConflicts || runtimeFallbacks.resolveConfigConflicts,
  });
}

function installRuntimeFallbacks(fallbacks = {}) {
  runtimeFallbacks = { ...runtimeFallbacks, ...(fallbacks || {}) };
}

async function withRuntime(overrides, fn) {
  if (typeof fn !== "function") throw new TypeError("withRuntime requires a callback");
  const parent = runtimeScope.getStore() || defaultScope;
  const scope = buildScope({ ...parent.overrides, ...(overrides || {}) });
  return runtimeScope.run(scope, fn);
}

module.exports = {
  getRuntime,
  installRuntimeFallbacks,
  withRuntime,
};
