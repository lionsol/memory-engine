import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildQ4RecallHintC1FreshCorpusV1 } from "../lib/benchmark/q4-recall-hint-c1-corpus-v1.js";
import { buildQ4RecallHintC2FreshHoldoutCorpusV1 } from "../lib/benchmark/q4-recall-hint-c2-holdout-corpus-v1.js";
import {
  Q4_RECALL_HINT_C2_HOLDOUT_FROZEN_IDENTITY,
  assertQ4RecallHintC2HoldoutFrozenIdentityV1,
  buildQ4RecallHintC2HoldoutManifestV1,
  flattenQ4RecallHintC2HoldoutMemoryRecordsV1,
} from "../lib/benchmark/q4-recall-hint-c2-holdout-manifest-v1.js";
import {
  materializeQ4RecallHintC2HoldoutCorpusV1,
  runQ4RecallHintC2HoldoutPreflightV1,
} from "../lib/benchmark/q4-recall-hint-c2-holdout-preflight-v1.js";
import {
  Q4_RECALL_HINT_C2_MAX_EMBEDDING_REQUESTS,
  Q4_RECALL_HINT_C2_MAX_RERANK_REQUESTS,
  Q4_RECALL_HINT_C2_PRODUCER_MAX_COST_CNY,
  Q4_RECALL_HINT_C2_SEMANTIC_MAX_COST_USD,
  buildQ4RecallHintC2HoldoutContractV1,
} from "../lib/benchmark/q4-recall-hint-c2-holdout-contract-v1.js";
import {
  evaluateQ4RecallHintC2BaselineEligibilityV1,
  runQ4RecallHintC2HoldoutV1,
} from "../lib/benchmark/q4-recall-hint-c2-holdout-execution-v1.js";
import { createQ4RecallHintC1BSemanticSessionV1 } from "../lib/benchmark/q4-recall-hint-c1b-semantic-session-v1.js";
import { main as runQ4C2Cli } from "../bin/run-q4-recall-hint-c2-holdout-v1.mjs";

function fixture(sourceCommit = "q4-c2-source-fixture") {
  const corpus = buildQ4RecallHintC2FreshHoldoutCorpusV1();
  const manifest = buildQ4RecallHintC2HoldoutManifestV1(corpus);
  const contract = buildQ4RecallHintC2HoldoutContractV1({ corpus, sourceCommit });
  return { corpus, manifest, contract, sourceCommit };
}

function constantEmbedding() {
  const vector = new Array(2560).fill(0);
  vector[0] = 1;
  return vector;
}

function fakeVectorStoreFactory() {
  const rows = [];
  return async () => ({
    table: {
      async add(input) {
        rows.push(...input.map(row => ({ ...row, vector: [...row.vector] })));
      },
      search() {
        return {
          limit(limit) {
            return {
              async execute() {
                return rows.slice(0, limit).map((row, index) => ({
                  ...row,
                  _distance: index / 1000,
                }));
              },
            };
          },
        };
      },
    },
  });
}

