import { createHash } from "node:crypto";

import { scoreLocomoChunkCase } from "./locomo-chunk-evidence-scorer.js";
import { analyzeQ5B3DevelopmentValidationV1 } from "./q5-b3-development-validation-analysis-v1.js";
import { assertQ5B3NoFinalOutcomesV1 } from "./q5-b3-fixed-pool-analysis-plan-v1.js";

export const Q5_B3_D_FEASIBILITY_SCHEMA =
  "memory_engine_q5_b3_product_visible_pair_set_feasibility_v1";

const REDUNDANCY_GAIN_THRESHOLDS = Object.freeze([0, 0.05, 0.10]);
const SCORE_GAP_THRESHOLDS = Object.freeze([-0.05, -0.25, -1.0]);
const MAX_CANDIDATE_RANKS = Object.freeze([5, 10, 20]);

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function tokenize(text) {
  const normalized = typeof text === "string" ? text.normalize("NFKC").toLowerCase() : "";
  return new Set((normalized.match(/[\p{L}\p{N}]+/gu) || []).filter(token => token.length >= 2));
}

function intersectionSize(left, right) {
  let count = 0;
  for (const token of left) if (right.has(token)) count += 1;
  return count;
}

function overlapCoefficient(left, right) {
  if (left.size === 0 || right.size === 0) return 0;
  return intersectionSize(left, right) / Math.min(left.size, right.size);
}

function unionSets(sets) {
  const out = new Set();
  for (const set of sets) for (const value of set) out.add(value);
  return out;
}

function incrementalQueryTerms(queryTokens, candidateTokens, keptTokens) {
  let count = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token) && !keptTokens.has(token)) count += 1;
  }
  return count;
}

function candidateMap(candidates) {
  const map = new Map();
  for (const row of candidates || []) {
    if (!row || typeof row.id !== "string" || map.has(row.id)) fail("Q5_B3_D_CANDIDATE_INVALID");
    if (typeof row.text !== "string") fail("Q5_B3_D_CANDIDATE_TEXT_INVALID");
    if (!Number.isFinite(row.rerank_score) || !Number.isSafeInteger(row.rerank_rank)) {
      fail("Q5_B3_D_RERANK_SIGNAL_INVALID");
    }
    map.set(row.id, {
      ...row,
      tokens: tokenize(row.text),
    });
  }
  return map;
}

