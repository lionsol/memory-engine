import test from "node:test";
import assert from "node:assert/strict";

import { buildQ4RecallHintC1FreshCorpusV1 } from "../lib/benchmark/q4-recall-hint-c1-corpus-v1.js";
import {
  RH_L1_SESSION_EMBEDDING_REQUEST_CAP,
  RH_L1_SESSION_RERANK_REQUEST_CAP,
  RH_L1_TARGET_CASE_COUNT,
  RH_L1_TARGET_EXPANSION_COUNT,
  RH_L1_TOTAL_EMBEDDING_REQUEST_CAP,
  RH_L1_TOTAL_RERANK_REQUEST_CAP,
  buildRhL1PerformanceContractV1,
} from "../lib/benchmark/rh-l1-performance-contract-v1.js";
import { runRhL1PerformanceQualificationV1 } from "../lib/benchmark/rh-l1-performance-execution-v1.js";

const SOURCE = "2".repeat(40);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fakeEmbeddingProvider() {
  return async () => {
    await delay(2);
    return [1];
  };
}

function fakeRerankAdapter() {
  return async (_query, documents) => {
    await delay(1);
    return {
      scores: documents.map((_document, index) => ({ index, score: documents.length - index })),
      adapterIdentity: { provider: "fake", model: "fake", revision: null },
      usage: { input_tokens: 1, output_tokens: 0 },
    };
  };
}

async function fakeSessionFactory({ contract, embeddingProvider, rerankAdapter }) {
  let embeddingRequests = 0;
  let embeddingCacheHits = 0;
  let rerankRequests = 0;
  const cache = new Map();

  const embed = async text => {
    if (cache.has(text)) {
      embeddingCacheHits += 1;
      return cache.get(text);
    }
    embeddingRequests += 1;
    const vector = await embeddingProvider(text);
    cache.set(text, vector);
    return vector;
  };

  for (let index = 0; index < contract.embedding.corpus_embedding_inputs; index += 1) {
    await embed(`corpus-${index}`);
  }

  return {
    async runArm({ row, plan, recallHintVectorExecutionMode }) {
      const queries = [row.query, ...(plan?.queries || [])];
      if (recallHintVectorExecutionMode === "parallel") {
        await Promise.all(queries.map(embed));
      } else {
        for (const query of queries) await embed(query);
      }
      // Simulate the second search hitting the shared exact-input cache.
      for (const query of queries) await embed(query);
      rerankRequests += 1;
      await rerankAdapter(row.query, ["a", "b", "c"]);
      const expansionCount = plan?.queries?.length || 0;
      const parallel = recallHintVectorExecutionMode === "parallel";
      return {
        candidate_pool_ids: [`${row.case_id}-a`, `${row.case_id}-b`],
        ranked_top3_ids: [`${row.case_id}-a`],
        latency_ms: parallel ? 70 + expansionCount : 120 + expansionCount,
        pool_vector_ms: parallel ? 35 + expansionCount : 80 + expansionCount,
        ranked_vector_ms: parallel ? 10 : 20,
        vector_query_execution: parallel ? "parallel" : "sequential",
      };
    },
    usage() {
      return {
        embedding_requests: embeddingRequests,
        embedding_cache_hits: embeddingCacheHits,
        rerank_requests: rerankRequests,
        cost_upper_bound_usd: 0.09,
      };
    },
    async close() {},
  };
}

test("RH-L1 contract freezes fixed performance material and exact two-session budget", () => {
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  const contract = buildRhL1PerformanceContractV1({ corpus, sourceCommit: SOURCE });

  assert.equal(contract.quality_claim_scope, "NONE");
  assert.equal(contract.producer_requests, 0);
  assert.equal(contract.target_case_count, RH_L1_TARGET_CASE_COUNT);
  assert.equal(contract.target_expansion_count, RH_L1_TARGET_EXPANSION_COUNT);
  assert.equal(contract.target_plans.length, 12);
  assert.ok(contract.target_plans.every(row => row.query_plan.queries.length >= 1));
  assert.equal(contract.session_contract.embedding.max_provider_requests, RH_L1_SESSION_EMBEDDING_REQUEST_CAP);
  assert.equal(contract.session_contract.rerank.max_provider_requests, RH_L1_SESSION_RERANK_REQUEST_CAP);
  assert.equal(contract.total_budget.embedding_requests, RH_L1_TOTAL_EMBEDDING_REQUEST_CAP);
  assert.equal(contract.total_budget.rerank_requests, RH_L1_TOTAL_RERANK_REQUEST_CAP);
  assert.equal(contract.total_budget.max_cost_usd, 0.19);
  assert.equal(contract.retry_policy, "NO_RETRY_NO_RESUME_NO_REPLAY");
  assert.match(contract.contract_sha256, /^[0-9a-f]{64}$/);
  assert.match(contract.execution_binding_sha256, /^[0-9a-f]{64}$/);
});

test("RH-L1 fake qualification proves equal outputs/call counts and observed parallelism", async () => {
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  const contract = buildRhL1PerformanceContractV1({ corpus, sourceCommit: SOURCE });
  const result = await runRhL1PerformanceQualificationV1({
    corpus,
    contract,
    sessionFactory: fakeSessionFactory,
    sequentialEmbeddingProvider: fakeEmbeddingProvider(),
    sequentialRerankAdapter: fakeRerankAdapter(),
    parallelEmbeddingProvider: fakeEmbeddingProvider(),
    parallelRerankAdapter: fakeRerankAdapter(),
  });

  assert.equal(result.status, "PASS", JSON.stringify({ gates: result.gates, usage: result.usage }));
  assert.equal(result.rows.length, 12);
  assert.equal(result.gates.status, "PASS");
  assert.deepEqual(result.gates.reasons, []);
  assert.equal(result.gates.exact_equivalence.candidate_pool, true);
  assert.equal(result.gates.exact_equivalence.ranked_top3, true);
  assert.equal(result.usage.sequential.embedding_requests, 99);
  assert.equal(result.usage.parallel.embedding_requests, 99);
  assert.equal(result.usage.sequential.rerank_requests, 12);
  assert.equal(result.usage.parallel.rerank_requests, 12);
  assert.equal(result.providers.sequential.embedding.max_active, 1);
  assert.ok(result.providers.parallel.embedding.max_active >= 2);
  assert.ok(result.gates.latency.deltas.pool_vector_p50_speedup_fraction >= 0.20);
  assert.ok(result.gates.latency.deltas.full_semantic_p50_speedup_fraction >= 0.10);
});

test("RH-L1 qualification stops when outputs diverge despite latency improvement", async () => {
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  const contract = buildRhL1PerformanceContractV1({ corpus, sourceCommit: SOURCE });
  let sessionIndex = 0;
  const result = await runRhL1PerformanceQualificationV1({
    corpus,
    contract,
    sessionFactory: async args => {
      sessionIndex += 1;
      const session = await fakeSessionFactory(args);
      if (sessionIndex !== 2) return session;
      return {
        ...session,
        async runArm(input) {
          const row = await session.runArm(input);
          return { ...row, ranked_top3_ids: ["diverged"] };
        },
      };
    },
    sequentialEmbeddingProvider: fakeEmbeddingProvider(),
    sequentialRerankAdapter: fakeRerankAdapter(),
    parallelEmbeddingProvider: fakeEmbeddingProvider(),
    parallelRerankAdapter: fakeRerankAdapter(),
  });

  assert.equal(result.status, "STOPPED");
  assert.equal(result.gates.exact_equivalence.ranked_top3, false);
  assert.ok(result.gates.reasons.includes("ranked_top3_not_exactly_equivalent"));
});
