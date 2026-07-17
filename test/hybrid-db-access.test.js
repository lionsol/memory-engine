import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { hybridSearch } from "../lib/recall/hybrid-search.js";
import {
  CONTRACT_ERROR,
  createIsolatedHybridDbAccessScope,
  runWithHybridDbAccessScope,
} from "../lib/recall/hybrid/db-access.js";

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
    const withHybridDbAccessScope = createIsolatedHybridDbAccessScope({
      ...paths,
      withLegacyDb: () => {
        throw new Error("legacy accessor must not be used");
      },
    });

    const result = await withHybridDbAccessScope(async access => {
      assert.deepEqual(access.capabilities, {
        isolatedFts: true,
        isolatedKg: true,
        isolatedRecent: true,
      });
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
  const channelSql = [];
  const access = {
    withCoreDb: accessorFor("core", calls),
    withEngineDb: accessorFor("engine", calls),
    withLegacyDb: run => {
      calls.legacy = (calls.legacy || 0) + 1;
      return run({
        prepare(sql) {
          channelSql.push(String(sql));
          return { all: () => [], get: () => null };
        },
      });
    },
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
  assert.equal(calls.engine, 1);
  assert.equal(calls.core, 1);
  assert.equal(calls.legacy > 0, true);
  assert.equal(channelSql.some(sql => sql.includes("chunks_fts")), true);
  assert.equal(channelSql.some(sql => sql.includes("FROM chunks c")), true);
  assert.equal(fallbackCalls, 0);
});

test("incomplete explicit contracts fail closed without using legacy fallback", async () => {
  for (const missing of ["withCoreDb", "withEngineDb", "withLegacyDb"]) {
    let fallbackCalls = 0;
    const access = {
      withCoreDb: () => undefined,
      withEngineDb: () => undefined,
      withLegacyDb: () => undefined,
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
      error => error.message === CONTRACT_ERROR,
    );
    assert.equal(fallbackCalls, 0, missing);
  }
});

test("legacy adapter uses one scoped entry and maps all readers to the scoped accessor", async () => {
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
  const result = await runWithHybridDbAccessScope({ withDb }, async access => ({
    core: await access.withCoreDb(db => db.marker),
    engine: await access.withEngineDb(db => db.marker),
    legacy: await access.withLegacyDb(db => db.marker),
    isolatedFts: access.capabilities.isolatedFts,
    isolatedKg: access.capabilities.isolatedKg,
    isolatedRecent: access.capabilities.isolatedRecent,
  }));
  assert.deepEqual(result, {
    core: "scoped",
    engine: "scoped",
    legacy: "scoped",
    isolatedFts: false,
    isolatedKg: false,
    isolatedRecent: false,
  });
  assert.equal(scopedRuns, 1);
  assert.equal(baseCalls, 0);
  assert.equal(runWithHybridDbAccessScope({ withDb: scopedAccessor }, access => access.capabilities.isolatedFts), false);
  assert.equal(runWithHybridDbAccessScope({ withDb: scopedAccessor }, access => access.capabilities.isolatedKg), false);
  assert.equal(runWithHybridDbAccessScope({ withDb: scopedAccessor }, access => access.capabilities.isolatedRecent), false);
});

test("malformed legacy scoped accessors fail at the scope callback boundary", async () => {
  for (const malformed of [null, undefined, {}, "not-an-accessor"]) {
    let scopedRuns = 0;
    let baseCalls = 0;
    let runCalls = 0;
    const withDb = fn => {
      baseCalls += 1;
      return fn({ marker: "base" });
    };
    withDb.scoped = async run => {
      scopedRuns += 1;
      return run(malformed);
    };

    await assert.rejects(
      runWithHybridDbAccessScope({ withDb }, () => {
        runCalls += 1;
      }),
      error => error.message === CONTRACT_ERROR && !error.message.includes("withCoreDb is not a function"),
    );
    assert.equal(runCalls, 0, String(malformed));
    assert.equal(baseCalls, 0, String(malformed));
    assert.equal(scopedRuns, 1, String(malformed));
  }
});

test("explicit scope resolves and rejects with one lifecycle", async () => {
  const resolvedCalls = { opened: 0, closed: 0 };
  const resolved = await hybridSearch("query", {}, runtimeWithExplicitAccess({
    withCoreDb: accessorFor("core", {}),
    withEngineDb: accessorFor("engine", {}),
    withLegacyDb: accessorFor("legacy", {}),
  }, resolvedCalls));
  assert.equal(resolvedCalls.scopeOpened, 1);
  assert.equal(resolvedCalls.scopeClosed, 1);
  assert.equal(resolved.pool, 0);

  const rejectedCalls = { scopeOpened: 0, scopeClosed: 0 };
  await assert.rejects(hybridSearch("query", {}, runtimeWithExplicitAccess({
    withCoreDb: accessorFor("core", {}, { fail: sql => sql.includes("SELECT id, path, updated_at") }),
    withEngineDb: accessorFor("engine", {}),
    withLegacyDb: accessorFor("legacy", {}),
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
      withLegacyDb: reader("legacy"),
    };
    if (capability !== undefined) access.capabilities = { isolatedFts: capability };
    await hybridSearch("capability query", {}, {
      withHybridDbAccessScope: async run => run(access),
      calcRealtimeConf: row => row.confidence,
      syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
      getMemorySearchManager: async () => ({ manager: { search: async () => ({ entries: [] }) } }),
    });
    assert.equal(sqlByReader.engine.length, 1);
    assert.equal(sqlByReader.core.some(sql => sql.includes("SELECT id, path, updated_at FROM chunks")), true);
    assert.equal(sqlByReader.core.some(sql => sql.includes("chunks_fts")), false, String(capability));
    assert.equal(sqlByReader.legacy.some(sql => sql.includes("chunks_fts")), true, String(capability));
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
      withLegacyDb: reader("legacy"),
      capabilities: { isolatedFts: true },
    }),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getMemorySearchManager: async () => ({ manager: { search: async () => ({ entries: [] }) } }),
  });
  assert.equal(sqlByReader.engine.length, 1);
  assert.equal(sqlByReader.core.some(sql => sql.includes("chunks_fts") && sql.includes("json_each")), true);
  assert.equal(sqlByReader.legacy.some(sql => sql.includes("chunks_fts")), false);
  assert.equal(sqlByReader.legacy.length > 0, true);
});

