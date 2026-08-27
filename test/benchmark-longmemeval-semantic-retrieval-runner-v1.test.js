import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import cli from "../bin/run-longmemeval-semantic-retrieval-v1.js";
import { MEMORY_ENGINE_DEFAULTS } from "../lib/config/defaults.js";
import {
  CANONICAL_VECTOR_PROJECTION_VERSION,
  CANONICAL_VECTOR_TEXT_MAX_CHARS,
} from "../lib/canonical/vector-projection.js";
import {
  buildEmbeddingCacheKey,
  createBenchmarkEmbeddingCache,
  LONGMEMEVAL_SEMANTIC_PROFILE,
  LONGMEMEVAL_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA,
  runLongMemEvalSemanticRetrievalCase,
  runLongMemEvalSemanticRetrievalDataset,
  SEMANTIC_EMBEDDING_MODEL,
  SEMANTIC_EMBEDDING_PROVIDER,
  SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
  SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD,
} from "../lib/benchmark/longmemeval-semantic-retrieval-runner-v1.js";
import { LONGMEMEVAL_RETRIEVAL_PROFILE } from "../lib/benchmark/longmemeval-retrieval-runner-v1.js";

const {
  resolveRepositoryProvenance,
  runLongMemEvalSemanticCli,
  usage,
  validateRepositoryProvenance,
} = cli;

const TEST_REPOSITORY_COMMIT = "a".repeat(40);
const TEST_REPOSITORY_PROVENANCE = {
  repository_commit: TEST_REPOSITORY_COMMIT,
  repository_worktree_clean: true,
  repository_provenance_source: "git",
};

function fixture(overrides = {}) {
  return {
    question_id: "semantic_q1",
    question_type: "single_hop",
    question: "semantic-query",
    answer: "Kyoto",
    question_date: "2025/01/10 (Fri) 12:00",
    haystack_session_ids: ["s-noise", "s-answer", "s-other"],
    haystack_dates: [
      "2025/01/01 (Wed) 12:00",
      "2025/01/09 (Thu) 09:00",
      "2025/01/09 (Thu) 10:00",
    ],
    haystack_sessions: [
      [
        { role: "user", content: "unrelated weather note" },
        { role: "assistant", content: "assistant-only text must not be embedded" },
      ],
      [
        { role: "user", content: "semantic-answer Kyoto", has_answer: true },
        { role: "assistant", content: "gold answer label is not a corpus field" },
      ],
      [
        { role: "user", content: "semantic-noise Osaka" },
        { role: "assistant", content: "unrelated response" },
      ],
    ],
    answer_session_ids: ["s-answer"],
    ...overrides,
  };
}

function vectorFor(text) {
  const vector = new Array(SEMANTIC_EXPECTED_EMBEDDING_DIMENSION).fill(0);
  const value = String(text);
  if (value.includes("semantic-query") || value.includes("semantic-answer")) vector[0] = 1;
  else if (value.includes("semantic-noise")) vector[1] = 1;
  else vector[2] = 1;
  return vector;
}

function fakeEmbedder(seen = [], behavior = {}) {
  return async text => {
    const value = String(text);
    seen.push(value);
    if (behavior.error && behavior.error(value)) throw new Error(behavior.error(value));
    if (behavior.dimension) return new Array(behavior.dimension).fill(0);
    return vectorFor(value);
  };
}

function fakeVectorStoreFactory({ stores = [], behavior = {} } = {}) {
  return async ({ path }) => {
    const rows = [];
    const store = {
      path,
      rows,
      queryVectors: [],
    };
    stores.push(store);
    if (behavior.initError) throw new Error(behavior.initError);
    store.table = {
      async add(nextRows) {
        if (behavior.writeError) throw new Error(behavior.writeError);
        rows.push(...nextRows.map(row => ({ ...row, vector: [...row.vector] })));
      },
      search(query) {
        store.queryVectors.push([...query]);
        return {
          limit(limit) {
            return {
              async execute() {
                if (behavior.searchError) throw new Error(behavior.searchError);
                if (behavior.emptySearch) return [];
                return [...rows]
                  .map(row => ({
                    ...row,
                    _distance: row.vector[0] === query[0] && query[0] === 1 ? 0.01 : 0.9,
                  }))
                  .sort((left, right) => left._distance - right._distance || left.id.localeCompare(right.id))
                  .slice(0, limit);
              },
            };
          },
        };
      },
    };
    return { table: store.table };
  };
}

