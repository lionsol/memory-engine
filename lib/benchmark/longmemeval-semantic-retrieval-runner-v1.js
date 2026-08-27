import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { MEMORY_ENGINE_DEFAULTS } from "../config/defaults.js";
import {
  DEFAULT_SF_BASE_URL,
  EMBEDDING_MODEL,
  generateEmbedding as generateSiliconFlowEmbedding,
  getSFBaseUrl,
} from "../siliconflow-runtime.js";
import { createLanceDbRuntime } from "../lancedb-runtime.js";
import { hybridSearch } from "../recall/hybrid-search.js";
import {
  CANONICAL_VECTOR_PROJECTION_VERSION,
  CANONICAL_VECTOR_TEXT_MAX_CHARS,
  materializeCanonicalLanceRow,
  projectCanonicalMemoryToVectorProjection,
} from "../canonical/vector-projection.js";
import { getCanonicalMemoriesByIds } from "../canonical/read-adapter.js";
import {
  aggregateLongMemEvalRetrievalResults,
  createBenchmarkHybridRuntime,
  materializeLongMemEvalCaseDatabases,
} from "./longmemeval-retrieval-runner-v1.js";
import {
  LONGMEMEVAL_V1_SCHEMA,
  hasLongMemEvalUserTarget,
  normalizeLongMemEvalCase,
  scoreLongMemEvalSessionMetrics,
  scoreLongMemEvalSessionRetrieval,
} from "./longmemeval-v1.js";

export const LONGMEMEVAL_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA =
  "memory_engine_longmemeval_semantic_retrieval_v1";
export const LONGMEMEVAL_SEMANTIC_PROFILE = "production_hybrid_semantic_session_v1";
export const SEMANTIC_EMBEDDING_PROVIDER = "SiliconFlow";
export const SEMANTIC_EMBEDDING_MODEL = EMBEDDING_MODEL;
export const SEMANTIC_EMBEDDING_MODEL_REVISION = "unavailable/unpinned";
export const SEMANTIC_EXPECTED_EMBEDDING_DIMENSION = 2560;
export const SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD = 0.7;
export const SEMANTIC_EMBEDDING_CACHE_SCHEMA = "memory_engine_benchmark_embedding_cache_v1";

if (MEMORY_ENGINE_DEFAULTS?.recall?.lexicalConfidenceThreshold !== SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD) {
  throw new Error("semantic_profile_requires_production_lexical_confidence_threshold_0_7");
}

const GOLD_FIELDS = new Set([
  "answer",
  "expected_answer",
  "answer_session_ids",
  "evidence_session_ids",
  "has_answer",
  "evidence_label",
  "evidence_labels",
  "gold",
  "gold_answer",
  "evaluator_target",
  "expected_target",
]);

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function sanitizeErrorMessage(error) {
  const raw = error?.message ? String(error.message) : String(error || "unknown error");
  return raw
    .replace(/authorization\s*:\s*bearer\s+[^\s]+/gi, "authorization: bearer [redacted]")
    .replace(/bearer\s+[^\s]+/gi, "bearer [redacted]")
    .replace(/(api[_-]?key|token|secret)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 240);
}

export class LongMemEvalSemanticProfileError extends Error {
  constructor(stage, message, details = {}) {
    super(`semantic_profile_${stage}${message ? `: ${sanitizeErrorMessage({ message })}` : ""}`);
    this.name = "LongMemEvalSemanticProfileError";
    this.stage = stage;
    this.code = `semantic_${stage}`;
    this.details = { ...details };
  }
}

function stageError(stage, error, details = {}) {
  if (error instanceof LongMemEvalSemanticProfileError) {
    error.details = { ...error.details, ...details };
    return error;
  }
  return new LongMemEvalSemanticProfileError(stage, sanitizeErrorMessage(error), {
    cause_message: sanitizeErrorMessage(error),
    ...details,
  });
}

function recordFailureDetails(error, stats, fallbackCalled) {
  if (!(error instanceof LongMemEvalSemanticProfileError)) return error;
  error.details = {
    ...error.details,
    provider_call_count: stats.providerCallCount,
    embedding_cache_hits: stats.embeddingCacheHits,
    corpus_embedding_count: stats.corpusEmbeddingCount,
    query_embedding_count: stats.queryEmbeddingCount,
    vector_attempted_count: stats.vectorAttemptedCount,
    vector_skipped_count: stats.vectorSkippedCount,
    vector_error_count: stats.vectorErrorCount,
    vector_fallback_called: fallbackCalled,
  };
  return error;
}

