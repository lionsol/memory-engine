import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

import {
  CORE_DB_PATH,
  ENGINE_DB_PATH,
} from "../../memory-manager-runtime.js";

export const CORE_CHUNK_TIME_MIGRATION_CONFIRM_TOKEN = "MIGRATE_CORE_CHUNK_TIMES";
export const CORE_CHUNK_TIME_MIGRATION_ALLOW_UNRECOVERABLE_EVENT_AT_NULLS_TOKEN = "ALLOW_UNRECOVERABLE_EVENT_AT_NULLS";

function escapeSqliteString(value) {
  return String(value || "").replace(/'/g, "''");
}

function toCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function timestampForFilename(now = new Date()) {
  return new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function hash(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

function defaultSessionsDir() {
  return resolve(homedir(), ".openclaw/agents/main/sessions");
}

function defaultMemoryDir() {
  return resolve(process.cwd(), "memory");
}

function resolvePaths(options = {}) {
  return {
    coreDbPath: options.coreDbPath
      || process.env.MEMORY_ENGINE_CORE_DB
      || process.env.CORE_DB_PATH
      || CORE_DB_PATH
      || resolve(homedir(), ".openclaw/memory/main.sqlite"),
    engineDbPath: options.engineDbPath
      || process.env.MEMORY_ENGINE_DB
      || process.env.ENGINE_DB_PATH
      || ENGINE_DB_PATH
      || resolve(homedir(), ".openclaw/memory/memory-engine/memory-engine.sqlite"),
    sessionsDir: options.sessionsDir
      || process.env.MEMORY_ENGINE_SESSIONS_DIR
      || defaultSessionsDir(),
  };
}

function tableExists(db, schemaName, tableName) {
  try {
    const row = db.prepare(
      `SELECT name FROM ${schemaName}.sqlite_master WHERE type = 'table' AND name = ?`,
    ).get(String(tableName || ""));
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

function readColumns(db) {
  return new Set(db.prepare("PRAGMA table_info(chunks)").all().map((row) => String(row.name || "")));
}

function attachEngineIfAvailable(db, engineDbPath) {
  if (!engineDbPath || !existsSync(engineDbPath)) return false;
  db.exec(`ATTACH DATABASE '${escapeSqliteString(engineDbPath)}' AS engine`);
  return tableExists(db, "engine", "memory_confidence");
}

function normalizeReliableTimestampCandidate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(raw)) return raw;
  const spaced = raw.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s*(Z|[+-]\d{2}:?\d{2})$/);
  if (spaced) return `${spaced[1]}T${spaced[2]}${spaced[3]}`;
  return null;
}

export function extractReliableEventAtFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const bracketed = raw.match(/^\[([^\]|]+)(?:\s*\||\])/);
  const bareIso = raw.match(/^(\d{4}-\d{2}-\d{2}T\S+)/);
  const bareSpaced = raw.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\s*(?:Z|[+-]\d{2}:?\d{2}))/);
  const normalized = normalizeReliableTimestampCandidate(bracketed?.[1])
    || normalizeReliableTimestampCandidate(bareIso?.[1])
    || normalizeReliableTimestampCandidate(bareSpaced?.[1]);
  if (!normalized) return null;

  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function toEventTimestampSec(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value > 1e12 ? value / 1000 : value);
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return Math.floor(numeric > 1e12 ? numeric / 1000 : numeric);
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function dateStrFromTs(tsStr) {
  const d = new Date(tsStr);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function sessionKeyFromName(name) {
  return String(name || "").replace(/\.jsonl(\..+)?$/, "");
}

function parseSessionMessages(filePath) {
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n").filter(Boolean);
  const messages = [];
  let recordsRead = 0;
  let malformedRecords = 0;

  for (const line of lines) {
    recordsRead += 1;
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
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
          .trim();
      }

      if (!text) continue;
      if (role === "assistant" && text.length < 3) continue;
      messages.push({ role, text, ts });
    } catch {
      malformedRecords += 1;
    }
  }

  return { messages, recordsRead, malformedRecords };
}

function listSessionFiles(sessionsDir) {
  if (!sessionsDir || !existsSync(sessionsDir)) return [];
  return readdirSync(sessionsDir)
    .filter((fileName) => (fileName.endsWith(".jsonl") || fileName.includes(".jsonl."))
      && !fileName.includes(".deleted.")
      && !fileName.includes(".trajectory."))
    .map((fileName) => ({
      name: fileName,
      key: sessionKeyFromName(fileName),
      path: resolve(sessionsDir, fileName),
    }));
}

function buildSessionTranscriptEventIndex(options = {}) {
  const sessionsDir = options.sessionsDir;
  const index = new Map();
  const conflicts = new Set();
  const files = listSessionFiles(sessionsDir);
  let recordsRead = 0;
  let malformedRecords = 0;
  let messagesIndexed = 0;
  let filesSkippedOnError = 0;

  for (const file of files) {
    try {
      const parsed = parseSessionMessages(file.path);
      recordsRead += parsed.recordsRead;
      malformedRecords += parsed.malformedRecords;
      for (const message of parsed.messages) {
        const eventAt = toEventTimestampSec(message.ts);
        const dateStr = dateStrFromTs(message.ts);
        if (eventAt === null || !dateStr) continue;
        const chunkId = hash(message.text + message.ts + dateStr);
        const existing = index.get(chunkId);
        if (existing !== undefined && existing !== eventAt) {
          conflicts.add(chunkId);
          index.delete(chunkId);
          continue;
        }
        if (!conflicts.has(chunkId)) index.set(chunkId, eventAt);
        messagesIndexed += 1;
      }
    } catch {
      filesSkippedOnError += 1;
    }
  }

  return {
    index,
    sessionsDir,
    sessionFilesScanned: files.length,
    sessionFilesSkippedOnError: filesSkippedOnError,
    sessionRecordsRead: recordsRead,
    sessionMalformedRecords: malformedRecords,
    sessionMessagesIndexed: messagesIndexed,
    sessionChunkIdConflictCount: conflicts.size,
  };
}

function collectRawLogRows(db, columns, hasEngineConfidence) {
  if (!hasEngineConfidence) return [];
  const eventAtExpr = columns.has("event_at") ? "c.event_at" : "NULL";
  const createdAtExpr = columns.has("created_at") ? "c.created_at" : "NULL";
  const pathExpr = columns.has("path") ? "c.path" : "NULL";
  const updatedAtExpr = columns.has("updated_at") ? "c.updated_at" : "NULL";
  return db.prepare(
    `SELECT c.id, ${pathExpr} AS path, c.text, ${updatedAtExpr} AS updated_at, ${eventAtExpr} AS event_at, ${createdAtExpr} AS created_at
     FROM chunks c
     JOIN engine.memory_confidence mc ON mc.chunk_id = c.id
     WHERE mc.category = 'raw_log'
     ORDER BY c.id ASC`,
  ).all();
}

