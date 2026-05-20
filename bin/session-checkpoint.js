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
const { homedir } = require("node:os");
const { resolve } = require("node:path");
const { readFileSync, existsSync, appendFileSync, mkdirSync, writeFileSync } = require("node:fs");
const Database = require("better-sqlite3");
const zlib = require("node:zlib");

// Paths
const HOME = homedir();
const DB_PATH = resolve(HOME, ".openclaw/memory/main.sqlite");
const WORKSPACE = resolve(HOME, ".openclaw/workspace");
const SMART_ADD_DIR = "memory/smart-add";
const CONFIG_JSON = resolve(HOME, ".openclaw/openclaw.json");
const EPISODES_DIR = "memory/episodes";

// Config cache
let config = null;
function getConfig() {
  if (!config) config = JSON.parse(readFileSync(CONFIG_JSON, "utf-8"));
  return config;
}

function getSFKey() {
  try {
    return getConfig().models?.providers?.siliconflow?.apiKey || "";
  } catch (e) {
    return "";
  }
}

function getSFBaseUrl() {
  try {
    return getConfig().models?.providers?.siliconflow?.baseUrl || "https://api.siliconflow.cn/v1";
  } catch (e) {
    return "https://api.siliconflow.cn/v1";
  }
}

// ── DB helpers ──

