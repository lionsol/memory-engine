import { hybridSearch } from "../recall/hybrid-search.js";
import { safeRelativePath } from "../path-utils.js";
import { getDefaultMemoryEngineConfig } from "../config/defaults.js";
import { getMemoryEngineConfig } from "../config/runtime.js";
import { normalizeExternalMemory } from "../recall/hybrid/normalize-candidate.js";
import { recordHybridSearchObservation } from "../recall/hybrid-observation.js";

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

function tokenizeConflictText(text) {
  return String(text || "")
    .toLowerCase()
    .match(/[\p{L}\p{N}_-]{2,}/gu) || [];
}

function conflictTextOverlap(row) {
  const left = new Set(tokenizeConflictText(`${row.path1 || ""}\n${row.text1 || ""}`));
  const right = new Set(tokenizeConflictText(`${row.path2 || ""}\n${row.text2 || ""}`));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared++;
  }
  return shared / Math.min(left.size, right.size);
}

export function createMemoryEngineExecute(runtime) {
  const {
    api,
    autoRouteCategory,
    dateStrInTimeZone,
    SMART_ADD_TIME_ZONE,
    resolve,
    WORKSPACE,
    SMART_ADD_DIR,
    buildSmartAddFingerprint,
    appendSmartAdd,
    syncIndexIfNeeded,
    catParams,
    withDb,
    getLancedbTable,
    generateEmbedding,
    recordMemoryEvent,
    getMemorySearchManager,
    calcRealtimeConf,
    existsSync,
    readFileSync,
    KG_PATH,
    resolvePrefixes,
    batchReinforce,
    CATEGORY_MAP,
    calcTau,
    hybridSearch: hybridSearchRuntime = hybridSearch,
    withHybridDbAccessScope = null,
    recentCanaryProvider = null,
    resolveRecentCanaryContext = null,
    trustedRuntimeContext = null,
    kgFailClosedMode = undefined,
    kgFailClosedCanary = null,
    recentFailClosedMode = undefined,
    recentFailClosedCanary = null,
    productionEvidenceIdentityContext = null,
    resolveTrafficOriginContext = null,
    hybridObservationSurface = "memory_engine_action_search",
  } = runtime;

  const runMemoryEngineSearch = createSearchRunner({
    api,
    withDb,
    withHybridDbAccessScope,
    calcRealtimeConf,
    syncIndexIfNeeded,
    CATEGORY_MAP,
    getLancedbTable,
    generateEmbedding,
    getMemorySearchManager,
    hybridSearch: hybridSearchRuntime,
    recordMemoryEvent,
    hybridObservationSurface,
    recentCanaryProvider,
    resolveRecentCanaryContext,
    trustedRuntimeContext,
    kgFailClosedMode,
    kgFailClosedCanary,
    recentFailClosedMode,
    recentFailClosedCanary,
    productionEvidenceIdentityContext,
    resolveTrafficOriginContext,
  });

  return async function executeMemoryEngineAction(_toolCallId, params) {
    const lancedbTable = getLancedbTable();
        const { action, text, category, protected: isProtected, chunk_id, hit, top_k, deep } = params;
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

            // Get new chunks
            const { conf, tau } = catParams(cat, isProtected);
            let lanceWritten = 0;

            const result = withDb(db => {
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

              // ① Write SQLite confidence first (lightweight, instantaneous)
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

            // ② Generate embedding + write LanceDB (synchronous, with rollback)
            if (result.newChunks && lancedbTable) {
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
                }
              } catch (e) {
                // LanceDB write failed → rollback SQLite to avoid orphan
                console.warn("[memory-engine] LanceDB write failed, rolling back SQLite:", e.message);
                withDb(db => {
                  const del = db.prepare("DELETE FROM memory_confidence WHERE chunk_id = ?");
                  for (const row of result.newChunks) {
                    del.run(row.id);
                  }
                });
                // Re-throw so the caller knows the add failed
                throw new Error(`LanceDB write failed, SQLite rolled back: ${e.message}`);
              }
            }

            if (result.newChunks) {
              for (const row of result.newChunks) {
                recordMemoryEvent({ event_type: "memory_created", memory_id: row.id, source: "memory_engine.add", metadata_json: { category: result.category, confidence: result.confidence, tau: result.tau, lance_written: lanceWritten } });
              }
            }
            return { success: true, chunks_added: result.chunks_added, category: result.category, confidence: result.confidence, tau: result.tau, lance_written: lanceWritten };
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
            const memoryEngineConfig = getMemoryEngineConfig(api.config || null);
            const configuredThreshold = Number(memoryEngineConfig?.archive?.threshold);
            const threshold = Number.isFinite(configuredThreshold)
              ? configuredThreshold
              : Number(getDefaultMemoryEngineConfig()?.archive?.threshold);
            return withDb(db => {
              const rows = db.prepare([
                "SELECT chunk_id, confidence, last_confidence_update, hit_count,",
                "base_tau, is_protected, category FROM memory_confidence",
                "WHERE is_archived = 0 AND is_protected = 0 AND category != 'user_identity'"
              ].join(" ")).all();
              const toArchive = [];
              for (const row of rows) {
                if (!row.last_confidence_update) continue;
                const deltaDays = (nowSec - row.last_confidence_update) / 86400;
                const t = calcTau(row.hit_count, row.base_tau);
                const rc = row.confidence * Math.exp(-deltaDays / t);
                if (rc < threshold) toArchive.push(row.chunk_id);
              }
              if (toArchive.length > 0) {
                const ph = toArchive.map(() => "?").join(",");
                db.prepare(`UPDATE memory_confidence SET is_archived = 1 WHERE chunk_id IN (${ph})`).run(...toArchive);
                for (const id of toArchive) recordMemoryEvent({ event_type: "memory_archived", memory_id: id, source: "memory_engine.archive", metadata_json: { threshold } });
              }
              return { archived: toArchive.length, threshold };
            });
          }

          if (action === "kg-bridge") {
            // Read knowledge-graph.json and write kg_data for matching chunks
            if (!existsSync(KG_PATH)) return { error: "knowledge-graph.json not found" };
            const kgRaw = JSON.parse(readFileSync(KG_PATH, "utf-8"));
            const nodes = kgRaw.nodes || kgRaw.concepts || [];
            const edges = kgRaw.edges || kgRaw.relationships || [];
            return withDb(db => {
              const subgraph = {
                node_count: nodes.length,
                edge_count: edges.length,
                nodes: nodes.slice(0, 20).map(n => ({
                  id: n.id || n.name,
                  name: n.name || n.id,
                  type: n.type || "concept",
                  properties: n.properties || {},
                })),
                edges: edges.slice(0, 30).map(e => ({
                  source: e.source || e.from,
                  target: e.target || e.to,
                  type: e.type || "RELATED_TO",
                })),
              };
              const kgJson = JSON.stringify(subgraph);
              // Write kg_data for all matching concept chunks
              const chunkMatches = db.prepare([
                "SELECT chunk_id FROM memory_confidence",
                "WHERE category IN ('kg_node', 'raw_log')",
              ].join(" ")).all();
              const update = db.prepare([
                "UPDATE memory_confidence SET kg_data = ? WHERE chunk_id = ?"
              ].join(" "));
              for (const row of chunkMatches.slice(0, 10)) {
                update.run(kgJson, row.chunk_id);
              }
              return {
                success: true,
                nodes: nodes.length,
                edges: edges.length,
                chunks_updated: Math.min(chunkMatches.length, 10),
              };
            });
          }

          if (action === "detect-conflicts") {
            return withDb(db => {
              const rows = db.prepare([
                "SELECT m1.chunk_id as id1, m2.chunk_id as id2,",
                "m1.category, m1.confidence as c1, m2.confidence as c2,",
                "m1.hit_count as h1, m2.hit_count as h2,",
                "c1.text as text1, c2.text as text2,",
                "c1.path as path1, c2.path as path2",
                "FROM memory_confidence m1",
                "JOIN memory_confidence m2 ON m1.category = m2.category",
                "AND m1.chunk_id < m2.chunk_id",
                "JOIN chunks c1 ON c1.id = m1.chunk_id",
                "JOIN chunks c2 ON c2.id = m2.chunk_id",
                "WHERE m1.is_archived = 0 AND m2.is_archived = 0",
                "AND ABS(m1.confidence - m2.confidence) > 0.3",
                "AND ABS(m1.hit_count - m2.hit_count) > 3",
                "ORDER BY m1.category, MAX(m1.last_confidence_update, m2.last_confidence_update) DESC",
                "LIMIT 500",
              ].join(" ")).all();

              let flagged = 0;
              const flagStmt = db.prepare([
                "UPDATE memory_confidence SET conflict_flag = 1 WHERE chunk_id = ?"
              ].join(" "));
              for (const row of rows) {
                if (conflictTextOverlap(row) < 0.2) continue;
                // Flag the lower-confidence one as possibly outdated
                const lowerId = row.c1 < row.c2 ? row.id1 : row.id2;
                flagStmt.run(lowerId);
                flagged++;
              }
              return {
                success: true,
                pairs_checked: rows.length,
                flagged_as_conflict: flagged,
                note: "Lower-confidence related chunks in same category with divergent hit counts flagged",
              };
            });
          }

          return { error: "unknown action", available: ["add", "search", "cite", "update", "status", "archive", "kg-bridge", "detect-conflicts"] };
        } catch (e) {
          return { error: e.message };
        }
  };
}

