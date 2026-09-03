import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  LOCOMO_BLIP_CAPTION_POLICY,
  LOCOMO_DIALOG_PROJECTION_VERSION,
  LOCOMO_HOST_MANAGER_MODE,
  LOCOMO_INCLUDE_SESSION_DATETIME,
  LOCOMO_LEXICAL_RETRIEVAL_PROFILE,
  LOCOMO_RETRIEVAL_RUNNER_SCHEMA,
  LOCOMO_VECTOR_MODE,
  createLocomoProductionHybridRuntime,
  materializeLocomoConversationDataPlane,
  runLocomoLexicalRetrievalDataset,
} from "../lib/benchmark/locomo-retrieval-runner-v1.js";
import {
  LOCOMO_EVIDENCE_CANONICALIZED_V1,
  LOCOMO_EVIDENCE_STRICT_V1,
  validateLocomoDataset,
} from "../lib/benchmark/locomo-v1.js";
import {
  LOCOMO_BENCHMARK_CLOCK_CONTRACT,
  LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE,
  LOCOMO_TIME_FROZEN_RETRIEVAL_RUNNER_SCHEMA,
  LOCOMO_TIME_FROZEN_SEMANTIC_RETRIEVAL_PROFILE,
  runLocomoTimeFrozenLexicalRetrievalDataset,
} from "../lib/benchmark/locomo-time-frozen-retrieval-runner-v2.js";
import { resolveSearchNowSec, validateSearchNowSec, hybridSearch } from "../lib/recall/hybrid-search.js";
import { fuseChannels, scoreCandidate } from "../lib/recall/hybrid/fusion.js";

const require = createRequire(import.meta.url);
const timeFrozenCli = require("../bin/run-locomo-time-frozen-retrieval-v2.js");

const TEST_REPOSITORY_PROVENANCE = {
  repository_commit: "0".repeat(40),
  repository_worktree_clean: true,
  repository_provenance_source: "git",
};
const TEST_BENCHMARK_NOW_SEC = 1_800_000_000;

function rawCase({ sampleId = "conv-test", questions = null } = {}) {
  return {
    sample_id: sampleId,
    conversation: {
      speaker_a: "Alice",
      speaker_b: "Bob",
      session_1_date_time: "1:00 pm on 1 May, 2023",
      session_1: [
        { speaker: "Alice", dia_id: "D1:1", text: "Alice visited Kyoto." },
        { speaker: "Bob", dia_id: "D1:2", text: "They discussed Osaka." },
      ],
      session_2_date_time: "2:00 pm on 2 May, 2023",
      session_2: [
        { speaker: "Alice", dia_id: "D2:1", text: "Alice returned later." },
      ],
    },
    qa: questions || [
      { question: "Where did Alice visit?", answer: "GOLD", evidence: ["D1:1"], category: 4 },
      { question: "What did they discuss?", answer: "GOLD", evidence: ["D1:2"], category: 4 },
    ],
  };
}

function fakeRunnerDependencies({ mismatchSearchClock = null, mismatchMaterializationClock = null } = {}) {
  const materializationClocks = [];
  const runtimeClocks = [];
  const searches = [];
  const planes = [];
  return {
    materializationClocks,
    runtimeClocks,
    searches,
    planes,
    materialize(record, options) {
      materializationClocks.push(options.benchmarkNowSec);
      const benchmarkNowSec = mismatchMaterializationClock ?? options.benchmarkNowSec;
      const plane = {
        sample_id: record.sample_id,
        benchmarkNowSec,
        memoryToDialog: new Map([[
          "m1",
          { sample_id: record.sample_id, dia_id: "D1:1", session_id: "session_1" },
        ]]),
        close() {
          this.closed = true;
        },
        closed: false,
      };
      planes.push(plane);
      return plane;
    },
    createRuntime(plane, options) {
      const runtime = { plane };
      runtimeClocks.push(options.searchNowSec);
      return { runtime, close() {} };
    },
    async search(query, options, runtime) {
      searches.push({ query, options, runtime });
      const searchNowSec = mismatchSearchClock ?? runtime.searchNowSec;
      return {
        results: [{ memory_id: "m1" }],
        channels: ["fts"],
        channel_sizes: { fts: 1 },
        debug: {
          search_now_sec: searchNowSec,
          lexical_confidence: 0.2,
          vector_skipped: true,
          vector_skip_reason: "lexical_confidence_threshold_met",
          vector_backend: "skipped",
          vector_stage: "skipped",
        },
      };
    },
  };
}

