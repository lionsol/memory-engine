import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  hasLongMemEvalUserTarget,
  normalizeLongMemEvalCase,
} from "./longmemeval-v1.js";
import {
  LONGMEMEVAL_RETRIEVAL_PROFILE,
  runLongMemEvalRetrievalDataset,
} from "./longmemeval-retrieval-runner-v1.js";
import {
  LOCOMO_DATASET_FILE_COMMIT,
  LOCOMO_DATASET_PATH,
  LOCOMO_DATASET_SHA256,
  LOCOMO_EVIDENCE_STRICT_V1,
  LOCOMO_LICENSE_IDENTITY,
  LOCOMO_UPSTREAM_COMMIT,
  LOCOMO_UPSTREAM_REPOSITORY,
  assertOfficialLocomoDataset,
  normalizeLocomoDataset,
} from "./locomo-v1.js";
import {
  createLocomoProductionHybridRuntime,
} from "./locomo-retrieval-runner-v1.js";
import {
  LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE,
  runLocomoTimeFrozenLexicalRetrievalDataset,
} from "./locomo-time-frozen-retrieval-runner-v2.js";
import {
  aggregateQ1EvidenceRankingAt3,
  Q1_PRODUCT_METRIC_CONTRACT_SCHEMA,
  scoreQ1EvidenceRankingAt3,
  summarizeQ1LatencyWindow,
} from "./q1-product-metric-contract-v1.js";
import { validateQ1CurrentBaselineEnvelope } from "./q1-current-baseline-v1.js";
import {
  Q2_CHANNEL_ABLATION_SCHEMA,
  Q2_EVALUATION_TOP_K,
  Q2_Q1_BASELINE_FIXTURE_SHA256,
  assertQ2ObservedChannelContract,
  resolveQ2ChannelAblationProfile,
} from "./q2-channel-ablation-v1.js";

export const Q2_NON_VECTOR_ABLATION_SCHEMA = "memory_engine_q2_non_vector_ablation_v1";
export const Q2_NON_VECTOR_ABLATION_VERSION = "q2_non_vector_ablation_v1";
export const Q2_Q1_BASELINE_FIXTURE_PATH = "test/fixtures/q1-current-baseline-v1.json";
export const Q2_Q1_METRIC_CONTRACT_SCHEMA = Q1_PRODUCT_METRIC_CONTRACT_SCHEMA;

export const Q2_LONGMEMEVAL_DATASET_SHA256 =
  "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442";
export const Q2_LONGMEMEVAL_DATASET_NAME = "LongMemEval-S";
export const Q2_LONGMEMEVAL_BENCHMARK_NOW_SEC = 1_800_000_000;
export const Q2_LONGMEMEVAL_TOP_K = Q2_EVALUATION_TOP_K;

export const Q2_LOCOMO_DATASET_SHA256 = LOCOMO_DATASET_SHA256;
export const Q2_LOCOMO_DATASET_NAME = "LoCoMo";
export const Q2_LOCOMO_BENCHMARK_NOW_SEC = 1_705_066_861;
export const Q2_LOCOMO_TOP_K = Q2_EVALUATION_TOP_K;

// The lexical runner records repository provenance but cannot invoke git in
// the restricted benchmark process. Bind the stage's expected repository
// revision explicitly; the dirty state is truthful while Q2-A2 is executing
// before its commit.
export const Q2_A2_EXPECTED_REPOSITORY_COMMIT =
  "d705625dffcbf5f0b0886f5f8fcb302d4a438248";
export const Q2_A2_REPOSITORY_PROVENANCE = Object.freeze({
  repository_commit: Q2_A2_EXPECTED_REPOSITORY_COMMIT,
  repository_worktree_clean: false,
  repository_provenance_source: "git",
});

export const Q2_NON_VECTOR_PROFILE_ORDER = Object.freeze([
  "q2_fts_only_v1",
  "q2_fts_kg_v1",
  "q2_fts_recent_v1",
  "q2_non_vector_full_v1",
]);

export const Q2_FACTORIAL_METRICS = Object.freeze([
  "recall_any@3",
  "recall_all@3",
  "ndcg@3",
  "evidence_coverage@3",
  "recall_all@3_feasible",
  "cross_session_evidence_coverage@3",
]);

export const Q2_PAIRED_TRANSITION_METRICS = Object.freeze([
  "recall_any@3",
  "recall_all@3",
  "evidence_coverage@3",
  "ndcg@3",
]);

export const Q2_CHANNEL_USAGE_NAMES = Object.freeze([
  "fts",
  "kg",
  "like",
  "recent",
  "episode",
  "recent_fallback",
  "vector",
]);

const Q2_ABLATION_PROFILE_ORDER = Object.freeze([
  "q2_fts_only_v1",
  "q2_fts_kg_v1",
  "q2_fts_recent_v1",
]);

const EXPECTED_LONGMEMEVAL_SHAPE = Object.freeze({
  source_case_count: 500,
  scoreable_case_count: 419,
  skipped_case_count: 81,
  official_retrieval_abstention: 30,
  official_retrieval_no_user_target: 51,
  evidence_session_count_distribution: Object.freeze({
    1: 119,
    2: 229,
    3: 39,
    4: 18,
    5: 11,
    6: 3,
  }),
});

const EXPECTED_LOCOMO_SHAPE = Object.freeze({
  conversation_count: 10,
  session_count: 272,
  turn_count: 5882,
  qa_count: 1986,
  strict_metric_case_count: 1972,
  strict_skipped_case_count: 14,
  retrieval_latency_attempt_count: 1978,
});

const EXACT_PARITY_FIELDS = Object.freeze([
  "aggregation_status",
  "aggregation_refused",
  "scoreable_case_count",
  "unknown_or_unscoreable_case_count",
  "unknown_or_unscoreable_by_reason",
  "budget_feasible_case_count",
  "budget_infeasible_case_count",
  "cross_session_case_count",
  "first_relevant_rank@3",
]);

const FLOAT_PARITY_FIELDS = Object.freeze([
  "recall_any@3",
  "recall_all@3",
  "ndcg@3",
  "evidence_coverage@3",
  "recall_all@3_feasible",
  "cross_session_evidence_coverage@3",
]);

