import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import cli from "../bin/run-longmemeval-semantic-query-instruction-retrieval-v1.js";
import { hybridSearch } from "../lib/recall/hybrid-search.js";
import {
  buildEmbeddingCacheKey,
  createBenchmarkEmbeddingCache,
  LONGMEMEVAL_SEMANTIC_PROFILE,
  runLongMemEvalSemanticRetrievalCase,
  SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
} from "../lib/benchmark/longmemeval-semantic-retrieval-runner-v1.js";
import {
  formatSemanticQueryInstructionEmbeddingInput,
  LONGMEMEVAL_SEMANTIC_QUERY_INSTRUCTION_PROFILE,
  runLongMemEvalSemanticQueryInstructionRetrievalCase,
  SEMANTIC_DOCUMENT_INSTRUCTION,
  SEMANTIC_QUERY_FORMATTING_CONTRACT,
  SEMANTIC_QUERY_INSTRUCTION_SHA256,
  SEMANTIC_QUERY_INSTRUCTION_TEXT,
  SEMANTIC_QUERY_INSTRUCTION_VERSION,
  runLongMemEvalSemanticQueryInstructionRetrievalDataset,
} from "../lib/benchmark/longmemeval-semantic-query-instruction-retrieval-runner-v1.js";

const TEST_REPOSITORY_COMMIT = "a".repeat(40);
const TEST_REPOSITORY_PROVENANCE = {
  repository_commit: TEST_REPOSITORY_COMMIT,
  repository_worktree_clean: true,
  repository_provenance_source: "git",
};

function fixture(overrides = {}) {
  return {
    question_id: "rh1_q1",
    question_type: "single-session-user",
    question: "Where was the artifact stored?",
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
        { role: "user", content: "rh1-answer Kyoto", has_answer: true },
        { role: "assistant", content: "gold answer label stays evaluator-only" },
      ],
      [
        { role: "user", content: "rh1-other Osaka" },
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
  if (value.startsWith(SEMANTIC_QUERY_INSTRUCTION_TEXT) || value.includes("rh1-answer")) vector[0] = 1;
  else if (value.includes("rh1-other")) vector[1] = 1;
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
    const store = { path, rows, queryVectors: [], closed: false };
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
                    _distance: row.vector[0] === query[0] && query[0] === 1
                      ? 0.01
                      : row.vector[1] === query[1] && query[1] === 1
                        ? 0.02
                        : row.vector[2] === query[2] && query[2] === 1
                          ? 0.03
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
    return {
      table: store.table,
      close() {
        store.closed = true;
      },
    };
  };
}

function semanticOptions(overrides = {}) {
  const seen = overrides.seen || [];
  const stores = overrides.stores || [];
  return {
    topK: 3,
    benchmarkNowSec: 1_800_000_000,
    embeddingProvider: overrides.embeddingProvider || fakeEmbedder(seen, overrides.embedBehavior),
    vectorStoreFactory: overrides.vectorStoreFactory || fakeVectorStoreFactory({
      stores,
      behavior: overrides.storeBehavior,
    }),
    ...overrides,
    seen,
    stores,
  };
}

async function expectRh1Stage(record, options, stage) {
  await assert.rejects(
    runLongMemEvalSemanticQueryInstructionRetrievalCase(record, options),
    error => {
      assert.equal(error.stage, stage, error.stack);
      assert.equal(typeof error.details?.provider_call_count, "number");
      assert.equal(typeof error.details?.vector_fallback_called, "boolean");
      return true;
    },
  );
}

test("RH1 has an independent profile and an exact normalized query formatting contract", () => {
  const formatted = formatSemanticQueryInstructionEmbeddingInput("[Fri 2025/01/10 12:00 UTC] Where was the artifact stored?");
  assert.notEqual(LONGMEMEVAL_SEMANTIC_QUERY_INSTRUCTION_PROFILE, LONGMEMEVAL_SEMANTIC_PROFILE);
  assert.equal(
    formatted,
    `${SEMANTIC_QUERY_INSTRUCTION_TEXT}\nQuery:Where was the artifact stored`,
  );
  assert.equal(
    SEMANTIC_QUERY_INSTRUCTION_SHA256,
    createHash("sha256").update(SEMANTIC_QUERY_INSTRUCTION_TEXT).digest("hex"),
  );
  assert.equal(SEMANTIC_QUERY_INSTRUCTION_VERSION, "query_embedding_instruction_v1");
  assert.equal(SEMANTIC_DOCUMENT_INSTRUCTION, "none");
  assert.equal(
    SEMANTIC_QUERY_FORMATTING_CONTRACT,
    "query_embedding_input = query_instruction_text + LF + \"Query:\" + normalizeFtsQuery(query); no trailing LF",
  );
});

