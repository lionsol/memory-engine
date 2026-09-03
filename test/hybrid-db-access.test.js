import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { hybridSearch } from "../lib/recall/hybrid-search.js";
import {
  CONTRACT_ERROR,
  createIsolatedHybridDbAccessScope,
  runWithHybridDbAccessScope,
} from "../lib/recall/hybrid/db-access.js";

const ISOLATED_SCOPE_ERROR = "HYBRID_ISOLATED_DB_SCOPE_REQUIRED";

function isolatedFactoryFixture() {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-hybrid-scope-"));
  const coreDbPath = join(root, "core.sqlite");
  const engineDbPath = join(root, "engine.sqlite");
  const core = new Database(coreDbPath);
  core.exec("CREATE TABLE chunks (id TEXT PRIMARY KEY, text TEXT)");
  core.close();
  const engine = new Database(engineDbPath);
  engine.exec("CREATE TABLE memory_confidence (chunk_id TEXT PRIMARY KEY, confidence REAL)");
  engine.close();
  return { root, coreDbPath, engineDbPath };
}

function rowsFor(sql) {
  if (sql.includes("SELECT chunk_id") && sql.includes("FROM memory_confidence")) {
    return [{
      chunk_id: "chunk-1234567890abcdef",
      confidence: 0.8,
      last_confidence_update: 0,
      base_tau: 7,
      hit_count: 2,
      is_protected: 0,
      conflict_flag: 0,
      category: "raw_log",
      is_archived: 0,
    }];
  }
  if (sql.includes("SELECT id, path, updated_at FROM chunks")) {
    return [{ id: "chunk-1234567890abcdef", path: "memory/smart-add/test.md", updated_at: 1710000000 }];
  }
  return [];
}

function accessorFor(name, calls, { fail = null } = {}) {
  return (run) => {
    calls[name] = (calls[name] || 0) + 1;
    return run({
      prepare(sql) {
        const query = String(sql);
        if (fail && fail(query)) throw new Error(`${name} reader failure`);
        return { all: (...args) => rowsFor(query, args), get: () => null };
      },
    });
  };
}

function runtimeWithExplicitAccess(access, calls, extra = {}) {
  return {
    withHybridDbAccessScope: async (run) => {
      calls.scopeOpened = (calls.scopeOpened || 0) + 1;
      try {
        return await run(access);
      } finally {
        calls.scopeClosed = (calls.scopeClosed || 0) + 1;
      }
    },
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getMemorySearchManager: async () => ({ manager: { search: async () => ({ entries: [] }) } }),
    ...extra,
  };
}

