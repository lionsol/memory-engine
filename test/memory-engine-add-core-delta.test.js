import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createMemoryEngineExecute } from "../lib/tools/memory-engine-actions.js";

function createDeltaHarness({
  beforeIds = [],
  afterIds = beforeIds,
  engineIds = [],
  backfilledIds = [],
  appendResult = null,
  coreReadFailureAt = null,
  engineWriteFailure = false,
  lanceIds = [],
  lanceFailIds = [],
  canonicalFailIds = [],
  embeddingFailIds = [],
} = {}) {
  let coreIds = [...beforeIds];
  let coreReadCount = 0;
  let appendCalls = 0;
  let syncCalls = 0;
  const engineState = new Set(engineIds.map(String));
  const selectedPaths = [];
  const canonicalLookupIds = [];
  const embeddingInputs = [];
  const lanceRows = [];
  const lanceIdSet = new Set(lanceIds.map(String));
  const lanceFailureIds = new Set(lanceFailIds.map(String));
  const canonicalFailureIds = new Set(canonicalFailIds.map(String));
  const embeddingFailureIds = new Set(embeddingFailIds.map(String));
  const engineInsertedIds = [];
  const lanceAddAttempts = [];
  const lanceMembershipQueries = [];
  const events = [];
  let engineSelectCount = 0;
  let lanceTableCalls = 0;

  const runtime = {
    api: { config: {} },
    autoRouteCategory: () => "raw_log",
    dateStrInTimeZone: () => "2026-08-19",
    SMART_ADD_TIME_ZONE: "Asia/Shanghai",
    resolve: path.posix.resolve,
    WORKSPACE: "/tmp/ws",
    SMART_ADD_DIR: "memory/smart-add",
    buildSmartAddFingerprint: () => "fingerprint",
    appendSmartAdd: async options => {
      appendCalls += 1;
      if (appendResult) return appendResult;
      return { appended: true, sync: await options.syncRunner() };
    },
    syncIndexIfNeeded: async () => {
      syncCalls += 1;
      coreIds = [...afterIds];
      for (const id of backfilledIds) engineState.add(String(id));
      return { synced: true };
    },
    catParams: () => ({ conf: 0.5, tau: 7 }),
    withDb: () => {
      throw new Error("combined DB accessor must not be used");
    },
    withCoreDb: fn => {
      coreReadCount += 1;
      if (coreReadFailureAt === coreReadCount) throw new Error("Core snapshot unavailable");
      return fn({
        prepare(sql) {
          assert.equal(String(sql), "SELECT id FROM chunks WHERE path = ? ORDER BY id ASC");
          return {
            all(fileRel) {
              selectedPaths.push(fileRel);
              return coreIds
                .slice()
                .sort((left, right) => left.localeCompare(right))
                .map(id => ({ id }));
            },
          };
        },
      });
    },
    withEngineDb: fn => {
      if (engineWriteFailure) throw new Error("Engine unavailable");
      return fn({
        prepare(sql) {
          const query = String(sql);
          if (query.includes("SELECT 1 FROM memory_confidence WHERE chunk_id = ?")) {
            return {
              get(id) {
                engineSelectCount += 1;
                return engineState.has(String(id)) ? { chunk_id: String(id) } : undefined;
              },
            };
          }
          if (query.includes("INSERT INTO memory_confidence")) {
            return {
              run(id) {
                const exactId = String(id);
                engineInsertedIds.push(exactId);
                engineState.add(exactId);
                return { changes: 1 };
              },
            };
          }
          throw new Error(`unexpected Engine SQL: ${query}`);
        },
        transaction(fn) {
          return () => fn();
        },
      });
    },
    withEngineDbReadonly: () => {
      throw new Error("canonical test double should not use readonly Engine accessor");
    },
    getLancedbTable: () => {
      lanceTableCalls += 1;
      const table = {
        query() {
          let predicate = "";
          const query = {
            where(value) {
              predicate = String(value);
              lanceMembershipQueries.push(predicate);
              return query;
            },
            select() {
              return query;
            },
            limit() {
              return query;
            },
            async toArray() {
              const requestedIds = [...predicate.matchAll(/'((?:''|[^'])*)'/g)]
                .map(match => match[1].replace(/''/g, "'"));
              return requestedIds
                .filter(id => lanceIdSet.has(id))
                .map(id => ({ id }));
            },
          };
          return query;
        },
        add: async rows => {
          for (const row of rows) {
            const id = String(row.id);
            lanceAddAttempts.push(id);
            if (lanceFailureIds.has(id)) throw new Error("vector offline");
            if (lanceIdSet.has(id)) throw new Error("duplicate lance id");
            lanceIdSet.add(id);
            lanceRows.push(row);
          }
        },
      };
      return table;
    },
    getCanonicalMemoryById: id => {
      canonicalLookupIds.push(id);
      if (canonicalFailureIds.has(String(id))) throw new Error("canonical unavailable");
      return {
        ok: true,
        memory: { memory_id: id },
      };
    },
    projectCanonicalMemoryToVectorProjection: memory => ({
      memory_id: memory.memory_id,
      canonical_id: `cmem:core:${memory.memory_id}`,
      text: `canonical text for ${memory.memory_id}`,
      embedding_input: `embedding input for ${memory.memory_id}`,
    }),
    generateEmbedding: async input => {
      embeddingInputs.push(input);
      const id = String(input).replace(/^embedding input for /, "");
      if (embeddingFailureIds.has(id)) throw new Error("vector offline");
      return [0.11, 0.22];
    },
    materializeCanonicalLanceRow: (projection, { vector, timestamp }) => ({
      id: projection.memory_id,
      text: projection.text,
      vector,
      timestamp,
    }),
    now: () => 1780000000000,
    recordMemoryEvent: event => events.push(event),
    getMemorySearchManager: async () => ({ manager: null }),
    calcRealtimeConf: () => 0,
    existsSync: () => false,
    readFileSync: () => "",
    KG_PATH: "/tmp/ws/knowledge-graph.json",
    resolvePrefixes: () => [],
    batchReinforce: () => 0,
    CATEGORY_MAP: {},
    calcTau: () => 0,
  };

  return {
    runtime,
    stats: {
      get coreReadCount() { return coreReadCount; },
      get appendCalls() { return appendCalls; },
      get syncCalls() { return syncCalls; },
      get engineSelectCount() { return engineSelectCount; },
      get lanceTableCalls() { return lanceTableCalls; },
      selectedPaths,
      canonicalLookupIds,
      embeddingInputs,
      lanceRows,
      engineInsertedIds,
      lanceAddAttempts,
      lanceMembershipQueries,
      events,
      lanceIdSet,
    },
  };
}

