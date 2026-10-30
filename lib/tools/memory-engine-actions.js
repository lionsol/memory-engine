import { safeRelativePath } from "../path-utils.js";
import { getDefaultMemoryEngineConfig } from "../config/defaults.js";
import { getMemoryEngineConfig } from "../config/runtime.js";
import { getCanonicalMemoryById } from "../canonical/read-adapter.js";
import { composeCanonicalMemoryObject } from "../canonical/memory-object.js";
import {
  materializeCanonicalLanceRow,
  projectCanonicalMemoryToVectorProjection,
} from "../canonical/vector-projection.js";
import { normalizeExternalMemory } from "../recall/hybrid/normalize-candidate.js";
import {
  batchReinforce as defaultBatchReinforce,
  calcDecayedBaseConfidence,
} from "../memory-confidence.js";
import { MEMORY_CITE_NOT_AUTHORIZED } from "../recall/cite-authority.js";
import {
  buildHybridSearchRuntime,
  normalizeHybridRuntimeContext,
  recordHybridRuntimeObservation,
} from "../recall/hybrid/runtime-context.js";
import {
  MEMORY_EXPLICIT_RERANK_CONFIG_INVALID,
  normalizeExplicitSearchRerankPolicy,
} from "../recall/hybrid/explicit-search-rerank-profile.js";
import {
  applyKgBridge,
  archiveLowConfidence,
  detectRelatedConflictsIsolated,
} from "../lifecycle/operations.js";
import {
  INVALID_TOP_K,
  validateTopK,
} from "../recall/top-k-policy.js";
import lanceMembership from "../checkpoint/lance-membership.cjs";
import derivedSummary from "../checkpoint/derived-summary.js";
import {
  buildLiteralPrefixGlob,
  resolveExactOrUniquePrefixRows,
} from "../id-prefix-resolution.js";
import { validateRecallHintV1 } from "../recall/hint/recall-hint-v1.js";
import { buildRecallHintVectorQueryPlan } from "../recall/hint/recall-hint-query-plan.js";
import {
  evaluateRecallHintRuntimeCanaryV1,
  sanitizeRecallHintRuntimeContextV1,
} from "../recall/hint/recall-hint-runtime-canary-v1.js";
import { resolveRhL3RuntimeProbeV1 } from "../recall/hint/rh-l3-runtime-probe-v1.js";
import { RECALL_HINT_RUNTIME_PROVIDER_RESULT_SCHEMA_V1 } from "../recall/hint/recall-hint-provider-contract-v1.js";
import {
  assignStableMemoryIdentity,
  embeddingFingerprint,
  isStableMemoryIdentityReady,
  validateEmbeddingVector,
} from "../db/stable-memory-identity.cjs";

const { readScopedLanceIds } = lanceMembership;
const MAX_VECTOR_ERRORS = 20;
const RECALL_HINT_PROVIDER_TIMEOUT_MS = 100;

async function readVectorDimension(table) {
  if (typeof table?.schema !== "function") return null;
  const schema = await table.schema();
  const field = (schema?.fields || []).find(item => String(item?.name || "") === "vector");
  const candidate = field?.type?.listSize ?? field?.type?.list_size ?? null;
  return Number.isInteger(Number(candidate)) && Number(candidate) > 0 ? Number(candidate) : null;
}

async function readLanceFingerprintSchema(table) {
  if (!table) {
    return {
      status: "unverified",
      reason: "lancedb_unavailable",
      hasColumn: false,
    };
  }
  if (typeof table.schema !== "function") {
    return {
      status: "unverified",
      reason: "schema_unavailable",
      hasColumn: false,
    };
  }
  try {
    const schema = await table.schema();
    const hasColumn = (schema?.fields || []).some(field => (
      String(field?.name || "") === "embedding_fingerprint"
    ));
    return {
      status: hasColumn ? "verified" : "unverified",
      reason: hasColumn ? null : "fingerprint_column_missing",
      hasColumn,
    };
  } catch (error) {
    return {
      status: "unverified",
      reason: "schema_query_failed",
      hasColumn: false,
      error,
    };
  }
}

async function readLanceEmbeddingFingerprint(table, id) {
  try {
    if (typeof table?.query !== "function") {
      return { status: "unverified", reason: "fingerprint_query_unavailable" };
    }
    let query = table.query();
    if (typeof query?.where !== "function") {
      return { status: "unverified", reason: "fingerprint_query_unavailable" };
    }
    query = query.where(`id = '${String(id).replace(/'/g, "''")}'`) || query;
    if (typeof query.select === "function") {
      query = query.select(["id", "embedding_fingerprint"]) || query;
    }
    if (typeof query.limit === "function") query = query.limit(1) || query;
    const rows = typeof query.toArray === "function"
      ? await query.toArray()
      : typeof query.execute === "function"
        ? await query.execute()
        : [];
    const fingerprint = rows?.[0]?.embedding_fingerprint;
    if (!fingerprint) {
      return { status: "unverified", reason: "fingerprint_value_missing" };
    }
    return { status: "verified", reason: null, fingerprint: String(fingerprint) };
  } catch (error) {
    return { status: "unverified", reason: "fingerprint_query_failed", error };
  }
}

function createAddPropagationCounters(chunksAdded = 0) {
  const pending = Math.max(0, Number(chunksAdded) || 0);
  return {
    engine_existing: 0,
    engine_written: 0,
    engine_ready: 0,
    engine_pending: pending,
    lance_existing: 0,
    lance_written: 0,
    lance_ready: 0,
    lance_pending: pending,
    vector_errors: [],
    vector_error: null,
  };
}

function boundedVectorError(error, fallback = "vector_propagation_failed") {
  const message = String(error?.message || error || "").trim().replace(/\s+/g, " ");
  if (message === "lancedb_unavailable" || message === "vector offline") return message;
  if (message === "embedding_fingerprint_conflict") return message;
  if (/^canonical_lookup_[a-z0-9_-]+$/.test(message)) return message.slice(0, 120);
  if (/^[A-Z][A-Z0-9_:-]{1,79}$/.test(message)) return message;
  return fallback;
}

function createResolverErrorProvider(message = "recent_canary_context_error") {
  return function recentCanaryResolverErrorProvider() {
    throw new Error(message);
  };
}

function sanitizeResolvedRecentCanaryContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.source !== "openclaw_runtime") return null;
  return {
    source: "openclaw_runtime",
    agentIdentity: value.agentIdentity ?? null,
    sessionIdentity: value.sessionIdentity ?? null,
    requestIdentity: value.requestIdentity ?? null,
    chatType: value.chatType ?? null,
  };
}

function resolveInjectedRecentCanaryContext({
  trustedRuntimeContext = null,
  recentCanaryProvider = null,
  resolveRecentCanaryContext = null,
} = {}) {
  if (typeof resolveRecentCanaryContext !== "function") {
    return {
      recentCanaryContext: null,
      recentCanaryProvider,
    };
  }

  try {
    const resolved = resolveRecentCanaryContext({
      trustedRuntimeContext,
    });
    return {
      recentCanaryContext: sanitizeResolvedRecentCanaryContext(resolved),
      recentCanaryProvider,
    };
  } catch {
    return {
      recentCanaryContext: null,
      recentCanaryProvider: createResolverErrorProvider(),
    };
  }
}

