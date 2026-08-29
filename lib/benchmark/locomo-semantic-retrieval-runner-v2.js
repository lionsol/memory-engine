import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import { MEMORY_ENGINE_DEFAULTS } from "../config/defaults.js";
import {
  DEFAULT_SF_BASE_URL,
  EMBEDDING_MODEL,
  generateEmbedding as generateSiliconFlowEmbedding,
  getSFBaseUrl,
} from "../siliconflow-runtime.js";
import { createLanceDbRuntime } from "../lancedb-runtime.js";
import { getCanonicalMemoriesByIds } from "../canonical/read-adapter.js";
import {
  CANONICAL_VECTOR_PROJECTION_VERSION,
  CANONICAL_VECTOR_TEXT_MAX_CHARS,
  materializeCanonicalLanceRow,
  projectCanonicalMemoryToVectorProjection,
} from "../canonical/vector-projection.js";
import { hybridSearch } from "../recall/hybrid-search.js";
import {
  createBenchmarkHybridRuntime,
} from "./longmemeval-retrieval-runner-v1.js";
import {
  buildEmbeddingCacheKey,
  createBenchmarkEmbeddingCache,
  LongMemEvalSemanticProfileError,
  normalizeEmbeddingBaseUrlIdentity,
  SEMANTIC_EMBEDDING_CACHE_SCHEMA,
  SEMANTIC_EMBEDDING_CACHE_SQLITE_USER_VERSION,
} from "./longmemeval-semantic-retrieval-runner-v1.js";
import {
  LOCOMO_BLIP_CAPTION_POLICY,
  LOCOMO_DIALOG_TEXT_PROJECTION,
  LOCOMO_DIALOG_PROJECTION_VERSION,
  LOCOMO_EVIDENCE_CANONICALIZED_V1,
  LOCOMO_EVIDENCE_STRICT_V1,
  LOCOMO_INCLUDE_SESSION_DATETIME,
  LOCOMO_DATASET_SHA256,
  buildLocomoSearchRequest,
  getLocomoProvenance,
  normalizeLocomoDataset,
  scoreLocomoRetrieval,
} from "./locomo-v1.js";
import {
  materializeLocomoConversationDataPlane,
  aggregatePolicy,
  publicMetrics,
  resolveLocomoRepositoryProvenance,
  skippedMetrics,
  validateBenchmarkNowSec,
  mapLocomoSearchResultsToDialogs,
} from "./locomo-retrieval-runner-v1.js";

export const LOCOMO_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA =
  "memory_engine_locomo_semantic_retrieval_time_frozen_v2";
export const LOCOMO_SEMANTIC_PROFILE =
  "production_hybrid_semantic_dialog_locomo_time_frozen_v2";
export const LOCOMO_SEMANTIC_RETRIEVAL_PROFILE = LOCOMO_SEMANTIC_PROFILE;
export const LOCOMO_SEMANTIC_EMBEDDING_PROVIDER = "SiliconFlow";
export const LOCOMO_SEMANTIC_EMBEDDING_MODEL = EMBEDDING_MODEL;
export const LOCOMO_SEMANTIC_EMBEDDING_MODEL_REVISION = "unavailable/unpinned";
export const LOCOMO_SEMANTIC_EXPECTED_EMBEDDING_DIMENSION = 2560;
export const LOCOMO_SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD = 0.7;
export const LOCOMO_SEMANTIC_VECTOR_TOP_K = 50;
export const LOCOMO_SEMANTIC_TOP_K = 50;
export const LOCOMO_SEMANTIC_VECTOR_MODE = "temporary_lancedb";
export const LOCOMO_SEMANTIC_HOST_MANAGER_MODE = "forbidden";
export const LOCOMO_SEMANTIC_QUERY_INSTRUCTION = "none";
export const LOCOMO_SEMANTIC_QUERY_MODE = "exact_question";
export const LOCOMO_SEMANTIC_BENCHMARK_CLOCK_CONTRACT =
  "locomo_materialization_and_search_fixed_v2";
export const LOCOMO_SEMANTIC_EMBEDDING_CACHE_SCHEMA = SEMANTIC_EMBEDDING_CACHE_SCHEMA;
export const LOCOMO_SEMANTIC_EMBEDDING_CACHE_SQLITE_USER_VERSION =
  SEMANTIC_EMBEDDING_CACHE_SQLITE_USER_VERSION;

if (MEMORY_ENGINE_DEFAULTS?.recall?.lexicalConfidenceThreshold !== LOCOMO_SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD) {
  throw new Error("locomo_semantic_profile_requires_production_lexical_confidence_threshold_0_7");
}

const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const HEX_SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const GOLD_FIELDS = new Set([
  "answer",
  "adversarial_answer",
  "expected_answer",
  "evidence",
  "evaluator_labels",
  "evaluator_target",
  "category",
  "image_search_query",
  "img_url",
  "observation",
  "session_summary",
  "event_summary",
  "strict",
  "sensitivity",
  "scoring_state",
]);

const RESERVED_PROVENANCE_KEYS = new Set([
  "profile",
  "repository_commit",
  "repository_worktree_clean",
  "repository_provenance_source",
  "dataset_sha256",
  "dataset_sha256_source",
  "upstream_repository",
  "upstream_commit",
  "dataset_file_commit",
  "dataset_path",
  "license_identity",
  "locomo_dialog_text_projection",
  "benchmark_now_sec",
  "materialization_now_sec",
  "search_now_sec",
  "benchmark_clock_contract",
  "top_k",
  "vector_top_k",
  "embedding_provider",
  "embedding_base_url_identity",
  "embedding_model",
  "embedding_model_revision",
  "embedding_dimension",
  "canonical_vector_projection_version",
  "canonical_vector_text_max_chars",
  "lexical_confidence_threshold",
  "embedding_cache_schema",
  "embedding_cache_user_version",
  "provider_call_count",
  "embedding_cache_hits",
  "corpus_embedding_count",
  "query_embedding_count",
  "total_embedding_lookups",
  "corpora_built",
  "corpus_lancedb_row_count",
  "vector_attempted_count",
  "vector_skipped_count",
  "vector_error_count",
  "host_manager_fallback_count",
  "corpus_build_latency_ms_total",
  "retrieval_latency_ms_total",
  "strict_denominator",
  "sensitivity_denominator",
  "evidence_policies",
  "dialog_projection_version",
  "include_session_datetime",
  "blip_caption_policy",
  "vector_mode",
  "host_manager_mode",
  "query_instruction",
  "query_mode",
  "multi_query",
  "legacy_fallback",
  "gold_leakage_boundary",
  "profileProvenance",
  "repositoryCommit",
  "repositoryWorktreeClean",
  "repositoryProvenanceSource",
  "datasetSha256",
  "benchmarkNowSec",
  "materializationNowSec",
  "searchNowSec",
]);

