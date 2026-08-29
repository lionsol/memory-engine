import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  CANONICAL_VECTOR_PROJECTION_VERSION,
  CANONICAL_VECTOR_TEXT_MAX_CHARS,
} from "../lib/canonical/vector-projection.js";
import { stripPromptMetadataPrefix } from "../query-utils.js";
import {
  buildLocomoConversationDialogDocuments,
  LOCOMO_BLIP_CAPTION_POLICY,
  LOCOMO_DIALOG_PROJECTION_VERSION,
  LOCOMO_DATASET_SHA256,
  LOCOMO_EVIDENCE_CANONICALIZED_V1,
  LOCOMO_EVIDENCE_STRICT_V1,
  normalizeLocomoDataset,
} from "../lib/benchmark/locomo-v1.js";
import {
  LOCOMO_LEXICAL_RETRIEVAL_PROFILE,
} from "../lib/benchmark/locomo-retrieval-runner-v1.js";
import {
  LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE,
  LOCOMO_TIME_FROZEN_SEMANTIC_RETRIEVAL_PROFILE,
} from "../lib/benchmark/locomo-time-frozen-retrieval-runner-v2.js";
import {
  LOCOMO_SEMANTIC_BENCHMARK_CLOCK_CONTRACT,
  LOCOMO_SEMANTIC_EMBEDDING_CACHE_SCHEMA,
  LOCOMO_SEMANTIC_EMBEDDING_CACHE_SQLITE_USER_VERSION,
  LOCOMO_SEMANTIC_EMBEDDING_MODEL,
  LOCOMO_SEMANTIC_EMBEDDING_MODEL_REVISION,
  LOCOMO_SEMANTIC_EMBEDDING_PROVIDER,
  LOCOMO_SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
  LOCOMO_SEMANTIC_HOST_MANAGER_MODE,
  LOCOMO_SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD,
  LOCOMO_SEMANTIC_PROFILE,
  LOCOMO_SEMANTIC_QUERY_INSTRUCTION,
  LOCOMO_SEMANTIC_QUERY_MODE,
  LOCOMO_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA,
  LOCOMO_SEMANTIC_TOP_K,
  LOCOMO_SEMANTIC_VECTOR_MODE,
  createLocomoSemanticHybridRuntime,
  runLocomoSemanticRetrievalDataset,
} from "../lib/benchmark/locomo-semantic-retrieval-runner-v2.js";

const require = createRequire(import.meta.url);
const semanticCli = require("../bin/run-locomo-semantic-retrieval-v2.js");

const TEST_NOW_SEC = 1_800_000_000;
const TEST_REPOSITORY_PROVENANCE = {
  repository_commit: "a".repeat(40),
  repository_worktree_clean: true,
  repository_provenance_source: "git",
};

function rawCase({ sampleId = "conv-test", questions = null, longText = false } = {}) {
  const firstText = longText
    ? `Alice visited Kyoto. ${"long ".repeat(600)}`
    : "Alice visited Kyoto.";
  return {
    sample_id: sampleId,
    observation: "PRIVATE OBSERVATION",
    session_summary: "PRIVATE SESSION SUMMARY",
    event_summary: "PRIVATE EVENT SUMMARY",
    conversation: {
      speaker_a: "Alice",
      speaker_b: "Bob",
      session_1_date_time: "1:00 pm on 1 May, 2023",
      session_1: [{
        speaker: "Alice",
        dia_id: "D1:1",
        text: firstText,
        blip_caption: "a Kyoto street at dusk",
        img_url: "PRIVATE IMAGE URL",
        image_search_query: "PRIVATE IMAGE QUERY",
        answer: "PRIVATE TURN ANSWER",
        adversarial_answer: "PRIVATE ADVERSARIAL ANSWER",
        evidence: ["D1:1"],
        category: 5,
      }, {
        speaker: "Bob",
        dia_id: "D1:2",
        text: "They discussed Osaka.",
      }],
      session_2_date_time: "2:00 pm on 2 May, 2023",
      session_2: [{
        speaker: "Alice",
        dia_id: "D2:1",
        text: "Alice returned later.",
      }],
    },
    qa: questions || [
      { question: "which city did Alice visit?", answer: "Kyoto", evidence: ["D1:1"], category: 4 },
      { question: "what did they discuss?", answer: "Osaka", evidence: ["D1:2"], category: 4 },
    ],
  };
}

