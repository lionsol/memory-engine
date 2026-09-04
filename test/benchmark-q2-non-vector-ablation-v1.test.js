import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  createBenchmarkHybridRuntime,
  materializeLongMemEvalCaseDatabases,
  runLongMemEvalRetrievalCase,
} from "../lib/benchmark/longmemeval-retrieval-runner-v1.js";
import { normalizeLongMemEvalCase } from "../lib/benchmark/longmemeval-v1.js";
import {
  LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE,
} from "../lib/benchmark/locomo-time-frozen-retrieval-runner-v2.js";
import {
  createLocomoProductionHybridRuntime,
  materializeLocomoConversationDataPlane,
} from "../lib/benchmark/locomo-retrieval-runner-v1.js";
import {
  aggregateQ1EvidenceRankingAt3,
  scoreQ1EvidenceRankingAt3,
} from "../lib/benchmark/q1-product-metric-contract-v1.js";
import {
  Q2_CHANNEL_ABLATION_PROFILES,
  Q2_CHANNEL_ABLATION_SCHEMA,
  Q2_EVALUATION_TOP_K,
  Q2_Q1_BASELINE_FIXTURE_SHA256,
  assertQ2ObservedChannelContract,
  resolveQ2ChannelAblationProfile,
} from "../lib/benchmark/q2-channel-ablation-v1.js";
import {
  Q2_A2_EXPECTED_REPOSITORY_COMMIT,
  Q2_A2_REPOSITORY_PROVENANCE,
  Q2_FACTORIAL_METRICS,
  Q2_LOCOMO_BENCHMARK_NOW_SEC,
  Q2_LOCOMO_DATASET_SHA256,
  Q2_LONGMEMEVAL_BENCHMARK_NOW_SEC,
  Q2_LONGMEMEVAL_DATASET_SHA256,
  Q2_NON_VECTOR_ABLATION_SCHEMA,
  Q2_NON_VECTOR_PROFILE_ORDER,
  assertQ2AuthorityHashes,
  assertQ2BaselineParity,
  assertQ2NoCrossDatasetPooling,
  assertQ2NonVectorAblationEnvelope,
  assertQ2ProfilePopulation,
  bindQ2LongMemEvalProfile,
  computeQ2FactorialEffects,
  computeQ2PairedTransitions,
  validateQ2AuthorityHashes,
  validateQ2NonVectorAblationEnvelope,
} from "../lib/benchmark/q2-non-vector-ablation-v1.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(repoRoot, "test/fixtures/q2-non-vector-ablation-v1.json");
const q1FixturePath = resolve(repoRoot, "test/fixtures/q1-current-baseline-v1.json");
const productionHybridPath = resolve(repoRoot, "lib/recall/hybrid-search.js");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const q1Baseline = JSON.parse(readFileSync(q1FixturePath, "utf8"));

function rawLongCase(index, evidenceCount, { skipped = false, abstention = false } = {}) {
  const sessionCount = Math.max(6, evidenceCount || 1);
  const sessionIds = Array.from({ length: sessionCount }, (_, sessionIndex) => (
    `synthetic-session-${index}-${sessionIndex}`
  ));
  const sessions = sessionIds.map((sessionId, sessionIndex) => [{
    role: "user",
    content: `Synthetic evidence ${sessionId}`,
    has_answer: !skipped && !abstention && sessionIndex === 0,
  }]);
  return {
    question_id: abstention ? `synthetic-${index}_abs` : `synthetic-${index}`,
    question_type: "multi-session",
    question: "Which synthetic evidence is required?",
    answer: "Synthetic answer",
    question_date: "2025/01/10 (Fri) 12:00",
    haystack_session_ids: sessionIds,
    haystack_dates: sessionIds.map(() => "2025/01/01 (Wed) 12:00"),
    haystack_sessions: sessions,
    answer_session_ids: skipped || abstention ? [] : sessionIds.slice(0, evidenceCount),
  };
}

