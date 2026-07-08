#!/usr/bin/env node
/**
 * flush-session-rawlog.js
 *
 * 在模型切换 / session reset 前，将对话 flush 到 raw_log DB，
 * 避免切换后数据丢失导致摘要漏记。
 *
 * 两种写入模式：
 *   1. smart-add 文件（轻量，用于回溯查阅）
 *   2. 直接写入 SQLite（确保 session-checkpoint 能读到 raw_log）
 *
 * 用法:
 *   node scripts/flush-session-rawlog.js                         # flush 最新重置的 session
 *   node scripts/flush-session-rawlog.js --current               # flush 当前 session
 *   node scripts/flush-session-rawlog.js --key <sessionKey>      # flush 指定 session
 *   node scripts/flush-session-rawlog.js --checkpoint            # session-checkpoint 集成模式
 *   node scripts/flush-session-rawlog.js --all                   # flush 所有旧 session
 */

const { readFileSync, existsSync, mkdirSync, appendFileSync, statSync, readdirSync } = require("node:fs");
const { resolve, basename, dirname } = require("node:path");
const { createHash } = require("node:crypto");
const { homedir } = require("node:os");
const Database = require("better-sqlite3");

const HOME = homedir();
const WORKSPACE = resolve(HOME, ".openclaw/workspace");
const SESSIONS_DIR = resolve(HOME, ".openclaw/agents/main/sessions");
const SMART_ADD_DIR = resolve(WORKSPACE, "memory/smart-add");
const MAIN_DB_PATH = resolve(HOME, ".openclaw/memory/main.sqlite");
const ME_DB_PATH = resolve(HOME, ".openclaw/memory/memory-engine/memory-engine.sqlite");

// ── Helpers ──

function log(msg) {
  const t = new Date().toISOString().slice(11, 19);
  process.stderr.write(`[flush ${t}] ${msg}\n`);
}

