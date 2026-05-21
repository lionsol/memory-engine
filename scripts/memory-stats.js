#!/usr/bin/env node
/**
 * memory-stats.js — 记忆系统每日统计
 *
 * 功能：
 *   1. 抢救成功率 (#1) — 记录 autoRecall 注入及被引用的次数
 *   2. 写入触发分布 (#2) — 按来源分类当天写入的记忆条目
 *   3. 废品回收率 (#3) — 归档数量 + 置信度分布
 *
 * 运行方式：cron 每日 04:00（session-checkpoint 之后）
 * 数据存于：main.sqlite.memory_daily_stats 表
 */

const { homedir } = require("node:os");
const { resolve } = require("node:path");
const { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } = require("node:fs");
const Database = require("better-sqlite3");

// ── Paths ──
const HOME = homedir();
const DB_PATH = resolve(HOME, ".openclaw/memory/main.sqlite");
const WORKSPACE = resolve(HOME, ".openclaw/workspace");
const EPISODES_DIR = resolve(WORKSPACE, "memory/episodes");
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
  return new Date().toISOString().slice(0, 10);
}

function yesterdayDateStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
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
    // Also ensure memory_engine_events table for tracking search/cite
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_engine_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        event_time INTEGER NOT NULL,
        details TEXT DEFAULT '',
        session_key TEXT DEFAULT ''
      );
    `);
    // Add trigger column to memory_confidence if not exists
    try {
      db.exec(`ALTER TABLE memory_confidence ADD COLUMN write_trigger TEXT DEFAULT ''`);
    } catch (_) {
      // Column already exists
    }
  });
  console.log("[stats] Tables ensured");
}

// ── #3: Archive Rate (collect from memory_confidence) ──
function collectArchiveRate(dateStr) {
  const stats = withDb(db => {
    const total = db.prepare("SELECT COUNT(*) FROM memory_confidence").get()["COUNT(*)"];
    const archived = db.prepare("SELECT COUNT(*) FROM memory_confidence WHERE is_archived = 1").get()["COUNT(*)"];
    const below015 = db.prepare("SELECT COUNT(*) FROM memory_confidence WHERE is_archived = 0 AND confidence < 0.15").get()["COUNT(*)"];
    const minConf = db.prepare("SELECT MIN(confidence) FROM memory_confidence WHERE is_archived = 0").get()["MIN(confidence)"] || 0;
    const avgConf = db.prepare("SELECT ROUND(AVG(confidence), 3) FROM memory_confidence WHERE is_archived = 0").get()["ROUND(AVG(confidence), 3)"] || 0;
    const zeroHits = db.prepare("SELECT COUNT(*) FROM memory_confidence WHERE is_archived = 0 AND hit_count = 0").get()["COUNT(*)"];
    
    return { total, archived, below015, minConf, avgConf, zeroHits };
  });

  // Write to stats table
  withDb(db => {
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO memory_daily_stats (date, metric, value, details, collected_at)
      VALUES (?, ?, ?, ?, strftime('%s','now') * 1000)
    `);
    upsert.run(dateStr, "archive.total", stats.total, "");
    upsert.run(dateStr, "archive.archived", stats.archived, "");
    upsert.run(dateStr, "archive.below_threshold", stats.below015, "confidence<0.15 not archived");
    upsert.run(dateStr, "archive.min_confidence", stats.minConf, "");
    upsert.run(dateStr, "archive.avg_confidence", stats.avgConf, "");
    upsert.run(dateStr, "archive.zero_hits", stats.zeroHits, "never cited");
  });

  console.log(`[stats] Archive: ${stats.archived}/${stats.total} archived, min_conf=${stats.minConf}, zero_hits=${stats.zeroHits}`);
  return stats;
}

