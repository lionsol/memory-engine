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
import { buildQ4RecallHintC1ManifestV1 } from "./q4-recall-hint-c1-manifest-v1.js";
import { summarizeQ4RecallHintC1BDevelopmentHintsV1 } from "./q4-recall-hint-c1b-development-hints-v1.js";
import { Q4_RECALL_HINT_MAX_POOL_DEPTH, Q4_RECALL_HINT_TOP_K } from "./q4-recall-hint-evaluation-v1.js";

export const Q4_C1B_RETRIEVAL_EFFECT_CONTRACT_SCHEMA = "memory_engine_q4_recall_hint_c1b_retrieval_effect_contract_v1";
export const Q4_C1B_RETRIEVAL_EFFECT_PROFILE = "q4_c1b_semantic_rerank_development_v1";
export const Q4_C1B_EMBEDDING_ENDPOINT = "https://api.siliconflow.cn/v1/embeddings";
export const Q4_C1B_DEVELOPMENT_CASE_COUNT = 16;
export const Q4_C1B_CORPUS_RECORD_COUNT = 72;
export const Q4_C1B_DEVELOPMENT_BASELINE_QUERY_COUNT = 16;
export const Q4_C1B_DEVELOPMENT_RERANK_CALLS_PER_ARM = 16;
export const Q4_C1B_DEVELOPMENT_MAX_RERANK_REQUESTS = 32;
export const Q4_C1B_RETRIEVAL_EFFECT_ACCEPTANCE_REQUESTS = 0;
export const Q4_C1B_VECTOR_SEARCH_TOP_K = 50;
export const Q4_C1B_EMBEDDING_MAX_INPUT_TOKENS_PER_REQUEST = 32_768;
export const Q4_C1B_EMBEDDING_DEADLINE_MS = 15_000;
export const Q4_C1B_EMBEDDING_MAX_RESPONSE_BYTES = 524_288;
export const Q4_C1B_EMBEDDING_PRICE_USD_PER_MILLION = 0.02;
export const Q4_C1B_RERANK_PRICE_USD_PER_MILLION = 0.01;
export const Q4_C1B_RETRIEVAL_EFFECT_MAX_COST_USD = 0.20;
export const Q4_C1B_COST_BINDING_SOURCE = "SiliconFlow current model pages + project R3-C1 0.6B observed billing";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function expectedEmbeddingRequestCap(expansionQueryCount) {
  return Q4_C1B_CORPUS_RECORD_COUNT
    + Q4_C1B_DEVELOPMENT_BASELINE_QUERY_COUNT
    + expansionQueryCount;
}

function roundUsd(value) {
  return Number(Number(value).toFixed(8));
}

function costUpperBound(maxEmbeddingRequests) {
  const embeddingMaxTokens = maxEmbeddingRequests * Q4_C1B_EMBEDDING_MAX_INPUT_TOKENS_PER_REQUEST;
  const rerankMaxTokens = Q4_C1B_DEVELOPMENT_MAX_RERANK_REQUESTS
    * R3_C1_B_PROVIDER_PROFILE.candidateDepth
    * SILICONFLOW_RERANK_LIMITS.maxPairTokens;
  const embeddingCost = embeddingMaxTokens * Q4_C1B_EMBEDDING_PRICE_USD_PER_MILLION / 1_000_000;
  const rerankCost = rerankMaxTokens * Q4_C1B_RERANK_PRICE_USD_PER_MILLION / 1_000_000;
  return Object.freeze({
    embedding_max_input_tokens: embeddingMaxTokens,
    rerank_max_input_tokens: rerankMaxTokens,
    embedding_cost_usd: roundUsd(embeddingCost),
    rerank_cost_usd: roundUsd(rerankCost),
    theoretical_max_cost_usd: roundUsd(embeddingCost + rerankCost),
  });
}

