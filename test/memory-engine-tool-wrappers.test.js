import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createMemoryEngineExecute,
  createMemoryEngineGetExecute,
  createMemoryEngineSearchExecute,
} from "../lib/tools/memory-engine-actions.js";
import {
  MEMORY_ENGINE_TOOL_NAMES,
  registerMemoryEngineTools,
} from "../lib/tools/register-memory-engine-tools.js";

function createBaseRuntime(overrides = {}) {
  return {
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
    withDb: (fn) => fn({
      prepare: () => ({ all: () => [], get: () => null, run: () => ({}) }),
      transaction: (inner) => inner,
    }),
    getLancedbTable: () => null,
    generateEmbedding: async () => [],
    recordMemoryEvent: () => {},
    getMemorySearchManager: async () => ({ manager: null }),
    calcRealtimeConf: ({ confidence = 0 }) => Number(confidence || 0),
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

test("manifest advertises the three memory-engine tools and no standard memory tool shadowing", () => {
  const manifest = JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"));

  assert.deepEqual(manifest.contracts.tools, MEMORY_ENGINE_TOOL_NAMES);
  assert.equal(manifest.contracts.tools.includes("memory_search"), false);
  assert.equal(manifest.contracts.tools.includes("memory_get"), false);
});

test("runtime tool registration matches the manifest tool contract exactly", () => {
  const seen = [];
  const api = {
    registerTool(tool) {
      seen.push(tool.name);
    },
  };

  registerMemoryEngineTools(api, {
    memoryEngine: async () => ({}),
    memoryEngineSearch: async () => ({}),
    memoryEngineGet: async () => ({}),
  });

  const manifest = JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"));
  assert.deepEqual(seen, MEMORY_ENGINE_TOOL_NAMES);
  assert.deepEqual(seen, manifest.contracts.tools);
});

test("memory_engine_search returns the same top results as memory_engine action=search", async () => {
  const hybridSearchCalls = [];
  const hybridSearch = async (text, options) => {
    hybridSearchCalls.push({ text, options });
    return {
      pool: ["fts", "vector"],
      channels: { fts: [{ id: "mem-1" }], vector: [{ id: "mem-2" }] },
      channel_sizes: { fts: 1, vector: 1 },
      debug: { query: text },
      results: [
        { id: "mem-1", score: 0.9, text: "first" },
        { id: "mem-2", score: 0.8, text: "second" },
      ],
    };
  };
  const runtime = createBaseRuntime({ hybridSearch });
  const executeAction = createMemoryEngineExecute(runtime);
  const executeSearch = createMemoryEngineSearchExecute(runtime);

  const fromAction = await executeAction("tool-1", { action: "search", text: "alpha", top_k: 3 });
  const fromWrapper = await executeSearch("tool-2", { query: "alpha", top_k: 3 });

  assert.deepEqual(fromWrapper.results.map((item) => item.id), fromAction.results.map((item) => item.id));
  assert.deepEqual(fromWrapper, fromAction);
  assert.deepEqual(hybridSearchCalls, [
    { text: "alpha", options: { topK: 3 } },
    { text: "alpha", options: { topK: 3 } },
  ]);
});

test("memory_engine_get handles missing ids cleanly", async () => {
  const runtime = createBaseRuntime({
    withDb: (fn) => fn({
      prepare(sql) {
        const query = String(sql);
        if (query.includes("PRAGMA table_info(chunks)")) {
          return { all: () => [{ name: "id" }, { name: "path" }, { name: "text" }] };
        }
        if (query.includes("FROM chunks c")) {
          return { all: () => [] };
        }
        return { all: () => [], get: () => null, run: () => ({}) };
      },
      transaction: (inner) => inner,
    }),
  });
  const executeGet = createMemoryEngineGetExecute(runtime);

  const result = await executeGet("tool-3", { id: "missing-id" });

  assert.deepEqual(result, {
    found: false,
    id: "missing-id",
    error: "not found",
  });
});

test("memory_engine_get returns source path and line range when chunk metadata is available", async () => {
  const runtime = createBaseRuntime({
    withDb: (fn) => fn({
      prepare(sql) {
        const query = String(sql);
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
            all: () => [{
              id: "chunk-1234567890abcdef",
              path: "memory/smart-add/2026-05-27.md",
              source: "memory/smart-add/2026-05-27.md",
              start_line: 12,
              end_line: 18,
              updated_at: 1710000000,
              text: "stored memory",
              confidence: 0.7,
              last_confidence_update: 1710000000,
              base_tau: 30,
              hit_count: 2,
              is_protected: 0,
              conflict_flag: 0,
              is_archived: 0,
              category: "preference",
            }],
          };
        }
        return { all: () => [], get: () => null, run: () => ({}) };
      },
      transaction: (inner) => inner,
    }),
  });
  const executeGet = createMemoryEngineGetExecute(runtime);

  const result = await executeGet("tool-4", { id: "chunk-1234" });

  assert.equal(result.found, true);
  assert.equal(result.memory.id, "chunk-1234567890abcdef");
  assert.equal(result.memory.path, "memory/smart-add/2026-05-27.md");
  assert.equal(result.memory.source, "memory/smart-add/2026-05-27.md");
  assert.deepEqual(result.memory.line_range, { start: 12, end: 18 });
});

test("memory_engine_get returns multiple-match metadata for ambiguous id prefixes", async () => {
  const runtime = createBaseRuntime({
    withDb: (fn) => fn({
      prepare(sql) {
        const query = String(sql);
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
            all: () => [
              {
                id: "sharedprefix-111111111111",
                path: "memory/smart-add/2026-05-27.md",
                source: "memory/smart-add/2026-05-27.md",
                start_line: 10,
                end_line: 12,
                updated_at: 1710000000,
                text: "first ambiguous memory",
                confidence: 0.7,
                last_confidence_update: 1710000000,
                base_tau: 30,
                hit_count: 2,
                is_protected: 0,
                conflict_flag: 0,
                is_archived: 0,
                category: "preference",
              },
              {
                id: "sharedprefix-222222222222",
                path: "memory/smart-add/2026-05-28.md",
                source: "memory/smart-add/2026-05-28.md",
                start_line: 14,
                end_line: 16,
                updated_at: 1710000100,
                text: "second ambiguous memory",
                confidence: 0.6,
                last_confidence_update: 1710000100,
                base_tau: 7,
                hit_count: 1,
                is_protected: 0,
                conflict_flag: 0,
                is_archived: 0,
                category: "raw_log",
              },
            ],
          };
        }
        return { all: () => [], get: () => null, run: () => ({}) };
      },
      transaction: (inner) => inner,
    }),
  });
  const executeGet = createMemoryEngineGetExecute(runtime);

  const result = await executeGet("tool-5", { id: "sharedprefix" });

  assert.equal(result.found, false);
  assert.equal(result.id, "sharedprefix");
  assert.equal(result.error, "multiple matches");
  assert.deepEqual(result.matches, [
    "sharedprefix-111",
    "sharedprefix-222",
  ]);
  assert.equal("memory" in result, false);
});
