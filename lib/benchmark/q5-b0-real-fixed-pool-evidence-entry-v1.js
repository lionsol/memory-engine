import { createHash } from "node:crypto";

import { classifyC1ADiagnosticCase } from "./c1a-qualification-manifest.js";
import {
  C1A_LOCOMO_CANDIDATE_DEPTH,
  C1A_LOCOMO_SOURCE_PROFILE,
} from "./c1a-locomo-qualification.js";

export const Q5_B0_EVIDENCE_ENTRY_SCHEMA =
  "memory_engine_q5_b0_real_fixed_pool_evidence_entry_v1";
export const Q5_B0_EXPECTED_CASE_COUNT = 1970;
export const Q5_B0_EXPECTED_SAMPLE_COUNT = 10;
export const Q5_B0_SPLIT_SAMPLE_COUNTS = Object.freeze({
  development: 6,
  validation: 2,
  final_evaluation: 2,
});

const SPLIT_SALT = "memory-engine-q5-b0-sample-split-v1\0";

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function sha256Json(value) {
  return sha256(JSON.stringify(value));
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requireHex(value, length, code) {
  if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${length}}$`).test(value)) {
    throw fail(code);
  }
  return value;
}

function validateMaterial(material) {
  if (!material || material.schema !== "memory_engine_r3_c1a_locomo_material_v1") {
    throw fail("Q5_B0_MATERIAL_SCHEMA_INVALID");
  }
  if (material.source_profile !== C1A_LOCOMO_SOURCE_PROFILE) {
    throw fail("Q5_B0_SOURCE_PROFILE_INVALID");
  }
  if (material.evidence_limitations?.production_equivalent_candidate_generation !== false) {
    throw fail("Q5_B0_PRODUCTION_EQUIVALENCE_BOUNDARY_INVALID");
  }
  if (material.evidence_limitations?.candidate_depth !== C1A_LOCOMO_CANDIDATE_DEPTH) {
    throw fail("Q5_B0_CANDIDATE_DEPTH_LIMITATION_DRIFT");
  }
  if (material.profile?.candidateDepth !== C1A_LOCOMO_CANDIDATE_DEPTH
      || material.profile?.topK !== 3) {
    throw fail("Q5_B0_PROFILE_DRIFT");
  }
  if (!Array.isArray(material.cases) || material.cases.length !== Q5_B0_EXPECTED_CASE_COUNT) {
    throw fail("Q5_B0_CASE_COUNT_DRIFT");
  }
  return material;
}

function splitSamples(cases) {
  const samples = [...new Set(cases.map(row => row.sample_id))];
  if (samples.length !== Q5_B0_EXPECTED_SAMPLE_COUNT) throw fail("Q5_B0_SAMPLE_COUNT_DRIFT");
  const ordered = samples.sort((left, right) => (
    sha256(`${SPLIT_SALT}${left}`).localeCompare(sha256(`${SPLIT_SALT}${right}`))
    || left.localeCompare(right)
  ));
  const developmentEnd = Q5_B0_SPLIT_SAMPLE_COUNTS.development;
  const validationEnd = developmentEnd + Q5_B0_SPLIT_SAMPLE_COUNTS.validation;
  return Object.freeze({
    development: Object.freeze(ordered.slice(0, developmentEnd)),
    validation: Object.freeze(ordered.slice(developmentEnd, validationEnd)),
    final_evaluation: Object.freeze(ordered.slice(validationEnd)),
  });
}

function splitForSample(sampleId, splits) {
  for (const [split, sampleIds] of Object.entries(splits)) {
    if (sampleIds.includes(sampleId)) return split;
  }
  throw fail("Q5_B0_SAMPLE_SPLIT_MISSING");
}

function snapshotCase(row, split) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw fail("Q5_B0_CASE_INVALID");
  if (typeof row.case_id !== "string" || row.case_id.length === 0) throw fail("Q5_B0_CASE_ID_INVALID");
  if (typeof row.sample_id !== "string" || row.sample_id.length === 0) throw fail("Q5_B0_SAMPLE_ID_INVALID");
  if (typeof row.query !== "string" || row.query.length === 0) throw fail("Q5_B0_QUERY_INVALID");
  if (row.query_egress !== "UNKNOWN") throw fail("Q5_B0_EGRESS_MUST_REMAIN_UNKNOWN");
  if (!Array.isArray(row.candidates) || row.candidates.length < 1
      || row.candidates.length > C1A_LOCOMO_CANDIDATE_DEPTH) {
    throw fail("Q5_B0_CANDIDATE_COUNT_INVALID");
  }
  if (row.candidates.some(candidate => candidate?.egress !== "UNKNOWN")) {
    throw fail("Q5_B0_CANDIDATE_EGRESS_MUST_REMAIN_UNKNOWN");
  }
  if (!Array.isArray(row.control_top3) || row.control_top3.length > 3) {
    throw fail("Q5_B0_CONTROL_TOP3_INVALID");
  }
  if (![0, 1].includes(row.control_recall_all_at_3)) {
    throw fail("Q5_B0_CONTROL_RECALL_ALL_INVALID");
  }
  if (!Number.isSafeInteger(row.gold_evidence_count) || row.gold_evidence_count < 1) {
    throw fail("Q5_B0_GOLD_COUNT_INVALID");
  }
  if (typeof row.gold_complete_in_top20 !== "boolean") {
    throw fail("Q5_B0_GOLD_COMPLETE_INVALID");
  }
  if (!Array.isArray(row.evidence_ids) || row.evidence_ids.length !== row.gold_evidence_count) {
    throw fail("Q5_B0_EVIDENCE_IDS_INVALID");
  }

  const candidateIds = row.candidates.map(candidate => candidate.id);
  const candidateTexts = row.candidates.map(candidate => candidate.text);
  if (new Set(candidateIds).size !== candidateIds.length) throw fail("Q5_B0_CANDIDATE_ID_DUPLICATE");

  return Object.freeze({
    case_id: row.case_id,
    sample_id: row.sample_id,
    qa_index: row.qa_index,
    split,
    query_sha256: sha256(row.query),
    candidate_count: candidateIds.length,
    ordered_candidate_ids_sha256: sha256Json(candidateIds),
    canonical_texts_sha256: sha256Json(candidateTexts),
    control_top3_sha256: sha256Json(row.control_top3),
    control_recall_all_at_3: row.control_recall_all_at_3,
    gold_evidence_count: row.gold_evidence_count,
    gold_complete_in_top20: row.gold_complete_in_top20,
    diagnostic_stratum: classifyC1ADiagnosticCase(row),
    category: row.category ?? null,
    projection_total_code_points: row.projection?.total_code_points ?? null,
  });
}

function countBy(rows, field) {
  const out = {};
  for (const row of rows) {
    const key = String(row[field]);
    out[key] = (out[key] || 0) + 1;
  }
  return Object.freeze(out);
}

function summarizeSplit(rows, sampleIds) {
  return Object.freeze({
    sample_count: sampleIds.length,
    sample_ids: sampleIds,
    case_count: rows.length,
    diagnostic_strata: countBy(rows, "diagnostic_stratum"),
    category_counts: countBy(rows, "category"),
    control_recall_all_at_3_count: rows.reduce(
      (sum, row) => sum + row.control_recall_all_at_3,
      0,
    ),
    gold_complete_in_top20_count: rows.reduce(
      (sum, row) => sum + Number(row.gold_complete_in_top20),
      0,
    ),
    top3_budget_infeasible_count: rows.filter(row => row.gold_evidence_count > 3).length,
  });
}

export function buildQ5B0EvidenceEntryManifestV1({
  material,
  sourceIdentity,
} = {}) {
  validateMaterial(material);
  if (!sourceIdentity || typeof sourceIdentity !== "object" || Array.isArray(sourceIdentity)) {
    throw fail("Q5_B0_SOURCE_IDENTITY_REQUIRED");
  }
  const candidateManifestSha = requireHex(
    sourceIdentity.candidate_manifest_sha256,
    64,
    "Q5_B0_CANDIDATE_MANIFEST_SHA_INVALID",
  );
  const overlaySha = requireHex(
    sourceIdentity.overlay_sha256,
    64,
    "Q5_B0_OVERLAY_SHA_INVALID",
  );
  const controlScoreSha = requireHex(
    sourceIdentity.control_score_sha256,
    64,
    "Q5_B0_CONTROL_SCORE_SHA_INVALID",
  );
  if (sourceIdentity.case_count !== Q5_B0_EXPECTED_CASE_COUNT) {
    throw fail("Q5_B0_SOURCE_CASE_COUNT_DRIFT");
  }
  if (sourceIdentity.profile_id !== C1A_LOCOMO_SOURCE_PROFILE) {
    throw fail("Q5_B0_SOURCE_IDENTITY_PROFILE_DRIFT");
  }

  const splits = splitSamples(material.cases);
  const snapshots = material.cases.map(row => snapshotCase(
    row,
    splitForSample(row.sample_id, splits),
  ));
  const identities = new Set();
  for (const row of snapshots) {
    if (identities.has(row.case_id)) throw fail("Q5_B0_CASE_ID_DUPLICATE");
    identities.add(row.case_id);
  }

  const splitRows = Object.fromEntries(Object.keys(splits).map(split => [
    split,
    snapshots.filter(row => row.split === split),
  ]));

  const body = {
    schema: Q5_B0_EVIDENCE_ENTRY_SCHEMA,
    source: Object.freeze({
      benchmark: "LoCoMo",
      source_profile: C1A_LOCOMO_SOURCE_PROFILE,
      candidate_generation: "frozen_fts_only_not_production_hybrid",
      production_equivalent_candidate_generation: false,
      canonical_text_projection: true,
      candidate_depth: C1A_LOCOMO_CANDIDATE_DEPTH,
      top_k: 3,
      candidate_manifest_sha256: candidateManifestSha,
      overlay_sha256: overlaySha,
      control_score_sha256: controlScoreSha,
    }),
    egress_decision: "UNKNOWN",
    provider_requests: 0,
    model_training_runs: 0,
    split_policy: Object.freeze({
      unit: "sample_id",
      rationale: "prevent_conversation_level_leakage_across_splits",
      deterministic_hash: "sha256",
      salt_id: "memory-engine-q5-b0-sample-split-v1",
      sample_counts: Q5_B0_SPLIT_SAMPLE_COUNTS,
      final_evaluation_consumption: "ONE_SHOT_IF_USED_FOR_MODEL_OR_THRESHOLD_SELECTION",
    }),
    population: Object.freeze({
      sample_count: Q5_B0_EXPECTED_SAMPLE_COUNT,
      case_count: snapshots.length,
      development: summarizeSplit(splitRows.development, splits.development),
      validation: summarizeSplit(splitRows.validation, splits.validation),
      final_evaluation: summarizeSplit(splitRows.final_evaluation, splits.final_evaluation),
      overall_diagnostic_strata: countBy(snapshots, "diagnostic_stratum"),
      overall_category_counts: countBy(snapshots, "category"),
    }),
    cases: Object.freeze(snapshots),
  };

  return Object.freeze({
    ...body,
    manifest_sha256: sha256(JSON.stringify(body)),
  });
}
