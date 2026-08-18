import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkpoint = require("../bin/session-checkpoint.js");
const orphanRepair = require("../lib/checkpoint/orphan-repair.js");

function createFixture({
  coreRows = [
    { id: "chunk-1", text: "body 1" },
    { id: "chunk-2", text: "body 2" },
  ],
  engineRows = [
    { chunk_id: "chunk-1", category: "raw_log", is_archived: 0 },
    { chunk_id: "chunk-2", category: "raw_log", is_archived: 0 },
  ],
  createEngine = true,
  createEngineSchema = true,
} = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-checkpoint-orphan-"));
  const workspaceDir = resolve(root, "workspace");
  const memoryDir = resolve(root, "memory");
  const lancedbDir = resolve(root, "vector-index");
  const coreDbPath = resolve(root, "core.sqlite");
  const engineDbPath = resolve(root, "engine.sqlite");
  const configJsonPath = resolve(root, "openclaw.json");
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });
  mkdirSync(lancedbDir, { recursive: true });

  writeFileSync(configJsonPath, JSON.stringify({
    models: {
      providers: {
        siliconflow: {
          apiKey: "test-sf-key",
          baseUrl: "https://api.siliconflow.cn/v1",
        },
      },
    },
  }));

  const coreDb = new Database(coreDbPath);
  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        source TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        hash TEXT,
        text TEXT,
        updated_at INTEGER
      )
    `);
    const insert = coreDb.prepare([
      "INSERT INTO chunks",
      "(id, path, source, start_line, end_line, hash, text, updated_at)",
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ].join(" "));
    for (const row of coreRows) {
      const path = row.path ?? `memory/${row.id}.md`;
      insert.run(
        row.id,
        path,
        row.source ?? path,
        row.start_line ?? 1,
        row.end_line ?? 1,
        row.hash ?? null,
        row.text,
        row.updated_at ?? 1,
      );
    }
  } finally {
    coreDb.close();
  }

  if (createEngine) {
    const engineDb = new Database(engineDbPath);
    try {
      if (createEngineSchema) {
        engineDb.exec(`
          CREATE TABLE memory_confidence (
            chunk_id TEXT PRIMARY KEY,
            initial_confidence REAL NOT NULL DEFAULT 0.5,
            confidence REAL NOT NULL DEFAULT 0.5,
            last_confidence_update INTEGER,
            base_tau REAL NOT NULL DEFAULT 7.0,
            hit_count INTEGER NOT NULL DEFAULT 0,
            is_archived INTEGER NOT NULL DEFAULT 0,
            is_protected INTEGER NOT NULL DEFAULT 0,
            conflict_flag INTEGER NOT NULL DEFAULT 0,
            category TEXT NOT NULL DEFAULT 'raw_log',
            kg_data TEXT
          )
        `);
        const insert = engineDb.prepare(
          "INSERT INTO memory_confidence "
          + "(chunk_id, initial_confidence, confidence, last_confidence_update, base_tau, "
          + "hit_count, is_archived, is_protected, conflict_flag, category, kg_data) "
          + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        );
        for (const row of engineRows) {
          insert.run(
            row.chunk_id,
            row.initial_confidence ?? 0.5,
            row.confidence ?? 0.5,
            row.last_confidence_update ?? 1,
            row.base_tau ?? 7,
            row.hit_count ?? 0,
            row.is_archived ?? 0,
            row.is_protected ?? 0,
            row.conflict_flag ?? 0,
            row.category ?? "raw_log",
            row.kg_data ?? null,
          );
        }
      }
    } finally {
      engineDb.close();
    }
  }

  return { root, workspaceDir, memoryDir, lancedbDir, coreDbPath, engineDbPath, configJsonPath };
}

function withPatchedRequireCache(moduleId, fakeExports, fn) {
  const resolved = require.resolve(moduleId);
  const previous = require.cache[resolved];
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: fakeExports,
  };
  const finish = () => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  };
  try {
    const result = fn();
    if (result && typeof result.then === "function") return result.finally(finish);
    finish();
    return result;
  } catch (error) {
    finish();
    throw error;
  }
}

function withFreshOrphanRepair({
  isolatedDbsExports,
}, fn) {
  const orphanPath = require.resolve("../lib/checkpoint/orphan-repair.js");
  const previous = require.cache[orphanPath];
  delete require.cache[orphanPath];
  return withPatchedRequireCache("../lib/db/isolated-dbs.js", isolatedDbsExports, () => {
    try {
      const fresh = require("../lib/checkpoint/orphan-repair.js");
      return fn(fresh);
    } finally {
      delete require.cache[orphanPath];
      if (previous) require.cache[orphanPath] = previous;
    }
  });
}

function withStubbedHttpsRequest(handler, fn) {
  const https = require("node:https");
  const originalRequest = https.request;
  https.request = handler;
  const finish = () => {
    https.request = originalRequest;
  };
  try {
    const result = fn();
    if (result && typeof result.then === "function") return result.finally(finish);
    finish();
    return result;
  } catch (error) {
    finish();
    throw error;
  }
}

function successfulEmbeddingRequest() {
  return function request(_url, _options, callback) {
    const response = new EventEmitter();
    const requestHandle = new EventEmitter();
    requestHandle.write = () => {};
    requestHandle.end = () => {
      callback(response);
      process.nextTick(() => {
        response.emit("data", JSON.stringify({
          data: [{ embedding: [0.11, 0.22, 0.33] }],
        }));
        response.emit("end");
      });
    };
    return requestHandle;
  };
}

async function runRepairWithLanceDb(fixture, lancedbExports, run = null) {
  return checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    memoryDir: fixture.memoryDir,
    lancedbDir: fixture.lancedbDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    configJsonPath: fixture.configJsonPath,
  }, async () => withPatchedRequireCache("@lancedb/lancedb", lancedbExports, async () => {
    if (run) return run();
    return orphanRepair.repairOrphanVectors();
  }));
}

function readDatabaseList(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare("PRAGMA database_list").all();
  } finally {
    db.close();
  }
}

test("LanceDB require/connect failure returns 0 and warns", async () => {
  const fixture = createFixture();
  const warnings = [];
  const prevWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(" "));

  try {
    const repaired = await runRepairWithLanceDb(fixture, {
      connect: async () => {
        throw new Error("lancedb init failed");
      },
    });
    assert.equal(repaired, 0);
  } finally {
    console.warn = prevWarn;
  }

  assert.equal(warnings.some(line => line.includes("[checkpoint] LanceDB scan failed: lancedb init failed")), true);
});

test("orphan repair uses the shared runtime LanceDB directory", async () => {
  const fixture = createFixture();
  const connectedPaths = [];

  const repaired = await runRepairWithLanceDb(fixture, {
    connect: async (dbPath) => {
      connectedPaths.push(dbPath);
      return {
        openTable: async () => ({
          countRows: async () => 1001,
        }),
      };
    },
  });

  assert.equal(repaired, 0);
  assert.deepEqual(connectedPaths, [fixture.lancedbDir]);
  assert.notEqual(fixture.lancedbDir, resolve(fixture.memoryDir, "lancedb"));
});

test("count > 1000 returns 0", async () => {
  const fixture = createFixture();

  const repaired = await runRepairWithLanceDb(fixture, {
    connect: async () => ({
      openTable: async () => ({
        countRows: async () => 1001,
      }),
    }),
  });

  assert.equal(repaired, 0);
});

test("no orphan vectors returns 0 and does not call add", async () => {
  const fixture = createFixture();
  let addCalls = 0;

  const repaired = await runRepairWithLanceDb(fixture, {
    connect: async () => ({
      openTable: async () => ({
        countRows: async () => 2,
        search: () => ({
          limit: () => ({
            execute: async function* () {
              yield [{ id: "chunk-1" }, { id: "chunk-2" }];
            },
          }),
        }),
        add: async () => {
          addCalls += 1;
        },
      }),
    }),
  });

  assert.equal(repaired, 0);
  assert.equal(addCalls, 0);
});

test("single orphan is repaired once with the matching core chunk text", async () => {
  const fixture = createFixture();
  const addedRows = [];

  const repaired = await withStubbedHttpsRequest(successfulEmbeddingRequest(), async () => runRepairWithLanceDb(fixture, {
    connect: async () => ({
      openTable: async () => ({
        countRows: async () => 1,
        search: () => ({
          limit: () => ({
            execute: async function* () {
              yield [{ id: "chunk-1" }];
            },
          }),
        }),
        add: async (rows) => {
          addedRows.push(...rows);
        },
      }),
    }),
  }));

  assert.equal(repaired, 1);
  assert.equal(addedRows.length, 1);
  assert.equal(addedRows[0].id, "chunk-2");
  assert.equal(addedRows[0].text, "body 2");
  assert.deepEqual(addedRows[0].vector, [0.11, 0.22, 0.33]);
});

test("multiple orphan vectors are repaired in engine query order without duplicates", async () => {
  const fixture = createFixture({
    coreRows: [
      { id: "chunk-1", text: "body 1" },
      { id: "chunk-2", text: "body 2" },
      { id: "chunk-3", text: "body 3" },
    ],
    engineRows: [
      { chunk_id: "chunk-1", category: "raw_log", is_archived: 0 },
      { chunk_id: "chunk-2", category: "raw_log", is_archived: 0 },
      { chunk_id: "chunk-3", category: "raw_log", is_archived: 0 },
    ],
  });
  const addedIds = [];

  const repaired = await withStubbedHttpsRequest(successfulEmbeddingRequest(), async () => runRepairWithLanceDb(fixture, {
    connect: async () => ({
      openTable: async () => ({
        countRows: async () => 1,
        search: () => ({
          limit: () => ({
            execute: async function* () {
              yield [{ id: "chunk-1" }];
            },
          }),
        }),
        add: async (rows) => {
          for (const row of rows) addedIds.push(row.id);
        },
      }),
    }),
  }));

  assert.equal(repaired, 2);
  assert.deepEqual(addedIds, ["chunk-2", "chunk-3"]);
});

test("global orphan repair uses one canonical batch per ten ids and preserves exact projection text", async () => {
  const coreRows = [];
  const engineRows = [];
  for (let i = 0; i < 11; i += 1) {
    const id = `global-${String(i).padStart(2, "0")}`;
    coreRows.push({ id, text: `legacy global text ${i}` });
    engineRows.push({ chunk_id: id, category: "raw_log", is_archived: 0 });
  }
  const fixture = createFixture({ coreRows, engineRows });
  const batchCalls = [];
  const embeddingInputs = [];
  const addedRows = [];

  try {
    const repaired = await runRepairWithLanceDb(fixture, {
      connect: async () => ({
        openTable: async () => ({
          countRows: async () => 0,
          search: () => ({
            limit: () => ({
              execute: async function* () {
                yield [];
              },
            }),
          }),
          add: async rows => addedRows.push(...rows),
        }),
      }),
    }, () => orphanRepair.repairOrphanVectors({
      getCanonicalMemoriesByIds: ids => {
        batchCalls.push(ids);
        return {
          ok: true,
          results: ids.map(id => ({
            memory_id: id,
            ok: true,
            memory: {
              memory_id: id,
              canonical_id: `cmem:core:${id}`,
              source: { text: `CANONICAL GLOBAL SOURCE ${id}` },
              content_ref: { content_hash: `sha256:${id}` },
            },
          })),
        };
      },
      embedText: async text => {
        embeddingInputs.push(text);
        return [0.11, 0.22, 0.33];
      },
      now: () => 1780000000000,
    }));

    assert.equal(repaired, 11);
    assert.deepEqual(batchCalls.map(ids => ids.length), [10, 1]);
    assert.deepEqual(addedRows.map(row => row.id), [
      ...Array.from({ length: 11 }, (_, index) => `global-${String(index).padStart(2, "0")}`),
    ]);
    assert.deepEqual(addedRows.map(row => row.text), embeddingInputs);
    assert.deepEqual(embeddingInputs, addedRows.map(row => `CANONICAL GLOBAL SOURCE ${row.id}`));
    assert.equal(addedRows.every(row => Object.keys(row).sort().join(",") === "id,text,timestamp,vector"), true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("global canonical failure skips only the affected orphan", async () => {
  const fixture = createFixture({
    coreRows: [
      { id: "global-fail", text: "fail source" },
      { id: "global-ok", text: "ok source" },
    ],
    engineRows: [
      { chunk_id: "global-fail", category: "raw_log", is_archived: 0 },
      { chunk_id: "global-ok", category: "raw_log", is_archived: 0 },
    ],
  });
  const addedIds = [];
  const warnings = [];
  const previousWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(" "));

  try {
    const repaired = await runRepairWithLanceDb(fixture, {
      connect: async () => ({
        openTable: async () => ({
          countRows: async () => 0,
          search: () => ({
            limit: () => ({
              execute: async function* () {
                yield [];
              },
            }),
          }),
          add: async rows => addedIds.push(...rows.map(row => row.id)),
        }),
      }),
    }, () => orphanRepair.repairOrphanVectors({
      getCanonicalMemoriesByIds: ids => ({
        ok: true,
        results: ids.map(id => id === "global-fail"
          ? { memory_id: id, ok: false, memory: null, reason: "core_not_found" }
          : {
            memory_id: id,
            ok: true,
            memory: {
              memory_id: id,
              canonical_id: `cmem:core:${id}`,
              source: { text: "CANONICAL GLOBAL OK" },
              content_ref: { content_hash: `sha256:${id}` },
            },
          }),
      }),
      embedText: async () => [0.11, 0.22, 0.33],
    }));

    assert.equal(repaired, 1);
    assert.deepEqual(addedIds, ["global-ok"]);
    assert.equal(warnings.some(line => line.includes("canonical_lookup_core_not_found")), true);
  } finally {
    console.warn = previousWarn;
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("archived engine rows are excluded from orphan detection", async () => {
  const fixture = createFixture({
    engineRows: [
      { chunk_id: "chunk-1", category: "raw_log", is_archived: 0 },
      { chunk_id: "chunk-2", category: "raw_log", is_archived: 1 },
    ],
  });
  const addedIds = [];

  const repaired = await withStubbedHttpsRequest(successfulEmbeddingRequest(), async () => runRepairWithLanceDb(fixture, {
    connect: async () => ({
      openTable: async () => ({
        countRows: async () => 0,
        search: () => ({
          limit: () => ({
            execute: async function* () {
              yield [];
            },
          }),
        }),
        add: async (rows) => {
          for (const row of rows) addedIds.push(row.id);
        },
      }),
    }),
  }));

  assert.equal(repaired, 1);
  assert.deepEqual(addedIds, ["chunk-1"]);
});

test("empty core returns 0 even when engine rows are missing from LanceDB", async () => {
  const fixture = createFixture({
    coreRows: [],
    engineRows: [
      { chunk_id: "chunk-1", category: "raw_log", is_archived: 0 },
    ],
  });
  let addCalls = 0;

  const repaired = await withStubbedHttpsRequest(successfulEmbeddingRequest(), async () => runRepairWithLanceDb(fixture, {
    connect: async () => ({
      openTable: async () => ({
        countRows: async () => 0,
        search: () => ({
          limit: () => ({
            execute: async function* () {
              yield [];
            },
          }),
        }),
        add: async () => {
          addCalls += 1;
        },
      }),
    }),
  }));

  assert.equal(repaired, 0);
  assert.equal(addCalls, 0);
});

test("empty engine dataset returns 0 and does not repair anything", async () => {
  const fixture = createFixture({
    engineRows: [],
  });
  let addCalls = 0;

  const repaired = await runRepairWithLanceDb(fixture, {
    connect: async () => ({
      openTable: async () => ({
        countRows: async () => 0,
        search: () => ({
          limit: () => ({
            execute: async function* () {
              yield [];
            },
          }),
        }),
        add: async () => {
          addCalls += 1;
        },
      }),
    }),
  });

  assert.equal(repaired, 0);
  assert.equal(addCalls, 0);
});

test("missing Engine DB keeps readonly behavior and returns 0 without creating the file", async () => {
  const fixture = createFixture({
    createEngine: false,
  });
  const warnings = [];
  const prevWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(" "));

  try {
    const repaired = await runRepairWithLanceDb(fixture, {
      connect: async () => ({
        openTable: async () => ({
          countRows: async () => 0,
          search: () => ({
            limit: () => ({
              execute: async function* () {
                yield [];
              },
            }),
          }),
          add: async () => {},
        }),
      }),
    });
    assert.equal(repaired, 0);
  } finally {
    console.warn = prevWarn;
  }

  assert.equal(existsSync(fixture.engineDbPath), false);
  assert.equal(
    warnings.some((line) => line.includes("[checkpoint] Orphan repair skipped:")),
    true,
  );
});

test("missing Engine schema returns 0 and does not initialize memory_confidence", async () => {
  const fixture = createFixture({
    createEngineSchema: false,
  });
  const warnings = [];
  const prevWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(" "));

  try {
    const repaired = await runRepairWithLanceDb(fixture, {
      connect: async () => ({
        openTable: async () => ({
          countRows: async () => 0,
          search: () => ({
            limit: () => ({
              execute: async function* () {
                yield [];
              },
            }),
          }),
          add: async () => {},
        }),
      }),
    });
    assert.equal(repaired, 0);
  } finally {
    console.warn = prevWarn;
  }

  const engineDb = new Database(fixture.engineDbPath, { readonly: true, fileMustExist: true });
  try {
    assert.equal(
      engineDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_confidence'").get(),
      undefined,
    );
  } finally {
    engineDb.close();
  }
  assert.equal(
    warnings.some((line) => line.includes("[checkpoint] Orphan repair skipped: no such table: memory_confidence")),
    true,
  );
});

test("orphan repair uses native readonly isolated Engine without attached schemas", async () => {
  const fixture = createFixture();
  const realIsolated = await import("../lib/db/isolated-dbs.js");
  const observations = [];

  await withStubbedHttpsRequest(successfulEmbeddingRequest(), async () => checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    memoryDir: fixture.memoryDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    configJsonPath: fixture.configJsonPath,
  }, async () => withFreshOrphanRepair({
    isolatedDbsExports: {
      ...realIsolated,
      withEngineDbIsolated(fn, options = {}) {
        return realIsolated.withEngineDbIsolated((engineDb) => {
          observations.push({
            readonly: options.readonly,
            databaseList: engineDb.prepare("PRAGMA database_list").all(),
          });
          return fn(engineDb);
        }, options);
      },
    },
  }, async (freshOrphanRepair) => withPatchedRequireCache("@lancedb/lancedb", {
    connect: async () => ({
      openTable: async () => ({
        countRows: async () => 0,
        search: () => ({
          limit: () => ({
            execute: async function* () {
              yield [];
            },
          }),
        }),
        add: async () => {},
      }),
    }),
  }, async () => {
    const repaired = await freshOrphanRepair.repairOrphanVectors();
    assert.equal(repaired, 2);
  }))));

  assert.equal(observations.length, 2);
  assert.equal(observations.every(observation => observation.readonly === true), true);
  assert.equal(observations.every(observation => (
    JSON.stringify(observation.databaseList.map(row => row.name)) === JSON.stringify(["main"])
  )), true);
  assert.equal(observations.every(observation => observation.databaseList[0].file === fixture.engineDbPath), true);
  assert.deepEqual(readDatabaseList(fixture.engineDbPath).map((row) => row.name), ["main"]);
});

test("repair failure warns and continues with later orphan rows", async () => {
  const fixture = createFixture({
    coreRows: [
      { id: "chunk-1", text: "body 1" },
      { id: "chunk-2", text: "body 2" },
      { id: "chunk-3", text: "body 3" },
    ],
    engineRows: [
      { chunk_id: "chunk-1", category: "raw_log", is_archived: 0 },
      { chunk_id: "chunk-2", category: "raw_log", is_archived: 0 },
      { chunk_id: "chunk-3", category: "raw_log", is_archived: 0 },
    ],
  });
  const warnings = [];
  const addedIds = [];
  const prevWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(" "));

  try {
    const repaired = await withStubbedHttpsRequest(successfulEmbeddingRequest(), async () => runRepairWithLanceDb(fixture, {
      connect: async () => ({
        openTable: async () => ({
          countRows: async () => 1,
          search: () => ({
            limit: () => ({
              execute: async function* () {
                yield [{ id: "chunk-1" }];
              },
            }),
          }),
          add: async (rows) => {
            const id = rows[0]?.id;
            if (id === "chunk-2") throw new Error("mock add failure");
            addedIds.push(id);
          },
        }),
      }),
    }));
    assert.equal(repaired, 1);
  } finally {
    console.warn = prevWarn;
  }

  assert.deepEqual(addedIds, ["chunk-3"]);
  assert.equal(warnings.some((line) => line.includes("Failed to repair chunk-2")), true);
  assert.equal(warnings.some((line) => line.includes("mock add failure")), true);
});

test("runtime override repairOrphanVectors still controls main flow", async () => {
  const fixture = createFixture();
  let repairCalls = 0;

  try {
    await checkpoint.withRuntime({
      workspaceDir: fixture.workspaceDir,
      memoryDir: fixture.memoryDir,
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
      timeZone: "Asia/Shanghai",
      now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
      readCheckpointRawLogs: () => [],
      flushCheckpointRawLog: () => ({ ok: true }),
      repairOrphanVectors: async () => {
        repairCalls += 1;
        return 7;
      },
      resolveConfigConflicts: () => 0,
    }, () => checkpoint.main());
  } catch (_) {
    // main() should not throw here
  }

  assert.equal(repairCalls, 1);
});

test("orphan-repair source uses isolated readonly Engine and no attached checkpoint schema", () => {
  const source = readFileSync(resolve("lib/checkpoint/orphan-repair.js"), "utf8");
  assert.doesNotMatch(source, /withMeDb/);
  assert.doesNotMatch(source, /chunks_db/);
  assert.doesNotMatch(source, /ATTACH DATABASE/);
  assert.doesNotMatch(source, /patchWriteGuards/);
  assert.doesNotMatch(source, /ensureCheckpointTables/);
  assert.match(source, /withDb/);
  assert.match(source, /withEngineDbIsolated/);
  assert.match(source, /readonly:\s*true/);
});
