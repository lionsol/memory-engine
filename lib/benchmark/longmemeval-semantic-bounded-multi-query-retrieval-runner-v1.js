import { getSFBaseUrl } from "../siliconflow-runtime.js";
import {
  LONGMEMEVAL_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA,
  LONGMEMEVAL_SEMANTIC_PROFILE,
  LongMemEvalSemanticProfileError,
  SEMANTIC_EMBEDDING_PROVIDER,
  SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
  SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD,
  createBenchmarkEmbeddingCache,
  normalizeEmbeddingBaseUrlIdentity,
  runLongMemEvalSemanticRetrievalCase,
} from "./longmemeval-semantic-retrieval-runner-v1.js";
import {
  aggregateLongMemEvalRetrievalResults,
} from "./longmemeval-retrieval-runner-v1.js";
import {
  H2_QUERY_PLANNER_MODEL,
  H2_QUERY_PLANNER_MODEL_REVISION,
  H2_QUERY_PLANNER_PROMPT_VERSION,
  H2_QUERY_PLANNER_PROMPT_SHA256,
  H2_QUERY_PLANNER_PROVIDER,
  H2_QUERY_PLANNER_QUERY_COUNT,
  H2_QUERY_PLANNER_QUERY_MAX_CHARS,
  H2_QUERY_PLANNER_OUTPUT_SCHEMA_SHA256,
  H2_QUERY_PLANNER_TEMPERATURE,
  boundedMultiQueryPlannerProvenance,
  createSiliconFlowBoundedMultiQueryPlanner,
  parseBoundedMultiQueryPlannerResponse,
  validateCachedBoundedMultiQueryPlan,
} from "./longmemeval-bounded-multi-query-planner-v1.js";
import {
  H2_QUERY_PLAN_CACHE_SCHEMA,
  H2_QUERY_PLAN_CACHE_SQLITE_USER_VERSION,
  buildQueryPlanCacheKey,
  createBenchmarkQueryPlanCache,
} from "./longmemeval-query-plan-cache-v1.js";
import {
  LONGMEMEVAL_V1_SCHEMA,
  hasLongMemEvalUserTarget,
  normalizeLongMemEvalCase,
} from "./longmemeval-v1.js";
import { stripPromptMetadataPrefix } from "../../query-utils.js";

export const LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE =
  "production_hybrid_semantic_bounded_multi_query_session_v1";
export const H2_VECTOR_QUERY_MODE = "bounded_multi_query";
export const H2_VECTOR_QUERY_RRF_K = 60;

function officialSkipReason(item) {
  if (item.abstention) return "official_retrieval_abstention";
  return hasLongMemEvalUserTarget(item) ? null : "official_retrieval_no_user_target";
}