function readCoreChunkRowsForPath(runCoreDb, fileRel) {
  const rows = runCoreDb(db => {
    const idRows = db.prepare(
      "SELECT id FROM chunks WHERE path = ? ORDER BY id ASC"
    ).all(fileRel);
    if (!Array.isArray(idRows)) throw new Error("core_chunk_rows_malformed");
    let textById = null;
    try {
      const textRows = idRows.map(row => db.prepare(
        "SELECT text FROM chunks WHERE id = ?"
      ).get(row.id));
      textById = new Map(textRows.map((row, index) => [String(idRows[index].id), row?.text ?? null]));
    } catch {
      // Older read-only test doubles and historical Core snapshots may expose
      // only ids.  Stable identity assignment then remains safe but leaves
      // content_hash unset until a trusted content-bearing reconciliation.
      textById = new Map();
    }
    return idRows.map(row => ({ ...row, text: textById.get(String(row.id)) ?? null }));
  });
  return rows.map((row, index) => {
    if (!row || row.id == null) throw new Error(`core_chunk_id_missing_at_${index}`);
    return {
      id: String(row.id),
      text: row.text == null ? null : String(row.text),
    };
  });
}

function readCoreChunkIdsForPath(runCoreDb, fileRel) {
  return readCoreChunkRowsForPath(runCoreDb, fileRel).map(row => row.id);
}