function buildBackfillDiagnostics(rawLogRows, transcriptIndex = null) {
  const recoverable = [];
  const conflicts = [];
  let existingEventAtCount = 0;
  let eventAtNullCount = 0;
  let textTimestampBackfillCount = 0;
  let transcriptBackfillCount = 0;
  let textAndTranscriptAgreeCount = 0;
  let backfillConflictCount = 0;
  let transcriptExactChunkIdMatchCount = 0;

  for (const row of rawLogRows) {
    const id = String(row.id || "");
    if (row.event_at !== null && row.event_at !== undefined && row.event_at !== "") {
      existingEventAtCount += 1;
      continue;
    }
    eventAtNullCount += 1;

    const textEventAt = extractReliableEventAtFromText(row.text);
    const transcriptEventAt = transcriptIndex?.get(id) ?? null;
    if (transcriptEventAt !== null) transcriptExactChunkIdMatchCount += 1;

    if (textEventAt !== null && transcriptEventAt !== null && textEventAt !== transcriptEventAt) {
      backfillConflictCount += 1;
      conflicts.push({
        id,
        text_event_at: textEventAt,
        session_transcript_event_at: transcriptEventAt,
      });
      continue;
    }

    const recoveredEventAt = textEventAt ?? transcriptEventAt;
    if (recoveredEventAt === null) continue;

    let source = "text_timestamp";
    if (textEventAt !== null && transcriptEventAt !== null) {
      source = "text_timestamp+session_transcript_exact_chunk_id";
      textAndTranscriptAgreeCount += 1;
    } else if (transcriptEventAt !== null) {
      source = "session_transcript_exact_chunk_id";
      transcriptBackfillCount += 1;
    } else {
      textTimestampBackfillCount += 1;
    }

    recoverable.push({ id, event_at: recoveredEventAt, source });
  }

  return {
    existingEventAtCount,
    eventAtNullCount,
    recoverable,
    conflicts,
    textTimestampBackfillCount,
    transcriptBackfillCount,
    textAndTranscriptAgreeCount,
    transcriptExactChunkIdMatchCount,
    backfillConflictCount,
    unrecoverableEventAtNullCount: Math.max(0, eventAtNullCount - recoverable.length - backfillConflictCount),
  };
}

function disabledTranscriptRecovery(sessionsDir) {
  return {
    index: new Map(),
    sessionsDir,
    sessionFilesScanned: 0,
    sessionFilesSkippedOnError: 0,
    sessionRecordsRead: 0,
    sessionMalformedRecords: 0,
    sessionMessagesIndexed: 0,
    sessionChunkIdConflictCount: 0,
  };
}

function toTimestampMs(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value > 1e12 ? value : value * 1000);
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return toTimestampMs(Number(raw));
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function toUtcDateStringFromAnyTimestamp(value) {
  const ms = toTimestampMs(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function incrementCount(map, key, delta = 1) {
  const normalized = String(key || "(unknown)");
  map.set(normalized, (map.get(normalized) || 0) + delta);
}

function sortCountEntries(map, valueKey, limit = null) {
  const rows = Array.from(map.entries())
    .map(([key, value]) => ({ key, [valueKey]: value }))
    .sort((a, b) => b[valueKey] - a[valueKey] || String(a.key).localeCompare(String(b.key)));
  return limit == null ? rows : rows.slice(0, limit);
}

function extractPathDate(path) {
  const match = String(path || "").match(/memory\/smart-add\/(\d{4}-\d{2}-\d{2})\.md$/);
  return match?.[1] || null;
}

function classifyRoleHint(text) {
  const raw = String(text || "").trim();
  if (!raw) return "unknown";
  if (/^#\s+Smart Added Memory\b/i.test(raw) || /^##\s+\S+/.test(raw) || /^Category:\s+\w+/mi.test(raw)) {
    return "metadata_header";
  }
  if (/\*\*User:\*\*/.test(raw) || /^User:/mi.test(raw) || /^\[[^\]]+\]\s*\*\*User:\*\*/.test(raw)) {
    return "user";
  }
  if (/\*\*Assistant:\*\*/.test(raw) || /^Assistant:/mi.test(raw) || /^\[[^\]]+\]\s*\*\*Assistant:\*\*/.test(raw)) {
    return "assistant";
  }
  return "unknown";
}

function looksLikeToolOutput(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  return /^```/m.test(raw)
    || /(^|\n)\$(\s|\w)/.test(raw)
    || /(stdout|stderr|exit code|command output|traceback|stack trace)/i.test(raw)
    || /(^|\n)(npm|node|python|bash|git)\s+\S+/i.test(raw);
}

function looksLikeCheckpointGenerated(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  return /(session checkpoint|checkpoint runtime|checkpoint summary|nightly checkpoint|episode smart-add append)/i.test(raw);
}

function textLengthBucket(length) {
  if (length < 80) return "0-79";
  if (length < 200) return "80-199";
  if (length < 500) return "200-499";
  if (length < 1000) return "500-999";
  return "1000+";
}

function resolveMemoryFilePath(memoryDir, chunkPath) {
  const rawPath = String(chunkPath || "");
  if (!memoryDir || !rawPath.startsWith("memory/")) return null;
  return resolve(memoryDir, rawPath.slice("memory/".length));
}

function normalizePreviewText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function buildPreview(text, maxChars = 240) {
  const normalized = normalizePreviewText(text);
  if (!normalized) return "";
  if (!Number.isFinite(maxChars) || maxChars <= 0) return "";
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars)}...` : normalized;
}

function readJsonlRows(inputPath) {
  return readFileSync(inputPath, "utf8")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return {
          line_number: index + 1,
          raw: line,
          row: JSON.parse(line),
        };
      } catch (error) {
        return {
          line_number: index + 1,
          raw: line,
          row: null,
          parse_error: String(error?.message || error),
        };
      }
    });
}

function writeJsonlRows(outPath, rows) {
  mkdirSync(dirname(outPath), { recursive: true });
  const lines = rows.map((row) => JSON.stringify(row));
  writeFileSync(outPath, lines.length > 0 ? `${lines.join("\n")}\n` : "", "utf8");
}

const EVENT_AT_MANUAL_RECOVERY_REVIEW_STATUSES = new Set([
  "unreviewed",
  "reviewed",
]);

const EVENT_AT_MANUAL_RECOVERY_REVIEW_ACTIONS = new Set([
  "recover_event_at",
  "keep_null",
  "ignore_low_value",
  "needs_more_evidence",
]);

const EVENT_AT_MANUAL_RECOVERY_EVENT_AT_SOURCES = new Set([
  "session_transcript",
  "external_note",
  "manual_timestamp",
  "other",
  "null",
]);

const EVENT_AT_MANUAL_RECOVERY_CONFIDENCE = new Set([
  "high",
  "medium",
  "low",
]);

function isValidDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function isValidTextSha16(value) {
  return /^[a-f0-9]{16}$/i.test(String(value || "").trim());
}

function isExplicitIsoTimestamp(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
}

function normalizeEventAtLabelValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value > 1e12 ? value / 1000 : value);
  }

  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? Math.floor(numeric > 1e12 ? numeric / 1000 : numeric) : null;
  }
  if (!isExplicitIsoTimestamp(raw)) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function normalizeEventAtSource(value) {
  if (value === null || value === undefined || value === "") return "null";
  return String(value).trim();
}

function buildEventAtManualRecoveryLabelSeed(candidate) {
  return {
    id: String(candidate?.id || ""),
    date: String(candidate?.date || ""),
    text_sha256_16: String(candidate?.text_sha256_16 || ""),
    manual_review_status: "unreviewed",
    review_action: "needs_more_evidence",
    event_at: null,
    event_at_source: "null",
    confidence: null,
    reviewer_note: "",
  };
}