export function proposeQ5B3DProductVisibleSwapV1({
  query,
  candidates,
  servedTop3Ids,
  config,
} = {}) {
  if (typeof query !== "string") fail("Q5_B3_D_QUERY_INVALID");
  if (!Array.isArray(servedTop3Ids)
      || servedTop3Ids.length < 1
      || servedTop3Ids.length > 3) {
    fail("Q5_B3_D_SERVED_TOP3_INVALID");
  }
  if (!config || !Number.isFinite(config.min_redundancy_gain)
      || !Number.isFinite(config.min_score_gap)
      || !Number.isSafeInteger(config.max_candidate_rank)) {
    fail("Q5_B3_D_CONFIG_INVALID");
  }

  const byId = candidateMap(candidates);
  if (new Set(servedTop3Ids).size !== servedTop3Ids.length
      || servedTop3Ids.some(id => !byId.has(id))) {
    fail("Q5_B3_D_SERVED_ID_INVALID");
  }
  if (servedTop3Ids.length < 3) {
    return Object.freeze({
      applied: false,
      reason: "fewer_than_three_pool_candidates",
      selected_ids: Object.freeze([...servedTop3Ids]),
      proposal: null,
    });
  }

  const queryTokens = tokenize(query);
  const servedSet = new Set(servedTop3Ids);
  const proposals = [];

  for (const displacedId of servedTop3Ids) {
    const displaced = byId.get(displacedId);
    const keptIds = servedTop3Ids.filter(id => id !== displacedId);
    const kept = keptIds.map(id => byId.get(id));
    const keptTokenUnion = unionSets(kept.map(row => row.tokens));
    const displacedRedundancy = Math.max(
      ...kept.map(row => overlapCoefficient(displaced.tokens, row.tokens)),
    );

    for (const candidate of byId.values()) {
      if (servedSet.has(candidate.id)) continue;
      if (candidate.rerank_rank > config.max_candidate_rank) continue;

      const candidateRedundancy = Math.max(
        ...kept.map(row => overlapCoefficient(candidate.tokens, row.tokens)),
      );
      const redundancyGain = displacedRedundancy - candidateRedundancy;
      const newQueryTerms = incrementalQueryTerms(queryTokens, candidate.tokens, keptTokenUnion);
      const scoreGap = candidate.rerank_score - displaced.rerank_score;

      if (newQueryTerms < 1) continue;
      if (redundancyGain < config.min_redundancy_gain) continue;
      if (scoreGap < config.min_score_gap) continue;

      proposals.push({
        candidate_id: candidate.id,
        displaced_id: displacedId,
        incremental_query_terms: newQueryTerms,
        redundancy_gain: redundancyGain,
        displaced_redundancy: displacedRedundancy,
        candidate_redundancy: candidateRedundancy,
        score_gap: scoreGap,
        candidate_rerank_rank: candidate.rerank_rank,
        candidate_rerank_score: candidate.rerank_score,
        displaced_rerank_score: displaced.rerank_score,
      });
    }
  }

  if (proposals.length === 0) {
    return Object.freeze({
      applied: false,
      reason: "no_product_visible_swap_passed_guards",
      selected_ids: Object.freeze([...servedTop3Ids]),
      proposal: null,
    });
  }

  proposals.sort((left, right) => (
    right.incremental_query_terms - left.incremental_query_terms
    || right.redundancy_gain - left.redundancy_gain
    || right.score_gap - left.score_gap
    || left.candidate_rerank_rank - right.candidate_rerank_rank
    || String(left.candidate_id).localeCompare(String(right.candidate_id))
    || String(left.displaced_id).localeCompare(String(right.displaced_id))
  ));

  const chosen = proposals[0];
  return Object.freeze({
    applied: true,
    reason: "product_visible_complementarity_swap",
    selected_ids: Object.freeze(
      servedTop3Ids.map(id => id === chosen.displaced_id ? chosen.candidate_id : id),
    ),
    proposal: Object.freeze(chosen),
  });
}

function frozenConfigs() {
  const configs = [];
  for (const minRedundancyGain of REDUNDANCY_GAIN_THRESHOLDS) {
    for (const minScoreGap of SCORE_GAP_THRESHOLDS) {
      for (const maxCandidateRank of MAX_CANDIDATE_RANKS) {
        configs.push(Object.freeze({
          min_redundancy_gain: minRedundancyGain,
          min_score_gap: minScoreGap,
          max_candidate_rank: maxCandidateRank,
        }));
      }
    }
  }
  return Object.freeze(configs);
}

function transition(before, after) {
  if (before === after) return "unchanged";
  return after > before ? "improved" : "regressed";
}

function emptyTransitions() {
  return { improved: 0, regressed: 0, unchanged: 0 };
}

function scoreSelected(material, materialCase, selectedIds) {
  const score = scoreLocomoChunkCase({
    material: material.scoring_material,
    sampleId: materialCase.sample_id,
    qaIndex: materialCase.qa_index,
    evidenceIds: materialCase.evidence_ids,
    selectedChunkIds: selectedIds,
    category: materialCase.category ?? null,
  });
  if (score?.scoreable !== true) fail("Q5_B3_D_SCORE_UNKNOWN");
  return {
    recall_any: Number(score.metrics?.["recall_any@3"]),
    recall_all: Number(score.metrics?.["recall_all@3"]),
    evidence_coverage: Number(score.metrics?.["evidence_coverage@3"]),
  };
}

function productCandidates(packetCase, materialCase) {
  const materialById = new Map(materialCase.candidates.map(row => [row.id, row]));
  return packetCase.candidates.map(packetCandidate => {
    const source = materialById.get(packetCandidate.id);
    if (!source) fail("Q5_B3_D_MATERIAL_CANDIDATE_MISSING");
    return Object.freeze({
      id: packetCandidate.id,
      text: source.text,
      pre_rerank_rank: packetCandidate.pre_rerank_rank,
      rerank_score: packetCandidate.rerank_score,
      rerank_rank: packetCandidate.rerank_rank,
    });
  });
}

