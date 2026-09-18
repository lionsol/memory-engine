import test from "node:test";
import assert from "node:assert/strict";

import { rerankCanonicalMemories } from "../lib/recall/rerank/canonical-rerank-orchestrator.js";
import { R3_C1_B_PROVIDER_PROFILE } from "../lib/recall/hybrid/explicit-search-rerank-provider-policy.js";
import {
  buildQ5SelectionSignalCaptureCaseV1,
  buildQ5SelectionSignalPacketV1,
  validateQ5SelectionSignalPacketV1,
} from "../lib/benchmark/q5-selection-signal-contract-v1.js";

const SOURCE = "a".repeat(40);
const FIXTURE = "b".repeat(64);

function memories() {
  return [
    ["cand-a", "AlphaProject rationale text"],
    ["cand-b", "AlphaProject limitation text"],
    ["cand-c", "BetaProject rationale text"],
    ["cand-d", "GammaProject note text"],
  ].map(([id, text]) => ({
    memory_id: id,
    source: {
      record_type: "chunk",
      record_id: id,
      text,
    },
  }));
}

function fakeAdapter(usage = {
  prompt_tokens: 120,
  completion_tokens: 0,
  total_tokens: 120,
}) {
  const adapter = async (_query, documents) => ({
    scores: documents.map((_text, index) => ({
      index,
      score: [0.4, 0.9, 0.2, 0.8][index],
    })),
    usage,
  });
  Object.defineProperty(adapter, "adapterIdentity", {
    value: R3_C1_B_PROVIDER_PROFILE.adapterIdentity,
    enumerable: true,
  });
  return adapter;
}

async function validCase(usage = undefined) {
  const sourceMemories = memories();
  const reranked = await rerankCanonicalMemories({
    query: "Why that design and what limitation remained?",
    memories: sourceMemories,
    maxCodePointsPerCandidate: R3_C1_B_PROVIDER_PROFILE.maxCodePointsPerCandidate,
    maxTotalCodePoints: R3_C1_B_PROVIDER_PROFILE.maxTotalCodePoints,
    deadlineMs: R3_C1_B_PROVIDER_PROFILE.deadlineMs,
    adapter: fakeAdapter(usage),
  });

  return buildQ5SelectionSignalCaptureCaseV1({
    sourceName: "q5_fake_source",
    caseId: "q5-case-01",
    arm: "hint",
    query: "Why that design and what limitation remained?",
    preRerankCandidates: sourceMemories.map(memory => ({
      id: memory.memory_id,
      text: memory.source.text,
    })),
    projectionMetadata: reranked.projectionMetadata,
    rerankResult: reranked,
  });
}

test("Q5-A3 capture is constructible from the current canonical rerank path and preserves complete score/order signals", async () => {
  const capture = await validCase();

  assert.deepEqual(capture.rerank_order_ids, [
    "cand-b",
    "cand-d",
    "cand-a",
    "cand-c",
  ]);
  assert.deepEqual(capture.served_top3_ids, ["cand-b", "cand-d", "cand-a"]);
  assert.deepEqual(
    capture.candidates.map(row => ({
      id: row.id,
      pre: row.pre_rerank_rank,
      score: row.rerank_score,
      rerank: row.rerank_rank,
      truncated: row.truncated,
    })),
    [
      { id: "cand-a", pre: 1, score: 0.4, rerank: 3, truncated: false },
      { id: "cand-b", pre: 2, score: 0.9, rerank: 1, truncated: false },
      { id: "cand-c", pre: 3, score: 0.2, rerank: 4, truncated: false },
      { id: "cand-d", pre: 4, score: 0.8, rerank: 2, truncated: false },
    ],
  );
  assert.equal(capture.adapter_identity.provider, R3_C1_B_PROVIDER_PROFILE.adapterIdentity.provider);
  assert.equal(capture.adapter_identity.model, R3_C1_B_PROVIDER_PROFILE.adapterIdentity.model);

  const serialized = JSON.stringify(capture);
  assert.equal(serialized.includes("Why that design"), false);
  assert.equal(serialized.includes("AlphaProject"), false);
  assert.equal(serialized.includes("BetaProject"), false);
  assert.match(capture.query_sha256, /^[0-9a-f]{64}$/);
  assert.equal(capture.candidates.every(row => /^[0-9a-f]{64}$/.test(row.text_sha256)), true);
});

