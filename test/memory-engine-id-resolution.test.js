import test from "node:test";
import assert from "node:assert/strict";

import {
  createMemoryEngineExecute,
  createMemoryEngineGetExecute,
} from "../lib/tools/memory-engine-actions.js";

function literalPrefixFromGlob(pattern) {
  return String(pattern || "")
    .replace(/\*$/, "")
    .replaceAll("[[]", "[")
    .replaceAll("[*]", "*")
    .replaceAll("[?]", "?");
}

function createUpdateRuntime(ids, overrides = {}) {
  const updated = [];
  const updates = [];
  const queries = [];
  const rows = new Map(ids.map(id => [id, {
    chunk_id: id,
    initial_confidence: 0.5,
    confidence: 0.5,
    last_confidence_update: 0,
    base_tau: 7,
    hit_count: 0,
    is_archived: 0,
    is_protected: 0,
    conflict_flag: 0,
    category: "raw_log",
    ...(overrides.rows?.[id] || {}),
  }]));
  const db = {
    prepare(sql) {
      const query = String(sql);
      queries.push(query);
      if (query.includes("SELECT chunk_id, initial_confidence, confidence, last_confidence_update")) {
        return {
          get(value) {
            return rows.get(String(value)) || null;
          },
        };
      }
      if (query.includes("SELECT chunk_id FROM memory_confidence")) {
        if (query.includes("WHERE chunk_id = ?")) {
          return {
            all(value) {
              const match = rows.get(String(value));
              if (!match) return [];
              if (query.includes("COALESCE(is_archived, 0) = 0") && Number(match.is_archived || 0) !== 0) {
                return [];
              }
              return [{ chunk_id: match.chunk_id }];
            },
          };
        }
        if (query.includes("WHERE chunk_id GLOB ?")) {
          return {
            all(pattern) {
              const prefix = literalPrefixFromGlob(pattern);
              return [...rows.values()]
                .filter(row => row.chunk_id.startsWith(prefix))
                .filter(row => !query.includes("COALESCE(is_archived, 0) = 0")
                  || Number(row.is_archived || 0) === 0)
                .sort((left, right) => left.chunk_id.localeCompare(right.chunk_id))
                .slice(0, 2)
                .map(row => ({ chunk_id: row.chunk_id }));
            },
          };
        }
        throw new Error(`unexpected id resolver SQL: ${query}`);
      }
      if (query.startsWith("UPDATE memory_confidence SET")) {
        return {
          run(...args) {
            const id = String(args.at(-1));
            const row = rows.get(id);
            const blockedArchived = query.includes("COALESCE(is_archived, 0) = 0")
              && Number(row?.is_archived || 0) !== 0;
            updates.push({ query, args });
            if (blockedArchived || !row) return { changes: 0 };
            updated.push(id);
            return { changes: 1 };
          },
        };
      }
      throw new Error(`unexpected update SQL: ${query}`);
    },
  };
  return {
    updated,
    updates,
    queries,
    runtime: {
      api: { config: {} },
      getLancedbTable: () => null,
      withDb: fn => fn(db),
      CATEGORY_MAP: overrides.CATEGORY_MAP || {},
      calcTau: overrides.calcTau || (() => 7),
      now: overrides.now || (() => 1_800_000_000_000),
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
        if (query.includes("WHERE c.id = ?")) {
          return {
            all(value) {
              const match = coreRows.find(row => row.id === String(value));
              return match ? [match] : [];
            },
          };
        }
        if (query.includes("WHERE c.id GLOB ?")) {
          return {
            all(pattern) {
              const prefix = literalPrefixFromGlob(pattern);
              return coreRows
                .filter(row => row.id.startsWith(prefix))
                .sort((left, right) => String(left.id).localeCompare(String(right.id)))
                .slice(0, 2);
            },
          };
        }
        throw new Error(`unexpected Core id resolver SQL: ${query}`);
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
  assert.equal(queries.some(query => query.includes("substr(chunk_id")), false);
  assert.equal(queries.some(query => query.includes("chunk_id GLOB ?")), true);
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

test("memory_engine update excludes archived rows at lookup and final mutation", async () => {
  const archivedId = "archived-update-id";
  const { runtime, updated, queries } = createUpdateRuntime([archivedId], {
    rows: {
      [archivedId]: {
        is_archived: 1,
      },
    },
  });
  const execute = createMemoryEngineExecute(runtime);

  const result = await execute("update-archived", {
    action: "update",
    chunk_id: archivedId,
    hit: true,
  });

  assert.deepEqual(result, { error: "no match" });
  assert.deepEqual(updated, []);
  assert.equal(
    queries.some(query => query.includes("WHERE chunk_id = ? AND COALESCE(is_archived, 0) = 0")),
    true,
  );
});

test("classification-only update settles elapsed confidence under old decay parameters before changing category", async () => {
  const id = "classification-decay-id";
  const nowSec = 1_800_000_000;
  const { runtime, updates } = createUpdateRuntime([id], {
    rows: {
      [id]: {
        initial_confidence: 0.5,
        confidence: 0.8,
        last_confidence_update: nowSec - 10 * 86400,
        base_tau: 10,
        hit_count: 0,
        category: "raw_log",
      },
    },
    CATEGORY_MAP: {
      raw_log: { conf: 0.5, tau: 7 },
      preference: { conf: 0.7, tau: 30 },
    },
    now: () => nowSec * 1000,
  });
  const execute = createMemoryEngineExecute(runtime);

  const result = await execute("update-category-decay", {
    action: "update",
    chunk_id: id,
    category: "preference",
  });

  assert.equal(result.success, true);
  assert.equal(updates.length, 1);
  assert.match(updates[0].query, /confidence = \?/);
  assert.match(updates[0].query, /last_confidence_update = \?/);
  assert.match(updates[0].query, /category = \?/);
  assert.match(updates[0].query, /base_tau = \?/);
  assert.match(updates[0].query, /WHERE chunk_id = \? AND COALESCE\(is_archived, 0\) = 0/);
  assert.doesNotMatch(updates[0].query, /initial_confidence = \?/);
  const expectedSettled = 0.8 * Math.exp(-1);
  assert.ok(Math.abs(updates[0].args[0] - expectedSettled) < 1e-12);
  assert.deepEqual(updates[0].args.slice(1), [nowSec, "preference", 30, id]);
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
  assert.equal(queries.some(query => query.includes("substr(c.id")), false);
  assert.equal(queries.some(query => query.includes("WHERE c.id = ?")), true);
});
