import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import Database from "better-sqlite3";

import { MEMORY_ENGINE_DEFAULTS } from "../config/defaults.js";
import { getCanonicalMemoryById } from "../canonical/read-adapter.js";
import { projectCanonicalMemoryToVectorProjection } from "../canonical/vector-projection.js";
import { autoRouteCategory, catParams } from "../memory-confidence.js";
import { hybridSearch } from "../recall/hybrid-search.js";
import { createAmlSemanticBackend } from "./aml-semantic-backend-v1.js";
import { createBenchmarkHybridRuntime } from "./longmemeval-retrieval-runner-v1.js";

export const AML_DATA_PLANE_SCHEMA = "memory_engine_aml_data_plane_v1";
export const AML_ADD_PROJECTION_VERSION = "aml_add_projection_v1";
export const AML_SEARCH_EVIDENCE_SURFACE = "production_hybrid_text_240_v1";
export const AML_HOST_MANAGER_MODE = "forbidden";
export const AML_DEFAULT_MAX_TOP_K = 100;

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name}_must_be_positive_integer`);
  return parsed;
}

function assertTemporaryParent(value = tmpdir()) {
  const temporaryRoot = resolve(tmpdir());
  const candidate = resolve(String(value || temporaryRoot));
  if (!(candidate === temporaryRoot || candidate.startsWith(`${temporaryRoot}${sep}`))) {
    throw new Error("aml_temporary_root_required");
  }
  return candidate;
}

function safePathPart(value, fallback = "value") {
  const normalized = String(value || fallback)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function createCoreSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT,
      model TEXT,
      text TEXT NOT NULL,
      embedding TEXT,
      updated_at INTEGER
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      text,
      id UNINDEXED,
      path UNINDEXED,
      source UNINDEXED,
      model UNINDEXED,
      start_line UNINDEXED,
      end_line UNINDEXED
    );
  `);
}

function createEngineSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_confidence (
      chunk_id TEXT PRIMARY KEY,
      initial_confidence REAL NOT NULL,
      confidence REAL NOT NULL,
      last_confidence_update INTEGER,
      base_tau REAL NOT NULL,
      hit_count INTEGER NOT NULL,
      is_archived INTEGER NOT NULL,
      is_protected INTEGER NOT NULL,
      conflict_flag INTEGER NOT NULL,
      category TEXT NOT NULL,
      kg_data TEXT
    );
    CREATE TABLE IF NOT EXISTS aml_add_requests (
      request_id TEXT PRIMARY KEY,
      payload_sha256 TEXT NOT NULL,
      session_id TEXT NOT NULL,
      memory_id TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
  `);
}

function normalizedPayload(request) {
  return {
    request_id: request.request_id,
    user_id: request.user_id,
    session_id: request.session_id,
    messages: request.messages.map(message => ({
      role: message.role,
      content: message.content,
      timestamp_ms: message.timestamp_ms ?? null,
    })),
  };
}

export function renderAmlAddDocument(request) {
  if (!request || !Array.isArray(request.messages) || request.messages.length === 0) {
    throw new Error("aml_messages_required");
  }
  return request.messages.map(message => {
    const timestamp = message.timestamp_ms !== null && message.timestamp_ms !== undefined
      && Number.isFinite(Number(message.timestamp_ms))
      ? `(${Math.trunc(Number(message.timestamp_ms))}) `
      : "";
    return `${timestamp}${message.role}: ${message.content}`;
  }).join("\n");
}

function latestMessageTimeSec(messages, fallbackNowSec) {
  const values = messages
    .filter(message => message.timestamp_ms !== null && message.timestamp_ms !== undefined)
    .map(message => Number(message.timestamp_ms))
    .filter(Number.isFinite)
    .map(value => Math.floor(value / 1000));
  return values.length > 0 ? Math.max(...values) : fallbackNowSec;
}

function memoryIdForRequest(request) {
  return sha256(`${AML_ADD_PROJECTION_VERSION}\u0000${request.user_id}\u0000${request.request_id}`);
}

function requestPayloadSha(request) {
  return sha256(JSON.stringify(normalizedPayload(request)));
}

function cleanupInsertedMemory(core, engine, memoryId, requestId) {
  try {
    core.prepare("DELETE FROM chunks_fts WHERE id = ?").run(memoryId);
    core.prepare("DELETE FROM chunks WHERE id = ?").run(memoryId);
  } catch {}
  try {
    engine.prepare("DELETE FROM aml_add_requests WHERE request_id = ?").run(requestId);
    engine.prepare("DELETE FROM memory_confidence WHERE chunk_id = ?").run(memoryId);
  } catch {}
}

function normalizeVectorBackend(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("aml_vector_backend_must_be_object");
  }
  if (typeof value.withSearchRuntime === "function") {
    if (typeof value.addCanonicalMemory !== "function") {
      throw new Error("aml_vector_backend_add_required");
    }
    return value;
  }
  if (!value.table || typeof value.table.search !== "function") {
    throw new Error("aml_vector_backend_table_required");
  }
  if (typeof value.generateEmbedding !== "function") {
    throw new Error("aml_vector_backend_generate_embedding_required");
  }
  if (typeof value.addCanonicalMemory !== "function") {
    throw new Error("aml_vector_backend_add_required");
  }
  return value;
}

export function createAmlUserDataPlane({
  root,
  userId,
  maxTopK = AML_DEFAULT_MAX_TOP_K,
  vectorBackend = null,
  removeOnClose = false,
  nowSecProvider = () => Math.floor(Date.now() / 1000),
} = {}) {
  if (typeof userId !== "string" || userId.length === 0) throw new Error("aml_user_id_required");
  const resolvedRoot = assertTemporaryParent(root);
  mkdirSync(resolvedRoot, { recursive: true });
  const corePath = join(resolvedRoot, "core.sqlite");
  const enginePath = join(resolvedRoot, "engine.sqlite");
  const vectorPath = join(resolvedRoot, "lancedb");
  mkdirSync(vectorPath, { recursive: true });

  const coreInit = new Database(corePath);
  const engineInit = new Database(enginePath);
  try {
    createCoreSchema(coreInit);
    createEngineSchema(engineInit);
  } finally {
    coreInit.close();
    engineInit.close();
  }

  const selectedVectorBackend = normalizeVectorBackend(vectorBackend);
  const productionMinConfidence = Number(MEMORY_ENGINE_DEFAULTS?.confidence?.min ?? 0.15);
  const productionLexicalThreshold = Number(
    MEMORY_ENGINE_DEFAULTS?.recall?.lexicalConfidenceThreshold ?? 0.7,
  );
  const resolvedMaxTopK = positiveInteger(maxTopK, "aml_max_top_k");

  function createSearchRuntime({ table = undefined, generateEmbedding = undefined } = {}) {
    return createBenchmarkHybridRuntime(
      { corePath, enginePath },
      {
        topK: resolvedMaxTopK,
        minConfidence: productionMinConfidence,
        lexicalConfidenceThreshold: productionLexicalThreshold,
        vectorTable: table !== undefined
          ? table
          : (selectedVectorBackend?.table || null),
        generateEmbedding: generateEmbedding !== undefined
          ? generateEmbedding
          : (selectedVectorBackend?.generateEmbedding || (async () => [0])),
        getMemorySearchManager: async () => ({
          manager: null,
          error: "aml_host_memory_manager_forbidden",
        }),
      },
    );
  }

  let closed = false;

  async function add(request) {
    if (closed) throw new Error("aml_data_plane_closed");
    if (request.user_id !== userId) throw new Error("aml_cross_user_add_forbidden");

    const core = new Database(corePath);
    const engine = new Database(enginePath);
    let memoryId = null;
    let coreInserted = false;
    let engineInserted = false;
    try {
      const payloadSha256 = requestPayloadSha(request);
      const existing = engine.prepare(`
        SELECT request_id, payload_sha256, session_id, memory_id, created_at
        FROM aml_add_requests
        WHERE request_id = ?
      `).get(request.request_id);
      if (existing) {
        if (existing.payload_sha256 !== payloadSha256) throw new Error("aml_request_id_payload_conflict");
        return {
          deduped: true,
          memory_id: existing.memory_id,
          payload_sha256: existing.payload_sha256,
        };
      }

      const nowSec = positiveInteger(nowSecProvider(), "aml_now_sec");
      const text = renderAmlAddDocument(request);
      memoryId = memoryIdForRequest(request);
      const contentHash = sha256(text);
      const updatedAt = latestMessageTimeSec(request.messages, nowSec);
      const category = autoRouteCategory(text);
      const { conf, tau } = catParams(category, false);
      const path = [
        "benchmark",
        "aml",
        sha256(userId).slice(0, 16),
        safePathPart(request.session_id, "session"),
        `${sha256(request.request_id).slice(0, 20)}.md`,
      ].join("/");
      const endLine = Math.max(1, text.split("\n").length);
      const insertChunk = core.prepare(`
        INSERT INTO chunks (
          id, path, source, start_line, end_line, hash, model, text, embedding, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertFts = core.prepare(`
        INSERT INTO chunks_fts (text, id, path, source, model, start_line, end_line)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const insertConfidence = engine.prepare(`
        INSERT INTO memory_confidence (
          chunk_id, initial_confidence, confidence, last_confidence_update,
          base_tau, hit_count, is_archived, is_protected, conflict_flag, category, kg_data
        ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?, NULL)
      `);
      const insertLedger = engine.prepare(`
        INSERT INTO aml_add_requests (request_id, payload_sha256, session_id, memory_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);

      const insertCore = core.transaction(() => {
        insertChunk.run(
          memoryId,
          path,
          "benchmark_aml_add",
          1,
          endLine,
          contentHash,
          "benchmark-aml-add-v1",
          text,
          null,
          updatedAt,
        );
        insertFts.run(
          text,
          memoryId,
          path,
          "benchmark_aml_add",
          "benchmark-aml-add-v1",
          1,
          endLine,
        );
      });
      const insertEngine = engine.transaction(() => {
        insertConfidence.run(memoryId, conf, conf, nowSec, tau, category);
        insertLedger.run(request.request_id, payloadSha256, request.session_id, memoryId, nowSec);
      });

      insertCore();
      coreInserted = true;
      insertEngine();
      engineInserted = true;

      if (selectedVectorBackend) {
        const canonicalCore = new Database(corePath, { readonly: true, fileMustExist: true });
        const canonicalEngine = new Database(enginePath, { readonly: true, fileMustExist: true });
        try {
          const resolved = getCanonicalMemoryById(memoryId, {
            withCoreDb: run => run(canonicalCore),
            withEngineDb: run => run(canonicalEngine),
          });
          if (!resolved?.ok || !resolved.memory) throw new Error("aml_canonical_add_resolution_failed");
          const projection = projectCanonicalMemoryToVectorProjection(resolved.memory);
          await selectedVectorBackend.addCanonicalMemory({
            canonicalMemory: resolved.memory,
            projection,
            timestamp: updatedAt,
            vectorPath,
          });
        } finally {
          canonicalCore.close();
          canonicalEngine.close();
        }
      }

      return {
        deduped: false,
        memory_id: memoryId,
        payload_sha256: payloadSha256,
        category,
        confidence: conf,
        tau,
        updated_at: updatedAt,
        vector_written: Boolean(selectedVectorBackend),
      };
    } catch (error) {
      if (memoryId && selectedVectorBackend && typeof selectedVectorBackend.removeMemory === "function") {
        try {
          await selectedVectorBackend.removeMemory(memoryId);
        } catch {}
      }
      if (memoryId && (coreInserted || engineInserted)) {
        cleanupInsertedMemory(core, engine, memoryId, request.request_id);
      }
      throw error;
    } finally {
      core.close();
      engine.close();
    }
  }

  async function search(request) {
    if (closed) throw new Error("aml_data_plane_closed");
    if (request.user_id !== userId) throw new Error("aml_cross_user_search_forbidden");
    const topK = positiveInteger(request.top_k, "aml_top_k");
    let result;
    if (typeof selectedVectorBackend?.withSearchRuntime === "function") {
      result = await selectedVectorBackend.withSearchRuntime(async ({ table, generateEmbedding }) => {
        const runtime = createSearchRuntime({ table, generateEmbedding });
        try {
          runtime.runtime.searchNowSec = positiveInteger(nowSecProvider(), "aml_search_now_sec");
          const scopedResult = await hybridSearch(request.query, { topK }, runtime.runtime);
          const vectorDebug = scopedResult?.debug || {};
          if (vectorDebug.vector_backend !== "lancedb" ||
              vectorDebug.vector_stage !== "lancedb_search" ||
              !Array.isArray(scopedResult?.channels) ||
              !scopedResult.channels.includes("vector")) {
            throw new Error("aml_semantic_vector_not_attempted_or_not_in_fusion");
          }
          return scopedResult;
        } finally {
          runtime.close();
        }
      });
    } else {
      const runtime = createSearchRuntime();
      try {
        runtime.runtime.searchNowSec = positiveInteger(nowSecProvider(), "aml_search_now_sec");
        result = await hybridSearch(request.query, { topK }, runtime.runtime);
      } finally {
        runtime.close();
      }
    }
    const data = (Array.isArray(result?.results) ? result.results : [])
      .slice(0, topK)
      .map(item => {
        const projected = {
          id: String(item.memory_id || ""),
          content: String(item.text || ""),
        };
        if (Number.isFinite(Number(item.final_score))) projected.score = Number(item.final_score);
        return projected;
      });
    return {
      data,
      diagnostics: {
        pool: Number(result?.pool || 0),
        channels: Array.isArray(result?.channels) ? [...result.channels] : [],
        channel_sizes: result?.channel_sizes || {},
        vector_backend: result?.debug?.vector_backend || null,
        vector_stage: result?.debug?.vector_stage || null,
      },
    };
  }

  async function close() {
    if (closed) return;
    closed = true;
    if (typeof selectedVectorBackend?.close === "function") await selectedVectorBackend.close();
    if (removeOnClose) rmSync(resolvedRoot, { recursive: true, force: true });
  }

  return {
    schema: AML_DATA_PLANE_SCHEMA,
    user_id: userId,
    root: resolvedRoot,
    corePath,
    enginePath,
    vectorPath,
    vector_mode: selectedVectorBackend?.vector_mode || (selectedVectorBackend ? "injected_per_user" : "disabled"),
    vector_provenance: selectedVectorBackend?.provenance || null,
    host_manager_mode: AML_HOST_MANAGER_MODE,
    evidence_surface: AML_SEARCH_EVIDENCE_SURFACE,
    add,
    search,
    close,
    get closed() {
      return closed;
    },
  };
}

