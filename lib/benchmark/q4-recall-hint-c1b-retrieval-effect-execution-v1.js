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
import {
  buildQ4RecallHintC1ManifestV1,
  flattenQ4RecallHintC1MemoryRecordsV1,
} from "./q4-recall-hint-c1-manifest-v1.js";
import { materializeQ4RecallHintC1CorpusV1 } from "./q4-recall-hint-c1-baseline-preflight-v1.js";
import { createBenchmarkHybridRuntime } from "./longmemeval-retrieval-runner-v1.js";
import { buildQ4RecallHintC1BDevelopmentHintsV1 } from "./q4-recall-hint-c1b-development-hints-v1.js";
import {
  Q4_C1B_EMBEDDING_PRICE_USD_PER_MILLION,
  Q4_C1B_RETRIEVAL_EFFECT_MAX_COST_USD,
  Q4_C1B_RERANK_PRICE_USD_PER_MILLION,
  buildQ4RecallHintC1BRetrievalEffectContractV1,
} from "./q4-recall-hint-c1b-retrieval-effect-contract-v1.js";
import { evaluateQ4RecallHintCases } from "./q4-recall-hint-evaluation-v1.js";

export const Q4_C1B_RETRIEVAL_EFFECT_EXECUTION_SCHEMA = "memory_engine_q4_recall_hint_c1b_retrieval_effect_execution_v1";

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
  const embedding = embeddingRequests
    * contract.embedding.max_input_tokens_per_request
    * Q4_C1B_EMBEDDING_PRICE_USD_PER_MILLION / 1_000_000;
  const rerank = rerankRequests
    * contract.rerank.candidate_depth
    * contract.rerank.max_pair_tokens
    * Q4_C1B_RERANK_PRICE_USD_PER_MILLION / 1_000_000;
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