function evaluateConfig({ config, split, baselineRows, packetById, materialById, material }) {
  const rows = [];
  const recallAny = emptyTransitions();
  const recallAll = emptyTransitions();
  let applied = 0;
  let protectRegressions = 0;
  let coverageDeltaSum = 0;

  for (const baseline of baselineRows.filter(row => row.split === split)) {
    const packetCase = packetById.get(baseline.case_id);
    const materialCase = materialById.get(baseline.case_id);
    if (!packetCase || !materialCase) fail("Q5_B3_D_CASE_MISSING");

    const proposal = proposeQ5B3DProductVisibleSwapV1({
      query: materialCase.query,
      candidates: productCandidates(packetCase, materialCase),
      servedTop3Ids: packetCase.served_top3_ids,
      config,
    });
    if (proposal.applied) applied += 1;

    const before = {
      recall_any: baseline.rerank.recall_any_at_3,
      recall_all: baseline.rerank.recall_all_at_3,
      evidence_coverage: baseline.rerank.evidence_coverage_at_3,
    };
    const after = proposal.applied
      ? scoreSelected(material, materialCase, proposal.selected_ids)
      : before;

    recallAny[transition(before.recall_any, after.recall_any)] += 1;
    recallAll[transition(before.recall_all, after.recall_all)] += 1;
    coverageDeltaSum += after.evidence_coverage - before.evidence_coverage;
    const protectRegression = baseline.selection_reason === "protect"
      && before.recall_all === 1
      && after.recall_all === 0;
    if (protectRegression) protectRegressions += 1;

    rows.push(Object.freeze({
      case_id: baseline.case_id,
      selection_reason: baseline.selection_reason,
      applied: proposal.applied,
      before,
      after,
      recall_any_transition: transition(before.recall_any, after.recall_any),
      recall_all_transition: transition(before.recall_all, after.recall_all),
      protect_regression: protectRegression,
      proposal: proposal.proposal,
    }));
  }

  return Object.freeze({
    split,
    case_count: rows.length,
    config,
    applied_count: applied,
    paired_recall_any: Object.freeze(recallAny),
    paired_recall_all: Object.freeze(recallAll),
    protect_regression_count: protectRegressions,
    mean_evidence_coverage_delta: rows.length === 0 ? 0 : coverageDeltaSum / rows.length,
    rows: Object.freeze(rows),
  });
}

function compareDevelopmentResults(left, right) {
  const leftSafe = left.paired_recall_any.regressed === 0 && left.protect_regression_count === 0;
  const rightSafe = right.paired_recall_any.regressed === 0 && right.protect_regression_count === 0;
  if (leftSafe !== rightSafe) return leftSafe ? -1 : 1;

  if (left.paired_recall_all.improved !== right.paired_recall_all.improved) {
    return right.paired_recall_all.improved - left.paired_recall_all.improved;
  }
  if (left.paired_recall_all.regressed !== right.paired_recall_all.regressed) {
    return left.paired_recall_all.regressed - right.paired_recall_all.regressed;
  }
  if (left.mean_evidence_coverage_delta !== right.mean_evidence_coverage_delta) {
    return right.mean_evidence_coverage_delta - left.mean_evidence_coverage_delta;
  }

  // Strictest deterministic tie-break: more redundancy gain, tighter score guard, shallower rank.
  if (left.config.min_redundancy_gain !== right.config.min_redundancy_gain) {
    return right.config.min_redundancy_gain - left.config.min_redundancy_gain;
  }
  if (left.config.min_score_gap !== right.config.min_score_gap) {
    return right.config.min_score_gap - left.config.min_score_gap;
  }
  return left.config.max_candidate_rank - right.config.max_candidate_rank;
}

function compactOutcome(result) {
  return Object.freeze({
    split: result.split,
    case_count: result.case_count,
    config: result.config,
    applied_count: result.applied_count,
    paired_recall_any: result.paired_recall_any,
    paired_recall_all: result.paired_recall_all,
    protect_regression_count: result.protect_regression_count,
    mean_evidence_coverage_delta: result.mean_evidence_coverage_delta,
  });
}