export function createMemoryEngineExecute(runtime) {
  const actionRuntime = runtime?.action || runtime || {};
  const hybridRuntime = normalizeHybridRuntimeContext(runtime?.hybrid || runtime);
  const { dataAccess, retrievalPolicy, telemetry } = hybridRuntime;
  const {
    autoRouteCategory,
    dateStrInTimeZone,
    SMART_ADD_TIME_ZONE = actionRuntime.smartAddTimeZone,
    resolve,
    WORKSPACE = actionRuntime.workspaceDir,
    SMART_ADD_DIR = actionRuntime.smartAddDir,
    buildSmartAddFingerprint,
    appendSmartAdd,
    syncIndexIfNeeded = retrievalPolicy.syncIndexIfNeeded,
    catParams,
    withDb = dataAccess.withDb,
    withCoreDb,
    withEngineDb,
    withEngineDbReadonly,
    getLancedbTable = dataAccess.getLancedbTable,
    generateEmbedding = retrievalPolicy.generateEmbedding,
    getCanonicalMemoryById: resolveCanonicalMemory = getCanonicalMemoryById,
    projectCanonicalMemoryToVectorProjection: projectVector = projectCanonicalMemoryToVectorProjection,
    materializeCanonicalLanceRow: materializeLanceRow = materializeCanonicalLanceRow,
    now: nowProvider = () => Date.now(),
    recordMemoryEvent = telemetry.recordMemoryEvent,
    calcRealtimeConf = retrievalPolicy.calcRealtimeConf,
    existsSync,
    readFileSync,
    KG_PATH = actionRuntime.kgPath,
    batchReinforce = defaultBatchReinforce,
    authorizeMemoryEngineCite,
    CATEGORY_MAP = retrievalPolicy.categoryMap,
    calcTau,
  } = actionRuntime;
  const runCoreDb = withCoreDb || dataAccess.withCoreDb || withDb;
  const runEngineDb = withEngineDb || dataAccess.withEngineDb || withDb;
  const runEngineDbReadonly = withEngineDbReadonly || dataAccess.withEngineDbReadonly;
  const apiConfig = actionRuntime.apiConfig
    ?? actionRuntime.api?.config
    ?? retrievalPolicy.apiConfig
    ?? null;
  const runMemoryEngineSearch = createSearchRunner(hybridRuntime);

  return async function executeMemoryEngineAction(_toolCallId, params) {
        const {
          action,
          text,
          category,
          protected: isProtected,
          chunk_id,
          chunk_ids,
          hit,
          top_k,
        } = params;
        const nowMs = Number(nowProvider());
        const nowSec = Math.floor((Number.isFinite(nowMs) ? nowMs : Date.now()) / 1000);

        try {
          if (action === "search" && !validateTopK(top_k).valid) {
            return { error: INVALID_TOP_K, code: INVALID_TOP_K };
          }
          let citeAuthorization = null;
          let authorizedCiteIds = null;
          if (action === "cite") {
            if (!Array.isArray(chunk_ids) || chunk_ids.length === 0) {
              return { error: "chunk_ids array required" };
            }
            citeAuthorization = typeof authorizeMemoryEngineCite === "function"
              ? authorizeMemoryEngineCite(_toolCallId, chunk_ids)
              : null;
            if (
              citeAuthorization?.authorized !== true ||
              !Array.isArray(citeAuthorization.resolved_ids) ||
              citeAuthorization.resolved_ids.length === 0 ||
              citeAuthorization.resolved_ids.some(id => typeof id !== "string" || !id.trim())
            ) {
              return {
                error: citeAuthorization?.code || citeAuthorization?.error || MEMORY_CITE_NOT_AUTHORIZED,
                code: citeAuthorization?.code || citeAuthorization?.error || MEMORY_CITE_NOT_AUTHORIZED,
              };
            }
            authorizedCiteIds = [...new Set(citeAuthorization.resolved_ids.map(id => id.trim()))];
          }
          if (action === "search") {
            const result = await runMemoryEngineSearch(
              { text, top_k },
              { toolCallId: _toolCallId, action: "memory_engine.search" },
            );
            return projectMemoryEngineSearchToolResult(result);
          }
          if (action === "add") {
            if (!text) return { error: "text required for add" };
            // ── Auto-route category via rule engine ──
            const cat = autoRouteCategory(text, { category });
            const now = new Date();
            const dateStr = dateStrInTimeZone(0, SMART_ADD_TIME_ZONE, now);
            const ts = now.toISOString().replace(/[:.]/g, "").slice(0, 15);
            const entryId = `${ts}_${cat}`;
            const fileDir = resolve(WORKSPACE, SMART_ADD_DIR);
            const filePath = resolve(fileDir, `${dateStr}.md`);
            let fileRel;
            let beforeIds;
            try {
              fileRel = safeRelativePath(WORKSPACE, filePath);
              if (!fileRel) {
                throw new Error(`failed to derive workspace-relative path for ${filePath}`);
              }
              beforeIds = new Set(readCoreChunkIdsForPath(runCoreDb, fileRel));
            } catch (error) {
              return {
                success: false,
                error: "core_pre_snapshot_failed",
                category: cat,
                canonical_written: false,
                derived_state: "failed",
                needs_reconcile: false,
                ...createAddPropagationCounters(0),
                derived_error: String(error?.message || error),
              };
            }
            const fingerprint = buildSmartAddFingerprint(text, cat, isProtected);
            let appendResult;
            try {
              appendResult = await appendSmartAdd({
                fileDir,
                filePath,
                entryId,
                category: cat,
                isProtected,
                text,
                fingerprint,
                syncCli: true,
                syncRunner: () => syncIndexIfNeeded("memory_engine.add"),
              });
            } catch (error) {
              return {
                success: false,
                error: "source_persistence_failed",
                category: cat,
                canonical_written: false,
                derived_state: "failed",
                needs_reconcile: false,
                ...createAddPropagationCounters(0),
                derived_error: String(error?.message || error),
              };
            }
            if (!appendResult.appended) {
              return {
                success: true,
                deduped: true,
                reason: appendResult.reason,
                category: cat,
              };
            }

            const { conf, tau } = catParams(cat, isProtected);
            const sync = appendResult.sync || null;
            const syncFailed = Boolean(sync && (sync.ok === false || sync.error));
            if (syncFailed) {
              return {
                success: true,
                canonical_written: true,
                chunks_added: 0,
                category: cat,
                confidence: conf,
                tau,
                derived_state: "pending",
                needs_reconcile: true,
                reconcile_reason: "sync_failed",
                ...createAddPropagationCounters(0),
                sync,
              };
            }

            let afterRows;
            try {
              afterRows = readCoreChunkRowsForPath(runCoreDb, fileRel);
            } catch (error) {
              return {
                success: true,
                canonical_written: true,
                chunks_added: 0,
                category: cat,
                confidence: conf,
                tau,
                derived_state: "pending",
                needs_reconcile: true,
                reconcile_reason: "index_observation_failed",
                ...createAddPropagationCounters(0),
                derived_error: String(error?.message || error),
                sync,
              };
            }

            const newCoreRows = afterRows.filter(row => !beforeIds.has(String(row.id)));
            if (newCoreRows.length === 0) {
              return {
                success: true,
                canonical_written: true,
                chunks_added: 0,
                category: cat,
                confidence: conf,
                tau,
                derived_state: "pending",
                needs_reconcile: true,
                reconcile_reason: "index_not_observed",
                ...createAddPropagationCounters(0),
                sync,
              };
            }

            const engineCounters = createAddPropagationCounters(newCoreRows.length);
            const stableIdentityByCoreId = new Map();
            let stableIdentityState = "unmigrated";
            let engineTransactionSucceeded = false;
            try {
              runEngineDb(db => {
                const exists = db.prepare("SELECT 1 FROM memory_confidence WHERE chunk_id = ? LIMIT 1");
                const engineRowsToInsert = [];
                for (const row of newCoreRows) {
                  if (exists.get(row.id)) engineCounters.engine_existing += 1;
                  else engineRowsToInsert.push(row);
                }
                const stableIdentitySupported = isStableMemoryIdentityReady(db);
                stableIdentityState = stableIdentitySupported ? "migrated" : "unmigrated";
                if (stableIdentitySupported) {
                  const txn = db.transaction(() => {
                    for (const row of newCoreRows) {
                      const assignment = assignStableMemoryIdentity(db, {
                        skipSchema: true,
                        chunkId: row.id,
                        path: fileRel,
                        source: "core",
                        text: row.text,
                        initialConfidence: conf,
                        confidence: conf,
                        lastConfidenceUpdate: nowSec,
                        baseTau: tau,
                        category: cat,
                        embeddingModel: actionRuntime.embeddingModel || "Qwen/Qwen3-Embedding-4B",
                        operation: "create",
                      });
                      stableIdentityByCoreId.set(String(row.id), assignment.entity);
                    }
                  });
                  txn();
                } else if (engineRowsToInsert.length > 0) {
                  const insert = db.prepare([
                    "INSERT INTO memory_confidence",
                    "(chunk_id, initial_confidence, confidence, last_confidence_update,",
                    "base_tau, hit_count, is_archived, is_protected, conflict_flag, category)",
                    "VALUES (?, ?, ?, ?, ?, 0, 0, ?, 0, ?)"
                  ].join(" "));
                  const txn = db.transaction(() => {
                    for (const row of engineRowsToInsert) {
                      insert.run(row.id, conf, conf, nowSec, tau, isProtected ? 1 : 0, cat);
                    }
                  });
                  txn();
                }
              });
              engineCounters.engine_written = newCoreRows.length - engineCounters.engine_existing;
              engineCounters.engine_ready = newCoreRows.length;
              engineCounters.engine_pending = 0;
              engineTransactionSucceeded = true;
            } catch (error) {
              console.warn("[memory-engine] canonical add persisted but Engine metadata write failed:", error.message);
              return {
                success: true,
                canonical_written: true,
                chunks_added: newCoreRows.length,
                category: cat,
                confidence: conf,
                tau,
                derived_state: "partial",
                needs_reconcile: true,
                reconcile_reason: "engine_write_failed",
                derived_error: error.message,
                stable_identity_state: stableIdentityState,
                ...engineCounters,
                sync,
              };
            }

            const vectorState = new Map();
            const vectorErrors = [];
            const addVectorError = (row, lanceState, error, fallback) => {
              const reason = boundedVectorError(error, fallback);
              const id = String(row.id);
              vectorState.set(id, {
                lance_state: lanceState,
                lance_written: 0,
                vector_error: reason,
              });
              if (vectorErrors.length < MAX_VECTOR_ERRORS) {
                vectorErrors.push({ id: id.slice(0, 16), reason });
              }
            };

            const addLancedbTable = getLancedbTable();
            let expectedEmbeddingDimension = Number(actionRuntime.embeddingDimension);
            if (!Number.isInteger(expectedEmbeddingDimension) || expectedEmbeddingDimension <= 0) {
              expectedEmbeddingDimension = null;
              try {
                expectedEmbeddingDimension = await readVectorDimension(addLancedbTable);
              } catch {
                expectedEmbeddingDimension = null;
              }
            }
            const fingerprintSchema = await readLanceFingerprintSchema(addLancedbTable);
            let fingerprintVerification = fingerprintSchema.status;
            let fingerprintVerificationReason = fingerprintSchema.reason;
            let existingLanceIds = new Set();
            let lanceMembershipReady = false;
            if (!addLancedbTable) {
              for (const row of newCoreRows) {
                addVectorError(row, "pending", "lancedb_unavailable", "lancedb_unavailable");
              }
            } else if (fingerprintSchema.status !== "verified") {
              for (const row of newCoreRows) {
                addVectorError(
                  row,
                  "pending",
                  fingerprintSchema.reason,
                  "embedding_metadata_unverified",
                );
              }
            } else {
              try {
                const lanceIdsByCoreId = newCoreRows.map(row => (
                  stableIdentityByCoreId.get(String(row.id))?.entity_id || String(row.id)
                ));
                existingLanceIds = await readScopedLanceIds(
                  addLancedbTable,
                  lanceIdsByCoreId,
                );
                lanceMembershipReady = true;
              } catch (error) {
                for (const row of newCoreRows) {
                  addVectorError(row, "pending", error, "lance_membership_unavailable");
                }
              }

              for (const row of lanceMembershipReady ? newCoreRows : []) {
                const stableIdentity = stableIdentityByCoreId.get(String(row.id)) || null;
                const coreId = String(row.id);
                const exactId = stableIdentity?.entity_id || coreId;
                if (existingLanceIds.has(exactId)) {
                  let metadataReady = true;
                  let metadataState = "existing";
                  let metadataError = null;
                  if (stableIdentity && typeof runEngineDb === "function") {
                    const expectedModel = actionRuntime.embeddingModel || "Qwen/Qwen3-Embedding-4B";
                    if (stableIdentity.embedding_model
                      && String(stableIdentity.embedding_model) !== String(expectedModel)) {
                      metadataReady = false;
                      metadataError = "embedding_model_mismatch";
                    } else try {
                      const fingerprintResult = await readLanceEmbeddingFingerprint(addLancedbTable, exactId);
                      if (fingerprintResult.status === "verified") {
                        const existingFingerprint = fingerprintResult.fingerprint;
                        if (stableIdentity.embedding_fingerprint
                          && String(stableIdentity.embedding_fingerprint) !== String(existingFingerprint)) {
                          fingerprintVerification = "conflict";
                          fingerprintVerificationReason = "embedding_fingerprint_conflict";
                          throw new Error("embedding_fingerprint_conflict");
                        }
                        runEngineDb(db => {
                          db.prepare(`
                            UPDATE memory_identity
                            SET embedding_model = COALESCE(?, embedding_model),
                                embedding_fingerprint = ?, updated_at = ?
                            WHERE entity_id = ?
                          `).run(
                            expectedModel,
                            existingFingerprint,
                            nowSec,
                            stableIdentity.entity_id,
                          );
                          db.prepare(`
                            UPDATE memory_confidence
                            SET embedding_model = COALESCE(?, embedding_model), embedding_fingerprint = ?
                            WHERE entity_id = ?
                          `).run(
                            expectedModel,
                            existingFingerprint,
                            stableIdentity.entity_id,
                          );
                        });
                      } else {
                        metadataReady = false;
                        fingerprintVerification = "unverified";
                        fingerprintVerificationReason = fingerprintResult.reason;
                        metadataState = "existing_unverified";
                        metadataError = fingerprintResult.reason;
                      }
                    } catch (error) {
                      metadataReady = false;
                      metadataError = boundedVectorError(error, "embedding_metadata_unverified");
                    }
                  }
                  vectorState.set(coreId, {
                    lance_state: metadataReady ? metadataState : "pending",
                    lance_written: 0,
                    vector_error: metadataReady
                      ? (metadataState === "existing_unverified" ? "embedding_metadata_unverified" : null)
                      : (metadataError || "engine_identity_metadata_pending"),
                  });
                  continue;
                }

                try {
                  const canonicalResult = await resolveCanonicalMemory(coreId, {
                    withCoreDb: runCoreDb,
                    withEngineDb: runEngineDbReadonly,
                  });
                  if (!canonicalResult?.ok || !canonicalResult.memory) {
                    throw new Error(`canonical_lookup_${canonicalResult?.reason || "invalid_result"}`);
                  }
                  if (canonicalResult.memory.memory_id !== coreId) {
                    throw new Error("canonical_lookup_memory_id_mismatch");
                  }

                  const projection = projectVector(canonicalResult.memory);
                  const vec = await generateEmbedding(projection.embedding_input);
                  const embeddingValidation = validateEmbeddingVector(vec, {
                    expectedDimension: expectedEmbeddingDimension,
                  });
                  if (!embeddingValidation.ok) {
                    throw new Error(`invalid embedding for LanceDB write: ${embeddingValidation.reason}`);
                  }
                  const vectorFingerprint = embeddingFingerprint(vec);
                  if (stableIdentity?.embedding_fingerprint
                    && String(stableIdentity.embedding_fingerprint) !== String(vectorFingerprint)) {
                    throw new Error("embedding_fingerprint_conflict");
                  }
                  const lanceRow = materializeLanceRow(projection, {
                    vector: vec,
                    timestamp: nowProvider(),
                    ...(stableIdentity ? {
                      entityId: stableIdentity.entity_id,
                      docUuid: stableIdentity.doc_uuid,
                      embeddingFingerprint: vectorFingerprint,
                    } : {}),
                  });
                  if (String(lanceRow?.id) !== exactId) {
                    throw new Error("lance_row_id_mismatch");
                  }
                  await addLancedbTable.add([lanceRow]);
                  if (stableIdentity && typeof runEngineDb === "function") {
                    runEngineDb(db => {
                      db.prepare(`
                        UPDATE memory_identity
                        SET embedding_model = COALESCE(?, embedding_model),
                            embedding_fingerprint = ?, updated_at = ?
                        WHERE entity_id = ?
                      `).run(
                        actionRuntime.embeddingModel || "Qwen/Qwen3-Embedding-4B",
                        vectorFingerprint,
                        nowSec,
                        stableIdentity.entity_id,
                      );
                      db.prepare(`
                        UPDATE memory_confidence
                        SET embedding_model = COALESCE(?, embedding_model), embedding_fingerprint = ?
                        WHERE entity_id = ?
                      `).run(
                        actionRuntime.embeddingModel || "Qwen/Qwen3-Embedding-4B",
                        vectorFingerprint,
                        stableIdentity.entity_id,
                      );
                    });
                  }
                  vectorState.set(coreId, {
                    lance_state: "written",
                    lance_written: 1,
                    vector_error: null,
                  });
                } catch (error) {
                  if (String(error?.message || error) === "embedding_fingerprint_conflict") {
                    fingerprintVerification = "conflict";
                    fingerprintVerificationReason = "embedding_fingerprint_conflict";
                  }
                  addVectorError(row, "failed", error);
                  console.warn(
                    `[memory-engine] canonical add persisted but LanceDB write failed for ${exactId.slice(0, 16)}: ${boundedVectorError(error)}`,
                  );
                }
              }
            }

            const lanceExisting = [...vectorState.values()]
              .filter(state => state.lance_state === "existing").length;
            const lanceExistingUnverified = [...vectorState.values()]
              .filter(state => state.lance_state === "existing_unverified").length;
            const lanceWritten = [...vectorState.values()]
              .filter(state => state.lance_state === "written").length;
            const lanceReady = lanceExisting + lanceExistingUnverified + lanceWritten;
            const lancePending = newCoreRows.length - lanceReady;
            const allReady = engineTransactionSucceeded
              && engineCounters.engine_ready === newCoreRows.length
              && lanceReady === newCoreRows.length;
            const fullyReady = allReady && lanceExistingUnverified === 0;
            const derivedState = fullyReady ? "committed" : "partial";
            const needsReconcile = !fullyReady;
            const reconcileReason = fullyReady
              ? null
              : engineCounters.engine_ready < newCoreRows.length
                ? "engine_write_failed"
                : fingerprintVerification === "conflict"
                  ? "embedding_fingerprint_conflict"
                  : addLancedbTable && fingerprintVerification === "unverified"
                    ? "embedding_metadata_unverified"
                : lanceExistingUnverified > 0
                  ? "embedding_metadata_unverified"
                  : "vector_pending";

            for (const row of newCoreRows) {
              const state = vectorState.get(String(row.id)) || {
                lance_state: "pending",
                lance_written: 0,
                vector_error: "vector_propagation_failed",
              };
              recordMemoryEvent({
                event_type: "memory_created",
                memory_id: stableIdentityByCoreId.get(String(row.id))?.entity_id || row.id,
                source: "memory_engine.add",
                metadata_json: {
                  category: cat,
                  confidence: conf,
                  tau,
                  engine_ready: true,
                  lance_state: state.lance_state,
                  lance_written: state.lance_written,
                  derived_state: derivedState,
                  needs_reconcile: needsReconcile,
                  vector_error: state.vector_error,
                },
              });
            }
            return {
              success: true,
              canonical_written: true,
              chunks_added: newCoreRows.length,
              category: cat,
              confidence: conf,
              tau,
              engine_existing: engineCounters.engine_existing,
              engine_written: engineCounters.engine_written,
              engine_ready: engineCounters.engine_ready,
              engine_pending: engineCounters.engine_pending,
              lance_existing: lanceExisting,
              lance_existing_unverified: lanceExistingUnverified,
              lance_written: lanceWritten,
              lance_ready: lanceReady,
              lance_pending: lancePending,
              derived_state: derivedState,
              needs_reconcile: needsReconcile,
              reconcile_reason: reconcileReason,
              stable_identity_state: stableIdentityState,
              fingerprint_verification: fingerprintVerification,
              fingerprint_verification_reason: fingerprintVerificationReason,
              vector_errors: vectorErrors,
              vector_error: vectorErrors[0]?.reason || null,
              sync,
            };
          }

          if (action === "cite") {
            return runEngineDb(db => {
              const fullIds = authorizedCiteIds;
              const reinforcedIds = [];
              const count = batchReinforce(db, fullIds, nowSec, {
                onReinforced: id => reinforcedIds.push(id),
              });
              const eventIds = reinforcedIds.length > 0
                ? [...new Set(reinforcedIds)]
                : count === fullIds.length
                  ? fullIds
                  : [];
              for (const id of eventIds) {
                recordMemoryEvent({ event_type: "memory_cited", memory_id: id, cited_count: 1, source: "memory_engine.cite" });
                recordMemoryEvent({ event_type: "memory_reinforced", memory_id: id, source: "memory_engine.cite" });
              }
              return {
                success: true,
                reinforced: count,
                ids: eventIds.map(id => id.slice(0, 16)),
              };
            });
          }

          if (action === "update") {
            const lookupId = typeof chunk_id === "string" ? chunk_id.trim() : "";
            if (!lookupId) return { error: "chunk_id required" };
            return runEngineDb(db => {
              const exact = db.prepare([
                "SELECT chunk_id FROM memory_confidence",
                "WHERE chunk_id = ? AND COALESCE(is_archived, 0) = 0",
                "LIMIT 1",
              ].join(" ")).all(lookupId)
                .find(row => String(row?.chunk_id ?? "") === lookupId);
              const matches = exact
                ? [exact]
                : db.prepare([
                  "SELECT chunk_id FROM memory_confidence",
                  "WHERE chunk_id GLOB ? AND COALESCE(is_archived, 0) = 0",
                  "ORDER BY chunk_id ASC",
                  "LIMIT 2",
                ].join(" ")).all(buildLiteralPrefixGlob(lookupId));
              const resolution = resolveExactOrUniquePrefixRows(matches, lookupId, "chunk_id");
              if (resolution.status === "not_found" || resolution.status === "invalid") {
                return { error: "no match" };
              }
              if (resolution.status === "ambiguous") {
                return {
                  error: "multiple matches",
                  matches: resolution.matches.map(row => String(row.chunk_id).slice(0, 16)),
                };
              }
              const fullId = String(resolution.row.chunk_id);
              const current = db.prepare([
                "SELECT chunk_id, initial_confidence, confidence, last_confidence_update,",
                "base_tau, hit_count, is_archived, is_protected, conflict_flag, category",
                "FROM memory_confidence",
                "WHERE chunk_id = ?",
                "LIMIT 1",
              ].join(" ")).get(fullId);
              if (!current) return { error: "no match" };

              const sets = [];
              const vals = [];
              const categoryRule = category ? CATEGORY_MAP[category] : null;
              const hasMutation = Boolean(categoryRule) || Boolean(hit) || isProtected !== undefined;
              if (!hasMutation) return { success: true, chunk_id: fullId.slice(0, 16) };

              const settledConfidence = Number(calcDecayedBaseConfidence(current, nowSec));
              sets.push("confidence = ?", "last_confidence_update = ?");
              vals.push(
                Number.isFinite(settledConfidence) ? settledConfidence : Number(current.confidence || 0),
                nowSec,
              );
              if (categoryRule) {
                sets.push("category = ?", "base_tau = ?");
                vals.push(category, categoryRule.tau);
              }
              if (hit) sets.push("hit_count = hit_count + 1");
              if (isProtected !== undefined) {
                sets.push("is_protected = ?");
                vals.push(isProtected ? 1 : 0);
              }
              vals.push(fullId);
              const updateResult = db.prepare(
                `UPDATE memory_confidence SET ${sets.join(", ")} WHERE chunk_id = ? AND COALESCE(is_archived, 0) = 0`,
              ).run(...vals);
              if (Number(updateResult?.changes || 0) !== 1) {
                return { error: "no match" };
              }
              return { success: true, chunk_id: fullId.slice(0, 16) };
            });
          }

          if (action === "status") {
            const coreIds = runCoreDb(db => db.prepare("SELECT id FROM chunks").all().map(row => String(row.id)));
            return runEngineDb(db => {
              const c = db.prepare([
                "SELECT COUNT(*) as total, SUM(is_archived) as archived,",
                "SUM(is_protected) as protected, SUM(conflict_flag) as conflicted,",
                "ROUND(AVG(confidence), 4) as avg_conf, ROUND(AVG(base_tau), 2) as avg_tau,",
                "ROUND(AVG(hit_count), 2) as avg_hits FROM memory_confidence"
              ].join(" ")).get();
              const cat = db.prepare("SELECT category, COUNT(*) as count FROM memory_confidence GROUP BY category ORDER BY count DESC").all();
              const trackedIds = new Set(db.prepare("SELECT chunk_id FROM memory_confidence").all().map(row => String(row.chunk_id)));
              const missingCount = coreIds.reduce((count, id) => count + (trackedIds.has(id) ? 0 : 1), 0);
              return {
                chunks_total: coreIds.length, confidence_tracked: c.total || 0,
                archived: c.archived || 0, protected: c.protected || 0,
                conflicted: c.conflicted || 0, avg_confidence: c.avg_conf || 0,
                avg_tau: c.avg_tau || 0, avg_hits: c.avg_hits || 0,
                chunks_missing_confidence: missingCount, by_category: cat,
              };
            });
          }

          if (action === "archive") {
            const memoryEngineConfig = getMemoryEngineConfig(apiConfig);
            const configuredThreshold = Number(memoryEngineConfig?.archive?.threshold);
            const threshold = Number.isFinite(configuredThreshold)
              ? configuredThreshold
              : Number(getDefaultMemoryEngineConfig()?.archive?.threshold);
            return runEngineDb(db => archiveLowConfidence(db, {
              threshold,
              shouldArchive(row, activeThreshold) {
                if (!row.last_confidence_update) return false;
                const deltaDays = (nowSec - row.last_confidence_update) / 86400;
                const tau = calcTau(row.hit_count, row.base_tau);
                return Number(row.confidence || 0) * Math.exp(-deltaDays / tau) < activeThreshold;
              },
              onArchived(id) {
                recordMemoryEvent({
                  event_type: "memory_archived",
                  memory_id: id,
                  source: "memory_engine.archive",
                  metadata_json: { threshold },
                });
              },
            }));
          }

          if (action === "kg-bridge") {
            // Read knowledge-graph.json and write kg_data for matching chunks
            if (!existsSync(KG_PATH)) return { error: "knowledge-graph.json not found" };
            const kgRaw = JSON.parse(readFileSync(KG_PATH, "utf-8"));
            const nodes = kgRaw.nodes || kgRaw.concepts || [];
            const edges = kgRaw.edges || kgRaw.relationships || [];
            return runEngineDb(db => applyKgBridge(db, {
              nodes,
              edges,
              limit: 10,
            }));
          }

          if (action === "detect-conflicts") {
            return detectRelatedConflictsIsolated({
              withEngineDb: runEngineDb,
              withCoreDb: runCoreDb,
            });
          }

          return { error: "unknown action", available: ["add", "search", "cite", "update", "status", "archive", "kg-bridge", "detect-conflicts"] };
        } catch (e) {
          const stableCode = [
            "AMBIGUOUS_MEMORY_ID",
            "INVALID_MEMORY_ID",
            "INVALID_CONFIDENCE_STATE",
          ].includes(e?.code || e?.message)
            ? (e.code || e.message)
            : null;
          return stableCode
            ? { error: stableCode, code: stableCode }
            : { error: e.message };
        }
  };
}

