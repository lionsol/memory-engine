import { createHash } from "node:crypto";

import { CANONICAL_VECTOR_PROJECTION_VERSION, CANONICAL_VECTOR_TEXT_MAX_CHARS } from "../canonical/vector-projection.js";
import { R3_C1_B_PROVIDER_PROFILE } from "../recall/hybrid/explicit-search-rerank-provider-policy.js";
import {
  SILICONFLOW_RERANK_ENDPOINT,
  SILICONFLOW_RERANK_LIMITS,
  SILICONFLOW_RERANK_MODEL_0_6B,
  SILICONFLOW_RERANK_PROVIDER,
} from "../recall/rerank/siliconflow-rerank-adapter.js";
import {
  SEMANTIC_EMBEDDING_MODEL,
  SEMANTIC_EMBEDDING_MODEL_REVISION,
  SEMANTIC_EMBEDDING_PROVIDER,
  SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
  SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD,
} from "./longmemeval-semantic-retrieval-runner-v1.js";
import {
  Q4_RECALL_HINT_C1_FROZEN_IDENTITY,
  buildQ4RecallHintC1ManifestV1,
} from "./q4-recall-hint-c1-manifest-v1.js";
import {
  Q4_RECALL_HINT_C1B_MAX_INPUT_TOKENS_PER_REQUEST,
  Q4_RECALL_HINT_C1B_MAX_OUTPUT_TOKENS_PER_REQUEST,
} from "./q4-recall-hint-c1b-provider-contract-v1.js";
import {
  Q4_C1B_SF_BILLING_CURRENCY,
  Q4_C1B_SF_ENDPOINT,
  Q4_C1B_SF_INPUT_PRICE_PER_MILLION,
  Q4_C1B_SF_MODEL,
  Q4_C1B_SF_OUTPUT_PRICE_PER_MILLION,
  Q4_C1B_SF_PROVIDER,
  buildQ4RecallHintC1BSiliconFlowPacketV1,
} from "./q4-recall-hint-c1b-siliconflow-v4flash-v1.js";
import {
  Q4_C1B_EMBEDDING_DEADLINE_MS,
  Q4_C1B_EMBEDDING_ENDPOINT,
  Q4_C1B_EMBEDDING_MAX_INPUT_TOKENS_PER_REQUEST,
  Q4_C1B_EMBEDDING_MAX_RESPONSE_BYTES,
  Q4_C1B_EMBEDDING_PRICE_USD_PER_MILLION,
  Q4_C1B_RERANK_PRICE_USD_PER_MILLION,
  Q4_C1B_VECTOR_SEARCH_TOP_K,
} from "./q4-recall-hint-c1b-retrieval-effect-contract-v1.js";
import { Q4_RECALL_HINT_MAX_POOL_DEPTH, Q4_RECALL_HINT_TOP_K } from "./q4-recall-hint-evaluation-v1.js";

export const Q4_C1B_ACCEPTANCE_CONTRACT_SCHEMA = "memory_engine_q4_recall_hint_c1b_acceptance_contract_v1";
export const Q4_C1B_ACCEPTANCE_PROFILE = "q4_c1b_acceptance_transaction_v1";
export const Q4_C1B_ACCEPTANCE_CASE_COUNT = 32;
export const Q4_C1B_ACCEPTANCE_CASES_PER_FAMILY = 8;
export const Q4_C1B_ACCEPTANCE_CORPUS_RECORD_COUNT = 72;
export const Q4_C1B_ACCEPTANCE_MAX_EXPANSION_QUERIES = 64;
export const Q4_C1B_ACCEPTANCE_MAX_EMBEDDING_REQUESTS = 168;
export const Q4_C1B_ACCEPTANCE_MAX_RERANK_REQUESTS = 64;
export const Q4_C1B_ACCEPTANCE_PRODUCER_MAX_REQUESTS = 32;
export const Q4_C1B_ACCEPTANCE_PRODUCER_MAX_INPUT_TOKENS = 65_536;
export const Q4_C1B_ACCEPTANCE_PRODUCER_MAX_OUTPUT_TOKENS = 8_192;
export const Q4_C1B_ACCEPTANCE_PRODUCER_MAX_COST_CNY = 0.30;
export const Q4_C1B_ACCEPTANCE_SEMANTIC_MAX_COST_USD = 0.30;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function roundMoney(value) {
  return Number(Number(value).toFixed(8));
}

