import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import h2Cli from "../bin/run-longmemeval-semantic-bounded-multi-query-retrieval-v1.js";
import rh1Cli from "../bin/run-longmemeval-semantic-query-instruction-retrieval-v1.js";
import semanticCli from "../bin/run-longmemeval-semantic-retrieval-v1.js";
import { hybridSearch } from "../lib/recall/hybrid-search.js";
import { stripPromptMetadataPrefix } from "../query-utils.js";
import {
  createBenchmarkEmbeddingCache,
  LONGMEMEVAL_SEMANTIC_PROFILE,
  SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
  runLongMemEvalSemanticRetrievalCase,
} from "../lib/benchmark/longmemeval-semantic-retrieval-runner-v1.js";
import {
  LONGMEMEVAL_SEMANTIC_QUERY_INSTRUCTION_PROFILE,
} from "../lib/benchmark/longmemeval-semantic-query-instruction-retrieval-runner-v1.js";
import {
  H2_QUERY_PLANNER_MAX_RESPONSE_BYTES,
  H2_QUERY_PLANNER_MAX_TOKENS,
  H2_QUERY_PLANNER_MODEL,
  H2_QUERY_PLANNER_MODEL_REVISION,
  H2_QUERY_PLANNER_OUTPUT_SCHEMA_SHA256,
  H2_QUERY_PLANNER_PROMPT_SHA256,
  H2_QUERY_PLANNER_PROMPT_VERSION,
  H2_QUERY_PLANNER_PROVIDER,
  H2_QUERY_PLANNER_QUERY_MAX_CHARS,
  H2_QUERY_PLANNER_TEMPERATURE,
  H2_QUERY_PLANNER_TIMEOUT_MS,
  buildBoundedMultiQueryPlannerRequest,
  boundedMultiQueryPlannerProvenance,
  createSiliconFlowBoundedMultiQueryPlanner,
  parseBoundedMultiQueryPlannerResponse,
} from "../lib/benchmark/longmemeval-bounded-multi-query-planner-v1.js";
import {
  H2_QUERY_PLAN_CACHE_SCHEMA,
  H2_QUERY_PLAN_CACHE_SQLITE_USER_VERSION,
  buildQueryPlanCacheKey,
  createBenchmarkQueryPlanCache,
} from "../lib/benchmark/longmemeval-query-plan-cache-v1.js";
import {
  H2_VECTOR_QUERY_MODE,
  H2_VECTOR_QUERY_RRF_K,
  LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE,
  runLongMemEvalSemanticBoundedMultiQueryRetrievalCase,
  runLongMemEvalSemanticBoundedMultiQueryRetrievalDataset,
} from "../lib/benchmark/longmemeval-semantic-bounded-multi-query-retrieval-runner-v1.js";

const TEST_REPOSITORY_COMMIT = "b".repeat(40);
const TEST_REPOSITORY_PROVENANCE = {
  repositoryCommit: TEST_REPOSITORY_COMMIT,
  repositoryWorktreeClean: true,
  repositoryProvenanceSource: "git",
};

function fixture(overrides = {}) {
  return {
    question_id: "h2_q1",
    question_type: "multi-session",
    question: "What happened to the artifact?",
    answer: "Kyoto",
    question_date: "2025/01/10 (Fri) 12:00",
    haystack_session_ids: ["s-noise", "s-answer", "s-noise"],
    haystack_dates: [
      "2025/01/01 (Wed) 12:00",
      "2025/01/09 (Thu) 09:00",
      "2025/01/09 (Thu) 10:00",
    ],
    haystack_sessions: [
      [{ role: "user", content: "unrelated weather note" }],
      [{ role: "user", content: "artifact answer Kyoto", has_answer: true }],
      [{ role: "user", content: "another artifact note" }],
    ],
    answer_session_ids: ["s-answer"],
    ...overrides,
  };
}

function vectorFor(text, question) {
  const vector = new Array(SEMANTIC_EXPECTED_EMBEDDING_DIMENSION).fill(0);
  if (text === question) vector[0] = 1;
  else if (text === "planner-one") vector[1] = 1;
  else if (text === "planner-two") vector[2] = 1;
  else vector[3] = 1;
  return vector;
}

function fakeEmbeddingProvider(seen, question, behavior = {}) {
  return async text => {
    const value = String(text);
    seen.push(value);
    if (behavior.error && behavior.error(value)) throw new Error(behavior.error(value));
    if (behavior.dimension && behavior.dimension(value)) return new Array(behavior.dimension(value)).fill(0);
    return vectorFor(value, question);
  };
}