function validateEventAtManualRecoveryCandidateRow(rowWrapper) {
  if (rowWrapper.parse_error) {
    return {
      valid: false,
      errors: [`parse_error:${rowWrapper.parse_error}`],
    };
  }

  const row = rowWrapper.row || {};
  const errors = [];
  if (!row || typeof row !== "object") errors.push("row");
  if (!String(row.id || "").trim()) errors.push("id");
  if (!isValidDateOnly(row.date)) errors.push("date");
  if (!isValidTextSha16(row.text_sha256_16)) errors.push("text_sha256_16");

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateEventAtManualRecoveryLabelRow(rowWrapper) {
  if (rowWrapper.parse_error) {
    return {
      valid: false,
      normalized: null,
      errors: [`parse_error:${rowWrapper.parse_error}`],
    };
  }

  const row = rowWrapper.row || {};
  const errors = [];
  const normalized = {
    id: String(row.id || "").trim(),
    date: String(row.date || "").trim(),
    text_sha256_16: String(row.text_sha256_16 || "").trim().toLowerCase(),
    manual_review_status: String(row.manual_review_status || "").trim(),
    review_action: String(row.review_action || "").trim(),
    event_at: row.event_at ?? null,
    event_at_source: normalizeEventAtSource(row.event_at_source),
    confidence: row.confidence == null || row.confidence === "" ? null : String(row.confidence).trim(),
    reviewer_note: typeof row.reviewer_note === "string" ? row.reviewer_note : String(row.reviewer_note || ""),
  };

  if (!normalized.id) errors.push("id");
  if (!isValidDateOnly(normalized.date)) errors.push("date");
  if (!isValidTextSha16(normalized.text_sha256_16)) errors.push("text_sha256_16");
  if (!EVENT_AT_MANUAL_RECOVERY_REVIEW_STATUSES.has(normalized.manual_review_status)) {
    errors.push("manual_review_status");
  }
  if (!EVENT_AT_MANUAL_RECOVERY_REVIEW_ACTIONS.has(normalized.review_action)) {
    errors.push("review_action");
  }

  if (normalized.event_at_source === "updated_at" || normalized.event_at_source === "legacy_updated_at") {
    errors.push("event_at_source_forbidden_updated_at");
  } else if (!EVENT_AT_MANUAL_RECOVERY_EVENT_AT_SOURCES.has(normalized.event_at_source)) {
    errors.push("event_at_source");
  }

  const isRecover = normalized.review_action === "recover_event_at";
  const normalizedEventAt = normalizeEventAtLabelValue(normalized.event_at);
  normalized.event_at_unix = normalizedEventAt;

  if (isRecover) {
    if (normalizedEventAt === null) {
      const rawValue = String(normalized.event_at ?? "").trim();
      if (rawValue && !/^\d+$/.test(rawValue) && !isExplicitIsoTimestamp(rawValue)) {
        errors.push("event_at_timezone_explicit_iso_or_unix_seconds_required");
      } else {
        errors.push("event_at");
      }
    }
    if (normalized.event_at_source === "null") errors.push("event_at_source_required");
    if (!EVENT_AT_MANUAL_RECOVERY_CONFIDENCE.has(normalized.confidence || "")) {
      errors.push("confidence");
    }
  } else {
    if (normalized.event_at !== null && normalized.event_at !== undefined && String(normalized.event_at).trim() !== "") {
      errors.push("event_at_not_allowed_without_recover_event_at");
    }
    if (normalized.event_at_source !== "null") errors.push("event_at_source_must_be_null");
    if (normalized.confidence !== null) errors.push("confidence_not_allowed_without_recover_event_at");
  }

  return {
    valid: errors.length === 0,
    normalized,
    errors,
  };
}

function countObjectEntries(rows, keyName) {
  const counts = {};
  for (const row of rows) {
    const key = String(row?.[keyName] || "unknown");
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])));
}

function stableSeededSortKey(seed, id) {
  return hash(`${String(seed)}:${String(id || "")}`);
}

function normalizeSeed(value) {
  const raw = String(value ?? "event-at-manual-recovery-pilot").trim();
  return raw || "event-at-manual-recovery-pilot";
}

function normalizePilotCount(value) {
  const numeric = Number.parseInt(String(value ?? 50), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error("count must be a positive integer");
  }
  return numeric;
}

function defaultEventAtManualRecoveryPilotOutPath(date, count) {
  return resolve(tmpdir(), "memory-engine-reports", `event-at-manual-recovery-labels-${date}-pilot${count}.jsonl`);
}

function assertPilotOutPathAllowed(outPath) {
  const allowedRoot = resolve(tmpdir(), "memory-engine-reports");
  const target = resolve(outPath);
  if (target !== allowedRoot && !target.startsWith(`${allowedRoot}/`)) {
    throw new Error(`outPath must stay under ${allowedRoot}`);
  }
}

function inferEventAtManualRecoveryCandidatesPath(labelsPath, labels = []) {
  const firstDate = String(labels[0]?.date || "").trim();
  if (!isValidDateOnly(firstDate)) {
    throw new Error("labels file must contain at least one valid date to locate candidate export");
  }
  return resolve(dirname(labelsPath), `event-at-manual-recovery-${firstDate}.jsonl`);
}

function candidatePilotTag(candidate) {
  if (candidate?.has_preference_tag) return "preference";
  if (candidate?.has_decision_tag) return "decision";
  if (candidate?.has_todo_tag) return "todo";
  return "no_tag";
}

function candidateLengthBucket(candidate) {
  const length = Number(candidate?.text_length || 0);
  if (length >= 1000) return "1000+";
  if (length >= 500) return "500-999";
  if (length >= 200) return "200-499";
  if (length >= 80) return "80-199";
  return "0-79";
}

function buildEventAtManualRecoveryPilotReason(candidate) {
  return `role=${String(candidate?.role_hint || "unknown")},length_bucket=${candidateLengthBucket(candidate)},tag=${candidatePilotTag(candidate)}`;
}

function buildEventAtManualRecoveryPilotCoveragePools(enriched) {
  const pools = [];
  for (const role of ["user", "assistant"]) {
    pools.push({
      reason: `coverage_role_${role}`,
      filter: (row) => row._candidate_role === role,
    });
  }
  for (const tag of ["preference", "decision", "todo", "no_tag"]) {
    pools.push({
      reason: `coverage_tag_${tag}`,
      filter: (row) => row._candidate_tag === tag,
    });
  }
  for (const lengthBucket of ["500-999", "1000+"]) {
    pools.push({
      reason: `coverage_length_${lengthBucket}`,
      filter: (row) => row._candidate_length_bucket === lengthBucket,
    });
  }
  return pools;
}

function addPilotSelection(selected, selectedIds, row, reason) {
  if (!row || selectedIds.has(row.id)) return false;
  selected.push({
    id: row.id,
    date: row.date,
    text_sha256_16: row.text_sha256_16,
    manual_review_status: row.manual_review_status,
    review_action: row.review_action,
    event_at: row.event_at,
    event_at_source: row.event_at_source,
    confidence: row.confidence,
    reviewer_note: row.reviewer_note,
    pilot_sample: true,
    pilot_reason: row.pilot_reason || reason,
  });
  selectedIds.add(row.id);
  return true;
}

function inspectUnrecoverableRow(row, options = {}) {
  const text = String(row.text || "");
  const path = String(row.path || "");
  const legacyUpdatedAtDate = toUtcDateStringFromAnyTimestamp(row.updated_at);
  const pathDate = extractPathDate(path);
  const memoryDir = options.memoryDir || defaultMemoryDir();
  const memoryFilePath = resolveMemoryFilePath(memoryDir, path);
  const availableInSmartAddFile = path.startsWith("memory/smart-add/")
    && Boolean(memoryFilePath)
    && existsSync(memoryFilePath);
  const roleHint = classifyRoleHint(text);
  const hasTimestampPrefix = extractReliableEventAtFromText(text) !== null;
  const hasSmartAddTag = /smart[- ]add|smart-add-fingerprint|Category:\s*raw_log/i.test(text) || path.startsWith("memory/smart-add/");
  const hasDecisionTag = /\bdecision\b/i.test(text);
  const hasPreferenceTag = /\bpreference\b/i.test(text);
  const hasTodoTag = /\b(todo|action item|follow-up)\b/i.test(text);
  const toolOutput = looksLikeToolOutput(text);
  const checkpointGenerated = looksLikeCheckpointGenerated(text);
  const availableInTranscript = options.transcriptIndex?.has(String(row.id || "")) || false;

  let recommendedAction = "needs_review";
  if (toolOutput || checkpointGenerated || roleHint === "metadata_header") {
    recommendedAction = "ignore_low_value";
  } else if (availableInSmartAddFile && pathDate) {
    recommendedAction = "keep_null";
  } else if ((roleHint === "user" || roleHint === "assistant") && !availableInSmartAddFile) {
    recommendedAction = "manual_recovery_candidate";
  }

  return {
    id: String(row.id || ""),
    path,
    legacy_updated_at: row.updated_at ?? null,
    legacy_updated_at_date: legacyUpdatedAtDate,
    text_length: text.length,
    text_sha256_16: hash(text).slice(0, 16),
    role_hint: roleHint,
    has_timestamp_prefix: hasTimestampPrefix,
    has_smart_add_tag: hasSmartAddTag,
    has_decision_tag: hasDecisionTag,
    has_preference_tag: hasPreferenceTag,
    has_todo_tag: hasTodoTag,
    looks_like_tool_output: toolOutput,
    looks_like_checkpoint_generated: checkpointGenerated,
    path_date: pathDate,
    path_date_matches_legacy_updated_at_date: Boolean(pathDate && legacyUpdatedAtDate && pathDate === legacyUpdatedAtDate),
    available_in_smart_add_file: availableInSmartAddFile,
    available_in_session_transcript_exact_id: availableInTranscript,
    recommended_action: recommendedAction,
  };
}

