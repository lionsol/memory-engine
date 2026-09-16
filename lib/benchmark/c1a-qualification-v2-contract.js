import { createHash } from "node:crypto";

import {
  C1A_MANIFEST_SCHEMA,
  classifyC1ADiagnosticCase,
  snapshotC1ACase,
} from "./c1a-qualification-manifest.js";
import {
  C1A_ACCEPTANCE_THRESHOLDS,
  scoreC1AQualification,
} from "./c1a-qualification-scorer.js";

export const C1A_V2_MANIFEST_SCHEMA = "memory_engine_r3_c1a_qualification_v2_manifest_v1";
export const C1A_V2_PRIMARY_COUNT = 256;
export const C1A_V2_SENTINEL_COUNT = 16;
export const C1A_V2_PRIOR_OBSERVED_UNIQUE_COUNT = 320;
export const C1A_V2_DIAGNOSTIC_QUOTAS = Object.freeze({
  protect: 20,
  recoverable_rank_miss: 20,
  candidate_miss: 12,
  top3_budget_infeasible: 12,
});

export const C1A_V2_ACCEPTANCE_THRESHOLDS = Object.freeze({
  recallAllDeltaPp: C1A_ACCEPTANCE_THRESHOLDS.recallAllDeltaPp,
  evidenceCoverageDeltaPp: C1A_ACCEPTANCE_THRESHOLDS.evidenceCoverageDeltaPp,
  recallAnyDeltaPp: C1A_ACCEPTANCE_THRESHOLDS.recallAnyDeltaPp,
  nonAdversarialProtectRegressionRateMax: C1A_ACCEPTANCE_THRESHOLDS.protectRegressionRateMax,
  appliedRateMin: C1A_ACCEPTANCE_THRESHOLDS.appliedRateMin,
  fallbackRateMax: C1A_ACCEPTANCE_THRESHOLDS.fallbackRateMax,
  p95MsMax: C1A_ACCEPTANCE_THRESHOLDS.p95MsMax,
  p99MsMax: C1A_ACCEPTANCE_THRESHOLDS.p99MsMax,
  sentinelCaseCount: C1A_V2_SENTINEL_COUNT,
  sentinelTop1ExactRequired: C1A_V2_SENTINEL_COUNT,
  sentinelTop3SetExactRequired: C1A_V2_SENTINEL_COUNT,
  primaryCaseCount: C1A_V2_PRIMARY_COUNT,
});

