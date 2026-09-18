import { createHash } from "node:crypto";

import { scoreQ1EvidenceRankingAt3 } from "./q1-product-metric-contract-v1.js";
import {
  Q5_FIXED_CANDIDATE_FIXTURE_SCHEMA,
  Q5_FIXED_CANDIDATE_TOP_K,
} from "./q5-fixed-candidate-attribution-v1.js";

export const Q5_FIXED_CANDIDATE_INTERVENTION_SCHEMA =
  "memory_engine_q5_fixed_candidate_intervention_v1";

export const Q5_INTERVENTION_IDS = Object.freeze({
  PRE_RERANK_TOP3: "pre_rerank_top3_v1",
  ANCHOR_COMPLEMENTARITY: "anchor_complementarity_repair_v1",
});

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function metric(score, name) {
  return Number(score?.metrics?.[name] ?? score?.[name] ?? 0);
}

function scoreSelection(goldEvidenceIds, selectedIds) {
  return scoreQ1EvidenceRankingAt3({
    gold_evidence_ids: goldEvidenceIds,
    ranked_retrieved_ids: selectedIds,
  });
}

function tokenize(text) {
  return (String(text || "").toLowerCase().match(/[a-z0-9][a-z0-9_-]*/g) || [])
    .filter(token => token.length > 1);
}

function isMultiIntentQuery(query) {
  const normalized = String(query || "").toLowerCase();
  if (/\b(before|after)\b|之前|之后|迁移前|迁移后/.test(normalized)) return false;
  return /\band\b|，|分别|以及|同时/.test(normalized);
}

function preRerankTop3(run) {
  return Object.freeze(run.candidate_pool_ids.slice(0, Q5_FIXED_CANDIDATE_TOP_K));
}

function anchorComplementarityRepair({ caseRow, run, memoryMap }) {
  const original = [...run.ranked_top3_ids];
  if (!isMultiIntentQuery(caseRow.query)) {
    return Object.freeze({
      selected_ids: Object.freeze(original),
      applied: false,
      reason: "query_not_multi_intent",
      anchor_id: null,
      anchor_token: null,
      counterpart_id: null,
    });
  }

  const pool = run.candidate_pool_ids;
  const poolRank = new Map(pool.map((id, index) => [id, index]));
  const poolTokens = pool.map(id => {
    const memory = memoryMap.get(id);
    if (!memory) throw fail("Q5_A2_POOL_MEMORY_MISSING");
    return tokenize(memory.text);
  });
  const documentFrequency = new Map();
  for (const tokens of poolTokens) {
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    }
  }

  const pairCandidates = [];
  for (let rerankIndex = 0; rerankIndex < original.length; rerankIndex += 1) {
    const anchorId = original[rerankIndex];
    const anchorIndex = poolRank.get(anchorId);
    if (!Number.isInteger(anchorIndex)) continue;

    const anchorTokens = poolTokens[anchorIndex];
    let anchorToken = null;
    for (let index = 0; index < Math.min(3, anchorTokens.length); index += 1) {
      const token = anchorTokens[index];
      if (documentFrequency.get(token) === 2) {
        anchorToken = token;
        break;
      }
    }
    if (!anchorToken) continue;

    let counterpartIndex = null;
    for (let index = 0; index < pool.length; index += 1) {
      const id = pool[index];
      if (original.includes(id)) continue;
      if (poolTokens[index].includes(anchorToken)) {
        counterpartIndex = index;
        break;
      }
    }
    if (!Number.isInteger(counterpartIndex)) continue;

    pairCandidates.push({
      anchorId,
      anchorIndex,
      anchorToken,
      counterpartId: pool[counterpartIndex],
      counterpartIndex,
      rerankIndex,
      maxPoolIndex: Math.max(anchorIndex, counterpartIndex),
      sumPoolIndex: anchorIndex + counterpartIndex,
    });
  }

  if (pairCandidates.length === 0) {
    return Object.freeze({
      selected_ids: Object.freeze(original),
      applied: false,
      reason: "bounded_pair_not_found",
      anchor_id: null,
      anchor_token: null,
      counterpart_id: null,
    });
  }

  pairCandidates.sort((left, right) => (
    left.maxPoolIndex - right.maxPoolIndex
    || left.sumPoolIndex - right.sumPoolIndex
    || left.rerankIndex - right.rerankIndex
  ));
  const chosen = pairCandidates[0];
  const selected = [chosen.anchorId, chosen.counterpartId];
  for (const id of original) {
    if (!selected.includes(id) && selected.length < Q5_FIXED_CANDIDATE_TOP_K) selected.push(id);
  }
  for (const id of pool) {
    if (!selected.includes(id) && selected.length < Q5_FIXED_CANDIDATE_TOP_K) selected.push(id);
  }

  return Object.freeze({
    selected_ids: Object.freeze(selected.slice(0, Q5_FIXED_CANDIDATE_TOP_K)),
    applied: true,
    reason: "bounded_anchor_counterpart_inserted",
    anchor_id: chosen.anchorId,
    anchor_token: chosen.anchorToken,
    counterpart_id: chosen.counterpartId,
  });
}

