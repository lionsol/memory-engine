import { safeRelativePath } from "../path-utils.js";
import { getDefaultMemoryEngineConfig } from "../config/defaults.js";
import { getMemoryEngineConfig } from "../config/runtime.js";
import { normalizeExternalMemory } from "../recall/hybrid/normalize-candidate.js";
import {
  buildHybridSearchRuntime,
  normalizeHybridRuntimeContext,
  recordHybridRuntimeObservation,
} from "../recall/hybrid/runtime-context.js";
import {
  applyKgBridge,
  archiveLowConfidence,
  detectRelatedConflicts,
} from "../lifecycle/operations.js";

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
    getLancedbTable = dataAccess.getLancedbTable,
    generateEmbedding = retrievalPolicy.generateEmbedding,
    recordMemoryEvent = telemetry.recordMemoryEvent,
    calcRealtimeConf = retrievalPolicy.calcRealtimeConf,
    existsSync,
    readFileSync,
    KG_PATH = actionRuntime.kgPath,
    resolvePrefixes,
    batchReinforce,
    CATEGORY_MAP = retrievalPolicy.categoryMap,
    calcTau,
  } = actionRuntime;
  const apiConfig = actionRuntime.apiConfig
    ?? actionRuntime.api?.config
    ?? retrievalPolicy.apiConfig
    ?? null;
  const runMemoryEngineSearch = createSearchRunner(hybridRuntime);

  return async function executeMemoryEngineAction(_toolCallId, params) {
    const lancedbTable = getLancedbTable();
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
        const k = top_k || 5;
        const nowSec = Math.floor(Date.now() / 1000);

        try {
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
            try {
              result = withDb(db => {
                const fileRel = safeRelativePath(WORKSPACE, filePath);
                if (!fileRel) {
                  throw new Error(`failed to derive workspace-relative path for ${filePath}`);
                }
                const newChunks = db.prepare([
                  "SELECT id FROM chunks WHERE path = ?",
                  "AND id NOT IN (SELECT chunk_id FROM memory_confidence)"
                ].join(" ")).all(fileRel);

                if (newChunks.length <= 0) {
                  return { chunks_added: 0, category: cat, confidence: conf, tau };
                }

                const insert = db.prepare([
                  "INSERT INTO memory_confidence",
                  "(chunk_id, initial_confidence, confidence, last_confidence_update,",
                  "base_tau, hit_count, is_archived, is_protected, conflict_flag, category)",
                  "VALUES (?, ?, ?, ?, ?, 0, 0, ?, 0, ?)"
                ].join(" "));
                const txn = db.transaction(() => {
                  for (const row of newChunks) {
                    insert.run(row.id, conf, conf, nowSec, tau, isProtected ? 1 : 0, cat);
                  }
                });
                txn();

                return { chunks_added: newChunks.length, category: cat, confidence: conf, tau, newChunks };
              });
            } catch (error) {
              console.warn("[memory-engine] canonical add persisted but Engine metadata write failed:", error.message);
              return {
                success: true,
                canonical_written: true,
                chunks_added: 0,
                category: cat,
                confidence: conf,
                tau,
                derived_state: "pending_engine",
                needs_reconcile: true,
                reconcile_reason: "engine_write_failed",
                derived_error: error.message,
                sync,
              };
            }

            let lanceWritten = 0;
            let vectorError = null;
            if (result.newChunks) {
              if (!lancedbTable) {
                vectorError = "lancedb_unavailable";
              } else {
                try {
                  const vec = await generateEmbedding(text);
                  if (vec && vec.length > 0) {
                    await lancedbTable.add([{
                      id: result.newChunks[0].id,
                      text: text.slice(0, 2000),
                      vector: vec,
                      timestamp: Date.now()
                    }]);
                    lanceWritten = 1;
                  } else {
                    vectorError = "embedding_empty";
                  }
                } catch (error) {
                  vectorError = error.message;
                  console.warn("[memory-engine] canonical add persisted but LanceDB write failed:", error.message);
                }
              }
            }

            const needsReconcile = result.chunks_added === 0 || Boolean(result.newChunks && lanceWritten === 0);
            const derivedState = result.chunks_added === 0
              ? "pending_index"
              : needsReconcile
                ? "partial"
                : "complete";

            if (result.newChunks) {
              for (const row of result.newChunks) {
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
              { text, top_k: k, lancedbTable },
              { toolCallId: _toolCallId, action: "memory_engine.search" },
            );
          }
          if (action === "cite") {
            if (!chunk_ids || chunk_ids.length === 0) return { error: "chunk_ids array required" };
            return withDb(db => {
              const fullIds = resolvePrefixes(db, chunk_ids);
              if (fullIds.length === 0) return { success: true, reinforced: 0, note: "no matching chunks found" };
              const count = batchReinforce(db, fullIds, nowSec);
              for (const id of fullIds) {
                recordMemoryEvent({ event_type: "memory_cited", memory_id: id, cited_count: 1, source: "memory_engine.cite" });
                recordMemoryEvent({ event_type: "memory_reinforced", memory_id: id, source: "memory_engine.cite" });
              }
              return {
                success: true,
                reinforced: count,
                ids: fullIds.map(id => id.slice(0, 16)),
                next_confidence: (0.5 + count * 0.1).toFixed(2),
              };
            });
          }

          if (action === "update") {
            if (!chunk_id) return { error: "chunk_id required" };
            return withDb(db => {
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
            return withDb(db => {
              const total = db.prepare("SELECT COUNT(*) as c FROM chunks").get();
              const c = db.prepare([
                "SELECT COUNT(*) as total, SUM(is_archived) as archived,",
                "SUM(is_protected) as protected, SUM(conflict_flag) as conflicted,",
                "ROUND(AVG(confidence), 4) as avg_conf, ROUND(AVG(base_tau), 2) as avg_tau,",
                "ROUND(AVG(hit_count), 2) as avg_hits FROM memory_confidence"
              ].join(" ")).get();
              const cat = db.prepare("SELECT category, COUNT(*) as count FROM memory_confidence GROUP BY category ORDER BY count DESC").all();
              const missing = db.prepare("SELECT COUNT(*) as c FROM chunks c LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id WHERE mc.chunk_id IS NULL").get();
              return {
                chunks_total: total.c, confidence_tracked: c.total || 0,
                archived: c.archived || 0, protected: c.protected || 0,
                conflicted: c.conflicted || 0, avg_confidence: c.avg_conf || 0,
                avg_tau: c.avg_tau || 0, avg_hits: c.avg_hits || 0,
                chunks_missing_confidence: missing.c || 0, by_category: cat,
              };
            });
          }

          if (action === "archive") {
            const memoryEngineConfig = getMemoryEngineConfig(apiConfig);
            const configuredThreshold = Number(memoryEngineConfig?.archive?.threshold);
            const threshold = Number.isFinite(configuredThreshold)
              ? configuredThreshold
              : Number(getDefaultMemoryEngineConfig()?.archive?.threshold);
            return withDb(db => archiveLowConfidence(db, {
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
            return withDb(db => applyKgBridge(db, {
              nodes,
              edges,
              limit: 10,
            }));
          }

          if (action === "detect-conflicts") {
            return withDb(db => detectRelatedConflicts(db));
          }

          return { error: "unknown action", available: ["add", "search", "cite", "update", "status", "archive", "kg-bridge", "detect-conflicts"] };
        } catch (e) {
          return { error: e.message };
        }
  };
}

function createSearchRunner(runtime) {
  const hybridRuntime = normalizeHybridRuntimeContext(runtime?.hybrid || runtime);
  const { dataAccess, retrievalPolicy, telemetry } = hybridRuntime;
  const defaultSurface = telemetry.hybridObservationSurface || "memory_engine_action_search";

  return async function runMemoryEngineSearch(params = {}, invocation = {}) {
    const queryText = String(params.query || params.text || "").trim();
    if (!queryText) return { error: "query text required for search" };
    const topK = Math.max(1, Number(params.top_k || 5) || 5);
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
    return {
      pool: result.pool,
      channels: result.channels,
      channel_sizes: result.channel_sizes,
      debug: result.debug,
      results: result.results,
    };
  };
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
  const calcRealtimeConf = getRuntime.calcRealtimeConf || retrievalPolicy.calcRealtimeConf;
  const CATEGORY_MAP = getRuntime.CATEGORY_MAP || getRuntime.categoryMap || retrievalPolicy.categoryMap;
  const onMemoryEngineGetSuccess = getRuntime.onMemoryEngineGetSuccess;

  return async function runMemoryEngineGet(params = {}) {
    const lookupId = String(params.id || "").trim();
    if (!lookupId) return { error: "id required" };

    return withDb((db) => {
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
        ", mc.confidence, mc.last_confidence_update,",
        "COALESCE(mc.base_tau, 7.0) AS base_tau,",
        "COALESCE(mc.hit_count, 0) AS hit_count,",
        "COALESCE(mc.is_protected, 0) AS is_protected,",
        "COALESCE(mc.conflict_flag, 0) AS conflict_flag,",
        "COALESCE(mc.is_archived, 0) AS is_archived,",
        "mc.category AS category",
        "FROM chunks c",
        "LEFT JOIN memory_confidence mc ON mc.chunk_id = c.id",
        "WHERE c.id LIKE ? || '%'",
        "ORDER BY CASE WHEN mc.chunk_id IS NULL THEN 1 ELSE 0 END ASC,",
        "mc.last_confidence_update DESC, c.updated_at DESC, c.id ASC",
        "LIMIT 2",
      ].join(" ");
      const rows = db.prepare(selectSql).all(lookupId);
      if (rows.length === 0) {
        return {
          found: false,
          id: lookupId,
          error: "not found",
        };
      }
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
    });
  };
}

export function createMemoryEngineSearchExecute(runtime) {
  const runMemoryEngineSearch = createSearchRunner(runtime);
  return async function executeMemoryEngineSearch(_toolCallId, params) {
    return runMemoryEngineSearch(params, {
      toolCallId: _toolCallId,
      action: "memory_engine_search",
      surface: "memory_engine_search",
    });
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