test("Q5-A3 packet freezes topK/candidate depth and validates a complete capture without gold fields", async () => {
  const capture = await validCase();
  const packet = buildQ5SelectionSignalPacketV1({
    sourceCommit: SOURCE,
    fixtureSha256: FIXTURE,
    cases: [capture],
  });
  const validation = validateQ5SelectionSignalPacketV1(packet);

  assert.equal(packet.top_k, 3);
  assert.equal(packet.candidate_depth, 20);
  assert.equal(packet.contains_gold_fields, false);
  assert.equal(validation.valid, true);
  assert.equal(validation.case_count, 1);
  assert.equal(validation.packet_sha256, packet.packet_sha256);
  assert.match(packet.packet_sha256, /^[0-9a-f]{64}$/);
});

test("Q5-A3 fails closed on score/order/model drift and forbidden evaluator fields", async () => {
  const capture = await validCase();

  const missingScore = structuredClone(capture);
  delete missingScore.candidates[0].rerank_score;
  const packetMissingScore = {
    schema: "memory_engine_q5_selection_signal_capture_v1",
    profile: "q5_a3_fixed_pool_rerank_signal_capture_v1",
    source_commit: SOURCE,
    fixture_sha256: FIXTURE,
    top_k: 3,
    candidate_depth: 20,
    contains_gold_fields: false,
    cases: [missingScore],
    packet_sha256: "0".repeat(64),
  };
  assert.throws(
    () => validateQ5SelectionSignalPacketV1(packetMissingScore),
    /Q5_A3_PACKET_SCORE_INVALID/,
  );

  const rankMismatch = structuredClone(capture);
  rankMismatch.candidates[0].rerank_rank = 1;
  assert.throws(
    () => buildQ5SelectionSignalPacketV1({
      sourceCommit: SOURCE,
      fixtureSha256: FIXTURE,
      cases: [rankMismatch],
    }),
    /Q5_A3_PACKET_RERANK_ORDER_RANK_MISMATCH/,
  );

  const modelDrift = structuredClone(capture);
  modelDrift.adapter_identity.model = "other-model";
  assert.throws(
    () => buildQ5SelectionSignalPacketV1({
      sourceCommit: SOURCE,
      fixtureSha256: FIXTURE,
      cases: [modelDrift],
    }),
    /Q5_A3_ADAPTER_IDENTITY_DRIFT/,
  );

  const forbidden = structuredClone(capture);
  forbidden.gold_evidence_ids = ["cand-b"];
  assert.throws(
    () => buildQ5SelectionSignalPacketV1({
      sourceCommit: SOURCE,
      fixtureSha256: FIXTURE,
      cases: [forbidden],
    }),
    /Q5_A3_FORBIDDEN_FIELD/,
  );
});

test("Q5-A3 accepts the real SiliconFlow bounded usage schema and omits null counters", async () => {
  const capture = await validCase({
    input_tokens: 321,
    output_tokens: null,
    total_tokens: 321,
    billed_input_tokens: null,
    billed_output_tokens: null,
  });

  const packet = buildQ5SelectionSignalPacketV1({
    sourceCommit: SOURCE,
    fixtureSha256: FIXTURE,
    cases: [capture],
  });

  assert.deepEqual(packet.cases[0].usage, {
    input_tokens: 321,
    total_tokens: 321,
  });
});

test("Q5-A3 packet hash drift is rejected independently of semantic validation", async () => {
  const capture = await validCase();
  const packet = buildQ5SelectionSignalPacketV1({
    sourceCommit: SOURCE,
    fixtureSha256: FIXTURE,
    cases: [capture],
  });
  const drifted = structuredClone(packet);
  drifted.packet_sha256 = "f".repeat(64);

  assert.throws(
    () => validateQ5SelectionSignalPacketV1(drifted),
    /Q5_A3_PACKET_HASH_MISMATCH/,
  );
});
