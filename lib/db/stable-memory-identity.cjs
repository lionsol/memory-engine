"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { existsSync, readFileSync } = require("node:fs");

const STABLE_MEMORY_IDENTITY_STATES = Object.freeze([
  "active",
  "superseded",
  "archived",
  "unknown_legacy",
  // A manifest is an explicit recovery authority. It is intentionally kept
  // distinct from active so a later reconciliation can make that transition
  // explicit without treating an old row as a newly-created memory.
  "recovered",
]);

const STABLE_MEMORY_IDENTITY_CONFLICT = "STABLE_MEMORY_IDENTITY_CONFLICT";
const STABLE_MEMORY_IDENTITY_SCHEMA_REQUIRED = "STABLE_MEMORY_IDENTITY_SCHEMA_REQUIRED";
const STABLE_MEMORY_IDENTITY_SCHEMA_VERSION = 1;
const CHECKPOINT_KEY = "global";
const DEFAULT_EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-4B";
const DEFAULT_EMBEDDING_DIMENSION = 2560;

function conflict(message, details = {}) {
  const error = new Error(message || STABLE_MEMORY_IDENTITY_CONFLICT);
  error.code = STABLE_MEMORY_IDENTITY_CONFLICT;
  Object.assign(error, details);
  return error;
}