function collectCoreChunkTimeDiagnostics(options = {}) {
  const paths = resolvePaths(options);
  const transcriptRecovery = options.sessionTranscriptRecovery !== false
    ? buildSessionTranscriptEventIndex({ sessionsDir: paths.sessionsDir })
    : disabledTranscriptRecovery(paths.sessionsDir);
  const db = new Database(paths.coreDbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma("busy_timeout = 5000");
    const columns = readColumns(db);
    const hasEngineConfidence = attachEngineIfAvailable(db, paths.engineDbPath);
    const rawLogRows = collectRawLogRows(db, columns, hasEngineConfidence);
    const backfill = buildBackfillDiagnostics(rawLogRows, transcriptRecovery.index);

    return {
      paths,
      columns,
      hasEngineConfidence,
      transcriptRecovery,
      rawLogRows,
      backfill,
    };
  } finally {
    db.close();
  }
}

export function inspectCoreChunkTimeMigration(options = {}) {
  const {
    paths,
    columns,
    hasEngineConfidence,
    transcriptRecovery,
    rawLogRows,
    backfill,
  } = collectCoreChunkTimeDiagnostics(options);
  const wouldAddColumns = [
    columns.has("event_at") ? null : "event_at",
    columns.has("created_at") ? null : "created_at",
  ].filter(Boolean);

  return {
    mode: "dry_run",
    dry_run: true,
    generated_at: new Date().toISOString(),
    core_db_path: paths.coreDbPath,
    engine_db_path: paths.engineDbPath,
    sessions_dir: paths.sessionsDir,
    engine_confidence_available: hasEngineConfidence,
    session_transcript_recovery_enabled: options.sessionTranscriptRecovery !== false,
    session_files_scanned: transcriptRecovery.sessionFilesScanned,
    session_files_skipped_on_error: transcriptRecovery.sessionFilesSkippedOnError,
    session_records_read: transcriptRecovery.sessionRecordsRead,
    session_malformed_records: transcriptRecovery.sessionMalformedRecords,
    session_messages_indexed: transcriptRecovery.sessionMessagesIndexed,
    session_chunk_id_conflict_count: transcriptRecovery.sessionChunkIdConflictCount,
    chunks_columns: Array.from(columns).sort(),
    has_event_at: columns.has("event_at"),
    has_created_at: columns.has("created_at"),
    has_updated_at: columns.has("updated_at"),
    would_add_columns: wouldAddColumns,
    raw_log_total_count: rawLogRows.length,
    event_at_existing_count: backfill.existingEventAtCount,
    event_at_null_count: backfill.eventAtNullCount,
    recoverable_event_at_backfill_count: backfill.recoverable.length,
    text_timestamp_backfill_count: backfill.textTimestampBackfillCount,
    session_transcript_exact_id_backfill_count: backfill.transcriptBackfillCount,
    text_and_session_transcript_agree_count: backfill.textAndTranscriptAgreeCount,
    session_transcript_exact_chunk_id_match_count: backfill.transcriptExactChunkIdMatchCount,
    backfill_conflict_count: backfill.backfillConflictCount,
    unrecoverable_event_at_null_count: backfill.unrecoverableEventAtNullCount,
    sample_recoverable_chunk_ids: backfill.recoverable.slice(0, 20).map((row) => row.id),
    sample_recoverable_sources: backfill.recoverable.slice(0, 20).map((row) => row.source),
    backfill_policy: "only leading timezone-explicit timestamps and exact session transcript chunk-id matches are trusted; updated_at is never blindly copied into event_at",
    apply_would_leave_unrecoverable_event_at_nulls: backfill.unrecoverableEventAtNullCount > 0,
    apply_requires_backup: true,
    confirm_token_required: CORE_CHUNK_TIME_MIGRATION_CONFIRM_TOKEN,
    unrecoverable_event_at_null_confirm_token_required: backfill.unrecoverableEventAtNullCount > 0
      ? CORE_CHUNK_TIME_MIGRATION_ALLOW_UNRECOVERABLE_EVENT_AT_NULLS_TOKEN
      : null,
    writes_db: false,
  };
}

export function auditCoreChunkEventTimeRecovery(options = {}) {
  const {
    paths,
    columns,
    transcriptRecovery,
    rawLogRows,
    backfill,
  } = collectCoreChunkTimeDiagnostics(options);

  return {
    mode: "dry_run",
    dry_run: true,
    writes_db: false,
    generated_at: new Date().toISOString(),
    core_db_path: paths.coreDbPath,
    engine_db_path: paths.engineDbPath,
    sessions_dir: paths.sessionsDir,
    has_event_at: columns.has("event_at"),
    has_created_at: columns.has("created_at"),
    has_updated_at: columns.has("updated_at"),
    session_transcript_recovery_enabled: options.sessionTranscriptRecovery !== false,
    session_files_scanned: transcriptRecovery.sessionFilesScanned,
    session_files_skipped_on_error: transcriptRecovery.sessionFilesSkippedOnError,
    session_records_read: transcriptRecovery.sessionRecordsRead,
    session_malformed_records: transcriptRecovery.sessionMalformedRecords,
    session_messages_indexed: transcriptRecovery.sessionMessagesIndexed,
    session_chunk_id_conflict_count: transcriptRecovery.sessionChunkIdConflictCount,
    raw_log_total_count: rawLogRows.length,
    event_at_existing_count: backfill.existingEventAtCount,
    event_at_null_count: backfill.eventAtNullCount,
    recoverable_event_at_count: backfill.recoverable.length,
    recoverable_from_text_timestamp_count: backfill.textTimestampBackfillCount,
    recoverable_from_session_transcript_count: backfill.transcriptBackfillCount,
    text_and_session_transcript_agree_count: backfill.textAndTranscriptAgreeCount,
    session_transcript_exact_chunk_id_match_count: backfill.transcriptExactChunkIdMatchCount,
    conflict_count: backfill.backfillConflictCount,
    unrecoverable_event_at_null_count: backfill.unrecoverableEventAtNullCount,
    sample_conflicts: backfill.conflicts.slice(0, 20),
    sample_recoverable: backfill.recoverable.slice(0, 20),
    backfill_policy: "only leading timezone-explicit timestamps and exact session transcript chunk-id matches are trusted; updated_at is never blindly copied into event_at",
  };
}