function fakeVectorStoreFactory({ stores = [], behavior = {} } = {}) {
  return async ({ path }) => {
    const store = { path, rows: [], searches: [], closed: false };
    stores.push(store);
    if (behavior.initError) throw new Error(behavior.initError);
    store.table = {
      async add(rows) {
        if (behavior.writeError) throw new Error(behavior.writeError);
        store.rows.push(...rows.map(row => ({ ...row, vector: [...row.vector] })));
      },
      search(query) {
        const marker = query[0] === 1 ? "question" : query[1] === 1 ? "planner-one" : "planner-two";
        return {
          limit(limit) {
            store.searches.push({ marker, limit, vector: [...query] });
            return {
              async execute() {
                if (behavior.searchError) throw new Error(behavior.searchError);
                const rows = marker === "question"
                  ? [store.rows[0], store.rows[1]]
                  : marker === "planner-one"
                    ? [store.rows[0], store.rows[2]]
                    : [store.rows[1], store.rows[0]];
                return rows.filter(Boolean).map((row, index) => ({
                  ...row,
                  _distance: marker === "planner-two" && index === 0 ? 0.01 : 0.1 + index * 0.1,
                })).slice(0, limit);
              },
            };
          },
        };
      },
    };
    return {
      table: store.table,
      close() {
        store.closed = true;
      },
    };
  };
}

function tieBreakVectorStoreFactory({ stores = [], equalSemantic = false } = {}) {
  return async ({ path }) => {
    const store = { path, rows: [], searches: [], closed: false };
    stores.push(store);
    store.table = {
      async add(rows) {
        store.rows.push(...rows.map(row => ({ ...row, vector: [...row.vector] })));
      },
      search(query) {
        const marker = query[0] === 1 ? "question" : query[1] === 1 ? "planner-one" : "planner-two";
        return {
          limit(limit) {
            store.searches.push({ marker, limit });
            return {
              async execute() {
                if (marker === "planner-two") return [];
                const rows = marker === "question"
                  ? [store.rows[0], store.rows[1]]
                  : [store.rows[1], store.rows[0]];
                return rows.map((row, index) => ({
                  ...row,
                  _distance: equalSemantic
                    ? 0.5
                    : (row === store.rows[0] ? 0.05 + index * 0.05 : 0.3 + index * 0.05),
                })).slice(0, limit);
              },
            };
          },
        };
      },
    };
    return {
      table: store.table,
      close() {
        store.closed = true;
      },
    };
  };
}

function h2Options(record, overrides = {}) {
  const seen = overrides.seen || [];
  const stores = overrides.stores || [];
  return {
    topK: 3,
    benchmarkNowSec: 1_800_000_000,
    ...TEST_REPOSITORY_PROVENANCE,
    plannerProvider: async (...args) => {
      if (overrides.plannerCalls) overrides.plannerCalls.push(args);
      return JSON.stringify({ queries: ["planner-one", "planner-two"] });
    },
    embeddingProvider: overrides.embeddingProvider || fakeEmbeddingProvider(seen, record.question, overrides.embedBehavior),
    vectorStoreFactory: overrides.vectorStoreFactory || fakeVectorStoreFactory({ stores, behavior: overrides.storeBehavior }),
    ...overrides,
    seen,
    stores,
  };
}

function queryPlanKey(overrides = {}) {
  return buildQueryPlanCacheKey({
    provider: H2_QUERY_PLANNER_PROVIDER,
    baseUrlIdentity: "https://planner.example/",
    model: H2_QUERY_PLANNER_MODEL,
    modelRevision: H2_QUERY_PLANNER_MODEL_REVISION,
    promptVersion: H2_QUERY_PLANNER_PROMPT_VERSION,
    promptSha256: H2_QUERY_PLANNER_PROMPT_SHA256,
    temperature: H2_QUERY_PLANNER_TEMPERATURE,
    outputSchemaSha256: H2_QUERY_PLANNER_OUTPUT_SCHEMA_SHA256,
    question: "question with a hidden answer",
    ...overrides,
  });
}

function queryPlanForKey(key, queries = ["first evidence", "second evidence"]) {
  return {
    queries,
    provenance: {
      provider: key.provider,
      base_url_identity: key.base_url_identity,
      model: key.model,
      model_revision: key.model_revision,
      prompt_version: key.prompt_version,
      prompt_sha256: key.prompt_sha256,
      temperature: key.temperature,
      output_schema_sha256: key.output_schema_sha256,
      question_input_sha256: key.question_input_sha256,
    },
  };
}

function plannerProviderResponseBody(content = JSON.stringify({ queries: ["planner-one", "planner-two"] })) {
  return JSON.stringify({ choices: [{ message: { content } }] });
}

