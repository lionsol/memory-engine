import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryEngineExecute } from "../lib/tools/memory-engine-actions.js";

test("memory_engine unknown action response is stable", async () => {
  const execute = createMemoryEngineExecute({
    api: { config: {} },
    autoRouteCategory: () => "raw_log",
    dateStrInTimeZone: () => "2026-05-27",
    SMART_ADD_TIME_ZONE: "Asia/Shanghai",
    resolve: (...parts) => parts.join("/"),
    WORKSPACE: "/tmp/ws",
    SMART_ADD_DIR: "memory/smart-add",
    buildSmartAddFingerprint: () => "fingerprint",
    appendSmartAdd: () => ({ appended: true }),
    syncIndexIfNeeded: async () => ({}),
    catParams: () => ({ conf: 0.5, tau: 7 }),
    withDb: fn => fn({ prepare: () => ({ all: () => [], get: () => null, run: () => ({}) }), transaction: f => f }),
    getLancedbTable: () => null,
    generateEmbedding: async () => [],
    recordMemoryEvent: () => {},
    getMemorySearchManager: async () => ({ manager: null }),
    sanitizeFtsQuery: text => text,
    calcRealtimeConf: () => 0,
    existsSync: () => false,
    readFileSync: () => "",
    KG_PATH: "/tmp/ws/knowledge-graph.json",
    resolvePrefixes: () => [],
    batchReinforce: () => 0,
    CATEGORY_MAP: {},
    calcTau: () => 0,
  });

  const result = await execute("t1", { action: "unknown" });
  assert.equal(
    JSON.stringify(result, null, 2),
    `{
  "error": "unknown action",
  "available": [
    "add",
    "search",
    "cite",
    "update",
    "status",
    "archive",
    "kg-bridge",
    "detect-conflicts"
  ]
}`
  );
});
