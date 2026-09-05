import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  aggregateQ1EvidenceRankingAt3,
} from "../lib/benchmark/q1-product-metric-contract-v1.js";
import {
  normalizeLocomoDataset,
} from "../lib/benchmark/locomo-v1.js";
import * as binding from "../lib/benchmark/q2-semantic-binding-v1.js";

function baselineTrack(dataset) {
  const isLong = dataset === "LongMemEval-S";
  return {
    source_identity: {
      dataset,
      dataset_sha256: isLong
        ? "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442"
        : "79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4",
      retrieval_profile: isLong
        ? "production_hybrid_lexical_session_v1"
        : "production_hybrid_lexical_dialog_locomo_time_frozen_v2",
      top_k: 3,
      benchmark_now_sec: isLong ? 1_800_000_000 : 1_705_066_861,
    },
    q1: Object.fromEntries(binding.Q2_SEMANTIC_SCALAR_METRICS.map(metric => [metric, 0])),
  };
}

function authorityOptions(dataset, overrides = {}) {
  return {
    q1BaselineFixtureSha256: binding.Q2_Q1_BASELINE_FIXTURE_SHA256,
    q2A2FixtureSha256: binding.Q2_A2_ABLATION_FIXTURE_SHA256,
    q1BaselineTrack: baselineTrack(dataset),
    ...overrides,
  };
}

function rawLongCase(index, {
  evidenceCount = 1,
  abstention = false,
  noUserTarget = false,
  abstentionNoUserTarget = false,
} = {}) {
  const sessionIds = Array.from({ length: 6 }, (_, sessionIndex) => `long-${index}-s-${sessionIndex}`);
  const missingUserTarget = noUserTarget || abstentionNoUserTarget;
  return {
    question_id: abstention ? `long-${index}_abs` : `long-${index}`,
    question_type: "multi-session",
    question: "Which synthetic evidence is required?",
    answer: "synthetic answer",
    question_date: "2025/01/10 (Fri) 12:00",
    haystack_session_ids: sessionIds,
    haystack_dates: sessionIds.map(() => "2025/01/01 (Wed) 12:00"),
    haystack_sessions: sessionIds.map((sessionId, sessionIndex) => [{
      role: "user",
      content: `Synthetic evidence ${sessionId}`,
      has_answer: !missingUserTarget && sessionIndex === 0,
    }]),
    answer_session_ids: missingUserTarget || abstention ? [] : sessionIds.slice(0, evidenceCount),
  };
}

function buildLongDataset({ abstentionNoUserTarget = false, nonAbstentionNoUserTargetCount = 51 } = {}) {
  const records = [];
  for (let index = 0; index < 30; index += 1) {
    records.push(rawLongCase(index, { abstention: true, abstentionNoUserTarget }));
  }
  for (let index = 30; index < 30 + nonAbstentionNoUserTargetCount; index += 1) {
    records.push(rawLongCase(index, { noUserTarget: true }));
  }
  const distribution = [[1, 119], [2, 229], [3, 39], [4, 18], [5, 11], [6, 3]];
  let index = 30 + nonAbstentionNoUserTargetCount;
  for (const [evidenceCount, count] of distribution) {
    for (let offset = 0; offset < count; offset += 1) {
      records.push(rawLongCase(index, { evidenceCount }));
      index += 1;
    }
  }
  return records.slice(0, 500);
}

function semanticDiagnostics({ fallback = 0 } = {}) {
  return {
    channels: ["fts", "vector"],
    channel_sizes: { fts: 1, vector: 1 },
    vector_mode: "temporary_lancedb",
    vector_backend: "lancedb",
    vector_stage: "lancedb_search",
    vector_skipped: false,
    vector_in_fusion: true,
    vector_attempted_count: 1,
    vector_skipped_count: 0,
    vector_error_count: 0,
    host_manager_fallback_count: fallback,
  };
}

