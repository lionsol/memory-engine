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

function getDSKey() {
  // Read from secure file first, then openclaw.json, then env var
  try {
    const keyPath = resolve(WORKSPACE, "../credentials/deepseek-api-key");
    const key = readFileSync(keyPath, "utf-8").trim();
    if (key) return key;
  } catch (e) { /* file not found */ }
  try {
    return getConfig().models?.providers?.deepseek?.apiKey || process.env.DEEPSEEK_API_KEY || "";
  } catch (e) {
    return "";
  }
}

function getDSBaseUrl() {
  try {
    return getConfig().models?.providers?.deepseek?.baseUrl || "https://api.deepseek.com";
  } catch (e) {
    return "https://api.deepseek.com";
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
  return dateStringInTimeZone(Date.now(), "Asia/Shanghai");
}

/**
 * Returns YESTERDAY's date string (YYYY-MM-DD) in business timezone (Asia/Shanghai).
 * The script runs at 03:55 CST to process the previous day's data.
 */
function yesterdayDateStr(now = null) {
  const businessToday = dateStringInTimeZone(now || Date.now(), "Asia/Shanghai");
  return shiftDateString(businessToday, -1);
}

function parseDatePartsInTimeZone(dateInput, timeZone = "Asia/Shanghai") {
  const date = dateInput ? new Date(dateInput) : new Date();
  if (Number.isNaN(date.getTime())) {
    return parseDatePartsInTimeZone(new Date(), timeZone);
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
  };
}

function dateStringInTimeZone(dateInput, timeZone = "Asia/Shanghai") {
  const p = parseDatePartsInTimeZone(dateInput, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

function shiftDateString(dateStr, days) {
  const [y, m, d] = String(dateStr || "").split("-").map(n => Number(n));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + (Number(days) || 0));
  return dt.toISOString().slice(0, 10);
}

function buildNightlyEntryId({ targetDate, category = "episodic", generatedAt = null } = {}) {
  const businessTargetDate = targetDate || yesterdayDateStr(generatedAt || Date.now());
  const p = parseDatePartsInTimeZone(generatedAt || Date.now(), "Asia/Shanghai");
  return `${businessTargetDate}_${category}_nightly_generated_${p.hour}${p.minute}${p.second}`;
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

// ── Generic LLM call ──

function llmComplete(prompt, systemPrompt, options = {}) {
  const { provider = "siliconflow" } = options;
  const keyFn = provider === "deepseek" ? getDSKey : getSFKey;
  const baseFn = provider === "deepseek" ? getDSBaseUrl : getSFBaseUrl;
  const defaultModel = provider === "deepseek" ? "deepseek-chat" : "deepseek-ai/DeepSeek-V3.2";

  return new Promise((resolve, reject) => {
    const apiKey = keyFn();
    if (!apiKey) return reject(new Error(`${provider} API key not found`));

    const baseUrl = baseFn();
    const url = new URL("/chat/completions", baseUrl);
    const model = options.model || defaultModel;
    const temperature = options.temperature ?? 0.1;
    const maxTokens = options.maxTokens ?? 1024;
    const requestTimeoutMs = options.timeoutMs ?? 45000;

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
    req.setTimeout(requestTimeoutMs, () => {
      req.destroy();
      reject(new Error(`LLM request timed out after ${requestTimeoutMs}ms`));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Read today's raw content ──

function readYesterdayRawLogs() {
  const yesterday = yesterdayDateStr();
  const logs = [];

  // Source 1: smart-add file — ALL entries are notes, not conversations
  const smartAddPath = resolve(WORKSPACE, SMART_ADD_DIR, `${yesterday}.md`);
  if (existsSync(smartAddPath)) {
    const content = readFileSync(smartAddPath, "utf-8");
    const entries = parseSmartAddEntries(content);
    for (const parsed of entries) {
      const cat = parsed.category || inferCategoryFromEntry(parsed.raw || parsed.text);
      const body = parsed.text || parsed.raw || "";
      if (!body.trim()) continue;
      logs.push({
        category: cat,
        text: body,
        source: "note",  // smart-add entries are always notes, never conversation
      });
    }
  }

  // Source 2: raw_log from confidence DB (these are real conversation data)
  try {
    withDb((db) => {
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
        logs.push({ category: "raw_log", text: row.text, source: 'conversation' });
      }
    });
  } catch (e) {
    console.error("[checkpoint] DB read warning:", e.message);
  }

  return logs;
}

function inferCategoryFromEntry(text) {
  const raw = String(text || "");
  if (/^KG_concept_/mi.test(raw)) return "kg_node";
  if (/^Node:\s*/mi.test(raw) && /^Properties:\s*/mi.test(raw)) return "kg_node";
  return "raw_log";
}

function parseSmartAddEntries(content) {
  const normalized = String(content || "").replace(/\r\n/g, "\n");
  const blockRe = /(?:<!--\s*smart-add-fingerprint:\s*[a-f0-9]{8,64}\s*-->\s*\n)?##\s+[\s\S]*?(?=\n(?:<!--\s*smart-add-fingerprint:\s*[a-f0-9]{8,64}\s*-->\s*\n)?##\s+|$)/gi;
  const blocks = (normalized.match(blockRe) || []).map((b) => b.trim());

  const entries = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length === 0) continue;
    const entryId = String(lines[0] || "").replace(/^##\s*/, "").trim();
    const categoryLine = lines.find((line) => /^\s*Category:\s*/i.test(line));
    const category = categoryLine
      ? String(categoryLine.replace(/^\s*Category:\s*/i, "").split("|")[0] || "").trim()
      : null;
    const text = lines
      .filter((line) =>
        !/^\s*Category:\s*/i.test(line)
        && !/^\s*kg_data:\s*/i.test(line)
        && !/^\s*##\s*/.test(line)
        && !/^\s*<!--\s*smart-add-fingerprint:\s*[a-f0-9]{8,64}\s*-->\s*$/i.test(line)
      )
      .join("\n")
      .trim();

    if (!text) continue;
    entries.push({ entryId, category, text, raw: block });
  }
  return entries;
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
  const fingerprint = smartAddFingerprint({ category, raw: text, kg_data: opts.kg_data });
  const existing = readSmartAddFingerprints(today);
  if (existing.has(fingerprint)) return null;

  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "").slice(0, 15);
  const entryId = `${ts}_${category}_nightly`;
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
  const filePath = resolve(WORKSPACE, SMART_ADD_DIR, `${date}.md`);
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
const NIGHTLY_PROMPT = `你是我的个人记忆整理助手。以下是今天收集的各种碎片化记录，
包括对话摘要、项目状态、梦境记录、配置笔记等。

请按以下结构输出今日摘要，并包含结构化记忆和配置信息。
注意：条目按时间顺序排列，请涵盖全天各时段的内容，确保最近新增的条目也被纳入摘要。
只输出 JSON，不要其他文字。

JSON 结构：
{
  "episode_summary": "一段话（不超过 300 字），按以下结构组织：\n1. 核心对话与决策：今天讨论了什么重要话题，做了什么决定\n2. 项目进展：哪些项目有更新或状态变化\n3. 个人记录：梦境、想法、笔记等零散内容\n4. 待办/后续：从今天内容中浮现出的后续事项",
  "smart_memories": [
    {"type": "profile|preference|entity|event|case|pattern", "text": "具体内容"}
  ],
  "configs": [
    {"key": "配置名", "value": "值", "context": "来源说明"}
  ]
}

注意事项：
- 配置笔记和推荐方案不应被描述为"讨论了..."
- 如果某类信息不存在，返回空数组/空字符串

今天的内容：
---
{chunks_text}
---

JSON:`;

/**
 * Quick health check: a tiny ping to the provider before sending the full prompt.
 * Returns true if reachable, false if timeout/error.
 */
function quickHealthCheck(provider) {
  const keyFn = provider === "deepseek" ? getDSKey : getSFKey;
  if (!keyFn()) return false;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 10000);
    llmComplete("回复 OK 即可", null, { provider, model: provider === "deepseek" ? "deepseek-chat" : "deepseek-ai/DeepSeek-V3.2", maxTokens: 10, timeoutMs: 10000 })
      .then(() => { clearTimeout(timeout); resolve(true); })
      .catch(() => { clearTimeout(timeout); resolve(false); });
  });
}

async function llmNightlyExtract(combinedText) {
  const trimmed = combinedText.substring(0, 45000);

  // Try primary: SiliconFlow DeepSeek-V3.2
  console.log(`[checkpoint] Sending ${trimmed.length} chars to LLM (SiliconFlow DeepSeek-V3.2, 120s timeout)...`);
  let result;
  try {
    result = await llmComplete(NIGHTLY_PROMPT + trimmed, null, {
      temperature: 0.1,
      maxTokens: 8192,
      timeoutMs: 120000,
    });
  } catch (e) {
    console.warn(`[checkpoint] SiliconFlow primary failed: ${e.message}`);

    // Fallback: try deepseek.com DeepSeek V4 Flash
    if (!getDSKey()) {
      console.warn("[checkpoint] DeepSeek API key not configured — skipping fallback");
      return { smart_memories: [], episode_summary: "", configs: [], error: "llm超时" };
    }

    console.log(`[checkpoint] Falling back to deepseek.com (DeepSeek V4 Flash, 120s timeout)...`);
    try {
      result = await llmComplete(NIGHTLY_PROMPT + trimmed, null, {
        provider: "deepseek",
        model: "deepseek-chat",
        temperature: 0.1,
        maxTokens: 8192,
        timeoutMs: 120000,
      });
      console.log("[checkpoint] Fallback succeeded via deepseek.com");
    } catch (e2) {
      console.error(`[checkpoint] Fallback also failed: ${e2.message}`);
      return { smart_memories: [], episode_summary: "", configs: [], error: "llm超时" };
    }
  }

  // Parse JSON from response
  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn("[checkpoint] LLM response didn't contain JSON:", result.slice(0, 300));
    return { smart_memories: [], episode_summary: "", configs: [] };
  }

  return JSON.parse(jsonMatch[0]);
}

/**
 * Run the full nightly checkpoint: one LLM call → 4 outputs.
 */
async function nightlyCheckpoint(rawLogs) {
  const episodeDate = yesterdayDateStr();

  if (rawLogs.length === 0) {
    console.log("[checkpoint] No raw logs found — nothing to extract.");
    writeEmptyEpisode(episodeDate);
    return { memories: 0, episode: false, configs: 0 };
  }

  // Split rawLogs into conversation data (for episode summary) and all data (for config extraction)
  const conversationLogs = rawLogs
    .filter(l => l.text && l.text.trim() && l.source === 'conversation');
  const allLogs = rawLogs
    .filter(l => l.text && l.text.trim());

  // Use ALL data for the LLM call (it can distinguish types per the prompt instructions)
  const combinedText = allLogs
    .map(l => l.text.trim())
    .join("\n---\n");

  if (!combinedText.trim()) {
    console.log("[checkpoint] All logs empty — nothing to extract.");
    writeEmptyEpisode(episodeDate);
    return { memories: 0, episode: false, configs: 0 };
  }

  // Guard: no real conversation data → skip LLM call entirely, write incomplete marker
  if (conversationLogs.length === 0) {
    console.log(`[checkpoint] No conversation logs found (${allLogs.length} note entries only) — marking as incomplete, skipping LLM.`);
    writeIncompleteEpisode(episodeDate, allLogs.length);
    return { memories: 0, episode: false, configs: 0, skipped: true };
  }

  // Log the data mix for debugging
  console.log(`[checkpoint] Conversation entries: ${conversationLogs.length}, Total entries: ${allLogs.length}`);

  // ── Single LLM call ──
  const extracted = await llmNightlyExtract(combinedText);

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
    const entryId = appendSmartAdd(item.text, cat);
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
    const kgData = JSON.stringify({
      episode_of: rawLogs.map(r => r.chunk_id || '').filter(Boolean),
      date: episodeDate
    });
    const entryId = appendSmartAdd(episodeText, 'episodic', { kg_data: kgData });
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
      // Write to memory/episodes/
      const episodeDir = resolve(WORKSPACE, EPISODES_DIR);
      const episodePath = resolve(episodeDir, `${episodeDate}.md`);
      mkdirSync(episodeDir, { recursive: true });
      writeFileSync(episodePath, [
        `# Episode: ${episodeDate}`,
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
      const dailyPath = resolve(dailyDir, `${episodeDate}.md`);
      mkdirSync(dailyDir, { recursive: true });
      if (!existsSync(dailyPath)) {
        writeFileSync(dailyPath, `# ${episodeDate}\n\n${episodeText}\n\n`);
      }

      console.log(`[checkpoint] Episode written: ${episodeText.slice(0, 80)}...`);
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
    const entryId = appendSmartAdd(text, 'preference');
    if (!entryId) {
      console.log(`  ↳ Skipped config (duplicate/fingerprint): ${cfg.key}`);
      continue;
    }
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

function writeIncompleteEpisode(today, noteCount) {
  const episodeDir = resolve(WORKSPACE, EPISODES_DIR);
  const episodePath = resolve(episodeDir, `${today}.md`);
  mkdirSync(episodeDir, { recursive: true });
  writeFileSync(episodePath, [
    `# Episode: ${today}`,
    "",
    "⚠️ **数据不完整 — 当日无有效对话记录**",
    "",
    `会话日志数据缺失（DB raw_log 条目为空），仅包含 ${noteCount} 条配置笔记/自动写入条目。`,
    "无足够数据生成可靠摘要，跳过 LLM 摘要生成。",
    "",
    "可能原因：",
    "- DB 损坏后从备份恢复，当天后续对话丢失",
    "- 当日仅有 cron 任务运行，无用户对话",
    "- checkpoint 运行时间早于对话发生时间",
    "",
    "---",
    `_Generated at ${new Date().toISOString()}_`,
    "",
  ].join("\n"));
  console.log(`[checkpoint] Incomplete-data episode marker written for ${today} (${noteCount} notes, 0 conversations)`);
}

function writeLLMTimeoutEpisode(today) {
  const episodeDir = resolve(WORKSPACE, EPISODES_DIR);
  const episodePath = resolve(episodeDir, `${today}.md`);
  mkdirSync(episodeDir, { recursive: true });
  writeFileSync(episodePath, `# Episode: ${today}\n\n⚠️ llm超时 — 当日日志未处理（SiliconFlow + DeepSeek 均不可用）\n\n---\n_Generated at ${new Date().toISOString()}_\n`);
  console.log("[checkpoint] LLM timeout episode marker written");
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

// ── Orphan vector repair ──

async function repairOrphanVectors() {
  let repaired = 0;
  try {
    const lancedb = require('@lancedb/lancedb');
    const LANCEDB_PATH = resolve(HOME, '.openclaw/memory/lancedb');

    // Get all SQLite confidence chunk IDs
    const sqliteIds = withDb(db => {
      return db.prepare('SELECT chunk_id, category FROM memory_confidence WHERE is_archived = 0').all();
    });

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
          const key = getSFKey();
          if (!key) continue;

          const embBody = JSON.stringify({
            model: 'Qwen/Qwen3-Embedding-4B',
            input: text.slice(0, 8000),
          });
          const embResult = await new Promise((res, rej) => {
            const url = new URL('/v1/embeddings', getSFBaseUrl());
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
    const rawLogs = readYesterdayRawLogs();
    console.log(`[checkpoint] Found ${rawLogs.length} raw log entries (yesterday: ${yesterdayDateStr()})`);

    // Step 2: Unified nightly checkpoint (1 LLM call → 3 outputs)
    const result = await nightlyCheckpoint(rawLogs);

    // Step 2.5: Repair orphan vectors (SQLite has, LanceDB missing)
    const repaired = await repairOrphanVectors();

    // Step 3: Resolve config conflicts (existing logic, kept)
    const conflicts = resolveConfigConflicts();

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

if (require.main === module) {
  main();
}

module.exports = {
  yesterdayDateStr,
  buildNightlyEntryId,
  mergeKgData,
};
