import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

import lancedb from "@lancedb/lancedb";

import {
  CANONICAL_VECTOR_PROJECTION_VERSION,
  CANONICAL_VECTOR_TEXT_MAX_CHARS,
  materializeCanonicalLanceRow,
  projectCanonicalMemoryToVectorProjection,
} from "../canonical/vector-projection.js";
import { DEFAULT_SF_BASE_URL } from "../siliconflow-runtime.js";
import {
  buildEmbeddingCacheKey,
  createBenchmarkEmbeddingCache,
  normalizeEmbeddingBaseUrlIdentity,
  SEMANTIC_EMBEDDING_CACHE_SCHEMA,
  SEMANTIC_EMBEDDING_MODEL,
  SEMANTIC_EMBEDDING_MODEL_REVISION,
  SEMANTIC_EMBEDDING_PROVIDER,
  SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
} from "./longmemeval-semantic-retrieval-runner-v1.js";

export const AML_SEMANTIC_BACKEND_SCHEMA = "memory_engine_aml_semantic_backend_v1";
export const AML_SEMANTIC_BACKEND_VERSION = AML_SEMANTIC_BACKEND_SCHEMA;
export const AML_SEMANTIC_VECTOR_MODE = "temporary_lancedb_per_user_v1";
export const AML_SEMANTIC_VECTOR_TABLE = "chunks";

const INTERNAL_SEED_ID = "__memory_engine_aml_semantic_backend_seed__";

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

export class AmlSemanticBackendError extends Error {
  constructor(stage, message, details = {}) {
    super(`aml_semantic_${stage}${message ? `: ${sanitizeErrorMessage({ message })}` : ""}`);
    this.name = "AmlSemanticBackendError";
    this.stage = stage;
    this.code = `aml_semantic_${stage}`;
    this.details = { ...details };
  }
}

function stageError(stage, error, details = {}) {
  if (error instanceof AmlSemanticBackendError) {
    error.details = { ...error.details, ...details };
    return error;
  }
  return new AmlSemanticBackendError(stage, sanitizeErrorMessage(error), {
    cause_message: sanitizeErrorMessage(error),
    ...details,
  });
}

function assertTemporaryPath(value, name) {
  const temporaryRoot = resolve(tmpdir());
  const candidate = resolve(String(value || ""));
  if (!(candidate === temporaryRoot || candidate.startsWith(`${temporaryRoot}${sep}`))) {
    throw new AmlSemanticBackendError(`${name}_path`, "benchmark path must be below the operating-system temporary directory");
  }
  return candidate;
}

function assertDescendant(candidate, parent, name) {
  const relativePath = relative(parent, candidate);
  if (relativePath.startsWith("..") || relativePath.includes(`..${sep}`) || resolve(candidate) === resolve(parent)) {
    throw new AmlSemanticBackendError(`${name}_path`, "benchmark path must remain inside its owner root");
  }
  return candidate;
}

function requireEmbeddingProvider(value) {
  if (typeof value === "function") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.embed === "function") return value.embed.bind(value);
    if (typeof value.generateEmbedding === "function") return value.generateEmbedding.bind(value);
  }
  throw new AmlSemanticBackendError(
    "embedding_provider_required",
    "an explicitly injected embedding provider is required",
  );
}

function requireCache(value) {
  if (!value || typeof value !== "object" || typeof value.get !== "function" ||
      typeof value.set !== "function" || typeof value.close !== "function") {
    throw new AmlSemanticBackendError("embedding_cache_open", "embedding cache must expose get, set, and close");
  }
  return value;
}

function copyVector(value) {
  if (Array.isArray(value)) return [...value];
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) return Array.from(value);
  if (value && typeof value[Symbol.iterator] === "function") return Array.from(value);
  return null;
}

function assertEmbeddingVector(value, stage) {
  const vector = copyVector(value);
  if (!vector || vector.length !== SEMANTIC_EXPECTED_EMBEDDING_DIMENSION) {
    throw new AmlSemanticBackendError(`${stage}_embedding_dimension`, "unexpected embedding dimension", {
      expected_dimension: SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
      actual_dimension: vector?.length ?? null,
    });
  }
  if (!vector.every(number => Number.isFinite(number))) {
    throw new AmlSemanticBackendError(`${stage}_embedding_dimension`, "embedding contains non-finite values", {
      expected_dimension: SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
    });
  }
  return vector;
}

function escapePredicateValue(value) {
  return String(value).replaceAll("'", "''");
}