export function normalizeEmbeddingBaseUrlIdentity(value = DEFAULT_SF_BASE_URL) {
  try {
    const url = new URL(String(value));
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "invalid-url";
  }
}

export function buildEmbeddingCacheKey({
  provider = SEMANTIC_EMBEDDING_PROVIDER,
  baseUrl = DEFAULT_SF_BASE_URL,
  model = SEMANTIC_EMBEDDING_MODEL,
  projectionVersion = CANONICAL_VECTOR_PROJECTION_VERSION,
  input = "",
} = {}) {
  const exactInput = String(input);
  return {
    provider: String(provider),
    base_url_identity: normalizeEmbeddingBaseUrlIdentity(baseUrl),
    model: String(model),
    projection_version: projectionVersion,
    input_sha256: sha256(exactInput),
    normalized_input_sha256: sha256(exactInput.normalize("NFC")),
  };
}

function serializeCacheKey(key) {
  return JSON.stringify(key);
}

function assertBenchmarkCachePath(cachePath) {
  if (/[\\/]\.openclaw[\\/]memory(?:[\\/]|$)/u.test(cachePath)) {
    throw new LongMemEvalSemanticProfileError(
      "embedding_cache_path",
      "benchmark cache cannot use a live OpenClaw memory path",
    );
  }
}

function assertNoGoldFields(value, label) {
  if (Array.isArray(value)) {
    for (const item of value) assertNoGoldFields(item, label);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (GOLD_FIELDS.has(key)) throw new Error(`${label}_contains_gold_field:${key}`);
    assertNoGoldFields(child, label);
  }
}

function copyVector(vector) {
  if (Array.isArray(vector)) return [...vector];
  if (ArrayBuffer.isView(vector) && !(vector instanceof DataView)) return Array.from(vector);
  return null;
}

function assertEmbeddingDimension(vector, stage) {
  const copied = copyVector(vector);
  if (!copied || copied.length !== SEMANTIC_EXPECTED_EMBEDDING_DIMENSION) {
    throw new LongMemEvalSemanticProfileError(`${stage}_embedding_dimension`, "unexpected embedding dimension", {
      expected_dimension: SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
      actual_dimension: copied?.length ?? null,
    });
  }
  if (!copied.every(value => Number.isFinite(value))) {
    throw new LongMemEvalSemanticProfileError(`${stage}_embedding_dimension`, "embedding contains non-finite values", {
      expected_dimension: SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
      actual_dimension: copied.length,
    });
  }
  return copied;
}

function readCacheFile(cachePath) {
  if (!existsSync(cachePath)) {
    return { schema: SEMANTIC_EMBEDDING_CACHE_SCHEMA, entries: {} };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(cachePath, "utf8"));
  } catch (error) {
    throw stageError("embedding_cache_read", error);
  }
  if (!parsed || parsed.schema !== SEMANTIC_EMBEDDING_CACHE_SCHEMA ||
      !parsed.entries || typeof parsed.entries !== "object" || Array.isArray(parsed.entries)) {
    throw new LongMemEvalSemanticProfileError("embedding_cache_read", "invalid embedding cache schema");
  }
  assertNoGoldFields(parsed, "embedding_cache");
  return parsed;
}

export function createBenchmarkEmbeddingCache(cachePath = null) {
  const resolvedPath = cachePath == null ? null : resolve(String(cachePath));
  if (resolvedPath) assertBenchmarkCachePath(resolvedPath);
  const state = resolvedPath
    ? readCacheFile(resolvedPath)
    : { schema: SEMANTIC_EMBEDDING_CACHE_SCHEMA, entries: {} };

  function persist() {
    if (!resolvedPath) return;
    try {
      mkdirSync(dirname(resolvedPath), { recursive: true });
      const temporaryPath = `${resolvedPath}.${process.pid}.tmp`;
      writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      renameSync(temporaryPath, resolvedPath);
    } catch (error) {
      throw stageError("embedding_cache_write", error);
    }
  }

  return {
    path: resolvedPath,
    get(key) {
      const entry = state.entries[serializeCacheKey(key)];
      if (entry === undefined) return null;
      assertNoGoldFields(entry, "embedding_cache_entry");
      if (!entry || typeof entry !== "object" || !Array.isArray(entry.vector)) {
        throw new LongMemEvalSemanticProfileError("embedding_cache_read", "invalid embedding cache entry");
      }
      return [...entry.vector];
    },
    set(key, vector) {
      const copied = copyVector(vector);
      if (!copied) throw new LongMemEvalSemanticProfileError("embedding_cache_write", "invalid embedding cache vector");
      const entry = {
        vector: copied,
        provenance: {
          provider: key.provider,
          base_url_identity: key.base_url_identity,
          model: key.model,
          projection_version: key.projection_version,
          input_sha256: key.input_sha256,
          normalized_input_sha256: key.normalized_input_sha256,
          dimension: copied.length,
        },
      };
      assertNoGoldFields(entry, "embedding_cache_entry");
      state.entries[serializeCacheKey(key)] = entry;
      persist();
    },
    snapshot() {
      return JSON.parse(JSON.stringify(state));
    },
  };
}