function mockHybridRuntime(options = {}) {
  const { searchNowSec } = options;
  const realtimeClocks = [];
  const withDb = fn => fn({
    prepare(sql) {
      const query = String(sql);
      return {
        all(...args) {
          if (query.includes("SELECT chunk_id") && query.includes("FROM memory_confidence")) {
            return [{
              chunk_id: "chunk-1234567890abcdef",
              confidence: 0.9,
              last_confidence_update: 0,
              base_tau: 7,
              hit_count: 3,
              is_protected: 0,
              conflict_flag: 0,
              category: "episodic",
              is_archived: 0,
            }];
          }
          if (query.includes("SELECT id, path, updated_at FROM chunks")) {
            return [{
              id: "chunk-1234567890abcdef",
              path: "memory/episodes/session-checkpoint.md",
              updated_at: 1710000000,
            }];
          }
          if (query.includes("FROM memory_confidence mc") && query.includes("mc.kg_data LIKE")) {
            return [];
          }
          if (query.includes("FROM chunks_fts f")) {
            const ftsQuery = String(args[0] || "");
            if (ftsQuery.includes(" OR ")) return [];
            return [{
              id: "chunk-1234567890abcdef",
              text: "session checkpoint project note",
              path: "memory/episodes/session-checkpoint.md",
              updated_at: 1710000000,
              confidence: 0.9,
              last_confidence_update: 0,
              base_tau: 7,
              hit_count: 3,
              is_protected: 0,
              conflict_flag: 0,
              category: "episodic",
              is_archived: 0,
            }];
          }
          return [];
        },
      };
    },
  });
  const runtime = {
    cfg: {
      memory: { backend: "sqlite" },
      autoRecall: { lexicalConfidenceThreshold: 0.65 },
    },
    withHybridDbAccessScope: async run => run({
      withCoreDb: withDb,
      withEngineDb: withDb,
      capabilities: {
        isolatedFts: true,
        isolatedKg: true,
        isolatedRecent: true,
      },
    }),
    calcRealtimeConf: (row, now) => {
      realtimeClocks.push(now);
      return row.confidence;
    },
    getMemorySearchManager: async () => ({
      manager: { search: async () => ({ entries: [] }) },
    }),
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
  };
  if (Object.hasOwn(options, "searchNowSec")) runtime.searchNowSec = searchNowSec;
  return { runtime, realtimeClocks };
}

test("search clock resolver preserves wall-clock default and validates an exact fixed integer", () => {
  let nowCalls = 0;
  assert.equal(
    resolveSearchNowSec(undefined, () => {
      nowCalls += 1;
      return 1_800_000_123_456;
    }),
    1_800_000_123,
  );
  assert.equal(nowCalls, 1);
  assert.equal(resolveSearchNowSec(TEST_BENCHMARK_NOW_SEC, () => {
    nowCalls += 1;
    return 0;
  }), TEST_BENCHMARK_NOW_SEC);
  assert.equal(nowCalls, 1);
  assert.equal(validateSearchNowSec(TEST_BENCHMARK_NOW_SEC), TEST_BENCHMARK_NOW_SEC);
  for (const value of [0, -1, 1.5, "1800000000", Number.NaN, Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1, null, undefined]) {
    assert.throws(
      () => validateSearchNowSec(value),
      /hybrid_search_now_sec_must_be_positive_safe_integer/,
    );
  }
});