function semanticOptions(overrides = {}) {
  const seen = overrides.seen || [];
  const stores = overrides.stores || [];
  return {
    topK: 3,
    benchmarkNowSec: 1_800_000_000,
    embeddingProvider: overrides.embeddingProvider || fakeEmbedder(seen, overrides.embedBehavior),
    vectorStoreFactory: overrides.vectorStoreFactory || fakeVectorStoreFactory({ stores, behavior: overrides.storeBehavior }),
    ...overrides,
    seen,
    stores,
  };
}

async function expectStage(record, options, stage) {
  await assert.rejects(
    runLongMemEvalSemanticRetrievalCase(record, options),
    error => {
      assert.equal(error.stage, stage, error.stack);
      assert.equal(typeof error.details?.provider_call_count, "number");
      assert.equal(typeof error.details?.vector_fallback_called, "boolean");
      return true;
    },
  );
}

test("semantic profile identity is distinct and binds the production-default vector gate", () => {
  assert.notEqual(LONGMEMEVAL_SEMANTIC_PROFILE, LONGMEMEVAL_RETRIEVAL_PROFILE);
  assert.equal(LONGMEMEVAL_SEMANTIC_PROFILE, "production_hybrid_semantic_session_v1");
  assert.equal(SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD, 0.7);
  assert.equal(MEMORY_ENGINE_DEFAULTS.recall.lexicalConfidenceThreshold, 0.7);
  assert.equal(SEMANTIC_EMBEDDING_PROVIDER, "SiliconFlow");
  assert.equal(SEMANTIC_EMBEDDING_MODEL, "Qwen/Qwen3-Embedding-4B");
  assert.equal(CANONICAL_VECTOR_PROJECTION_VERSION, 1);
  assert.equal(CANONICAL_VECTOR_TEXT_MAX_CHARS, 2_000);
  assert.equal(LONGMEMEVAL_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA, "memory_engine_longmemeval_semantic_retrieval_v1");
});

test("semantic case uses Canonical vector projection, 2560 dimensions, and production hybrid fusion", async () => {
  const seen = [];
  const stores = [];
  const result = await runLongMemEvalSemanticRetrievalCase(fixture(), semanticOptions({ seen, stores }));

  assert.equal(result.skipped, false);
  assert.equal(result.profile, LONGMEMEVAL_SEMANTIC_PROFILE);
  assert.equal(result.retrieved_session_ids[0], "s-answer");
  assert.equal(result.metrics["recall_any@1"], 1);
  assert.equal(result.diagnostics.vector_backend, "lancedb");
  assert.equal(result.diagnostics.vector_stage, "lancedb_search");
  assert.equal(result.diagnostics.vector_in_fusion, true);
  assert.equal(result.diagnostics.vector_skipped, false);
  assert.equal(result.diagnostics.lexical_confidence < SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD, true);
  assert.equal(result.diagnostics.canonical_result_projection.dropped_count, 0);
  assert.equal(result.provenance.embedding_dimension, SEMANTIC_EXPECTED_EMBEDDING_DIMENSION);
  assert.equal(result.provenance.lexical_confidence_threshold, 0.7);
  assert.equal(result.provenance.canonical_vector_projection_version, CANONICAL_VECTOR_PROJECTION_VERSION);
  assert.equal(result.provenance.canonical_vector_text_max_chars, CANONICAL_VECTOR_TEXT_MAX_CHARS);
  assert.equal(result.provenance.vector_attempted_count, 1);
  assert.equal(result.provenance.vector_skipped_count, 0);
  assert.equal(result.provenance.vector_error_count, 0);
  assert.equal(seen.length, 4);
  assert.equal(stores.length, 1);
  assert.equal(stores[0].rows.length, 3);
  assert.equal(stores[0].queryVectors.length, 1);
  assert.notEqual(stores[0].path.includes(".openclaw/memory"), true);
});

