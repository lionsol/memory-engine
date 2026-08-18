import {
  withCoreDbReadonly,
  withEngineDbIsolated,
  withIsolatedDbSession,
} from "../../db/isolated-dbs.js";

const REQUIRED_ACCESSORS = ["withCoreDb", "withEngineDb"];
const CONTRACT_ERROR = "hybridSearch DB access scope requires withCoreDb and withEngineDb";

function assertAccessors(access) {
  if (!access || REQUIRED_ACCESSORS.some((name) => typeof access[name] !== "function")) {
    throw new Error(CONTRACT_ERROR);
  }
  return access;
}

function legacyAccess(withDb) {
  return {
    withCoreDb: withDb,
    withEngineDb: withDb,
    withLegacyDb: withDb,
    capabilities: {
      isolatedFts: false,
      isolatedKg: false,
      isolatedRecent: false,
      legacyFallbackAllowed: true,
    },
  };
}

function normalizeAccess(access) {
  const valid = assertAccessors(access);
  return {
    ...valid,
    capabilities: {
      ...(valid.capabilities || {}),
      isolatedFts: valid.capabilities?.isolatedFts === true,
      isolatedKg: valid.capabilities?.isolatedKg === true,
      isolatedRecent: valid.capabilities?.isolatedRecent === true,
      legacyFallbackAllowed: valid.capabilities?.legacyFallbackAllowed === true
        || (valid.capabilities?.legacyFallbackAllowed !== false && typeof valid.withLegacyDb === "function"),
    },
  };
}

/**
 * Build the production hybrid reader scope. Handles are opened lazily inside
 * one request session and remain shared by all hybrid channels.
 */
export function createIsolatedHybridDbAccessScope(dbOptions = {}) {
  return function withHybridDbAccessScope(run) {
    return withIsolatedDbSession((session) => run({
      withCoreDb: (callback) => withCoreDbReadonly(callback, { ...dbOptions, session }),
      withEngineDb: (callback) => withEngineDbIsolated(callback, {
        ...dbOptions,
        readonly: true,
        session,
      }),
      capabilities: {
        isolatedFts: true,
        isolatedKg: true,
        isolatedRecent: true,
        legacyFallbackAllowed: false,
      },
    }), dbOptions);
  };
}

/**
 * Legacy compatibility adapter. Production runtime supplies an explicit
 * isolated scope and therefore never reaches this branch. Older tests/offline
 * callers may still provide one combined withDb accessor; those callers retain
 * legacy fallback capability explicitly and are not the production contract.
 */
export function runWithHybridDbAccessScope(runtime = {}, run) {
  if (typeof runtime.withHybridDbAccessScope === "function") {
    return runtime.withHybridDbAccessScope((access) => run(normalizeAccess(access)));
  }

  const withDb = runtime.withDb;
  if (typeof withDb !== "function") throw new Error("hybridSearch runtime.withDb is required");
  if (typeof withDb.scoped === "function") {
    return withDb.scoped((scopedWithDb) => run(assertAccessors(legacyAccess(scopedWithDb))));
  }
  return run(legacyAccess(withDb));
}

export { CONTRACT_ERROR };
