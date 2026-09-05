import { createHash } from "node:crypto";

import {
  hasLongMemEvalUserTarget,
  normalizeLongMemEvalCase,
} from "./longmemeval-v1.js";
import {
  LOCOMO_DATASET_FILE_COMMIT,
  LOCOMO_DATASET_PATH,
  LOCOMO_DATASET_SHA256,
  LOCOMO_EVIDENCE_STRICT_V1,
  LOCOMO_LICENSE_IDENTITY,
  LOCOMO_UPSTREAM_COMMIT,
  LOCOMO_UPSTREAM_REPOSITORY,
  normalizeLocomoDataset,
} from "./locomo-v1.js";
import {
  LONGMEMEVAL_SEMANTIC_PROFILE,
  LONGMEMEVAL_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA,
  SEMANTIC_EMBEDDING_MODEL,
  SEMANTIC_EMBEDDING_MODEL_REVISION,
  SEMANTIC_EMBEDDING_PROVIDER,
  SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
  SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD,
} from "./longmemeval-semantic-retrieval-runner-v1.js";
import {
  LOCOMO_SEMANTIC_BENCHMARK_CLOCK_CONTRACT,
  LOCOMO_SEMANTIC_EMBEDDING_MODEL,
  LOCOMO_SEMANTIC_EMBEDDING_MODEL_REVISION,
  LOCOMO_SEMANTIC_EMBEDDING_PROVIDER,
  LOCOMO_SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
  LOCOMO_SEMANTIC_HOST_MANAGER_MODE,
  LOCOMO_SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD,
  LOCOMO_SEMANTIC_PROFILE,
  LOCOMO_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA,
  LOCOMO_SEMANTIC_TOP_K,
  LOCOMO_SEMANTIC_VECTOR_TOP_K,
} from "./locomo-semantic-retrieval-runner-v2.js";
import {
  aggregateQ1EvidenceRankingAt3,
  Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
  scoreQ1EvidenceRankingAt3,
  summarizeQ1LatencyWindow,
} from "./q1-product-metric-contract-v1.js";

export const Q2_SEMANTIC_BINDING_SCHEMA = "memory_engine_q2_semantic_binding_v1";
export const Q2_SEMANTIC_BINDING_VERSION = "q2_semantic_binding_v1";
export const Q2_SEMANTIC_PROFILE = "q2_always_vector_v1";
export const Q2_ALWAYS_VECTOR_PROFILE = Q2_SEMANTIC_PROFILE;

export const Q2_SEMANTIC_RUNNER_SERVED_DEPTH = 50;
export const Q2_SEMANTIC_Q1_EVALUATION_DEPTH = 3;
export const Q2_SEMANTIC_TOP_K = Q2_SEMANTIC_RUNNER_SERVED_DEPTH;
export const Q2_SEMANTIC_VECTOR_REQUIRED = true;
export const Q2_SEMANTIC_VECTOR_SKIP_ALLOWED = false;
export const Q2_SEMANTIC_VECTOR_ERROR_ALLOWED = false;
export const Q2_SEMANTIC_HOST_MANAGER_FALLBACK_ALLOWED = false;

export const Q2_Q1_BASELINE_FIXTURE_SHA256 =
  "1867ad5ebd4368ad967c2f491f21fc888e27df3eea122741c5a4b42430bff042";
export const Q2_A2_ABLATION_FIXTURE_SHA256 =
  "ae3304c41e347370c019d06667d062dd305ef147acb8ad6d957debd42785ea1d";
export const Q2_Q2_A2_FIXTURE_SHA256 = Q2_A2_ABLATION_FIXTURE_SHA256;
export const Q2_Q1_BASELINE_FIXTURE_PATH = "test/fixtures/q1-current-baseline-v1.json";
export const Q2_A2_ABLATION_FIXTURE_PATH = "test/fixtures/q2-non-vector-ablation-v1.json";

export const Q2_SEMANTIC_LATENCY_STATUS = "DESCRIPTIVE_RUNNER_TOP50";
export const Q2_SEMANTIC_LATENCY_COMPARABLE_TO_Q1_LEXICAL_TOP3 = false;
export const Q2_SEMANTIC_RUNNER_DEPTH = Q2_SEMANTIC_RUNNER_SERVED_DEPTH;
export const Q2_SEMANTIC_EVALUATION_DEPTH = Q2_SEMANTIC_Q1_EVALUATION_DEPTH;

export const Q2_HISTORICAL_SEMANTIC_RESULTS_ROLE = "SANITY_REFERENCE_ONLY";
export const Q2_SELECTIVE_VECTOR_V1 = "NOT_IMPLEMENTED";
export const Q2_SELECTIVE_VECTOR_STATUS = Q2_SELECTIVE_VECTOR_V1;

export const Q2_PROVIDER_FINGERPRINT_SCHEMA = "memory_engine_q2_provider_fingerprint_v1";
export const Q2_PROVIDER_FINGERPRINT_METHOD = "sha256_utf8_json_number_array_v1";
export const Q2_PROVIDER_FINGERPRINT_INPUT_ID = "q2-neutral-provider-sentinel-v1";
export const Q2_PROVIDER_FINGERPRINT_SENTINEL =
  "Neutral benchmark identity sentence for embedding reproducibility.";
export const Q2_PROVIDER_FINGERPRINT_CONTRACT = Object.freeze({
  schema: Q2_PROVIDER_FINGERPRINT_SCHEMA,
  method: Q2_PROVIDER_FINGERPRINT_METHOD,
  input_id: Q2_PROVIDER_FINGERPRINT_INPUT_ID,
  dimension: 2560,
  raw_vector_committed: false,
});

export const Q2_SEMANTIC_SCALAR_METRICS = Object.freeze([
  "recall_any@3",
  "recall_all@3",
  "ndcg@3",
  "evidence_coverage@3",
  "recall_all@3_feasible",
  "cross_session_evidence_coverage@3",
]);

export const Q2_SEMANTIC_PAIRED_METRICS = Object.freeze([
  "recall_any@3",
  "recall_all@3",
  "ndcg@3",
  "evidence_coverage@3",
]);

const LONGMEMEVAL_DATASET = "LongMemEval-S";
const LONGMEMEVAL_DATASET_SHA256 =
  "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442";
const LONGMEMEVAL_Q1_LEXICAL_PROFILE = "production_hybrid_lexical_session_v1";
const LONGMEMEVAL_Q1_CLOCK = 1_800_000_000;
const LONGMEMEVAL_SOURCE_CASES = 500;
const LONGMEMEVAL_SCOREABLE_CASES = 419;
const LONGMEMEVAL_SKIPPED_CASES = 81;

