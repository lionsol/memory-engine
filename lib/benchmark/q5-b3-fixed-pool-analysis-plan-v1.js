import { createHash } from "node:crypto";

import {
  Q5_B2_EXPECTED_B1_MANIFEST_SHA256,
  Q5_B2_EXPECTED_CASE_COUNT,
  Q5_B2_PACKET_SCHEMA,
} from "./q5-b2-fixed-pool-score-capture-v1.js";

export const Q5_B3_ANALYSIS_PLAN_SCHEMA =
  "memory_engine_q5_b3_fixed_pool_analysis_plan_v1";
export const Q5_B3_EXPECTED_B0_MANIFEST_SHA256 =
  "f9262cd548c8a145da32da20f46a53872cab0310661d5b3a3055f5925ca9afe0";
export const Q5_B3_ALLOWED_EXPLORATION_SPLITS = Object.freeze([
  "development",
  "validation",
]);
export const Q5_B3_SEALED_SPLIT = "final_evaluation";

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requireArray(value, code) {
  if (!Array.isArray(value)) throw fail(code);
  return value;
}

function indexByCase(rows, code) {
  const map = new Map();
  for (const row of requireArray(rows, code)) {
    if (!row || typeof row.case_id !== "string" || row.case_id.length === 0) throw fail(code);
    if (map.has(row.case_id)) throw fail("Q5_B3_CASE_DUPLICATE");
    map.set(row.case_id, row);
  }
  return map;
}

function splitSummary(rows) {
  const counts = {};
  for (const row of rows) counts[row.split] = (counts[row.split] || 0) + 1;
  return Object.freeze(counts);
}

export function buildQ5B3AnalysisPlanV1({
  b0Manifest,
  b1Manifest,
} = {}) {
  if (!b0Manifest || b0Manifest.schema !== "memory_engine_q5_b0_real_fixed_pool_evidence_entry_v1") {
    throw fail("Q5_B3_B0_SCHEMA_INVALID");
  }
  if (b0Manifest.manifest_sha256 !== Q5_B3_EXPECTED_B0_MANIFEST_SHA256) {
    throw fail("Q5_B3_B0_MANIFEST_DRIFT");
  }
  if (!b1Manifest || b1Manifest.schema !== "memory_engine_q5_b1_fixed_pool_score_capture_manifest_v1") {
    throw fail("Q5_B3_B1_SCHEMA_INVALID");
  }
  if (b1Manifest.manifest_sha256 !== Q5_B2_EXPECTED_B1_MANIFEST_SHA256) {
    throw fail("Q5_B3_B1_MANIFEST_DRIFT");
  }
  if (!Array.isArray(b1Manifest.cases) || b1Manifest.cases.length !== Q5_B2_EXPECTED_CASE_COUNT) {
    throw fail("Q5_B3_B1_CASE_COUNT_INVALID");
  }

  const b0ByCase = indexByCase(b0Manifest.cases, "Q5_B3_B0_CASES_INVALID");
  const rows = b1Manifest.cases.map(row => {
    const b0 = b0ByCase.get(row.case_id);
    if (!b0) throw fail("Q5_B3_CASE_NOT_IN_B0");
    if (b0.sample_id !== row.sample_id) throw fail("Q5_B3_SAMPLE_ID_DRIFT");
    if (b0.split !== row.split) throw fail("Q5_B3_SPLIT_DRIFT");
    if (b0.query_sha256 !== row.query_sha256) throw fail("Q5_B3_QUERY_IDENTITY_DRIFT");
    if (b0.candidate_count !== row.candidate_count) throw fail("Q5_B3_CANDIDATE_COUNT_DRIFT");
    if (b0.ordered_candidate_ids_sha256 !== row.ordered_candidate_ids_sha256) {
      throw fail("Q5_B3_CANDIDATE_ORDER_IDENTITY_DRIFT");
    }
    if (b0.canonical_texts_sha256 !== row.canonical_texts_sha256) {
      throw fail("Q5_B3_CANONICAL_TEXT_IDENTITY_DRIFT");
    }
    if (b0.control_top3_sha256 !== row.control_top3_sha256) {
      throw fail("Q5_B3_CONTROL_TOP3_IDENTITY_DRIFT");
    }
    return Object.freeze({
      case_id: row.case_id,
      sample_id: row.sample_id,
      split: row.split,
      selection_reason: row.selection_reason,
      diagnostic_stratum: b0.diagnostic_stratum,
      gold_evidence_count: b0.gold_evidence_count,
      gold_complete_in_top20: b0.gold_complete_in_top20,
      category: b0.category,
    });
  });

  const sampleSplits = new Map();
  for (const row of rows) {
    const prior = sampleSplits.get(row.sample_id);
    if (prior && prior !== row.split) throw fail("Q5_B3_SAMPLE_SPLIT_LEAKAGE");
    sampleSplits.set(row.sample_id, row.split);
  }

  const finalRows = rows.filter(row => row.split === Q5_B3_SEALED_SPLIT);
  if (finalRows.length !== 128) throw fail("Q5_B3_FINAL_COUNT_DRIFT");

  const body = {
    schema: Q5_B3_ANALYSIS_PLAN_SCHEMA,
    source_b0_manifest_sha256: b0Manifest.manifest_sha256,
    source_b1_manifest_sha256: b1Manifest.manifest_sha256,
    required_b2_packet: Object.freeze({
      schema: Q5_B2_PACKET_SCHEMA,
      source_b1_manifest_sha256: Q5_B2_EXPECTED_B1_MANIFEST_SHA256,
      case_count: Q5_B2_EXPECTED_CASE_COUNT,
      contains_gold_fields: false,
    }),
    population: Object.freeze({
      case_count: rows.length,
      split_counts: splitSummary(rows),
      unique_sample_count: sampleSplits.size,
    }),
    access_policy: Object.freeze({
      exploration_splits: Q5_B3_ALLOWED_EXPLORATION_SPLITS,
      sealed_split: Q5_B3_SEALED_SPLIT,
      final_outcomes_visible_by_default: false,
      final_consumption_requires_explicit_one_shot_authority: true,
    }),
    evaluator_boundary: Object.freeze({
      packet_gold_fields_allowed: false,
      evaluator_join_key: "case_id",
      gold_source: "historical_locomo_material_evaluator_only",
      direct_candidate_id_equals_gold_id: false,
      scorer: "scoreLocomoChunkCase/evaluateLocomoChunkEvidenceCoverage",
    }),
    planned_outputs_before_final: Object.freeze([
      "rerank_top3_recall_any_at_3",
      "rerank_top3_recall_all_at_3",
      "rerank_top3_evidence_coverage_at_3",
      "pool_gold_complete",
      "top3_budget_feasible",
      "selection_failure_count",
      "protect_regression_count",
      "score_rank_distribution",
      "pair_set_signal_diagnostics",
    ]),
    rows: Object.freeze(rows),
  };

  return Object.freeze({
    ...body,
    plan_sha256: sha256(JSON.stringify(body)),
  });
}

export function assertQ5B3NoFinalOutcomesV1(result) {
  if (!result || typeof result !== "object") throw fail("Q5_B3_RESULT_INVALID");
  const forbiddenKeys = new Set([
    "final_metrics",
    "final_outcomes",
    "final_case_results",
    "final_evaluation_results",
  ]);
  const walk = value => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) throw fail("Q5_B3_FINAL_OUTCOME_LEAK");
      walk(item);
    }
  };
  walk(result);
  return true;
}