function createProvider({
  embeddingProvider,
  embeddingBaseUrl,
  providerEnv,
  providerConfig,
  providerHomeDir,
  providerReadFile,
} = {}) {
  const baseUrl = embeddingBaseUrl || getSFBaseUrl({ env: providerEnv });
  const embed = typeof embeddingProvider === "function"
    ? embeddingProvider
    : embeddingProvider && typeof embeddingProvider.embed === "function"
      ? embeddingProvider.embed.bind(embeddingProvider)
      : text => generateSiliconFlowEmbedding(text, {
        cfg: providerConfig,
        env: providerEnv,
        homeDir: providerHomeDir,
        readFile: providerReadFile,
        baseUrl,
      });
  return {
    embed,
    baseUrlIdentity: normalizeEmbeddingBaseUrlIdentity(baseUrl),
  };
}

function createEmbeddingStats() {
  return {
    providerCallCount: 0,
    embeddingCacheHits: 0,
    corpusEmbeddingCount: 0,
    queryEmbeddingCount: 0,
    corpusBuildLatency: 0,
    retrievalLatency: 0,
    vectorAttemptedCount: 0,
    vectorSkippedCount: 0,
    vectorErrorCount: 0,
  };
}

function provenance({
  datasetSha256 = null,
  repositoryCommit = null,
  provider,
  baseUrlIdentity,
  stats,
  vectorTopK,
} = {}) {
  return {
    profile: LONGMEMEVAL_SEMANTIC_PROFILE,
    repository_commit: repositoryCommit || null,
    dataset_sha256: datasetSha256 || null,
    embedding_provider: provider,
    embedding_base_url_identity: baseUrlIdentity,
    embedding_model: SEMANTIC_EMBEDDING_MODEL,
    embedding_model_revision: SEMANTIC_EMBEDDING_MODEL_REVISION,
    embedding_dimension: SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
    canonical_vector_projection_version: CANONICAL_VECTOR_PROJECTION_VERSION,
    canonical_vector_text_max_chars: CANONICAL_VECTOR_TEXT_MAX_CHARS,
    lexical_confidence_threshold: SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD,
    vector_top_k: vectorTopK,
    provider_call_count: stats.providerCallCount,
    embedding_cache_hits: stats.embeddingCacheHits,
    corpus_embedding_count: stats.corpusEmbeddingCount,
    query_embedding_count: stats.queryEmbeddingCount,
    corpus_build_latency: stats.corpusBuildLatency,
    retrieval_latency: stats.retrievalLatency,
    vector_attempted_count: stats.vectorAttemptedCount,
    vector_skipped_count: stats.vectorSkippedCount,
    vector_error_count: stats.vectorErrorCount,
  };
}

function mapSearchResultsToSessions(results, sessionByMemoryId) {
  const mapped = [];
  for (const result of Array.isArray(results) ? results : []) {
    const sessionId = sessionByMemoryId.get(String(result?.memory_id || ""));
    if (sessionId) mapped.push(sessionId);
  }
  return mapped;
}

function maskMetricsBeyondDepth(metrics, retrievalDepth) {
  const depth = Math.max(1, Math.trunc(Number(retrievalDepth) || 1));
  return Object.fromEntries(Object.entries(metrics || {}).map(([key, value]) => {
    const cutoff = Number(key.split("@")[1]);
    return [key, Number.isFinite(cutoff) && cutoff > depth ? null : value];
  }));
}