const LOCOMO_DATASET = "LoCoMo";
const LOCOMO_Q1_LEXICAL_PROFILE = "production_hybrid_lexical_dialog_locomo_time_frozen_v2";
const LOCOMO_CLOCK = 1_705_066_861;
const LOCOMO_CONVERSATIONS = 10;
const LOCOMO_SESSIONS = 272;
const LOCOMO_TURNS = 5_882;
const LOCOMO_QA = 1_986;
const LOCOMO_STRICT_SCOREABLE = 1_972;
const LOCOMO_STRICT_SKIPPED = 14;
const LOCOMO_RETRIEVAL_ATTEMPTS = 1_978;

const LONGMEMEVAL_EVIDENCE_DISTRIBUTION = Object.freeze({
  1: 119,
  2: 229,
  3: 39,
  4: 18,
  5: 11,
  6: 3,
});

const LONGMEMEVAL_HISTORICAL_REFERENCE = Object.freeze({
  identity: "B4",
  role: Q2_HISTORICAL_SEMANTIC_RESULTS_ROLE,
  dataset_sha256: LONGMEMEVAL_DATASET_SHA256,
  provider: "SiliconFlow",
  model: "Qwen/Qwen3-Embedding-4B",
  model_revision: "unavailable/unpinned",
  dimension: 2560,
  lexical_confidence_threshold: 0.7,
  historical_top_k: 50,
  historical_scored_cases: 419,
  historical_skipped_cases: 81,
  vector_attempted: 419,
  vector_skipped: 0,
  vector_error: 0,
});

const LOCOMO_HISTORICAL_REFERENCE = Object.freeze({
  identity: "B5-S3",
  role: Q2_HISTORICAL_SEMANTIC_RESULTS_ROLE,
  dataset_sha256: LOCOMO_DATASET_SHA256,
  provider: "SiliconFlow",
  model: "Qwen/Qwen3-Embedding-4B",
  model_revision: "unavailable/unpinned",
  dimension: 2560,
  lexical_confidence_threshold: 0.7,
  historical_top_k: 50,
  historical_vector_top_k: 50,
  benchmark_now_sec: LOCOMO_CLOCK,
  materialization_now_sec: LOCOMO_CLOCK,
  search_now_sec: LOCOMO_CLOCK,
  strict_scored_cases: 1972,
  strict_skipped_cases: 14,
  retrieval_attempts: 1978,
  vector_attempted: 1978,
  vector_skipped: 0,
  vector_error: 0,
});

function freezeBinding(binding) {
  return Object.freeze({
    ...binding,
    source_identity: Object.freeze({ ...binding.source_identity }),
    historical_reference: Object.freeze({ ...binding.historical_reference }),
  });
}

const LONGMEMEVAL_BINDING = freezeBinding({
  dataset_key: "longmemeval",
  dataset: LONGMEMEVAL_DATASET,
  dataset_sha256: LONGMEMEVAL_DATASET_SHA256,
  profile: Q2_SEMANTIC_PROFILE,
  runner_schema: LONGMEMEVAL_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA,
  runner_profile: LONGMEMEVAL_SEMANTIC_PROFILE,
  runner_served_depth: Q2_SEMANTIC_RUNNER_SERVED_DEPTH,
  q1_evaluation_depth: Q2_SEMANTIC_Q1_EVALUATION_DEPTH,
  runner_top_k: Q2_SEMANTIC_RUNNER_SERVED_DEPTH,
  runner_vector_top_k_min: Q2_SEMANTIC_RUNNER_SERVED_DEPTH,
  vector_required: Q2_SEMANTIC_VECTOR_REQUIRED,
  vector_skip_allowed: Q2_SEMANTIC_VECTOR_SKIP_ALLOWED,
  vector_error_allowed: Q2_SEMANTIC_VECTOR_ERROR_ALLOWED,
  host_manager_fallback_allowed: Q2_SEMANTIC_HOST_MANAGER_FALLBACK_ALLOWED,
  benchmark_now_sec: null,
  benchmark_clock_policy: "runner-supplied",
  provider: SEMANTIC_EMBEDDING_PROVIDER,
  model: SEMANTIC_EMBEDDING_MODEL,
  model_revision: SEMANTIC_EMBEDDING_MODEL_REVISION,
  dimension: SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
  lexical_confidence_threshold: SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD,
  historical_reference: LONGMEMEVAL_HISTORICAL_REFERENCE,
  source_identity: {
    dataset: LONGMEMEVAL_DATASET,
    dataset_sha256: LONGMEMEVAL_DATASET_SHA256,
    runner_profile: LONGMEMEVAL_SEMANTIC_PROFILE,
    runner_served_depth: Q2_SEMANTIC_RUNNER_SERVED_DEPTH,
    q1_evaluation_depth: Q2_SEMANTIC_Q1_EVALUATION_DEPTH,
    top_k: Q2_SEMANTIC_RUNNER_SERVED_DEPTH,
    vector_top_k: Q2_SEMANTIC_RUNNER_SERVED_DEPTH,
    benchmark_now_sec: null,
  },
});

const LOCOMO_BINDING = freezeBinding({
  dataset_key: "locomo",
  dataset: LOCOMO_DATASET,
  dataset_sha256: LOCOMO_DATASET_SHA256,
  profile: Q2_SEMANTIC_PROFILE,
  runner_schema: LOCOMO_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA,
  runner_profile: LOCOMO_SEMANTIC_PROFILE,
  runner_served_depth: Q2_SEMANTIC_RUNNER_SERVED_DEPTH,
  q1_evaluation_depth: Q2_SEMANTIC_Q1_EVALUATION_DEPTH,
  runner_top_k: LOCOMO_SEMANTIC_TOP_K,
  runner_vector_top_k_min: LOCOMO_SEMANTIC_VECTOR_TOP_K,
  vector_required: Q2_SEMANTIC_VECTOR_REQUIRED,
  vector_skip_allowed: Q2_SEMANTIC_VECTOR_SKIP_ALLOWED,
  vector_error_allowed: Q2_SEMANTIC_VECTOR_ERROR_ALLOWED,
  host_manager_fallback_allowed: Q2_SEMANTIC_HOST_MANAGER_FALLBACK_ALLOWED,
  benchmark_now_sec: LOCOMO_CLOCK,
  materialization_now_sec: LOCOMO_CLOCK,
  search_now_sec: LOCOMO_CLOCK,
  benchmark_clock_contract: LOCOMO_SEMANTIC_BENCHMARK_CLOCK_CONTRACT,
  provider: LOCOMO_SEMANTIC_EMBEDDING_PROVIDER,
  model: LOCOMO_SEMANTIC_EMBEDDING_MODEL,
  model_revision: LOCOMO_SEMANTIC_EMBEDDING_MODEL_REVISION,
  dimension: LOCOMO_SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
  lexical_confidence_threshold: LOCOMO_SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD,
  host_manager_mode: LOCOMO_SEMANTIC_HOST_MANAGER_MODE,
  evidence_policy: LOCOMO_EVIDENCE_STRICT_V1,
  upstream_repository: LOCOMO_UPSTREAM_REPOSITORY,
  upstream_commit: LOCOMO_UPSTREAM_COMMIT,
  dataset_file_commit: LOCOMO_DATASET_FILE_COMMIT,
  dataset_path: LOCOMO_DATASET_PATH,
  license_identity: LOCOMO_LICENSE_IDENTITY,
  historical_reference: LOCOMO_HISTORICAL_REFERENCE,
  source_identity: {
    dataset: LOCOMO_DATASET,
    dataset_sha256: LOCOMO_DATASET_SHA256,
    runner_profile: LOCOMO_SEMANTIC_PROFILE,
    runner_served_depth: Q2_SEMANTIC_RUNNER_SERVED_DEPTH,
    q1_evaluation_depth: Q2_SEMANTIC_Q1_EVALUATION_DEPTH,
    top_k: LOCOMO_SEMANTIC_TOP_K,
    vector_top_k: LOCOMO_SEMANTIC_VECTOR_TOP_K,
    benchmark_now_sec: LOCOMO_CLOCK,
    materialization_now_sec: LOCOMO_CLOCK,
    search_now_sec: LOCOMO_CLOCK,
    evidence_policy: LOCOMO_EVIDENCE_STRICT_V1,
  },
});