function syntheticLongBindingSource() {
  const records = [];
  for (let index = 0; index < 30; index += 1) {
    records.push(rawLongCase(index, 1, { abstention: true }));
  }
  for (let index = 30; index < 81; index += 1) {
    records.push(rawLongCase(index, 1, { skipped: true }));
  }
  const distribution = [
    [1, 119],
    [2, 229],
    [3, 39],
    [4, 18],
    [5, 11],
    [6, 3],
  ];
  let index = 81;
  for (const [evidenceCount, count] of distribution) {
    for (let offset = 0; offset < count; offset += 1) {
      records.push(rawLongCase(index, evidenceCount));
      index += 1;
    }
  }
  return records;
}

function syntheticLongRun(records) {
  const items = records.map(normalizeLongMemEvalCase);
  return {
    results: items.map(item => {
      const scoreable = item.abstention === false
        && item.sessions.some(session => session.turns.some(
          turn => turn.role === "user" && turn.has_answer === true,
        ));
      if (!scoreable) {
        return {
          question_id: item.question_id,
          skipped: true,
          skip_reason: item.abstention
            ? "official_retrieval_abstention"
            : "official_retrieval_no_user_target",
          retrieved_session_ids: [],
        };
      }
      return {
        question_id: item.question_id,
        skipped: false,
        retrieved_session_ids: [item.evidence_session_ids[0]],
        latency_ms: 1,
        diagnostics: { channels: ["fts"], channel_sizes: { fts: 1 } },
      };
    }),
    run: {
      profile: "production_hybrid_lexical_session_v1",
      top_k: 3,
      benchmark_now_sec: Q2_LONGMEMEVAL_BENCHMARK_NOW_SEC,
    },
    summary: {
      cases: 500,
      scored_cases: 419,
      skipped_cases: 81,
    },
  };
}

function rawLocomoCase() {
  return {
    sample_id: "q2-locomo-synthetic",
    conversation: {
      speaker_a: "Alice",
      speaker_b: "Bob",
      session_1_date_time: "1:00 pm on 1 May, 2023",
      session_1: [
        { speaker: "Alice", dia_id: "D1:1", text: "Synthetic Kyoto evidence." },
      ],
    },
    qa: [{
      question: "Where is the synthetic evidence?",
      answer: "Kyoto",
      evidence: ["D1:1"],
      category: 4,
    }],
  };
}

function rankingScore(gold, retrieved) {
  return scoreQ1EvidenceRankingAt3({
    gold_evidence_ids: gold,
    ranked_retrieved_ids: retrieved,
  });
}

function syntheticCell(profile, scores, dataset = "synthetic") {
  const q1 = aggregateQ1EvidenceRankingAt3(scores);
  return {
    profile,
    provenance: "BENCHMARK_DERIVED",
    source_identity: {
      dataset,
      dataset_sha256: "a".repeat(64),
    },
    q1,
    caseScores: scores.map(score => ({ score, scoreable: score.scoreable === true })),
  };
}

function assertNoRawFixtureKeys(value) {
  const forbidden = new Set([
    "answer",
    "answers",
    "candidate_id",
    "candidate_ids",
    "conversation",
    "content",
    "dialog_id",
    "dialog_ids",
    "evidence_id",
    "evidence_ids",
    "gold_evidence_ids",
    "memory",
    "memory_content",
    "memory_contents",
    "prompt",
    "question",
    "question_id",
    "raw_evidence",
    "retrieved_dialog_ids",
    "retrieved_ids",
    "retrieved_memory_ids",
    "retrieved_session_ids",
    "sample_id",
    "session_id",
    "session_ids",
    "sessions",
    "text",
    "tool_result",
    "tool_results",
    "turn_id",
  ]);
  const walk = (current, path) => {
    if (Array.isArray(current)) {
      current.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      if (forbidden.has(key)) {
        assert.equal(key === "sessions" && typeof child === "number", true, `${path}.${key}`);
      }
      walk(child, `${path}.${key}`);
    }
  };
  walk(value, "$fixture");
}

