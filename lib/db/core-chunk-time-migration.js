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
  return db.prepare(
    `SELECT c.id, c.text, ${eventAtExpr} AS event_at
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
