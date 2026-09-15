export const C1A_ACCEPTANCE_THRESHOLDS = Object.freeze({
  recallAllDeltaPp: 8,
  evidenceCoverageDeltaPp: 5,
  recallAnyDeltaPp: -1,
  protectRegressionRateMax: 0.03,
  appliedRateMin: 0.99,
  fallbackRateMax: 0.01,
  p95MsMax: 2000,
  p99MsMax: 2400,
  sentinelExactTop3Required: 8,
  primaryCaseCount: 256,
});

function metric(row, key, side) {
  const value = row?.[side]?.metrics?.[key];
  if (!Number.isFinite(value)) throw new Error(`c1a_metric_missing:${side}:${key}:${row?.case_id ?? "unknown"}`);
  return value;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

function aggregateMetric(rows, key) {
  if (rows.length === 0) return null;
  const control = rows.map(row => metric(row, key, "control"));
  const final = rows.map(row => metric(row, key, "final"));
  const controlMean = mean(control);
  const finalMean = mean(final);
  return {
    control: controlMean,
    final: finalMean,
    delta_pp: (finalMean - controlMean) * 100,
  };
}

function pairedRecallAll(rows) {
  let improved = 0;
  let regressed = 0;
  let unchanged = 0;
  for (const row of rows) {
    const control = metric(row, "recall_all@3", "control");
    const final = metric(row, "recall_all@3", "final");
    if (final > control) improved += 1;
    else if (final < control) regressed += 1;
    else unchanged += 1;
  }
  return { improved, regressed, unchanged, net_improved: improved - regressed };
}

function protectRegression(rows) {
  const protectedRows = rows.filter(row => metric(row, "recall_all@3", "control") === 1);
  const regressions = protectedRows.filter(row => metric(row, "recall_all@3", "final") < 1).length;
  return {
    case_count: protectedRows.length,
    regression_count: regressions,
    regression_rate: protectedRows.length === 0 ? 0 : regressions / protectedRows.length,
  };
}

function reliability(rows) {
  const eligible = rows.filter(row => row.eligible === true);
  const attempted = eligible.filter(row => row.attempted === true);
  const applied = attempted.filter(row => row.provider_status === "applied");
  const fallback = attempted.filter(row => row.provider_status === "fallback");
  const structurallyInvalid = attempted.filter(row => row.structurally_invalid_response === true);
  return {
    eligible_count: eligible.length,
    attempted_count: attempted.length,
    applied_count: applied.length,
    fallback_count: fallback.length,
    structurally_invalid_count: structurallyInvalid.length,
    attempted_rate: eligible.length === 0 ? 0 : attempted.length / eligible.length,
    applied_rate: attempted.length === 0 ? 0 : applied.length / attempted.length,
    fallback_rate: attempted.length === 0 ? 0 : fallback.length / attempted.length,
  };
}

function latency(rows) {
  const values = rows
    .filter(row => row.provider_status === "applied" && Number.isFinite(row.adapter_elapsed_ms))
    .map(row => row.adapter_elapsed_ms);
  return {
    successful_count: values.length,
    p95_ms: percentile(values, 0.95),
    p99_ms: percentile(values, 0.99),
    max_ms: values.length === 0 ? null : Math.max(...values),
  };
}

function sentinelSummary(rows) {
  const appliedPairs = rows.filter(row => row.first_status === "applied" && row.second_status === "applied");
  const exactApplied = appliedPairs.filter(row => Array.isArray(row.first_top3)
    && Array.isArray(row.second_top3)
    && JSON.stringify(row.first_top3) === JSON.stringify(row.second_top3)).length;
  return {
    case_count: rows.length,
    applied_pair_count: appliedPairs.length,
    exact_top3_order_count: exactApplied,
  };
}

function metricView(rows) {
  return {
    case_count: rows.length,
    metrics: rows.length === 0 ? null : {
      "recall_all@3": aggregateMetric(rows, "recall_all@3"),
      "recall_any@3": aggregateMetric(rows, "recall_any@3"),
      "evidence_coverage@3": aggregateMetric(rows, "evidence_coverage@3"),
    },
  };
}

function normalizeExecutionSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("c1a_execution_summary_required");
  }
  const numeric = name => {
    const item = value[name];
    if (!Number.isSafeInteger(item) || item < 0) throw new Error(`c1a_execution_summary_invalid:${name}`);
    return item;
  };
  const boolean = name => {
    if (typeof value[name] !== "boolean") throw new Error(`c1a_execution_summary_invalid:${name}`);
    return value[name];
  };
  return {
    unauthorized_transmission_count: numeric("unauthorized_transmission_count"),
    automatic_retry_count: numeric("automatic_retry_count"),
    request_budget_exceeded: boolean("request_budget_exceeded"),
    token_budget_exceeded: boolean("token_budget_exceeded"),
    cost_cap_exceeded: boolean("cost_cap_exceeded"),
    evidence_integrity_ok: boolean("evidence_integrity_ok"),
  };
}