function semanticCostBinding() {
  const embeddingMaxTokens = Q4_C1B_ACCEPTANCE_MAX_EMBEDDING_REQUESTS
    * Q4_C1B_EMBEDDING_MAX_INPUT_TOKENS_PER_REQUEST;
  const rerankMaxTokens = Q4_C1B_ACCEPTANCE_MAX_RERANK_REQUESTS
    * R3_C1_B_PROVIDER_PROFILE.candidateDepth
    * SILICONFLOW_RERANK_LIMITS.maxPairTokens;
  const embeddingCost = embeddingMaxTokens * Q4_C1B_EMBEDDING_PRICE_USD_PER_MILLION / 1_000_000;
  const rerankCost = rerankMaxTokens * Q4_C1B_RERANK_PRICE_USD_PER_MILLION / 1_000_000;
  return Object.freeze({
    status: "FROZEN",
    billing_currency: "USD",
    embedding_price_usd_per_million_input_tokens: Q4_C1B_EMBEDDING_PRICE_USD_PER_MILLION,
    rerank_price_usd_per_million_input_tokens: Q4_C1B_RERANK_PRICE_USD_PER_MILLION,
    embedding_max_input_tokens: embeddingMaxTokens,
    rerank_max_input_tokens: rerankMaxTokens,
    embedding_cost_upper_bound_usd: roundMoney(embeddingCost),
    rerank_cost_upper_bound_usd: roundMoney(rerankCost),
    theoretical_max_cost_usd: roundMoney(embeddingCost + rerankCost),
    max_cost_usd: Q4_C1B_ACCEPTANCE_SEMANTIC_MAX_COST_USD,
  });
}

function producerCostBinding() {
  const theoretical = (
    Q4_C1B_ACCEPTANCE_PRODUCER_MAX_INPUT_TOKENS * Q4_C1B_SF_INPUT_PRICE_PER_MILLION
    + Q4_C1B_ACCEPTANCE_PRODUCER_MAX_OUTPUT_TOKENS * Q4_C1B_SF_OUTPUT_PRICE_PER_MILLION
  ) / 1_000_000;
  return Object.freeze({
    status: "FROZEN",
    billing_currency: Q4_C1B_SF_BILLING_CURRENCY,
    input_price_per_million: Q4_C1B_SF_INPUT_PRICE_PER_MILLION,
    output_price_per_million: Q4_C1B_SF_OUTPUT_PRICE_PER_MILLION,
    theoretical_max_cost: roundMoney(theoretical),
    max_cost: Q4_C1B_ACCEPTANCE_PRODUCER_MAX_COST_CNY,
  });
}