export const Q2_SEMANTIC_PROFILE_BINDINGS = Object.freeze({
  longmemeval: LONGMEMEVAL_BINDING,
  locomo: LOCOMO_BINDING,
});
export const Q2_SEMANTIC_PROFILES = Q2_SEMANTIC_PROFILE_BINDINGS;
export const Q2_SEMANTIC_PROFILE_REGISTRY = Q2_SEMANTIC_PROFILE_BINDINGS;
export const Q2_ALWAYS_VECTOR_BINDINGS = Q2_SEMANTIC_PROFILE_BINDINGS;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function exactEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function boundedError(error) {
  return String(error?.message || error).slice(0, 240);
}

function requireExact(actual, expected, code, details = {}) {
  if (!exactEqual(actual, expected)) {
    const suffix = Object.keys(details).length === 0 ? "" : `:${JSON.stringify(details)}`;
    throw new Error(`${code}${suffix}`);
  }
}

function normalizeDatasetKey(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/[_\s-]+/gu, "");
  if (raw === "longmemeval" || raw === "longmemevals") return "longmemeval";
  if (raw === "locomo") return "locomo";
  return null;
}

export function resolveQ2SemanticProfile(dataset) {
  const key = normalizeDatasetKey(isRecord(dataset) ? dataset.dataset : dataset);
  if (!key) throw new Error(`q2_semantic_unknown_dataset:${String(isRecord(dataset) ? dataset.dataset : dataset)}`);
  return Q2_SEMANTIC_PROFILE_BINDINGS[key];
}

function authorityValue(options, names) {
  const sources = [options, options?.authority, options?.source_identity];
  for (const source of sources) {
    if (!isRecord(source)) continue;
    for (const name of names) {
      if (hasOwn(source, name) && source[name] !== undefined) return source[name];
    }
  }
  return undefined;
}

export function validateQ2SemanticAuthorityHashes(options = {}) {
  const actual = {
    q1_baseline_fixture_sha256: authorityValue(options, [
      "q1BaselineFixtureSha256",
      "q1_baseline_fixture_sha256",
    ]),
    q2_a2_fixture_sha256: authorityValue(options, [
      "q2A2FixtureSha256",
      "q2_a2_fixture_sha256",
      "q2AblationFixtureSha256",
    ]),
  };
  const expected = {
    q1_baseline_fixture_sha256: Q2_Q1_BASELINE_FIXTURE_SHA256,
    q2_a2_fixture_sha256: Q2_A2_ABLATION_FIXTURE_SHA256,
  };
  const mismatches = Object.keys(expected)
    .filter(key => actual[key] !== expected[key])
    .map(key => ({ name: key, actual: actual[key] ?? null, expected: expected[key] }));
  return { valid: mismatches.length === 0, actual, expected, mismatches };
}

export function assertQ2SemanticAuthorityHashes(options = {}) {
  const validation = validateQ2SemanticAuthorityHashes(options);
  if (!validation.valid) {
    throw new Error(`q2_semantic_authority_hash_mismatch:${validation.mismatches.map(item => item.name).join(",")}`);
  }
  return validation;
}

function q1BaselineTrackKey(binding) {
  return binding.dataset_key === "longmemeval"
    ? "longmemeval_lexical_session"
    : "locomo_lexical_strict_session";
}

function resolveQ1BaselineTrack(options, binding) {
  const direct = options?.q1BaselineTrack || options?.q1_baseline_track;
  const envelope = options?.q1Baseline || options?.q1BaselineFixture || options?.q1_baseline;
  const track = direct || envelope?.tracks?.[q1BaselineTrackKey(binding)] || envelope?.[q1BaselineTrackKey(binding)];
  if (!isRecord(track)) throw new Error(`q2_semantic_q1_baseline_track_required:${binding.dataset}`);
  const source = track.source_identity;
  if (!isRecord(source)
      || source.dataset !== binding.dataset
      || source.dataset_sha256 !== binding.dataset_sha256
      || source.top_k !== Q2_SEMANTIC_Q1_EVALUATION_DEPTH
      || source.retrieval_profile !== (
        binding.dataset_key === "longmemeval" ? LONGMEMEVAL_Q1_LEXICAL_PROFILE : LOCOMO_Q1_LEXICAL_PROFILE
      )
      || source.benchmark_now_sec !== (
        binding.dataset_key === "longmemeval" ? LONGMEMEVAL_Q1_CLOCK : LOCOMO_CLOCK
      )) {
    throw new Error(`q2_semantic_q1_baseline_identity_mismatch:${binding.dataset}`);
  }
  if (!isRecord(track.q1)) throw new Error(`q2_semantic_q1_baseline_metrics_required:${binding.dataset}`);
  for (const metric of Q2_SEMANTIC_SCALAR_METRICS) {
    if (!finiteNumber(track.q1[metric])) throw new Error(`q2_semantic_q1_baseline_metric_invalid:${binding.dataset}:${metric}`);
  }
  return track;
}