async function defaultVectorStoreFactory(path) {
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

async function materializeVectorCorpus({ corpus, materialized, runtime, table, embed }) {
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
  return rows.length;
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

async function runArm({ row, plan, runtime, contract, rerankProfile }) {
  runtime.vectorQueryPlan = plan;
  runtime.offlineRerankProfile = null;
  const started = performance.now();
  const poolSearch = await hybridSearch(row.query, { topK: contract.candidate_depth }, runtime);
  validateVectorSearch(poolSearch, plan);
  const candidatePoolIds = uniqueResultIds(poolSearch.results, contract.candidate_depth);

  runtime.offlineRerankProfile = rerankProfile;
  const rankedSearch = await hybridSearch(row.query, { topK: contract.top_k }, runtime);
  validateVectorSearch(rankedSearch, plan);
  validateRerankSearch(rankedSearch, contract);
  const rankedTop3Ids = uniqueResultIds(rankedSearch.results, contract.top_k);
  return {
    candidate_pool_ids: candidatePoolIds,
    ranked_top3_ids: rankedTop3Ids,
    latency_ms: performance.now() - started,
  };
}

export async function runQ4RecallHintC1BRetrievalEffectV1({
  corpus,
  hintSnapshot = null,
  embeddingProvider,
  rerankAdapter,
  vectorStoreFactory = defaultVectorStoreFactory,
  keepTemp = false,
} = {}) {
  if (typeof embeddingProvider !== "function") throw fail("Q4_C1B_RETRIEVAL_EMBEDDING_PROVIDER_REQUIRED");
  if (typeof rerankAdapter !== "function") throw fail("Q4_C1B_RETRIEVAL_RERANK_ADAPTER_REQUIRED");
  if (typeof vectorStoreFactory !== "function") throw fail("Q4_C1B_RETRIEVAL_VECTOR_STORE_FACTORY_REQUIRED");

  const hints = hintSnapshot || buildQ4RecallHintC1BDevelopmentHintsV1(corpus);
  const contract = buildQ4RecallHintC1BRetrievalEffectContractV1({ corpus, hintSnapshot: hints });
  const manifest = buildQ4RecallHintC1ManifestV1(corpus);
  const developmentIds = new Set(manifest.development.map(row => row.case_id));
  const caseById = new Map(corpus.cases.map(row => [row.case_id, row]));
  const hintById = new Map(hints.rows.map(row => [row.case_id, row]));
  const materialized = materializeQ4RecallHintC1CorpusV1(corpus);
  let benchmarkRuntime = null;
  let vectorStore = null;
  const embeddingCache = new Map();
  let embeddingRequests = 0;
  let embeddingCacheHits = 0;
  let rerankRequests = 0;

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
    const costUpper = costUpperBoundForObservedRequests({
      embeddingRequests: nextEmbeddingRequests,
      rerankRequests,
      contract,
    });
    if (costUpper > Q4_C1B_RETRIEVAL_EFFECT_MAX_COST_USD + 1e-12) {
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
    const costUpper = costUpperBoundForObservedRequests({ embeddingRequests, rerankRequests, contract });
    if (costUpper > Q4_C1B_RETRIEVAL_EFFECT_MAX_COST_USD + 1e-12) {
      throw fail("Q4_C1B_RETRIEVAL_COST_CAP_EXCEEDED");
    }
    return rerankAdapter(query, documents, signal);
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
    await materializeVectorCorpus({
      corpus,
      materialized,
      runtime: benchmarkRuntime,
      table: vectorStore.table,
      embed,
    });

    const rerankProfile = createOfflineProfile(countedRerankAdapter);
    const rows = [];
    for (const caseId of manifest.development.map(row => row.case_id)) {
      if (!developmentIds.has(caseId)) throw fail("Q4_C1B_RETRIEVAL_CASE_SCOPE_INVALID");
      const row = caseById.get(caseId);
      const hint = hintById.get(caseId);
      if (!row || !hint) throw fail("Q4_C1B_RETRIEVAL_CASE_OR_HINT_MISSING");

      const baseline = await runArm({
        row,
        plan: null,
        runtime: benchmarkRuntime.runtime,
        contract,
        rerankProfile,
      });
      const hintRun = await runArm({
        row,
        plan: hint.query_plan,
        runtime: benchmarkRuntime.runtime,
        contract,
        rerankProfile,
      });
      rows.push({
        case_id: row.case_id,
        split: "development",
        family: row.family,
        gold_evidence_ids: row.gold_evidence_ids,
        baseline,
        hint: {
          ...hintRun,
          provider_calls: 0,
          extra_embedding_calls: hint.query_plan?.queries?.length || 0,
          extra_vector_search_calls: hint.query_plan?.queries?.length || 0,
          provider_input_tokens: 0,
          provider_output_tokens: 0,
          hint_status: hint.query_plan ? "expanded" : "empty",
          fallback: false,
        },
      });
    }

    if (rerankRequests !== contract.rerank.max_provider_requests) {
      throw fail("Q4_C1B_RETRIEVAL_RERANK_REQUEST_COUNT_MISMATCH", { rerankRequests });
    }
    if (embeddingRequests > contract.embedding.max_provider_requests) {
      throw fail("Q4_C1B_RETRIEVAL_EMBEDDING_REQUEST_COUNT_MISMATCH", { embeddingRequests });
    }
    const costUpperBoundUsd = costUpperBoundForObservedRequests({ embeddingRequests, rerankRequests, contract });
    if (costUpperBoundUsd > contract.cost_binding.max_cost_usd + 1e-12) {
      throw fail("Q4_C1B_RETRIEVAL_COST_CAP_EXCEEDED");
    }

    return Object.freeze({
      schema: Q4_C1B_RETRIEVAL_EFFECT_EXECUTION_SCHEMA,
      contract,
      provider_usage: Object.freeze({
        embedding_requests: embeddingRequests,
        embedding_cache_hits: embeddingCacheHits,
        rerank_requests: rerankRequests,
        cost_upper_bound_usd: costUpperBoundUsd,
      }),
      evaluation: evaluateQ4RecallHintCases(rows),
    });
  } catch (error) {
    if (error && typeof error === "object") {
      error.q4_provider_usage = Object.freeze({
        embedding_requests: embeddingRequests,
        embedding_cache_hits: embeddingCacheHits,
        rerank_requests: rerankRequests,
        cost_upper_bound_usd: costUpperBoundForObservedRequests({ embeddingRequests, rerankRequests, contract }),
      });
    }
    throw error;
  } finally {
    benchmarkRuntime?.close();
    await vectorStore?.close?.();
    if (!keepTemp) {
      const { rmSync } = await import("node:fs");
      rmSync(materialized.root, { recursive: true, force: true });
    }
  }
}