test("hybridSearch uses absent wall clock and present exact clock without changing latency timing", async () => {
  const originalDateNow = Date.now;
  Date.now = () => 1_700_000_123_456;
  try {
    const absent = mockHybridRuntime();
    const absentResult = await hybridSearch("session checkpoint project", { topK: 3 }, absent.runtime);
    assert.equal(absentResult.debug.search_now_sec, undefined);
    assert.deepEqual(absent.realtimeClocks, [1_700_000_123]);

    const fixed = mockHybridRuntime({ searchNowSec: TEST_BENCHMARK_NOW_SEC });
    const fixedResult = await hybridSearch("session checkpoint project", { topK: 3 }, fixed.runtime);
    assert.equal(fixedResult.debug.search_now_sec, TEST_BENCHMARK_NOW_SEC);
    assert.deepEqual(fixed.realtimeClocks, [TEST_BENCHMARK_NOW_SEC]);
    assert.equal(typeof fixedResult.debug.vector_ms, "number");
  } finally {
    Date.now = originalDateNow;
  }
});

test("hybridSearch rejects every invalid present clock before entering the database path", async () => {
  for (const value of [0, -1, 1.5, "1800000000", Number.NaN, Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1, null, undefined]) {
    const runtime = mockHybridRuntime({ searchNowSec: value }).runtime;
    await assert.rejects(
      () => hybridSearch("query", { topK: 1 }, runtime),
      /hybrid_search_now_sec_must_be_positive_safe_integer/,
    );
  }
});

test("production benchmark adapter passes the optional fixed clock into hybridSearch", async () => {
  const plane = materializeLocomoConversationDataPlane(rawCase({
    questions: [{ question: "Where did Alice visit?", answer: "GOLD", evidence: ["D1:1"], category: 4 }],
  }), { benchmarkNowSec: TEST_BENCHMARK_NOW_SEC });
  const adapter = createLocomoProductionHybridRuntime(plane, {
    topK: 3,
    searchNowSec: TEST_BENCHMARK_NOW_SEC,
  });
  try {
    assert.equal(adapter.runtime.searchNowSec, TEST_BENCHMARK_NOW_SEC);
    const result = await hybridSearch("Where did Alice visit?", { topK: 3 }, adapter.runtime);
    assert.equal(result.debug.search_now_sec, TEST_BENCHMARK_NOW_SEC);
    assert.equal(result.debug.vector_skipped, true);
    assert.equal(adapter.vector_mode, LOCOMO_VECTOR_MODE);
    assert.equal(adapter.host_manager_mode, LOCOMO_HOST_MANAGER_MODE);
  } finally {
    adapter.close();
    plane.close();
  }
});

test("synthetic recency rows show clock-sensitive final ordering and preserve the fusion formula", () => {
  const rankingConfig = {
    recencyBoost: { base: 0.06, decayDays: 2.5 },
    confidenceWeight: 0.1,
  };
  const firstClock = 1_000_000;
  const channels = {
    fts: [
      {
        id: "older-but-stronger",
        text: "older",
        semantic_score: 0.34,
        created_at: firstClock - 10 * 86400,
        confidence_mode: "external",
        category: "external",
      },
      {
        id: "newer-but-weaker",
        text: "newer",
        semantic_score: 0.30,
        created_at: firstClock,
        confidence_mode: "external",
        category: "external",
      },
    ],
  };
  const atFirstClock = fuseChannels(channels, {
    rrfK: 60,
    nowSec: firstClock,
    rankingConfig,
  }).fused;
  const atLaterClock = fuseChannels(channels, {
    rrfK: 60,
    nowSec: firstClock + 100 * 86400,
    rankingConfig,
  }).fused;
  const order = fused => [...fused].sort((left, right) => right.finalScore - left.finalScore).map(item => item.id);
  assert.deepEqual(order(atFirstClock), ["newer-but-weaker", "older-but-stronger"]);
  assert.deepEqual(order(atLaterClock), ["older-but-stronger", "newer-but-weaker"]);
  const repeat = fuseChannels(channels, {
    rrfK: 60,
    nowSec: firstClock,
    rankingConfig,
  }).fused;
  assert.deepEqual(
    repeat.map(item => ({ id: item.id, finalScore: item.finalScore, recencyBoost: item.recencyBoost })),
    atFirstClock.map(item => ({ id: item.id, finalScore: item.finalScore, recencyBoost: item.recencyBoost })),
  );
  for (const item of atFirstClock) assert.equal(item.finalScore, scoreCandidate(item));
});

