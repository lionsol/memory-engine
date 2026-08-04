import {
  ensureEngineWritable,
  openEngineDb,
  withEngineDb,
  withEngineDbSession,
} from "../db/engine-db.js";
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

  const openDb = (options = {}) => openEngineDb({
    ...options,
    ...dbOptions,
    readonly: options.readonly ?? false,
  });

  const withDb = (fn, options = {}) => withEngineDb(fn, {
    ...options,
    ...dbOptions,
    readonly: options.readonly ?? false,
  });

  withDb.scoped = function scopedWithDb(run) {
    return withEngineDbSession(session => run((fn, options = {}) => withDb(fn, {
      ...options,
      session,
    })));
  };

  const withCoreDb = (fn, options = {}) => withCoreDbReadonly(fn, {
    ...options,
    ...dbOptions,
  });

  const withIsolatedEngineDb = (fn, options = {}) => withEngineDbIsolated(fn, {
    ...options,
    ...dbOptions,
  });

  return {
    paths: resolvedPaths,
    dbOptions,
    coreDbPath: resolvedPaths.coreDbPath,
    engineDbPath: resolvedPaths.engineDbPath,
    engineDbDir: resolvedPaths.engineDbDir,
    openDb,
    withDb,
    withCoreDb,
    withIsolatedEngineDb,
    withHybridDbAccessScope: createIsolatedHybridDbAccessScope({
      ...dbOptions,
      withLegacyDb: withDb,
    }),
    ensureWritable: () => ensureEngineWritable(dbOptions),
  };
}