function createSearchRunner(runtime) {
  const hybridRuntime = normalizeHybridRuntimeContext(runtime?.hybrid || runtime);
  const { dataAccess, retrievalPolicy, telemetry } = hybridRuntime;
  const defaultSurface = telemetry.hybridObservationSurface || "memory_engine_action_search";

  function recallHintDebug({
    mode = "none",
    status,
    hint = null,
    expansionCount = 0,
    canaryDecision = null,
    providerTelemetry = null,
  } = {}) {
    const providerLatency = Number(providerTelemetry?.latency_ms);
    const providerInputTokens = Number(providerTelemetry?.usage?.input_tokens);
    const providerOutputTokens = Number(providerTelemetry?.usage?.output_tokens);
    const debug = {
      mode,
      status,
      hint_entity_count: Array.isArray(hint?.entities) ? hint.entities.length : 0,
      hint_facet_count: Array.isArray(hint?.query_facets) ? hint.query_facets.length : 0,
      hint_has_project: typeof hint?.project === "string" && hint.project.length > 0,
      hint_time_relation: hint?.time_relation?.relation || null,
      hint_expansion_count: expansionCount,
      hint_canary_in_scope: canaryDecision?.in_scope === true,
      hint_canary_reason: canaryDecision?.reason || null,
      hint_vector_execution_mode: canaryDecision?.vector_execution_mode || "sequential",
    };
    if (canaryDecision?.execution_probe) {
      debug.hint_execution_probe = canaryDecision.execution_probe;
    }
    if (providerTelemetry) {
      debug.hint_provider_latency_ms = Number.isFinite(providerLatency) && providerLatency >= 0
        ? Math.min(60_000, providerLatency)
        : null;
      debug.hint_provider_input_tokens = Number.isSafeInteger(providerInputTokens) && providerInputTokens >= 0
        ? Math.min(100_000, providerInputTokens)
        : null;
      debug.hint_provider_output_tokens = Number.isSafeInteger(providerOutputTokens) && providerOutputTokens >= 0
        ? Math.min(10_000, providerOutputTokens)
        : null;
    }
    return debug;
  }

  function resolveRecallHintCanaryDecision(invocation = {}) {
    if (retrievalPolicy.recallHintRuntimeCanary === undefined) {
      return Object.freeze({
        configured: false,
        enabled: true,
        in_scope: true,
        provider_allowed: true,
        vector_execution_mode: retrievalPolicy.recallHintVectorExecutionMode === "parallel"
          ? "parallel"
          : "sequential",
        reason: "legacy_injected_provider",
        session_id_present: false,
      });
    }

    let runtimeContext = sanitizeRecallHintRuntimeContextV1(
      invocation.trustedRuntimeContext,
    );
    if (!runtimeContext && typeof retrievalPolicy.resolveExplicitSearchRuntimeContext === "function") {
      try {
        runtimeContext = sanitizeRecallHintRuntimeContextV1(
          retrievalPolicy.resolveExplicitSearchRuntimeContext(invocation.toolCallId || null),
        );
      } catch {
        runtimeContext = null;
      }
    }
    return Object.freeze({
      configured: true,
      ...evaluateRecallHintRuntimeCanaryV1({
        runtimeContext,
        config: retrievalPolicy.recallHintRuntimeCanary,
      }),
    });
  }

  async function resolveRecallHint(query, canaryDecision = null) {
    const provider = retrievalPolicy.recallHintProvider;
    if (provider === undefined || provider === null) {
      return {
        vectorQueryPlan: null,
        debug: recallHintDebug({ status: "provider_absent", canaryDecision }),
      };
    }
    if (typeof provider !== "function") {
      return {
        vectorQueryPlan: null,
        debug: recallHintDebug({ status: "provider_invalid", canaryDecision }),
      };
    }

    let output;
    try {
      output = await new Promise((resolve, reject) => {
        let settled = false;
        const controller = new AbortController();
        const providerDeadline = Number.isSafeInteger(provider.deadlineMs) && provider.deadlineMs > 0
          ? Math.min(60_000, provider.deadlineMs + 250)
          : RECALL_HINT_PROVIDER_TIMEOUT_MS;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          const error = new Error("recall_hint_provider_timeout");
          error.code = "RECALL_HINT_PROVIDER_TIMEOUT";
          controller.abort(error);
          reject(error);
        }, providerDeadline);
        Promise.resolve()
          .then(() => provider({ query, signal: controller.signal }))
          .then(value => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
          }, error => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(error);
          });
      });
    } catch (error) {
      const timedOut = error?.code === "RECALL_HINT_PROVIDER_TIMEOUT"
        || /DEADLINE/i.test(String(error?.code || ""))
        || error?.name === "TimeoutError"
        || /timeout/i.test(String(error?.message || ""));
      return {
        vectorQueryPlan: null,
        debug: recallHintDebug({
          status: timedOut ? "provider_timeout" : "provider_error",
          canaryDecision,
        }),
      };
    }

    const providerTelemetry = output?.schema === RECALL_HINT_RUNTIME_PROVIDER_RESULT_SCHEMA_V1
      ? {
          latency_ms: output.latency_ms,
          usage: output.usage,
        }
      : null;
    const hintOutput = output?.schema === RECALL_HINT_RUNTIME_PROVIDER_RESULT_SCHEMA_V1
      ? output.hint
      : output;
    const validation = validateRecallHintV1(hintOutput);
    if (!validation.valid) {
      return {
        vectorQueryPlan: null,
        debug: recallHintDebug({
          mode: "recall_hint_v1",
          status: "invalid_hint",
          canaryDecision,
          providerTelemetry,
        }),
      };
    }
    const hint = validation.normalized;
    let vectorQueryPlan = null;
    try {
      vectorQueryPlan = buildRecallHintVectorQueryPlan(query, hint);
    } catch {
      vectorQueryPlan = null;
    }
    if (!vectorQueryPlan) {
      return {
        vectorQueryPlan: null,
        debug: recallHintDebug({
          mode: "recall_hint_v1",
          status: Object.keys(hint).length === 1 ? "empty_hint" : "no_expansion",
          hint,
          canaryDecision,
          providerTelemetry,
        }),
      };
    }
    return {
      vectorQueryPlan,
      debug: recallHintDebug({
        mode: "recall_hint_v1",
        status: "applied",
        hint,
        expansionCount: vectorQueryPlan.queries.length,
        canaryDecision,
        providerTelemetry,
      }),
    };
  }

  return async function runMemoryEngineSearch(params = {}, invocation = {}) {
    const topKResult = validateTopK(params.top_k);
    if (!topKResult.valid) {
      return { error: INVALID_TOP_K, code: INVALID_TOP_K };
    }
    const queryText = String(params.query || params.text || "").trim();
    if (!queryText) return { error: "query text required for search" };
    const topK = topKResult.value;
    let explicitSearchRerankProfile = null;
    try {
      explicitSearchRerankProfile = normalizeExplicitSearchRerankPolicy(
        retrievalPolicy.explicitSearchRerankPolicy,
        topK,
      );
    } catch (error) {
      const code = error?.code || MEMORY_EXPLICIT_RERANK_CONFIG_INVALID;
      return { error: code, code };
    }
    const lancedbTable = params.lancedbTable !== undefined
      ? params.lancedbTable
      : dataAccess.getLancedbTable();
    const {
      recentCanaryContext,
      recentCanaryProvider: recentCanaryProviderForCall,
    } = resolveInjectedRecentCanaryContext({
      trustedRuntimeContext: retrievalPolicy.trustedRuntimeContext,
      recentCanaryProvider: retrievalPolicy.recentCanaryProvider,
      resolveRecentCanaryContext: retrievalPolicy.resolveRecentCanaryContext,
    });
    const hybridSearchOverrides = {
      getLancedbTable: () => lancedbTable,
      recentCanaryProvider: recentCanaryProviderForCall,
      recentCanaryContext,
      trustedRuntimeContext: retrievalPolicy.trustedRuntimeContext,
    };
    if (explicitSearchRerankProfile) {
      hybridSearchOverrides.explicitSearchRerankProfile = explicitSearchRerankProfile;
    }
    if (invocation.action === "memory_engine_search") {
      const recallHintCanary = resolveRecallHintCanaryDecision(invocation);
      if (recallHintCanary.probe_allowed === true) {
        const probe = resolveRhL3RuntimeProbeV1({
          probeId: recallHintCanary.execution_probe,
          query: queryText,
        });
        hybridSearchOverrides.recallHintDebug = recallHintDebug({
          mode: probe.applied ? "recall_hint_v1" : "none",
          status: probe.reason,
          hint: probe.hint,
          expansionCount: probe.vectorQueryPlan?.queries?.length || 0,
          canaryDecision: recallHintCanary,
        });
        if (probe.vectorQueryPlan) {
          hybridSearchOverrides.vectorQueryPlan = probe.vectorQueryPlan;
          hybridSearchOverrides.recallHintVectorExecutionMode = recallHintCanary.vector_execution_mode;
        }
      } else if (recallHintCanary.provider_allowed === true) {
        const recallHint = await resolveRecallHint(queryText, recallHintCanary);
        hybridSearchOverrides.recallHintDebug = recallHint.debug;
        if (recallHint.vectorQueryPlan) {
          hybridSearchOverrides.vectorQueryPlan = recallHint.vectorQueryPlan;
          hybridSearchOverrides.recallHintVectorExecutionMode = recallHintCanary.vector_execution_mode;
        }
      } else {
        hybridSearchOverrides.recallHintDebug = recallHintDebug({
          status: "canary_blocked",
          canaryDecision: recallHintCanary,
        });
      }
    }
    const result = await retrievalPolicy.hybridSearch(queryText, { topK }, buildHybridSearchRuntime(
      hybridRuntime,
      hybridSearchOverrides,
    ));
    recordHybridRuntimeObservation(hybridRuntime, {
      surface: invocation.surface || defaultSurface,
      result,
      traceId: invocation.toolCallId || null,
      toolCallId: invocation.toolCallId || null,
    });
    if (!result?.error && typeof telemetry.onMemoryEngineSearchSuccess === "function") {
      telemetry.onMemoryEngineSearchSuccess(result, invocation);
    }
    const projected = {
      pool: result.pool,
      channels: result.channels,
      channel_sizes: result.channel_sizes,
      debug: result.debug,
      results: result.results,
    };
    if (typeof result?.error === "string") projected.error = result.error;
    if (typeof result?.code === "string") projected.code = result.code;
    return projected;
  };
}

