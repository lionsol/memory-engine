const { resolveMemoryEnginePaths } = require("./paths.cjs");

function freezeRecord(value) {
  return Object.freeze({ ...(value || {}) });
}

function createMemoryEngineRuntimeDescriptor({
  pathOverrides = {},
  env = process.env,
} = {}) {
  const paths = freezeRecord(resolveMemoryEnginePaths(pathOverrides, env));
  const db = freezeRecord({
    coreDbPath: paths.coreDbPath,
    engineDbPath: paths.engineDbPath,
    engineDbDir: paths.engineDbDir,
  });

  return Object.freeze({ paths, db });
}

module.exports = {
  createMemoryEngineRuntimeDescriptor,
};