export function buildQ4RecallHintC1BRetrievalEffectContractV1({ corpus, hintSnapshot } = {}) {
  if (!corpus || !Array.isArray(corpus.cases)) throw fail("Q4_C1B_RETRIEVAL_CORPUS_REQUIRED");
  const manifest = buildQ4RecallHintC1ManifestV1(corpus);
  if (manifest.population?.memory_record_count !== Q4_C1B_CORPUS_RECORD_COUNT) {
    throw fail("Q4_C1B_RETRIEVAL_CORPUS_COUNT_MISMATCH");
  }
  if (manifest.population?.development_count !== Q4_C1B_DEVELOPMENT_CASE_COUNT) {
    throw fail("Q4_C1B_RETRIEVAL_DEVELOPMENT_COUNT_MISMATCH");
  }
  if (hintSnapshot?.manifest_sha256 !== manifest.manifest_sha256
      || hintSnapshot?.development_sha256 !== manifest.development_sha256) {
    throw fail("Q4_C1B_RETRIEVAL_HINT_IDENTITY_MISMATCH");
  }
  const hintSummary = summarizeQ4RecallHintC1BDevelopmentHintsV1(hintSnapshot);
  if (hintSummary.case_count !== Q4_C1B_DEVELOPMENT_CASE_COUNT) {
    throw fail("Q4_C1B_RETRIEVAL_HINT_COUNT_MISMATCH");
  }

  const maxEmbeddingRequests = expectedEmbeddingRequestCap(hintSummary.expansion_query_count);
  const costUpper = costUpperBound(maxEmbeddingRequests);
  if (costUpper.theoretical_max_cost_usd > Q4_C1B_RETRIEVAL_EFFECT_MAX_COST_USD) {
    throw fail("Q4_C1B_RETRIEVAL_COST_CAP_TOO_LOW");
  }
  return Object.freeze({
    schema: Q4_C1B_RETRIEVAL_EFFECT_CONTRACT_SCHEMA,
    profile: Q4_C1B_RETRIEVAL_EFFECT_PROFILE,
    scope: "development_only",
    quality_claim_scope: "targeted_synthetic_development_diagnostic_only",
    manifest_sha256: manifest.manifest_sha256,
    development_sha256: manifest.development_sha256,
    producer_result_sha256: hintSnapshot.provider_result_sha256,
    development_hints_sha256: hintSnapshot.hints_sha256,
    case_count: Q4_C1B_DEVELOPMENT_CASE_COUNT,
    acceptance_case_count: 0,
    corpus_record_count: Q4_C1B_CORPUS_RECORD_COUNT,
    candidate_depth: Q4_RECALL_HINT_MAX_POOL_DEPTH,
    top_k: Q4_RECALL_HINT_TOP_K,
    candidate_generation: Object.freeze({
      fts: true,
      vector: true,
      kg: false,
      recent: false,
      lexical_confidence_threshold: SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD,
      vector_search_top_k: Q4_C1B_VECTOR_SEARCH_TOP_K,
    }),
    arms: Object.freeze({
      baseline: Object.freeze({ original_query: true, recall_hint: false }),
      hint: Object.freeze({ original_query: true, recall_hint: true }),
    }),
    embedding: Object.freeze({
      provider: SEMANTIC_EMBEDDING_PROVIDER,
      model: SEMANTIC_EMBEDDING_MODEL,
      revision: SEMANTIC_EMBEDDING_MODEL_REVISION,
      endpoint: Q4_C1B_EMBEDDING_ENDPOINT,
      dimension: SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
      canonical_projection_version: CANONICAL_VECTOR_PROJECTION_VERSION,
      canonical_vector_text_max_chars: CANONICAL_VECTOR_TEXT_MAX_CHARS,
      shared_cache_required: true,
      corpus_embedding_inputs: Q4_C1B_CORPUS_RECORD_COUNT,
      baseline_query_inputs: Q4_C1B_DEVELOPMENT_BASELINE_QUERY_COUNT,
      hint_expansion_inputs: hintSummary.expansion_query_count,
      max_provider_requests: maxEmbeddingRequests,
      max_input_tokens_per_request: Q4_C1B_EMBEDDING_MAX_INPUT_TOKENS_PER_REQUEST,
      max_total_input_tokens: costUpper.embedding_max_input_tokens,
      deadline_ms: Q4_C1B_EMBEDDING_DEADLINE_MS,
      max_response_bytes: Q4_C1B_EMBEDDING_MAX_RESPONSE_BYTES,
    }),
    rerank: Object.freeze({
      provider: SILICONFLOW_RERANK_PROVIDER,
      model: SILICONFLOW_RERANK_MODEL_0_6B,
      revision: R3_C1_B_PROVIDER_PROFILE.adapterIdentity.revision,
      endpoint: SILICONFLOW_RERANK_ENDPOINT,
      candidate_depth: R3_C1_B_PROVIDER_PROFILE.candidateDepth,
      max_code_points_per_candidate: R3_C1_B_PROVIDER_PROFILE.maxCodePointsPerCandidate,
      max_total_code_points: R3_C1_B_PROVIDER_PROFILE.maxTotalCodePoints,
      deadline_ms: R3_C1_B_PROVIDER_PROFILE.deadlineMs,
      baseline_max_requests: Q4_C1B_DEVELOPMENT_RERANK_CALLS_PER_ARM,
      hint_max_requests: Q4_C1B_DEVELOPMENT_RERANK_CALLS_PER_ARM,
      max_provider_requests: Q4_C1B_DEVELOPMENT_MAX_RERANK_REQUESTS,
      max_pair_tokens: SILICONFLOW_RERANK_LIMITS.maxPairTokens,
      max_total_input_tokens: costUpper.rerank_max_input_tokens,
    }),
    producer: Object.freeze({
      provider_requests: 0,
      reuse_frozen_development_hints: true,
    }),
    egress: Object.freeze({
      embedding_allow: Object.freeze([
        "synthetic_canonical_vector_projection_text",
        "development_original_query",
        "development_hint_expansion_query",
      ]),
      rerank_allow: Object.freeze([
        "development_original_query",
        "bounded_canonical_candidate_text",
      ]),
      deny: Object.freeze([
        "gold_evidence_ids",
        "case_labels",
        "acceptance_cases",
        "full_session",
        "tool_trace",
        "live_memory",
      ]),
    }),
    mutation: Object.freeze({
      live_core: "DENY",
      live_engine: "DENY",
      live_lancedb: "DENY",
      runtime_config: "DENY",
      temporary_benchmark_artifacts: "ALLOW",
    }),
    cost_binding: Object.freeze({
      status: "FROZEN",
      billing_currency: "USD",
      embedding_price_usd_per_million_input_tokens: Q4_C1B_EMBEDDING_PRICE_USD_PER_MILLION,
      rerank_price_usd_per_million_input_tokens: Q4_C1B_RERANK_PRICE_USD_PER_MILLION,
      embedding_max_input_tokens: costUpper.embedding_max_input_tokens,
      rerank_max_input_tokens: costUpper.rerank_max_input_tokens,
      embedding_cost_upper_bound_usd: costUpper.embedding_cost_usd,
      rerank_cost_upper_bound_usd: costUpper.rerank_cost_usd,
      theoretical_max_cost_usd: costUpper.theoretical_max_cost_usd,
      max_cost_usd: Q4_C1B_RETRIEVAL_EFFECT_MAX_COST_USD,
      source: Q4_C1B_COST_BINDING_SOURCE,
    }),
  });
}
