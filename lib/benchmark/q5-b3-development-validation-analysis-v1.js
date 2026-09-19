import { createHash } from "node:crypto";

import {
  evaluateLocomoChunkEvidenceCoverage,
  scoreLocomoChunkCase,
} from "./locomo-chunk-evidence-scorer.js";
import {
  Q5_B2_PACKET_SCHEMA,
  validateQ5B2PacketV1,
} from "./q5-b2-fixed-pool-score-capture-v1.js";
import {
  Q5_B3_ANALYSIS_PLAN_SCHEMA,
  Q5_B3_ALLOWED_EXPLORATION_SPLITS,
  Q5_B3_SEALED_SPLIT,
  assertQ5B3NoFinalOutcomesV1,
} from "./q5-b3-fixed-pool-analysis-plan-v1.js";

export const Q5_B3_DV_ANALYSIS_SCHEMA =
  "memory_engine_q5_b3_development_validation_offline_analysis_v1";

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function validRange(range) {
  return range
    && Number.isSafeInteger(range.startUtf16)
    && Number.isSafeInteger(range.endUtf16)
    && range.startUtf16 >= 0
    && range.endUtf16 > range.startUtf16;
}

function metric(score, name) {
  const value = score?.metrics?.[name];
  return Number.isFinite(value) ? Number(value) : null;
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length === 0
    ? null
    : finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function quantile(values, q) {
  const finite = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (finite.length === 0) return null;
  if (finite.length === 1) return finite[0];
  const position = (finite.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return finite[lower];
  const weight = position - lower;
  return finite[lower] * (1 - weight) + finite[upper] * weight;
}

function sourceKey(sampleId, sessionId) {
  return `${sampleId}\u0000${sessionId}`;
}

function turnKey(sampleId, diaId) {
  return `${sampleId}\u0000${diaId}`;
}

function buildScoringIndex(scoringMaterial) {
  if (!scoringMaterial || !Array.isArray(scoringMaterial.sources)) {
    fail("Q5_B3_SCORING_MATERIAL_INVALID");
  }
  const chunks = new Map();
  const turns = new Map();

  for (const source of scoringMaterial.sources) {
    const key = sourceKey(source.sampleId, source.sessionId);
    for (const chunk of source.chunks || []) {
      if (chunks.has(chunk.memoryId)) fail("Q5_B3_CHUNK_ID_DUPLICATE");
      chunks.set(chunk.memoryId, { ...chunk, source_key: key });
    }
    for (const turn of source.turnRanges || []) {
      const keyTurn = turnKey(source.sampleId, turn.diaId);
      if (turns.has(keyTurn)) fail("Q5_B3_TURN_ID_DUPLICATE");
      turns.set(keyTurn, { ...turn, source_key: key });
    }
  }
  return { chunks, turns };
}

function mergedCoveredLength(intervals) {
  const ordered = intervals
    .filter(interval => interval.endUtf16 > interval.startUtf16)
    .toSorted((a, b) => a.startUtf16 - b.startUtf16 || a.endUtf16 - b.endUtf16);
  if (ordered.length === 0) return 0;
  let covered = 0;
  let start = ordered[0].startUtf16;
  let end = ordered[0].endUtf16;
  for (let index = 1; index < ordered.length; index += 1) {
    const interval = ordered[index];
    if (interval.startUtf16 > end) {
      covered += end - start;
      start = interval.startUtf16;
      end = interval.endUtf16;
    } else if (interval.endUtf16 > end) {
      end = interval.endUtf16;
    }
  }
  return covered + (end - start);
}

function coverageForSelection(index, materialCase, selectedIds) {
  const selected = selectedIds.map(id => {
    const chunk = index.chunks.get(id);
    if (!chunk) fail("Q5_B3_SELECTED_CHUNK_MISSING");
    return chunk;
  });

  let full = 0;
  for (const evidenceId of materialCase.evidence_ids) {
    const target = index.turns.get(turnKey(materialCase.sample_id, evidenceId));
    if (!target || !validRange(target.range)) fail("Q5_B3_EVIDENCE_TARGET_UNKNOWN");
    const intervals = [];
    for (const chunk of selected) {
      if (chunk.source_key !== target.source_key) continue;
      if (chunk.position?.status === "exact" && validRange(chunk.position?.range)) {
        const startUtf16 = Math.max(chunk.position.range.startUtf16, target.range.startUtf16);
        const endUtf16 = Math.min(chunk.position.range.endUtf16, target.range.endUtf16);
        if (endUtf16 > startUtf16) intervals.push({ startUtf16, endUtf16 });
        continue;
      }
      if (
        Number.isSafeInteger(chunk.startLine)
        && Number.isSafeInteger(chunk.endLine)
        && Number.isSafeInteger(target.range.startLine)
        && Number.isSafeInteger(target.range.endLine)
        && chunk.startLine <= target.range.endLine
        && chunk.endLine >= target.range.startLine
      ) {
        fail("Q5_B3_SELECTED_CHUNK_POSITION_UNKNOWN");
      }
    }
    const targetLength = target.range.endUtf16 - target.range.startUtf16;
    if (mergedCoveredLength(intervals) >= targetLength) full += 1;
  }

  return Object.freeze({
    full_evidence_count: full,
    evidence_count: materialCase.evidence_ids.length,
    recall_any: Number(full > 0),
    recall_all: Number(full === materialCase.evidence_ids.length),
    evidence_coverage: full / materialCase.evidence_ids.length,
  });
}

function combinations(values, size) {
  const out = [];
  const walk = (start, acc) => {
    if (acc.length === size) {
      out.push([...acc]);
      return;
    }
    for (let index = start; index <= values.length - (size - acc.length); index += 1) {
      acc.push(values[index]);
      walk(index + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

function oracleTop3(index, materialCase, poolIds, servedTop3) {
  const maxSize = Math.min(3, poolIds.length);
  let bestCoverage = -1;
  let bestAny = 0;
  let feasible = false;
  let minimumCoverSize = null;
  let minimumCompletionAdditions = null;
  let feasibleSetCount = 0;

  const served = new Set(servedTop3);
  for (let size = 1; size <= maxSize; size += 1) {
    for (const ids of combinations(poolIds, size)) {
      const coverage = coverageForSelection(index, materialCase, ids);
      if (coverage.evidence_coverage > bestCoverage) {
        bestCoverage = coverage.evidence_coverage;
        bestAny = coverage.recall_any;
      }
      if (coverage.recall_all !== 1) continue;
      feasible = true;
      feasibleSetCount += 1;
      if (minimumCoverSize === null) minimumCoverSize = size;
      const additions = ids.reduce((count, id) => count + Number(!served.has(id)), 0);
      if (minimumCompletionAdditions === null || additions < minimumCompletionAdditions) {
        minimumCompletionAdditions = additions;
      }
    }
  }

  return Object.freeze({
    feasible,
    minimum_cover_size: minimumCoverSize,
    minimum_completion_additions: minimumCompletionAdditions,
    feasible_set_count: feasibleSetCount,
    oracle_recall_any: bestAny,
    oracle_recall_all: Number(feasible),
    oracle_evidence_coverage: Math.max(0, bestCoverage),
  });
}

function singleSwapDiagnostics(index, materialCase, packetCase) {
  const served = packetCase.served_top3_ids;
  const scoreById = new Map(packetCase.candidates.map(row => [row.id, Number(row.rerank_score)]));
  const rankById = new Map(packetCase.candidates.map(row => [row.id, row.rerank_rank]));
  const packetById = new Map(packetCase.candidates.map(row => [row.id, row]));
  const poolIds = packetCase.candidates
    .toSorted((a, b) => a.pre_rerank_rank - b.pre_rerank_rank)
    .map(row => row.id);
  const servedCoverage = coverageForSelection(index, materialCase, served);

  const repairs = [];
  for (const candidateId of poolIds) {
    if (served.includes(candidateId)) continue;
    if (served.length < 3) {
      const proposal = [...served, candidateId];
      if (coverageForSelection(index, materialCase, proposal).recall_all === 1) {
        repairs.push({
          candidate_id: candidateId,
          displaced_id: null,
          displaced_redundant: null,
        });
      }
      continue;
    }
    for (const displacedId of served) {
      const proposal = served.map(id => id === displacedId ? candidateId : id);
      if (new Set(proposal).size !== proposal.length) continue;
      if (coverageForSelection(index, materialCase, proposal).recall_all === 1) {
        const withoutDisplaced = served.filter(id => id !== displacedId);
        const withoutCoverage = coverageForSelection(index, materialCase, withoutDisplaced);
        repairs.push({
          candidate_id: candidateId,
          displaced_id: displacedId,
          displaced_redundant:
            withoutCoverage.full_evidence_count === servedCoverage.full_evidence_count,
        });
      }
    }
  }

  if (repairs.length === 0) {
    return Object.freeze({
      exists: false,
      best_candidate_rank: null,
      best_candidate_score: null,
      score_minus_weakest_served: null,
      repair_pair_count: 0,
      redundant_displacement_exists: false,
      best_candidate_truncated: null,
    });
  }

  repairs.sort((left, right) => (
    rankById.get(left.candidate_id) - rankById.get(right.candidate_id)
    || String(left.candidate_id).localeCompare(String(right.candidate_id))
  ));
  const best = repairs[0];
  const servedScores = served.map(id => scoreById.get(id)).filter(Number.isFinite);
  const weakestServed = servedScores.length > 0 ? Math.min(...servedScores) : null;
  const bestScore = scoreById.get(best.candidate_id);

  return Object.freeze({
    exists: true,
    best_candidate_rank: rankById.get(best.candidate_id),
    best_candidate_score: bestScore,
    score_minus_weakest_served: Number.isFinite(weakestServed) && Number.isFinite(bestScore)
      ? bestScore - weakestServed
      : null,
    repair_pair_count: repairs.length,
    redundant_displacement_exists: repairs.some(row => row.displaced_redundant === true),
    best_candidate_truncated: packetById.get(best.candidate_id)?.truncated === true,
  });
}

function validatePacketMaterialBinding(packetCase, materialCase) {
  if (!materialCase) fail("Q5_B3_MATERIAL_CASE_MISSING");
  if (packetCase.sample_id !== materialCase.sample_id) fail("Q5_B3_SAMPLE_ID_DRIFT");
  if (packetCase.query_sha256 !== sha256(materialCase.query)) fail("Q5_B3_QUERY_HASH_DRIFT");
  if (packetCase.candidate_count !== materialCase.candidates.length) {
    fail("Q5_B3_CANDIDATE_COUNT_DRIFT");
  }

  const packetCandidates = [...packetCase.candidates].toSorted(
    (a, b) => a.pre_rerank_rank - b.pre_rerank_rank,
  );
  for (let index = 0; index < materialCase.candidates.length; index += 1) {
    const source = materialCase.candidates[index];
    const captured = packetCandidates[index];
    if (!captured || captured.id !== source.id) fail("Q5_B3_CANDIDATE_IDENTITY_DRIFT");
    if (captured.text_sha256 !== sha256(source.text)) fail("Q5_B3_CANDIDATE_TEXT_HASH_DRIFT");
  }
}

function rankBin(rank) {
  if (!Number.isFinite(rank)) return "none";
  if (rank === 4) return "4";
  if (rank === 5) return "5";
  if (rank <= 10) return "6_10";
  return "11_20";
}

function summarizeSplit(rows, split) {
  const subset = rows.filter(row => row.split === split);
  const recoverable = subset.filter(row => row.selection_reason === "recoverable_rank_miss");
  const protect = subset.filter(row => row.selection_reason === "protect");
  const feasibleFailures = subset.filter(row => row.selection_failure === true);
  const singleSwap = feasibleFailures.filter(row => row.single_swap.exists);
  const rankBins = { "4": 0, "5": 0, "6_10": 0, "11_20": 0, none: 0 };
  for (const row of feasibleFailures) rankBins[rankBin(row.single_swap.best_candidate_rank)] += 1;
  const scoreGaps = feasibleFailures
    .map(row => row.single_swap.score_minus_weakest_served)
    .filter(Number.isFinite);

  return Object.freeze({
    case_count: subset.length,
    selection_population: Object.freeze({
      recoverable_rank_miss: recoverable.length,
      protect: protect.length,
    }),
    rerank_top3: Object.freeze({
      recall_any_at_3: mean(subset.map(row => row.rerank.recall_any_at_3)),
      recall_all_at_3: mean(subset.map(row => row.rerank.recall_all_at_3)),
      evidence_coverage_at_3: mean(subset.map(row => row.rerank.evidence_coverage_at_3)),
    }),
    control_top3: Object.freeze({
      recall_any_at_3: mean(subset.map(row => row.control.recall_any_at_3)),
      recall_all_at_3: mean(subset.map(row => row.control.recall_all_at_3)),
      evidence_coverage_at_3: mean(subset.map(row => row.control.evidence_coverage_at_3)),
    }),
    pool_gold_complete_count: subset.filter(row => row.pool_gold_complete).length,
    top3_budget_feasible_count: subset.filter(row => row.top3_budget_feasible).length,
    selection_failure_count: feasibleFailures.length,
    recoverable_outcomes: Object.freeze({
      rerank_fixed_count: recoverable.filter(row => row.rerank.recall_all_at_3 === 1).length,
      rerank_still_incomplete_count: recoverable.filter(row => row.rerank.recall_all_at_3 === 0).length,
    }),
    protect_outcomes: Object.freeze({
      preserved_count: protect.filter(row => row.rerank.recall_all_at_3 === 1).length,
      regression_count: protect.filter(row => row.protect_regression).length,
    }),
    pair_set_signal_diagnostics: Object.freeze({
      feasible_failure_count: feasibleFailures.length,
      single_swap_repairable_count: singleSwap.length,
      requires_at_least_two_additions_count: feasibleFailures.filter(
        row => row.oracle.minimum_completion_additions >= 2,
      ).length,
      best_single_swap_candidate_rank_bins: Object.freeze(rankBins),
      redundant_displacement_repairable_count: feasibleFailures.filter(
        row => row.single_swap.redundant_displacement_exists === true,
      ).length,
      best_repair_candidate_truncated_count: feasibleFailures.filter(
        row => row.single_swap.best_candidate_truncated === true,
      ).length,
    }),
    projection_diagnostics: Object.freeze({
      any_candidate_truncated_case_count: subset.filter(
        row => row.projection.any_candidate_truncated,
      ).length,
      served_candidate_truncated_count: subset.reduce(
        (sum, row) => sum + row.projection.served_truncated_count,
        0,
      ),
    }),
    score_rank_distribution: Object.freeze({
      single_swap_score_gap_vs_weakest_served: Object.freeze({
        count: scoreGaps.length,
        min: scoreGaps.length ? Math.min(...scoreGaps) : null,
        p25: quantile(scoreGaps, 0.25),
        median: quantile(scoreGaps, 0.5),
        p75: quantile(scoreGaps, 0.75),
        max: scoreGaps.length ? Math.max(...scoreGaps) : null,
      }),
    }),
  });
}

export function analyzeQ5B3DevelopmentValidationV1({
  analysisPlan,
  b2Packet,
  material,
} = {}) {
  if (!analysisPlan || analysisPlan.schema !== Q5_B3_ANALYSIS_PLAN_SCHEMA) {
    fail("Q5_B3_ANALYSIS_PLAN_INVALID");
  }
  if (!b2Packet || b2Packet.schema !== Q5_B2_PACKET_SCHEMA) {
    fail("Q5_B3_B2_PACKET_INVALID");
  }
  validateQ5B2PacketV1(b2Packet);
  if (b2Packet.source_b1_manifest_sha256 !== analysisPlan.source_b1_manifest_sha256) {
    fail("Q5_B3_B2_PACKET_MANIFEST_DRIFT");
  }
  if (b2Packet.contains_gold_fields !== false || b2Packet.top_k !== 3) {
    fail("Q5_B3_B2_PACKET_BOUNDARY_INVALID");
  }
  if (!material || material.schema !== "memory_engine_r3_c1a_locomo_material_v1") {
    fail("Q5_B3_MATERIAL_INVALID");
  }

  const allowed = new Set(Q5_B3_ALLOWED_EXPLORATION_SPLITS);
  const planRows = (analysisPlan.rows || []).filter(row => allowed.has(row.split));
  if (planRows.some(row => row.split === Q5_B3_SEALED_SPLIT)) fail("Q5_B3_FINAL_SPLIT_LEAK");
  const planByCase = new Map(planRows.map(row => [row.case_id, row]));
  const packetByCase = new Map((b2Packet.cases || []).map(row => [row.case_id, row]));
  const materialByCase = new Map((material.cases || []).map(row => [row.case_id, row]));
  const scoringIndex = buildScoringIndex(material.scoring_material);

  const rows = [];
  for (const planRow of planRows) {
    const packetCase = packetByCase.get(planRow.case_id);
    const materialCase = materialByCase.get(planRow.case_id);
    if (!packetCase) fail("Q5_B3_PACKET_CASE_MISSING");
    if (packetCase.split !== planRow.split || packetCase.sample_id !== planRow.sample_id) {
      fail("Q5_B3_PACKET_CASE_IDENTITY_DRIFT");
    }
    validatePacketMaterialBinding(packetCase, materialCase);

    const controlScore = scoreLocomoChunkCase({
      material: material.scoring_material,
      sampleId: materialCase.sample_id,
      qaIndex: materialCase.qa_index,
      evidenceIds: materialCase.evidence_ids,
      selectedChunkIds: materialCase.control_top3,
      category: materialCase.category ?? null,
    });
    const rerankScore = scoreLocomoChunkCase({
      material: material.scoring_material,
      sampleId: materialCase.sample_id,
      qaIndex: materialCase.qa_index,
      evidenceIds: materialCase.evidence_ids,
      selectedChunkIds: packetCase.served_top3_ids,
      category: materialCase.category ?? null,
    });
    if (controlScore.scoreable !== true || rerankScore.scoreable !== true) {
      fail("Q5_B3_SCORE_UNKNOWN");
    }

    const controlCoverageCheck = coverageForSelection(
      scoringIndex,
      materialCase,
      materialCase.control_top3,
    );
    const rerankCoverageCheck = coverageForSelection(
      scoringIndex,
      materialCase,
      packetCase.served_top3_ids,
    );
    if (
      controlCoverageCheck.recall_any !== metric(controlScore, "recall_any@3")
      || controlCoverageCheck.recall_all !== metric(controlScore, "recall_all@3")
      || controlCoverageCheck.evidence_coverage !== metric(controlScore, "evidence_coverage@3")
      || rerankCoverageCheck.recall_any !== metric(rerankScore, "recall_any@3")
      || rerankCoverageCheck.recall_all !== metric(rerankScore, "recall_all@3")
      || rerankCoverageCheck.evidence_coverage !== metric(rerankScore, "evidence_coverage@3")
    ) {
      fail("Q5_B3_ORACLE_SCORER_SEMANTICS_DRIFT");
    }

    const poolIds = [...packetCase.candidates]
      .toSorted((a, b) => a.pre_rerank_rank - b.pre_rerank_rank)
      .map(row => row.id);
    const poolCoverage = evaluateLocomoChunkEvidenceCoverage({
      material: material.scoring_material,
      sampleId: materialCase.sample_id,
      qaIndex: materialCase.qa_index,
      evidenceIds: materialCase.evidence_ids,
      selectedChunkIds: poolIds,
    });
    if (poolCoverage.scoreable !== true) fail("Q5_B3_POOL_SCORE_UNKNOWN");
    const poolGoldComplete = poolCoverage.recall_all === 1;
    if (poolGoldComplete !== planRow.gold_complete_in_top20) {
      fail("Q5_B3_POOL_GOLD_COMPLETENESS_DRIFT");
    }

    const oracle = oracleTop3(
      scoringIndex,
      materialCase,
      poolIds,
      packetCase.served_top3_ids,
    );
    const rerank = Object.freeze({
      recall_any_at_3: metric(rerankScore, "recall_any@3"),
      recall_all_at_3: metric(rerankScore, "recall_all@3"),
      evidence_coverage_at_3: metric(rerankScore, "evidence_coverage@3"),
    });
    const control = Object.freeze({
      recall_any_at_3: metric(controlScore, "recall_any@3"),
      recall_all_at_3: metric(controlScore, "recall_all@3"),
      evidence_coverage_at_3: metric(controlScore, "evidence_coverage@3"),
    });
    const selectionFailure = poolGoldComplete && oracle.feasible && rerank.recall_all_at_3 === 0;
    const protectRegression = planRow.selection_reason === "protect"
      && control.recall_all_at_3 === 1
      && rerank.recall_all_at_3 === 0;
    const singleSwap = selectionFailure
      ? singleSwapDiagnostics(scoringIndex, materialCase, packetCase)
      : Object.freeze({
        exists: false,
        best_candidate_rank: null,
        best_candidate_score: null,
        score_minus_weakest_served: null,
        repair_pair_count: 0,
        redundant_displacement_exists: false,
        best_candidate_truncated: null,
      });
    const packetCandidateById = new Map(packetCase.candidates.map(row => [row.id, row]));
    const projection = Object.freeze({
      any_candidate_truncated: packetCase.candidates.some(row => row.truncated === true),
      served_truncated_count: packetCase.served_top3_ids.reduce(
        (sum, id) => sum + Number(packetCandidateById.get(id)?.truncated === true),
        0,
      ),
    });

    rows.push(Object.freeze({
      case_id: planRow.case_id,
      sample_id: planRow.sample_id,
      split: planRow.split,
      selection_reason: planRow.selection_reason,
      diagnostic_stratum: planRow.diagnostic_stratum,
      category: planRow.category,
      gold_evidence_count: planRow.gold_evidence_count,
      pool_gold_complete: poolGoldComplete,
      top3_budget_feasible: oracle.feasible,
      selection_failure: selectionFailure,
      protect_regression: protectRegression,
      control,
      rerank,
      oracle,
      single_swap: singleSwap,
      projection,
    }));
  }

  const summaries = Object.freeze({
    development: summarizeSplit(rows, "development"),
    validation: summarizeSplit(rows, "validation"),
  });

  const body = {
    schema: Q5_B3_DV_ANALYSIS_SCHEMA,
    source_plan_sha256: analysisPlan.plan_sha256,
    source_b2_packet_sha256: b2Packet.packet_sha256,
    analyzed_splits: Object.freeze(["development", "validation"]),
    final_evaluation_consumed: false,
    provider_requests: 0,
    model_training_runs: 0,
    threshold_selection_performed: false,
    pair_set_algorithm_selected: false,
    statistical_ltr_selected: false,
    runtime_mutation: false,
    summaries,
    rows: Object.freeze(rows),
  };
  assertQ5B3NoFinalOutcomesV1(body);
  return Object.freeze({
    ...body,
    result_sha256: sha256(JSON.stringify(body)),
  });
}