test("bounded Q2 fixture validates, binds Q1 authority, and keeps both tracks separate", () => {
  assert.equal(fixture.schema, Q2_NON_VECTOR_ABLATION_SCHEMA);
  assert.deepEqual(validateQ2NonVectorAblationEnvelope(fixture), { valid: true, errors: [] });
  assert.doesNotThrow(() => assertQ2NonVectorAblationEnvelope(fixture));
  assert.equal(fixture.authority.q1_baseline_fixture_sha256, Q2_Q1_BASELINE_FIXTURE_SHA256);
  assert.deepEqual(fixture.design.profiles, Q2_NON_VECTOR_PROFILE_ORDER);
  assert.equal(fixture.interpretation.cross_dataset_pooling, false);

  assertQ2BaselineParity(
    fixture.tracks.longmemeval.profiles.q2_non_vector_full_v1,
    q1Baseline.tracks.longmemeval_lexical_session,
    { dataset: "LongMemEval-S" },
  );
  assertQ2BaselineParity(
    fixture.tracks.locomo.profiles.q2_non_vector_full_v1,
    q1Baseline.tracks.locomo_lexical_strict_session,
    { dataset: "LoCoMo" },
  );
  assert.equal(fixture.tracks.longmemeval.baseline_parity.mismatch_count, 0);
  assert.equal(fixture.tracks.locomo.baseline_parity.mismatch_count, 0);
  assert.equal(fixture.tracks.longmemeval.baseline_parity.status, "PASS");
  assert.equal(fixture.tracks.locomo.baseline_parity.status, "PASS");
});

test("Q2 fixture retains explicit source identity, profile population, and Q1 breakdown denominators", () => {
  for (const [trackName, dataset, expectedHash, expectedCases] of [
    ["longmemeval", "LongMemEval-S", Q2_LONGMEMEVAL_DATASET_SHA256, 500],
    ["locomo", "LoCoMo", Q2_LOCOMO_DATASET_SHA256, 1986],
  ]) {
    const track = fixture.tracks[trackName];
    assertQ2ProfilePopulation(track.profiles, dataset);
    const keys = Object.keys(track.profiles).sort();
    assert.deepEqual(keys, [...Q2_NON_VECTOR_PROFILE_ORDER].sort());
    for (const profile of Q2_NON_VECTOR_PROFILE_ORDER) {
      const cell = track.profiles[profile];
      assert.equal(cell.provenance, "BENCHMARK_DERIVED");
      assert.equal(cell.source_identity.dataset, dataset);
      assert.equal(cell.source_identity.dataset_sha256, expectedHash);
      assert.equal(cell.source_identity.q1_baseline_fixture_sha256, Q2_Q1_BASELINE_FIXTURE_SHA256);
      assert.equal(cell.source_identity.q2_metric_contract_schema, Q2_CHANNEL_ABLATION_SCHEMA);
      assert.equal(cell.source_identity.top_k, 3);
      assert.equal(cell.q1.scoreable_case_count + cell.q1.unknown_or_unscoreable_case_count, expectedCases);
    }
    assert.ok(Object.keys(track.source_breakdown).length === Q2_NON_VECTOR_PROFILE_ORDER.length);
  }
  assert.equal(
    fixture.tracks.locomo.profiles.q2_non_vector_full_v1.source_identity.runner_profile,
    LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE,
  );
  assert.equal(
    fixture.tracks.locomo.profiles.q2_non_vector_full_v1.source_identity.benchmark_now_sec,
    Q2_LOCOMO_BENCHMARK_NOW_SEC,
  );
  assert.equal(
    fixture.tracks.locomo.profiles.q2_non_vector_full_v1.source_identity.materialization_now_sec,
    Q2_LOCOMO_BENCHMARK_NOW_SEC,
  );
  assert.equal(
    fixture.tracks.locomo.profiles.q2_non_vector_full_v1.source_identity.search_now_sec,
    Q2_LOCOMO_BENCHMARK_NOW_SEC,
  );
});

