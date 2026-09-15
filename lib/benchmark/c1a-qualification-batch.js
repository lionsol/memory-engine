import { C1A_MANIFEST_SCHEMA, snapshotC1ACase } from "./c1a-qualification-manifest.js";
import {
  preflightC1AQualificationCase,
  runC1AQualificationCase,
} from "./c1a-qualification-runner.js";

const DIAGNOSTIC_ORDER = Object.freeze([
  "protect",
  "recoverable_rank_miss",
  "candidate_miss",
  "top3_budget_infeasible",
]);

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function compareSnapshot(expected, material) {
  const actual = snapshotC1ACase(material);
  const fields = [
    "case_id",
    "query_sha256",
    "ordered_candidate_ids_sha256",
    "canonical_texts_sha256",
    "control_top3_sha256",
    "control_recall_all_at_3",
    "gold_evidence_count",
    "gold_complete_in_top20",
  ];
  for (const field of fields) {
    if (actual[field] !== expected[field]) {
      throw fail("C1A_CASE_MATERIAL_IDENTITY_MISMATCH", {
        caseId: expected.case_id,
        field,
      });
    }
  }
  return actual;
}

function materialIndex(cases) {
  if (!Array.isArray(cases)) throw fail("C1A_BATCH_CASES_MUST_BE_ARRAY");
  const index = new Map();
  for (const item of cases) {
    if (typeof item?.case_id !== "string" || item.case_id.length === 0) {
      throw fail("C1A_BATCH_CASE_ID_INVALID");
    }
    if (index.has(item.case_id)) throw fail("C1A_BATCH_CASE_ID_DUPLICATE", { caseId: item.case_id });
    index.set(item.case_id, item);
  }
  return index;
}

function selectedMainSnapshots(manifest) {
  const diagnostics = DIAGNOSTIC_ORDER.flatMap(key => {
    const rows = manifest?.diagnostics?.[key];
    if (!Array.isArray(rows)) throw fail("C1A_MANIFEST_DIAGNOSTIC_STRATUM_MISSING", { stratum: key });
    return rows.map(row => ({ ...row, qualification_stratum: key, qualification_population: "diagnostic" }));
  });
  if (!Array.isArray(manifest?.primary)) throw fail("C1A_MANIFEST_PRIMARY_MISSING");
  return [
    ...manifest.primary.map(row => ({ ...row, qualification_stratum: null, qualification_population: "primary" })),
    ...diagnostics,
  ];
}

function caseInvocation(material) {
  const candidateEgress = Object.fromEntries((material.candidates ?? []).map(candidate => [
    candidate.id,
    candidate.egress ?? material.candidate_egress?.[candidate.id] ?? "UNKNOWN",
  ]));
  return {
    caseId: material.case_id,
    query: material.query,
    candidates: material.candidates,
    controlOrder: material.control_order,
    queryEgress: material.query_egress ?? "UNKNOWN",
    candidateEgress,
  };
}

