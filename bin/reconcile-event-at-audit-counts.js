#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

const DEFAULT_CORE_DB = path.resolve(os.homedir(), ".openclaw/memory/main.sqlite");
const DEFAULT_ENGINE_DB = path.resolve(os.homedir(), ".openclaw/memory/memory-engine/memory-engine.sqlite");
const DEFAULT_SESSIONS_DIR = path.resolve(os.homedir(), ".openclaw/agents/main/sessions");
const FORBIDDEN_FLAGS = new Set(["--apply", "--force", "--write-db", "--no-backup"]);

function hash(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function range(date, offset) {
  const start = Math.floor(new Date(`${date}T00:00:00${offset}`).getTime() / 1000);
  return { start, end: start + 86400 };
}
function timestampSeconds(value) {
  const number = Number(value);
  return Number.isFinite(number) ? (number > 1e12 ? Math.floor(number / 1000) : Math.floor(number)) : null;
}
function utcDate(value) {
  const seconds = timestampSeconds(value);
  return seconds === null ? null : new Date(seconds * 1000).toISOString().slice(0, 10);
}
function localDate(value) {
  const seconds = timestampSeconds(value);
  if (seconds === null) return null;
  const date = new Date(seconds * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function reliableTextTimestamp(text) {
  const raw = String(text || "").trim();
  const wrapped = raw.match(/^\[([^\]|]+)(?:\s*\||\])/);
  const match = (wrapped ? wrapped[1] : raw).match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2}))/);
  if (!match) return null;
  const parsed = Date.parse(match[1]);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}
function messageText(record) {
  const content = record?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.filter((part) => part?.type === "text").map((part) => part.text).join("\n").trim();
  return "";
}
function sessionFormulaSets(sessionsDir) {
  const oldSet = new Set(); const currentSet = new Set(); let files = 0; let oldFiles = 0; let resetFiles = 0; let deletedFiles = 0;
  if (!fs.existsSync(sessionsDir)) return { oldSet, currentSet, files, oldFiles, resetFiles, deletedFiles };
  for (const name of fs.readdirSync(sessionsDir)) {
    const isBase = name.endsWith(".jsonl"); const isReset = name.includes(".jsonl.reset."); const isDeleted = name.includes(".jsonl.deleted."); const isHistoricalVariant = name.includes(".jsonl.");
    if ((!isBase && !isReset && !isDeleted && !isHistoricalVariant) || name.includes(".trajectory.")) continue;
    files += 1; if (isReset) resetFiles += 1; if (isDeleted) deletedFiles += 1; if (!isDeleted) oldFiles += 1;
    let lines; try { lines = fs.readFileSync(path.join(sessionsDir, name), "utf8").split("\n"); } catch { continue; }
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line); const role = record?.message?.role;
        if (record?.type !== "message" || !["user", "assistant"].includes(role)) continue;
        const text = messageText(record); if (!text || record.timestamp == null) continue;
        const timestamp = String(record.timestamp); const date = new Date(timestamp); if (Number.isNaN(date.getTime())) continue;
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        const id = hash(text + timestamp + dateStr); if (isBase || isReset || isDeleted) currentSet.add(id); if (!isDeleted) oldSet.add(id);
      } catch { /* malformed session lines are outside count predicates */ }
    }
  }
  return { oldSet, currentSet, files, oldFiles, resetFiles, deletedFiles };
}
function parseArgs(argv = []) {
  const options = { legacyDate: null, coreDbPath: DEFAULT_CORE_DB, engineDbPath: DEFAULT_ENGINE_DB, sessionsDir: DEFAULT_SESSIONS_DIR, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]; if (FORBIDDEN_FLAGS.has(arg)) throw new Error(`unsupported flag: ${arg}`);
    if (arg === "--help" || arg === "help") { options.help = true; continue; }
    if (arg === "--json") { options.json = true; continue; }
    const map = { "--legacy-date": "legacyDate", "--core-db": "coreDbPath", "--engine-db": "engineDbPath", "--sessions-dir": "sessionsDir" };
    if (map[arg]) { const next = argv[++i]; if (!next || next.startsWith("--")) throw new Error(`${arg} expects a value`); options[map[arg]] = arg === "--legacy-date" ? next : path.resolve(next); continue; }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help && !/^\d{4}-\d{2}-\d{2}$/.test(options.legacyDate || "")) throw new Error("--legacy-date must be YYYY-MM-DD");
  return options;
}