test("RH1 instructs only the vector query, preserves corpus/lexical input, and enters production fusion", async () => {
  const record = fixture();
  const seen = [];
  const stores = [];
  let lexicalQuery = null;
  let normalizedLexicalQuery = null;
  const result = await runLongMemEvalSemanticQueryInstructionRetrievalCase(record, semanticOptions({
    seen,
    stores,
    hybridSearchFn: async (query, options, runtime) => {
      lexicalQuery = query;
      const search = await hybridSearch(query, options, runtime);
      normalizedLexicalQuery = search.debug.query_normalized;
      return search;
    },
  }));

  assert.equal(lexicalQuery, record.question);
  assert.equal(normalizedLexicalQuery, "Where was the artifact stored");
  assert.equal(seen.filter(value => value.startsWith(SEMANTIC_QUERY_INSTRUCTION_TEXT)).length, 1);
  assert.equal(seen.filter(value => !value.startsWith(SEMANTIC_QUERY_INSTRUCTION_TEXT)).length, 3);
  assert.equal(seen.every(value => !value.includes("answer_session_ids")), true);
  assert.equal(result.profile, LONGMEMEVAL_SEMANTIC_QUERY_INSTRUCTION_PROFILE);
  assert.equal(result.retrieved_session_ids[0], "s-answer");
  assert.equal(result.diagnostics.vector_backend, "lancedb");
  assert.equal(result.diagnostics.vector_stage, "lancedb_search");
  assert.equal(result.diagnostics.vector_in_fusion, true);
  assert.equal(result.diagnostics.vector_skipped, false);
  assert.equal(result.provenance.query_instruction_version, SEMANTIC_QUERY_INSTRUCTION_VERSION);
  assert.equal(result.provenance.query_instruction_text, SEMANTIC_QUERY_INSTRUCTION_TEXT);
  assert.equal(result.provenance.query_instruction_sha256, SEMANTIC_QUERY_INSTRUCTION_SHA256);
  assert.equal(result.provenance.query_formatting_contract, SEMANTIC_QUERY_FORMATTING_CONTRACT);
  assert.equal(result.provenance.document_instruction, "none");
  assert.equal(result.provenance.query_embedding_input, undefined);
  assert.equal(stores[0].rows.every(row => !Object.hasOwn(row, "embedding_input")), true);
});

test("B4 default profile remains unchanged while its corpus cache entries hit directly from RH1", async () => {
  const cache = createBenchmarkEmbeddingCache();
  const seen = [];
  const record = fixture();
  try {
    const b4 = await runLongMemEvalSemanticRetrievalCase(record, semanticOptions({
      embeddingCache: cache,
      seen,
    }));
    assert.equal(b4.profile, LONGMEMEVAL_SEMANTIC_PROFILE);
    assert.equal(Object.hasOwn(b4.provenance, "query_instruction_version"), false);
    assert.equal(seen.some(value => value.startsWith(SEMANTIC_QUERY_INSTRUCTION_TEXT)), false);

    const rh1 = await runLongMemEvalSemanticQueryInstructionRetrievalCase(record, semanticOptions({
      embeddingCache: cache,
      seen,
    }));
    assert.equal(rh1.provenance.corpus_embedding_count, 3);
    assert.equal(rh1.provenance.embedding_cache_hits, 3);
    assert.equal(rh1.provenance.provider_call_count, 1);
    assert.equal(seen.filter(value => value.startsWith(SEMANTIC_QUERY_INSTRUCTION_TEXT)).length, 1);

    const expectedQueryKey = buildEmbeddingCacheKey({
      input: formatSemanticQueryInstructionEmbeddingInput(record.question),
    });
    const snapshot = cache.snapshot();
    assert.equal(snapshot.entries[JSON.stringify(expectedQueryKey)].provenance.input_sha256, expectedQueryKey.input_sha256);
    assert.equal(JSON.stringify(snapshot).includes(record.question), false);
    assert.equal(JSON.stringify(snapshot).includes("answer_session_ids"), false);
    assert.equal(cache.get(expectedQueryKey).length, SEMANTIC_EXPECTED_EMBEDDING_DIMENSION);
  } finally {
    cache.close();
  }
});