export function analyzeQ5B3DProductVisibleFeasibilityV1({
  analysisPlan,
  b2Packet,
  material,
} = {}) {
  const baseline = analyzeQ5B3DevelopmentValidationV1({
    analysisPlan,
    b2Packet,
    material,
  });
  if (baseline.final_evaluation_consumed !== false) fail("Q5_B3_D_FINAL_ALREADY_CONSUMED");

  const packetById = new Map((b2Packet.cases || []).map(row => [row.case_id, row]));
  const materialById = new Map((material.cases || []).map(row => [row.case_id, row]));
  const configs = frozenConfigs();
  const developmentResults = configs.map(config => evaluateConfig({
    config,
    split: "development",
    baselineRows: baseline.rows,
    packetById,
    materialById,
    material,
  })).toSorted(compareDevelopmentResults);

  const safeDevelopmentResults = developmentResults.filter(result => (
    result.paired_recall_any.regressed === 0
    && result.protect_regression_count === 0
  ));
  const selectedDevelopment = safeDevelopmentResults[0] ?? null;
  const bestUnsafeDevelopment = selectedDevelopment ? null : developmentResults[0] ?? null;
  if (!selectedDevelopment && !bestUnsafeDevelopment) {
    fail("Q5_B3_D_DEVELOPMENT_SELECTION_EMPTY");
  }

  const selectedConfig = selectedDevelopment?.config ?? null;
  const validation = selectedDevelopment
    ? evaluateConfig({
      config: selectedConfig,
      split: "validation",
      baselineRows: baseline.rows,
      packetById,
      materialById,
      material,
    })
    : null;

  const validationSuccess = validation !== null
    && validation.paired_recall_all.improved > 0
    && validation.paired_recall_any.regressed === 0
    && validation.protect_regression_count === 0;

  const body = {
    schema: Q5_B3_D_FEASIBILITY_SCHEMA,
    source_b3_b_result_sha256: baseline.result_sha256,
    source_plan_sha256: baseline.source_plan_sha256,
    source_b2_packet_sha256: baseline.source_b2_packet_sha256,
    signal_contract: Object.freeze({
      candidate_to_candidate_text_redundancy: "unicode_token_overlap_coefficient",
      omitted_candidate_query_novelty: "incremental_query_terms_vs_kept_pair",
      rerank_guard: "candidate_minus_displaced_score_and_candidate_rank",
      minimum_incremental_query_terms: 1,
      threshold_grid: Object.freeze({
        min_redundancy_gain: REDUNDANCY_GAIN_THRESHOLDS,
        min_score_gap: SCORE_GAP_THRESHOLDS,
        max_candidate_rank: MAX_CANDIDATE_RANKS,
      }),
      selector_gold_fields: false,
      evaluator_fields_used_only_for_offline_scoring: true,
    }),
    development_config_count: configs.length,
    development_safe_config_count: safeDevelopmentResults.length,
    selected_config: selectedConfig,
    development: selectedDevelopment ? compactOutcome(selectedDevelopment) : null,
    best_unsafe_development: bestUnsafeDevelopment ? compactOutcome(bestUnsafeDevelopment) : null,
    validation: validation ? compactOutcome(validation) : null,
    validation_status: validation
      ? "ONE_SHOT_FROZEN_DEVELOPMENT_CONFIG_EVALUATED"
      : "NOT_RUN_NO_SAFE_DEVELOPMENT_CONFIG",
    validation_success: validationSuccess,
    branch_interpretation: validationSuccess
      ? "PRODUCT_VISIBLE_COMPLEMENTARITY_FEASIBILITY_SUPPORTED"
      : "DETERMINISTIC_COMPLEMENTARITY_BRANCH_CLOSE_BY_DEFAULT",
    final_evaluation_consumed: false,
    provider_requests: 0,
    embedding_requests: 0,
    reranker_requests: 0,
    llm_requests: 0,
    model_training_runs: 0,
    statistical_ltr_selected: false,
    learned_set_scorer_selected: false,
    runtime_mutation: false,
    validation_informed_retuning: false,
  };
  assertQ5B3NoFinalOutcomesV1(body);
  return Object.freeze({
    ...body,
    result_sha256: sha256(JSON.stringify(body)),
  });
}
