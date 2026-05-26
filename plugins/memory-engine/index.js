import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { getMemorySearchManager } from "openclaw/plugin-sdk/memory-core-engine-runtime";
import Database from "better-sqlite3";
import lancedb from '@lancedb/lancedb';
import { buildSmartAddFingerprint } from "./smart-add-fingerprint.js";
import { localDateKey } from "./date-utils.js";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { resolve } from "path";
import { explainAutoRecallSkip, formatAutoRecallContext, parseCitedMemoryIds, shouldInjectCandidate } from "./auto-recall.js";
import {
  buildLikeFallbackPatterns,
  buildFtsFallbackQuery,
  extractQueryTokens,
  normalizeFtsQuery,
  rankFtsFallbackCandidates,
  sanitizeFtsQuery,
  stripPromptMetadataPrefix,
} from "./query-utils.js";
import { appendSmartAdd } from "./session-checkpoint.js";
import {
  DB_PATH,
  HOME_DIR,
  INDEX_SYNC_WATCH_DIRS,
  SMART_ADD_DIR,
  WORKSPACE,
  getSharedMemoryManager,
} from "./memory-manager-runtime.js";

const KG_PATH = resolve(HOME_DIR, ".openclaw/workspace/knowledge-graph.json");
const LANCEDB_PATH = resolve(HOME_DIR, ".openclaw/memory/lancedb");
const EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-4B";
const MEMORY_SUPPLEMENT_SENTINEL = "MEMORY_SUPPLEMENT_SENTINEL";
const MEMORY_SUPPLEMENT_BOUNDARY_START = "<!-- MEMORY_ENGINE_SUPPLEMENT_START -->";
const MEMORY_SUPPLEMENT_BOUNDARY_END = "<!-- MEMORY_ENGINE_SUPPLEMENT_END -->";

// ── LanceDB globals (initialized in register) ──
let lancedbTable = null;
const indexSyncState = {
  lastSyncAt: 0,
  lastMaxMtimeMs: 0,
};

/**
 * Generate embedding via SiliconFlow embedding API.
 */