export function createAmlDataPlaneRegistry({
  temporaryParent = tmpdir(),
  maxTopK = AML_DEFAULT_MAX_TOP_K,
  vectorBackendFactory = null,
  semanticBackendFactory = null,
  embeddingProvider = null,
  embeddingBaseUrl,
  embeddingCacheFactory,
  lancedbConnect,
  nowSecProvider = () => Math.floor(Date.now() / 1000),
  removeOnClose = true,
} = {}) {
  const parent = assertTemporaryParent(temporaryParent);
  const root = mkdtempSync(join(parent, "memory-engine-aml-v1-"));
  const planes = new Map();
  let closed = false;

  function get(userId) {
    return planes.get(userId) || null;
  }

  function getOrCreate(userId) {
    if (closed) throw new Error("aml_registry_closed");
    const existing = planes.get(userId);
    if (existing) return existing;
    const userRoot = join(root, `user-${sha256(userId).slice(0, 24)}`);
    mkdirSync(userRoot, { recursive: false });
    const vectorPath = join(userRoot, "lancedb");
    mkdirSync(vectorPath, { recursive: true });
    if (typeof semanticBackendFactory === "function" && typeof vectorBackendFactory === "function") {
      throw new Error("aml_vector_backend_factory_conflict");
    }
    const factoryContext = { userId, root: userRoot, vectorPath };
    const vectorBackend = typeof semanticBackendFactory === "function"
      ? semanticBackendFactory(factoryContext)
      : (typeof vectorBackendFactory === "function"
        ? vectorBackendFactory(factoryContext)
        : (embeddingProvider != null
          ? createAmlSemanticBackend({
            root: userRoot,
            vectorPath,
            embeddingProvider,
            embeddingBaseUrl,
            embeddingCacheFactory,
            lancedbConnect,
          })
          : null));
    const plane = createAmlUserDataPlane({
      root: userRoot,
      userId,
      maxTopK,
      vectorBackend,
      removeOnClose: false,
      nowSecProvider,
    });
    planes.set(userId, plane);
    return plane;
  }

  async function close() {
    if (closed) return;
    closed = true;
    for (const plane of planes.values()) await plane.close();
    planes.clear();
    if (removeOnClose) rmSync(root, { recursive: true, force: true });
  }

  return {
    schema: AML_DATA_PLANE_SCHEMA,
    root,
    max_top_k: positiveInteger(maxTopK, "aml_max_top_k"),
    get,
    getOrCreate,
    close,
    get size() {
      return planes.size;
    },
    get closed() {
      return closed;
    },
  };
}
