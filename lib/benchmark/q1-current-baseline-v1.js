import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  Q1_CASE_PROVENANCE,
  Q1_NOT_MEASURABLE,
  Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
  aggregateQ1EvidenceRankingAt3,
  aggregateQ1TriggerDecision,
  scoreQ1EvidenceRankingAt3,
  scoreQ1TriggerDecision,
  summarizeQ1LatencyWindow,
} from "./q1-product-metric-contract-v1.js";
import {
  LONGMEMEVAL_RETRIEVAL_PROFILE,
  runLongMemEvalRetrievalDataset,
} from "./longmemeval-retrieval-runner-v1.js";
import {
  hasLongMemEvalUserTarget,
  normalizeLongMemEvalCase,
  scoreLongMemEvalSessionMetrics,
} from "./longmemeval-v1.js";
import {
  LOCOMO_CATEGORY_MAP,
  LOCOMO_DATASET_SHA256,
  LOCOMO_DATASET_FILE_COMMIT,
  LOCOMO_DATASET_PATH,
  LOCOMO_EVIDENCE_CANONICALIZED_V1,
  LOCOMO_EVIDENCE_STRICT_V1,
  LOCOMO_LICENSE_IDENTITY,
  LOCOMO_UPSTREAM_REPOSITORY,
  LOCOMO_UPSTREAM_COMMIT,
  assertOfficialLocomoDataset,
  normalizeLocomoCase,
  normalizeLocomoDataset,
  scoreLocomoSessionMetrics,
} from "./locomo-v1.js";
import {
  LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE,
  runLocomoTimeFrozenLexicalRetrievalDataset,
} from "./locomo-time-frozen-retrieval-runner-v2.js";
import { evaluateAutoRecallPolicyHoldoutV2B5Jsonl } from "../recall/auto-recall-policy-holdout-v2b5.js";

export const Q1_CURRENT_BASELINE_SCHEMA = "memory_engine_q1_current_baseline_v1";
export const Q1_CURRENT_BASELINE_VERSION = "q1_current_offline_baseline_v1";

export const LONGMEMEVAL_DATASET_SHA256 =
  "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442";
export const LONGMEMEVAL_DATASET_NAME = "LongMemEval-S";
export const LONGMEMEVAL_DATASET_PATH = "/tmp/longmemeval_s_cleaned.json";
export const LONGMEMEVAL_Q1_BENCHMARK_NOW_SEC = 1_800_000_000;
export const LONGMEMEVAL_Q1_TOP_K = 3;

export const LOCOMO_Q1_DATASET_SHA256 = LOCOMO_DATASET_SHA256;
export const LOCOMO_Q1_DATASET_NAME = "LoCoMo";
export const LOCOMO_Q1_DATASET_PATH = "/tmp/locomo10.json";
export const LOCOMO_Q1_BENCHMARK_NOW_SEC = 1_705_066_861;
export const LOCOMO_Q1_TOP_K = 3;

export const AUTO_RECALL_V2B5_FIXTURE_NAME = "auto-recall-policy-holdout.v2b5";
export const AUTO_RECALL_V2B5_FIXTURE_PATH =
  "test/fixtures/auto-recall-policy-holdout.v2b5.jsonl";

const EXPECTED_LONGMEMEVAL_SHAPE = Object.freeze({
  cases: 500,
  scored: 419,
  skipped: 81,
  official_retrieval_abstention: 30,
  official_retrieval_no_user_target: 51,
  evidence_session_counts: Object.freeze({
    1: 119,
    2: 229,
    3: 39,
    4: 18,
    5: 11,
    6: 3,
  }),
});

const EXPECTED_LOCOMO_SHAPE = Object.freeze({
  conversations: 10,
  sessions: 272,
  turns: 5882,
  qa: 1986,
  strict_scored: 1972,
  strict_skipped: 14,
});

const EXPECTED_TRIGGER_MATRIX = Object.freeze({
  TP: 3,
  TN: 17,
  FP: 7,
  FN: 21,
  UNKNOWN: 0,
});

const EXPECTED_UNAVAILABLE = Object.freeze({
  production_top3_safety: "NOT_EVALUATED_CURRENT_AUTHORITY",
  production_injection_quality: "NOT_EVALUATED_CURRENT_AUTHORITY",
  production_recall_latency: "NOT_EVALUATED_CURRENT_AUTHORITY",
  answer_evidence_coverage: "NOT_MEASURABLE_WITH_CURRENT_AUTHORITY",
});

const FORBIDDEN_BASELINE_KEYS = new Set([
  "answer",
  "answers",
  "conversation",
  "conversations",
  "embedding",
  "embeddings",
  "evidence_ids",
  "gold_evidence_ids",
  "memory",
  "memory_content",
  "memory_contents",
  "prompt",
  "prompts",
  "question",
  "question_id",
  "raw_evidence",
  "retrieved_dialog_ids",
  "retrieved_ids",
  "retrieved_memory_ids",
  "retrieved_session_ids",
  "ranked_retrieved_ids",
  "sample_id",
  "session_ids",
  "sessions",
  "tool_result",
  "tool_results",
  "turn_id",
]);

const FORBIDDEN_POOLING_KEYS = new Set([
  "overall_score",
  "overall_recall",
  "overall_failure_rate",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function finiteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function integerNonNegative(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function mean(values) {
  const finite = values.filter(value => typeof value === "number" && Number.isFinite(value));
  return finite.length === 0
    ? null
    : finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function sameMetric(left, right) {
  return left === right || (Number.isNaN(left) && Number.isNaN(right));
}

function mismatchCount(pairs) {
  return pairs.filter(pair => !sameMetric(pair[0], pair[1])).length;
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function boundedError(error) {
  return String(error?.message || error).slice(0, 240);
}

function readPinnedJson(path, expectedSha256, label) {
  if (typeof path !== "string" || path.trim() === "") {
    throw new Error(`q1_baseline_${label}_path_required`);
  }

  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    throw new Error(`q1_baseline_${label}_source_unavailable:${boundedError(error)}`);
  }

  const actualSha256 = sha256Bytes(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`q1_baseline_${label}_sha256_mismatch:${actualSha256}`);
  }

  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`q1_baseline_${label}_json_invalid:${boundedError(error)}`);
  }
  return { bytes, value, sha256: actualSha256 };
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`q1_baseline_${label}_mismatch:${String(actual)}!=${String(expected)}`);
  }
}

function expectDeepEqual(actual, expected, label) {
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  if (actualText !== expectedText) {
    throw new Error(`q1_baseline_${label}_mismatch:${actualText}!=${expectedText}`);
  }
}

