import { createHash } from "node:crypto";

export const C1A_MANIFEST_SCHEMA = "memory_engine_r3_c1a_qualification_manifest_v1";
export const C1A_PRIMARY_COUNT = 256;
export const C1A_SENTINEL_COUNT = 8;
export const C1A_DIAGNOSTIC_QUOTAS = Object.freeze({
  protect: 20,
  recoverable_rank_miss: 20,
  candidate_miss: 12,
  top3_budget_infeasible: 12,
});

const PRIMARY_SALT = "memory-engine-r3-c1-a-primary-v1\0";
const SENTINEL_SALT = "memory-engine-r3-c1-a-sentinel-v1\0";
const DIAGNOSTIC_SALTS = Object.freeze({
  protect: "memory-engine-r3-c1-a-diagnostic-protect-v1\0",
  recoverable_rank_miss: "memory-engine-r3-c1-a-diagnostic-recoverable-v1\0",
  candidate_miss: "memory-engine-r3-c1-a-diagnostic-candidate-miss-v1\0",
  top3_budget_infeasible: "memory-engine-r3-c1-a-diagnostic-budget-v1\0",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Json(value) {
  return sha256(JSON.stringify(value));
}

function requireCase(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("c1a_case_must_be_object");
  if (typeof item.case_id !== "string" || item.case_id.length === 0) throw new Error("c1a_case_id_required");
  if (![0, 1].includes(item.control_recall_all_at_3)) throw new Error(`c1a_control_recall_all_invalid:${item.case_id}`);
  if (!Number.isSafeInteger(item.gold_evidence_count) || item.gold_evidence_count < 1) {
    throw new Error(`c1a_gold_evidence_count_invalid:${item.case_id}`);
  }
  if (typeof item.gold_complete_in_top20 !== "boolean") {
    throw new Error(`c1a_gold_complete_in_top20_invalid:${item.case_id}`);
  }
  return item;
}

function sortedByHash(cases, salt) {
  return [...cases].sort((left, right) => {
    const leftHash = sha256(`${salt}${left.case_id}`);
    const rightHash = sha256(`${salt}${right.case_id}`);
    return leftHash.localeCompare(rightHash) || left.case_id.localeCompare(right.case_id);
  });
}

function diagnosticStratum(item) {
  if (item.control_recall_all_at_3 === 1) return "protect";
  if (item.gold_evidence_count > 3) return "top3_budget_infeasible";
  return item.gold_complete_in_top20 ? "recoverable_rank_miss" : "candidate_miss";
}

export function snapshotC1ACase(item) {
  requireCase(item);
  const rawCandidates = Array.isArray(item.candidates) ? item.candidates : null;
  const candidateIds = rawCandidates
    ? rawCandidates.map(candidate => candidate?.id)
    : (Array.isArray(item.candidate_ids) ? item.candidate_ids : null);
  const candidateTexts = rawCandidates
    ? rawCandidates.map(candidate => candidate?.text)
    : (Array.isArray(item.candidate_texts) ? item.candidate_texts : null);
  const controlTop3 = Array.isArray(item.control_top3)
    ? item.control_top3
    : (Array.isArray(item.control_order) ? item.control_order.slice(0, 3) : null);
  const snapshot = {
    case_id: item.case_id,
    query_sha256: typeof item.query === "string" ? sha256(item.query) : item.query_sha256,
    ordered_candidate_ids_sha256: candidateIds ? sha256Json(candidateIds) : item.ordered_candidate_ids_sha256,
    canonical_texts_sha256: candidateTexts ? sha256Json(candidateTexts) : item.canonical_texts_sha256,
    control_top3_sha256: controlTop3 ? sha256Json(controlTop3) : item.control_top3_sha256,
    control_recall_all_at_3: item.control_recall_all_at_3,
    gold_evidence_count: item.gold_evidence_count,
    gold_complete_in_top20: item.gold_complete_in_top20,
  };
  for (const field of [
    "query_sha256",
    "ordered_candidate_ids_sha256",
    "canonical_texts_sha256",
    "control_top3_sha256",
  ]) {
    if (typeof snapshot[field] !== "string" || snapshot[field].length === 0) {
      throw new Error(`c1a_case_snapshot_incomplete:${item.case_id}:${field}`);
    }
  }
  return snapshot;
}

export function buildC1AQualificationManifest({
  cases,
  eligibilityByCase = {},
  expectedSourceCaseCount = 1970,
  primaryCount = C1A_PRIMARY_COUNT,
  diagnosticQuotas = C1A_DIAGNOSTIC_QUOTAS,
  sentinelCount = C1A_SENTINEL_COUNT,
  minimumPrimaryEligibilityRatio = 0.95,
  profile,
  sourceIdentity = null,
} = {}) {
  if (!Array.isArray(cases)) throw new Error("c1a_cases_must_be_array");
  if (!Number.isSafeInteger(expectedSourceCaseCount) || expectedSourceCaseCount < 1) {
    throw new Error("c1a_expected_source_case_count_invalid");
  }
  if (cases.length !== expectedSourceCaseCount) throw new Error("c1a_source_population_count_mismatch");
  if (!Number.isSafeInteger(primaryCount) || primaryCount < 1) throw new Error("c1a_primary_count_invalid");
  const normalized = cases.map(requireCase);
  const ids = new Set();
  for (const item of normalized) {
    if (ids.has(item.case_id)) throw new Error(`c1a_case_id_duplicate:${item.case_id}`);
    ids.add(item.case_id);
  }
  if (normalized.length < primaryCount) throw new Error("c1a_primary_population_insufficient");

  const primary = sortedByHash(normalized, PRIMARY_SALT).slice(0, primaryCount);
  const primaryIds = new Set(primary.map(item => item.case_id));
  const remaining = normalized.filter(item => !primaryIds.has(item.case_id));

  const diagnostics = {};
  const diagnosticIds = new Set();
  for (const [stratum, quota] of Object.entries(diagnosticQuotas)) {
    if (!Number.isSafeInteger(quota) || quota < 0) throw new Error(`c1a_diagnostic_quota_invalid:${stratum}`);
    const available = remaining.filter(item => !diagnosticIds.has(item.case_id) && diagnosticStratum(item) === stratum);
    const selected = sortedByHash(available, DIAGNOSTIC_SALTS[stratum] || `${stratum}\0`).slice(0, quota);
    if (selected.length !== quota) throw new Error(`c1a_diagnostic_population_insufficient:${stratum}`);
    diagnostics[stratum] = selected;
    for (const item of selected) diagnosticIds.add(item.case_id);
  }

  const eligiblePrimary = primary.filter(item => eligibilityByCase[item.case_id] === true);
  const sentinels = sortedByHash(eligiblePrimary, SENTINEL_SALT).slice(0, sentinelCount);
  if (sentinels.length !== sentinelCount) throw new Error("c1a_sentinel_population_insufficient");

  const primaryEligibleCount = eligiblePrimary.length;
  const primaryEligibilityRatio = primaryEligibleCount / primary.length;
  if (!Number.isFinite(minimumPrimaryEligibilityRatio)
      || minimumPrimaryEligibilityRatio < 0
      || minimumPrimaryEligibilityRatio > 1) {
    throw new Error("c1a_primary_eligibility_threshold_invalid");
  }
  if (primaryEligibilityRatio < minimumPrimaryEligibilityRatio) {
    throw new Error("c1a_primary_provider_eligibility_below_threshold");
  }
  const diagnosticRows = Object.fromEntries(Object.entries(diagnostics).map(([key, rows]) => [
    key,
    rows.map(snapshotC1ACase),
  ]));

  const body = {
    schema: C1A_MANIFEST_SCHEMA,
    source_identity: sourceIdentity,
    profile: profile ?? null,
    population: {
      source_case_count: normalized.length,
      expected_source_case_count: expectedSourceCaseCount,
      primary_count: primary.length,
      diagnostic_count: diagnosticIds.size,
      sentinel_count: sentinels.length,
      primary_provider_eligible_count: primaryEligibleCount,
      primary_provider_eligible_ratio: primaryEligibilityRatio,
      minimum_primary_provider_eligible_ratio: minimumPrimaryEligibilityRatio,
    },
    primary: primary.map(snapshotC1ACase),
    diagnostics: diagnosticRows,
    sentinels: sentinels.map(snapshotC1ACase),
  };

  return {
    ...body,
    manifest_sha256: sha256(JSON.stringify(body)),
  };
}

export function classifyC1ADiagnosticCase(item) {
  return diagnosticStratum(requireCase(item));
}
