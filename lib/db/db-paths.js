import runtimePaths from "../runtime/paths.cjs";

const { resolveMemoryEnginePaths } = runtimePaths;

export function resolveCoreDbPath(options = {}) {
  return resolveMemoryEnginePaths(options).coreDbPath;
}

export function resolveEngineDbPath(options = {}) {
  return resolveMemoryEnginePaths(options).engineDbPath;
}

export function resolveEngineDbDir(options = {}) {
  return resolveMemoryEnginePaths(options).engineDbDir;
}
