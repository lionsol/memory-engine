import { createHash } from "node:crypto";

import { createQ4RecallHintC1BSemanticSessionV1 } from "./q4-recall-hint-c1b-semantic-session-v1.js";

export const RH_L1_DETERMINISTIC_EQUIVALENCE_SCHEMA = "memory_engine_rh_l1_deterministic_equivalence_v1";
export const RH_L1_DETERMINISTIC_EMBEDDING_ID = "rh_l1_sha256_sparse_embedding_v1";
export const RH_L1_DETERMINISTIC_VECTOR_STORE_ID = "rh_l1_exact_cosine_store_v1";
export const RH_L1_DETERMINISTIC_RERANK_ID = "rh_l1_sha256_rerank_v1";

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function createRhL1DeterministicEmbeddingV1(text, dimension = 2560) {
  if (!Number.isSafeInteger(dimension) || dimension < 32) throw fail("RH_L1_E1_DIMENSION_INVALID");
  const vector = new Array(dimension).fill(0);
  const value = String(text);
  for (let block = 0; block < 16; block += 1) {
    const digest = createHash("sha256").update(value).update("\0").update(String(block)).digest();
    const index = digest.readUInt16BE(0) % dimension;
    const sign = (digest[2] & 1) === 0 ? 1 : -1;
    const magnitude = 1 + (digest[3] / 255);
    vector[index] += sign * magnitude;
  }
  return vector;
}

function vectorNorm(vector) {
  let sum = 0;
  for (const value of vector) sum += value * value;
  return Math.sqrt(sum);
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    throw fail("RH_L1_E1_VECTOR_SHAPE_MISMATCH");
  }
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) dot += left[index] * right[index];
  const denominator = vectorNorm(left) * vectorNorm(right);
  return denominator > 0 ? dot / denominator : 0;
}

export function createRhL1DeterministicVectorStoreFactoryV1() {
  return async () => {
    const rows = [];
    return {
      table: {
        async add(input) {
          if (!Array.isArray(input)) throw fail("RH_L1_E1_VECTOR_ROWS_INVALID");
          rows.push(...input.map(row => ({
            ...row,
            vector: Array.from(row.vector || []),
          })));
        },
        search(queryVector) {
          const vector = Array.from(queryVector || []);
          return {
            limit(limit) {
              return {
                async execute() {
                  return rows
                    .map(row => {
                      const similarity = cosineSimilarity(vector, row.vector);
                      return {
                        ...row,
                        _distance: 1 - similarity,
                      };
                    })
                    .sort((left, right) => {
                      const distanceDelta = left._distance - right._distance;
                      if (distanceDelta !== 0) return distanceDelta;
                      return String(left.id).localeCompare(String(right.id));
                    })
                    .slice(0, limit);
                },
              };
            },
          };
        },
      },
      async close() {},
    };
  };
}

export function createRhL1DeterministicRerankAdapterV1(contract) {
  const identity = Object.freeze({
    provider: contract.rerank.provider,
    model: contract.rerank.model,
    revision: contract.rerank.revision ?? null,
  });
  return async (query, documents) => ({
    scores: documents.map((document, index) => {
      const digest = createHash("sha256")
        .update(String(query))
        .update("\0")
        .update(String(document))
        .digest();
      return {
        index,
        score: digest.readUInt32BE(0) / 0xffffffff,
      };
    }),
    adapterIdentity: identity,
    usage: { input_tokens: 0, output_tokens: 0 },
  });
}

