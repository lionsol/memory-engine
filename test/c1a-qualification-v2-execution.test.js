import assert from "node:assert/strict";
import test from "node:test";

import { buildC1AQualificationManifest } from "../lib/benchmark/c1a-qualification-manifest.js";
import {
  buildC1AV2QualificationManifest,
  C1A_V2_ACCEPTANCE_THRESHOLDS,
} from "../lib/benchmark/c1a-qualification-v2-contract.js";
import { runC1AV2QualificationBatch } from "../lib/benchmark/c1a-qualification-v2-batch.js";
import {
  C1A_V2_EGRESS_SCOPE,
  C1A_V2_EXECUTION_PACKET_SCHEMA,
  C1A_V2_MAX_PROVIDER_REQUESTS,
  validateC1AV2ExecutionPacket,
} from "../lib/benchmark/c1a-qualification-v2-execution-packet.js";
import { executeC1AV2LocomoQualification } from "../lib/benchmark/c1a-qualification-v2-execution.js";
import { createC1AExecutionBudget } from "../lib/benchmark/c1a-qualification-runner.js";

const sourceCommit = "a".repeat(40);
const executionRoot = "/tmp/memory-engine-c1a-v2";

function makeCase(caseId, { control = 0, evidenceCount = 2, complete = true, category = 2 } = {}) {
  const candidates = [
    { id: `${caseId}-a`, text: `alpha-${caseId}`, egress: "ALLOW" },
    { id: `${caseId}-b`, text: `beta-${caseId}`, egress: "ALLOW" },
    { id: `${caseId}-c`, text: `gamma-${caseId}`, egress: "ALLOW" },
  ];
  return {
    case_id: caseId,
    query: `query-${caseId}`,
    query_egress: "ALLOW",
    candidates,
    control_order: candidates.map(item => item.id),
    control_top3: candidates.map(item => item.id),
    control_recall_all_at_3: control,
    gold_evidence_count: evidenceCount,
    gold_complete_in_top20: complete,
    category,
  };
}

function makePopulation() {
  return [
    ...Array.from({ length: 250 }, (_, i) => makeCase(`p-${i}`, { control: 1, category: i % 5 === 0 ? 5 : 2 })),
    ...Array.from({ length: 250 }, (_, i) => makeCase(`r-${i}`, { complete: true, category: 2 })),
    ...Array.from({ length: 250 }, (_, i) => makeCase(`m-${i}`, { complete: false, category: 4 })),
    ...Array.from({ length: 250 }, (_, i) => makeCase(`b-${i}`, { evidenceCount: 4, category: 3 })),
  ];
}

function providerProfile() {
  return {
    candidateDepth: 20,
    topK: 3,
    maxCodePointsPerCandidate: 4000,
    maxTotalCodePoints: 48000,
    deadlineMs: 5000,
    provider: {
      provider: "siliconflow",
      model: "Qwen/Qwen3-Reranker-0.6B",
      endpoint: "https://api.siliconflow.cn/v1/rerank",
      revision: null,
    },
    token_preflight: {
      counter_id: "qwen3_utf8_byte_token_upper_bound_v1",
      maxQueryTokens: 4096,
      maxDocumentTokens: 8192,
      maxPairTokens: 12288,
      specialTokenReservePerPair: 256,
    },
    acceptance_thresholds: { ...C1A_V2_ACCEPTANCE_THRESHOLDS },
  };
}

function buildFixture() {
  const cases = makePopulation();
  const eligibilityByCase = Object.fromEntries(cases.map(item => [item.case_id, true]));
  const observedManifest = buildC1AQualificationManifest({
    cases,
    eligibilityByCase,
    expectedSourceCaseCount: cases.length,
    primaryCount: 256,
    diagnosticQuotas: {
      protect: 20,
      recoverable_rank_miss: 20,
      candidate_miss: 12,
      top3_budget_infeasible: 12,
    },
    sentinelCount: 8,
    profile: { candidateDepth: 20, topK: 3 },
    sourceIdentity: { synthetic: true },
  });
  const manifest = buildC1AV2QualificationManifest({
    cases,
    eligibilityByCase,
    observedManifest,
    expectedSourceCaseCount: cases.length,
    profile: providerProfile(),
    sourceIdentity: {
      qualification_source: { source_commit: sourceCommit, worktree_clean: true },
      egress_decision: "ALLOW",
    },
  });
  return { cases, observedManifest, manifest };
}