function sourceIdentityErrors(identity, requiredKeys = []) {
  const errors = [];
  if (!isRecord(identity)) return ["source_identity_must_be_object"];

  for (const key of requiredKeys) {
    if (!hasOwn(identity, key) || identity[key] === null || identity[key] === undefined) {
      errors.push(`missing:${key}`);
    } else if (typeof identity[key] === "string" && identity[key].trim() === "") {
      errors.push(`empty:${key}`);
    }
  }
  if (hasOwn(identity, "dataset_sha256")
      && (!/^[0-9a-f]{64}$/u.test(String(identity.dataset_sha256)))) {
    errors.push("dataset_sha256_invalid");
  }
  if (hasOwn(identity, "provenance") && !Q1_CASE_PROVENANCE.includes(identity.provenance)) {
    errors.push("provenance_invalid");
  }
  return [...new Set(errors)];
}

export function validateQ1CurrentBaselineSourceIdentity(identity, requiredKeys = []) {
  const errors = sourceIdentityErrors(identity, requiredKeys);
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function assertQ1CurrentBaselineSourceIdentity(identity, requiredKeys = []) {
  const validation = validateQ1CurrentBaselineSourceIdentity(identity, requiredKeys);
  if (!validation.valid) {
    throw new Error(`q1_baseline_source_identity_invalid:${validation.errors.join(",")}`);
  }
  return validation;
}

function longMemEvalSourceIdentity(sha256 = LONGMEMEVAL_DATASET_SHA256) {
  return {
    dataset: LONGMEMEVAL_DATASET_NAME,
    dataset_sha256: sha256,
    dataset_file: "longmemeval_s_cleaned.json",
    retrieval_profile: LONGMEMEVAL_RETRIEVAL_PROFILE,
    top_k: LONGMEMEVAL_Q1_TOP_K,
    benchmark_now_sec: LONGMEMEVAL_Q1_BENCHMARK_NOW_SEC,
  };
}

function locomoSourceIdentity(sha256 = LOCOMO_Q1_DATASET_SHA256) {
  return {
    dataset: LOCOMO_Q1_DATASET_NAME,
    dataset_sha256: sha256,
    upstream_repository: LOCOMO_UPSTREAM_REPOSITORY,
    upstream_commit: LOCOMO_UPSTREAM_COMMIT,
    dataset_file_commit: LOCOMO_DATASET_FILE_COMMIT,
    dataset_path: LOCOMO_DATASET_PATH,
    license_identity: LOCOMO_LICENSE_IDENTITY,
    evidence_policy: LOCOMO_EVIDENCE_STRICT_V1,
    retrieval_profile: LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE,
    q1_metric_level: "session",
    top_k: LOCOMO_Q1_TOP_K,
    benchmark_now_sec: LOCOMO_Q1_BENCHMARK_NOW_SEC,
  };
}

function triggerSourceIdentity(fixtureSha256 = null) {
  return {
    fixture: AUTO_RECALL_V2B5_FIXTURE_NAME,
    evaluator: "frozen_v2b5_runtime_candidate",
    ...(fixtureSha256 ? { fixture_sha256: fixtureSha256 } : {}),
  };
}

function q1Metadata(provenance, sourceIdentity, datasetIdentity) {
  return {
    provenance,
    source_identity: sourceIdentity,
    dataset_identity: datasetIdentity,
  };
}

function rankingScoreInput(goldEvidenceIds, rankedRetrievedIds, metadata) {
  return {
    gold_evidence_ids: goldEvidenceIds,
    ranked_retrieved_ids: rankedRetrievedIds,
    ...metadata,
  };
}

function unknownRankingInput(goldEvidenceIds, metadata) {
  // Deliberately omit ranked_retrieved_ids. An empty array would be a valid
  // zero-valued retrieval result and would incorrectly turn an official skip
  // into a miss.
  return {
    gold_evidence_ids: goldEvidenceIds,
    ...metadata,
  };
}

function rankingProjection(aggregate) {
  return {
    aggregation_status: aggregate.aggregation_status,
    aggregation_refused: aggregate.aggregation_refused,
    scoreable_case_count: aggregate.scoreable_case_count,
    unknown_or_unscoreable_case_count: aggregate.unknown_or_unscoreable_case_count,
    unknown_or_unscoreable_by_reason: aggregate.unknown_or_unscoreable_by_reason,
    "recall_any@3": aggregate["recall_any@3"],
    "recall_all@3": aggregate["recall_all@3"],
    "ndcg@3": aggregate["ndcg@3"],
    "evidence_coverage@3": aggregate["evidence_coverage@3"],
    budget_feasible_case_count: aggregate.budget_feasible_case_count,
    budget_infeasible_case_count: aggregate.budget_infeasible_case_count,
    "recall_all@3_feasible": aggregate["recall_all@3_feasible"],
    cross_session_case_count: aggregate.cross_session_case_count,
    "cross_session_evidence_coverage@3": aggregate["cross_session_evidence_coverage@3"],
    "first_relevant_rank@3": aggregate["first_relevant_rank@3"],
  };
}

function triggerProjection(aggregate) {
  return {
    aggregation_status: aggregate.aggregation_status,
    aggregation_refused: aggregate.aggregation_refused,
    labeled_turn_count: aggregate.labeled_turn_count,
    labeled_positive_count: aggregate.labeled_positive_count,
    labeled_negative_count: aggregate.labeled_negative_count,
    unknown_decision_count: aggregate.unknown_decision_count,
    TP: aggregate.TP,
    TN: aggregate.TN,
    FP: aggregate.FP,
    FN: aggregate.FN,
    trigger_recall: aggregate.trigger_recall,
    unnecessary_recall_rate: aggregate.unnecessary_recall_rate,
    trigger_precision: aggregate.trigger_precision,
  };
}

function latencyProjection(summary) {
  return {
    provenance: summary.provenance,
    source_identity: summary.source_identity,
    dataset_identity: summary.dataset_identity,
    latency_evidence_status: summary.latency_evidence_status,
    started_trace_count: summary.started_trace_count,
    latency_sample_count: summary.latency_sample_count,
    recall_latency_p50_ms: summary.recall_latency_p50_ms,
    recall_latency_p95_ms: summary.recall_latency_p95_ms,
    incomplete_trace_count: summary.incomplete_trace_count,
    incomplete_trace_rate: summary.incomplete_trace_rate,
    error_or_timeout_count: summary.error_or_timeout_count,
    error_or_timeout_rate: summary.error_or_timeout_rate,
  };
}

function sortedObject(entries) {
  return Object.fromEntries(
    [...entries].sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
}

function buildRankingBreakdown(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return sortedObject([...groups.entries()].map(([value, group]) => [
    value,
    {
      [key]: value,
      q1: rankingProjection(aggregateQ1EvidenceRankingAt3(group)),
    },
  ]));
}

function buildTriggerBreakdown(rows) {
  const groups = new Map();
  for (const row of rows) {
    const value = row.family;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return sortedObject([...groups.entries()].map(([family, group]) => [
    family,
    {
      family,
      q1: triggerProjection(aggregateQ1TriggerDecision(group)),
    },
  ]));
}

function validateLongMemEvalSource(records) {
  if (!Array.isArray(records)) throw new Error("q1_baseline_longmemeval_source_must_be_array");
  expectEqual(records.length, EXPECTED_LONGMEMEVAL_SHAPE.cases, "longmemeval_case_count");

  const items = records.map(normalizeLongMemEvalCase);
  let abstention = 0;
  let noUserTarget = 0;
  let scored = 0;
  const evidenceSessionCounts = new Map();
  for (const item of items) {
    const noTarget = !hasLongMemEvalUserTarget(item);
    if (item.abstention) abstention += 1;
    if (!item.abstention && noTarget) noUserTarget += 1;
    if (!item.abstention && !noTarget) {
      scored += 1;
      const count = new Set(item.evidence_session_ids).size;
      evidenceSessionCounts.set(count, (evidenceSessionCounts.get(count) || 0) + 1);
    }
  }
  const shape = {
    cases: items.length,
    scored,
    skipped: items.length - scored,
    official_retrieval_abstention: abstention,
    official_retrieval_no_user_target: noUserTarget,
    evidence_session_counts: Object.fromEntries(
      [...evidenceSessionCounts.entries()].sort(([left], [right]) => left - right),
    ),
  };
  expectDeepEqual(shape, EXPECTED_LONGMEMEVAL_SHAPE, "longmemeval_source_shape");
  return { items, shape };
}

function expectedLongSkipReason(item) {
  if (item.abstention) return "official_retrieval_abstention";
  return hasLongMemEvalUserTarget(item) ? null : "official_retrieval_no_user_target";
}

export function scoreQ1LongMemEvalCase(record, retrievalResult, options = {}) {
  const item = record?.schema === "memory_engine_longmemeval_v1"
    ? record
    : normalizeLongMemEvalCase(record);
  const sourceIdentity = options.sourceIdentity || longMemEvalSourceIdentity();
  const metadata = q1Metadata(
    "BENCHMARK_DERIVED",
    sourceIdentity,
    LONGMEMEVAL_DATASET_NAME,
  );
  const scoreable = expectedLongSkipReason(item) === null;
  const q1 = scoreable
    ? scoreQ1EvidenceRankingAt3(rankingScoreInput(
      item.evidence_session_ids,
      retrievalResult?.retrieved_session_ids,
      metadata,
    ))
    : scoreQ1EvidenceRankingAt3(unknownRankingInput(item.evidence_session_ids, metadata));
  return {
    item,
    scoreable,
    q1,
    legacy: scoreable
      ? scoreLongMemEvalSessionMetrics(item, retrievalResult?.retrieved_session_ids || [])
      : null,
  };
}

function validateLongMemEvalRun(run, items) {
  if (!isRecord(run) || !Array.isArray(run.results) || !isRecord(run.run)) {
    throw new Error("q1_baseline_longmemeval_run_invalid");
  }
  expectEqual(run.results.length, items.length, "longmemeval_run_result_count");
  expectEqual(run.run.profile, LONGMEMEVAL_RETRIEVAL_PROFILE, "longmemeval_run_profile");
  expectEqual(run.run.top_k, LONGMEMEVAL_Q1_TOP_K, "longmemeval_run_top_k");
  expectEqual(
    run.run.benchmark_now_sec,
    LONGMEMEVAL_Q1_BENCHMARK_NOW_SEC,
    "longmemeval_run_clock",
  );

  const skipReasons = {};
  let scored = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const result = run.results[index];
    expectEqual(result?.question_id, item.question_id, `longmemeval_result_identity_${index}`);
    const expectedSkipReason = expectedLongSkipReason(item);
    if (expectedSkipReason) {
      if (result?.skipped !== true || result.skip_reason !== expectedSkipReason) {
        throw new Error(`q1_baseline_longmemeval_skip_mismatch:${index}`);
      }
      skipReasons[expectedSkipReason] = (skipReasons[expectedSkipReason] || 0) + 1;
    } else {
      if (result?.skipped === true || !Array.isArray(result?.retrieved_session_ids)) {
        throw new Error(`q1_baseline_longmemeval_scored_result_invalid:${index}`);
      }
      if (!isRecord(result.metrics) || !finiteNonNegative(result.latency_ms)) {
        throw new Error(`q1_baseline_longmemeval_latency_or_metrics_invalid:${index}`);
      }
      scored += 1;
    }
  }
  expectEqual(scored, EXPECTED_LONGMEMEVAL_SHAPE.scored, "longmemeval_run_scored_count");
  expectDeepEqual(skipReasons, {
    official_retrieval_abstention: EXPECTED_LONGMEMEVAL_SHAPE.official_retrieval_abstention,
    official_retrieval_no_user_target: EXPECTED_LONGMEMEVAL_SHAPE.official_retrieval_no_user_target,
  }, "longmemeval_run_skip_reasons");
  expectEqual(run.summary?.cases, EXPECTED_LONGMEMEVAL_SHAPE.cases, "longmemeval_summary_cases");
  expectEqual(run.summary?.scored_cases, EXPECTED_LONGMEMEVAL_SHAPE.scored, "longmemeval_summary_scored");
  expectEqual(run.summary?.skipped_cases, EXPECTED_LONGMEMEVAL_SHAPE.skipped, "longmemeval_summary_skipped");
  return { scored, skipReasons };
}

function buildLongMemEvalTrackFromRun(records, run, options = {}) {
  const sourceIdentity = options.sourceIdentity || longMemEvalSourceIdentity();
  assertQ1CurrentBaselineSourceIdentity(sourceIdentity, [
    "dataset",
    "dataset_sha256",
    "retrieval_profile",
    "top_k",
    "benchmark_now_sec",
  ]);
  expectEqual(sourceIdentity.dataset, LONGMEMEVAL_DATASET_NAME, "longmemeval_dataset_identity");
  expectEqual(sourceIdentity.dataset_sha256, LONGMEMEVAL_DATASET_SHA256, "longmemeval_dataset_sha256");
  expectEqual(sourceIdentity.retrieval_profile, LONGMEMEVAL_RETRIEVAL_PROFILE, "longmemeval_profile_identity");
  expectEqual(sourceIdentity.top_k, LONGMEMEVAL_Q1_TOP_K, "longmemeval_top_k_identity");
  expectEqual(
    sourceIdentity.benchmark_now_sec,
    LONGMEMEVAL_Q1_BENCHMARK_NOW_SEC,
    "longmemeval_clock_identity",
  );

  const { items, shape } = validateLongMemEvalSource(records);
  validateLongMemEvalRun(run, items);
  const metadata = q1Metadata(
    "BENCHMARK_DERIVED",
    sourceIdentity,
    LONGMEMEVAL_DATASET_NAME,
  );
  const q1Rows = [];
  const legacyRecallAnyPairs = [];
  const legacyRecallAllPairs = [];
  const q1NdcgValues = [];
  const legacyNdcgValues = [];
  const latencySamples = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const result = run.results[index];
    const scoredCase = scoreQ1LongMemEvalCase(item, result, { sourceIdentity });
    const scoreable = scoredCase.scoreable;
    const q1Score = scoredCase.q1;
    q1Rows.push({ ...q1Score, question_type: item.question_type });

    if (!scoreable) continue;
    latencySamples.push(result.latency_ms);
    const q1Any = q1Score["recall_any@3"];
    const q1All = q1Score["recall_all@3"];
    const legacyAny = scoredCase.legacy.metrics["recall_any@3"];
    const legacyAll = scoredCase.legacy.metrics["recall_all@3"];
    legacyRecallAnyPairs.push([q1Any, legacyAny]);
    legacyRecallAllPairs.push([q1All, legacyAll]);
    q1NdcgValues.push(q1Score["ndcg@3"]);
    legacyNdcgValues.push(scoredCase.legacy.metrics["ndcg_any@3"]);
  }

  const q1Aggregate = aggregateQ1EvidenceRankingAt3(q1Rows);
  expectEqual(q1Aggregate.aggregation_refused, false, "longmemeval_q1_aggregation_refused");
  expectEqual(q1Aggregate.scoreable_case_count, EXPECTED_LONGMEMEVAL_SHAPE.scored, "longmemeval_q1_scoreable");
  expectEqual(
    q1Aggregate.unknown_or_unscoreable_case_count,
    EXPECTED_LONGMEMEVAL_SHAPE.skipped,
    "longmemeval_q1_unknown",
  );
  expectEqual(q1Aggregate.budget_feasible_case_count, 387, "longmemeval_q1_feasible");
  expectEqual(q1Aggregate.budget_infeasible_case_count, 32, "longmemeval_q1_infeasible");
  expectEqual(q1Aggregate.cross_session_case_count, 300, "longmemeval_q1_cross_session");

  const latency = summarizeQ1LatencyWindow({
    started_trace_count: EXPECTED_LONGMEMEVAL_SHAPE.scored,
    completed_latency_samples: latencySamples,
    incomplete_trace_count: 0,
    error_or_timeout_count: 0,
    ...metadata,
  });
  expectEqual(latency.latency_sample_count, EXPECTED_LONGMEMEVAL_SHAPE.scored, "longmemeval_latency_samples");

  const q1Ndcg = mean(q1NdcgValues);
  const legacyNdcg = mean(legacyNdcgValues);
  return {
    provenance: "BENCHMARK_DERIVED",
    source_identity: sourceIdentity,
    denominator: {
      source_case_count: shape.cases,
      scoreable_case_count: shape.scored,
      skipped_case_count: shape.skipped,
      official_retrieval_abstention: shape.official_retrieval_abstention,
      official_retrieval_no_user_target: shape.official_retrieval_no_user_target,
      retrieval_attempt_count: shape.scored,
      evidence_session_count_distribution: shape.evidence_session_counts,
    },
    q1: rankingProjection(q1Aggregate),
    by_question_type: buildRankingBreakdown(q1Rows, "question_type"),
    legacy_compatibility: {
      recall_any_mismatch_count: mismatchCount(legacyRecallAnyPairs),
      recall_all_mismatch_count: mismatchCount(legacyRecallAllPairs),
      q1_ndcg_at_3: q1Ndcg,
      legacy_longmemeval_ndcg_at_3: legacyNdcg,
      legacy_longmemeval_ndcg_any_at_3: legacyNdcg,
      ndcg_metric_definition_delta: q1Ndcg === null || legacyNdcg === null
        ? null
        : q1Ndcg - legacyNdcg,
      legacy_ndcg_mismatch_count: mismatchCount(
        q1NdcgValues.map((value, index) => [value, legacyNdcgValues[index]]),
      ),
      ndcg_definition_compatible: false,
      ndcg_definition: "standard_binary_dcg_log2_rank_plus_1",
      legacy_ndcg_definition: "legacy_longmemeval",
    },
    latency: latencyProjection(latency),
  };
}

export function bindQ1LongMemEvalBaseline(records, run, options = {}) {
  return buildLongMemEvalTrackFromRun(records, run, options);
}

async function loadAndRunLongMemEval(path) {
  const source = readPinnedJson(path, LONGMEMEVAL_DATASET_SHA256, "longmemeval");
  const run = await runLongMemEvalRetrievalDataset(source.value, {
    topK: LONGMEMEVAL_Q1_TOP_K,
    benchmarkNowSec: LONGMEMEVAL_Q1_BENCHMARK_NOW_SEC,
  });
  return buildLongMemEvalTrackFromRun(source.value, run, {
    sourceIdentity: longMemEvalSourceIdentity(source.sha256),
  });
}

function validateLocomoRun(run) {
  if (!isRecord(run) || !Array.isArray(run.results) || !isRecord(run.run)) {
    throw new Error("q1_baseline_locomo_run_invalid");
  }
  expectEqual(run.results.length, EXPECTED_LOCOMO_SHAPE.qa, "locomo_run_result_count");
  expectEqual(run.run.profile, LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE, "locomo_run_profile");
  expectEqual(run.run.top_k, LOCOMO_Q1_TOP_K, "locomo_run_top_k");
  expectEqual(run.run.benchmark_now_sec, LOCOMO_Q1_BENCHMARK_NOW_SEC, "locomo_run_clock");
  expectEqual(run.summary?.cases, EXPECTED_LOCOMO_SHAPE.qa, "locomo_summary_cases");
  expectEqual(run.summary?.retrieval_cases, 1978, "locomo_retrieval_attempt_count");
  expectEqual(run.summary?.strict?.scored_cases, EXPECTED_LOCOMO_SHAPE.strict_scored, "locomo_summary_strict_scored");
  expectEqual(run.summary?.strict?.skipped_cases, EXPECTED_LOCOMO_SHAPE.strict_skipped, "locomo_summary_strict_skipped");
  expectEqual(run.provenance?.dataset_sha256, LOCOMO_Q1_DATASET_SHA256, "locomo_run_dataset_sha256");
  expectEqual(
    run.provenance?.benchmark_now_sec,
    LOCOMO_Q1_BENCHMARK_NOW_SEC,
    "locomo_run_provenance_clock",
  );
}

export function scoreQ1LocomoStrictSessionCase(record, retrievedSessionIds, options = {}) {
  const item = record?.schema === "memory_engine_locomo_v1"
    ? record
    : normalizeLocomoCase(record, { evidencePolicy: LOCOMO_EVIDENCE_STRICT_V1 });
  const questionIndex = options.questionIndex ?? 0;
  const question = item.questions[questionIndex];
  if (!question) throw new Error(`q1_baseline_locomo_question_missing:${questionIndex}`);
  const sourceIdentity = options.sourceIdentity || locomoSourceIdentity();
  const metadata = q1Metadata("BENCHMARK_DERIVED", sourceIdentity, LOCOMO_Q1_DATASET_NAME);
  if (!question.scoreable) {
    return {
      question,
      scoreable: false,
      q1: scoreQ1EvidenceRankingAt3(unknownRankingInput(question.evidence_session_ids, metadata)),
      legacy: scoreLocomoSessionMetrics(item, Array.isArray(retrievedSessionIds) ? retrievedSessionIds : [], {
        questionIndex,
        evidencePolicy: LOCOMO_EVIDENCE_STRICT_V1,
      }),
    };
  }
  if (!Array.isArray(retrievedSessionIds)) {
    throw new Error("q1_baseline_locomo_retrieved_session_ids_required");
  }
  return {
    question,
    scoreable: true,
    q1: scoreQ1EvidenceRankingAt3(rankingScoreInput(
      question.evidence_session_ids,
      retrievedSessionIds,
      metadata,
    )),
    legacy: scoreLocomoSessionMetrics(item, retrievedSessionIds, {
      questionIndex,
      evidencePolicy: LOCOMO_EVIDENCE_STRICT_V1,
    }),
  };
}

function buildLocomoQuestionRows(records, run, strictItems, options = {}) {
  const sourceIdentity = options.sourceIdentity || locomoSourceIdentity();
  assertQ1CurrentBaselineSourceIdentity(sourceIdentity, [
    "dataset",
    "dataset_sha256",
    "evidence_policy",
    "retrieval_profile",
    "q1_metric_level",
    "top_k",
    "benchmark_now_sec",
  ]);
  expectEqual(sourceIdentity.dataset, LOCOMO_Q1_DATASET_NAME, "locomo_dataset_identity");
  expectEqual(sourceIdentity.dataset_sha256, LOCOMO_Q1_DATASET_SHA256, "locomo_dataset_sha256");
  expectEqual(sourceIdentity.evidence_policy, LOCOMO_EVIDENCE_STRICT_V1, "locomo_evidence_policy");
  expectEqual(sourceIdentity.retrieval_profile, LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE, "locomo_profile_identity");
  expectEqual(sourceIdentity.q1_metric_level, "session", "locomo_q1_metric_level");
  expectEqual(sourceIdentity.top_k, LOCOMO_Q1_TOP_K, "locomo_top_k_identity");
  expectEqual(sourceIdentity.benchmark_now_sec, LOCOMO_Q1_BENCHMARK_NOW_SEC, "locomo_clock_identity");
  validateLocomoRun(run);
  expectEqual(strictItems.length, EXPECTED_LOCOMO_SHAPE.conversations, "locomo_normalized_conversations");

  const metadata = q1Metadata("BENCHMARK_DERIVED", sourceIdentity, LOCOMO_Q1_DATASET_NAME);
  const q1Rows = [];
  const legacyRecallAnyPairs = [];
  const legacyRecallAllPairs = [];
  const legacyNdcgPairs = [];
  const q1NdcgValues = [];
  const legacyNdcgValues = [];
  const latencySamples = [];
  let resultIndex = 0;
  let strictScored = 0;
  let strictSkipped = 0;
  let retrievalAttempts = 0;

  for (let conversationIndex = 0; conversationIndex < strictItems.length; conversationIndex += 1) {
    const item = strictItems[conversationIndex];
    for (const question of item.questions) {
      const result = run.results[resultIndex];
      if (!result) throw new Error(`q1_baseline_locomo_result_missing:${resultIndex}`);
      expectEqual(result.question_id, question.question_id, `locomo_result_identity_${resultIndex}`);
      expectEqual(result.category, question.category, `locomo_result_category_${resultIndex}`);
      resultIndex += 1;

      const sensitivityScoreable = result.sensitivity?.scoreable === true;
      if (sensitivityScoreable) {
        retrievalAttempts += 1;
        if (!finiteNonNegative(result.latency_ms)) {
          throw new Error(`q1_baseline_locomo_latency_invalid:${resultIndex - 1}`);
        }
        latencySamples.push(result.latency_ms);
      }

      const scoreable = question.scoreable === true;
      if (scoreable) {
        if (!sensitivityScoreable || !Array.isArray(result.retrieved_session_ids)) {
          throw new Error(`q1_baseline_locomo_scoreable_retrieval_missing:${resultIndex - 1}`);
        }
        const scoredCase = scoreQ1LocomoStrictSessionCase(
          item,
          result.retrieved_session_ids,
          { questionIndex: question.qa_index, sourceIdentity },
        );
        const q1Score = scoredCase.q1;
        q1Rows.push({
          ...q1Score,
          category: question.category,
          category_name: question.category_name,
        });
        const legacy = scoredCase.legacy;
        legacyRecallAnyPairs.push([q1Score["recall_any@3"], legacy.metrics["recall_any@3"]]);
        legacyRecallAllPairs.push([q1Score["recall_all@3"], legacy.metrics["recall_all@3"]]);
        legacyNdcgPairs.push([q1Score["ndcg@3"], legacy.metrics["ndcg_any@3"]]);
        q1NdcgValues.push(q1Score["ndcg@3"]);
        legacyNdcgValues.push(legacy.metrics["ndcg_any@3"]);
        strictScored += 1;
      } else {
        const q1Score = scoreQ1EvidenceRankingAt3(unknownRankingInput(
          question.evidence_session_ids,
          metadata,
        ));
        q1Rows.push({
          ...q1Score,
          category: question.category,
          category_name: question.category_name,
        });
        strictSkipped += 1;
      }
    }
  }

  expectEqual(resultIndex, EXPECTED_LOCOMO_SHAPE.qa, "locomo_result_iteration_count");
  expectEqual(strictScored, EXPECTED_LOCOMO_SHAPE.strict_scored, "locomo_q1_scoreable_count");
  expectEqual(strictSkipped, EXPECTED_LOCOMO_SHAPE.strict_skipped, "locomo_q1_unknown_count");
  expectEqual(retrievalAttempts, 1978, "locomo_retrieval_attempts");
  expectEqual(latencySamples.length, retrievalAttempts, "locomo_latency_sample_count");

  const q1Aggregate = aggregateQ1EvidenceRankingAt3(q1Rows);
  expectEqual(q1Aggregate.aggregation_refused, false, "locomo_q1_aggregation_refused");
  expectEqual(q1Aggregate.scoreable_case_count, EXPECTED_LOCOMO_SHAPE.strict_scored, "locomo_q1_scoreable");
  expectEqual(
    q1Aggregate.unknown_or_unscoreable_case_count,
    EXPECTED_LOCOMO_SHAPE.strict_skipped,
    "locomo_q1_unknown",
  );

  const latency = summarizeQ1LatencyWindow({
    started_trace_count: retrievalAttempts,
    completed_latency_samples: latencySamples,
    incomplete_trace_count: 0,
    error_or_timeout_count: 0,
    ...metadata,
  });
  expectEqual(latency.latency_sample_count, retrievalAttempts, "locomo_latency_samples");

  const byCategory = {};
  const categoryGroups = new Map();
  for (const row of q1Rows) {
    if (!categoryGroups.has(row.category)) categoryGroups.set(row.category, []);
    categoryGroups.get(row.category).push(row);
  }
  for (const [category, group] of [...categoryGroups.entries()].sort(([left], [right]) => left - right)) {
    const categoryName = LOCOMO_CATEGORY_MAP[category]?.name || `category-${category}`;
    byCategory[String(category)] = {
      category,
      category_name: categoryName,
      q1: rankingProjection(aggregateQ1EvidenceRankingAt3(group)),
    };
  }

  return {
    provenance: "BENCHMARK_DERIVED",
    source_identity: sourceIdentity,
    denominator: {
      conversation_count: EXPECTED_LOCOMO_SHAPE.conversations,
      session_count: EXPECTED_LOCOMO_SHAPE.sessions,
      turn_count: EXPECTED_LOCOMO_SHAPE.turns,
      qa_count: EXPECTED_LOCOMO_SHAPE.qa,
      strict_metric_case_count: strictScored,
      strict_skipped_case_count: strictSkipped,
      retrieval_latency_attempt_count: retrievalAttempts,
    },
    q1: rankingProjection(q1Aggregate),
    by_category: byCategory,
    compatibility: {
      recall_any_mismatch_count: mismatchCount(legacyRecallAnyPairs),
      recall_all_mismatch_count: mismatchCount(legacyRecallAllPairs),
      ndcg_mismatch_count: mismatchCount(legacyNdcgPairs),
      q1_ndcg_at_3: mean(q1NdcgValues),
      legacy_locomo_strict_session_ndcg_at_3: mean(legacyNdcgValues),
      ndcg_definition_compatible: true,
      ndcg_definition: "standard_binary_dcg_log2_rank_plus_1",
      legacy_ndcg_definition: "legacy_locomo_strict_session",
    },
    latency: latencyProjection(latency),
  };
}

export function bindQ1LocomoBaseline(records, run, options = {}) {
  const bytes = options.datasetBytes;
  const validation = options.validation || (bytes
    ? assertOfficialLocomoDataset(records, bytes)
    : null);
  if (!validation) throw new Error("q1_baseline_locomo_source_validation_required");
  if (validation) {
    expectEqual(validation.actual_dataset_sha256, LOCOMO_Q1_DATASET_SHA256, "locomo_source_sha256");
    if (!validation.official_shape_matches) throw new Error("q1_baseline_locomo_source_shape_mismatch");
    expectEqual(
      validation.policies[LOCOMO_EVIDENCE_STRICT_V1].scored_cases,
      EXPECTED_LOCOMO_SHAPE.strict_scored,
      "locomo_source_strict_scored",
    );
    expectEqual(
      validation.policies[LOCOMO_EVIDENCE_STRICT_V1].skipped_cases,
      EXPECTED_LOCOMO_SHAPE.strict_skipped,
      "locomo_source_strict_skipped",
    );
  }
  const strictItems = options.strictItems || normalizeLocomoDataset(records, {
    evidencePolicy: LOCOMO_EVIDENCE_STRICT_V1,
  });
  return buildLocomoQuestionRows(records, run, strictItems, options);
}

async function loadAndRunLocomo(path, repositoryProvenance = null) {
  const source = readPinnedJson(path, LOCOMO_Q1_DATASET_SHA256, "locomo");
  const validation = assertOfficialLocomoDataset(source.value, source.bytes);
  const run = await runLocomoTimeFrozenLexicalRetrievalDataset(source.value, {
    topK: LOCOMO_Q1_TOP_K,
    benchmarkNowSec: LOCOMO_Q1_BENCHMARK_NOW_SEC,
    datasetSha256: source.sha256,
    repositoryProvenance,
  });
  return bindQ1LocomoBaseline(source.value, run, {
    datasetBytes: source.bytes,
    validation,
    sourceIdentity: locomoSourceIdentity(source.sha256),
  });
}

function readJsonl(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`q1_baseline_trigger_source_unavailable:${boundedError(error)}`);
  }
}

