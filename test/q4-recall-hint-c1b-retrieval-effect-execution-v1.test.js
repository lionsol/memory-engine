import test from "node:test";
import assert from "node:assert/strict";

import { buildQ4RecallHintC1FreshCorpusV1 } from "../lib/benchmark/q4-recall-hint-c1-corpus-v1.js";
import { runQ4RecallHintC1BRetrievalEffectV1 } from "../lib/benchmark/q4-recall-hint-c1b-retrieval-effect-execution-v1.js";

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

test("Q4-C1b retrieval-effect execution uses development-only Hybrid vector + rerank path with shared embedding cache", async () => {
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  let embeddingCalls = 0;
  const output = await runQ4RecallHintC1BRetrievalEffectV1({
    corpus,
    embeddingProvider: async () => {
      embeddingCalls += 1;
      return constantEmbedding();
    },
    rerankAdapter: fakeRerankAdapter(),
    vectorStoreFactory: fakeVectorStoreFactory(),
  });

  assert.equal(output.schema, "memory_engine_q4_recall_hint_c1b_retrieval_effect_execution_v1");
  assert.equal(output.contract.scope, "development_only");
  assert.equal(output.evaluation.case_count, 16);
  assert.equal(output.evaluation.development.case_count, 16);
  assert.equal(output.evaluation.acceptance, null);
  assert.equal(output.evaluation.technical_stop_conditions.status, "NOT_EVALUABLE");

  assert.equal(output.provider_usage.embedding_requests, embeddingCalls);
  assert.ok(output.provider_usage.embedding_requests > 72);
  assert.ok(output.provider_usage.embedding_requests <= 107);
  assert.ok(output.provider_usage.embedding_cache_hits > 0);
  assert.equal(output.provider_usage.rerank_requests, 32);
  assert.ok(output.provider_usage.cost_upper_bound_usd <= 0.20);

  for (const row of output.evaluation.rows) {
    assert.equal(row.split, "development");
    assert.ok(row.baseline.candidate_pool_ids.length <= 20);
    assert.ok(row.hint.candidate_pool_ids.length <= 20);
    assert.ok(row.baseline.ranked_top3_ids.length <= 3);
    assert.ok(row.hint.ranked_top3_ids.length <= 3);
    assert.equal(row.accounting.provider_calls, 0);
    assert.ok(row.accounting.extra_embedding_calls <= 2);
    assert.ok(row.accounting.extra_vector_search_calls <= 2);
  }
});

test("Q4-C1b retrieval-effect execution fails closed on invalid embedding dimension", async () => {
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  await assert.rejects(
    runQ4RecallHintC1BRetrievalEffectV1({
      corpus,
      embeddingProvider: async () => [1, 2, 3],
      rerankAdapter: fakeRerankAdapter(),
      vectorStoreFactory: fakeVectorStoreFactory(),
    }),
    /Q4_C1B_RETRIEVAL_EMBEDDING_DIMENSION_INVALID/,
  );
});
