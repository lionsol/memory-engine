#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");

const FORBIDDEN_FLAGS = new Set(["--apply", "--force", "--write-db", "--no-backup"]);
const DEFAULT_CORE_DB = path.resolve(os.homedir(), ".openclaw/memory/main.sqlite");
const DEFAULT_ENGINE_DB = path.resolve(os.homedir(), ".openclaw/memory/memory-engine/memory-engine.sqlite");
const DEFAULT_SESSIONS_DIR = path.resolve(os.homedir(), ".openclaw/agents/main/sessions");
const DEFAULT_MEMORY_DIR = path.resolve(os.homedir(), ".openclaw/workspace/memory");

function sha256(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function normalize(value) { return String(value || "").replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim(); }
function addCount(map, value) { const key = String(value ?? ""); map[key] = (map[key] || 0) + 1; }
function sortedCounts(map, limit = 50) {
  return Object.fromEntries(Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit));
}
function epochSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
}
function rangeForDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--legacy-date must be YYYY-MM-DD");
  const start = Math.floor(new Date(`${date}T00:00:00+08:00`).getTime() / 1000);
  return { start, end: start + 86400 };
}
function safeReadJsonl(filePath, sessionIndex) {
  let content;
  try { content = fs.readFileSync(filePath, "utf8"); } catch { return; }
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      const message = record?.message;
      if (record?.type !== "message" || !message || !["user", "assistant"].includes(message.role)) continue;
      const text = typeof message.content === "string"
        ? message.content.trim()
        : Array.isArray(message.content) ? message.content.filter((p) => p?.type === "text").map((p) => p.text).join("\n").trim() : "";
      if (!text || record.timestamp == null) continue;
      const timestamp = String(record.timestamp);
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) continue;
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      sessionIndex.add(sha256(text + timestamp + dateStr));
    } catch { /* malformed session records do not affect DB row audit */ }
  }
}
function buildSessionIndex(sessionsDir) {
  const index = new Set();
  let files = 0;
  if (!fs.existsSync(sessionsDir)) return { index, files };
  for (const name of fs.readdirSync(sessionsDir)) {
    if (!(name.endsWith(".jsonl") || name.includes(".jsonl.reset.") || name.includes(".jsonl.deleted.")) || name.includes(".trajectory.")) continue;
    files += 1;
    safeReadJsonl(path.join(sessionsDir, name), index);
  }
  return { index, files };
}
function collectMemoryFileIndex(memoryDir) {
  const exact = new Map();
  const normalized = new Map();
  const files = [];
  const roots = ["smart-add", "generated-smart-add", "episodes", "legacy-daily-mirrors", "quarantine", "archive", "backups"]
    .map((name) => path.join(memoryDir, name)).filter((dir) => fs.existsSync(dir));
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && /\.(md|txt|jsonl?)$/i.test(entry.name)) {
        files.push(full);
        let text; try { text = fs.readFileSync(full, "utf8"); } catch { continue; }
        const blocks = text.split(/\n(?:##\s+|---\s*$)/m).map((block) => block.trim()).filter(Boolean);
        for (const block of [text, ...blocks]) {
          exact.set(sha256(block), (exact.get(sha256(block)) || []).concat(full));
          normalized.set(normalize(block), (normalized.get(normalize(block)) || []).concat(full));
          for (const line of block.split("\n").map((item) => item.trim()).filter(Boolean)) {
            exact.set(sha256(line), (exact.get(sha256(line)) || []).concat(full));
            normalized.set(normalize(line), (normalized.get(normalize(line)) || []).concat(full));
          }
        }
      }
    }
  }
  for (const root of roots) visit(root);
  return { exact, normalized, files };
}
function pathFamily(value) {
  const p = String(value || "");
  if (p.includes("generated-smart-add")) return "generated-smart-add";
  if (p.includes("smart-add")) return "smart-add";
  if (p.includes("legacy-daily-mirrors")) return "legacy-daily-mirrors";
  if (p.includes("episodes")) return "episodes";
  if (p.includes("quarantine")) return "quarantine";
  if (p.includes("archive")) return "archive";
  return "other";
}
function classifyWriter(row, formulaMatch) {
  const p = String(row.path || "");
  const model = String(row.model || "");
  if (formulaMatch) return "raw_session_flush_formula";
  if (p.includes("generated-smart-add") || model.includes("checkpoint")) return "checkpoint_generated";
  if (p.includes("legacy-daily-mirrors")) return "legacy_mirror";
  if (/reindex|backfill|migration|import/i.test(model)) return "reindex_backfill_migration";
  if (p.includes("smart-add")) return "smart_add_or_raw_log_import";
  return "other_historical_writer";
}
function distribution(values) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return { count: 0, min: null, max: null, mean: null, p50: null, p95: null };
  const at = (p) => nums[Math.min(nums.length - 1, Math.floor(nums.length * p))];
  return { count: nums.length, min: nums[0], max: nums[nums.length - 1], mean: Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2)), p50: at(0.5), p95: at(0.95) };
}
function batchStats(seconds) {
  const second = {}, minute = {};
  for (const value of seconds) { addCount(second, value); addCount(minute, Math.floor(value / 60)); }
  const max = (map) => Math.max(0, ...Object.values(map));
  const unique = Object.keys(second).length;
  const span = seconds.length ? Math.max(...seconds) - Math.min(...seconds) : 0;
  const reasons = [];
  if (max(second) >= 10) reasons.push("multiple_rows_share_same_second");
  if (max(minute) >= 100) reasons.push("large_same_minute_batch");
  if (seconds.length >= 100 && span <= 3600) reasons.push("rows_concentrated_in_short_window");
  return { unique_updated_at_count: unique, largest_same_second_batch: max(second), largest_same_minute_batch: max(minute), updated_at_span_seconds: span, looks_like_batch_write: reasons.length > 0, batch_write_reasons: reasons, top_seconds: sortedCounts(second, 10), top_minutes: sortedCounts(minute, 10) };
}

