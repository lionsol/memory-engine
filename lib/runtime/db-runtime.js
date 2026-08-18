import {
  withCoreDbReadonly,
  withEngineDbIsolated,
} from "../db/isolated-dbs.js";
import { createIsolatedHybridDbAccessScope } from "../recall/hybrid/db-access.js";

function requirePaths(paths) {
  if (!paths?.coreDbPath || !paths?.engineDbPath || !paths?.engineDbDir) {
    throw new TypeError("createMemoryEngineDbRuntime requires resolved Core and Engine DB paths");
  }
  return paths;
}

export function createMemoryEngineDbRuntime({ paths, busyTimeout } = {}) {
  const resolvedPaths = requirePaths(paths);
  const dbOptions = {
    coreDbPath: resolvedPaths.coreDbPath,
    engineDbPath: resolvedPaths.engineDbPath,
    engineDbDir: resolvedPaths.engineDbDir,
    ...(busyTimeout === undefined ? {} : { busyTimeout }),
  };

  const withCoreDb = (fn, options = {}) => withCoreDbReadonly(fn, {
    ...options,
    ...dbOptions,
  });

  const withIsolatedEngineDb = (fn, options = {}) => withEngineDbIsolated(fn, {
    ...options,
    ...dbOptions,
  });
  const withEngineDbReadonly = (fn, options = {}) => withIsolatedEngineDb(fn, {
    ...options,
    readonly: true,
  });
  const withEngineDbWritable = (fn, options = {}) => withIsolatedEngineDb(fn, {
    ...options,
    readonly: false,
  });

  return {
    paths: resolvedPaths,
    dbOptions,
    coreDbPath: resolvedPaths.coreDbPath,
    engineDbPath: resolvedPaths.engineDbPath,
    engineDbDir: resolvedPaths.engineDbDir,
    withCoreDb,
    withIsolatedEngineDb,
    withEngineDbReadonly,
    withEngineDbWritable,
    withHybridDbAccessScope: createIsolatedHybridDbAccessScope(dbOptions),
    ensureWritable: () => withEngineDbWritable((db) => {
      db.prepare("SELECT 1").get();
      return true;
    }),
  };
}
