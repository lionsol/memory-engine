import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildLocomoChunkMaterial,
  flattenChunkMaterial,
} from "../lib/benchmark/locomo-chunk-material.js";
import {
  Q5_B2_EXPECTED_B1_MANIFEST_SHA256,
  Q5_B2_PACKET_SCHEMA,
} from "../lib/benchmark/q5-b2-fixed-pool-score-capture-v1.js";
import {
  Q5_B3_ANALYSIS_PLAN_SCHEMA,
} from "../lib/benchmark/q5-b3-fixed-pool-analysis-plan-v1.js";
import {
  Q5_B3_DV_ANALYSIS_SCHEMA,
  analyzeQ5B3DevelopmentValidationV1,
} from "../lib/benchmark/q5-b3-development-validation-analysis-v1.js";

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function fixture() {
  const sample = {
    sample_id: "conv-b3-test",
    conversation: {
      session_1: [
        { speaker: "A", dia_id: "D1:1", text: "evidence one two" },
        { speaker: "B", dia_id: "D1:2", text: "second evidence" },
        { speaker: "C", dia_id: "D1:3", text: "third" },
      ],
    },
  };
  const texts = [
    "A: evidence one ",
    "two",
    "B: second evidence",
    "C: third",
  ];
  const chunkMarkdown = () => texts.map((text, index) => ({
    startLine: index < 2 ? 1 : (index === 2 ? 2 : 3),
    endLine: index < 2 ? 1 : (index === 2 ? 2 : 3),
    text,
    hash: sha256(text),
  }));
  const scoringMaterial = buildLocomoChunkMaterial({
    samples: [sample],
    chunkMarkdown,
    tokens: 10,
    overlap: 2,
    modelIdentity: {
      value: "q5-b3-test",
      kind: "experimental_offline_id_only",
      source: "focused_test",
      productionEquivalent: false,
    },
  });
  const byText = new Map(flattenChunkMaterial(scoringMaterial).map(row => [row.text, row.memoryId]));
  const candidates = texts.map(text => ({ id: byText.get(text), text }));
  const served = [
    byText.get("A: evidence one "),
    byText.get("B: second evidence"),
    byText.get("C: third"),
  ];
  const suffix = byText.get("two");
  const caseId = "conv-b3-test:qa:0";
  const sourceHash = Q5_B2_EXPECTED_B1_MANIFEST_SHA256;

  const material = {
    schema: "memory_engine_r3_c1a_locomo_material_v1",
    scoring_material: scoringMaterial,
    cases: [{
      case_id: caseId,
      sample_id: "conv-b3-test",
      qa_index: 0,
      query: "what was the evidence",
      candidates,
      control_top3: served,
      evidence_ids: ["D1:1"],
      category: 1,
    }],
  };

  const analysisPlan = {
    schema: Q5_B3_ANALYSIS_PLAN_SCHEMA,
    source_b1_manifest_sha256: sourceHash,
    plan_sha256: "b".repeat(64),
    rows: [{
      case_id: caseId,
      sample_id: "conv-b3-test",
      split: "development",
      selection_reason: "recoverable_rank_miss",
      diagnostic_stratum: "recoverable_rank_miss",
      gold_evidence_count: 1,
      gold_complete_in_top20: true,
      category: 1,
    }, {
      case_id: "sealed:qa:0",
      sample_id: "sealed",
      split: "final_evaluation",
      selection_reason: "unconditional_hash_sample",
      diagnostic_stratum: "protect",
      gold_evidence_count: 1,
      gold_complete_in_top20: true,
      category: 1,
    }],
  };

  const scoreRows = [
    { id: served[0], score: 0.9, rank: 1 },
    { id: suffix, score: 0.69, rank: 4 },
    { id: served[1], score: 0.8, rank: 2 },
    { id: served[2], score: 0.7, rank: 3 },
  ];
  const candidateById = new Map(candidates.map(row => [row.id, row]));
  const mainPacketCase = {
    case_id: caseId,
    sample_id: "conv-b3-test",
    split: "development",
    selection_reason: "recoverable_rank_miss",
    query_sha256: sha256("what was the evidence"),
    candidate_count: candidates.length,
    candidates: scoreRows.map((row, index) => ({
      id: row.id,
      pre_rerank_rank: index + 1,
      text_sha256: sha256(candidateById.get(row.id).text),
      original_code_points: candidateById.get(row.id).text.length,
      output_code_points: candidateById.get(row.id).text.length,
      truncated: false,
      rerank_score: row.score,
      rerank_rank: row.rank,
    })),
    rerank_order_ids: served.concat(suffix),
    served_top3_ids: served,
    adapter_identity: {
      provider: "siliconflow",
      model: "Qwen/Qwen3-Reranker-0.6B",
      revision: null,
    },
    usage: null,
  };
  const dummyCases = Array.from({ length: 511 }, (_, index) => {
    const id = `dummy-${index}`;
    const candidateId = `dummy-candidate-${index}`;
    return {
      case_id: id,
      sample_id: `dummy-sample-${index}`,
      split: "final_evaluation",
      selection_reason: "unconditional_hash_sample",
      query_sha256: sha256(`dummy-query-${index}`),
      candidate_count: 1,
      candidates: [{
        id: candidateId,
        pre_rerank_rank: 1,
        text_sha256: sha256(`dummy-text-${index}`),
        original_code_points: 10,
        output_code_points: 10,
        truncated: false,
        rerank_score: 0.5,
        rerank_rank: 1,
      }],
      rerank_order_ids: [candidateId],
      served_top3_ids: [candidateId],
      adapter_identity: {
        provider: "siliconflow",
        model: "Qwen/Qwen3-Reranker-0.6B",
        revision: null,
      },
      usage: null,
    };
  });
  const packetBody = {
    schema: Q5_B2_PACKET_SCHEMA,
    source_commit: "1".repeat(40),
    source_b1_manifest_sha256: sourceHash,
    provider: "siliconflow",
    model: "Qwen/Qwen3-Reranker-0.6B",
    revision: null,
    candidate_depth_max: 20,
    top_k: 3,
    contains_gold_fields: false,
    case_count: 512,
    cases: [mainPacketCase, ...dummyCases],
  };
  const b2Packet = {
    ...packetBody,
    packet_sha256: sha256(JSON.stringify(packetBody)),
  };

  return { analysisPlan, b2Packet, material, caseId };
}