export async function runC1AQualificationBatch({
  manifest,
  cases,
  adapter,
  budget,
  tokenCounter,
  deadlineMs,
  pacer = async () => {},
  onEvidence = async () => {},
} = {}) {
  if (manifest?.schema !== C1A_MANIFEST_SCHEMA) throw fail("C1A_MANIFEST_SCHEMA_MISMATCH");
  if (typeof adapter !== "function") throw fail("C1A_BATCH_ADAPTER_REQUIRED");
  if (!budget || typeof budget.snapshot !== "function") throw fail("C1A_BATCH_BUDGET_REQUIRED");
  if (typeof pacer !== "function" || typeof onEvidence !== "function") {
    throw fail("C1A_BATCH_CALLBACK_INVALID");
  }

  const byId = materialIndex(cases);
  const mainSnapshots = selectedMainSnapshots(manifest);
  const selectedIds = new Set();
  for (const snapshot of mainSnapshots) {
    if (selectedIds.has(snapshot.case_id)) throw fail("C1A_MANIFEST_CASE_OVERLAP", { caseId: snapshot.case_id });
    selectedIds.add(snapshot.case_id);
    const material = byId.get(snapshot.case_id);
    if (!material) throw fail("C1A_SELECTED_CASE_MISSING", { caseId: snapshot.case_id });
    compareSnapshot(snapshot, material);
  }

  const preflightById = new Map();
  for (const snapshot of mainSnapshots) {
    const material = byId.get(snapshot.case_id);
    const preflight = preflightC1AQualificationCase({
      ...caseInvocation(material),
      tokenCounter,
    });
    preflightById.set(snapshot.case_id, preflight);
  }

  const primaryEligibleCount = manifest.primary.filter(row => preflightById.get(row.case_id)?.eligible === true).length;
  const primaryEligibilityRatio = primaryEligibleCount / manifest.primary.length;
  const minimumEligibility = manifest.population?.minimum_primary_provider_eligible_ratio;
  if (!Number.isFinite(minimumEligibility) || primaryEligibilityRatio < minimumEligibility) {
    throw fail("C1A_PRIMARY_PROVIDER_ELIGIBILITY_BELOW_FROZEN_THRESHOLD", {
      primaryEligibleCount,
      primaryEligibilityRatio,
    });
  }

  if (!Array.isArray(manifest.sentinels)) throw fail("C1A_MANIFEST_SENTINELS_MISSING");
  for (const sentinel of manifest.sentinels) {
    if (!selectedIds.has(sentinel.case_id)) throw fail("C1A_SENTINEL_NOT_IN_MAIN_POPULATION", { caseId: sentinel.case_id });
    compareSnapshot(sentinel, byId.get(sentinel.case_id));
    if (preflightById.get(sentinel.case_id)?.eligible !== true) {
      throw fail("C1A_SENTINEL_NOT_PROVIDER_ELIGIBLE", { caseId: sentinel.case_id });
    }
  }

  const mainEvidence = [];
  for (const snapshot of mainSnapshots) {
    const material = byId.get(snapshot.case_id);
    const preflight = preflightById.get(snapshot.case_id);
    if (preflight.eligible) {
      await pacer({
        phase: "main",
        case_id: snapshot.case_id,
        estimated_request_tokens: preflight.estimated_request_tokens,
      });
    }
    const evidence = await runC1AQualificationCase({
      ...caseInvocation(material),
      adapter,
      tokenCounter,
      budget,
      deadlineMs,
    });
    const bounded = {
      ...evidence,
      qualification_population: snapshot.qualification_population,
      qualification_stratum: snapshot.qualification_stratum,
    };
    mainEvidence.push(bounded);
    await onEvidence({ phase: "main", evidence: bounded });
  }

  const sentinelEvidence = [];
  for (const snapshot of manifest.sentinels) {
    const material = byId.get(snapshot.case_id);
    const preflight = preflightById.get(snapshot.case_id);
    await pacer({
      phase: "sentinel_repeat",
      case_id: snapshot.case_id,
      estimated_request_tokens: preflight.estimated_request_tokens,
    });
    const evidence = await runC1AQualificationCase({
      ...caseInvocation(material),
      adapter,
      tokenCounter,
      budget,
      deadlineMs,
    });
    sentinelEvidence.push(evidence);
    await onEvidence({ phase: "sentinel_repeat", evidence });
  }

  return {
    schema: "memory_engine_r3_c1a_qualification_batch_v1",
    manifest_sha256: manifest.manifest_sha256,
    main_evidence: mainEvidence,
    sentinel_evidence: sentinelEvidence,
    budget: budget.snapshot(),
    execution_summary: {
      unauthorized_transmission_count: 0,
      automatic_retry_count: 0,
      request_budget_exceeded: false,
      token_budget_exceeded: false,
      cost_cap_exceeded: false,
      evidence_integrity_ok: true,
    },
  };
}
