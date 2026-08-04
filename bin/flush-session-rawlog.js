#!/usr/bin/env node
/**
 * flush-session-rawlog.js
 *
 * 在模型切换 / session reset 前，将对话 flush 到 raw_log DB，
 * 避免切换后数据丢失导致摘要漏记。
 *
 * 写入 canonical smart-add 文件，供 checkpoint 按目标日期读取。
 * memory-engine 不直接写 OpenClaw Core DB；Core 索引更新由显式 owner sync 负责。
 *
 * 用法:
 *   node scripts/flush-session-rawlog.js                         # flush 最新重置的 session
 *   node scripts/flush-session-rawlog.js --current               # flush 当前 session
 *   node scripts/flush-session-rawlog.js --key <sessionKey>      # flush 指定 session
 *   node scripts/flush-session-rawlog.js --checkpoint --target-date YYYY-MM-DD
 *   node scripts/flush-session-rawlog.js --all                   # flush 所有旧 session
 */

const { readFileSync, existsSync, mkdirSync, appendFileSync, statSync, readdirSync } = require("node:fs");
const { resolve, basename } = require("node:path");
const { createHash } = require("node:crypto");
const { homedir } = require("node:os");

const HOME = homedir();
const WORKSPACE = resolve(HOME, ".openclaw/workspace");
const SESSIONS_DIR = resolve(HOME, ".openclaw/agents/main/sessions");
const SMART_ADD_DIR = resolve(WORKSPACE, "memory/smart-add");

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

function validateTargetDate(value) {
  const targetDate = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error("--target-date must be a valid YYYY-MM-DD date");
  }
  const [year, month, day] = targetDate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isFinite(parsed.getTime())
    || parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new Error("--target-date must be a valid YYYY-MM-DD date");
  }
  return targetDate;
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

// ── Canonical smart-add file write ──

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
  const entry = `${header}## ${entryId}\n\nCategory: raw_log\nProvenance: session_flush\n<!-- smart-add-fingerprint: ${fp} -->\n\n${combinedText}\n\n`;
  appendFileSync(filePath, header ? entry : `\n${entry}`);

  return { written: true, entryId };
}

// ── Core flush function ──

function flushSession(filePath, sessionKey, options = {}) {
  const label = `${sessionKey || basename(filePath)}`;
  const targetDate = options.targetDate || null;
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

  const dayResults = [];

  for (const [dateStr, dateMsgs] of Object.entries(byDate)) {
    if (targetDate && dateStr !== targetDate) {
      log(`  → ${dateStr}: skipped (out_of_target_date)`);
      dayResults.push({
        date: dateStr,
        action: "skip",
        reason: "out_of_target_date",
        smartAdd: "out_of_target_date",
        coreDbWrite: "disabled",
      });
      continue;
    }

    // Skip today's data — it's still streaming, let session-checkpoint handle it
    if (dateStr === todayStr() && !process.argv.includes("--force-today")) {
      log(`  → ${dateStr}: skipped (today, still streaming)`);
      dayResults.push({ date: dateStr, action: "skip", reason: "still_today" });
      continue;
    }

    const fileResult = writeSmartAddFile(dateStr, dateMsgs);
    if (fileResult.written) {
      log(`  → ${dateStr}: ${dateMsgs.length} msgs → canonical smart-add`);
    } else {
      log(`  → ${dateStr}: smart-add skipped (${fileResult.reason})`);
    }

    dayResults.push({
      date: dateStr,
      smartAdd: fileResult.written || fileResult.reason,
      coreDbWrite: "disabled",
    });
  }

  const smartAddEntriesWritten = dayResults.filter((result) => result.smartAdd === true).length;

  return {
    key: sessionKey,
    flushed: smartAddEntriesWritten > 0,
    userMessages: uc,
    assistantMessages: ac,
    totalMessages: messages.length,
    days: Object.keys(byDate).length,
    smartAddEntriesWritten,
    targetDate: targetDate || null,
    outOfTargetDateGroupsSkipped: dayResults.filter((result) => result.reason === "out_of_target_date").length,
    dbEntriesWritten: 0,
    coreDbWriteDisabled: true,
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
  const targetDateArg = args.includes("--target-date")
    ? args[args.indexOf("--target-date") + 1]
    : args.find((arg) => arg.startsWith("--target-date="))?.slice("--target-date=".length);

  if (isCheckpoint && !targetDateArg) {
    log("ERROR: --target-date required for --checkpoint");
    process.exitCode = 1;
    return;
  }

  let targetDate = null;
  if (targetDateArg) {
    try {
      targetDate = validateTargetDate(targetDateArg);
    } catch (error) {
      log(`ERROR: ${error.message}`);
      process.exitCode = 1;
      return;
    }
  }

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
      const r = flushSession(f.path, f.key, { targetDate });
      results.push(r);
    }
    console.log(JSON.stringify({
      mode: "checkpoint",
      targetDate,
      sessionsScanned: targets.length,
      targetDateEntriesWritten: results.reduce((sum, result) => sum + Number(result.smartAddEntriesWritten || 0), 0),
      outOfTargetDateGroupsSkipped: results.reduce((sum, result) => sum + Number(result.outOfTargetDateGroupsSkipped || 0), 0),
      results,
    }, null, 2));
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
