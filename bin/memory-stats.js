#!/usr/bin/env node
/**
 * memory-stats.js — 记忆系统每日统计
 *
 * Core is a read-only observation source. Statistics are persisted in the
 * memory-engine-owned database.
 */

const { homedir } = require("node:os");
const { dirname, resolve } = require("node:path");
const { appendFileSync, mkdirSync } = require("node:fs");
const Database = require("better-sqlite3");

function resolveRuntime(options = {}) {
  const home = homedir();
  const workspaceDir = options.workspaceDir
    || process.env.MEMORY_ENGINE_WORKSPACE
    || process.env.MEMORY_ENGINE_WORKSPACE_DIR
    || resolve(home, ".openclaw/workspace");
  return {
    coreDbPath: options.coreDbPath
      || process.env.MEMORY_ENGINE_CORE_DB
      || process.env.CORE_DB_PATH
      || resolve(home, ".openclaw/memory/main.sqlite"),
    engineDbPath: options.engineDbPath
      || process.env.MEMORY_ENGINE_DB
      || process.env.ENGINE_DB_PATH
      || resolve(home, ".openclaw/memory/memory-engine/memory-engine.sqlite"),
    workspaceDir,
    dailyDir: resolve(workspaceDir, "memory"),
    statsLog: resolve(workspaceDir, "memory/stats-history.md"),
  };
}