test("default semantic vector store is a temporary LanceDB table", async () => {
  const result = await runLongMemEvalSemanticRetrievalCase(fixture(), {
    topK: 3,
    benchmarkNowSec: 1_800_000_000,
    embeddingProvider: fakeEmbedder(),
  });
  assert.equal(result.diagnostics.vector_mode, "temporary_lancedb");
  assert.equal(result.diagnostics.vector_backend, "lancedb");
  assert.equal(result.diagnostics.vector_stage, "lancedb_search");
  assert.equal(result.provenance.vector_attempted_count, 1);
});

test("Canonical vector projection preserves the 2000-character contract and user-turn-only corpus", async () => {
  const stores = [];
  const longContent = `semantic-answer ${"x".repeat(2_100)}`;
  const record = fixture({
    haystack_sessions: [
      fixture().haystack_sessions[0],
      [
        { role: "user", content: longContent, has_answer: true },
        { role: "assistant", content: "assistant body must never enter the projection" },
      ],
      fixture().haystack_sessions[2],
    ]
  });
  const result = await runLongMemEvalSemanticRetrievalCase(record, semanticOptions({ stores }));
  const answerRow = stores[0].rows.find(row => row.text.startsWith("semantic-answer"));

  assert.equal(result.skipped, false);
  assert.ok(answerRow);
  assert.equal(answerRow.text.length, CANONICAL_VECTOR_TEXT_MAX_CHARS);
  assert.equal(answerRow.text.includes("assistant body must never enter the projection"), false);
  assert.equal(answerRow.vector.length, SEMANTIC_EXPECTED_EMBEDDING_DIMENSION);
  assert.deepEqual(Object.keys(answerRow).sort(), ["id", "text", "timestamp", "vector"]);
  assert.equal("embedding_input" in answerRow, false);
});

test("each semantic case owns an isolated temporary vector data plane", async () => {
  const stores = [];
  const output = await runLongMemEvalSemanticRetrievalDataset([
    fixture(),
    fixture({ question_id: "semantic_q2" }),
  ], semanticOptions({ stores }));

  assert.equal(output.results.length, 2);
  assert.equal(output.summary.schema, LONGMEMEVAL_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA);
  assert.equal(stores.length, 2);
  assert.notEqual(stores[0].path, stores[1].path);
  assert.equal(stores.every(store => store.path.includes("semantic-vector")), true);
  assert.equal(output.run.vector_attempted_count, 2);
});

test("runner closes only cache instances it owns", async () => {
  let standaloneCloseCount = 0;
  let standaloneCache;
  await runLongMemEvalSemanticRetrievalCase(fixture(), semanticOptions({
    embeddingCacheFactory: () => {
      standaloneCache = createBenchmarkEmbeddingCache();
      const close = standaloneCache.close.bind(standaloneCache);
      standaloneCache.close = () => {
        standaloneCloseCount += 1;
        return close();
      };
      return standaloneCache;
    },
  }));
  assert.equal(standaloneCloseCount, 1);

  const backingCache = createBenchmarkEmbeddingCache();
  let externalCloseCount = 0;
  const externalCache = {
    get: backingCache.get.bind(backingCache),
    set: backingCache.set.bind(backingCache),
    close: () => { externalCloseCount += 1; },
  };
  await runLongMemEvalSemanticRetrievalCase(fixture(), semanticOptions({
    embeddingCache: externalCache,
  }));
  assert.equal(externalCloseCount, 0);
  backingCache.close();
});

