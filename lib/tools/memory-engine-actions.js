import { safeRelativePath } from "../path-utils.js";
import { getDefaultMemoryEngineConfig } from "../config/defaults.js";
import { getMemoryEngineConfig } from "../config/runtime.js";
import { getCanonicalMemoryById } from "../canonical/read-adapter.js";
import {
  materializeCanonicalLanceRow,
  projectCanonicalMemoryToVectorProjection,
} from "../canonical/vector-projection.js";
import { normalizeExternalMemory } from "../recall/hybrid/normalize-candidate.js";
import {
  batchReinforce as defaultBatchReinforce,
} from "../memory-confidence.js";
import { MEMORY_CITE_NOT_AUTHORIZED } from "../recall/cite-authority.js";
import {
  buildHybridSearchRuntime,
  normalizeHybridRuntimeContext,
  recordHybridRuntimeObservation,
} from "../recall/hybrid/runtime-context.js";
import {
  applyKgBridge,
  archiveLowConfidence,
  detectRelatedConflictsIsolated,
} from "../lifecycle/operations.js";
import {
  INVALID_TOP_K,
  validateTopK,
} from "../recall/top-k-policy.js";

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

function readCoreChunkIdsForPath(runCoreDb, fileRel) {
  const rows = runCoreDb(db => db.prepare(
    "SELECT id FROM chunks WHERE path = ? ORDER BY id ASC"
  ).all(fileRel));
  if (!Array.isArray(rows)) throw new Error("core_chunk_ids_malformed");
  return rows.map((row, index) => {
    if (!row || row.id == null) throw new Error(`core_chunk_id_missing_at_${index}`);
    return String(row.id);
  });
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
          deep,
        } = params;
        let lancedbTable = null;
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
          lancedbTable = action === "add" ? null : getLancedbTable();
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
                derived_error: String(error?.message || error),
              };
            }
            const fingerprint = buildSmartAddFingerprint(text, cat, isProtected);
            const appendResult = await appendSmartAdd({
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
                derived_state: "pending_sync",
                needs_reconcile: true,
                reconcile_reason: "sync_failed",
                sync,
              };
            }

            let result;
            let afterRows;
            try {
              afterRows = readCoreChunkIdsForPath(runCoreDb, fileRel)
                .map(id => ({ id }));
            } catch (error) {
              return {
                success: true,
                canonical_written: true,
                chunks_added: 0,
                category: cat,
                confidence: conf,
                tau,
                lance_written: 0,
                derived_state: "pending_index",
                needs_reconcile: true,
                reconcile_reason: "index_observation_failed",
                derived_error: String(error?.message || error),
                vector_error: null,
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
                lance_written: 0,
                derived_state: "pending_index",
                needs_reconcile: true,
                reconcile_reason: "index_not_observed",
                vector_error: null,
                sync,
              };
            }

            try {
              result = runEngineDb(db => {
                const exists = db.prepare("SELECT 1 FROM memory_confidence WHERE chunk_id = ? LIMIT 1");
                const engineRowsToInsert = newCoreRows.filter(row => !exists.get(row.id));
                if (engineRowsToInsert.length > 0) {
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

                return {
                  chunks_added: newCoreRows.length,
                  category: cat,
                  confidence: conf,
                  tau,
                  newCoreRows,
                };
              });
            } catch (error) {
              console.warn("[memory-engine] canonical add persisted but Engine metadata write failed:", error.message);
              return {
                success: true,
                canonical_written: true,
                chunks_added: newCoreRows.length,
                category: cat,
                confidence: conf,
                tau,
                derived_state: "pending_engine",
                needs_reconcile: true,
                reconcile_reason: "engine_write_failed",
                derived_error: error.message,
                lance_written: 0,
                sync,
              };
            }

            let lanceWritten = 0;
            let vectorError = null;
            if (result.newCoreRows) {
              const addLancedbTable = getLancedbTable();
              if (!addLancedbTable) {
                vectorError = "lancedb_unavailable";
              } else {
                try {
                  const exactId = String(result.newCoreRows[0].id);
                  const canonicalResult = await resolveCanonicalMemory(exactId, {
                    withCoreDb: runCoreDb,
                    withEngineDb: runEngineDbReadonly,
                  });
                  if (!canonicalResult?.ok || !canonicalResult.memory) {
                    throw new Error(`canonical_lookup_${canonicalResult?.reason || "invalid_result"}`);
                  }
                  if (canonicalResult.memory.memory_id !== exactId) {
                    throw new Error("canonical_lookup_memory_id_mismatch");
                  }

                  const projection = projectVector(canonicalResult.memory);
                  const vec = await generateEmbedding(projection.embedding_input);
                  const lanceRow = materializeLanceRow(projection, {
                    vector: vec,
                    timestamp: nowProvider(),
                  });
                  await addLancedbTable.add([lanceRow]);
                  lanceWritten = 1;
                } catch (error) {
                  vectorError = String(error?.message || error);
                  console.warn("[memory-engine] canonical add persisted but LanceDB write failed:", error.message);
                }
              }
            }

            const needsReconcile = result.chunks_added === 0 || Boolean(result.newCoreRows && lanceWritten === 0);
            const derivedState = result.chunks_added === 0
              ? "pending_index"
              : needsReconcile
                ? "partial"
                : "complete";

            if (result.newCoreRows) {
              for (const row of result.newCoreRows) {
                recordMemoryEvent({
                  event_type: "memory_created",
                  memory_id: row.id,
                  source: "memory_engine.add",
                  metadata_json: {
                    category: result.category,
                    confidence: result.confidence,
                    tau: result.tau,
                    lance_written: lanceWritten,
                    derived_state: derivedState,
                    needs_reconcile: needsReconcile,
                    vector_error: vectorError,
                  },
                });
              }
            }
            return {
              success: true,
              canonical_written: true,
              chunks_added: result.chunks_added,
              category: result.category,
              confidence: result.confidence,
              tau: result.tau,
              lance_written: lanceWritten,
              derived_state: derivedState,
              needs_reconcile: needsReconcile,
              reconcile_reason: needsReconcile
                ? result.chunks_added === 0
                  ? "index_not_observed"
                  : "vector_pending"
                : null,
              vector_error: vectorError,
              sync,
            };
          }

          if (action === "search") {
            return runMemoryEngineSearch(
              { text, top_k, lancedbTable },
              { toolCallId: _toolCallId, action: "memory_engine.search" },
            );
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
                next_confidence: (0.5 + count * 0.1).toFixed(2),
              };
            });
          }

          if (action === "update") {
            if (!chunk_id) return { error: "chunk_id required" };
            return runEngineDb(db => {
              const matches = db.prepare([
                "SELECT chunk_id FROM memory_confidence WHERE chunk_id LIKE ? || '%' LIMIT 2"
              ].join("")).all(chunk_id);
              if (matches.length === 0) return { error: "no match" };
              if (matches.length > 1) return { error: "multiple matches", matches: matches.map(r => r.chunk_id.slice(0, 16)) };
              const fullId = matches[0].chunk_id;
              const sets = ["last_confidence_update = ?"];
              const vals = [nowSec];
              if (category) {
                const rule = CATEGORY_MAP[category];
                if (rule) {
                  sets.push("category = ?", "initial_confidence = ?", "confidence = ?", "base_tau = ?");
                  vals.push(category, rule.conf, rule.conf, rule.tau);
                }
              }
              if (hit) sets.push("hit_count = hit_count + 1");
              if (isProtected !== undefined) { sets.push("is_protected = ?"); vals.push(isProtected ? 1 : 0); }
              vals.push(fullId);
              db.prepare(`UPDATE memory_confidence SET ${sets.join(", ")} WHERE chunk_id = ?`).run(...vals);
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

  return async function runMemoryEngineSearch(params = {}, invocation = {}) {
    const topKResult = validateTopK(params.top_k);
    if (!topKResult.valid) {
      return { error: INVALID_TOP_K, code: INVALID_TOP_K };
    }
    const queryText = String(params.query || params.text || "").trim();
    if (!queryText) return { error: "query text required for search" };
    const topK = topKResult.value;
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
    const result = await retrievalPolicy.hybridSearch(queryText, { topK }, buildHybridSearchRuntime(
      hybridRuntime,
      {
        getLancedbTable: () => lancedbTable,
        recentCanaryProvider: recentCanaryProviderForCall,
        recentCanaryContext,
        trustedRuntimeContext: retrievalPolicy.trustedRuntimeContext,
      },
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
    return {
      pool: result.pool,
      channels: result.channels,
      channel_sizes: result.channel_sizes,
      debug: result.debug,
      results: result.results,
    };
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

function projectMemoryEngineSearchResult(result = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return {};
  const projected = {};
  for (const field of MEMORY_ENGINE_SEARCH_RESULT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) continue;
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

function projectMemoryEngineSearchToolResult(result = {}) {
  const projected = {
    results: Array.isArray(result?.results)
      ? result.results.map(projectMemoryEngineSearchResult)
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

    const coreRows = runCoreDb((db) => {
      const columns = readChunkColumns(db);
      const selectSql = [
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
        buildChunkColumnExpr(columns, "text", "''"),
        "FROM chunks c",
        "WHERE c.id LIKE ? || '%'",
        "ORDER BY c.updated_at DESC, c.id ASC",
      ].join(" ");
      return db.prepare(selectSql).all(lookupId);
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
          "SELECT chunk_id, confidence, last_confidence_update, base_tau, hit_count,",
          "is_protected, conflict_flag, is_archived, category",
          `FROM memory_confidence WHERE chunk_id IN (${placeholders})`,
        ].join(" ")).all(...batch));
      }
      return rows;
    });
    const engineMap = new Map(engineRows.map(row => [String(row.chunk_id), row]));
    const rows = coreRows.map(row => {
      const meta = engineMap.get(String(row.id));
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
        _managed: Boolean(meta),
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
    }).slice(0, 2);

    if (rows.length > 1) {
      return {
        found: false,
        id: lookupId,
        error: "multiple matches",
        matches: rows.map((row) => String(row.id || "").slice(0, 16)),
      };
    }
    const row = rows[0];
    const normalized = normalizeExternalMemory(row, {
      nowSec: Math.floor(Date.now() / 1000),
      calcRealtimeConf,
      categoryMap: CATEGORY_MAP,
    }) || { id: String(row.id || "").trim() };
    const startLine = Number.isFinite(Number(row.start_line)) ? Number(row.start_line) : null;
    const endLine = Number.isFinite(Number(row.end_line)) ? Number(row.end_line) : null;
    const result = {
      found: true,
      memory: {
        ...normalized,
        source: row.source ?? null,
        start_line: startLine,
        end_line: endLine,
        line_range: startLine !== null || endLine !== null
          ? { start: startLine, end: endLine }
          : null,
        updated_at: row.updated_at ?? null,
        text: String(row.text || ""),
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
  return async function executeMemoryEngineSearch(_toolCallId, params) {
    const result = await runMemoryEngineSearch(params, {
      toolCallId: _toolCallId,
      action: "memory_engine_search",
      surface: "memory_engine_search",
    });
    return projectMemoryEngineSearchToolResult(result);
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