export function previewCoreChunkEventTimeMigrationImpact(options = {}) {
  const {
    paths,
    columns,
    transcriptRecovery,
    rawLogRows,
    backfill,
  } = collectCoreChunkTimeDiagnostics(options);

  const recoverableById = new Map(backfill.recoverable.map((row) => [String(row.id || ""), row]));
  const recoverableSourceCounts = new Map();
  const impactByDate = new Map();
  const impactByPath = new Map();
  const unrecoverableSamples = [];
  let legacyIncludedCount = 0;

  for (const row of rawLogRows) {
    const id = String(row.id || "");
    const path = String(row.path || "");
    const legacyDate = toUtcDateStringFromAnyTimestamp(row.updated_at);
    const existingEventAt = row.event_at !== null && row.event_at !== undefined && row.event_at !== "";
    const recoverable = recoverableById.get(id) || null;
    const keptAfterMigration = existingEventAt || recoverable !== null;
    const unrecoverable = !keptAfterMigration;

    if (legacyDate) {
      legacyIncludedCount += 1;
      const current = impactByDate.get(legacyDate) || {
        date: legacyDate,
        legacy_rows: 0,
        recoverable_rows: 0,
        unrecoverable_rows: 0,
      };
      current.legacy_rows += 1;
      if (keptAfterMigration) current.recoverable_rows += 1;
      if (unrecoverable) current.unrecoverable_rows += 1;
      impactByDate.set(legacyDate, current);
    }

    const pathCurrent = impactByPath.get(path) || {
      path,
      legacy_rows: 0,
      recoverable_rows: 0,
      unrecoverable_rows: 0,
    };
    pathCurrent.legacy_rows += 1;
    if (keptAfterMigration) pathCurrent.recoverable_rows += 1;
    if (unrecoverable) pathCurrent.unrecoverable_rows += 1;
    impactByPath.set(path, pathCurrent);

    if (recoverable?.source) incrementCount(recoverableSourceCounts, recoverable.source);

    if (unrecoverable && unrecoverableSamples.length < 20) {
      unrecoverableSamples.push({
        id,
        path,
        legacy_updated_at: row.updated_at ?? null,
        legacy_updated_at_date: legacyDate,
        event_at: row.event_at ?? null,
        created_at: row.created_at ?? null,
      });
    }
  }

  const impactByLegacyUpdatedAtDate = Array.from(impactByDate.values())
    .map((row) => ({
      ...row,
      estimated_drop_ratio: row.legacy_rows > 0
        ? Number((row.unrecoverable_rows / row.legacy_rows).toFixed(3))
        : 0,
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const impactByPathRows = Array.from(impactByPath.values())
    .map((row) => ({
      ...row,
      estimated_drop_ratio: row.legacy_rows > 0
        ? Number((row.unrecoverable_rows / row.legacy_rows).toFixed(3))
        : 0,
    }))
    .sort((a, b) => b.unrecoverable_rows - a.unrecoverable_rows || String(a.path).localeCompare(String(b.path)))
    .slice(0, 20);

  const topUnrecoverableDates = impactByLegacyUpdatedAtDate
    .filter((row) => row.unrecoverable_rows > 0)
    .slice()
    .sort((a, b) => b.unrecoverable_rows - a.unrecoverable_rows || String(a.date).localeCompare(String(b.date)))
    .slice(0, 10)
    .map((row) => ({
      date: row.date,
      unrecoverable_rows: row.unrecoverable_rows,
      legacy_rows: row.legacy_rows,
      estimated_drop_ratio: row.estimated_drop_ratio,
    }));

  const estimatedRowsKeptAfterMigration = backfill.existingEventAtCount + backfill.recoverable.length;
  const estimatedRowsDroppedFromDbRawLogPoolAfterMigration = Math.max(0, rawLogRows.length - estimatedRowsKeptAfterMigration);

  return {
    mode: "dry_run",
    dry_run: true,
    writes_db: false,
    generated_at: new Date().toISOString(),
    core_db_path: paths.coreDbPath,
    engine_db_path: paths.engineDbPath,
    sessions_dir: paths.sessionsDir,
    has_event_at: columns.has("event_at"),
    has_created_at: columns.has("created_at"),
    has_updated_at: columns.has("updated_at"),
    session_transcript_recovery_enabled: options.sessionTranscriptRecovery !== false,
    session_files_scanned: transcriptRecovery.sessionFilesScanned,
    session_files_skipped_on_error: transcriptRecovery.sessionFilesSkippedOnError,
    session_records_read: transcriptRecovery.sessionRecordsRead,
    session_malformed_records: transcriptRecovery.sessionMalformedRecords,
    session_messages_indexed: transcriptRecovery.sessionMessagesIndexed,
    session_chunk_id_conflict_count: transcriptRecovery.sessionChunkIdConflictCount,
    raw_log_total_count: rawLogRows.length,
    legacy_rows_with_updated_at_basis_count: legacyIncludedCount,
    recoverable_event_at_count: estimatedRowsKeptAfterMigration,
    recoverable_from_existing_event_at_count: backfill.existingEventAtCount,
    recoverable_from_text_timestamp_count: backfill.textTimestampBackfillCount,
    recoverable_from_session_transcript_count: backfill.transcriptBackfillCount,
    text_and_session_transcript_agree_count: backfill.textAndTranscriptAgreeCount,
    unrecoverable_event_at_null_count: backfill.unrecoverableEventAtNullCount,
    legacy_time_basis: columns.has("event_at")
      ? "event_at_strict_reader"
      : columns.has("created_at")
        ? "created_at_legacy_event_time"
        : "updated_at_event_time",
    legacy_updated_at_basis_warning: "updated_at is used only to estimate current legacy checkpoint behavior; it is never used as event_at backfill source",
    estimated_rows_kept_after_migration: estimatedRowsKeptAfterMigration,
    estimated_rows_dropped_from_db_raw_log_pool_after_migration: estimatedRowsDroppedFromDbRawLogPoolAfterMigration,
    recovery_source_distribution: sortCountEntries(recoverableSourceCounts, "count"),
    impact_by_legacy_updated_at_date: impactByLegacyUpdatedAtDate,
    impact_by_path: impactByPathRows,
    top_unrecoverable_dates: topUnrecoverableDates,
    sample_unrecoverable_chunk_ids: unrecoverableSamples,
    backfill_policy: "only leading timezone-explicit timestamps and exact session transcript chunk-id matches are trusted; updated_at is never blindly copied into event_at",
  };
}

export function inspectUnrecoverableEventAtRawLog(options = {}) {
  const {
    paths,
    columns,
    transcriptRecovery,
    rawLogRows,
    backfill,
  } = collectCoreChunkTimeDiagnostics(options);
  const requestedDate = String(options.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    throw new Error("date must be provided as YYYY-MM-DD");
  }

  const recoverableById = new Map(backfill.recoverable.map((row) => [String(row.id || ""), row]));
  const unrecoverableRows = [];
  let legacyRows = 0;
  let recoverableRows = 0;
  const roleCounts = new Map();
  const pathCounts = new Map();
  const tagCounts = new Map();
  const textLengthCounts = new Map();
  const recommendedActionCounts = new Map();
  let pathDateMatchCount = 0;
  let availableInSmartAddFileCount = 0;
  let looksLikeToolOutputCount = 0;
  let looksLikeCheckpointGeneratedCount = 0;

  for (const row of rawLogRows) {
    const id = String(row.id || "");
    const legacyDate = toUtcDateStringFromAnyTimestamp(row.updated_at);
    if (legacyDate !== requestedDate) continue;

    legacyRows += 1;
    const existingEventAt = row.event_at !== null && row.event_at !== undefined && row.event_at !== "";
    const recoverable = existingEventAt || recoverableById.has(id);
    if (recoverable) {
      recoverableRows += 1;
      continue;
    }

    const inspected = inspectUnrecoverableRow(row, {
      memoryDir: options.memoryDir,
      transcriptIndex: transcriptRecovery.index,
    });
    unrecoverableRows.push(inspected);
    incrementCount(roleCounts, inspected.role_hint);
    incrementCount(pathCounts, inspected.path);
    if (inspected.has_smart_add_tag) incrementCount(tagCounts, "smart_add");
    if (inspected.has_decision_tag) incrementCount(tagCounts, "decision");
    if (inspected.has_preference_tag) incrementCount(tagCounts, "preference");
    if (inspected.has_todo_tag) incrementCount(tagCounts, "todo");
    if (inspected.has_timestamp_prefix) incrementCount(tagCounts, "timestamp_prefix");
    incrementCount(textLengthCounts, textLengthBucket(inspected.text_length));
    incrementCount(recommendedActionCounts, inspected.recommended_action);
    if (inspected.path_date_matches_legacy_updated_at_date) pathDateMatchCount += 1;
    if (inspected.available_in_smart_add_file) availableInSmartAddFileCount += 1;
    if (inspected.looks_like_tool_output) looksLikeToolOutputCount += 1;
    if (inspected.looks_like_checkpoint_generated) looksLikeCheckpointGeneratedCount += 1;
  }

  return {
    mode: "dry_run",
    dry_run: true,
    writes_db: false,
    generated_at: new Date().toISOString(),
    date: requestedDate,
    core_db_path: paths.coreDbPath,
    engine_db_path: paths.engineDbPath,
    sessions_dir: paths.sessionsDir,
    memory_dir: options.memoryDir || defaultMemoryDir(),
    has_event_at: columns.has("event_at"),
    has_created_at: columns.has("created_at"),
    has_updated_at: columns.has("updated_at"),
    session_transcript_recovery_enabled: options.sessionTranscriptRecovery !== false,
    legacy_time_basis: columns.has("event_at")
      ? "event_at_strict_reader"
      : columns.has("created_at")
        ? "created_at_legacy_event_time"
        : "updated_at_event_time",
    legacy_updated_at_basis_warning: "updated_at is used only as a legacy forensic grouping clue; it is never used as an event_at backfill source",
    backfill_policy: "only leading timezone-explicit timestamps and exact session transcript chunk-id matches are trusted; updated_at is never blindly copied into event_at",
    legacy_rows: legacyRows,
    recoverable_rows: recoverableRows,
    unrecoverable_rows: unrecoverableRows.length,
    role_breakdown: sortCountEntries(roleCounts, "count"),
    path_breakdown: sortCountEntries(pathCounts, "count", 20),
    tag_breakdown: sortCountEntries(tagCounts, "count"),
    text_length_distribution: sortCountEntries(textLengthCounts, "count"),
    path_date_match_count: pathDateMatchCount,
    available_in_smart_add_file_count: availableInSmartAddFileCount,
    looks_like_tool_output_count: looksLikeToolOutputCount,
    looks_like_checkpoint_generated_count: looksLikeCheckpointGeneratedCount,
    recommended_action_breakdown: sortCountEntries(recommendedActionCounts, "count"),
    sample_unrecoverable: unrecoverableRows.slice(0, 20),
  };
}

export function exportEventAtManualRecoveryCandidates(options = {}) {
  const {
    paths,
    columns,
    transcriptRecovery,
    rawLogRows,
    backfill,
  } = collectCoreChunkTimeDiagnostics(options);
  const requestedDate = String(options.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    throw new Error("date must be provided as YYYY-MM-DD");
  }

  const format = String(options.format || "jsonl").trim().toLowerCase();
  if (format !== "jsonl" && format !== "md") {
    throw new Error("format must be jsonl or md");
  }

  const includePreview = options.includePreview !== false;
  const previewChars = Number.isFinite(Number(options.previewChars)) ? Number(options.previewChars) : 240;
  const outPath = String(options.outPath || "").trim();
  if (!outPath) {
    throw new Error("outPath is required");
  }

  const recoverableById = new Map(backfill.recoverable.map((row) => [String(row.id || ""), row]));
  const candidates = [];
  const roleCounts = new Map();
  const tagCounts = new Map();
  const textLengthCounts = new Map();

  for (const row of rawLogRows) {
    const id = String(row.id || "");
    const legacyDate = toUtcDateStringFromAnyTimestamp(row.updated_at);
    if (legacyDate !== requestedDate) continue;
    const existingEventAt = row.event_at !== null && row.event_at !== undefined && row.event_at !== "";
    if (existingEventAt || recoverableById.has(id)) continue;

    const inspected = inspectUnrecoverableRow(row, {
      memoryDir: options.memoryDir,
      transcriptIndex: transcriptRecovery.index,
    });
    if (inspected.recommended_action !== "manual_recovery_candidate") continue;

    const candidate = {
      date: requestedDate,
      id: inspected.id,
      path: inspected.path,
      legacy_updated_at: inspected.legacy_updated_at,
      legacy_updated_at_date: inspected.legacy_updated_at_date,
      text_length: inspected.text_length,
      text_sha256_16: inspected.text_sha256_16,
      role_hint: inspected.role_hint,
      has_timestamp_prefix: inspected.has_timestamp_prefix,
      has_decision_tag: inspected.has_decision_tag,
      has_preference_tag: inspected.has_preference_tag,
      has_todo_tag: inspected.has_todo_tag,
      looks_like_tool_output: inspected.looks_like_tool_output,
      looks_like_checkpoint_generated: inspected.looks_like_checkpoint_generated,
      available_in_smart_add_file: inspected.available_in_smart_add_file,
      recommended_action: inspected.recommended_action,
      manual_review_status: "unreviewed",
      suggested_review_action: "needs_more_evidence",
      event_at_source_required: true,
    };
    if (includePreview) {
      candidate.preview = buildPreview(row.text, previewChars);
    }
    candidates.push(candidate);
    incrementCount(roleCounts, candidate.role_hint);
    if (candidate.has_decision_tag) incrementCount(tagCounts, "decision");
    if (candidate.has_preference_tag) incrementCount(tagCounts, "preference");
    if (candidate.has_todo_tag) incrementCount(tagCounts, "todo");
    incrementCount(textLengthCounts, textLengthBucket(candidate.text_length));
  }

  mkdirSync(dirname(outPath), { recursive: true });
  if (format === "jsonl") {
    const lines = candidates.map((candidate) => JSON.stringify(candidate));
    writeFileSync(outPath, lines.length > 0 ? `${lines.join("\n")}\n` : "", "utf8");
  } else {
    const previewColumn = includePreview ? " | Preview" : "";
    const divider = includePreview ? " | ---" : "";
    const rows = candidates.slice(0, 200).map((candidate) => {
      const base = `| \`${candidate.id.slice(0, 12)}\` | ${candidate.role_hint} | ${candidate.text_length} | \`${candidate.text_sha256_16}\` | ${candidate.path} | ${candidate.suggested_review_action}`;
      if (!includePreview) return `${base} |`;
      const preview = String(candidate.preview || "").replace(/\|/g, "\\|");
      return `${base} | ${preview} |`;
    });
    const markdown = [
      "# Event-at Manual Recovery Candidates",
      "",
      `- date: \`${requestedDate}\``,
      `- candidate_count: \`${candidates.length}\``,
      `- preview_chars: \`${includePreview ? previewChars : 0}\``,
      "- raw_text_exported: `false`",
      "- writes_db: `false`",
      "",
      "## Summary",
      "",
      `- role_breakdown: ${JSON.stringify(sortCountEntries(roleCounts, "count"))}`,
      `- tag_breakdown: ${JSON.stringify(sortCountEntries(tagCounts, "count"))}`,
      `- text_length_distribution: ${JSON.stringify(sortCountEntries(textLengthCounts, "count"))}`,
      "",
      "## Candidates",
      "",
      `| Chunk ID | Role | Text Length | SHA16 | Path | Suggested Action${previewColumn} |`,
      `| --- | --- | ---: | --- | --- | ---${divider} |`,
      ...rows,
      "",
      "> Preview text is capped, single-line, and intended only for manual triage. Raw log full text is not exported.",
      "",
    ].join("\n");
    writeFileSync(outPath, markdown, "utf8");
  }

  return {
    mode: "dry_run",
    dry_run: true,
    writes_db: false,
    generated_at: new Date().toISOString(),
    date: requestedDate,
    candidate_count: candidates.length,
    role_breakdown: sortCountEntries(roleCounts, "count"),
    tag_breakdown: sortCountEntries(tagCounts, "count"),
    text_length_distribution: sortCountEntries(textLengthCounts, "count"),
    output_path: outPath,
    preview_chars: includePreview ? previewChars : 0,
    raw_text_exported: false,
    has_event_at: columns.has("event_at"),
    has_created_at: columns.has("created_at"),
    has_updated_at: columns.has("updated_at"),
  };
}

export function initEventAtManualRecoveryLabels(options = {}) {
  const candidatesPath = String(options.candidatesPath || options.candidates || "").trim();
  const outPath = String(options.outPath || options.out || "").trim();
  if (!candidatesPath) throw new Error("candidates path is required");
  if (!outPath) throw new Error("outPath is required");

  const candidateRows = readJsonlRows(candidatesPath);
  const invalidCandidates = [];
  const labels = [];

  for (const rowWrapper of candidateRows) {
    const validation = validateEventAtManualRecoveryCandidateRow(rowWrapper);
    if (!validation.valid) {
      invalidCandidates.push({
        line_number: rowWrapper.line_number,
        id: rowWrapper.row?.id || null,
        errors: validation.errors,
      });
      continue;
    }
    labels.push(buildEventAtManualRecoveryLabelSeed(rowWrapper.row));
  }

  if (invalidCandidates.length > 0) {
    throw new Error(`candidates file contains ${invalidCandidates.length} invalid row(s)`);
  }

  writeJsonlRows(outPath, labels);

  return {
    mode: "dry_run",
    dry_run: true,
    writes_db: false,
    migration_applied: false,
    generated_at: new Date().toISOString(),
    candidates_path: candidatesPath,
    output_path: outPath,
    candidate_count: labels.length,
    label_count: labels.length,
    raw_text_exported: false,
    default_manual_review_status: "unreviewed",
    default_review_action: "needs_more_evidence",
  };
}

export function summarizeEventAtManualRecoveryLabels(options = {}) {
  const labelsPath = String(options.labelsPath || options.labels || "").trim();
  if (!labelsPath) throw new Error("labels path is required");

  const rowWrappers = readJsonlRows(labelsPath);
  const validated = rowWrappers.map((rowWrapper) => ({
    rowWrapper,
    validation: validateEventAtManualRecoveryLabelRow(rowWrapper),
  }));

  const parsedRows = validated
    .filter((item) => item.rowWrapper.row && typeof item.rowWrapper.row === "object")
    .map((item) => item.rowWrapper.row);
  const invalidLabels = validated
    .filter((item) => !item.validation.valid)
    .map((item) => ({
      line_number: item.rowWrapper.line_number,
      id: item.rowWrapper.row?.id || null,
      errors: item.validation.errors,
    }));

  const summary = {
    mode: "dry_run",
    dry_run: true,
    writes_db: false,
    migration_applied: false,
    generated_at: new Date().toISOString(),
    labels_path: labelsPath,
    label_count: rowWrappers.length,
    review_status_breakdown: countObjectEntries(parsedRows, "manual_review_status"),
    review_action_breakdown: countObjectEntries(parsedRows, "review_action"),
    recover_event_at_count: parsedRows.filter((row) => row.review_action === "recover_event_at").length,
    keep_null_count: parsedRows.filter((row) => row.review_action === "keep_null").length,
    ignore_low_value_count: parsedRows.filter((row) => row.review_action === "ignore_low_value").length,
    needs_more_evidence_count: parsedRows.filter((row) => row.review_action === "needs_more_evidence").length,
    invalid_label_count: invalidLabels.length,
    invalid_labels: invalidLabels,
  };

  return summary;
}

export function previewEventAtManualRecoveryApply(options = {}) {
  const labelsPath = String(options.labelsPath || options.labels || "").trim();
  if (!labelsPath) throw new Error("labels path is required");

  const rowWrappers = readJsonlRows(labelsPath);
  const invalidRecoverLabels = [];
  const wouldUpdate = [];
  const blockedReasonCounts = new Map();

  for (const rowWrapper of rowWrappers) {
    const validation = validateEventAtManualRecoveryLabelRow(rowWrapper);
    const reviewAction = String(rowWrapper.row?.review_action || "").trim();
    if (reviewAction !== "recover_event_at") continue;

    if (!validation.valid) {
      invalidRecoverLabels.push({
        line_number: rowWrapper.line_number,
        id: rowWrapper.row?.id || null,
        errors: validation.errors,
      });
      for (const error of validation.errors) incrementCount(blockedReasonCounts, error);
      continue;
    }

    wouldUpdate.push({
      id: validation.normalized.id,
      date: validation.normalized.date,
      text_sha256_16: validation.normalized.text_sha256_16,
      event_at: validation.normalized.event_at_unix,
      event_at_source: validation.normalized.event_at_source,
      confidence: validation.normalized.confidence,
    });
  }

  wouldUpdate.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  return {
    mode: "dry_run",
    dry_run: true,
    writes_db: false,
    migration_applied: false,
    generated_at: new Date().toISOString(),
    labels_path: labelsPath,
    candidate_updates_count: wouldUpdate.length,
    valid_recover_event_at_count: wouldUpdate.length,
    invalid_recover_event_at_count: invalidRecoverLabels.length,
    would_update: wouldUpdate,
    blocked_reasons: sortCountEntries(blockedReasonCounts, "count"),
    invalid_labels: invalidRecoverLabels,
  };
}

export function sampleEventAtManualRecoveryLabels(options = {}) {
  const labelsPath = String(options.labelsPath || options.labels || "").trim();
  if (!labelsPath) throw new Error("labels path is required");

  const count = normalizePilotCount(options.count);
  const seed = normalizeSeed(options.seed);
  const labelRows = readJsonlRows(labelsPath);
  const labels = [];
  const invalidLabels = [];

  for (const rowWrapper of labelRows) {
    const validation = validateEventAtManualRecoveryLabelRow(rowWrapper);
    if (!validation.valid) {
      invalidLabels.push({
        line_number: rowWrapper.line_number,
        id: rowWrapper.row?.id || null,
        errors: validation.errors,
      });
      continue;
    }
    labels.push(validation.normalized);
  }

  if (invalidLabels.length > 0) {
    throw new Error(`labels file contains ${invalidLabels.length} invalid row(s)`);
  }

  const candidatesPath = String(options.candidatesPath || options.candidates || inferEventAtManualRecoveryCandidatesPath(labelsPath, labels)).trim();
  const candidateRows = readJsonlRows(candidatesPath);
  const candidateMap = new Map();
  const invalidCandidates = [];

  for (const rowWrapper of candidateRows) {
    const validation = validateEventAtManualRecoveryCandidateRow(rowWrapper);
    if (!validation.valid) {
      invalidCandidates.push({
        line_number: rowWrapper.line_number,
        id: rowWrapper.row?.id || null,
        errors: validation.errors,
      });
      continue;
    }
    candidateMap.set(String(rowWrapper.row.id), rowWrapper.row);
  }

  if (invalidCandidates.length > 0) {
    throw new Error(`candidates file contains ${invalidCandidates.length} invalid row(s)`);
  }

  const enriched = labels
    .map((label) => {
      const candidate = candidateMap.get(label.id);
      if (!candidate) {
        throw new Error(`candidate not found for label id: ${label.id}`);
      }
      if (String(candidate.text_sha256_16).toLowerCase() !== label.text_sha256_16) {
        throw new Error(`candidate text_sha256_16 mismatch for label id: ${label.id}`);
      }
      return {
        ...label,
        _candidate_role: String(candidate.role_hint || "unknown"),
        _candidate_tag: candidatePilotTag(candidate),
        _candidate_length_bucket: candidateLengthBucket(candidate),
        _candidate_sort_key: stableSeededSortKey(seed, label.id),
        pilot_reason: buildEventAtManualRecoveryPilotReason(candidate),
      };
    })
    .sort((a, b) => String(a._candidate_sort_key).localeCompare(String(b._candidate_sort_key)) || String(a.id).localeCompare(String(b.id)));

  const selected = [];
  const selectedIds = new Set();
  const coveragePools = buildEventAtManualRecoveryPilotCoveragePools(enriched);

  for (const pool of coveragePools) {
    if (selected.length >= count) break;
    const candidate = enriched.find((row) => !selectedIds.has(row.id) && pool.filter(row));
    addPilotSelection(selected, selectedIds, candidate, pool.reason);
  }

  for (const row of enriched) {
    if (selected.length >= count) break;
    addPilotSelection(selected, selectedIds, row, "seeded_fill");
  }

  const outPath = String(options.outPath || options.out || defaultEventAtManualRecoveryPilotOutPath(labels[0]?.date || "unknown-date", count)).trim();
  assertPilotOutPathAllowed(outPath);
  writeJsonlRows(outPath, selected);

  return {
    mode: "dry_run",
    dry_run: true,
    writes_db: false,
    migration_applied: false,
    generated_at: new Date().toISOString(),
    labels_path: labelsPath,
    candidates_path: candidatesPath,
    output_path: outPath,
    seed,
    pilot_sample_count: selected.length,
    requested_count: count,
    raw_text_exported: false,
    role_breakdown: countObjectEntries(selected.map((row) => ({ role: row.pilot_reason.match(/role=([^,]+)/)?.[1] || "unknown" })), "role"),
    tag_breakdown: countObjectEntries(selected.map((row) => ({ tag: row.pilot_reason.match(/tag=([^,]+)/)?.[1] || "unknown" })), "tag"),
    length_bucket_breakdown: countObjectEntries(selected.map((row) => ({ length_bucket: row.pilot_reason.match(/length_bucket=([^,]+)/)?.[1] || "unknown" })), "length_bucket"),
  };
}

function resolveBackupPaths(options, coreDbPath, now = new Date()) {
  const backupDir = options.backupDir || resolve(dirname(coreDbPath), "backups");
  const base = resolve(
    backupDir,
    `openclaw-core-before-chunk-time-migration-${timestampForFilename(now)}.sqlite`,
  );
  const candidates = [
    { source: coreDbPath, target: base },
    { source: `${coreDbPath}-wal`, target: `${base}-wal` },
    { source: `${coreDbPath}-shm`, target: `${base}-shm` },
  ];
  return {
    backupDir,
    backupPaths: candidates.filter((entry) => existsSync(entry.source)),
  };
}

function createBackups(options, coreDbPath) {
  const { backupDir, backupPaths } = resolveBackupPaths(options, coreDbPath);
  mkdirSync(backupDir, { recursive: true });
  for (const backup of backupPaths) {
    copyFileSync(backup.source, backup.target);
    if (!existsSync(backup.target)) {
      throw new Error(`backup file was not created: ${backup.target}`);
    }
  }
  return backupPaths.map((entry) => entry.target);
}

function ensureMigrationColumns(db, columns) {
  const added = [];
  if (!columns.has("event_at")) {
    db.exec("ALTER TABLE chunks ADD COLUMN event_at INTEGER");
    added.push("event_at");
  }
  if (!columns.has("created_at")) {
    db.exec("ALTER TABLE chunks ADD COLUMN created_at INTEGER");
    added.push("created_at");
  }
  return added;
}

function backfillRecoverableEventAt(db, candidates) {
  if (candidates.length === 0) return 0;
  const update = db.prepare("UPDATE chunks SET event_at = ? WHERE id = ? AND event_at IS NULL");
  let changed = 0;
  for (const candidate of candidates) {
    changed += toCount(update.run(candidate.event_at, candidate.id)?.changes);
  }
  return changed;
}

function assertUnrecoverableEventAtNullsConfirmed(preflight, options = {}) {
  const remaining = toCount(preflight.unrecoverable_event_at_null_count);
  if (remaining === 0) return;
  if (options.confirmUnrecoverableEventAtNulls === CORE_CHUNK_TIME_MIGRATION_ALLOW_UNRECOVERABLE_EVENT_AT_NULLS_TOKEN) return;
  throw new Error(
    `apply would leave ${remaining} raw_log rows with event_at NULL; `
      + `rerun with confirm token: ${CORE_CHUNK_TIME_MIGRATION_ALLOW_UNRECOVERABLE_EVENT_AT_NULLS_TOKEN}`,
  );
}

export function applyCoreChunkTimeMigration(options = {}) {
  if (options.confirmToken !== CORE_CHUNK_TIME_MIGRATION_CONFIRM_TOKEN) {
    throw new Error(`apply requires confirm token: ${CORE_CHUNK_TIME_MIGRATION_CONFIRM_TOKEN}`);
  }

  const paths = resolvePaths(options);
  const preflight = inspectCoreChunkTimeMigration({
    ...options,
    coreDbPath: paths.coreDbPath,
    engineDbPath: paths.engineDbPath,
    sessionsDir: paths.sessionsDir,
  });
  assertUnrecoverableEventAtNullsConfirmed(preflight, options);
  const backupPaths = createBackups(options, paths.coreDbPath);
  const db = new Database(paths.coreDbPath, { readonly: false, fileMustExist: true });

  try {
    db.pragma("busy_timeout = 5000");
    const hasEngineConfidence = attachEngineIfAvailable(db, paths.engineDbPath);
    const tx = db.transaction(() => {
      const initialColumns = readColumns(db);
      const addedColumns = ensureMigrationColumns(db, initialColumns);
      const columnsAfterMigration = readColumns(db);
      const rawLogRows = collectRawLogRows(db, columnsAfterMigration, hasEngineConfidence);
      const transcriptRecovery = options.sessionTranscriptRecovery !== false
        ? buildSessionTranscriptEventIndex({ sessionsDir: paths.sessionsDir })
        : { index: new Map() };
      const backfill = buildBackfillDiagnostics(rawLogRows, transcriptRecovery.index);
      const backfilledCount = backfillRecoverableEventAt(db, backfill.recoverable);
      return {
        addedColumns,
        backfilledCount,
        recoverableCount: backfill.recoverable.length,
      };
    });

    const applied = tx();
    const post = inspectCoreChunkTimeMigration({
      ...options,
      coreDbPath: paths.coreDbPath,
      engineDbPath: paths.engineDbPath,
      sessionsDir: paths.sessionsDir,
    });
    return {
      mode: "apply",
      dry_run: false,
      started_at: preflight.generated_at,
      finished_at: new Date().toISOString(),
      core_db_path: paths.coreDbPath,
      engine_db_path: paths.engineDbPath,
      backup_paths: backupPaths,
      added_columns: applied.addedColumns,
      recoverable_event_at_backfill_count: applied.recoverableCount,
      backfilled_event_at_count: applied.backfilledCount,
      remaining_event_at_null_count: post.event_at_null_count,
      remaining_unrecoverable_event_at_null_count: post.unrecoverable_event_at_null_count,
      preflight,
      postflight: post,
    };
  } finally {
    db.close();
  }
}
