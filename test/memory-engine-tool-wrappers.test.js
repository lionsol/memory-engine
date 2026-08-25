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
    registerTool(tool, options) {
      seen.push(options?.name || tool.name);
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

test("registered memory_engine_get requires exact Owner context before lookup", async () => {
  const registrations = [];
  const executorCalls = [];
  const ownerResult = {
    found: true,
    memory: {
      id: "existing-memory",
      text: "owner-visible content",
      source: "memory/owner.md",
    },
  };
  const api = {
    registerTool(tool, options) {
      registrations.push({ tool, options });
    },
  };

  registerMemoryEngineTools(api, {
    memoryEngine: async () => ({}),
    memoryEngineSearch: async () => ({}),
    memoryEngineGet: async (...args) => {
      executorCalls.push(args);
      return ownerResult;
    },
  });

  const getRegistration = registrations.find(
    registration => registration.options?.name === "memory_engine_get",
  );
  assert.ok(getRegistration);
  assert.equal(typeof getRegistration.tool, "function");

  const authorizedTool = getRegistration.tool({ senderIsOwner: true });
  const authorizedResult = await authorizedTool.execute("owner-call", { id: "existing-memory" });
  assert.deepEqual(authorizedResult, ownerResult);
  assert.equal(executorCalls.length, 1);

  const unauthorizedContexts = [
    { senderIsOwner: false },
    {},
    {
      agentId: "main",
      messageChannel: "webchat",
      requesterSenderId: "owner-like",
      sessionKey: "owner-like-session",
      deliveryContext: { channel: "webchat" },
    },
  ];
  for (const context of unauthorizedContexts) {
    const unauthorizedTool = getRegistration.tool(context);
    const existingResult = await unauthorizedTool.execute("denied-existing", { id: "existing-memory" });
    const missingResult = await unauthorizedTool.execute("denied-missing", { id: "missing-memory" });
    const expected = {
      found: false,
      error: "owner_authorization_required",
      code: "MEMORY_GET_OWNER_AUTH_REQUIRED",
    };
    assert.deepEqual(existingResult, expected);
    assert.deepEqual(missingResult, expected);
  }
  assert.equal(executorCalls.length, 1);
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
  assert.deepEqual(Object.keys(fromAction).sort(), ["channel_sizes", "channels", "debug", "pool", "results"]);
  assert.deepEqual(fromWrapper, {
    results: [
      { id: "mem-1", text: "first" },
      { id: "mem-2", text: "second" },
    ],
  });
  assert.deepEqual(hybridSearchCalls, [
    { text: "alpha", options: { topK: 3 } },
    { text: "alpha", options: { topK: 3 } },
  ]);
});

test("memory_engine_search returns a bounded whitelist projection", async () => {
  const longText = "x".repeat(300);
  const runtime = createBaseRuntime({
    hybridSearch: async () => ({
      pool: ["fts"],
      channels: { fts: [{ id: "internal-channel-id", text: longText }] },
      channel_sizes: { fts: 1 },
      debug: { preview: longText, secret_debug_field: "must not leak" },
      results: [{
        id: "event-id",
        memory_id: "full-memory-id",
        canonical_id: "cmem:core:full-memory-id",
        text: longText,
        path: "memory/example.md",
        category: "preference",
        kind: "fact",
        category_authority: "managed",
        confidence_mode: "managed",
        source_type: "memory-engine-managed",
        external_badge: false,
        semantic_score: 0.91,
        rrf_score: 0.82,
        final_score: 0.8,
        sources: ["fts", "vector", { internal: "must not leak" }],
        similarity: 0.93,
        confidence: 0.77,
        created_at: 1710000000,
        secret_internal_field: "must not leak",
        source_text: "must not leak",
        canonical_memory: { source: { text: "must not leak" } },
        raw_payload: { text: "must not leak" },
        lifecycle: { management: "managed" },
        classification: { risk: "must not leak" },
      }],
    }),
  });
  const executeSearch = createMemoryEngineSearchExecute(runtime);

  const result = await executeSearch("tool-bounded-search", { query: "bounded", top_k: 1 });
  const projected = result.results[0];

  assert.equal(projected.text, longText.slice(0, 240));
  assert.equal(projected.text.length, 240);
  assert.deepEqual(projected.sources, ["fts", "vector"]);
  assert.deepEqual(projected, {
    id: "event-id",
    memory_id: "full-memory-id",
    canonical_id: "cmem:core:full-memory-id",
    text: longText.slice(0, 240),
    path: "memory/example.md",
    category: "preference",
    kind: "fact",
    category_authority: "managed",
    confidence_mode: "managed",
    source_type: "memory-engine-managed",
    external_badge: false,
    semantic_score: 0.91,
    rrf_score: 0.82,
    final_score: 0.8,
    sources: ["fts", "vector"],
    similarity: 0.93,
    confidence: 0.77,
    created_at: 1710000000,
  });
  for (const field of [
    "pool",
    "channels",
    "channel_sizes",
    "debug",
    "secret_internal_field",
    "source_text",
    "canonical_memory",
    "raw_payload",
    "lifecycle",
    "classification",
  ]) {
    assert.equal(field in result, false);
    assert.equal(field in projected, false);
  }
});

test("manual memory_engine_search is not filtered by autoRecall hard deny policy", async () => {
  const runtime = createBaseRuntime({
    hybridSearch: async () => ({
      results: [
        {
          id: "suspected-tool-output-1",
          primary_bucket: "suspected_tool_output",
          sample_buckets: ["suspected_tool_output"],
          text: "tool transcript residue",
        },
      ],
    }),
  });
  const executeSearch = createMemoryEngineSearchExecute(runtime);

  const result = await executeSearch("tool-manual-search", { query: "show me that memory", top_k: 3 });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].id, "suspected-tool-output-1");
  assert.equal(result.results[0].text, "tool transcript residue");
  assert.equal("primary_bucket" in result.results[0], false);
  assert.equal("sample_buckets" in result.results[0], false);
});

