import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { createMemoryEngineExecute } from "../lib/tools/memory-engine-actions.js";

function createBaseRuntime(overrides = {}) {
  return {
    api: { config: {} },
    autoRouteCategory: () => "raw_log",
    dateStrInTimeZone: () => "2026-07-26",
    SMART_ADD_TIME_ZONE: "Asia/Shanghai",
    resolve: path.posix.resolve,
    WORKSPACE: "/tmp/ws/",
    SMART_ADD_DIR: "memory/smart-add",
    buildSmartAddFingerprint: () => "fingerprint",
    appendSmartAdd: async () => ({ appended: true }),
    syncIndexIfNeeded: async () => ({ synced: true }),
    catParams: () => ({ conf: 0.5, tau: 7 }),
    withDb: () => {
      throw new Error("unexpected DB access");
    },
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
    ...overrides,
  };
}

test("memory_engine.add reports canonical success when sync fails", async () => {
  let dbCalls = 0;
  const execute = createMemoryEngineExecute(createBaseRuntime({
    appendSmartAdd: async () => ({
      appended: true,
      sync: { ok: false, error: "sync unavailable" },
    }),
    withDb: () => {
      dbCalls += 1;
      throw new Error("DB should not be queried after sync failure");
    },
  }));

  const result = await execute("add-sync-failure", {
    action: "add",
    text: "canonical content survives sync failure",
  });

  assert.equal(dbCalls, 0);
  assert.equal(result.success, true);
  assert.equal(result.canonical_written, true);
  assert.equal(result.derived_state, "pending_sync");
  assert.equal(result.needs_reconcile, true);
  assert.equal(result.reconcile_reason, "sync_failed");
  assert.equal(result.sync.error, "sync unavailable");
});

test("memory_engine.add keeps Engine metadata and reports partial success when LanceDB fails", async () => {
  const sqlSeen = [];
  const events = [];
  let confidenceInserts = 0;
  const db = {
    prepare(sql) {
      const normalized = String(sql);
      sqlSeen.push(normalized);
      if (normalized.includes("SELECT id FROM chunks WHERE path = ?")) {
        return { all: () => [{ id: "chunk-1" }] };
      }
      if (normalized.includes("INSERT INTO memory_confidence")) {
        return {
          run() {
            confidenceInserts += 1;
            return { changes: 1 };
          },
        };
      }
      throw new Error(`unexpected SQL: ${normalized}`);
    },
    transaction(fn) {
      return () => fn();
    },
  };

  const execute = createMemoryEngineExecute(createBaseRuntime({
    appendSmartAdd: async () => ({ appended: true, sync: { synced: true } }),
    withDb: fn => fn(db),
    getLancedbTable: () => ({
      add: async () => {
        throw new Error("vector offline");
      },
    }),
    generateEmbedding: async () => [0.1, 0.2],
    recordMemoryEvent: event => events.push(event),
  }));

  const result = await execute("add-vector-failure", {
    action: "add",
    text: "canonical content survives vector failure",
  });

  assert.equal(result.success, true);
  assert.equal(result.canonical_written, true);
  assert.equal(result.chunks_added, 1);
  assert.equal(result.derived_state, "partial");
  assert.equal(result.needs_reconcile, true);
  assert.equal(result.reconcile_reason, "vector_pending");
  assert.equal(result.vector_error, "vector offline");
  assert.equal(confidenceInserts, 1);
  assert.equal(sqlSeen.some(sql => sql.includes("DELETE FROM memory_confidence")), false);
  assert.equal(events.length, 1);
  assert.equal(events[0].metadata_json.derived_state, "partial");
});