function scoreRow(goldEvidenceIds, selectedIds) {
  const score = scoreSelection(goldEvidenceIds, selectedIds);
  return Object.freeze({
    recall_any_at_3: metric(score, "recall_any@3"),
    recall_all_at_3: metric(score, "recall_all@3"),
    evidence_coverage_at_3: metric(score, "evidence_coverage@3"),
    ndcg_at_3: metric(score, "ndcg@3"),
  });
}

function compareMetric(productScore, candidateScore, field) {
  if (candidateScore[field] > productScore[field]) return "improved";
  if (candidateScore[field] < productScore[field]) return "regressed";
  return "unchanged";
}

function summarize(rows, interventionId) {
  const selected = rows.map(row => row.interventions[interventionId]);
  const count = selected.length || 1;
  const recallAllTransitions = { improved: 0, regressed: 0, unchanged: 0 };
  const recallAnyTransitions = { improved: 0, regressed: 0, unchanged: 0 };
  let applied = 0;
  let recallAny = 0;
  let recallAll = 0;
  let coverage = 0;
  let ndcg = 0;
  let bridgeImproved = 0;
  let bridgeRegressed = 0;
  let bridgeUnchanged = 0;

  for (const row of rows) {
    const intervention = row.interventions[interventionId];
    recallAny += intervention.score.recall_any_at_3;
    recallAll += intervention.score.recall_all_at_3;
    coverage += intervention.score.evidence_coverage_at_3;
    ndcg += intervention.score.ndcg_at_3;
    recallAllTransitions[intervention.recall_all_transition] += 1;
    recallAnyTransitions[intervention.recall_any_transition] += 1;
    applied += Number(intervention.applied === true);
    if (row.recovered_pool_but_top3_incomplete) {
      if (intervention.recall_all_transition === "improved") bridgeImproved += 1;
      else if (intervention.recall_all_transition === "regressed") bridgeRegressed += 1;
      else bridgeUnchanged += 1;
    }
  }

  return Object.freeze({
    snapshot_count: rows.length,
    applied_count: applied,
    metrics: Object.freeze({
      recall_any_at_3: recallAny / count,
      recall_all_at_3: recallAll / count,
      evidence_coverage_at_3: coverage / count,
      ndcg_at_3: ndcg / count,
    }),
    paired_recall_all: Object.freeze(recallAllTransitions),
    paired_recall_any: Object.freeze(recallAnyTransitions),
    recovered_pool_bridge: Object.freeze({
      improved: bridgeImproved,
      regressed: bridgeRegressed,
      unchanged: bridgeUnchanged,
    }),
  });
}

