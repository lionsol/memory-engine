#!/usr/bin/env node
/**
 * memory-stats.js — 记忆系统每日统计
 *
 * 功能：
 *   1. 记忆总览 (#1) — 总条目数、按来源/类型分布
 *   2. 写入触发分布 (#2) — 按来源分类当天写入的记忆条目
 *   3. 活跃度追踪 (#3) — embedding 状态、更新时间分布
 *
 * 运行方式：cron 每日 04:00（session-checkpoint 之后）
 * 数据存于：main.sqlite.memory_daily_stats 表
 */

const { homedir } = require("node:os");
const { resolve } = require("node:path");
const { existsSync, readFileSync, appendFileSync, mkdirSync } = require("node:fs");
const Database = require("better-sqlite3");

// ── Paths ──
const HOME = homedir();
const DB_PATH = resolve(HOME, ".openclaw/memory/main.sqlite");
const WORKSPACE = resolve(HOME, ".openclaw/workspace");
const EPISODES_DIR = resolve(WORKSPACE, "memory/episodes");
const DAILY_DIR = resolve(WORKSPACE, "memory");
const STATS_LOG = resolve(WORKSPACE, "memory/stats-history.md");

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
  // Use local timezone (Asia/Shanghai) date
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
}

function classifyByPath(path) {
  if (!path) return "other";
  if (path.startsWith("memory/dreaming/")) return "dreaming";
  if (path.startsWith("memory/projects/")) return "project";
  if (path.startsWith("memory/episodes/")) return "episode";
  if (path.startsWith("memory/journal/") || path.startsWith("memory/")) return "daily";
  if (path.startsWith("MEMORY.md") || path.startsWith("memory/MEMORY")) return "curated";
  return "other";
}

function classifyTrigger(path) {
  if (!path) return "other";
  // checkpoint (auto-save) vs agent_active (user-initiated)
  if (path.startsWith("memory/dreaming/")) return "checkpoint_auto";
  if (path.startsWith("memory/episodes/")) return "checkpoint_llm";
  if (path.startsWith("memory/projects/")) return "checkpoint_auto";
  if (path.startsWith("memory/journal/")) return "agent_passive";
  if (path.startsWith("tools/memory/") || path.startsWith("memory/MEMORY")) return "checkpoint_llm";
  return "other";
}

// ── Ensure stats table exists ──
function ensureStatsTable() {
  withDb(db => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_daily_stats (
        date TEXT NOT NULL,
        metric TEXT NOT NULL,
        value REAL NOT NULL DEFAULT 0,
        details TEXT DEFAULT '',
        collected_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
        PRIMARY KEY (date, metric)
      );
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_engine_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        event_time INTEGER NOT NULL,
        details TEXT DEFAULT '',
        session_key TEXT DEFAULT ''
      );
    `);
  });
  console.log("[stats] Tables ensured");
}

// ── #1: Memory Overview ──
function collectOverview(dateStr) {
  const stats = withDb(db => {
    const total = db.prepare("SELECT COUNT(*) FROM chunks WHERE source = 'memory'").get()["COUNT(*)"];
    
    // By path type
    const byType = db.prepare(`
      SELECT
        CASE
          WHEN path LIKE 'memory/dreaming/%' THEN 'dreaming'
          WHEN path LIKE 'memory/projects/%' THEN 'project'
          WHEN path LIKE 'memory/episodes/%' THEN 'episode'
          WHEN path LIKE 'memory/journal/%' THEN 'journal'
          ELSE 'other'
        END as type,
        COUNT(*) as cnt
      FROM chunks WHERE source = 'memory'
      GROUP BY type
      ORDER BY cnt DESC
    `).all();
    
    // Files count
    const files = db.prepare("SELECT COUNT(DISTINCT path) FROM chunks WHERE source = 'memory'").get()["COUNT(DISTINCT path)"];
    
    // Recent updates (last 24h)
    const yesterday = Date.now() - 86400000;
    const recent = db.prepare("SELECT COUNT(*) FROM chunks WHERE source = 'memory' AND updated_at > ?").get(yesterday);
    
    return { total, byType, files, recent: recent["COUNT(*)"] };
  });

  withDb(db => {
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO memory_daily_stats (date, metric, value, details, collected_at)
      VALUES (?, ?, ?, ?, strftime('%s','now') * 1000)
    `);
    upsert.run(dateStr, "overview.total", stats.total, "");
    upsert.run(dateStr, "overview.files", stats.files, "");
    upsert.run(dateStr, "overview.updated_24h", stats.recent, "chunks updated in last 24h");
    
    for (const t of stats.byType) {
      upsert.run(dateStr, `overview.type_${t.type}`, t.cnt, "");
    }
  });

  console.log(`[stats] Overview: ${stats.total} chunks, ${stats.files} files, ${stats.recent} recent`);
  return stats;
}

