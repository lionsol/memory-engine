import { createHash } from "node:crypto";

import { createQ4RecallHintC1BSemanticSessionV1 } from "./q4-recall-hint-c1b-semantic-session-v1.js";
import {
  RH_L1_DETERMINISTIC_EMBEDDING_ID,
  RH_L1_DETERMINISTIC_RERANK_ID,
  createRhL1DeterministicEmbeddingV1,
  createRhL1DeterministicRerankAdapterV1,
} from "./rh-l1-deterministic-equivalence-v1.js";

export const RH_L1_LANCEDB_EQUIVALENCE_SCHEMA = "memory_engine_rh_l1_lancedb_equivalence_v1";
export const RH_L1_LANCEDB_EQUIVALENCE_STORE_ID = "rh_l1_shared_real_lancedb_v1";

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function exactArrayEqual(left, right) {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

export async function runRhL1LanceDbEquivalenceV1({
  corpus,
  contract,
  sessionFactory = createQ4RecallHintC1BSemanticSessionV1,
} = {}) {
  if (!corpus || !Array.isArray(corpus.cases)) throw fail("RH_L1_E2_CORPUS_REQUIRED");
  if (!contract || !Array.isArray(contract.target_plans)) throw fail("RH_L1_E2_CONTRACT_REQUIRED");
  if (typeof sessionFactory !== "function") throw fail("RH_L1_E2_SESSION_FACTORY_REQUIRED");

  const dimension = contract.session_contract?.embedding?.dimension;
  const deterministicEmbedding = async text => createRhL1DeterministicEmbeddingV1(text, dimension);
  const deterministicRerank = createRhL1DeterministicRerankAdapterV1(contract.session_contract);

  let session = null;
  try {
    session = await sessionFactory({
      corpus,
      contract: {
        ...contract.session_contract,
        rerank: {
          ...contract.session_contract.rerank,
          max_provider_requests: contract.target_case_count * 2,
        },
        cost_binding: {
          ...contract.session_contract.cost_binding,
          max_cost_usd: contract.session_contract.cost_binding.max_cost_usd * 2,
        },
      },
      embeddingProvider: deterministicEmbedding,
      rerankAdapter: deterministicRerank,
    });

    const caseById = new Map(corpus.cases.map(row => [row.case_id, row]));
    const rows = [];
    for (const [index, target] of contract.target_plans.entries()) {
      const row = caseById.get(target.case_id);
      if (!row) throw fail("RH_L1_E2_TARGET_CASE_MISSING", { case_id: target.case_id });

      let sequential;
      let parallel;
      if (index % 2 === 0) {
        sequential = await session.runArm({
          row,
          plan: target.query_plan,
          recallHintVectorExecutionMode: "sequential",
        });
        parallel = await session.runArm({
          row,
          plan: target.query_plan,
          recallHintVectorExecutionMode: "parallel",
        });
      } else {
        parallel = await session.runArm({
          row,
          plan: target.query_plan,
          recallHintVectorExecutionMode: "parallel",
        });
        sequential = await session.runArm({
          row,
          plan: target.query_plan,
          recallHintVectorExecutionMode: "sequential",
        });
      }

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

    const usage = session.usage();
    const candidatePoolExactCount = rows.filter(row => row.candidate_pool_exact).length;
    const rankedTop3ExactCount = rows.filter(row => row.ranked_top3_exact).length;
    const executionModesValid = rows.every(row => (
      row.sequential.vector_query_execution === "sequential"
      && row.parallel.vector_query_execution === "parallel"
    ));
    const reasons = [];
    if (candidatePoolExactCount !== rows.length) reasons.push("candidate_pool_order_diverged");
    if (rankedTop3ExactCount !== rows.length) reasons.push("ranked_top3_order_diverged");
    if (!executionModesValid) reasons.push("execution_mode_not_observed");

    const identityBody = {
      embedding_id: RH_L1_DETERMINISTIC_EMBEDDING_ID,
      vector_store_id: RH_L1_LANCEDB_EQUIVALENCE_STORE_ID,
      rerank_id: RH_L1_DETERMINISTIC_RERANK_ID,
      target_plans_sha256: contract.target_plans_sha256,
      rows: rows.map(row => ({
        case_id: row.case_id,
        candidate_pool_ids: row.sequential.candidate_pool_ids,
        ranked_top3_ids: row.sequential.ranked_top3_ids,
      })),
    };

    return Object.freeze({
      schema: RH_L1_LANCEDB_EQUIVALENCE_SCHEMA,
      status: reasons.length === 0 ? "PASS" : "FAIL",
      quality_claim_scope: "NONE_EXECUTION_EQUIVALENCE_ONLY",
      external_provider_requests: 0,
      target_case_count: rows.length,
      deterministic_inputs: Object.freeze({
        embedding_id: RH_L1_DETERMINISTIC_EMBEDDING_ID,
        vector_store_id: RH_L1_LANCEDB_EQUIVALENCE_STORE_ID,
        rerank_id: RH_L1_DETERMINISTIC_RERANK_ID,
      }),
      equivalence: Object.freeze({
        candidate_pool_exact_count: candidatePoolExactCount,
        ranked_top3_exact_count: rankedTop3ExactCount,
        execution_modes_valid: executionModesValid,
        reasons: Object.freeze(reasons),
      }),
      usage,
      rows: Object.freeze(rows),
      result_sha256: sha256(JSON.stringify(identityBody)),
    });
  } finally {
    await session?.close?.();
  }
}