test("RH1 keeps 2560-dimensional embedding validation and fail-closed error stages", async () => {
  await expectRh1Stage(
    fixture(),
    semanticOptions({ embedBehavior: { dimension: 3 } }),
    "corpus_embedding_dimension",
  );

  await expectRh1Stage(
    fixture(),
    semanticOptions({
      embeddingProvider: fakeEmbedder([], {
        error: value => value.startsWith(SEMANTIC_QUERY_INSTRUCTION_TEXT) ? "query provider failure" : null,
      }),
    }),
    "query_embedding",
  );

  await expectRh1Stage(
    fixture(),
    semanticOptions({
      embeddingProvider: async text => text.startsWith(SEMANTIC_QUERY_INSTRUCTION_TEXT)
        ? new Array(7).fill(0)
        : vectorFor(text),
    }),
    "query_embedding_dimension",
  );

  const stores = [];
  await assert.rejects(
    runLongMemEvalSemanticQueryInstructionRetrievalCase(fixture(), semanticOptions({
      stores,
      storeBehavior: { searchError: "vector search failure" },
    })),
    error => {
      assert.equal(error.stage, "vector_search");
      assert.equal(error.details.vector_fallback_called, true);
      return true;
    },
  );
});

test("RH1 preserves isolated vector ownership, duplicate occurrences, and official exclusions", async () => {
  const stores = [];
  const duplicate = await runLongMemEvalSemanticQueryInstructionRetrievalCase(fixture({
    haystack_session_ids: ["s-noise", "s-answer", "s-noise"],
  }), semanticOptions({ stores }));
  assert.equal(stores.length, 1);
  assert.equal(stores[0].path.includes("semantic-vector"), true);
  assert.equal(stores[0].closed, true);
  assert.equal(duplicate.corpus_sessions, 3);
  assert.equal(duplicate.retrieved_session_ids.filter(id => id === "s-noise").length, 2);

  const abstention = await runLongMemEvalSemanticQueryInstructionRetrievalCase(fixture({
    question_id: "rh1_abs",
    answer_session_ids: [],
  }), semanticOptions());
  assert.equal(abstention.skipped, true);
  assert.equal(abstention.skip_reason, "official_retrieval_abstention");
  assert.equal(abstention.provenance.vector_attempted_count, 0);

  const noTarget = await runLongMemEvalSemanticQueryInstructionRetrievalCase(fixture({
    question_id: "rh1_no_target",
    answer_session_ids: ["s-answer"],
    haystack_sessions: fixture().haystack_sessions.map(session => session.map(turn => ({
      role: turn.role,
      content: turn.content,
    }))),
  }), semanticOptions());
  assert.equal(noTarget.skipped, true);
  assert.equal(noTarget.skip_reason, "official_retrieval_no_user_target");
});

