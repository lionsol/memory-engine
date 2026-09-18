import test from "node:test";
import assert from "node:assert/strict";

import {
  RECALL_HINT_V1_VECTOR_QUERY_MAX_CODE_POINTS,
  buildRecallHintVectorQueryPlan,
} from "../lib/recall/hint/recall-hint-query-plan.js";
import {
  normalizeRecallHintV1,
  validateRecallHintV1,
} from "../lib/recall/hint/recall-hint-v1.js";
import { RECALL_HINT_RUNTIME_PROVIDER_RESULT_SCHEMA_V1 } from "../lib/recall/hint/recall-hint-provider-contract-v1.js";
import { createAutoRecallHookLifecycle } from "../lib/recall/auto-recall-hook-lifecycle.js";
import { collectVectorCandidates } from "../lib/recall/hybrid/channels/vector.js";
import { hybridSearch } from "../lib/recall/hybrid-search.js";
import {
  createCandidateCounts,
  createHybridDebug,
  createHybridWarnings,
} from "../lib/recall/hybrid/debug.js";
import { createHybridRuntimeContext, buildHybridSearchRuntime } from "../lib/recall/hybrid/runtime-context.js";
import { createMemoryEngineExecute, createMemoryEngineSearchExecute } from "../lib/tools/memory-engine-actions.js";

test("Recall Hint v1 validates, trims, deduplicates, and permits an empty normalized hint", () => {
  const validation = validateRecallHintV1({
    version: "recall_hint_v1",
    project: "  memory-engine  ",
    entities: ["  plugin  ", "plugin", "  ", "OpenClaw"],
    time_relation: { relation: "before" },
    query_facets: [" reason ", "reason"],
  });

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.normalized, {
    version: "recall_hint_v1",
    project: "memory-engine",
    entities: ["plugin", "OpenClaw"],
    query_facets: ["reason"],
  });
  assert.deepEqual(normalizeRecallHintV1({ version: "recall_hint_v1", project: " \t" }), {
    version: "recall_hint_v1",
  });
  assert.deepEqual(normalizeRecallHintV1({
    version: "recall_hint_v1",
    time_relation: { relation: "before", anchor: " \t" },
  }), {
    version: "recall_hint_v1",
  });
});

test("Recall Hint v1 rejects unknown or malformed fields and uses code-point bounds", () => {
  const unknown = validateRecallHintV1({
    version: "recall_hint_v1",
    hidden_context: "not allowed",
  });
  assert.equal(unknown.valid, false);
  assert.equal(unknown.errors.includes("unknown_field:hidden_context"), true);

  const malformed = validateRecallHintV1({
    version: "recall_hint_v1",
    entities: ["ok", 7],
    query_facets: ["ok", "second", "third"],
    time_relation: { relation: "before", anchor: "   " },
  });
  assert.equal(malformed.valid, false);
  assert.equal(malformed.errors.includes("entities[1]_must_be_string"), true);
  assert.equal(malformed.errors.includes("query_facets_exceeds_item_bound"), true);

  const longProject = validateRecallHintV1({
    version: "recall_hint_v1",
    project: "😀".repeat(97),
  });
  assert.equal(longProject.valid, false);
  assert.equal(longProject.errors.includes("project_exceeds_code_point_bound"), true);
});