function idPredicate(memoryId) {
  return `id = '${escapePredicateValue(memoryId)}'`;
}

function isFiniteTimestamp(value) {
  return Number.isFinite(Number(value));
}

function isReusableRow(row, expected) {
  return row && String(row.id) === String(expected.id) &&
    row.text === expected.text &&
    isFiniteTimestamp(row.timestamp) &&
    (() => {
      try {
        assertEmbeddingVector(row.vector, "stored");
        return true;
      } catch {
        return false;
      }
    })();
}

async function toRows(query) {
  if (!query) return [];
  if (typeof query.toArray === "function") return await query.toArray();
  if (typeof query.execute === "function") {
    const value = await query.execute();
    if (Array.isArray(value)) return value;
    if (value && typeof value[Symbol.asyncIterator] === "function") {
      const rows = [];
      for await (const row of value) rows.push(row);
      return rows;
    }
    return [];
  }
  throw new Error("query result cannot be materialized");
}

async function findRowsById(table, memoryId) {
  const query = table.query()
    .where(idPredicate(memoryId))
    .limit(2);
  return toRows(query);
}

function assertExactProjection(canonicalMemory, projection) {
  if (!canonicalMemory || typeof canonicalMemory !== "object" || Array.isArray(canonicalMemory)) {
    throw new AmlSemanticBackendError("corpus_projection", "canonical memory is required");
  }
  let expected;
  try {
    expected = projectCanonicalMemoryToVectorProjection(canonicalMemory);
  } catch (error) {
    throw stageError("corpus_projection", error);
  }
  const fields = [
    "projection_version",
    "memory_id",
    "canonical_id",
    "source_content_hash",
    "text",
    "embedding_input",
    "text_truncated",
    "source_text_length",
  ];
  if (fields.some(field => projection[field] !== expected[field])) {
    throw new AmlSemanticBackendError(
      "corpus_projection",
      "caller projection does not match the canonical vector projection",
    );
  }
  return expected;
}

async function closeHandle(handle, name) {
  if (!handle || typeof handle.close !== "function") return;
  try {
    await handle.close();
  } catch (error) {
    throw stageError("resource_close", error, { resource: name });
  }
}

