import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  CORE_CHUNK_TIME_MIGRATION_ALLOW_UNRECOVERABLE_EVENT_AT_NULLS_TOKEN,
  CORE_CHUNK_TIME_MIGRATION_CONFIRM_TOKEN,
  applyCoreChunkTimeMigration,
  extractReliableEventAtFromText,
  inspectCoreChunkTimeMigration,
} from "../lib/db/core-chunk-time-migration.js";
import { patchWriteGuards } from "../lib/db/core-write-guard.js";

function hash(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

function dateStrFromTs(tsStr) {
  const d = new Date(tsStr);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function makeFlushChunkId(text, ts) {
  return hash(text + ts + dateStrFromTs(ts));
}

function createFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-core-time-migration-"));
  const coreDbPath = resolve(root, "core.sqlite");
  const engineDbPath = resolve(root, "engine.sqlite");
  const sessionsDir = resolve(root, "sessions");
  const backupDir = resolve(root, "backups");
  mkdirSync(backupDir, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });

  const transcriptText = "transcript-only recoverable raw log";
  const transcriptTs = "2026-06-17T10:15:00.000+08:00";
  const transcriptChunkId = makeFlushChunkId(transcriptText, transcriptTs);
  writeFileSync(resolve(sessionsDir, "agent-main.jsonl.reset.20260618"), JSON.stringify({
    type: "message",
    timestamp: transcriptTs,
    message: {
      role: "user",
      content: transcriptText,
    },
  }));

  const coreDb = new Database(coreDbPath);
  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'memory',
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        hash TEXT NOT NULL,
        model TEXT NOT NULL,
        text TEXT NOT NULL,
        embedding TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    const insert = coreDb.prepare(`
      INSERT INTO chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
      VALUES (?, 'memory/smart-add/2026-06-17.md', 'memory', 0, 0, ?, 'test', ?, '', ?)
    `);
    insert.run(
      "recoverable-raw-log",
      "h1",
      "[2026-06-17T09:30:00.000+08:00 | session:abc] **User:** recoverable raw log",
      Date.parse("2026-07-01T10:00:00.000+08:00") / 1000,
    );
    insert.run(
      "unrecoverable-raw-log",
      "h2",
      "**User:** no embedded timestamp",
      Date.parse("2026-07-01T11:00:00.000+08:00") / 1000,
    );
    insert.run(
      transcriptChunkId,
      "h-session",
      transcriptText,
      Date.parse("2026-07-01T11:30:00.000+08:00") / 1000,
    );
    insert.run(
      "non-raw-log",
      "h3",
      "[2026-06-17T10:00:00.000+08:00] preference text",
      Date.parse("2026-07-01T12:00:00.000+08:00") / 1000,
    );
  } finally {
    coreDb.close();
  }

  const engineDb = new Database(engineDbPath);
  try {
    engineDb.exec(`
      CREATE TABLE memory_confidence (
        chunk_id TEXT PRIMARY KEY,
        category TEXT NOT NULL DEFAULT 'raw_log'
      )
    `);
    const insertConfidence = engineDb.prepare("INSERT INTO memory_confidence (chunk_id, category) VALUES (?, ?)");
    insertConfidence.run("recoverable-raw-log", "raw_log");
    insertConfidence.run("unrecoverable-raw-log", "raw_log");
    insertConfidence.run(transcriptChunkId, "raw_log");
    insertConfidence.run("non-raw-log", "preference");
  } finally {
    engineDb.close();
  }

  return { root, coreDbPath, engineDbPath, sessionsDir, backupDir, transcriptChunkId, transcriptTs };
}

test("timestamp extraction only accepts explicit timezone timestamps", () => {
  assert.equal(
    extractReliableEventAtFromText("[2026-06-17T09:30:00.000+08:00 | session:abc] **User:** ok"),
    Date.parse("2026-06-17T09:30:00.000+08:00") / 1000,
  );
  assert.equal(
    extractReliableEventAtFromText("[2026-06-17 09:30:00 +08:00] **User:** ok"),
    Date.parse("2026-06-17T09:30:00+08:00") / 1000,
  );
  assert.equal(
    extractReliableEventAtFromText("[2026-06-17 09:30:00] **User:** missing timezone"),
    null,
  );
});

function readCoreColumns(coreDbPath) {
  const db = new Database(coreDbPath, { readonly: true, fileMustExist: true });
  try {
    return new Set(db.prepare("PRAGMA table_info(chunks)").all().map((row) => String(row.name || "")));
  } finally {
    db.close();
  }
}