test("v1 runner and profile remain unchanged and do not pass a search clock", async () => {
  const seenClocks = [];
  const output = await runLocomoLexicalRetrievalDataset([rawCase({
    questions: [{ question: "Where?", answer: "GOLD", evidence: ["D1:1"], category: 4 }],
  })], {
    topK: 1,
    benchmarkNowSec: TEST_BENCHMARK_NOW_SEC,
    repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
    materialize(record, options) {
      return {
        sample_id: record.sample_id,
        benchmarkNowSec: options.benchmarkNowSec,
        memoryToDialog: new Map(),
        close() {},
      };
    },
    createRuntime() {
      return { runtime: {}, close() {} };
    },
    async search(_query, _options, runtime) {
      seenClocks.push(runtime.searchNowSec);
      return { results: [], debug: {}, channels: [], channel_sizes: {} };
    },
  });
  assert.deepEqual(seenClocks, [undefined]);
  assert.equal(output.schema, LOCOMO_RETRIEVAL_RUNNER_SCHEMA);
  assert.equal(output.profile, LOCOMO_LEXICAL_RETRIEVAL_PROFILE);
  assert.equal(Object.hasOwn(output.provenance, "materialization_now_sec"), false);
  assert.equal(Object.hasOwn(output.provenance, "search_now_sec"), false);
  assert.equal(Object.hasOwn(output.run, "benchmark_clock_contract"), false);
});

test("v2 uses one benchmark/materialization/search clock for every conversation and QA", async () => {
  const deps = fakeRunnerDependencies();
  const records = [
    rawCase({ sampleId: "conv-a" }),
    rawCase({ sampleId: "conv-b" }),
  ];
  const output = await runLocomoTimeFrozenLexicalRetrievalDataset(records, {
    topK: 3,
    benchmarkNowSec: TEST_BENCHMARK_NOW_SEC,
    repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
    ...deps,
  });

  assert.equal(output.schema, LOCOMO_TIME_FROZEN_RETRIEVAL_RUNNER_SCHEMA);
  assert.equal(output.profile, LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE);
  assert.equal(output.summary.schema, LOCOMO_TIME_FROZEN_RETRIEVAL_RUNNER_SCHEMA);
  assert.equal(output.summary.profile, LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE);
  assert.equal(output.summary.conversations, 2);
  assert.equal(output.summary.retrieval_cases, 4);
  assert.deepEqual(deps.materializationClocks, Array(2).fill(TEST_BENCHMARK_NOW_SEC));
  assert.deepEqual(deps.runtimeClocks, Array(2).fill(TEST_BENCHMARK_NOW_SEC));
  assert.equal(deps.searches.length, 4);
  assert.equal(deps.searches.every(entry => entry.runtime.searchNowSec === TEST_BENCHMARK_NOW_SEC), true);
  assert.equal(deps.searches.every(entry => !entry.query.includes("GOLD")), true);
  assert.equal(deps.searches[0].runtime, deps.searches[1].runtime);
  assert.equal(deps.searches[2].runtime, deps.searches[3].runtime);
  assert.equal(new Set(deps.searches.map(entry => entry.runtime)).size, 2);
  assert.equal(deps.planes.every(plane => plane.closed), true);

  const required = [
    "profile",
    "benchmark_now_sec",
    "materialization_now_sec",
    "search_now_sec",
    "benchmark_clock_contract",
    "repository_commit",
    "repository_worktree_clean",
    "repository_provenance_source",
    "dataset_sha256",
    "upstream_commit",
    "dataset_file_commit",
    "top_k",
    "dialog_projection_version",
    "include_session_datetime",
    "blip_caption_policy",
    "vector_mode",
    "host_manager_mode",
    "lexical_confidence_threshold",
  ];
  for (const key of required) {
    assert.equal(Object.hasOwn(output.provenance, key), true, `missing provenance.${key}`);
    assert.equal(Object.hasOwn(output.run, key), true, `missing run.${key}`);
  }
  assert.equal(output.provenance.profile, LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE);
  assert.equal(output.provenance.benchmark_now_sec, TEST_BENCHMARK_NOW_SEC);
  assert.equal(output.provenance.materialization_now_sec, TEST_BENCHMARK_NOW_SEC);
  assert.equal(output.provenance.search_now_sec, TEST_BENCHMARK_NOW_SEC);
  assert.equal(output.provenance.benchmark_clock_contract, LOCOMO_BENCHMARK_CLOCK_CONTRACT);
  assert.equal(output.provenance.top_k, 3);
  assert.equal(output.provenance.dialog_projection_version, LOCOMO_DIALOG_PROJECTION_VERSION);
  assert.equal(output.provenance.include_session_datetime, LOCOMO_INCLUDE_SESSION_DATETIME);
  assert.equal(output.provenance.blip_caption_policy, LOCOMO_BLIP_CAPTION_POLICY);
  assert.equal(output.provenance.vector_mode, LOCOMO_VECTOR_MODE);
  assert.equal(output.provenance.host_manager_mode, LOCOMO_HOST_MANAGER_MODE);
  assert.equal(output.provenance.lexical_confidence_threshold, 0);
  assert.equal(output.results.every(result => result.diagnostics.search_now_sec === TEST_BENCHMARK_NOW_SEC), true);
});