function buildTriggerTrackFromReport(report, fixtureSha256 = null) {
  if (!isRecord(report) || report.validation?.valid !== true) {
    throw new Error("q1_baseline_trigger_evaluator_invalid");
  }
  expectEqual(report.summary?.total, 48, "trigger_source_count");
  expectEqual(report.summary?.expected_yes, 24, "trigger_source_positive_count");
  expectEqual(report.summary?.expected_no, 24, "trigger_source_negative_count");
  const runtime = report.confusion_matrices?.v2_runtime_candidate;
  const runtimeMatrix = {
    TP: runtime?.true_positive,
    TN: runtime?.true_negative,
    FP: runtime?.false_positive,
    FN: runtime?.false_negative,
    UNKNOWN: runtime?.invalid,
  };
  expectDeepEqual(runtimeMatrix, EXPECTED_TRIGGER_MATRIX, "trigger_runtime_matrix");

  const sourceIdentity = triggerSourceIdentity(fixtureSha256);
  assertQ1CurrentBaselineSourceIdentity(sourceIdentity, ["fixture", "evaluator"]);
  const metadata = q1Metadata("TARGETED_SYNTHETIC", sourceIdentity, AUTO_RECALL_V2B5_FIXTURE_NAME);
  const q1Rows = report.results.map(result => ({
    ...scoreQ1TriggerDecision({
      expected_should_recall: result.expected?.should_recall,
      actual_should_recall: result.v2_runtime_candidate?.should_recall,
      ...metadata,
    }),
    family: result.family,
  }));
  const q1Aggregate = aggregateQ1TriggerDecision(q1Rows);
  expectEqual(q1Aggregate.aggregation_refused, false, "trigger_q1_aggregation_refused");
  expectEqual(q1Aggregate.case_count, 48, "trigger_q1_case_count");
  expectEqual(q1Aggregate.TP, 3, "trigger_q1_tp");
  expectEqual(q1Aggregate.TN, 17, "trigger_q1_tn");
  expectEqual(q1Aggregate.FP, 7, "trigger_q1_fp");
  expectEqual(q1Aggregate.FN, 21, "trigger_q1_fn");
  expectEqual(q1Aggregate.unknown_decision_count, 0, "trigger_q1_unknown");

  return {
    provenance: "TARGETED_SYNTHETIC",
    source_identity: sourceIdentity,
    denominator: {
      labeled_turn_count: q1Aggregate.labeled_turn_count,
      labeled_positive_count: q1Aggregate.labeled_positive_count,
      labeled_negative_count: q1Aggregate.labeled_negative_count,
      unknown_decision_count: q1Aggregate.unknown_decision_count,
    },
    q1: triggerProjection(q1Aggregate),
    runtime_candidate_confusion_matrix: runtimeMatrix,
    by_family: buildTriggerBreakdown(q1Rows),
    evaluator: {
      b5_evaluator_status: report.b5_evaluator_status,
      evidence_role: report.evidence_role,
      current_evaluation_status: report.current_evaluation_status,
    },
  };
}