test("LongMemEval runner threads bounded channel capabilities without changing its default", async () => {
  const raw = rawLongCase(900, 1);
  const disabled = await runLongMemEvalRetrievalCase(raw, {
    topK: 3,
    benchmarkNowSec: Q2_LONGMEMEVAL_BENCHMARK_NOW_SEC,
    channelCapabilities: { isolatedKg: false, isolatedRecent: false },
  });
  assert.equal(disabled.skipped, false);
  assert.deepEqual(disabled.diagnostics.channels, ["fts"]);
  assert.equal(disabled.diagnostics.channel_sizes.kg, undefined);
  assert.equal(disabled.diagnostics.channel_sizes.recent, undefined);
  assert.equal(disabled.diagnostics.vector_mode, "disabled_empty_backend");

  const materialized = materializeLongMemEvalCaseDatabases(
    normalizeLongMemEvalCase(raw),
    { benchmarkNowSec: Q2_LONGMEMEVAL_BENCHMARK_NOW_SEC },
  );
  const adapter = createBenchmarkHybridRuntime(materialized, { topK: 3 });
  try {
    const capabilities = await adapter.runtime.withHybridDbAccessScope(access => access.capabilities);
    assert.deepEqual(capabilities, {
      isolatedFts: true,
      isolatedKg: true,
      isolatedRecent: true,
      legacyFallbackAllowed: false,
    });
  } finally {
    adapter.close();
    rmSync(materialized.root, { recursive: true, force: true });
  }
});

test("LoCoMo factory forwards Q2 capabilities and preserves default isolated behavior", () => {
  const make = channelCapabilities => {
    const plane = materializeLocomoConversationDataPlane(rawLocomoCase(), {
      benchmarkNowSec: Q2_LOCOMO_BENCHMARK_NOW_SEC,
    });
    const adapter = createLocomoProductionHybridRuntime(plane, {
      topK: 3,
      searchNowSec: Q2_LOCOMO_BENCHMARK_NOW_SEC,
      ...(channelCapabilities ? { channelCapabilities } : {}),
    });
    return { plane, adapter };
  };
  const defaultRuntime = make();
  const isolated = make({ isolatedKg: false, isolatedRecent: true });
  try {
    assert.deepEqual(defaultRuntime.adapter.runtime.channelCapabilities, {
      isolatedKg: true,
      isolatedRecent: true,
    });
    assert.deepEqual(isolated.adapter.runtime.channelCapabilities, {
      isolatedKg: false,
      isolatedRecent: true,
    });
    assert.equal(isolated.adapter.runtime.searchNowSec, Q2_LOCOMO_BENCHMARK_NOW_SEC);
  } finally {
    defaultRuntime.adapter.close();
    defaultRuntime.plane.close();
    isolated.adapter.close();
    isolated.plane.close();
  }
});

test("observed-channel contracts are explicit for every Q2 profile and vector is never allowed", () => {
  const allowed = {
    q2_fts_only_v1: ["fts"],
    q2_fts_kg_v1: ["fts", "kg"],
    q2_fts_recent_v1: ["fts", "like", "recent", "episode", "recent_fallback"],
    q2_non_vector_full_v1: ["fts", "kg", "like", "recent", "episode", "recent_fallback"],
  };
  for (const [profile, channels] of Object.entries(allowed)) {
    const result = {
      channels,
      channel_sizes: Object.fromEntries(channels.map(channel => [channel, 1])),
    };
    assert.deepEqual(assertQ2ObservedChannelContract(profile, result).observed_channels, [...channels].sort());
    assert.throws(
      () => assertQ2ObservedChannelContract(profile, {
        channels: [...channels, "vector"],
        channel_sizes: Object.fromEntries([...channels, "vector"].map(channel => [channel, 1])),
      }),
      /q2_observed_channel_contract_violation/,
    );
    assert.equal(resolveQ2ChannelAblationProfile(profile).retrieval_channels.vector, false);
  }
  for (const cell of Object.values(fixture.tracks.longmemeval.profiles)) {
    assert.equal(cell.channel_usage.vector_served_case_count, 0);
    assert.equal(cell.channel_usage.unexpected_served_channel_count, 0);
  }
  for (const cell of Object.values(fixture.tracks.locomo.profiles)) {
    assert.equal(cell.channel_usage.vector_served_case_count, 0);
    assert.equal(cell.channel_usage.unexpected_served_channel_count, 0);
  }
});

