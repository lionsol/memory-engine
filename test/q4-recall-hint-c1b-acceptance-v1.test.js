import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { main as runAcceptanceCli } from "../bin/run-q4-recall-hint-c1b-acceptance-v1.mjs";

import { buildQ4RecallHintC1FreshCorpusV1 } from "../lib/benchmark/q4-recall-hint-c1-corpus-v1.js";
import { buildQ4RecallHintC1ManifestV1 } from "../lib/benchmark/q4-recall-hint-c1-manifest-v1.js";
import {
  Q4_C1B_ACCEPTANCE_MAX_EMBEDDING_REQUESTS,
  Q4_C1B_ACCEPTANCE_MAX_RERANK_REQUESTS,
  Q4_C1B_ACCEPTANCE_PRODUCER_MAX_COST_CNY,
  Q4_C1B_ACCEPTANCE_SEMANTIC_MAX_COST_USD,
  buildQ4RecallHintC1BAcceptanceContractV1,
} from "../lib/benchmark/q4-recall-hint-c1b-acceptance-contract-v1.js";
import {
  evaluateQ4RecallHintC1BAcceptanceBaselineEligibilityV1,
  runQ4RecallHintC1BAcceptanceV1,
} from "../lib/benchmark/q4-recall-hint-c1b-acceptance-execution-v1.js";

function fixture() {
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  const manifest = buildQ4RecallHintC1ManifestV1(corpus);
  const sourceCommit = "q4-acceptance-source-fixture";
  const contract = buildQ4RecallHintC1BAcceptanceContractV1({ corpus, sourceCommit });
  const caseById = new Map(corpus.cases.map(row => [row.case_id, row]));
  const acceptanceRows = manifest.acceptance.map(row => caseById.get(row.case_id));
  return { corpus, manifest, sourceCommit, contract, acceptanceRows };
}

function baselineEligibilityRows(acceptanceRows) {
  const missedFamilies = new Set();
  return acceptanceRows.map(row => {
    const shouldMiss = row.family !== "protection" && !missedFamilies.has(row.family);
    if (shouldMiss) missedFamilies.add(row.family);
    return {
      case_id: row.case_id,
      family: row.family,
      gold_evidence_ids: row.gold_evidence_ids,
      baseline: {
        candidate_pool_ids: shouldMiss ? [] : [...row.gold_evidence_ids],
        ranked_top3_ids: shouldMiss ? [] : [...row.gold_evidence_ids],
      },
    };
  });
}

function fakeHintTransport(counter) {
  return async ({ request }) => {
    counter.calls += 1;
    const project = request.prompt.match(/"active_project":"([^"]+)"/u)?.[1] || null;
    return {
      text: project
        ? JSON.stringify({ version: "recall_hint_v1", project, entities: [project] })
        : JSON.stringify({ version: "recall_hint_v1" }),
      usage: { input_tokens: 120, output_tokens: 24 },
    };
  };
}

function fakeSemanticSessionFactory({ failEligibility = false } = {}) {
  return async () => {
    const baselineSeenByFamily = new Set();
    let armCalls = 0;
    return {
      runArm: async ({ row, plan }) => {
        armCalls += 1;
        const isBaseline = plan === null;
        let shouldMiss = false;
        if (isBaseline && row.family !== "protection" && !baselineSeenByFamily.has(row.family)) {
          baselineSeenByFamily.add(row.family);
          shouldMiss = !failEligibility;
        }
        if (failEligibility && isBaseline) shouldMiss = false;
        return {
          candidate_pool_ids: shouldMiss ? [] : [...row.gold_evidence_ids],
          ranked_top3_ids: shouldMiss ? [] : [...row.gold_evidence_ids],
          latency_ms: 1,
        };
      },
      usage: () => ({
        embedding_requests: Math.min(136, Q4_C1B_ACCEPTANCE_MAX_EMBEDDING_REQUESTS),
        embedding_cache_hits: 64,
        rerank_requests: armCalls,
        cost_upper_bound_usd: 0.20,
      }),
      close: async () => {},
    };
  };
}