function longSemanticRun(records = buildLongDataset(), mutate = null) {
  const normalized = records.map(record => record.schema ? record : record);
  const results = normalized.map((record, index) => {
    const isSkipped = index < 81;
    if (isSkipped) {
      return {
        question_id: record.question_id,
        skipped: true,
        skip_reason: index < 30 ? "official_retrieval_abstention" : "official_retrieval_no_user_target",
        retrieved_session_ids: [],
        diagnostics: null,
        provenance: {
          dataset_sha256: "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442",
          vector_attempted_count: 0,
          vector_skipped_count: 0,
          vector_error_count: 0,
        },
        latency_ms: 0,
      };
    }
    const sessionIds = record.haystack_session_ids;
    return {
      question_id: record.question_id,
      skipped: false,
      retrieved_session_ids: [sessionIds[0], ...sessionIds.slice(1, 4)],
      diagnostics: semanticDiagnostics(),
      provenance: {
        dataset_sha256: "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442",
        vector_attempted_count: 1,
        vector_skipped_count: 0,
        vector_error_count: 0,
      },
      latency_ms: 1,
    };
  });
  const run = {
    schema: "memory_engine_longmemeval_semantic_retrieval_v1",
    profile: "production_hybrid_semantic_session_v1",
    provenance: {
      dataset_sha256: "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442",
      vector_attempted_count: 419,
      vector_skipped_count: 0,
      vector_error_count: 0,
    },
    run: {
      profile: "production_hybrid_semantic_session_v1",
      dataset_sha256: "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442",
      top_k: 50,
      vector_top_k: 50,
      benchmark_now_sec: 1_800_000_000,
    },
    summary: { cases: 500, scored_cases: 419, skipped_cases: 81 },
    results,
  };
  if (mutate) mutate(run);
  return run;
}

function rawLocomoConversation(index, questionCount, invalidCount = 0) {
  const sessionCount = index < 2 ? 28 : 27;
  const conversation = {
    speaker_a: "Alice",
    speaker_b: "Bob",
  };
  let globalSession = index < 2 ? index * 28 : 56 + (index - 2) * 27;
  for (let sessionNumber = 1; sessionNumber <= sessionCount; sessionNumber += 1) {
    const turnCount = globalSession < 221 ? 22 : 20;
    conversation[`session_${sessionNumber}_date_time`] = "1:00 pm on 1 May, 2023";
    conversation[`session_${sessionNumber}`] = Array.from({ length: turnCount }, (_, turnIndex) => ({
      speaker: turnIndex % 2 === 0 ? "Alice" : "Bob",
      dia_id: `D${sessionNumber}:${turnIndex + 1}`,
      text: turnIndex === 0 ? "Synthetic Kyoto evidence." : "Synthetic conversation turn.",
    }));
    globalSession += 1;
  }
  const qa = Array.from({ length: questionCount }, (_, qaIndex) => ({
    question: `Where is synthetic evidence ${index}-${qaIndex}?`,
    answer: "Kyoto",
    evidence: qaIndex < invalidCount
      ? (qaIndex < 6 ? ["D1:1", "D1:1"] : [])
      : ["D1:1"],
    category: (qaIndex % 5) + 1,
  }));
  return { sample_id: `locomo-${index}`, conversation, qa };
}

function buildLocomoDataset() {
  return Array.from({ length: 10 }, (_, index) => rawLocomoConversation(index, index === 0 ? 204 : 198, index === 0 ? 14 : 0));
}

function locomoSemanticRun(records = buildLocomoDataset(), mutate = null) {
  const items = normalizeLocomoDataset(records, { evidencePolicy: "locomo_evidence_strict_v1" });
  const flatQuestions = items.flatMap(item => item.questions.map(question => ({ item, question })));
  const results = flatQuestions.map(({ item, question }, index) => {
    const attempted = question.scoreable === true || question.skip_reason === "duplicate_evidence";
    const diagnostics = attempted ? semanticDiagnostics() : null;
    return {
      question_id: question.question_id,
      sample_id: item.sample_id,
      qa_index: question.qa_index,
      retrieved_session_ids: question.scoreable ? [...question.evidence_session_ids] : [],
      strict: question.scoreable ? { scoreable: true } : { scoreable: false },
      strict_session: question.scoreable ? { scoreable: true } : { scoreable: false },
      diagnostics,
      latency_ms: attempted ? 1 : 0,
    };
  });
  const run = {
    schema: "memory_engine_locomo_semantic_retrieval_time_frozen_v2",
    profile: "production_hybrid_semantic_dialog_locomo_time_frozen_v2",
    provenance: {
      dataset_sha256: "79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4",
      benchmark_now_sec: 1705066861,
      materialization_now_sec: 1705066861,
      search_now_sec: 1705066861,
    },
    run: {
      profile: "production_hybrid_semantic_dialog_locomo_time_frozen_v2",
      dataset_sha256: "79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4",
      top_k: 50,
      vector_top_k: 50,
      benchmark_now_sec: 1705066861,
      materialization_now_sec: 1705066861,
      search_now_sec: 1705066861,
      primary_metric_level: "dialog",
      compatibility_metric_level: "session_projection",
    },
    summary: {
      cases: 1986,
      strict: { scored_cases: 1972, skipped_cases: 14 },
      sensitivity: { scored_cases: 1978, skipped_cases: 8 },
      vector_attempted_count: 1978,
      vector_skipped_count: 0,
      vector_error_count: 0,
      host_manager_fallback_count: 0,
    },
    results,
  };
  if (mutate) mutate(run);
  return run;
}