test("Q2 binding reuses the Q1 scorer and preserves budget/source population semantics", () => {
  const records = syntheticLongBindingSource();
  const run = syntheticLongRun(records);
  const bound = bindQ2LongMemEvalProfile(records, run, { profile: "q2_fts_only_v1" });
  const items = records.map(normalizeLongMemEvalCase);
  const directRows = items.map(item => {
    const scoreable = item.abstention === false && item.sessions.some(session => session.turns.some(
      turn => turn.role === "user" && turn.has_answer === true,
    ));
    return rankingScore(
      item.evidence_session_ids,
      scoreable ? [item.evidence_session_ids[0]] : undefined,
    );
  });
  const direct = aggregateQ1EvidenceRankingAt3(directRows);
  for (const field of [
    "scoreable_case_count",
    "unknown_or_unscoreable_case_count",
    "budget_feasible_case_count",
    "budget_infeasible_case_count",
    "cross_session_case_count",
    "recall_any@3",
    "recall_all@3",
    "ndcg@3",
    "evidence_coverage@3",
    "recall_all@3_feasible",
    "cross_session_evidence_coverage@3",
  ]) {
    assert.equal(bound.q1[field], direct[field], field);
  }
  assert.deepEqual(bound.q1["first_relevant_rank@3"], direct["first_relevant_rank@3"]);
  assert.equal(bound.denominator.source_case_count, 500);
  assert.equal(bound.denominator.scoreable_case_count, 419);
  assert.equal(bound.denominator.skipped_case_count, 81);
  assert.equal(bound.denominator.budget_feasible_case_count, 387);
  assert.equal(bound.denominator.budget_infeasible_case_count, 32);
  assert.equal(bound.denominator.cross_session_case_count, 300);
  assert.equal(bound.source_identity.q1_baseline_fixture_sha256, Q2_Q1_BASELINE_FIXTURE_SHA256);
  assert.equal(bound.source_identity.runner_profile, "production_hybrid_lexical_session_v1");
});

test("paired transitions count improved, regressed, and unchanged cases with scoreable denominators", () => {
  const fullScores = [
    rankingScore(["a"], ["a"]),
    rankingScore(["a"], ["x"]),
    rankingScore(["a", "b"], ["a", "x"]),
  ];
  const cells = new Map([
    ["q2_non_vector_full_v1", syntheticCell("q2_non_vector_full_v1", fullScores)],
    ["q2_fts_only_v1", syntheticCell("q2_fts_only_v1", [
      rankingScore(["a"], ["a"]),
      rankingScore(["a"], ["a"]),
      rankingScore(["a", "b"], ["a", "b"]),
    ])],
    ["q2_fts_kg_v1", syntheticCell("q2_fts_kg_v1", [
      rankingScore(["a"], ["x"]),
      rankingScore(["a"], ["x"]),
      rankingScore(["a", "b"], ["a", "x"]),
    ])],
    ["q2_fts_recent_v1", syntheticCell("q2_fts_recent_v1", fullScores)],
  ]);
  const transitions = computeQ2PairedTransitions(cells);
  assert.deepEqual(transitions.q2_fts_only_v1.metrics["recall_any@3"], {
    improved: 1,
    regressed: 0,
    unchanged: 2,
    comparable_case_count: 3,
  });
  assert.deepEqual(transitions.q2_fts_kg_v1.metrics["recall_any@3"], {
    improved: 0,
    regressed: 1,
    unchanged: 2,
    comparable_case_count: 3,
  });
  assert.deepEqual(transitions.q2_fts_recent_v1.metrics["recall_any@3"], {
    improved: 0,
    regressed: 0,
    unchanged: 3,
    comparable_case_count: 3,
  });
});

