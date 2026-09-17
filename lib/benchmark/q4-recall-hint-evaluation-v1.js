import { scoreQ1EvidenceRankingAt3 } from "./q1-product-metric-contract-v1.js";

export const Q4_RECALL_HINT_EVALUATION_SCHEMA = "memory_engine_q4_recall_hint_evaluation_v1";
export const Q4_RECALL_HINT_SPLITS = Object.freeze(["development", "acceptance"]);
export const Q4_RECALL_HINT_FAMILIES = Object.freeze(["entity_reference", "temporal_relation", "multi_facet", "protection"]);
export const Q4_RECALL_HINT_MAX_POOL_DEPTH = 20;
export const Q4_RECALL_HINT_TOP_K = 3;
export const Q4_RECALL_HINT_MAX_PROVIDER_CALLS = 1;
export const Q4_RECALL_HINT_MAX_EXTRA_VECTOR_CALLS = 2;

const FINAL_METRICS = Object.freeze([
  "recall_any@3",
  "recall_all@3",
  "ndcg@3",
  "evidence_coverage@3",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function uniqueStrings(values, field) {
  if (!Array.isArray(values) || values.some(value => typeof value !== "string" || value.trim() === "")) {
    throw new Error(`q4_recall_hint_${field}_must_be_string_array`);
  }
  return [...new Set(values.map(value => value.trim()))];
}

function validateRun(run, field) {
  if (!isRecord(run)) throw new Error(`q4_recall_hint_${field}_run_required`);
  const candidatePoolIds = uniqueStrings(run.candidate_pool_ids, `${field}_candidate_pool_ids`);
  const rankedTop3Ids = uniqueStrings(run.ranked_top3_ids, `${field}_ranked_top3_ids`);
  if (candidatePoolIds.length > Q4_RECALL_HINT_MAX_POOL_DEPTH) {
    throw new Error(`q4_recall_hint_${field}_candidate_pool_exceeds_depth`);
  }
  if (rankedTop3Ids.length > Q4_RECALL_HINT_TOP_K) {
    throw new Error(`q4_recall_hint_${field}_ranked_results_exceed_top_k`);
  }
  if (!finiteNonNegative(run.latency_ms)) {
    throw new Error(`q4_recall_hint_${field}_latency_invalid`);
  }
  return {
    candidate_pool_ids: candidatePoolIds,
    ranked_top3_ids: rankedTop3Ids,
    latency_ms: run.latency_ms,
  };
}

function validateHintAccounting(hint) {
  const providerCalls = Number(hint?.provider_calls ?? 0);
  const extraEmbeddingCalls = Number(hint?.extra_embedding_calls ?? 0);
  const extraVectorSearchCalls = Number(hint?.extra_vector_search_calls ?? 0);
  const inputTokens = Number(hint?.provider_input_tokens ?? 0);
  const outputTokens = Number(hint?.provider_output_tokens ?? 0);
  for (const [field, value] of [
    ["provider_calls", providerCalls],
    ["extra_embedding_calls", extraEmbeddingCalls],
    ["extra_vector_search_calls", extraVectorSearchCalls],
    ["provider_input_tokens", inputTokens],
    ["provider_output_tokens", outputTokens],
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`q4_recall_hint_${field}_invalid`);
    }
  }
  if (providerCalls > Q4_RECALL_HINT_MAX_PROVIDER_CALLS) {
    throw new Error("q4_recall_hint_provider_call_budget_exceeded");
  }
  if (extraEmbeddingCalls > Q4_RECALL_HINT_MAX_EXTRA_VECTOR_CALLS) {
    throw new Error("q4_recall_hint_extra_embedding_budget_exceeded");
  }
  if (extraVectorSearchCalls > Q4_RECALL_HINT_MAX_EXTRA_VECTOR_CALLS) {
    throw new Error("q4_recall_hint_extra_vector_search_budget_exceeded");
  }
  const status = typeof hint?.hint_status === "string" && hint.hint_status.trim()
    ? hint.hint_status.trim()
    : "unknown";
  return {
    provider_calls: providerCalls,
    extra_embedding_calls: extraEmbeddingCalls,
    extra_vector_search_calls: extraVectorSearchCalls,
    provider_input_tokens: inputTokens,
    provider_output_tokens: outputTokens,
    hint_status: status,
    fallback: hint?.fallback === true,
  };
}

function poolScore(goldEvidenceIds, poolIds) {
  const gold = new Set(goldEvidenceIds);
  const observed = new Set(poolIds.filter(id => gold.has(id)));
  return {
    evidence_coverage: observed.size / gold.size,
    pool_miss: observed.size !== gold.size,
    observed_gold_count: observed.size,
    gold_count: gold.size,
  };
}

function percentile(values, percentileValue) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index];
}