test("Recall Hint v1 query plans are deterministic, bounded, and keep zero to two expansions", () => {
  const one = buildRecallHintVectorQueryPlan("original query", normalizeRecallHintV1({
    version: "recall_hint_v1",
    project: "project-a",
    entities: ["entity-a"],
  }));
  assert.equal(one.mode, "recall_hint_v1");
  assert.equal(one.queries.length, 1);
  assert.match(one.queries[0], /^original query /);
  assert.match(one.queries[0], /project:project-a/);
  assert.match(one.queries[0], /entities:entity-a/);

  const oneFacet = buildRecallHintVectorQueryPlan("original query", normalizeRecallHintV1({
    version: "recall_hint_v1",
    query_facets: ["reason"],
  }));
  assert.equal(oneFacet.queries.length, 1);
  assert.match(oneFacet.queries[0], /original query reason/);

  const twoFacets = buildRecallHintVectorQueryPlan("original query", normalizeRecallHintV1({
    version: "recall_hint_v1",
    query_facets: ["reason", "limitation"],
  }));
  assert.deepEqual(twoFacets.queries.map(query => query.includes("reason") || query.includes("limitation")), [true, true]);

  const time = buildRecallHintVectorQueryPlan("original query", normalizeRecallHintV1({
    version: "recall_hint_v1",
    time_relation: { relation: "after", anchor: "migration" },
  }));
  assert.match(time.queries[0], /time_relation:after/);
  assert.match(time.queries[0], /time_anchor:migration/);

  assert.equal(buildRecallHintVectorQueryPlan("original query", { version: "recall_hint_v1" }), null);
  assert.equal(buildRecallHintVectorQueryPlan("   ", { version: "recall_hint_v1", project: "x" }), null);
  assert.equal(
    Array.from(twoFacets.queries[0]).length <= RECALL_HINT_V1_VECTOR_QUERY_MAX_CODE_POINTS,
    true,
  );
});

function makeVectorContext(vectorQueryPlan, rowsByQuery, vectorTopK = 2, { recallHintVectorExecutionMode } = {}) {
  const candidateCounts = createCandidateCounts();
  const debug = createHybridDebug({
    rawQuery: "query",
    strippedQuery: "query",
    normalizedQuery: "query",
    queryTerms: ["query"],
    candidateCounts,
    minConfidence: 0,
    lexicalConfidenceThreshold: 1,
  });
  const channels = {};
  const seenQueries = [];
  const { warnVectorChannelOnce } = createHybridWarnings();
  return {
    seenQueries,
    channels,
    debug,
    candidateCounts,
    shouldSkipVector: false,
    getLancedbRuntimeRuntime: null,
    getLancedbTableRuntime: () => ({
      search(vector) {
        const rows = rowsByQuery[Number(vector[0]) - 1] || [];
        return {
          limit() { return this; },
          execute: async () => rows,
        };
      },
    }),
    getMemorySearchManagerFn: async () => ({ manager: null }),
    generateEmbeddingRuntime: async query => {
      seenQueries.push(query);
      return [seenQueries.length];
    },
    strippedQuery: "query",
    vectorTopK,
    vectorReadyTimeoutMs: 400,
    confidenceMap: new Map(),
    chunkMetaMap: new Map(),
    normalizeCandidate: row => ({
      ...row,
      id: String(row.id),
      semantic_score: Number(row.similarity ?? (1 - Number(row._distance || 0))),
      similarity: Number(row.similarity ?? (1 - Number(row._distance || 0))),
    }),
    filterForRerank: () => true,
    toDebugErrorMessage: error => String(error?.message || error),
    warnVectorChannelOnce,
    cfg: null,
    vectorQueryPlan,
    recallHintVectorExecutionMode,
  };
}

test("recall_hint_v1 vector mode prepends original, fuses and deduplicates, and stays bounded", async () => {
  const plan = buildRecallHintVectorQueryPlan("query", normalizeRecallHintV1({
    version: "recall_hint_v1",
    query_facets: ["reason", "limitation"],
  }));
  const ctx = makeVectorContext(plan, [
    [
      { id: "useful-original", text: "useful", similarity: 0.95 },
      { id: "displaced-original", text: "displaced", similarity: 0.9 },
    ],
    [
      { id: "useful-original", text: "useful", similarity: 0.8 },
      { id: "extra-expansion", text: "extra", similarity: 0.7 },
    ],
    [
      { id: "extra-expansion", text: "extra", similarity: 0.7 },
    ],
  ], 2);

  await collectVectorCandidates(ctx);

  assert.deepEqual(ctx.seenQueries, [
    "query",
    "query reason",
    "query limitation",
  ]);
  assert.equal(ctx.debug.vector_query_mode, "recall_hint_v1");
  assert.equal(ctx.debug.vector_query_count, 3);
  assert.equal(ctx.debug.vector_search_count, 3);
  assert.equal(ctx.candidateCounts.vector_raw, 5);
  assert.equal(ctx.candidateCounts.vector_after_conf_filter, 2);
  assert.equal(new Set(ctx.channels.vector.map(item => item.id)).size, 2);
  assert.equal(ctx.channels.vector.some(item => item.id === "extra-expansion"), true);
  assert.equal(ctx.channels.vector.some(item => item.id === "displaced-original"), false);
  assert.equal(ctx.channels.vector.find(item => item.id === "useful-original").vector_query_rrf_score > 1 / 61, true);
});