function officialSkipReason(item) {
  if (item.abstention) return "official_retrieval_abstention";
  return hasLongMemEvalUserTarget(item) ? null : "official_retrieval_no_user_target";
}

function vectorDiagnostics(search, stats, vectorTopK) {
  const debug = search?.debug || {};
  const channels = Array.isArray(search?.channels) ? [...search.channels] : [];
  const canonical = debug.canonical_result_projection || null;
  return {
    pool: Number(search?.pool || 0),
    channels,
    channel_sizes: search?.channel_sizes || {},
    vector_mode: "temporary_lancedb",
    vector_backend: debug.vector_backend || null,
    vector_stage: debug.vector_stage || null,
    vector_skipped: debug.vector_skipped === true,
    vector_skip_reason: debug.vector_skip_reason || null,
    vector_in_fusion: channels.includes("vector"),
    vector_candidate_count: Number(debug.candidate_counts_before_filtering?.vector_raw || 0),
    vector_top_k: vectorTopK,
    lexical_confidence: Number.isFinite(debug.lexical_confidence) ? debug.lexical_confidence : null,
    lexical_confidence_threshold: SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD,
    canonical_result_projection: canonical
      ? {
        requested_count: canonical.requested_count,
        resolved_count: canonical.resolved_count,
        dropped_count: canonical.dropped_count,
        dropped_reasons: canonical.dropped_reasons,
      }
      : null,
    provider_call_count: stats.providerCallCount,
    embedding_cache_hits: stats.embeddingCacheHits,
    corpus_embedding_count: stats.corpusEmbeddingCount,
    query_embedding_count: stats.queryEmbeddingCount,
    corpus_build_latency: stats.corpusBuildLatency,
    retrieval_latency: stats.retrievalLatency,
    vector_attempted_count: stats.vectorAttemptedCount,
    vector_skipped_count: stats.vectorSkippedCount,
    vector_error_count: stats.vectorErrorCount,
  };
}

async function createTemporaryVectorStore({ path, vectorStoreFactory } = {}) {
  try {
    const store = await vectorStoreFactory({ path });
    const table = store?.table || (store && typeof store.search === "function" ? store : null);
    if (!table) throw new Error("temporary vector table unavailable");
    return {
      table,
      close: typeof store?.close === "function" ? store.close.bind(store) : null,
    };
  } catch (error) {
    throw stageError("vector_store_initialization", error);
  }
}

async function defaultVectorStoreFactory({ path } = {}) {
  let runtime;
  try {
    runtime = createLanceDbRuntime({
      dbPath: path,
      logger: { log() {}, warn() {} },
      readyTimeoutMs: 5_000,
    });
    if (await runtime.ensureLanceDBReady() !== true) {
      throw new Error(`lancedb_${runtime.readyState?.state || "not_ready"}`);
    }
    const state = await runtime.getLanceDBRuntime({ timeoutMs: 5_000 });
    if (state?.readyState !== "ready" || !state.table) {
      throw new Error(`lancedb_${state?.readyState || "not_ready"}`);
    }
    return { table: state.table };
  } catch (error) {
    throw stageError("vector_store_initialization", error);
  }
}

async function getEmbedding(text, kind, { provider, cache, stats } = {}) {
  const key = buildEmbeddingCacheKey({
    provider: SEMANTIC_EMBEDDING_PROVIDER,
    baseUrl: provider.baseUrlIdentity,
    model: SEMANTIC_EMBEDDING_MODEL,
    projectionVersion: CANONICAL_VECTOR_PROJECTION_VERSION,
    input: text,
  });
  let cached;
  try {
    cached = cache.get(key);
  } catch (error) {
    throw stageError("embedding_cache_read", error, { kind });
  }
  if (cached !== null && cached !== undefined) {
    stats.embeddingCacheHits += 1;
    return assertEmbeddingDimension(cached, kind);
  }

  stats.providerCallCount += 1;
  let vector;
  try {
    vector = await provider.embed(text);
  } catch (error) {
    throw stageError(`${kind}_embedding`, error);
  }
  const checked = assertEmbeddingDimension(vector, kind);
  try {
    cache.set(key, checked);
  } catch (error) {
    throw stageError("embedding_cache_write", error, { kind });
  }
  return checked;
}