const CLOCK_OVERRIDE_KEYS = new Set([
  "benchmark_now_sec",
  "materialization_now_sec",
  "search_now_sec",
  "benchmark_clock_contract",
  "materializationNowSec",
  "searchNowSec",
  "benchmarkClockContract",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizeErrorMessage(error) {
  return String(error?.message || error || "unknown error")
    .replace(/authorization\s*:\s*bearer\s+[^\s]+/gi, "authorization: bearer [redacted]")
    .replace(/bearer\s+[^\s]+/gi, "bearer [redacted]")
    .replace(/(api[_-]?key|token|secret)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 240);
}

function stageError(stage, error, details = {}) {
  if (error instanceof LongMemEvalSemanticProfileError) {
    error.details = { ...error.details, ...details };
    return error;
  }
  const wrapped = new LongMemEvalSemanticProfileError(stage, sanitizeErrorMessage(error));
  wrapped.details = { cause_message: sanitizeErrorMessage(error), ...details };
  return wrapped;
}

function fail(stage, message, details = {}) {
  throw new LongMemEvalSemanticProfileError(stage, message, details);
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

function normalizeProfileProvenance(value) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("provenance", "profile provenance must be an object");
  }
  try {
    assertNoGoldFields(value, "locomo_semantic_profile_provenance");
  } catch (error) {
    throw stageError("provenance", error);
  }
  const reserved = Object.keys(value).filter(key => RESERVED_PROVENANCE_KEYS.has(key));
  if (reserved.length > 0) fail("provenance", "profile provenance contains reserved keys", { reserved_keys: reserved });
  return { ...value };
}

function validateRepositoryProvenance(value) {
  const commit = String(value?.repository_commit ?? value?.repositoryCommit ?? "").trim();
  if (!GIT_COMMIT_PATTERN.test(commit)) fail("repository_provenance", "invalid repository commit");
  const clean = value?.repository_worktree_clean ?? value?.repositoryWorktreeClean;
  if (typeof clean !== "boolean") fail("repository_provenance", "invalid repository worktree state");
  const source = value?.repository_provenance_source ?? value?.repositoryProvenanceSource;
  if (source !== "git") fail("repository_provenance", "repository provenance source must be git");
  return {
    repository_commit: commit,
    repository_worktree_clean: clean,
    repository_provenance_source: source,
  };
}

function normalizeDatasetSha256(records, value) {
  if (value !== undefined && value !== null) {
    const normalized = String(value).trim();
    if (!HEX_SHA256_PATTERN.test(normalized)) fail("provenance", "invalid dataset SHA-256");
    return { value: normalized, source: "caller_input_bytes" };
  }
  return {
    value: sha256(Buffer.from(JSON.stringify(records), "utf8")),
    source: "runner_input_serialization",
  };
}

function positiveFixedTopK(value) {
  if (!Number.isSafeInteger(value) || value !== LOCOMO_SEMANTIC_TOP_K) {
    fail("contract", "semantic LoCoMo v2 top_k is fixed at 50", { actual_top_k: value });
  }
  return value;
}

function boundedLimit(value, length) {
  if (value === null || value === undefined) return length;
  if (!Number.isSafeInteger(value) || value < 0) fail("contract", "limit must be a non-negative safe integer");
  return Math.min(value, length);
}

function assertNoClockOverrides(options) {
  for (const key of CLOCK_OVERRIDE_KEYS) {
    if (Object.hasOwn(options, key)) fail("contract", `clock override is reserved:${key}`);
  }
  for (const key of [
    "profile",
    "lexicalConfidenceThreshold",
    "lexical_confidence_threshold",
    "vectorTopK",
    "vector_top_k",
    "vectorQueryPlan",
    "queryEmbeddingInputTransform",
    "queryInstruction",
    "multiQuery",
    "legacyFallback",
    "projectionVersion",
    "canonicalVectorProjectionVersion",
    "dialogProjectionVersion",
    "includeSessionDatetime",
    "blipCaptionPolicy",
    "includeBlipCaption",
  ]) {
    if (Object.hasOwn(options, key)) fail("contract", `semantic profile override is reserved:${key}`);
  }
}

function assertTemporaryPath(value, label, { root = null } = {}) {
  const candidate = resolve(String(value));
  const liveRoot = resolve(homedir(), ".openclaw", "memory");
  const temporaryRoot = resolve(tmpdir());
  if (candidate === liveRoot || candidate.startsWith(`${liveRoot}${sep}`)) {
    fail(`${label}_path`, "live OpenClaw memory path is forbidden");
  }
  if (!(candidate === temporaryRoot || candidate.startsWith(`${temporaryRoot}${sep}`))) {
    fail(`${label}_path`, "benchmark path must be temporary");
  }
  if (root !== null) {
    const parent = resolve(String(root));
    if (!(candidate === parent || candidate.startsWith(`${parent}${sep}`))) {
      fail(`${label}_path`, "conversation-owned path is required");
    }
  }
  return candidate;
}

function copyVector(vector) {
  if (Array.isArray(vector)) return [...vector];
  if (ArrayBuffer.isView(vector) && !(vector instanceof DataView)) return Array.from(vector);
  return null;
}

function assertEmbeddingDimension(vector, stage) {
  const copied = copyVector(vector);
  if (!copied || copied.length !== LOCOMO_SEMANTIC_EXPECTED_EMBEDDING_DIMENSION) {
    fail(`${stage}_embedding_dimension`, "unexpected embedding dimension", {
      expected_dimension: LOCOMO_SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
      actual_dimension: copied?.length ?? null,
    });
  }
  if (!copied.every(value => Number.isFinite(value))) {
    fail(`${stage}_embedding_dimension`, "embedding contains non-finite values");
  }
  return copied;
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
    baseUrlIdentity: normalizeEmbeddingBaseUrlIdentity(baseUrl || DEFAULT_SF_BASE_URL),
  };
}