function fakeEmbedding(text, behavior = {}) {
  if (behavior.error) {
    const message = behavior.error(String(text));
    if (message) throw new Error(message);
  }
  if (behavior.dimension) return new Array(behavior.dimension).fill(0);
  const value = String(text).toLowerCase();
  const vector = new Array(LOCOMO_SEMANTIC_EXPECTED_EMBEDDING_DIMENSION).fill(0);
  if (value.includes("kyoto") || value.includes("which city")) vector[0] = 1;
  else if (value.includes("osaka") || value.includes("discuss")) vector[1] = 1;
  else vector[2] = 1;
  return vector;
}

function fakeEmbedder(seen = [], behavior = {}) {
  return async text => {
    seen.push(String(text));
    return fakeEmbedding(text, behavior);
  };
}

function fakeVectorStoreFactory(stores = [], behavior = {}) {
  return async ({ path }) => {
    const rows = [];
    const store = { path, rows, queryVectors: [] };
    stores.push(store);
    if (behavior.initError) throw new Error(behavior.initError);
    store.table = {
      async add(nextRows) {
        if (behavior.writeError) throw new Error(behavior.writeError);
        rows.push(...nextRows.map(row => ({ ...row, vector: [...row.vector] })));
      },
      async countRows() {
        return behavior.countRows === undefined ? rows.length : behavior.countRows;
      },
      search(query) {
        store.queryVectors.push([...query]);
        return {
          limit(limit) {
            return {
              async execute() {
                if (behavior.searchError) throw new Error(behavior.searchError);
                if (behavior.emptySearch) return [];
                if (behavior.foreignId) {
                  return [{ id: behavior.foreignId, text: "foreign", _distance: 0.01 }];
                }
                return [...rows]
                  .map(row => ({
                    ...row,
                    _distance: row.vector[0] === query[0] && query[0] === 1
                      || row.vector[1] === query[1] && query[1] === 1
                      ? 0.01
                      : 0.9,
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

function officialFakeEmbeddingFromDigest(digestHex) {
  const digest = Buffer.from(String(digestHex), "hex");
  const vector = new Array(LOCOMO_SEMANTIC_EXPECTED_EMBEDDING_DIMENSION).fill(0);
  for (let index = 0; index < digest.length; index += 1) vector[index] = digest[index] / 255;
  return vector;
}

function officialFakeEmbedding(text) {
  return officialFakeEmbeddingFromDigest(createHash("sha256").update(String(text)).digest("hex"));
}

function officialInputWitness(records) {
  const items = normalizeLocomoDataset(records, {
    evidencePolicy: LOCOMO_EVIDENCE_CANONICALIZED_V1,
  });
  const corpusInputs = new Set();
  const queryInputs = new Set();
  for (const item of items) {
    for (const document of buildLocomoConversationDialogDocuments(item, {
      evidencePolicy: item.evidence_policy,
    })) {
      corpusInputs.add(document.content.slice(0, CANONICAL_VECTOR_TEXT_MAX_CHARS));
    }
    for (const question of item.questions) {
      if (question.scoreable) queryInputs.add(stripPromptMetadataPrefix(question.question));
    }
  }
  return {
    corpusInputs,
    queryInputs,
    allInputs: new Set([...corpusInputs, ...queryInputs]),
    corpusHashes: new Set([...corpusInputs].map(value => createHash("sha256").update(value).digest("hex"))),
    queryHashes: new Set([...queryInputs].map(value => createHash("sha256").update(value).digest("hex"))),
  };
}

function officialFakeEmbeddingCache() {
  const entries = new Set();
  const operations = [];
  let closeCount = 0;
  return {
    operations,
    get(key) {
      operations.push({ operation: "get", key: { ...key } });
      const serialized = JSON.stringify(key);
      if (!entries.has(serialized)) return null;
      return officialFakeEmbeddingFromDigest(key.input_sha256);
    },
    set(key, vector) {
      assert.equal(vector.length, LOCOMO_SEMANTIC_EXPECTED_EMBEDDING_DIMENSION);
      operations.push({ operation: "set", key: { ...key } });
      entries.add(JSON.stringify(key));
    },
    close() {
      closeCount += 1;
    },
    get closeCount() {
      return closeCount;
    },
  };
}

function officialFakeVectorStoreFactory(stores = []) {
  return async ({ path, sampleId }) => {
    const store = {
      path,
      sampleId,
      rows: [],
      addCalls: 0,
      vectorSearchCount: 0,
      queryVectorDimensions: [],
      errors: [],
      closed: false,
      closeCount: 0,
    };
    const table = {
      async add(nextRows) {
        store.addCalls += 1;
        for (const row of nextRows) {
          assert.deepEqual(Object.keys(row).sort(), ["id", "text", "timestamp", "vector"]);
          assert.equal(row.vector.length, LOCOMO_SEMANTIC_EXPECTED_EMBEDDING_DIMENSION);
          store.rows.push({ id: row.id, text: row.text, timestamp: row.timestamp });
        }
      },
      async countRows() {
        return store.rows.length;
      },
      search(query) {
        try {
          assert.equal(query.length, LOCOMO_SEMANTIC_EXPECTED_EMBEDDING_DIMENSION);
          store.vectorSearchCount += 1;
          store.queryVectorDimensions.push(query.length);
          return {
            limit(limit) {
              return {
                async execute() {
                  try {
                    return store.rows.slice(0, limit).map(row => ({
                      ...row,
                      _distance: 0.01,
                    }));
                  } catch (error) {
                    store.errors.push(String(error?.stack || error));
                    throw error;
                  }
                },
              };
            },
          };
        } catch (error) {
          store.errors.push(String(error?.stack || error));
          throw error;
        }
      },
    };
    store.table = table;
    stores.push(store);
    return {
      table,
      close() {
        store.closeCount += 1;
        store.closed = true;
      },
    };
  };
}

function options(overrides = {}) {
  const seen = overrides.seen || [];
  const stores = overrides.stores || [];
  return {
    topK: LOCOMO_SEMANTIC_TOP_K,
    benchmarkNowSec: TEST_NOW_SEC,
    repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
    embeddingProvider: overrides.embeddingProvider || fakeEmbedder(seen, overrides.embedBehavior),
    vectorStoreFactory: overrides.vectorStoreFactory || fakeVectorStoreFactory(stores, overrides.storeBehavior),
    ...overrides,
    seen,
    stores,
  };
}

async function expectStage(record, runnerOptions, stage) {
  await assert.rejects(
    runLocomoSemanticRetrievalDataset([record], runnerOptions),
    error => {
      assert.equal(error.stage, stage, error.stack);
      assert.equal(typeof error.details?.corpus_embedding_count, "number");
      assert.equal(typeof error.details?.vector_error_count, "number");
      return true;
    },
  );
}

test("semantic v2 identity is independent from lexical v1 and lexical time-frozen v2", () => {
  assert.equal(LOCOMO_SEMANTIC_PROFILE, LOCOMO_TIME_FROZEN_SEMANTIC_RETRIEVAL_PROFILE);
  assert.notEqual(LOCOMO_SEMANTIC_PROFILE, LOCOMO_LEXICAL_RETRIEVAL_PROFILE);
  assert.notEqual(LOCOMO_SEMANTIC_PROFILE, LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE);
  assert.equal(LOCOMO_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA, "memory_engine_locomo_semantic_retrieval_time_frozen_v2");
  assert.equal(LOCOMO_SEMANTIC_TOP_K, 50);
  assert.equal(LOCOMO_SEMANTIC_VECTOR_MODE, "temporary_lancedb");
  assert.equal(LOCOMO_SEMANTIC_HOST_MANAGER_MODE, "forbidden");
  assert.equal(LOCOMO_SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD, 0.7);
  assert.equal(LOCOMO_SEMANTIC_EMBEDDING_PROVIDER, "SiliconFlow");
  assert.equal(LOCOMO_SEMANTIC_EMBEDDING_MODEL, "Qwen/Qwen3-Embedding-4B");
  assert.equal(LOCOMO_SEMANTIC_EMBEDDING_MODEL_REVISION, "unavailable/unpinned");
  assert.equal(LOCOMO_SEMANTIC_QUERY_INSTRUCTION, "none");
  assert.equal(LOCOMO_SEMANTIC_QUERY_MODE, "exact_question");
  assert.equal(LOCOMO_SEMANTIC_BENCHMARK_CLOCK_CONTRACT, "locomo_materialization_and_search_fixed_v2");
});

test("semantic v2 builds one isolated conversation corpus and reuses it for all QA", async () => {
  const seen = [];
  const stores = [];
  const output = await runLocomoSemanticRetrievalDataset([rawCase()], options({ seen, stores }));

  assert.equal(output.schema, LOCOMO_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA);
  assert.equal(output.profile, LOCOMO_SEMANTIC_PROFILE);
  assert.equal(output.summary.conversations, 1);
  assert.equal(output.summary.corpora_built, 1);
  assert.equal(output.summary.corpus_lancedb_row_count, 3);
  assert.equal(output.summary.corpus_embedding_count, 3);
  assert.equal(output.summary.query_embedding_count, 2);
  assert.equal(output.summary.total_embedding_lookups, 5);
  assert.equal(output.summary.retrieval_cases, 2);
  assert.equal(output.summary.vector_attempted_count, 2);
  assert.equal(output.summary.vector_skipped_count, 0);
  assert.equal(output.summary.vector_error_count, 0);
  assert.equal(output.summary.host_manager_fallback_count, 0);
  assert.equal(stores.length, 1);
  assert.equal(stores[0].rows.length, 3);
  assert.equal(stores[0].queryVectors.length, 2);
  assert.equal(existsSync(stores[0].path), false);
  assert.equal(seen.length, 5);
  assert.equal(output.summary.strict.scored_cases, 2);
  assert.equal(output.summary.sensitivity.scored_cases, 2);
  const repeat = await runLocomoSemanticRetrievalDataset([rawCase()], options());
  assert.deepEqual(
    output.results.map(result => ({ ids: result.retrieved_memory_ids, metrics: result.sensitivity.metrics })),
    repeat.results.map(result => ({ ids: result.retrieved_memory_ids, metrics: result.sensitivity.metrics })),
  );
  for (const result of output.results) {
    assert.equal(result.diagnostics.search_now_sec, TEST_NOW_SEC);
    assert.equal(result.diagnostics.vector_backend, "lancedb");
    assert.equal(result.diagnostics.vector_stage, "lancedb_search");
    assert.equal(result.diagnostics.vector_in_fusion, true);
    assert.equal(result.diagnostics.vector_skipped, false);
    assert.equal(result.diagnostics.vector_error_count, 0);
  }
  for (const scope of [output.provenance, output.run]) {
    assert.equal(scope.profile, LOCOMO_SEMANTIC_PROFILE);
    assert.equal(scope.benchmark_now_sec, TEST_NOW_SEC);
    assert.equal(scope.materialization_now_sec, TEST_NOW_SEC);
    assert.equal(scope.search_now_sec, TEST_NOW_SEC);
    assert.equal(scope.benchmark_clock_contract, LOCOMO_SEMANTIC_BENCHMARK_CLOCK_CONTRACT);
    assert.equal(scope.top_k, 50);
    assert.equal(scope.vector_top_k, 50);
    assert.equal(scope.dialog_projection_version, LOCOMO_DIALOG_PROJECTION_VERSION);
    assert.equal(scope.include_session_datetime, true);
    assert.equal(scope.blip_caption_policy, LOCOMO_BLIP_CAPTION_POLICY);
    assert.equal(scope.embedding_dimension, LOCOMO_SEMANTIC_EXPECTED_EMBEDDING_DIMENSION);
    assert.equal(scope.canonical_vector_projection_version, CANONICAL_VECTOR_PROJECTION_VERSION);
    assert.equal(scope.canonical_vector_text_max_chars, CANONICAL_VECTOR_TEXT_MAX_CHARS);
    assert.equal(scope.embedding_cache_schema, LOCOMO_SEMANTIC_EMBEDDING_CACHE_SCHEMA);
    assert.equal(scope.embedding_cache_user_version, LOCOMO_SEMANTIC_EMBEDDING_CACHE_SQLITE_USER_VERSION);
  }
});

test("Canonical vector projection preserves frozen dialog text and excludes evaluator fields", async () => {
  const seen = [];
  const stores = [];
  await runLocomoSemanticRetrievalDataset([rawCase({ longText: true })], options({ seen, stores }));
  const first = stores[0].rows.find(row => row.text.includes("Kyoto"));
  assert.ok(first);
  assert.equal(first.text.length, CANONICAL_VECTOR_TEXT_MAX_CHARS);
  assert.equal(first.text.startsWith("(1:00 pm on 1 May, 2023) Alice: Alice visited Kyoto."), true);
  assert.deepEqual(Object.keys(first).sort(), ["id", "text", "timestamp", "vector"]);
  assert.equal(first.text.includes("PRIVATE"), false);
  assert.equal(seen.every(value => !value.includes("PRIVATE")), true);
  assert.equal(seen.every(value => !value.includes("adversarial_answer")), true);
  assert.equal(seen.some(value => value === "which city did Alice visit?"), true);
});

test("semantic results feed strict and sensitivity evaluators from the same retrieval", async () => {
  const output = await runLocomoSemanticRetrievalDataset([rawCase()], options());
  for (const result of output.results) {
    assert.deepEqual(result.retrieved_dialog_ids.length > 0, true);
    assert.equal(result.strict.question_id, result.sensitivity.question_id);
    assert.equal(result.strict_session.question_id, result.sensitivity_session.question_id);
    assert.equal(result.strict.metric_level, "dialog");
    assert.equal(result.sensitivity.metric_level, "dialog");
    assert.equal(result.strict_session.metric_level, "session");
    assert.equal(result.sensitivity_session.metric_level, "session");
  }
  assert.equal(output.provenance.strict_denominator.scored_cases, 2);
  assert.equal(output.provenance.sensitivity_denominator.scored_cases, 2);
  assert.equal(output.provenance.strict_denominator.skipped_cases, 0);
  assert.equal(output.provenance.sensitivity_denominator.skipped_cases, 0);
  assert.equal(output.provenance.evidence_policies.includes(LOCOMO_EVIDENCE_STRICT_V1), true);
  assert.equal(output.provenance.evidence_policies.includes(LOCOMO_EVIDENCE_CANONICALIZED_V1), true);
});

test("score-skipped QA does not generate query embeddings or vector searches", async () => {
  const stores = [];
  const output = await runLocomoSemanticRetrievalDataset([rawCase({
    questions: [{ question: "unscored question", answer: "unknown", evidence: ["D9:9"], category: 4 }],
  })], options({ stores }));
  assert.equal(output.results[0].sensitivity.scoreable, false);
  assert.equal(output.results[0].strict.scoreable, false);
  assert.equal(output.summary.corpus_embedding_count, 3);
  assert.equal(output.summary.query_embedding_count, 0);
  assert.equal(output.summary.vector_attempted_count, 0);
  assert.equal(output.summary.vector_skipped_count, 0);
  assert.equal(stores[0].queryVectors.length, 0);
});

test("embedding cache miss, hit, restart, and ownership follow the existing SQLite contract", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-locomo-semantic-cache-"));
  const cachePath = join(root, "embeddings.sqlite");
  const firstSeen = [];
  try {
    const first = await runLocomoSemanticRetrievalDataset([rawCase()], options({
      cachePath,
      seen: firstSeen,
      embeddingProvider: fakeEmbedder(firstSeen),
    }));
    assert.equal(first.provenance.provider_call_count, 5);
    assert.equal(first.provenance.embedding_cache_hits, 0);
    const secondSeen = [];
    const second = await runLocomoSemanticRetrievalDataset([rawCase()], options({
      cachePath,
      seen: secondSeen,
      embeddingProvider: fakeEmbedder(secondSeen),
    }));
    assert.equal(second.provenance.provider_call_count, 0);
    assert.equal(second.provenance.embedding_cache_hits, 5);
    assert.equal(secondSeen.length, 0);
    const database = new Database(cachePath, { readonly: true });
    assert.equal(database.pragma("user_version", { simple: true }), 1);
    assert.equal(database.prepare("SELECT value FROM embedding_cache_metadata WHERE key = 'schema'").get().value, LOCOMO_SEMANTIC_EMBEDDING_CACHE_SCHEMA);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM embedding_cache_entries").get().count, 5);
    database.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("wrong embedding dimensions, provider failure, cache/vector failures, and row mismatch fail closed", async () => {
  await expectStage(rawCase(), options({ embedBehavior: { dimension: 3 } }), "corpus_embedding_dimension");
  await expectStage(rawCase(), options({
    embeddingProvider: async () => { throw new Error("missing provider configuration"); },
  }), "corpus_embedding");
  await expectStage(rawCase(), options({ storeBehavior: { writeError: "write failed" } }), "vector_store_write");
  await expectStage(rawCase(), options({ storeBehavior: { countRows: 2 } }), "vector_store_write");
  await expectStage(rawCase(), options({ storeBehavior: { initError: "initialization failed" } }), "vector_store_initialization");
});

test("query embedding, LanceDB search, empty vector, and host fallback failures are fail-closed", async () => {
  await expectStage(rawCase(), options({
    embeddingProvider: fakeEmbedder([], { error: value => value.includes("which city") ? "query failed" : null }),
  }), "query_embedding");
  await expectStage(rawCase(), options({ storeBehavior: { searchError: "search failed" } }), "vector_fallback");
  await expectStage(rawCase(), options({ storeBehavior: { emptySearch: true } }), "vector_search");
  await expectStage(rawCase(), options({ storeBehavior: { foreignId: "foreign-memory" } }), "vector_search");
});

test("semantic runner rejects fixed-contract overrides and preserves deterministic clock provenance", async () => {
  for (const bad of [0, -1, 1.5, "1800000000", Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      runLocomoSemanticRetrievalDataset([], options({ benchmarkNowSec: bad })),
      /locomo_benchmark_now_sec_must_be_positive_safe_integer/,
    );
  }
  await assert.rejects(
    runLocomoSemanticRetrievalDataset([], { ...options(), searchNowSec: TEST_NOW_SEC }),
    /clock override is reserved:searchNowSec/,
  );
  await assert.rejects(
    runLocomoSemanticRetrievalDataset([], { ...options(), profile: "spoofed" }),
    /semantic profile override is reserved:profile/,
  );
  await assert.rejects(
    runLocomoSemanticRetrievalDataset([], {
      ...options(),
      profileProvenance: { search_now_sec: TEST_NOW_SEC - 1 },
    }),
    /reserved keys/,
  );
  await assert.rejects(
    runLocomoSemanticRetrievalDataset([], { ...options(), topK: 3 }),
    /top_k is fixed at 50/,
  );
  for (const [key, value] of [
    ["dialogProjectionVersion", "other"],
    ["includeSessionDatetime", false],
    ["blipCaptionPolicy", "other"],
    ["includeBlipCaption", false],
  ]) {
    await assert.rejects(
      runLocomoSemanticRetrievalDataset([], { ...options(), [key]: value }),
      /semantic profile override is reserved/,
    );
  }
  await assert.rejects(
    (() => {
      const missing = options();
      delete missing.benchmarkNowSec;
      return runLocomoSemanticRetrievalDataset([], missing);
    })(),
    /benchmark_now_sec is required/,
  );
});

test("semantic CLI requires one decimal fixed clock and runs a deterministic fake-provider smoke", async () => {
  for (const value of ["-1", "1.5", "1e3", "NaN", "Infinity", String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.throws(
      () => semanticCli.parseArgs(["--benchmark-now-sec", value]),
      /benchmark_now_sec_must_be_positive_safe_integer/,
    );
  }
  assert.throws(
    () => semanticCli.parseArgs(["--benchmark-now-sec", "1800000000", "--benchmark-now-sec", "1800000001"]),
    /duplicate_argument:--benchmark-now-sec/,
  );
  assert.throws(
    () => semanticCli.parseArgs(["--top-k", "3"]),
    /locomo_semantic_top_k_must_be_50/,
  );

  const root = mkdtempSync(join(tmpdir(), "memory-engine-locomo-semantic-cli-"));
  const inputPath = join(root, "fixture.json");
  const outputPath = join(root, "output.json");
  const input = `${JSON.stringify([rawCase()])}\n`;
  writeFileSync(inputPath, input, "utf8");
  const seen = [];
  try {
    const result = await semanticCli.runLocomoSemanticCli([
      "--input", inputPath,
      "--output", outputPath,
      "--top-k", "50",
      "--benchmark-now-sec", String(TEST_NOW_SEC),
    ], {
      repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
      embeddingProvider: fakeEmbedder(seen),
      runnerOptions: { vectorStoreFactory: fakeVectorStoreFactory([]) },
    });
    assert.equal(result.output.profile, LOCOMO_SEMANTIC_PROFILE);
    assert.equal(result.output.provenance.input_file, "fixture.json");
    assert.equal(result.output.provenance.input_sha256, createHash("sha256").update(input).digest("hex"));
    assert.equal(result.output.provenance.benchmark_now_sec, TEST_NOW_SEC);
    assert.equal(result.output.provenance.query_instruction, "none");
    assert.equal(result.output.summary.vector_attempted_count, 2);
    assert.equal(existsSync(outputPath), true);
    assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")).results, result.output.results);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("semantic CLI rejects missing clock, caller clock/provenance spoofing, and live artifact paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-locomo-semantic-cli-contract-"));
  const inputPath = join(root, "fixture.json");
  writeFileSync(inputPath, `${JSON.stringify([rawCase()])}\n`, "utf8");
  try {
    await assert.rejects(
      semanticCli.runLocomoSemanticCli(["--input", inputPath], {
        repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
        runDataset: async () => { throw new Error("runner_must_not_run"); },
      }),
      /locomo_semantic_benchmark_now_sec_required/,
    );
    await assert.rejects(
      semanticCli.runLocomoSemanticCli(["--input", inputPath, "--benchmark-now-sec", String(TEST_NOW_SEC)], {
        repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
        runnerOptions: { benchmarkNowSec: TEST_NOW_SEC },
        runDataset: async () => { throw new Error("runner_must_not_run"); },
      }),
      /locomo_semantic_cli_reserved_override:benchmarkNowSec/,
    );
    await assert.rejects(
      semanticCli.runLocomoSemanticCli([
        "--input", inputPath,
        "--benchmark-now-sec", String(TEST_NOW_SEC),
        "--output", join(process.env.HOME || "/home/lionsol", ".openclaw", "memory", "forbidden.json"),
      ], { repositoryProvenance: TEST_REPOSITORY_PROVENANCE }),
      /locomo_semantic_output_live_memory_path_rejected/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("official LoCoMo semantic v2 contract runs through production hybridSearch offline", async t => {
  const datasetPath = process.env.LOCOMO_DATASET_PATH;
  if (!datasetPath || !existsSync(datasetPath)) {
    t.skip("LOCOMO_DATASET_PATH is not set to an available pinned dataset");
    return;
  }

  const datasetBytes = readFileSync(datasetPath);
  const datasetSha256 = createHash("sha256").update(datasetBytes).digest("hex");
  assert.equal(datasetSha256, LOCOMO_DATASET_SHA256);
  const records = JSON.parse(datasetBytes.toString("utf8"));
  assert.ok(Array.isArray(records));

  const witness = officialInputWitness(records);
  const cache = officialFakeEmbeddingCache();
  const stores = [];
  const providerInputs = [];
  const embeddingProvider = async text => {
    const input = String(text);
    assert.equal(witness.allInputs.has(input), true, "only projected corpus text or exact questions may be embedded");
    providerInputs.push(input);
    return officialFakeEmbedding(input);
  };
  let output;
  try {
    output = await runLocomoSemanticRetrievalDataset(records, {
      benchmarkNowSec: 1_705_066_861,
      datasetSha256,
      repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
      embeddingBaseUrl: "https://fake.invalid/v1",
      embeddingProvider,
      embeddingCache: cache,
      vectorStoreFactory: officialFakeVectorStoreFactory(stores),
    });
  } catch (error) {
    error.message = `${error.message}; fake_vector_state=${JSON.stringify(stores.map(store => ({
      sampleId: store.sampleId,
      rows: store.rows.length,
      searches: store.vectorSearchCount,
      errors: store.errors,
    })))}`;
    throw error;
  }

  assert.equal(output.profile, LOCOMO_SEMANTIC_PROFILE);
  assert.equal(output.provenance.profile, LOCOMO_SEMANTIC_PROFILE);
  assert.equal(output.summary.cases, 1_986);
  assert.equal(output.summary.retrieval_cases, 1_978);
  assert.equal(output.summary.strict.scored_cases, 1_972);
  assert.equal(output.summary.strict.skipped_cases, 14);
  assert.equal(output.summary.sensitivity.scored_cases, 1_978);
  assert.equal(output.summary.sensitivity.skipped_cases, 8);
  assert.equal(output.summary.conversations, 10);
  assert.equal(output.summary.corpora_built, 10);
  assert.equal(output.summary.corpus_embedding_count, 5_882);
  assert.equal(output.summary.query_embedding_count, 1_978);
  assert.equal(output.summary.total_embedding_lookups, 7_860);
  assert.equal(output.summary.corpus_lancedb_row_count, 5_882);
  assert.equal(output.summary.vector_attempted_count, 1_978);
  assert.equal(output.summary.vector_skipped_count, 0);
  assert.equal(output.summary.vector_error_count, 0);
  assert.equal(output.summary.host_manager_fallback_count, 0);

  for (const scope of [output.provenance, output.run]) {
    assert.equal(scope.benchmark_now_sec, 1_705_066_861);
    assert.equal(scope.materialization_now_sec, 1_705_066_861);
    assert.equal(scope.search_now_sec, 1_705_066_861);
  }

  const scoreableResults = output.results.filter(result => result.sensitivity.scoreable);
  const skippedResults = output.results.filter(result => !result.sensitivity.scoreable);
  assert.equal(scoreableResults.length, 1_978);
  assert.equal(skippedResults.length, 8);
  for (const result of scoreableResults) {
    const diagnostics = result.diagnostics;
    assert.ok(diagnostics);
    assert.equal(diagnostics.vector_backend, "lancedb");
    assert.equal(diagnostics.vector_stage, "lancedb_search");
    assert.equal(diagnostics.vector_skipped, false);
    assert.equal(diagnostics.vector_in_fusion, true);
    assert.equal(diagnostics.channels.includes("vector"), true);
    assert.equal(diagnostics.search_now_sec, 1_705_066_861);
    assert.equal(diagnostics.query_embedding_count, 1);
    assert.equal(diagnostics.corpus_embedding_count, 0);
    assert.equal(diagnostics.vector_attempted_count, 1);
    assert.equal(diagnostics.vector_skipped_count, 0);
    assert.equal(diagnostics.vector_error_count, 0);
    assert.equal(diagnostics.host_manager_fallback_count, 0);
  }
  for (const result of skippedResults) {
    assert.equal(result.diagnostics, null);
    assert.deepEqual(result.retrieved_memory_ids, []);
    assert.deepEqual(result.retrieved_dialog_ids, []);
  }

  const expectedRowsByConversation = new Map(
    output.summary.corpus_lancedb_row_counts.map(row => [row.sample_id, row]),
  );
  assert.equal(expectedRowsByConversation.size, 10);
  assert.equal(stores.length, 10);
  for (const store of stores) {
    const expected = expectedRowsByConversation.get(store.sampleId);
    assert.ok(expected, `missing corpus row count for ${store.sampleId}`);
    assert.equal(store.rows.length, expected.dialog_count);
    assert.equal(store.rows.length, expected.lancedb_row_count);
    assert.equal(store.addCalls, 1);
    assert.equal(store.closed, true);
    assert.equal(store.closeCount, 1);
    assert.equal(store.vectorSearchCount, store.queryVectorDimensions.length);
    assert.equal(store.queryVectorDimensions.every(
      dimension => dimension === LOCOMO_SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
    ), true);
    assert.equal(store.rows.every(row => witness.corpusInputs.has(row.text)), true);
  }
  assert.equal(stores.reduce((sum, store) => sum + store.vectorSearchCount, 0), 1_978);

  assert.equal(output.provenance.provider_call_count + output.provenance.embedding_cache_hits, 7_860);
  assert.equal(providerInputs.length, output.provenance.provider_call_count);
  assert.equal(cache.operations.filter(operation => operation.operation === "get").length, 7_860);
  assert.equal(cache.closeCount, 0, "runner must not close an injected external cache");
  const cacheKeyFields = [
    "base_url_identity",
    "input_sha256",
    "model",
    "normalized_input_sha256",
    "projection_version",
    "provider",
  ];
  for (const operation of cache.operations) {
    assert.deepEqual(Object.keys(operation.key).sort(), [...cacheKeyFields].sort());
    assert.equal(Object.hasOwn(operation.key, "input"), false);
    assert.equal(Object.hasOwn(operation.key, "answer"), false);
    assert.equal(Object.hasOwn(operation.key, "evidence"), false);
    assert.equal(Object.hasOwn(operation.key, "category"), false);
    assert.equal(
      witness.corpusHashes.has(operation.key.input_sha256)
        || witness.queryHashes.has(operation.key.input_sha256),
      true,
    );
  }
});

test("semantic runtime binds fixed clock and forbids host manager fallback", () => {
  assert.throws(
    () => createLocomoSemanticHybridRuntime({}, {
      topK: 50,
      vectorTable: { search() {} },
      generateEmbedding: async () => new Array(LOCOMO_SEMANTIC_EXPECTED_EMBEDDING_DIMENSION).fill(0),
    }),
    /positive_safe_integer/,
  );
});