export function scoreC1AQualification({
  primaryRows,
  diagnosticRows = [],
  sentinelRows = [],
  executionSummary,
  thresholds = C1A_ACCEPTANCE_THRESHOLDS,
} = {}) {
  if (!Array.isArray(primaryRows) || primaryRows.length !== thresholds.primaryCaseCount) {
    throw new Error("c1a_primary_population_must_match_frozen_count");
  }
  if (!Array.isArray(diagnosticRows) || !Array.isArray(sentinelRows)) throw new Error("c1a_optional_rows_invalid");
  const execution = normalizeExecutionSummary(executionSummary);

  const recallAll = aggregateMetric(primaryRows, "recall_all@3");
  const recallAny = aggregateMetric(primaryRows, "recall_any@3");
  const evidenceCoverage = aggregateMetric(primaryRows, "evidence_coverage@3");
  const paired = pairedRecallAll(primaryRows);
  const protect = protectRegression(primaryRows);
  const reliabilitySummary = reliability(primaryRows);
  const latencySummary = latency(primaryRows);
  const sentinels = sentinelSummary(sentinelRows);

  const eligibleRows = primaryRows.filter(row => row.rerank_eligible === true);
  const appliedRows = primaryRows.filter(row => row.provider_status === "applied");

  const gates = {
    recall_all_delta: recallAll.delta_pp >= thresholds.recallAllDeltaPp,
    evidence_coverage_delta: evidenceCoverage.delta_pp >= thresholds.evidenceCoverageDeltaPp,
    recall_any_guardrail: recallAny.delta_pp >= thresholds.recallAnyDeltaPp,
    protect_regression: protect.regression_rate <= thresholds.protectRegressionRateMax,
    attempted_rate: reliabilitySummary.attempted_rate === 1,
    applied_rate: reliabilitySummary.applied_rate >= thresholds.appliedRateMin,
    fallback_rate: reliabilitySummary.fallback_rate <= thresholds.fallbackRateMax,
    structurally_invalid_response: reliabilitySummary.structurally_invalid_count === 0,
    latency_p95: latencySummary.p95_ms !== null && latencySummary.p95_ms <= thresholds.p95MsMax,
    latency_p99: latencySummary.p99_ms !== null && latencySummary.p99_ms <= thresholds.p99MsMax,
    sentinel_top3_stability: sentinels.case_count === thresholds.sentinelExactTop3Required
      && sentinels.applied_pair_count === thresholds.sentinelExactTop3Required
      && sentinels.exact_top3_order_count === thresholds.sentinelExactTop3Required,
    unauthorized_transmission: execution.unauthorized_transmission_count === 0,
    automatic_retry: execution.automatic_retry_count === 0,
    request_budget: execution.request_budget_exceeded === false,
    token_budget: execution.token_budget_exceeded === false,
    cost_cap: execution.cost_cap_exceeded === false,
    evidence_integrity: execution.evidence_integrity_ok === true,
  };

  return {
    schema: "memory_engine_r3_c1a_qualification_score_v1",
    views: {
      A_full_primary: metricView(primaryRows),
      B_rerank_eligible: metricView(eligibleRows),
      C_provider_applied: metricView(appliedRows),
    },
    primary: {
      case_count: primaryRows.length,
      metrics: {
        "recall_all@3": recallAll,
        "recall_any@3": recallAny,
        "evidence_coverage@3": evidenceCoverage,
      },
      paired_recall_all: paired,
      protect_regression: protect,
      reliability: reliabilitySummary,
      latency: latencySummary,
    },
    diagnostics: {
      case_count: diagnosticRows.length,
      by_stratum: Object.fromEntries([...new Set(diagnosticRows.map(row => row.stratum))].map(stratum => [
        stratum,
        diagnosticRows.filter(row => row.stratum === stratum).length,
      ])),
    },
    sentinels,
    execution,
    thresholds: { ...thresholds },
    gates,
    pass: Object.values(gates).every(Boolean),
  };
}
