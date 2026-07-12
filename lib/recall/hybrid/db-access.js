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
    capabilities: { isolatedFts: false, isolatedKg: false },
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
    },
  };
}

/**
 * Phase 1B1 transitional contract. withCoreDb and withEngineDb name the
 * future isolated read scopes; withLegacyDb intentionally still permits the
 * existing cross-Core/Engine SQL. Isolated topology cannot safely provide
 * withLegacyDb until each channel has been migrated. The legacy adapter
 * defaults isolatedFts/isolatedKg to false; only an explicit scope provider
 * may opt in. Capabilities describe reader topology, not a security sandbox.
 * isolatedKg only permits an attempt; runtime routing still fail-closes behind
 * TEXT-ID guards. Other channels still use withLegacyDb, and Phase 1B1/1B2/1B3
 * do not remove runtime Core write risk.
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