test("RH1 dataset and CLI expose only the explicit profile with deterministic injected seams", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-rh1-cli-"));
  const inputPath = join(root, "input.json");
  const cachePath = join(root, "cache.sqlite");
  const content = `${JSON.stringify([fixture()], null, 2)}\n`;
  writeFileSync(inputPath, content, "utf8");
  try {
    const output = await cli.runLongMemEvalSemanticQueryInstructionCli([
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
    assert.equal(output.printable.run.profile, LONGMEMEVAL_SEMANTIC_QUERY_INSTRUCTION_PROFILE);
    assert.equal(output.printable.summary.profile, LONGMEMEVAL_SEMANTIC_QUERY_INSTRUCTION_PROFILE);
    assert.equal(output.printable.provenance.profile, LONGMEMEVAL_SEMANTIC_QUERY_INSTRUCTION_PROFILE);
    assert.equal(output.printable.provenance.query_instruction_sha256, SEMANTIC_QUERY_INSTRUCTION_SHA256);
    assert.equal(output.printable.provenance.repository_commit, TEST_REPOSITORY_COMMIT);
    assert.equal(output.printable.provenance.repository_worktree_clean, true);
    assert.equal(output.printable.provenance.repository_provenance_source, "git");
    const database = new Database(cachePath, { readonly: true });
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM embedding_cache_entries").get().count, 4);
    database.close();

    const help = await cli.runLongMemEvalSemanticQueryInstructionCli(["--help"]);
    assert.equal(help.usage.includes(LONGMEMEVAL_SEMANTIC_QUERY_INSTRUCTION_PROFILE), true);
    assert.equal(help.usage.includes("B4 profile"), false);
    assert.equal(help.usage.includes("SQLite"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RH1 CLI binds injected exact git provenance, rejects dirty state, and does not invoke real git in tests", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-rh1-provenance-"));
  const inputPath = join(root, "input.json");
  writeFileSync(inputPath, "[]\n", "utf8");
  const calls = [];
  try {
    const result = await cli.runLongMemEvalSemanticQueryInstructionCli(["--input", inputPath], {
      repositoryProvenance: () => TEST_REPOSITORY_PROVENANCE,
      execFileSync: () => { throw new Error("real git must not be called"); },
      runDataset: async (records, options) => {
        calls.push({ records, options });
        return {
          provenance: {
            profile: LONGMEMEVAL_SEMANTIC_QUERY_INSTRUCTION_PROFILE,
            repository_commit: options.repositoryCommit,
            repository_worktree_clean: options.repositoryWorktreeClean,
            repository_provenance_source: options.repositoryProvenanceSource,
          },
          run: { profile: LONGMEMEVAL_SEMANTIC_QUERY_INSTRUCTION_PROFILE },
          summary: { profile: LONGMEMEVAL_SEMANTIC_QUERY_INSTRUCTION_PROFILE },
        };
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.repositoryCommit, TEST_REPOSITORY_COMMIT);
    assert.equal(result.output.provenance.repository_commit, TEST_REPOSITORY_COMMIT);
    assert.equal(result.output.provenance.repository_worktree_clean, true);
    assert.equal(result.output.provenance.repository_provenance_source, "git");

    await assert.rejects(
      cli.runLongMemEvalSemanticQueryInstructionCli(["--input", inputPath], {
        repositoryProvenance: {
          ...TEST_REPOSITORY_PROVENANCE,
          repository_worktree_clean: false,
        },
        runDataset: async () => { throw new Error("runner must not be called"); },
      }),
      error => error.code === "semantic_cli_repository_provenance_dirty_worktree",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("RH1 dataset preserves profile provenance on skipped cases without embedding gold fields", async () => {
  const output = await runLongMemEvalSemanticQueryInstructionRetrievalDataset([
    fixture({ question_id: "rh1_abs", answer_session_ids: [] }),
  ], {
    embeddingProvider: fakeEmbedder(),
    vectorStoreFactory: fakeVectorStoreFactory(),
  });
  assert.equal(output.profile, LONGMEMEVAL_SEMANTIC_QUERY_INSTRUCTION_PROFILE);
  assert.equal(output.results[0].skipped, true);
  assert.equal(output.results[0].provenance.query_instruction_text, SEMANTIC_QUERY_INSTRUCTION_TEXT);
  assert.equal(JSON.stringify(output).includes("answer_session_ids"), false);
});

test("RH1 source keeps the shared semantic runner and query formatter out of the corpus path", () => {
  const source = readFileSync(
    new URL("../lib/benchmark/longmemeval-semantic-query-instruction-retrieval-runner-v1.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /runLongMemEvalSemanticRetrievalDataset/);
  assert.match(source, /formatSemanticQueryInstructionEmbeddingInput/);
  assert.doesNotMatch(source, /projectCanonicalMemoryToVectorProjection/);
  assert.doesNotMatch(source, /materializeSemanticCorpus/);
});
