import {
  withCoreDbReadonly,
  withEngineDbIsolated,
  withIsolatedDbSession,
} from "../../db/isolated-dbs.js";

const REQUIRED_ACCESSORS = ["withCoreDb", "withEngineDb"];
export const HYBRID_ISOLATED_DB_SCOPE_REQUIRED = "HYBRID_ISOLATED_DB_SCOPE_REQUIRED";
export const CONTRACT_ERROR = HYBRID_ISOLATED_DB_SCOPE_REQUIRED;

function scopeError() {
  const error = new Error(HYBRID_ISOLATED_DB_SCOPE_REQUIRED);
  error.code = HYBRID_ISOLATED_DB_SCOPE_REQUIRED;
  return error;
}

function assertAccessors(access) {
  if (!access || typeof access !== "object" || REQUIRED_ACCESSORS.some((name) => typeof access[name] !== "function")) {
    throw scopeError();
  }
  if ("withDb" in access || "withLegacyDb" in access) {
    throw scopeError();
  }
  if (access.capabilities?.legacyFallbackAllowed === true) {
    throw scopeError();
  }
  return access;
}

function normalizeAccess(access) {
  const valid = assertAccessors(access);
  const capabilities = valid.capabilities && typeof valid.capabilities === "object"
    ? valid.capabilities
    : {};
  return {
    withCoreDb: valid.withCoreDb,
    withEngineDb: valid.withEngineDb,
    capabilities: {
      ...capabilities,
      isolatedFts: capabilities.isolatedFts === true,
      isolatedKg: capabilities.isolatedKg === true,
      isolatedRecent: capabilities.isolatedRecent === true,
      legacyFallbackAllowed: false,
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

export function runWithHybridDbAccessScope(runtime = {}, run) {
  if (typeof runtime?.withHybridDbAccessScope !== "function") {
    throw scopeError();
  }
  return runtime.withHybridDbAccessScope((access) => run(normalizeAccess(access)));
}
