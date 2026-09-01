import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createMemoryEngineExecute } from "../lib/tools/memory-engine-actions.js";

test("memory_engine.add queries chunks.path using stable relative POSIX path", async () => {
  let selectedPath = null;
  let coreRows = [];
  const execute = createMemoryEngineExecute({
    api: { config: {} },
    autoRouteCategory: () => "raw_log",
    dateStrInTimeZone: () => "2026-06-08",
    SMART_ADD_TIME_ZONE: "Asia/Shanghai",
    resolve: path.posix.resolve,
    WORKSPACE: "/tmp/ws/",
    SMART_ADD_DIR: "memory/smart-add",
    buildSmartAddFingerprint: () => "fingerprint",
    appendSmartAdd: async () => {
      coreRows = [{ id: "chunk-1" }];
      return { appended: true, sync: { synced: true } };
    },
    syncIndexIfNeeded: async () => ({}),
    catParams: () => ({ conf: 0.5, tau: 7 }),
    withDb: fn => fn({
      prepare(sql) {
        const normalized = String(sql);
        if (normalized.includes("SELECT id FROM chunks WHERE path = ?")) {
          return {
            all(pathValue) {
              selectedPath = pathValue;
              return pathValue === "memory/smart-add/2026-06-08.md" ? coreRows : [];
            },
          };
        }
        return {
          run() {
            return {};
          },
          get() {
            return null;
          },
          all() {
            return [];
          },
        };
      },
      transaction(fnTxn) {
        return () => fnTxn();
      },
    }),
    getLancedbTable: () => null,
    generateEmbedding: async () => [],
    recordMemoryEvent: () => {},
    getMemorySearchManager: async () => ({ manager: null }),
    calcRealtimeConf: () => 0,
    existsSync: () => false,
    readFileSync: () => "",
    KG_PATH: "/tmp/ws/knowledge-graph.json",
    resolvePrefixes: () => [],
    batchReinforce: () => 0,
    CATEGORY_MAP: {},
    calcTau: () => 0,
  });

  const result = await execute("tool-1", { action: "add", text: "remember this" });
  assert.equal(selectedPath, "memory/smart-add/2026-06-08.md");
  assert.equal(result.success, true);
  assert.equal(result.chunks_added, 1);
  assert.equal(result.derived_state, "partial");
  assert.equal(result.reconcile_reason, "vector_pending");
  assert.equal(result.lance_ready, 0);
  assert.equal(result.lance_pending, 1);
});

test("memory_engine.add passes async in-process sync runner into appendSmartAdd", async () => {
  let syncCalls = 0;
  let receivedSyncRunner = null;
  let coreRows = [];
  const execute = createMemoryEngineExecute({
    api: { config: {} },
    autoRouteCategory: () => "raw_log",
    dateStrInTimeZone: () => "2026-06-08",
    SMART_ADD_TIME_ZONE: "Asia/Shanghai",
    resolve: path.posix.resolve,
    WORKSPACE: "/tmp/ws/",
    SMART_ADD_DIR: "memory/smart-add",
    buildSmartAddFingerprint: () => "fingerprint",
    appendSmartAdd: async (options) => {
      receivedSyncRunner = options.syncRunner;
      const sync = await options.syncRunner({ force: true, quiet: true });
      return { appended: true, sync };
    },
    syncIndexIfNeeded: async (reason) => {
      syncCalls += 1;
      coreRows = [{ id: "chunk-1" }];
      return { synced: true, reason };
    },
    catParams: () => ({ conf: 0.5, tau: 7 }),
    withDb: fn => fn({
      prepare(sql) {
        const normalized = String(sql);
        if (normalized.includes("SELECT id FROM chunks WHERE path = ?")) {
          return {
            all(pathValue) {
              return pathValue === "memory/smart-add/2026-06-08.md" ? coreRows : [];
            },
          };
        }
        return {
          run() {
            return {};
          },
          get() {
            return null;
          },
          all() {
            return [];
          },
        };
      },
      transaction(fnTxn) {
        return () => fnTxn();
      },
    }),
    getLancedbTable: () => null,
    generateEmbedding: async () => [],
    recordMemoryEvent: () => {},
    getMemorySearchManager: async () => ({ manager: null }),
    calcRealtimeConf: () => 0,
    existsSync: () => false,
    readFileSync: () => "",
    KG_PATH: "/tmp/ws/knowledge-graph.json",
    resolvePrefixes: () => [],
    batchReinforce: () => 0,
    CATEGORY_MAP: {},
    calcTau: () => 0,
  });

  const result = await execute("tool-2", { action: "add", text: "remember this too" });
  assert.equal(typeof receivedSyncRunner, "function");
  assert.equal(syncCalls, 1);
  assert.equal(result.success, true);
  assert.equal(result.chunks_added, 1);
});