test("dataset closes its shared owned cache after all cases", async () => {
  let closeCount = 0;
  await runLongMemEvalSemanticRetrievalDataset([fixture(), fixture({ question_id: "semantic_q2" })], {
    ...semanticOptions(),
    embeddingCacheFactory: () => {
      const cache = createBenchmarkEmbeddingCache();
      const close = cache.close.bind(cache);
      cache.close = () => {
        closeCount += 1;
        return close();
      };
      return cache;
    },
  });
  assert.equal(closeCount, 1);
});

test("corpus embedding failure is fail-closed before vector write", async () => {
  const stores = [];
  await expectStage(
    fixture(),
    semanticOptions({
      stores,
      embedBehavior: { error: () => "corpus embedding boom" },
    }),
    "corpus_embedding",
  );
  assert.equal(stores[0].rows.length, 0);
});

test("wrong corpus embedding dimension is fail-closed", async () => {
  await expectStage(
    fixture(),
    semanticOptions({ embedBehavior: { dimension: 3 } }),
    "corpus_embedding_dimension",
  );
});

test("vector write failure is fail-closed and query embedding is never attempted", async () => {
  const seen = [];
  await expectStage(
    fixture(),
    semanticOptions({ seen, storeBehavior: { writeError: "vector write boom" } }),
    "vector_store_write",
  );
  assert.equal(seen.length, 3);
});

test("query embedding failure and wrong query dimension are fail-closed", async () => {
  await expectStage(
    fixture(),
    semanticOptions({ embedBehavior: { error: value => value === "semantic-query" ? "query embedding boom" : null } }),
    "query_embedding",
  );
  await expectStage(
    fixture(),
    semanticOptions({
      embeddingProvider: async text => text === "semantic-query"
        ? new Array(7).fill(0)
        : vectorFor(text),
    }),
    "query_embedding_dimension",
  );
});

test("vector search failure, empty result, and host-manager fallback are fail-closed", async () => {
  const failedSearch = semanticOptions({ storeBehavior: { searchError: "vector search boom" } });
  await assert.rejects(
    runLongMemEvalSemanticRetrievalCase(fixture(), failedSearch),
    error => {
      assert.equal(error.stage, "vector_search");
      assert.equal(error.details.vector_fallback_called, true);
      return true;
    },
  );

  await expectStage(
    fixture(),
    semanticOptions({ storeBehavior: { emptySearch: true } }),
    "vector_search",
  );
});

test("temporary vector store initialization failure is fail-closed", async () => {
  await expectStage(
    fixture(),
    semanticOptions({ storeBehavior: { initError: "vector init boom" } }),
    "vector_store_initialization",
  );
});

test("strong lexical match is not silently accepted as semantic success", async () => {
  const strongQuery = "\"semantic-answer Kyoto\"";
  const record = fixture({
    question_id: "semantic-answer-Kyoto-semantic-query",
    question: strongQuery,
    haystack_sessions: [
      [{ role: "user", content: strongQuery, has_answer: true }],
      [{ role: "user", content: strongQuery }],
      [{ role: "user", content: strongQuery }],
    ],
    haystack_session_ids: ["s1", "s2", "s3"],
    answer_session_ids: ["s1"],
  });
  const stores = [];
  await expectStage(record, semanticOptions({ stores }), "vector_skipped");
  assert.equal(stores[0].queryVectors.length, 0);
});

test("official exclusions remain evaluator-only skips", async () => {
  const abstention = await runLongMemEvalSemanticRetrievalCase(fixture({
    question_id: "semantic_abs",
    answer_session_ids: [],
  }), semanticOptions());
  assert.equal(abstention.skipped, true);
  assert.equal(abstention.skip_reason, "official_retrieval_abstention");
  assert.equal(abstention.provenance.vector_attempted_count, 0);

  const assistantOnly = await runLongMemEvalSemanticRetrievalCase(fixture({
    question_id: "semantic_assistant_only",
    haystack_sessions: fixture().haystack_sessions.map(session => session.map(turn => ({
      ...turn,
      has_answer: turn.role === "assistant",
    }))),
  }), semanticOptions());
  assert.equal(assistantOnly.skipped, true);
  assert.equal(assistantOnly.skip_reason, "official_retrieval_no_user_target");
});