test("production isolated factory exposes all channel capabilities and main-only handles", async () => {
  const paths = isolatedFactoryFixture();
  try {
    let coreHandle;
    let engineHandle;
    const withHybridDbAccessScope = createIsolatedHybridDbAccessScope(paths);

    const result = await withHybridDbAccessScope(async access => {
      assert.deepEqual(access.capabilities, {
        isolatedFts: true,
        isolatedKg: true,
        isolatedRecent: true,
        legacyFallbackAllowed: false,
      });
      assert.equal("withLegacyDb" in access, false);
      coreHandle = access.withCoreDb(db => db);
      engineHandle = access.withEngineDb(db => db);
      assert.deepEqual(coreHandle.prepare("PRAGMA database_list").all().map(row => row.name), ["main"]);
      assert.deepEqual(engineHandle.prepare("PRAGMA database_list").all().map(row => row.name), ["main"]);
      assert.throws(
        () => coreHandle.prepare("INSERT INTO chunks (id, text) VALUES ('blocked', 'x')").run(),
        error => error.code === "SQLITE_READONLY",
      );
      assert.throws(
        () => engineHandle.prepare("INSERT INTO memory_confidence (chunk_id, confidence) VALUES ('blocked', 0.1)").run(),
        error => error.code === "SQLITE_READONLY",
      );
      return "scope-result";
    });

    assert.equal(result, "scope-result");
    assert.throws(() => coreHandle.prepare("SELECT 1").get(), /closed|not open/i);
    assert.throws(() => engineHandle.prepare("SELECT 1").get(), /closed|not open/i);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("explicit DB access scope routes metadata and channels to the declared readers", async () => {
  const calls = {};
  const access = {
    withCoreDb: accessorFor("core", calls),
    withEngineDb: accessorFor("engine", calls),
  };
  let fallbackCalls = 0;
  const runtime = runtimeWithExplicitAccess(access, calls, {
    withDb: () => {
      fallbackCalls += 1;
      throw new Error("legacy fallback must not be called");
    },
  });

  const result = await hybridSearch("ordinary query", { topK: 3 }, runtime);
  assert.equal(result.pool, 0);
  assert.equal(calls.scopeOpened, 1);
  assert.equal(calls.scopeClosed, 1);
  assert.equal(calls.engine > 0, true);
  assert.equal(calls.core > 0, true);
  assert.equal(fallbackCalls, 0);
});

test("incomplete explicit contracts fail closed without using legacy fallback", async () => {
  for (const missing of ["withCoreDb", "withEngineDb"]) {
    let fallbackCalls = 0;
    const access = {
      withCoreDb: () => undefined,
      withEngineDb: () => undefined,
    };
    delete access[missing];
    await assert.rejects(
      hybridSearch("query", {}, {
        withHybridDbAccessScope: async run => run(access),
        withDb: () => {
          fallbackCalls += 1;
          throw new Error("fallback must not run");
        },
        calcRealtimeConf: row => row.confidence,
        syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
      }),
      error => error.code === CONTRACT_ERROR && error.message === CONTRACT_ERROR,
    );
    assert.equal(fallbackCalls, 0, missing);
  }
});

test("combined runtime.withDb is rejected before any legacy accessor can run", async () => {
  let scopedRuns = 0;
  let baseCalls = 0;
  const scopedAccessor = fn => fn({ marker: "scoped" });
  const withDb = fn => {
    baseCalls += 1;
    return fn({ marker: "base" });
  };
  withDb.scoped = async run => {
    scopedRuns += 1;
    return run(scopedAccessor);
  };
  assert.throws(
    () => runWithHybridDbAccessScope({ withDb }, () => {
      throw new Error("combined scope must not reach the callback");
    }),
    error => error?.code === ISOLATED_SCOPE_ERROR && error.message === ISOLATED_SCOPE_ERROR,
  );
  assert.equal(scopedRuns, 0);
  assert.equal(baseCalls, 0);
});

test("hybridSearch rejects a withDb-only runtime before opening a database", async () => {
  let dbCalls = 0;
  await assert.rejects(
    hybridSearch("query", {}, {
      withDb: () => {
        dbCalls += 1;
        throw new Error("legacy reader must not run");
      },
      calcRealtimeConf: row => row.confidence,
    }),
    error => error?.code === ISOLATED_SCOPE_ERROR && error.message === ISOLATED_SCOPE_ERROR,
  );
  assert.equal(dbCalls, 0);
});

test("explicit combined access cannot enable legacy fallback", async () => {
  let legacyCalls = 0;
  const access = {
    withCoreDb: run => run({ marker: "core" }),
    withEngineDb: run => run({ marker: "engine" }),
    withLegacyDb: () => {
      legacyCalls += 1;
      throw new Error("legacy reader must not run");
    },
    capabilities: {
      isolatedFts: true,
      isolatedKg: true,
      isolatedRecent: true,
      legacyFallbackAllowed: true,
    },
  };
  await assert.rejects(
    runWithHybridDbAccessScope({
      withHybridDbAccessScope: async run => run(access),
    }, () => {
      throw new Error("combined access must not reach the callback");
    }),
    error => error?.code === ISOLATED_SCOPE_ERROR && error.message === ISOLATED_SCOPE_ERROR,
  );
  assert.equal(legacyCalls, 0);
});

test("malformed isolated scopes fail at the scope callback boundary", async () => {
  for (const malformed of [null, undefined, {}, "not-an-accessor"]) {
    let scopedRuns = 0;
    let runCalls = 0;
    const withHybridDbAccessScope = async run => {
      scopedRuns += 1;
      return run(malformed);
    };

    await assert.rejects(
      runWithHybridDbAccessScope({ withHybridDbAccessScope }, () => {
        runCalls += 1;
      }),
      error => error.code === CONTRACT_ERROR && error.message === CONTRACT_ERROR,
    );
    assert.equal(runCalls, 0, String(malformed));
    assert.equal(scopedRuns, 1, String(malformed));
  }
});

test("production Hybrid source exposes only the isolated reader contract", () => {
  const dbAccessSource = readFileSync(new URL("../lib/recall/hybrid/db-access.js", import.meta.url), "utf8");
  const hybridSearchSource = readFileSync(new URL("../lib/recall/hybrid-search.js", import.meta.url), "utf8");
  const channelRuntimeSource = readFileSync(new URL("../lib/recall/hybrid/channel-runtime.js", import.meta.url), "utf8");
  assert.doesNotMatch(dbAccessSource, /legacyAccess/);
  assert.doesNotMatch(hybridSearchSource, /withLegacyDb/);
  assert.doesNotMatch(channelRuntimeSource, /withDb/);
  assert.doesNotMatch(channelRuntimeSource, /legacyFallbackAllowed:\s*true/);
});

test("explicit scope resolves and rejects with one lifecycle", async () => {
  const resolvedCalls = { opened: 0, closed: 0 };
  const resolved = await hybridSearch("query", {}, runtimeWithExplicitAccess({
    withCoreDb: accessorFor("core", {}),
    withEngineDb: accessorFor("engine", {}),
  }, resolvedCalls));
  assert.equal(resolvedCalls.scopeOpened, 1);
  assert.equal(resolvedCalls.scopeClosed, 1);
  assert.equal(resolved.pool, 0);

  const rejectedCalls = { scopeOpened: 0, scopeClosed: 0 };
  await assert.rejects(hybridSearch("query", {}, runtimeWithExplicitAccess({
    withCoreDb: accessorFor("core", {}, { fail: sql => sql.includes("SELECT id, path, updated_at") }),
    withEngineDb: accessorFor("engine", {}),
  }, rejectedCalls)), /core reader failure/);
  assert.equal(rejectedCalls.scopeOpened, 1);
  assert.equal(rejectedCalls.scopeClosed, 1);
});

test("isolatedFts capability requires strict true and routes only FTS to Core", async () => {
  for (const capability of [undefined, false, "true", 1, null, {}, []]) {
    const sqlByReader = { core: [], engine: [], legacy: [] };
    const reader = name => run => run({
      prepare(sql) {
        sqlByReader[name].push(String(sql));
        return {
          all: () => name === "engine"
            ? [{ chunk_id: "chunk-1", confidence: 0.8, category: "raw_log", is_archived: 0 }]
            : name === "core"
              ? [{ id: "chunk-1", path: "memory/a.md", updated_at: 1 }]
              : [],
        };
      },
    });
    const access = {
      withCoreDb: reader("core"),
      withEngineDb: reader("engine"),
    };
    if (capability !== undefined) access.capabilities = { isolatedFts: capability };
    await hybridSearch("capability query", {}, {
      withHybridDbAccessScope: async run => run(access),
      calcRealtimeConf: row => row.confidence,
      syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
      getMemorySearchManager: async () => ({ manager: { search: async () => ({ entries: [] }) } }),
    });
    assert.equal(sqlByReader.engine.length, 1);
    assert.equal(sqlByReader.core.some(sql => sql.includes("chunks_fts")), true, String(capability));
    assert.equal(sqlByReader.legacy.length, 0, String(capability));
  }

  const sqlByReader = { core: [], engine: [], legacy: [] };
  const reader = name => run => run({
    prepare(sql) {
      sqlByReader[name].push(String(sql));
      return { all: () => name === "engine"
        ? [{ chunk_id: "chunk-1", confidence: 0.8, category: "raw_log", is_archived: 0 }]
        : name === "core" ? [{ id: "chunk-1", path: "memory/a.md", updated_at: 1 }] : [] };
    },
  });
  await hybridSearch("capability query", {}, {
    withHybridDbAccessScope: async run => run({
      withCoreDb: reader("core"),
      withEngineDb: reader("engine"),
      capabilities: { isolatedFts: true },
    }),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getMemorySearchManager: async () => ({ manager: { search: async () => ({ entries: [] }) } }),
  });
  assert.equal(sqlByReader.engine.length, 1);
  assert.equal(sqlByReader.core.some(sql => sql.includes("chunks_fts") && sql.includes("json_each")), true);
  assert.equal(sqlByReader.legacy.length, 0);
});

test("isolatedKg capability requires strict true and stays independent from isolatedFts", async () => {
  for (const capability of [undefined, false, "true", 1, null, {}, []]) {
    const result = await runWithHybridDbAccessScope({
      withHybridDbAccessScope: async run => run({
        withCoreDb: run => run({ marker: "core" }),
        withEngineDb: run => run({ marker: "engine" }),
        capabilities: capability === undefined ? { isolatedFts: true } : { isolatedFts: true, isolatedKg: capability },
      }),
    }, access => access.capabilities);
    assert.equal(result.isolatedFts, true, String(capability));
    assert.equal(result.isolatedKg, false, String(capability));
  }

  const enabled = await runWithHybridDbAccessScope({
    withHybridDbAccessScope: async run => run({
      withCoreDb: run => run({ marker: "core" }),
      withEngineDb: run => run({ marker: "engine" }),
      capabilities: { isolatedFts: false, isolatedKg: true },
    }),
  }, access => access.capabilities);
  assert.equal(enabled.isolatedFts, false);
  assert.equal(enabled.isolatedKg, true);
});

test("isolatedRecent capability requires strict true and stays independent from isolatedFts and isolatedKg", async () => {
  for (const capability of [undefined, false, "true", 1, null, {}, []]) {
    const result = await runWithHybridDbAccessScope({
      withHybridDbAccessScope: async run => run({
        withCoreDb: run => run({ marker: "core" }),
        withEngineDb: run => run({ marker: "engine" }),
        capabilities: capability === undefined
          ? { isolatedFts: true, isolatedKg: true }
          : { isolatedFts: true, isolatedKg: true, isolatedRecent: capability },
      }),
    }, access => access.capabilities);
    assert.equal(result.isolatedFts, true, String(capability));
    assert.equal(result.isolatedKg, true, String(capability));
    assert.equal(result.isolatedRecent, false, String(capability));
  }

  const enabled = await runWithHybridDbAccessScope({
    withHybridDbAccessScope: async run => run({
      withCoreDb: run => run({ marker: "core" }),
      withEngineDb: run => run({ marker: "engine" }),
      capabilities: { isolatedFts: false, isolatedKg: false, isolatedRecent: true },
    }),
  }, access => access.capabilities);
  assert.equal(enabled.isolatedFts, false);
  assert.equal(enabled.isolatedKg, false);
  assert.equal(enabled.isolatedRecent, true);
});

test("hybridSearch routes KG to isolated readers only when capability is true and snapshot IDs are all text", async () => {
  const sqlByReader = { core: [], engine: [], legacy: [] };
  const reader = name => run => run({
    prepare(sql) {
      const query = String(sql);
      sqlByReader[name].push(query);
      return {
        all() {
          if (name === "engine" && query.includes("SELECT chunk_id, confidence")) {
            return [{ chunk_id: "chunk-1", confidence: 0.8, last_confidence_update: 0, base_tau: 7, hit_count: 2, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 0 }];
          }
          if (name === "core" && query.includes("SELECT id, path, updated_at FROM chunks")) {
            return [{ id: "chunk-1", path: "memory/a.md", updated_at: 1 }];
          }
          if (name === "engine" && query.includes("typeof(chunk_id) AS chunk_id_storage_class")) {
            return [{ chunk_id: "chunk-1", chunk_id_storage_class: "text", confidence: 0.8, last_confidence_update: 0, base_tau: 7, hit_count: 2, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 0, kg_data: "ordinary query node" }];
          }
          if (name === "core" && query.includes("FROM json_each(?) AS candidate")) {
            return [{ id: "chunk-1", text: "ordinary query note", path: "memory/a.md", updated_at: 1 }];
          }
          return [];
        },
        get: () => null,
      };
    },
  });

  const result = await hybridSearch("ordinary query", {}, {
    withHybridDbAccessScope: async run => run({
      withCoreDb: reader("core"),
      withEngineDb: reader("engine"),
      capabilities: { isolatedKg: true },
    }),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getMemorySearchManager: async () => ({ manager: { search: async () => ({ entries: [] }) } }),
  });

  assert.equal(sqlByReader.engine.some(sql => sql.includes("typeof(chunk_id) AS chunk_id_storage_class")), true);
  assert.equal(sqlByReader.core.some(sql => sql.includes("FROM json_each(?) AS candidate")), true);
  assert.equal(sqlByReader.legacy.some(sql => sql.includes("FROM memory_confidence mc") && sql.includes("mc.kg_data LIKE")), false);
  assert.equal(result.debug.kg_access_mode, "isolated");
});

test("hybridSearch blocks KG when isolated identity is invalid", async () => {
  const sqlByReader = { core: [], engine: [], legacy: [] };
  const reader = name => run => run({
    prepare(sql) {
      const query = String(sql);
      sqlByReader[name].push(query);
      return {
        all() {
          if (name === "engine" && query.includes("SELECT chunk_id, confidence")) {
            return [{ chunk_id: Buffer.from("blob-id"), confidence: 0.8, last_confidence_update: 0, base_tau: 7, hit_count: 2, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 0 }];
          }
          if (name === "core" && query.includes("SELECT id, path, updated_at FROM chunks")) {
            return [{ id: "chunk-1", path: "memory/a.md", updated_at: 1 }];
          }
          if (name === "legacy" && query.includes("FROM memory_confidence mc") && query.includes("mc.kg_data LIKE")) {
            return [{ id: "chunk-1", text: "ordinary query note", path: "memory/a.md", updated_at: 1, confidence: 0.8, last_confidence_update: 0, base_tau: 7, hit_count: 2, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 0, kg_data: "ordinary query node" }];
          }
          return [];
        },
        get: () => null,
      };
    },
  });

  const result = await hybridSearch("ordinary query", {}, {
    withHybridDbAccessScope: async run => run({
      withCoreDb: reader("core"),
      withEngineDb: reader("engine"),
      capabilities: { isolatedKg: true },
    }),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getMemorySearchManager: async () => ({ manager: { search: async () => ({ entries: [] }) } }),
  });

  assert.equal(sqlByReader.engine.some(sql => sql.includes("typeof(chunk_id) AS chunk_id_storage_class")), false);
  assert.equal(sqlByReader.core.some(sql => sql.includes("FROM json_each(?) AS candidate")), false);
  assert.equal(sqlByReader.legacy.length, 0);
  assert.equal(result.debug.kg_access_mode, "isolated_blocked");
  assert.equal(result.debug.kg_isolated_fallback_reason, "text_id_invariant_failed");
  assert.equal(result.debug.kg_legacy_fallback_disabled, true);
});

test("hybridSearch routes Recent to isolated readers only when capability is true and snapshot IDs are all text", async () => {
  const sqlByReader = { core: [], engine: [], legacy: [] };
  const reader = name => run => run({
    readonly: true,
    prepare(sql) {
      const query = String(sql);
      sqlByReader[name].push(query);
      return {
        all(...args) {
          if (query.includes("PRAGMA database_list")) {
            return [{ name: "main" }];
          }
          if (name === "engine" && query.includes("SELECT chunk_id, confidence")) {
            return [{ chunk_id: "chunk-1", confidence: 0.8, last_confidence_update: 0, base_tau: 7, hit_count: 2, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 0 }];
          }
          if (name === "core" && query.includes("SELECT id, path, updated_at FROM chunks")) {
            return [{ id: "chunk-1", path: "memory/smart-add/a.md", updated_at: 1 }];
          }
          if (name === "engine" && query.includes("COALESCE(is_archived, 0) != 0")) {
            return [];
          }
          if (name === "core" && query.includes("NOT IN") && query.includes("memory/smart-add/%")) {
            return [{ id: "chunk-1", text: "ordinary query note", path: "memory/smart-add/a.md", updated_at: 1 }];
          }
          if (name === "engine" && query.includes("WITH selected AS")) {
            return [{ chunk_id: "chunk-1", confidence: 0.8, last_confidence_update: 0, base_tau: 7, hit_count: 2, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 0 }];
          }
          return [];
        },
        get: () => null,
      };
    },
  });

  const result = await hybridSearch("ordinary query", {}, {
    withHybridDbAccessScope: async run => run({
      withCoreDb: reader("core"),
      withEngineDb: reader("engine"),
      capabilities: { isolatedRecent: true },
    }),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getMemorySearchManager: async () => ({ manager: { search: async () => ({ entries: [] }) } }),
  });

  assert.equal(sqlByReader.engine.some(sql => sql.includes("COALESCE(is_archived, 0) != 0")), true);
  assert.equal(sqlByReader.engine.some(sql => sql.includes("WITH selected AS")), true);
  assert.equal(sqlByReader.core.some(sql => sql.includes("NOT IN") && sql.includes("memory/smart-add/%")), true);
  assert.equal(
    sqlByReader.legacy.some(sql => sql.includes("LEFT JOIN memory_confidence") && sql.includes("memory/smart-add/%")),
    false,
  );
  assert.equal(result.debug.recent_access_mode, "isolated");
});

test("hybridSearch blocks Recent when isolated identity is invalid", async () => {
  const sqlByReader = { core: [], engine: [], legacy: [] };
  const reader = name => run => run({
    readonly: true,
    prepare(sql) {
      const query = String(sql);
      sqlByReader[name].push(query);
      return {
        all() {
          if (query.includes("PRAGMA database_list")) {
            return [{ name: "main" }];
          }
          if (name === "engine" && query.includes("SELECT chunk_id, confidence")) {
            return [{ chunk_id: Buffer.from("blob-id"), confidence: 0.8, last_confidence_update: 0, base_tau: 7, hit_count: 2, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 0 }];
          }
          if (name === "core" && query.includes("SELECT id, path, updated_at FROM chunks")) {
            return [{ id: "chunk-1", path: "memory/smart-add/a.md", updated_at: 1 }];
          }
          if (name === "legacy" && query.includes("LEFT JOIN memory_confidence") && query.includes("memory/smart-add/%")) {
            return [{ id: "chunk-1", text: "ordinary query note", path: "memory/smart-add/a.md", updated_at: 1, confidence: 0.8, last_confidence_update: 0, base_tau: 7, hit_count: 2, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 0 }];
          }
          return [];
        },
        get: () => null,
      };
    },
  });

  const result = await hybridSearch("ordinary query", {}, {
    withHybridDbAccessScope: async run => run({
      withCoreDb: reader("core"),
      withEngineDb: reader("engine"),
      capabilities: { isolatedRecent: true },
    }),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getMemorySearchManager: async () => ({ manager: { search: async () => ({ entries: [] }) } }),
  });

  assert.equal(sqlByReader.engine.some(sql => sql.includes("COALESCE(is_archived, 0) != 0")), false);
  assert.equal(sqlByReader.engine.some(sql => sql.includes("WITH selected AS")), false);
  assert.equal(sqlByReader.core.some(sql => sql.includes("NOT EXISTS") && sql.includes("memory/smart-add/%")), false);
  assert.equal(sqlByReader.legacy.length, 0);
  assert.equal(result.debug.recent_access_mode, "isolated_blocked");
  assert.equal(result.debug.recent_isolated_fallback_reason, "isolated_recent_engine_id_invariant_failed");
  assert.equal(result.debug.recent_legacy_fallback_disabled, true);
});
