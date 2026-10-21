const { createHash } = require("node:crypto");
const { getSFKey, getSFBaseUrl } = require("./config");
const { withDb } = require("./db");
const { withEngineDbIsolated } = require("../db/isolated-dbs.js");
const { getCanonicalMemoriesByIds } = require("../canonical/read-adapter.js");
const {
  materializeCanonicalLanceRow,
  projectCanonicalMemoryToVectorProjection,
} = require("../canonical/vector-projection.js");
const { getRuntime } = require("./runtime");
const {
  collectEligibleSessionFlushCoreRows,
} = require("./session-flush-reconciliation.js");
const { readScopedLanceRows } = require("./lance-membership.cjs");
const {
  embeddingFingerprint,
  DEFAULT_EMBEDDING_MODEL,
  assertStableMemoryIdentitySchema,
  isStableMemoryIdentityReady,
  stableMemoryIdentitySchemaState,
  readActiveStableIdentities,
  readMigrationAliases,
  readCheckpoint,
  validateEmbeddingVector,
  writeCheckpoint,
} = require("../db/stable-memory-identity.cjs");

const MAX_LANCE_WRITES_PER_CYCLE = 10;
const LANCE_QUERY_BATCH_SIZE = 400;
const MAX_LANCE_SCAN_ROWS = 5000;
const MAX_PROVIDER_REQUESTS_PER_CYCLE = MAX_LANCE_WRITES_PER_CYCLE;
const GLOBAL_MAINTENANCE_TRIGGER = "global_identity_maintenance";