const MEMORY_ENGINE_SEARCH_RESULT_FIELDS = Object.freeze([
  "id",
  "memory_id",
  "canonical_id",
  "text",
  "path",
  "category",
  "kind",
  "category_authority",
  "confidence_mode",
  "source_type",
  "external_badge",
  "semantic_score",
  "rrf_score",
  "final_score",
  "sources",
  "similarity",
  "confidence",
  "created_at",
]);

function projectMemoryEngineSearchSources(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  return value
    .filter(source => typeof source === "string")
    .slice(0, 16);
}

function projectMemoryEngineSearchResult(result = {}, { exactPrimaryId = false } = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return {};
  const projected = {};
  for (const field of MEMORY_ENGINE_SEARCH_RESULT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) continue;
    if (field === "id") {
      if (exactPrimaryId) {
        if (typeof result.memory_id === "string" && result.memory_id.trim().length > 0) {
          projected.id = result.memory_id;
        }
      } else {
        projected.id = result.id;
      }
      continue;
    }
    if (field === "text") {
      projected.text = String(result.text || "").slice(0, 240);
      continue;
    }
    if (field === "sources") {
      const sources = projectMemoryEngineSearchSources(result.sources);
      if (sources !== undefined) projected.sources = sources;
      continue;
    }
    projected[field] = result[field];
  }
  return projected;
}