test("Q4-C1b acceptance contract freezes one untouched 32-case transaction and hard caps", () => {
  const { contract } = fixture();
  assert.equal(contract.scope, "acceptance_only");
  assert.equal(contract.case_count, 32);
  assert.equal(contract.execution_policy.max_executions, 1);
  assert.equal(contract.execution_policy.automatic_retry, false);
  assert.equal(contract.execution_policy.resume, false);
  assert.equal(contract.execution_policy.replay, false);
  assert.equal(contract.producer.max_provider_requests, 32);
  assert.equal(contract.producer.cost_binding.max_cost, Q4_C1B_ACCEPTANCE_PRODUCER_MAX_COST_CNY);
  assert.equal(contract.embedding.max_provider_requests, Q4_C1B_ACCEPTANCE_MAX_EMBEDDING_REQUESTS);
  assert.equal(contract.rerank.max_provider_requests, Q4_C1B_ACCEPTANCE_MAX_RERANK_REQUESTS);
  assert.equal(contract.cost_binding.max_cost_usd, Q4_C1B_ACCEPTANCE_SEMANTIC_MAX_COST_USD);
  assert.equal(contract.mutation.live_core, "DENY");
  assert.equal(contract.mutation.live_engine, "DENY");
  assert.equal(contract.mutation.live_lancedb, "DENY");
  assert.equal(contract.mutation.deployment, "DENY");
  assert.equal(contract.egress.deny.includes("gold_evidence_ids"), true);
  assert.equal(contract.egress.deny.includes("retrieval_results"), true);
  assert.equal(contract.egress.deny.includes("live_memory"), true);
  assert.equal(typeof contract.execution_binding_sha256, "string");
});

test("Q4-C1b acceptance baseline eligibility requires protection completeness and target-family headroom", () => {
  const { acceptanceRows } = fixture();
  const pass = evaluateQ4RecallHintC1BAcceptanceBaselineEligibilityV1(baselineEligibilityRows(acceptanceRows));
  assert.equal(pass.status, "PASS");
  assert.equal(pass.families.protection.pool_miss_count, 0);
  assert.equal(pass.families.protection.recall_all_at_3, 1);
  for (const family of ["entity_reference", "temporal_relation", "multi_facet"]) {
    assert.equal(pass.families[family].pool_miss_count >= 1, true);
  }
});

test("Q4-C1b acceptance stops before producer when real semantic baseline has no target headroom", async () => {
  const { corpus, sourceCommit, contract } = fixture();
  const producer = { calls: 0 };
  const result = await runQ4RecallHintC1BAcceptanceV1({
    corpus,
    sourceCommit,
    executionBindingSha256: contract.execution_binding_sha256,
    producerTransport: fakeHintTransport(producer),
    semanticSessionFactory: fakeSemanticSessionFactory({ failEligibility: true }),
  });
  assert.equal(result.status, "STOPPED");
  assert.equal(result.stop_phase, "BASELINE_ELIGIBILITY");
  assert.equal(producer.calls, 0);
  assert.equal(result.producer_usage.provider_requests, 0);
  assert.equal(result.evaluation, null);
});

test("Q4-C1b acceptance fake transaction executes baseline -> producer -> hint exactly once and applies gates", async () => {
  const { corpus, sourceCommit, contract } = fixture();
  const producer = { calls: 0 };
  const result = await runQ4RecallHintC1BAcceptanceV1({
    corpus,
    sourceCommit,
    executionBindingSha256: contract.execution_binding_sha256,
    producerTransport: fakeHintTransport(producer),
    semanticSessionFactory: fakeSemanticSessionFactory(),
  });
  assert.equal(result.status, "PASS");
  assert.equal(result.stop_phase, null);
  assert.equal(result.baseline_eligibility.status, "PASS");
  assert.equal(producer.calls, 32);
  assert.equal(result.producer_usage.provider_requests, 32);
  assert.equal(result.semantic_usage.rerank_requests, 64);
  assert.equal(result.evaluation.acceptance.case_count, 32);
  assert.equal(result.evaluation.technical_stop_conditions.status, "PASS");
  assert.equal(result.evaluation.acceptance.paired["recall_all@3"].improved > 0, true);
  assert.equal(result.evaluation.acceptance.paired["recall_all@3"].regressed, 0);
  assert.equal(typeof result.result_sha256, "string");
});