export function bindQ1TriggerBaseline(report, options = {}) {
  return buildTriggerTrackFromReport(report, options.fixtureSha256 || null);
}

function buildUnavailableStatus(status, reason) {
  return {
    status,
    provenance: null,
    source_identity: null,
    unknown_or_unmeasurable_count: 1,
    reason,
  };
}

export function buildQ1CurrentBaselineEnvelope({ longmemeval, locomo, trigger }) {
  const envelope = {
    schema: Q1_CURRENT_BASELINE_SCHEMA,
    baseline_version: Q1_CURRENT_BASELINE_VERSION,
    q1_metric_contract_schema: Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
    tracks: {
      longmemeval_lexical_session: longmemeval,
      locomo_lexical_strict_session: locomo,
      trigger_v2b5: trigger,
    },
    unavailable: {
      production_top3_safety: buildUnavailableStatus(
        EXPECTED_UNAVAILABLE.production_top3_safety,
        "current_authoritative_lifecycle_and_conflict_labels_not_bound",
      ),
      production_injection_quality: buildUnavailableStatus(
        EXPECTED_UNAVAILABLE.production_injection_quality,
        "current_authoritative_quality_review_window_not_bound",
      ),
      production_recall_latency: buildUnavailableStatus(
        EXPECTED_UNAVAILABLE.production_recall_latency,
        "production_observed_latency_samples_not_bound",
      ),
      answer_evidence_coverage: buildUnavailableStatus(
        EXPECTED_UNAVAILABLE.answer_evidence_coverage,
        "authoritative_final_answer_evidence_use_labels_are_not_available",
      ),
    },
    interpretation: {
      offline_evaluation_only: true,
      production_prevalence_claim: false,
      cross_source_pooling: false,
      metrics_are_definitions_not_thresholds: true,
      rollout_authorization: "NONE",
      runtime_mutation_authorized: false,
    },
  };
  assertQ1CurrentBaselineEnvelope(envelope);
  return envelope;
}