const longRecords = buildLongDataset();
const locomoRecords = buildLocomoDataset();

function bindLong(overrides = {}) {
  return binding.bindQ2LongMemEvalAlwaysVectorRun(
    longRecords,
    longSemanticRun(longRecords, overrides.mutateRun),
    authorityOptions("LongMemEval-S", overrides.options),
  );
}

function bindLocomo(overrides = {}) {
  return binding.bindQ2LocomoAlwaysVectorRun(
    locomoRecords,
    locomoSemanticRun(locomoRecords, overrides.mutateRun),
    authorityOptions("LoCoMo", overrides.options),
  );
}

test("Q2 semantic schema and profile registry are frozen", () => {
  assert.equal(binding.Q2_SEMANTIC_BINDING_SCHEMA, "memory_engine_q2_semantic_binding_v1");
  assert.equal(binding.Q2_SEMANTIC_PROFILE, "q2_always_vector_v1");
  assert.deepEqual(Object.keys(binding.Q2_SEMANTIC_PROFILE_BINDINGS).sort(), ["locomo", "longmemeval"]);
});

test("dataset profile resolution fails closed for unknown datasets", () => {
  assert.throws(() => binding.resolveQ2SemanticProfile("unknown"), /q2_semantic_unknown_dataset/);
});

test("LongMemEval maps to the frozen semantic runner profile", () => {
  const profile = binding.resolveQ2SemanticProfile("LongMemEval-S");
  assert.equal(profile.runner_profile, "production_hybrid_semantic_session_v1");
  assert.equal(profile.runner_served_depth, 50);
  assert.equal(profile.q1_evaluation_depth, 3);
});

test("LoCoMo maps to the frozen semantic v2 profile", () => {
  const profile = binding.resolveQ2SemanticProfile("LoCoMo");
  assert.equal(profile.runner_profile, "production_hybrid_semantic_dialog_locomo_time_frozen_v2");
  assert.equal(profile.runner_top_k, 50);
  assert.equal(profile.runner_vector_top_k_min, 50);
  assert.equal(profile.benchmark_now_sec, 1705066861);
});

test("both bindings require always-vector execution", () => {
  for (const profile of Object.values(binding.Q2_SEMANTIC_PROFILE_BINDINGS)) {
    assert.equal(profile.vector_required, true);
    assert.equal(profile.vector_skip_allowed, false);
    assert.equal(profile.vector_error_allowed, false);
    assert.equal(profile.host_manager_fallback_allowed, false);
  }
});

test("runner depth is 50 while Q1 quality depth is 3", () => {
  assert.equal(binding.Q2_SEMANTIC_RUNNER_SERVED_DEPTH, 50);
  assert.equal(binding.Q2_SEMANTIC_Q1_EVALUATION_DEPTH, 3);
  assert.equal(binding.Q2_SEMANTIC_TOP_K, 50);
});

test("Q1 and Q2-A2 authority hashes are required", () => {
  assert.throws(() => binding.assertQ2SemanticAuthorityHashes({}), /q1_baseline_fixture_sha256/);
  assert.throws(() => binding.assertQ2SemanticAuthorityHashes({
    q1BaselineFixtureSha256: binding.Q2_Q1_BASELINE_FIXTURE_SHA256,
  }), /q2_a2_fixture_sha256/);
  assert.doesNotThrow(() => binding.assertQ2SemanticAuthorityHashes({
    q1BaselineFixtureSha256: binding.Q2_Q1_BASELINE_FIXTURE_SHA256,
    q2A2FixtureSha256: binding.Q2_A2_ABLATION_FIXTURE_SHA256,
  }));
});

