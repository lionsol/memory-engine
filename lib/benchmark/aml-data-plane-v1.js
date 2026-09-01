import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import Database from "better-sqlite3";

import { MEMORY_ENGINE_DEFAULTS } from "../config/defaults.js";
import { getCanonicalMemoryById } from "../canonical/read-adapter.js";
import {
  CANONICAL_VECTOR_PROJECTION_VERSION,
  CANONICAL_VECTOR_TEXT_MAX_CHARS,
  projectCanonicalMemoryToVectorProjection,
} from "../canonical/vector-projection.js";
import { autoRouteCategory, catParams } from "../memory-confidence.js";
import { hybridSearch } from "../recall/hybrid-search.js";
import {
  AML_SEMANTIC_BACKEND_VERSION,
  AML_SEMANTIC_VECTOR_MODE,
  createAmlSemanticBackend,
} from "./aml-semantic-backend-v1.js";
import {
  SEMANTIC_EMBEDDING_CACHE_SCHEMA,
  SEMANTIC_EMBEDDING_MODEL,
  SEMANTIC_EMBEDDING_MODEL_REVISION,
  SEMANTIC_EMBEDDING_PROVIDER,
  SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
  normalizeEmbeddingBaseUrlIdentity,
} from "./longmemeval-semantic-retrieval-runner-v1.js";
import { DEFAULT_SF_BASE_URL } from "../siliconflow-runtime.js";
import { createBenchmarkHybridRuntime } from "./longmemeval-retrieval-runner-v1.js";

export const AML_DATA_PLANE_SCHEMA = "memory_engine_aml_data_plane_v1";
export const AML_ADD_PROJECTION_VERSION = "aml_add_projection_v1";
export const AML_SEARCH_EVIDENCE_SURFACE = "production_hybrid_text_240_v1";
export const AML_HOST_MANAGER_MODE = "forbidden";
export const AML_DEFAULT_MAX_TOP_K = 100;
export const AML_RETAINED_REGISTRY_SCHEMA = "memory_engine_aml_retained_registry_v1";
export const AML_USER_ROOT_SCHEMA = "memory_engine_aml_user_root_v1";

const AML_RETAINED_MANIFEST_FILE = "manifest.json";
const AML_USER_ROOT_MARKER_FILE = "user-manifest.json";

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