function packet(manifest, overrides = {}) {
  return {
    schema: C1A_V2_EXECUTION_PACKET_SCHEMA,
    source_commit: sourceCommit,
    manifest_sha256: manifest.manifest_sha256,
    prior_observed_manifest_sha256: manifest.prior_observed_manifest_sha256,
    provider: "siliconflow",
    model: "Qwen/Qwen3-Reranker-0.6B",
    endpoint: "https://api.siliconflow.cn/v1/rerank",
    egress: {
      query: "ALLOW",
      canonical_text: "ALLOW",
      scope: C1A_V2_EGRESS_SCOPE,
    },
    max_provider_requests: C1A_V2_MAX_PROVIDER_REQUESTS,
    max_input_tokens: 6_000_000,
    max_cost_usd: 1,
    input_price_usd_per_million: 0.01,
    deadline_ms: 5000,
    execution_count: 1,
    pacing: {
      min_interval_ms: 1000,
      token_window_ms: 60_000,
      max_estimated_tokens_per_window: 400_000,
    },
    rate_limits: { confirmed: true, source: "synthetic-frozen-rate-limit" },
    api_key_env: "SILICONFLOW_API_KEY",
    execution_root: executionRoot,
    ...overrides,
  };
}

function fakeAdapter() {
  return async (_query, texts) => ({
    scores: texts.map((_text, index) => ({ index, score: texts.length - index })),
    adapterIdentity: { provider: "siliconflow", model: "Qwen/Qwen3-Reranker-0.6B", revision: null },
    usage: { input_tokens: 3 },
  });
}

test("C1-A v2 packet binds the exact disjoint manifest, 0.6B model and 336-request envelope", () => {
  const { manifest } = buildFixture();
  const binding = validateC1AV2ExecutionPacket({
    packet: packet(manifest),
    manifest,
    sourceCommit,
    worktreeClean: true,
    executionRoot,
  });
  assert.equal(binding.model, "Qwen/Qwen3-Reranker-0.6B");
  assert.equal(binding.max_provider_requests, 336);
  assert.equal(binding.prior_observed_manifest_sha256, manifest.prior_observed_manifest_sha256);

  assert.throws(
    () => validateC1AV2ExecutionPacket({
      packet: packet(manifest, { model: "Qwen/Qwen3-Reranker-8B" }),
      manifest,
      sourceCommit,
      worktreeClean: true,
    }),
    /C1A_V2_EXECUTION_PROVIDER_BINDING_MISMATCH/,
  );
  assert.throws(
    () => validateC1AV2ExecutionPacket({
      packet: packet(manifest, { max_provider_requests: 328 }),
      manifest,
      sourceCommit,
      worktreeClean: true,
    }),
    /C1A_V2_EXECUTION_REQUEST_CAP_MISMATCH/,
  );

  const tampered = structuredClone(manifest);
  tampered.primary[0].case_id = "tampered-case";
  assert.throws(
    () => validateC1AV2ExecutionPacket({
      packet: packet(manifest),
      manifest: tampered,
      sourceCommit,
      worktreeClean: true,
    }),
    /C1A_V2_EXECUTION_MANIFEST_HASH_MISMATCH/,
  );
});

test("C1-A v2 batch executes exactly H256 + D64 + S16 with bounded evidence", async () => {
  const { cases, manifest } = buildFixture();
  let adapterCalls = 0;
  let pacerCalls = 0;
  const adapter = fakeAdapter();
  const result = await runC1AV2QualificationBatch({
    manifest,
    cases,
    adapter: async (...args) => {
      adapterCalls += 1;
      return adapter(...args);
    },
    budget: createC1AExecutionBudget({
      maxRequests: 336,
      maxInputTokens: 6_000_000,
      maxCostUsd: 1,
      inputPriceUsdPerMillion: 0.01,
    }),
    deadlineMs: 5000,
    pacer: async () => { pacerCalls += 1; },
  });

  assert.equal(result.main_evidence.length, 320);
  assert.equal(result.sentinel_evidence.length, 16);
  assert.equal(adapterCalls, 336);
  assert.equal(pacerCalls, 336);
  assert.equal(result.budget.requests, 336);
  assert.equal(result.prior_observed_manifest_sha256, manifest.prior_observed_manifest_sha256);
  assert.doesNotMatch(JSON.stringify(result), /query-p-|alpha-p-|beta-p-|gamma-p-/);
});

test("C1-A v2 execution uses the 336 budget and the v2 scorer seam", async () => {
  const { cases, manifest } = buildFixture();
  const expectedRows = { primaryRows: [], diagnosticRows: [], sentinelRows: [], executionSummary: {} };
  let scorerCalls = 0;
  const result = await executeC1AV2LocomoQualification({
    packet: packet(manifest),
    manifest,
    material: { cases },
    sourceCommit,
    worktreeClean: true,
    adapter: fakeAdapter(),
    pacer: async () => {},
    scoreRowsBuilder: ({ batch }) => {
      assert.equal(batch.main_evidence.length, 320);
      assert.equal(batch.sentinel_evidence.length, 16);
      return expectedRows;
    },
    scoreQualification: rows => {
      scorerCalls += 1;
      assert.equal(rows, expectedRows);
      return { schema: "synthetic-v2-score", pass: true };
    },
  });

  assert.equal(scorerCalls, 1);
  assert.equal(result.schema, "memory_engine_r3_c1a_execution_result_v2");
  assert.equal(result.binding.max_provider_requests, 336);
  assert.equal(result.batch.budget.requests, 336);
  assert.equal(result.score.pass, true);
});
