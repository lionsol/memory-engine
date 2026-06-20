import test from "node:test";
import assert from "node:assert/strict";
import {
  createBackfillConfidenceForIndexedChunks,
  createIndexSyncRuntime,
} from "../lib/index-sync-runtime.js";

test("createBackfillConfidenceForIndexedChunks inserts inferred confidence rows", () => {
  const runCalls = [];
  const db = {
    prepare(sql) {
      const normalized = String(sql);
      if (normalized.includes("SELECT c.id, c.path, c.text")) {
        return {
          all() {
            return [{ id: "chunk-1", path: "memory/smart-add/2026-06-08.md", text: "body" }];
          },
        };
      }
      const stmt = {
        changes: 0,
        run(...args) {
          runCalls.push(args);
          stmt.changes = 1;
          return { changes: 1 };
        },
      };
      return stmt;
    },
    transaction(fn) {
      return () => fn();
    },
  };
  const backfill = createBackfillConfidenceForIndexedChunks({
    catParams: () => ({ conf: 0.5, tau: 7 }),
    inferCategoryFromChunk: () => "raw_log",
  });

  const result = backfill(db, 123);
  assert.deepEqual(result, { scanned: 1, inserted: 1 });
  assert.deepEqual(runCalls, [["chunk-1", 0.5, 0.5, 123, 7, "raw_log"]]);
});

test("createIndexSyncRuntime returns fresh without calling manager when unchanged after first sync", async () => {
  let managerCalls = 0;
  let syncCalls = 0;
  const withDb = fn => fn({});
  const syncIndexIfNeeded = createIndexSyncRuntime({
    memoryRoot: "/workspace",
    watchDirs: ["memory/smart-add"],
    withDb,
    getSharedMemoryManager: async () => {
      managerCalls += 1;
      return {
        manager: {
          status() {
            return { dirty: false };
          },
          async sync() {
            syncCalls += 1;
          },
        },
      };
    },
    collectIndexedFiles: () => [{ relPath: "memory/smart-add/2026-06-08.md", mtimeMs: 100 }],
    readIndexedPathState: () => ({
      paths: ["memory/smart-add/2026-06-08.md"],
      updatedAt: { "memory/smart-add/2026-06-08.md": 1 },
    }),
    backfillConfidenceForIndexedChunks: () => ({ scanned: 0, inserted: 0 }),
  });

  const first = await syncIndexIfNeeded("test");
  const second = await syncIndexIfNeeded("test");

  assert.equal(first.reason, "test");
  assert.equal(first.synced, true);
  assert.equal(second.reason, "fresh");
  assert.equal(second.synced, false);
  assert.equal(managerCalls, 1);
  assert.equal(syncCalls, 1);
});

test("createIndexSyncRuntime only inspects currently scanned watch paths", async () => {
  const readPathLists = [];
  const syncIndexIfNeeded = createIndexSyncRuntime({
    memoryRoot: "/workspace",
    watchDirs: ["memory/smart-add"],
    withDb: fn => fn({}),
    getSharedMemoryManager: async () => ({
      manager: {
        status() {
          return { dirty: false };
        },
        async sync() {},
      },
    }),
    collectIndexedFiles: () => [{ relPath: "memory/smart-add/2026-06-08.md", mtimeMs: 100 }],
    readIndexedPathState: (_db, pathList) => {
      readPathLists.push([...pathList]);
      return {
        paths: [...pathList],
        updatedAt: Object.fromEntries(pathList.map(path => [path, 1])),
      };
    },
    backfillConfidenceForIndexedChunks: () => ({ scanned: 0, inserted: 0 }),
  });

  await syncIndexIfNeeded("test");

  assert.deepEqual(readPathLists, [
    ["memory/smart-add/2026-06-08.md"],
    ["memory/smart-add/2026-06-08.md"],
  ]);
});