test("factorial effects use the frozen F/K/R/KR equations and omit denominator interactions", () => {
  const values = {
    q2_fts_only_v1: 0.1,
    q2_fts_kg_v1: 0.2,
    q2_fts_recent_v1: 0.3,
    q2_non_vector_full_v1: 0.5,
  };
  const cells = Object.fromEntries(Object.entries(values).map(([profile, value]) => [profile, {
    profile,
    q1: Object.fromEntries(Q2_FACTORIAL_METRICS.map(metric => [metric, value])),
  }]));
  const effects = computeQ2FactorialEffects(cells);
  assert.ok(Math.abs(effects["recall_any@3"].kg_effect_without_recent - 0.1) <= 1e-12);
  assert.ok(Math.abs(effects["recall_any@3"].kg_effect_with_recent - 0.2) <= 1e-12);
  assert.ok(Math.abs(effects["recall_any@3"].recent_effect_without_kg - 0.2) <= 1e-12);
  assert.ok(Math.abs(effects["recall_any@3"].recent_effect_with_kg - 0.3) <= 1e-12);
  assert.ok(Math.abs(effects["recall_any@3"].interaction - 0.1) <= 1e-12);
  assert.deepEqual(Object.keys(effects), Q2_FACTORIAL_METRICS);
});

test("source pooling fails closed for datasets, hashes, provenance, and trigger separation", () => {
  const longCell = fixture.tracks.longmemeval.profiles.q2_non_vector_full_v1;
  const locomoCell = fixture.tracks.locomo.profiles.q2_non_vector_full_v1;
  assert.throws(
    () => assertQ2NoCrossDatasetPooling([longCell, locomoCell]),
    /q2_cross_dataset_pooling_refused/,
  );
  assert.throws(
    () => assertQ2NoCrossDatasetPooling([
      longCell,
      {
        provenance: "TARGETED_SYNTHETIC",
        source_identity: { dataset: "LongMemEval-S", dataset_sha256: Q2_LONGMEMEVAL_DATASET_SHA256 },
      },
    ]),
    /q2_cross_provenance_pooling_refused/,
  );
  assert.throws(
    () => assertQ2NoCrossDatasetPooling([{ provenance: "BENCHMARK_DERIVED" }]),
    /q2_source_identity_required/,
  );

  const valid = validateQ2AuthorityHashes({
    q1BaselineFixtureSha256: Q2_Q1_BASELINE_FIXTURE_SHA256,
    longmemevalSha256: Q2_LONGMEMEVAL_DATASET_SHA256,
    locomoSha256: Q2_LOCOMO_DATASET_SHA256,
  });
  assert.equal(valid.valid, true);
  assert.equal(validateQ2AuthorityHashes({
    q1BaselineFixtureSha256: "0".repeat(64),
    longmemevalSha256: Q2_LONGMEMEVAL_DATASET_SHA256,
    locomoSha256: Q2_LOCOMO_DATASET_SHA256,
  }).valid, false);
  assert.throws(
    () => assertQ2AuthorityHashes({
      q1BaselineFixtureSha256: Q2_Q1_BASELINE_FIXTURE_SHA256,
      longmemevalSha256: "0".repeat(64),
      locomoSha256: Q2_LOCOMO_DATASET_SHA256,
    }),
    /STOP_Q2_A2_AUTHORITY_HASH_MISMATCH:longmemeval/,
  );
});

test("profile population drift, malformed identity, and raw fixture payloads fail closed", () => {
  const drift = structuredClone(fixture.tracks.longmemeval.profiles);
  drift.q2_fts_only_v1.denominator.source_case_count = 499;
  assert.throws(
    () => assertQ2ProfilePopulation(drift, "LongMemEval-S"),
    /STOP_Q2_A2_PROFILE_POPULATION_DRIFT:LongMemEval-S:q2_fts_only_v1/,
  );

  const malformedIdentity = structuredClone(fixture);
  delete malformedIdentity.tracks.locomo.profiles.q2_non_vector_full_v1.source_identity.dataset;
  assert.equal(validateQ2NonVectorAblationEnvelope(malformedIdentity).valid, false);
  assert.throws(
    () => assertQ2NonVectorAblationEnvelope(malformedIdentity),
    /dataset_identity:LoCoMo:q2_non_vector_full_v1/,
  );

  const rawPayload = structuredClone(fixture);
  rawPayload.tracks.longmemeval.profiles.q2_fts_only_v1.question = "raw benchmark text";
  assert.equal(validateQ2NonVectorAblationEnvelope(rawPayload).valid, false);
  assert.throws(
    () => assertQ2NonVectorAblationEnvelope(rawPayload),
    /raw_payload_key:\$\.tracks\.longmemeval\.profiles\.q2_fts_only_v1\.question/,
  );
  assertNoRawFixtureKeys(fixture);
});