// ── #2: Write Trigger Distribution ──
function collectWriteTriggers(dateStr) {
  const stats = withDb(db => {
    const rows = db.prepare(`
      SELECT path, model, updated_at FROM chunks WHERE source = 'memory' ORDER BY updated_at DESC
    `).all();

    const byTrigger = {};
    for (const row of rows) {
      const trigger = classifyTrigger(row.path);
      byTrigger[trigger] = (byTrigger[trigger] || 0) + 1;
    }
    
    // Yesterday's new chunks
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = dayStart.getTime() - 86400000;
    const yesterdayEnd = dayStart.getTime();
    
    const yesterdayNew = db.prepare(`
      SELECT COUNT(*) FROM chunks WHERE source = 'memory' AND updated_at BETWEEN ? AND ?
    `).get(yesterdayStart, yesterdayEnd);
    
    return { byTrigger, total: rows.length, yesterdayNew: yesterdayNew["COUNT(*)"] };
  });

  withDb(db => {
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO memory_daily_stats (date, metric, value, details, collected_at)
      VALUES (?, ?, ?, ?, strftime('%s','now') * 1000)
    `);
    upsert.run(dateStr, "trigger.total", stats.total, "");
    upsert.run(dateStr, "trigger.yesterday_new", stats.yesterdayNew, "chunks created yesterday");
    
    for (const [trigger, count] of Object.entries(stats.byTrigger)) {
      upsert.run(dateStr, `trigger.${trigger}`, count, "");
    }
  });

  console.log(`[stats] Triggers: ${JSON.stringify(stats.byTrigger)}`);
  return stats;
}

// ── #3: Activity & Health ──
function collectActivity(dateStr) {
  withDb(db => {
    // Chunks with/without embedding
    const withEmbedding = db.prepare("SELECT COUNT(*) FROM chunks WHERE source = 'memory' AND embedding IS NOT NULL AND embedding != ''").get()["COUNT(*)"];
    const total = db.prepare("SELECT COUNT(*) FROM chunks WHERE source = 'memory'").get()["COUNT(*)"];
    
    // Daily files in memory/ directory
    const dailyFilesCount = db.prepare("SELECT COUNT(*) FROM chunks WHERE path LIKE 'memory/%-%-%.md' AND source = 'memory'").get()["COUNT(*)"];
    
    // Distinct models used
    const models = db.prepare("SELECT DISTINCT model FROM chunks WHERE source = 'memory' AND model != ''").all().map(r => r.model);
    
    // Recent chunks in last 7 days
    const weekAgo = Date.now() - 7 * 86400000;
    const weekCount = db.prepare("SELECT COUNT(*) FROM chunks WHERE source = 'memory' AND updated_at > ?").get(weekAgo)["COUNT(*)"];
    
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO memory_daily_stats (date, metric, value, details, collected_at)
      VALUES (?, ?, ?, ?, strftime('%s','now') * 1000)
    `);
    upsert.run(dateStr, "health.with_embedding", withEmbedding, "");
    upsert.run(dateStr, "health.without_embedding", total - withEmbedding, "");
    upsert.run(dateStr, "health.daily_files", dailyFilesCount, "");
    upsert.run(dateStr, "health.models_count", models.length, models.join(","));
    upsert.run(dateStr, "health.active_7d", weekCount, "chunks updated in last 7 days");
    
    console.log(`[stats] Health: ${withEmbedding}/${total} embedded, ${models.length} models, ${weekCount} active/7d`);
  });
}

// ── Generate Markdown Report ──
function generateReport(dateStr) {
  const stats = withDb(db => {
    return db.prepare("SELECT * FROM memory_daily_stats WHERE date = ?").all(dateStr);
  });
  
  if (stats.length === 0) {
    console.log("[stats] No stats for today yet");
    return;
  }
  
  const lines = [`## 📊 记忆统计 — ${dateStr}`, ""];
  
  // Group by prefix
  const groups = {};
  for (const s of stats) {
    const prefix = s.metric.split(".")[0];
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(s);
  }
  
  // Overview section
  if (groups.overview) {
    lines.push("### 📦 记忆总览");
    for (const s of groups.overview) {
      const key = s.metric.replace("overview.", "");
      lines.push(`- **${key}**: ${s.value} ${s.details ? `(${s.details})` : ""}`);
    }
    lines.push("");
  }
  
  // Trigger section
  if (groups.trigger) {
    lines.push("### ✍️ 写入触发分布");
    for (const s of groups.trigger) {
      const key = s.metric.replace("trigger.", "");
      lines.push(`- **${key}**: ${s.value} ${s.details ? `(${s.details})` : ""}`);
    }
    lines.push("");
  }
  
  // Health section
  if (groups.health) {
    lines.push("### 💪 健康度");
    for (const s of groups.health) {
      const key = s.metric.replace("health.", "");
      lines.push(`- **${key}**: ${s.value} ${s.details ? `(${s.details})` : ""}`);
    }
    lines.push("");
  }
  
  lines.push("---\n");
  
  // Append to stats history file
  mkdirSync(resolve(WORKSPACE, "memory"), { recursive: true });
  appendFileSync(STATS_LOG, lines.join("\n"));
  console.log(`[stats] Report appended to ${STATS_LOG}`);
}

// ── Main ──
async function main() {
  const dateStr = todayDateStr();
  console.log(`[stats] === Memory Stats — ${dateStr} ===`);
  
  ensureStatsTable();
  
  // #1 Overview
  collectOverview(dateStr);
  
  // #2 Write triggers
  collectWriteTriggers(dateStr);
  
  // #3 Activity & Health
  collectActivity(dateStr);
  
  // Generate report
  generateReport(dateStr);
  
  console.log("[stats] ✅ Complete");
}

main().catch(e => {
  console.error("[stats] ❌ Failed:", e.message);
  process.exit(1);
});