function createStats() {
  return {
    providerCallCount: 0,
    embeddingCacheHits: 0,
    corpusEmbeddingCount: 0,
    queryEmbeddingCount: 0,
    totalEmbeddingLookups: 0,
    corpusBuildLatencyMs: 0,
    retrievalLatencyMs: 0,
    vectorAttemptedCount: 0,
    vectorSkippedCount: 0,
    vectorErrorCount: 0,
    hostManagerFallbackCount: 0,
  };
}

function addStats(target, source) {
  for (const key of [
    "providerCallCount",
    "embeddingCacheHits",
    "corpusEmbeddingCount",
    "queryEmbeddingCount",
    "totalEmbeddingLookups",
    "corpusBuildLatencyMs",
    "retrievalLatencyMs",
    "vectorAttemptedCount",
    "vectorSkippedCount",
    "vectorErrorCount",
    "hostManagerFallbackCount",
  ]) target[key] += Number(source[key] || 0);
}

async function getEmbedding(text, kind, { provider, cache, stats } = {}) {
  if (typeof text !== "string") fail(`${kind}_embedding_input`, "embedding input must be a string");
  const key = buildEmbeddingCacheKey({
    provider: LOCOMO_SEMANTIC_EMBEDDING_PROVIDER,
    baseUrl: provider.baseUrlIdentity,
    model: LOCOMO_SEMANTIC_EMBEDDING_MODEL,
    projectionVersion: CANONICAL_VECTOR_PROJECTION_VERSION,
    input: text,
  });
  let cached;
  try {
    cached = cache.get(key);
  } catch (error) {
    throw stageError("embedding_cache_read", error, { kind });
  }
  stats.totalEmbeddingLookups += 1;
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

export async function createLocomoSemanticVectorStore({ path } = {}) {
  const resolvedPath = assertTemporaryPath(path, "vector_store");
  let runtime = null;
  try {
    runtime = createLanceDbRuntime({
      dbPath: resolvedPath,
      logger: { log() {}, warn() {} },
      readyTimeoutMs: 5_000,
    });
    if (await runtime.ensureLanceDBReady() !== true) {
      fail("vector_store_initialization", `lancedb_${runtime.readyState?.state || "not_ready"}`);
    }
    const state = await runtime.getLanceDBRuntime({ timeoutMs: 5_000 });
    if (state?.readyState !== "ready" || !state.table) {
      fail("vector_store_initialization", `lancedb_${state?.readyState || "not_ready"}`);
    }
    return {
      owner: "runner",
      path: resolvedPath,
      table: state.table,
      // LanceDB owns its native connection; the temporary parent is removed
      // by the conversation data-plane close after this handle is released.
      close() {},
    };
  } catch (error) {
    throw stageError("vector_store_initialization", error);
  }
}

function normalizeVectorStore(store, path) {
  const table = store?.table || (store && typeof store.search === "function" ? store : null);
  if (!table) fail("vector_store_initialization", "temporary LanceDB table unavailable");
  return {
    owner: "runner",
    path,
    table,
    close: typeof store?.close === "function" ? store.close.bind(store) : null,
  };
}

export function createLocomoSemanticHybridRuntime(materialized, {
  topK = LOCOMO_SEMANTIC_TOP_K,
  vectorTable = null,
  generateEmbedding = null,
  searchNowSec,
} = {}) {
  positiveFixedTopK(topK);
  validateBenchmarkNowSec(searchNowSec);
  if (!vectorTable || typeof vectorTable.search !== "function") {
    fail("vector_runtime", "semantic profile requires a temporary LanceDB table");
  }
  if (typeof generateEmbedding !== "function") {
    fail("vector_runtime", "semantic profile requires an embedding function");
  }
  const adapter = createBenchmarkHybridRuntime(materialized, {
    topK,
    vectorTable,
    generateEmbedding,
    lexicalConfidenceThreshold: LOCOMO_SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD,
    searchNowSec,
    getMemorySearchManager: async () => {
      throw new Error("locomo_semantic_host_manager_fallback_forbidden");
    },
  });
  return {
    ...adapter,
    vector_mode: LOCOMO_SEMANTIC_VECTOR_MODE,
    host_manager_mode: LOCOMO_SEMANTIC_HOST_MANAGER_MODE,
  };
}

function conversationMemoryIds(materialized) {
  if (!(materialized?.memoryToDialog instanceof Map) || materialized.memoryToDialog.size < 1) {
    fail("corpus", "conversation memory mapping is required");
  }
  const ids = [...materialized.memoryToDialog.keys()];
  if (ids.some(id => typeof id !== "string" || id.length === 0)) fail("corpus", "invalid conversation memory id");
  return ids;
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
  const memoryIds = conversationMemoryIds(materialized);
  if (typeof runtime?.withHybridDbAccessScope !== "function") {
    fail("corpus_canonical_read", "isolated hybrid database scope is required");
  }
  let canonicalBatch;
  try {
    canonicalBatch = await runtime.withHybridDbAccessScope(async ({ withCoreDb, withEngineDb }) => (
      getCanonicalMemoriesByIds(memoryIds, { withCoreDb, withEngineDb })
    ));
  } catch (error) {
    throw stageError("corpus_canonical_read", error);
  }
  if (!canonicalBatch?.ok || !Array.isArray(canonicalBatch.results)
      || canonicalBatch.results.length !== memoryIds.length) {
    fail("corpus_canonical_read", "canonical batch read failed", {
      reason: canonicalBatch?.reason || "invalid_batch_result",
    });
  }

  const rows = [];
  for (const [index, resolved] of canonicalBatch.results.entries()) {
    if (!resolved?.ok || !resolved.memory || resolved.memory.memory_id !== memoryIds[index]) {
      fail("corpus_canonical_read", "canonical memory identity mismatch", {
        memory_index: index,
        memory_id: memoryIds[index],
      });
    }
    let projection;
    try {
      projection = projectCanonicalMemoryToVectorProjection(resolved.memory);
    } catch (error) {
      throw stageError("corpus_vector_projection", error, { memory_index: index });
    }
    if (projection.embedding_input !== projection.text
        || projection.text.length > CANONICAL_VECTOR_TEXT_MAX_CHARS) {
      fail("corpus_vector_projection", "Canonical vector projection contract violated", {
        memory_index: index,
      });
    }
    stats.corpusEmbeddingCount += 1;
    const vector = await getEmbedding(projection.embedding_input, "corpus", { provider, cache, stats });
    try {
      rows.push(materializeCanonicalLanceRow(projection, {
        vector,
        timestamp: Number.isFinite(Number(resolved.memory.source.updated_at))
          ? Number(resolved.memory.source.updated_at)
          : benchmarkNowSec,
      }));
    } catch (error) {
      throw stageError("corpus_vector_materialization", error, { memory_index: index });
    }
  }

  if (rows.length !== memoryIds.length) fail("vector_store_write", "LanceDB row count mismatch before write");
  if (typeof vectorStore?.table?.add !== "function") fail("vector_store_write", "temporary LanceDB add unavailable");
  try {
    await vectorStore.table.add(rows);
    if (typeof vectorStore.table.countRows === "function") {
      const actualRows = await vectorStore.table.countRows();
      if (Number(actualRows) !== rows.length) {
        fail("vector_store_write", "LanceDB row count mismatch after write", {
          expected_rows: rows.length,
          actual_rows: actualRows,
        });
      }
    }
  } catch (error) {
    if (error instanceof LongMemEvalSemanticProfileError) throw error;
    throw stageError("vector_store_write", error, { row_count: rows.length });
  }
  return rows.length;
}

function bindSemanticRuntime(adapter, searchNowSec) {
  const runtime = adapter?.runtime || adapter;
  if (!runtime || typeof runtime !== "object") fail("vector_runtime", "runtime object is required");
  if (Object.hasOwn(runtime, "searchNowSec") && runtime.searchNowSec !== searchNowSec) {
    fail("clock", "runtime search clock override is forbidden");
  }
  try {
    runtime.searchNowSec = searchNowSec;
  } catch (error) {
    throw stageError("clock", error);
  }
  if (runtime.searchNowSec !== searchNowSec) fail("clock", "runtime search clock mismatch");

  let fallbackCount = 0;
  try {
    runtime.getMemorySearchManager = async () => {
      fallbackCount += 1;
      throw new Error("locomo_semantic_host_manager_fallback_forbidden");
    };
  } catch (error) {
    throw stageError("vector_fallback", error);
  }
  return {
    runtime,
    fallbackCount: () => fallbackCount,
  };
}

function diagnostics(search, stats, searchNowSec) {
  const debug = search?.debug || {};
  const channels = Array.isArray(search?.channels) ? [...search.channels] : [];
  const canonical = debug.canonical_result_projection || null;
  return {
    pool: Number(search?.pool || 0),
    channels,
    channel_sizes: search?.channel_sizes || {},
    vector_mode: LOCOMO_SEMANTIC_VECTOR_MODE,
    vector_backend: debug.vector_backend || null,
    vector_stage: debug.vector_stage || null,
    vector_skipped: debug.vector_skipped === true,
    vector_skip_reason: debug.vector_skip_reason || null,
    vector_in_fusion: channels.includes("vector"),
    vector_candidate_count: Number(debug.candidate_counts_before_filtering?.vector_raw || 0),
    vector_top_k: LOCOMO_SEMANTIC_VECTOR_TOP_K,
    lexical_confidence: Number.isFinite(debug.lexical_confidence) ? debug.lexical_confidence : null,
    lexical_confidence_threshold: LOCOMO_SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD,
    search_now_sec: searchNowSec,
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
    vector_attempted_count: stats.vectorAttemptedCount,
    vector_skipped_count: stats.vectorSkippedCount,
    vector_error_count: stats.vectorErrorCount,
    host_manager_fallback_count: stats.hostManagerFallbackCount,
  };
}

function validateSemanticSearch(search, {
  stats,
  fallbackCount,
  queryEmbeddingError,
  searchNowSec,
} = {}) {
  if (queryEmbeddingError) {
    stats.vectorErrorCount += 1;
    throw queryEmbeddingError;
  }
  if (!search || typeof search !== "object" || !Array.isArray(search.results)) {
    stats.vectorErrorCount += 1;
    fail("vector_search", "hybrid search result is invalid");
  }
  const debug = search.debug || {};
  if (debug.search_now_sec !== searchNowSec) {
    stats.vectorErrorCount += 1;
    fail("clock", "search diagnostic clock mismatch", {
      expected_search_now_sec: searchNowSec,
      actual_search_now_sec: debug.search_now_sec ?? null,
    });
  }
  if (fallbackCount > 0) {
    stats.hostManagerFallbackCount += fallbackCount;
    stats.vectorErrorCount += 1;
    fail("vector_fallback", "host memory-manager fallback was called", {
      host_manager_fallback_count: fallbackCount,
    });
  }
  if (debug.vector_error) {
    stats.vectorErrorCount += 1;
    fail("vector_search", "production vector channel reported an error", {
      vector_error: sanitizeErrorMessage(debug.vector_error),
    });
  }
  if (debug.vector_skipped === true) {
    stats.vectorSkippedCount += 1;
    fail("vector_skipped", "semantic v2 vector channel was skipped", {
      skip_reason: debug.vector_skip_reason || null,
    });
  }
  if (debug.vector_backend !== "lancedb" || debug.vector_stage !== "lancedb_search") {
    stats.vectorErrorCount += 1;
    fail("vector_not_attempted", "production LanceDB vector search was not attempted", {
      vector_backend: debug.vector_backend || null,
      vector_stage: debug.vector_stage || null,
    });
  }
  const channels = Array.isArray(search.channels) ? search.channels : [];
  const vectorRaw = Number(debug.candidate_counts_before_filtering?.vector_raw || 0);
  const vectorFiltered = Number(debug.candidate_counts_before_filtering?.vector_after_conf_filter || 0);
  const droppedCount = Number(debug.canonical_result_projection?.dropped_count || 0);
  if (vectorRaw < 1 || vectorFiltered < 1 || !channels.includes("vector") || droppedCount > 0) {
    stats.vectorErrorCount += 1;
    fail("vector_search", "LanceDB vector candidates did not enter production fusion", {
      vector_raw: vectorRaw,
      vector_after_conf_filter: vectorFiltered,
      vector_in_fusion: channels.includes("vector"),
      canonical_dropped_count: droppedCount,
    });
  }
  stats.vectorAttemptedCount += 1;
}

function makeProvenance({
  profileProvenance,
  embeddingBaseUrlIdentity,
  repositoryProvenance,
  datasetSha256,
  datasetSha256Source,
  benchmarkNowSec,
  topK,
  stats,
  corporaBuilt,
  corpusLanceRows,
  strictDenominator,
  sensitivityDenominator,
  corpusRowCounts,
} = {}) {
  const extension = normalizeProfileProvenance(profileProvenance);
  return {
    ...getLocomoProvenance(),
    ...repositoryProvenance,
    profile: LOCOMO_SEMANTIC_PROFILE,
    dataset_sha256: datasetSha256,
    dataset_sha256_source: datasetSha256Source,
    benchmark_now_sec: benchmarkNowSec,
    materialization_now_sec: benchmarkNowSec,
    search_now_sec: benchmarkNowSec,
    benchmark_clock_contract: LOCOMO_SEMANTIC_BENCHMARK_CLOCK_CONTRACT,
    top_k: topK,
    vector_top_k: LOCOMO_SEMANTIC_VECTOR_TOP_K,
    evidence_policies: [LOCOMO_EVIDENCE_STRICT_V1, LOCOMO_EVIDENCE_CANONICALIZED_V1],
    strict_denominator: strictDenominator,
    sensitivity_denominator: sensitivityDenominator,
    locomo_dialog_text_projection: LOCOMO_DIALOG_TEXT_PROJECTION,
    dialog_projection_version: LOCOMO_DIALOG_PROJECTION_VERSION,
    include_session_datetime: LOCOMO_INCLUDE_SESSION_DATETIME,
    blip_caption_policy: LOCOMO_BLIP_CAPTION_POLICY,
    embedding_provider: LOCOMO_SEMANTIC_EMBEDDING_PROVIDER,
    embedding_base_url_identity: embeddingBaseUrlIdentity,
    embedding_model: LOCOMO_SEMANTIC_EMBEDDING_MODEL,
    embedding_model_revision: LOCOMO_SEMANTIC_EMBEDDING_MODEL_REVISION,
    embedding_dimension: LOCOMO_SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
    canonical_vector_projection_version: CANONICAL_VECTOR_PROJECTION_VERSION,
    canonical_vector_text_max_chars: CANONICAL_VECTOR_TEXT_MAX_CHARS,
    lexical_confidence_threshold: LOCOMO_SEMANTIC_LEXICAL_CONFIDENCE_THRESHOLD,
    embedding_cache_schema: LOCOMO_SEMANTIC_EMBEDDING_CACHE_SCHEMA,
    embedding_cache_user_version: LOCOMO_SEMANTIC_EMBEDDING_CACHE_SQLITE_USER_VERSION,
    query_instruction: LOCOMO_SEMANTIC_QUERY_INSTRUCTION,
    query_mode: LOCOMO_SEMANTIC_QUERY_MODE,
    multi_query: false,
    legacy_fallback: false,
    vector_mode: LOCOMO_SEMANTIC_VECTOR_MODE,
    host_manager_mode: LOCOMO_SEMANTIC_HOST_MANAGER_MODE,
    corpora_built: corporaBuilt,
    corpus_lancedb_row_count: corpusLanceRows,
    corpus_lancedb_row_counts: corpusRowCounts,
    provider_call_count: stats.providerCallCount,
    embedding_cache_hits: stats.embeddingCacheHits,
    corpus_embedding_count: stats.corpusEmbeddingCount,
    query_embedding_count: stats.queryEmbeddingCount,
    total_embedding_lookups: stats.totalEmbeddingLookups,
    vector_attempted_count: stats.vectorAttemptedCount,
    vector_skipped_count: stats.vectorSkippedCount,
    vector_error_count: stats.vectorErrorCount,
    host_manager_fallback_count: stats.hostManagerFallbackCount,
    corpus_build_latency_ms_total: stats.corpusBuildLatencyMs,
    retrieval_latency_ms_total: stats.retrievalLatencyMs,
    ...extension,
  };
}

function normalizeCache(cache, ownsCache) {
  if (!cache || typeof cache.get !== "function" || typeof cache.set !== "function"
      || (ownsCache && typeof cache.close !== "function")) {
    fail("embedding_cache_initialization", "invalid benchmark embedding cache");
  }
  return cache;
}

async function closeResource(resource) {
  if (!resource) return;
  if (typeof resource.close === "function") await resource.close();
}

async function runConversation(sensitivityItem, strictItem, {
  benchmarkNowSec,
  topK,
  temporaryParent,
  materialize,
  createRuntime,
  search,
  vectorStoreFactory,
  provider,
  cache,
  keepTemp,
} = {}) {
  const stats = createStats();
  let dataPlane = null;
  let vectorStore = null;
  let runtimeAdapter = null;
  let runtimeBinding = null;
  let primaryError = null;
  const corpusBuildStarted = performance.now();
  const caseRow = {
    sample_id: sensitivityItem.sample_id,
    dialog_count: 0,
    lancedb_row_count: 0,
  };
  try {
    dataPlane = await materialize(sensitivityItem, {
      benchmarkNowSec,
      temporaryParent,
      removeOnClose: !keepTemp,
    });
    if (dataPlane?.benchmarkNowSec !== benchmarkNowSec) {
      fail("clock", "materialization clock mismatch");
    }
    const vectorPath = assertTemporaryPath(join(dataPlane.root, "semantic-vector"), "vector_store", {
      root: dataPlane.root,
    });
    let createdVectorStore;
    try {
      createdVectorStore = await vectorStoreFactory({ path: vectorPath, sampleId: sensitivityItem.sample_id });
    } catch (error) {
      throw stageError("vector_store_initialization", error);
    }
    vectorStore = normalizeVectorStore(createdVectorStore, vectorPath);
    const queryInputs = [];
    let expectedQuery = null;
    let queryEmbeddingError = null;
    const queryEmbedding = async query => {
      if (typeof query !== "string" || query.length === 0) fail("query_embedding_input", "exact question text is required");
      if (expectedQuery !== null && query !== expectedQuery) {
        fail("query_embedding_input", "query embedding did not receive the exact question text");
      }
      queryInputs.push(query);
      stats.queryEmbeddingCount += 1;
      try {
        return await getEmbedding(query, "query", { provider, cache, stats });
      } catch (error) {
        queryEmbeddingError = error;
        throw error;
      }
    };
    runtimeAdapter = await createRuntime(dataPlane, {
      topK,
      vectorTable: vectorStore.table,
      generateEmbedding: queryEmbedding,
      searchNowSec: benchmarkNowSec,
    });
    runtimeBinding = bindSemanticRuntime(runtimeAdapter, benchmarkNowSec);
    caseRow.dialog_count = conversationMemoryIds(dataPlane).length;
    caseRow.lancedb_row_count = await materializeSemanticCorpus({
      materialized: dataPlane,
      runtime: runtimeBinding.runtime,
      vectorStore,
      provider,
      cache,
      stats,
      benchmarkNowSec,
    });
    stats.corpusBuildLatencyMs = performance.now() - corpusBuildStarted;

    const rows = [];
    for (let questionIndex = 0; questionIndex < sensitivityItem.questions.length; questionIndex += 1) {
      const sensitivityQuestion = sensitivityItem.questions[questionIndex];
      const strictQuestion = strictItem.questions[questionIndex];
      let retrieved = [];
      let retrievedMemoryIds = [];
      let retrievedDialogIdentities = [];
      let retrievedSessionIds = [];
      let searchDiagnostics = null;
      let latencyMs = 0;
      const beforeQueryStats = { ...stats };
      if (sensitivityQuestion.scoreable) {
        const request = buildLocomoSearchRequest(sensitivityItem, {
          questionIndex,
          topK,
          evidencePolicy: LOCOMO_EVIDENCE_CANONICALIZED_V1,
        });
        expectedQuery = request.query;
        queryEmbeddingError = null;
        const started = performance.now();
        let searchResult;
        try {
          searchResult = await search(request.query, { topK }, runtimeBinding.runtime);
        } catch (error) {
          if (error?.stage !== "query_embedding" && !queryEmbeddingError) {
            throw stageError("vector_search", error);
          }
        } finally {
          latencyMs = performance.now() - started;
          stats.retrievalLatencyMs += latencyMs;
        }
        if (queryEmbeddingError) {
          stats.vectorErrorCount += 1;
          if (queryEmbeddingError instanceof LongMemEvalSemanticProfileError) throw queryEmbeddingError;
          throw stageError("query_embedding", queryEmbeddingError);
        }
        validateSemanticSearch(searchResult, {
          stats,
          fallbackCount: runtimeBinding.fallbackCount(),
          queryEmbeddingError,
          searchNowSec: benchmarkNowSec,
        });
        const mapped = mapLocomoSearchResultsToDialogs(searchResult.results, dataPlane.memoryToDialog);
        retrievedMemoryIds = mapped.map(value => value.memory_id);
        retrievedDialogIdentities = mapped.map(value => ({
          sample_id: value.sample_id,
          dia_id: value.dia_id,
          session_id: value.session_id,
        }));
        retrieved = mapped.map(value => value.dia_id);
        const scored = scoreLocomoRetrieval(sensitivityItem, retrieved, {
          questionIndex,
          evidencePolicy: LOCOMO_EVIDENCE_CANONICALIZED_V1,
        });
        retrievedSessionIds = scored.projected_session_ids || [];
        searchDiagnostics = diagnostics(searchResult, {
          ...stats,
          providerCallCount: stats.providerCallCount - beforeQueryStats.providerCallCount,
          embeddingCacheHits: stats.embeddingCacheHits - beforeQueryStats.embeddingCacheHits,
          corpusEmbeddingCount: stats.corpusEmbeddingCount - beforeQueryStats.corpusEmbeddingCount,
          queryEmbeddingCount: stats.queryEmbeddingCount - beforeQueryStats.queryEmbeddingCount,
          vectorAttemptedCount: stats.vectorAttemptedCount - beforeQueryStats.vectorAttemptedCount,
          vectorSkippedCount: stats.vectorSkippedCount - beforeQueryStats.vectorSkippedCount,
          vectorErrorCount: stats.vectorErrorCount - beforeQueryStats.vectorErrorCount,
          hostManagerFallbackCount: runtimeBinding.fallbackCount(),
        }, benchmarkNowSec);
        const strictScore = strictQuestion.scoreable
          ? scoreLocomoRetrieval(strictItem, retrieved, {
            questionIndex,
            evidencePolicy: LOCOMO_EVIDENCE_STRICT_V1,
          })
          : null;
        rows.push({
          question_id: sensitivityQuestion.question_id,
          sample_id: sensitivityItem.sample_id,
          qa_index: sensitivityQuestion.qa_index,
          category: sensitivityQuestion.category,
          category_name: sensitivityQuestion.category_name,
          retrieved_memory_ids: retrievedMemoryIds,
          retrieved_dialog_identities: retrievedDialogIdentities,
          retrieved_dialog_ids: retrieved,
          retrieved_session_ids: retrievedSessionIds,
          corpus_sessions: sensitivityItem.sessions.length,
          latency_ms: latencyMs,
          strict: strictScore ? publicMetrics(strictScore.dialog) : skippedMetrics(strictQuestion),
          strict_session: strictScore ? publicMetrics(strictScore.session) : skippedMetrics(strictQuestion),
          sensitivity: publicMetrics(scored.dialog),
          sensitivity_session: publicMetrics(scored.session),
          diagnostics: searchDiagnostics,
        });
      } else {
        rows.push({
          question_id: sensitivityQuestion.question_id,
          sample_id: sensitivityItem.sample_id,
          qa_index: sensitivityQuestion.qa_index,
          category: sensitivityQuestion.category,
          category_name: sensitivityQuestion.category_name,
          retrieved_memory_ids: [],
          retrieved_dialog_identities: [],
          retrieved_dialog_ids: [],
          retrieved_session_ids: [],
          corpus_sessions: sensitivityItem.sessions.length,
          latency_ms: 0,
          strict: skippedMetrics(strictQuestion),
          strict_session: skippedMetrics(strictQuestion),
          sensitivity: skippedMetrics(sensitivityQuestion),
          sensitivity_session: skippedMetrics(sensitivityQuestion),
          diagnostics: null,
        });
      }
      // The query input is intentionally retained only for an internal
      // assertion/debugging seam; it is never placed in vector metadata or cache provenance.
      if (sensitivityQuestion.scoreable && queryInputs.length > 0
          && queryInputs[queryInputs.length - 1] !== sensitivityQuestion.question) {
        fail("query_embedding_input", "query embedding did not receive the exact question text");
      }
      expectedQuery = null;
    }
    return { rows, stats, corpus: caseRow };
  } catch (error) {
    primaryError = error instanceof LongMemEvalSemanticProfileError ? error : stageError("case", error);
    primaryError.details = {
      ...(primaryError.details || {}),
      provider_call_count: stats.providerCallCount,
      embedding_cache_hits: stats.embeddingCacheHits,
      corpus_embedding_count: stats.corpusEmbeddingCount,
      query_embedding_count: stats.queryEmbeddingCount,
      vector_attempted_count: stats.vectorAttemptedCount,
      vector_skipped_count: stats.vectorSkippedCount,
      vector_error_count: stats.vectorErrorCount,
      host_manager_fallback_count: runtimeBinding?.fallbackCount?.() || 0,
    };
    throw primaryError;
  } finally {
    const cleanupErrors = [];
    for (const resource of [runtimeAdapter, vectorStore, dataPlane]) {
      try {
        await closeResource(resource);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (!primaryError && cleanupErrors.length > 0) throw stageError("cleanup", cleanupErrors[0]);
  }
}

function selectItems(records, limit) {
  if (!Array.isArray(records)) fail("dataset", "LoCoMo dataset must be an array");
  const selectedCount = boundedLimit(limit, records.length);
  return {
    strictItems: normalizeLocomoDataset(records.slice(0, selectedCount), {
      evidencePolicy: LOCOMO_EVIDENCE_STRICT_V1,
    }),
    sensitivityItems: normalizeLocomoDataset(records.slice(0, selectedCount), {
      evidencePolicy: LOCOMO_EVIDENCE_CANONICALIZED_V1,
    }),
  };
}

function denominator(policySummary) {
  return {
    cases: policySummary.cases,
    scored_cases: policySummary.scored_cases,
    skipped_cases: policySummary.skipped_cases,
    skipped_by_reason: policySummary.skipped_by_reason,
  };
}

function assertOfficialSemanticContract({
  datasetSha256,
  corpusRows,
  stats,
  summary,
} = {}) {
  if (datasetSha256 !== LOCOMO_DATASET_SHA256) return;
  if (summary?.conversations !== 10) return;
  if (summary.cases !== 1_986
      || summary.strict?.scored_cases !== 1_972
      || summary.strict?.skipped_cases !== 14
      || summary.sensitivity?.scored_cases !== 1_978
      || summary.sensitivity?.skipped_cases !== 8
      || stats.corpusEmbeddingCount !== 5_882
      || stats.queryEmbeddingCount !== 1_978
      || stats.totalEmbeddingLookups !== 7_860
      || corpusRows.length !== 10
      || corpusRows.some(row => row.dialog_count !== row.lancedb_row_count)
      || stats.vectorAttemptedCount !== 1_978
      || stats.vectorSkippedCount !== 0
      || stats.vectorErrorCount !== 0
      || stats.hostManagerFallbackCount !== 0) {
    fail("contract", "official LoCoMo semantic v2 invariant failed", {
      conversations: summary.conversations,
      corpus_embedding_count: stats.corpusEmbeddingCount,
      query_embedding_count: stats.queryEmbeddingCount,
      total_embedding_lookups: stats.totalEmbeddingLookups,
      vector_attempted_count: stats.vectorAttemptedCount,
      vector_skipped_count: stats.vectorSkippedCount,
      vector_error_count: stats.vectorErrorCount,
      host_manager_fallback_count: stats.hostManagerFallbackCount,
    });
  }
}

export async function runLocomoSemanticRetrievalDataset(records, options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    fail("contract", "semantic runner options must be an object");
  }
  assertNoClockOverrides(options);
  if (!Object.hasOwn(options, "benchmarkNowSec") || options.benchmarkNowSec === undefined) {
    fail("contract", "benchmark_now_sec is required");
  }
  const benchmarkNowSec = validateBenchmarkNowSec(options.benchmarkNowSec);
  const topK = positiveFixedTopK(options.topK === undefined ? LOCOMO_SEMANTIC_TOP_K : options.topK);
  const limit = options.limit === undefined ? null : options.limit;
  const selected = selectItems(records, limit);
  const repositoryProvenance = validateRepositoryProvenance(
    options.repositoryProvenance || resolveLocomoRepositoryProvenance(),
  );
  if (!repositoryProvenance.repository_worktree_clean) {
    fail("repository_provenance", "benchmark source worktree must be clean");
  }
  const datasetIdentity = normalizeDatasetSha256(records, options.datasetSha256);
  const extension = normalizeProfileProvenance(options.profileProvenance);
  if (options.cachePath !== undefined && options.embeddingCache) {
    fail("embedding_cache_initialization", "embeddingCache and cachePath cannot both be supplied");
  }
  if (options.cachePath !== undefined && options.cachePath !== null) {
    assertTemporaryPath(options.cachePath, "embedding_cache");
  }
  const embeddingProvider = createProvider(options);
  const ownsCache = !options.embeddingCache;
  const cache = normalizeCache(
    options.embeddingCache || (options.embeddingCacheFactory || createBenchmarkEmbeddingCache)(options.cachePath ?? null),
    ownsCache,
  );
  const materialize = options.materialize || materializeLocomoConversationDataPlane;
  const createRuntime = options.createRuntime || createLocomoSemanticHybridRuntime;
  const search = options.search || hybridSearch;
  const vectorStoreFactory = options.vectorStoreFactory || createLocomoSemanticVectorStore;
  for (const [name, value] of [["materializer", materialize], ["runtime_factory", createRuntime], ["search", search], ["vector_store_factory", vectorStoreFactory]]) {
    if (typeof value !== "function") fail("contract", `${name} must be a function`);
  }

  const allRows = [];
  const corpusRows = [];
  const stats = createStats();
  let corporaBuilt = 0;
  try {
    for (let index = 0; index < selected.sensitivityItems.length; index += 1) {
      const conversation = await runConversation(selected.sensitivityItems[index], selected.strictItems[index], {
        benchmarkNowSec,
        topK,
        temporaryParent: options.temporaryParent || tmpdir(),
        materialize,
        createRuntime,
        search,
        vectorStoreFactory,
        provider: embeddingProvider,
        cache,
        keepTemp: options.keepTemp === true,
      });
      allRows.push(...conversation.rows);
      corpusRows.push(conversation.corpus);
      addStats(stats, conversation.stats);
      corporaBuilt += 1;
    }
    const strict = aggregatePolicy(allRows, "strict");
    const sensitivity = aggregatePolicy(allRows, "sensitivity");
    const summary = {
      schema: LOCOMO_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA,
      profile: LOCOMO_SEMANTIC_PROFILE,
      cases: allRows.length,
      retrieval_cases: sensitivity.scored_cases,
      conversations: selected.sensitivityItems.length,
      corpora_built: corporaBuilt,
      corpus_reuse_searches: sensitivity.scored_cases,
      corpus_embedding_count: stats.corpusEmbeddingCount,
      query_embedding_count: stats.queryEmbeddingCount,
      total_embedding_lookups: stats.totalEmbeddingLookups,
      corpus_lancedb_row_count: corpusRows.reduce((sum, row) => sum + row.lancedb_row_count, 0),
      corpus_lancedb_row_counts: corpusRows,
      corpus_build_latency_ms_total: stats.corpusBuildLatencyMs,
      retrieval_latency_ms_total: stats.retrievalLatencyMs,
      mean_retrieval_latency_ms: sensitivity.scored_cases > 0
        ? stats.retrievalLatencyMs / sensitivity.scored_cases
        : null,
      provider_call_count: stats.providerCallCount,
      embedding_cache_hits: stats.embeddingCacheHits,
      vector_attempted_count: stats.vectorAttemptedCount,
      vector_skipped_count: stats.vectorSkippedCount,
      vector_error_count: stats.vectorErrorCount,
      host_manager_fallback_count: stats.hostManagerFallbackCount,
      strict,
      sensitivity,
    };
    assertOfficialSemanticContract({
      datasetSha256: datasetIdentity.value,
      corpusRows,
      stats,
      summary,
    });
    const provenance = makeProvenance({
      profileProvenance: {
        ...extension,
      },
      embeddingBaseUrlIdentity: embeddingProvider.baseUrlIdentity,
      repositoryProvenance,
      datasetSha256: datasetIdentity.value,
      datasetSha256Source: datasetIdentity.source,
      benchmarkNowSec,
      topK,
      stats,
      corporaBuilt,
      corpusLanceRows: summary.corpus_lancedb_row_count,
      corpusRowCounts: corpusRows,
      strictDenominator: denominator(strict),
      sensitivityDenominator: denominator(sensitivity),
    });
    const run = {
      ...provenance,
      profile: LOCOMO_SEMANTIC_PROFILE,
      top_k: topK,
      vector_top_k: LOCOMO_SEMANTIC_VECTOR_TOP_K,
      requested_conversation_limit: limit,
      conversations: selected.sensitivityItems.length,
      corpus_owner: "conversation",
      corpus_reuse: "same_conversation_questions_share_one_temporary_data_plane",
      primary_metric_level: "dialog",
      compatibility_metric_level: "session_projection",
      corpus_build_latency_ms_total: stats.corpusBuildLatencyMs,
      retrieval_latency_ms_total: stats.retrievalLatencyMs,
    };
    return {
      schema: LOCOMO_SEMANTIC_RETRIEVAL_RUNNER_SCHEMA,
      profile: LOCOMO_SEMANTIC_PROFILE,
      provenance,
      run,
      summary,
      results: allRows,
    };
  } finally {
    if (ownsCache) await closeResource(cache);
  }
}

export async function runLocomoSemanticRetrievalCase(record, options = {}) {
  return runLocomoSemanticRetrievalDataset([record], { ...options, limit: null });
}

export const runLocomoTimeFrozenSemanticRetrievalDataset = runLocomoSemanticRetrievalDataset;
export const runLocomoTimeFrozenSemanticRetrievalCase = runLocomoSemanticRetrievalCase;