test("recall_hint_v1 parallel vector execution is opt-in and output-equivalent to sequential fusion", async () => {
  const plan = buildRecallHintVectorQueryPlan("query", normalizeRecallHintV1({
    version: "recall_hint_v1",
    query_facets: ["reason", "limitation"],
  }));
  const rows = [
    [
      { id: "useful-original", text: "useful", similarity: 0.95 },
      { id: "displaced-original", text: "displaced", similarity: 0.9 },
    ],
    [
      { id: "useful-original", text: "useful", similarity: 0.8 },
      { id: "extra-expansion", text: "extra", similarity: 0.7 },
    ],
    [
      { id: "extra-expansion", text: "extra", similarity: 0.7 },
    ],
  ];
  const sequential = makeVectorContext(plan, rows, 2);
  const parallel = makeVectorContext(plan, rows, 2, { recallHintVectorExecutionMode: "parallel" });
  const vectorByQuery = new Map([
    ["query", [1]],
    ["query reason", [2]],
    ["query limitation", [3]],
  ]);
  parallel.generateEmbeddingRuntime = async query => {
    parallel.seenQueries.push(query);
    return vectorByQuery.get(query);
  };

  await collectVectorCandidates(sequential);
  await collectVectorCandidates(parallel);

  const project = ctx => ctx.channels.vector.map(item => ({
    id: item.id,
    semantic_score: item.semantic_score,
    similarity: item.similarity,
    vector_query_rrf_score: item.vector_query_rrf_score,
  }));
  assert.deepEqual(project(parallel), project(sequential));
  assert.equal(sequential.debug.vector_query_execution, "sequential");
  assert.equal(parallel.debug.vector_query_execution, "parallel");
  assert.equal(parallel.debug.vector_search_count, 3);
  assert.equal(parallel.candidateCounts.vector_raw, sequential.candidateCounts.vector_raw);

  const unknownMode = makeVectorContext(plan, rows, 2, { recallHintVectorExecutionMode: "unknown" });
  await collectVectorCandidates(unknownMode);
  assert.equal(unknownMode.debug.vector_query_execution, "sequential");
  assert.deepEqual(project(unknownMode), project(sequential));
});

test("recall_hint_v1 parallel execution overlaps embedding/search work without changing call counts", async () => {
  const plan = buildRecallHintVectorQueryPlan("query", normalizeRecallHintV1({
    version: "recall_hint_v1",
    query_facets: ["reason", "limitation"],
  }));
  const ctx = makeVectorContext(plan, [[], [], []], 3, { recallHintVectorExecutionMode: "parallel" });
  let activeEmbeddings = 0;
  let maxActiveEmbeddings = 0;
  let embeddingCalls = 0;
  let activeSearches = 0;
  let maxActiveSearches = 0;
  let searchCalls = 0;
  const queryIndex = new Map([
    ["query", 1],
    ["query reason", 2],
    ["query limitation", 3],
  ]);

  ctx.generateEmbeddingRuntime = async query => {
    ctx.seenQueries.push(query);
    embeddingCalls += 1;
    activeEmbeddings += 1;
    maxActiveEmbeddings = Math.max(maxActiveEmbeddings, activeEmbeddings);
    await new Promise(resolve => setTimeout(resolve, 15));
    activeEmbeddings -= 1;
    return [queryIndex.get(query)];
  };
  ctx.getLancedbTableRuntime = () => ({
    search(vector) {
      return {
        limit() { return this; },
        async execute() {
          searchCalls += 1;
          activeSearches += 1;
          maxActiveSearches = Math.max(maxActiveSearches, activeSearches);
          await new Promise(resolve => setTimeout(resolve, 15));
          activeSearches -= 1;
          return [{ id: `row-${vector[0]}`, text: "row", similarity: 0.9 }];
        },
      };
    },
  });

  await collectVectorCandidates(ctx);

  assert.equal(embeddingCalls, 3);
  assert.equal(searchCalls, 3);
  assert.ok(maxActiveEmbeddings > 1);
  assert.ok(maxActiveSearches > 1);
  assert.equal(ctx.debug.vector_query_execution, "parallel");
});