test("core chunk time migration dry-run reports schema/backfill without writing DB", () => {
  const fixture = createFixture();
  const beforeColumns = readCoreColumns(fixture.coreDbPath);

  const report = inspectCoreChunkTimeMigration({
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    sessionsDir: fixture.sessionsDir,
  });

  const afterColumns = readCoreColumns(fixture.coreDbPath);
  assert.equal(report.mode, "dry_run");
  assert.equal(report.writes_db, false);
  assert.deepEqual(report.would_add_columns, ["event_at", "created_at"]);
  assert.equal(report.raw_log_total_count, 3);
  assert.equal(report.session_files_scanned, 1);
  assert.equal(report.session_messages_indexed, 1);
  assert.equal(report.recoverable_event_at_backfill_count, 2);
  assert.equal(report.text_timestamp_backfill_count, 1);
  assert.equal(report.session_transcript_exact_id_backfill_count, 1);
  assert.equal(report.session_transcript_exact_chunk_id_match_count, 1);
  assert.equal(report.unrecoverable_event_at_null_count, 1);
  assert.deepEqual(afterColumns, beforeColumns);
  assert.equal(afterColumns.has("event_at"), false);
  assert.equal(afterColumns.has("created_at"), false);
});

test("core chunk time migration apply requires backup and explicit confirm token", () => {
  const fixture = createFixture();

  assert.throws(
    () => applyCoreChunkTimeMigration({
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
      sessionsDir: fixture.sessionsDir,
      backupDir: fixture.backupDir,
    }),
    /confirm token/i,
  );

  assert.throws(
    () => applyCoreChunkTimeMigration({
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
      sessionsDir: fixture.sessionsDir,
      backupDir: fixture.backupDir,
      confirmToken: CORE_CHUNK_TIME_MIGRATION_CONFIRM_TOKEN,
    }),
    /event_at NULL/i,
  );

  const report = applyCoreChunkTimeMigration({
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    sessionsDir: fixture.sessionsDir,
    backupDir: fixture.backupDir,
    confirmToken: CORE_CHUNK_TIME_MIGRATION_CONFIRM_TOKEN,
    confirmUnrecoverableEventAtNulls: CORE_CHUNK_TIME_MIGRATION_ALLOW_UNRECOVERABLE_EVENT_AT_NULLS_TOKEN,
  });

  const columns = readCoreColumns(fixture.coreDbPath);
  assert.equal(report.mode, "apply");
  assert.equal(report.backup_paths.length >= 1, true);
  assert.equal(report.backup_paths.every((path) => existsSync(path)), true);
  assert.deepEqual(report.added_columns, ["event_at", "created_at"]);
  assert.equal(report.backfilled_event_at_count, 2);
  assert.equal(columns.has("event_at"), true);
  assert.equal(columns.has("created_at"), true);

  const db = new Database(fixture.coreDbPath, { readonly: true, fileMustExist: true });
  try {
    const recoverable = db.prepare("SELECT event_at, created_at, updated_at FROM chunks WHERE id = ?").get("recoverable-raw-log");
    const transcriptRecoverable = db.prepare("SELECT event_at, created_at, updated_at FROM chunks WHERE id = ?").get(fixture.transcriptChunkId);
    const unrecoverable = db.prepare("SELECT event_at, created_at, updated_at FROM chunks WHERE id = ?").get("unrecoverable-raw-log");
    const nonRaw = db.prepare("SELECT event_at, created_at, updated_at FROM chunks WHERE id = ?").get("non-raw-log");
    assert.equal(recoverable.event_at, Date.parse("2026-06-17T09:30:00.000+08:00") / 1000);
    assert.equal(transcriptRecoverable.event_at, Date.parse(fixture.transcriptTs) / 1000);
    assert.equal(recoverable.created_at, null);
    assert.equal(transcriptRecoverable.created_at, null);
    assert.equal(unrecoverable.event_at, null);
    assert.equal(unrecoverable.created_at, null);
    assert.equal(nonRaw.event_at, null);
  } finally {
    db.close();
  }
});

test("ordinary core write guard still blocks core schema changes outside migration path", () => {
  const fixture = createFixture();
  const db = new Database(resolve(fixture.root, "engine-guard.sqlite"));
  try {
    db.exec(`ATTACH DATABASE '${String(fixture.coreDbPath).replace(/'/g, "''")}' AS core`);
    patchWriteGuards(db, { message: "blocked core writes in test" });
    assert.throws(
      () => db.exec("ALTER TABLE core.chunks ADD COLUMN event_at INTEGER"),
      /blocked core writes/i,
    );
  } finally {
    db.close();
  }

  const report = applyCoreChunkTimeMigration({
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    sessionsDir: fixture.sessionsDir,
    backupDir: fixture.backupDir,
    confirmToken: CORE_CHUNK_TIME_MIGRATION_CONFIRM_TOKEN,
    confirmUnrecoverableEventAtNulls: CORE_CHUNK_TIME_MIGRATION_ALLOW_UNRECOVERABLE_EVENT_AT_NULLS_TOKEN,
  });
  assert.deepEqual(report.added_columns, ["event_at", "created_at"]);
});
