#!/usr/bin/env node
/**
 * session-checkpoint.js — 每日 Session 结束前的强制检查点
 *
 * 运行方式：cron 每日 03:55（系统切 session 前）
 * 功能：
 *   1. 检查今天的 raw_log，提取潜在配置信息
 *   2. 未识别的配置自动写入 preference 记忆
 *   3. 生成今日摘要（episode），供新 session 注入
 */

const https = require("node:https");
const crypto = require("node:crypto");
const { resolve } = require("node:path");
const { readFileSync, existsSync, appendFileSync, mkdirSync, writeFileSync, readdirSync } = require("node:fs");
const checkpointDate = require("../lib/checkpoint/date");
const checkpointConfig = require("../lib/checkpoint/config");
const checkpointCompleteness = require("../lib/checkpoint/completeness");
const { writeConfidence } = require("../lib/checkpoint/confidence-writer");
const checkpointDb = require("../lib/checkpoint/db");
const checkpointEpisodeWriter = require("../lib/checkpoint/episode-writer");
const checkpointLlm = require("../lib/checkpoint/llm");
const checkpointMarkers = require("../lib/checkpoint/markers");
const checkpointRawLog = require("../lib/checkpoint/raw-log");
const { getRuntime, withRuntime } = require("../lib/checkpoint/runtime");
const runtimeRegistry = require("../lib/checkpoint/runtime");
const { withDb, withMeDb, inspectBusyTimeouts } = checkpointDb;
const { writeEmptyEpisode, writeIncompleteEpisode, writeLLMTimeoutEpisode } = checkpointMarkers;
const { parseSmartAddEntries } = checkpointRawLog;

// Paths
const SMART_ADD_DIR = "memory/smart-add";
const EPISODES_DIR = "memory/episodes";

function currentIsoString() {
  return new Date(getRuntime().now()).toISOString();
}

function todayDateStr() {
  const rt = getRuntime();
  return checkpointDate.todayDateStr(rt.now(), rt.timeZone);
}

/**
 * Returns YESTERDAY's date string (YYYY-MM-DD) in business timezone (Asia/Shanghai).
 * The script runs at 03:55 CST to process the previous day's data.
 */
function yesterdayDateStr(now = null) {
  const rt = getRuntime();
  return checkpointDate.yesterdayDateStr(now || rt.now(), rt.timeZone);
}

function buildNightlyEntryId({ targetDate, category = "episodic", generatedAt = null } = {}) {
  const rt = getRuntime();
  return checkpointDate.buildNightlyEntryId({
    targetDate,
    category,
    generatedAt: generatedAt || rt.now(),
    timeZone: rt.timeZone,
  });
}

function mergeKgData(existingKgData, patch = {}) {
  let base = {};
  if (existingKgData && typeof existingKgData === "object") {
    base = { ...existingKgData };
  } else if (typeof existingKgData === "string" && existingKgData.trim()) {
    try {
      base = JSON.parse(existingKgData);
    } catch (_) {
      base = {};
    }
  }
  if (patch && typeof patch === "object") {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) base[key] = value;
    }
  }
  return JSON.stringify(base);
}

// ── Read today's raw content ──

// ── Unified Nightly Smart Extraction ──

/**
 * Map LLM-extracted memory type to memory_engine category.
 */
function mapToCategory(type) {
  const map = {
    'profile': 'user_identity',
    'preference': 'preference',
    'entity': 'kg_node',
    'event': 'episodic',
    'case': 'episodic',
    'pattern': 'preference'
  };
  return map[type] || 'raw_log';
}

/**
 * Write a single entry to the smart-add file + confidence table.
 */