test("memory_engine.add uses the exact Core delta even when sync backfilled Engine first", async () => {
  const harness = createDeltaHarness({
    beforeIds: ["old-id"],
    afterIds: ["old-id", "new-id"],
    backfilledIds: ["new-id"],
  });
  const execute = createMemoryEngineExecute(harness.runtime);

  const result = await execute("core-delta-backfilled", { action: "add", text: "new memory" });

  assert.equal(result.chunks_added, 1);
  assert.equal(harness.stats.engineInsertedIds.length, 0);
  assert.deepEqual(harness.stats.canonicalLookupIds, ["new-id"]);
  assert.deepEqual(harness.stats.lanceRows.map(row => row.id), ["new-id"]);
  assert.equal(result.engine_existing, 1);
  assert.equal(result.engine_written, 0);
  assert.equal(result.engine_ready, 1);
  assert.equal(result.engine_pending, 0);
  assert.equal(result.lance_existing, 0);
  assert.equal(result.lance_written, 1);
  assert.equal(result.lance_ready, 1);
  assert.equal(result.lance_pending, 0);
  assert.equal(result.needs_reconcile, false);
  assert.equal(result.derived_state, "committed");
  assert.deepEqual(harness.stats.selectedPaths, [
    "memory/smart-add/2026-08-19.md",
    "memory/smart-add/2026-08-19.md",
  ]);
});

