import { createHash } from "node:crypto";

import { buildQ4RecallHintC1ManifestV1 } from "./q4-recall-hint-c1-manifest-v1.js";
import { buildQ4RecallHintC1BDevelopmentHintsV1 } from "./q4-recall-hint-c1b-development-hints-v1.js";
import { buildQ4RecallHintC1BRetrievalEffectContractV1 } from "./q4-recall-hint-c1b-retrieval-effect-contract-v1.js";

export const RH_L1_PERFORMANCE_CONTRACT_SCHEMA = "memory_engine_rh_l1_performance_contract_v1";
export const RH_L1_PERFORMANCE_PROFILE = "rh_l1_sequential_vs_parallel_real_provider_v1";
export const RH_L1_TARGET_CASE_COUNT = 12;
export const RH_L1_TARGET_EXPANSION_COUNT = 19;
export const RH_L1_SESSION_EMBEDDING_REQUEST_CAP = 99;
export const RH_L1_SESSION_RERANK_REQUEST_CAP = 12;
export const RH_L1_TOTAL_EMBEDDING_REQUEST_CAP = 198;
export const RH_L1_TOTAL_RERANK_REQUEST_CAP = 24;
export const RH_L1_SESSION_MAX_COST_USD = 0.095;
export const RH_L1_TOTAL_MAX_COST_USD = 0.19;
export const RH_L1_TOTAL_THEORETICAL_MAX_COST_USD = 0.18874368;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function stableTargetPlans(corpus, hints) {
  const caseById = new Map(corpus.cases.map(row => [row.case_id, row]));
  const rows = hints.rows
    .filter(row => row.query_plan?.queries?.length > 0)
    .map(row => {
      const record = caseById.get(row.case_id);
      if (!record) throw fail("RH_L1_TARGET_CASE_MISSING");
      return Object.freeze({
        case_id: row.case_id,
        family: row.family,
        query: record.query,
        query_plan: row.query_plan,
      });
    });
  if (rows.length !== RH_L1_TARGET_CASE_COUNT) throw fail("RH_L1_TARGET_CASE_COUNT_MISMATCH");
  const expansions = rows.reduce((sum, row) => sum + row.query_plan.queries.length, 0);
  if (expansions !== RH_L1_TARGET_EXPANSION_COUNT) throw fail("RH_L1_TARGET_EXPANSION_COUNT_MISMATCH");
  return Object.freeze(rows);
}

function buildSessionContract(base) {
  const embeddingMaxInputTokens = RH_L1_SESSION_EMBEDDING_REQUEST_CAP * base.embedding.max_input_tokens_per_request;
  const rerankMaxInputTokens = RH_L1_SESSION_RERANK_REQUEST_CAP
    * base.rerank.candidate_depth
    * base.rerank.max_pair_tokens;
  const embeddingCost = embeddingMaxInputTokens
    * base.cost_binding.embedding_price_usd_per_million_input_tokens / 1_000_000;
  const rerankCost = rerankMaxInputTokens
    * base.cost_binding.rerank_price_usd_per_million_input_tokens / 1_000_000;
  const theoretical = Number((embeddingCost + rerankCost).toFixed(8));
  if (theoretical > RH_L1_SESSION_MAX_COST_USD) throw fail("RH_L1_SESSION_COST_CAP_TOO_LOW");

  return Object.freeze({
    ...base,
    profile: RH_L1_PERFORMANCE_PROFILE,
    scope: "fixed_development_performance_material_only",
    quality_claim_scope: "none_performance_and_regression_only",
    case_count: RH_L1_TARGET_CASE_COUNT,
    acceptance_case_count: 0,
    embedding: Object.freeze({
      ...base.embedding,
      baseline_query_inputs: RH_L1_TARGET_CASE_COUNT,
      hint_expansion_inputs: RH_L1_TARGET_EXPANSION_COUNT,
      max_provider_requests: RH_L1_SESSION_EMBEDDING_REQUEST_CAP,
      max_total_input_tokens: embeddingMaxInputTokens,
    }),
    rerank: Object.freeze({
      ...base.rerank,
      baseline_max_requests: 0,
      hint_max_requests: RH_L1_SESSION_RERANK_REQUEST_CAP,
      max_provider_requests: RH_L1_SESSION_RERANK_REQUEST_CAP,
      max_total_input_tokens: rerankMaxInputTokens,
    }),
    producer: Object.freeze({
      provider_requests: 0,
      reuse_frozen_development_hints: true,
    }),
    cost_binding: Object.freeze({
      ...base.cost_binding,
      embedding_max_input_tokens: embeddingMaxInputTokens,
      rerank_max_input_tokens: rerankMaxInputTokens,
      embedding_cost_upper_bound_usd: Number(embeddingCost.toFixed(8)),
      rerank_cost_upper_bound_usd: Number(rerankCost.toFixed(8)),
      theoretical_max_cost_usd: theoretical,
      max_cost_usd: RH_L1_SESSION_MAX_COST_USD,
    }),
  });
}