function withCoreDb(runtime, fn) {
  const db = new Database(runtime.coreDbPath, { readonly: true, fileMustExist: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function withEngineDb(runtime, fn) {
  mkdirSync(dirname(runtime.engineDbPath), { recursive: true });
  const db = new Database(runtime.engineDbPath, { readonly: false, fileMustExist: false });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function todayDateStr() {
  // Use local timezone (Asia/Shanghai) date.
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
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

function ensureStatsTable(runtime) {
  withEngineDb(runtime, db => {
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
  });
  console.log("[stats] Engine statistics table ensured");
}

function collectOverview(dateStr, runtime) {
  const stats = withCoreDb(runtime, db => {
    const total = db.prepare("SELECT COUNT(*) FROM chunks WHERE source = 'memory'").get()["COUNT(*)"];

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

    const files = db.prepare("SELECT COUNT(DISTINCT path) FROM chunks WHERE source = 'memory'").get()["COUNT(DISTINCT path)"];
    const yesterday = Date.now() - 86400000;
    const recent = db.prepare("SELECT COUNT(*) FROM chunks WHERE source = 'memory' AND updated_at > ?").get(yesterday);

    return { total, byType, files, recent: recent["COUNT(*)"] };
  });

  withEngineDb(runtime, db => {
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

function collectWriteTriggers(dateStr, runtime) {
  const stats = withCoreDb(runtime, db => {
    const rows = db.prepare(`
      SELECT path, model, updated_at FROM chunks WHERE source = 'memory' ORDER BY updated_at DESC
    `).all();

    const byTrigger = {};
    for (const row of rows) {
      const trigger = classifyTrigger(row.path);
      byTrigger[trigger] = (byTrigger[trigger] || 0) + 1;
    }

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const yesterdayStart = dayStart.getTime() - 86400000;
    const yesterdayEnd = dayStart.getTime();
    const yesterdayNew = db.prepare(`
      SELECT COUNT(*) FROM chunks WHERE source = 'memory' AND updated_at BETWEEN ? AND ?
    `).get(yesterdayStart, yesterdayEnd);

    return { byTrigger, total: rows.length, yesterdayNew: yesterdayNew["COUNT(*)"] };
  });

  withEngineDb(runtime, db => {
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

function collectActivity(dateStr, runtime) {
  const stats = withCoreDb(runtime, db => {
    const withEmbedding = db.prepare("SELECT COUNT(*) FROM chunks WHERE source = 'memory' AND embedding IS NOT NULL AND embedding != ''").get()["COUNT(*)"];
    const total = db.prepare("SELECT COUNT(*) FROM chunks WHERE source = 'memory'").get()["COUNT(*)"];
    const dailyFilesCount = db.prepare("SELECT COUNT(*) FROM chunks WHERE path LIKE 'memory/%-%-%.md' AND source = 'memory'").get()["COUNT(*)"];
    const models = db.prepare("SELECT DISTINCT model FROM chunks WHERE source = 'memory' AND model != ''").all().map(r => r.model);
    const weekAgo = Date.now() - 7 * 86400000;
    const weekCount = db.prepare("SELECT COUNT(*) FROM chunks WHERE source = 'memory' AND updated_at > ?").get(weekAgo)["COUNT(*)"];
    return {
      withEmbedding,
      total,
      dailyFilesCount,
      models,
      weekCount,
    };
  });

  withEngineDb(runtime, db => {
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO memory_daily_stats (date, metric, value, details, collected_at)
      VALUES (?, ?, ?, ?, strftime('%s','now') * 1000)
    `);
    upsert.run(dateStr, "health.with_embedding", stats.withEmbedding, "");
    upsert.run(dateStr, "health.without_embedding", stats.total - stats.withEmbedding, "");
    upsert.run(dateStr, "health.daily_files", stats.dailyFilesCount, "");
    upsert.run(dateStr, "health.models_count", stats.models.length, stats.models.join(","));
    upsert.run(dateStr, "health.active_7d", stats.weekCount, "chunks updated in last 7 days");
  });

  console.log(`[stats] Health: ${stats.withEmbedding}/${stats.total} embedded, ${stats.models.length} models, ${stats.weekCount} active/7d`);
  return stats;
}

function generateReport(dateStr, runtime) {
  const stats = withEngineDb(runtime, db => {
    return db.prepare("SELECT * FROM memory_daily_stats WHERE date = ?").all(dateStr);
  });

  if (stats.length === 0) {
    console.log("[stats] No stats for today yet");
    return;
  }

  const lines = [`## 📊 记忆统计 — ${dateStr}`, ""];
  const groups = {};
  for (const s of stats) {
    const prefix = s.metric.split(".")[0];
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(s);
  }

  if (groups.overview) {
    lines.push("### 📦 记忆总览");
    for (const s of groups.overview) {
      const key = s.metric.replace("overview.", "");
      lines.push(`- **${key}**: ${s.value} ${s.details ? `(${s.details})` : ""}`);
    }
    lines.push("");
  }

  if (groups.trigger) {
    lines.push("### ✍️ 写入触发分布");
    for (const s of groups.trigger) {
      const key = s.metric.replace("trigger.", "");
      lines.push(`- **${key}**: ${s.value} ${s.details ? `(${s.details})` : ""}`);
    }
    lines.push("");
  }

  if (groups.health) {
    lines.push("### 💪 健康度");
    for (const s of groups.health) {
      const key = s.metric.replace("health.", "");
      lines.push(`- **${key}**: ${s.value} ${s.details ? `(${s.details})` : ""}`);
    }
    lines.push("");
  }

  lines.push("---\n");
  mkdirSync(runtime.dailyDir, { recursive: true });
  appendFileSync(runtime.statsLog, lines.join("\n"));
  console.log(`[stats] Report appended to ${runtime.statsLog}`);
  return lines.join("\n");
}

async function main(options = {}) {
  const runtime = resolveRuntime(options);
  const dateStr = options.dateStr || todayDateStr();
  console.log(`[stats] === Memory Stats — ${dateStr} ===`);

  ensureStatsTable(runtime);
  collectOverview(dateStr, runtime);
  collectWriteTriggers(dateStr, runtime);
  collectActivity(dateStr, runtime);
  generateReport(dateStr, runtime);

  console.log("[stats] ✅ Complete");
  return { dateStr, runtime };
}

module.exports = {
  classifyTrigger,
  collectActivity,
  collectOverview,
  collectWriteTriggers,
  ensureStatsTable,
  generateReport,
  main,
  resolveRuntime,
  todayDateStr,
  withCoreDb,
  withEngineDb,
};

if (require.main === module) {
  main().catch(e => {
    console.error("[stats] ❌ Failed:", e.message);
    process.exit(1);
  });
}