test("memory_engine.add keeps a successful sync pending when Core exact delta is empty", async () => {
  const harness = createDeltaHarness({
    beforeIds: ["old-id"],
    afterIds: ["old-id"],
  });
  const execute = createMemoryEngineExecute(harness.runtime);

  const result = await execute("core-delta-empty", { action: "add", text: "not yet observable" });

  assert.equal(result.success, true);
  assert.equal(result.canonical_written, true);
  assert.equal(result.chunks_added, 0);
  assert.equal(result.lance_written, 0);
  assert.equal(result.derived_state, "pending");
  assert.equal(result.needs_reconcile, true);
  assert.equal(result.reconcile_reason, "index_not_observed");
  assert.equal(harness.stats.engineSelectCount, 0);
  assert.equal(harness.stats.lanceTableCalls, 0);
  assert.deepEqual(harness.stats.canonicalLookupIds, []);
  assert.deepEqual(harness.stats.embeddingInputs, []);
  assert.deepEqual(harness.stats.lanceRows, []);
});

test("memory_engine.add inserts missing Engine state for each new Core identity", async () => {
  const harness = createDeltaHarness({
    beforeIds: ["old-id"],
    afterIds: ["old-id", "new-id"],
  });
  const execute = createMemoryEngineExecute(harness.runtime);

  const result = await execute("core-delta-normal", { action: "add", text: "normal add" });

  assert.equal(result.chunks_added, 1);
  assert.deepEqual(harness.stats.engineInsertedIds, ["new-id"]);
  assert.deepEqual(harness.stats.canonicalLookupIds, ["new-id"]);
  assert.equal(result.engine_existing, 0);
  assert.equal(result.engine_written, 1);
  assert.equal(result.engine_ready, 1);
  assert.equal(result.engine_pending, 0);
  assert.equal(result.lance_existing, 0);
  assert.equal(result.lance_written, 1);
  assert.equal(result.lance_ready, 1);
  assert.equal(result.lance_pending, 0);
  assert.equal(result.derived_state, "committed");
});

test("memory_engine.add keeps observed Core IDs pending when Engine metadata writing fails", async () => {
  const harness = createDeltaHarness({
    beforeIds: ["old-id"],
    afterIds: ["old-id", "new-id"],
    engineWriteFailure: true,
  });
  const execute = createMemoryEngineExecute(harness.runtime);

  const result = await execute("engine-write-failure", { action: "add", text: "engine unavailable" });

  assert.equal(result.success, true);
  assert.equal(result.canonical_written, true);
  assert.equal(result.chunks_added, 1);
  assert.equal(result.derived_state, "partial");
  assert.equal(result.needs_reconcile, true);
  assert.equal(result.reconcile_reason, "engine_write_failed");
  assert.equal(result.lance_written, 0);
  assert.equal(result.engine_existing, 0);
  assert.equal(result.engine_written, 0);
  assert.equal(result.engine_ready, 0);
  assert.equal(result.engine_pending, 1);
  assert.match(result.derived_error, /Engine unavailable/);
  assert.deepEqual(harness.stats.canonicalLookupIds, []);
  assert.deepEqual(harness.stats.embeddingInputs, []);
  assert.deepEqual(harness.stats.lanceRows, []);
});