function baselineComparison(semanticAggregate, baselineTrack) {
  const deltas = Object.fromEntries(Q2_SEMANTIC_SCALAR_METRICS.map(metric => [
    metric,
    semanticAggregate?.[metric] === null || !finiteNumber(semanticAggregate?.[metric])
      ? null
      : semanticAggregate[metric] - baselineTrack.q1[metric],
  ]));
  return {
    q1_baseline_metrics: Object.fromEntries(Q2_SEMANTIC_SCALAR_METRICS.map(metric => [metric, baselineTrack.q1[metric]])),
    semantic_absolute_delta_vs_q1: deltas,
  };
}

function metadataFor(binding, run, extra = {}) {
  const sourceIdentity = {
    ...binding.source_identity,
    benchmark_now_sec: binding.dataset_key === "longmemeval"
      ? (run?.run?.benchmark_now_sec ?? run?.provenance?.benchmark_now_sec ?? null)
      : LOCOMO_CLOCK,
  };
  return {
    provenance: "BENCHMARK_DERIVED",
    source_identity: sourceIdentity,
    dataset_identity: binding.dataset,
    ...extra,
  };
}

function scoreUnknown(metadata) {
  return scoreQ1EvidenceRankingAt3({
    ...metadata,
    gold_evidence_ids: [],
    ranked_retrieved_ids: [],
  });
}

function scoreQ1Top3(metadata, goldEvidenceIds, retrievedSessionIds) {
  return scoreQ1EvidenceRankingAt3({
    ...metadata,
    gold_evidence_ids: goldEvidenceIds,
    ranked_retrieved_ids: retrievedSessionIds.slice(0, Q2_SEMANTIC_Q1_EVALUATION_DEPTH),
  });
}

function sourceShapeLongMemEval(records) {
  if (!Array.isArray(records) || records.length !== LONGMEMEVAL_SOURCE_CASES) {
    throw new Error(`q2_semantic_longmemeval_source_cases:${records?.length ?? "invalid"}`);
  }
  let items;
  try {
    items = records.map(record => normalizeLongMemEvalCase(record));
  } catch (error) {
    throw new Error(`q2_semantic_longmemeval_source_invalid:${boundedError(error)}`);
  }
  const scored = items.filter(item => !item.abstention && hasLongMemEvalUserTarget(item));
  const skipped = items.length - scored.length;
  requireExact(scored.length, LONGMEMEVAL_SCOREABLE_CASES, "q2_semantic_longmemeval_scoreable_cases");
  requireExact(skipped, LONGMEMEVAL_SKIPPED_CASES, "q2_semantic_longmemeval_skipped_cases");
  const abstention = items.filter(item => item.abstention).length;
  const noUserTarget = items.filter(item => !hasLongMemEvalUserTarget(item)).length;
  requireExact(abstention, 30, "q2_semantic_longmemeval_abstention_cases");
  requireExact(noUserTarget, 51, "q2_semantic_longmemeval_no_user_target_cases");
  const distribution = {};
  for (const item of scored) {
    const count = item.evidence_session_ids.length;
    distribution[count] = (distribution[count] || 0) + 1;
  }
  requireExact(distribution, LONGMEMEVAL_EVIDENCE_DISTRIBUTION, "q2_semantic_longmemeval_evidence_distribution");
  return { items, scored, skipped };
}

function sourceShapeLocomo(records) {
  let items;
  try {
    items = normalizeLocomoDataset(records, { evidencePolicy: LOCOMO_EVIDENCE_STRICT_V1 });
  } catch (error) {
    throw new Error(`q2_semantic_locomo_source_invalid:${boundedError(error)}`);
  }
  const qaCount = items.reduce((sum, item) => sum + item.questions.length, 0);
  const sessionCount = items.reduce((sum, item) => sum + item.sessions.length, 0);
  const turnCount = items.reduce((sum, item) => sum + item.sessions.reduce((inner, session) => (
    inner + session.turns.length
  ), 0), 0);
  const questions = items.flatMap(item => item.questions.map(question => ({ item, question })));
  const scoreable = questions.filter(({ question }) => question.scoreable === true);
  requireExact(items.length, LOCOMO_CONVERSATIONS, "q2_semantic_locomo_conversations");
  requireExact(sessionCount, LOCOMO_SESSIONS, "q2_semantic_locomo_sessions");
  requireExact(turnCount, LOCOMO_TURNS, "q2_semantic_locomo_turns");
  requireExact(qaCount, LOCOMO_QA, "q2_semantic_locomo_qa");
  requireExact(scoreable.length, LOCOMO_STRICT_SCOREABLE, "q2_semantic_locomo_strict_scoreable");
  requireExact(questions.length - scoreable.length, LOCOMO_STRICT_SKIPPED, "q2_semantic_locomo_strict_skipped");
  return { items, questions, scoreable };
}

function semanticRunIdentity(run, binding) {
  if (!isRecord(run) || !Array.isArray(run.results) || !isRecord(run.run)) {
    throw new Error(`q2_semantic_run_invalid:${binding.dataset}`);
  }
  requireExact(run.schema, binding.runner_schema, "q2_semantic_runner_schema", { dataset: binding.dataset });
  requireExact(run.profile, binding.runner_profile, "q2_semantic_runner_profile", { dataset: binding.dataset });
  requireExact(run.run.profile, binding.runner_profile, "q2_semantic_run_profile", { dataset: binding.dataset });
  requireExact(run.run.top_k, Q2_SEMANTIC_RUNNER_SERVED_DEPTH, "q2_semantic_runner_top_k", { dataset: binding.dataset });
  if (Number(run.run.vector_top_k) < binding.runner_vector_top_k_min) {
    throw new Error(`q2_semantic_runner_vector_top_k:${binding.dataset}`);
  }
  const runSha = run.run.dataset_sha256 ?? run.provenance?.dataset_sha256;
  requireExact(runSha, binding.dataset_sha256, "q2_semantic_dataset_sha256", { dataset: binding.dataset });
  if (run.provenance?.dataset_sha256 !== undefined) {
    requireExact(run.provenance.dataset_sha256, binding.dataset_sha256, "q2_semantic_provenance_dataset_sha256", { dataset: binding.dataset });
  }
  if (binding.dataset_key === "locomo") {
    requireExact(run.run.benchmark_now_sec, LOCOMO_CLOCK, "q2_semantic_locomo_benchmark_clock");
    requireExact(run.run.materialization_now_sec, LOCOMO_CLOCK, "q2_semantic_locomo_materialization_clock");
    requireExact(run.run.search_now_sec, LOCOMO_CLOCK, "q2_semantic_locomo_search_clock");
  }
  return run;
}