function withDb(fn) {
  const db = new Database(DB_PATH, { readonly: false });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

// ── LLM call via SiliconFlow ──

function llmComplete(prompt, systemPrompt, options = {}) {
  return new Promise((resolve, reject) => {
    const apiKey = getSFKey();
    if (!apiKey) return reject(new Error("SiliconFlow API key not found"));

    const baseUrl = getSFBaseUrl();
    const url = new URL("/chat/completions", baseUrl);
    const model = options.model || "deepseek-ai/DeepSeek-V4-Flash";
    const temperature = options.temperature ?? 0.1;
    const maxTokens = options.maxTokens ?? 1024;

    const body = JSON.stringify({
      model,
      messages: [
        ...(systemPrompt
          ? [{ role: "system", content: systemPrompt }]
          : []),
        { role: "user", content: prompt },
      ],
      temperature,
      max_tokens: maxTokens,
      stream: false,
    });

    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      },
      (res) => {
        let data = "";
        const isGzip = res.headers["content-encoding"] === "gzip";
        const stream = isGzip ? res.pipe(zlib.createGunzip()) : res;
        stream.on("data", (chunk) => (data += chunk));
        stream.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
            resolve(parsed.choices?.[0]?.message?.content || "");
          } catch (e) {
            reject(new Error(`Parse failed: ${e.message}\nRaw: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Read today's raw content ──

function readTodayRawLogs() {
  const today = todayDateStr();
  const logs = [];

  // Source 1: smart-add file
  const smartAddPath = resolve(WORKSPACE, SMART_ADD_DIR, `${today}.md`);
  if (existsSync(smartAddPath)) {
    const content = readFileSync(smartAddPath, "utf-8");
    // Parse entries: ## timestamp_category\n\nCategory: xxx\n\ntext
    const entries = content.split(/\n## /);
    for (const entry of entries) {
      const catMatch = entry.match(/Category:\s*(\S+)/);
      const textMatch = entry.split(/\n\n/).slice(1).join("\n\n").trim();
      if (catMatch && textMatch) {
        logs.push({ category: catMatch[1], text: textMatch });
      }
    }
  }

  // Source 2: raw_log from confidence DB
  try {
    withDb((db) => {
      const todayMs = new Date();
      todayMs.setHours(0, 0, 0, 0);
      const startOfDay = todayMs.getTime();

      const rows = db
        .prepare(
          `SELECT c.text, mc.category
           FROM chunks c
           JOIN memory_confidence mc ON c.id = mc.chunk_id
           WHERE mc.category = 'raw_log'
           ORDER BY c.updated_at DESC
           LIMIT 100`
        )
        .all();

      for (const row of rows) {
        logs.push({ category: "raw_log", text: row.text });
      }
    });
  } catch (e) {
    console.error("[checkpoint] DB read warning:", e.message);
  }

  return logs;
}

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
  const fileDir = resolve(WORKSPACE, SMART_ADD_DIR);
  const filePath = resolve(fileDir, `${today}.md`);
  mkdirSync(fileDir, { recursive: true });

  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "").slice(0, 15);
  const entryId = `${ts}_${category}_nightly`;
  const entry = `## ${entryId}\n\nCategory: ${category}${opts.protected ? " | Protected" : ""}${opts.kg_data ? `\n\nkg_data: ${opts.kg_data}` : ""}\n\n${text.trim()}\n\n`;

  const header = !existsSync(filePath) ? "# Smart Added Memory\n\n" : "";
  appendFileSync(filePath, header ? entry : `\n${entry}`);

  return entryId;
}

/**
 * Quick dedup via FTS5: check if a similar entry already exists.
 */
function isDuplicate(text) {
  try {
    return withDb((db) => {
      // Try FTS5 exact match first
      const fts = db.prepare(`
        SELECT COUNT(*) as cnt FROM chunks_fts
        WHERE chunks_fts MATCH ?
      `).get(text.replace(/[^\w\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 5).join(' '));
      if (fts && fts.cnt > 0) return true;

      // Fallback: check if any recent chunk contains key fragments
      const keyFrags = text.match(/[\u4e00-\u9fff\w]{4,}/g) || [];
      const sig = keyFrags.slice(0, 3).join('|');
      if (!sig) return false;

      const existing = db.prepare(`
        SELECT COUNT(*) as cnt FROM chunks c
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
 * One LLM call: extract structured memories, episode summary, and configs.
 */
const NIGHTLY_PROMPT = `从以下今天的全部对话中，完成三件事。只输出 JSON，不要其他文字。

三件事：
1. smart_memories: 提取结构化记忆，每一条包含 type 和 text
   type 可选：profile（身份信息）、preference（偏好习惯）、entity（重要实体）、
   event（事件决策）、case（问题解决案例）、pattern（行为模式）
2. episode_summary: 用一段话（不超过 200 字）总结今天主要发生的事
3. configs: 提取所有配置信息（API key、文件路径、模型参数等），
   每一条包含 key、value、context

如果某类信息不存在，返回空数组/空字符串。按以下 JSON 格式返回：

{
  "smart_memories": [{"type": "...", "text": "..."}],
  "episode_summary": "...",
  "configs": [{"key": "...", "value": "...", "context": "..."}]
}

JSON:`;

async function llmNightlyExtract(combinedText) {
  const trimmed = combinedText.substring(0, 12000);
  console.log(`[checkpoint] Sending ${trimmed.length} chars to LLM for unified extraction...`);

  try {
    const result = await llmComplete(NIGHTLY_PROMPT + trimmed, null, {
      temperature: 0.1,
      maxTokens: 4096,
    });

    // Parse JSON from response
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[checkpoint] LLM response didn't contain JSON:", result.slice(0, 300));
      return { smart_memories: [], episode_summary: "", configs: [] };
    }

    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("[checkpoint] Nightly extraction failed:", e.message);
    return { smart_memories: [], episode_summary: "", configs: [] };
  }
}

/**
 * Run the full nightly checkpoint: one LLM call → 4 outputs.
 */
async function nightlyCheckpoint(rawLogs) {
  const today = todayDateStr();

  if (rawLogs.length === 0) {
    console.log("[checkpoint] No raw logs found today — nothing to extract.");
    writeEmptyEpisode(today);
    return { memories: 0, episode: false, configs: 0 };
  }

  const combinedText = rawLogs
    .filter(l => l.text && l.text.trim())
    .map(l => l.text.trim())
    .slice(0, 20)
    .join("\n---\n");

  if (!combinedText.trim()) {
    console.log("[checkpoint] All raw logs empty — nothing to extract.");
    writeEmptyEpisode(today);
    return { memories: 0, episode: false, configs: 0 };
  }

  // ── Single LLM call ──
  const extracted = await llmNightlyExtract(combinedText);

  // ── 1. Write structured memories (6 types) ──
  let memWritten = 0;
  for (const item of extracted.smart_memories || []) {
    if (memWritten >= 10) break;
    if (!item.text || !item.type) continue;

    // Dedup check
    if (isDuplicate(item.text)) {
      console.log(`  ↳ Skipped (duplicate): ${item.text.slice(0, 60)}`);
      continue;
    }

    const cat = mapToCategory(item.type);
    const entryId = appendSmartAdd(item.text, cat);
    try { writeConfidence(entryId, item.text, cat); } catch (e) {}
    memWritten++;
  }
  console.log(`[checkpoint] Wrote ${memWritten} structured memory(-ies)`);

  // ── 2. Write episode summary ──
  let episodeWritten = false;
  if (extracted.episode_summary && extracted.episode_summary.trim()) {
    const episodeText = extracted.episode_summary.trim();
    const kgData = JSON.stringify({
      episode_of: rawLogs.map(r => r.chunk_id || '').filter(Boolean),
      date: today
    });
    const entryId = appendSmartAdd(episodeText, 'episodic', { kg_data: kgData });
    try { writeConfidence(entryId, episodeText, 'episodic'); } catch (e) {}

    // Also write to memory/episodes/
    const episodeDir = resolve(WORKSPACE, EPISODES_DIR);
    const episodePath = resolve(episodeDir, `${today}.md`);
    mkdirSync(episodeDir, { recursive: true });
    writeFileSync(episodePath, [
      `# Episode: ${today}`,
      "",
      episodeText,
      "",
      extracted.configs && extracted.configs.length > 0
        ? "### 配置记忆\n" + extracted.configs.map(c => `- ${c.key} = ${c.value}（${c.context}）`).join("\n")
        : "",
      "",
      "---",
      `_Generated at ${new Date().toISOString()}_`,
      "",
    ].join("\n"));

    // Append to daily memory file
    const dailyDir = resolve(WORKSPACE, "memory");
    const dailyPath = resolve(dailyDir, `${today}.md`);
    mkdirSync(dailyDir, { recursive: true });
    if (!existsSync(dailyPath)) {
      writeFileSync(dailyPath, `# ${today}\n\n${episodeText}\n\n`);
    }

    episodeWritten = true;
    console.log(`[checkpoint] Episode written: ${episodeText.slice(0, 80)}...`);
  }

  if (!episodeWritten) {
    writeEmptyEpisode(today);
  }

  // ── 3. Write configs (existing logic, same format) ──
  let cfgWritten = 0;
  for (const cfg of extracted.configs || []) {
    if (cfgWritten >= 10) break;
    if (!cfg.key || !cfg.value) continue;

    const text = `配置：${cfg.key} = ${cfg.value}（来源：${cfg.context || 'checkpoint'}）`;
    const entryId = appendSmartAdd(text, 'preference');
    try { writeConfidence(entryId, text, 'preference'); } catch (e) {}
    cfgWritten++;
  }
  console.log(`[checkpoint] Wrote ${cfgWritten} config(s)`);

  return { memories: memWritten, episode: episodeWritten, configs: cfgWritten };
}

function writeEmptyEpisode(today) {
  const episodeDir = resolve(WORKSPACE, EPISODES_DIR);
  const episodePath = resolve(episodeDir, `${today}.md`);
  mkdirSync(episodeDir, { recursive: true });
  if (!existsSync(episodePath)) {
    writeFileSync(episodePath, `# Episode: ${today}\n\n（无今日内容）\n\n---\n_Generated at ${new Date().toISOString()}_\n`);
  }
}

function writeConfidence(entryId, text, category) {
  withDb((db) => {
    const nowSec = Math.floor(Date.now() / 1000);
    const catParams = {
      preference: { conf: 0.8, tau: 90.0 },
      episodic: { conf: 0.7, tau: 30.0 },
      user_identity: { conf: 0.95, tau: 365.0 },
      kg_node: { conf: 0.85, tau: 90.0 },
      temporary: { conf: 0.4, tau: 2.0 },
      raw_log: { conf: 0.5, tau: 7.0 },
    };
    const params = catParams[category] || { conf: 0.5, tau: 7.0 };
    // Find matching chunk by path + text prefix
    const fileRel = `memory/smart-add/${todayDateStr()}.md`;
    const chunk = db.prepare(`
      SELECT id FROM chunks
      WHERE path = ? AND id NOT IN (SELECT chunk_id FROM memory_confidence)
      ORDER BY updated_at DESC LIMIT 1
    `).get(fileRel);

    if (chunk) {
      db.prepare(`
        INSERT OR REPLACE INTO memory_confidence
        (chunk_id, initial_confidence, confidence, last_confidence_update,
         base_tau, hit_count, is_archived, is_protected, conflict_flag, category)
        VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?)
      `).run(chunk.id, params.conf, params.conf, nowSec, params.tau, category);
    }
    console.log(`[checkpoint] Confidence written: ${category} conf=${params.conf} tau=${params.tau}`);
  });
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

  withDb((db) => {
    // 读取所有 preference 和非 archived 的条目
    const rows = db.prepare([
      "SELECT mc.chunk_id, c.text, mc.last_confidence_update, mc.conflict_flag",
      "FROM memory_confidence mc",
      "JOIN chunks c ON c.id = mc.chunk_id",
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

// ── Main ──

async function main() {
  const start = Date.now();
  console.log(`[checkpoint] === Session Checkpoint ${todayDateStr()} ===`);

  try {
    // Step 1: Gather raw logs
    const rawLogs = readTodayRawLogs();
    console.log(`[checkpoint] Found ${rawLogs.length} raw log entries`);

    // Step 2: Unified nightly checkpoint (1 LLM call → 3 outputs)
    const result = await nightlyCheckpoint(rawLogs);

    // Step 3: Resolve config conflicts (existing logic, kept)
    const conflicts = resolveConfigConflicts();

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[checkpoint] ✅ Completed in ${elapsed}s — ${result.memories} memories, ${result.episode ? 'episode' : 'no episode'}, ${result.configs} configs, ${conflicts} conflicts`);
  } catch (e) {
    console.error("[checkpoint] ❌ Failed:", e.message);
    process.exit(1);
  }
}

main();
