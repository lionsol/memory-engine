import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createMemoryEngineExecute } from "../lib/tools/memory-engine-actions.js";

test("memory_engine.add queries chunks.path using stable relative POSIX path", async () => {
  let selectedPath = null;
  const execute = createMemoryEngineExecute({
    api: { config: {} },
    autoRouteCategory: () => "raw_log",
    dateStrInTimeZone: () => "2026-06-08",
    SMART_ADD_TIME_ZONE: "Asia/Shanghai",
    resolve: path.posix.resolve,
    WORKSPACE: "/tmp/ws/",
    SMART_ADD_DIR: "memory/smart-add",
    buildSmartAddFingerprint: () => "fingerprint",
    appendSmartAdd: () => ({ appended: true }),
    syncIndexIfNeeded: async () => ({}),
    catParams: () => ({ conf: 0.5, tau: 7 }),
    withDb: fn => fn({
      prepare(sql) {
        const normalized = String(sql);
        if (normalized.includes("SELECT id FROM chunks WHERE path = ?")) {
          return {
            all(pathValue) {
              selectedPath = pathValue;
              return pathValue === "memory/smart-add/2026-06-08.md" ? [{ id: "chunk-1" }] : [];
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
});
