import { createHash } from "node:crypto";

import { scoreQ1EvidenceRankingAt3 } from "./q1-product-metric-contract-v1.js";
import {
  Q5_FIXED_CANDIDATE_FIXTURE_SCHEMA,
  Q5_FIXED_CANDIDATE_TOP_K,
} from "./q5-fixed-candidate-attribution-v1.js";
import { validateQ5SelectionSignalPacketV1 } from "./q5-selection-signal-contract-v1.js";

export const Q5_MARGIN_SWEEP_SCHEMA =
  "memory_engine_q5_margin_constrained_selection_v1";

export const Q5_MARGIN_CONSTRAINTS = Object.freeze([
  "counterpart_to_displaced_ratio",
  "counterpart_minus_displaced_score",
]);

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
  const score = scoreQ1EvidenceRankingAt3({
    gold_evidence_ids: goldEvidenceIds,
    ranked_retrieved_ids: selectedIds,
  });
  return Object.freeze({
    recall_any_at_3: metric(score, "recall_any@3"),
    recall_all_at_3: metric(score, "recall_all@3"),
    evidence_coverage_at_3: metric(score, "evidence_coverage@3"),
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

function complementarityProposal({ caseRow, run, memoryMap }) {
  const original = [...run.ranked_top3_ids];
  if (!isMultiIntentQuery(caseRow.query)) return null;

  const pool = run.candidate_pool_ids;
  const poolRank = new Map(pool.map((id, index) => [id, index]));
  const poolTokens = pool.map(id => {
    const memory = memoryMap.get(id);
    if (!memory) throw fail("Q5_A6_POOL_MEMORY_MISSING");
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
      anchor_id: anchorId,
      anchor_index: anchorIndex,
      anchor_token: anchorToken,
      counterpart_id: pool[counterpartIndex],
      counterpart_index: counterpartIndex,
      rerank_index: rerankIndex,
      max_pool_index: Math.max(anchorIndex, counterpartIndex),
      sum_pool_index: anchorIndex + counterpartIndex,
    });
  }

  if (pairCandidates.length === 0) return null;
  pairCandidates.sort((left, right) => (
    left.max_pool_index - right.max_pool_index
    || left.sum_pool_index - right.sum_pool_index
    || left.rerank_index - right.rerank_index
  ));
  const chosen = pairCandidates[0];
  const selected = [chosen.anchor_id, chosen.counterpart_id];
  for (const id of original) {
    if (!selected.includes(id) && selected.length < Q5_FIXED_CANDIDATE_TOP_K) selected.push(id);
  }
  const displacedId = original.find(id => !selected.includes(id)) || null;
  if (!displacedId) throw fail("Q5_A6_DISPLACED_ID_MISSING");

  return Object.freeze({
    original_ids: Object.freeze(original),
    proposed_ids: Object.freeze(selected),
    anchor_id: chosen.anchor_id,
    counterpart_id: chosen.counterpart_id,
    displaced_id: displacedId,
  });
}

function scoreMap(packetCase) {
  return new Map(packetCase.candidates.map(row => [row.id, Number(row.rerank_score)]));
}

function proposalSignal(proposal, packetCase) {
  const scores = scoreMap(packetCase);
  const counterpartScore = scores.get(proposal.counterpart_id);
  const displacedScore = scores.get(proposal.displaced_id);
  if (!Number.isFinite(counterpartScore) || !Number.isFinite(displacedScore)) {
    throw fail("Q5_A6_SCORE_MISSING");
  }
  return Object.freeze({
    counterpart_score: counterpartScore,
    displaced_score: displacedScore,
    counterpart_to_displaced_ratio: displacedScore === 0
      ? Number.POSITIVE_INFINITY
      : counterpartScore / displacedScore,
    counterpart_minus_displaced_score: counterpartScore - displacedScore,
  });
}

function transition(before, after, field) {
  if (after[field] > before[field]) return "improved";
  if (after[field] < before[field]) return "regressed";
  return "unchanged";
}

function evaluateThreshold(rows, constraint, threshold) {
  const transitionsAny = { improved: 0, regressed: 0, unchanged: 0 };
  const transitionsAll = { improved: 0, regressed: 0, unchanged: 0 };
  let applied = 0;

  for (const row of rows) {
    const apply = row.signal[constraint] >= threshold;
    const after = apply ? row.proposed_score : row.product_score;
    if (apply) applied += 1;
    transitionsAny[transition(row.product_score, after, "recall_any_at_3")] += 1;
    transitionsAll[transition(row.product_score, after, "recall_all_at_3")] += 1;
  }

  return Object.freeze({
    threshold,
    applied_count: applied,
    paired_recall_any: Object.freeze(transitionsAny),
    paired_recall_all: Object.freeze(transitionsAll),
  });
}

function thresholdCandidates(rows, constraint) {
  const values = [...new Set(rows.map(row => row.signal[constraint]))].sort((a, b) => a - b);
  return Object.freeze([...values, Number.POSITIVE_INFINITY]);
}

function selectDevelopmentThreshold(rows, constraint) {
  const evaluated = thresholdCandidates(rows, constraint)
    .map(threshold => evaluateThreshold(rows, constraint, threshold))
    .filter(row => row.paired_recall_any.regressed === 0);

  if (evaluated.length === 0) throw fail("Q5_A6_NO_DEVELOPMENT_SAFE_THRESHOLD");

  evaluated.sort((left, right) => (
    right.paired_recall_all.improved - left.paired_recall_all.improved
    || left.paired_recall_all.regressed - right.paired_recall_all.regressed
    || right.threshold - left.threshold
    || left.applied_count - right.applied_count
  ));
  return Object.freeze({
    selected: evaluated[0],
    all_safe_thresholds: Object.freeze(evaluated),
  });
}

function anyThresholdWithSafeGain(rows, constraint) {
  return thresholdCandidates(rows, constraint)
    .map(threshold => evaluateThreshold(rows, constraint, threshold))
    .some(row => (
      row.paired_recall_any.regressed === 0
      && row.paired_recall_all.improved > 0
    ));
}

export function evaluateQ5MarginConstrainedSelectionV1({
  fixture,
  scorePacket,
} = {}) {
  if (!fixture || fixture.schema !== Q5_FIXED_CANDIDATE_FIXTURE_SCHEMA) {
    throw fail("Q5_A6_FIXTURE_SCHEMA_INVALID");
  }
  if (fixture.top_k !== Q5_FIXED_CANDIDATE_TOP_K) throw fail("Q5_A6_TOPK_DRIFT");
  validateQ5SelectionSignalPacketV1(scorePacket);
  if (scorePacket.fixture_sha256 !== fixture.fixture_sha256) {
    throw fail("Q5_A6_PACKET_FIXTURE_MISMATCH");
  }

  const packetByCaseArm = new Map(scorePacket.cases.map(row => [
    `${row.source_name}\0${row.case_id}\0${row.arm}`,
    row,
  ]));
  const rows = [];

  for (const source of fixture.sources || []) {
    const memoryMap = new Map((source.memories || []).map(row => [row.id, row]));
    for (const caseRow of source.cases || []) {
      for (const arm of ["baseline", "hint"]) {
        const proposal = complementarityProposal({
          caseRow,
          run: caseRow[arm],
          memoryMap,
        });
        if (!proposal) continue;

        const packetCase = packetByCaseArm.get(
          `${source.source_name}\0${caseRow.case_id}\0${arm}`,
        );
        if (!packetCase) throw fail("Q5_A6_PACKET_CASE_ARM_MISSING");
        const signal = proposalSignal(proposal, packetCase);
        const productScore = scoreSelection(caseRow.gold_evidence_ids, proposal.original_ids);
        const proposedScore = scoreSelection(caseRow.gold_evidence_ids, proposal.proposed_ids);

        rows.push(Object.freeze({
          source_name: source.source_name,
          case_id: caseRow.case_id,
          family: caseRow.family,
          arm,
          signal,
          product_score: productScore,
          proposed_score: proposedScore,
        }));
      }
    }
  }

  const developmentRows = rows.filter(row => row.source_name === "q4_c1b_development");
  const holdoutRows = rows.filter(row => row.source_name === "q4_c2_holdout");
  const constraints = {};

  for (const constraint of Q5_MARGIN_CONSTRAINTS) {
    const development = selectDevelopmentThreshold(developmentRows, constraint);
    const holdoutAtSelected = evaluateThreshold(
      holdoutRows,
      constraint,
      development.selected.threshold,
    );
    constraints[constraint] = Object.freeze({
      development_selected: development.selected,
      development_safe_threshold_count: development.all_safe_thresholds.length,
      holdout_at_development_threshold: holdoutAtSelected,
      holdout_any_safe_gain_threshold_exists: anyThresholdWithSafeGain(
        holdoutRows,
        constraint,
      ),
    });
  }

  const body = {
    schema: Q5_MARGIN_SWEEP_SCHEMA,
    fixture_sha256: fixture.fixture_sha256,
    score_packet_sha256: scorePacket.packet_sha256,
    top_k: Q5_FIXED_CANDIDATE_TOP_K,
    provider_requests: 0,
    model_training_runs: 0,
    development_source: "q4_c1b_development",
    holdout_source: "q4_c2_holdout",
    proposal_snapshot_count: rows.length,
    development_proposal_count: developmentRows.length,
    holdout_proposal_count: holdoutRows.length,
    constraints: Object.freeze(constraints),
  };

  return Object.freeze({
    ...body,
    result_sha256: sha256(JSON.stringify(body)),
  });
}