function assertRetainedRoot(value) {
  const temporaryRoot = resolve(tmpdir());
  const candidate = resolve(String(value || ""));
  if (!candidate || candidate === temporaryRoot || !candidate.startsWith(`${temporaryRoot}${sep}`)) {
    throw new Error("aml_retained_root_required");
  }
  if (existsSync(candidate)) {
    if (lstatSync(candidate).isSymbolicLink()) throw new Error("aml_retained_root_symlink_forbidden");
    if (!statSync(candidate).isDirectory()) throw new Error("aml_retained_root_directory_required");
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
      state TEXT NOT NULL DEFAULT 'ready',
      vector_required INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `);
  const columns = new Set(db.prepare("PRAGMA table_info(aml_add_requests)").all().map(row => row.name));
  if (!columns.has("state")) {
    db.exec("ALTER TABLE aml_add_requests ADD COLUMN state TEXT NOT NULL DEFAULT 'ready'");
  }
  if (!columns.has("vector_required")) {
    db.exec("ALTER TABLE aml_add_requests ADD COLUMN vector_required INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.has("updated_at")) {
    db.exec("ALTER TABLE aml_add_requests ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0");
  }
  db.prepare("UPDATE aml_add_requests SET updated_at = created_at WHERE updated_at = 0").run();
  const invalid = db.prepare(`
    SELECT request_id
    FROM aml_add_requests
    WHERE state IS NULL
       OR state NOT IN ('pending', 'ready')
       OR vector_required IS NULL
       OR vector_required NOT IN (0, 1)
       OR updated_at IS NULL
       OR updated_at < 1
    LIMIT 1
  `).get();
  if (invalid) throw new Error("aml_add_requests_schema_invalid");
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

function coreMemoryIsExact(core, expected) {
  const chunk = core.prepare(`
    SELECT id, path, source, start_line, end_line, hash, model, text, embedding, updated_at
    FROM chunks
    WHERE id = ?
  `).get(expected.id);
  const ftsRows = core.prepare(`
    SELECT text, id, path, source, model, start_line, end_line
    FROM chunks_fts
    WHERE id = ?
  `).all(expected.id);
  const sameChunk = chunk &&
    chunk.id === expected.id &&
    chunk.path === expected.path &&
    chunk.source === expected.source &&
    chunk.start_line === expected.start_line &&
    chunk.end_line === expected.end_line &&
    chunk.hash === expected.hash &&
    chunk.model === expected.model &&
    chunk.text === expected.text &&
    chunk.embedding === null &&
    chunk.updated_at === expected.updated_at;
  const sameFts = ftsRows.length === 1 &&
    ftsRows[0].text === expected.text &&
    ftsRows[0].id === expected.id &&
    ftsRows[0].path === expected.path &&
    ftsRows[0].source === expected.source &&
    ftsRows[0].model === expected.model &&
    ftsRows[0].start_line === expected.start_line &&
    ftsRows[0].end_line === expected.end_line;
  return Boolean(sameChunk && sameFts);
}

function ensureCoreMemory(core, expected) {
  const transaction = core.transaction(() => {
    if (coreMemoryIsExact(core, expected)) return "reused";
    core.prepare("DELETE FROM chunks_fts WHERE id = ?").run(expected.id);
    core.prepare("DELETE FROM chunks WHERE id = ?").run(expected.id);
    core.prepare(`
      INSERT INTO chunks (
        id, path, source, start_line, end_line, hash, model, text, embedding, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      expected.id,
      expected.path,
      expected.source,
      expected.start_line,
      expected.end_line,
      expected.hash,
      expected.model,
      expected.text,
      null,
      expected.updated_at,
    );
    core.prepare(`
      INSERT INTO chunks_fts (text, id, path, source, model, start_line, end_line)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      expected.text,
      expected.id,
      expected.path,
      expected.source,
      expected.model,
      expected.start_line,
      expected.end_line,
    );
    return "repaired";
  });
  return transaction();
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

function retainedManifestFor({ vectorBackend, maxTopK }) {
  const provenance = vectorBackend?.provenance && typeof vectorBackend.provenance === "object"
    ? vectorBackend.provenance
    : {};
  return {
    schema: AML_RETAINED_REGISTRY_SCHEMA,
    data_plane_schema: AML_DATA_PLANE_SCHEMA,
    semantic_enabled: Boolean(vectorBackend),
    semantic_backend_version: provenance.semantic_backend_version ?? null,
    vector_mode: vectorBackend?.vector_mode || (vectorBackend ? "injected_per_user" : "disabled"),
    vector_store: provenance.vector_store ?? null,
    embedding_provider: provenance.embedding_provider ?? null,
    embedding_base_url_identity: provenance.embedding_base_url_identity ?? null,
    embedding_model: provenance.embedding_model ?? null,
    embedding_model_revision: provenance.embedding_model_revision ?? null,
    embedding_dimension: provenance.embedding_dimension ?? null,
    canonical_vector_projection_version: provenance.canonical_vector_projection_version ?? null,
    canonical_vector_text_max_chars: provenance.canonical_vector_text_max_chars ?? null,
    embedding_cache_schema: provenance.embedding_cache_schema ?? null,
    max_top_k: maxTopK,
  };
}

function configuredSemanticBackend({ embeddingBaseUrl }) {
  return {
    vector_mode: AML_SEMANTIC_VECTOR_MODE,
    provenance: {
      semantic_backend_version: AML_SEMANTIC_BACKEND_VERSION,
      embedding_provider: SEMANTIC_EMBEDDING_PROVIDER,
      embedding_base_url_identity: normalizeEmbeddingBaseUrlIdentity(
        embeddingBaseUrl ?? DEFAULT_SF_BASE_URL,
      ),
      embedding_model: SEMANTIC_EMBEDDING_MODEL,
      embedding_model_revision: SEMANTIC_EMBEDDING_MODEL_REVISION,
      embedding_dimension: SEMANTIC_EXPECTED_EMBEDDING_DIMENSION,
      canonical_vector_projection_version: CANONICAL_VECTOR_PROJECTION_VERSION,
      canonical_vector_text_max_chars: CANONICAL_VECTOR_TEXT_MAX_CHARS,
      embedding_cache_schema: SEMANTIC_EMBEDDING_CACHE_SCHEMA,
      vector_store: "lancedb",
    },
  };
}

const RETAINED_MANIFEST_KEYS = Object.freeze([
  "schema",
  "data_plane_schema",
  "semantic_enabled",
  "semantic_backend_version",
  "vector_mode",
  "vector_store",
  "embedding_provider",
  "embedding_base_url_identity",
  "embedding_model",
  "embedding_model_revision",
  "embedding_dimension",
  "canonical_vector_projection_version",
  "canonical_vector_text_max_chars",
  "embedding_cache_schema",
  "max_top_k",
]);

function validateRetainedManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("aml_retained_manifest_invalid");
  }
  const keys = Object.keys(manifest).sort();
  const expectedKeys = [...RETAINED_MANIFEST_KEYS].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error("aml_retained_manifest_schema_invalid");
  }
  if (manifest.schema !== AML_RETAINED_REGISTRY_SCHEMA ||
      manifest.data_plane_schema !== AML_DATA_PLANE_SCHEMA ||
      typeof manifest.semantic_enabled !== "boolean" ||
      typeof manifest.vector_mode !== "string" ||
      !Number.isInteger(manifest.max_top_k) || manifest.max_top_k < 1) {
    throw new Error("aml_retained_manifest_identity_invalid");
  }
  return manifest;
}

function readRetainedManifest(root) {
  const manifestPath = join(root, AML_RETAINED_MANIFEST_FILE);
  if (!existsSync(manifestPath)) return null;
  try {
    return validateRetainedManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  } catch (error) {
    if (error?.message?.startsWith("aml_retained_manifest_")) throw error;
    throw new Error("aml_retained_manifest_invalid");
  }
}

function writeRetainedManifest(root, manifest) {
  const validated = validateRetainedManifest(manifest);
  const manifestPath = join(root, AML_RETAINED_MANIFEST_FILE);
  const temporaryPath = join(root, `.manifest.tmp-${process.pid}-${sha256(JSON.stringify(validated)).slice(0, 16)}`);
  writeFileSync(temporaryPath, `${JSON.stringify(validated)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, manifestPath);
}

function assertManifestCompatible(root, expected, { allowCreateForUserRoot = null } = {}) {
  const existing = readRetainedManifest(root);
  if (!existing) {
    const entries = readdirSync(root);
    if (entries.length > 0 &&
        (!allowCreateForUserRoot ||
         entries.some(entry => entry !== allowCreateForUserRoot))) {
      throw new Error("aml_retained_manifest_missing");
    }
    writeRetainedManifest(root, expected);
    return expected;
  }
  const canonical = value => JSON.stringify(RETAINED_MANIFEST_KEYS.map(key => [key, value[key]]));
  if (canonical(existing) !== canonical(expected)) {
    throw new Error("aml_retained_manifest_incompatible");
  }
  return existing;
}

function userRootMarkerFor(userId) {
  return {
    schema: AML_USER_ROOT_SCHEMA,
    data_plane_schema: AML_DATA_PLANE_SCHEMA,
    user_id_sha256: sha256(userId),
  };
}

function writeUserRootMarker(root, userId) {
  const marker = userRootMarkerFor(userId);
  const markerPath = join(root, AML_USER_ROOT_MARKER_FILE);
  const temporaryPath = join(root, `.user-manifest.tmp-${process.pid}-${sha256(userId).slice(0, 16)}`);
  writeFileSync(temporaryPath, `${JSON.stringify(marker)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, markerPath);
}

function assertUserRootMarker(root, userId) {
  const markerPath = join(root, AML_USER_ROOT_MARKER_FILE);
  if (!existsSync(markerPath)) throw new Error("aml_user_root_marker_missing");
  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    throw new Error("aml_user_root_marker_invalid");
  }
  const expectedKeys = ["data_plane_schema", "schema", "user_id_sha256"];
  if (!marker || Object.keys(marker).sort().join("\u0000") !== expectedKeys.join("\u0000") ||
      marker.schema !== AML_USER_ROOT_SCHEMA ||
      marker.data_plane_schema !== AML_DATA_PLANE_SCHEMA ||
      marker.user_id_sha256 !== sha256(userId)) {
    throw new Error("aml_user_root_marker_mismatch");
  }
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
  stageHook = null,
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
        topKPolicyMax: resolvedMaxTopK,
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

  async function invokeStageHook(stage, context) {
    if (typeof stageHook !== "function") return;
    await stageHook(stage, {
      user_id: userId,
      ...context,
    });
  }

  let closed = false;

  async function add(request) {
    if (closed) throw new Error("aml_data_plane_closed");
    if (request.user_id !== userId) throw new Error("aml_cross_user_add_forbidden");

    const core = new Database(corePath);
    const engine = new Database(enginePath);
    let memoryId = null;
    let coreTouched = false;
    let engineInserted = false;
    let newRequest = false;
    let pendingRequest = false;
    try {
      const payloadSha256 = requestPayloadSha(request);
      const existing = engine.prepare(`
        SELECT request_id, payload_sha256, session_id, memory_id, state,
          vector_required, created_at, updated_at
        FROM aml_add_requests
        WHERE request_id = ?
      `).get(request.request_id);
      if (existing) {
        if (existing.payload_sha256 !== payloadSha256) throw new Error("aml_request_id_payload_conflict");
        if (existing.state === "ready") {
          return {
            deduped: true,
            memory_id: existing.memory_id,
            payload_sha256: existing.payload_sha256,
          };
        }
        if (existing.state !== "pending") throw new Error("aml_add_request_state_invalid");
        if (Boolean(existing.vector_required) !== Boolean(selectedVectorBackend)) {
          throw new Error("aml_request_vector_mode_conflict");
        }
        pendingRequest = true;
        memoryId = existing.memory_id;
      }

      const nowSec = positiveInteger(nowSecProvider(), "aml_now_sec");
      const text = renderAmlAddDocument(request);
      const deterministicMemoryId = memoryIdForRequest(request);
      if (memoryId && memoryId !== deterministicMemoryId) throw new Error("aml_memory_id_derivation_mismatch");
      memoryId = deterministicMemoryId;
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
      const expectedCore = {
        id: memoryId,
        path,
        source: "benchmark_aml_add",
        start_line: 1,
        end_line: endLine,
        hash: contentHash,
        model: "benchmark-aml-add-v1",
        text,
        updated_at: updatedAt,
      };

      if (!pendingRequest) {
        newRequest = true;
        const insertEngine = engine.transaction(() => {
          engine.prepare(`
            INSERT INTO memory_confidence (
              chunk_id, initial_confidence, confidence, last_confidence_update,
              base_tau, hit_count, is_archived, is_protected, conflict_flag, category, kg_data
            ) VALUES (?, ?, 0, ?, ?, 0, 0, 0, 0, ?, NULL)
          `).run(memoryId, conf, nowSec, tau, category);
          engine.prepare(`
            INSERT INTO aml_add_requests (
              request_id, payload_sha256, session_id, memory_id, state,
              vector_required, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
          `).run(
            request.request_id,
            payloadSha256,
            request.session_id,
            memoryId,
            selectedVectorBackend ? 1 : 0,
            nowSec,
            nowSec,
          );
        });
        insertEngine();
        engineInserted = true;
        await invokeStageHook("after_pending_commit", {
          request_id: request.request_id,
          memory_id: memoryId,
        });
      } else {
        const ensurePending = engine.transaction(() => {
          const ledger = engine.prepare(`
            SELECT payload_sha256, session_id, memory_id, state, vector_required
            FROM aml_add_requests
            WHERE request_id = ?
          `).get(request.request_id);
          if (!ledger || ledger.payload_sha256 !== payloadSha256 || ledger.memory_id !== memoryId ||
              ledger.state !== "pending" || Boolean(ledger.vector_required) !== Boolean(selectedVectorBackend)) {
            throw new Error("aml_pending_request_metadata_conflict");
          }
          const confidence = engine.prepare(`
            SELECT initial_confidence, confidence, base_tau, is_archived,
              is_protected, conflict_flag, category
            FROM memory_confidence
            WHERE chunk_id = ?
          `).get(memoryId);
          if (!confidence) {
            engine.prepare(`
              INSERT INTO memory_confidence (
                chunk_id, initial_confidence, confidence, last_confidence_update,
                base_tau, hit_count, is_archived, is_protected, conflict_flag, category, kg_data
              ) VALUES (?, ?, 0, ?, ?, 0, 0, 0, 0, ?, NULL)
            `).run(memoryId, conf, nowSec, tau, category);
            return;
          }
          if (confidence.initial_confidence !== conf || confidence.confidence !== 0 ||
              confidence.base_tau !== tau || confidence.is_archived !== 0 ||
              confidence.is_protected !== 0 || confidence.conflict_flag !== 0 ||
              confidence.category !== category) {
            throw new Error("aml_pending_confidence_metadata_conflict");
          }
        });
        ensurePending();
      }

      const coreAction = ensureCoreMemory(core, expectedCore);
      coreTouched = true;
      await invokeStageHook("after_core_commit", {
        request_id: request.request_id,
        memory_id: memoryId,
        core_action: coreAction,
      });

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
        await invokeStageHook("after_vector_commit", {
          request_id: request.request_id,
          memory_id: memoryId,
        });
      }

      const promoteReady = engine.transaction(() => {
        const confidenceUpdate = engine.prepare(`
          UPDATE memory_confidence
          SET confidence = ?, last_confidence_update = ?
          WHERE chunk_id = ?
        `).run(conf, nowSec, memoryId);
        const ledgerUpdate = engine.prepare(`
          UPDATE aml_add_requests
          SET state = 'ready', updated_at = ?
          WHERE request_id = ? AND payload_sha256 = ? AND state = 'pending'
        `).run(nowSec, request.request_id, payloadSha256);
        if (confidenceUpdate.changes !== 1 || ledgerUpdate.changes !== 1) {
          throw new Error("aml_ready_promotion_failed");
        }
      });
      promoteReady();
      await invokeStageHook("after_ready_commit", {
        request_id: request.request_id,
        memory_id: memoryId,
      });

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
      if (newRequest && memoryId && selectedVectorBackend && typeof selectedVectorBackend.removeMemory === "function") {
        try {
          await selectedVectorBackend.removeMemory(memoryId);
        } catch {}
      }
      if (newRequest && memoryId && (coreTouched || engineInserted)) {
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
  retainedRoot = null,
  maxTopK = AML_DEFAULT_MAX_TOP_K,
  vectorBackendFactory = null,
  semanticBackendFactory = null,
  embeddingProvider = null,
  embeddingBaseUrl,
  embeddingCacheFactory,
  lancedbConnect,
  nowSecProvider = () => Math.floor(Date.now() / 1000),
  removeOnClose = true,
  stageHook = null,
} = {}) {
  const parent = assertTemporaryParent(temporaryParent);
  const retained = retainedRoot !== null && retainedRoot !== undefined;
  const root = retained
    ? assertRetainedRoot(retainedRoot)
    : mkdtempSync(join(parent, "memory-engine-aml-v1-"));
  if (retained) mkdirSync(root, { recursive: true });
  const planes = new Map();
  let closed = false;

  if (typeof semanticBackendFactory === "function" && typeof vectorBackendFactory === "function") {
    throw new Error("aml_vector_backend_factory_conflict");
  }

  if (retained && typeof semanticBackendFactory !== "function" &&
      typeof vectorBackendFactory !== "function") {
    const configuredBackend = embeddingProvider != null
      ? configuredSemanticBackend({ embeddingBaseUrl })
      : null;
    assertManifestCompatible(root, retainedManifestFor({
      vectorBackend: configuredBackend,
      maxTopK: positiveInteger(maxTopK, "aml_max_top_k"),
    }));
  }

  function createVectorBackend({ userId, userRoot, vectorPath }) {
    const factoryContext = { userId, root: userRoot, vectorPath };
    return typeof semanticBackendFactory === "function"
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
  }

  function createPlane(userId, userRoot, { newUserRoot = false } = {}) {
    const vectorPath = join(userRoot, "lancedb");
    let vectorBackend = null;
    try {
      vectorBackend = createVectorBackend({ userId, userRoot, vectorPath });
      if (retained) {
        assertManifestCompatible(root, retainedManifestFor({
          vectorBackend,
          maxTopK: positiveInteger(maxTopK, "aml_max_top_k"),
        }), {
          allowCreateForUserRoot: newUserRoot ? userRoot.split(sep).pop() : null,
        });
      }
      const plane = createAmlUserDataPlane({
        root: userRoot,
        userId,
        maxTopK,
        vectorBackend,
        removeOnClose: false,
        nowSecProvider,
        stageHook,
      });
      planes.set(userId, plane);
      return plane;
    } catch (error) {
      if (typeof vectorBackend?.close === "function") {
        try {
          const result = vectorBackend.close();
          if (result && typeof result.then === "function") result.catch(() => {});
        } catch {}
      }
      if (newUserRoot) rmSync(userRoot, { recursive: true, force: true });
      throw error;
    }
  }

  function getOrCreate(userId) {
    if (closed) throw new Error("aml_registry_closed");
    const existing = planes.get(userId);
    if (existing) return existing;
    const userRoot = join(root, `user-${sha256(userId).slice(0, 24)}`);
    const newUserRoot = !existsSync(userRoot);
    if (newUserRoot) {
      mkdirSync(userRoot, { recursive: false });
      if (retained) writeUserRootMarker(userRoot, userId);
    } else if (retained) {
      if (lstatSync(userRoot).isSymbolicLink()) throw new Error("aml_user_root_symlink_forbidden");
      if (!statSync(userRoot).isDirectory()) throw new Error("aml_user_root_directory_required");
      assertUserRootMarker(userRoot, userId);
    }
    return createPlane(userId, userRoot, { newUserRoot });
  }

  function getRetainedUser(userId) {
    const userRoot = join(root, `user-${sha256(userId).slice(0, 24)}`);
    if (!existsSync(userRoot)) return null;
    if (lstatSync(userRoot).isSymbolicLink()) throw new Error("aml_user_root_symlink_forbidden");
    if (!statSync(userRoot).isDirectory()) throw new Error("aml_user_root_directory_required");
    assertUserRootMarker(userRoot, userId);
    return createPlane(userId, userRoot);
  }

  function getExisting(userId) {
    if (closed) return null;
    const existing = planes.get(userId);
    if (existing) return existing;
    return retained ? getRetainedUser(userId) : null;
  }

  async function close() {
    if (closed) return;
    closed = true;
    for (const plane of planes.values()) await plane.close();
    planes.clear();
    if (!retained && removeOnClose) rmSync(root, { recursive: true, force: true });
  }

  async function destroy() {
    if (!closed) await close();
    if (retained) rmSync(root, { recursive: true, force: true });
  }

  return {
    schema: AML_DATA_PLANE_SCHEMA,
    root,
    retained,
    max_top_k: positiveInteger(maxTopK, "aml_max_top_k"),
    get: getExisting,
    getOrCreate,
    close,
    destroy,
    get size() {
      return planes.size;
    },
    get closed() {
      return closed;
    },
  };
}