async function materializeSemanticCorpus({
  materialized,
  runtime,
  vectorStore,
  provider,
  cache,
  stats,
  benchmarkNowSec,
} = {}) {
  const memoryIds = [...materialized.sessionByMemoryId.keys()];
  const rows = await runtime.runtime.withHybridDbAccessScope(async ({ withCoreDb, withEngineDb }) => {
    let canonicalBatch;
    try {
      canonicalBatch = getCanonicalMemoriesByIds(memoryIds, { withCoreDb, withEngineDb });
    } catch (error) {
      throw stageError("corpus_canonical_read", error);
    }
    if (!canonicalBatch?.ok || !Array.isArray(canonicalBatch.results) || canonicalBatch.results.length !== memoryIds.length) {
      throw new LongMemEvalSemanticProfileError("corpus_canonical_read", "canonical batch read failed", {
        reason: canonicalBatch?.reason || "invalid_batch_result",
      });
    }

    const materializedRows = [];
    for (const [index, resolved] of canonicalBatch.results.entries()) {
      if (!resolved?.ok || !resolved.memory) {
        throw new LongMemEvalSemanticProfileError("corpus_canonical_read", "canonical memory unavailable", {
          memory_index: index,
          reason: resolved?.reason || "invalid_memory",
        });
      }
      let projection;
      try {
        projection = projectCanonicalMemoryToVectorProjection(resolved.memory);
      } catch (error) {
        throw stageError("corpus_vector_projection", error, { memory_index: index });
      }
      stats.corpusEmbeddingCount += 1;
      const vector = await getEmbedding(projection.embedding_input, "corpus", { provider, cache, stats });
      try {
        materializedRows.push(materializeCanonicalLanceRow(projection, {
          vector,
          timestamp: Number.isFinite(Number(resolved.memory.source.updated_at))
            ? Number(resolved.memory.source.updated_at)
            : benchmarkNowSec,
        }));
      } catch (error) {
        throw stageError("corpus_vector_materialization", error, { memory_index: index });
      }
    }
    return materializedRows;
  });

  if (!Array.isArray(rows) || rows.length !== memoryIds.length) {
    throw new LongMemEvalSemanticProfileError("vector_store_write", "corpus row count mismatch");
  }
  if (typeof vectorStore.table.add !== "function") {
    throw new LongMemEvalSemanticProfileError("vector_store_write", "temporary vector table add unavailable");
  }
  try {
    await vectorStore.table.add(rows);
  } catch (error) {
    throw stageError("vector_store_write", error, { row_count: rows.length });
  }
  return rows.length;
}

function validateSemanticSearch(search, { stats, fallbackCalled, queryEmbeddingError = null } = {}) {
  const debug = search?.debug || {};
  if (queryEmbeddingError) {
    stats.vectorErrorCount += 1;
    if (queryEmbeddingError instanceof LongMemEvalSemanticProfileError) throw queryEmbeddingError;
    throw stageError("query_embedding", queryEmbeddingError);
  }
  if (debug.vector_error) {
    stats.vectorErrorCount += 1;
    const stage = debug.vector_stage === "embedding" ? "query_embedding" : "vector_search";
    const error = new LongMemEvalSemanticProfileError(stage, "production vector channel reported an error", {
      vector_error: sanitizeErrorMessage({ message: debug.vector_error }),
    });
    if (fallbackCalled) error.details.vector_fallback_called = true;
    throw error;
  }
  if (fallbackCalled) {
    stats.vectorErrorCount += 1;
    throw new LongMemEvalSemanticProfileError("vector_fallback", "host memory manager fallback was called");
  }
  if (debug.vector_skipped === true) {
    stats.vectorSkippedCount += 1;
    throw new LongMemEvalSemanticProfileError("vector_skipped", "semantic profile vector channel was skipped");
  }
  if (debug.vector_stage !== "lancedb_search" || debug.vector_backend !== "lancedb") {
    stats.vectorErrorCount += 1;
    throw new LongMemEvalSemanticProfileError("vector_not_attempted", "production LanceDB vector search was not attempted", {
      vector_stage: debug.vector_stage || null,
      vector_backend: debug.vector_backend || null,
    });
  }
  const vectorRaw = Number(debug.candidate_counts_before_filtering?.vector_raw || 0);
  const vectorFiltered = Number(debug.candidate_counts_before_filtering?.vector_after_conf_filter || 0);
  if (vectorRaw < 1 || vectorFiltered < 1 || !Array.isArray(search?.channels) || !search.channels.includes("vector")) {
    stats.vectorErrorCount += 1;
    throw new LongMemEvalSemanticProfileError("vector_search", "production vector search returned no usable candidates", {
      vector_raw: vectorRaw,
      vector_after_conf_filter: vectorFiltered,
    });
  }
  stats.vectorAttemptedCount += 1;
}