function fakePlannerRequest({ mode = "success", statusCode = 200, responseBody = plannerProviderResponseBody(), observed }) {
  return (url, options, callback) => {
    observed.url = String(url);
    observed.options = options;
    let timeoutHandler = null;
    const request = new EventEmitter();
    request.setTimeout = (milliseconds, handler) => {
      observed.setTimeoutMs = milliseconds;
      timeoutHandler = handler;
      return request;
    };
    request.write = body => {
      observed.body = JSON.parse(String(body));
    };
    request.end = () => {
      queueMicrotask(() => {
        if (mode === "timeout") {
          timeoutHandler?.();
          return;
        }
        if (mode === "request-error") {
          request.emit("error", new Error("transport failed test-secret"));
          return;
        }
        const response = new EventEmitter();
        response.statusCode = statusCode;
        response.destroy = () => {
          observed.responseDestroyed = true;
        };
        callback(response);
        if (mode === "oversize") {
          response.emit("data", Buffer.alloc(H2_QUERY_PLANNER_MAX_RESPONSE_BYTES + 1, 97));
          return;
        }
        response.emit("data", Buffer.from(responseBody));
        response.emit("end");
      });
    };
    request.destroy = () => {
      observed.requestDestroyed = true;
    };
    return request;
  };
}

test("H2 profile is independent and the default B4/RH1 profiles remain distinct", () => {
  assert.notEqual(LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE, LONGMEMEVAL_SEMANTIC_PROFILE);
  assert.notEqual(LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE, LONGMEMEVAL_SEMANTIC_QUERY_INSTRUCTION_PROFILE);
  const request = buildBoundedMultiQueryPlannerRequest("Question only");
  assert.equal(request.model, H2_QUERY_PLANNER_MODEL);
  assert.equal(request.temperature, H2_QUERY_PLANNER_TEMPERATURE);
  assert.equal(request.max_tokens, H2_QUERY_PLANNER_MAX_TOKENS);
  assert.equal(request.messages.length, 1);
  assert.equal(request.messages[0].content.endsWith("\nQuestion:Question only"), true);
  assert.equal(request.messages[0].content.includes("answer_session_ids"), false);
  assert.equal(typeof H2_QUERY_PLANNER_PROMPT_SHA256, "string");
  assert.equal(H2_QUERY_PLANNER_PROMPT_SHA256.length, 64);
  assert.equal(H2_QUERY_PLANNER_OUTPUT_SCHEMA_SHA256.length, 64);
  assert.equal(H2_QUERY_PLANNER_TIMEOUT_MS, 45_000);
  assert.equal(H2_QUERY_PLANNER_MAX_RESPONSE_BYTES, 65_536);
  assert.equal(H2_QUERY_PLANNER_PROMPT_VERSION, "bounded_multi_query_planner_prompt_v1");
});

test("strict planner parser rejects malformed, duplicate, repeated, and over-limit output", () => {
  const valid = JSON.stringify({ queries: ["one evidence", "other evidence"] });
  assert.deepEqual(parseBoundedMultiQueryPlannerResponse(valid, { exactProductionQuery: "original" }).queries, [
    "one evidence",
    "other evidence",
  ]);
  const invalid = [
    "```json\n" + valid + "\n```",
    "not json",
    `${valid} trailing`,
    JSON.stringify({ queries: ["one"] }),
    JSON.stringify({ queries: ["one", "two"], extra: true }),
    JSON.stringify({ queries: "one" }),
    JSON.stringify({ queries: ["", "two"] }),
    JSON.stringify({ queries: ["one", "one "] }),
    JSON.stringify({ queries: ["original", "other"] }),
    JSON.stringify({ queries: ["x".repeat(H2_QUERY_PLANNER_QUERY_MAX_CHARS + 1), "other"] }),
  ];
  for (const value of invalid) assert.throws(() => parseBoundedMultiQueryPlannerResponse(value, { exactProductionQuery: "original" }));
});

test("planner transport is bounded, sanitized, and sends the frozen request contract", async () => {
  const observed = {};
  const planner = createSiliconFlowBoundedMultiQueryPlanner({
    baseUrl: "https://user:password@example.com/base?token=secret#fragment",
    providerEnv: { SILICONFLOW_API_KEY: "test-secret" },
    requestImpl: fakePlannerRequest({ observed }),
  });
  assert.deepEqual(await planner("question only"), JSON.stringify({ queries: ["planner-one", "planner-two"] }));
  assert.equal(observed.url, "https://example.com/base/v1/chat/completions");
  assert.equal(observed.options.timeout, H2_QUERY_PLANNER_TIMEOUT_MS);
  assert.equal(observed.setTimeoutMs, H2_QUERY_PLANNER_TIMEOUT_MS);
  assert.equal(observed.body.model, H2_QUERY_PLANNER_MODEL);
  assert.equal(observed.body.temperature, 0);
  assert.equal(observed.body.max_tokens, H2_QUERY_PLANNER_MAX_TOKENS);
  const provenance = boundedMultiQueryPlannerProvenance("https://user:password@example.com/base?token=secret#fragment");
  assert.equal(provenance.planner_request_url_identity, observed.url);
  assert.equal(provenance.planner_api_path, "/base/v1/chat/completions");
  assert.equal(provenance.planner_max_tokens, H2_QUERY_PLANNER_MAX_TOKENS);
  assert.equal(provenance.planner_timeout_ms, H2_QUERY_PLANNER_TIMEOUT_MS);
  assert.equal(provenance.planner_max_response_bytes, H2_QUERY_PLANNER_MAX_RESPONSE_BYTES);
  assert.equal(JSON.stringify(provenance).includes("user"), false);
  assert.equal(JSON.stringify(provenance).includes("password"), false);
  assert.equal(JSON.stringify(provenance).includes("secret"), false);
});

