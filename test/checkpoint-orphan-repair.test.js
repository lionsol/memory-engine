import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
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
  const coreDbPath = resolve(root, "core.sqlite");
  const engineDbPath = resolve(root, "engine.sqlite");
  const configJsonPath = resolve(root, "openclaw.json");
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });

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
        text TEXT
      )
    `);
    const insert = coreDb.prepare("INSERT INTO chunks (id, text) VALUES (?, ?)");
    for (const row of coreRows) insert.run(row.id, row.text);
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
            category TEXT NOT NULL DEFAULT 'raw_log',
            is_archived INTEGER NOT NULL DEFAULT 0
          )
        `);
        const insert = engineDb.prepare(
          "INSERT INTO memory_confidence (chunk_id, category, is_archived) VALUES (?, ?, ?)",
        );
        for (const row of engineRows) {
          insert.run(row.chunk_id, row.category ?? "raw_log", row.is_archived ?? 0);
        }
      }
    } finally {
      engineDb.close();
    }
  }

  return { root, workspaceDir, memoryDir, coreDbPath, engineDbPath, configJsonPath };
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

  assert.equal(observations.length, 1);
  assert.equal(observations[0].readonly, true);
  assert.deepEqual(observations[0].databaseList.map((row) => row.name), ["main"]);
  assert.equal(observations[0].databaseList[0].file, fixture.engineDbPath);
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