test("memory_engine.add propagates every exact Core delta chunk independently", async () => {
  const harness = createDeltaHarness({
    beforeIds: ["old-id"],
    afterIds: ["old-id", "new-b", "new-a"],
  });
  const execute = createMemoryEngineExecute(harness.runtime);

  const result = await execute("core-delta-mixed", { action: "add", text: "mixed add" });

  assert.equal(result.chunks_added, 2);
  assert.deepEqual(harness.stats.engineInsertedIds, ["new-a", "new-b"]);
  assert.deepEqual(harness.stats.canonicalLookupIds, ["new-a", "new-b"]);
  assert.deepEqual(harness.stats.embeddingInputs, [
    "embedding input for new-a",
    "embedding input for new-b",
  ]);
  assert.deepEqual(harness.stats.lanceRows.map(row => row.id), ["new-a", "new-b"]);
  assert.equal(result.engine_existing, 0);
  assert.equal(result.engine_written, 2);
  assert.equal(result.engine_ready, 2);
  assert.equal(result.engine_pending, 0);
  assert.equal(result.lance_existing, 0);
  assert.equal(result.lance_written, 2);
  assert.equal(result.lance_ready, 2);
  assert.equal(result.lance_pending, 0);
  assert.equal(result.derived_state, "committed");
});

test("memory_engine.add continues sibling vector attempts after one chunk fails", async () => {
  const harness = createDeltaHarness({
    beforeIds: [],
    afterIds: ["new-a", "new-b", "new-c"],
    embeddingFailIds: ["new-b"],
  });
  const execute = createMemoryEngineExecute(harness.runtime);

  const result = await execute("core-delta-vector-partial", { action: "add", text: "partial vectors" });

  assert.deepEqual(harness.stats.canonicalLookupIds, ["new-a", "new-b", "new-c"]);
  assert.deepEqual(harness.stats.embeddingInputs, [
    "embedding input for new-a",
    "embedding input for new-b",
    "embedding input for new-c",
  ]);
  assert.deepEqual(harness.stats.lanceRows.map(row => row.id), ["new-a", "new-c"]);
  assert.equal(result.lance_written, 2);
  assert.equal(result.lance_ready, 2);
  assert.equal(result.lance_pending, 1);
  assert.equal(result.derived_state, "partial");
  assert.equal(result.needs_reconcile, true);
  assert.equal(result.reconcile_reason, "vector_pending");
  assert.deepEqual(result.vector_errors, [{ id: "new-b", reason: "vector offline" }]);

  const created = harness.stats.events
    .filter(event => event.event_type === "memory_created")
    .map(event => [event.memory_id, event.metadata_json.lance_state, event.metadata_json.lance_written]);
  assert.deepEqual(created, [
    ["new-a", "written", 1],
    ["new-b", "failed", 0],
    ["new-c", "written", 1],
  ]);
});

test("memory_engine.add detects existing Lance IDs and only propagates missing chunks", async () => {
  const harness = createDeltaHarness({
    beforeIds: [],
    afterIds: ["new-a", "new-b"],
    lanceIds: ["new-a"],
  });
  const execute = createMemoryEngineExecute(harness.runtime);

  const result = await execute("core-delta-lance-existing", { action: "add", text: "idempotent vectors" });

  assert.deepEqual(harness.stats.canonicalLookupIds, ["new-b"]);
  assert.deepEqual(harness.stats.embeddingInputs, ["embedding input for new-b"]);
  assert.deepEqual(harness.stats.lanceAddAttempts, ["new-b"]);
  assert.equal(result.lance_existing, 1);
  assert.equal(result.lance_written, 1);
  assert.equal(result.lance_ready, 2);
  assert.equal(result.lance_pending, 0);
  assert.equal(result.derived_state, "committed");
});

test("memory_engine.add vectors the full Core delta when Engine metadata is mixed", async () => {
  const harness = createDeltaHarness({
    beforeIds: [],
    afterIds: ["new-a", "new-b"],
    engineIds: ["new-a"],
  });
  const execute = createMemoryEngineExecute(harness.runtime);

  const result = await execute("core-delta-engine-existing", { action: "add", text: "mixed engine state" });

  assert.deepEqual(harness.stats.engineInsertedIds, ["new-b"]);
  assert.deepEqual(harness.stats.canonicalLookupIds, ["new-a", "new-b"]);
  assert.equal(result.engine_existing, 1);
  assert.equal(result.engine_written, 1);
  assert.equal(result.engine_ready, 2);
  assert.equal(result.engine_pending, 0);
  assert.equal(result.lance_written, 2);
  assert.equal(result.lance_ready, 2);
  assert.equal(result.derived_state, "committed");
});