function fakeRerankAdapter() {
  return async (_query, documents) => ({
    scores: documents.map((_document, index) => ({ index, score: documents.length - index })),
    adapterIdentity: {
      provider: "siliconflow",
      model: "Qwen/Qwen3-Reranker-0.6B",
      revision: null,
    },
    usage: { input_tokens: 10, output_tokens: 0 },
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

function fakeSemanticSessionFactory({ noHeadroomFamily = null, failRecoveryFamily = null } = {}) {
  return async ({ corpus }) => {
    const totalCases = corpus.cases.length;
    const baselineMissCase = new Map();
    let armCalls = 0;
    return {
      runArm: async ({ row }) => {
        armCalls += 1;
        const baseline = armCalls <= totalCases;
        let shouldMiss = false;
        if (baseline && ["entity_reference", "multi_facet"].includes(row.family)) {
          if (row.family !== noHeadroomFamily && !baselineMissCase.has(row.family)) {
            baselineMissCase.set(row.family, row.case_id);
            shouldMiss = true;
          }
        } else if (!baseline && failRecoveryFamily === row.family
            && baselineMissCase.get(row.family) === row.case_id) {
          shouldMiss = true;
        }
        return {
          candidate_pool_ids: shouldMiss ? [] : [...row.gold_evidence_ids],
          ranked_top3_ids: shouldMiss ? [] : [...row.gold_evidence_ids],
          latency_ms: 1,
        };
      },
      usage: () => ({
        embedding_requests: Math.min(80, Q4_RECALL_HINT_C2_MAX_EMBEDDING_REQUESTS),
        embedding_cache_hits: 32,
        rerank_requests: armCalls,
        cost_upper_bound_usd: 0.15,
      }),
      close: async () => {},
    };
  };
}

test("Q4-C2 fresh holdout is acceptance-only, narrowed, and independent of consumed C1 cases", () => {
  const c1 = buildQ4RecallHintC1FreshCorpusV1();
  const { corpus, manifest } = fixture();
  assert.equal(corpus.cases.length, 24);
  assert.deepEqual([...new Set(corpus.cases.map(row => row.family))].sort(), [
    "entity_reference",
    "multi_facet",
    "protection",
  ]);
  assert.equal(manifest.population.development_count, 0);
  assert.equal(manifest.population.holdout_count, 24);
  assert.equal(manifest.population.memory_record_count, 32);
  assert.deepEqual(manifest.population.family_counts, {
    entity_reference: 8,
    multi_facet: 8,
    protection: 8,
  });

  const oldCaseIds = new Set(c1.cases.map(row => row.case_id));
  const oldMemoryIds = new Set(c1.cases.flatMap(row => row.memory_records.map(memory => memory.id)));
  const oldQueries = new Set(c1.cases.map(row => row.query));
  const oldTexts = new Set(c1.cases.flatMap(row => row.memory_records.map(memory => memory.text)));
  assert.equal(corpus.cases.some(row => oldCaseIds.has(row.case_id)), false);
  assert.equal(corpus.cases.some(row => row.memory_records.some(memory => oldMemoryIds.has(memory.id))), false);
  assert.equal(corpus.cases.some(row => oldQueries.has(row.query)), false);
  assert.equal(corpus.cases.some(row => row.memory_records.some(memory => oldTexts.has(memory.text))), false);
  assert.deepEqual(assertQ4RecallHintC2HoldoutFrozenIdentityV1(corpus).manifest_sha256,
    Q4_RECALL_HINT_C2_HOLDOUT_FROZEN_IDENTITY.manifest_sha256);
});

test("Q4-C2 zero-provider lexical preflight preserves protection and exposes both target-family headrooms", async () => {
  const result = await runQ4RecallHintC2HoldoutPreflightV1();
  assert.equal(result.eligibility.status, "PASS");
  assert.equal(result.provider_calls, 0);
  assert.equal(result.vector_provider_calls, 0);
  assert.equal(result.rerank_provider_calls, 0);
  assert.equal(result.families.protection.pool_miss_count, 0);
  assert.equal(result.families.protection.recall_all_at_3, 1);
  assert.equal(result.families.entity_reference.pool_miss_count > 0, true);
  assert.equal(result.families.multi_facet.pool_miss_count > 0, true);
});

test("Q4-C2 corpus runs through the shared production Hybrid semantic session with only local fake providers", async () => {
  const { corpus, contract } = fixture();
  let embeddingCalls = 0;
  const session = await createQ4RecallHintC1BSemanticSessionV1({
    corpus,
    contract,
    embeddingProvider: async () => {
      embeddingCalls += 1;
      return constantEmbedding();
    },
    rerankAdapter: fakeRerankAdapter(),
    vectorStoreFactory: fakeVectorStoreFactory(),
    materializeCorpus: materializeQ4RecallHintC2HoldoutCorpusV1,
    flattenMemoryRecords: flattenQ4RecallHintC2HoldoutMemoryRecordsV1,
  });
  try {
    const run = await session.runArm({ row: corpus.cases[0], plan: null });
    assert.ok(run.candidate_pool_ids.length <= 20);
    assert.ok(run.ranked_top3_ids.length <= 3);
    const usage = session.usage();
    assert.equal(usage.embedding_requests, embeddingCalls);
    assert.equal(usage.embedding_requests, 33);
    assert.equal(usage.rerank_requests, 1);
    assert.ok(usage.embedding_cache_hits > 0);
  } finally {
    await session.close();
  }
});

test("Q4-C2 contract freezes one 24-case transaction, narrowed gates, and hard caps", () => {
  const { contract } = fixture();
  assert.equal(contract.scope, "fresh_holdout_acceptance_only");
  assert.deepEqual(contract.target_families, ["entity_reference", "multi_facet"]);
  assert.equal(contract.protection_family, "protection");
  assert.equal(contract.execution_policy.max_executions, 1);
  assert.equal(contract.execution_policy.development_split, false);
  assert.equal(contract.execution_policy.automatic_retry, false);
  assert.equal(contract.execution_policy.resume, false);
  assert.equal(contract.execution_policy.replay, false);
  assert.equal(contract.acceptance_gates.per_target_family_pool_miss_must_strictly_decrease, true);
  assert.equal(contract.producer.max_provider_requests, 24);
  assert.equal(contract.producer.cost_binding.max_cost, Q4_RECALL_HINT_C2_PRODUCER_MAX_COST_CNY);
  assert.equal(contract.embedding.max_provider_requests, Q4_RECALL_HINT_C2_MAX_EMBEDDING_REQUESTS);
  assert.equal(contract.rerank.max_provider_requests, Q4_RECALL_HINT_C2_MAX_RERANK_REQUESTS);
  assert.equal(contract.cost_binding.max_cost_usd, Q4_RECALL_HINT_C2_SEMANTIC_MAX_COST_USD);
  assert.equal(contract.producer.cost_binding.theoretical_max_cost, 0.202752);
  assert.equal(contract.cost_binding.theoretical_max_cost_usd, 0.18612224);
  assert.equal(contract.mutation.live_core, "DENY");
  assert.equal(contract.mutation.live_engine, "DENY");
  assert.equal(contract.mutation.live_lancedb, "DENY");
  assert.equal(typeof contract.execution_binding_sha256, "string");
});

test("Q4-C2 semantic baseline eligibility requires protection completeness and headroom in entity+multi", () => {
  const { corpus } = fixture();
  const seen = new Set();
  const rows = corpus.cases.map(row => {
    const miss = row.family !== "protection" && !seen.has(row.family);
    if (miss) seen.add(row.family);
    return {
      case_id: row.case_id,
      family: row.family,
      gold_evidence_ids: row.gold_evidence_ids,
      baseline: {
        candidate_pool_ids: miss ? [] : [...row.gold_evidence_ids],
        ranked_top3_ids: miss ? [] : [...row.gold_evidence_ids],
      },
    };
  });
  const result = evaluateQ4RecallHintC2BaselineEligibilityV1(rows);
  assert.equal(result.status, "PASS");
  assert.equal(result.families.entity_reference.pool_miss_count, 1);
  assert.equal(result.families.multi_facet.pool_miss_count, 1);
  assert.equal(result.families.protection.pool_miss_count, 0);
  assert.equal(result.families.protection.recall_all_at_3, 1);
});

test("Q4-C2 stops before producer if either narrowed target lacks semantic baseline headroom", async () => {
  const { corpus, sourceCommit, contract } = fixture();
  const producer = { calls: 0 };
  const result = await runQ4RecallHintC2HoldoutV1({
    corpus,
    sourceCommit,
    executionBindingSha256: contract.execution_binding_sha256,
    producerTransport: fakeHintTransport(producer),
    semanticSessionFactory: fakeSemanticSessionFactory({ noHeadroomFamily: "multi_facet" }),
  });
  assert.equal(result.status, "STOPPED");
  assert.equal(result.stop_phase, "BASELINE_ELIGIBILITY");
  assert.equal(result.baseline_eligibility.reasons.includes("multi_facet_baseline_pool_miss_headroom_absent"), true);
  assert.equal(producer.calls, 0);
  assert.equal(result.producer_usage.provider_requests, 0);
  assert.equal(result.evaluation, null);
});

test("Q4-C2 fake holdout transaction passes only when both target families recover candidate misses", async () => {
  const { corpus, sourceCommit, contract } = fixture();
  const producer = { calls: 0 };
  const result = await runQ4RecallHintC2HoldoutV1({
    corpus,
    sourceCommit,
    executionBindingSha256: contract.execution_binding_sha256,
    producerTransport: fakeHintTransport(producer),
    semanticSessionFactory: fakeSemanticSessionFactory(),
  });
  assert.equal(result.status, "PASS");
  assert.equal(result.stop_phase, null);
  assert.equal(result.baseline_eligibility.status, "PASS");
  assert.equal(producer.calls, 24);
  assert.equal(result.producer_usage.provider_requests, 24);
  assert.equal(result.semantic_usage.rerank_requests, 48);
  assert.equal(result.acceptance_gates.status, "PASS");
  assert.equal(result.evaluation.families.entity_reference.delta.pool_miss_count, -1);
  assert.equal(result.evaluation.families.multi_facet.delta.pool_miss_count, -1);
  assert.equal(result.evaluation.protection.paired["recall_all@3"].regressed, 0);
  assert.equal(typeof result.result_sha256, "string");
});

test("Q4-C2 gates stop if one target family fails to recover its baseline candidate miss", async () => {
  const { corpus, sourceCommit, contract } = fixture();
  const producer = { calls: 0 };
  const result = await runQ4RecallHintC2HoldoutV1({
    corpus,
    sourceCommit,
    executionBindingSha256: contract.execution_binding_sha256,
    producerTransport: fakeHintTransport(producer),
    semanticSessionFactory: fakeSemanticSessionFactory({ failRecoveryFamily: "multi_facet" }),
  });
  assert.equal(result.status, "STOPPED");
  assert.equal(result.stop_phase, "ACCEPTANCE_GATES");
  assert.equal(result.acceptance_gates.reasons.includes("multi_facet_pool_miss_not_recovered"), true);
  assert.equal(producer.calls, 24);
});

test("Q4-C2 execution binding fails closed before any provider path", async () => {
  const { corpus, sourceCommit } = fixture();
  const producer = { calls: 0 };
  await assert.rejects(
    runQ4RecallHintC2HoldoutV1({
      corpus,
      sourceCommit,
      executionBindingSha256: "wrong-binding",
      producerTransport: fakeHintTransport(producer),
      semanticSessionFactory: fakeSemanticSessionFactory(),
    }),
    /Q4_C2_HOLDOUT_EXECUTION_BINDING_MISMATCH/,
  );
  assert.equal(producer.calls, 0);
});

test("Q4-C2 CLI preflight is zero-egress and one attempt marker prevents replay", async () => {
  const root = mkdtempSync(join(tmpdir(), "q4-c2-cli-test-"));
  const source = { commit: "q4-c2-cli-source", worktree_clean: true };
  const env = { SILICONFLOW_API_KEY: "sk-q4-c2-test" };
  try {
    const preflight = await runQ4C2Cli(["--preflight"], { env, source, baseDir: root });
    assert.equal(preflight.status, "PASS");
    assert.equal(preflight.mode, "PREFLIGHT_ONLY");
    assert.equal(preflight.case_count, 24);
    assert.deepEqual(preflight.target_families, ["entity_reference", "multi_facet"]);

    let executeCalls = 0;
    const result = await runQ4C2Cli([
      "--execution-binding",
      preflight.execution_binding_sha256,
    ], {
      env,
      source,
      baseDir: root,
      producerTransportFactory: () => async () => {
        throw new Error("fake transport should be owned by injected execute");
      },
      semanticProvidersFactory: () => ({ embeddingProvider: async () => [], rerankAdapter: async () => [] }),
      execute: async () => {
        executeCalls += 1;
        return {
          status: "STOPPED",
          stop_phase: "BASELINE_ELIGIBILITY",
          baseline_eligibility: { status: "STOP", reasons: ["fixture"] },
          producer_usage: { provider_requests: 0, input_tokens: 0, output_tokens: 0, cost: 0, billing_currency: "CNY" },
          semantic_usage: { embedding_requests: 1, embedding_cache_hits: 0, rerank_requests: 1, cost_upper_bound_usd: 0.01 },
          acceptance_gates: null,
          evaluation: null,
          result_sha256: null,
        };
      },
    });
    assert.equal(result.status, "STOPPED");
    assert.equal(executeCalls, 1);
    const marker = JSON.parse(readFileSync(preflight.attempt_path, "utf8"));
    assert.equal(marker.state, "CONSUMED");
    assert.equal(marker.retry_policy, "NO_RETRY_NO_RESUME_NO_REPLAY");
    await assert.rejects(
      runQ4C2Cli(["--execution-binding", preflight.execution_binding_sha256], {
        env,
        source,
        baseDir: root,
        producerTransportFactory: () => async () => {},
        semanticProvidersFactory: () => ({ embeddingProvider: async () => [], rerankAdapter: async () => [] }),
        execute: async () => ({}),
      }),
      /Q4_C2_HOLDOUT_ATTEMPT_ALREADY_EXISTS/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