function exactArrayEqual(left, right) {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

export async function runRhL1DeterministicEquivalenceV1({
  corpus,
  contract,
  sessionFactory = createQ4RecallHintC1BSemanticSessionV1,
} = {}) {
  if (!corpus || !Array.isArray(corpus.cases)) throw fail("RH_L1_E1_CORPUS_REQUIRED");
  if (!contract || !Array.isArray(contract.target_plans)) throw fail("RH_L1_E1_CONTRACT_REQUIRED");
  if (typeof sessionFactory !== "function") throw fail("RH_L1_E1_SESSION_FACTORY_REQUIRED");

  const dimension = contract.session_contract?.embedding?.dimension;
  const deterministicEmbedding = async text => createRhL1DeterministicEmbeddingV1(text, dimension);
  const deterministicRerank = createRhL1DeterministicRerankAdapterV1(contract.session_contract);
  const vectorStoreFactory = createRhL1DeterministicVectorStoreFactoryV1();

  let sequentialSession = null;
  let parallelSession = null;
  try {
    sequentialSession = await sessionFactory({
      corpus,
      contract: contract.session_contract,
      embeddingProvider: deterministicEmbedding,
      rerankAdapter: deterministicRerank,
      vectorStoreFactory,
    });
    parallelSession = await sessionFactory({
      corpus,
      contract: contract.session_contract,
      embeddingProvider: deterministicEmbedding,
      rerankAdapter: deterministicRerank,
      vectorStoreFactory,
    });

    const caseById = new Map(corpus.cases.map(row => [row.case_id, row]));
    const rows = [];
    for (const target of contract.target_plans) {
      const row = caseById.get(target.case_id);
      if (!row) throw fail("RH_L1_E1_TARGET_CASE_MISSING", { case_id: target.case_id });
      const sequential = await sequentialSession.runArm({
        row,
        plan: target.query_plan,
        recallHintVectorExecutionMode: "sequential",
      });
      const parallel = await parallelSession.runArm({
        row,
        plan: target.query_plan,
        recallHintVectorExecutionMode: "parallel",
      });
      rows.push(Object.freeze({
        case_id: target.case_id,
        family: target.family,
        expansion_count: target.query_plan.queries.length,
        candidate_pool_exact: exactArrayEqual(sequential.candidate_pool_ids, parallel.candidate_pool_ids),
        ranked_top3_exact: exactArrayEqual(sequential.ranked_top3_ids, parallel.ranked_top3_ids),
        sequential: Object.freeze({
          candidate_pool_ids: sequential.candidate_pool_ids,
          ranked_top3_ids: sequential.ranked_top3_ids,
          vector_query_execution: sequential.vector_query_execution,
        }),
        parallel: Object.freeze({
          candidate_pool_ids: parallel.candidate_pool_ids,
          ranked_top3_ids: parallel.ranked_top3_ids,
          vector_query_execution: parallel.vector_query_execution,
        }),
      }));
    }

    const sequentialUsage = sequentialSession.usage();
    const parallelUsage = parallelSession.usage();
    const candidatePoolExactCount = rows.filter(row => row.candidate_pool_exact).length;
    const rankedTop3ExactCount = rows.filter(row => row.ranked_top3_exact).length;
    const executionModesValid = rows.every(row => (
      row.sequential.vector_query_execution === "sequential"
      && row.parallel.vector_query_execution === "parallel"
    ));
    const usageEqual = sequentialUsage.embedding_requests === parallelUsage.embedding_requests
      && sequentialUsage.embedding_cache_hits === parallelUsage.embedding_cache_hits
      && sequentialUsage.rerank_requests === parallelUsage.rerank_requests;
    const reasons = [];
    if (candidatePoolExactCount !== rows.length) reasons.push("candidate_pool_order_diverged");
    if (rankedTop3ExactCount !== rows.length) reasons.push("ranked_top3_order_diverged");
    if (!executionModesValid) reasons.push("execution_mode_not_observed");
    if (!usageEqual) reasons.push("arm_usage_differed");

    const identityBody = {
      embedding_id: RH_L1_DETERMINISTIC_EMBEDDING_ID,
      vector_store_id: RH_L1_DETERMINISTIC_VECTOR_STORE_ID,
      rerank_id: RH_L1_DETERMINISTIC_RERANK_ID,
      target_plans_sha256: contract.target_plans_sha256,
      rows: rows.map(row => ({
        case_id: row.case_id,
        candidate_pool_ids: row.sequential.candidate_pool_ids,
        ranked_top3_ids: row.sequential.ranked_top3_ids,
      })),
    };

    return Object.freeze({
      schema: RH_L1_DETERMINISTIC_EQUIVALENCE_SCHEMA,
      status: reasons.length === 0 ? "PASS" : "FAIL",
      quality_claim_scope: "NONE_EXECUTION_EQUIVALENCE_ONLY",
      external_provider_requests: 0,
      target_case_count: rows.length,
      deterministic_inputs: Object.freeze({
        embedding_id: RH_L1_DETERMINISTIC_EMBEDDING_ID,
        vector_store_id: RH_L1_DETERMINISTIC_VECTOR_STORE_ID,
        rerank_id: RH_L1_DETERMINISTIC_RERANK_ID,
      }),
      equivalence: Object.freeze({
        candidate_pool_exact_count: candidatePoolExactCount,
        ranked_top3_exact_count: rankedTop3ExactCount,
        execution_modes_valid: executionModesValid,
        usage_equal: usageEqual,
        reasons: Object.freeze(reasons),
      }),
      usage: Object.freeze({
        sequential: sequentialUsage,
        parallel: parallelUsage,
      }),
      rows: Object.freeze(rows),
      result_sha256: sha256(JSON.stringify(identityBody)),
    });
  } finally {
    await sequentialSession?.close?.();
    await parallelSession?.close?.();
  }
}