test("LongMemEval binding uses session gold and ranked session output at Q1 depth", () => {
  const result = bindLong();
  assert.equal(result.q1.schema, "memory_engine_q1_product_metric_contract_v1");
  assert.equal(result.runner_contract.runner_served_depth, 50);
  assert.equal(result.runner_contract.q1_quality_evaluation_depth, 3);
  assert.equal(result.denominator.scoreable_case_count, 419);
  assert.equal(result.q1.scoreable_case_count, 419);
  assert.equal(result.q1.unknown_or_unscoreable_case_count, 81);
  assert.equal(result.q1["recall_any@3"], 1);
  assert.equal(result.q1["recall_all@3"], 419 > 0 ? 387 / 419 : null);
});

test("LoCoMo binding uses strict session evidence rather than dialog evidence", () => {
  const result = bindLocomo();
  assert.equal(result.source_identity.evidence_policy, "locomo_evidence_strict_v1");
  assert.equal(result.denominator.strict_metric_case_count, 1972);
  assert.equal(result.denominator.strict_skipped_case_count, 14);
  assert.equal(result.q1.scoreable_case_count, 1972);
  assert.equal(result.q1.unknown_or_unscoreable_case_count, 14);
  assert.equal(result.runner_contract.q1_quality_evaluation_depth, 3);
});

test("LongMemEval skipped cases remain unknown rather than zero misses", () => {
  const result = bindLong();
  assert.equal(result.q1.unknown_or_unscoreable_case_count, 81);
  assert.equal(result.q1["recall_any@3"], 1);
});

test("LongMemEval abstention/no-target overlap is counted independently", () => {
  const records = buildLongDataset({ abstentionNoUserTarget: true });
  assert.equal(records.length, 500);
  const result = binding.bindQ2LongMemEvalAlwaysVectorRun(
    records,
    longSemanticRun(records),
    authorityOptions("LongMemEval-S"),
  );
  assert.equal(result.denominator.scoreable_case_count, 419);
  assert.equal(result.denominator.skipped_case_count, 81);
  assert.equal(result.q1.scoreable_case_count, 419);
  assert.equal(result.q1.unknown_or_unscoreable_case_count, 81);
});

test("LongMemEval rejects an incorrect non-abstention/no-target population", () => {
  const records = buildLongDataset({
    abstentionNoUserTarget: true,
    nonAbstentionNoUserTargetCount: 52,
  });
  assert.equal(records.length, 500);
  assert.throws(() => binding.bindQ2LongMemEvalAlwaysVectorRun(
    records,
    longSemanticRun(records),
    authorityOptions("LongMemEval-S"),
  ), /q2_semantic_longmemeval_scoreable_cases/);
});

test("LoCoMo strict skipped cases remain unknown rather than zero misses", () => {
  const result = bindLocomo();
  assert.equal(result.q1.unknown_or_unscoreable_case_count, 14);
  assert.equal(result.q1["recall_any@3"], 1);
});

test("Q1 aggregate is reused without a second ranking formula", () => {
  const result = bindLong();
  const direct = aggregateQ1EvidenceRankingAt3(result.case_scores);
  assert.deepEqual(result.q1, direct);
});

test("LongMemEval question-type breakdown is retained", () => {
  const result = bindLong();
  assert.deepEqual(Object.keys(result.source_breakdown), ["multi-session"]);
  assert.equal(result.source_breakdown["multi-session"].scoreable_case_count, 419);
});

test("LoCoMo category breakdown is retained", () => {
  const result = bindLocomo();
  assert.deepEqual(Object.keys(result.source_breakdown).sort(), [
    "adversarial",
    "multi-hop-retrieval",
    "open-domain-knowledge",
    "single-hop-retrieval",
    "temporal-reasoning",
  ]);
});

test("wrong semantic profile fails closed", () => {
  assert.throws(() => bindLong({ mutateRun: run => {
    run.profile = "production_hybrid_lexical_session_v1";
  } }), /q2_semantic_runner_profile/);
});

test("vector-skipped case fails closed", () => {
  assert.throws(() => bindLong({ mutateRun: run => {
    run.results[81].diagnostics.vector_skipped = true;
    run.results[81].provenance.vector_skipped_count = 1;
  } }), /q2_semantic_vector_skipped/);
});