async function generateEmbedding(text) {
  const apiKey = resolveSFKey();
  if (!apiKey) throw new Error("SiliconFlow API key not found");

  const { https } = await import('node:https');
  const url = new URL("/v1/embeddings", getSFBaseUrl());
  const body = JSON.stringify({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 8000),
  });

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          resolve(parsed.data?.[0]?.embedding || []);
        } catch (e) {
          reject(new Error(`Embedding parse: ${e.message}`));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Initialize LanceDB: connect and ensure the chunks table exists.
 */
async function initLanceDB() {
  try {
    const db = await lancedb.connect(LANCEDB_PATH);
    const tableNames = await db.tableNames();
    if (tableNames.includes('chunks')) {
      lancedbTable = await db.openTable('chunks');
    } else {
      lancedbTable = await db.createTable('chunks', [
        { id: crypto.randomUUID(), text: "", vector: new Array(2560).fill(0), timestamp: Date.now() }
      ]);
    }
    console.log("[memory-engine] LanceDB initialized at", LANCEDB_PATH);
    return true;
  } catch (e) {
    console.warn("[memory-engine] LanceDB init skipped:", e.message);
    return false;
  }
}

const CATEGORY_MAP = {
  temporary:       { conf: 0.40, tau: 2.0 },
  raw_log:         { conf: 0.50, tau: 7.0 },
  episodic:        { conf: 0.70, tau: 30.0 },
  preference:      { conf: 0.70, tau: 30.0 },
  kg_node:         { conf: 0.85, tau: 90.0 },
  user_identity:   { conf: 0.95, tau: 365.0 },
};

function withDb(fn) {
  const db = new Database(DB_PATH, { readonly: false });
  try { return fn(db); } finally { db.close(); }
}

function calcTau(hits, baseTau) {
  if (baseTau >= 365.0) return baseTau;
  return baseTau + (365.0 - baseTau) * (1 - Math.exp(-0.3 * hits));
}

function catParams(category, isProtected) {
  if (isProtected || category === "user_identity") return { conf: 0.95, tau: 365.0 };
  return CATEGORY_MAP[category] || CATEGORY_MAP.raw_log;
}

/**
 * Auto-route text to an appropriate category via regex rules.
 * Only overrides when no explicit category was passed (or raw_log default).
 */
function autoRouteCategory(text, metadata = {}) {
  if (metadata.category && metadata.category !== 'raw_log') {
    return metadata.category;
  }
  if (/api[_-]?key|voice[_-]?id|model\s*[:=]|\/[a-z0-9_\/\.-]+\.[a-z]{2,5}|[a-f0-9]{32,}/i.test(text)) {
    return 'preference';
  }
  if (/我是|我叫|我的名字|我的职业|我在.*工作|我住在/.test(text)) {
    return 'user_identity';
  }
  if (/暂时|临时|一次性|仅这次|就现在|当前会话|测试一下|试试看/.test(text)) {
    return 'temporary';
  }
  if (/我喜欢|我习惯|我偏好|我常用|我一般|我倾向于|记住|别忘了|以后都|下次|我的设置/.test(text)) {
    return 'preference';
  }
  if (/决定|结论|总结|教训|经验|最终选择|定下来|确定了/.test(text)) {
    return 'preference';
  }
  return 'raw_log';
}

function calcRealtimeConf(row, now) {
  if (row.is_protected) return row.confidence;
  if (!row.last_confidence_update) return row.confidence;
  const deltaDays = (now - row.last_confidence_update) / 86400;
  const tau = calcTau(row.hit_count, row.base_tau);
  let c = row.confidence * Math.exp(-deltaDays / tau);
  if (row.conflict_flag) c -= 0.5;
  return Math.max(0, c);
}

function ensureConfidenceTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_confidence (
      chunk_id TEXT PRIMARY KEY,
      initial_confidence REAL NOT NULL DEFAULT 0.5,
      confidence REAL NOT NULL DEFAULT 0.5,
      last_confidence_update INTEGER,
      base_tau REAL NOT NULL DEFAULT 7.0,
      hit_count INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      is_protected INTEGER NOT NULL DEFAULT 0,
      conflict_flag INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'raw_log',
      kg_data TEXT
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_mc_archived ON memory_confidence(is_archived)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_mc_category ON memory_confidence(category)");
}

function ensureMemoryEventsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      session_id TEXT,
      trace_id TEXT,
      memory_id TEXT,
      latency_ms INTEGER,
      candidate_count INTEGER,
      injected_count INTEGER,
      cited_count INTEGER,
      vector_score REAL,
      fts_score REAL,
      final_score REAL,
      source TEXT,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_memory_events_created ON memory_events(created_at)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_memory_events_trace ON memory_events(trace_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_memory_events_session ON memory_events(session_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_memory_events_type ON memory_events(event_type)");
}

function ensureMemoryEngineTables(db) {
  ensureConfidenceTable(db);
  ensureMemoryEventsTable(db);
}

function recordMemoryEvent(event) {
  try {
    withDb(db => {
      ensureMemoryEventsTable(db);
      db.prepare([
        "INSERT INTO memory_events",
        "(event_type, session_id, trace_id, memory_id, latency_ms, candidate_count, injected_count, cited_count, vector_score, fts_score, final_score, source, metadata_json)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ].join(" ")).run(
        event.event_type,
        event.session_id || null,
        event.trace_id || null,
        event.memory_id || null,
        event.latency_ms ?? null,
        event.candidate_count ?? null,
        event.injected_count ?? null,
        event.cited_count ?? null,
        event.vector_score ?? null,
        event.fts_score ?? null,
        event.final_score ?? null,
        event.source || null,
        event.metadata_json ? JSON.stringify(event.metadata_json) : null
      );
    });
  } catch (e) {
    console.warn("[memory-engine] memory event write failed:", e.message);
  }
}

function buildRecallCompletedMetadata({
  skipped = false,
  skip_reason = null,
  candidate_count = 0,
  candidate_count_before_gate = 0,
  candidate_count_after_gate = 0,
  strict_count = 0,
  fallback_count = 0,
  post_rerank_count = 0,
  injected_count = 0,
} = {}) {
  return {
    skipped: Boolean(skipped),
    skip_reason: skip_reason || null,
    candidate_count: Number(candidate_count) || 0,
    candidate_count_before_gate: Number(candidate_count_before_gate) || 0,
    candidate_count_after_gate: Number(candidate_count_after_gate) || 0,
    strict_count: Number(strict_count) || 0,
    fallback_count: Number(fallback_count) || 0,
    post_rerank_count: Number(post_rerank_count) || 0,
    injected_count: Number(injected_count) || 0,
  };
}

function gateThresholdForCategory(category, minCoverage = null) {
  const normalized = String(category || "raw_log").toLowerCase();
  const finalScoreMin =
    normalized === "raw_log" ? 0.05 :
    normalized === "episodic" ? 0.02 :
    null;
  return {
    final_score_min: finalScoreMin,
    min_coverage: Number.isFinite(minCoverage) ? Number(minCoverage) : null,
  };
}

function buildAutoRecallDebugMetadata(prompt, result, skipReason = null) {
  const debugInfo = result?.debug || {};
  const strippedPrompt = stripPromptMetadataPrefix(prompt);
  const normalizedQuery = String(debugInfo.query_normalized || normalizeFtsQuery(strippedPrompt));
  const finalFtsQuery = String(
    debugInfo.fts_query_final ||
    buildFtsFallbackQuery(strippedPrompt) ||
    normalizedQuery
  );
  const postRerankTopK = Array.isArray(debugInfo.post_rerank_topK) ? debugInfo.post_rerank_topK : [];
  return {
    query_original: String(prompt || ""),
    query_stripped: String(debugInfo.query_stripped || strippedPrompt),
    query_normalized: normalizedQuery,
    fts_query_final: finalFtsQuery,
    fallbacks_triggered: Array.isArray(debugInfo.fallbacks_triggered) ? debugInfo.fallbacks_triggered : [],
    candidate_count: Number(result?.results?.length || 0),
    strict_count: Number(debugInfo.strict_count ?? 0),
    fallback_count: Number(debugInfo.fallback_count ?? 0),
    post_rerank_count: postRerankTopK.length,
    post_rerank_topK: postRerankTopK,
    candidate_count_before_gate: Number(debugInfo.candidate_count_before_gate ?? result?.results?.length ?? 0),
    candidate_count_after_gate: Number(debugInfo.candidate_count_after_gate ?? result?.results?.length ?? 0),
    rejected_candidates: Array.isArray(debugInfo.rejected_candidates) ? debugInfo.rejected_candidates : [],
    gate_decisions: Array.isArray(debugInfo.gate_decisions) ? debugInfo.gate_decisions : [],
    injected_count: Number(debugInfo.injected_count ?? 0),
    skipped: Boolean(skipReason),
    skip_reason: skipReason || null,
    candidate_counts_before_filtering: debugInfo.candidate_counts_before_filtering || {},
  };
}

function batchReinforce(db, ids, nowSec) {
  const stmt = db.prepare([
    "UPDATE memory_confidence SET",
    "hit_count = hit_count + 1,",
    "confidence = MIN(1.0, confidence + 0.1),",
    "last_confidence_update = ?",
    "WHERE chunk_id = ?"
  ].join(" "));
  const txn = db.transaction(() => {
    let count = 0;
    for (const id of ids) {
      stmt.run(nowSec, id);
      if (stmt.changes > 0) count++;
    }
    return count;
  });
  return txn();
}

function resolveHookSessionId(event, ctx) {
  return event?.sessionId ||
    event?.session_id ||
    event?.sessionKey ||
    ctx?.sessionId ||
    ctx?.sessionKey ||
    ctx?.runId ||
    null;
}

function resolvePrefixes(db, prefixes) {
  const results = [];
  for (const pf of prefixes) {
    const rows = db.prepare([
      "SELECT chunk_id FROM memory_confidence WHERE chunk_id LIKE ? || '%' LIMIT 1"
    ].join(" ")).all(pf);
    if (rows.length > 0) results.push(rows[0].chunk_id);
  }
  return results;
}

function collectIndexedFiles() {
  const files = [];

  for (const dirRel of INDEX_SYNC_WATCH_DIRS) {
    const absDir = resolve(WORKSPACE, dirRel);
    if (!existsSync(absDir)) continue;
    let entries = [];
    try {
      entries = readdirSync(absDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const absFile = resolve(absDir, entry);
      let stat;
      try {
        stat = statSync(absFile);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      const relPath = absFile.replace(WORKSPACE + "/", "");
      files.push({
        relPath,
        absPath: absFile,
        mtimeMs: stat.mtimeMs,
      });
    }
  }

  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return files;
}

function tableExists(db, name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?").get(name);
  return !!row;
}

function readIndexedPathState(db, pathList) {
  if (!Array.isArray(pathList) || pathList.length <= 0) {
    return { paths: [], updatedAt: {} };
  }
  if (!tableExists(db, "chunks")) {
    return { paths: [], updatedAt: {} };
  }
  const placeholders = pathList.map(() => "?").join(", ");
  const rows = db.prepare([
    "SELECT path, MAX(updated_at) AS updated_at",
    "FROM chunks",
    `WHERE path IN (${placeholders})`,
    "GROUP BY path",
  ].join(" ")).all(...pathList);
  const paths = rows.map(r => r.path).sort((a, b) => a.localeCompare(b));
  const updatedAt = {};
  for (const row of rows) {
    updatedAt[row.path] = row.updated_at ?? null;
  }
  return { paths, updatedAt };
}

function extractCategoryFromText(text = "") {
  const match = String(text || "").match(/(?:^|\n)Category:\s*([a-z_]+)/i);
  return match?.[1] ? String(match[1]).toLowerCase() : "";
}

function inferCategoryFromChunk(path = "", text = "") {
  const fromText = extractCategoryFromText(text);
  if (fromText && CATEGORY_MAP[fromText]) return fromText;
  if (String(path).startsWith("memory/episodes/")) return "episodic";
  return "raw_log";
}

function deriveCandidateSources({ path = "", category = "", text = "" }) {
  const tags = [];
  const p = String(path);
  const c = String(category).toLowerCase();
  const t = String(text).toLowerCase();
  if (p.startsWith("memory/smart-add/")) tags.push("smart-add");
  if (p.startsWith("memory/episodes/") || c === "episodic") tags.push("episodic");
  if (/session\s*checkpoint|session[_ -]?key|session[_ -]?id/.test(t) || /session[-_]?checkpoint/i.test(p)) {
    tags.push("session_checkpoint");
  }
  return tags;
}

function tokenizeQuery(text, maxTerms = 10) {
  return extractQueryTokens(text, maxTerms);
}

function lexicalMatchScore(haystack, terms) {
  if (!Array.isArray(terms) || terms.length === 0) return 0;
  const raw = String(haystack || "").toLowerCase();
  let matched = 0;
  for (const term of terms) {
    if (!term) continue;
    if (raw.includes(term)) matched += 1;
  }
  if (matched === 0) return 0;
  return Math.round((matched / terms.length) * 10000) / 10000;
}

function backfillConfidenceForIndexedChunks(db, nowSec) {
  const rows = db.prepare(`
    SELECT c.id, c.path, c.text
    FROM chunks c
    LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
    WHERE mc.chunk_id IS NULL
      AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
    ORDER BY c.updated_at DESC
    LIMIT 500
  `).all();
  if (rows.length === 0) return { scanned: 0, inserted: 0 };

  const insert = db.prepare([
    "INSERT OR IGNORE INTO memory_confidence",
    "(chunk_id, initial_confidence, confidence, last_confidence_update,",
    "base_tau, hit_count, is_archived, is_protected, conflict_flag, category)",
    "VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?)"
  ].join(" "));
  let inserted = 0;
  const txn = db.transaction(() => {
    for (const row of rows) {
      const category = inferCategoryFromChunk(row.path, row.text);
      const { conf, tau } = catParams(category, false);
      const info = insert.run(row.id, conf, conf, nowSec, tau, category);
      if (info.changes > 0) inserted += 1;
    }
  });
  txn();
  return { scanned: rows.length, inserted };
}

async function syncIndexIfNeeded(reason = "autoRecall") {
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const scannedFiles = collectIndexedFiles();
  const stats = {
    fileCount: scannedFiles.length,
    maxMtimeMs: scannedFiles.reduce((m, f) => Math.max(m, f.mtimeMs), 0),
  };
  const scannedPaths = scannedFiles.map(f => f.relPath);
  const changed = stats.maxMtimeMs > indexSyncState.lastMaxMtimeMs;
  const needsInitialSync = indexSyncState.lastSyncAt === 0;
  const beforeState = withDb(db => readIndexedPathState(db, scannedPaths));

  if (!changed && !needsInitialSync) {
    return withDb(db => ({
      synced: false,
      reason: "fresh",
      memory_root: WORKSPACE,
      watch_dirs: [...INDEX_SYNC_WATCH_DIRS],
      files: stats.fileCount,
      scanned_paths: scannedPaths,
      indexed_paths_before: beforeState.paths,
      indexed_paths_after: beforeState.paths,
      skipped_paths: scannedPaths.filter(p => !beforeState.paths.includes(p)),
      updated_at: beforeState.updatedAt,
      changed_paths: [],
      manager_dirty_before: null,
      force_sync: false,
      backfill: backfillConfidenceForIndexedChunks(db, nowSec),
    }));
  }

  const previousMaxMtimeMs = indexSyncState.lastMaxMtimeMs;
  const changedPaths = scannedFiles
    .filter(f => f.mtimeMs > previousMaxMtimeMs)
    .map(f => f.relPath);
  indexSyncState.lastMaxMtimeMs = Math.max(indexSyncState.lastMaxMtimeMs, stats.maxMtimeMs);
  try {
    const { manager } = await getSharedMemoryManager();
    if (manager) {
      const managerStatusBefore = typeof manager.status === "function" ? manager.status() : null;
      const managerDirtyBefore = Boolean(managerStatusBefore?.dirty);
      const forceSync = changed && !managerDirtyBefore;
      await manager.sync(forceSync ? { reason, force: true } : { reason });
      indexSyncState.lastSyncAt = nowMs;
      const afterState = withDb(db => readIndexedPathState(db, scannedPaths));
      return withDb(db => ({
        synced: true,
        reason,
        memory_root: WORKSPACE,
        watch_dirs: [...INDEX_SYNC_WATCH_DIRS],
        files: stats.fileCount,
        scanned_paths: scannedPaths,
        indexed_paths_before: beforeState.paths,
        indexed_paths_after: afterState.paths,
        skipped_paths: scannedPaths.filter(p => !afterState.paths.includes(p)),
        updated_at: afterState.updatedAt,
        changed_paths: changedPaths,
        manager_dirty_before: managerDirtyBefore,
        force_sync: forceSync,
        backfill: backfillConfidenceForIndexedChunks(db, nowSec),
      }));
    }
  } catch {}

  const fallbackAfterState = withDb(db => readIndexedPathState(db, scannedPaths));
  return withDb(db => ({
    synced: false,
    reason: "manager_unavailable",
    memory_root: WORKSPACE,
    watch_dirs: [...INDEX_SYNC_WATCH_DIRS],
    files: stats.fileCount,
    scanned_paths: scannedPaths,
    indexed_paths_before: beforeState.paths,
    indexed_paths_after: fallbackAfterState.paths,
    skipped_paths: scannedPaths.filter(p => !fallbackAfterState.paths.includes(p)),
    updated_at: fallbackAfterState.updatedAt,
    changed_paths: changedPaths,
    manager_dirty_before: null,
    force_sync: false,
    backfill: backfillConfidenceForIndexedChunks(db, nowSec),
  }));
}

function computeRecencyBoost(createdAtSec, nowSec) {
  if (!createdAtSec || !Number.isFinite(createdAtSec)) return 0;
  const ageDays = Math.max(0, (nowSec - createdAtSec) / 86400);
  // Keep recency as a tie-breaker, not the dominant ranking signal.
  const boost = 0.06 * Math.exp(-ageDays / 2.5);
  return Math.round(boost * 10000) / 10000;
}

function computeCategoryBoost(category, text = "") {
  const cat = String(category || "").toLowerCase();
  if (cat === "episodic") return 0.12;
  const raw = String(text || "").toLowerCase();
  if (raw.includes("session checkpoint") || raw.includes("session-checkpoint")) return 0.1;
  return 0;
}

async function hybridSearch(text, { topK = 5 } = {}) {
  const k = topK || 5;
  const nowSec = Math.floor(Date.now() / 1000);
  const channels = {};
  const rawQuery = String(text || "");
  const strippedQuery = stripPromptMetadataPrefix(rawQuery);
  const normalizedQuery = normalizeFtsQuery(strippedQuery);
  const fallbackFtsQuery = buildFtsFallbackQuery(strippedQuery);
  const queryTerms = tokenizeQuery(normalizedQuery);
  const candidateCounts = {
    vector_raw: 0,
    vector_after_conf_filter: 0,
    fts_raw_primary: 0,
    fts_raw_final: 0,
    like_raw: 0,
    recent_raw: 0,
    episode_raw: 0,
    recent_fallback_raw: 0,
  };
  const debug = {
    query_original: rawQuery,
    query_stripped: strippedQuery,
    query_normalized: normalizedQuery,
    fts_query_final: normalizedQuery,
    vector_query: strippedQuery,
    query_terms: queryTerms,
    candidate_counts_before_filtering: candidateCounts,
    fallbacks_triggered: [],
    strict_count: 0,
    fallback_count: 0,
    post_rerank_topK: [],
  };

  try {
    debug.sync = await syncIndexIfNeeded("hybridSearch");
  } catch (e) {
    debug.sync = { synced: false, reason: "sync_error", error: e.message };
  }

  try {
    const { manager } = await getMemorySearchManager({});
    if (manager) {
      const raw = await manager.search(strippedQuery, { limit: 30 });
      const candidates = raw?.entries || raw || [];
      candidateCounts.vector_raw = candidates.length;
      const scored = withDb(db => {
        const confRows = db.prepare(`SELECT chunk_id, confidence, last_confidence_update, base_tau, hit_count, is_protected, conflict_flag, category, is_archived FROM memory_confidence`).all();
        const confMap = new Map(confRows.map(r => [r.chunk_id, r]));
        const tsRows = db.prepare("SELECT id, path, updated_at FROM chunks").all();
        const tsMap = new Map(tsRows.map(r => [r.id, r.updated_at || 0]));
        const pathMap = new Map(tsRows.map(r => [r.id, r.path || ""]));
        const res = [];
        for (const c of candidates) {
          const id = c.id || c.chunkId;
          if (!id) continue;
          const meta = confMap.get(id);
          if (!meta || meta.is_archived) continue;
          const rtConf = meta.is_protected ? meta.confidence : calcRealtimeConf(meta, nowSec);
          res.push({
            id,
            text: (c.text || c.content || "").slice(0, 600),
            category: meta.category,
            similarity: Math.round((c.similarity ?? c.score ?? 0.5) * 10000) / 10000,
            confidence_realtime: Math.round(rtConf * 10000) / 10000,
            hit_count: meta.hit_count,
            created_at: tsMap.get(id) || 0,
            path: pathMap.get(id) || "",
          });
        }
        res.sort((a, b) => b.similarity - a.similarity);
        return res.slice(0, 30);
      });
      candidateCounts.vector_after_conf_filter = scored.length;
      if (scored.length > 0) channels.vector = scored;
    }
  } catch (e) {}

  let ftsIsEmpty = true;
  try {
    if (normalizedQuery) {
      const ftsSelectSql = `
        SELECT c.id, c.text,
          c.path,
          c.updated_at,
          COALESCE(mc.confidence, 0.5) as confidence,
          mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,
          COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,
          COALESCE(mc.conflict_flag, 0) as conflict_flag, COALESCE(mc.category, 'raw_log') as category
        FROM chunks_fts f
        JOIN chunks c ON c.id = f.id
        LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
        WHERE chunks_fts MATCH ?
          AND COALESCE(mc.is_archived, 0) = 0
        ORDER BY bm25(chunks_fts, 0)
        LIMIT 20
      `;
      const strictRows = withDb(db => db.prepare(ftsSelectSql).all(normalizedQuery));
      candidateCounts.fts_raw_primary = strictRows.length;
      debug.strict_count = strictRows.length;
      if (strictRows.length > 0) {
        ftsIsEmpty = false;
        candidateCounts.fts_raw_final = strictRows.length;
        debug.fts_query_final = normalizedQuery;
        channels.fts = strictRows.map(row => ({
          id: row.id,
          text: row.text.slice(0, 600),
          category: row.category,
          similarity: 0.5,
          confidence_realtime: row.is_protected ? row.confidence : Math.round(calcRealtimeConf(row, nowSec) * 10000) / 10000,
          hit_count: row.hit_count,
          created_at: row.updated_at || 0,
          path: row.path || "",
        }));
      } else if (fallbackFtsQuery && fallbackFtsQuery !== normalizedQuery) {
        const fallbackRows = withDb(db => db.prepare(ftsSelectSql).all(fallbackFtsQuery));
        debug.fallback_count = fallbackRows.length;
        candidateCounts.fts_raw_final = fallbackRows.length;
        debug.fts_query_final = fallbackFtsQuery;
        ftsIsEmpty = fallbackRows.length === 0;
        if (fallbackRows.length > 0) {
          const reranked = rankFtsFallbackCandidates(fallbackRows, {
            rawQuery: strippedQuery,
            queryTerms,
            nowSec,
            topK: 20,
          });
          debug.post_rerank_topK = reranked.post_rerank_topK;
          channels.fts = reranked.ranked.map(row => ({
            id: row.id,
            text: String(row.text || "").slice(0, 600),
            category: row.category,
            similarity: row.fallback_score,
            confidence_realtime: row.is_protected ? row.confidence : Math.round(calcRealtimeConf(row, nowSec) * 10000) / 10000,
            hit_count: row.hit_count,
            created_at: row.updated_at || 0,
            path: row.path || "",
          }));
        }
      } else {
        candidateCounts.fts_raw_final = strictRows.length;
      }
    }
  } catch (e) {}

  if (ftsIsEmpty) {
    debug.fallbacks_triggered.push("fts_empty");
    try {
      const likePatterns = buildLikeFallbackPatterns(normalizedQuery, 8);
      debug.like_patterns = likePatterns;
      if (likePatterns.length > 0) {
        const likeRows = withDb(db => {
          const where = likePatterns.map(() => "(c.path LIKE ? OR c.text LIKE ?)").join(" OR ");
          const sql = `
            SELECT c.id, c.text, c.path, c.updated_at,
              COALESCE(mc.confidence, 0.5) as confidence,
              mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,
              COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,
              COALESCE(mc.conflict_flag, 0) as conflict_flag, COALESCE(mc.category, 'raw_log') as category
            FROM chunks c
            LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
            WHERE COALESCE(mc.is_archived, 0) = 0
              AND (${where})
            ORDER BY c.updated_at DESC
            LIMIT 30
          `;
          const params = likePatterns.flatMap(pattern => [pattern, pattern]);
          return db.prepare(sql).all(...params);
        });
        candidateCounts.like_raw = likeRows.length;
        if (likeRows.length > 0) {
          debug.fallbacks_triggered.push("like_search");
          channels.like = likeRows.map(row => {
            const lexical = lexicalMatchScore(`${row.path}\n${row.text}`, queryTerms);
            return {
              id: row.id,
              text: row.text.slice(0, 600),
              category: row.category,
              similarity: Math.round((0.3 + lexical) * 10000) / 10000,
              confidence_realtime: row.is_protected ? row.confidence : Math.round(calcRealtimeConf(row, nowSec) * 10000) / 10000,
              hit_count: row.hit_count,
              created_at: row.updated_at || 0,
              path: row.path || "",
            };
          });
        }
      }
    } catch {}
  }

  try {
    const recentRows = withDb(db => db.prepare(`
      SELECT c.id, c.text, c.path, c.updated_at,
        COALESCE(mc.confidence, 0.5) as confidence,
        mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,
        COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,
        COALESCE(mc.conflict_flag, 0) as conflict_flag, COALESCE(mc.category, 'raw_log') as category
      FROM chunks c
      LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
      WHERE COALESCE(mc.is_archived, 0) = 0
        AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
      ORDER BY c.updated_at DESC
      LIMIT 120
    `).all());
    candidateCounts.recent_raw = recentRows.length;
    const scoredRecent = recentRows
      .map(row => {
        const category = row.category || inferCategoryFromChunk(row.path, row.text);
        const lexical = lexicalMatchScore(`${row.path}\n${row.text}`, queryTerms);
        if (lexical <= 0) return null;
        const recency = computeRecencyBoost(row.updated_at || 0, nowSec);
        return {
          id: row.id,
          text: row.text.slice(0, 600),
          category,
          similarity: Math.round((0.35 + lexical + recency) * 10000) / 10000,
          confidence_realtime: row.is_protected ? row.confidence : Math.round(calcRealtimeConf(row, nowSec) * 10000) / 10000,
          hit_count: row.hit_count,
          created_at: row.updated_at || 0,
          path: row.path || "",
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 20);
    if (scoredRecent.length > 0) channels.recent = scoredRecent;

    const episodeRows = scoredRecent
      .filter(row => row.category === "episodic" || String(row.path).startsWith("memory/episodes/"))
      .map(row => ({ ...row, similarity: Math.round((row.similarity + 0.08) * 10000) / 10000 }))
      .slice(0, 20);
    candidateCounts.episode_raw = episodeRows.length;
    if (episodeRows.length > 0) channels.episode = episodeRows;
  } catch {}

  if (ftsIsEmpty) {
    if (candidateCounts.like_raw === 0 && Array.isArray(channels.vector) && channels.vector.length > 0) {
      debug.fallbacks_triggered.push("vector_only");
    }
    try {
      const recentFallbackRows = withDb(db => db.prepare(`
        SELECT c.id, c.text, c.path, c.updated_at,
          COALESCE(mc.confidence, 0.5) as confidence,
          mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,
          COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,
          COALESCE(mc.conflict_flag, 0) as conflict_flag, COALESCE(mc.category, 'raw_log') as category
        FROM chunks c
        LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
        WHERE COALESCE(mc.is_archived, 0) = 0
          AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
        ORDER BY c.updated_at DESC
        LIMIT 20
      `).all());
      candidateCounts.recent_fallback_raw = recentFallbackRows.length;
      if (recentFallbackRows.length > 0) {
        debug.fallbacks_triggered.push("recent_episodic");
        channels.recent_fallback = recentFallbackRows.map(row => {
          const category = row.category || inferCategoryFromChunk(row.path, row.text);
          const recency = computeRecencyBoost(row.updated_at || 0, nowSec);
          return {
            id: row.id,
            text: row.text.slice(0, 600),
            category,
            similarity: Math.round((0.25 + recency) * 10000) / 10000,
            confidence_realtime: row.is_protected ? row.confidence : Math.round(calcRealtimeConf(row, nowSec) * 10000) / 10000,
            hit_count: row.hit_count,
            created_at: row.updated_at || 0,
            path: row.path || "",
          };
        });
      }
    } catch {}
  }

  const names = Object.keys(channels);
  if (names.length === 0) return { pool: 0, results: [], channels: [], note: "no channels returned results" };

  const fusion = new Map();
  for (const [chName, rankedItems] of Object.entries(channels)) {
    rankedItems.forEach((item, idx) => {
      const exist = fusion.get(item.id) || {
        id: item.id,
        text: item.text,
        category: item.category,
        channels: [],
        semantic_sources: [],
        sources: [],
        rrfScore: 0,
        recencyBoost: 0,
        categoryBoost: 0,
        finalScore: 0,
        similarity: item.similarity,
        confidence_realtime: item.confidence_realtime,
        hits: item.hit_count,
        created_at: item.created_at || 0,
        path: item.path || "",
      };
      if (!exist.channels.includes(chName)) exist.channels.push(chName);
      const semanticTags = deriveCandidateSources(item);
      for (const tag of semanticTags) {
        if (!exist.semantic_sources.includes(tag)) exist.semantic_sources.push(tag);
      }
      exist.rrfScore += 1 / (60 + idx + 1);
      if (!exist.path && item.path) exist.path = item.path;
      if (!exist.category && item.category) exist.category = item.category;
      fusion.set(item.id, exist);
    });
  }

  const fused = Array.from(fusion.values()).map(item => {
    item.rrfScore = Math.round(item.rrfScore * 10000) / 10000;
    item.recencyBoost = computeRecencyBoost(item.created_at, nowSec);
    item.categoryBoost = computeCategoryBoost(item.category, item.text);
    item.finalScore = Math.round((item.rrfScore + item.recencyBoost + item.categoryBoost) * 10000) / 10000;
    item.sources = [...new Set([...item.channels, ...item.semantic_sources])];
    return item;
  });

  const preRerank = [...fused]
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, 8)
    .map(item => ({
      id: item.id.slice(0, 16),
      score: item.rrfScore,
      category: item.category,
      sources: item.sources,
      path: item.path,
      preview: String(item.text || "").slice(0, 100),
    }));

  const postRerank = [...fused]
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, 8)
    .map(item => ({
      id: item.id.slice(0, 16),
      score: item.finalScore,
      rrf_score: item.rrfScore,
      recency_boost: item.recencyBoost,
      category_boost: item.categoryBoost,
      category: item.category,
      sources: item.sources,
      path: item.path,
      preview: String(item.text || "").slice(0, 100),
    }));

  const sourceBreakdown = {};
  const categoryBreakdown = {};
  for (const item of fused) {
    for (const src of item.sources) {
      sourceBreakdown[src] = (sourceBreakdown[src] || 0) + 1;
    }
    const cat = item.category || "unknown";
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
  }

  const fusedSorted = [...fused].sort((a, b) => b.finalScore - a.finalScore);
  const debugInfo = {
    ...debug,
    channel_sizes: Object.fromEntries(Object.entries(channels).map(([name, items]) => [name, items.length])),
    source_breakdown: sourceBreakdown,
    category_breakdown: categoryBreakdown,
    pre_rerank_top: preRerank,
    post_rerank_top: postRerank,
  };

  const results = fusedSorted.slice(0, k).map(item => ({
    id: item.id.slice(0, 16),
    text: item.text.slice(0, 240),
    path: item.path || "",
    category: item.category,
    rrf_score: item.rrfScore,
    recency_boost: item.recencyBoost,
    category_boost: item.categoryBoost,
    final_score: item.finalScore,
    sources: item.sources,
    similarity: item.similarity,
    confidence: item.confidence_realtime,
    hits: item.hits,
    created_at: item.created_at || 0,
  }));

  return {
    pool: fusedSorted.length,
    channels: names,
    channel_sizes: Object.fromEntries(Object.entries(channels).map(([name, items]) => [name, items.length])),
    debug: debugInfo,
    results,
  };
}

function resolveSFKey() {
  try {
    const cfg = JSON.parse(readFileSync(resolve(homedir(), '.openclaw/openclaw.json'), 'utf-8'));
    return cfg.models?.providers?.siliconflow?.apiKey || '';
  } catch(e) { return ''; }
}

export default definePluginEntry({
  id: "memory-engine",
  name: "Memory Engine",
  description: "Smart memory with confidence scoring, time-decay, and lifecycle management.",
  contracts: {
    tools: true,
  },
  register(api) {
    // Ensure confidence table exists at startup
    try {
      withDb(db => ensureMemoryEngineTables(db));
    } catch (e) {
      console.error("[memory-engine] failed to init confidence table:", e.message);
    }

    // Initialize LanceDB (async, fire-and-forget)
    initLanceDB().catch(e => console.warn("[memory-engine] LanceDB init deferred:", e.message));


    const autoRecallTraceByRun = new Map();
    const autoRecallTraceBySession = new Map();
    const pluginEntryConfig = api.config?.plugins?.entries?.["memory-engine"]?.config;
    const autoRecallConfig =
      api.pluginConfig?.autoRecall ||
      pluginEntryConfig?.autoRecall ||
      api.config?.autoRecall ||
      {};
    if (autoRecallConfig.enabled && typeof api.on === "function") {
      const autoRecallTopK = Math.max(1, Number(autoRecallConfig.topK || 3));
      const autoRecallTimeoutMs = Math.max(1000, Number(autoRecallConfig.timeoutMs || 8000));
      console.log(`[memory-engine] autoRecall hook registered topK=${autoRecallTopK} timeoutMs=${autoRecallTimeoutMs}`);
      api.on("before_prompt_build", async (event, ctx) => {
        try {
          const prompt = String(event?.prompt || "").trim();
          const traceId = crypto.randomUUID();
          const startedAt = Date.now();
          const sessionId = resolveHookSessionId(event, ctx);
          const skipReason = explainAutoRecallSkip(prompt);
          if (skipReason) {
            const skipDebugMetadata = buildAutoRecallDebugMetadata(prompt, null, skipReason);
            recordMemoryEvent({
              event_type: "auto_recall_debug",
              session_id: sessionId,
              trace_id: traceId,
              source: "autoRecall",
              metadata_json: skipDebugMetadata,
            });
            recordMemoryEvent({
              event_type: "recall_completed",
              session_id: sessionId,
              trace_id: traceId,
              latency_ms: Date.now() - startedAt,
              candidate_count: 0,
              injected_count: 0,
              source: "autoRecall",
              metadata_json: buildRecallCompletedMetadata({
                skipped: true,
                skip_reason: skipReason,
                candidate_count: 0,
                strict_count: 0,
                fallback_count: 0,
                post_rerank_count: 0,
              }),
            });
            return;
          }
          recordMemoryEvent({ event_type: "recall_started", session_id: sessionId, trace_id: traceId, source: "autoRecall", metadata_json: { prompt: prompt.slice(0, 500), topK: autoRecallTopK } });
          const result = await hybridSearch(prompt, { topK: autoRecallTopK });
          const hits = result?.results?.length || 0;
          const gateDebug = {
            candidate_count_before_gate: hits,
            candidate_count_after_gate: 0,
            rejected_candidates: [],
            gate_decisions: [],
            injected_count: 0,
          };
          const gateQuery = String(result?.debug?.query_stripped || stripPromptMetadataPrefix(prompt));
          const gatedResults = (Array.isArray(result?.results) ? result.results : []).filter(candidate => {
            const gate = shouldInjectCandidate(candidate, gateQuery, gateDebug);
            const category = String(candidate?.category || "raw_log").toLowerCase();
            const id = String(candidate?.id || "").slice(0, 16);
            const finalScoreRaw = Number(candidate?.final_score ?? candidate?.finalScore ?? candidate?.rrf_score ?? 0);
            const finalScore = Number.isFinite(finalScoreRaw) ? Number(finalScoreRaw.toFixed(6)) : 0;
            const decision = {
              id,
              injected: Boolean(gate?.inject),
              rejection_reason: gate?.reason || null,
              rejected_reason: gate?.rejected_reason || gate?.reason || null,
              matched_key_classes: Array.isArray(gate?.matched_key_classes) ? gate.matched_key_classes : [],
              threshold_used: gateThresholdForCategory(category, gate?.min_coverage),
              category,
              final_score: finalScore,
            };
            gateDebug.gate_decisions.push(decision);
            if (gate?.inject) return true;
            gateDebug.rejected_candidates.push({
              id,
              category,
              reason: gate?.reason || "gated",
              rejected_reason: gate?.rejected_reason || gate?.reason || "gated",
              matched_key_classes: Array.isArray(gate?.matched_key_classes) ? gate.matched_key_classes : [],
              preview: String(candidate?.text || "").slice(0, 120),
            });
            return false;
          });
          gateDebug.candidate_count_after_gate = gatedResults.length;
          gateDebug.injected_count = Math.min(gatedResults.length, autoRecallTopK);
          result.debug = {
            ...(result?.debug || {}),
            ...gateDebug,
          };
          console.log(`[memory-engine] autoRecall: prompt="${prompt.slice(0,60)}" hits=${hits} topK=${autoRecallTopK}`);
          const debugInfo = result?.debug || {};
          const postRerankCount = Array.isArray(debugInfo.post_rerank_topK) ? debugInfo.post_rerank_topK.length : 0;
          recordMemoryEvent({
            event_type: "auto_recall_debug",
            session_id: sessionId,
            trace_id: traceId,
            source: "autoRecall",
            metadata_json: buildAutoRecallDebugMetadata(prompt, result),
          });
          console.log(
            `[memory-engine] autoRecall.debug query original="${String(debugInfo.query_original || "").slice(0, 160)}" normalized="${String(debugInfo.query_normalized || "").slice(0, 160)}" fts_final="${String(debugInfo.fts_query_final || "").slice(0, 160)}" vector_query="${String(debugInfo.vector_query || "").slice(0, 160)}"`
          );
          console.log(
            `[memory-engine] autoRecall.debug strict_count=${debugInfo.strict_count ?? 0} fallback_count=${debugInfo.fallback_count ?? 0} candidate_counts_before_filtering=${JSON.stringify(debugInfo.candidate_counts_before_filtering || {})} fallbacks=${JSON.stringify(debugInfo.fallbacks_triggered || [])} gate_before=${debugInfo.candidate_count_before_gate ?? hits} gate_after=${debugInfo.candidate_count_after_gate ?? hits} rejected=${Array.isArray(debugInfo.rejected_candidates) ? debugInfo.rejected_candidates.length : 0}`
          );
          if (Array.isArray(debugInfo.post_rerank_topK) && debugInfo.post_rerank_topK.length > 0) {
            console.log(`[memory-engine] autoRecall.debug post_rerank_topK=${JSON.stringify(debugInfo.post_rerank_topK)}`);
          }
          console.log(`[memory-engine] autoRecall.debug channels=${JSON.stringify(result?.channel_sizes || {})} source_breakdown=${JSON.stringify(debugInfo.source_breakdown || {})} category_breakdown=${JSON.stringify(debugInfo.category_breakdown || {})} sync=${JSON.stringify(debugInfo.sync || {})}`);
          if (Array.isArray(debugInfo.pre_rerank_top)) {
            console.log(`[memory-engine] autoRecall.debug pre_rerank_top=${JSON.stringify(debugInfo.pre_rerank_top)}`);
          }
          if (Array.isArray(debugInfo.post_rerank_top)) {
            console.log(`[memory-engine] autoRecall.debug post_rerank_top=${JSON.stringify(debugInfo.post_rerank_top)}`);
          }
          if (hits > 0) {
            console.log(`[memory-engine] autoRecall.debug query="${prompt.slice(0, 160)}" candidates=${result.results.map(r => r.id).join(",")}`);
            result.results.slice(0, 5).forEach((r, i) => {
              const id = String(r.id || "").slice(0, 16);
              const c = r.category || "?";
              const conf = r.confidence ?? r.confidence_realtime ?? "?";
              const finalScore = r.final_score ?? r.rrf_score ?? "?";
              const rrfScore = r.rrf_score ?? "?";
              const recencyBoost = r.recency_boost ?? 0;
              const categoryBoost = r.category_boost ?? 0;
              const createdAt = r.created_at ? new Date(r.created_at * 1000).toISOString() : "n/a";
              console.log(`  #${i+1} [${id}] finalScore=${finalScore} rrfScore=${rrfScore} recencyBoost=${recencyBoost} categoryBoost=${categoryBoost} cat=${c} conf=${conf} createdAt=${createdAt} preview="${(r.text||"").slice(0,100)}"`);
            });
          }
          const sessionIdForEvents = resolveHookSessionId(event, ctx);
          result.results.slice(0, Math.max(3, autoRecallTopK)).forEach((r, i) => {
            const id = String(r.id || "").slice(0, 16);
            recordMemoryEvent({
              event_type: "memory_candidate_retrieved",
              session_id: sessionIdForEvents,
              trace_id: traceId,
              memory_id: id,
              final_score: r.final_score ?? r.rrf_score,
              source: "autoRecall",
              metadata_json: { rank: i + 1, category: r.category, confidence: r.confidence, sources: r.sources, preview: (r.text || "").slice(0, 200) }
            });
          });
          const prependContext = formatAutoRecallContext(gatedResults, { topK: autoRecallTopK });
          if (!prependContext) {
            recordMemoryEvent({
              event_type: "recall_completed",
              session_id: sessionIdForEvents,
              trace_id: traceId,
              latency_ms: Date.now() - startedAt,
              candidate_count: hits,
              injected_count: 0,
              source: "autoRecall",
              metadata_json: buildRecallCompletedMetadata({
                skipped: false,
                skip_reason: null,
                candidate_count: hits,
                candidate_count_before_gate: Number(debugInfo.candidate_count_before_gate ?? hits),
                candidate_count_after_gate: Number(debugInfo.candidate_count_after_gate ?? 0),
                strict_count: Number(debugInfo.strict_count ?? 0),
                fallback_count: Number(debugInfo.fallback_count ?? 0),
                post_rerank_count: postRerankCount,
                injected_count: 0,
              }),
            });
            return;
          }
          const gateDecisions = Array.isArray(debugInfo.gate_decisions) ? debugInfo.gate_decisions : [];
          const gateDecisionById = new Map(gateDecisions.map(item => [String(item?.id || ""), item]));
          console.log(`[memory-engine] AUTO_RECALL_GATE_ACTIVE trace_id=${traceId} total_candidates=${gateDecisions.length} gated_injected=${Math.min(gatedResults.length, autoRecallTopK)}`);
          gateDecisions.forEach(item => {
            console.log(
              `[memory-engine] autoRecall.gate decision id=${String(item?.id || "")} injected=${Boolean(item?.injected)} rejection_reason=${item?.rejection_reason || "none"} rejected_reason=${item?.rejected_reason || "none"} matched_key_classes=${JSON.stringify(item?.matched_key_classes || [])} threshold_used=${JSON.stringify(item?.threshold_used || null)} category=${String(item?.category || "raw_log")} final_score=${Number(item?.final_score ?? 0)}`
            );
            recordMemoryEvent({
              event_type: "auto_recall_debug",
              session_id: sessionIdForEvents,
              trace_id: traceId,
              memory_id: String(item?.id || null),
              source: "autoRecall",
              metadata_json: {
                debug_type: "gate_decision",
                injected: Boolean(item?.injected),
                rejection_reason: item?.rejection_reason || null,
                rejected_reason: item?.rejected_reason || item?.rejection_reason || null,
                matched_key_classes: Array.isArray(item?.matched_key_classes) ? item.matched_key_classes : [],
                threshold_used: item?.threshold_used || null,
                category: String(item?.category || "raw_log"),
                final_score: Number(item?.final_score ?? 0),
              },
            });
          });
          const injectedIds = gatedResults.slice(0, autoRecallTopK).map(r => String(r.id || "").slice(0, 16));
          gatedResults.slice(0, autoRecallTopK).forEach(r => {
            const id = String(r.id || "").slice(0, 16);
            const decision = gateDecisionById.get(id);
            const category = String(r.category || decision?.category || "raw_log").toLowerCase();
            const thresholdUsed = decision?.threshold_used || gateThresholdForCategory(category, null);
            const finalScoreRaw = Number(r.final_score ?? r.finalScore ?? r.rrf_score ?? decision?.final_score ?? 0);
            const finalScore = Number.isFinite(finalScoreRaw) ? Number(finalScoreRaw.toFixed(6)) : 0;
            recordMemoryEvent({
              event_type: "memory_injected",
              session_id: sessionIdForEvents,
              trace_id: traceId,
              memory_id: id,
              final_score: finalScore,
              source: "autoRecall",
              metadata_json: {
                injected: true,
                rejection_reason: null,
                threshold_used: thresholdUsed,
                category,
                final_score: finalScore,
                confidence: r.confidence,
                preview: (r.text || "").slice(0, 200),
              }
            });
          });
          recordMemoryEvent({
            event_type: "recall_completed",
            session_id: sessionIdForEvents,
            trace_id: traceId,
            latency_ms: Date.now() - startedAt,
            candidate_count: hits,
            injected_count: Math.min(gatedResults.length, autoRecallTopK),
            source: "autoRecall",
            metadata_json: buildRecallCompletedMetadata({
              skipped: false,
              skip_reason: null,
              candidate_count: hits,
              candidate_count_before_gate: Number(debugInfo.candidate_count_before_gate ?? hits),
              candidate_count_after_gate: Number(debugInfo.candidate_count_after_gate ?? gatedResults.length),
              strict_count: Number(debugInfo.strict_count ?? 0),
              fallback_count: Number(debugInfo.fallback_count ?? 0),
              post_rerank_count: postRerankCount,
              injected_count: Math.min(gatedResults.length, autoRecallTopK),
            }),
          });
          const traceState = { traceId, sessionId: sessionIdForEvents, injectedIds };
          const runKey = ctx?.runId || event?.runId;
          if (runKey) autoRecallTraceByRun.set(runKey, traceState);
          if (sessionIdForEvents) autoRecallTraceBySession.set(sessionIdForEvents, traceState);
          return { prependContext };
        } catch (e) {
          api.logger?.warn?.(`memory-engine autoRecall skipped: ${e.message}`);
          return;
        }
      }, { timeoutMs: autoRecallTimeoutMs });

      api.on("before_agent_finalize", async (event, ctx) => {
        try {
          const text = event?.lastAssistantMessage || "";
          const citedIds = parseCitedMemoryIds(text);
          if (citedIds.length === 0) return;
          const sessionId = resolveHookSessionId(event, ctx);
          const traceState =
            autoRecallTraceByRun.get(event?.runId || ctx?.runId) ||
            autoRecallTraceBySession.get(sessionId);
          const allowed = new Set(traceState?.injectedIds || []);
          const idsToReinforce = citedIds.filter(id => allowed.size === 0 || allowed.has(id.slice(0, 16)));
          if (idsToReinforce.length === 0) return;
          const fullIds = withDb(db => {
            const resolved = resolvePrefixes(db, idsToReinforce);
            if (resolved.length > 0) batchReinforce(db, resolved, Math.floor(Date.now() / 1000));
            return resolved;
          });
          for (const id of fullIds) {
            recordMemoryEvent({
              event_type: "memory_cited",
              session_id: sessionId,
              trace_id: traceState?.traceId || event?.runId || ctx?.runId || null,
              memory_id: id.slice(0, 16),
              cited_count: 1,
              source: "autoRecall.finalize",
              metadata_json: { cited_memory_ids: citedIds, runId: event?.runId || ctx?.runId || null }
            });
            recordMemoryEvent({
              event_type: "memory_reinforced",
              session_id: sessionId,
              trace_id: traceState?.traceId || event?.runId || ctx?.runId || null,
              memory_id: id.slice(0, 16),
              source: "autoRecall.finalize"
            });
          }
        } catch (e) {
          api.logger?.warn?.(`memory-engine autoRecall citation finalize skipped: ${e.message}`);
        }
      });
    }

    // Register memory prompt supplement — guides agent to cite memory IDs
    api.registerMemoryPromptSupplement((_params) => {
      const sessionId = resolveHookSessionId(_params, _params?.ctx || _params);
      const injected = sessionId ? (autoRecallTraceBySession.get(sessionId)?.injectedIds || []) : [];
      const supplement = [
        MEMORY_SUPPLEMENT_BOUNDARY_START,
        `${MEMORY_SUPPLEMENT_SENTINEL}: active`,
        `MEMORY_SUPPLEMENT_INJECTED_COUNT: ${injected.length}`,
        "## Memory Engine - 记忆置信度系统",
        "",
        "### 工作流",
        "1. **搜索记忆** → `memory_engine` action=`search`, text=`你的问题`",
        "2. **引用强化** → 如果你用了上一步的搜索结果来回答，必须调 `memory_engine` action=`cite`, chunk_ids=[结果中的id]",
        "3. **存储新记忆** → 需要长期记住的事实，用 `memory_engine` action=`add`",
        "",
        "规则：引用搜索结果却不调 `cite`，那些记忆会随时间衰减消失。",
        "每次 `cite` 让记忆更牢固（hit+1, conf+0.1, 半衰期延长）。",
        MEMORY_SUPPLEMENT_BOUNDARY_END,
      ];
      console.log(`[memory-engine] supplement.injected memory_count=${injected.length} preview="${supplement.slice(0, 4).join(" | ").slice(0, 180)}"`);
      return supplement;
    });

    api.registerTool({
      name: "memory_engine",
      label: "Memory Engine",
      description: [
        `智能记忆系统 — 置信度评分 + 时间衰减 + 引用强化。\n`,
        `\n=== 最常用操作 ===\n`,
        `search -> 搜索记忆。写 text=你的查询。返回结果带 id/confidence/score。\n`,
        `cite   -> 引用强化。把 search 返回的 id 放入 chunk_ids 数组。巩固记忆。\n`,
        `add    -> 存新记忆。写 text=内容，推荐指定 category（见下）。\n`,
        `\n=== 其他操作 ===\n`,
        `status -> 查看统计。\n`,
        `archive -> 标记低置信度记忆为已归档。\n`,
        `update -> 手动更新某条记忆的字段。\n`,
        `\n=== category 建议 ===\n`,
        `user_identity: 用户身份/职业/核心特征（protected, 不衰减）\n`,
        `preference: 用户偏好/习惯（τ=30天）\n`,
        `kg_node: 知识图谱结构结论（τ=90天）\n`,
        `raw_log: 日常对话/未提炼想法（τ=7天, 默认）\n`,
        `temporary: 临时/一次性（τ=2天）\n`,
        `episodic: 情节摘要（τ=30天）\n`,
        `\n重要：用 search 后必须 cite（或 update --hit），否则记忆会衰减。`,
      ].join(''),
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["add", "search", "cite", "update", "status", "archive", "kg-bridge", "detect-conflicts"],
          },
          text: { type: "string" },
          category: {
            type: "string",
            enum: ["temporary", "raw_log", "episodic", "preference", "kg_node", "user_identity"],
          },
          protected: { type: "boolean" },
          chunk_id: { type: "string" },
          chunk_ids: {
            type: "array",
            items: { type: "string" },
            description: "List of chunk ID prefixes to cite/reinforce",
          },
          hit: { type: "boolean" },
          deep: { type: "boolean", description: "Use LLM for semantic contradiction check (slow path)" },
          top_k: { type: "number", default: 5 },
        },
        required: ["action"],
      },

      execute: async (_toolCallId, params) => {
        const { action, text, category, protected: isProtected, chunk_id, hit, top_k, deep } = params;
        const k = top_k || 5;
        const nowSec = Math.floor(Date.now() / 1000);

        try {
          if (action === "add") {
            if (!text) return { error: "text required for add" };
            // ── Auto-route category via rule engine ──
            const cat = autoRouteCategory(text, { category });
            const now = new Date();
            const dateStr = localDateKey(now);
            const ts = now.toISOString().replace(/[:.]/g, "").slice(0, 15);
            const entryId = `${ts}_${cat}`;
            const fileDir = resolve(WORKSPACE, SMART_ADD_DIR);
            const filePath = resolve(fileDir, `${dateStr}.md`);
            const fingerprint = buildSmartAddFingerprint(text, cat, isProtected);
            const appendResult = appendSmartAdd({
              fileDir,
              filePath,
              entryId,
              category: cat,
              isProtected,
              text,
              fingerprint,
              syncCli: false,
            });
            if (!appendResult.appended) {
              return {
                success: true,
                deduped: true,
                reason: appendResult.reason,
                category: cat,
              };
            }

            // Sync via manager — populates SQLite chunks + FTS5
            try {
              await syncIndexIfNeeded("memory_engine.add");
            } catch (e) {
              // fallback: reindex may happen on next cycle
            }

            // Get new chunks
            const { conf, tau } = catParams(cat, isProtected);
            let lanceWritten = 0;

            const result = withDb(db => {
              const fileRel = filePath.replace(WORKSPACE + "/", "");
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
            if (!text) return { error: "query text required for search" };

            // Channel 1: Vector search via OpenClaw manager
            let vectorCandidates = [];
            try {
              const { manager } = await getMemorySearchManager({});
              if (manager) {
                const raw = await manager.search(text, { limit: 30 });
                vectorCandidates = raw?.entries || raw || [];
              }
            } catch (e) {}

            // Channel 1b: LanceDB vector search (if initialized)
            let lanceCandidates = [];
            if (lancedbTable) {
              try {
                const queryVec = await generateEmbedding(text);
                if (queryVec && queryVec.length > 0) {
                  const rawLance = await lancedbTable.search(queryVec).limit(30).execute();
                  if (rawLance) {
                    // LanceDB v2 returns async iterable, not Array
                    let lanceRows = [];
                    if (typeof rawLance[Symbol.asyncIterator] === 'function') {
                      for await (const batch of rawLance) {
                        for (const row of batch) lanceRows.push(row);
                      }
                    } else if (Array.isArray(rawLance)) {
                      lanceRows = rawLance;
                    }

                    if (lanceRows.length > 0) {
                      lanceCandidates = withDb(db => {
                        const confMap = new Map();
                        const confRows = db.prepare(`SELECT chunk_id, confidence, last_confidence_update, base_tau, hit_count, is_protected, conflict_flag, category FROM memory_confidence`).all();
                        for (const r of confRows) confMap.set(r.chunk_id, r);
                        return lanceRows
                          .filter(l => confMap.has(l.id))
                          .map(l => {
                            const meta = confMap.get(l.id);
                            return {
                              id: l.id, text: (l.text || '').slice(0, 600),
                              category: meta.category,
                              similarity: l._distance !== undefined ? 1 - l._distance : 0.6,
                              confidence_realtime: meta.is_protected ? meta.confidence
                                : Math.round(calcRealtimeConf(meta, nowSec) * 10000) / 10000,
                              hit_count: meta.hit_count,
                              is_protected: meta.is_protected,
                              conflict_flag: meta.conflict_flag,
                            };
                          })
                          .sort((a, b) => b.similarity - a.similarity)
                          .slice(0, 30);
                      });
                    }
                  }
                }
              } catch (e) {
                // LanceDB query failed, non-fatal
              }
            }

            // Channel 2: FTS5 full-text search
            let ftsCandidates = [];
            try {
              const safeQuery = sanitizeFtsQuery(text);
              if (safeQuery) {
                withDb(db => {
                  ftsCandidates = db.prepare(`
                    SELECT c.id, c.text,
                      COALESCE(mc.confidence, 0.5) as confidence,
                      mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,
                      COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,
                      COALESCE(mc.conflict_flag, 0) as conflict_flag, COALESCE(mc.category, 'raw_log') as category
                    FROM chunks_fts f
                    JOIN chunks c ON c.id = f.id
                    LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
                    WHERE chunks_fts MATCH ?
                      AND COALESCE(mc.is_archived, 0) = 0
                    ORDER BY bm25(chunks_fts, 0)
                    LIMIT 20
                  `).all(safeQuery);
                });
              }
            } catch (e) {}

            // Channel 3: KG bridge (if kg.js exists)
            let kgCandidates = [];
            let kgActive = false;
            const kgJsonPath = resolve(WORKSPACE, 'knowledge-graph.json');
            const kgModulePath = resolve(WORKSPACE, 'skills/jpeng-knowledge-graph-memory');
            try {
              if (existsSync(kgJsonPath) && existsSync(resolve(kgModulePath, 'index.js'))) {
                const KG = require(kgModulePath);
                const data = JSON.parse(readFileSync(kgJsonPath, 'utf-8'));
                const kg = KG.KnowledgeGraph.fromJSON(data);
                const concepts = kg.search({ name: text });
                if (Array.isArray(concepts) && concepts.length > 0) {
                  kgActive = true;
                  const names = concepts.map(c => c.name).filter(Boolean);
                  if (names.length > 0) {
                    withDb(db => {
                      const seen = new Set();
                      for (const name of names) {
                        const safeName = sanitizeFtsQuery(name);
                        if (!safeName || safeName.length < 2) continue;
                        const rows = db.prepare([
                          'SELECT DISTINCT c.id, c.text,',
                          '  COALESCE(mc.confidence, 0.5) as confidence,',
                          '  mc.last_confidence_update, COALESCE(mc.base_tau, 7.0) as base_tau,',
                          '  COALESCE(mc.hit_count, 0) as hit_count, COALESCE(mc.is_protected, 0) as is_protected,',
                          '  COALESCE(mc.conflict_flag, 0) as conflict_flag, COALESCE(mc.category, \'raw_log\') as category',
                          'FROM chunks_fts f',
                          'JOIN chunks c ON c.id = f.id',
                          'LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id',
                          'WHERE chunks_fts MATCH ?',
                          '  AND COALESCE(mc.is_archived, 0) = 0',
                          'ORDER BY bm25(chunks_fts, 0)',
                          'LIMIT 3'
                        ].join('\n')).all(safeName);
                        for (const row of rows) {
                          if (seen.has(row.id)) continue;
                          seen.add(row.id);
                          kgCandidates.push(row);
                          if (kgCandidates.length >= 15) break;
                        }
                        if (kgCandidates.length >= 15) break;
                      }
                    });
                  }
                }
              }
            } catch (e) {}

            // Build channels from candidates
            const channels = {};

            if (vectorCandidates.length > 0) {
              const scored = withDb(db => {
                const confRows = db.prepare(`SELECT chunk_id, confidence, last_confidence_update, base_tau, hit_count, is_protected, conflict_flag, category, is_archived FROM memory_confidence`).all();
                const confMap = new Map(confRows.map(r => [r.chunk_id, r]));
                const res = [];
                for (const c of vectorCandidates) {
                  const id = c.id || c.chunkId;
                  if (!id) continue;
                  const meta = confMap.get(id);
                  if (!meta || meta.is_archived) continue;
                  const rtConf = meta.is_protected ? meta.confidence : calcRealtimeConf(meta, nowSec);
                  const sim = c.similarity ?? c.score ?? 0.5;
                  res.push({
                    id, text: (c.text || c.content || "").slice(0, 600),
                    category: meta.category,
                    similarity: Math.round(sim * 10000) / 10000,
                    confidence_realtime: Math.round(rtConf * 10000) / 10000,
                    hit_count: meta.hit_count,
                    is_protected: meta.is_protected,
                    conflict_flag: meta.conflict_flag,
                  });
                }
                res.sort((a, b) => b.similarity - a.similarity);
                return res.slice(0, 30);
              });
              if (scored.length > 0) channels.vector = scored;
            }

            // Channel 1b: LanceDB
            if (lanceCandidates.length > 0) {
              channels.lance = lanceCandidates;
            }

            if (ftsCandidates.length > 0) {
              channels.fts = ftsCandidates.map(row => ({
                id: row.id, text: row.text.slice(0, 600),
                category: row.category,
                similarity: 0.5,
                confidence_realtime: row.is_protected ? row.confidence
                  : Math.round(calcRealtimeConf(row, nowSec) * 10000) / 10000,
                hit_count: row.hit_count,
                is_protected: row.is_protected,
                conflict_flag: row.conflict_flag,
              }));
            }

            if (kgCandidates.length > 0) {
              channels.kg = kgCandidates.map(row => ({
                id: row.id, text: row.text.slice(0, 600),
                category: row.category,
                similarity: 0.5,
                confidence_realtime: row.is_protected ? row.confidence
                  : Math.round(calcRealtimeConf(row, nowSec) * 10000) / 10000,
                hit_count: row.hit_count,
                is_protected: row.is_protected,
                conflict_flag: row.conflict_flag,
              }));
            }

            const channelCount = Object.keys(channels).length;
            if (channelCount === 0) {
              return { pool: 0, results: [], channels: [], note: "no channels returned results" };
            }

            // RRF fusion
            const fusion = new Map();
            for (const [chName, rankedItems] of Object.entries(channels)) {
              rankedItems.forEach((item, idx) => {
                const exist = fusion.get(item.id) || {
                  id: item.id, text: item.text, category: item.category,
                  sources: [], rrfScore: 0,
                  similarity: item.similarity, confidence_realtime: item.confidence_realtime,
                  hits: item.hit_count,
                };
                exist.sources.push(chName);
                let acc = 0;
                for (const [cn, items] of Object.entries(channels)) {
                  const rank = items.findIndex(i => i.id === item.id);
                  if (rank >= 0) acc += 1 / (60 + rank + 1);
                }
                exist.rrfScore = Math.round(acc * 10000) / 10000;
                fusion.set(item.id, exist);
              });
            }

            const fused = Array.from(fusion.values());
            fused.sort((a, b) => b.rrfScore - a.rrfScore);
            const results = fused.slice(0, k).map(item => ({
              id: item.id.slice(0, 16),
              text: item.text.slice(0, 200),
              category: item.category,
              rrf_score: item.rrfScore,
              sources: item.sources,
              similarity: item.similarity,
              confidence: item.confidence_realtime,
              hits: item.hits,
            }));

            return {
              pool: fused.length,
              channels: Object.keys(channels),
              channel_sizes: Object.fromEntries(Object.entries(channels).map(([k, v]) => [k, v.length])),
              kg_active: kgActive,
              results,
            };
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
            const threshold = api.config?.archiveThreshold ?? 0.15;
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
              const now = Math.floor(Date.now() / 1000);
              // Simple heuristic: find chunks with same category that have divergent confidence
              const rows = db.prepare([
                "SELECT m1.chunk_id as id1, m2.chunk_id as id2,",
                "m1.category, m1.confidence as c1, m2.confidence as c2,",
                "m1.hit_count as h1, m2.hit_count as h2",
                "FROM memory_confidence m1",
                "JOIN memory_confidence m2 ON m1.category = m2.category",
                "AND m1.chunk_id < m2.chunk_id",
                "WHERE m1.is_archived = 0 AND m2.is_archived = 0",
                "AND ABS(m1.confidence - m2.confidence) > 0.3",
                "AND ABS(m1.hit_count - m2.hit_count) > 3"
              ].join(" ")).all();

              let flagged = 0;
              const flagStmt = db.prepare([
                "UPDATE memory_confidence SET conflict_flag = 1 WHERE chunk_id = ?"
              ].join(" "));
              for (const row of rows) {
                // Flag the lower-confidence one as possibly outdated
                const lowerId = row.c1 < row.c2 ? row.id1 : row.id2;
                flagStmt.run(lowerId);
                flagged++;
              }
              return {
                success: true,
                pairs_checked: rows.length,
                flagged_as_conflict: flagged,
                note: "Lower-confidence chunks in same category with divergent hit counts flagged",
              };
            });
          }

          return { error: "unknown action", available: ["add", "search", "cite", "update", "status", "archive", "kg-bridge", "detect-conflicts"] };
        } catch (e) {
          return { error: e.message };
        }
      },
    });

    // Image Vision tool — 识别图片内容
    api.registerTool({
      name: "image_vision",
      label: "图片识别",
      description: "识别图片中的物体、场景、人物、动作等非文字内容。调用 Qwen3-VL-32B-Instruct (SiliconFlow)。传入图片路径和可选问句。",
      parameters: {
        type: "object",
        properties: {
          image_path: {
            type: "string",
            description: "图片文件路径（绝对路径或相对于工作区的路径）",
          },
          question: {
            type: "string",
            description: "问句，如省略则默认让模型描述图片内容",
          },
        },
        required: ["image_path"],
      },
      async execute(_id, params) {
        try {
          const { execSync } = await import("child_process");
          const scriptPath = resolve(WORKSPACE, "scripts/image-vision.py");
          const imagePath = params.image_path;
          const question = params.question || "请详细描述这张图片中的内容，包括物体、场景、人物（如有）、动作、氛围等。用中文回答。";
          
          if (!existsSync(scriptPath)) {
            return { content: [{ type: "text", text: `脚本不存在: ${scriptPath}` }] };
          }
          
          const result = execSync(
            `python3 ${scriptPath} ${JSON.stringify(imagePath)} ${JSON.stringify(question)}`,
            { encoding: "utf-8", timeout: 120000 }
          );
          
          return { content: [{ type: "text", text: result.trim() }] };
        } catch (e) {
          return { content: [{ type: "text", text: `图片识别失败: ${e.message}` }] };
        }
      },
    });
  },
});