test("duplicate source session ids retain independent corpus occurrences", async () => {
  const record = fixture({
    haystack_session_ids: ["s-noise", "s-answer", "s-noise"],
  });
  const result = await runLongMemEvalSemanticRetrievalCase(record, semanticOptions());
  assert.equal(result.corpus_sessions, 3);
  assert.equal(result.retrieved_session_ids.includes("s-answer"), true);
});

test("benchmark-owned embedding cache is reusable and reduces provider calls", async () => {
  const seen = [];
  const stores = [];
  const cache = createBenchmarkEmbeddingCache();
  const output = await runLongMemEvalSemanticRetrievalDataset([
    fixture(),
    fixture({ question_id: "semantic_q2" }),
  ], semanticOptions({ cache, seen, stores }));

  assert.equal(output.results[0].provenance.provider_call_count, 4);
  assert.equal(output.results[1].provenance.provider_call_count, 0);
  assert.equal(output.results[1].provenance.embedding_cache_hits, 4);
  assert.equal(output.run.provider_call_count, 4);
  assert.equal(output.run.embedding_cache_hits, 4);
  assert.equal(seen.length, 4);
  cache.close();
});

test("SQLite cache round-trips exact 2560-dimensional Float64 vectors across close and reopen", () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-semantic-cache-roundtrip-"));
  const vector = new Array(SEMANTIC_EXPECTED_EMBEDDING_DIMENSION).fill(0);
  vector[0] = Math.PI;
  vector[1] = Number.MIN_VALUE;
  vector[2] = -0;
  vector[3] = Number.MAX_VALUE;
  const key = buildEmbeddingCacheKey({ input: "exact-roundtrip" });
  const cachePath = join(root, "embeddings.sqlite");
  try {
    const cache = createBenchmarkEmbeddingCache(cachePath);
    cache.set(key, vector);
    assert.deepEqual(cache.get(key), vector);
    cache.close();
    assert.throws(() => cache.get(key), error => error.stage === "embedding_cache_closed");
    cache.close();

    const rawDatabase = new Database(cachePath, { readonly: true });
    assert.equal(rawDatabase.pragma("user_version", { simple: true }), 1);
    assert.equal(rawDatabase.prepare(
      "SELECT value FROM embedding_cache_metadata WHERE key = 'schema'",
    ).get().value, "memory_engine_benchmark_embedding_cache_v1");
    rawDatabase.close();

    const reopened = createBenchmarkEmbeddingCache(cachePath);
    const restored = reopened.get(key);
    assert.equal(restored.length, SEMANTIC_EXPECTED_EMBEDDING_DIMENSION);
    for (let index = 0; index < vector.length; index += 1) {
      assert.equal(Object.is(restored[index], vector[index]), true, `vector index ${index}`);
    }
    reopened.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SQLite cache rejects wrong dimensions and non-finite vectors", () => {
  const cache = createBenchmarkEmbeddingCache();
  const key = buildEmbeddingCacheKey({ input: "invalid-vector" });
  assert.throws(
    () => cache.set(key, new Array(3).fill(0)),
    error => error.stage === "embedding_cache_write",
  );
  const nonFinite = new Array(SEMANTIC_EXPECTED_EMBEDDING_DIMENSION).fill(0);
  nonFinite[17] = Number.NaN;
  assert.throws(
    () => cache.set(key, nonFinite),
    error => error.stage === "embedding_cache_write",
  );
  cache.close();
});