export function evaluateQ5FixedCandidateInterventionsV1(fixture) {
  if (!fixture || fixture.schema !== Q5_FIXED_CANDIDATE_FIXTURE_SCHEMA) {
    throw fail("Q5_A2_FIXTURE_SCHEMA_INVALID");
  }
  const { fixture_sha256: fixtureSha256, ...fixtureBody } = fixture;
  if (fixtureSha256 !== sha256(JSON.stringify(fixtureBody))) {
    throw fail("Q5_A2_FIXTURE_HASH_MISMATCH");
  }
  if (fixture.top_k !== Q5_FIXED_CANDIDATE_TOP_K) throw fail("Q5_A2_TOPK_DRIFT");

  const rows = [];
  const summaries = {};

  for (const source of fixture.sources || []) {
    const memoryMap = new Map((source.memories || []).map(row => [row.id, row]));
    const sourceRows = [];

    for (const caseRow of source.cases || []) {
      const baselinePoolComplete = caseRow.gold_evidence_ids
        .every(id => caseRow.baseline.candidate_pool_ids.includes(id));

      for (const arm of ["baseline", "hint"]) {
        const run = caseRow[arm];
        const productScore = scoreRow(caseRow.gold_evidence_ids, run.ranked_top3_ids);
        const poolComplete = caseRow.gold_evidence_ids
          .every(id => run.candidate_pool_ids.includes(id));
        const recoveredPoolButTop3Incomplete = arm === "hint"
          && !baselinePoolComplete
          && poolComplete
          && productScore.recall_all_at_3 === 0;

        const preIds = preRerankTop3(run);
        const preScore = scoreRow(caseRow.gold_evidence_ids, preIds);
        const complement = anchorComplementarityRepair({ caseRow, run, memoryMap });
        const complementScore = scoreRow(caseRow.gold_evidence_ids, complement.selected_ids);

        const row = Object.freeze({
          source_name: source.source_name,
          case_id: caseRow.case_id,
          family: caseRow.family,
          arm,
          pool_gold_complete: poolComplete,
          recovered_pool_but_top3_incomplete: recoveredPoolButTop3Incomplete,
          product: Object.freeze({
            selected_ids: Object.freeze([...run.ranked_top3_ids]),
            score: productScore,
          }),
          interventions: Object.freeze({
            [Q5_INTERVENTION_IDS.PRE_RERANK_TOP3]: Object.freeze({
              selected_ids: preIds,
              score: preScore,
              applied: true,
              reason: "reranker_bypassed_for_diagnostic",
              recall_all_transition: compareMetric(productScore, preScore, "recall_all_at_3"),
              recall_any_transition: compareMetric(productScore, preScore, "recall_any_at_3"),
            }),
            [Q5_INTERVENTION_IDS.ANCHOR_COMPLEMENTARITY]: Object.freeze({
              ...complement,
              score: complementScore,
              recall_all_transition: compareMetric(productScore, complementScore, "recall_all_at_3"),
              recall_any_transition: compareMetric(productScore, complementScore, "recall_any_at_3"),
            }),
          }),
        });
        rows.push(row);
        sourceRows.push(row);
      }
    }

    summaries[source.source_name] = Object.freeze({
      baseline: Object.freeze({
        product: summarizeProduct(sourceRows.filter(row => row.arm === "baseline")),
        interventions: Object.freeze({
          [Q5_INTERVENTION_IDS.PRE_RERANK_TOP3]: summarize(
            sourceRows.filter(row => row.arm === "baseline"),
            Q5_INTERVENTION_IDS.PRE_RERANK_TOP3,
          ),
          [Q5_INTERVENTION_IDS.ANCHOR_COMPLEMENTARITY]: summarize(
            sourceRows.filter(row => row.arm === "baseline"),
            Q5_INTERVENTION_IDS.ANCHOR_COMPLEMENTARITY,
          ),
        }),
      }),
      hint: Object.freeze({
        product: summarizeProduct(sourceRows.filter(row => row.arm === "hint")),
        interventions: Object.freeze({
          [Q5_INTERVENTION_IDS.PRE_RERANK_TOP3]: summarize(
            sourceRows.filter(row => row.arm === "hint"),
            Q5_INTERVENTION_IDS.PRE_RERANK_TOP3,
          ),
          [Q5_INTERVENTION_IDS.ANCHOR_COMPLEMENTARITY]: summarize(
            sourceRows.filter(row => row.arm === "hint"),
            Q5_INTERVENTION_IDS.ANCHOR_COMPLEMENTARITY,
          ),
        }),
      }),
    });
  }

  const body = {
    schema: Q5_FIXED_CANDIDATE_INTERVENTION_SCHEMA,
    fixture_sha256: fixture.fixture_sha256,
    top_k: Q5_FIXED_CANDIDATE_TOP_K,
    provider_requests: 0,
    model_training_runs: 0,
    interventions: Object.freeze({
      [Q5_INTERVENTION_IDS.PRE_RERANK_TOP3]: Object.freeze({
        role: "DIAGNOSTIC_CONTROL_ONLY",
        gold_in_selection: false,
        product_visible_inputs: Object.freeze(["candidate_pool_order"]),
      }),
      [Q5_INTERVENTION_IDS.ANCHOR_COMPLEMENTARITY]: Object.freeze({
        role: "BOUNDED_SYNTHETIC_MECHANISM_PROBE",
        gold_in_selection: false,
        product_visible_inputs: Object.freeze([
          "query_text",
          "candidate_pool_order",
          "candidate_text",
          "frozen_rerank_top3",
        ]),
        trigger: "multi_intent_query_and_compact_bounded_repeated_anchor_pair",
      }),
    }),
    rows: Object.freeze(rows),
    summaries: Object.freeze(summaries),
  };

  return Object.freeze({
    ...body,
    result_sha256: sha256(JSON.stringify(body)),
  });
}

function summarizeProduct(rows) {
  const count = rows.length || 1;
  let recallAny = 0;
  let recallAll = 0;
  let coverage = 0;
  let ndcg = 0;
  let bridgeCount = 0;
  for (const row of rows) {
    recallAny += row.product.score.recall_any_at_3;
    recallAll += row.product.score.recall_all_at_3;
    coverage += row.product.score.evidence_coverage_at_3;
    ndcg += row.product.score.ndcg_at_3;
    bridgeCount += Number(row.recovered_pool_but_top3_incomplete);
  }
  return Object.freeze({
    snapshot_count: rows.length,
    metrics: Object.freeze({
      recall_any_at_3: recallAny / count,
      recall_all_at_3: recallAll / count,
      evidence_coverage_at_3: coverage / count,
      ndcg_at_3: ndcg / count,
    }),
    recovered_pool_bridge_count: bridgeCount,
  });
}