function appendSmartAdd(text, category, opts = {}) {
  const today = todayDateStr();
  const fileDir = getRuntime().smartAddDir;
  const filePath = resolve(fileDir, `${today}.md`);
  mkdirSync(fileDir, { recursive: true });
  const fingerprint = smartAddFingerprint({ category, raw: text, kg_data: opts.kg_data });
  const existing = readSmartAddFingerprints(today);
  if (existing.has(fingerprint)) return null;

  const generatedAt = opts.generatedAt || getRuntime().now();
  const entryId = opts.entryId || buildNightlyEntryId({
    targetDate: opts.targetDate || yesterdayDateStr(generatedAt),
    category,
    generatedAt,
  });
  const entry = `<!-- smart-add-fingerprint: ${fingerprint} -->\n## ${entryId}\n\nCategory: ${category}${opts.protected ? " | Protected" : ""}${opts.kg_data ? `\n\nkg_data: ${opts.kg_data}` : ""}\n\n${text.trim()}\n\n`;

  const header = !existsSync(filePath) ? "# Smart Added Memory\n\n" : "";
  appendFileSync(filePath, header ? entry : `\n${entry}`);

  return entryId;
}

function canonicalizeSmartAddEntry({ raw = "", category = "", kg_data = "" }) {
  const normalized = String(raw || "").replace(/\r\n/g, "\n");
  const withoutTitle = normalized.replace(/^\s*##\s+.*\n?/, "");
  const withoutComments = withoutTitle.replace(/<!--[\s\S]*?-->/g, "");
  const cat = String(category || "").trim();
  const kg = String(kg_data || "").trim();
  const base = cat ? `Category: ${cat}${kg ? `\n\nkg_data: ${kg}` : ""}\n\n${withoutComments}` : withoutComments;
  return base.replace(/\s+/g, " ").trim();
}

function smartAddFingerprint(entry) {
  const canonical = canonicalizeSmartAddEntry(entry || {});
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function parseNodeProperties(text) {
  const raw = String(text || "");
  const nodeMatch = raw.match(/^Node:\s*(.+)$/mi);
  const propsMatch = raw.match(/^Properties:\s*(.+)$/mi);
  return {
    node: nodeMatch ? nodeMatch[1].trim() : "",
    properties: propsMatch ? propsMatch[1].trim() : "",
  };
}

function readSmartAddFingerprints(date = todayDateStr()) {
  const filePath = resolve(getRuntime().smartAddDir, `${date}.md`);
  if (!existsSync(filePath)) return new Set();
  const content = readFileSync(filePath, "utf-8");
  const fpCommentRe = /<!--\s*smart-add-fingerprint:\s*([a-f0-9]{8,64})\s*-->/gi;
  const parsed = parseSmartAddEntries(content);
  const set = new Set();
  let match;
  while ((match = fpCommentRe.exec(content)) !== null) {
    if (match[1]) set.add(String(match[1]).toLowerCase());
  }
  for (const entry of parsed) {
    const fp = smartAddFingerprint({ raw: entry.raw || entry.text });
    set.add(fp);
  }
  return set;
}

/**
 * Quick dedup via FTS5: check if a similar entry already exists.
 */
function isDuplicate(text, category = "raw_log") {
  try {
    const fp = smartAddFingerprint({ category, raw: text });
    const todayFp = readSmartAddFingerprints(todayDateStr());
    if (todayFp.has(fp)) return true;

    // Check FTS5 in main.sqlite first (doesn't need memory_confidence)
    const ftsMatch = withDb((db) => {
      const fts = db.prepare(`
        SELECT COUNT(*) as cnt FROM chunks_fts
        WHERE chunks_fts MATCH ?
      `).get(text.replace(/[^\w\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 5).join(' '));
      return fts && fts.cnt > 0;
    });
    if (ftsMatch) return true;

    // Fallback via withMeDb (memory_confidence lives in memory-engine.sqlite, chunks in main.sqlite ATTACHed)
    const keyFrags = text.match(/[\u4e00-\u9fff\w]{4,}/g) || [];
    const sig = keyFrags.slice(0, 3).join('|');
    if (!sig) return false;

    return withMeDb((db) => {
      const existing = db.prepare(`
        SELECT COUNT(*) as cnt FROM chunks_db.chunks c
        JOIN memory_confidence mc ON c.id = mc.chunk_id
        WHERE mc.is_archived = 0
        AND (c.text LIKE ? OR c.text LIKE ? OR c.text LIKE ?)
      `).get(`%${keyFrags[0]||''}%`, `%${keyFrags[1]||''}%`, `%${keyFrags[2]||''}%`);
      return (existing && existing.cnt >= 2);
    });
  } catch (e) {
    return false;
  }
}

/**
 * Run the full nightly checkpoint: one LLM call → 4 outputs.
 */
async function nightlyCheckpoint(rawLogs) {
  const episodeDate = yesterdayDateStr();
  const generatedAt = currentIsoString();
  const assessment = checkpointCompleteness.assessCheckpointCompleteness(rawLogs);
  const conversationLogs = assessment.conversationLogs;
  const allLogs = assessment.allLogs;
  const combinedText = assessment.combinedText;

  if (assessment.status === "no_raw_logs") {
    console.log("[checkpoint] No raw logs found — nothing to extract.");
    writeEmptyEpisode(episodeDate);
    return { memories: 0, episode: false, configs: 0 };
  }

  if (assessment.status === "all_logs_empty") {
    console.log("[checkpoint] All logs empty — nothing to extract.");
    writeEmptyEpisode(episodeDate);
    return { memories: 0, episode: false, configs: 0 };
  }

  if (assessment.status === "no_conversation") {
    console.log(`[checkpoint] No conversation logs found (${assessment.allCount} note entries only) — marking as incomplete, skipping LLM.`);
    writeIncompleteEpisode(episodeDate, assessment.allCount);
    return { memories: 0, episode: false, configs: 0, skipped: true, reason: "no_conversation_data" };
  }

  console.log(`[checkpoint] Conversation entries: ${assessment.conversationCount}, Total entries: ${assessment.allCount}`);

  // ── Single LLM call ──
  let extracted;
  try {
    extracted = await getRuntime().llmNightlyExtract(combinedText);
  } catch (error) {
    console.error(`[checkpoint] LLM extraction failed: ${error.message}`);
    writeLLMTimeoutEpisode(episodeDate);
    return { memories: 0, episode: false, configs: 0, timeout: true, error: error.message };
  }

  // ── Timeout guard: llm超时 → write marker episode and exit early ──
  if (extracted.error === "llm超时") {
    console.log("[checkpoint] llm超时 — both providers failed");
    writeLLMTimeoutEpisode(episodeDate);
    return { memories: 0, episode: false, configs: 0, timeout: true };
  }

  // ── 1. Write structured memories (6 types) ──
  let memWritten = 0;
  for (const item of extracted.smart_memories || []) {
    if (memWritten >= 10) break;
    if (!item.text || !item.type) continue;

    // Dedup check
    if (isDuplicate(item.text, mapToCategory(item.type))) {
      console.log(`  ↳ Skipped (duplicate): ${item.text.slice(0, 60)}`);
      continue;
    }

    const cat = mapToCategory(item.type);
    const stableText = String(item.text || "").trim();
    if (!stableText) continue;
    const entryId = appendSmartAdd(item.text, cat, {
      targetDate: episodeDate,
      generatedAt,
    });
    if (!entryId) {
      console.log(`  ↳ Skipped (duplicate/fingerprint): ${stableText.slice(0, 60)}`);
      continue;
    }
    try { writeConfidence(entryId, item.text, cat); } catch (e) {}
    memWritten++;
  }
  console.log(`[checkpoint] Wrote ${memWritten} structured memory(-ies)`);

  // ── 2. Write episode summary ──
  let episodeWritten = false;
  if (extracted.episode_summary && extracted.episode_summary.trim()) {
    const episodeText = extracted.episode_summary.trim();
    const kgData = mergeKgData(JSON.stringify({
      episode_of: rawLogs.map(r => r.chunk_id || '').filter(Boolean),
      date: episodeDate,
    }), {
      date: episodeDate,
      generatedAt,
      source_type: "checkpoint_llm",
      targetDate: episodeDate,
    });
    const entryId = appendSmartAdd(episodeText, 'episodic', {
      kg_data: kgData,
      targetDate: episodeDate,
      generatedAt,
    });
    if (entryId) {
      try { writeConfidence(entryId, episodeText, 'episodic'); } catch (e) {}
    } else {
      console.log("[checkpoint] Episode smart-add append skipped by fingerprint dedup");
    }

    // Default to valid; will be overridden if hallucination detected
    episodeWritten = true;

    // Validate: if no real conversation data found, any "讨论/进行/决定" is hallucination
    if (conversationLogs.length === 0) {
      const halluPatterns = [
        /讨论了/, /进行了/, /决定/, /确认/, /提到/,
        /讨论/, /对话/, /交流/, /沟通/, /商议/
      ];
      const isHallucinated = halluPatterns.some(p => p.test(episodeText));
      if (isHallucinated) {
        console.warn(`[checkpoint] ⚠️ Episode hallucinated (0 conversation logs, ${allLogs.length} note entries). Discarding.`);
        episodeWritten = false;
        writeIncompleteEpisode(episodeDate, allLogs.length);
      } else {
        // No conversation but no hallucination keywords — write data-only episode
        console.log(`[checkpoint] No conversation logs, but episode text doesn't mention discussion. Writing as-is.`);
      }
    }

    if (episodeWritten) {
      checkpointEpisodeWriter.writeEpisodeFiles({
        episodeDate,
        generatedAt,
        episodeText,
        configs: extracted.configs,
      });
    }
  }

  if (!episodeWritten) {
    writeEmptyEpisode(episodeDate);
  }

  // ── 3. Write configs (existing logic, same format) ──
  let cfgWritten = 0;
  for (const cfg of extracted.configs || []) {
    if (cfgWritten >= 10) break;
    if (!cfg.key || !cfg.value) continue;

    const text = `配置：${cfg.key} = ${cfg.value}（来源：${cfg.context || 'checkpoint'}）`;
    const entryId = appendSmartAdd(text, 'preference', {
      targetDate: episodeDate,
      generatedAt,
    });
    if (!entryId) {
      console.log(`  ↳ Skipped config (duplicate/fingerprint): ${cfg.key}`);
      continue;
    }
    try { writeConfidence(entryId, text, 'preference'); } catch (e) {}
    cfgWritten++;
  }
  console.log(`[checkpoint] Wrote ${cfgWritten} config(s)`);

  return {
    memories: memWritten,
    episode: episodeWritten,
    configs: cfgWritten,
    targetDate: episodeDate,
    generatedAt,
    source_type: "checkpoint_llm",
    category: "episodic",
  };
}

// ── 配置冲突自动标记 ──

function extractConfigKey(text) {
  // 匹配 "配置：<key> = <value>（来源：...）"
  const match = text.match(/配置[：:]\s*(\S[^=\n]*?)\s*[=:=]\s*\S/);
  if (match) return match[1].trim().toLowerCase();
  // 回退：匹配 "<key> = <value>" 或 "<key>: <value>"
  const fallback = text.match(/^\s*(\S[\w\-\/]+)\s*[=:=]\s*\S/);
  if (fallback) return fallback[1].trim().toLowerCase();
  return null;
}

function resolveConfigConflicts() {
  console.log("[checkpoint] Resolving config conflicts...");
  let flagged = 0;

  withMeDb((db) => {
    // 读取所有 preference 和非 archived 的条目 (memory_confidence in memory-engine.sqlite, chunks in ATTACHed main.sqlite)
    const rows = db.prepare([
      "SELECT mc.chunk_id, c.text, mc.last_confidence_update, mc.conflict_flag",
      "FROM memory_confidence mc",
      "JOIN chunks_db.chunks c ON c.id = mc.chunk_id",
      "WHERE mc.category = 'preference'",
      "AND mc.is_archived = 0",
      "ORDER BY mc.last_confidence_update DESC",
    ].join(" ")).all();

    // 按配置 key 分组
    const groups = {};
    for (const row of rows) {
      const key = extractConfigKey(row.text || "");
      if (!key) continue;
      if (!groups[key]) groups[key] = [];
      groups[key].push({
        chunk_id: row.chunk_id,
        text: (row.text || "").slice(0, 80),
        updated: row.last_confidence_update || 0,
        already_flagged: row.conflict_flag === 1,
      });
    }

    const updateStmt = db.prepare("UPDATE memory_confidence SET conflict_flag = 1 WHERE chunk_id = ?");
    const unflagStmt = db.prepare("UPDATE memory_confidence SET conflict_flag = 0 WHERE chunk_id = ?");

    for (const [key, entries] of Object.entries(groups)) {
      if (entries.length <= 1) {
        // 只有一条，确保没有误标记
        if (entries[0].already_flagged) {
          unflagStmt.run(entries[0].chunk_id);
          console.log(`  ↳ 解除冲突标记: ${key}（唯一条目）`);
        }
        continue;
      }

      // 按更新时间降序排列，第一条是最新的
      entries.sort((a, b) => b.updated - a.updated);
      const newest = entries[0];

      // 如果最新条目已被标记冲突，先解除
      if (newest.already_flagged) {
        unflagStmt.run(newest.chunk_id);
        console.log(`  ↳ 解除最新条目冲突标记: ${key}`);
      }

      // 标记所有旧条目
      for (let i = 1; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry.already_flagged) {
          updateStmt.run(entry.chunk_id);
          flagged++;
          console.log(`  ⚠️  冲突标记: ${key} | 旧: ${entry.text.slice(0, 50)} | 新: ${newest.text.slice(0, 50)}`);
        }
      }
    }
  });

  console.log(`[checkpoint] Config conflict resolution: ${flagged} conflict(s) flagged`);
  return flagged;
}

// ── Orphan vector repair ──

async function repairOrphanVectors() {
  let repaired = 0;
  try {
    const lancedb = require('@lancedb/lancedb');
    const LANCEDB_PATH = resolve(getRuntime().memoryDir, 'lancedb');

    // Get all SQLite confidence chunk IDs (from memory-engine.sqlite)
    const sqliteIds = withMeDb(db => {
      return db.prepare('SELECT chunk_id, category FROM memory_confidence WHERE is_archived = 0').all();
    }, { readonly: true });

    // Get all LanceDB chunk IDs via vector search (dummy vector to enumerate)
    let lanceIds = new Set();
    try {
      const ldb = await lancedb.connect(LANCEDB_PATH);
      const table = await ldb.openTable('chunks');
      const count = await table.countRows();
      if (count > 1000) {
        console.log(`[checkpoint] LanceDB has ${count} rows, skipping full scan`);
        return 0;
      }
      const dummyVec = new Array(2560).fill(0);
      const raw = await table.search(dummyVec).limit(count + 10).execute();
      const items = [];
      if (typeof raw[Symbol.asyncIterator] === 'function') {
        for await (const batch of raw) { for (const row of batch) items.push(row); }
      }
      lanceIds = new Set(items.map(r => r.id));
    } catch (e) {
      console.warn('[checkpoint] LanceDB scan failed:', e.message);
      return 0;
    }

    // Find SQLite entries missing from LanceDB
    const missing = sqliteIds.filter(r => !lanceIds.has(r.chunk_id));
    if (missing.length === 0) {
      console.log('[checkpoint] No orphan vectors to repair');
      return 0;
    }

    console.log(`[checkpoint] Found ${missing.length} SQLite entries missing from LanceDB, repairing...`);

    // Regenerate embeddings and write to LanceDB
    const ldb = await lancedb.connect(LANCEDB_PATH);
    const table = await ldb.openTable('chunks');
    const BATCH = 10;

    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      for (const row of batch) {
        try {
          // Get text from chunks table
          const chunk = withDb(db => {
            return db.prepare('SELECT text FROM chunks WHERE id = ?').get(row.chunk_id);
          });
          if (!chunk || !chunk.text) continue;

          const text = chunk.text.slice(0, 2000);

          // Use embedding API directly
          const https = require('node:https');
          const key = checkpointConfig.getSFKey();
          if (!key) continue;

          const embBody = JSON.stringify({
            model: 'Qwen/Qwen3-Embedding-4B',
            input: text.slice(0, 8000),
          });
          const embResult = await new Promise((res, rej) => {
            const url = new URL('/v1/embeddings', checkpointConfig.getSFBaseUrl());
            const req = https.request(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            }, (resp) => {
              let d = '';
              resp.on('data', c => d += c);
              resp.on('end', () => {
                try { res(JSON.parse(d)); } catch (e) { rej(e); }
              });
            });
            req.on('error', rej);
            req.write(embBody);
            req.end();
          });

          const vec = embResult.data?.[0]?.embedding;
          if (vec && vec.length > 0) {
            await table.add([{
              id: row.chunk_id,
              text: text.slice(0, 2000),
              vector: vec,
              timestamp: Date.now(),
            }]);
            repaired++;
          }
        } catch (e) {
          console.warn(`  ↳ Failed to repair ${row.chunk_id.slice(0, 16)}: ${e.message}`);
        }
      }
    }

    console.log(`[checkpoint] Repaired ${repaired}/${missing.length} missing LanceDB vectors`);
  } catch (e) {
    console.warn('[checkpoint] Orphan repair skipped:', e.message);
  }
  return repaired;
}