function auditRawLogProvenance(options = {}) {
  const range = rangeForDate(options.legacyDate);
  const coreDb = new Database(options.coreDbPath || DEFAULT_CORE_DB, { readonly: true });
  const engineDbPath = options.engineDbPath || DEFAULT_ENGINE_DB;
  const engineDb = new Database(engineDbPath, { readonly: true });
  const rawIds = new Set(engineDb.prepare("SELECT chunk_id FROM memory_confidence WHERE category = 'raw_log'").all().map((row) => row.chunk_id));
  const confidence = new Map(engineDb.prepare("SELECT chunk_id, last_confidence_update FROM memory_confidence WHERE category = 'raw_log'").all().map((row) => [row.chunk_id, row.last_confidence_update]));
  const rows = coreDb.prepare("SELECT id,path,source,start_line,end_line,hash,model,updated_at,LENGTH(text) AS text_length,text FROM chunks WHERE (updated_at >= ? AND updated_at < ?) OR (updated_at >= ? AND updated_at < ?)").all(range.start, range.end, range.start * 1000, range.end * 1000).filter((row) => rawIds.has(row.id));
  const session = buildSessionIndex(options.sessionsDir || DEFAULT_SESSIONS_DIR);
  const fileIndex = collectMemoryFileIndex(options.memoryDir || DEFAULT_MEMORY_DIR);
  const pathCounts = {}, sourceCounts = {}, modelCounts = {}, startEndCounts = {}, writerCounts = {}, familyCounts = {}, idLengthCounts = {}, updatedUnits = {}, confidenceUnits = {}, prefixCounts = {};
  const hashCounts = {}, duplicateText = {}, formulaRows = [], fileExact = new Set(), fileNormalized = new Set(), matchingPaths = {}, matchingPathFamilies = {};
  const lengths = [], updatedSeconds = [], confidenceTimes = [];
  let hashMatches = 0, hashMissing = 0, idEqualsHash = 0;
  for (const row of rows) {
    const text = String(row.text || "");
    addCount(pathCounts, row.path); addCount(sourceCounts, row.source); addCount(modelCounts, row.model); addCount(startEndCounts, `${row.start_line}:${row.end_line}`); addCount(familyCounts, pathFamily(row.path)); addCount(idLengthCounts, String(String(row.id || "").length)); addCount(prefixCounts, String(row.id || "").slice(0, 4));
    addCount(hashCounts, row.hash || ""); lengths.push(Number(row.text_length || text.length));
    const unit = Number(row.updated_at) >= 1e12 ? "milliseconds" : Number.isFinite(Number(row.updated_at)) ? "seconds" : "invalid"; addCount(updatedUnits, unit);
    const updatedSec = epochSeconds(row.updated_at); if (updatedSec !== null) updatedSeconds.push(updatedSec);
    const confidenceTime = confidence.get(row.id); if (confidenceTime != null) { confidenceTimes.push(epochSeconds(confidenceTime)); addCount(confidenceUnits, Number(confidenceTime) >= 1e12 ? "milliseconds" : "seconds"); }
    if (!row.hash) hashMissing += 1; else if (row.hash === sha256(text)) hashMatches += 1;
    if (row.id === row.hash) idEqualsHash += 1;
    const formulaMatch = session.index.has(row.id); if (formulaMatch) formulaRows.push(row.id);
    const exactFiles = fileIndex.exact.get(sha256(text)) || []; const normalizedFiles = fileIndex.normalized.get(normalize(text)) || [];
    if (exactFiles.length) { fileExact.add(row.id); for (const file of exactFiles) { addCount(matchingPaths, path.relative(options.memoryDir || DEFAULT_MEMORY_DIR, file)); addCount(matchingPathFamilies, pathFamily(path.relative(options.memoryDir || DEFAULT_MEMORY_DIR, file))); } }
    if (normalizedFiles.length) fileNormalized.add(row.id);
    addCount(writerCounts, classifyWriter(row, formulaMatch));
    if (text) { addCount(duplicateText, sha256(text)); }
  }
  const duplicateHashGroups = Object.values(hashCounts).filter((count) => count > 1).length;
  const duplicateTextGroups = Object.values(duplicateText).filter((count) => count > 1).length;
  const time = batchStats(updatedSeconds);
  const rawLogWriter = rows.length && writerCounts.raw_session_flush_formula === rows.length ? "flush-session-rawlog.js" : Object.entries(writerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown";
  coreDb.close(); engineDb.close();
  return {
    mode: "read_only",
    legacy_date: options.legacyDate,
    row_count: rows.length,
    path_breakdown: sortedCounts(pathCounts), source_breakdown: sortedCounts(sourceCounts), model_breakdown: sortedCounts(modelCounts), start_line_end_line_breakdown: sortedCounts(startEndCounts), path_family_breakdown: sortedCounts(familyCounts),
    hash_id_analysis: { hash_matches_sha256_text: hashMatches, hash_missing: hashMissing, id_equals_hash: idEqualsHash, hash_match_rate: rows.length ? Number((hashMatches / rows.length).toFixed(4)) : 0, duplicate_hash_group_count: duplicateHashGroups, exact_duplicate_text_hash_group_count: duplicateTextGroups },
    id_prefix_generation_clues: { id_length_breakdown: idLengthCounts, common_prefixes: sortedCounts(prefixCounts) },
    text_length_distribution: distribution(lengths),
    updated_at: { ...time, unit_breakdown: updatedUnits },
    memory_confidence_last_update: { distribution: distribution(confidenceTimes), unit_breakdown: confidenceUnits },
    session_formula_match: { session_files_scanned: session.files, matching_chunk_id_count: formulaRows.length, match_rate: rows.length ? Number((formulaRows.length / rows.length).toFixed(4)) : 0 },
    file_content_match: { exact_file_content_match_count: fileExact.size, normalized_line_block_match_count: fileNormalized.size, matching_paths: sortedCounts(matchingPaths), matching_path_families: sortedCounts(matchingPathFamilies) },
    writer_inventory: [
      { writer: "bin/flush-session-rawlog.js", active_period: "2026-06-02 onward; event-time fixes 2026-07-04/07-08", input_source: "session_jsonl", chunk_id_formula: "sha256(message_text + raw_session_timestamp + local_date_string)", text_transformations: ["trim message text", "smart-add file adds role wrapper only in file fallback"], timestamp_field_written: "updated_at on legacy schema; event_at plus created_at on current schema", timestamp_semantics: "event_time when session timestamp parses; fallback is write time if missing", evidence: "git 3b84412, 430a042, 44b2edd; bin/flush-session-rawlog.js:134-267" },
      { writer: "OpenClaw memory index / reindex", active_period: "historical; observed in 2026-06-15 rows", input_source: "memory/smart-add/*.md", chunk_id_formula: "OpenClaw indexer-specific; not the flush formula for these rows", text_transformations: ["smart-add markdown block parsing/indexing"], timestamp_field_written: "updated_at", timestamp_semantics: "index/write time or unknown; not proven event time", evidence: "06-15 model=Qwen/Qwen3-Embedding-4B, path=memory/smart-add/*, formula_match=0" },
      { writer: "lib/index-sync-runtime.js", active_period: "current/maintenance path", input_source: "indexed smart-add and episodes", chunk_id_formula: "does not create chunks; initializes memory_confidence for missing rows", text_transformations: [], timestamp_field_written: "last_confidence_update", timestamp_semantics: "maintenance time, not event time", evidence: "lib/index-sync-runtime.js:1-33" },
    ],
    writer_inventory_result: { dominant_writer_signature: rawLogWriter, writer_signature_breakdown: sortedCounts(writerCounts), known_formula: "sha256(message_text + raw_session_timestamp + local_date_string)", updated_at_semantics: "legacy updated_at is writer-selected timestamp; this audit does not treat it as event_at" },
    batch_write_analysis: time,
    likely_event_date_conclusion: time.looks_like_batch_write ? "likely_batch_write_date" : "mixed_or_unknown",
    conclusion_evidence: time.batch_write_reasons,
    raw_text_exported: false, writes_db: false, migration_applied: false,
  };
}

function parseArgs(argv = []) {
  const options = { legacyDate: null, json: false, coreDbPath: DEFAULT_CORE_DB, engineDbPath: DEFAULT_ENGINE_DB, sessionsDir: DEFAULT_SESSIONS_DIR, memoryDir: DEFAULT_MEMORY_DIR, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (FORBIDDEN_FLAGS.has(arg)) throw new Error(`unsupported flag: ${arg}`);
    if (arg === "--help" || arg === "help") { options.help = true; continue; }
    if (arg === "--json") { options.json = true; continue; }
    const map = { "--legacy-date": "legacyDate", "--core-db": "coreDbPath", "--engine-db": "engineDbPath", "--sessions-dir": "sessionsDir", "--memory-dir": "memoryDir" };
    if (map[arg]) { const next = argv[++i]; if (!next || next.startsWith("--")) throw new Error(`${arg} expects a value`); options[map[arg]] = arg === "--legacy-date" ? next : path.resolve(next); continue; }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help && !options.legacyDate) throw new Error("--legacy-date is required");
  return options;
}
function printHelp() { process.stdout.write("Audit raw_log provenance (read-only)\n\nUsage: node bin/audit-raw-log-provenance.js --legacy-date YYYY-MM-DD --json\n\nRefused: --apply --force --write-db --no-backup\n"); }

if (require.main === module) {
  try { const options = parseArgs(process.argv.slice(2)); if (options.help) printHelp(); else process.stdout.write(`${JSON.stringify(auditRawLogProvenance(options), null, 2)}\n`); }
  catch (error) { process.stderr.write(`error: ${String(error?.message || error)}\n`); process.exitCode = 1; }
}

module.exports = { auditRawLogProvenance, batchStats, parseArgs, normalize, sha256 };