test("vector-error case fails closed", () => {
  assert.throws(() => bindLong({ mutateRun: run => {
    run.results[81].diagnostics.vector_error = "synthetic error";
    run.results[81].provenance.vector_error_count = 1;
  } }), /q2_semantic_vector_error/);
});

test("missing vector-in-fusion evidence fails closed", () => {
  assert.throws(() => bindLong({ mutateRun: run => {
    run.results[81].diagnostics.vector_in_fusion = false;
    run.results[81].diagnostics.channels = ["fts"];
  } }), /q2_semantic_vector_not_in_fusion/);
});

test("host-manager fallback evidence fails closed", () => {
  assert.throws(() => bindLocomo({ mutateRun: run => {
    run.results[14].diagnostics.host_manager_fallback_count = 1;
  } }), /q2_semantic_host_manager_fallback/);
});

test("wrong LongMemEval dataset SHA fails closed", () => {
  assert.throws(() => bindLong({ mutateRun: run => {
    run.run.dataset_sha256 = "f".repeat(64);
  } }), /q2_semantic_dataset_sha256/);
});

test("wrong LoCoMo clock fails closed", () => {
  assert.throws(() => bindLocomo({ mutateRun: run => {
    run.run.search_now_sec += 1;
  } }), /q2_semantic_locomo_search_clock/);
});

test("wrong LoCoMo topK fails closed", () => {
  assert.throws(() => bindLocomo({ mutateRun: run => {
    run.run.top_k = 3;
  } }), /q2_semantic_runner_top_k/);
});

test("runner vector topK below 50 fails closed", () => {
  assert.throws(() => bindLong({ mutateRun: run => {
    run.run.vector_top_k = 3;
  } }), /q2_semantic_runner_vector_top_k/);
});

test("wrong Q1 baseline identity fails closed", () => {
  assert.throws(() => bindLong({ options: {
    q1BaselineTrack: {
      ...baselineTrack("LongMemEval-S"),
      source_identity: { ...baselineTrack("LongMemEval-S").source_identity, top_k: 50 },
    },
  } }), /q2_semantic_q1_baseline_identity_mismatch/);
});

test("mixed dataset aggregation is refused", () => {
  const long = bindLong();
  const locomo = bindLocomo();
  assert.throws(() => binding.assertQ2SemanticNoCrossDatasetPooling([long, locomo]), /cross_dataset_pooling_refused/);
  assert.doesNotThrow(() => binding.assertQ2SemanticNoCrossDatasetPooling([long]));
});

test("paired transition accounting uses tolerance and excludes unknown rows", () => {
  const baseline = [
    { scoreable: true, metrics: { "recall_any@3": 0, "recall_all@3": 0, "ndcg@3": 0, "evidence_coverage@3": 0 } },
    { scoreable: false, metrics: { "recall_any@3": null } },
    { scoreable: true, metrics: { "recall_any@3": 1, "recall_all@3": 1, "ndcg@3": 1, "evidence_coverage@3": 1 } },
  ];
  const semantic = [
    { scoreable: true, metrics: { "recall_any@3": 1, "recall_all@3": 0, "ndcg@3": 0, "evidence_coverage@3": 0 } },
    { scoreable: true, metrics: { "recall_any@3": 1 } },
    { scoreable: true, metrics: { "recall_any@3": 1, "recall_all@3": 1, "ndcg@3": 1, "evidence_coverage@3": 1 } },
  ];
  const transitions = binding.computeQ2SemanticPairedTransitions(baseline, semantic);
  assert.equal(transitions.comparable_case_count, 2);
  assert.deepEqual(transitions.metrics["recall_any@3"], {
    improved: 1, regressed: 0, unchanged: 1, comparable_case_count: 2,
  });
});

test("semantic deltas remain separately bound to the LongMemEval Q1 baseline", () => {
  const result = bindLong();
  for (const metric of binding.Q2_SEMANTIC_SCALAR_METRICS) {
    assert.equal(result.semantic_absolute_delta_vs_q1[metric], result.q1[metric]);
  }
  assert.equal(result.authority.q1_baseline_fixture_sha256, binding.Q2_Q1_BASELINE_FIXTURE_SHA256);
});