function validateVectorEvidence(result, binding, index) {
  if (!isRecord(result) || !Array.isArray(result.retrieved_session_ids)) {
    throw new Error(`q2_semantic_retrieved_session_ids_required:${binding.dataset}:${index}`);
  }
  const diagnostics = result.diagnostics;
  const provenance = isRecord(result.provenance) ? result.provenance : diagnostics;
  if (!isRecord(diagnostics) || !isRecord(provenance)) {
    throw new Error(`q2_semantic_vector_evidence_missing:${binding.dataset}:${index}`);
  }
  if (diagnostics.vector_skipped === true || Number(provenance.vector_skipped_count) !== 0) {
    throw new Error(`q2_semantic_vector_skipped:${binding.dataset}:${index}`);
  }
  if (diagnostics.vector_error || Number(provenance.vector_error_count) !== 0) {
    throw new Error(`q2_semantic_vector_error:${binding.dataset}:${index}`);
  }
  if (diagnostics.vector_backend !== "lancedb" || diagnostics.vector_stage !== "lancedb_search") {
    throw new Error(`q2_semantic_lancedb_path_missing:${binding.dataset}:${index}`);
  }
  if (diagnostics.vector_in_fusion !== true || !diagnostics.channels?.includes("vector")) {
    throw new Error(`q2_semantic_vector_not_in_fusion:${binding.dataset}:${index}`);
  }
  if (Number(provenance.vector_attempted_count) < 1 || Number(diagnostics.vector_attempted_count) < 1) {
    throw new Error(`q2_semantic_vector_not_attempted:${binding.dataset}:${index}`);
  }
  const fallbackCount = Math.max(
    Number(diagnostics.host_manager_fallback_count || 0),
    Number(provenance.host_manager_fallback_count || 0),
  );
  if (fallbackCount > 0) throw new Error(`q2_semantic_host_manager_fallback:${binding.dataset}:${index}`);
  if (provenance.dataset_sha256 !== undefined && provenance.dataset_sha256 !== binding.dataset_sha256) {
    throw new Error(`q2_semantic_result_dataset_sha256:${binding.dataset}:${index}`);
  }
  return {
    vector_attempted: true,
    vector_skipped: false,
    vector_error: false,
    vector_in_fusion: true,
    lancedb_path: true,
    host_manager_fallback: false,
  };
}

function countLatencyRows(binding, results) {
  const attempted = binding.dataset_key === "longmemeval"
    ? results.filter(result => result?.skipped !== true)
    : results.filter(result => isRecord(result?.diagnostics));
  if (attempted.some(result => !finiteNumber(Number(result.latency_ms)) || Number(result.latency_ms) < 0)) {
    throw new Error(`q2_semantic_latency_sample_invalid:${binding.dataset}`);
  }
  return attempted.map(result => Number(result.latency_ms));
}

function summarizeSemanticLatency(binding, run, results) {
  const samples = countLatencyRows(binding, results);
  const expectedStarted = binding.dataset_key === "longmemeval"
    ? LONGMEMEVAL_SCOREABLE_CASES
    : LOCOMO_RETRIEVAL_ATTEMPTS;
  requireExact(samples.length, expectedStarted, "q2_semantic_latency_attempt_count", { dataset: binding.dataset });
  const summary = summarizeQ1LatencyWindow({
    started_trace_count: expectedStarted,
    completed_latency_samples: samples,
    incomplete_trace_count: 0,
    error_or_timeout_count: 0,
    provenance: "BENCHMARK_DERIVED",
    source_identity: {
      ...binding.source_identity,
      runner_served_depth: Q2_SEMANTIC_RUNNER_SERVED_DEPTH,
      q1_evaluation_depth: Q2_SEMANTIC_Q1_EVALUATION_DEPTH,
    },
    dataset_identity: binding.dataset,
  });
  const runSummary = run.summary || {};
  const runProvenance = run.provenance || {};
  return {
    ...summary,
    semantic_latency_status: Q2_SEMANTIC_LATENCY_STATUS,
    latency_comparable_to_q1_lexical_top3: Q2_SEMANTIC_LATENCY_COMPARABLE_TO_Q1_LEXICAL_TOP3,
    runner_served_depth: Q2_SEMANTIC_RUNNER_SERVED_DEPTH,
    q1_evaluation_depth: Q2_SEMANTIC_Q1_EVALUATION_DEPTH,
    provider_call_count: runSummary.provider_call_count ?? runProvenance.provider_call_count ?? null,
    embedding_cache_hits: runSummary.embedding_cache_hits ?? runProvenance.embedding_cache_hits ?? null,
    corpus_build_latency_ms_total: runSummary.corpus_build_latency_ms_total
      ?? runProvenance.corpus_build_latency
      ?? null,
    retrieval_latency_ms_total: runSummary.retrieval_latency_ms_total
      ?? runProvenance.retrieval_latency
      ?? null,
  };
}