const PRIMARY_SALT = "memory-engine-r3-c1-a-v2-primary-v1\0";
const SENTINEL_SALT = "memory-engine-r3-c1-a-v2-sentinel-v1\0";
const DIAGNOSTIC_SALTS = Object.freeze({
  protect: "memory-engine-r3-c1-a-v2-diagnostic-protect-v1\0",
  recoverable_rank_miss: "memory-engine-r3-c1-a-v2-diagnostic-recoverable-v1\0",
  candidate_miss: "memory-engine-r3-c1-a-v2-diagnostic-candidate-miss-v1\0",
  top3_budget_infeasible: "memory-engine-r3-c1-a-v2-diagnostic-budget-v1\0",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sortedByHash(cases, salt) {
  return [...cases].sort((left, right) => {
    const leftHash = sha256(`${salt}${left.case_id}`);
    const rightHash = sha256(`${salt}${right.case_id}`);
    return leftHash.localeCompare(rightHash) || left.case_id.localeCompare(right.case_id);
  });
}

function observedIdsFromV1Manifest(observedManifest) {
  if (!observedManifest || typeof observedManifest !== "object" || Array.isArray(observedManifest)) {
    throw new Error("c1a_v2_observed_manifest_required");
  }
  if (observedManifest.schema !== C1A_MANIFEST_SCHEMA) {
    throw new Error("c1a_v2_observed_manifest_schema_invalid");
  }
  if (typeof observedManifest.manifest_sha256 !== "string" || observedManifest.manifest_sha256.length !== 64) {
    throw new Error("c1a_v2_observed_manifest_hash_invalid");
  }
  const { manifest_sha256: declaredHash, ...observedBody } = observedManifest;
  if (sha256(JSON.stringify(observedBody)) !== declaredHash) {
    throw new Error("c1a_v2_observed_manifest_hash_mismatch");
  }
  if (!Array.isArray(observedManifest.primary) || observedManifest.primary.length !== 256) {
    throw new Error("c1a_v2_observed_primary_invalid");
  }
  const diagnosticGroups = observedManifest.diagnostics;
  if (!diagnosticGroups || typeof diagnosticGroups !== "object" || Array.isArray(diagnosticGroups)) {
    throw new Error("c1a_v2_observed_diagnostics_invalid");
  }
  const diagnostics = Object.values(diagnosticGroups).flat();
  if (diagnostics.length !== 64) throw new Error("c1a_v2_observed_diagnostic_count_invalid");
  const primaryIds = new Set(observedManifest.primary.map(item => item?.case_id));
  const ids = new Set([...primaryIds, ...diagnostics.map(item => item?.case_id)]);
  if (ids.has(undefined) || ids.has(null) || ids.has("")) throw new Error("c1a_v2_observed_case_id_invalid");
  if (ids.size !== C1A_V2_PRIOR_OBSERVED_UNIQUE_COUNT) {
    throw new Error("c1a_v2_observed_unique_count_invalid");
  }
  if (!Array.isArray(observedManifest.sentinels)) throw new Error("c1a_v2_observed_sentinels_invalid");
  if (observedManifest.sentinels.some(item => !primaryIds.has(item?.case_id))) {
    throw new Error("c1a_v2_observed_sentinel_not_primary");
  }
  return ids;
}

export function buildC1AV2QualificationManifest({
  cases,
  eligibilityByCase = {},
  observedManifest,
  expectedSourceCaseCount = 1970,
  minimumPrimaryEligibilityRatio = 0.95,
  profile,
  sourceIdentity = null,
} = {}) {
  if (!Array.isArray(cases) || cases.length !== expectedSourceCaseCount) {
    throw new Error("c1a_v2_source_population_count_mismatch");
  }
  const allIds = new Set();
  for (const item of cases) {
    if (!item || typeof item.case_id !== "string" || item.case_id.length === 0) {
      throw new Error("c1a_v2_case_id_required");
    }
    if (allIds.has(item.case_id)) throw new Error(`c1a_v2_case_id_duplicate:${item.case_id}`);
    allIds.add(item.case_id);
  }

  const observedIds = observedIdsFromV1Manifest(observedManifest);
  for (const id of observedIds) {
    if (!allIds.has(id)) throw new Error(`c1a_v2_observed_case_not_in_source:${id}`);
  }
  const holdout = cases.filter(item => !observedIds.has(item.case_id));
  if (holdout.length !== expectedSourceCaseCount - C1A_V2_PRIOR_OBSERVED_UNIQUE_COUNT) {
    throw new Error("c1a_v2_holdout_population_count_mismatch");
  }

  const primary = sortedByHash(holdout, PRIMARY_SALT).slice(0, C1A_V2_PRIMARY_COUNT);
  if (primary.length !== C1A_V2_PRIMARY_COUNT) throw new Error("c1a_v2_primary_population_insufficient");
  const primaryIds = new Set(primary.map(item => item.case_id));
  const remaining = holdout.filter(item => !primaryIds.has(item.case_id));

  const diagnostics = {};
  const diagnosticIds = new Set();
  for (const [stratum, quota] of Object.entries(C1A_V2_DIAGNOSTIC_QUOTAS)) {
    const available = remaining.filter(item => (
      !diagnosticIds.has(item.case_id) && classifyC1ADiagnosticCase(item) === stratum
    ));
    const selected = sortedByHash(available, DIAGNOSTIC_SALTS[stratum]).slice(0, quota);
    if (selected.length !== quota) throw new Error(`c1a_v2_diagnostic_population_insufficient:${stratum}`);
    diagnostics[stratum] = selected;
    for (const item of selected) diagnosticIds.add(item.case_id);
  }

  const eligiblePrimary = primary.filter(item => eligibilityByCase[item.case_id] === true);
  const eligibilityRatio = eligiblePrimary.length / primary.length;
  if (!Number.isFinite(minimumPrimaryEligibilityRatio)
      || minimumPrimaryEligibilityRatio < 0
      || minimumPrimaryEligibilityRatio > 1) {
    throw new Error("c1a_v2_primary_eligibility_threshold_invalid");
  }
  if (eligibilityRatio < minimumPrimaryEligibilityRatio) {
    throw new Error("c1a_v2_primary_provider_eligibility_below_threshold");
  }
  const sentinels = sortedByHash(eligiblePrimary, SENTINEL_SALT).slice(0, C1A_V2_SENTINEL_COUNT);
  if (sentinels.length !== C1A_V2_SENTINEL_COUNT) throw new Error("c1a_v2_sentinel_population_insufficient");

  const body = {
    schema: C1A_V2_MANIFEST_SCHEMA,
    source_identity: sourceIdentity,
    prior_observed_manifest_sha256: observedManifest.manifest_sha256,
    profile: profile ?? null,
    population: {
      source_case_count: cases.length,
      excluded_prior_observed_unique_count: observedIds.size,
      holdout_case_count: holdout.length,
      primary_count: primary.length,
      diagnostic_count: diagnosticIds.size,
      sentinel_count: sentinels.length,
      primary_provider_eligible_count: eligiblePrimary.length,
      primary_provider_eligible_ratio: eligibilityRatio,
      minimum_primary_provider_eligible_ratio: minimumPrimaryEligibilityRatio,
    },
    primary: primary.map(snapshotC1ACase),
    diagnostics: Object.fromEntries(Object.entries(diagnostics).map(([stratum, rows]) => [
      stratum,
      rows.map(snapshotC1ACase),
    ])),
    sentinels: sentinels.map(snapshotC1ACase),
  };
  return {
    ...body,
    manifest_sha256: sha256(JSON.stringify(body)),
  };
}

function metric(row, key, side) {
  const value = row?.[side]?.metrics?.[key];
  if (!Number.isFinite(value)) throw new Error(`c1a_v2_metric_missing:${side}:${key}:${row?.case_id ?? "unknown"}`);
  return value;
}

function protectSummary(rows) {
  const protectedRows = rows.filter(row => metric(row, "recall_all@3", "control") === 1);
  const regressions = protectedRows.filter(row => metric(row, "recall_all@3", "final") < 1).length;
  return {
    case_count: protectedRows.length,
    regression_count: regressions,
    regression_rate: protectedRows.length === 0 ? 0 : regressions / protectedRows.length,
  };
}

function sameTop3Set(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function sentinelV2Summary(rows) {
  const applied = rows.filter(row => row.first_status === "applied" && row.second_status === "applied");
  let top1Exact = 0;
  let top3SetExact = 0;
  let orderedTop3Exact = 0;
  for (const row of applied) {
    if (Array.isArray(row.first_top3) && Array.isArray(row.second_top3)
        && row.first_top3[0] === row.second_top3[0]) top1Exact += 1;
    if (sameTop3Set(row.first_top3, row.second_top3)) top3SetExact += 1;
    if (JSON.stringify(row.first_top3) === JSON.stringify(row.second_top3)) orderedTop3Exact += 1;
  }
  return {
    case_count: rows.length,
    applied_pair_count: applied.length,
    top1_exact_count: top1Exact,
    top3_set_exact_count: top3SetExact,
    ordered_top3_exact_count: orderedTop3Exact,
  };
}

export function scoreC1AV2Qualification({
  primaryRows,
  diagnosticRows = [],
  sentinelRows = [],
  executionSummary,
  thresholds = C1A_V2_ACCEPTANCE_THRESHOLDS,
} = {}) {
  if (!Array.isArray(primaryRows) || primaryRows.length !== thresholds.primaryCaseCount) {
    throw new Error("c1a_v2_primary_population_must_match_frozen_count");
  }
  const base = scoreC1AQualification({
    primaryRows,
    diagnosticRows,
    sentinelRows,
    executionSummary,
    thresholds: {
      ...C1A_ACCEPTANCE_THRESHOLDS,
      primaryCaseCount: thresholds.primaryCaseCount,
      sentinelExactTop3Required: thresholds.sentinelCaseCount,
    },
  });

  const nonAdversarial = primaryRows.filter(row => row.control?.category !== 5);
  const adversarial = primaryRows.filter(row => row.control?.category === 5);
  const nonAdversarialProtect = protectSummary(nonAdversarial);
  const adversarialProtect = protectSummary(adversarial);
  const sentinels = sentinelV2Summary(sentinelRows);

  const gates = {
    recall_all_delta: base.primary.metrics["recall_all@3"].delta_pp >= thresholds.recallAllDeltaPp,
    evidence_coverage_delta: base.primary.metrics["evidence_coverage@3"].delta_pp >= thresholds.evidenceCoverageDeltaPp,
    recall_any_guardrail: base.primary.metrics["recall_any@3"].delta_pp >= thresholds.recallAnyDeltaPp,
    non_adversarial_protect_regression: nonAdversarialProtect.regression_rate
      <= thresholds.nonAdversarialProtectRegressionRateMax,
    attempted_rate: base.primary.reliability.attempted_rate === 1,
    applied_rate: base.primary.reliability.applied_rate >= thresholds.appliedRateMin,
    fallback_rate: base.primary.reliability.fallback_rate <= thresholds.fallbackRateMax,
    structurally_invalid_response: base.primary.reliability.structurally_invalid_count === 0,
    latency_p95: base.primary.latency.p95_ms !== null && base.primary.latency.p95_ms <= thresholds.p95MsMax,
    latency_p99: base.primary.latency.p99_ms !== null && base.primary.latency.p99_ms <= thresholds.p99MsMax,
    sentinel_applied_pairs: sentinels.case_count === thresholds.sentinelCaseCount
      && sentinels.applied_pair_count === thresholds.sentinelCaseCount,
    sentinel_top1_stability: sentinels.top1_exact_count === thresholds.sentinelTop1ExactRequired,
    sentinel_top3_set_stability: sentinels.top3_set_exact_count === thresholds.sentinelTop3SetExactRequired,
    unauthorized_transmission: base.execution.unauthorized_transmission_count === 0,
    automatic_retry: base.execution.automatic_retry_count === 0,
    request_budget: base.execution.request_budget_exceeded === false,
    token_budget: base.execution.token_budget_exceeded === false,
    cost_cap: base.execution.cost_cap_exceeded === false,
    evidence_integrity: base.execution.evidence_integrity_ok === true,
  };

  return {
    schema: "memory_engine_r3_c1a_qualification_v2_score_v1",
    views: base.views,
    primary: base.primary,
    protect: {
      non_adversarial: nonAdversarialProtect,
      adversarial_diagnostic: adversarialProtect,
      all_categories_diagnostic: base.primary.protect_regression,
    },
    diagnostics: base.diagnostics,
    sentinels,
    execution: base.execution,
    thresholds: { ...thresholds },
    gates,
    pass: Object.values(gates).every(Boolean),
  };
}