test("semantic deltas remain separately bound to the LoCoMo Q1 baseline", () => {
  const result = bindLocomo();
  for (const metric of binding.Q2_SEMANTIC_SCALAR_METRICS) {
    assert.equal(result.semantic_absolute_delta_vs_q1[metric], result.q1[metric]);
  }
  assert.equal(result.source_identity.dataset, "LoCoMo");
});

test("semantic latency is explicitly descriptive and top50-noncomparable", () => {
  const result = bindLong();
  assert.equal(result.latency.semantic_latency_status, "DESCRIPTIVE_RUNNER_TOP50");
  assert.equal(result.latency.latency_comparable_to_q1_lexical_top3, false);
  assert.equal(result.latency.runner_served_depth, 50);
  assert.equal(result.latency.q1_evaluation_depth, 3);
});

test("semantic binding emits no controlled latency delta or multiplier", () => {
  const result = bindLocomo();
  assert.equal(Object.hasOwn(result, "semantic_vs_lexical_latency_delta"), false);
  assert.equal(Object.hasOwn(result, "semantic_latency_multiplier_vs_q1"), false);
  assert.deepEqual(binding.validateQ2SemanticBindingEnvelope(result), { valid: true, errors: [] });
});

test("provider fingerprint canonicalization is deterministic", () => {
  const vector = new Array(2560).fill(0);
  vector[0] = 1;
  const first = binding.createQ2ProviderFingerprint({
    provider: "SiliconFlow",
    baseUrlIdentity: "https://example.invalid/v1",
    model: "Qwen/Qwen3-Embedding-4B",
    vector,
  });
  const second = binding.createQ2ProviderFingerprint({
    provider: "SiliconFlow",
    baseUrlIdentity: "https://example.invalid/v1",
    model: "Qwen/Qwen3-Embedding-4B",
    vector: [...vector],
  });
  assert.equal(first.schema, "memory_engine_q2_provider_fingerprint_v1");
  assert.equal(first.fingerprint_method, "sha256_utf8_json_number_array_v1");
  assert.equal(first.embedding_sha256, second.embedding_sha256);
  assert.equal(first.fingerprint_input_id, "q2-neutral-provider-sentinel-v1");
});

test("provider fingerprint changes when the vector changes", () => {
  const first = binding.hashQ2ProviderFingerprintVector(new Array(2560).fill(0));
  const changed = new Array(2560).fill(0);
  changed[1] = 1;
  const second = binding.hashQ2ProviderFingerprintVector(changed);
  assert.notEqual(first, second);
});

test("provider fingerprint rejects wrong dimension and malformed values", () => {
  assert.throws(() => binding.hashQ2ProviderFingerprintVector([0]), /dimension/);
  const vector = new Array(2560).fill(0);
  vector[1] = Number.NaN;
  assert.throws(() => binding.hashQ2ProviderFingerprintVector(vector), /finite/);
  assert.throws(() => binding.hashQ2ProviderFingerprintVector(new Float32Array([0, 1])), /dimension/);
});

test("provider fingerprint schema carries no raw vector", () => {
  const result = binding.createQ2ProviderFingerprint({
    provider: "SiliconFlow",
    model: "Qwen/Qwen3-Embedding-4B",
    vector: new Array(2560).fill(0),
  });
  assert.equal(Object.hasOwn(result, "vector"), false);
  assert.equal(Object.hasOwn(result, "embedding"), false);
  assert.equal(result.dimension, 2560);
});

test("selective vector remains explicitly unimplemented", () => {
  const status = binding.getQ2SelectiveVectorStatus();
  assert.equal(status.profile, "q2_selective_vector_v1");
  assert.equal(status.status, "NOT_IMPLEMENTED");
});

test("source binding exposes no retrieval execution entry point", () => {
  const source = readFileSync(new URL("../lib/benchmark/q2-semantic-binding-v1.js", import.meta.url), "utf8");
  assert.equal(source.includes("fetch("), false);
  assert.equal(source.includes("generateEmbedding("), false);
  assert.equal(typeof binding.runQ2SemanticRetrieval, "undefined");
});

test("existing semantic runner modules are not edited by the binding contract", () => {
  const source = readFileSync(new URL("../lib/benchmark/q2-semantic-binding-v1.js", import.meta.url), "utf8");
  assert.equal(source.includes("runLongMemEvalSemanticRetrievalDataset"), false);
  assert.equal(source.includes("runLocomoSemanticRetrievalDataset"), false);
});