function metricValue(score, metric) {
  return score?.metrics?.[metric] ?? score?.[metric];
}

function pairedTransitions(rows, selector) {
  const result = {};
  for (const metric of FINAL_METRICS) {
    result[metric] = { improved: 0, regressed: 0, unchanged: 0 };
  }
  for (const row of rows) {
    if (!selector(row)) continue;
    for (const metric of FINAL_METRICS) {
      const baseline = metricValue(row.baseline.final, metric);
      const hint = metricValue(row.hint.final, metric);
      if (!Number.isFinite(baseline) || !Number.isFinite(hint)) continue;
      if (hint > baseline + 1e-12) result[metric].improved += 1;
      else if (baseline > hint + 1e-12) result[metric].regressed += 1;
      else result[metric].unchanged += 1;
    }
  }
  return result;
}

function aggregateRows(rows, selector) {
  const selected = rows.filter(selector);
  if (selected.length === 0) return null;
  const sum = (fn) => selected.reduce((total, row) => total + fn(row), 0);
  const mean = (fn) => sum(fn) / selected.length;
  const baselinePoolMiss = sum(row => Number(row.baseline.pool.pool_miss));
  const hintPoolMiss = sum(row => Number(row.hint.pool.pool_miss));
  const aggregate = {
    case_count: selected.length,
    baseline: {
      pool_evidence_coverage: mean(row => row.baseline.pool.evidence_coverage),
      pool_miss_count: baselinePoolMiss,
      recall_any_at_3: mean(row => metricValue(row.baseline.final, "recall_any@3")),
      recall_all_at_3: mean(row => metricValue(row.baseline.final, "recall_all@3")),
      ndcg_at_3: mean(row => metricValue(row.baseline.final, "ndcg@3")),
      evidence_coverage_at_3: mean(row => metricValue(row.baseline.final, "evidence_coverage@3")),
      latency_p95_ms: percentile(selected.map(row => row.baseline.latency_ms), 0.95),
    },
    hint: {
      pool_evidence_coverage: mean(row => row.hint.pool.evidence_coverage),
      pool_miss_count: hintPoolMiss,
      recall_any_at_3: mean(row => metricValue(row.hint.final, "recall_any@3")),
      recall_all_at_3: mean(row => metricValue(row.hint.final, "recall_all@3")),
      ndcg_at_3: mean(row => metricValue(row.hint.final, "ndcg@3")),
      evidence_coverage_at_3: mean(row => metricValue(row.hint.final, "evidence_coverage@3")),
      latency_p95_ms: percentile(selected.map(row => row.hint.latency_ms), 0.95),
    },
    delta: {},
    paired: pairedTransitions(selected, () => true),
    cost: {
      provider_calls: sum(row => row.accounting.provider_calls),
      extra_embedding_calls: sum(row => row.accounting.extra_embedding_calls),
      extra_vector_search_calls: sum(row => row.accounting.extra_vector_search_calls),
      provider_input_tokens: sum(row => row.accounting.provider_input_tokens),
      provider_output_tokens: sum(row => row.accounting.provider_output_tokens),
      fallback_count: sum(row => Number(row.accounting.fallback)),
      fallback_rate: mean(row => Number(row.accounting.fallback)),
    },
  };
  for (const field of [
    "pool_evidence_coverage",
    "recall_any_at_3",
    "recall_all_at_3",
    "ndcg_at_3",
    "evidence_coverage_at_3",
    "latency_p95_ms",
  ]) {
    aggregate.delta[field] = aggregate.hint[field] - aggregate.baseline[field];
  }
  aggregate.delta.pool_miss_count = hintPoolMiss - baselinePoolMiss;
  return aggregate;
}