function projectMemoryEngineSearchToolResult(result = {}, options = {}) {
  const projected = {
    results: Array.isArray(result?.results)
      ? result.results.map(item => projectMemoryEngineSearchResult(item, options))
      : [],
  };
  if (typeof result?.error === "string") projected.error = result.error;
  if (typeof result?.code === "string") projected.code = result.code;
  return projected;
}

function chunkArray(values, size = 400) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function buildChunkColumnExpr(columns, name, fallback = "NULL") {
  return columns.has(name) ? `c.${name} AS ${name}` : `${fallback} AS ${name}`;
}

function readChunkColumns(db) {
  try {
    const rows = db.prepare("PRAGMA table_info(chunks)").all();
    return new Set(rows.map((row) => String(row.name || "")));
  } catch {
    return new Set();
  }
}

function createGetRunner(runtime) {
  const getRuntime = runtime?.get || runtime || {};
  const hybridRuntime = normalizeHybridRuntimeContext(runtime?.hybrid || runtime);
  const { dataAccess, retrievalPolicy } = hybridRuntime;
  const withDb = getRuntime.withDb || dataAccess.withDb;
  const runCoreDb = getRuntime.withCoreDb || dataAccess.withCoreDb || withDb;
  const runEngineDb = getRuntime.withEngineDb || dataAccess.withEngineDb || withDb;
  const calcRealtimeConf = getRuntime.calcRealtimeConf || retrievalPolicy.calcRealtimeConf;
  const CATEGORY_MAP = getRuntime.CATEGORY_MAP || getRuntime.categoryMap || retrievalPolicy.categoryMap;
  const onMemoryEngineGetSuccess = getRuntime.onMemoryEngineGetSuccess;

  return async function runMemoryEngineGet(params = {}) {
    const lookupId = String(params.id || "").trim();
    if (!lookupId) return { error: "id required" };
    if (lookupId.startsWith("checkpoint:")) {
      try {
        if (!getRuntime.memoryDir) throw new Error("derived_memory_directory_unavailable");
        const result = derivedSummary.readDerivedSummary(lookupId.slice("checkpoint:".length), {
          directory: derivedSummary.archiveDirectory(getRuntime.memoryDir),
          purpose: params.purpose, itemIndex: params.item_index, sourceId: params.source_id,
        });
        return { found: true, memory: { id: lookupId, kind: "derived_summary", ...result } };
      } catch (error) {
        return { found: false, id: lookupId, code: "MEMORY_GET_DERIVED_INVALID",
          error: "derived archive read failed", reason: error.code || error.message };
      }
    }

    const coreRows = runCoreDb((db) => {
      const columns = readChunkColumns(db);
      const selectColumns = [
        "SELECT c.id,",
        buildChunkColumnExpr(columns, "path"),
        ",",
        buildChunkColumnExpr(columns, "source"),
        ",",
        buildChunkColumnExpr(columns, "start_line"),
        ",",
        buildChunkColumnExpr(columns, "end_line"),
        ",",
        buildChunkColumnExpr(columns, "updated_at", "0"),
        ",",
        buildChunkColumnExpr(columns, "hash"),
        ",",
        buildChunkColumnExpr(columns, "text", "''"),
        "FROM chunks c",
      ].join(" ");
      const exact = db.prepare(`${selectColumns} WHERE c.id = ? LIMIT 1`).all(lookupId)
        .find(row => String(row?.id ?? "") === lookupId);
      if (exact) return [exact];
      return db.prepare([
        selectColumns,
        "WHERE c.id GLOB ?",
        "ORDER BY c.id ASC",
        "LIMIT 2",
      ].join(" ")).all(buildLiteralPrefixGlob(lookupId));
    });
    if (coreRows.length === 0) {
      return {
        found: false,
        id: lookupId,
        error: "not found",
      };
    }

    const engineRows = runEngineDb((db) => {
      const rows = [];
      for (const batch of chunkArray(coreRows.map(row => row.id))) {
        const placeholders = batch.map(() => "?").join(", ");
        rows.push(...db.prepare([
          "SELECT chunk_id, initial_confidence, confidence, last_confidence_update, base_tau, hit_count,",
          "is_protected, conflict_flag, is_archived, category",
          `FROM memory_confidence WHERE chunk_id IN (${placeholders})`,
        ].join(" ")).all(...batch));
      }
      return rows;
    });
    const engineRowsById = new Map();
    for (const engineRow of engineRows) {
      const id = String(engineRow?.chunk_id ?? "");
      const group = engineRowsById.get(id) || [];
      group.push(engineRow);
      engineRowsById.set(id, group);
    }
    const rows = coreRows.map(row => {
      const matchingEngineRows = engineRowsById.get(String(row.id)) || [];
      const meta = matchingEngineRows.length === 1 ? matchingEngineRows[0] : null;
      return {
        ...row,
        confidence: meta?.confidence ?? null,
        last_confidence_update: meta?.last_confidence_update ?? null,
        base_tau: meta?.base_tau ?? 7.0,
        hit_count: meta?.hit_count ?? 0,
        is_protected: meta?.is_protected ?? 0,
        conflict_flag: meta?.conflict_flag ?? 0,
        is_archived: meta?.is_archived ?? 0,
        category: meta?.category ?? null,
        _managed: matchingEngineRows.length > 0,
      };
    }).sort((left, right) => {
      if (left._managed !== right._managed) return left._managed ? -1 : 1;
      const leftReinforced = Number(left.last_confidence_update ?? -Infinity);
      const rightReinforced = Number(right.last_confidence_update ?? -Infinity);
      if (leftReinforced !== rightReinforced) return rightReinforced - leftReinforced;
      const leftUpdated = Number(left.updated_at ?? 0);
      const rightUpdated = Number(right.updated_at ?? 0);
      if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;
      return String(left.id).localeCompare(String(right.id));
    });
    const resolution = resolveExactOrUniquePrefixRows(rows, lookupId, "id");

    if (resolution.status === "ambiguous") {
      return {
        found: false,
        id: lookupId,
        error: "multiple matches",
        matches: resolution.matches.map((candidate) => String(candidate.id || "").slice(0, 16)),
      };
    }
    if (resolution.status !== "resolved" || !resolution.row) {
      return {
        found: false,
        id: lookupId,
        error: "not found",
      };
    }
    const row = resolution.row;
    const matchingEngineRows = engineRowsById.get(String(row.id)) || [];
    if (matchingEngineRows.length > 1) {
      return {
        found: false,
        id: String(row.id),
        error: "canonical read failed",
        code: "MEMORY_GET_CANONICAL_INVALID",
        reason: "engine_ambiguous",
      };
    }

    let canonical;
    try {
      canonical = composeCanonicalMemoryObject(row, matchingEngineRows[0] || null);
    } catch (error) {
      return {
        found: false,
        id: String(row.id || lookupId),
        error: "canonical read failed",
        code: "MEMORY_GET_CANONICAL_INVALID",
        reason: typeof error?.reason === "string" ? error.reason : "canonical_invalid",
      };
    }

    const lifecycle = canonical.lifecycle;
    const managed = lifecycle.management === "managed";
    const normalized = normalizeExternalMemory({
      id: canonical.memory_id,
      text: canonical.source.text,
      path: canonical.source.path,
      updated_at: canonical.source.updated_at,
      category: canonical.classification.category,
      confidence: managed ? lifecycle.confidence : null,
      last_confidence_update: managed ? lifecycle.last_confidence_update : null,
      base_tau: managed ? lifecycle.base_tau_days : null,
      hit_count: managed ? lifecycle.hit_count : 0,
      is_protected: managed && lifecycle.protected ? 1 : 0,
      conflict_flag: managed && lifecycle.conflict ? 1 : 0,
      is_archived: managed && lifecycle.archived ? 1 : 0,
    }, {
      nowSec: Math.floor(Date.now() / 1000),
      calcRealtimeConf,
      categoryMap: CATEGORY_MAP,
    }) || { id: canonical.memory_id };
    const startLine = canonical.source.line_start;
    const endLine = canonical.source.line_end;
    const result = {
      found: true,
      memory: {
        ...normalized,
        id: canonical.memory_id,
        memory_id: canonical.memory_id,
        canonical_id: canonical.canonical_id,
        kind: canonical.classification.kind,
        category_authority: canonical.classification.category_authority,
        source: canonical.source.core_source,
        start_line: startLine,
        end_line: endLine,
        line_range: { start: startLine, end: endLine },
        updated_at: canonical.source.updated_at,
        text: canonical.source.text,
      },
    };
    if (typeof onMemoryEngineGetSuccess === "function") {
      onMemoryEngineGetSuccess(result.memory.id, params);
    }
    return result;
  };
}

export function createMemoryEngineSearchExecute(runtime) {
  const runMemoryEngineSearch = createSearchRunner(runtime);
  return async function executeMemoryEngineSearch(_toolCallId, params, trustedRuntimeContext = null) {
    const boundedTrustedRuntimeContext = sanitizeRecallHintRuntimeContextV1({
      ...(trustedRuntimeContext && typeof trustedRuntimeContext === "object"
        ? trustedRuntimeContext
        : {}),
      requestIdentity: _toolCallId || null,
    });
    const result = await runMemoryEngineSearch(params, {
      toolCallId: _toolCallId,
      action: "memory_engine_search",
      surface: "memory_engine_search",
      trustedRuntimeContext: boundedTrustedRuntimeContext,
    });
    return projectMemoryEngineSearchToolResult(result, { exactPrimaryId: true });
  };
}

export function createMemoryEngineGetExecute(runtime) {
  const runMemoryEngineGet = createGetRunner(runtime);
  return async function executeMemoryEngineGet(_toolCallId, params) {
    return runMemoryEngineGet({
      ...params,
      _toolCallId,
    });
  };
}