function stableJson(value) {
  if (value === null) return "null";
  if (value === undefined) return '{"$undefined":true}';
  if (typeof value === "number") {
    if (Number.isNaN(value)) return '{"$number":"NaN"}';
    if (value === Infinity) return '{"$number":"Infinity"}';
    if (value === -Infinity) return '{"$number":"-Infinity"}';
    if (Object.is(value, -0)) return "-0";
    return JSON.stringify(value);
  }
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => stableJson(item)).join(",")}]`;
  if (value instanceof Date) return `{"$date":${JSON.stringify(value.toISOString())}}`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(number)));
}

function hashDataset(value) {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}

function chunked(values, size = LANCE_QUERY_BATCH_SIZE) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function schemaFieldNames(schema) {
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  const names = fields.map(field => String(field?.name || "")).filter(Boolean);
  if (names.length > 0) return new Set(names);
  if (Array.isArray(schema?.names)) return new Set(schema.names.map(String).filter(Boolean));
  return new Set();
}

function vectorDimensionFromSchema(schema) {
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  const vectorField = fields.find(field => String(field?.name || "") === "vector");
  const type = vectorField?.type;
  const candidate = type?.listSize ?? type?.list_size ?? type?.valueType?.listSize ?? null;
  return Number.isInteger(Number(candidate)) && Number(candidate) > 0 ? Number(candidate) : null;
}

async function readLanceSchemaInfo(table, { includeDatasetStats = true } = {}) {
  let schema = null;
  let schemaError = null;
  if (typeof table?.schema === "function") {
    try {
      schema = await table.schema();
    } catch (error) {
      schemaError = error;
    }
  }
  const columns = schema ? schemaFieldNames(schema) : null;
  const vectorDimension = schema ? vectorDimensionFromSchema(schema) : null;
  let version = null;
  let rowCount = null;
  if (includeDatasetStats) {
    try {
      if (typeof table?.version === "function") version = await table.version();
    } catch {
      version = null;
    }
    try {
      if (typeof table?.countRows === "function") rowCount = await table.countRows();
    } catch {
      rowCount = null;
    }
  }
  const datasetIdentity = version !== null || rowCount !== null || columns
    ? hashDataset({
      version: version === null ? null : Number(version),
      row_count: rowCount === null ? null : Number(rowCount),
      columns: columns ? [...columns].sort() : null,
    })
    : null;
  // This is a schema capability signal used by the global maintenance path.
  // The scoped path separately requires an authoritative per-entity value
  // comparison before it reports vector validation as verified.
  const fingerprintVerification = schemaError
    ? "unverified"
    : !schema
      ? "unverified"
      : columns.has("embedding_fingerprint") ? "verified" : "unverified";
  const fingerprintVerificationReason = schemaError
    ? "schema_query_failed"
    : !schema
      ? "schema_unavailable"
      : columns.has("embedding_fingerprint") ? null : "fingerprint_column_missing";
  return {
    columns,
    vectorDimension,
    version,
    rowCount,
    datasetIdentity,
    fingerprintVerification,
    fingerprintVerificationReason,
    schemaError: schemaError ? String(schemaError?.message || schemaError) : null,
  };
}

function selectColumnsForSchema(schemaInfo) {
  if (!(schemaInfo?.columns instanceof Set)) return ["id"];
  const columns = ["id"];
  for (const optional of ["doc_uuid", "embedding_fingerprint"]) {
    if (schemaInfo.columns.has(optional)) columns.push(optional);
  }
  return columns.filter(column => schemaInfo.columns.has(column));
}

function rowForLanceSchema(row, schemaInfo) {
  if (!(schemaInfo?.columns instanceof Set)) return row;
  const projected = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (schemaInfo.columns.has(key)) projected[key] = value;
  }
  return projected;
}

function stableIdentityDatasetIdentity(identities) {
  return hashDataset((identities || []).map(row => ({
    entity_id: String(row.entity_id),
    state: String(row.state || ""),
    core_chunk_id_snapshot: row.core_chunk_id_snapshot || null,
    embedding_model: row.embedding_model || null,
    embedding_fingerprint: row.embedding_fingerprint || null,
  })).sort((left, right) => left.entity_id.localeCompare(right.entity_id)));
}

function combinedDatasetIdentity(schemaInfo, identities, lanceRows = []) {
  return hashDataset({
    lance: schemaInfo?.datasetIdentity || null,
    lance_members: [...new Set((lanceRows || [])
      .map(row => String(row?.id ?? "").trim())
      .filter(Boolean))].sort(),
    engine: stableIdentityDatasetIdentity(identities),
  });
}

function readScopedEngineRows(runtime, ids) {
  return withEngineDbIsolated((engineDb) => {
    const columns = new Set(engineDb.prepare("PRAGMA table_info(memory_confidence)").all().map(row => String(row.name)));
    const hasIdentityTable = Boolean(engineDb.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_identity'",
    ).get());
    const identityState = stableMemoryIdentitySchemaState(engineDb);
    const canJoinIdentity = identityState === "migrated" && hasIdentityTable && columns.has("entity_id");
    const identityColumns = hasIdentityTable
      ? new Set(engineDb.prepare("PRAGMA table_info(memory_identity)").all().map(row => String(row.name)))
      : new Set();
    const identityFingerprintAvailable = canJoinIdentity && identityColumns.has("embedding_fingerprint");
    const optional = [
      ["entity_id", "NULL AS entity_id"],
      ["source_doc_id", "NULL AS source_doc_id"],
      ["content_hash", "NULL AS content_hash"],
      ["embedding_model", "NULL AS embedding_model"],
    ];
    const projection = optional.map(([name, fallback]) => columns.has(name) ? `mc.${name} AS ${name}` : fallback).join(", ");
    const identityProjection = canJoinIdentity
      ? `mi.state AS identity_state, ${identityFingerprintAvailable
        ? "mi.embedding_fingerprint AS identity_embedding_fingerprint"
        : "NULL AS identity_embedding_fingerprint"}`
      : "NULL AS identity_state, NULL AS identity_embedding_fingerprint";
    const rows = [];
    for (const batch of chunked(ids)) {
      if (batch.length === 0) continue;
      const placeholders = batch.map(() => "?").join(", ");
      rows.push(...engineDb.prepare(`
        SELECT chunk_id, is_archived, ${projection}
             , ${identityProjection}
        FROM memory_confidence mc
        ${canJoinIdentity ? "LEFT JOIN memory_identity mi ON mi.entity_id = mc.entity_id" : ""}
        WHERE chunk_id IN (${placeholders})
      `).all(...batch));
    }
    return {
      rows,
      stable_identity_ready: identityState === "migrated",
      stable_identity_state: identityState,
    };
  }, {
    ...runtime.dbOptions,
    readonly: true,
  });
}

function requestEmbedding(text) {
  const https = require("node:https");
  const key = getSFKey();
  if (!key) return Promise.resolve(null);

  const embBody = JSON.stringify({
    model: "Qwen/Qwen3-Embedding-4B",
    input: String(text || "").slice(0, 8000),
  });
  return new Promise((resolve, reject) => {
    const url = new URL("/v1/embeddings", getSFBaseUrl());
    const req = https.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    }, (resp) => {
      let data = "";
      resp.on("data", chunk => data += chunk);
      resp.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.data?.[0]?.embedding || null);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
    req.write(embBody);
    req.end();
  });
}

function readonlyEngineAccessor(runtime, override) {
  if (typeof override === "function") return override;
  return fn => withEngineDbIsolated(fn, {
    ...runtime.dbOptions,
    readonly: true,
  });
}

async function resolveCanonicalBatch(memoryIds, runtime, options = {}) {
  const resolver = options.getCanonicalMemoriesByIds || getCanonicalMemoriesByIds;
  const withCoreDb = options.withCoreDb || (fn => withDb(fn));
  const withEngineDb = readonlyEngineAccessor(runtime, options.withEngineDbReadonly);
  return resolver(memoryIds, { withCoreDb, withEngineDb });
}

function canonicalResolutionError(resolution, memoryId) {
  if (!resolution?.ok || !resolution.memory) {
    return new Error(`canonical_lookup_${resolution?.reason || "invalid_result"}`);
  }
  if (resolution.memory.memory_id !== memoryId) {
    return new Error("canonical_lookup_memory_id_mismatch");
  }
  return null;
}

async function buildCanonicalLanceRow(resolution, memoryId, {
  embedText,
  sourceRow,
  timestamp,
  schemaInfo = null,
  embeddingModel = DEFAULT_EMBEDDING_MODEL,
  embeddingDimension = null,
} = {}) {
  const resolutionError = canonicalResolutionError(resolution, memoryId);
  if (resolutionError) throw resolutionError;
  const projection = projectCanonicalMemoryToVectorProjection(resolution.memory);
  const vector = await embedText(projection.embedding_input, sourceRow);
  const expectedDimension = embeddingDimension || schemaInfo?.vectorDimension || null;
  const validation = validateEmbeddingVector(vector, { expectedDimension });
  if (!validation.ok) {
    throw new Error(`invalid embedding for LanceDB convergence: ${validation.reason}`);
  }
  const identityModel = sourceRow?.embedding_model || null;
  if (identityModel && String(identityModel) !== String(embeddingModel)) {
    throw new Error(`embedding model mismatch: expected ${embeddingModel}, found ${identityModel}`);
  }
  const row = materializeCanonicalLanceRow(projection, {
    vector,
    timestamp,
    ...(sourceRow?.entity_id ? {
      entityId: sourceRow.entity_id,
      docUuid: sourceRow?.doc_uuid || sourceRow?.source_doc_id || null,
      embeddingFingerprint: embeddingFingerprint(vector),
    } : {}),
  });
  const expectedFingerprint = String(sourceRow?.identity_embedding_fingerprint || "").trim();
  const actualFingerprint = String(row?.embedding_fingerprint || "").trim();
  if (expectedFingerprint && actualFingerprint && expectedFingerprint !== actualFingerprint) {
    const error = new Error("canonical embedding fingerprint conflicts with stable Engine identity");
    error.code = "EMBEDDING_FINGERPRINT_CONFLICT";
    throw error;
  }
  return rowForLanceSchema(row, schemaInfo);
}

function assessScopedFingerprintValidation({
  schemaInfo,
  activeRows = [],
  lanceRows = [],
  addedRows = [],
  membershipComplete = false,
  knownConflicts = 0,
} = {}) {
  if (knownConflicts > 0) {
    return { state: "conflict", reason: "engine_lance_fingerprint_mismatch", conflicts: knownConflicts };
  }
  if (activeRows.length === 0) return { state: "not_applicable", reason: "no_active_rows", conflicts: 0 };
  if (!(schemaInfo?.columns instanceof Set) || !schemaInfo.columns.has("embedding_fingerprint")) {
    return { state: "unverified", reason: "fingerprint_column_missing", conflicts: 0 };
  }
  if (!membershipComplete) return { state: "incomplete", reason: "vector_membership_incomplete", conflicts: 0 };

  let unverifiedReason = null;
  let conflicts = 0;
  const addedById = new Map(addedRows.map(row => [String(row.id), row]));
  for (const sourceRow of activeRows) {
    const coreId = String(sourceRow.id);
    const entityId = String(sourceRow.entity_id || "");
    const expected = String(sourceRow.identity_embedding_fingerprint || "").trim();
    if (!expected) {
      unverifiedReason ||= "trusted_engine_fingerprint_missing";
      continue;
    }
    const members = lanceRows.filter(row => (
      String(row.id) === coreId || (entityId && String(row.id) === entityId)
    ));
    const newlyAdded = addedById.get(coreId) || (entityId ? addedById.get(entityId) : null);
    const actualValues = members.map(row => String(row.embedding_fingerprint || "").trim());
    if (newlyAdded) actualValues.push(String(newlyAdded.embedding_fingerprint || "").trim());
    if (actualValues.length === 0) {
      unverifiedReason ||= "vector_member_missing_after_repair";
      continue;
    }
    if (actualValues.some(value => !value)) {
      unverifiedReason ||= "lance_fingerprint_missing";
      continue;
    }
    if (actualValues.some(value => value !== expected)) conflicts += 1;
  }
  if (conflicts > 0) {
    return { state: "conflict", reason: "engine_lance_fingerprint_mismatch", conflicts };
  }
  if (unverifiedReason) return { state: "unverified", reason: unverifiedReason, conflicts: 0 };
  return { state: "verified", reason: null, conflicts: 0 };
}

function scopedFailure({
  trigger,
  eligible,
  active,
  missing,
  error,
  failed = missing,
  operationFailed = failed,
  writeFailed = 0,
  limitBacklog = 0,
  fingerprintVerification = "unverified",
  fingerprintVerificationReason = "not_checked",
  fingerprintConflictCount = 0,
  skippedUnknownLegacy = 0,
} = {}) {
  return {
    ok: false,
    trigger,
    lance_eligible: active,
    lance_existing: Math.max(0, eligible - missing),
    lance_missing_before: missing,
    lance_added: 0,
    lance_failed: failed,
    lance_operation_failed: operationFailed,
    lance_write_failed: writeFailed,
    lance_limit_backlog_remaining: limitBacklog,
    lance_backlog_remaining: Math.max(missing, operationFailed + writeFailed + limitBacklog),
    lance_converged: false,
    lance_membership_complete: false,
    lance_membership_state: "incomplete",
    lance_vector_validation_complete: false,
    lance_vector_validation_state: fingerprintVerification === "conflict" ? "conflict" : "incomplete",
    lance_fingerprint_conflicts: fingerprintConflictCount,
    lance_skipped_unknown_legacy: skippedUnknownLegacy,
    lance_input_state: error && eligible === 0 ? "input_error" : eligible === 0 ? "empty_input" : "present",
    lance_completion_state: writeFailed > 0 ? "write_failed" : operationFailed > 0 ? "operation_failed" : limitBacklog > 0 ? "limit_backlog" : "failed",
    fingerprint_verification: fingerprintVerification,
    fingerprint_verification_reason: fingerprintVerificationReason,
    error: error?.message ? String(error.message) : String(error),
  };
}

async function reconcileScopedSessionFlushVectors(options = {}) {
  const runtime = getRuntime();
  const trigger = options.trigger || "nightly_checkpoint";
  let eligibleCoreRows = Array.isArray(options.eligibleCoreRows)
    ? options.eligibleCoreRows
    : null;
  if (!eligibleCoreRows) {
    const collection = collectEligibleSessionFlushCoreRows({ trigger });
    if (!collection.ok) {
      return scopedFailure({
        trigger,
        eligible: 0,
        active: 0,
        missing: 0,
        error: new Error(collection.error),
        failed: 0,
      });
    }
    eligibleCoreRows = collection.eligibleCoreRows;
  }

  if (options.engineReconciliation?.ok === false) {
    return scopedFailure({
      trigger,
      eligible: eligibleCoreRows.length,
      active: 0,
      missing: eligibleCoreRows.length,
      error: new Error(options.engineReconciliation.error || "Engine reconciliation incomplete"),
    });
  }

  const eligibleIds = [...new Set(eligibleCoreRows.map(row => String(row.id)).filter(Boolean))];
  if (eligibleIds.length === 0) {
    return {
      ok: true,
      trigger,
      lance_eligible: 0,
      lance_existing: 0,
      lance_missing_before: 0,
      lance_added: 0,
      lance_failed: 0,
      lance_operation_failed: 0,
      lance_write_failed: 0,
      lance_limit_backlog_remaining: 0,
      lance_backlog_remaining: 0,
      lance_converged: true,
      lance_membership_complete: true,
      lance_membership_state: "empty_input",
      lance_skipped_unknown_legacy: 0,
      lance_vector_validation_complete: false,
      lance_vector_validation_state: "not_applicable",
      lance_fingerprint_conflicts: 0,
      lance_input_state: "empty_input",
      lance_completion_state: "empty_input",
      fingerprint_verification: "unverified",
      fingerprint_verification_reason: "no_input",
    };
  }

  let engineSnapshot;
  try {
    engineSnapshot = readScopedEngineRows(runtime, eligibleIds);
  } catch (error) {
    return scopedFailure({
      trigger,
      eligible: eligibleIds.length,
      active: 0,
      missing: eligibleIds.length,
      error,
    });
  }

  const engineRows = engineSnapshot.rows;
  if (["partial", "error"].includes(engineSnapshot.stable_identity_state)) {
    return scopedFailure({
      trigger,
      eligible: eligibleIds.length,
      active: 0,
      missing: eligibleIds.length,
      error: new Error("stable memory identity schema incomplete; scoped vector repair halted"),
    });
  }
  const engineById = new Map(engineRows.map(row => [String(row.chunk_id), row]));
  const activeRows = eligibleCoreRows.map(row => {
    const engineRow = engineById.get(String(row.id));
    if (!engineRow || Number(engineRow.is_archived || 0) !== 0) return null;
    // Once the stable schema exists, only active/recovered identities may
    // enter the scoped vector path.  In particular, unknown_legacy rows stay
    // isolated until an explicit recovery mapping changes their state.
    if (engineSnapshot.stable_identity_ready) {
      if (!engineRow.entity_id || !["active", "recovered"].includes(String(engineRow.identity_state || ""))) {
        return null;
      }
    }
    return {
      ...row,
      ...(engineRow.entity_id ? { entity_id: String(engineRow.entity_id) } : {}),
      ...(engineRow.identity_state ? { identity_state: String(engineRow.identity_state) } : {}),
      ...(engineRow.identity_embedding_fingerprint
        ? { identity_embedding_fingerprint: String(engineRow.identity_embedding_fingerprint) }
        : {}),
    };
  }).filter(Boolean);
  const skippedUnknownLegacy = engineSnapshot.stable_identity_ready
    ? eligibleCoreRows.filter(row => {
      const engineRow = engineById.get(String(row.id));
      return engineRow && String(engineRow.identity_state || "") === "unknown_legacy";
    }).length
    : 0;
  if (skippedUnknownLegacy > 0) {
    console.log(`[checkpoint] session_flush Lance skipped ${skippedUnknownLegacy} unknown_legacy identity row(s)`);
  }
  if (activeRows.length === 0) {
    return {
      ok: true,
      trigger,
      lance_eligible: 0,
      lance_existing: 0,
      lance_missing_before: 0,
      lance_added: 0,
      lance_failed: 0,
      lance_operation_failed: 0,
      lance_write_failed: 0,
      lance_limit_backlog_remaining: 0,
      lance_backlog_remaining: 0,
      lance_converged: true,
      lance_membership_complete: true,
      lance_membership_state: "no_active_rows",
    lance_skipped_unknown_legacy: skippedUnknownLegacy,
      lance_vector_validation_complete: false,
      lance_vector_validation_state: "not_applicable",
      lance_fingerprint_conflicts: 0,
      lance_input_state: "present",
      lance_completion_state: "no_active_rows",
      fingerprint_verification: "unverified",
      fingerprint_verification_reason: "no_active_rows",
    };
  }

  let lancedb;
  let table;
  try {
    lancedb = require("@lancedb/lancedb");
    const db = await lancedb.connect(runtime.lancedbDir);
    table = await db.openTable("chunks");
  } catch (error) {
    return scopedFailure({
      trigger,
      eligible: activeRows.length,
      active: activeRows.length,
      missing: activeRows.length,
      error,
    });
  }

  let schemaInfo;
  try {
    schemaInfo = await readLanceSchemaInfo(table, { includeDatasetStats: false });
    if (schemaInfo.schemaError) throw new Error(`LanceDB schema query failed: ${schemaInfo.schemaError}`);
    if (!(schemaInfo.columns instanceof Set) || !schemaInfo.columns.has("id")) {
      throw new Error("LanceDB table schema is missing required id column");
    }
    if (!Number.isInteger(schemaInfo.vectorDimension) || schemaInfo.vectorDimension <= 0) {
      throw new Error("LanceDB table schema has no verifiable vector dimension");
    }
  } catch (error) {
    return scopedFailure({
      trigger,
      eligible: activeRows.length,
      active: activeRows.length,
      missing: activeRows.length,
      error,
      failed: activeRows.length,
      operationFailed: activeRows.length,
    });
  }

  const stableIdentity = row => engineSnapshot.stable_identity_ready ? String(row.entity_id || "") : "";
  const requestedLanceIds = [...new Set(activeRows
    .flatMap(row => [String(row.id), stableIdentity(row)])
    .filter(Boolean))];
  let lanceRows;
  try {
    lanceRows = await readScopedLanceRows(table, requestedLanceIds, { schemaInfo });
  } catch (error) {
    return scopedFailure({
      trigger,
      eligible: activeRows.length,
      active: activeRows.length,
      missing: activeRows.length,
      error,
      failed: activeRows.length,
      operationFailed: activeRows.length,
      fingerprintVerification: "unverified",
      fingerprintVerificationReason: "scoped_membership_query_failed",
    });
  }
  const lanceIds = new Set(lanceRows.map(row => String(row.id)));
  const existingRows = activeRows.filter(row => (
    lanceIds.has(String(row.id)) || (stableIdentity(row) && lanceIds.has(stableIdentity(row)))
  ));
  const missingRows = activeRows.filter(row => !existingRows.includes(row));
  let fingerprintVerification = "unverified";
  let fingerprintVerificationReason = schemaInfo.fingerprintVerificationReason;
  let fingerprintConflictCount = 0;
  const existingFingerprintState = assessScopedFingerprintValidation({
    schemaInfo,
    activeRows,
    lanceRows,
    membershipComplete: missingRows.length === 0,
  });
  fingerprintVerification = existingFingerprintState.state === "conflict" ? "conflict" : "unverified";
  fingerprintVerificationReason = existingFingerprintState.reason;
  fingerprintConflictCount = existingFingerprintState.conflicts;
  if (missingRows.length === 0) {
    const validation = assessScopedFingerprintValidation({
      schemaInfo,
      activeRows,
      lanceRows,
      membershipComplete: true,
      knownConflicts: fingerprintConflictCount,
    });
    return {
      ok: validation.state !== "conflict",
      trigger,
      lance_eligible: activeRows.length,
      lance_existing: existingRows.length,
      lance_missing_before: 0,
      lance_added: 0,
      lance_failed: 0,
      lance_operation_failed: 0,
      lance_write_failed: 0,
      lance_limit_backlog_remaining: 0,
      lance_backlog_remaining: 0,
      lance_converged: true,
      lance_membership_complete: true,
      lance_membership_state: "complete",
      lance_skipped_unknown_legacy: skippedUnknownLegacy,
      lance_vector_validation_complete: validation.state === "verified",
      lance_vector_validation_state: validation.state,
      lance_fingerprint_conflicts: validation.conflicts,
      lance_input_state: "present",
      lance_completion_state: validation.state === "conflict" ? "vector_conflict" : "complete",
      fingerprint_verification: validation.state,
      fingerprint_verification_reason: validation.reason,
    };
  }
  const selectedRows = missingRows.slice(0, MAX_LANCE_WRITES_PER_CYCLE);
  const limitBacklog = Math.max(0, missingRows.length - selectedRows.length);
  let added = 0;
  let operationFailed = 0;
  let writeFailed = 0;
  const addedRows = [];
  const embedText = typeof options.embedText === "function" ? options.embedText : requestEmbedding;
  let canonicalBatch;
  try {
    canonicalBatch = await resolveCanonicalBatch(
      selectedRows.map(row => String(row.id)),
      runtime,
      options,
    );
  } catch (error) {
    return scopedFailure({
      trigger,
      eligible: activeRows.length,
      active: activeRows.length,
      missing: missingRows.length,
      failed: selectedRows.length,
      operationFailed: selectedRows.length,
      limitBacklog,
      fingerprintVerification,
      fingerprintVerificationReason,
      fingerprintConflictCount,
      error,
    });
  }
  if (!canonicalBatch?.ok || !Array.isArray(canonicalBatch.results)) {
    return scopedFailure({
      trigger,
      eligible: activeRows.length,
      active: activeRows.length,
      missing: missingRows.length,
      failed: selectedRows.length,
      operationFailed: selectedRows.length,
      limitBacklog,
      fingerprintVerification,
      fingerprintVerificationReason,
      fingerprintConflictCount,
      error: new Error(`canonical_batch_${canonicalBatch?.reason || "invalid_result"}`),
    });
  }
  const canonicalById = new Map(canonicalBatch.results.map(result => [String(result?.memory_id || ""), result]));

  for (const row of selectedRows) {
    let lanceRow;
    try {
      const memoryId = String(row.id);
      lanceRow = await buildCanonicalLanceRow(canonicalById.get(memoryId), memoryId, {
        embedText,
        sourceRow: row,
        timestamp: typeof options.now === "function" ? options.now() : runtime.now(),
        schemaInfo,
      });
    } catch (error) {
      if (error?.code === "EMBEDDING_FINGERPRINT_CONFLICT") fingerprintConflictCount += 1;
      operationFailed += 1;
      console.warn(`  ↳ Failed to prepare session_flush ${String(row.id).slice(0, 16)}: ${error.message}`);
      continue;
    }
    try {
      await table.add([lanceRow]);
      added += 1;
      addedRows.push(lanceRow);
    } catch (error) {
      writeFailed += 1;
      console.warn(`  ↳ Failed to write session_flush ${String(row.id).slice(0, 16)}: ${error.message}`);
    }
  }

  const failed = operationFailed + writeFailed;
  const backlog = failed + limitBacklog;
  const membershipComplete = backlog === 0;
  const fingerprintState = assessScopedFingerprintValidation({
    schemaInfo,
    activeRows,
    lanceRows,
    addedRows,
    membershipComplete,
    knownConflicts: fingerprintConflictCount,
  });
  fingerprintVerification = fingerprintState.state;
  fingerprintVerificationReason = fingerprintState.reason;
  const completionState = writeFailed > 0
    ? "write_failed"
    : operationFailed > 0
      ? "operation_failed"
      : limitBacklog > 0
        ? "limit_backlog"
        : "complete";
  return {
    ok: membershipComplete && fingerprintState.state !== "conflict",
    trigger,
    lance_eligible: activeRows.length,
    lance_existing: existingRows.length,
    lance_missing_before: missingRows.length,
    lance_added: added,
    lance_failed: failed,
    lance_operation_failed: operationFailed,
    lance_write_failed: writeFailed,
    lance_limit_backlog_remaining: limitBacklog,
    lance_backlog_remaining: backlog,
    lance_converged: membershipComplete,
    lance_membership_complete: membershipComplete,
    lance_membership_state: membershipComplete ? "complete" : completionState,
      lance_skipped_unknown_legacy: skippedUnknownLegacy,
    lance_vector_validation_complete: fingerprintState.state === "verified",
    lance_vector_validation_state: fingerprintState.state,
    lance_fingerprint_conflicts: fingerprintState.conflicts,
    lance_input_state: "present",
    lance_completion_state: completionState,
    fingerprint_verification: fingerprintVerification,
    fingerprint_verification_reason: fingerprintVerificationReason,
  };
}

async function materializeLanceRows(value) {
  const resolved = await value;
  if (Array.isArray(resolved)) return resolved;
  if (resolved && typeof resolved[Symbol.asyncIterator] === "function") {
    const rows = [];
    for await (const page of resolved) rows.push(...(Array.isArray(page) ? page : [page]));
    return rows;
  }
  if (resolved && typeof resolved[Symbol.iterator] === "function") return [...resolved];
  return [];
}

async function enumerateLanceRows(table, {
  pageSize = 400,
  maxRows = 5000,
  offset = 0,
  onPage,
  schemaInfo: suppliedSchemaInfo = null,
} = {}) {
  pageSize = boundedNumber(pageSize, LANCE_QUERY_BATCH_SIZE, 1, LANCE_QUERY_BATCH_SIZE);
  maxRows = boundedNumber(maxRows, MAX_LANCE_SCAN_ROWS, pageSize, MAX_LANCE_SCAN_ROWS);
  const schemaInfo = suppliedSchemaInfo || await readLanceSchemaInfo(table);
  if (schemaInfo?.columns instanceof Set && !schemaInfo.columns.has("id")) {
    throw new Error("LanceDB table schema is missing required id column");
  }
  const selectColumns = selectColumnsForSchema(schemaInfo);
  const rows = [];
  let cursor = Math.max(0, Number(offset) || 0);
  let complete = false;
  let pages = 0;
  while (rows.length < maxRows) {
    let query;
    let pagedQuery = false;
    if (typeof table?.query === "function") {
      query = table.query();
      if (typeof query.select === "function") {
        query = query.select(selectColumns) || query;
      }
      if (typeof query.limit === "function") query = query.limit(Math.min(pageSize, maxRows - rows.length)) || query;
      if (typeof query.offset === "function") {
        query = query.offset(cursor) || query;
        pagedQuery = true;
      }
    } else if (typeof table?.search === "function") {
      // Compatibility with pre-identity test doubles only. Production LanceDB
      // tables use query().select() above; no zero-vector search is used.
      query = table.search([1]);
      if (typeof query.limit === "function") query = query.limit(Math.min(pageSize, maxRows - rows.length)) || query;
    } else {
      throw new Error("LanceDB table does not support bounded enumeration");
    }

    const materializer = typeof query?.toArray === "function"
      ? query.toArray()
      : typeof query?.execute === "function"
        ? query.execute()
        : query;
    const page = await materializeLanceRows(materializer);
    if (page.length === 0) {
      complete = true;
      break;
    }
    const boundedPage = page.slice(0, Math.min(pageSize, maxRows - rows.length));
    rows.push(...boundedPage);
    pages += 1;
    if (typeof onPage === "function") await onPage(boundedPage, {
      offset: cursor,
      nextOffset: cursor + boundedPage.length,
      pages,
    });
    cursor += boundedPage.length;
    if (boundedPage.length < pageSize || (!pagedQuery && page.length < pageSize)) {
      complete = true;
      break;
    }
    if (!pagedQuery && typeof table?.query !== "function") {
      // A legacy search-only test double cannot be safely paged. Its result is
      // still bounded and is used only when the identity schema is absent.
      complete = true;
      break;
    }
  }
  if (rows.length >= maxRows) complete = false;
  return { rows, complete, nextOffset: cursor, pages };
}

function withEngineDb(runtime, options, { readonly = true } = {}, callback) {
  const override = readonly
    ? options.withEngineDbReadonly || options.withEngineDb
    : options.withEngineDbWritable || options.withEngineDb;
  if (typeof override === "function") return override(callback);
  return withEngineDbIsolated(callback, {
    ...runtime.dbOptions,
    readonly,
  });
}

function readStableIdentities(runtime, options) {
  return withEngineDb(runtime, options, { readonly: true }, db => {
    const hasTable = Boolean(db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_identity'",
    ).get());
    if (!hasTable) {
      return {
        hasStableSchema: false,
        rows: [],
        legacyRows: db.prepare("SELECT chunk_id, category FROM memory_confidence WHERE is_archived = 0 LIMIT ?").all(MAX_LANCE_SCAN_ROWS + 1),
        truncated: Number(db.prepare("SELECT COUNT(*) AS c FROM memory_confidence WHERE is_archived = 0").get()?.c || 0) > MAX_LANCE_SCAN_ROWS,
      };
    }
    const rows = readActiveStableIdentities(db, { limit: MAX_LANCE_SCAN_ROWS + 1 });
    return {
      hasStableSchema: true,
      rows: rows.slice(0, MAX_LANCE_SCAN_ROWS),
      truncated: rows.length > MAX_LANCE_SCAN_ROWS,
      aliases: readMigrationAliases(db).slice(0, MAX_LANCE_SCAN_ROWS),
    };
  });
}

function updateStableEmbeddingMetadata(runtime, options, entityId, fingerprint, model = null) {
  withEngineDb(runtime, options, { readonly: false }, db => {
    if (!isStableMemoryIdentityReady(db)) {
      throw new Error("stable memory identity schema is not ready for metadata recovery");
    }
    assertStableMemoryIdentitySchema(db);
    const existing = db.prepare(
      "SELECT embedding_fingerprint FROM memory_identity WHERE entity_id = ?",
    ).get(entityId);
    if (existing?.embedding_fingerprint
      && String(existing.embedding_fingerprint) !== String(fingerprint)) {
      throw new Error(`embedding_fingerprint_conflict: ${entityId}`);
    }
    const identityResult = db.prepare(`
      UPDATE memory_identity
      SET embedding_model = COALESCE(?, embedding_model),
          embedding_fingerprint = ?, updated_at = ?
      WHERE entity_id = ?
    `).run(
      model ? String(model) : null,
      fingerprint,
      typeof options.now === "function" ? Math.floor(Number(options.now()) / 1000) : Math.floor(Date.now() / 1000),
      entityId,
    );
    if (Number(identityResult?.changes || 0) !== 1) {
      throw new Error(`stable identity metadata row not found: ${entityId}`);
    }
    db.prepare(`
      UPDATE memory_confidence
      SET embedding_model = COALESCE(?, embedding_model), embedding_fingerprint = ?
      WHERE entity_id = ?
    `).run(model ? String(model) : null, fingerprint, entityId);
  });
  return { ok: true, fingerprint };
}

function updateStableEmbedding(runtime, options, entityId, vector, model = null) {
  return updateStableEmbeddingMetadata(runtime, options, entityId, embeddingFingerprint(vector), model);
}

function classifyStableRows(lanceRows, identities, {
  aliases = [],
  fingerprintVerification = "verified",
} = {}) {
  const identityById = new Map(identities.map(row => [String(row.entity_id), row]));
  const aliasByLanceId = new Map((aliases || []).map(row => [String(row.lance_id), row]));
  const seenIds = new Set();
  const classes = {
    present_valid: [],
    missing: [],
    unknown_identity: [],
    stale: [],
    fingerprint_unverified: [],
    fingerprint_conflicts: [],
  };
  for (const row of lanceRows) {
    const lanceId = String(typeof row === "object" ? row?.id ?? "" : row ?? "").trim();
    if (!lanceId) continue;
    const alias = aliasByLanceId.get(lanceId);
    const id = String(alias?.entity_id || lanceId);
    seenIds.add(id);
    const identity = identityById.get(id);
    if (!identity) {
      classes.unknown_identity.push({ ...(typeof row === "object" ? row : {}), id: lanceId });
    } else if (identity.state === "active" || identity.state === "recovered") {
      const rowFingerprint = row?.embedding_fingerprint ? String(row.embedding_fingerprint) : null;
      const identityFingerprint = identity.embedding_fingerprint
        ? String(identity.embedding_fingerprint)
        : null;
      const classified = {
        ...(typeof row === "object" ? row : {}),
        id: lanceId,
        entity_id: id,
        identity,
        migration_alias: Boolean(alias),
      };
      if (fingerprintVerification !== "verified") {
        classes.fingerprint_unverified.push(classified);
        classes.present_valid.push(classified);
      } else if (rowFingerprint && identityFingerprint && rowFingerprint !== identityFingerprint) {
        classes.stale.push(classified);
        classes.fingerprint_conflicts.push(classified);
      } else if (!rowFingerprint || !identityFingerprint) {
        classes.fingerprint_unverified.push(classified);
        // A Lance fingerprint can safely recover a missing Engine metadata
        // value, but the row remains stale until that write succeeds.
        if (rowFingerprint && !identityFingerprint && fingerprintVerification === "verified") {
          classes.stale.push(classified);
        } else {
          classes.present_valid.push(classified);
        }
      } else {
        classes.present_valid.push(classified);
      }
    } else {
      classes.stale.push({
        ...(typeof row === "object" ? row : {}),
        id: lanceId,
        entity_id: id,
        identity,
        migration_alias: Boolean(alias),
      });
    }
  }
  for (const identity of identities) {
    if (!seenIds.has(String(identity.entity_id))) classes.missing.push(identity);
  }
  return classes;
}

function fingerprintVerificationResult(classes, schemaInfo) {
  if (classes?.fingerprint_conflicts?.length > 0) {
    return {
      status: "conflict",
      reason: "engine_lance_fingerprint_mismatch",
    };
  }
  if (schemaInfo?.fingerprintVerification !== "verified") {
    return {
      status: "unverified",
      reason: schemaInfo?.fingerprintVerificationReason || "fingerprint_verification_unavailable",
    };
  }
  if (classes?.fingerprint_unverified?.length > 0) {
    return {
      status: "unverified",
      reason: "fingerprint_value_missing",
    };
  }
  return { status: "verified", reason: null };
}

async function repairStableGlobalVectors(runtime, options, table, identities) {
  const pageSize = boundedNumber(options.pageSize, LANCE_QUERY_BATCH_SIZE, 1, LANCE_QUERY_BATCH_SIZE);
  const maxRows = boundedNumber(options.maxRows, MAX_LANCE_SCAN_ROWS, pageSize, MAX_LANCE_SCAN_ROWS);
  const schemaInfo = await readLanceSchemaInfo(table);
  const aliases = options.migrationAliases || [];
  let checkpoint = options.checkpoint || withEngineDb(runtime, options, { readonly: true }, db => readCheckpoint(db));
  const persist = (next) => {
    if (options.persistCheckpoint === false) return next;
    return withEngineDb(runtime, options, { readonly: false }, db => writeCheckpoint(db, next));
  };
  const preflightState = { offset: 0, seenRows: [], seenIds: [] };
  let currentDatasetIdentity = null;
  try {
    const datasetEnumeration = await enumerateLanceRows(table, {
      pageSize,
      maxRows,
      offset: 0,
      schemaInfo,
      onPage: async (page, state) => {
        for (const row of page) {
          const id = String(row?.id ?? "").trim();
          if (!id || preflightState.seenIds.includes(id)) continue;
          preflightState.seenIds.push(id);
          preflightState.seenRows.push({
            id,
            ...(row?.doc_uuid ? { doc_uuid: String(row.doc_uuid) } : {}),
            ...(row?.embedding_fingerprint ? { embedding_fingerprint: String(row.embedding_fingerprint) } : {}),
          });
        }
        preflightState.offset = state.nextOffset;
      },
    });
    currentDatasetIdentity = combinedDatasetIdentity(schemaInfo, identities, datasetEnumeration.rows);
  } catch (error) {
    // The bounded enumeration below is the resumable source of truth. A
    // transient page failure must leave the already-persisted checkpoint
    // usable instead of turning the preflight identity scan into an untracked
    // second migration attempt.
    if (!checkpoint) {
      checkpoint = await persist({
        offset: preflightState.offset,
        pageSize,
        maxRows,
        status: "running",
        seenRows: preflightState.seenRows,
        seenIds: preflightState.seenIds,
        counts: {},
        datasetIdentity: null,
        updatedAt: typeof options.now === "function" ? options.now() : Date.now(),
      });
    }
    return {
      ok: false,
      complete: false,
      completion_state: "failed",
      remaining_backlog: null,
      lance_backlog_remaining: null,
      next_offset: preflightState.offset,
      checkpoint,
      classes: null,
      repaired: 0,
      repair_failed: 0,
      counts: {},
      dataset_changed: false,
      fingerprint_verification: "unverified",
      fingerprint_verification_reason: "query_failed",
      error: error?.message ? String(error.message) : String(error),
    };
  }
  const checkpointMatches = checkpoint
    ? (currentDatasetIdentity === null || checkpoint.datasetIdentity === currentDatasetIdentity)
    : false;
  if (checkpoint && (checkpoint.status === "running" || checkpoint.status === "complete")
    && currentDatasetIdentity !== null && !checkpointMatches) {
    checkpoint = null;
  }
  if (checkpoint?.status === "complete" && checkpointMatches && currentDatasetIdentity !== null) {
    const counts = checkpoint.counts || {};
    return {
      ok: true,
      complete: true,
      completion_state: "complete",
      remaining_backlog: 0,
      lance_backlog_remaining: 0,
      checkpoint,
      classes: null,
      repaired: 0,
      repair_failed: 0,
      counts,
      dataset_changed: false,
      fingerprint_verification: checkpoint.fingerprintVerification || schemaInfo.fingerprintVerification,
      fingerprint_verification_reason: checkpoint.fingerprintVerificationReason
        || schemaInfo.fingerprintVerificationReason
        || null,
    };
  }
  if (!checkpoint || checkpoint.status !== "running" || !checkpointMatches) checkpoint = {
    offset: 0,
    pageSize,
    maxRows,
    status: "running",
    seenRows: [],
    seenIds: [],
    counts: {},
    datasetIdentity: currentDatasetIdentity,
  };
  const seenRows = Array.isArray(checkpoint.seenRows) ? [...checkpoint.seenRows] : [];
  const seenIds = new Set(Array.isArray(checkpoint.seenIds) ? checkpoint.seenIds.map(String) : []);
  const enumeration = await enumerateLanceRows(table, {
    pageSize,
    maxRows,
    offset: checkpoint.offset,
    schemaInfo,
    onPage: async (page, state) => {
      for (const row of page) {
        const id = String(row?.id ?? "").trim();
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        seenRows.push({
          id,
          ...(row?.doc_uuid ? { doc_uuid: String(row.doc_uuid) } : {}),
          ...(row?.embedding_fingerprint ? { embedding_fingerprint: String(row.embedding_fingerprint) } : {}),
        });
      }
      await persist({
        ...checkpoint,
        offset: state.nextOffset,
        pageSize,
        maxRows,
        status: "running",
        seenIds: [...seenIds],
        seenRows,
        counts: checkpoint.counts || {},
        datasetIdentity: currentDatasetIdentity || checkpoint.datasetIdentity || null,
        updatedAt: typeof options.now === "function" ? options.now() : Date.now(),
      });
      checkpoint = {
        ...checkpoint,
        offset: state.nextOffset,
        seenIds: [...seenIds],
        seenRows,
      };
    },
  });
  const afterEnumerationSchema = await readLanceSchemaInfo(table);
  const afterEnumerationRows = await enumerateLanceRows(table, {
    pageSize,
    maxRows,
    offset: 0,
    schemaInfo: afterEnumerationSchema,
  });
  const afterEnumerationDatasetIdentity = combinedDatasetIdentity(
    afterEnumerationSchema,
    identities,
    afterEnumerationRows.rows,
  );
  const expectedDatasetIdentity = currentDatasetIdentity || checkpoint.datasetIdentity || null;
  if (expectedDatasetIdentity && afterEnumerationDatasetIdentity !== expectedDatasetIdentity) {
    const invalidatedCheckpoint = {
      offset: 0,
      pageSize,
      maxRows,
      status: "invalidated",
      seenRows: [],
      seenIds: [],
      counts: {},
      datasetIdentity: afterEnumerationDatasetIdentity,
      updatedAt: typeof options.now === "function" ? options.now() : Date.now(),
    };
    await persist(invalidatedCheckpoint);
    return {
      ok: false,
      complete: false,
      completion_state: "dataset_changed",
      remaining_backlog: null,
      lance_backlog_remaining: null,
      checkpoint: invalidatedCheckpoint,
      classes: null,
      repaired: 0,
      repair_failed: 0,
      counts: {},
      dataset_changed: true,
      fingerprint_verification: schemaInfo.fingerprintVerification,
      fingerprint_verification_reason: schemaInfo.fingerprintVerificationReason || "dataset_changed",
    };
  }
  if (!enumeration.complete) {
    const partialClasses = classifyStableRows(seenRows, identities, {
      aliases,
      fingerprintVerification: schemaInfo?.fingerprintVerification || "unverified",
    });
    const partialFingerprint = fingerprintVerificationResult(partialClasses, schemaInfo);
    return {
      ok: true,
      complete: false,
      completion_state: "in_progress",
      remaining_backlog: null,
      lance_backlog_remaining: null,
      next_offset: enumeration.nextOffset,
      checkpoint: { ...checkpoint, offset: enumeration.nextOffset, seenIds: [...seenIds], datasetIdentity: currentDatasetIdentity },
      classes: partialClasses,
      repaired: 0,
      repair_failed: 0,
      counts: null,
      dataset_changed: false,
      fingerprint_verification: partialFingerprint.status,
      fingerprint_verification_reason: partialFingerprint.reason,
    };
  }

  const classes = classifyStableRows(seenRows, identities, {
    aliases,
    fingerprintVerification: schemaInfo?.fingerprintVerification || "unverified",
  });
  let metadataRecovered = 0;
  let metadataFailed = 0;
  for (const stale of classes.stale) {
    if (!stale.identity?.entity_id || stale.identity.embedding_fingerprint || !stale.embedding_fingerprint) continue;
    try {
      const expectedModel = options.embeddingModel || DEFAULT_EMBEDDING_MODEL;
      if (stale.identity.embedding_model
        && String(stale.identity.embedding_model) !== String(expectedModel)) {
        throw new Error(`embedding model mismatch: expected ${expectedModel}, found ${stale.identity.embedding_model}`);
      }
      updateStableEmbeddingMetadata(
        runtime,
        options,
        stale.identity.entity_id,
        String(stale.embedding_fingerprint),
        expectedModel,
      );
      stale.identity.embedding_model = expectedModel;
      stale.identity.embedding_fingerprint = String(stale.embedding_fingerprint);
      classes.fingerprint_unverified = classes.fingerprint_unverified.filter(row => (
        String(row.entity_id) !== String(stale.identity.entity_id)
      ));
      metadataRecovered += 1;
    } catch (error) {
      metadataFailed += 1;
      console.warn(`  ↳ Failed to recover stable metadata ${String(stale.identity.entity_id).slice(0, 16)}: ${error.message}`);
    }
  }
  const maxWrites = boundedNumber(options.maxWrites, MAX_LANCE_WRITES_PER_CYCLE, 0, MAX_LANCE_WRITES_PER_CYCLE);
  const selected = classes.missing.slice(0, maxWrites);
  let repaired = 0;
  let repairFailed = 0;
  let alreadyPresent = 0;
  const embedText = typeof options.embedText === "function" ? options.embedText : requestEmbedding;
  for (let offset = 0; offset < selected.length; offset += 10) {
    const batch = selected.slice(offset, offset + 10).filter(row => (
      row.core_chunk_id_snapshot || row.chunk_id
    ));
    if (batch.length === 0) continue;
    const currentCoreSnapshotIds = batch.map(row => String(
      row.core_chunk_id_snapshot || row.chunk_id,
    ));
    let canonicalBatch;
    try {
      canonicalBatch = await resolveCanonicalBatch(currentCoreSnapshotIds, runtime, options);
    } catch (error) {
      repairFailed += batch.length;
      console.warn(`  ↳ Failed to resolve canonical stable identity batch: ${error.message}`);
      continue;
    }
    if (!canonicalBatch?.ok || !Array.isArray(canonicalBatch.results)) {
      repairFailed += batch.length;
      console.warn(`  ↳ Failed to resolve canonical stable identity batch: ${canonicalBatch?.reason || "invalid_result"}`);
      continue;
    }
    const canonicalById = new Map(canonicalBatch.results.map(result => [String(result?.memory_id || ""), result]));
    for (const identity of batch) {
      try {
        const memoryId = String(identity.core_chunk_id_snapshot || identity.chunk_id || "");
        if (!memoryId) throw new Error("stable identity has no Core chunk snapshot");
        if (typeof table?.query === "function") {
          const probe = table.query();
          if (typeof probe?.where === "function") {
            const alreadyInLance = await readScopedLanceIds(table, [String(identity.entity_id)]);
            if (alreadyInLance.has(String(identity.entity_id))) {
              alreadyPresent += 1;
              continue;
            }
          }
        }
        const lanceRow = await buildCanonicalLanceRow(canonicalById.get(memoryId), memoryId, {
          embedText,
          sourceRow: identity,
          timestamp: typeof options.now === "function" ? options.now() : Date.now(),
          schemaInfo,
          embeddingModel: options.embeddingModel || DEFAULT_EMBEDDING_MODEL,
          embeddingDimension: options.embeddingDimension || null,
        });
        await table.add([lanceRow]);
        const metadata = updateStableEmbedding(
          runtime,
          options,
          identity.entity_id,
          lanceRow.vector,
          options.embeddingModel || DEFAULT_EMBEDDING_MODEL,
        );
        identity.embedding_model = options.embeddingModel || DEFAULT_EMBEDDING_MODEL;
        identity.embedding_fingerprint = metadata.fingerprint;
        repaired += 1;
      } catch (error) {
        repairFailed += 1;
        console.warn(`  ↳ Failed to repair stable entity ${String(identity.entity_id).slice(0, 16)}: ${error.message}`);
      }
    }
  }

  const finalSchemaInfo = await readLanceSchemaInfo(table);
  const finalDatasetRows = await enumerateLanceRows(table, {
    pageSize,
    maxRows,
    offset: 0,
    schemaInfo: finalSchemaInfo,
  });
  const finalDatasetIdentity = combinedDatasetIdentity(finalSchemaInfo, identities, finalDatasetRows.rows);
  const fingerprintState = fingerprintVerificationResult(classes, finalSchemaInfo);
  const fingerprintConflicts = classes.fingerprint_conflicts.length;
  const remainingBacklog = Math.max(0, classes.missing.length - repaired - alreadyPresent)
    + metadataFailed
    + fingerprintConflicts;
  const complete = repairFailed === 0 && metadataFailed === 0 && fingerprintConflicts === 0 && remainingBacklog === 0;
  const finalCheckpoint = {
    offset: 0,
    pageSize,
    maxRows,
    status: complete ? "complete" : "running",
    seenIds: [...seenIds],
    seenRows,
    counts: {
      present_valid: classes.present_valid.length,
      missing: classes.missing.length,
      unknown_identity: classes.unknown_identity.length,
      stale: classes.stale.length,
    },
    fingerprintVerification: fingerprintState.status,
    fingerprintVerificationReason: fingerprintState.reason,
    datasetIdentity: finalDatasetIdentity,
    updatedAt: typeof options.now === "function" ? options.now() : Date.now(),
  };
  await persist(finalCheckpoint);
  return {
    ok: complete,
    complete,
    completion_state: complete
      ? "complete"
      : fingerprintConflicts > 0
        ? "fingerprint_conflict"
        : (repairFailed > 0 || metadataFailed > 0) ? "partial_failure" : "in_progress",
    remaining_backlog: remainingBacklog,
    lance_backlog_remaining: remainingBacklog,
    next_offset: 0,
    checkpoint: finalCheckpoint,
    classes,
    repaired,
    repair_failed: repairFailed,
    counts: finalCheckpoint.counts,
    already_present: alreadyPresent,
    metadata_recovered: metadataRecovered,
    metadata_failed: metadataFailed,
    dataset_changed: false,
    fingerprint_verification: fingerprintState.status,
    fingerprint_verification_reason: fingerprintState.reason,
    fingerprint_unverified: classes.fingerprint_unverified.length,
    fingerprint_conflicts: fingerprintConflicts,
  };
}

async function repairLegacyGlobalVectors(runtime, options, table) {
  let repaired = 0;
  let repairFailed = 0;
  const sqliteRows = Array.isArray(options.legacyRows)
    ? options.legacyRows
    : withEngineDb(runtime, options, { readonly: true }, engineDb => (
      engineDb.prepare("SELECT chunk_id, category FROM memory_confidence WHERE is_archived = 0").all()
    ));
  const schemaInfo = await readLanceSchemaInfo(table);
  const enumeration = await enumerateLanceRows(table, {
    pageSize: boundedNumber(options.pageSize, LANCE_QUERY_BATCH_SIZE, 1, LANCE_QUERY_BATCH_SIZE),
    maxRows: boundedNumber(options.maxRows, MAX_LANCE_SCAN_ROWS, 1, MAX_LANCE_SCAN_ROWS),
    schemaInfo,
  });
  const lanceIds = new Set(enumeration.rows.map(row => String(row?.id || "")));
  const missing = sqliteRows.filter(row => !lanceIds.has(String(row.chunk_id)));
  if (missing.length === 0) return { repaired: 0, repairFailed: 0, remainingBacklog: 0 };
  const embedText = typeof options.embedText === "function" ? options.embedText : requestEmbedding;
  const selected = missing.slice(0, MAX_PROVIDER_REQUESTS_PER_CYCLE);
  for (let i = 0; i < selected.length; i += 10) {
    const batch = selected.slice(i, i + 10);
    let canonicalBatch;
    try {
      canonicalBatch = await resolveCanonicalBatch(batch.map(row => String(row.chunk_id)), runtime, options);
    } catch (error) {
      repairFailed += batch.length;
      console.warn(`  ↳ Failed to resolve canonical orphan batch: ${error.message}`);
      continue;
    }
    if (!canonicalBatch?.ok || !Array.isArray(canonicalBatch.results)) {
      repairFailed += batch.length;
      continue;
    }
    const canonicalById = new Map(canonicalBatch.results.map(result => [String(result?.memory_id || ""), result]));
    for (const row of batch) {
      try {
        const memoryId = String(row.chunk_id);
        const lanceRow = await buildCanonicalLanceRow(canonicalById.get(memoryId), memoryId, {
          embedText,
          sourceRow: row,
          timestamp: typeof options.now === "function" ? options.now() : runtime.now(),
          schemaInfo,
          embeddingModel: options.embeddingModel || DEFAULT_EMBEDDING_MODEL,
          embeddingDimension: options.embeddingDimension || null,
        });
        await table.add([lanceRow]);
        repaired += 1;
      } catch (error) {
        repairFailed += 1;
        console.warn(`  ↳ Failed to repair ${row.chunk_id.slice(0, 16)}: ${error.message}`);
      }
    }
  }
  return {
    repaired,
    repairFailed,
    remainingBacklog: Math.max(0, missing.length - repaired),
  };
}

async function repairGlobalOrphanVectors(options = {}) {
  if (options.authorization !== "stable-memory-identity-global-maintenance") {
    return globalMaintenanceDisabledResult();
  }
  let stableMode = false;
  try {
    const lancedb = require("@lancedb/lancedb");
    const runtime = getRuntime();
    let ldb;
    let table;
    try {
      ldb = await lancedb.connect(runtime.lancedbDir);
      table = await ldb.openTable("chunks");
    } catch (error) {
      console.warn("[checkpoint] LanceDB scan failed:", error.message);
      return {
        ok: false,
        legacy_failure: true,
        complete: false,
        completion_state: "failed",
        remaining_backlog: null,
        lance_backlog_remaining: null,
        repaired: 0,
        repair_failed: 0,
        error: error?.message ? String(error.message) : String(error),
      };
    }
    const stable = readStableIdentities(runtime, options);
    stableMode = stable.hasStableSchema;
    if (stable.truncated) {
      return {
        ok: false,
        complete: false,
        completion_state: "scan_cap",
        remaining_backlog: null,
        lance_backlog_remaining: null,
        repaired: 0,
        repair_failed: 0,
        dataset_changed: false,
        error: "Engine identity scan exceeds bounded maintenance cap",
      };
    }
    if (!stable.hasStableSchema) {
      const legacy = await repairLegacyGlobalVectors(runtime, { ...options, legacyRows: stable.legacyRows }, table);
      const legacyComplete = legacy.remainingBacklog === 0 && legacy.repairFailed === 0;
      return {
        ok: legacyComplete,
        complete: legacyComplete,
        completion_state: legacyComplete ? "complete" : legacy.repairFailed > 0 ? "partial_failure" : "in_progress",
        remaining_backlog: legacy.remainingBacklog,
        lance_backlog_remaining: legacy.remainingBacklog,
        repaired: legacy.repaired,
        repair_failed: legacy.repairFailed,
        legacy_mode: true,
      };
    }
    const result = await repairStableGlobalVectors(runtime, {
      ...options,
      migrationAliases: stable.aliases,
    }, table, stable.rows);
    return result;
  } catch (error) {
    console.warn("[checkpoint] Orphan repair skipped:", error.message);
    return {
      ok: false,
      ...(stableMode ? {} : { legacy_failure: true }),
      complete: false,
      completion_state: "failed",
      remaining_backlog: null,
      lance_backlog_remaining: null,
      repaired: 0,
      repair_failed: 0,
      error: error?.message ? String(error.message) : String(error),
    };
  }
}

function globalMaintenanceDisabledResult(reason = "authorization_required") {
  return {
    ok: false,
    trigger: GLOBAL_MAINTENANCE_TRIGGER,
    complete: false,
    completion_state: "disabled",
    remaining_backlog: null,
    lance_backlog_remaining: null,
    repaired: 0,
    repair_failed: 0,
    disabled_reason: reason,
  };
}

/**
 * Deliberate global entry point. Ordinary checkpoint/session flush code must
 * use scope=session_flush and never reaches this function. Production
 * execution remains disabled until a separately authorized caller supplies
 * the exact authorization token.
 */
async function runGlobalIdentityMaintenance(options = {}) {
  if (options.authorization !== "stable-memory-identity-global-maintenance") {
    return globalMaintenanceDisabledResult();
  }
  const result = await repairGlobalOrphanVectors({
    ...options,
    trigger: GLOBAL_MAINTENANCE_TRIGGER,
  });
  if (typeof result === "number") {
    return {
      ok: true,
      trigger: GLOBAL_MAINTENANCE_TRIGGER,
      complete: true,
      completion_state: "complete",
      remaining_backlog: 0,
      lance_backlog_remaining: 0,
      repaired: result,
      repair_failed: 0,
    };
  }
  return { trigger: GLOBAL_MAINTENANCE_TRIGGER, ...result };
}

async function repairOrphanVectors(options = {}) {
  if (options && options.scope === "session_flush") {
    return reconcileScopedSessionFlushVectors(options);
  }
  return repairGlobalOrphanVectors(options);
}

module.exports = {
  GLOBAL_MAINTENANCE_TRIGGER,
  MAX_LANCE_WRITES_PER_CYCLE,
  MAX_LANCE_SCAN_ROWS,
  MAX_PROVIDER_REQUESTS_PER_CYCLE,
  stableJson,
  enumerateLanceRows,
  repairGlobalOrphanVectors,
  repairOrphanVectors,
  reconcileScopedSessionFlushVectors,
  runGlobalIdentityMaintenance,
};
