import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { createLanceDbRuntime } from "../lancedb-runtime.js";
import { getCanonicalMemoriesByIds } from "../canonical/read-adapter.js";
import {
  materializeCanonicalLanceRow,
  projectCanonicalMemoryToVectorProjection,
} from "../canonical/vector-projection.js";
import { hybridSearch } from "../recall/hybrid-search.js";
import { R3_C1_B_PROVIDER_PROFILE } from "../recall/hybrid/explicit-search-rerank-provider-policy.js";
import { flattenQ4RecallHintC1MemoryRecordsV1 } from "./q4-recall-hint-c1-manifest-v1.js";
import { materializeQ4RecallHintC1CorpusV1 } from "./q4-recall-hint-c1-baseline-preflight-v1.js";
import { createBenchmarkHybridRuntime } from "./longmemeval-retrieval-runner-v1.js";

export const Q4_C1B_SEMANTIC_SESSION_SCHEMA = "memory_engine_q4_recall_hint_c1b_semantic_session_v1";

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function resultId(item) {
  const value = item?.memory_id ?? item?.id ?? null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueResultIds(results, limit) {
  const ids = [];
  const seen = new Set();
  for (const item of Array.isArray(results) ? results : []) {
    const id = resultId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

function requireEmbedding(vector, dimension) {
  const isVector = Array.isArray(vector) || (ArrayBuffer.isView(vector) && !(vector instanceof DataView));
  if (!isVector || vector.length !== dimension) throw fail("Q4_C1B_RETRIEVAL_EMBEDDING_DIMENSION_INVALID");
  const copy = Array.from(vector);
  if (!copy.every(Number.isFinite)) throw fail("Q4_C1B_RETRIEVAL_EMBEDDING_VALUE_INVALID");
  return copy;
}

function costUpperBoundForObservedRequests({ embeddingRequests, rerankRequests, contract }) {
  const embeddingPrice = contract?.cost_binding?.embedding_price_usd_per_million_input_tokens;
  const rerankPrice = contract?.cost_binding?.rerank_price_usd_per_million_input_tokens;
  if (!Number.isFinite(embeddingPrice) || !Number.isFinite(rerankPrice)) {
    throw fail("Q4_C1B_RETRIEVAL_COST_BINDING_INVALID");
  }
  const embedding = embeddingRequests
    * contract.embedding.max_input_tokens_per_request
    * embeddingPrice / 1_000_000;
  const rerank = rerankRequests
    * contract.rerank.candidate_depth
    * contract.rerank.max_pair_tokens
    * rerankPrice / 1_000_000;
  return Number((embedding + rerank).toFixed(8));
}

function validateVectorSearch(search, plan) {
  const debug = search?.debug || {};
  if (debug.vector_error || debug.vector_multi_query_failed === true) {
    throw fail("Q4_C1B_RETRIEVAL_VECTOR_FAILED");
  }
  if (debug.vector_stage !== "lancedb_search" || debug.vector_backend !== "lancedb") {
    throw fail("Q4_C1B_RETRIEVAL_VECTOR_NOT_APPLIED");
  }
  if (!Array.isArray(search?.channels) || !search.channels.includes("vector")) {
    throw fail("Q4_C1B_RETRIEVAL_VECTOR_CHANNEL_MISSING");
  }
  if (plan) {
    const expectedCount = 1 + plan.queries.length;
    if (debug.vector_query_mode !== "recall_hint_v1"
        || Number(debug.vector_query_count) !== expectedCount
        || Number(debug.vector_search_count) !== expectedCount) {
      throw fail("Q4_C1B_RETRIEVAL_HINT_VECTOR_PLAN_NOT_APPLIED");
    }
  }
}

function validateRerankSearch(search, contract) {
  const debug = search?.debug?.offline_rerank;
  if (!debug || debug.rerank_status !== "applied") throw fail("Q4_C1B_RETRIEVAL_RERANK_NOT_APPLIED");
  if (debug.candidate_depth !== contract.rerank.candidate_depth) {
    throw fail("Q4_C1B_RETRIEVAL_RERANK_DEPTH_MISMATCH");
  }
  const identity = debug.adapter_identity || {};
  if (identity.provider !== contract.rerank.provider
      || identity.model !== contract.rerank.model
      || (identity.revision ?? null) !== contract.rerank.revision) {
    throw fail("Q4_C1B_RETRIEVAL_RERANK_IDENTITY_MISMATCH");
  }
}

export async function defaultQ4RecallHintC1BVectorStoreFactoryV1(path) {
  const runtime = createLanceDbRuntime({
    dbPath: path,
    logger: { log() {}, warn() {} },
    readyTimeoutMs: 5_000,
  });
  if (await runtime.ensureLanceDBReady() !== true) throw fail("Q4_C1B_RETRIEVAL_LANCEDB_NOT_READY");
  const state = await runtime.getLanceDBRuntime({ timeoutMs: 5_000 });
  if (state?.readyState !== "ready" || !state.table) throw fail("Q4_C1B_RETRIEVAL_LANCEDB_TABLE_UNAVAILABLE");
  return { table: state.table };
}

async function materializeVectorCorpus({ corpus, runtime, table, embed }) {
  const memoryIds = flattenQ4RecallHintC1MemoryRecordsV1(corpus).map(row => row.id);
  const rows = await runtime.runtime.withHybridDbAccessScope(async ({ withCoreDb, withEngineDb }) => {
    const batch = getCanonicalMemoriesByIds(memoryIds, { withCoreDb, withEngineDb });
    if (!batch?.ok || !Array.isArray(batch.results) || batch.results.length !== memoryIds.length) {
      throw fail("Q4_C1B_RETRIEVAL_CANONICAL_BATCH_INVALID");
    }
    const output = [];
    for (const resolved of batch.results) {
      if (!resolved?.ok || !resolved.memory) throw fail("Q4_C1B_RETRIEVAL_CANONICAL_MEMORY_MISSING");
      const projection = projectCanonicalMemoryToVectorProjection(resolved.memory);
      const vector = await embed(projection.embedding_input);
      output.push(materializeCanonicalLanceRow(projection, {
        vector,
        timestamp: Number(resolved.memory.source?.updated_at || 1_800_000_000),
      }));
    }
    return output;
  });
  if (typeof table.add !== "function") throw fail("Q4_C1B_RETRIEVAL_VECTOR_TABLE_ADD_UNAVAILABLE");
  await table.add(rows);
}

function createOfflineProfile(adapter) {
  return Object.freeze({
    candidateDepth: R3_C1_B_PROVIDER_PROFILE.candidateDepth,
    maxCodePointsPerCandidate: R3_C1_B_PROVIDER_PROFILE.maxCodePointsPerCandidate,
    maxTotalCodePoints: R3_C1_B_PROVIDER_PROFILE.maxTotalCodePoints,
    deadlineMs: R3_C1_B_PROVIDER_PROFILE.deadlineMs,
    executeRerank: true,
    adapter,
  });
}

export async function createQ4RecallHintC1BSemanticSessionV1({
  corpus,
  contract,
  embeddingProvider,
  rerankAdapter,
  vectorStoreFactory = defaultQ4RecallHintC1BVectorStoreFactoryV1,
  keepTemp = false,
} = {}) {
  if (!contract || typeof contract !== "object") throw fail("Q4_C1B_RETRIEVAL_CONTRACT_REQUIRED");
  if (typeof embeddingProvider !== "function") throw fail("Q4_C1B_RETRIEVAL_EMBEDDING_PROVIDER_REQUIRED");
  if (typeof rerankAdapter !== "function") throw fail("Q4_C1B_RETRIEVAL_RERANK_ADAPTER_REQUIRED");
  if (typeof vectorStoreFactory !== "function") throw fail("Q4_C1B_RETRIEVAL_VECTOR_STORE_FACTORY_REQUIRED");

  const materialized = materializeQ4RecallHintC1CorpusV1(corpus);
  let benchmarkRuntime = null;
  let vectorStore = null;
  let closed = false;
  const embeddingCache = new Map();
  let embeddingRequests = 0;
  let embeddingCacheHits = 0;
  let rerankRequests = 0;

  const usage = () => Object.freeze({
    embedding_requests: embeddingRequests,
    embedding_cache_hits: embeddingCacheHits,
    rerank_requests: rerankRequests,
    cost_upper_bound_usd: costUpperBoundForObservedRequests({ embeddingRequests, rerankRequests, contract }),
  });

  const embed = async text => {
    const key = String(text);
    if (embeddingCache.has(key)) {
      embeddingCacheHits += 1;
      return embeddingCache.get(key);
    }
    const nextEmbeddingRequests = embeddingRequests + 1;
    if (nextEmbeddingRequests > contract.embedding.max_provider_requests) {
      throw fail("Q4_C1B_RETRIEVAL_EMBEDDING_REQUEST_BUDGET_EXCEEDED");
    }
    const nextCost = costUpperBoundForObservedRequests({
      embeddingRequests: nextEmbeddingRequests,
      rerankRequests,
      contract,
    });
    if (nextCost > contract.cost_binding.max_cost_usd + 1e-12) {
      throw fail("Q4_C1B_RETRIEVAL_COST_CAP_EXCEEDED");
    }
    embeddingRequests = nextEmbeddingRequests;
    const vector = requireEmbedding(await embeddingProvider(key), contract.embedding.dimension);
    embeddingCache.set(key, vector);
    return vector;
  };

  const countedRerankAdapter = async (query, documents, signal) => {
    if (rerankRequests + 1 > contract.rerank.max_provider_requests) {
      throw fail("Q4_C1B_RETRIEVAL_RERANK_REQUEST_BUDGET_EXCEEDED");
    }
    rerankRequests += 1;
    const nextCost = costUpperBoundForObservedRequests({ embeddingRequests, rerankRequests, contract });
    if (nextCost > contract.cost_binding.max_cost_usd + 1e-12) {
      throw fail("Q4_C1B_RETRIEVAL_COST_CAP_EXCEEDED");
    }
    return rerankAdapter(query, documents, signal);
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    benchmarkRuntime?.close();
    await vectorStore?.close?.();
    if (!keepTemp) {
      const { rmSync } = await import("node:fs");
      rmSync(materialized.root, { recursive: true, force: true });
    }
  };

  try {
    vectorStore = await vectorStoreFactory(join(materialized.root, "q4-semantic-lancedb"));
    if (!vectorStore?.table) throw fail("Q4_C1B_RETRIEVAL_VECTOR_TABLE_REQUIRED");
    benchmarkRuntime = createBenchmarkHybridRuntime(materialized, {
      topK: contract.candidate_depth,
      topKPolicyMax: contract.candidate_depth,
      vectorTable: vectorStore.table,
      generateEmbedding: embed,
      lexicalConfidenceThreshold: contract.candidate_generation.lexical_confidence_threshold,
      channelCapabilities: { isolatedKg: false, isolatedRecent: false },
      searchNowSec: 1_800_000_000,
    });
    await materializeVectorCorpus({ corpus, runtime: benchmarkRuntime, table: vectorStore.table, embed });
  } catch (error) {
    error.q4_provider_usage = usage();
    await close();
    throw error;
  }

  const rerankProfile = createOfflineProfile(countedRerankAdapter);
  const runArm = async ({ row, plan = null } = {}) => {
    if (closed) throw fail("Q4_C1B_RETRIEVAL_SESSION_CLOSED");
    if (!row || typeof row.query !== "string") throw fail("Q4_C1B_RETRIEVAL_CASE_REQUIRED");
    benchmarkRuntime.runtime.vectorQueryPlan = plan;
    benchmarkRuntime.runtime.offlineRerankProfile = null;
    const started = performance.now();
    const poolSearch = await hybridSearch(row.query, { topK: contract.candidate_depth }, benchmarkRuntime.runtime);
    validateVectorSearch(poolSearch, plan);
    const candidatePoolIds = uniqueResultIds(poolSearch.results, contract.candidate_depth);

    benchmarkRuntime.runtime.offlineRerankProfile = rerankProfile;
    const rankedSearch = await hybridSearch(row.query, { topK: contract.top_k }, benchmarkRuntime.runtime);
    validateVectorSearch(rankedSearch, plan);
    validateRerankSearch(rankedSearch, contract);
    return Object.freeze({
      candidate_pool_ids: candidatePoolIds,
      ranked_top3_ids: uniqueResultIds(rankedSearch.results, contract.top_k),
      latency_ms: performance.now() - started,
    });
  };

  return Object.freeze({
    schema: Q4_C1B_SEMANTIC_SESSION_SCHEMA,
    runArm,
    usage,
    close,
  });
}