function wrapExecutable(value, state) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return value;
  return new Proxy(value, {
    get(target, property, receiver) {
      if (property === "execute" && typeof target.execute === "function") {
        return async (...args) => {
          try {
            return await target.execute(...args);
          } catch (error) {
            state.searchError = error;
            throw error;
          }
        };
      }
      if (property === "limit" && typeof target.limit === "function") {
        return (...args) => {
          try {
            return wrapExecutable(target.limit(...args), state);
          } catch (error) {
            state.searchError = error;
            throw error;
          }
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function instrumentSearchTable(table, state) {
  return new Proxy(table, {
    get(target, property, receiver) {
      if (property === "search" && typeof target.search === "function") {
        return (...args) => {
          state.searchCount += 1;
          try {
            return wrapExecutable(target.search(...args), state);
          } catch (error) {
            state.searchError = error;
            throw error;
          }
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

async function openVectorScope(vectorPath, connect) {
  let connection = null;
  let table = null;
  try {
    connection = await connect(vectorPath);
    const names = await connection.tableNames();
    if (Array.isArray(names) && names.includes(AML_SEMANTIC_VECTOR_TABLE)) {
      table = await connection.openTable(AML_SEMANTIC_VECTOR_TABLE);
    } else {
      const seed = {
        id: INTERNAL_SEED_ID,
        text: "",
        vector: new Array(SEMANTIC_EXPECTED_EMBEDDING_DIMENSION).fill(0),
        timestamp: 0,
      };
      table = await connection.createTable(AML_SEMANTIC_VECTOR_TABLE, [seed]);
      await table.delete(idPredicate(INTERNAL_SEED_ID));
    }
    return { connection, table };
  } catch (error) {
    await closeHandle(table, "lancedb_table").catch(() => {});
    await closeHandle(connection, "lancedb_connection").catch(() => {});
    throw stageError("vector_store_init", error);
  }
}

function snapshotStats(stats) {
  return {
    provider_call_count: stats.providerCallCount,
    embedding_cache_hits: stats.embeddingCacheHits,
    corpus_embedding_count: stats.corpusEmbeddingCount,
    query_embedding_count: stats.queryEmbeddingCount,
    vector_search_count: stats.vectorSearchCount,
  };
}

export function createAmlSemanticBackend({
  root,
  vectorPath = null,
  embeddingProvider = null,
  embeddingBaseUrl = DEFAULT_SF_BASE_URL,
  embeddingCachePath = null,
  embeddingCacheFactory = createBenchmarkEmbeddingCache,
  lancedbConnect = path => lancedb.connect(path),
} = {}) {
  const resolvedRoot = assertTemporaryPath(root, "aml_semantic_root");
  const resolvedVectorPath = assertDescendant(
    resolve(vectorPath || join(resolvedRoot, "lancedb")),
    resolvedRoot,
    "aml_semantic_vector",
  );
  const resolvedCachePath = assertDescendant(
    resolve(embeddingCachePath || join(resolvedRoot, "embedding-cache.sqlite")),
    resolvedRoot,
    "aml_semantic_cache",
  );
  const embed = requireEmbeddingProvider(embeddingProvider);
  if (typeof embeddingCacheFactory !== "function") {
    throw new AmlSemanticBackendError("embedding_cache_factory_required", "embedding cache factory must be callable");
  }
  if (typeof lancedbConnect !== "function") {
    throw new AmlSemanticBackendError("vector_store_factory_required", "LanceDB connector must be callable");
  }
  mkdirSync(resolvedRoot, { recursive: true });
  mkdirSync(resolvedVectorPath, { recursive: true });

  const baseUrlIdentity = normalizeEmbeddingBaseUrlIdentity(embeddingBaseUrl);
  const provenance = Object.freeze({
    semantic_backend_version: AML_SEMANTIC_BACKEND_VERSION,
    embedding_provider: SEMANTIC_EMBEDDING_PROVIDER,
    embedding_base_url_identity: baseUrlIdentity,
    embedding_model: SEMANTIC_EMBEDDING_MODEL,
    embedding_model_revision: SEMANTIC_EMBEDDING_MODEL_REVISION,
    embedding_dimension: SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
    canonical_vector_projection_version: CANONICAL_VECTOR_PROJECTION_VERSION,
    canonical_vector_text_max_chars: CANONICAL_VECTOR_TEXT_MAX_CHARS,
    embedding_cache_schema: SEMANTIC_EMBEDDING_CACHE_SCHEMA,
    vector_store: "lancedb",
    vector_mode: AML_SEMANTIC_VECTOR_MODE,
  });
  const stats = {
    providerCallCount: 0,
    embeddingCacheHits: 0,
    corpusEmbeddingCount: 0,
    queryEmbeddingCount: 0,
    vectorSearchCount: 0,
  };
  let closed = false;

  function ensureOpen() {
    if (closed) throw new AmlSemanticBackendError("closed", "semantic backend is closed");
  }

  async function openCache() {
    let cache;
    try {
      cache = requireCache(await embeddingCacheFactory(resolvedCachePath));
      return cache;
    } catch (error) {
      throw stageError("embedding_cache_open", error);
    }
  }

  async function withOperation(callback) {
    ensureOpen();
    let cache = null;
    let vectorScope = null;
    let operationState = { searchCount: 0, searchError: null, embeddingError: null };
    let primaryError = null;
    let result;
    try {
      cache = await openCache();
      vectorScope = await openVectorScope(resolvedVectorPath, lancedbConnect);
      const state = operationState;
      result = await callback({ cache, table: vectorScope.table, connection: vectorScope.connection, state });
      if (state.searchError) throw stageError("vector_search", state.searchError);
      if (state.embeddingError) throw stageError("query_embedding", state.embeddingError);
    } catch (error) {
      primaryError = operationState.searchError
        ? stageError("vector_search", operationState.searchError)
        : (operationState.embeddingError
          ? stageError("query_embedding", operationState.embeddingError)
        : (error instanceof AmlSemanticBackendError
          ? error
          : stageError("operation", error)));
    }

    stats.vectorSearchCount += operationState.searchCount;
    let closeError = null;
    try {
      await closeHandle(vectorScope?.table, "lancedb_table");
    } catch (error) {
      closeError ||= error;
    }
    try {
      await closeHandle(vectorScope?.connection, "lancedb_connection");
    } catch (error) {
      closeError ||= error;
    }
    try {
      await closeHandle(cache, "embedding_cache");
    } catch (error) {
      closeError ||= error;
    }
    if (primaryError) throw primaryError;
    if (closeError) throw closeError;
    return result;
  }

  async function embedWithCache(input, kind, cache) {
    const exactInput = String(input);
    const key = buildEmbeddingCacheKey({
      provider: SEMANTIC_EMBEDDING_PROVIDER,
      baseUrl: baseUrlIdentity,
      model: SEMANTIC_EMBEDDING_MODEL,
      projectionVersion: CANONICAL_VECTOR_PROJECTION_VERSION,
      input: exactInput,
    });
    let cached;
    try {
      cached = await cache.get(key);
    } catch (error) {
      throw stageError("embedding_cache_read", error, { kind });
    }
    if (cached != null) {
      stats.embeddingCacheHits += 1;
      try {
        return assertEmbeddingVector(cached, `${kind}_cached`);
      } catch (error) {
        throw stageError(`${kind}_embedding`, error);
      }
    }
    stats.providerCallCount += 1;
    let provided;
    try {
      provided = await embed(exactInput);
    } catch (error) {
      throw stageError(`${kind}_embedding`, error);
    }
    const vector = assertEmbeddingVector(provided, kind);
    try {
      await cache.set(key, vector);
    } catch (error) {
      throw stageError("embedding_cache_write", error, { kind });
    }
    return vector;
  }

  async function addCanonicalMemory({ canonicalMemory, projection, timestamp, vectorPath: requestedVectorPath } = {}) {
    ensureOpen();
    if (requestedVectorPath && resolve(requestedVectorPath) !== resolvedVectorPath) {
      throw new AmlSemanticBackendError("vector_path", "caller cannot override the benchmark-owned vector path");
    }
    if (!projection || typeof projection !== "object" || typeof projection.memory_id !== "string") {
      throw new AmlSemanticBackendError("corpus_projection", "canonical vector projection is required");
    }
    const exactProjection = assertExactProjection(canonicalMemory, projection);
    return withOperation(async ({ cache, table }) => {
      let rows;
      try {
        rows = await findRowsById(table, exactProjection.memory_id);
      } catch (error) {
        throw stageError("vector_read", error);
      }
      const expectedShape = {
        id: exactProjection.memory_id,
        text: exactProjection.text,
      };
      if (rows.length === 1 && isReusableRow(rows[0], expectedShape)) {
        return {
          reused: true,
          row: rows[0],
          stats: snapshotStats(stats),
        };
      }
      if (rows.length > 0) {
        try {
          await table.delete(idPredicate(exactProjection.memory_id));
        } catch (error) {
          throw stageError("vector_write", error);
        }
      }
      stats.corpusEmbeddingCount += 1;
      const vector = await embedWithCache(exactProjection.embedding_input, "corpus", cache);
      let row;
      try {
        row = materializeCanonicalLanceRow(exactProjection, { vector, timestamp });
        await table.add([row]);
      } catch (error) {
        throw stageError("vector_write", error);
      }
      return {
        reused: false,
        row,
        stats: snapshotStats(stats),
      };
    });
  }

  async function withSearchRuntime(callback) {
    if (typeof callback !== "function") throw new AmlSemanticBackendError("search_callback", "search callback is required");
    return withOperation(async ({ cache, table, state }) => {
      const generateEmbedding = async query => {
        stats.queryEmbeddingCount += 1;
        try {
          return await embedWithCache(query, "query", cache);
        } catch (error) {
          state.embeddingError = error;
          throw error;
        }
      };
      const result = await callback({
        table: instrumentSearchTable(table, state),
        generateEmbedding,
        provenance,
      });
      return result;
    });
  }

  async function removeMemory(memoryId) {
    ensureOpen();
    if (typeof memoryId !== "string" || memoryId.length === 0) return;
    await withOperation(async ({ table }) => {
      try {
        await table.delete(idPredicate(memoryId));
      } catch (error) {
        throw stageError("vector_write", error);
      }
    });
  }

  async function close() {
    if (closed) return;
    closed = true;
  }

  return {
    schema: AML_SEMANTIC_BACKEND_SCHEMA,
    version: AML_SEMANTIC_BACKEND_VERSION,
    vector_mode: AML_SEMANTIC_VECTOR_MODE,
    vector_path: resolvedVectorPath,
    embedding_cache_path: resolvedCachePath,
    provenance,
    addCanonicalMemory,
    withSearchRuntime,
    removeMemory,
    close,
    snapshotStats: () => snapshotStats(stats),
    get closed() {
      return closed;
    },
  };
}

export function hashAmlSemanticBackendInput(value) {
  return sha256(value);
}