test("B3 development/validation analysis keeps final sealed and diagnoses a one-swap rank miss", () => {
  const input = fixture();
  const result = analyzeQ5B3DevelopmentValidationV1(input);

  assert.equal(result.schema, Q5_B3_DV_ANALYSIS_SCHEMA);
  assert.equal(result.final_evaluation_consumed, false);
  assert.equal(result.provider_requests, 0);
  assert.equal(result.model_training_runs, 0);
  assert.equal(result.threshold_selection_performed, false);
  assert.equal(result.pair_set_algorithm_selected, false);
  assert.equal(result.statistical_ltr_selected, false);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].case_id, input.caseId);
  assert.equal(result.rows[0].split, "development");
  assert.equal(result.rows[0].pool_gold_complete, true);
  assert.equal(result.rows[0].top3_budget_feasible, true);
  assert.equal(result.rows[0].selection_failure, true);
  assert.equal(result.rows[0].rerank.recall_all_at_3, 0);
  assert.equal(result.rows[0].oracle.minimum_cover_size, 2);
  assert.equal(result.rows[0].oracle.minimum_completion_additions, 1);
  assert.equal(result.rows[0].single_swap.exists, true);
  assert.equal(result.rows[0].single_swap.best_candidate_rank, 4);
  assert.equal(result.rows[0].single_swap.redundant_displacement_exists, true);
  assert.equal(result.rows[0].single_swap.best_candidate_truncated, false);
  assert.equal(result.rows[0].projection.any_candidate_truncated, false);
  assert.equal(result.summaries.development.selection_failure_count, 1);
  assert.equal(result.summaries.development.pair_set_signal_diagnostics.single_swap_repairable_count, 1);
  assert.equal(
    result.summaries.development.pair_set_signal_diagnostics.redundant_displacement_repairable_count,
    1,
  );
  assert.equal(result.summaries.development.projection_diagnostics.any_candidate_truncated_case_count, 0);
  assert.equal(result.summaries.validation.case_count, 0);
});

test("B3 analysis fails closed when the B2 canonical text binding drifts", () => {
  const input = fixture();
  input.b2Packet.cases[0].candidates[0].text_sha256 = "0".repeat(64);
  const { packet_sha256: _oldSha, ...packetBody } = input.b2Packet;
  input.b2Packet.packet_sha256 = sha256(JSON.stringify(packetBody));
  assert.throws(
    () => analyzeQ5B3DevelopmentValidationV1(input),
    error => error?.code === "Q5_B3_CANDIDATE_TEXT_HASH_DRIFT",
  );
});