// ── Main ──

async function main() {
  const start = Date.now();
  console.log(`[checkpoint] === Session Checkpoint ${todayDateStr()} ===`);

  try {
    // Step 1: Gather raw logs
    const rawLogs = getRuntime().readYesterdayRawLogs();
    console.log(`[checkpoint] Found ${rawLogs.length} raw log entries (yesterday: ${yesterdayDateStr()})`);

    // Step 2: Unified nightly checkpoint (1 LLM call → 3 outputs)
    const result = await nightlyCheckpoint(rawLogs);

    // Step 2.5: Repair orphan vectors (SQLite has, LanceDB missing)
    const repaired = await getRuntime().repairOrphanVectors();

    // Step 3: Resolve config conflicts (existing logic, kept)
    const conflicts = getRuntime().resolveConfigConflicts();

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    if (result.timeout) {
      console.log(`[checkpoint] ⏰ llm超时 — completed in ${elapsed}s`);
    } else if (result.skipped) {
      console.log(`[checkpoint] ⏭ Skipped (no conversation data) — ${elapsed}s`);
    } else {
      console.log(`[checkpoint] ✅ Completed in ${elapsed}s — ${result.memories} memories, ${result.episode ? 'episode' : 'no episode'}, ${result.configs} configs, ${repaired} vectors repaired, ${conflicts} conflicts`);
    }
  } catch (e) {
    console.error("[checkpoint] ❌ Failed:", e.message);
    process.exit(1);
  }
}

runtimeRegistry.installRuntimeFallbacks({
  llmNightlyExtract: checkpointLlm.llmNightlyExtract,
  readYesterdayRawLogs: checkpointRawLog.readYesterdayRawLogs,
  repairOrphanVectors,
  resolveConfigConflicts,
});

if (require.main === module) {
  main();
}

module.exports = {
  inspectBusyTimeouts,
  main,
  yesterdayDateStr,
  buildNightlyEntryId,
  mergeKgData,
  nightlyCheckpoint,
  withRuntime,
};
