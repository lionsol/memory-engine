import { createHash } from "node:crypto";

export const Q5_B1_CAPTURE_MANIFEST_SCHEMA =
  "memory_engine_q5_b1_fixed_pool_score_capture_manifest_v1";
export const Q5_B1_EXPECTED_B0_MANIFEST_SHA256 =
  "f9262cd548c8a145da32da20f46a53872cab0310661d5b3a3055f5925ca9afe0";
export const Q5_B1_CAPTURE_MODEL = "Qwen/Qwen3-Reranker-0.6B";
export const Q5_B1_CAPTURE_PROVIDER = "siliconflow";
export const Q5_B1_QUOTAS = Object.freeze({
  development: Object.freeze({
    recoverable_rank_miss: 128,
    protect: 128,
  }),
  validation: Object.freeze({
    recoverable_rank_miss: 64,
    protect: 64,
  }),
  final_evaluation: Object.freeze({
    unconditional: 128,
  }),
});

const SALTS = Object.freeze({
  development_recoverable_rank_miss:
    "memory-engine-q5-b1-development-recoverable-v1\0",
  development_protect:
    "memory-engine-q5-b1-development-protect-v1\0",
  validation_recoverable_rank_miss:
    "memory-engine-q5-b1-validation-recoverable-v1\0",
  validation_protect:
    "memory-engine-q5-b1-validation-protect-v1\0",
  final_evaluation_unconditional:
    "memory-engine-q5-b1-final-unconditional-v1\0",
});

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function sortedByHash(rows, salt) {
  return [...rows].sort((left, right) => (
    sha256(`${salt}${left.case_id}`).localeCompare(sha256(`${salt}${right.case_id}`))
    || left.case_id.localeCompare(right.case_id)
  ));
}

function assertB0Manifest(manifest) {
  if (!manifest || manifest.schema !== "memory_engine_q5_b0_real_fixed_pool_evidence_entry_v1") {
    throw fail("Q5_B1_B0_SCHEMA_INVALID");
  }
  if (manifest.manifest_sha256 !== Q5_B1_EXPECTED_B0_MANIFEST_SHA256) {
    throw fail("Q5_B1_B0_MANIFEST_IDENTITY_DRIFT");
  }
  if (manifest.provider_requests !== 0 || manifest.egress_decision !== "UNKNOWN") {
    throw fail("Q5_B1_B0_AUTHORITY_BOUNDARY_DRIFT");
  }
  if (!Array.isArray(manifest.cases) || manifest.cases.length !== 1970) {
    throw fail("Q5_B1_B0_CASE_COUNT_DRIFT");
  }
}

function snapshot(row, selectionReason) {
  return Object.freeze({
    case_id: row.case_id,
    sample_id: row.sample_id,
    split: row.split,
    selection_reason: selectionReason,
    query_sha256: row.query_sha256,
    candidate_count: row.candidate_count,
    ordered_candidate_ids_sha256: row.ordered_candidate_ids_sha256,
    canonical_texts_sha256: row.canonical_texts_sha256,
    control_top3_sha256: row.control_top3_sha256,
  });
}

function selectStratum(cases, split, stratum, quota) {
  const available = cases.filter(row => (
    row.split === split && row.diagnostic_stratum === stratum
  ));
  if (available.length < quota) throw fail("Q5_B1_STRATUM_POPULATION_INSUFFICIENT");
  const key = `${split}_${stratum}`;
  const salt = SALTS[key];
  if (!salt) throw fail("Q5_B1_STRATUM_SALT_MISSING");
  return sortedByHash(available, salt)
    .slice(0, quota)
    .map(row => snapshot(row, stratum));
}

function selectFinalUnconditional(cases, quota) {
  const available = cases.filter(row => row.split === "final_evaluation");
  if (available.length < quota) throw fail("Q5_B1_FINAL_POPULATION_INSUFFICIENT");
  return sortedByHash(available, SALTS.final_evaluation_unconditional)
    .slice(0, quota)
    .map(row => snapshot(row, "unconditional_hash_sample"));
}

function splitCounts(rows) {
  const out = {};
  for (const row of rows) out[row.split] = (out[row.split] || 0) + 1;
  return Object.freeze(out);
}

export function buildQ5B1CaptureManifestV1(b0Manifest) {
  assertB0Manifest(b0Manifest);

  const development = [
    ...selectStratum(
      b0Manifest.cases,
      "development",
      "recoverable_rank_miss",
      Q5_B1_QUOTAS.development.recoverable_rank_miss,
    ),
    ...selectStratum(
      b0Manifest.cases,
      "development",
      "protect",
      Q5_B1_QUOTAS.development.protect,
    ),
  ];
  const validation = [
    ...selectStratum(
      b0Manifest.cases,
      "validation",
      "recoverable_rank_miss",
      Q5_B1_QUOTAS.validation.recoverable_rank_miss,
    ),
    ...selectStratum(
      b0Manifest.cases,
      "validation",
      "protect",
      Q5_B1_QUOTAS.validation.protect,
    ),
  ];
  const finalEvaluation = selectFinalUnconditional(
    b0Manifest.cases,
    Q5_B1_QUOTAS.final_evaluation.unconditional,
  );

  const selected = Object.freeze([
    ...development,
    ...validation,
    ...finalEvaluation,
  ]);
  const ids = new Set();
  for (const row of selected) {
    if (ids.has(row.case_id)) throw fail("Q5_B1_CASE_OVERLAP");
    ids.add(row.case_id);
  }

  const body = {
    schema: Q5_B1_CAPTURE_MANIFEST_SCHEMA,
    source_b0_manifest_sha256: b0Manifest.manifest_sha256,
    source_profile: b0Manifest.source.source_profile,
    source_candidate_generation: b0Manifest.source.candidate_generation,
    production_equivalent_candidate_generation: false,
    provider: Q5_B1_CAPTURE_PROVIDER,
    model: Q5_B1_CAPTURE_MODEL,
    revision: null,
    candidate_depth_max: 20,
    top_k: 3,
    provider_execution_authorized: false,
    provider_requests: 0,
    model_training_runs: 0,
    selection_policy: Object.freeze({
      development:
        "gold-derived strata allowed for design population: balanced recoverable_rank_miss/protect",
      validation:
        "gold-derived strata allowed for fixed validation population: balanced recoverable_rank_miss/protect",
      final_evaluation:
        "unconditional deterministic hash sample; selection does not use diagnostic stratum/category/gold count",
      final_evaluation_usage:
        "ONE_SHOT_BENCHMARK_FINAL; NOT A FULLY BLINDED EXTERNAL TEST",
    }),
    population: Object.freeze({
      selected_case_count: selected.length,
      split_counts: splitCounts(selected),
      development: Object.freeze({
        case_count: development.length,
        recoverable_rank_miss: Q5_B1_QUOTAS.development.recoverable_rank_miss,
        protect: Q5_B1_QUOTAS.development.protect,
      }),
      validation: Object.freeze({
        case_count: validation.length,
        recoverable_rank_miss: Q5_B1_QUOTAS.validation.recoverable_rank_miss,
        protect: Q5_B1_QUOTAS.validation.protect,
      }),
      final_evaluation: Object.freeze({
        case_count: finalEvaluation.length,
        selection: "unconditional_hash_sample",
      }),
    }),
    cases: selected,
  };

  return Object.freeze({
    ...body,
    manifest_sha256: sha256(JSON.stringify(body)),
  });
}
