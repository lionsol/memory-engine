import test from "node:test";
import assert from "node:assert/strict";

import {
  createMemoryEngineExecute,
  createMemoryEngineGetExecute,
} from "../lib/tools/memory-engine-actions.js";

function sqlLikePrefix(value, pattern) {
  const source = String(pattern)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  return new RegExp(`^${source}`, "u").test(String(value));
}

function createUpdateRuntime(ids) {
  const updated = [];
  const queries = [];
  const db = {
    prepare(sql) {
      const query = String(sql);
      queries.push(query);
      if (query.includes("SELECT chunk_id FROM memory_confidence")) {
        return {
          all(...args) {
            let matches;
            if (query.includes(" LIKE ")) {
              matches = ids.filter(id => sqlLikePrefix(id, args[0]));
            } else if (query.includes("substr(chunk_id")) {
              const prefix = String(args[0] ?? "");
              matches = ids.filter(id => id.startsWith(prefix));
            } else {
              throw new Error(`unexpected id resolver SQL: ${query}`);
            }
            return matches.slice(0, 2).map(chunk_id => ({ chunk_id }));
          },
        };
      }
      if (query.startsWith("UPDATE memory_confidence SET")) {
        return {
          run(...args) {
            updated.push(args.at(-1));
            return { changes: 1 };
          },
        };
      }
      throw new Error(`unexpected update SQL: ${query}`);
    },
  };
  return {
    updated,
    queries,
    runtime: {
      api: { config: {} },
      getLancedbTable: () => null,
      withDb: fn => fn(db),
      CATEGORY_MAP: {},
      calcTau: () => 0,
    },
  };
}

function createGetRuntime(coreRows, engineRows = []) {
  const queries = [];
  const coreDb = {
    prepare(sql) {
      const query = String(sql);
      queries.push(query);
      if (query.includes("PRAGMA table_info(chunks)")) {
        return {
          all: () => [
            { name: "id" },
            { name: "path" },
            { name: "source" },
            { name: "start_line" },
            { name: "end_line" },
            { name: "updated_at" },
            { name: "text" },
          ],
        };
      }
      if (query.includes("FROM chunks c")) {
        return {
          all(...args) {
            if (query.includes(" LIKE ")) {
              return coreRows.filter(row => sqlLikePrefix(row.id, args[0]));
            }
            if (query.includes("substr(c.id")) {
              const prefix = String(args[0] ?? "");
              return coreRows.filter(row => row.id.startsWith(prefix));
            }
            throw new Error(`unexpected Core id resolver SQL: ${query}`);
          },
        };
      }
      throw new Error(`unexpected Core SQL: ${query}`);
    },
  };
  const engineDb = {
    prepare(sql) {
      const query = String(sql);
      if (query.includes("FROM memory_confidence WHERE chunk_id IN")) {
        return {
          all: (...ids) => engineRows.filter(row => ids.includes(row.chunk_id)),
        };
      }
      throw new Error(`unexpected Engine SQL: ${query}`);
    },
  };
  return {
    queries,
    runtime: {
      withCoreDb: fn => fn(coreDb),
      withEngineDb: fn => fn(engineDb),
      calcRealtimeConf: ({ confidence = 0 }) => Number(confidence || 0),
      CATEGORY_MAP: {},
    },
  };
}

test("memory_engine update resolves literal wildcard characters instead of SQL LIKE patterns", async () => {
  const { runtime, updated, queries } = createUpdateRuntime([
    "literal%id-target",
    "literalXid-other",
  ]);
  const execute = createMemoryEngineExecute(runtime);

  const result = await execute("update-literal-wildcard", {
    action: "update",
    chunk_id: "literal%id-",
    hit: true,
  });

  assert.equal(result.success, true);
  assert.deepEqual(updated, ["literal%id-target"]);
  assert.equal(queries.some(query => query.includes(" LIKE ")), false);
  assert.equal(queries.some(query => query.includes("substr(chunk_id")), true);
});

test("memory_engine update gives an exact id precedence over longer ids sharing the prefix", async () => {
  const { runtime, updated } = createUpdateRuntime([
    "exact-id",
    "exact-id-longer",
  ]);
  const execute = createMemoryEngineExecute(runtime);

  const result = await execute("update-exact-precedence", {
    action: "update",
    chunk_id: "exact-id",
    hit: true,
  });

  assert.equal(result.success, true);
  assert.deepEqual(updated, ["exact-id"]);
});

test("memory_engine_get resolves literal wildcard characters and keeps exact-id precedence", async () => {
  const { runtime, queries } = createGetRuntime([
    {
      id: "owner%memory",
      path: "memory/owner.md",
      source: "memory/owner.md",
      start_line: 1,
      end_line: 2,
      updated_at: 10,
      text: "literal percent memory",
    },
    {
      id: "ownerXmemory",
      path: "memory/other.md",
      source: "memory/other.md",
      start_line: 1,
      end_line: 2,
      updated_at: 20,
      text: "LIKE wildcard false positive",
    },
    {
      id: "owner%memory-longer",
      path: "memory/longer.md",
      source: "memory/longer.md",
      start_line: 1,
      end_line: 2,
      updated_at: 30,
      text: "longer literal prefix",
    },
  ]);
  const executeGet = createMemoryEngineGetExecute(runtime);

  const result = await executeGet("owner-get-literal", { id: "owner%memory" });

  assert.equal(result.found, true);
  assert.equal(result.memory.id, "owner%memory");
  assert.equal(result.memory.text, "literal percent memory");
  assert.equal(queries.some(query => query.includes(" LIKE ")), false);
  assert.equal(queries.some(query => query.includes("substr(c.id")), true);
});