function collectForbiddenKeys(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectForbiddenKeys(entry, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_BASELINE_KEYS.has(key)) errors.push(`raw_payload_key:${path}.${key}`);
    if (FORBIDDEN_POOLING_KEYS.has(key)) errors.push(`cross_source_pooling_key:${path}.${key}`);
    collectForbiddenKeys(child, `${path}.${key}`, errors);
  }
}

function validateTrackEnvelope(track, name, expectedProvenance, requiredIdentityKeys, errors) {
  if (!isRecord(track)) {
    errors.push(`track_missing:${name}`);
    return;
  }
  if (track.provenance !== expectedProvenance) {
    errors.push(`track_provenance:${name}`);
  }
  const identityValidation = validateQ1CurrentBaselineSourceIdentity(
    track.source_identity,
    requiredIdentityKeys,
  );
  if (!identityValidation.valid) {
    errors.push(`track_source_identity:${name}:${identityValidation.errors.join(",")}`);
  }
  if (track.q1?.aggregation_refused !== false || track.q1?.aggregation_status !== "READY") {
    errors.push(`track_q1_aggregation:${name}`);
  }
}

export function validateQ1CurrentBaselineEnvelope(envelope) {
  const errors = [];
  if (!isRecord(envelope)) {
    return { valid: false, errors: ["baseline_must_be_object"] };
  }
  if (envelope.schema !== Q1_CURRENT_BASELINE_SCHEMA) errors.push("schema_invalid");
  if (envelope.baseline_version !== Q1_CURRENT_BASELINE_VERSION) errors.push("baseline_version_invalid");
  if (envelope.q1_metric_contract_schema !== Q1_PRODUCT_METRIC_CONTRACT_SCHEMA) {
    errors.push("q1_metric_contract_schema_invalid");
  }
  validateTrackEnvelope(
    envelope.tracks?.longmemeval_lexical_session,
    "longmemeval_lexical_session",
    "BENCHMARK_DERIVED",
    ["dataset", "dataset_sha256", "retrieval_profile", "top_k", "benchmark_now_sec"],
    errors,
  );
  validateTrackEnvelope(
    envelope.tracks?.locomo_lexical_strict_session,
    "locomo_lexical_strict_session",
    "BENCHMARK_DERIVED",
    [
      "dataset",
      "dataset_sha256",
      "evidence_policy",
      "retrieval_profile",
      "q1_metric_level",
      "top_k",
      "benchmark_now_sec",
    ],
    errors,
  );
  validateTrackEnvelope(
    envelope.tracks?.trigger_v2b5,
    "trigger_v2b5",
    "TARGETED_SYNTHETIC",
    ["fixture", "evaluator"],
    errors,
  );

  const longIdentity = envelope.tracks?.longmemeval_lexical_session?.source_identity;
  if (longIdentity?.dataset !== LONGMEMEVAL_DATASET_NAME) errors.push("longmemeval_dataset_identity");
  if (longIdentity?.dataset_sha256 !== LONGMEMEVAL_DATASET_SHA256) errors.push("longmemeval_dataset_sha256");
  if (longIdentity?.retrieval_profile !== LONGMEMEVAL_RETRIEVAL_PROFILE) errors.push("longmemeval_profile");
  if (longIdentity?.top_k !== LONGMEMEVAL_Q1_TOP_K) errors.push("longmemeval_top_k");
  if (longIdentity?.benchmark_now_sec !== LONGMEMEVAL_Q1_BENCHMARK_NOW_SEC) errors.push("longmemeval_clock");

  const locomoIdentity = envelope.tracks?.locomo_lexical_strict_session?.source_identity;
  if (locomoIdentity?.dataset !== LOCOMO_Q1_DATASET_NAME) errors.push("locomo_dataset_identity");
  if (locomoIdentity?.dataset_sha256 !== LOCOMO_Q1_DATASET_SHA256) errors.push("locomo_dataset_sha256");
  if (locomoIdentity?.retrieval_profile !== LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE) errors.push("locomo_profile");
  if (locomoIdentity?.q1_metric_level !== "session") errors.push("locomo_q1_metric_level");
  if (locomoIdentity?.top_k !== LOCOMO_Q1_TOP_K) errors.push("locomo_top_k");
  if (locomoIdentity?.benchmark_now_sec !== LOCOMO_Q1_BENCHMARK_NOW_SEC) errors.push("locomo_clock");

  const longQ1 = envelope.tracks?.longmemeval_lexical_session?.q1;
  if (longQ1?.scoreable_case_count !== EXPECTED_LONGMEMEVAL_SHAPE.scored
      || longQ1?.unknown_or_unscoreable_case_count !== EXPECTED_LONGMEMEVAL_SHAPE.skipped
      || longQ1?.budget_feasible_case_count !== 387
      || longQ1?.budget_infeasible_case_count !== 32
      || longQ1?.cross_session_case_count !== 300) {
    errors.push("longmemeval_q1_structural_counts");
  }
  const locomoQ1 = envelope.tracks?.locomo_lexical_strict_session?.q1;
  if (locomoQ1?.scoreable_case_count !== EXPECTED_LOCOMO_SHAPE.strict_scored
      || locomoQ1?.unknown_or_unscoreable_case_count !== EXPECTED_LOCOMO_SHAPE.strict_skipped) {
    errors.push("locomo_q1_structural_counts");
  }
  const triggerQ1 = envelope.tracks?.trigger_v2b5?.q1;
  if (triggerQ1?.labeled_turn_count !== 48
      || triggerQ1?.labeled_positive_count !== 24
      || triggerQ1?.labeled_negative_count !== 24
      || triggerQ1?.TP !== EXPECTED_TRIGGER_MATRIX.TP
      || triggerQ1?.TN !== EXPECTED_TRIGGER_MATRIX.TN
      || triggerQ1?.FP !== EXPECTED_TRIGGER_MATRIX.FP
      || triggerQ1?.FN !== EXPECTED_TRIGGER_MATRIX.FN) {
    errors.push("trigger_q1_structural_counts");
  }

  for (const [name, status] of Object.entries(EXPECTED_UNAVAILABLE)) {
    if (envelope.unavailable?.[name]?.status !== status) errors.push(`unavailable_status:${name}`);
  }
  if (envelope.interpretation?.offline_evaluation_only !== true) {
    errors.push("interpretation_offline_only_required");
  }
  if (envelope.interpretation?.production_prevalence_claim !== false) {
    errors.push("interpretation_production_prevalence_forbidden");
  }
  if (envelope.interpretation?.cross_source_pooling !== false) {
    errors.push("interpretation_cross_source_pooling_forbidden");
  }

  collectForbiddenKeys(envelope, "$", errors);
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
  };
}