function groupedAggregates(rows, keys) {
  const groups = new Map();
  for (const { key, row } of rows) {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Object.fromEntries([...groups.entries()].map(([key, group]) => [
    key,
    aggregateQ1EvidenceRankingAt3(group),
  ]));
}

function profileSourceIdentity(binding, run) {
  return {
    ...binding.source_identity,
    q2_semantic_binding_schema: Q2_SEMANTIC_BINDING_SCHEMA,
    q1_metric_contract_schema: Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
    runner_schema: binding.runner_schema,
    runner_profile: binding.runner_profile,
    runner_served_depth: Q2_SEMANTIC_RUNNER_SERVED_DEPTH,
    q1_evaluation_depth: Q2_SEMANTIC_Q1_EVALUATION_DEPTH,
    benchmark_now_sec: binding.dataset_key === "locomo"
      ? LOCOMO_CLOCK
      : (run.run?.benchmark_now_sec ?? run.provenance?.benchmark_now_sec ?? null),
  };
}

function buildBindingResult({ binding, run, denominator, q1, sourceBreakdown, latency, caseScores, baselineTrack, vectorEvidence }) {
  const comparison = baselineComparison(q1, baselineTrack);
  return {
    schema: Q2_SEMANTIC_BINDING_SCHEMA,
    binding_version: Q2_SEMANTIC_BINDING_VERSION,
    profile: Q2_SEMANTIC_PROFILE,
    provenance: "BENCHMARK_DERIVED",
    source_identity: profileSourceIdentity(binding, run),
    runner_contract: {
      runner_schema: binding.runner_schema,
      runner_profile: binding.runner_profile,
      runner_served_depth: Q2_SEMANTIC_RUNNER_SERVED_DEPTH,
      q1_quality_evaluation_depth: Q2_SEMANTIC_Q1_EVALUATION_DEPTH,
      vector_required: true,
      vector_skip_allowed: false,
      vector_error_allowed: false,
      host_manager_fallback_allowed: false,
    },
    authority: {
      q1_baseline_fixture_sha256: Q2_Q1_BASELINE_FIXTURE_SHA256,
      q2_a2_fixture_sha256: Q2_A2_ABLATION_FIXTURE_SHA256,
      historical_semantic_results_role: Q2_HISTORICAL_SEMANTIC_RESULTS_ROLE,
    },
    denominator,
    q1_metric_contract_schema: Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
    q1,
    source_breakdown: sourceBreakdown,
    ...comparison,
    latency,
    vector_evidence: vectorEvidence,
    paired_transitions: null,
    selective_vector: {
      status: Q2_SELECTIVE_VECTOR_V1,
      reason: "current semantic qualification runners require vector execution on every retrieval",
    },
    case_scores: caseScores,
  };
}

function attachPairedTransitions(result, options) {
  const lexicalScores = options?.q1CaseScores || options?.lexicalCaseScores;
  if (lexicalScores === undefined) {
    result.paired_transitions = {
      status: "REQUIRES_CASE_ALIGNED_Q1_RUN",
      tolerance: 1e-12,
      metrics: [...Q2_SEMANTIC_PAIRED_METRICS],
    };
    if (options?.requirePairedTransitions === true) {
      throw new Error("q2_semantic_paired_case_scores_required");
    }
    return result;
  }
  result.paired_transitions = computeQ2SemanticPairedTransitions(lexicalScores, result.case_scores);
  return result;
}

function bindingArgs(recordsOrInput, runOrOptions, maybeOptions) {
  if (Array.isArray(recordsOrInput)) {
    return { records: recordsOrInput, run: runOrOptions, options: maybeOptions || {} };
  }
  if (isRecord(recordsOrInput) && Array.isArray(recordsOrInput.records)) {
    return {
      records: recordsOrInput.records,
      run: recordsOrInput.semantic_run || recordsOrInput.run || runOrOptions,
      options: maybeOptions || recordsOrInput.options || (isRecord(runOrOptions) && !runOrOptions.results ? runOrOptions : {}),
    };
  }
  throw new Error("q2_semantic_binding_records_required");
}

export function bindQ2LongMemEvalAlwaysVectorRun(recordsOrInput, runOrOptions, maybeOptions) {
  const { records, run, options } = bindingArgs(recordsOrInput, runOrOptions, maybeOptions);
  const binding = LONGMEMEVAL_BINDING;
  assertQ2SemanticAuthorityHashes(options);
  const baselineTrack = resolveQ1BaselineTrack(options, binding);
  const source = sourceShapeLongMemEval(records);
  semanticRunIdentity(run, binding);
  requireExact(run.results.length, LONGMEMEVAL_SOURCE_CASES, "q2_semantic_longmemeval_result_count");
  requireExact(run.summary?.cases, LONGMEMEVAL_SOURCE_CASES, "q2_semantic_longmemeval_summary_cases");
  requireExact(run.summary?.scored_cases, LONGMEMEVAL_SCOREABLE_CASES, "q2_semantic_longmemeval_summary_scored");
  requireExact(run.summary?.skipped_cases, LONGMEMEVAL_SKIPPED_CASES, "q2_semantic_longmemeval_summary_skipped");
  requireExact(run.provenance?.vector_attempted_count, LONGMEMEVAL_SCOREABLE_CASES, "q2_semantic_longmemeval_vector_attempted");
  requireExact(run.provenance?.vector_skipped_count, 0, "q2_semantic_longmemeval_vector_skipped");
  requireExact(run.provenance?.vector_error_count, 0, "q2_semantic_longmemeval_vector_error");

  const q1Rows = [];
  const grouped = [];
  const vectorEvidence = { attempted: 0, skipped: 0, errors: 0, in_fusion: 0, lancedb_path: 0, host_manager_fallback: 0 };
  for (let index = 0; index < source.items.length; index += 1) {
    const item = source.items[index];
    const result = run.results[index];
    requireExact(result?.question_id, item.question_id, "q2_semantic_longmemeval_result_identity", { index });
    const metadata = metadataFor(binding, run, { question_type: item.question_type });
    let score;
    if (!item.abstention && hasLongMemEvalUserTarget(item)) {
      if (result?.skipped === true) throw new Error(`q2_semantic_longmemeval_scored_case_skipped:${index}`);
      const evidence = validateVectorEvidence(result, binding, index);
      vectorEvidence.attempted += Number(evidence.vector_attempted);
      vectorEvidence.in_fusion += Number(evidence.vector_in_fusion);
      vectorEvidence.lancedb_path += Number(evidence.lancedb_path);
      vectorEvidence.host_manager_fallback += Number(evidence.host_manager_fallback);
      score = scoreQ1Top3(metadata, item.evidence_session_ids, result.retrieved_session_ids);
    } else {
      if (result?.skipped !== true) throw new Error(`q2_semantic_longmemeval_skip_identity:${index}`);
      score = scoreUnknown(metadata);
    }
    q1Rows.push(score);
    grouped.push({ key: item.question_type, row: score });
  }
  const q1 = aggregateQ1EvidenceRankingAt3(q1Rows);
  const denominator = {
    source_case_count: LONGMEMEVAL_SOURCE_CASES,
    scoreable_case_count: LONGMEMEVAL_SCOREABLE_CASES,
    skipped_case_count: LONGMEMEVAL_SKIPPED_CASES,
    unknown_or_unscoreable_case_count: LONGMEMEVAL_SKIPPED_CASES,
    retrieval_attempt_count: LONGMEMEVAL_SCOREABLE_CASES,
    runner_served_depth: Q2_SEMANTIC_RUNNER_SERVED_DEPTH,
    q1_evaluation_depth: Q2_SEMANTIC_Q1_EVALUATION_DEPTH,
    evidence_session_count_distribution: { ...LONGMEMEVAL_EVIDENCE_DISTRIBUTION },
  };
  const result = buildBindingResult({
    binding,
    run,
    denominator,
    q1,
    sourceBreakdown: groupedAggregates(grouped, "question_type"),
    latency: summarizeSemanticLatency(binding, run, run.results),
    caseScores: q1Rows,
    baselineTrack,
    vectorEvidence: {
      ...vectorEvidence,
      skipped: 0,
      errors: 0,
      expected_attempted: LONGMEMEVAL_SCOREABLE_CASES,
      host_manager_fallback_allowed: false,
    },
  });
  return attachPairedTransitions(result, options);
}

function locomoResultKey(result) {
  return `${result?.sample_id}:${result?.qa_index}`;
}

function buildLocomoResultMap(results) {
  const map = new Map();
  for (const result of results) {
    const key = locomoResultKey(result);
    if (key.startsWith("undefined:") || map.has(key)) throw new Error(`q2_semantic_locomo_result_identity_duplicate:${key}`);
    map.set(key, result);
  }
  return map;
}

export function bindQ2LocomoAlwaysVectorRun(recordsOrInput, runOrOptions, maybeOptions) {
  const { records, run, options } = bindingArgs(recordsOrInput, runOrOptions, maybeOptions);
  const binding = LOCOMO_BINDING;
  assertQ2SemanticAuthorityHashes(options);
  const baselineTrack = resolveQ1BaselineTrack(options, binding);
  const source = sourceShapeLocomo(records);
  semanticRunIdentity(run, binding);
  requireExact(run.summary?.cases, LOCOMO_QA, "q2_semantic_locomo_summary_cases");
  requireExact(run.results.length, LOCOMO_QA, "q2_semantic_locomo_result_count");
  requireExact(run.summary?.strict?.scored_cases, LOCOMO_STRICT_SCOREABLE, "q2_semantic_locomo_summary_strict_scored");
  requireExact(run.summary?.strict?.skipped_cases, LOCOMO_STRICT_SKIPPED, "q2_semantic_locomo_summary_strict_skipped");
  requireExact(run.summary?.sensitivity?.scored_cases, LOCOMO_RETRIEVAL_ATTEMPTS, "q2_semantic_locomo_summary_retrieval_attempts");
  requireExact(run.summary?.sensitivity?.skipped_cases, 8, "q2_semantic_locomo_summary_sensitivity_skipped");
  requireExact(run.summary?.vector_attempted_count, LOCOMO_RETRIEVAL_ATTEMPTS, "q2_semantic_locomo_vector_attempted");
  requireExact(run.summary?.vector_skipped_count, 0, "q2_semantic_locomo_vector_skipped");
  requireExact(run.summary?.vector_error_count, 0, "q2_semantic_locomo_vector_error");
  requireExact(run.summary?.host_manager_fallback_count, 0, "q2_semantic_locomo_host_manager_fallback");
  requireExact(run.run?.primary_metric_level, "dialog", "q2_semantic_locomo_primary_level");
  requireExact(run.run?.compatibility_metric_level, "session_projection", "q2_semantic_locomo_compatibility_level");

  const resultMap = buildLocomoResultMap(run.results);
  const q1Rows = [];
  const grouped = [];
  const vectorEvidence = { attempted: 0, skipped: 0, errors: 0, in_fusion: 0, lancedb_path: 0, host_manager_fallback: 0 };
  for (const { item, question } of source.questions) {
    const key = `${item.sample_id}:${question.qa_index}`;
    const result = resultMap.get(key);
    if (!result) throw new Error(`q2_semantic_locomo_result_missing:${key}`);
    const metadata = metadataFor(binding, run, {
      category: question.category,
      category_name: question.category_name,
      evidence_policy: LOCOMO_EVIDENCE_STRICT_V1,
    });
    let score;
    if (question.scoreable === true) {
      if (result.strict_session === undefined && result.strict === undefined) {
        throw new Error(`q2_semantic_locomo_strict_result_missing:${key}`);
      }
      const evidence = validateVectorEvidence(result, binding, key);
      vectorEvidence.attempted += Number(evidence.vector_attempted);
      vectorEvidence.in_fusion += Number(evidence.vector_in_fusion);
      vectorEvidence.lancedb_path += Number(evidence.lancedb_path);
      vectorEvidence.host_manager_fallback += Number(evidence.host_manager_fallback);
      score = scoreQ1Top3(metadata, question.evidence_session_ids, result.retrieved_session_ids);
    } else {
      score = scoreUnknown(metadata);
    }
    q1Rows.push(score);
    grouped.push({ key: question.category_name, row: score });
  }
  const q1 = aggregateQ1EvidenceRankingAt3(q1Rows);
  const denominator = {
    conversation_count: LOCOMO_CONVERSATIONS,
    session_count: LOCOMO_SESSIONS,
    turn_count: LOCOMO_TURNS,
    qa_count: LOCOMO_QA,
    strict_metric_case_count: LOCOMO_STRICT_SCOREABLE,
    strict_skipped_case_count: LOCOMO_STRICT_SKIPPED,
    retrieval_attempt_count: LOCOMO_RETRIEVAL_ATTEMPTS,
    runner_served_depth: Q2_SEMANTIC_RUNNER_SERVED_DEPTH,
    q1_evaluation_depth: Q2_SEMANTIC_Q1_EVALUATION_DEPTH,
    evidence_policy: LOCOMO_EVIDENCE_STRICT_V1,
  };
  const result = buildBindingResult({
    binding,
    run,
    denominator,
    q1,
    sourceBreakdown: groupedAggregates(grouped, "category_name"),
    latency: summarizeSemanticLatency(binding, run, run.results),
    caseScores: q1Rows,
    baselineTrack,
    vectorEvidence: {
      ...vectorEvidence,
      skipped: 0,
      errors: 0,
      expected_attempted: LOCOMO_RETRIEVAL_ATTEMPTS,
      host_manager_fallback_allowed: false,
    },
  });
  return attachPairedTransitions(result, options);
}

export const bindQ2LongMemEvalSemanticRun = bindQ2LongMemEvalAlwaysVectorRun;
export const bindQ2LocomoSemanticRun = bindQ2LocomoAlwaysVectorRun;

function scoreValue(row, metric) {
  if (isRecord(row?.metrics) && hasOwn(row.metrics, metric)) return row.metrics[metric];
  return row?.[metric];
}

function scoreableRow(row) {
  return row?.scoreable === true && isRecord(row?.metrics || row);
}

export function computeQ2SemanticPairedTransitions(q1CaseScores, semanticCaseScores, { tolerance = 1e-12 } = {}) {
  if (!Array.isArray(q1CaseScores) || !Array.isArray(semanticCaseScores)) {
    throw new Error("q2_semantic_paired_case_scores_must_be_arrays");
  }
  requireExact(q1CaseScores.length, semanticCaseScores.length, "q2_semantic_paired_case_count");
  const metrics = {};
  for (const metric of Q2_SEMANTIC_PAIRED_METRICS) {
    metrics[metric] = { improved: 0, regressed: 0, unchanged: 0, comparable_case_count: 0 };
  }
  let comparableCaseCount = 0;
  for (let index = 0; index < q1CaseScores.length; index += 1) {
    const baseline = q1CaseScores[index];
    const semantic = semanticCaseScores[index];
    if (!scoreableRow(baseline) || !scoreableRow(semantic)) continue;
    comparableCaseCount += 1;
    for (const metric of Q2_SEMANTIC_PAIRED_METRICS) {
      const left = scoreValue(baseline, metric);
      const right = scoreValue(semantic, metric);
      if (!finiteNumber(left) || !finiteNumber(right)) continue;
      metrics[metric].comparable_case_count += 1;
      if (right - left > tolerance) metrics[metric].improved += 1;
      else if (left - right > tolerance) metrics[metric].regressed += 1;
      else metrics[metric].unchanged += 1;
    }
  }
  return {
    status: "READY",
    tolerance,
    comparable_case_count: comparableCaseCount,
    unknown_or_unscoreable_case_count: q1CaseScores.length - comparableCaseCount,
    metrics,
  };
}

export function assertQ2SemanticNoCrossDatasetPooling(values) {
  const rows = Array.isArray(values) ? values : Object.values(values || {});
  const identities = rows.map(value => value?.source_identity).filter(isRecord);
  if (identities.length !== rows.length) throw new Error("q2_semantic_source_identity_required");
  const datasets = [...new Set(identities.map(identity => identity.dataset))];
  const hashes = [...new Set(identities.map(identity => identity.dataset_sha256))];
  if (datasets.length > 1) throw new Error(`q2_semantic_cross_dataset_pooling_refused:${datasets.join(",")}`);
  if (hashes.length > 1) throw new Error("q2_semantic_cross_dataset_source_hash_pooling_refused");
  return { valid: true, datasets, dataset_hashes: hashes };
}

function vectorValues(vector) {
  if (Array.isArray(vector)) return [...vector];
  if (ArrayBuffer.isView(vector) && !(vector instanceof DataView)) return Array.from(vector);
  throw new Error("q2_provider_fingerprint_vector_must_be_array_or_typed_array");
}

export function serializeQ2ProviderFingerprintVector(vector, { dimension = 2560 } = {}) {
  const values = vectorValues(vector);
  if (values.length !== dimension) throw new Error(`q2_provider_fingerprint_dimension:${values.length}:${dimension}`);
  if (values.length === 0 || values.some(value => typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error("q2_provider_fingerprint_vector_must_be_finite");
  }
  return JSON.stringify(values.map(value => Number(value)));
}

export function hashQ2ProviderFingerprintVector(vector, options = {}) {
  const serialized = serializeQ2ProviderFingerprintVector(vector, options);
  return createHash("sha256").update(Buffer.from(serialized, "utf8")).digest("hex");
}

export function createQ2ProviderFingerprint({
  provider = null,
  baseUrlIdentity = null,
  model = null,
  modelRevision = "unavailable/unpinned",
  dimension = 2560,
  vector,
  observedAt = null,
  fingerprintInputId = Q2_PROVIDER_FINGERPRINT_INPUT_ID,
} = {}) {
  if (typeof provider !== "string" || provider.trim() === "") throw new Error("q2_provider_fingerprint_provider_required");
  if (typeof model !== "string" || model.trim() === "") throw new Error("q2_provider_fingerprint_model_required");
  if (modelRevision !== null && typeof modelRevision !== "string") throw new Error("q2_provider_fingerprint_revision_invalid");
  if (baseUrlIdentity !== null && typeof baseUrlIdentity !== "string") throw new Error("q2_provider_fingerprint_base_url_invalid");
  if (observedAt !== null && typeof observedAt !== "string") throw new Error("q2_provider_fingerprint_observed_at_invalid");
  if (fingerprintInputId !== Q2_PROVIDER_FINGERPRINT_INPUT_ID) throw new Error("q2_provider_fingerprint_input_id_invalid");
  const embeddingSha256 = hashQ2ProviderFingerprintVector(vector, { dimension });
  return {
    schema: Q2_PROVIDER_FINGERPRINT_SCHEMA,
    provider,
    base_url_identity: baseUrlIdentity,
    model,
    model_revision: modelRevision ?? "unavailable/unpinned",
    dimension,
    fingerprint_method: Q2_PROVIDER_FINGERPRINT_METHOD,
    fingerprint_input_id: Q2_PROVIDER_FINGERPRINT_INPUT_ID,
    embedding_sha256: embeddingSha256,
    observed_at: observedAt,
  };
}

export function fingerprintQ2ProviderEmbedding(vectorOrInput, options = {}) {
  if (isRecord(vectorOrInput) && hasOwn(vectorOrInput, "vector")) {
    return createQ2ProviderFingerprint({ ...vectorOrInput, ...options });
  }
  return createQ2ProviderFingerprint({ ...options, vector: vectorOrInput });
}

export function getQ2SelectiveVectorStatus() {
  return {
    profile: "q2_selective_vector_v1",
    status: Q2_SELECTIVE_VECTOR_V1,
    reason: "current semantic qualification runners require vector execution on every scoreable retrieval and reject vector skips",
  };
}

export function validateQ2SemanticBindingEnvelope(value) {
  const errors = [];
  if (!isRecord(value)) return { valid: false, errors: ["binding_must_be_object"] };
  if (value.schema !== Q2_SEMANTIC_BINDING_SCHEMA) errors.push("schema");
  if (value.profile !== Q2_SEMANTIC_PROFILE) errors.push("profile");
  if (value.q1_metric_contract_schema !== Q1_PRODUCT_METRIC_CONTRACT_SCHEMA) errors.push("q1_metric_contract_schema");
  if (value.authority?.q1_baseline_fixture_sha256 !== Q2_Q1_BASELINE_FIXTURE_SHA256) errors.push("q1_baseline_authority");
  if (value.authority?.q2_a2_fixture_sha256 !== Q2_A2_ABLATION_FIXTURE_SHA256) errors.push("q2_a2_authority");
  if (value.runner_contract?.runner_served_depth !== 50) errors.push("runner_served_depth");
  if (value.runner_contract?.q1_quality_evaluation_depth !== 3) errors.push("q1_evaluation_depth");
  if (value.latency?.semantic_latency_status !== Q2_SEMANTIC_LATENCY_STATUS) errors.push("latency_status");
  if (value.latency?.latency_comparable_to_q1_lexical_top3 !== false) errors.push("latency_comparability");
  if (Object.prototype.hasOwnProperty.call(value, "semantic_vs_lexical_latency_delta")) errors.push("forbidden_latency_delta");
  if (Object.prototype.hasOwnProperty.call(value, "semantic_latency_multiplier_vs_q1")) errors.push("forbidden_latency_multiplier");
  return { valid: errors.length === 0, errors };
}

export function assertQ2SemanticBindingEnvelope(value) {
  const validation = validateQ2SemanticBindingEnvelope(value);
  if (!validation.valid) throw new Error(`q2_semantic_binding_envelope_invalid:${validation.errors.join(",")}`);
  return validation;
}