test("legacy vector query plans retain the historical exactly-two expansion contract", async () => {
  const legacy = makeVectorContext(
    { queries: ["planner one", "planner two"] },
    [[], [], []],
    5,
    { recallHintVectorExecutionMode: "parallel" },
  );
  await collectVectorCandidates(legacy);
  assert.deepEqual(legacy.seenQueries, ["query", "planner one", "planner two"]);
  assert.equal(legacy.debug.vector_query_mode, "bounded_multi_query");
  assert.equal(legacy.debug.vector_query_count, 3);
  assert.equal(legacy.debug.vector_query_execution, "sequential");

  const invalidOne = makeVectorContext({ mode: "recall_hint_v1", queries: ["query"] }, [[]], 5);
  await collectVectorCandidates(invalidOne);
  assert.deepEqual(invalidOne.seenQueries, ["query"]);
  assert.equal(invalidOne.debug.vector_multi_query_failed, true);
  assert.equal(invalidOne.debug.vector_hint_fallback_original, true);
});

test("recall_hint_v1 parallel failure remains fail-closed but may launch sibling query work before fallback", async () => {
  const plan = buildRecallHintVectorQueryPlan("query", normalizeRecallHintV1({
    version: "recall_hint_v1",
    query_facets: ["reason", "limitation"],
  }));
  const ctx = makeVectorContext(plan, [], 5, { recallHintVectorExecutionMode: "parallel" });
  const embeddingCalls = [];
  ctx.generateEmbeddingRuntime = async query => {
    embeddingCalls.push(query);
    if (query === "query reason") throw new Error("fake parallel expansion failure");
    return [query === "query" ? 1 : 3];
  };
  ctx.getLancedbTableRuntime = () => ({
    search(vector) {
      return {
        limit() { return this; },
        async execute() {
          return vector[0] === 1
            ? [{ id: "original-only", text: "original", similarity: 0.9 }]
            : [{ id: "sibling-expansion", text: "sibling", similarity: 0.8 }];
        },
      };
    },
  });

  await collectVectorCandidates(ctx);

  assert.equal(ctx.debug.vector_query_execution, "parallel");
  assert.equal(ctx.debug.vector_multi_query_failed, true);
  assert.equal(ctx.debug.vector_hint_fallback_original, true);
  assert.deepEqual(embeddingCalls.slice(0, 3), ["query", "query reason", "query limitation"]);
  assert.equal(embeddingCalls.at(-1), "query");
  assert.deepEqual(ctx.channels.vector.map(item => item.id), ["original-only"]);
});

test("recall_hint_v1 expansion failure falls back to the original vector query", async () => {
  const plan = buildRecallHintVectorQueryPlan("query", normalizeRecallHintV1({
    version: "recall_hint_v1",
    query_facets: ["reason"],
  }));
  const ctx = makeVectorContext(plan, [
    [{ id: "original-only", text: "original", similarity: 0.9 }],
  ], 5);
  ctx.generateEmbeddingRuntime = async query => {
    ctx.seenQueries.push(query);
    if (query !== "query") throw new Error("fake expansion embedding failure");
    return [1];
  };

  await collectVectorCandidates(ctx);

  assert.deepEqual(ctx.seenQueries, ["query", "query reason", "query"]);
  assert.equal(ctx.debug.vector_multi_query_failed, true);
  assert.equal(ctx.debug.vector_hint_fallback_original, true);
  assert.deepEqual(ctx.channels.vector.map(item => item.id), ["original-only"]);
});

test("recall_hint_v1 missing embedding runtime falls back without ReferenceError", async () => {
  const plan = buildRecallHintVectorQueryPlan("query", normalizeRecallHintV1({
    version: "recall_hint_v1",
    project: "project-a",
  }));
  const ctx = makeVectorContext(plan, [], 5);
  ctx.generateEmbeddingRuntime = null;
  ctx.getMemorySearchManagerFn = async () => ({
    manager: {
      search: async query => query === "query"
        ? [{ id: "manager-original", text: "original manager result", similarity: 0.8 }]
        : [],
    },
  });

  await collectVectorCandidates(ctx);

  assert.equal(ctx.debug.vector_multi_query_failed, true);
  assert.equal(ctx.debug.vector_hint_fallback_original, true);
  assert.deepEqual(ctx.channels.vector.map(item => item.id), ["manager-original"]);
});