test("memory_engine.add keeps the dedupe contract without a post Core snapshot", async () => {
  const harness = createDeltaHarness({
    beforeIds: ["old-id"],
    afterIds: ["old-id", "never-observed"],
    appendResult: { appended: false, reason: "duplicate" },
  });
  const execute = createMemoryEngineExecute(harness.runtime);

  const result = await execute("core-delta-dedupe", { action: "add", text: "duplicate add" });

  assert.deepEqual(result, {
    success: true,
    deduped: true,
    reason: "duplicate",
    category: "raw_log",
  });
  assert.equal(harness.stats.coreReadCount, 1);
  assert.equal(harness.stats.syncCalls, 0);
  assert.equal(harness.stats.lanceTableCalls, 0);
  assert.deepEqual(harness.stats.engineInsertedIds, []);
  assert.deepEqual(harness.stats.canonicalLookupIds, []);
  assert.deepEqual(harness.stats.lanceRows, []);
});

test("memory_engine.add fails closed before append when the Core pre-snapshot fails", async () => {
  const harness = createDeltaHarness({ coreReadFailureAt: 1 });
  const execute = createMemoryEngineExecute(harness.runtime);

  const result = await execute("core-pre-failure", { action: "add", text: "must not append" });

  assert.equal(result.success, false);
  assert.equal(result.error, "core_pre_snapshot_failed");
  assert.equal(result.canonical_written, false);
  assert.equal(result.derived_state, "failed");
  assert.equal(result.needs_reconcile, false);
  assert.equal(harness.stats.appendCalls, 0);
  assert.equal(harness.stats.syncCalls, 0);
  assert.equal(harness.stats.lanceTableCalls, 0);
  assert.deepEqual(harness.stats.engineInsertedIds, []);
  assert.deepEqual(harness.stats.canonicalLookupIds, []);
  assert.deepEqual(harness.stats.embeddingInputs, []);
  assert.deepEqual(harness.stats.lanceRows, []);
});

test("memory_engine.add reports index observation failure after source persistence", async () => {
  const harness = createDeltaHarness({
    beforeIds: ["old-id"],
    afterIds: ["old-id", "new-id"],
    coreReadFailureAt: 2,
  });
  const execute = createMemoryEngineExecute(harness.runtime);

  const result = await execute("core-post-failure", { action: "add", text: "persisted source" });

  assert.equal(result.success, true);
  assert.equal(result.canonical_written, true);
  assert.equal(result.chunks_added, 0);
  assert.equal(result.derived_state, "pending");
  assert.equal(result.needs_reconcile, true);
  assert.equal(result.reconcile_reason, "index_observation_failed");
  assert.equal(result.derived_error, "Core snapshot unavailable");
  assert.equal(harness.stats.appendCalls, 1);
  assert.equal(harness.stats.syncCalls, 1);
  assert.equal(harness.stats.lanceTableCalls, 0);
  assert.deepEqual(harness.stats.engineInsertedIds, []);
  assert.deepEqual(harness.stats.canonicalLookupIds, []);
  assert.deepEqual(harness.stats.embeddingInputs, []);
  assert.deepEqual(harness.stats.lanceRows, []);
});

test("memory_engine.add source uses Core identity delta instead of Engine-row absence", () => {
  const source = readFileSync(new URL("../lib/tools/memory-engine-actions.js", import.meta.url), "utf8");

  assert.match(source, /function readCoreChunkIdsForPath/);
  assert.match(source, /const newCoreRows = afterRows\.filter\(row => !beforeIds\.has\(String\(row\.id\)\)\)/);
  assert.doesNotMatch(source, /const newChunks = indexedChunks\.filter\(row => !exists\.get\(row\.id\)\)/);
});