const FORBIDDEN_FIXTURE_KEYS = new Set([
  "answer",
  "answers",
  "candidate_id",
  "candidate_ids",
  "conversation",
  "content",
  "dialog_id",
  "dialog_ids",
  "dia_id",
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

const FORBIDDEN_POOLING_KEYS = new Set([
  "overall_score",
  "overall_recall",
  "overall_failure_rate",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function boundedError(error) {
  return String(error?.message || error).slice(0, 240);
}

function readPinnedJson(path, expectedSha256, label) {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    throw new Error(`STOP_Q2_A2_${label.toUpperCase()}_SOURCE_UNAVAILABLE:${boundedError(error)}`);
  }
  const actualSha256 = sha256Bytes(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`STOP_Q2_A2_${label.toUpperCase()}_SHA_MISMATCH:${actualSha256}`);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`STOP_Q2_A2_${label.toUpperCase()}_JSON_INVALID:${boundedError(error)}`);
  }
  return { bytes, value, sha256: actualSha256 };
}

function exactEqual(actual, expected) {
  return Object.is(actual, expected)
    || JSON.stringify(actual) === JSON.stringify(expected);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function compareExact(actual, expected, path, mismatches) {
  if (!exactEqual(actual, expected)) mismatches.push({ path, actual, expected });
}

function compareFloat(actual, expected, path, mismatches) {
  if (finiteNumber(actual) && finiteNumber(expected)) {
    if (Math.abs(actual - expected) > 1e-12) mismatches.push({ path, actual, expected });
    return;
  }
  compareExact(actual, expected, path, mismatches);
}

function expectOneOf(value, allowed, path, mismatches) {
  if (!allowed.includes(value)) mismatches.push({ path, actual: value, expected: allowed });
}

function q1Projection(aggregate) {
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

function latencyProjection(latency) {
  return {
    provenance: latency.provenance,
    source_identity: latency.source_identity,
    dataset_identity: latency.dataset_identity,
    latency_evidence_status: latency.latency_evidence_status,
    started_trace_count: latency.started_trace_count,
    latency_sample_count: latency.latency_sample_count,
    recall_latency_p50_ms: latency.recall_latency_p50_ms,
    recall_latency_p95_ms: latency.recall_latency_p95_ms,
    incomplete_trace_count: latency.incomplete_trace_count,
    incomplete_trace_rate: latency.incomplete_trace_rate,
    error_or_timeout_count: latency.error_or_timeout_count,
    error_or_timeout_rate: latency.error_or_timeout_rate,
  };
}

function sortedObject(entries) {
  return Object.fromEntries(
    [...entries].sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
}

function buildSourceBreakdown(rows, key, nameKey = null) {
  const groups = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return sortedObject([...groups.entries()].map(([value, group]) => {
    const aggregate = aggregateQ1EvidenceRankingAt3(group);
    return [String(value), {
      [key]: value,
      ...(nameKey ? { [nameKey]: group[0]?.[nameKey] ?? null } : {}),
      q1: q1Projection(aggregate),
    }];
  }));
}

function profileSourceIdentity(dataset, datasetSha256, profile, extra = {}) {
  return {
    dataset,
    dataset_sha256: datasetSha256,
    q2_metric_contract_schema: Q2_CHANNEL_ABLATION_SCHEMA,
    retrieval_profile: profile.profile,
    q1_baseline_fixture_sha256: Q2_Q1_BASELINE_FIXTURE_SHA256,
    top_k: Q2_EVALUATION_TOP_K,
    ...extra,
  };
}

function createChannelUsage() {
  return {
    retrieval_attempt_count: 0,
    served_case_count_by_channel: Object.fromEntries(
      Q2_CHANNEL_USAGE_NAMES.map(name => [name, 0]),
    ),
    unexpected_served_channel_count: 0,
    vector_served_case_count: 0,
  };
}

function recordObservedChannels(usage, observed) {
  usage.retrieval_attempt_count += 1;
  for (const channel of observed.observed_channels) {
    if (!Object.hasOwn(usage.served_case_count_by_channel, channel)) {
      usage.served_case_count_by_channel[channel] = 0;
    }
    usage.served_case_count_by_channel[channel] += 1;
    if (channel === "vector") usage.vector_served_case_count += 1;
  }
}

function createRankingScore(item, retrievedIds, sourceIdentity, scoreable) {
  const input = {
    gold_evidence_ids: item.evidence_session_ids,
    provenance: "BENCHMARK_DERIVED",
    source_identity: sourceIdentity,
    dataset_identity: sourceIdentity.dataset,
  };
  if (scoreable) input.ranked_retrieved_ids = retrievedIds;
  return scoreQ1EvidenceRankingAt3(input);
}

function validateLongRunShape(run, items) {
  if (!isRecord(run) || !Array.isArray(run.results) || !isRecord(run.run)) {
    throw new Error("STOP_Q2_A2_LONGMEMEVAL_RUN_INVALID");
  }
  if (run.results.length !== items.length
      || run.run.profile !== LONGMEMEVAL_RETRIEVAL_PROFILE
      || run.run.top_k !== Q2_LONGMEMEVAL_TOP_K
      || run.run.benchmark_now_sec !== Q2_LONGMEMEVAL_BENCHMARK_NOW_SEC
      || run.summary?.cases !== EXPECTED_LONGMEMEVAL_SHAPE.source_case_count
      || run.summary?.scored_cases !== EXPECTED_LONGMEMEVAL_SHAPE.scoreable_case_count
      || run.summary?.skipped_cases !== EXPECTED_LONGMEMEVAL_SHAPE.skipped_case_count) {
    throw new Error("STOP_Q2_A2_LONGMEMEVAL_RUN_SHAPE_MISMATCH");
  }
}

function bindLongProfileInternal(records, run, profile, datasetSha256) {
  const items = records.map(normalizeLongMemEvalCase);
  validateLongRunShape(run, items);
  const sourceIdentity = profileSourceIdentity(
    Q2_LONGMEMEVAL_DATASET_NAME,
    datasetSha256,
    profile,
    {
      dataset_file: "longmemeval_s_cleaned.json",
      runner_profile: LONGMEMEVAL_RETRIEVAL_PROFILE,
      benchmark_now_sec: Q2_LONGMEMEVAL_BENCHMARK_NOW_SEC,
      evidence_unit: "session",
      channel_capabilities: profile.channel_capabilities,
    },
  );
  const rows = [];
  const caseScores = [];
  const latencySamples = [];
  const channelUsage = createChannelUsage();
  let scoredCaseCount = 0;
  let skippedCaseCount = 0;
  const skipReasons = {};

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const result = run.results[index];
    const scoreable = item.abstention === false && hasLongMemEvalUserTarget(item);
    if (!scoreable) {
      const expectedReason = item.abstention
        ? "official_retrieval_abstention"
        : "official_retrieval_no_user_target";
      if (result?.skipped !== true || result.skip_reason !== expectedReason) {
        throw new Error(`STOP_Q2_A2_LONGMEMEVAL_SKIP_MISMATCH:${index}`);
      }
      skippedCaseCount += 1;
      skipReasons[expectedReason] = (skipReasons[expectedReason] || 0) + 1;
      const score = createRankingScore(item, undefined, sourceIdentity, false);
      rows.push({ ...score, question_type: item.question_type });
      caseScores.push({ score, scoreable: false });
      continue;
    }

    if (result?.skipped === true
        || !Array.isArray(result.retrieved_session_ids)
        || !finiteNumber(result.latency_ms)
        || result.latency_ms < 0
        || !result.diagnostics) {
      throw new Error(`STOP_Q2_A2_LONGMEMEVAL_SCORED_RESULT_INVALID:${index}`);
    }
    const observed = assertQ2ObservedChannelContract(profile, result.diagnostics);
    recordObservedChannels(channelUsage, observed);
    latencySamples.push(result.latency_ms);
    scoredCaseCount += 1;
    const score = createRankingScore(
      item,
      result.retrieved_session_ids,
      sourceIdentity,
      true,
    );
    rows.push({ ...score, question_type: item.question_type });
    caseScores.push({ score, scoreable: true });
  }

  if (scoredCaseCount !== EXPECTED_LONGMEMEVAL_SHAPE.scoreable_case_count
      || skippedCaseCount !== EXPECTED_LONGMEMEVAL_SHAPE.skipped_case_count
      || latencySamples.length !== scoredCaseCount
      || channelUsage.retrieval_attempt_count !== scoredCaseCount) {
    throw new Error(`STOP_Q2_A2_LONGMEMEVAL_PROFILE_POPULATION_MISMATCH:${profile.profile}`);
  }
  const aggregate = aggregateQ1EvidenceRankingAt3(rows);
  if (aggregate.aggregation_refused !== false) {
    throw new Error(`STOP_Q2_A2_LONGMEMEVAL_Q1_AGGREGATION_REFUSED:${profile.profile}`);
  }
  const latency = summarizeQ1LatencyWindow({
    started_trace_count: scoredCaseCount,
    completed_latency_samples: latencySamples,
    incomplete_trace_count: 0,
    error_or_timeout_count: 0,
    provenance: "BENCHMARK_DERIVED",
    source_identity: sourceIdentity,
    dataset_identity: Q2_LONGMEMEVAL_DATASET_NAME,
  });
  const q1 = q1Projection(aggregate);
  const cell = {
    profile: profile.profile,
    provenance: "BENCHMARK_DERIVED",
    source_identity: sourceIdentity,
    denominator: {
      source_case_count: items.length,
      scoreable_case_count: aggregate.scoreable_case_count,
      unknown_or_unscoreable_case_count: aggregate.unknown_or_unscoreable_case_count,
      skipped_case_count: skippedCaseCount,
      retrieval_attempt_count: channelUsage.retrieval_attempt_count,
      official_retrieval_abstention: EXPECTED_LONGMEMEVAL_SHAPE.official_retrieval_abstention,
      official_retrieval_no_user_target: EXPECTED_LONGMEMEVAL_SHAPE.official_retrieval_no_user_target,
      evidence_session_count_distribution: EXPECTED_LONGMEMEVAL_SHAPE.evidence_session_count_distribution,
      budget_feasible_case_count: aggregate.budget_feasible_case_count,
      budget_infeasible_case_count: aggregate.budget_infeasible_case_count,
      cross_session_case_count: aggregate.cross_session_case_count,
    },
    q1,
    latency: latencyProjection(latency),
    channel_usage: channelUsage,
    source_breakdown: buildSourceBreakdown(rows, "question_type"),
  };
  return { cell, caseScores };
}

function validateLocomoRunShape(run) {
  if (!isRecord(run) || !Array.isArray(run.results) || !isRecord(run.run)) {
    throw new Error("STOP_Q2_A2_LOCOMO_RUN_INVALID");
  }
  if (run.results.length !== EXPECTED_LOCOMO_SHAPE.qa_count
      || run.profile !== LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE
      || run.run.top_k !== Q2_LOCOMO_TOP_K
      || run.run.benchmark_now_sec !== Q2_LOCOMO_BENCHMARK_NOW_SEC
      || run.run.materialization_now_sec !== Q2_LOCOMO_BENCHMARK_NOW_SEC
      || run.run.search_now_sec !== Q2_LOCOMO_BENCHMARK_NOW_SEC
      || run.summary?.cases !== EXPECTED_LOCOMO_SHAPE.qa_count
      || run.summary?.retrieval_cases !== EXPECTED_LOCOMO_SHAPE.retrieval_latency_attempt_count
      || run.summary?.strict?.scored_cases !== EXPECTED_LOCOMO_SHAPE.strict_metric_case_count
      || run.summary?.strict?.skipped_cases !== EXPECTED_LOCOMO_SHAPE.strict_skipped_case_count) {
    throw new Error("STOP_Q2_A2_LOCOMO_RUN_SHAPE_MISMATCH");
  }
}

function bindLocomoProfileInternal(records, run, profile, datasetSha256) {
  const items = normalizeLocomoDataset(records, { evidencePolicy: LOCOMO_EVIDENCE_STRICT_V1 });
  validateLocomoRunShape(run);
  const sourceIdentity = profileSourceIdentity(
    Q2_LOCOMO_DATASET_NAME,
    datasetSha256,
    profile,
    {
      upstream_repository: LOCOMO_UPSTREAM_REPOSITORY,
      upstream_commit: LOCOMO_UPSTREAM_COMMIT,
      dataset_file_commit: LOCOMO_DATASET_FILE_COMMIT,
      dataset_path: LOCOMO_DATASET_PATH,
      license_identity: LOCOMO_LICENSE_IDENTITY,
      evidence_policy: LOCOMO_EVIDENCE_STRICT_V1,
      runner_profile: LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE,
      q1_metric_level: "session",
      benchmark_now_sec: Q2_LOCOMO_BENCHMARK_NOW_SEC,
      materialization_now_sec: Q2_LOCOMO_BENCHMARK_NOW_SEC,
      search_now_sec: Q2_LOCOMO_BENCHMARK_NOW_SEC,
      benchmark_clock_contract: "locomo_materialization_and_search_fixed_v2",
      evidence_unit: "session",
      channel_capabilities: profile.channel_capabilities,
    },
  );
  const rows = [];
  const caseScores = [];
  const latencySamples = [];
  const channelUsage = createChannelUsage();
  let resultIndex = 0;
  let strictScored = 0;
  let strictSkipped = 0;
  let retrievalAttempts = 0;

  for (const item of items) {
    for (const question of item.questions) {
      const result = run.results[resultIndex];
      if (!result || result.question_id !== question.question_id || result.category !== question.category) {
        throw new Error(`STOP_Q2_A2_LOCOMO_RESULT_IDENTITY_MISMATCH:${resultIndex}`);
      }
      const attempted = result.sensitivity?.scoreable === true;
      if (attempted) {
        if (!Array.isArray(result.retrieved_session_ids)
            || !finiteNumber(result.latency_ms)
            || result.latency_ms < 0
            || !result.diagnostics) {
          throw new Error(`STOP_Q2_A2_LOCOMO_RETRIEVAL_RESULT_INVALID:${resultIndex}`);
        }
        const observed = assertQ2ObservedChannelContract(profile, result.diagnostics);
        recordObservedChannels(channelUsage, observed);
        latencySamples.push(result.latency_ms);
        retrievalAttempts += 1;
      }

      const scoreable = question.scoreable === true;
      if (scoreable) {
        if (!attempted) throw new Error(`STOP_Q2_A2_LOCOMO_SCOREABLE_RETRIEVAL_MISSING:${resultIndex}`);
        const score = createRankingScore(
          question,
          result.retrieved_session_ids,
          sourceIdentity,
          true,
        );
        rows.push({
          ...score,
          category: question.category,
          category_name: question.category_name,
        });
        caseScores.push({ score, scoreable: true });
        strictScored += 1;
      } else {
        const score = createRankingScore(question, undefined, sourceIdentity, false);
        rows.push({
          ...score,
          category: question.category,
          category_name: question.category_name,
        });
        caseScores.push({ score, scoreable: false });
        strictSkipped += 1;
      }
      resultIndex += 1;
    }
  }

  if (resultIndex !== EXPECTED_LOCOMO_SHAPE.qa_count
      || strictScored !== EXPECTED_LOCOMO_SHAPE.strict_metric_case_count
      || strictSkipped !== EXPECTED_LOCOMO_SHAPE.strict_skipped_case_count
      || retrievalAttempts !== EXPECTED_LOCOMO_SHAPE.retrieval_latency_attempt_count
      || latencySamples.length !== retrievalAttempts
      || channelUsage.retrieval_attempt_count !== retrievalAttempts) {
    throw new Error(`STOP_Q2_A2_LOCOMO_PROFILE_POPULATION_MISMATCH:${profile.profile}`);
  }
  const aggregate = aggregateQ1EvidenceRankingAt3(rows);
  if (aggregate.aggregation_refused !== false) {
    throw new Error(`STOP_Q2_A2_LOCOMO_Q1_AGGREGATION_REFUSED:${profile.profile}`);
  }
  const latency = summarizeQ1LatencyWindow({
    started_trace_count: retrievalAttempts,
    completed_latency_samples: latencySamples,
    incomplete_trace_count: 0,
    error_or_timeout_count: 0,
    provenance: "BENCHMARK_DERIVED",
    source_identity: sourceIdentity,
    dataset_identity: Q2_LOCOMO_DATASET_NAME,
  });
  const q1 = q1Projection(aggregate);
  const cell = {
    profile: profile.profile,
    provenance: "BENCHMARK_DERIVED",
    source_identity: sourceIdentity,
    denominator: {
      conversation_count: EXPECTED_LOCOMO_SHAPE.conversation_count,
      session_count: EXPECTED_LOCOMO_SHAPE.session_count,
      turn_count: EXPECTED_LOCOMO_SHAPE.turn_count,
      qa_count: EXPECTED_LOCOMO_SHAPE.qa_count,
      strict_metric_case_count: strictScored,
      strict_skipped_case_count: strictSkipped,
      retrieval_latency_attempt_count: retrievalAttempts,
      retrieval_attempt_count: retrievalAttempts,
      budget_feasible_case_count: aggregate.budget_feasible_case_count,
      budget_infeasible_case_count: aggregate.budget_infeasible_case_count,
      cross_session_case_count: aggregate.cross_session_case_count,
    },
    q1,
    latency: latencyProjection(latency),
    channel_usage: channelUsage,
    source_breakdown: buildSourceBreakdown(rows, "category", "category_name"),
  };
  return { cell, caseScores };
}

export function bindQ2LongMemEvalProfile(records, run, options = {}) {
  const profile = resolveQ2ChannelAblationProfile(options.profile || "q2_non_vector_full_v1");
  if (profile.executable_in_q2_a1 !== true) {
    throw new Error(`q2_profile_not_executable:${profile.profile}`);
  }
  return bindLongProfileInternal(
    records,
    run,
    profile,
    options.datasetSha256 || Q2_LONGMEMEVAL_DATASET_SHA256,
  ).cell;
}

export function bindQ2LocomoProfile(records, run, options = {}) {
  const profile = resolveQ2ChannelAblationProfile(options.profile || "q2_non_vector_full_v1");
  if (profile.executable_in_q2_a1 !== true) {
    throw new Error(`q2_profile_not_executable:${profile.profile}`);
  }
  return bindLocomoProfileInternal(
    records,
    run,
    profile,
    options.datasetSha256 || Q2_LOCOMO_DATASET_SHA256,
  ).cell;
}

function metricFromCell(cell, metric) {
  return cell?.q1?.[metric];
}

function factorialValue(value) {
  return finiteNumber(value) ? value : null;
}

export function computeQ2FactorialEffects(profileCells) {
  const cells = profileCells instanceof Map
    ? Object.fromEntries([...profileCells.entries()].map(([name, value]) => [name, value.cell || value]))
    : profileCells;
  const required = Q2_NON_VECTOR_PROFILE_ORDER;
  for (const profile of required) {
    if (!isRecord(cells?.[profile])) throw new Error(`q2_factorial_profile_missing:${profile}`);
  }
  return Object.fromEntries(Q2_FACTORIAL_METRICS.map(metric => {
    const F = factorialValue(metricFromCell(cells.q2_fts_only_v1, metric));
    const K = factorialValue(metricFromCell(cells.q2_fts_kg_v1, metric));
    const R = factorialValue(metricFromCell(cells.q2_fts_recent_v1, metric));
    const KR = factorialValue(metricFromCell(cells.q2_non_vector_full_v1, metric));
    const complete = [F, K, R, KR].every(finiteNumber);
    return [metric, {
      F,
      K,
      R,
      KR,
      kg_effect_without_recent: complete ? K - F : null,
      kg_effect_with_recent: complete ? KR - R : null,
      recent_effect_without_kg: complete ? R - F : null,
      recent_effect_with_kg: complete ? KR - K : null,
      interaction: complete ? KR - K - R + F : null,
    }];
  }));
}

function transitionForMetric(ablationScores, fullScores, metric) {
  const result = {
    improved: 0,
    regressed: 0,
    unchanged: 0,
    comparable_case_count: 0,
  };
  const count = Math.min(ablationScores.length, fullScores.length);
  for (let index = 0; index < count; index += 1) {
    if (ablationScores[index]?.scoreable !== true || fullScores[index]?.scoreable !== true) continue;
    const ablation = ablationScores[index].score?.[metric];
    const full = fullScores[index].score?.[metric];
    if (!finiteNumber(ablation) || !finiteNumber(full)) continue;
    result.comparable_case_count += 1;
    if (ablation > full + 1e-12) result.improved += 1;
    else if (ablation < full - 1e-12) result.regressed += 1;
    else result.unchanged += 1;
  }
  return result;
}

export function computeQ2PairedTransitions(profileCells) {
  const cells = profileCells instanceof Map ? profileCells : new Map(Object.entries(profileCells || {}));
  const full = cells.get("q2_non_vector_full_v1");
  if (!full?.caseScores) throw new Error("q2_paired_full_profile_missing");
  return Object.fromEntries(Q2_ABLATION_PROFILE_ORDER.map(profile => {
    const ablation = cells.get(profile);
    if (!ablation?.caseScores) throw new Error(`q2_paired_profile_missing:${profile}`);
    return [profile, {
      against_profile: "q2_non_vector_full_v1",
      scoreable_case_count: full.caseScores.filter(row => row.scoreable === true).length,
      metrics: Object.fromEntries(Q2_PAIRED_TRANSITION_METRICS.map(metric => [
        metric,
        transitionForMetric(ablation.caseScores, full.caseScores, metric),
      ])),
    }];
  }));
}

function sourceShapeLongMemEval(records) {
  if (!Array.isArray(records)) throw new Error("STOP_Q2_A2_LONGMEMEVAL_SOURCE_NOT_ARRAY");
  const items = records.map(normalizeLongMemEvalCase);
  const evidenceCounts = {};
  let scored = 0;
  let abstention = 0;
  let noUserTarget = 0;
  for (const item of items) {
    if (item.abstention) abstention += 1;
    const hasTarget = hasLongMemEvalUserTarget(item);
    if (!item.abstention && !hasTarget) noUserTarget += 1;
    if (!item.abstention && hasTarget) {
      scored += 1;
      const count = String(new Set(item.evidence_session_ids).size);
      evidenceCounts[count] = (evidenceCounts[count] || 0) + 1;
    }
  }
  const shape = {
    source_case_count: items.length,
    scoreable_case_count: scored,
    skipped_case_count: items.length - scored,
    official_retrieval_abstention: abstention,
    official_retrieval_no_user_target: noUserTarget,
    evidence_session_count_distribution: sortedObject(Object.entries(evidenceCounts)),
  };
  if (!exactEqual(shape, EXPECTED_LONGMEMEVAL_SHAPE)) {
    throw new Error(`STOP_Q2_A2_LONGMEMEVAL_SOURCE_SHAPE_MISMATCH:${JSON.stringify(shape)}`);
  }
  return { items, shape };
}

export function validateQ2LongMemEvalSource(records) {
  return sourceShapeLongMemEval(records);
}

export function validateQ2LocomoSource(records, bytes) {
  let validation;
  try {
    validation = assertOfficialLocomoDataset(records, bytes);
  } catch (error) {
    throw new Error(`STOP_Q2_A2_LOCOMO_SOURCE_VALIDATION:${boundedError(error)}`);
  }
  const strict = validation.policies?.[LOCOMO_EVIDENCE_STRICT_V1];
  if (!strict
      || validation.conversations !== EXPECTED_LOCOMO_SHAPE.conversation_count
      || validation.sessions !== EXPECTED_LOCOMO_SHAPE.session_count
      || validation.turns !== EXPECTED_LOCOMO_SHAPE.turn_count
      || validation.qa !== EXPECTED_LOCOMO_SHAPE.qa_count
      || strict.scored_cases !== EXPECTED_LOCOMO_SHAPE.strict_metric_case_count
      || strict.skipped_cases !== EXPECTED_LOCOMO_SHAPE.strict_skipped_case_count) {
    throw new Error("STOP_Q2_A2_LOCOMO_SOURCE_SHAPE_MISMATCH");
  }
  return {
    ...validation,
    retrieval_latency_attempt_count: EXPECTED_LOCOMO_SHAPE.retrieval_latency_attempt_count,
  };
}

export function validateQ2AuthorityHashes({
  q1BaselineFixtureSha256,
  longmemevalSha256,
  locomoSha256,
} = {}) {
  const checks = {
    q1_baseline_fixture: [q1BaselineFixtureSha256, Q2_Q1_BASELINE_FIXTURE_SHA256],
    longmemeval: [longmemevalSha256, Q2_LONGMEMEVAL_DATASET_SHA256],
    locomo: [locomoSha256, Q2_LOCOMO_DATASET_SHA256],
  };
  const mismatches = Object.entries(checks)
    .filter(([, [actual, expected]]) => actual !== expected)
    .map(([name, [actual, expected]]) => ({ name, actual, expected }));
  return {
    valid: mismatches.length === 0,
    mismatches,
  };
}

export function assertQ2AuthorityHashes(values) {
  const validation = validateQ2AuthorityHashes(values);
  if (!validation.valid) {
    throw new Error(`STOP_Q2_A2_AUTHORITY_HASH_MISMATCH:${validation.mismatches.map(item => item.name).join(",")}`);
  }
  return validation;
}

function parityBreakdown(actual, expected, path, mismatches) {
  const actualKeys = Object.keys(actual || {}).sort();
  const expectedKeys = Object.keys(expected || {}).sort();
  compareExact(actualKeys, expectedKeys, `${path}.keys`, mismatches);
  for (const key of expectedKeys) {
    const actualQ1 = actual?.[key]?.q1 || {};
    const expectedQ1 = expected?.[key]?.q1 || {};
    for (const field of EXACT_PARITY_FIELDS) {
      compareExact(actualQ1[field], expectedQ1[field], `${path}.${key}.q1.${field}`, mismatches);
    }
    for (const field of FLOAT_PARITY_FIELDS) {
      compareFloat(actualQ1[field], expectedQ1[field], `${path}.${key}.q1.${field}`, mismatches);
    }
  }
}

function parityRanking(actual, expected, path, mismatches) {
  for (const field of EXACT_PARITY_FIELDS) {
    compareExact(actual?.[field], expected?.[field], `${path}.${field}`, mismatches);
  }
  for (const field of FLOAT_PARITY_FIELDS) {
    compareFloat(actual?.[field], expected?.[field], `${path}.${field}`, mismatches);
  }
}

export function compareQ2ProfileToQ1Baseline(actualCell, expectedTrack, { dataset = "unknown" } = {}) {
  const mismatches = [];
  const expectedDenominator = expectedTrack?.denominator || {};
  const actualDenominator = actualCell?.denominator || {};
  const denominatorFields = dataset === Q2_LONGMEMEVAL_DATASET_NAME
    ? [
      ["source_case_count", "source_case_count"],
      ["scoreable_case_count", "scoreable_case_count"],
      ["skipped_case_count", "skipped_case_count"],
      ["retrieval_attempt_count", "retrieval_attempt_count"],
      ["official_retrieval_abstention", "official_retrieval_abstention"],
      ["official_retrieval_no_user_target", "official_retrieval_no_user_target"],
      ["evidence_session_count_distribution", "evidence_session_count_distribution"],
    ]
    : [
      ["strict_metric_case_count", "strict_metric_case_count"],
      ["strict_skipped_case_count", "strict_skipped_case_count"],
      ["retrieval_latency_attempt_count", "retrieval_latency_attempt_count"],
    ];
  for (const [actualKey, expectedKey] of denominatorFields) {
    compareExact(actualDenominator[actualKey], expectedDenominator[expectedKey], `denominator.${actualKey}`, mismatches);
  }
  parityRanking(actualCell?.q1, expectedTrack?.q1, "q1", mismatches);
  const expectedBreakdown = dataset === Q2_LONGMEMEVAL_DATASET_NAME
    ? expectedTrack?.by_question_type
    : expectedTrack?.by_category;
  parityBreakdown(actualCell?.source_breakdown, expectedBreakdown, "source_breakdown", mismatches);
  return {
    schema: Q2_NON_VECTOR_ABLATION_SCHEMA,
    dataset,
    profile: actualCell?.profile || null,
    tolerance: 1e-12,
    status: mismatches.length === 0 ? "PASS" : "STOP_Q2_A2_BASELINE_PARITY_MISMATCH",
    mismatch_count: mismatches.length,
    mismatches,
  };
}

export function assertQ2BaselineParity(actualCell, expectedTrack, options = {}) {
  const comparison = compareQ2ProfileToQ1Baseline(actualCell, expectedTrack, options);
  if (comparison.mismatch_count !== 0) {
    throw new Error(`STOP_Q2_A2_BASELINE_PARITY_MISMATCH:${comparison.dataset}:${comparison.mismatches[0]?.path || "unknown"}`);
  }
  return comparison;
}

function populationSignature(cell) {
  const denominator = cell?.denominator || {};
  return {
    source_case_count: denominator.source_case_count,
    scoreable_case_count: denominator.scoreable_case_count,
    unknown_or_unscoreable_case_count: denominator.unknown_or_unscoreable_case_count,
    skipped_case_count: denominator.skipped_case_count,
    strict_metric_case_count: denominator.strict_metric_case_count,
    strict_skipped_case_count: denominator.strict_skipped_case_count,
    retrieval_attempt_count: denominator.retrieval_attempt_count,
    retrieval_latency_attempt_count: denominator.retrieval_latency_attempt_count,
    official_retrieval_abstention: denominator.official_retrieval_abstention,
    official_retrieval_no_user_target: denominator.official_retrieval_no_user_target,
    evidence_session_count_distribution: denominator.evidence_session_count_distribution,
    budget_feasible_case_count: denominator.budget_feasible_case_count,
    budget_infeasible_case_count: denominator.budget_infeasible_case_count,
    cross_session_case_count: denominator.cross_session_case_count,
    source_breakdown_keys: Object.keys(cell?.source_breakdown || {}).sort(),
  };
}

export function assertQ2ProfilePopulation(profileCells, dataset = "unknown") {
  const cells = profileCells instanceof Map
    ? Object.fromEntries([...profileCells.entries()].map(([name, value]) => [name, value.cell || value]))
    : profileCells;
  const baseline = populationSignature(cells?.q2_non_vector_full_v1);
  for (const profile of Q2_NON_VECTOR_PROFILE_ORDER) {
    if (!cells?.[profile]) throw new Error(`STOP_Q2_A2_PROFILE_POPULATION_MISSING:${dataset}:${profile}`);
    const signature = populationSignature(cells[profile]);
    if (!exactEqual(signature, baseline)) {
      throw new Error(`STOP_Q2_A2_PROFILE_POPULATION_DRIFT:${dataset}:${profile}`);
    }
  }
  return { valid: true, dataset, population: baseline };
}

export function assertQ2NoCrossDatasetPooling(values) {
  const tracks = Array.isArray(values) ? values : Object.values(values || {});
  const missingIdentity = tracks.some(value => (
    !isRecord(value?.source_identity)
      || typeof value.source_identity.dataset !== "string"
      || value.source_identity.dataset.trim() === ""
      || typeof value.source_identity.dataset_sha256 !== "string"
      || value.source_identity.dataset_sha256.trim() === ""
      || typeof value.provenance !== "string"
  ));
  if (missingIdentity) throw new Error("q2_source_identity_required");
  const datasets = [...new Set(tracks.map(value => value.source_identity.dataset))];
  const datasetHashes = [...new Set(tracks.map(value => value.source_identity.dataset_sha256))];
  const provenances = [...new Set(tracks.map(value => value.provenance))];
  if (datasets.length > 1) throw new Error(`q2_cross_dataset_pooling_refused:${datasets.join(",")}`);
  if (datasetHashes.length > 1) throw new Error("q2_cross_dataset_source_hash_pooling_refused");
  if (provenances.length > 1) throw new Error(`q2_cross_provenance_pooling_refused:${provenances.join(",")}`);
  return { valid: true, datasets, dataset_hashes: datasetHashes, provenances };
}

function collectForbiddenKeys(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectForbiddenKeys(entry, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const numericSessionCount = key === "sessions" && typeof child === "number";
    if (FORBIDDEN_FIXTURE_KEYS.has(key) && !numericSessionCount) {
      errors.push(`raw_payload_key:${path}.${key}`);
    }
    if (FORBIDDEN_POOLING_KEYS.has(key)) errors.push(`cross_dataset_pooling_key:${path}.${key}`);
    collectForbiddenKeys(child, `${path}.${key}`, errors);
  }
}

function validateTrackEnvelope(track, dataset, errors) {
  if (!isRecord(track)) {
    errors.push(`track_missing:${dataset}`);
    return;
  }
  if (track.baseline_parity?.status !== "PASS" || track.baseline_parity?.mismatch_count !== 0) {
    errors.push(`baseline_parity:${dataset}`);
  }
  if (track.source_breakdown === undefined) errors.push(`source_breakdown_missing:${dataset}`);
  const profiles = track.profiles;
  compareExact(Object.keys(profiles || {}).sort(), [...Q2_NON_VECTOR_PROFILE_ORDER].sort(), `profiles.${dataset}.keys`, errors);
  const fullCell = profiles?.q2_non_vector_full_v1;
  const fullPopulation = populationSignature(fullCell);
  for (const profile of Q2_NON_VECTOR_PROFILE_ORDER) {
    const cell = profiles?.[profile];
    if (!isRecord(cell)) {
      errors.push(`profile_missing:${dataset}:${profile}`);
      continue;
    }
    if (cell.profile !== profile || cell.provenance !== "BENCHMARK_DERIVED") {
      errors.push(`profile_identity:${dataset}:${profile}`);
    }
    if (cell.source_identity?.dataset !== dataset) errors.push(`dataset_identity:${dataset}:${profile}`);
    if (cell.source_identity?.dataset_sha256 !== (
      dataset === Q2_LONGMEMEVAL_DATASET_NAME ? Q2_LONGMEMEVAL_DATASET_SHA256 : Q2_LOCOMO_DATASET_SHA256
    )) errors.push(`dataset_sha256:${dataset}:${profile}`);
    if (cell.source_identity?.q1_baseline_fixture_sha256 !== Q2_Q1_BASELINE_FIXTURE_SHA256) {
      errors.push(`q1_baseline_fixture_sha256:${dataset}:${profile}`);
    }
    if (cell.source_identity?.q2_metric_contract_schema !== Q2_CHANNEL_ABLATION_SCHEMA) {
      errors.push(`q2_metric_contract_schema:${dataset}:${profile}`);
    }
    const expectedRunnerProfile = dataset === Q2_LONGMEMEVAL_DATASET_NAME
      ? LONGMEMEVAL_RETRIEVAL_PROFILE
      : LOCOMO_TIME_FROZEN_LEXICAL_RETRIEVAL_PROFILE;
    if (cell.source_identity?.runner_profile !== expectedRunnerProfile) {
      errors.push(`runner_profile:${dataset}:${profile}`);
    }
    if (cell.source_identity?.top_k !== Q2_EVALUATION_TOP_K) errors.push(`top_k:${dataset}:${profile}`);
    if (cell.channel_usage?.unexpected_served_channel_count !== 0) errors.push(`unexpected_channels:${dataset}:${profile}`);
    if (cell.channel_usage?.vector_served_case_count !== 0) errors.push(`vector_served:${dataset}:${profile}`);
    if (cell.q1?.aggregation_refused !== false || cell.q1?.aggregation_status !== "READY") {
      errors.push(`q1_aggregation:${dataset}:${profile}`);
    }
    const deltas = cell.absolute_delta_vs_full;
    compareExact(
      Object.keys(deltas || {}).sort(),
      [...Q2_FACTORIAL_METRICS].sort(),
      `absolute_delta_vs_full.${dataset}.${profile}.keys`,
      errors,
    );
    for (const metric of Q2_FACTORIAL_METRICS) {
      const expectedDelta = finiteNumber(cell.q1?.[metric]) && finiteNumber(fullCell?.q1?.[metric])
        ? cell.q1[metric] - fullCell.q1[metric]
        : null;
      compareFloat(
        deltas?.[metric],
        expectedDelta,
        `absolute_delta_vs_full.${dataset}.${profile}.${metric}`,
        errors,
      );
    }
    if (fullCell && !exactEqual(populationSignature(cell), fullPopulation)) {
      errors.push(`population_drift:${dataset}:${profile}`);
    }
  }
  const factorial = track.factorial_effects || {};
  for (const metric of Q2_FACTORIAL_METRICS) {
    if (!isRecord(factorial[metric])) errors.push(`factorial_metric_missing:${dataset}:${metric}`);
  }
  const transitions = track.paired_transitions || {};
  for (const profile of Q2_ABLATION_PROFILE_ORDER) {
    if (!isRecord(transitions[profile])) errors.push(`paired_transition_missing:${dataset}:${profile}`);
  }
}

export function validateQ2NonVectorAblationEnvelope(envelope) {
  const errors = [];
  if (!isRecord(envelope)) return { valid: false, errors: ["envelope_must_be_object"] };
  if (envelope.schema !== Q2_NON_VECTOR_ABLATION_SCHEMA) errors.push("schema_invalid");
  if (envelope.experiment_version !== Q2_NON_VECTOR_ABLATION_VERSION) errors.push("version_invalid");
  if (envelope.authority?.q1_baseline_fixture_sha256 !== Q2_Q1_BASELINE_FIXTURE_SHA256) {
    errors.push("q1_fixture_authority_invalid");
  }
  if (envelope.authority?.q1_metric_contract_schema !== Q2_Q1_METRIC_CONTRACT_SCHEMA) {
    errors.push("q1_metric_contract_schema_invalid");
  }
  if (envelope.authority?.q2_a1_profile_schema !== Q2_CHANNEL_ABLATION_SCHEMA) {
    errors.push("q2_a1_schema_invalid");
  }
  if (envelope.authority?.dataset_hashes?.longmemeval !== Q2_LONGMEMEVAL_DATASET_SHA256) {
    errors.push("longmemeval_hash_authority_invalid");
  }
  if (envelope.authority?.dataset_hashes?.locomo !== Q2_LOCOMO_DATASET_SHA256) {
    errors.push("locomo_hash_authority_invalid");
  }
  if (envelope.authority?.clocks?.longmemeval_benchmark_now_sec !== Q2_LONGMEMEVAL_BENCHMARK_NOW_SEC
      || envelope.authority?.clocks?.locomo_benchmark_now_sec !== Q2_LOCOMO_BENCHMARK_NOW_SEC
      || envelope.authority?.clocks?.locomo_materialization_now_sec !== Q2_LOCOMO_BENCHMARK_NOW_SEC
      || envelope.authority?.clocks?.locomo_search_now_sec !== Q2_LOCOMO_BENCHMARK_NOW_SEC) {
    errors.push("clock_authority_invalid");
  }
  if (envelope.authority?.top_k !== Q2_EVALUATION_TOP_K) errors.push("top_k_invalid");
  if (envelope.design?.factorial !== "KG x Recent with FTS fixed on") errors.push("factorial_design_invalid");
  compareExact(envelope.design?.profiles, [...Q2_NON_VECTOR_PROFILE_ORDER], "design.profiles", errors);
  validateTrackEnvelope(envelope.tracks?.longmemeval, Q2_LONGMEMEVAL_DATASET_NAME, errors);
  validateTrackEnvelope(envelope.tracks?.locomo, Q2_LOCOMO_DATASET_NAME, errors);
  if (envelope.interpretation?.offline_evaluation_only !== true) errors.push("offline_only_required");
  if (envelope.interpretation?.production_prevalence_claim !== false) errors.push("production_prevalence_forbidden");
  if (envelope.interpretation?.cross_dataset_pooling !== false) errors.push("cross_dataset_pooling_forbidden");
  if (envelope.interpretation?.provider_used !== false) errors.push("provider_use_forbidden");
  if (envelope.interpretation?.vector_enabled !== false) errors.push("vector_enablement_forbidden");
  collectForbiddenKeys(envelope, "$", errors);
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function assertQ2NonVectorAblationEnvelope(envelope) {
  const validation = validateQ2NonVectorAblationEnvelope(envelope);
  if (!validation.valid) throw new Error(`q2_non_vector_ablation_envelope_invalid:${validation.errors.join(",")}`);
  return validation;
}

function buildTrackEnvelope(profileCells, baselineParity, dataset) {
  const rawCells = Object.fromEntries(
    Q2_NON_VECTOR_PROFILE_ORDER.map(profile => [profile, profileCells.get(profile).cell]),
  );
  const fullCell = rawCells.q2_non_vector_full_v1;
  const cells = Object.fromEntries(Q2_NON_VECTOR_PROFILE_ORDER.map(profile => {
    const cell = rawCells[profile];
    return [profile, {
      ...cell,
      absolute_delta_vs_full: Object.fromEntries(Q2_FACTORIAL_METRICS.map(metric => {
        const value = metricFromCell(cell, metric);
        const fullValue = metricFromCell(fullCell, metric);
        return [metric, finiteNumber(value) && finiteNumber(fullValue) ? value - fullValue : null];
      })),
    }];
  }));
  assertQ2ProfilePopulation(cells, dataset);
  assertQ2NoCrossDatasetPooling(Object.values(cells));
  return {
    baseline_parity: baselineParity,
    profiles: cells,
    factorial_effects: computeQ2FactorialEffects(cells),
    paired_transitions: computeQ2PairedTransitions(profileCells),
    source_breakdown: Object.fromEntries(
      Q2_NON_VECTOR_PROFILE_ORDER.map(profile => [profile, cells[profile].source_breakdown]),
    ),
  };
}

export function buildQ2NonVectorAblationEnvelope({
  longmemeval,
  locomo,
  authority = {},
} = {}) {
  const envelope = {
    schema: Q2_NON_VECTOR_ABLATION_SCHEMA,
    experiment_version: Q2_NON_VECTOR_ABLATION_VERSION,
    authority: {
      q1_baseline_fixture_sha256: Q2_Q1_BASELINE_FIXTURE_SHA256,
      q1_metric_contract_schema: Q2_Q1_METRIC_CONTRACT_SCHEMA,
      q2_a1_profile_schema: Q2_CHANNEL_ABLATION_SCHEMA,
      dataset_hashes: {
        longmemeval: Q2_LONGMEMEVAL_DATASET_SHA256,
        locomo: Q2_LOCOMO_DATASET_SHA256,
      },
      clocks: {
        longmemeval_benchmark_now_sec: Q2_LONGMEMEVAL_BENCHMARK_NOW_SEC,
        locomo_benchmark_now_sec: Q2_LOCOMO_BENCHMARK_NOW_SEC,
        locomo_materialization_now_sec: Q2_LOCOMO_BENCHMARK_NOW_SEC,
        locomo_search_now_sec: Q2_LOCOMO_BENCHMARK_NOW_SEC,
      },
      top_k: Q2_EVALUATION_TOP_K,
      ...authority,
    },
    design: {
      factorial: "KG x Recent with FTS fixed on",
      profiles: [...Q2_NON_VECTOR_PROFILE_ORDER],
      fixed_channels: { fts: true, vector: false },
      ranking_policy: "production_unchanged",
      top_k: Q2_EVALUATION_TOP_K,
    },
    tracks: {
      longmemeval: buildTrackEnvelope(longmemeval.profileCells, longmemeval.baselineParity, Q2_LONGMEMEVAL_DATASET_NAME),
      locomo: buildTrackEnvelope(locomo.profileCells, locomo.baselineParity, Q2_LOCOMO_DATASET_NAME),
    },
    interpretation: {
      offline_evaluation_only: true,
      production_prevalence_claim: false,
      cross_dataset_pooling: false,
      provider_used: false,
      vector_enabled: false,
      ranking_policy_changed: false,
      rollout_authorization: "NONE",
    },
  };
  assertQ2NonVectorAblationEnvelope(envelope);
  return envelope;
}

async function executeLongProfile(records, profile, runDataset = runLongMemEvalRetrievalDataset) {
  return runDataset(records, {
    topK: Q2_LONGMEMEVAL_TOP_K,
    benchmarkNowSec: Q2_LONGMEMEVAL_BENCHMARK_NOW_SEC,
    channelCapabilities: profile.channel_capabilities,
  });
}

async function executeLocomoProfile(
  records,
  datasetSha256,
  profile,
  runDataset = runLocomoTimeFrozenLexicalRetrievalDataset,
  repositoryProvenance = Q2_A2_REPOSITORY_PROVENANCE,
) {
  const createRuntime = (dataPlane, options = {}) => createLocomoProductionHybridRuntime(dataPlane, {
    topK: options.topK,
    searchNowSec: options.searchNowSec,
    channelCapabilities: profile.channel_capabilities,
  });
  return runDataset(records, {
    topK: Q2_LOCOMO_TOP_K,
    benchmarkNowSec: Q2_LOCOMO_BENCHMARK_NOW_SEC,
    datasetSha256,
    repositoryProvenance,
    createRuntime,
  });
}

function assertQ1FixtureSource(fixture) {
  const validation = validateQ1CurrentBaselineEnvelope(fixture);
  if (!validation.valid) throw new Error(`STOP_Q2_A2_Q1_BASELINE_FIXTURE_INVALID:${validation.errors.join(",")}`);
}

export async function runQ2NonVectorAblation(options = {}) {
  const q1Path = options.q1BaselinePath || Q2_Q1_BASELINE_FIXTURE_PATH;
  const longPath = options.longmemevalPath || "/tmp/longmemeval_s_cleaned.json";
  const locomoPath = options.locomoPath || "/tmp/locomo10.json";
  const q1Source = readPinnedJson(q1Path, Q2_Q1_BASELINE_FIXTURE_SHA256, "q1_baseline_fixture");
  assertQ1FixtureSource(q1Source.value);
  const longSource = readPinnedJson(longPath, Q2_LONGMEMEVAL_DATASET_SHA256, "longmemeval");
  const longValidation = sourceShapeLongMemEval(longSource.value);
  const locomoSource = readPinnedJson(locomoPath, Q2_LOCOMO_DATASET_SHA256, "locomo");
  const locomoValidation = validateQ2LocomoSource(locomoSource.value, locomoSource.bytes);
  assertQ2AuthorityHashes({
    q1BaselineFixtureSha256: sha256Bytes(q1Source.bytes),
    longmemevalSha256: sha256Bytes(longSource.bytes),
    locomoSha256: sha256Bytes(locomoSource.bytes),
  });

  const runLongDataset = options.runLongDataset || runLongMemEvalRetrievalDataset;
  const runLocomoDataset = options.runLocomoDataset || runLocomoTimeFrozenLexicalRetrievalDataset;
  if (typeof runLongDataset !== "function" || typeof runLocomoDataset !== "function") {
    throw new Error("q2_runner_dataset_functions_required");
  }

  const fullProfile = resolveQ2ChannelAblationProfile("q2_non_vector_full_v1");
  const longRuns = new Map();
  const longFullRun = await executeLongProfile(longSource.value, fullProfile, runLongDataset);
  const longFull = bindLongProfileInternal(
    longSource.value,
    longFullRun,
    fullProfile,
    longSource.sha256,
  );
  const longParity = assertQ2BaselineParity(
    longFull.cell,
    q1Source.value.tracks.longmemeval_lexical_session,
    { dataset: Q2_LONGMEMEVAL_DATASET_NAME },
  );
  longRuns.set(fullProfile.profile, longFull);

  const locomoRuns = new Map();
  const locomoFullRun = await executeLocomoProfile(
    locomoSource.value,
    locomoSource.sha256,
    fullProfile,
    runLocomoDataset,
    options.repositoryProvenance || Q2_A2_REPOSITORY_PROVENANCE,
  );
  const locomoFull = bindLocomoProfileInternal(
    locomoSource.value,
    locomoFullRun,
    fullProfile,
    locomoSource.sha256,
  );
  const locomoParity = assertQ2BaselineParity(
    locomoFull.cell,
    q1Source.value.tracks.locomo_lexical_strict_session,
    { dataset: Q2_LOCOMO_DATASET_NAME },
  );
  locomoRuns.set(fullProfile.profile, locomoFull);

  // The full-profile parity gates above intentionally precede every ablation.
  for (const profileName of Q2_ABLATION_PROFILE_ORDER) {
    const profile = resolveQ2ChannelAblationProfile(profileName);
    const longRun = await executeLongProfile(longSource.value, profile, runLongDataset);
    longRuns.set(profile.profile, bindLongProfileInternal(
      longSource.value,
      longRun,
      profile,
      longSource.sha256,
    ));
    const locomoRun = await executeLocomoProfile(
      locomoSource.value,
      locomoSource.sha256,
      profile,
      runLocomoDataset,
      options.repositoryProvenance || Q2_A2_REPOSITORY_PROVENANCE,
    );
    locomoRuns.set(profile.profile, bindLocomoProfileInternal(
      locomoSource.value,
      locomoRun,
      profile,
      locomoSource.sha256,
    ));
  }

  assertQ2ProfilePopulation(longRuns, Q2_LONGMEMEVAL_DATASET_NAME);
  assertQ2ProfilePopulation(locomoRuns, Q2_LOCOMO_DATASET_NAME);
  const envelope = buildQ2NonVectorAblationEnvelope({
    longmemeval: {
      profileCells: longRuns,
      baselineParity: longParity,
    },
    locomo: {
      profileCells: locomoRuns,
      baselineParity: locomoParity,
    },
    authority: {
      dataset_shapes: {
        longmemeval: longValidation.shape,
        locomo: {
          conversations: locomoValidation.conversations,
          sessions: locomoValidation.sessions,
          turns: locomoValidation.turns,
          qa: locomoValidation.qa,
          strict_scored: locomoValidation.policies[LOCOMO_EVIDENCE_STRICT_V1].scored_cases,
          strict_skipped: locomoValidation.policies[LOCOMO_EVIDENCE_STRICT_V1].skipped_cases,
          retrieval_attempts: locomoValidation.retrieval_latency_attempt_count,
        },
      },
    },
  });
  return envelope;
}

export const runQ2NonVectorAblationV1 = runQ2NonVectorAblation;
export const generateQ2NonVectorAblationV1 = runQ2NonVectorAblation;