function makeSearchContext({ recallHintProvider, hybridSearch, recallHintVectorExecutionMode, recallHintRuntimeCanary, resolveExplicitSearchRuntimeContext } = {}) {
  return createHybridRuntimeContext({
    dataAccess: {
      getLancedbTable: () => null,
    },
    retrievalPolicy: {
      recallHintProvider,
      hybridSearch,
      recallHintVectorExecutionMode,
      recallHintRuntimeCanary,
      resolveExplicitSearchRuntimeContext,
      calcRealtimeConf: () => 0.8,
      generateEmbedding: async () => [],
    },
    telemetry: {
      recordHybridSearchObservation: () => true,
      recordMemoryEvent: () => {},
    },
  });
}

test("Recall Hint provider is injected only for explicit memory_engine_search and forwards a bounded plan", async () => {
  const calls = { provider: 0, args: [], runtimes: [] };
  const context = makeSearchContext({
    recallHintVectorExecutionMode: "parallel",
    recallHintProvider: input => {
      calls.provider += 1;
      calls.args.push(input);
      return {
        version: "recall_hint_v1",
        project: "project-a",
        query_facets: ["reason"],
      };
    },
    hybridSearch: async (query, options, runtime) => {
      calls.runtimes.push({ query, options, runtime });
      return { results: [], debug: {} };
    },
  });
  const executeSearch = createMemoryEngineSearchExecute(context);

  await executeSearch("tool-1", { query: "original query", top_k: 3 });

  assert.equal(calls.provider, 1);
  assert.equal(calls.args.length, 1);
  assert.equal(calls.args[0].query, "original query");
  assert.equal(calls.args[0].signal instanceof AbortSignal, true);
  assert.equal(calls.args[0].signal.aborted, false);
  assert.deepEqual(calls.runtimes[0].runtime.vectorQueryPlan, {
    mode: "recall_hint_v1",
    queries: ["original query reason project:project-a"],
  });
  assert.equal(calls.runtimes[0].runtime.recallHintVectorExecutionMode, "parallel");
  assert.deepEqual(calls.runtimes[0].runtime.recallHintDebug, {
    mode: "recall_hint_v1",
    status: "applied",
    hint_entity_count: 0,
    hint_facet_count: 1,
    hint_has_project: true,
    hint_time_relation: null,
    hint_expansion_count: 1,
    hint_canary_in_scope: true,
    hint_canary_reason: "legacy_injected_provider",
    hint_vector_execution_mode: "parallel",
  });
});

test("Recall Hint runtime canary blocks provider outside the exact trusted session", async () => {
  let providerCalls = 0;
  const observed = [];
  const context = makeSearchContext({
    recallHintRuntimeCanary: {
      enabled: true,
      sessionIds: ["session-allowed"],
      vectorExecutionMode: "parallel",
    },
    resolveExplicitSearchRuntimeContext: () => ({
      source: "openclaw_runtime",
      sessionIdentity: "session-other",
      requestIdentity: "tool-1",
    }),
    recallHintProvider: () => {
      providerCalls += 1;
      return { version: "recall_hint_v1", query_facets: ["reason"] };
    },
    hybridSearch: async (query, options, runtime) => {
      observed.push({ query, options, runtime });
      return { results: [], debug: {} };
    },
  });

  await createMemoryEngineSearchExecute(context)("tool-1", { query: "original query", top_k: 3 });

  assert.equal(providerCalls, 0);
  assert.equal(Object.hasOwn(observed[0].runtime, "vectorQueryPlan"), false);
  assert.equal(observed[0].runtime.recallHintDebug.status, "canary_blocked");
  assert.equal(observed[0].runtime.recallHintDebug.hint_canary_in_scope, false);
  assert.equal(observed[0].runtime.recallHintDebug.hint_canary_reason, "session_not_allowlisted");
  assert.equal(observed[0].runtime.recallHintDebug.hint_vector_execution_mode, "parallel");
});