function normalizeString(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeState(value, fallback = "active") {
  const normalized = normalizeString(value) || fallback;
  if (!STABLE_MEMORY_IDENTITY_STATES.includes(normalized)) {
    throw new TypeError(`invalid stable memory identity state: ${normalized}`);
  }
  return normalized;
}

function resolveNowSec(value) {
  const number = Number(value);
  if (Number.isFinite(number)) return Math.floor(number > 100000000000 ? number / 1000 : number);
  return Math.floor(Date.now() / 1000);
}

function hashText(text) {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

function contentHash(text) {
  return `sha256:${hashText(text)}`;
}

function embeddingFingerprint(vector) {
  const values = Array.from(vector || []);
  return `sha256:${createHash("sha256").update(JSON.stringify(values), "utf8").digest("hex")}`;
}

function validateEmbeddingVector(vector, { expectedDimension = null } = {}) {
  const isArrayLike = Array.isArray(vector) || (ArrayBuffer.isView(vector) && !(vector instanceof DataView));
  if (!isArrayLike || vector.length === 0) return { ok: false, reason: "invalid_embedding_shape" };
  if (expectedDimension !== null && expectedDimension !== undefined
    && Number.isInteger(Number(expectedDimension))
    && Number(expectedDimension) > 0
    && vector.length !== Number(expectedDimension)) {
    return {
      ok: false,
      reason: "embedding_dimension_mismatch",
      expected_dimension: Number(expectedDimension),
      actual_dimension: vector.length,
    };
  }
  const values = Array.from(vector);
  if (!values.every(value => Number.isFinite(value))) return { ok: false, reason: "embedding_non_finite" };
  if (!values.some(value => Number(value) !== 0)) return { ok: false, reason: "embedding_degenerate" };
  return { ok: true, dimension: values.length };
}

function isRealEmbedding(vector, options = {}) {
  return validateEmbeddingVector(vector, options).ok;
}

function defaultEntityId(kind = "entity") {
  void kind;
  return randomUUID();
}

function deterministicId(kind, seed) {
  return `${kind}:${hashText(seed)}`;
}

function tableExists(db, tableName) {
  try {
    return Boolean(db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(tableName));
  } catch {
    return false;
  }
}

function tableColumns(db, tableName) {
  try {
    return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map(row => String(row.name)));
  } catch {
    return new Set();
  }
}

function hasStableMemoryIdentityColumns(db) {
  const columns = tableColumns(db, "memory_confidence");
  return ["entity_id", "source_doc_id", "content_hash", "embedding_model", "embedding_fingerprint"]
    .every(column => columns.has(column));
}

function isStableMemoryIdentityReady(db) {
  return hasStableMemoryIdentityColumns(db)
    && tableExists(db, "memory_identity")
    && tableExists(db, "memory_source_docs");
}

function stableMemoryIdentitySchemaState(db) {
  try {
    const tables = new Set(db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all().map(row => String(row.name)));
    if (!tables.has("memory_confidence")) return "error";
    const confidenceColumns = new Set(db.prepare("PRAGMA table_info(memory_confidence)").all().map(row => String(row.name)));
    const identityTable = tables.has("memory_identity");
    const sourceDocsTable = tables.has("memory_source_docs");
    const identityColumns = ["entity_id", "source_doc_id", "content_hash", "embedding_model", "embedding_fingerprint"];
    if (isStableMemoryIdentityReady(db)) return "migrated";
    return identityTable || sourceDocsTable || identityColumns.some(column => confidenceColumns.has(column))
      ? "partial"
      : "unmigrated";
  } catch (_) {
    return "error";
  }
}

function schemaRequiredError() {
  const error = new Error(
    "stable memory identity schema migration is required before stable association can be claimed",
  );
  error.code = STABLE_MEMORY_IDENTITY_SCHEMA_REQUIRED;
  return error;
}

function assertStableMemoryIdentitySchema(db) {
  if (!tableExists(db, "memory_confidence") || !hasStableMemoryIdentityColumns(db)) {
    throw schemaRequiredError();
  }
  return true;
}

function addColumnIfMissing(db, tableName, columnName, definition) {
  if (!tableExists(db, tableName)) return false;
  if (tableColumns(db, tableName).has(columnName)) return false;
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  return true;
}

function ensureStableMemoryIdentityTables(db, { addConfidenceColumns = false } = {}) {
  if (!db || typeof db.exec !== "function" || typeof db.prepare !== "function") {
    throw new TypeError("stable memory identity migration requires a SQLite database");
  }

  if (addConfidenceColumns && tableExists(db, "memory_confidence")) {
    addColumnIfMissing(db, "memory_confidence", "entity_id", "TEXT");
    addColumnIfMissing(db, "memory_confidence", "source_doc_id", "TEXT");
    addColumnIfMissing(db, "memory_confidence", "content_hash", "TEXT");
    addColumnIfMissing(db, "memory_confidence", "embedding_model", "TEXT");
    addColumnIfMissing(db, "memory_confidence", "embedding_fingerprint", "TEXT");
  }
  if (tableExists(db, "memory_confidence") && hasStableMemoryIdentityColumns(db)) {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_confidence_entity
        ON memory_confidence(entity_id)
        WHERE entity_id IS NOT NULL
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_source_docs (
      doc_uuid TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      canonical_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_content_fingerprint TEXT,
      UNIQUE(source, canonical_path)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_memory_source_docs_path ON memory_source_docs(canonical_path)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_identity (
      entity_id TEXT PRIMARY KEY,
      doc_uuid TEXT,
      core_chunk_id_snapshot TEXT,
      content_hash TEXT,
      embedding_model TEXT,
      embedding_fingerprint TEXT,
      state TEXT NOT NULL DEFAULT 'active'
        CHECK (state IN ('active', 'superseded', 'archived', 'unknown_legacy', 'recovered')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_memory_identity_doc ON memory_identity(doc_uuid)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_memory_identity_core ON memory_identity(core_chunk_id_snapshot)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_memory_identity_state ON memory_identity(state)");
  // These indexes are the database-level race barrier for concurrent writers.
  // The partial predicate keeps historical/superseded rows available for
  // forensics while allowing only one live association for a Core chunk.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_identity_live_core
      ON memory_identity(core_chunk_id_snapshot)
      WHERE core_chunk_id_snapshot IS NOT NULL
        AND state IN ('active', 'recovered')
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_identity_migration_map (
      migration_key TEXT PRIMARY KEY,
      source_fingerprint TEXT NOT NULL,
      entity_id TEXT NOT NULL UNIQUE,
      doc_uuid TEXT,
      lance_id TEXT,
      engine_memory_id TEXT,
      core_chunk_id TEXT,
      canonical_path TEXT,
      mapping_status TEXT NOT NULL DEFAULT 'applied',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  for (const [column, definition] of [
    ["lance_id", "TEXT"],
    ["engine_memory_id", "TEXT"],
    ["core_chunk_id", "TEXT"],
    ["canonical_path", "TEXT"],
    ["mapping_status", "TEXT NOT NULL DEFAULT 'applied'"],
  ]) addColumnIfMissing(db, "memory_identity_migration_map", column, definition);
  db.exec("CREATE INDEX IF NOT EXISTS idx_memory_identity_migration_doc ON memory_identity_migration_map(doc_uuid)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_memory_identity_migration_lance ON memory_identity_migration_map(lance_id)");

  // A singleton checkpoint and its JSON payload keep the enumeration bounded
  // and resumable without requiring a second persistent data model.
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_identity_convergence_checkpoint (
      checkpoint_key TEXT PRIMARY KEY,
      offset INTEGER NOT NULL DEFAULT 0,
      page_size INTEGER NOT NULL DEFAULT 400,
      max_rows INTEGER NOT NULL DEFAULT 5000,
      status TEXT NOT NULL DEFAULT 'idle',
      seen_json TEXT NOT NULL DEFAULT '[]',
      counts_json TEXT NOT NULL DEFAULT '{}',
      dataset_identity TEXT,
      updated_at INTEGER NOT NULL
    )
  `);
  addColumnIfMissing(db, "memory_identity_convergence_checkpoint", "dataset_identity", "TEXT");
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_identity_convergence_seen (
      checkpoint_key TEXT NOT NULL,
      lance_id TEXT NOT NULL,
      PRIMARY KEY (checkpoint_key, lance_id)
    )
  `);
  return { schema_version: STABLE_MEMORY_IDENTITY_SCHEMA_VERSION };
}

function readCheckpoint(db, key = CHECKPOINT_KEY) {
  if (!tableExists(db, "memory_identity_convergence_checkpoint")) return null;
  const row = db.prepare(
    "SELECT * FROM memory_identity_convergence_checkpoint WHERE checkpoint_key = ?",
  ).get(key);
  if (!row) return null;
  let seenIds = [];
  let seenRows = [];
  let counts = {};
  try {
    const parsedSeen = JSON.parse(row.seen_json || "[]");
    seenRows = Array.isArray(parsedSeen) ? parsedSeen : [];
    seenIds = seenRows.map(value => typeof value === "object" ? value?.id : value).filter(Boolean).map(String);
  } catch { seenIds = []; seenRows = []; }
  try { counts = JSON.parse(row.counts_json || "{}"); } catch { counts = {}; }
  return {
    key,
    offset: Number(row.offset || 0),
    pageSize: Number(row.page_size || 400),
    maxRows: Number(row.max_rows || 5000),
    status: String(row.status || "idle"),
    seenIds: Array.isArray(seenIds) ? seenIds.map(String) : [],
    seenRows,
    counts: counts && typeof counts === "object" ? counts : {},
    datasetIdentity: normalizeString(row.dataset_identity),
    updatedAt: Number(row.updated_at || 0),
  };
}

function writeCheckpoint(db, checkpoint = {}, key = CHECKPOINT_KEY) {
  ensureStableMemoryIdentityTables(db);
  const nowSec = resolveNowSec(checkpoint.updatedAt);
  const seenIds = [...new Set((checkpoint.seenIds || []).map(String))];
  const seenRows = Array.isArray(checkpoint.seenRows) && checkpoint.seenRows.length > 0
    ? checkpoint.seenRows
    : seenIds;
  const counts = checkpoint.counts && typeof checkpoint.counts === "object" ? checkpoint.counts : {};
  db.prepare(`
    INSERT INTO memory_identity_convergence_checkpoint
      (checkpoint_key, offset, page_size, max_rows, status, seen_json, counts_json, dataset_identity, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(checkpoint_key) DO UPDATE SET
      offset = excluded.offset,
      page_size = excluded.page_size,
      max_rows = excluded.max_rows,
      status = excluded.status,
      seen_json = excluded.seen_json,
      counts_json = excluded.counts_json,
      dataset_identity = excluded.dataset_identity,
      updated_at = excluded.updated_at
  `).run(
    key,
    Math.max(0, Number(checkpoint.offset || 0)),
    Math.max(1, Number(checkpoint.pageSize || 400)),
    Math.max(1, Number(checkpoint.maxRows || 5000)),
    normalizeString(checkpoint.status) || "running",
    JSON.stringify(seenRows),
    JSON.stringify(counts),
    normalizeString(checkpoint.datasetIdentity),
    nowSec,
  );
  return { ...checkpoint, key, seenIds, counts, updatedAt: nowSec };
}

function resetCheckpoint(db, key = CHECKPOINT_KEY) {
  if (!tableExists(db, "memory_identity_convergence_checkpoint")) return;
  db.prepare("DELETE FROM memory_identity_convergence_checkpoint WHERE checkpoint_key = ?").run(key);
  if (tableExists(db, "memory_identity_convergence_seen")) {
    db.prepare("DELETE FROM memory_identity_convergence_seen WHERE checkpoint_key = ?").run(key);
  }
}

function sourceDocByUuid(db, docUuid) {
  if (!docUuid) return null;
  return db.prepare("SELECT * FROM memory_source_docs WHERE doc_uuid = ?").get(docUuid) || null;
}

function sourceDocByPath(db, source, canonicalPath) {
  return db.prepare(
    "SELECT * FROM memory_source_docs WHERE source = ? AND canonical_path = ?",
  ).get(source, canonicalPath) || null;
}

function ensureSourceDocument(db, {
  docUuid: requestedDocUuid = null,
  source: requestedSource = "core",
  canonicalPath,
  contentFingerprint = null,
  nowSec,
  idFactory = defaultEntityId,
  allowMove = false,
} = {}) {
  const path = normalizeString(canonicalPath);
  if (!path) return null;
  const source = normalizeString(requestedSource) || "core";
  const now = resolveNowSec(nowSec);
  const requested = normalizeString(requestedDocUuid);
  const byUuid = requested ? sourceDocByUuid(db, requested) : null;
  const byPath = sourceDocByPath(db, source, path);

  if (byUuid && byPath && byUuid.doc_uuid !== byPath.doc_uuid) {
    throw conflict("source document path is already bound to another doc_uuid", {
      source,
      canonicalPath: path,
      doc_uuid: requested,
      existing_doc_uuid: byPath.doc_uuid,
    });
  }
  if (byUuid) {
    if (byUuid.source !== source) {
      throw conflict("doc_uuid cannot change source", { doc_uuid: requested });
    }
    if (byUuid.canonical_path !== path) {
      if (!allowMove) {
        throw conflict("doc_uuid is already bound to another canonical path", {
          doc_uuid: requested,
          existing_path: byUuid.canonical_path,
          canonicalPath: path,
        });
      }
      db.prepare(`
        UPDATE memory_source_docs
        SET canonical_path = ?, updated_at = ?, last_content_fingerprint = COALESCE(?, last_content_fingerprint)
        WHERE doc_uuid = ?
      `).run(path, now, contentFingerprint, requested);
      return sourceDocByUuid(db, requested);
    }
    db.prepare(`
      UPDATE memory_source_docs
      SET updated_at = ?, last_content_fingerprint = COALESCE(?, last_content_fingerprint)
      WHERE doc_uuid = ?
    `).run(now, contentFingerprint, requested);
    return sourceDocByUuid(db, requested);
  }
  if (byPath) {
    if (requested && byPath.doc_uuid !== requested) {
      throw conflict("canonical path is already bound to another doc_uuid", {
        source,
        canonicalPath: path,
        doc_uuid: requested,
        existing_doc_uuid: byPath.doc_uuid,
      });
    }
    db.prepare(`
      UPDATE memory_source_docs
      SET updated_at = ?, last_content_fingerprint = COALESCE(?, last_content_fingerprint)
      WHERE doc_uuid = ?
    `).run(now, contentFingerprint, byPath.doc_uuid);
    return sourceDocByUuid(db, byPath.doc_uuid);
  }

  const docUuid = requested || String(idFactory("doc_uuid"));
  if (!docUuid) throw new TypeError("source document identity factory returned an empty id");
  try {
    db.prepare(`
      INSERT INTO memory_source_docs
        (doc_uuid, source, canonical_path, created_at, updated_at, last_content_fingerprint)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(docUuid, source, path, now, now, contentFingerprint);
  } catch (error) {
    if (String(error?.code || "").startsWith("SQLITE_CONSTRAINT")) {
      const concurrent = sourceDocByPath(db, source, path);
      if (concurrent && (!requested || concurrent.doc_uuid === requested)) return concurrent;
      throw conflict("source document identity conflicts with existing registry row", {
        doc_uuid: docUuid,
        source,
        canonicalPath: path,
        cause: error,
      });
    }
    throw error;
  }
  return sourceDocByUuid(db, docUuid);
}

function identityById(db, entityId) {
  return db.prepare("SELECT * FROM memory_identity WHERE entity_id = ?").get(entityId) || null;
}

function activeIdentityByCoreId(db, coreChunkId) {
  if (!coreChunkId) return null;
  return db.prepare(`
    SELECT * FROM memory_identity
    WHERE core_chunk_id_snapshot = ? AND state IN ('active', 'recovered')
    ORDER BY updated_at DESC, entity_id ASC
    LIMIT 1
  `).get(coreChunkId) || null;
}

function assertIdentityFieldsCompatible(existing, incoming) {
  const comparable = [
    ["doc_uuid", incoming.docUuid],
    ["core_chunk_id_snapshot", incoming.coreChunkIdSnapshot],
    ["content_hash", incoming.contentHash],
    ["embedding_model", incoming.embeddingModel],
    ["embedding_fingerprint", incoming.embeddingFingerprint],
  ];
  for (const [field, value] of comparable) {
    if (value !== null && value !== undefined && existing[field] !== null && existing[field] !== value) {
      throw conflict(`identity field conflict: ${field}`, {
        entity_id: existing.entity_id,
        field,
        existing: existing[field],
        incoming: value,
      });
    }
  }
}

function insertIdentity(db, {
  entityId,
  docUuid = null,
  coreChunkIdSnapshot = null,
  contentHash: contentHashValue = null,
  embeddingModel = null,
  embeddingFingerprint: embeddingFingerprintValue = null,
  state = "active",
  nowSec,
} = {}) {
  const normalizedEntityId = normalizeString(entityId);
  if (!normalizedEntityId) throw new TypeError("entity_id is required");
  const normalizedState = normalizeState(state);
  const now = resolveNowSec(nowSec);
  const existing = identityById(db, normalizedEntityId);
  const incoming = {
    docUuid: normalizeString(docUuid),
    coreChunkIdSnapshot: normalizeString(coreChunkIdSnapshot),
    contentHash: normalizeString(contentHashValue),
    embeddingModel: normalizeString(embeddingModel),
    embeddingFingerprint: normalizeString(embeddingFingerprintValue),
  };
  if (existing) {
    assertIdentityFieldsCompatible(existing, incoming);
    const nextState = existing.state === "unknown_legacy" && normalizedState === "recovered"
      ? normalizedState
      : existing.state;
    db.prepare(`
      UPDATE memory_identity
      SET doc_uuid = COALESCE(doc_uuid, ?),
          core_chunk_id_snapshot = COALESCE(?, core_chunk_id_snapshot),
          content_hash = COALESCE(?, content_hash),
          embedding_model = COALESCE(?, embedding_model),
          embedding_fingerprint = COALESCE(?, embedding_fingerprint),
          state = ?,
          updated_at = ?
      WHERE entity_id = ?
    `).run(
      incoming.docUuid,
      incoming.coreChunkIdSnapshot,
      incoming.contentHash,
      incoming.embeddingModel,
      incoming.embeddingFingerprint,
      nextState,
      now,
      normalizedEntityId,
    );
    return identityById(db, normalizedEntityId);
  }

  if (incoming.coreChunkIdSnapshot) {
    const conflicting = db.prepare(`
      SELECT entity_id, state
      FROM memory_identity
      WHERE core_chunk_id_snapshot = ?
        AND entity_id != ?
        AND state IN ('active', 'recovered')
      LIMIT 1
    `).get(incoming.coreChunkIdSnapshot, normalizedEntityId);
    if (conflicting) {
      throw conflict("core chunk snapshot is already bound to another active entity", {
        core_chunk_id_snapshot: incoming.coreChunkIdSnapshot,
        entity_id: normalizedEntityId,
        existing_entity_id: conflicting.entity_id,
      });
    }
  }
  try {
    db.prepare(`
      INSERT INTO memory_identity
        (entity_id, doc_uuid, core_chunk_id_snapshot, content_hash,
         embedding_model, embedding_fingerprint, state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      normalizedEntityId,
      incoming.docUuid,
      incoming.coreChunkIdSnapshot,
      incoming.contentHash,
      incoming.embeddingModel,
      incoming.embeddingFingerprint,
      normalizedState,
      now,
      now,
    );
  } catch (error) {
    if (String(error?.code || "").startsWith("SQLITE_CONSTRAINT") && incoming.coreChunkIdSnapshot) {
      const concurrent = activeIdentityByCoreId(db, incoming.coreChunkIdSnapshot);
      if (concurrent) {
        assertIdentityFieldsCompatible(concurrent, incoming);
        return concurrent;
      }
    }
    throw error;
  }
  return identityById(db, normalizedEntityId);
}

function confidenceRow(db, chunkId) {
  if (!tableExists(db, "memory_confidence")) return null;
  return db.prepare("SELECT * FROM memory_confidence WHERE chunk_id = ?").get(chunkId) || null;
}

function linkConfidenceRow(db, {
  chunkId,
  entityId,
  docUuid,
  contentHash: contentHashValue,
  embeddingModel,
  embeddingFingerprint: embeddingFingerprintValue,
  initialConfidence = 0.5,
  confidence = 0.5,
  lastConfidenceUpdate = null,
  baseTau = 7,
  category = "raw_log",
} = {}) {
  if (!tableExists(db, "memory_confidence") || !chunkId) return { created: false, linked: false };
  assertStableMemoryIdentitySchema(db);
  const hasIdentityColumns = true;
  const existing = confidenceRow(db, chunkId);
  if (hasIdentityColumns && existing?.entity_id && existing.entity_id !== entityId) {
    const previousIdentity = identityById(db, existing.entity_id);
    if (previousIdentity?.state !== "superseded") {
      throw conflict("memory_confidence row is already bound to another entity", {
        chunk_id: chunkId,
        entity_id: entityId,
        existing_entity_id: existing.entity_id,
      });
    }
  }
  if (!existing) {
    if (hasIdentityColumns) {
      db.prepare(`
        INSERT INTO memory_confidence
          (chunk_id, initial_confidence, confidence, last_confidence_update,
           base_tau, hit_count, is_archived, is_protected, conflict_flag, category,
           entity_id, source_doc_id, content_hash, embedding_model, embedding_fingerprint)
        VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?)
      `).run(
        chunkId,
        initialConfidence,
        confidence,
        lastConfidenceUpdate,
        baseTau,
        category,
        entityId,
        docUuid,
        contentHashValue,
        embeddingModel,
        embeddingFingerprintValue,
      );
    } else {
      db.prepare(`
        INSERT INTO memory_confidence
          (chunk_id, initial_confidence, confidence, last_confidence_update,
           base_tau, hit_count, is_archived, is_protected, conflict_flag, category)
        VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?)
      `).run(chunkId, initialConfidence, confidence, lastConfidenceUpdate, baseTau, category);
    }
    return { created: true, linked: true };
  }
  if (!hasIdentityColumns) return { created: false, linked: true };
  db.prepare(`
    UPDATE memory_confidence
    SET entity_id = ?, source_doc_id = COALESCE(?, source_doc_id),
        content_hash = COALESCE(?, content_hash),
        embedding_model = COALESCE(?, embedding_model),
        embedding_fingerprint = COALESCE(?, embedding_fingerprint)
    WHERE chunk_id = ?
  `).run(
    entityId,
    docUuid,
    contentHashValue,
    embeddingModel,
    embeddingFingerprintValue,
    chunkId,
  );
  return { created: false, linked: true };
}

function supersedeEntities(db, entityIds, nowSec) {
  const ids = [...new Set((entityIds || []).map(normalizeString).filter(Boolean))];
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(", ");
  const result = db.prepare(`
    UPDATE memory_identity
    SET state = 'superseded', updated_at = ?
    WHERE entity_id IN (${placeholders}) AND state IN ('active', 'recovered')
  `).run(resolveNowSec(nowSec), ...ids);
  return Number(result?.changes || 0);
}

function assignStableMemoryIdentity(db, options = {}) {
  if (options.skipSchema !== true) ensureStableMemoryIdentityTables(db);
  assertStableMemoryIdentitySchema(db);
  const now = resolveNowSec(options.nowSec);
  const operation = normalizeString(options.operation) || "create";
  const coreChunkId = normalizeString(options.coreChunkId ?? options.chunkId ?? options.chunk_id);
  const text = options.text === undefined ? null : String(options.text ?? "");
  const contentHashValue = normalizeString(options.contentHash)
    || (text === null ? null : contentHash(text));
  const source = normalizeString(options.source) || "core";
  const canonicalPath = normalizeString(options.canonicalPath ?? options.path);
  const idFactory = options.idFactory || defaultEntityId;
  const suppliedEntityId = normalizeString(options.entityId);
  const priorEntityId = suppliedEntityId || normalizeString(options.previousEntityId);
  const priorIdentity = priorEntityId ? identityById(db, priorEntityId) : null;
  const requestedDocUuid = normalizeString(options.docUuid ?? options.sourceDocId)
    || ((operation === "move" || operation === "reindex") ? priorIdentity?.doc_uuid : null);
  if (operation === "move" && canonicalPath && !requestedDocUuid) {
    throw conflict("document move requires an existing entity or explicit doc_uuid", {
      canonicalPath,
    });
  }
  const doc = ensureSourceDocument(db, {
    docUuid: requestedDocUuid,
    source,
    canonicalPath,
    contentFingerprint: contentHashValue,
    nowSec: now,
    idFactory,
    allowMove: operation === "move" || operation === "reindex",
  });
  const docUuid = doc?.doc_uuid || normalizeString(options.docUuid ?? options.sourceDocId);

  let existing = suppliedEntityId ? identityById(db, suppliedEntityId) : null;
  if (existing) assertIdentityFieldsCompatible(existing, {
    docUuid,
    coreChunkIdSnapshot: coreChunkId,
    contentHash: contentHashValue,
    embeddingModel: normalizeString(options.embeddingModel),
    embeddingFingerprint: normalizeString(options.embeddingFingerprint),
  });

  if (!existing && coreChunkId && operation !== "rechunk") existing = activeIdentityByCoreId(db, coreChunkId);
  if (existing && operation === "model-upgrade") {
    const identity = insertIdentity(db, {
      entityId: existing.entity_id,
      docUuid,
      coreChunkIdSnapshot: coreChunkId || existing.core_chunk_id_snapshot,
      contentHash: contentHashValue || existing.content_hash,
      embeddingModel: options.embeddingModel,
      embeddingFingerprint: options.embeddingFingerprint,
      state: existing.state,
      nowSec: now,
    });
    linkConfidenceRow(db, {
      chunkId: coreChunkId,
      entityId: identity.entity_id,
      docUuid,
      contentHash: contentHashValue,
      embeddingModel: options.embeddingModel,
      embeddingFingerprint: options.embeddingFingerprint,
      initialConfidence: options.initialConfidence,
      confidence: options.confidence,
      lastConfidenceUpdate: options.lastConfidenceUpdate,
      baseTau: options.baseTau,
      category: options.category,
    });
    return { entity: identity, created: false, reused: true, superseded: 0 };
  }

  const forceNew = operation === "rechunk"
    || (operation === "update" && existing && contentHashValue && existing.content_hash !== contentHashValue);
  if (existing && !forceNew) {
    const identity = insertIdentity(db, {
      entityId: existing.entity_id,
      docUuid,
      coreChunkIdSnapshot: coreChunkId || existing.core_chunk_id_snapshot,
      contentHash: contentHashValue || existing.content_hash,
      embeddingModel: options.embeddingModel,
      embeddingFingerprint: options.embeddingFingerprint,
      state: existing.state,
      nowSec: now,
    });
    linkConfidenceRow(db, {
      chunkId: coreChunkId,
      entityId: identity.entity_id,
      docUuid,
      contentHash: contentHashValue,
      embeddingModel: options.embeddingModel,
      embeddingFingerprint: options.embeddingFingerprint,
      initialConfidence: options.initialConfidence,
      confidence: options.confidence,
      lastConfidenceUpdate: options.lastConfidenceUpdate,
      baseTau: options.baseTau,
      category: options.category,
    });
    return { entity: identity, created: false, reused: true, superseded: 0 };
  }

  const entityId = suppliedEntityId || String(idFactory("entity_id"));
  if (!entityId) throw new TypeError("entity identity factory returned an empty id");
  const supersedeIds = options.previousEntityId
    ? [options.previousEntityId]
    : Array.isArray(options.previousEntityIds)
      ? options.previousEntityIds
      : forceNew && existing
        ? [existing.entity_id]
        : [];
  const superseded = supersedeEntities(db, supersedeIds, now);
  const identity = insertIdentity(db, {
    entityId,
    docUuid,
    coreChunkIdSnapshot: coreChunkId,
    contentHash: contentHashValue,
    embeddingModel: options.embeddingModel,
    embeddingFingerprint: options.embeddingFingerprint,
    state: normalizeState(options.state, "active"),
    nowSec: now,
  });
  const confidence = linkConfidenceRow(db, {
    chunkId: coreChunkId,
    entityId: identity.entity_id,
    docUuid: identity.doc_uuid,
    contentHash: contentHashValue,
    embeddingModel: options.embeddingModel,
    embeddingFingerprint: options.embeddingFingerprint,
    initialConfidence: options.initialConfidence,
    confidence: options.confidence,
    lastConfidenceUpdate: options.lastConfidenceUpdate,
    baseTau: options.baseTau,
    category: options.category,
  });
  return {
    entity: identity,
    created: identity.entity_id === entityId,
    reused: identity.entity_id !== entityId,
    superseded,
    confidence,
  };
}

function transitionMemoryIdentity(db, entityId, state, { nowSec } = {}) {
  ensureStableMemoryIdentityTables(db);
  assertStableMemoryIdentitySchema(db);
  const normalizedEntityId = normalizeString(entityId);
  const nextState = normalizeState(state);
  const existing = identityById(db, normalizedEntityId);
  if (!existing) throw new Error(`memory identity not found: ${normalizedEntityId}`);
  const now = resolveNowSec(nowSec);
  db.prepare("UPDATE memory_identity SET state = ?, updated_at = ? WHERE entity_id = ?")
    .run(nextState, now, normalizedEntityId);
  if (tableExists(db, "memory_confidence")) {
    const archived = nextState === "archived" || nextState === "superseded" ? 1 : 0;
    db.prepare("UPDATE memory_confidence SET is_archived = ? WHERE entity_id = ?")
      .run(archived, normalizedEntityId);
  }
  return identityById(db, normalizedEntityId);
}

function archiveMemoryIdentity(db, entityId, options = {}) {
  return transitionMemoryIdentity(db, entityId, "archived", options);
}

function restoreMemoryIdentity(db, entityId, options = {}) {
  return transitionMemoryIdentity(db, entityId, "active", options);
}

function normalizeManifestRows(input, { readFile = readFileSync } = {}) {
  let value = input;
  if (typeof value === "string") {
    if (!existsSync(value)) throw new Error(`identity manifest not found: ${value}`);
    const text = readFile(value, "utf8");
    try {
      value = JSON.parse(text);
    } catch (error) {
      const rows = [];
      for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
        if (!line.trim()) continue;
        try {
          rows.push(JSON.parse(line));
        } catch (lineError) {
          throw new Error(`identity manifest JSONL line ${lineIndex + 1} is invalid: ${lineError.message}`);
        }
      }
      if (rows.length > 0) return rows;
      throw error;
    }
  }
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.rows)) return value.rows;
  if (value && Array.isArray(value.manifest)) return value.manifest;
  if (value && typeof value === "object") return [value];
  return [];
}

function manifestMigrationKey(row, normalized, index) {
  const explicit = normalizeString(row.migration_key ?? row.mapping_key ?? row.legacy_key);
  if (explicit) return explicit;
  if (normalized.engineMemoryId) return `engine:${normalized.engineMemoryId}`;
  if (normalized.lanceId) return `lance:${normalized.lanceId}`;
  if (normalized.coreChunkId) return `core:${normalized.coreChunkId}`;
  if (normalized.canonicalPath) {
    return `path:${normalized.source}:${normalized.canonicalPath}`;
  }
  const legacyId = normalizeString(row.legacy_id ?? row.id ?? row.memory_id);
  if (legacyId) return `legacy:${legacyId}`;
  throw new TypeError(
    `identity manifest row ${index} has no stable migration key; provide chunk_id, path, or migration_key`,
  );
}

function manifestSourceFingerprint(normalized) {
  return `sha256:${hashText(JSON.stringify({
    migration_key: normalized.migrationKey,
    lance_id: normalized.lanceId,
    engine_memory_id: normalized.engineMemoryId,
    source: normalized.source,
    canonical_path: normalized.canonicalPath,
    core_chunk_id: normalized.coreChunkId,
    content_hash: normalized.contentHash,
    embedding_model: normalized.embeddingModel,
    embedding_fingerprint: normalized.embeddingFingerprint,
    category: normalized.category,
  }))}`;
}

function normalizeManifestRow(row, index) {
  if (!row || typeof row !== "object") throw new TypeError(`identity manifest row ${index} is invalid`);
  const lanceId = normalizeString(row.lance_id ?? row.legacy_lance_id ?? row.vector_id);
  const engineMemoryId = normalizeString(row.engine_memory_id ?? row.engine_id);
  const coreChunkId = normalizeString(
    row.core_chunk_id ?? row.core_chunk_id_snapshot ?? row.chunk_id ?? row.coreId
      ?? row.id ?? row.memory_id ?? engineMemoryId ?? lanceId,
  );
  let source = normalizeString(row.source_system ?? row.source) || "core";
  let canonicalPath = normalizeString(row.canonical_path ?? row.path ?? row.source_path);
  if (!canonicalPath && source.startsWith("memory/")) {
    canonicalPath = source;
    source = "core";
  }
  const migrationKey = manifestMigrationKey(row, {
    engineMemoryId,
    lanceId,
    source,
    canonicalPath,
    coreChunkId,
  }, index);
  const entityId = normalizeString(row.entity_id ?? row.entityId)
    || deterministicId("migration-entity", migrationKey);
  const docUuid = normalizeString(row.doc_uuid ?? row.source_doc_id ?? row.docUuid)
    || (canonicalPath ? deterministicId("migration-doc", `${source}:${canonicalPath}`) : null);
  const text = row.text === undefined ? null : String(row.text ?? "");
  return {
    entityId,
    docUuid,
    lanceId,
    engineMemoryId,
    source,
    canonicalPath,
    coreChunkId,
    contentHash: normalizeString(row.content_hash) || (text === null ? null : contentHash(text)),
    embeddingModel: normalizeString(row.embedding_model),
    embeddingFingerprint: normalizeString(row.embedding_fingerprint),
    initialConfidence: Number.isFinite(Number(row.initial_confidence)) ? Number(row.initial_confidence) : 0.5,
    confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : 0.5,
    lastConfidenceUpdate: row.last_confidence_update ?? null,
    baseTau: Number.isFinite(Number(row.base_tau)) ? Number(row.base_tau) : 7,
    category: normalizeString(row.category) || "raw_log",
    confidenceChunkId: engineMemoryId || coreChunkId,
    migrationKey,
  };
}

function migrationMappingByKey(db, migrationKey) {
  return db.prepare(
    "SELECT * FROM memory_identity_migration_map WHERE migration_key = ?",
  ).get(migrationKey) || null;
}

function ensureMigrationMapping(db, row, nowSec) {
  const sourceFingerprint = manifestSourceFingerprint(row);
  const existing = migrationMappingByKey(db, row.migrationKey);
  if (existing) {
    if (existing.source_fingerprint !== sourceFingerprint
      || existing.entity_id !== row.entityId
      || (existing.doc_uuid || null) !== (row.docUuid || null)
      || (existing.lance_id || null) !== (row.lanceId || null)
      || (existing.engine_memory_id || null) !== (row.engineMemoryId || null)
      || (existing.core_chunk_id || null) !== (row.coreChunkId || null)
      || (existing.canonical_path || null) !== (row.canonicalPath || null)) {
      throw conflict("identity migration mapping changed for an existing manifest key", {
        migration_key: row.migrationKey,
        entity_id: row.entityId,
        existing_entity_id: existing.entity_id,
      });
    }
    db.prepare(
      "UPDATE memory_identity_migration_map SET mapping_status = 'applied', updated_at = ? WHERE migration_key = ?",
    ).run(nowSec, row.migrationKey);
    return existing;
  }
  try {
    db.prepare(`
      INSERT INTO memory_identity_migration_map
        (migration_key, source_fingerprint, entity_id, doc_uuid, lance_id,
         engine_memory_id, core_chunk_id, canonical_path, mapping_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'applied', ?, ?)
    `).run(
      row.migrationKey,
      sourceFingerprint,
      row.entityId,
      row.docUuid,
      row.lanceId,
      row.engineMemoryId,
      row.coreChunkId,
      row.canonicalPath,
      nowSec,
      nowSec,
    );
  } catch (error) {
    if (String(error?.code || "").startsWith("SQLITE_CONSTRAINT")) {
      throw conflict("identity migration mapping conflicts with existing identity", {
        migration_key: row.migrationKey,
        entity_id: row.entityId,
        cause: error,
      });
    }
    throw error;
  }
  return migrationMappingByKey(db, row.migrationKey);
}

function migrateStableMemoryIdentity(db, {
  manifest = [],
  manifestPath = null,
  nowSec,
  readFile = readFileSync,
} = {}) {
  ensureStableMemoryIdentityTables(db, { addConfidenceColumns: true });
  const input = manifestPath || manifest;
  const rawRows = normalizeManifestRows(input, { readFile });
  const normalizedRows = rawRows.map((row, index) => normalizeManifestRow(row, index));
  const now = resolveNowSec(nowSec);
  const result = {
    schema_version: STABLE_MEMORY_IDENTITY_SCHEMA_VERSION,
    manifest_rows: normalizedRows.length,
    recovered: 0,
    unknown_legacy: 0,
    already_migrated: 0,
    conflicts: 0,
  };

  const transaction = db.transaction(() => {
    const manifestByCore = new Map();
    for (const row of normalizedRows) {
      if (!row.coreChunkId) continue;
      const previous = manifestByCore.get(row.coreChunkId);
      if (previous && previous.entityId !== row.entityId) {
        throw conflict("manifest maps one core chunk to multiple entity IDs", {
          core_chunk_id: row.coreChunkId,
          entity_id: row.entityId,
          existing_entity_id: previous.entityId,
        });
      }
      manifestByCore.set(row.coreChunkId, row);
    }

    for (const row of normalizedRows) {
      ensureMigrationMapping(db, row, now);
      const doc = row.canonicalPath
        ? ensureSourceDocument(db, {
          docUuid: row.docUuid,
          source: row.source,
          canonicalPath: row.canonicalPath,
          contentFingerprint: row.contentHash,
          nowSec: now,
          idFactory: (kind) => deterministicId(`migration-${kind}`, row.migrationKey),
          allowMove: false,
        })
        : null;
      const docUuid = doc?.doc_uuid || row.docUuid;
      const before = identityById(db, row.entityId);
      const identity = insertIdentity(db, {
        entityId: row.entityId,
        docUuid,
        coreChunkIdSnapshot: row.coreChunkId,
        contentHash: row.contentHash,
        embeddingModel: row.embeddingModel,
        embeddingFingerprint: row.embeddingFingerprint,
        state: "recovered",
        nowSec: now,
      });
      const confidenceCandidates = [...new Set([row.confidenceChunkId, row.coreChunkId].filter(Boolean))];
      for (const confidenceChunkId of confidenceCandidates) {
        const existingConfidence = confidenceRow(db, confidenceChunkId);
        if (existingConfidence?.entity_id && existingConfidence.entity_id !== row.entityId) {
          throw conflict("manifest conflicts with memory_confidence identity", {
            chunk_id: confidenceChunkId,
            entity_id: row.entityId,
            existing_entity_id: existingConfidence.entity_id,
          });
        }
      }
      // A manifest can describe an historical Engine id and a different
      // current Core snapshot.  They are two names for one identity, not two
      // confidence rows: idx_memory_confidence_entity intentionally forbids
      // linking both rows to the same entity.  Prefer the historical Engine
      // row when present, otherwise reuse the Core row, otherwise create the
      // Engine row as the durable confidence association.
      const engineConfidence = confidenceRow(db, row.confidenceChunkId);
      const coreConfidence = row.coreChunkId && row.coreChunkId !== row.confidenceChunkId
        ? confidenceRow(db, row.coreChunkId)
        : null;
      const linkedConfidenceChunkId = engineConfidence
        ? row.confidenceChunkId
        : coreConfidence
          ? row.coreChunkId
          : row.confidenceChunkId;
      linkConfidenceRow(db, {
        chunkId: linkedConfidenceChunkId,
        entityId: row.entityId,
        docUuid,
        contentHash: row.contentHash,
        embeddingModel: row.embeddingModel,
        embeddingFingerprint: row.embeddingFingerprint,
        initialConfidence: row.initialConfidence,
        confidence: row.confidence,
        lastConfidenceUpdate: row.lastConfidenceUpdate,
        baseTau: row.baseTau,
        category: row.category,
      });
      if (before && identity.entity_id === before.entity_id && before.state === "recovered") result.already_migrated += 1;
      else result.recovered += 1;
    }

    if (tableExists(db, "memory_confidence")) {
      const legacyRows = db.prepare(`
        SELECT chunk_id, initial_confidence, confidence, last_confidence_update,
               base_tau, category, entity_id
        FROM memory_confidence
        WHERE entity_id IS NULL OR TRIM(entity_id) = ''
        ORDER BY chunk_id ASC
      `).all();
      for (const row of legacyRows) {
        const entityId = deterministicId("legacy", row.chunk_id);
        const before = identityById(db, entityId);
        insertIdentity(db, {
          entityId,
          docUuid: null,
          coreChunkIdSnapshot: row.chunk_id,
          state: "unknown_legacy",
          nowSec: now,
        });
        linkConfidenceRow(db, {
          chunkId: row.chunk_id,
          entityId,
          docUuid: null,
          initialConfidence: row.initial_confidence,
          confidence: row.confidence,
          lastConfidenceUpdate: row.last_confidence_update,
          baseTau: row.base_tau,
          category: row.category,
        });
        if (!before) result.unknown_legacy += 1;
      }
    }
  });

  try {
    transaction();
  } catch (error) {
    if (error?.code === STABLE_MEMORY_IDENTITY_CONFLICT) result.conflicts += 1;
    throw error;
  }
  return result;
}

function readActiveStableIdentities(db, { limit = null } = {}) {
  if (!tableExists(db, "memory_identity")) return [];
  assertStableMemoryIdentitySchema(db);
  const sql = `
    SELECT mi.*, mc.chunk_id, mc.is_archived
    FROM memory_identity mi
    LEFT JOIN memory_confidence mc ON mc.entity_id = mi.entity_id
    WHERE mi.state IN ('active', 'recovered')
      AND COALESCE(mc.is_archived, 0) = 0
    ORDER BY mi.entity_id ASC
    ${Number.isInteger(Number(limit)) && Number(limit) > 0 ? "LIMIT ?" : ""}
  `;
  return Number.isInteger(Number(limit)) && Number(limit) > 0
    ? db.prepare(sql).all(Number(limit))
    : db.prepare(sql).all();
}

function readMigrationAliases(db) {
  if (!tableExists(db, "memory_identity_migration_map")) return [];
  return db.prepare(`
    SELECT lance_id, entity_id, core_chunk_id, engine_memory_id, mapping_status
    FROM memory_identity_migration_map
    WHERE lance_id IS NOT NULL AND TRIM(lance_id) <> ''
    ORDER BY lance_id ASC
  `).all();
}

function markMissingCoreSnapshotsUnknown(db, currentCoreIds = [], {
  pathPrefixes = ["memory/smart-add/", "memory/episodes/"],
  nowSec,
} = {}) {
  if (!isStableMemoryIdentityReady(db)) return { changed: 0, entityIds: [] };
  const current = new Set((currentCoreIds || []).map(value => String(value)));
  const pathClause = pathPrefixes.map(() => "msd.canonical_path LIKE ?").join(" OR ");
  const rows = db.prepare(`
    SELECT mi.entity_id, mi.core_chunk_id_snapshot
    FROM memory_identity mi
    LEFT JOIN memory_source_docs msd ON msd.doc_uuid = mi.doc_uuid
    WHERE mi.state IN ('active', 'recovered')
      AND mi.core_chunk_id_snapshot IS NOT NULL
      AND (${pathClause})
  `).all(...pathPrefixes.map(prefix => `${prefix}%`));
  const staleIds = rows
    .filter(row => !current.has(String(row.core_chunk_id_snapshot)))
    .map(row => String(row.entity_id));
  if (staleIds.length === 0) return { changed: 0, entityIds: [] };
  const placeholders = staleIds.map(() => "?").join(", ");
  const now = resolveNowSec(nowSec);
  const result = db.prepare(`
    UPDATE memory_identity
    SET state = 'unknown_legacy', updated_at = ?
    WHERE entity_id IN (${placeholders}) AND state IN ('active', 'recovered')
  `).run(now, ...staleIds);
  db.prepare(`
    UPDATE memory_confidence
    SET is_archived = 1
    WHERE entity_id IN (${placeholders})
  `).run(...staleIds);
  return { changed: Number(result?.changes || 0), entityIds: staleIds };
}

module.exports = {
  CHECKPOINT_KEY,
  DEFAULT_EMBEDDING_DIMENSION,
  DEFAULT_EMBEDDING_MODEL,
  STABLE_MEMORY_IDENTITY_CONFLICT,
  STABLE_MEMORY_IDENTITY_SCHEMA_REQUIRED,
  STABLE_MEMORY_IDENTITY_SCHEMA_VERSION,
  STABLE_MEMORY_IDENTITY_STATES,
  activeIdentityByCoreId,
  archiveMemoryIdentity,
  assignStableMemoryIdentity,
  contentHash,
  defaultEntityId,
  deterministicId,
  embeddingFingerprint,
  ensureSourceDocument,
  ensureStableMemoryIdentityTables,
  assertStableMemoryIdentitySchema,
  hasStableMemoryIdentityColumns,
  isStableMemoryIdentityReady,
  stableMemoryIdentitySchemaState,
  hashText,
  isRealEmbedding,
  migrateStableMemoryIdentity,
  normalizeManifestRows,
  normalizeManifestRow,
  readActiveStableIdentities,
  readMigrationAliases,
  markMissingCoreSnapshotsUnknown,
  readCheckpoint,
  resetCheckpoint,
  restoreMemoryIdentity,
  transitionMemoryIdentity,
  validateEmbeddingVector,
  writeCheckpoint,
};