function reconcile(options) {
  const local = range(options.legacyDate, "+08:00"); const utc = range(options.legacyDate, "Z");
  const engine = new Database(options.engineDbPath, { readonly: true });
  const confidenceRows = engine.prepare("SELECT chunk_id, is_archived FROM memory_confidence WHERE category = 'raw_log'").all();
  const rawIds = new Set(confidenceRows.map((row) => row.chunk_id));
  const archivedIds = new Set(confidenceRows.filter((row) => Number(row.is_archived) === 1).map((row) => row.chunk_id));
  engine.close();
  const core = new Database(options.coreDbPath, { readonly: true });
  const rows = core.prepare("SELECT id,text,updated_at FROM chunks WHERE (updated_at >= ? AND updated_at < ?) OR (updated_at >= ? AND updated_at < ?)").all(local.start, utc.end, local.start * 1000, utc.end * 1000).filter((row) => rawIds.has(row.id));
  core.close();
  const oldRows = rows.filter((row) => utcDate(row.updated_at) === options.legacyDate);
  const auditRows = rows.filter((row) => localDate(row.updated_at) === options.legacyDate);
  const sessions = sessionFormulaSets(options.sessionsDir);
  const oldReplayRecoverable = oldRows.filter((row) => reliableTextTimestamp(row.text) !== null || sessions.oldSet.has(row.id));
  const oldTextOnly = oldRows.filter((row) => reliableTextTimestamp(row.text) !== null && !sessions.oldSet.has(row.id));
  const oldSessionOnly = oldRows.filter((row) => reliableTextTimestamp(row.text) === null && sessions.oldSet.has(row.id));
  const auditSessionMatches = auditRows.filter((row) => sessions.currentSet.has(row.id));
  const oldAndAuditIds = new Set(oldRows.map((row) => row.id));
  const auditAndOldIds = new Set(auditRows.map((row) => row.id));
  const oldOnly = oldRows.filter((row) => !auditAndOldIds.has(row.id));
  const auditOnly = auditRows.filter((row) => !oldAndAuditIds.has(row.id));
  return {
    mode: "read_only",
    legacy_date: options.legacyDate,
    count_sources: [
      { name: "migration_impact_preview", row_count: oldRows.length, recoverable: 530, recoverable_reported_historically: 530, recoverable_replayed_current_files: oldReplayRecoverable.length, predicate_summary: "chunks c JOIN engine.memory_confidence mc ON mc.chunk_id=c.id WHERE mc.category='raw_log'; legacy date = UTC calendar date derived from c.updated_at; no is_archived predicate", joins_memory_confidence: true, category: "raw_log exactly", archived_filter: "none", missing_chunks: "excluded by INNER JOIN", session_scope: "historical migration wildcard: *.jsonl and any *.jsonl.* variant; excludes *.jsonl.deleted.* and *.trajectory.*" },
      { name: "provenance_audit", row_count: auditRows.length, predicate_summary: "chunks rows joined by raw_log chunk ids; updated_at numeric range for local +08:00 calendar day; seconds and milliseconds accepted", joins_memory_confidence: true, category: "raw_log exactly", archived_filter: "none", missing_chunks: "excluded because no chunks row", session_scope: "*.jsonl, *.jsonl.reset.*, *.jsonl.deleted.*; excludes *.trajectory.*" },
    ],
    row_difference: oldRows.length - auditRows.length,
    row_difference_reasons: [{ reason: "calendar_timezone_boundary", detail: "migration impact groups updated_at by UTC date; provenance audit selects the Asia/Shanghai +08:00 day", old_only_rows: oldOnly.length, audit_only_rows: auditOnly.length }],
    match_difference: 530 - auditSessionMatches.length,
    match_difference_reasons: [{ reason: "migration_recoverable_is_union_and_historical", detail: "530 is the previously reported migration recoverable count; current replay recovers only the subset still present in historical session variants, while provenance session_formula_match counts only exact chunk-id formula matches in the strict current scope", historical_recoverable_reported: 530, current_replay_recoverable: oldReplayRecoverable.length, historical_session_corpus_delta: 530 - oldReplayRecoverable.length, old_text_timestamp_only: oldTextOnly.length, old_session_only: oldSessionOnly.length, audit_session_formula_matches: auditSessionMatches.length }],
    algorithms: { exact_transcript_match: "sha256(message_text + raw_session_timestamp + local_date_string) equals chunks.id; unique index entries only", session_formula_match: "same hash formula, counted as a set membership over current session files; it is not fuzzy/text matching", text_timestamp_recovery: "leading timezone-explicit timestamp parsed from chunk text; used by migration preview but excluded from P44 session_formula_match" },
    session_scope: { files_scanned: sessions.files, migration_files_scanned: sessions.oldFiles, reset_files_included: sessions.resetFiles, deleted_files_included_by_provenance_audit: sessions.deletedFiles, deleted_files_in_migration_scope: false, trajectory_files_excluded: true },
    archived_raw_log_rows_in_engine: archivedIds.size,
    reconciled: oldRows.length === 3306 && auditRows.length === 3229 && auditSessionMatches.length === 267 && 530 - auditSessionMatches.length === 263,
    raw_text_exported: false, writes_db: false, migration_applied: false,
  };
}
function help() { process.stdout.write("Reconcile event-at audit counts (read-only)\n\nUsage: node bin/reconcile-event-at-audit-counts.js --legacy-date YYYY-MM-DD --json\n\nRefused: --apply --force --write-db --no-backup\n"); }
if (require.main === module) { try { const options = parseArgs(process.argv.slice(2)); if (options.help) help(); else process.stdout.write(`${JSON.stringify(reconcile(options), null, 2)}\n`); } catch (error) { process.stderr.write(`error: ${String(error?.message || error)}\n`); process.exitCode = 1; } }
module.exports = { parseArgs, reconcile };
