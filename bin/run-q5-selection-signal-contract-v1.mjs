#!/usr/bin/env node

import { rerankCanonicalMemories } from "../lib/recall/rerank/canonical-rerank-orchestrator.js";
import { R3_C1_B_PROVIDER_PROFILE } from "../lib/recall/hybrid/explicit-search-rerank-provider-policy.js";
import {
  buildQ5SelectionSignalCaptureCaseV1,
  buildQ5SelectionSignalPacketV1,
  validateQ5SelectionSignalPacketV1,
} from "../lib/benchmark/q5-selection-signal-contract-v1.js";

const SOURCE = "c".repeat(40);
const FIXTURE = "d".repeat(64);

function qualificationMemories() {
  return [
    ["q5-signal-a", "ProjectA rationale text"],
    ["q5-signal-b", "ProjectA limitation text"],
    ["q5-signal-c", "ProjectB rationale text"],
    ["q5-signal-d", "ProjectC note text"],
  ].map(([id, text]) => ({
    memory_id: id,
    source: { record_type: "chunk", record_id: id, text },
  }));
}

function qualificationAdapter() {
  const adapter = async (_query, documents) => ({
    scores: documents.map((_text, index) => ({
      index,
      score: [0.55, 0.91, 0.31, 0.72][index],
    })),
    usage: { prompt_tokens: 96, completion_tokens: 0, total_tokens: 96 },
  });
  Object.defineProperty(adapter, "adapterIdentity", {
    value: R3_C1_B_PROVIDER_PROFILE.adapterIdentity,
    enumerable: true,
  });
  return adapter;
}

export async function main() {
  const sourceMemories = qualificationMemories();
  const reranked = await rerankCanonicalMemories({
    query: "Why that design and what limitation remained?",
    memories: sourceMemories,
    maxCodePointsPerCandidate: R3_C1_B_PROVIDER_PROFILE.maxCodePointsPerCandidate,
    maxTotalCodePoints: R3_C1_B_PROVIDER_PROFILE.maxTotalCodePoints,
    deadlineMs: R3_C1_B_PROVIDER_PROFILE.deadlineMs,
    adapter: qualificationAdapter(),
  });
  const capture = buildQ5SelectionSignalCaptureCaseV1({
    sourceName: "q5_a3_qualification",
    caseId: "q5-a3-fake-01",
    arm: "hint",
    query: "Why that design and what limitation remained?",
    preRerankCandidates: sourceMemories.map(memory => ({
      id: memory.memory_id,
      text: memory.source.text,
    })),
    projectionMetadata: reranked.projectionMetadata,
    rerankResult: reranked,
  });
  const packet = buildQ5SelectionSignalPacketV1({
    sourceCommit: SOURCE,
    fixtureSha256: FIXTURE,
    cases: [capture],
  });
  const validation = validateQ5SelectionSignalPacketV1(packet);
  return Object.freeze({
    status: "PASS",
    mode: "Q5_A3_SELECTION_SIGNAL_CONTRACT_SOURCE_QUALIFICATION",
    provider_requests: 0,
    model_training_runs: 0,
    packet_sha256: packet.packet_sha256,
    case_count: validation.case_count,
    candidate_count: capture.candidate_count,
    rerank_order_ids: capture.rerank_order_ids,
    served_top3_ids: capture.served_top3_ids,
    adapter_identity: capture.adapter_identity,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch(error => {
      process.stderr.write(`${JSON.stringify({
        status: "FAIL",
        code: error?.code || "Q5_A3_QUALIFICATION_FAILED",
        message: String(error?.message || error),
      }, null, 2)}\n`);
      process.exitCode = 1;
    });
}