test("v2 default runner uses the production hybrid adapter with the fixed search clock", async () => {
  const output = await runLocomoTimeFrozenLexicalRetrievalDataset([rawCase({
    questions: [{ question: "Where did Alice visit?", answer: "GOLD", evidence: ["D1:1"], category: 4 }],
  })], {
    topK: 3,
    benchmarkNowSec: TEST_BENCHMARK_NOW_SEC,
    repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
  });
  assert.equal(output.summary.conversations, 1);
  assert.equal(output.summary.retrieval_cases, 1);
  assert.equal(output.provenance.vector_mode, LOCOMO_VECTOR_MODE);
  assert.equal(output.provenance.host_manager_mode, LOCOMO_HOST_MANAGER_MODE);
  assert.equal(output.results[0].diagnostics.search_now_sec, TEST_BENCHMARK_NOW_SEC);
  assert.equal(output.results[0].diagnostics.vector_skipped, true);
});

test("v2 fixed-clock results are repeatable and clock mismatches fail closed", async () => {
  const makeOutput = () => {
    const deps = fakeRunnerDependencies();
    return runLocomoTimeFrozenLexicalRetrievalDataset([rawCase()], {
      benchmarkNowSec: TEST_BENCHMARK_NOW_SEC,
      repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
      ...deps,
    });
  };
  const [first, second] = await Promise.all([makeOutput(), makeOutput()]);
  const stable = output => output.results.map(result => ({
    question_id: result.question_id,
    retrieved_memory_ids: result.retrieved_memory_ids,
    retrieved_dialog_ids: result.retrieved_dialog_ids,
    diagnostics: result.diagnostics,
  }));
  assert.deepEqual(stable(first), stable(second));

  await assert.rejects(
    () => runLocomoTimeFrozenLexicalRetrievalDataset([rawCase()], {
      benchmarkNowSec: TEST_BENCHMARK_NOW_SEC,
      searchNowSec: TEST_BENCHMARK_NOW_SEC - 1,
      repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
    }),
    /locomo_v2_clock_override:searchNowSec/,
  );
  await assert.rejects(
    () => runLocomoTimeFrozenLexicalRetrievalDataset([rawCase()], {
      benchmarkNowSec: TEST_BENCHMARK_NOW_SEC,
      materializationNowSec: TEST_BENCHMARK_NOW_SEC - 1,
      repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
    }),
    /locomo_v2_clock_override:materializationNowSec/,
  );
  await assert.rejects(
    () => runLocomoTimeFrozenLexicalRetrievalDataset([], {
      benchmarkNowSec: TEST_BENCHMARK_NOW_SEC,
      repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
      profileProvenance: { search_now_sec: TEST_BENCHMARK_NOW_SEC - 1 },
    }),
    /locomo_provenance_reserved:search_now_sec/,
  );
  for (const value of [0, -1, 1.5, "1800000000", Number.NaN, Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      () => runLocomoTimeFrozenLexicalRetrievalDataset([], {
        benchmarkNowSec: value,
        repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
      }),
      /locomo_benchmark_now_sec_must_be_positive_safe_integer/,
    );
  }
  await assert.rejects(
    () => runLocomoTimeFrozenLexicalRetrievalDataset([], {
      repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
    }),
    /locomo_v2_benchmark_now_sec_required/,
  );
});

