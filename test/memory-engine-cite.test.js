import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryEngineExecute } from "../lib/tools/memory-engine-actions.js";

function createCiteRuntime(overrides = {}) {
  const events = [];
  const db = {};
  return {
    events,
    runtime: {
      api: { config: {} },
      getLancedbTable: () => null,
      withDb: fn => fn(db),
      batchReinforce: (_db, ids) => ids.length,
      authorizeMemoryEngineCite: (_toolCallId, prefixes) => ({
        authorized: true,
        resolved_ids: prefixes.map(prefix => `${prefix}-full-id`),
      }),
      recordMemoryEvent: event => events.push(event),
      ...overrides,
    },
  };
}

test("memory_engine cite requires a non-empty chunk_ids array", async () => {
  const { runtime } = createCiteRuntime();
  const execute = createMemoryEngineExecute(runtime);

  assert.deepEqual(
    await execute("cite-1", { action: "cite" }),
    { error: "chunk_ids array required" },
  );
});

test("memory_engine cite is withheld without a trusted same-turn authorizer", async () => {
  let dbCalls = 0;
  const { runtime } = createCiteRuntime({
    withDb: fn => {
      dbCalls += 1;
      return fn({});
    },
    authorizeMemoryEngineCite: undefined,
  });
  const execute = createMemoryEngineExecute(runtime);

  assert.deepEqual(
    await execute("unscoped-cite", { action: "cite", chunk_ids: ["alpha"] }),
    { error: "MEMORY_CITE_NOT_AUTHORIZED", code: "MEMORY_CITE_NOT_AUTHORIZED" },
  );
  assert.equal(dbCalls, 0);
});

test("memory_engine cite reinforces exact ids returned by the authorizer and records events", async () => {
  const { runtime, events } = createCiteRuntime();
  const execute = createMemoryEngineExecute(runtime);

  const result = await execute("cite-2", {
    action: "cite",
    chunk_ids: ["alpha", "beta"],
  });

  assert.equal(result.success, true);
  assert.equal(result.reinforced, 2);
  assert.deepEqual(result.ids, ["alpha-full-id", "beta-full-id"]);
  assert.equal("next_confidence" in result, false);
  assert.equal(events.length, 4);
  assert.deepEqual(
    events.map(event => [event.event_type, event.memory_id, event.source]),
    [
      ["memory_cited", "alpha-full-id", "memory_engine.cite"],
      ["memory_reinforced", "alpha-full-id", "memory_engine.cite"],
      ["memory_cited", "beta-full-id", "memory_engine.cite"],
      ["memory_reinforced", "beta-full-id", "memory_engine.cite"],
    ],
  );
});

test("memory_engine cite rejects an authorizer that does not return exact mutation ids", async () => {
  let batchCalls = 0;
  const { runtime } = createCiteRuntime({
    authorizeMemoryEngineCite: () => ({ authorized: true }),
    batchReinforce: () => {
      batchCalls += 1;
      return 1;
    },
  });
  const execute = createMemoryEngineExecute(runtime);

  assert.deepEqual(
    await execute("cite-without-exact-id", { action: "cite", chunk_ids: ["alpha"] }),
    { error: "MEMORY_CITE_NOT_AUTHORIZED", code: "MEMORY_CITE_NOT_AUTHORIZED" },
  );
  assert.equal(batchCalls, 0);
});
