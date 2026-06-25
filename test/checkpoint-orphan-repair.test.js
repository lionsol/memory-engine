import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkpoint = require("../bin/session-checkpoint.js");
const orphanRepair = require("../lib/checkpoint/orphan-repair.js");

function createFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-checkpoint-orphan-"));
  const workspaceDir = resolve(root, "workspace");
  const memoryDir = resolve(root, "memory");
  const coreDbPath = resolve(root, "core.sqlite");
  const engineDbPath = resolve(root, "engine.sqlite");
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });

  const coreDb = new Database(coreDbPath);
  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        text TEXT
      )
    `);
    coreDb.prepare("INSERT INTO chunks (id, text) VALUES (?, ?)").run("chunk-1", "body 1");
    coreDb.prepare("INSERT INTO chunks (id, text) VALUES (?, ?)").run("chunk-2", "body 2");
  } finally {
    coreDb.close();
  }

  const engineDb = new Database(engineDbPath);
  try {
    engineDb.exec(`
      CREATE TABLE memory_confidence (
        chunk_id TEXT PRIMARY KEY,
        category TEXT NOT NULL DEFAULT 'raw_log',
        is_archived INTEGER NOT NULL DEFAULT 0
      )
    `);
    engineDb.prepare("INSERT INTO memory_confidence (chunk_id, category, is_archived) VALUES (?, ?, 0)").run("chunk-1", "raw_log");
    engineDb.prepare("INSERT INTO memory_confidence (chunk_id, category, is_archived) VALUES (?, ?, 0)").run("chunk-2", "raw_log");
  } finally {
    engineDb.close();
  }

  return { workspaceDir, memoryDir, coreDbPath, engineDbPath };
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

test("LanceDB require/connect failure returns 0 and warns", async () => {
  const fixture = createFixture();
  const warnings = [];
  const prevWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(" "));

  try {
    await checkpoint.withRuntime({
      workspaceDir: fixture.workspaceDir,
      memoryDir: fixture.memoryDir,
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
    }, async () => {
      await withPatchedRequireCache("@lancedb/lancedb", {
        connect: async () => {
          throw new Error("lancedb init failed");
        },
      }, async () => {
        const repaired = await orphanRepair.repairOrphanVectors();
        assert.equal(repaired, 0);
      });
    });
  } finally {
    console.warn = prevWarn;
  }

  assert.equal(warnings.some(line => line.includes("[checkpoint] LanceDB scan failed: lancedb init failed")), true);
});

test("count > 1000 returns 0", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    memoryDir: fixture.memoryDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    await withPatchedRequireCache("@lancedb/lancedb", {
      connect: async () => ({
        openTable: async () => ({
          countRows: async () => 1001,
        }),
      }),
    }, async () => {
      const repaired = await orphanRepair.repairOrphanVectors();
      assert.equal(repaired, 0);
    });
  });
});

test("no missing vectors returns 0", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    memoryDir: fixture.memoryDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    await withPatchedRequireCache("@lancedb/lancedb", {
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
        }),
      }),
    }, async () => {
      const repaired = await orphanRepair.repairOrphanVectors();
      assert.equal(repaired, 0);
    });
  });
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