test("memory_engine_get handles missing ids cleanly", async () => {
  const seen = [];
  const runtime = createBaseRuntime({
    onMemoryEngineGetSuccess: (id) => seen.push(id),
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
  assert.deepEqual(seen, []);
});

test("memory_engine_get executor can still return suspected_tool_output memory", async () => {
  const seen = [];
  const runtime = createBaseRuntime({
    onMemoryEngineGetSuccess: (id) => seen.push(id),
    withDb: (fn) => fn({
      prepare(sql) {
        const query = String(sql);
        if (query.includes("PRAGMA table_info(chunks)")) {
          return { all: () => [{ name: "id" }, { name: "path" }, { name: "text" }] };
        }
        if (query.includes("FROM chunks c")) {
          return {
            all: () => [{
              id: "suspected-tool-output-1",
              path: "memory/dreaming/light/2026-05-16.md",
              text: "tool transcript residue",
              confidence: 0.2,
              last_confidence_update: 1710000000,
              base_tau: 7,
              hit_count: 0,
              is_protected: 0,
              conflict_flag: 0,
              is_archived: 0,
              category: "raw_log",
            }],
          };
        }
        return { all: () => [], get: () => null, run: () => ({}) };
      },
      transaction: (inner) => inner,
    }),
  });
  const executeGet = createMemoryEngineGetExecute(runtime);

  const result = await executeGet("tool-manual-get", { id: "suspected-tool-out" });

  assert.equal(result.found, true);
  assert.equal(result.memory.id, "suspected-tool-output-1");
  assert.equal(result.memory.path, "memory/dreaming/light/2026-05-16.md");
  assert.deepEqual(seen, ["suspected-tool-output-1"]);
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

test("memory_engine_get preserves managed-first and reinforcement ordering for ambiguous id prefixes", async () => {
  const runtime = createBaseRuntime({
    withDb: () => {
      throw new Error("combined DB accessor must not be used");
    },
    withCoreDb: (fn) => fn({
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
              },
              {
                id: "sharedprefix-222222222222",
                path: "memory/smart-add/2026-05-28.md",
                source: "memory/smart-add/2026-05-28.md",
                start_line: 14,
                end_line: 16,
                updated_at: 1710000100,
                text: "second ambiguous memory",
              },
            ],
          };
        }
        throw new Error(`unexpected Core SQL: ${query}`);
      },
    }),
    withEngineDb: (fn) => fn({
      prepare(sql) {
        const query = String(sql);
        if (query.includes("FROM memory_confidence WHERE chunk_id IN")) {
          return {
            all: () => [
              {
                chunk_id: "sharedprefix-111111111111",
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
                chunk_id: "sharedprefix-222222222222",
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
        throw new Error(`unexpected Engine SQL: ${query}`);
      },
    }),
  });
  const executeGet = createMemoryEngineGetExecute(runtime);

  const result = await executeGet("tool-5", { id: "sharedprefix" });

  assert.equal(result.found, false);
  assert.equal(result.id, "sharedprefix");
  assert.equal(result.error, "multiple matches");
  assert.deepEqual(result.matches, [
    "sharedprefix-222",
    "sharedprefix-111",
  ]);
  assert.equal("memory" in result, false);
});