function stageError(stage, error) {
  if (error instanceof LongMemEvalSemanticProfileError) return error;
  return new LongMemEvalSemanticProfileError(stage, error?.message || String(error || "unknown error"));
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function validateCache(cache, stage, { owns = true } = {}) {
  if (!isObject(cache) || typeof cache.get !== "function" || typeof cache.set !== "function" ||
      (owns && typeof cache.close !== "function")) {
    throw new LongMemEvalSemanticProfileError(stage, "invalid benchmark query plan cache");
  }
}

function closeCache(cache, owns) {
  if (owns && typeof cache?.close === "function") cache.close();
}

function createPlanner({
  plannerProvider,
  plannerProviderFactory = createSiliconFlowBoundedMultiQueryPlanner,
  plannerBaseUrl,
  providerConfig,
  providerEnv,
  providerHomeDir,
  providerReadFile,
} = {}) {
  if (typeof plannerProvider === "function") return plannerProvider;
  if (plannerProvider && typeof plannerProvider.plan === "function") {
    return question => plannerProvider.plan(question);
  }
  const provider = plannerProviderFactory({
    baseUrl: plannerBaseUrl,
    providerConfig,
    providerEnv,
    providerHomeDir,
    providerReadFile,
  });
  if (typeof provider !== "function") {
    throw new LongMemEvalSemanticProfileError("planner_initialization", "invalid query planner provider");
  }
  return provider;
}

function plannerConfig({ plannerBaseUrl, providerEnv } = {}) {
  const baseUrl = plannerBaseUrl || getSFBaseUrl({ env: providerEnv });
  return {
    baseUrl,
    baseUrlIdentity: normalizeEmbeddingBaseUrlIdentity(baseUrl),
  };
}

function plannerProvenance({ baseUrl, stats, planHash = null } = {}) {
  return {
    ...boundedMultiQueryPlannerProvenance(baseUrl),
    planner_provider_call_count: stats.plannerProviderCallCount,
    planner_cache_hits: stats.plannerCacheHits,
    planner_latency: stats.plannerLatency,
    query_plan_cache_schema: H2_QUERY_PLAN_CACHE_SCHEMA,
    query_plan_cache_user_version: H2_QUERY_PLAN_CACHE_SQLITE_USER_VERSION,
    query_plan_hash: planHash,
    vector_query_mode: H2_VECTOR_QUERY_MODE,
    vector_query_count: 0,
    vector_search_count: 0,
    vector_query_fusion: "rrf",
    vector_query_rrf_k: H2_VECTOR_QUERY_RRF_K,
    gold_leakage_boundary: "planner receives only the exact question string; evaluator fields and corpus data are excluded",
  };
}

function plannerStats() {
  return {
    plannerProviderCallCount: 0,
    plannerCacheHits: 0,
    plannerLatency: 0,
  };
}

function exactProductionVectorQuery(item) {
  return stripPromptMetadataPrefix(item.question);
}

async function resolveQueryPlan(item, {
  queryPlanCache,
  planner,
  plannerConfigValue,
  stats,
} = {}) {
  const key = buildQueryPlanCacheKey({
    provider: H2_QUERY_PLANNER_PROVIDER,
    baseUrlIdentity: plannerConfigValue.baseUrlIdentity,
    model: H2_QUERY_PLANNER_MODEL,
    modelRevision: H2_QUERY_PLANNER_MODEL_REVISION,
    promptVersion: H2_QUERY_PLANNER_PROMPT_VERSION,
    promptSha256: H2_QUERY_PLANNER_PROMPT_SHA256,
    temperature: H2_QUERY_PLANNER_TEMPERATURE,
    outputSchemaSha256: H2_QUERY_PLANNER_OUTPUT_SCHEMA_SHA256,
    question: item.question,
  });
  let cached;
  try {
    cached = queryPlanCache.get(key);
  } catch (error) {
    throw stageError("planner_cache_read", error);
  }
  if (cached) {
    try {
      const plan = validateCachedBoundedMultiQueryPlan(cached, {
        exactProductionQuery: exactProductionVectorQuery(item),
      });
      stats.plannerCacheHits += 1;
      return plan;
    } catch (error) {
      throw stageError("planner_cache_read", error);
    }
  }

  stats.plannerProviderCallCount += 1;
  const started = performance.now();
  let raw;
  try {
    raw = await planner(item.question);
  } catch (error) {
    throw stageError("planner_provider", error);
  } finally {
    stats.plannerLatency += performance.now() - started;
  }
  let plan;
  try {
    plan = parseBoundedMultiQueryPlannerResponse(raw, {
      exactProductionQuery: exactProductionVectorQuery(item),
    });
  } catch (error) {
    throw stageError("planner_parse", error);
  }
  try {
    queryPlanCache.set(key, {
      ...plan,
      provenance: {
        ...boundedMultiQueryPlannerProvenance(plannerConfigValue.baseUrl),
        question_input_sha256: key.question_input_sha256,
      },
    });
  } catch (error) {
    throw stageError("planner_cache_write", error);
  }
  return plan;
}

function numericTotal(results, key) {
  return results.reduce((sum, result) => sum + Number(result?.provenance?.[key] || 0), 0);
}

function runProvenance(results, options, plannerConfigValue) {
  const first = results.find(result => isObject(result?.provenance))?.provenance || {};
  const numericFields = [
    "provider_call_count",
    "embedding_cache_hits",
    "corpus_embedding_count",
    "query_embedding_count",
    "corpus_build_latency",
    "retrieval_latency",
    "vector_attempted_count",
    "vector_skipped_count",
    "vector_error_count",
    "planner_provider_call_count",
    "planner_cache_hits",
    "planner_latency",
    "vector_query_count",
    "vector_search_count",
    "vector_raw_total",
    "vector_unique_count",
  ];
  const perCaseOnly = new Set(["vector_query_input_sha256s", "vector_query_candidate_counts", "query_plan_hash"]);
  const result = { ...first };
  for (const field of perCaseOnly) delete result[field];
  for (const field of numericFields) result[field] = numericTotal(results, field);
  Object.assign(result, {
    ...boundedMultiQueryPlannerProvenance(plannerConfigValue.baseUrl),
    profile: LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE,
    embedding_provider: SEMANTIC_EMBEDDING_PROVIDER,
    embedding_dimension: SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
    lexical_confidence_threshold: SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD,
    planner_provider: H2_QUERY_PLANNER_PROVIDER,
    planner_model: H2_QUERY_PLANNER_MODEL,
    planner_model_revision: H2_QUERY_PLANNER_MODEL_REVISION,
    planner_query_count: H2_QUERY_PLANNER_QUERY_COUNT,
    planner_query_max_chars: H2_QUERY_PLANNER_QUERY_MAX_CHARS,
    planner_temperature: H2_QUERY_PLANNER_TEMPERATURE,
    query_plan_cache_schema: H2_QUERY_PLAN_CACHE_SCHEMA,
    query_plan_cache_user_version: H2_QUERY_PLAN_CACHE_SQLITE_USER_VERSION,
    vector_query_mode: H2_VECTOR_QUERY_MODE,
    vector_query_fusion: "rrf",
    vector_query_rrf_k: H2_VECTOR_QUERY_RRF_K,
    gold_leakage_boundary: "planner receives only the exact question string; evaluator fields and corpus data are excluded",
  });
  if (!result.embedding_base_url_identity) {
    result.embedding_base_url_identity = normalizeEmbeddingBaseUrlIdentity(
      options.embeddingBaseUrl || getSFBaseUrl({ env: options.providerEnv }),
    );
  }
  if (!result.planner_base_url_identity) result.planner_base_url_identity = plannerConfigValue.baseUrlIdentity;
  return result;
}

export async function runLongMemEvalSemanticBoundedMultiQueryRetrievalCase(record, options = {}) {
  const item = record?.schema === LONGMEMEVAL_V1_SCHEMA ? record : normalizeLongMemEvalCase(record);
  const config = plannerConfig(options);
  const skipReason = officialSkipReason(item);
  const stats = plannerStats();
  if (skipReason) {
    return runLongMemEvalSemanticRetrievalCase(item, {
      ...options,
      profile: LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE,
      vectorQueryPlan: null,
      profileProvenance: {
        ...(isObject(options.profileProvenance) ? options.profileProvenance : {}),
        ...plannerProvenance({ baseUrl: config.baseUrl, stats }),
      },
    });
  }

  const ownsQueryPlanCache = !options.queryPlanCache;
  const queryPlanCache = options.queryPlanCache || (options.queryPlanCacheFactory || createBenchmarkQueryPlanCache)(
    options.queryPlanCachePath,
  );
  try {
    validateCache(queryPlanCache, "planner_cache_initialization", { owns: ownsQueryPlanCache });
    const planner = createPlanner(options);
    const plan = await resolveQueryPlan(item, {
      queryPlanCache,
      planner,
      plannerConfigValue: config,
      stats,
    });
    return await runLongMemEvalSemanticRetrievalCase(item, {
      ...options,
      profile: LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE,
      vectorQueryPlan: plan,
      profileProvenance: {
        ...(isObject(options.profileProvenance) ? options.profileProvenance : {}),
        ...plannerProvenance({ baseUrl: config.baseUrl, stats, planHash: plan.plan_hash }),
      },
    });
  } catch (error) {
    throw stageError("h2_case", error);
  } finally {
    closeCache(queryPlanCache, ownsQueryPlanCache);
  }
}

export async function runLongMemEvalSemanticBoundedMultiQueryRetrievalDataset(records, options = {}) {
  if (!Array.isArray(records)) throw new Error("longmemeval_dataset_must_be_array");
  const limit = options.limit == null
    ? records.length
    : Math.max(0, Math.min(records.length, Math.trunc(Number(options.limit) || 0)));
  const selected = records.slice(0, limit);
  const embeddingCacheFactory = options.embeddingCacheFactory || createBenchmarkEmbeddingCache;
  const queryPlanCacheFactory = options.queryPlanCacheFactory || createBenchmarkQueryPlanCache;
  const ownsEmbeddingCache = !options.embeddingCache;
  const ownsQueryPlanCache = !options.queryPlanCache;
  let embeddingCache = options.embeddingCache || null;
  let queryPlanCache = options.queryPlanCache || null;
  try {
    if (!embeddingCache) embeddingCache = embeddingCacheFactory(options.cachePath);
    if (!queryPlanCache) queryPlanCache = queryPlanCacheFactory(options.queryPlanCachePath);
    if (!isObject(embeddingCache) || typeof embeddingCache.get !== "function" || typeof embeddingCache.set !== "function" ||
        (ownsEmbeddingCache && typeof embeddingCache.close !== "function")) {
      throw new LongMemEvalSemanticProfileError("embedding_cache_initialization", "invalid benchmark embedding cache");
    }
    validateCache(queryPlanCache, "planner_cache_initialization", { owns: ownsQueryPlanCache });
    const results = [];
    for (const record of selected) {
      results.push(await runLongMemEvalSemanticBoundedMultiQueryRetrievalCase(record, {
        ...options,
        embeddingCache,
        queryPlanCache,
      }));
    }
    const config = plannerConfig(options);
    const provenance = runProvenance(results, options, config);
    const topK = Math.max(1, Math.trunc(Number(options.topK) || 50));
    const vectorTopK = Math.max(50, topK);
    return {
      schema: LONGMEMEVAL_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA,
      profile: LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE,
      provenance,
      run: {
        ...provenance,
        top_k: topK,
        vector_top_k: vectorTopK,
        benchmark_now_sec: options.benchmarkNowSec,
        requested_limit: options.limit ?? null,
      },
      summary: aggregateLongMemEvalRetrievalResults(results, {
        profile: LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE,
        schema: LONGMEMEVAL_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA,
      }),
      results,
    };
  } finally {
    closeCache(queryPlanCache, ownsQueryPlanCache);
    closeCache(embeddingCache, ownsEmbeddingCache);
  }
}

export const H2_BASELINE_PROFILES = Object.freeze({
  lexical: "production_hybrid_lexical_session_v1",
  semantic: LONGMEMEVAL_SEMANTIC_PROFILE,
  queryInstruction: "production_hybrid_semantic_query_instruction_session_v1",
  boundedMultiQuery: LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE,
});