test("v2 rejects runtime/materialization/search diagnostic clock mismatches", async () => {
  const materializationMismatch = fakeRunnerDependencies({
    mismatchMaterializationClock: TEST_BENCHMARK_NOW_SEC - 1,
  });
  await assert.rejects(
    () => runLocomoTimeFrozenLexicalRetrievalDataset([rawCase()], {
      benchmarkNowSec: TEST_BENCHMARK_NOW_SEC,
      repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
      ...materializationMismatch,
    }),
    /locomo_v2_materialization_clock_mismatch/,
  );
  const searchMismatch = fakeRunnerDependencies({
    mismatchSearchClock: TEST_BENCHMARK_NOW_SEC - 1,
  });
  await assert.rejects(
    () => runLocomoTimeFrozenLexicalRetrievalDataset([rawCase()], {
      benchmarkNowSec: TEST_BENCHMARK_NOW_SEC,
      repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
      ...searchMismatch,
    }),
    /locomo_v2_search_clock_mismatch/,
  );
  await assert.rejects(
    () => runLocomoTimeFrozenLexicalRetrievalDataset([rawCase()], {
      benchmarkNowSec: TEST_BENCHMARK_NOW_SEC,
      repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
      createRuntime() {
        return { runtime: { searchNowSec: TEST_BENCHMARK_NOW_SEC - 1 }, close() {} };
      },
    }),
    /locomo_v2_search_clock_override/,
  );
});

test("v2 remains a lexical-only profile and leaves the semantic identity pending", () => {
  assert.equal(LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE, "production_hybrid_lexical_dialog_locomo_time_frozen_v2");
  assert.equal(LOCOMO_TIME_FROZEN_SEMANTIC_RETRIEVAL_PROFILE, "production_hybrid_semantic_dialog_locomo_time_frozen_v2");
  assert.notEqual(LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE, LOCOMO_TIME_FROZEN_SEMANTIC_RETRIEVAL_PROFILE);
  assert.equal(LOCOMO_LEXICAL_RETRIEVAL_PROFILE, "production_hybrid_lexical_dialog_locomo_v1");
  assert.equal(LOCOMO_EVIDENCE_STRICT_V1, "locomo_evidence_strict_v1");
  assert.equal(LOCOMO_EVIDENCE_CANONICALIZED_V1, "locomo_evidence_canonicalized_v1");
  assert.equal(LOCOMO_VECTOR_MODE, "disabled_empty_backend");
  assert.equal(LOCOMO_HOST_MANAGER_MODE, "disabled");
  assert.equal(LOCOMO_TIME_FROZEN_RETRIEVAL_RUNNER_SCHEMA, "memory_engine_locomo_lexical_retrieval_time_frozen_v2");
});