test("isolatedKg capability requires strict true and stays independent from isolatedFts", async () => {
  for (const capability of [undefined, false, "true", 1, null, {}, []]) {
    const result = await runWithHybridDbAccessScope({
      withHybridDbAccessScope: async run => run({
        withCoreDb: run => run({ marker: "core" }),
        withEngineDb: run => run({ marker: "engine" }),
        withLegacyDb: run => run({ marker: "legacy" }),
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
      withLegacyDb: run => run({ marker: "legacy" }),
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
        withLegacyDb: run => run({ marker: "legacy" }),
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
      withLegacyDb: run => run({ marker: "legacy" }),
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
      withLegacyDb: reader("legacy"),
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

test("hybridSearch falls back KG to legacy when isolatedKg is requested but snapshot IDs are not all text", async () => {
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
      withLegacyDb: reader("legacy"),
      capabilities: { isolatedKg: true },
    }),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getMemorySearchManager: async () => ({ manager: { search: async () => ({ entries: [] }) } }),
  });

  assert.equal(sqlByReader.engine.some(sql => sql.includes("typeof(chunk_id) AS chunk_id_storage_class")), false);
  assert.equal(sqlByReader.core.some(sql => sql.includes("FROM json_each(?) AS candidate")), false);
  assert.equal(sqlByReader.legacy.some(sql => sql.includes("FROM memory_confidence mc") && sql.includes("mc.kg_data LIKE")), true);
  assert.equal(result.debug.kg_access_mode, "legacy_fallback");
  assert.equal(result.debug.kg_isolated_fallback_reason, "text_id_invariant_failed");
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
      withLegacyDb: reader("legacy"),
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

test("hybridSearch falls back Recent to legacy when isolatedRecent is requested but snapshot IDs are not all text", async () => {
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
      withLegacyDb: reader("legacy"),
      capabilities: { isolatedRecent: true },
    }),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getMemorySearchManager: async () => ({ manager: { search: async () => ({ entries: [] }) } }),
  });

  assert.equal(sqlByReader.engine.some(sql => sql.includes("COALESCE(is_archived, 0) != 0")), false);
  assert.equal(sqlByReader.engine.some(sql => sql.includes("WITH selected AS")), false);
  assert.equal(sqlByReader.core.some(sql => sql.includes("NOT EXISTS") && sql.includes("memory/smart-add/%")), false);
  assert.equal(
    sqlByReader.legacy.some(sql => sql.includes("LEFT JOIN memory_confidence") && sql.includes("memory/smart-add/%")),
    true,
  );
  assert.equal(result.debug.recent_access_mode, "guarded_fallback");
  assert.equal(result.debug.recent_isolated_fallback_reason, "isolated_recent_engine_id_invariant_failed");
});