test("fixture latency is benchmark-derived and retains both retrieval-attempt denominators", () => {
  const longCells = Object.values(fixture.tracks.longmemeval.profiles);
  const locomoCells = Object.values(fixture.tracks.locomo.profiles);
  for (const cell of longCells) {
    assert.equal(cell.latency.provenance, "BENCHMARK_DERIVED");
    assert.equal(cell.latency.started_trace_count, 419);
    assert.equal(cell.latency.latency_sample_count, 419);
    assert.equal(cell.latency.incomplete_trace_count, 0);
    assert.equal(cell.latency.error_or_timeout_count, 0);
    assert.ok(cell.latency.recall_latency_p50_ms <= cell.latency.recall_latency_p95_ms);
  }
  for (const cell of locomoCells) {
    assert.equal(cell.latency.provenance, "BENCHMARK_DERIVED");
    assert.equal(cell.denominator.strict_metric_case_count, 1972);
    assert.equal(cell.denominator.retrieval_latency_attempt_count, 1978);
    assert.equal(cell.latency.started_trace_count, 1978);
    assert.equal(cell.latency.latency_sample_count, 1978);
    assert.equal(cell.latency.incomplete_trace_count, 0);
    assert.equal(cell.latency.error_or_timeout_count, 0);
    assert.ok(cell.latency.recall_latency_p50_ms <= cell.latency.recall_latency_p95_ms);
  }
});

test("unsupported Q2 profile statuses remain explicit and production hybrid source is unchanged", () => {
  assert.equal(
    Q2_CHANNEL_ABLATION_PROFILES.q2_vector_only_v1.status,
    "DEFER_UNSUPPORTED_WITH_CURRENT_PRODUCTION_ORCHESTRATION",
  );
  assert.equal(Q2_CHANNEL_ABLATION_PROFILES.q2_metadata_only_v1.status, "NOT_A_DISTINCT_RETRIEVAL_CHANNEL");
  assert.equal(Q2_CHANNEL_ABLATION_PROFILES.q2_episode_only_v1.status, "NOT_INDEPENDENTLY_SWITCHABLE");
  assert.equal(Q2_CHANNEL_ABLATION_PROFILES.q2_full_semantic_v1.provider_required, true);
  assert.equal(Q2_CHANNEL_ABLATION_PROFILES.q2_selective_vector_v1.runner_mapping, "not_mapped_to_current_semantic_runner");
  assert.equal(readFileSync(productionHybridPath, "utf8").includes(Q2_CHANNEL_ABLATION_SCHEMA), false);
  assert.equal(readFileSync(productionHybridPath, "utf8").includes("q2_non_vector"), false);
  assert.equal(Q2_A2_EXPECTED_REPOSITORY_COMMIT, "d705625dffcbf5f0b0886f5f8fcb302d4a438248");
  assert.deepEqual(Q2_A2_REPOSITORY_PROVENANCE, {
    repository_commit: Q2_A2_EXPECTED_REPOSITORY_COMMIT,
    repository_worktree_clean: false,
    repository_provenance_source: "git",
  });
});

test("fixture hash is stable and no generated raw benchmark payload is required", () => {
  const fixtureSha = createHash("sha256").update(readFileSync(fixturePath)).digest("hex");
  assert.match(fixtureSha, /^[0-9a-f]{64}$/u);
  if (existsSync("/tmp/q2-non-vector-ablation-v1.json")) {
    const generated = JSON.parse(readFileSync("/tmp/q2-non-vector-ablation-v1.json", "utf8"));
    assert.deepEqual(generated, fixture);
  }
});