export function buildRhL1PerformanceContractV1({ corpus, sourceCommit } = {}) {
  if (!corpus || !Array.isArray(corpus.cases)) throw fail("RH_L1_CORPUS_REQUIRED");
  if (typeof sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(sourceCommit)) {
    throw fail("RH_L1_SOURCE_COMMIT_INVALID");
  }
  const hints = buildQ4RecallHintC1BDevelopmentHintsV1(corpus);
  const base = buildQ4RecallHintC1BRetrievalEffectContractV1({ corpus, hintSnapshot: hints });
  const targetPlans = stableTargetPlans(corpus, hints);
  const manifest = buildQ4RecallHintC1ManifestV1(corpus);
  const targetPlanIdentity = targetPlans.map(row => ({
    case_id: row.case_id,
    family: row.family,
    query: row.query,
    queries: [...row.query_plan.queries],
  }));
  const targetPlansSha256 = sha256(JSON.stringify(targetPlanIdentity));
  const logicalQueryInputs = targetPlans.flatMap(row => [row.query, ...row.query_plan.queries]);
  const distinctQueryInputCount = new Set(logicalQueryInputs).size;
  if (distinctQueryInputCount !== 27) throw fail("RH_L1_DISTINCT_QUERY_INPUT_COUNT_MISMATCH");
  const sessionContract = buildSessionContract(base);
  const body = {
    schema: RH_L1_PERFORMANCE_CONTRACT_SCHEMA,
    profile: RH_L1_PERFORMANCE_PROFILE,
    source_commit: sourceCommit,
    scope: "real_provider_execution_performance_only",
    quality_claim_scope: "NONE",
    producer_requests: 0,
    corpus_manifest_sha256: manifest.manifest_sha256,
    development_sha256: manifest.development_sha256,
    frozen_hint_snapshot_sha256: hints.hints_sha256,
    target_plans_sha256: targetPlansSha256,
    target_case_count: RH_L1_TARGET_CASE_COUNT,
    target_expansion_count: RH_L1_TARGET_EXPANSION_COUNT,
    target_logical_query_input_count: logicalQueryInputs.length,
    target_distinct_query_input_count: distinctQueryInputCount,
    arm_order: "case_index_even_sequential_first_odd_parallel_first",
    execution_modes: Object.freeze(["sequential", "parallel"]),
    session_contract: sessionContract,
    total_budget: Object.freeze({
      embedding_requests: RH_L1_TOTAL_EMBEDDING_REQUEST_CAP,
      rerank_requests: RH_L1_TOTAL_RERANK_REQUEST_CAP,
      theoretical_max_cost_usd: RH_L1_TOTAL_THEORETICAL_MAX_COST_USD,
      max_cost_usd: RH_L1_TOTAL_MAX_COST_USD,
    }),
    gates: Object.freeze({
      exact_candidate_pool_equivalence: true,
      exact_ranked_top3_equivalence: true,
      equal_embedding_request_counts: true,
      equal_rerank_request_counts: true,
      sequential_max_embedding_concurrency_lte: 1,
      parallel_min_embedding_concurrency_gte: 2,
      pool_vector_p50_speedup_min_fraction: 0.20,
      full_semantic_p50_speedup_min_fraction: 0.10,
      full_semantic_p95_regression_max_fraction: 0.20,
      provider_error_count_max: 0,
      automatic_retry_count_max: 0,
    }),
    egress: Object.freeze({
      embedding_allow: Object.freeze([
        "synthetic_canonical_vector_projection_text",
        "frozen_development_original_query",
        "frozen_development_hint_expansion_query",
      ]),
      rerank_allow: Object.freeze([
        "frozen_development_original_query",
        "bounded_synthetic_canonical_candidate_text",
      ]),
      deny: Object.freeze([
        "gold_evidence_ids",
        "acceptance_cases",
        "full_session",
        "tool_trace",
        "live_memory",
        "recall_hint_producer_request",
      ]),
    }),
    mutation: Object.freeze({
      live_core: "DENY",
      live_engine: "DENY",
      live_lancedb: "DENY",
      runtime_config: "DENY",
      deployment: "DENY",
      temporary_benchmark_artifacts: "ALLOW",
    }),
    retry_policy: "NO_RETRY_NO_RESUME_NO_REPLAY",
  };
  const contractSha256 = sha256(JSON.stringify(body));
  const executionBindingSha256 = sha256(JSON.stringify({
    source_commit: sourceCommit,
    contract_sha256: contractSha256,
  }));
  return Object.freeze({
    ...body,
    target_plans: targetPlans,
    contract_sha256: contractSha256,
    execution_binding_sha256: executionBindingSha256,
  });
}