function hash(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateStrFromTs(tsStr) {
  const d = new Date(tsStr);
  if (isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function tsId() {
  return new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
}

function sessionKeyFromName(name) {
  // Handle: <key>.jsonl, <key>.jsonl.reset.<ts>, <key>.jsonl.deleted.<ts>
  return name.replace(/\.jsonl(\..+)?$/, "");
}

/** Cron session keys to skip */
const CRON_PREFIXES = ["cron:", "dreaming-"];

function isCronSession(key) {
  return CRON_PREFIXES.some((p) => key.includes(p));
}

// ── DB helpers ──

function getMainDb() {
  if (!existsSync(MAIN_DB_PATH)) return null;
  try {
    const db = new Database(MAIN_DB_PATH, { readonly: false });
    db.pragma("journal_mode = WAL");
    return db;
  } catch (e) {
    log(`Cannot open main DB: ${e.message}`);
    return null;
  }
}

function getMeDb() {
  mkdirSync(dirname(ME_DB_PATH), { recursive: true });
  try {
    const db = new Database(ME_DB_PATH, { readonly: false });
    db.pragma("journal_mode = WAL");
    // Ensure memory_confidence table exists
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
      );
      CREATE INDEX IF NOT EXISTS idx_mc_category ON memory_confidence(category);
    `);
    return db;
  } catch (e) {
    log(`Cannot open ME DB: ${e.message}`);
    return null;
  }
}

// ── Session file discovery ──

function getSessionFiles() {
  if (!existsSync(SESSIONS_DIR)) return [];
  return readdirSync(SESSIONS_DIR)
    .filter((f) => (f.endsWith(".jsonl") || f.includes(".jsonl.")) && !f.includes(".deleted.") && !f.includes(".trajectory."))
    .map((f) => ({
      path: resolve(SESSIONS_DIR, f),
      name: f,
      mtime: statSync(resolve(SESSIONS_DIR, f)).mtimeMs,
      key: sessionKeyFromName(f),
      isReset: f.includes(".reset."),
    }))
    .sort((a, b) => b.mtime - a.mtime);
}

// ── Session parsing ──

function parseSessionMessages(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter(Boolean);
  const messages = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type !== "message" || !obj.message) continue;
      const msg = obj.message;
      const role = msg.role;
      if (role !== "user" && role !== "assistant") continue;

      const ts = obj.timestamp;
      let text = "";

      if (typeof msg.content === "string") {
        text = msg.content.trim();
      } else if (Array.isArray(msg.content)) {
        text = msg.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n")
          .trim();
      }

      if (!text) continue;
      if (role === "assistant" && text.length < 3) continue;

      messages.push({ role, text, ts });
    } catch (_) {}
  }

  return messages;
}

// ── Direct SQLite write ──

/**
 * Write conversation messages directly as raw_log entries in the DB.
 * Creates chunks in main.sqlite + memory_confidence entries in memory-engine DB.
 */
function toEventTimestampSec(value, fallbackSec) {
  if (value === null || value === undefined || value === "") return fallbackSec;
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value > 1e12 ? value / 1000 : value);
  const raw = String(value).trim();
  if (!raw) return fallbackSec;
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return Math.floor(numeric > 1e12 ? numeric / 1000 : numeric);
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : fallbackSec;
}

function getChunkColumns(db) {
  return new Set(
    db.prepare("PRAGMA table_info(chunks)").all().map((row) => String(row.name || "")),
  );
}

function buildChunkInsert(columns) {
  const hasDedicatedEventTime = columns.has("event_at");
  const insertColumns = [
    "id",
    "path",
    "source",
    "start_line",
    "end_line",
    "hash",
    "model",
    "text",
    "embedding",
  ];
  if (hasDedicatedEventTime) insertColumns.push("event_at");
  if (columns.has("created_at")) insertColumns.push("created_at");
  insertColumns.push("updated_at");

  const placeholders = insertColumns.map(() => "?").join(", ");
  return {
    hasDedicatedEventTime,
    insertColumns,
    sql: `INSERT OR IGNORE INTO chunks (${insertColumns.join(", ")}) VALUES (${placeholders})`,
  };
}

function writeToDb(dateStr, messages, mainDb, meDb) {
  if (!mainDb || !meDb) {
    log("  DB not available, skipping SQLite write");
    return { written: 0 };
  }

  const smartAddPath = `memory/smart-add/${dateStr}.md`;
  const fallbackSec = Math.floor(Date.now() / 1000);
  const chunkColumns = getChunkColumns(mainDb);
  const chunkInsert = buildChunkInsert(chunkColumns);
  const insertChunk = mainDb.prepare(chunkInsert.sql);
  let written = 0;

  for (const m of messages) {
    const eventSec = toEventTimestampSec(m.ts, fallbackSec);
    const nowSec = Math.floor(Date.now() / 1000);
    const chunkId = hash(m.text + m.ts + dateStr);

    // Only check memory_confidence (fastest dedup)
    const existing = meDb.prepare("SELECT chunk_id FROM memory_confidence WHERE chunk_id = ?").get(chunkId);
    if (existing) continue;

    try {
      // New core schema stores raw_log event time in event_at.
      // Legacy core schema has no event_at, so updated_at must temporarily carry event time
      // to keep checkpoint targetDate filtering correct until explicit core migration runs.
      const chunkRow = {
        id: chunkId,
        path: smartAddPath,
        source: "memory",
        start_line: 0,
        end_line: 0,
        hash: hash(m.text),
        model: "flush-script",
        text: m.text,
        embedding: "",
        event_at: eventSec,
        created_at: nowSec,
        updated_at: chunkInsert.hasDedicatedEventTime ? nowSec : eventSec,
      };
      insertChunk.run(...chunkInsert.insertColumns.map((column) => chunkRow[column]));

      // Insert into memory_confidence table (memory-engine.sqlite)
      meDb.prepare(`
        INSERT OR IGNORE INTO memory_confidence
        (chunk_id, initial_confidence, confidence, last_confidence_update, base_tau, hit_count, is_archived, is_protected, conflict_flag, category)
        VALUES (?, 0.5, 0.5, ?, 7.0, 0, 0, 0, 0, 'raw_log')
      `).run(chunkId, eventSec);

      written++;
    } catch (e) {
      log(`  DB write error: ${e.message.slice(0, 80)}`);
    }
  }

  return { written };
}

// ── Smart-add file write (fallback, for human readability) ──

function writeSmartAddFile(dateStr, messages) {
  const filePath = resolve(SMART_ADD_DIR, `${dateStr}.md`);
  mkdirSync(SMART_ADD_DIR, { recursive: true });

  const lines = messages.map((m) => {
    const prefix = m.role === "user" ? "**User:**" : "**Assistant:**";
    return `${prefix} ${m.text}`;
  });

  const combinedText = lines.join("\n\n");
  const fp = hash(combinedText + dateStr + "raw_log").slice(0, 40);
  const entryId = `${tsId()}_raw_log_${hash(combinedText).slice(0, 8)}`;

  // Dedup
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf-8");
    if (existing.includes(fp)) {
      return { written: false, reason: "dup" };
    }
  }

  const header = existsSync(filePath) ? "" : "# Smart Added Memory\n\n";
  const entry = `${header}## ${entryId}\n\nCategory: raw_log\n<!-- smart-add-fingerprint: ${fp} -->\n\n${combinedText}\n\n`;
  appendFileSync(filePath, header ? entry : `\n${entry}`);

  return { written: true, entryId };
}

// ── Core flush function ──

function flushSession(filePath, sessionKey) {
  const label = `${sessionKey || basename(filePath)}`;
  log(`Flushing: ${label}`);

  const messages = parseSessionMessages(filePath);
  const uc = messages.filter((m) => m.role === "user").length;
  const ac = messages.filter((m) => m.role === "assistant").length;
  log(`  Messages: ${messages.length} (user=${uc}, assistant=${ac})`);

  if (messages.length === 0) {
    return { key: sessionKey, flushed: false, reason: "no_messages" };
  }

  // Group by date
  const byDate = {};
  for (const m of messages) {
    const d = dateStrFromTs(m.ts);
    if (d) {
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(m);
    }
  }

  // Open DBs once
  const mainDb = getMainDb();
  const meDb = getMeDb();

  const dayResults = [];

  for (const [dateStr, dateMsgs] of Object.entries(byDate)) {
    // Skip today's data — it's still streaming, let session-checkpoint handle it
    if (dateStr === todayStr() && !process.argv.includes("--force-today")) {
      log(`  → ${dateStr}: skipped (today, still streaming)`);
      dayResults.push({ date: dateStr, action: "skip", reason: "still_today" });
      continue;
    }

    // 1. Write to smart-add file (human readable)
    const fileResult = writeSmartAddFile(dateStr, dateMsgs);
    if (fileResult.written) {
      log(`  → ${dateStr}: ${dateMsgs.length} msgs → smart-add`);
    } else {
      log(`  → ${dateStr}: smart-add skipped (${fileResult.reason})`);
    }

    // 2. Write directly to SQLite (ensures checkpoint can find raw_log)
    const dbResult = writeToDb(dateStr, dateMsgs, mainDb, meDb);
    if (dbResult.written > 0) {
      log(`  → ${dateStr}: ${dbResult.written} entries → SQLite`);
    }

    dayResults.push({
      date: dateStr,
      smartAdd: fileResult.written || fileResult.reason,
      dbEntries: dbResult.written,
    });
  }

  if (mainDb) mainDb.close();
  if (meDb) meDb.close();

  const totalWritten = dayResults.reduce((s, r) => s + (r.dbEntries || 0), 0);

  return {
    key: sessionKey,
    flushed: totalWritten > 0 || dayResults.some((r) => r.smartAdd === true),
    userMessages: uc,
    assistantMessages: ac,
    totalMessages: messages.length,
    days: Object.keys(byDate).length,
    dbEntriesWritten: totalWritten,
    dayResults,
  };
}

// ── Is a session worth flushing? ──

function shouldFlush(file) {
  const now = Date.now();
  // Skip files younger than 5 minutes (still in use)
  if (now - file.mtime < 300000) return false;
  // Skip cron/dreaming sessions
  if (isCronSession(file.key)) return false;
  return true;
}

// ── Main ──

function main() {
  const args = process.argv.slice(2);
  const explicitKey = args.includes("--key") && args[args.indexOf("--key") + 1];
  const isAll = args.includes("--all");
  const isCheckpoint = args.includes("--checkpoint");
  const isCurrent = args.includes("--current");

  const files = getSessionFiles();
  log(`Found ${files.length} session files`);

  if (explicitKey) {
    const match = files.find((f) => f.key === explicitKey || f.name === explicitKey);
    if (!match) {
      log(`Session not found: ${explicitKey}`);
      process.exit(1);
    }
    const result = flushSession(match.path, match.key);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (isAll) {
    const results = files.filter(shouldFlush).map((f) => flushSession(f.path, f.key));
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (isCheckpoint) {
    log("=== Checkpoint integration ===");
    const targets = files.filter(shouldFlush);
    log(`Candidates: ${targets.length}`);

    const results = [];
    for (const f of targets) {
      const r = flushSession(f.path, f.key);
      results.push(r);
    }
    console.log(JSON.stringify({ mode: "checkpoint", results }, null, 2));
    return;
  }

  if (isCurrent) {
    // Flush the current main session's data up to now
    const current = files.find((f) => f.key === "agent:main:main") || files[0];
    if (!current) {
      log("No current session found");
      process.exit(0);
    }
    const result = flushSession(current.path, current.key);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Default: find the most recent reset session that hasn't been flushed
  const targets = files.filter(shouldFlush);
  const resetSessions = targets.filter((f) => f.isReset);

  if (resetSessions.length > 0) {
    // Flush only the most recent reset session
    const result = flushSession(resetSessions[0].path, resetSessions[0].key);
    console.log(JSON.stringify(result, null, 2));
  } else if (targets.length > 0) {
    // Fallback: flush the most recent old session
    const result = flushSession(targets[0].path, targets[0].key);
    console.log(JSON.stringify(result, null, 2));
  } else {
    log("No sessions need flushing");
    console.log(JSON.stringify({ flushed: false, reason: "no_sessions" }));
  }
}

main();