function createSearchRunner(runtime) {
  const {
    api,
    withDb,
    calcRealtimeConf,
    syncIndexIfNeeded,
    CATEGORY_MAP,
    getLancedbTable,
    generateEmbedding,
    getMemorySearchManager,
    hybridSearch: hybridSearchRuntime = hybridSearch,
    recordMemoryEvent,
    hybridObservationSurface = "memory_engine_action_search",
    withHybridDbAccessScope = null,
    recentCanaryProvider = null,
    resolveRecentCanaryContext = null,
    trustedRuntimeContext = null,
    kgFailClosedMode = undefined,
    kgFailClosedCanary = null,
    recentFailClosedMode = undefined,
    recentFailClosedCanary = null,
    productionEvidenceIdentityContext = null,
    resolveTrafficOriginContext = null,
  } = runtime;

  return async function runMemoryEngineSearch(params = {}, invocation = {}) {
    const queryText = String(params.query || params.text || "").trim();
    if (!queryText) return { error: "query text required for search" };
    const topK = Math.max(1, Number(params.top_k || 5) || 5);
    const lancedbTable = params.lancedbTable !== undefined
      ? params.lancedbTable
      : getLancedbTable();
    const {
      recentCanaryContext,
      recentCanaryProvider: recentCanaryProviderForCall,
    } = resolveInjectedRecentCanaryContext({
      trustedRuntimeContext,
      recentCanaryProvider,
      resolveRecentCanaryContext,
    });
    const result = await hybridSearchRuntime(queryText, { topK }, {
      withDb,
      withHybridDbAccessScope,
      calcRealtimeConf,
      syncIndexIfNeeded,
      categoryMap: CATEGORY_MAP,
      cfg: api.config || null,
      getLancedbTable: () => lancedbTable,
      generateEmbedding,
      getMemorySearchManager,
      recentCanaryProvider: recentCanaryProviderForCall,
      recentCanaryContext,
      kgFailClosedMode,
      kgFailClosedCanary,
      recentFailClosedMode,
      recentFailClosedCanary,
      trustedRuntimeContext,
      productionEvidenceIdentityContext,
    });
    const trafficOriginContext = typeof resolveTrafficOriginContext === "function"
      ? resolveTrafficOriginContext(invocation.toolCallId)
      : null;
    recordHybridSearchObservation({
      recordMemoryEvent,
      surface: invocation.surface || hybridObservationSurface,
      result,
      traceId: invocation.toolCallId || null,
      identityContext: productionEvidenceIdentityContext,
      trafficOriginContext,
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
  const {
    withDb,
    calcRealtimeConf,
    CATEGORY_MAP,
    onMemoryEngineGetSuccess,
  } = runtime;

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