test("Recall Hint runtime canary permits the exact trusted session and selects parallel execution", async () => {
  let providerCalls = 0;
  const observed = [];
  const context = makeSearchContext({
    recallHintRuntimeCanary: {
      enabled: true,
      sessionIds: ["session-allowed"],
      vectorExecutionMode: "parallel",
    },
    resolveExplicitSearchRuntimeContext: () => ({
      source: "openclaw_runtime",
      sessionIdentity: "session-allowed",
      requestIdentity: "tool-2",
    }),
    recallHintProvider: () => {
      providerCalls += 1;
      return { version: "recall_hint_v1", query_facets: ["reason"] };
    },
    hybridSearch: async (query, options, runtime) => {
      observed.push({ query, options, runtime });
      return { results: [], debug: {} };
    },
  });

  await createMemoryEngineSearchExecute(context)("tool-2", { query: "original query", top_k: 3 });

  assert.equal(providerCalls, 1);
  assert.equal(observed[0].runtime.recallHintVectorExecutionMode, "parallel");
  assert.equal(observed[0].runtime.recallHintDebug.status, "applied");
  assert.equal(observed[0].runtime.recallHintDebug.hint_canary_in_scope, true);
  assert.equal(observed[0].runtime.recallHintDebug.hint_canary_reason, "session_allowlisted");
});

test("Recall Hint provider envelope forwards bounded usage and latency into runtime debug", async () => {
  const observed = [];
  const context = makeSearchContext({
    recallHintRuntimeCanary: {
      enabled: true,
      sessionIds: ["session-allowed"],
      vectorExecutionMode: "parallel",
    },
    resolveExplicitSearchRuntimeContext: () => ({
      source: "openclaw_runtime",
      sessionIdentity: "session-allowed",
      requestIdentity: "tool-envelope",
    }),
    recallHintProvider: () => ({
      schema: RECALL_HINT_RUNTIME_PROVIDER_RESULT_SCHEMA_V1,
      hint: {
        version: "recall_hint_v1",
        query_facets: ["reason"],
      },
      usage: {
        input_tokens: 321,
        output_tokens: 45,
      },
      latency_ms: 456.75,
    }),
    hybridSearch: async (query, options, runtime) => {
      observed.push({ query, options, runtime });
      return { results: [], debug: {} };
    },
  });

  await createMemoryEngineSearchExecute(context)("tool-envelope", {
    query: "original query",
    top_k: 3,
  });

  assert.equal(observed[0].runtime.recallHintDebug.status, "applied");
  assert.equal(observed[0].runtime.recallHintDebug.hint_provider_input_tokens, 321);
  assert.equal(observed[0].runtime.recallHintDebug.hint_provider_output_tokens, 45);
  assert.equal(observed[0].runtime.recallHintDebug.hint_provider_latency_ms, 456.75);
});

test("Recall Hint runtime canary fails closed when trusted session context is unavailable", async () => {
  let providerCalls = 0;
  const observed = [];
  const context = makeSearchContext({
    recallHintRuntimeCanary: {
      enabled: true,
      sessionIds: ["session-allowed"],
      vectorExecutionMode: "parallel",
    },
    resolveExplicitSearchRuntimeContext: () => null,
    recallHintProvider: () => {
      providerCalls += 1;
      return { version: "recall_hint_v1", query_facets: ["reason"] };
    },
    hybridSearch: async (query, options, runtime) => {
      observed.push({ query, options, runtime });
      return { results: [], debug: {} };
    },
  });

  await createMemoryEngineSearchExecute(context)("tool-3", { query: "original query", top_k: 3 });

  assert.equal(providerCalls, 0);
  assert.equal(observed[0].runtime.recallHintDebug.status, "canary_blocked");
  assert.equal(observed[0].runtime.recallHintDebug.hint_canary_reason, "trusted_runtime_context_missing");
});