function sumStats(results) {
  const fields = {
    providerCallCount: "provider_call_count",
    embeddingCacheHits: "embedding_cache_hits",
    corpusEmbeddingCount: "corpus_embedding_count",
    queryEmbeddingCount: "query_embedding_count",
    corpusBuildLatency: "corpus_build_latency",
    retrievalLatency: "retrieval_latency",
    vectorAttemptedCount: "vector_attempted_count",
    vectorSkippedCount: "vector_skipped_count",
    vectorErrorCount: "vector_error_count",
  };
  return Object.fromEntries(Object.entries(fields).map(([field, key]) => [
    field,
    results.reduce((sum, result) => sum + Number(result?.provenance?.[key] || 0), 0),
  ]));
}

export async function runLongMemEvalSemanticRetrievalCase(record, {
  topK = 50,
  benchmarkNowSec = Math.floor(Date.now() / 1000),
  datasetSha256 = null,
  repositoryCommit = null,
  embeddingProvider = null,
  embeddingBaseUrl = null,
  providerEnv = undefined,
  providerConfig = undefined,
  providerHomeDir = undefined,
  providerReadFile = undefined,
  embeddingCache = null,
  cachePath = null,
  vectorStoreFactory = defaultVectorStoreFactory,
  keepTemp = false,
} = {}) {
  const item = record?.schema === LONGMEMEVAL_V1_SCHEMA ? record : normalizeLongMemEvalCase(record);
  const k = Math.max(1, Math.trunc(Number(topK) || 50));
  const vectorTopK = Math.max(50, k);
  const provider = createProvider({
    embeddingProvider,
    embeddingBaseUrl,
    providerEnv,
    providerConfig,
    providerHomeDir,
    providerReadFile,
  });
  const cache = embeddingCache || createBenchmarkEmbeddingCache(cachePath);
  const stats = createEmbeddingStats();
  const skipReason = officialSkipReason(item);
  if (skipReason) {
    const itemProvenance = provenance({
      datasetSha256,
      repositoryCommit,
      provider: SEMANTIC_EMBEDDING_PROVIDER,
      baseUrlIdentity: provider.baseUrlIdentity,
      stats,
      vectorTopK,
    });
    return {
      schema: LONGMEMEVAL_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA,
      profile: LONGMEMEVAL_SEMANTIC_PROFILE,
      question_id: item.question_id,
      question_type: item.question_type,
      skipped: true,
      skip_reason: skipReason,
      retrieved_session_ids: [],
      metrics: null,
      diagnostic_metrics: null,
      diagnostics: null,
      provenance: itemProvenance,
      latency_ms: 0,
      corpus_sessions: item.sessions.length,
    };
  }

  const materialized = materializeLongMemEvalCaseDatabases(item, { benchmarkNowSec });
  let vectorStore = null;
  let runtime = null;
  let fallbackCalled = false;
  let queryEmbeddingError = null;
  try {
    const corpusStart = performance.now();
    vectorStore = await createTemporaryVectorStore({
      path: join(materialized.root, "semantic-vector"),
      vectorStoreFactory,
    });
    const queryEmbedding = async query => {
      stats.queryEmbeddingCount += 1;
      try {
        return await getEmbedding(query, "query", { provider, cache, stats });
      } catch (error) {
        queryEmbeddingError = error;
        throw error;
      }
    };
    runtime = createBenchmarkHybridRuntime(materialized, {
      topK: k,
      vectorTable: vectorStore.table,
      generateEmbedding: queryEmbedding,
      lexicalConfidenceThreshold: SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD,
      getMemorySearchManager: async () => {
        fallbackCalled = true;
        throw new Error("semantic_profile_host_manager_fallback_disabled");
      },
    });
    await materializeSemanticCorpus({
      materialized,
      runtime,
      vectorStore,
      provider,
      cache,
      stats,
      benchmarkNowSec,
    });
    stats.corpusBuildLatency = performance.now() - corpusStart;

    const retrievalStart = performance.now();
    let search;
    try {
      search = await hybridSearch(item.question, { topK: k }, runtime.runtime);
    } catch (error) {
      stats.vectorErrorCount += 1;
      throw stageError("vector_search", error);
    } finally {
      stats.retrievalLatency = performance.now() - retrievalStart;
    }
    validateSemanticSearch(search, { stats, fallbackCalled, queryEmbeddingError });

    const retrievedSessionIds = mapSearchResultsToSessions(search.results, materialized.sessionByMemoryId);
    const metrics = maskMetricsBeyondDepth(
      scoreLongMemEvalSessionMetrics(item, retrievedSessionIds).metrics,
      k,
    );
    const itemProvenance = provenance({
      datasetSha256,
      repositoryCommit,
      provider: SEMANTIC_EMBEDDING_PROVIDER,
      baseUrlIdentity: provider.baseUrlIdentity,
      stats,
      vectorTopK,
    });
    return {
      schema: LONGMEMEVAL_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA,
      profile: LONGMEMEVAL_SEMANTIC_PROFILE,
      question_id: item.question_id,
      question_type: item.question_type,
      skipped: false,
      skip_reason: null,
      retrieved_session_ids: retrievedSessionIds,
      metrics,
      diagnostic_metrics: scoreLongMemEvalSessionRetrieval(item, retrievedSessionIds, { topK: k }),
      diagnostics: vectorDiagnostics(search, stats, vectorTopK),
      provenance: itemProvenance,
      latency_ms: stats.retrievalLatency,
      corpus_sessions: item.sessions.length,
    };
  } catch (error) {
    throw recordFailureDetails(error instanceof LongMemEvalSemanticProfileError
      ? error
      : stageError("case", error), stats, fallbackCalled);
  } finally {
    try {
      runtime?.close();
      if (vectorStore?.close) await vectorStore.close();
    } finally {
      if (!keepTemp) rmSync(materialized.root, { recursive: true, force: true });
    }
  }
}