export function assertQ1CurrentBaselineEnvelope(envelope) {
  const validation = validateQ1CurrentBaselineEnvelope(envelope);
  if (!validation.valid) {
    throw new Error(`q1_baseline_envelope_invalid:${validation.errors.join(",")}`);
  }
  return validation;
}

export async function runQ1CurrentOfflineBaseline(options = {}) {
  const longmemevalPath = options.longmemevalPath || LONGMEMEVAL_DATASET_PATH;
  const locomoPath = options.locomoPath || LOCOMO_Q1_DATASET_PATH;
  const triggerPath = options.triggerPath || AUTO_RECALL_V2B5_FIXTURE_PATH;
  const longmemeval = await loadAndRunLongMemEval(longmemevalPath);
  const locomo = await loadAndRunLocomo(locomoPath, options.repositoryProvenance || null);
  const triggerContent = readJsonl(triggerPath);
  const triggerReport = evaluateAutoRecallPolicyHoldoutV2B5Jsonl(triggerContent);
  const triggerSha256 = sha256Bytes(Buffer.from(triggerContent, "utf8"));
  const trigger = buildTriggerTrackFromReport(triggerReport, triggerSha256);
  return buildQ1CurrentBaselineEnvelope({ longmemeval, locomo, trigger });
}

export const buildQ1CurrentBaselineV1 = runQ1CurrentOfflineBaseline;
export const generateQ1CurrentBaselineV1 = runQ1CurrentOfflineBaseline;

export const Q1_CURRENT_BASELINE_EXPECTED = Object.freeze({
  longmemeval: EXPECTED_LONGMEMEVAL_SHAPE,
  locomo: EXPECTED_LOCOMO_SHAPE,
  trigger: EXPECTED_TRIGGER_MATRIX,
  unavailable: EXPECTED_UNAVAILABLE,
});

// Keep this import-time reference explicit: Q1-A2 binds the contract but does
// not redefine its unavailable answer-use status or injection semantics.
export const Q1_CURRENT_BASELINE_NOT_MEASURABLE = Q1_NOT_MEASURABLE;
export const Q1_CURRENT_BASELINE_UPSTREAM_LOCOMO_COMMIT = LOCOMO_UPSTREAM_COMMIT;
export const Q1_CURRENT_BASELINE_CANONICALIZED_POLICY = LOCOMO_EVIDENCE_CANONICALIZED_V1;
