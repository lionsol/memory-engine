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
      resolvePrefixes: (_db, prefixes) => prefixes.map(prefix => `${prefix}-full-id`),
      batchReinforce: (_db, ids) => ids.length,
      authorizeMemoryEngineCite: () => ({ authorized: true }),
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

test("memory_engine cite resolves prefixes, reinforces matches, and records events", async () => {
  const { runtime, events } = createCiteRuntime();
  const execute = createMemoryEngineExecute(runtime);

  const result = await execute("cite-2", {
    action: "cite",
    chunk_ids: ["alpha", "beta"],
  });

  assert.equal(result.success, true);
  assert.equal(result.reinforced, 2);
  assert.deepEqual(result.ids, ["alpha-full-id", "beta-full-id"]);
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