test("planner transport rejects HTTP, timeout, oversize, malformed, missing-content, and provider failures once", async () => {
  const cases = [
    { label: "http", mode: "success", statusCode: 503, responseBody: "{}" },
    { label: "timeout", mode: "timeout" },
    { label: "request error", mode: "request-error" },
    { label: "oversize", mode: "oversize" },
    { label: "malformed", mode: "success", responseBody: "not-json" },
    { label: "missing content", mode: "success", responseBody: JSON.stringify({ choices: [{}] }) },
    {
      label: "provider error",
      mode: "success",
      responseBody: JSON.stringify({ error: { message: "Bearer test-secret" } }),
    },
  ];
  for (const failure of cases) {
    const observed = {};
    const planner = createSiliconFlowBoundedMultiQueryPlanner({
      baseUrl: "https://example.com",
      providerEnv: { SILICONFLOW_API_KEY: "test-secret" },
      requestImpl: fakePlannerRequest({ ...failure, observed }),
    });
    await assert.rejects(planner("question only"), error => {
      assert.equal(String(error).includes("test-secret"), false, failure.label);
      return true;
    }, failure.label);
    assert.equal(observed.requestDestroyed || failure.mode === "success", true, failure.label);
  }
});

test("query-plan cache is separate, primary-keyed, restart-reusable, and upserts one entry", () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-h2-plan-cache-"));
  const path = join(root, "query-plan.sqlite");
  const key = queryPlanKey();
  const plan = queryPlanForKey(key);
  try {
    const cache = createBenchmarkQueryPlanCache(path);
    cache.set(key, plan);
    assert.deepEqual(cache.get(key).queries, plan.queries);
    const differentIdentityKey = queryPlanKey({
      provider: "DifferentProvider",
      model: "different-model",
    });
    cache.set(differentIdentityKey, queryPlanForKey(differentIdentityKey));
    assert.deepEqual(cache.get(differentIdentityKey).queries, plan.queries);
    cache.set(key, { ...plan, queries: ["updated first", "updated second"] });
    cache.close();

    const reopened = createBenchmarkQueryPlanCache(path);
    assert.deepEqual(reopened.get(key).queries, ["updated first", "updated second"]);
    const snapshot = JSON.stringify(reopened.snapshot());
    assert.equal(snapshot.includes("question with a hidden answer"), false);
    assert.equal(snapshot.includes("answer_session_ids"), false);
    assert.equal(snapshot.includes("question_type"), false);
    reopened.close();

    const database = new Database(path, { readonly: true });
    assert.equal(database.pragma("user_version", { simple: true }), H2_QUERY_PLAN_CACHE_SQLITE_USER_VERSION);
    assert.equal(database.prepare("SELECT value FROM query_plan_cache_metadata WHERE key = 'schema'").get().value, H2_QUERY_PLAN_CACHE_SCHEMA);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM query_plan_cache_entries").get().count, 2);
    database.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("query-plan cache v2 identity changes always miss and cache rows reject tampering", () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-h2-plan-cache-v2-"));
  const path = join(root, "query-plan.sqlite");
  const provenancePath = join(root, "provenance-tamper.sqlite");
  const key = queryPlanKey();
  try {
    const cache = createBenchmarkQueryPlanCache(path);
    cache.set(key, queryPlanForKey(key));
    const changedIdentities = [
      ["provider", { provider: "OtherProvider" }],
      ["base_url_identity", { baseUrlIdentity: "https://other-planner.example/" }],
      ["model", { model: "other-model" }],
      ["model_revision", { modelRevision: "revision-2" }],
      ["prompt_version", { promptVersion: "bounded_multi_query_planner_prompt_v2" }],
      ["prompt_sha256", { promptSha256: "a".repeat(64) }],
      ["temperature", { temperature: 1 }],
      ["output_schema_sha256", { outputSchemaSha256: "c".repeat(64) }],
      ["question_input_sha256", { question: "a different question" }],
    ];
    for (const [field, override] of changedIdentities) {
      assert.equal(cache.get(queryPlanKey(override)), null, `${field} must be part of cache identity`);
    }
    assert.throws(
      () => cache.set(key, {
        ...queryPlanForKey(key),
        provenance: { gold_answer: "must not persist" },
      }),
      /forbidden|reserved/i,
    );
    cache.close();

    const database = new Database(path);
    database.prepare("UPDATE query_plan_cache_entries SET model_revision = ?").run("tampered");
    database.close();
    const reopened = createBenchmarkQueryPlanCache(path);
    assert.throws(() => reopened.get(key), /provenance mismatch/i);
    reopened.close();
    const consistentDatabase = new Database(path);
    const consistentRow = consistentDatabase.prepare("SELECT provenance_json FROM query_plan_cache_entries").get();
    const consistentlyTamperedProvenance = JSON.parse(consistentRow.provenance_json);
    consistentlyTamperedProvenance.model_revision = "tampered";
    consistentDatabase.prepare(
      "UPDATE query_plan_cache_entries SET model_revision = ?, provenance_json = ?",
    ).run("tampered", JSON.stringify(consistentlyTamperedProvenance));
    consistentDatabase.close();
    const reopenedConsistent = createBenchmarkQueryPlanCache(path);
    assert.throws(() => reopenedConsistent.get(key), /provenance mismatch/i);
    reopenedConsistent.close();

    const provenanceCache = createBenchmarkQueryPlanCache(provenancePath);
    provenanceCache.set(key, queryPlanForKey(key));
    provenanceCache.close();
    const provenanceDatabase = new Database(provenancePath);
    const row = provenanceDatabase.prepare("SELECT provenance_json FROM query_plan_cache_entries").get();
    const tamperedProvenance = JSON.parse(row.provenance_json);
    tamperedProvenance.temperature = 99;
    provenanceDatabase.prepare("UPDATE query_plan_cache_entries SET provenance_json = ?").run(
      JSON.stringify(tamperedProvenance),
    );
    provenanceDatabase.close();
    const reopenedProvenance = createBenchmarkQueryPlanCache(provenancePath);
    assert.throws(() => reopenedProvenance.get(key), /provenance mismatch/i);
    reopenedProvenance.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("query-plan cache rejects legacy/invalid formats and forbidden identity fields", () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-h2-invalid-cache-"));
  const legacy = join(root, "legacy.sqlite");
  const empty = join(root, "empty.sqlite");
  const legacyV1 = join(root, "legacy-v1.sqlite");
  const invalid = join(root, "invalid.sqlite");
  try {
    writeFileSync(legacy, "{}", "utf8");
    assert.throws(() => createBenchmarkQueryPlanCache(legacy), /legacy|invalid/i);
    writeFileSync(empty, "", "utf8");
    assert.throws(() => createBenchmarkQueryPlanCache(empty), /legacy|invalid/i);
    const legacyDatabase = new Database(legacyV1);
    legacyDatabase.exec(`
      CREATE TABLE query_plan_cache_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO query_plan_cache_metadata (key, value)
      VALUES ('schema', 'memory_engine_benchmark_query_plan_cache_v1');
      CREATE TABLE query_plan_cache_entries (
        cache_key TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        base_url_identity TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        question_input_sha256 TEXT NOT NULL,
        plan_hash TEXT NOT NULL,
        queries_json TEXT NOT NULL,
        provenance_json TEXT NOT NULL
      );
      PRAGMA user_version = 1;
    `);
    legacyDatabase.close();
    assert.throws(() => createBenchmarkQueryPlanCache(legacyV1), /unsupported|invalid/i);
    const cache = createBenchmarkQueryPlanCache(invalid);
    cache.close();
    const database = new Database(invalid);
    database.pragma("user_version = 99");
    database.close();
    assert.throws(() => createBenchmarkQueryPlanCache(invalid), /unsupported|invalid/i);
    assert.throws(() => buildQueryPlanCacheKey({
      provider: H2_QUERY_PLANNER_PROVIDER,
      baseUrlIdentity: "https://planner.example/",
      model: H2_QUERY_PLANNER_MODEL,
      promptVersion: H2_QUERY_PLANNER_PROMPT_VERSION,
      question: "raw question",
      questionInputSha256: "raw question",
    }));
    const validKey = queryPlanKey();
    const goldCache = createBenchmarkQueryPlanCache(join(root, "gold.sqlite"));
    assert.throws(() => goldCache.set(validKey, {
      ...queryPlanForKey(validKey),
      provenance: { gold_answer: "must not persist" },
    }), /forbidden|reserved/i);
    goldCache.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("H2 executes exact query plus two planner queries, performs three searches, fuses vector results, and preserves isolation", async () => {
  const record = fixture();
  const seen = [];
  const stores = [];
  const plannerCalls = [];
  let capturedSearch = null;
  const result = await runLongMemEvalSemanticBoundedMultiQueryRetrievalCase(record, h2Options(record, {
    seen,
    stores,
    plannerCalls,
    hybridSearchFn: async (query, options, runtime) => {
      capturedSearch = await hybridSearch(query, options, runtime);
      return capturedSearch;
    },
  }));

  assert.equal(result.profile, LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE);
  assert.deepEqual(plannerCalls, [[record.question]]);
  assert.deepEqual(seen.slice(-3), [record.question, "planner-one", "planner-two"]);
  assert.equal(stores.length, 1);
  assert.equal(stores[0].path.includes("semantic-vector"), true);
  assert.equal(stores[0].closed, true);
  assert.deepEqual(stores[0].searches.map(search => search.marker), ["question", "planner-one", "planner-two"]);
  assert.deepEqual(stores[0].searches.map(search => search.limit), [50, 50, 50]);
  assert.equal(result.provenance.vector_query_mode, H2_VECTOR_QUERY_MODE);
  assert.equal(result.provenance.vector_query_count, 3);
  assert.equal(result.provenance.vector_search_count, 3);
  assert.equal(result.provenance.vector_query_fusion, "rrf");
  assert.equal(result.provenance.vector_query_rrf_k, H2_VECTOR_QUERY_RRF_K);
  assert.equal(result.provenance.vector_raw_total, 6);
  assert.equal(result.provenance.vector_unique_count, 3);
  assert.deepEqual(result.provenance.vector_query_candidate_counts, [2, 2, 2]);
  assert.equal(result.diagnostics.vector_backend, "lancedb");
  assert.equal(result.diagnostics.vector_stage, "lancedb_search");
  assert.equal(result.diagnostics.vector_in_fusion, true);
  assert.equal(result.diagnostics.vector_query_count, 3);
  assert.equal(result.diagnostics.vector_search_count, 3);
  assert.equal(result.diagnostics.vector_query_rrf_k, 60);
  assert.equal(result.provenance.vector_attempted_count, 1);
  assert.equal(result.provenance.vector_skipped_count, 0);
  assert.equal(result.provenance.vector_error_count, 0);
  assert.equal(result.provenance.query_embedding_count, 3);
  assert.equal(result.retrieved_session_ids.length > 0, true);
  assert.equal(capturedSearch.debug.channel_candidate_provenance.vector.count, 3);
  assert.equal(capturedSearch.debug.channel_candidate_provenance.vector.ids.length, 3);
  assert.equal(capturedSearch.debug.post_rerank_top.some(item => item.semantic_score === 0.99), true);
  assert.equal(JSON.stringify(result).includes("answer_session_ids"), false);
});

test("H2 query-level RRF ties prefer max semantic score, then memory id", async () => {
  async function runTieCase(equalSemantic) {
    const record = fixture({ question_id: `h2_rrf_tie_${equalSemantic ? "equal" : "semantic"}` });
    const stores = [];
    let capturedSearch = null;
    await runLongMemEvalSemanticBoundedMultiQueryRetrievalCase(record, h2Options(record, {
      stores,
      vectorStoreFactory: tieBreakVectorStoreFactory({ stores, equalSemantic }),
      hybridSearchFn: async (query, options, runtime) => {
        capturedSearch = await hybridSearch(query, options, runtime);
        return capturedSearch;
      },
    }));
    return {
      ids: capturedSearch.debug.channel_candidate_provenance.vector.ids,
      rowIds: stores[0].rows.slice(0, 2).map(row => row.id.slice(0, 16)),
    };
  }

  const semanticTie = await runTieCase(false);
  assert.deepEqual(semanticTie.ids.slice(0, 2), [semanticTie.rowIds[0], semanticTie.rowIds[1]]);
  const equalSemanticTie = await runTieCase(true);
  assert.deepEqual(equalSemanticTie.ids.slice(0, 2), [...equalSemanticTie.rowIds].sort((a, b) => a.localeCompare(b)));
});

test("H2 first vector query is the exact production stripped query while lexical input stays original", async () => {
  const record = fixture({
    question: "[Thu 2025-01-02 03:04 UTC]  Artifact?!  v2.1  東京",
  });
  const exactProductionVectorQuery = stripPromptMetadataPrefix(record.question);
  const seen = [];
  const stores = [];
  let lexicalQuery = null;
  await runLongMemEvalSemanticBoundedMultiQueryRetrievalCase(record, h2Options(record, {
    seen,
    stores,
    embeddingProvider: fakeEmbeddingProvider(seen, exactProductionVectorQuery),
    hybridSearchFn: async (query, options, runtime) => {
      lexicalQuery = query;
      return hybridSearch(query, options, runtime);
    },
  }));
  assert.equal(lexicalQuery, record.question);
  assert.deepEqual(seen.slice(-3), [exactProductionVectorQuery, "planner-one", "planner-two"]);
  assert.equal(stores[0].searches[0].marker, "question");
});

test("H2 leaves B4 default vector path at one embedding and one search", async () => {
  const record = fixture({ question_type: "single-session-user" });
  const seen = [];
  const stores = [];
  const b4 = await runLongMemEvalSemanticRetrievalCase(record, {
    ...TEST_REPOSITORY_PROVENANCE,
    topK: 3,
    embeddingProvider: fakeEmbeddingProvider(seen, record.question),
    vectorStoreFactory: fakeVectorStoreFactory({ stores }),
  });
  assert.equal(b4.profile, LONGMEMEVAL_SEMANTIC_PROFILE);
  assert.equal(b4.provenance.query_embedding_count, 1);
  assert.equal(stores[0].searches.length, 1);
  assert.equal(Object.hasOwn(b4.provenance, "vector_query_mode"), false);
});

test("H2 fail-closes without partial-query success, fallback, or wrong dimensions", async () => {
  const cases = [
    {
      label: "planner embedding failure",
      embedBehavior: { error: value => value === "planner-two" ? "planner query embed failed" : null },
      stage: "query_embedding",
    },
    {
      label: "planner embedding dimension failure",
      embedBehavior: { dimension: value => value === "planner-one" ? 7 : null },
      stage: "query_embedding_dimension",
    },
    {
      label: "vector search failure",
      storeBehavior: { searchError: "vector search failed" },
      stage: "vector_search",
    },
  ];
  for (const failure of cases) {
    const record = fixture({ question_id: `h2_failure_${failure.label.replace(/\s+/gu, "-")}` });
    const stores = [];
    await assert.rejects(
      runLongMemEvalSemanticBoundedMultiQueryRetrievalCase(record, h2Options(record, { ...failure, stores })),
      error => {
        assert.equal(error.stage, failure.stage, `${failure.label}: ${error.stack}`);
        assert.equal(error.details?.vector_fallback_called, false);
        return true;
      },
    );
    assert.equal(stores.length, 1);
  }
});

test("H2 official exclusions do not invoke planner or vector channel", async () => {
  const plannerCalls = [];
  const excluded = await runLongMemEvalSemanticBoundedMultiQueryRetrievalCase(
    fixture({ question_id: "h2_excluded", answer_session_ids: [], haystack_session_ids: [], haystack_dates: [], haystack_sessions: [] }),
    h2Options(fixture({ question: "excluded" }), { plannerCalls }),
  );
  assert.equal(excluded.skipped, true);
  assert.equal(plannerCalls.length, 0);
  assert.equal(excluded.provenance.vector_query_count, 0);
});

test("H2 fails closed when planner provider credentials/configuration are unavailable", async () => {
  const record = fixture({ question_id: "h2_missing_planner" });
  await assert.rejects(
    runLongMemEvalSemanticBoundedMultiQueryRetrievalCase(record, h2Options(record, {
      plannerProvider: null,
      plannerProviderFactory: () => async () => {
        throw new Error("planner provider credential unavailable");
      },
    })),
    error => {
      assert.equal(error.stage, "planner_provider");
      assert.match(error.message, /planner_provider|credential/i);
      return true;
    },
  );
});

test("H2 cache hit skips planner provider and external cache ownership is preserved", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-h2-runner-cache-"));
  const embeddingPath = join(root, "embedding.sqlite");
  const planPath = join(root, "plan.sqlite");
  const record = fixture();
  let plannerCalls = 0;
  let embeddingCalls = 0;
  try {
    const first = await runLongMemEvalSemanticBoundedMultiQueryRetrievalCase(record, {
      ...TEST_REPOSITORY_PROVENANCE,
      topK: 3,
      embeddingProvider: async text => {
        embeddingCalls += 1;
        return vectorFor(String(text), record.question);
      },
      plannerProvider: async question => {
        plannerCalls += 1;
        assert.equal(question, record.question);
        return JSON.stringify({ queries: ["planner-one", "planner-two"] });
      },
      cachePath: embeddingPath,
      queryPlanCachePath: planPath,
      vectorStoreFactory: fakeVectorStoreFactory(),
    });
    assert.equal(first.provenance.planner_provider_call_count, 1);
    assert.equal(first.provenance.planner_cache_hits, 0);

    const external = createBenchmarkQueryPlanCache(planPath);
    let externalClosed = false;
    const externalProxy = {
      get: external.get,
      set: external.set,
      close() {
        externalClosed = true;
        external.close();
      },
    };
    const externalEmbedding = createBenchmarkEmbeddingCache(embeddingPath);
    try {
      const second = await runLongMemEvalSemanticBoundedMultiQueryRetrievalCase(record, {
      ...TEST_REPOSITORY_PROVENANCE,
      topK: 3,
      embeddingProvider: async text => {
        embeddingCalls += 1;
        return vectorFor(String(text), record.question);
      },
      plannerProvider: async () => {
        plannerCalls += 1;
        throw new Error("planner must not run on cache hit");
      },
      cachePath: embeddingPath,
      embeddingCache: externalEmbedding,
      queryPlanCache: externalProxy,
      vectorStoreFactory: fakeVectorStoreFactory(),
      });
      assert.equal(second.provenance.planner_provider_call_count, 0);
      assert.equal(second.provenance.planner_cache_hits, 1);
      assert.equal(plannerCalls, 1);
      assert.equal(externalClosed, false);
      externalProxy.close();
      assert.equal(externalClosed, true);
      assert.equal(embeddingCalls > 0, true);
    } finally {
      if (!externalClosed) externalProxy.close();
      externalEmbedding.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("H2 runner-owned query-plan cache closes and CLI exposes an independent deterministic profile", async () => {
  const record = fixture();
  let ownedClosed = false;
  const output = await runLongMemEvalSemanticBoundedMultiQueryRetrievalCase(record, h2Options(record, {
    queryPlanCacheFactory: () => {
      const cache = createBenchmarkQueryPlanCache();
      return {
        get: cache.get,
        set: cache.set,
        close() {
          ownedClosed = true;
          cache.close();
        },
      };
    },
  }));
  assert.equal(output.profile, LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE);
  assert.equal(ownedClosed, true);

  const cliOutput = await h2Cli.runLongMemEvalSemanticBoundedMultiQueryCli([
    "--input", "/tmp/h2-not-read.json",
    "--query-plan-cache-path", "/tmp/h2-query-plan.sqlite",
    "--planner-base-url", "https://planner.example/base",
  ], {
    readFile: () => Buffer.from("[]\n"),
    repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
    runnerOptions: {
      queryPlanCachePath: "/tmp/caller-forged-plan.sqlite",
      plannerBaseUrl: "https://caller-forged.example",
    },
    runDataset: async (records, options) => ({
      records,
      options,
      profile: LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE,
      provenance: { profile: LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE },
      run: { profile: LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE },
      summary: { profile: LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE },
    }),
  });
  assert.equal(cliOutput.printable.run.profile, LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE);
  assert.equal(cliOutput.output.records.length, 0);
  assert.equal(cliOutput.output.options.repositoryCommit, TEST_REPOSITORY_COMMIT);
  assert.equal(cliOutput.output.options.queryPlanCachePath, "/tmp/h2-query-plan.sqlite");
  assert.equal(cliOutput.output.options.plannerBaseUrl, "https://planner.example/base");
  const help = await h2Cli.runLongMemEvalSemanticBoundedMultiQueryCli(["--help"]);
  assert.equal(help.usage.includes(LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE), true);
  assert.equal(help.usage.includes("query-plan-cache-path"), true);
});

test("H2-only CLI arguments stay isolated from B4 and RH1 shared parsers", async () => {
  for (const argument of ["--query-plan-cache-path", "--planner-base-url"]) {
    assert.throws(() => semanticCli.parseArgs([argument, "value"]), /unknown_argument/);
    await assert.rejects(
      rh1Cli.runLongMemEvalSemanticQueryInstructionCli(["--input", "/tmp/rh1-not-read.json", argument, "value"], {
        repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
      }),
      /unknown_argument/,
    );
  }
  assert.throws(() => h2Cli.parseH2Args(["--query-plan-cache-path"]), /missing_argument_value/);
  assert.throws(() => h2Cli.parseH2Args(["--planner-base-url"]), /missing_argument_value/);
  assert.throws(() => h2Cli.parseH2Args(["--query-plan-cache-path", "one", "--query-plan-cache-path", "two"]), /duplicate_argument/);
  assert.throws(() => h2Cli.parseH2Args(["--planner-base-url", "one", "--planner-base-url", "two"]), /duplicate_argument/);
  assert.throws(() => h2Cli.parseH2Args(["--unknown-h2-flag"]), /unknown_argument/);
});

test("H2 dataset aggregates planner/vector provenance and does not introduce evaluator fields", async () => {
  const record = fixture();
  const output = await runLongMemEvalSemanticBoundedMultiQueryRetrievalDataset([record], h2Options(record));
  assert.equal(output.profile, LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE);
  assert.equal(output.summary.profile, LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE);
  assert.equal(output.provenance.planner_provider, H2_QUERY_PLANNER_PROVIDER);
  assert.equal(output.provenance.planner_model, H2_QUERY_PLANNER_MODEL);
  assert.equal(output.provenance.planner_query_count, 2);
  assert.equal(output.provenance.vector_query_count, 3);
  assert.equal(output.provenance.vector_search_count, 3);
  assert.equal(output.provenance.vector_query_fusion, "rrf");
  assert.equal(output.provenance.query_plan_cache_schema, H2_QUERY_PLAN_CACHE_SCHEMA);
  assert.equal(output.provenance.query_plan_cache_user_version, H2_QUERY_PLAN_CACHE_SQLITE_USER_VERSION);
  assert.equal(JSON.stringify(output).includes("answer_session_ids"), false);
  assert.equal(JSON.stringify(output).includes("question_type"), true);
});
