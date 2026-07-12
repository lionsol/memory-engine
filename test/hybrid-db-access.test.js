import test from "node:test";
import assert from "node:assert/strict";

import { hybridSearch } from "../lib/recall/hybrid-search.js";
import { CONTRACT_ERROR, runWithHybridDbAccessScope } from "../lib/recall/hybrid/db-access.js";

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
  }));
  assert.deepEqual(result, { core: "scoped", engine: "scoped", legacy: "scoped", isolatedFts: false });
  assert.equal(scopedRuns, 1);
  assert.equal(baseCalls, 0);
  assert.equal(runWithHybridDbAccessScope({ withDb: scopedAccessor }, access => access.capabilities.isolatedFts), false);
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