test("Q4-C1b acceptance execution binding fails closed before any provider path", async () => {
  const { corpus, sourceCommit } = fixture();
  const producer = { calls: 0 };
  await assert.rejects(
    runQ4RecallHintC1BAcceptanceV1({
      corpus,
      sourceCommit,
      executionBindingSha256: "wrong-binding",
      producerTransport: fakeHintTransport(producer),
      semanticSessionFactory: fakeSemanticSessionFactory(),
    }),
    /Q4_C1B_ACCEPTANCE_EXECUTION_BINDING_MISMATCH/,
  );
  assert.equal(producer.calls, 0);
});

test("Q4-C1b acceptance CLI preflight is zero-egress and execution marker makes one attempt non-resumable", async () => {
  const baseDir = mkdtempSync(join(tmpdir(), "q4-c1b-acceptance-cli-test-"));
  const source = { commit: "acceptance-cli-source-fixture", worktree_clean: true };
  const env = { SILICONFLOW_API_KEY: "sk-test-only" };
  let producerFactoryCalls = 0;
  let semanticFactoryCalls = 0;
  let executeCalls = 0;
  try {
    const preflight = await runAcceptanceCli(["--preflight"], {
      env,
      source,
      baseDir,
      producerTransportFactory() {
        producerFactoryCalls += 1;
        return async () => { throw new Error("must not run"); };
      },
      semanticProvidersFactory() {
        semanticFactoryCalls += 1;
        return {};
      },
      execute: async () => { executeCalls += 1; },
    });
    assert.equal(preflight.status, "PASS");
    assert.equal(producerFactoryCalls, 0);
    assert.equal(semanticFactoryCalls, 0);
    assert.equal(executeCalls, 0);

    const result = await runAcceptanceCli([
      "--execution-binding",
      preflight.execution_binding_sha256,
    ], {
      env,
      source,
      baseDir,
      producerTransportFactory() {
        producerFactoryCalls += 1;
        return async () => ({ text: "{}", usage: { input_tokens: 0, output_tokens: 0 } });
      },
      semanticProvidersFactory() {
        semanticFactoryCalls += 1;
        return { embeddingProvider: async () => [], rerankAdapter: async () => [] };
      },
      execute: async () => {
        executeCalls += 1;
        return {
          status: "PASS",
          stop_phase: null,
          baseline_eligibility: { status: "PASS" },
          producer_usage: { provider_requests: 32 },
          producer_summary: { case_count: 32 },
          semantic_usage: { embedding_requests: 100, rerank_requests: 64, cost_upper_bound_usd: 0.2 },
          evaluation: { technical_stop_conditions: { status: "PASS" } },
          result_sha256: "fake-result",
        };
      },
    });
    assert.equal(result.status, "PASS");
    assert.equal(producerFactoryCalls, 1);
    assert.equal(semanticFactoryCalls, 1);
    assert.equal(executeCalls, 1);
    const attempt = JSON.parse(readFileSync(result.attempt_path, "utf8"));
    assert.equal(attempt.state, "CONSUMED");
    assert.equal(attempt.execution_binding_sha256, preflight.execution_binding_sha256);

    await assert.rejects(
      runAcceptanceCli(["--execution-binding", preflight.execution_binding_sha256], {
        env,
        source,
        baseDir,
        producerTransportFactory() {
          producerFactoryCalls += 1;
          return async () => ({});
        },
        semanticProvidersFactory() {
          semanticFactoryCalls += 1;
          return {};
        },
        execute: async () => { executeCalls += 1; },
      }),
      /Q4_C1B_ACCEPTANCE_ATTEMPT_ALREADY_EXISTS/,
    );
    assert.equal(producerFactoryCalls, 1);
    assert.equal(semanticFactoryCalls, 1);
    assert.equal(executeCalls, 1);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
  }
});
