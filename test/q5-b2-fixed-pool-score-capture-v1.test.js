import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { R3_C1_B_PROVIDER_PROFILE } from "../lib/recall/hybrid/explicit-search-rerank-provider-policy.js";
import {
  Q5_B2_EXPECTED_B1_MANIFEST_SHA256,
  Q5_B2_RETRY_POLICY,
  buildQ5B2PreflightV1,
  runQ5B2ScoreCaptureV1,
  validateQ5B2PacketV1,
} from "../lib/benchmark/q5-b2-fixed-pool-score-capture-v1.js";

const SOURCE = "a".repeat(40);

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function sha256Json(value) {
  return sha256(JSON.stringify(value));
}

function syntheticCase(index) {
  const caseId = `case-${String(index).padStart(4, "0")}`;
  const sampleId = `sample-${index % 10}`;
  const query = `question ${index}`;
  const candidates = Array.from({ length: 3 }, (_value, candidateIndex) => ({
    id: `${caseId}-candidate-${candidateIndex}`,
    text: `candidate ${index} text ${candidateIndex}`,
    egress: "UNKNOWN",
  }));
  return {
    case_id: caseId,
    sample_id: sampleId,
    qa_index: index,
    query,
    query_egress: "UNKNOWN",
    candidates,
    control_order: candidates.map(row => row.id),
    control_top3: candidates.map(row => row.id),
    control_recall_all_at_3: index % 2,
    gold_evidence_count: 1,
    gold_complete_in_top20: true,
    evidence_ids: ["D1:1"],
    category: 1,
    projection: {
      total_code_points: candidates.reduce((sum, row) => sum + Array.from(row.text).length, 0),
      candidate_count: candidates.length,
    },
  };
}

function syntheticMaterial() {
  return {
    schema: "memory_engine_r3_c1a_locomo_material_v1",
    source_profile: "q3_locomo_chunk_fts_only_v1",
    evidence_limitations: {
      candidate_generation: "frozen_fts_only_not_production_hybrid",
      candidate_depth: 20,
      production_equivalent_candidate_generation: false,
      canonical_text_projection: true,
    },
    profile: {
      candidateDepth: 20,
      topK: 3,
      maxCodePointsPerCandidate: 4000,
      maxTotalCodePoints: 48000,
      deadlineMs: 5000,
    },
    cases: Array.from({ length: 1970 }, (_value, index) => syntheticCase(index)),
  };
}

function syntheticManifest(material) {
  const rows = material.cases.slice(0, 512).map((row, index) => {
    const split = index < 256
      ? "development"
      : (index < 384 ? "validation" : "final_evaluation");
    return {
      case_id: row.case_id,
      sample_id: row.sample_id,
      split,
      selection_reason: split === "final_evaluation"
        ? "unconditional_hash_sample"
        : (index % 2 === 0 ? "recoverable_rank_miss" : "protect"),
      query_sha256: sha256(row.query),
      candidate_count: row.candidates.length,
      ordered_candidate_ids_sha256: sha256Json(row.candidates.map(candidate => candidate.id)),
      canonical_texts_sha256: sha256Json(row.candidates.map(candidate => candidate.text)),
      control_top3_sha256: sha256Json(row.control_top3),
    };
  });
  return {
    schema: "memory_engine_q5_b1_fixed_pool_score_capture_manifest_v1",
    source_b0_manifest_sha256:
      "f9262cd548c8a145da32da20f46a53872cab0310661d5b3a3055f5925ca9afe0",
    source_profile: "q3_locomo_chunk_fts_only_v1",
    source_candidate_generation: "frozen_fts_only_not_production_hybrid",
    production_equivalent_candidate_generation: false,
    provider: R3_C1_B_PROVIDER_PROFILE.adapterIdentity.provider,
    model: R3_C1_B_PROVIDER_PROFILE.adapterIdentity.model,
    revision: R3_C1_B_PROVIDER_PROFILE.adapterIdentity.revision,
    candidate_depth_max: 20,
    top_k: 3,
    provider_execution_authorized: false,
    provider_requests: 0,
    model_training_runs: 0,
    selection_policy: {},
    population: {
      selected_case_count: 512,
      split_counts: { development: 256, validation: 128, final_evaluation: 128 },
    },
    cases: rows,
    manifest_sha256: Q5_B2_EXPECTED_B1_MANIFEST_SHA256,
  };
}

function fakeAdapterFactory({ model }) {
  assert.equal(model, R3_C1_B_PROVIDER_PROFILE.adapterIdentity.model);
  const adapter = async (_query, documents) => ({
    scores: documents.map((_text, index) => ({
      index,
      score: 1 - index / 10,
    })),
    usage: {
      input_tokens: documents.length * 10,
      output_tokens: null,
      total_tokens: documents.length * 10,
      billed_input_tokens: documents.length * 10,
      billed_output_tokens: null,
    },
  });
  Object.defineProperty(adapter, "adapterIdentity", {
    value: R3_C1_B_PROVIDER_PROFILE.adapterIdentity,
    enumerable: true,
  });
  return adapter;
}