export function buildQ4RecallHintC1BAcceptanceContractV1({ corpus, sourceCommit } = {}) {
  if (typeof sourceCommit !== "string" || sourceCommit.trim() === "") {
    throw fail("Q4_C1B_ACCEPTANCE_SOURCE_COMMIT_REQUIRED");
  }
  const manifest = buildQ4RecallHintC1ManifestV1(corpus);
  if (manifest.manifest_sha256 !== Q4_RECALL_HINT_C1_FROZEN_IDENTITY.manifest_sha256
      || manifest.acceptance_sha256 !== Q4_RECALL_HINT_C1_FROZEN_IDENTITY.acceptance_sha256
      || manifest.population?.acceptance_count !== Q4_C1B_ACCEPTANCE_CASE_COUNT
      || manifest.population?.memory_record_count !== Q4_C1B_ACCEPTANCE_CORPUS_RECORD_COUNT) {
    throw fail("Q4_C1B_ACCEPTANCE_FROZEN_IDENTITY_MISMATCH");
  }

  const packet = buildQ4RecallHintC1BSiliconFlowPacketV1({ manifest, sourceCommit: sourceCommit.trim() });
  const semanticCost = semanticCostBinding();
  const producerCost = producerCostBinding();
  if (semanticCost.theoretical_max_cost_usd > Q4_C1B_ACCEPTANCE_SEMANTIC_MAX_COST_USD + 1e-12) {
    throw fail("Q4_C1B_ACCEPTANCE_SEMANTIC_COST_CAP_TOO_LOW");
  }
  if (producerCost.theoretical_max_cost > Q4_C1B_ACCEPTANCE_PRODUCER_MAX_COST_CNY + 1e-12) {
    throw fail("Q4_C1B_ACCEPTANCE_PRODUCER_COST_CAP_TOO_LOW");
  }

  const body = {
    schema: Q4_C1B_ACCEPTANCE_CONTRACT_SCHEMA,
    profile: Q4_C1B_ACCEPTANCE_PROFILE,
    source_commit: sourceCommit.trim(),
    scope: "acceptance_only",
    manifest_sha256: manifest.manifest_sha256,
    acceptance_sha256: manifest.acceptance_sha256,
    case_count: Q4_C1B_ACCEPTANCE_CASE_COUNT,
    cases_per_family: Q4_C1B_ACCEPTANCE_CASES_PER_FAMILY,
    corpus_record_count: Q4_C1B_ACCEPTANCE_CORPUS_RECORD_COUNT,
    candidate_depth: Q4_RECALL_HINT_MAX_POOL_DEPTH,
    top_k: Q4_RECALL_HINT_TOP_K,
    execution_policy: {
      max_executions: 1,
      baseline_before_producer: true,
      producer_before_hint_semantic: true,
      automatic_retry: false,
      resume: false,
      replay: false,
      tuning_after_baseline_read: false,
      tuning_after_acceptance_start: false,
    },
    baseline_eligibility: {
      protection_pool_complete_required: true,
      protection_recall_all_at_3_required: 1,
      target_family_pool_miss_minimum: 1,
      target_families: ["entity_reference", "temporal_relation", "multi_facet"],
    },
    producer: {
      provider: Q4_C1B_SF_PROVIDER,
      model: Q4_C1B_SF_MODEL,
      endpoint: Q4_C1B_SF_ENDPOINT,
      revision: packet.revision,
      prompt_sha256: packet.prompt_sha256,
      output_schema_sha256: packet.output_schema_sha256,
      max_provider_requests: Q4_C1B_ACCEPTANCE_PRODUCER_MAX_REQUESTS,
      max_input_tokens_per_request: Q4_RECALL_HINT_C1B_MAX_INPUT_TOKENS_PER_REQUEST,
      max_output_tokens_per_request: Q4_RECALL_HINT_C1B_MAX_OUTPUT_TOKENS_PER_REQUEST,
      max_total_input_tokens: Q4_C1B_ACCEPTANCE_PRODUCER_MAX_INPUT_TOKENS,
      max_total_output_tokens: Q4_C1B_ACCEPTANCE_PRODUCER_MAX_OUTPUT_TOKENS,
      deadline_ms: packet.deadline_ms,
      temperature: packet.temperature,
      cost_binding: producerCost,
    },
    candidate_generation: {
      fts: true,
      vector: true,
      kg: false,
      recent: false,
      lexical_confidence_threshold: SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD,
      vector_search_top_k: Q4_C1B_VECTOR_SEARCH_TOP_K,
    },
    embedding: {
      provider: SEMANTIC_EMBEDDING_PROVIDER,
      model: SEMANTIC_EMBEDDING_MODEL,
      revision: SEMANTIC_EMBEDDING_MODEL_REVISION,
      endpoint: Q4_C1B_EMBEDDING_ENDPOINT,
      dimension: SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
      canonical_projection_version: CANONICAL_VECTOR_PROJECTION_VERSION,
      canonical_vector_text_max_chars: CANONICAL_VECTOR_TEXT_MAX_CHARS,
      shared_cache_required: true,
      corpus_embedding_inputs: Q4_C1B_ACCEPTANCE_CORPUS_RECORD_COUNT,
      original_query_inputs: Q4_C1B_ACCEPTANCE_CASE_COUNT,
      max_hint_expansion_inputs: Q4_C1B_ACCEPTANCE_MAX_EXPANSION_QUERIES,
      max_provider_requests: Q4_C1B_ACCEPTANCE_MAX_EMBEDDING_REQUESTS,
      max_input_tokens_per_request: Q4_C1B_EMBEDDING_MAX_INPUT_TOKENS_PER_REQUEST,
      max_total_input_tokens: semanticCost.embedding_max_input_tokens,
      deadline_ms: Q4_C1B_EMBEDDING_DEADLINE_MS,
      max_response_bytes: Q4_C1B_EMBEDDING_MAX_RESPONSE_BYTES,
    },
    rerank: {
      provider: SILICONFLOW_RERANK_PROVIDER,
      model: SILICONFLOW_RERANK_MODEL_0_6B,
      revision: R3_C1_B_PROVIDER_PROFILE.adapterIdentity.revision,
      endpoint: SILICONFLOW_RERANK_ENDPOINT,
      candidate_depth: R3_C1_B_PROVIDER_PROFILE.candidateDepth,
      max_code_points_per_candidate: R3_C1_B_PROVIDER_PROFILE.maxCodePointsPerCandidate,
      max_total_code_points: R3_C1_B_PROVIDER_PROFILE.maxTotalCodePoints,
      deadline_ms: R3_C1_B_PROVIDER_PROFILE.deadlineMs,
      baseline_max_requests: Q4_C1B_ACCEPTANCE_CASE_COUNT,
      hint_max_requests: Q4_C1B_ACCEPTANCE_CASE_COUNT,
      max_provider_requests: Q4_C1B_ACCEPTANCE_MAX_RERANK_REQUESTS,
      max_pair_tokens: SILICONFLOW_RERANK_LIMITS.maxPairTokens,
      max_total_input_tokens: semanticCost.rerank_max_input_tokens,
    },
    cost_binding: semanticCost,
    egress: {
      producer_allow: ["acceptance_current_query", "bounded_caller_context"],
      embedding_allow: [
        "synthetic_canonical_vector_projection_text",
        "acceptance_original_query",
        "acceptance_hint_expansion_query",
      ],
      rerank_allow: ["acceptance_original_query", "bounded_synthetic_canonical_candidate_text"],
      deny: ["gold_evidence_ids", "case_labels", "retrieval_results", "full_session", "tool_trace", "live_memory"],
    },
    mutation: {
      live_core: "DENY",
      live_engine: "DENY",
      live_lancedb: "DENY",
      runtime_config: "DENY",
      autorecall: "DENY",
      deployment: "DENY",
      temporary_benchmark_artifacts: "ALLOW",
    },
  };

  return Object.freeze({
    ...body,
    execution_binding_sha256: sha256(JSON.stringify(body)),
    producer_packet: packet,
  });
}
