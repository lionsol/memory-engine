import assert from "node:assert/strict";
import test from "node:test";

import { buildC1AQualificationManifest } from "../lib/benchmark/c1a-qualification-manifest.js";
import { runC1AQualificationBatch } from "../lib/benchmark/c1a-qualification-batch.js";
import { createC1AExecutionBudget } from "../lib/benchmark/c1a-qualification-runner.js";

function makeCase(caseId, { control = 0, evidenceCount = 2, complete = true } = {}) {
  return {
    case_id: caseId,
    query: `query-${caseId}`,
    candidates: [
      { id: `${caseId}-a`, text: `alpha-${caseId}`, egress: "ALLOW" },
      { id: `${caseId}-b`, text: `beta-${caseId}`, egress: "ALLOW" },
    ],
    control_order: [`${caseId}-a`, `${caseId}-b`],
    query_egress: "ALLOW",
    control_recall_all_at_3: control,
    gold_evidence_count: evidenceCount,
    gold_complete_in_top20: complete,
  };
}

function makePopulation() {
  return [
    ...Array.from({ length: 6 }, (_, i) => makeCase(`p-${i}`, { control: 1 })),
    ...Array.from({ length: 6 }, (_, i) => makeCase(`r-${i}`, { complete: true })),
    ...Array.from({ length: 6 }, (_, i) => makeCase(`m-${i}`, { complete: false })),
    ...Array.from({ length: 6 }, (_, i) => makeCase(`b-${i}`, { evidenceCount: 4 })),
  ];
}

function buildSmallManifest(cases) {
  return buildC1AQualificationManifest({
    cases,
    eligibilityByCase: Object.fromEntries(cases.map(item => [item.case_id, true])),
    expectedSourceCaseCount: cases.length,
    primaryCount: 4,
    diagnosticQuotas: {
      protect: 1,
      recoverable_rank_miss: 1,
      candidate_miss: 1,
      top3_budget_infeasible: 1,
    },
    sentinelCount: 2,
    minimumPrimaryEligibilityRatio: 0.95,
    profile: { candidateDepth: 20, topK: 3 },
    sourceIdentity: "synthetic-test",
  });
}

test("C1-A batch executes exactly frozen main cases plus sentinel repeats with bounded evidence", async () => {
  const cases = makePopulation();
  const manifest = buildSmallManifest(cases);
  let adapterCalls = 0;
  let pacerCalls = 0;
  const persisted = [];
  const adapter = async (_query, texts) => {
    adapterCalls += 1;
    return {
      scores: texts.map((_text, index) => ({ index, score: texts.length - index })),
      adapterIdentity: { provider: "siliconflow", model: "Qwen/Qwen3-Reranker-8B", revision: null },
      usage: { input_tokens: 3 },
    };
  };

  const result = await runC1AQualificationBatch({
    manifest,
    cases,
    adapter,
    budget: createC1AExecutionBudget({ maxRequests: 10, maxInputTokens: 10_000 }),
    pacer: async () => { pacerCalls += 1; },
    onEvidence: async event => { persisted.push(event); },
  });

  assert.equal(result.main_evidence.length, 8);
  assert.equal(result.sentinel_evidence.length, 2);
  assert.equal(adapterCalls, 10);
  assert.equal(pacerCalls, 10);
  assert.equal(result.budget.requests, 10);
  assert.equal(persisted.length, 10);
  assert.equal(result.execution_summary.automatic_retry_count, 0);
  assert.equal(result.execution_summary.unauthorized_transmission_count, 0);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /query-p-|alpha-p-|beta-p-/);
});

test("C1-A batch detects frozen material drift before any adapter call", async () => {
  const cases = makePopulation();
  const manifest = buildSmallManifest(cases);
  const changed = structuredClone(cases);
  const selectedId = manifest.primary[0].case_id;
  changed.find(item => item.case_id === selectedId).query += "-mutated";
  let adapterCalls = 0;
  let pacerCalls = 0;

  await assert.rejects(
    () => runC1AQualificationBatch({
      manifest,
      cases: changed,
      adapter: async () => { adapterCalls += 1; return { scores: [] }; },
      budget: createC1AExecutionBudget({ maxRequests: 10, maxInputTokens: 10_000 }),
      pacer: async () => { pacerCalls += 1; },
    }),
    /C1A_CASE_MATERIAL_IDENTITY_MISMATCH/,
  );
  assert.equal(adapterCalls, 0);
  assert.equal(pacerCalls, 0);
});

test("C1-A batch recomputes eligibility and stops before provider calls on frozen-threshold loss", async () => {
  const cases = makePopulation();
  const manifest = buildSmallManifest(cases);
  const changed = structuredClone(cases);
  for (const row of manifest.primary) {
    const material = changed.find(item => item.case_id === row.case_id);
    material.candidates = material.candidates.map(candidate => ({ ...candidate, egress: "DENY" }));
  }
  // Re-freeze snapshots only for this test so the stop is specifically the eligibility gate,
  // not material-identity drift.
  const blockedManifest = buildC1AQualificationManifest({
    cases: changed,
    eligibilityByCase: Object.fromEntries(changed.map(item => [item.case_id, true])),
    expectedSourceCaseCount: changed.length,
    primaryCount: 4,
    diagnosticQuotas: { protect: 1, recoverable_rank_miss: 1, candidate_miss: 1, top3_budget_infeasible: 1 },
    sentinelCount: 2,
    minimumPrimaryEligibilityRatio: 0,
  });
  blockedManifest.population.minimum_primary_provider_eligible_ratio = 0.95;
  let adapterCalls = 0;

  await assert.rejects(
    () => runC1AQualificationBatch({
      manifest: blockedManifest,
      cases: changed,
      adapter: async () => { adapterCalls += 1; return { scores: [] }; },
      budget: createC1AExecutionBudget({ maxRequests: 10, maxInputTokens: 10_000 }),
    }),
    /C1A_PRIMARY_PROVIDER_ELIGIBILITY_BELOW_FROZEN_THRESHOLD/,
  );
  assert.equal(adapterCalls, 0);
});