function evaluateTechnicalStopConditions(acceptance, protection) {
  if (!acceptance) return { status: "NOT_EVALUABLE", reasons: ["acceptance_split_empty"] };
  const reasons = [];
  if (acceptance.delta.pool_evidence_coverage < -1e-12) reasons.push("acceptance_pool_coverage_regressed");
  if (acceptance.delta.pool_miss_count > 0) reasons.push("acceptance_pool_miss_increased");
  if (acceptance.delta.recall_any_at_3 < -1e-12) reasons.push("acceptance_recall_any_regressed");
  if (acceptance.delta.recall_all_at_3 < -1e-12) reasons.push("acceptance_recall_all_regressed");
  const recallAllPaired = acceptance.paired["recall_all@3"];
  if (recallAllPaired.improved <= recallAllPaired.regressed) {
    reasons.push("acceptance_recall_all_paired_not_positive");
  }
  if (protection) {
    if (protection.delta.pool_evidence_coverage < -1e-12) {
      reasons.push("protection_pool_coverage_regressed");
    }
    if (protection.delta.pool_miss_count > 0) reasons.push("protection_pool_miss_increased");
    if (protection.paired["recall_any@3"].regressed > 0) {
      reasons.push("protection_recall_any_regression_observed");
    }
    if (protection.paired["recall_all@3"].regressed > 0) {
      reasons.push("protection_recall_all_regression_observed");
    }
  }
  return { status: reasons.length === 0 ? "PASS" : "STOP", reasons };
}

export function evaluateQ4RecallHintCases(cases) {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error("q4_recall_hint_cases_must_be_nonempty_array");
  }
  const seenIds = new Set();
  const rows = cases.map((record, index) => {
    if (!isRecord(record)) throw new Error(`q4_recall_hint_case_invalid:${index}`);
    const caseId = typeof record.case_id === "string" ? record.case_id.trim() : "";
    if (!caseId || seenIds.has(caseId)) throw new Error(`q4_recall_hint_case_id_invalid:${index}`);
    seenIds.add(caseId);
    if (!Q4_RECALL_HINT_SPLITS.includes(record.split)) throw new Error(`q4_recall_hint_split_invalid:${caseId}`);
    if (!Q4_RECALL_HINT_FAMILIES.includes(record.family)) throw new Error(`q4_recall_hint_family_invalid:${caseId}`);
    const goldEvidenceIds = uniqueStrings(record.gold_evidence_ids, `${caseId}_gold_evidence_ids`);
    if (goldEvidenceIds.length === 0) throw new Error(`q4_recall_hint_gold_evidence_empty:${caseId}`);
    const baselineRun = validateRun(record.baseline, `${caseId}_baseline`);
    const hintRun = validateRun(record.hint, `${caseId}_hint`);
    const accounting = validateHintAccounting(record.hint);
    return {
      case_id: caseId,
      split: record.split,
      family: record.family,
      gold_evidence_ids: goldEvidenceIds,
      baseline: {
        ...baselineRun,
        pool: poolScore(goldEvidenceIds, baselineRun.candidate_pool_ids),
        final: scoreQ1EvidenceRankingAt3({
          gold_evidence_ids: goldEvidenceIds,
          ranked_retrieved_ids: baselineRun.ranked_top3_ids,
        }),
      },
      hint: {
        ...hintRun,
        pool: poolScore(goldEvidenceIds, hintRun.candidate_pool_ids),
        final: scoreQ1EvidenceRankingAt3({
          gold_evidence_ids: goldEvidenceIds,
          ranked_retrieved_ids: hintRun.ranked_top3_ids,
        }),
      },
      accounting,
    };
  });

  const development = aggregateRows(rows, row => row.split === "development");
  const acceptance = aggregateRows(rows, row => row.split === "acceptance");
  const protection = aggregateRows(rows, row => row.split === "acceptance" && row.family === "protection");
  const families = Object.fromEntries(Q4_RECALL_HINT_FAMILIES.map(family => [
    family,
    aggregateRows(rows, row => row.split === "acceptance" && row.family === family),
  ]));
  const stopConditions = evaluateTechnicalStopConditions(acceptance, protection);

  return {
    schema: Q4_RECALL_HINT_EVALUATION_SCHEMA,
    top_k: Q4_RECALL_HINT_TOP_K,
    candidate_depth: Q4_RECALL_HINT_MAX_POOL_DEPTH,
    case_count: rows.length,
    development,
    acceptance,
    protection,
    families,
    technical_stop_conditions: stopConditions,
    rows,
  };
}