test("SQLite cache uses complete provider/model/projection/input identity without collisions", () => {
  const cache = createBenchmarkEmbeddingCache();
  const base = buildEmbeddingCacheKey({ input: "same text" });
  const variants = [
    base,
    { ...base, provider: "OtherProvider" },
    { ...base, model: "other-model" },
    { ...base, projection_version: base.projection_version + 1 },
    { ...base, input_sha256: "different-input-hash" },
    { ...base, normalized_input_sha256: "different-normalized-input-hash" },
  ];
  for (const [index, key] of variants.entries()) {
    const vector = new Array(SEMANTIC_EXPECTED_EMBEDDING_DIMENSION).fill(0);
    vector[0] = index + 0.25;
    cache.set(key, vector);
  }
  for (const [index, key] of variants.entries()) assert.equal(cache.get(key)[0], index + 0.25);
  assert.equal(cache.snapshot().entries && Object.keys(cache.snapshot().entries).length, variants.length);
  cache.close();
});

test("SQLite cache is entry-wise, supports 100 2560-dimensional entries, and has no JSON rewrite path", () => {
  const cache = createBenchmarkEmbeddingCache();
  for (let index = 0; index < 100; index += 1) {
    const key = buildEmbeddingCacheKey({ input: `batch-${index}` });
    const vector = new Array(SEMANTIC_EXPECTED_EMBEDDING_DIMENSION).fill(0);
    vector[index % SEMANTIC_EXPECTED_EMBEDDING_DIMENSION] = index + 0.5;
    cache.set(key, vector);
  }
  for (let index = 0; index < 100; index += 1) {
    const key = buildEmbeddingCacheKey({ input: `batch-${index}` });
    assert.equal(cache.get(key)[index % SEMANTIC_EXPECTED_EMBEDDING_DIMENSION], index + 0.5);
  }
  cache.close();

  const source = readFileSync(
    new URL("../lib/benchmark/longmemeval-semantic-retrieval-runner-v1.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("JSON.stringify(state"), false);
  assert.equal(source.includes("writeFileSync"), false);
  assert.equal(source.includes("CREATE TABLE ${SEMANTIC_EMBEDDING_CACHE_SQLITE_TABLE}"), true);
  assert.equal(source.includes("PRIMARY KEY"), true);
});

test("SQLite cache rejects legacy JSON and unsupported SQLite formats", () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-semantic-cache-format-"));
  const legacyPath = join(root, "legacy.json");
  const invalidSqlitePath = join(root, "invalid.sqlite");
  try {
    writeFileSync(legacyPath, JSON.stringify({ schema: "memory_engine_benchmark_embedding_cache_v1", entries: {} }), "utf8");
    assert.throws(
      () => createBenchmarkEmbeddingCache(legacyPath),
      error => error.stage === "embedding_cache_format",
    );

    const invalidDb = new Database(invalidSqlitePath);
    invalidDb.exec("CREATE TABLE unrelated (value TEXT);");
    invalidDb.close();
    assert.throws(
      () => createBenchmarkEmbeddingCache(invalidSqlitePath),
      error => error.stage === "embedding_cache_format",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cache identity/provenance has no raw input or gold fields", () => {
  assert.throws(
    () => createBenchmarkEmbeddingCache(join(tmpdir(), ".openclaw", "memory", "live-cache.sqlite")),
    error => error.stage === "embedding_cache_path",
  );
  const key = buildEmbeddingCacheKey({
    provider: SEMANTIC_EMBEDDING_PROVIDER,
    baseUrl: "https://user:secret@example.test/v1?token=redact",
    model: SEMANTIC_EMBEDDING_MODEL,
    projectionVersion: CANONICAL_VECTOR_PROJECTION_VERSION,
    input: "exact projection input",
  });
  assert.equal(key.provider, SEMANTIC_EMBEDDING_PROVIDER);
  assert.equal(key.base_url_identity, "https://example.test/v1");
  assert.equal(key.model, SEMANTIC_EMBEDDING_MODEL);
  assert.equal(key.projection_version, CANONICAL_VECTOR_PROJECTION_VERSION);
  assert.equal(key.input_sha256, createHash("sha256").update("exact projection input").digest("hex"));
  assert.equal(typeof key.normalized_input_sha256, "string");
  assert.equal(JSON.stringify(key).includes("secret"), false);

  const root = mkdtempSync(join(tmpdir(), "memory-engine-semantic-cache-"));
  try {
    const cachePath = join(root, "cache.sqlite");
    const cache = createBenchmarkEmbeddingCache(cachePath);
    cache.set(key, new Array(SEMANTIC_EXPECTED_EMBEDDING_DIMENSION).fill(0));
    const database = new Database(cachePath, { readonly: true });
    const rows = database.prepare("SELECT * FROM embedding_cache_entries").all();
    const columns = database.prepare("PRAGMA table_info(embedding_cache_entries)").all().map(row => row.name);
    assert.equal(rows.length, 1);
    assert.equal(columns.includes("input"), false);
    assert.equal(columns.includes("raw_input"), false);
    assert.equal(JSON.stringify(rows).includes("answer_session_ids"), false);
    assert.equal(JSON.stringify(rows).includes("has_answer"), false);
    assert.equal(JSON.stringify(rows).includes("gold"), false);
    database.close();
    cache.close();
    const loaded = createBenchmarkEmbeddingCache(cachePath);
    assert.equal(loaded.get(key).length, SEMANTIC_EXPECTED_EMBEDDING_DIMENSION);
    loaded.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("semantic corpus and vector metadata do not receive evaluator gold fields", async () => {
  const seen = [];
  const stores = [];
  await runLongMemEvalSemanticRetrievalCase(fixture(), semanticOptions({ seen, stores }));
  assert.equal(seen.every(input => !input.includes("answer_session_ids")), true);
  assert.equal(seen.every(input => !input.includes("has_answer")), true);
  for (const row of stores[0].rows) {
    assert.equal("answer" in row, false);
    assert.equal("answer_session_ids" in row, false);
    assert.equal("has_answer" in row, false);
    assert.equal("evidence_label" in row, false);
  }
});

test("semantic CLI has explicit profile, deterministic injected smoke path, and no-provider fail-closed path", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-semantic-cli-"));
  try {
    const inputPath = join(root, "longmemeval-smoke.json");
    const cachePath = join(root, "benchmark-cache.sqlite");
    const content = `${JSON.stringify([fixture()], null, 2)}\n`;
    writeFileSync(inputPath, content, "utf8");
    const expectedSha = createHash("sha256").update(Buffer.from(content)).digest("hex");
    const injected = await runLongMemEvalSemanticCli([
      "--input", inputPath,
      "--limit", "1",
      "--top-k", "3",
      "--cache-path", cachePath,
    ], {
      embeddingProvider: fakeEmbedder(),
      repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
      runnerOptions: {
        vectorStoreFactory: fakeVectorStoreFactory(),
        benchmarkNowSec: 1_800_000_000,
      },
    });
    assert.equal(injected.printable.provenance.input_sha256, expectedSha);
    assert.equal(injected.printable.provenance.repository_commit, TEST_REPOSITORY_COMMIT);
    assert.equal(injected.printable.provenance.repository_worktree_clean, true);
    assert.equal(injected.printable.provenance.repository_provenance_source, "git");
    assert.equal(injected.printable.run.profile, LONGMEMEVAL_SEMANTIC_PROFILE);
    assert.equal(injected.printable.summary.scored_cases, 1);
    assert.equal(injected.printable.summary.metrics["recall_any@1"], 1);
    const cacheDatabase = new Database(cachePath, { readonly: true });
    assert.equal(cacheDatabase.prepare("SELECT COUNT(*) AS count FROM embedding_cache_entries").get().count, 4);
    cacheDatabase.close();

    const help = await runLongMemEvalSemanticCli(["--help"]);
    assert.equal(help.usage.includes(LONGMEMEVAL_SEMANTIC_PROFILE), true);
    assert.equal(help.usage.includes("SQLite"), true);
    assert.equal(usage(), help.usage);

    const isolatedProviderHome = join(root, "no-provider-home");
    await assert.rejects(
      runLongMemEvalSemanticCli(["--input", inputPath, "--limit", "1"], {
        repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
        runnerOptions: {
          vectorStoreFactory: fakeVectorStoreFactory(),
          providerEnv: Object.freeze({}),
          providerConfig: Object.freeze({}),
          providerHomeDir: isolatedProviderHome,
          providerReadFile: () => { throw new Error("provider config absent"); },
          benchmarkNowSec: 1_800_000_000,
        },
      }),
      error => {
        assert.equal(error.stage, "corpus_embedding");
        assert.equal(error.details.vector_fallback_called, false);
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("semantic CLI binds exact injected repository commit and emits clean git provenance", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-semantic-provenance-"));
  const inputPath = join(root, "input.json");
  writeFileSync(inputPath, "[]\n", "utf8");
  const calls = [];
  try {
    const result = await runLongMemEvalSemanticCli(["--input", inputPath], {
      repositoryProvenance: () => TEST_REPOSITORY_PROVENANCE,
      execFileSync: () => { throw new Error("real git must not be called"); },
      runnerOptions: {
        repositoryCommit: "b".repeat(40),
        repositoryWorktreeClean: false,
      },
      runDataset: async (records, options) => {
        calls.push({ records, options });
        return {
          provenance: {
            profile: LONGMEMEVAL_SEMANTIC_PROFILE,
            repository_commit: options.repositoryCommit,
            repository_worktree_clean: options.repositoryWorktreeClean,
            repository_provenance_source: options.repositoryProvenanceSource,
          },
          run: { profile: LONGMEMEVAL_SEMANTIC_PROFILE },
          summary: { cases: records.length },
        };
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.repositoryCommit, TEST_REPOSITORY_COMMIT);
    assert.equal(calls[0].options.repositoryWorktreeClean, true);
    assert.equal(calls[0].options.repositoryProvenanceSource, "git");
    assert.equal(result.output.provenance.repository_commit, TEST_REPOSITORY_COMMIT);
    assert.equal(result.output.provenance.repository_worktree_clean, true);
    assert.equal(result.output.provenance.repository_provenance_source, "git");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("semantic CLI rejects dirty worktrees before invoking the runner", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-semantic-dirty-"));
  const inputPath = join(root, "input.json");
  writeFileSync(inputPath, "[]\n", "utf8");
  let runnerCalled = false;
  try {
    await assert.rejects(
      runLongMemEvalSemanticCli(["--input", inputPath], {
        repositoryProvenance: {
          ...TEST_REPOSITORY_PROVENANCE,
          repository_worktree_clean: false,
        },
        runDataset: async () => {
          runnerCalled = true;
          throw new Error("runner must not be called");
        },
      }),
      error => error.code === "semantic_cli_repository_provenance_dirty_worktree",
    );
    assert.equal(runnerCalled, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("semantic CLI fails closed when git provenance cannot be resolved or commit format is invalid", async () => {
  assert.throws(
    () => resolveRepositoryProvenance({
      repositoryRoot: process.cwd(),
      execFileSync: () => { throw new Error("git unavailable"); },
    }),
    error => error.code === "semantic_cli_repository_provenance_unavailable",
  );
  assert.throws(
    () => validateRepositoryProvenance({
      ...TEST_REPOSITORY_PROVENANCE,
      repository_commit: "b002d8a",
    }),
    error => error.code === "semantic_cli_repository_provenance_invalid_commit",
  );
  assert.throws(
    () => validateRepositoryProvenance({
      ...TEST_REPOSITORY_PROVENANCE,
      repository_commit: "A".repeat(40),
    }),
    error => error.code === "semantic_cli_repository_provenance_invalid_commit",
  );
  assert.deepEqual(validateRepositoryProvenance(TEST_REPOSITORY_PROVENANCE), TEST_REPOSITORY_PROVENANCE);
});