export async function runLongMemEvalSemanticRetrievalDataset(records, {
  limit = null,
  topK = 50,
  benchmarkNowSec = Math.floor(Date.now() / 1000),
  datasetSha256 = null,
  repositoryCommit = null,
  embeddingProvider = null,
  embeddingBaseUrl = null,
  providerEnv = undefined,
  providerConfig = undefined,
  providerHomeDir = undefined,
  providerReadFile = undefined,
  embeddingCache = null,
  cachePath = null,
  vectorStoreFactory = defaultVectorStoreFactory,
  keepTemp = false,
} = {}) {
  if (!Array.isArray(records)) throw new Error("longmemeval_dataset_must_be_array");
  const boundedLimit = limit == null
    ? records.length
    : Math.max(0, Math.min(records.length, Math.trunc(Number(limit) || 0)));
  const selected = records.slice(0, boundedLimit);
  const cache = embeddingCache || createBenchmarkEmbeddingCache(cachePath);
  const results = [];
  for (const record of selected) {
    results.push(await runLongMemEvalSemanticRetrievalCase(record, {
      topK,
      benchmarkNowSec,
      datasetSha256,
      repositoryCommit,
      embeddingProvider,
      embeddingBaseUrl,
      providerEnv,
      providerConfig,
      providerHomeDir,
      providerReadFile,
      embeddingCache: cache,
      vectorStoreFactory,
      keepTemp,
    }));
  }
  const totals = sumStats(results);
  const runProvenance = provenance({
    datasetSha256,
    repositoryCommit,
    provider: SEMANTIC_EMBEDDING_PROVIDER,
    baseUrlIdentity: createProvider({ embeddingBaseUrl, providerEnv }).baseUrlIdentity,
    stats: totals,
    vectorTopK: Math.max(50, Math.max(1, Math.trunc(Number(topK) || 50))),
  });
  const normalizedTopK = Math.max(1, Math.trunc(Number(topK) || 50));
  const normalizedVectorTopK = Math.max(50, normalizedTopK);
  return {
    schema: LONGMEMEVAL_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA,
    profile: LONGMEMEVAL_SEMANTIC_PROFILE,
    provenance: runProvenance,
    run: {
      ...runProvenance,
      top_k: normalizedTopK,
      vector_top_k: normalizedVectorTopK,
      benchmark_now_sec: benchmarkNowSec,
      requested_limit: limit,
    },
    summary: aggregateLongMemEvalRetrievalResults(results, {
      profile: LONGMEMEVAL_SEMANTIC_PROFILE,
      schema: LONGMEMEVAL_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA,
    }),
    results,
  };
}