// ── #2: Write Trigger Distribution ──
function collectWriteTriggers(dateStr) {
  const stats = withDb(db => {
    // Count from memory_confidence directly (handles orphans)
    const totalActive = db.prepare("SELECT COUNT(*) FROM memory_confidence WHERE is_archived = 0").get()["COUNT(*)"];
    const totalAll = db.prepare("SELECT COUNT(*) FROM memory_confidence").get()["COUNT(*)"];
    
    // Get ALL entries with LEFT JOIN to include orphans
    const rows = db.prepare(`
      SELECT c.text, mc.category, mc.confidence, mc.chunk_id, mc.write_trigger, mc.is_archived
      FROM memory_confidence mc
      LEFT JOIN chunks c ON c.id = mc.chunk_id
      ORDER BY mc.rowid
    `).all();

    const byTrigger = {};
    for (const row of rows) {
      const text = row.text || "";
      let trigger = row.write_trigger || "";
      
      // If no trigger tag, classify by heuristics
      if (!trigger) {
        if (row.category === "episodic") {
          trigger = "checkpoint_llm";
        } else if (row.category === "kg_node") {
          trigger = "checkpoint_kg";
        } else if (row.category === "raw_log") {
          trigger = "agent_passive";
        } else if (text.startsWith("配置：")) {
          trigger = "checkpoint_rule";
        } else if (row.category === "user_identity" || row.category === "preference") {
          trigger = "agent_active";
        } else {
          trigger = "other";
        }
        
        // Backfill trigger column
        if (row.is_archived === 0 && row.chunk_id) {
          try {
            db.prepare("UPDATE memory_confidence SET write_trigger = ? WHERE chunk_id = ?").run(trigger, row.chunk_id);
          } catch (_) {}
        }
      }
      
      byTrigger[trigger] = (byTrigger[trigger] || 0) + 1;
    }
    
    return { byTrigger, totalActive, totalAll };
  });

  // Write to stats table
  withDb(db => {
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO memory_daily_stats (date, metric, value, details, collected_at)
      VALUES (?, ?, ?, ?, strftime('%s','now') * 1000)
    `);
    upsert.run(dateStr, "trigger.total_all", stats.totalAll, "all entries");
    upsert.run(dateStr, "trigger.total_active", stats.totalActive, "non-archived");
    
    let classified = 0;
    for (const [trigger, count] of Object.entries(stats.byTrigger)) {
      upsert.run(dateStr, `trigger.${trigger}`, count, "");
      classified += count;
    }
    // Orphan entries that have no text (deleted chunks)
    const orphans = stats.totalAll - classified;
    if (orphans > 0) {
      upsert.run(dateStr, "trigger.orphan", orphans, "no matching chunk text");
    }
  });

  console.log(`[stats] Triggers: ${JSON.stringify(stats.byTrigger)}`);
  return stats;
}

// ── #1: Rescue Rate — analyze autoRecall injection from episodes + protected memory ──
function collectRescueRate(dateStr) {
  const yDate = yesterdayDateStr();
  
  withDb(db => {
    // Check if episodes directory has files for the last 3 days
    const episodes = [];
    for (let d = 1; d <= 3; d++) {
      const dt = new Date();
      dt.setDate(dt.getDate() - d);
      const ds = dt.toISOString().split('T')[0];
      const epPath = resolve(EPISODES_DIR, `${ds}.md`);
      if (existsSync(epPath)) {
        episodes.push({ date: ds, size: readFileSync(epPath, "utf-8").length });
      }
    }
    
    // Count protected memories
    const protectedCount = db.prepare("SELECT COUNT(*) FROM memory_confidence WHERE is_protected = 1 AND is_archived = 0").get()["COUNT(*)"];
    
    // Count search→cite pairs from events table (if any)
    const recentSearches = db.prepare(`
      SELECT COUNT(*) as cnt FROM memory_engine_events
      WHERE event_type = 'search' AND event_time > strftime('%s','now') * 1000 - 86400000
    `).get()["cnt"];
    
    const recentCites = db.prepare(`
      SELECT COUNT(*) as cnt FROM memory_engine_events
      WHERE event_type = 'cite' AND event_time > strftime('%s','now') * 1000 - 86400000
    `).get()["cnt"];
    
    // Write to stats table
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO memory_daily_stats (date, metric, value, details, collected_at)
      VALUES (?, ?, ?, ?, strftime('%s','now') * 1000)
    `);
    upsert.run(dateStr, "rescue.protected_count", protectedCount, "");
    upsert.run(dateStr, "rescue.episode_count", episodes.length, `yesterday+2 days files`);
    upsert.run(dateStr, "rescue.searches_24h", recentSearches, "");
    upsert.run(dateStr, "rescue.cites_24h", recentCites, "");
    
    console.log(`[stats] Rescue: ${protectedCount} protected, ${episodes.length} episodes, ${recentSearches} searches, ${recentCites} cites`);
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
  
  // Archive section
  if (groups.archive) {
    lines.push("### 🗑️ 废品回收率");
    for (const s of groups.archive) {
      const key = s.metric.replace("archive.", "");
      lines.push(`- ${key}: ${s.value} ${s.details ? `(${s.details})` : ""}`);
    }
    lines.push("");
  }
  
  // Trigger section
  if (groups.trigger) {
    lines.push("### ✍️ 写入触发分布");
    for (const s of groups.trigger) {
      const key = s.metric.replace("trigger.", "");
      lines.push(`- ${key}: ${s.value}`);
    }
    lines.push("");
  }
  
  // Rescue section
  if (groups.rescue) {
    lines.push("### 🆘 抢救成功率");
    for (const s of groups.rescue) {
      const key = s.metric.replace("rescue.", "");
      lines.push(`- ${key}: ${s.value} ${s.details ? `(${s.details})` : ""}`);
    }
    lines.push("");
  }
  
  lines.push("---\n");
  
  // Append to stats history file
  const logDir = resolve(WORKSPACE, "memory");
  mkdirSync(logDir, { recursive: true });
  appendFileSync(STATS_LOG, lines.join("\n"));
  console.log(`[stats] Report appended to ${STATS_LOG}`);
}

// ── Main ──
async function main() {
  const dateStr = todayDateStr();
  console.log(`[stats] === Memory Stats — ${dateStr} ===`);
  
  ensureStatsTable();
  
  // Collect archive rate
  collectArchiveRate(dateStr);
  
  // Collect write triggers
  collectWriteTriggers(dateStr);
  
  // Collect rescue rate
  collectRescueRate(dateStr);
  
  // Generate report
  generateReport(dateStr);
  
  console.log("[stats] ✅ Complete");
}

main().catch(e => {
  console.error("[stats] ❌ Failed:", e.message);
  process.exit(1);
});