test("Q5-B2 preflight binds exactly 512 cases and remains zero-egress", () => {
  const material = syntheticMaterial();
  const manifest = syntheticManifest(material);
  const preflight = buildQ5B2PreflightV1({
    manifest,
    material,
    sourceCommit: SOURCE,
    env: { SILICONFLOW_API_KEY: "sk-test-only" },
  });

  assert.equal(preflight.status, "PASS");
  assert.equal(preflight.mode, "PREFLIGHT_ONLY");
  assert.equal(preflight.planned_provider_calls, 512);
  assert.equal(preflight.provider_attempt_cap, 512);
  assert.deepEqual(preflight.split_counts, {
    development: 256,
    validation: 128,
    final_evaluation: 128,
  });
  assert.equal(preflight.candidate_count_total, 1536);
  assert.equal(preflight.estimated_input_tokens_upper_bound > 0, true);
  assert.equal(preflight.credential_available, true);
  assert.equal(preflight.deadline_ms, 5000);
  assert.equal(preflight.retry_policy, Q5_B2_RETRY_POLICY);
  assert.equal(preflight.embedding_calls, 0);
  assert.equal(preflight.candidate_generation_runs, 0);
  assert.equal(preflight.hint_producer_calls, 0);
  assert.equal(preflight.model_training_runs, 0);
  assert.equal(preflight.runtime_mutation, false);
});

test("Q5-B2 fake capture performs exactly 512 reranks and emits a bounded valid packet", async () => {
  const material = syntheticMaterial();
  const manifest = syntheticManifest(material);
  let attempts = 0;
  const result = await runQ5B2ScoreCaptureV1({
    manifest,
    material,
    sourceCommit: SOURCE,
    env: { SILICONFLOW_API_KEY: "sk-test-only" },
    adapterFactory: fakeAdapterFactory,
    onProviderAttempt: ({ attempt }) => {
      attempts = attempt;
    },
  });

  assert.equal(attempts, 512);
  assert.equal(result.provider_attempts, 512);
  assert.equal(result.provider_successes, 512);
  assert.equal(result.retry_policy, "NO_RETRY_NO_RESUME_NO_REPLAY");
  assert.equal(result.packet.case_count, 512);
  assert.equal(validateQ5B2PacketV1(result.packet).valid, true);
  assert.equal(result.packet.cases.every(row => row.candidate_count === 3), true);
  assert.equal(result.packet.cases.every(row => (
    row.candidates.every(candidate => Number.isFinite(candidate.rerank_score))
  )), true);
  assert.equal(result.provider_usage.input_tokens > 0, true);

  const serialized = JSON.stringify(result.packet);
  assert.equal(serialized.includes('"query":'), false);
  assert.equal(serialized.includes('"text":'), false);
  assert.equal(serialized.includes("gold_evidence_ids"), false);
  assert.equal(serialized.includes("diagnostic_stratum"), false);
});

test("Q5-B2 stops on the first failed provider call and does not retry", async () => {
  const material = syntheticMaterial();
  const manifest = syntheticManifest(material);
  let calls = 0;
  const adapterFactory = () => {
    const adapter = async (_query, documents) => {
      calls += 1;
      if (calls === 7) {
        throw Object.assign(new Error("synthetic provider failure"), {
          code: "SYNTHETIC_PROVIDER_FAILURE",
        });
      }
      return {
        scores: documents.map((_text, index) => ({ index, score: 1 - index / 10 })),
        usage: null,
      };
    };
    Object.defineProperty(adapter, "adapterIdentity", {
      value: R3_C1_B_PROVIDER_PROFILE.adapterIdentity,
      enumerable: true,
    });
    return adapter;
  };

  await assert.rejects(
    () => runQ5B2ScoreCaptureV1({
      manifest,
      material,
      sourceCommit: SOURCE,
      env: { SILICONFLOW_API_KEY: "sk-test-only" },
      adapterFactory,
    }),
    /Q5_B2_RERANK_RESULT_NOT_COMPLETE|SYNTHETIC_PROVIDER_FAILURE/,
  );
  assert.equal(calls, 7);
});

test("Q5-B2 rejects material/hash drift before creating the provider adapter", async () => {
  const material = syntheticMaterial();
  const manifest = syntheticManifest(material);
  manifest.cases[0].query_sha256 = "f".repeat(64);
  let factoryCalls = 0;

  await assert.rejects(
    () => runQ5B2ScoreCaptureV1({
      manifest,
      material,
      sourceCommit: SOURCE,
      env: { SILICONFLOW_API_KEY: "sk-test-only" },
      adapterFactory: args => {
        factoryCalls += 1;
        return fakeAdapterFactory(args);
      },
    }),
    /Q5_B2_QUERY_HASH_DRIFT/,
  );
  assert.equal(factoryCalls, 0);
});