test("Recall Hint failures fall back to original-query retrieval without failing explicit search", async () => {
  const cases = [
    { status: "provider_error", provider: () => { throw new Error("fake provider failed"); } },
    { status: "provider_timeout", provider: () => { throw new Error("fake provider timeout"); } },
    { status: "provider_timeout", provider: () => new Promise(() => {}) },
    { status: "invalid_hint", provider: () => ({ version: "wrong", secret: "hidden" }) },
    { status: "empty_hint", provider: () => ({ version: "recall_hint_v1" }) },
  ];
  for (const item of cases) {
    const observed = [];
    const context = makeSearchContext({
      recallHintProvider: item.provider,
      hybridSearch: async (query, options, runtime) => {
        observed.push({ query, options, runtime });
        return { results: [], debug: {} };
      },
    });
    const executeSearch = createMemoryEngineSearchExecute(context);
    const result = await executeSearch("tool-1", { query: "original query", top_k: 3 });
    assert.deepEqual(result, { results: [] }, item.status);
    assert.equal(observed[0].query, "original query", item.status);
    assert.equal(Object.hasOwn(observed[0].runtime, "vectorQueryPlan"), false, item.status);
    assert.equal(observed[0].runtime.recallHintDebug.status, item.status, item.status);
  }
});

test("legacy action search and AutoRecall do not invoke the Recall Hint provider", async () => {
  let providerCalls = 0;
  const hybridCalls = [];
  const context = makeSearchContext({
    recallHintProvider: () => {
      providerCalls += 1;
      return { version: "recall_hint_v1", query_facets: ["unexpected"] };
    },
    hybridSearch: async (query, options, runtime) => {
      hybridCalls.push({ query, options, runtime });
      return { results: [], debug: {} };
    },
  });
  const executeAction = createMemoryEngineExecute(context);
  await executeAction("action-1", { action: "search", text: "action query", top_k: 3 });
  assert.equal(providerCalls, 0);
  assert.equal(Object.hasOwn(hybridCalls[0].runtime, "vectorQueryPlan"), false);

  const hooks = [];
  const lifecycle = createAutoRecallHookLifecycle({
    api: {
      logger: { warn() {} },
      on(name, handler, options) { hooks.push({ name, handler, options }); },
      registerMemoryPromptSupplement() {},
    },
    autoRecallConfig: { enabled: true, topK: 3, timeoutMs: 500 },
    recordMemoryEvent: () => {},
    withDb: fn => fn({}),
  });
  lifecycle.register(context);
  const beforePrompt = hooks.find(item => item.name === "before_prompt_build").handler;
  await beforePrompt({ prompt: "AutoRecall query", runId: "run-1", sessionId: "session-1" }, {
    agentId: "edi",
    trigger: "user",
    runId: "run-1",
    sessionId: "session-1",
  });
  assert.equal(providerCalls, 0);
  assert.equal(Object.hasOwn(hybridCalls.at(-1).runtime, "vectorQueryPlan"), false);
  assert.equal(Object.hasOwn(hybridCalls.at(-1).runtime, "recallHintProvider"), false);
  assert.equal(Object.hasOwn(buildHybridSearchRuntime(context, {}), "recallHintProvider"), false);
});

test("explicit Recall Hint search remains read-only and does not write memory or confidence state", async () => {
  const writes = [];
  const db = {
    prepare() {
      return {
        all: () => [],
        get: () => undefined,
        run: (...args) => {
          writes.push(args);
          throw new Error("unexpected write");
        },
      };
    },
  };
  const context = createHybridRuntimeContext({
    dataAccess: {
      withHybridDbAccessScope: async run => run({
        withCoreDb: callback => callback(db),
        withEngineDb: callback => callback(db),
        capabilities: { isolatedFts: true, isolatedKg: true, isolatedRecent: true },
      }),
      getLancedbTable: () => null,
      getLancedbRuntime: async () => ({ table: null, readyState: "disabled" }),
      getMemorySearchManager: async () => ({ manager: null }),
    },
    retrievalPolicy: {
      hybridSearch,
      recallHintProvider: () => ({ version: "recall_hint_v1", query_facets: ["reason"] }),
      calcRealtimeConf: () => 0.8,
      generateEmbedding: async () => [0.1, 0.2],
    },
    telemetry: {
      recordMemoryEvent: () => {},
      recordHybridSearchObservation: () => true,
    },
  });
  const result = await createMemoryEngineSearchExecute(context)("tool-1", {
    query: "read-only query",
    top_k: 3,
  });

  assert.deepEqual(result.results, []);
  assert.deepEqual(writes, []);
});
