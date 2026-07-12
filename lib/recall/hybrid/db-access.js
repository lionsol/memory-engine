const REQUIRED_ACCESSORS = ["withCoreDb", "withEngineDb", "withLegacyDb"];
const CONTRACT_ERROR = "hybridSearch DB access scope requires withCoreDb, withEngineDb, and withLegacyDb";

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
  };
}

/**
 * Phase 1B1 transitional contract. withCoreDb and withEngineDb name the
 * future isolated read scopes; withLegacyDb intentionally still permits the
 * existing cross-Core/Engine SQL. Isolated topology cannot safely provide
 * withLegacyDb until each channel has been migrated. The legacy adapter keeps
 * current runtime behavior and is not a SQLite security boundary.
 */
export function runWithHybridDbAccessScope(runtime = {}, run) {
  if (typeof runtime.withHybridDbAccessScope === "function") {
    return runtime.withHybridDbAccessScope((access) => run(assertAccessors(access)));
  }

  const withDb = runtime.withDb;
  if (typeof withDb !== "function") throw new Error("hybridSearch runtime.withDb is required");
  if (typeof withDb.scoped === "function") {
    return withDb.scoped((scopedWithDb) => run(assertAccessors(legacyAccess(scopedWithDb))));
  }
  return run(legacyAccess(withDb));
}

export { CONTRACT_ERROR };