test("v2 CLI requires one decimal fixed clock and runs a deterministic fake-runtime smoke", async () => {
  for (const value of ["-1", "1.5", "1e3", "NaN", "Infinity", String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.throws(
      () => timeFrozenCli.parseArgs(["--benchmark-now-sec", value]),
      /benchmark_now_sec_must_be_positive_safe_integer/,
    );
  }
  assert.throws(
    () => timeFrozenCli.parseArgs(["--benchmark-now-sec", "1800000000", "--benchmark-now-sec", "1800000001"]),
    /duplicate_argument:--benchmark-now-sec/,
  );

  const root = mkdtempSync(join(tmpdir(), "memory-engine-locomo-time-frozen-cli-"));
  const input = join(root, "fixture.json");
  const outputPath = join(root, "output.json");
  writeFileSync(input, JSON.stringify([rawCase()]));
  const deps = fakeRunnerDependencies();
  const originalDateNow = Date.now;
  Date.now = () => {
    throw new Error("wall_clock_must_not_be_used_by_v2_cli");
  };
  try {
    const result = await timeFrozenCli.runLocomoTimeFrozenRetrievalCli([
      "--input", input,
      "--output", outputPath,
      "--limit", "1",
      "--top-k", "3",
      "--benchmark-now-sec", String(TEST_BENCHMARK_NOW_SEC),
    ], {
      repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
      runnerOptions: deps,
    });
    assert.equal(result.output.profile, LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE);
    assert.equal(result.output.provenance.dataset_sha256.length, 64);
    assert.equal(result.output.provenance.benchmark_now_sec, TEST_BENCHMARK_NOW_SEC);
    assert.equal(result.output.provenance.materialization_now_sec, TEST_BENCHMARK_NOW_SEC);
    assert.equal(result.output.provenance.search_now_sec, TEST_BENCHMARK_NOW_SEC);
    assert.equal(result.output.run.top_k, 3);
    assert.equal(result.output.run.profile, LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE);
    assert.equal(result.output.provenance.vector_mode, LOCOMO_VECTOR_MODE);
    assert.equal(result.output.provenance.host_manager_mode, LOCOMO_HOST_MANAGER_MODE);
    assert.equal(existsSync(outputPath), true);
    assert.deepEqual(JSON.parse(readFileSync(outputPath)).results, result.output.results);
  } finally {
    Date.now = originalDateNow;
    rmSync(root, { recursive: true, force: true });
  }

  const rootForMissing = mkdtempSync(join(tmpdir(), "memory-engine-locomo-time-frozen-cli-missing-"));
  const missingInput = join(rootForMissing, "fixture.json");
  writeFileSync(missingInput, JSON.stringify([rawCase()]));
  try {
    await assert.rejects(
      () => timeFrozenCli.runLocomoTimeFrozenRetrievalCli(["--input", missingInput], {
        repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
        runDataset: async () => { throw new Error("runner_must_not_run"); },
      }),
      /locomo_v2_benchmark_now_sec_required/,
    );
    await assert.rejects(
      () => timeFrozenCli.runLocomoTimeFrozenRetrievalCli([
        "--input", missingInput,
        "--benchmark-now-sec", String(TEST_BENCHMARK_NOW_SEC),
      ], {
        repositoryProvenance: TEST_REPOSITORY_PROVENANCE,
        runnerOptions: { profileProvenance: { search_now_sec: 1 } },
        runDataset: async () => { throw new Error("runner_must_not_run"); },
      }),
      /locomo_provenance_reserved:search_now_sec/,
    );
  } finally {
    rmSync(rootForMissing, { recursive: true, force: true });
  }
});

test("official LoCoMo shape contract remains owned by v1 and is not reimplemented by v2", { skip: !existsSync(process.env.LOCOMO_DATASET_PATH || "") }, () => {
  const bytes = readFileSync(process.env.LOCOMO_DATASET_PATH);
  const validation = validateLocomoDataset(JSON.parse(bytes));
  assert.equal(validation.conversations, 10);
  assert.equal(validation.qa, 1986);
  assert.equal(validation.policies[LOCOMO_EVIDENCE_STRICT_V1].scored_cases, 1972);
  assert.equal(validation.policies[LOCOMO_EVIDENCE_CANONICALIZED_V1].scored_cases, 1978);
});
