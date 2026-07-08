import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

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
