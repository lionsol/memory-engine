import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { auditCoreChunkEventTimeRecovery } from "../lib/db/core-chunk-time-migration.js";

const CLI_PATH = resolve(process.cwd(), "bin/audit-core-chunk-event-time-recovery.js");

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

function createFixture(options = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-event-time-audit-"));
  const coreDbPath = resolve(root, "core.sqlite");
  const engineDbPath = resolve(root, "engine.sqlite");
  const sessionsDir = resolve(root, "sessions");
  mkdirSync(sessionsDir, { recursive: true });

  const coreDb = new Database(coreDbPath);
  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        updated_at INTEGER${options.includeEventAt ? ",\n        event_at INTEGER" : ""}${options.includeCreatedAt ? ",\n        created_at INTEGER" : ""}
      )
    `);
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
  } finally {
    engineDb.close();
  }

  return { root, coreDbPath, engineDbPath, sessionsDir };
}

function insertRawLogChunk(fixture, row) {
  const coreDb = new Database(fixture.coreDbPath);
  const engineDb = new Database(fixture.engineDbPath);
  try {
    const columns = new Set(coreDb.prepare("PRAGMA table_info(chunks)").all().map((entry) => String(entry.name || "")));
    const insertColumns = ["id", "text", "updated_at"];
    const values = [row.id, row.text, row.updated_at];
    if (columns.has("event_at")) {
      insertColumns.push("event_at");
      values.push(row.event_at ?? null);
    }
    if (columns.has("created_at")) {
      insertColumns.push("created_at");
      values.push(row.created_at ?? null);
    }
    const placeholders = insertColumns.map(() => "?").join(", ");
    coreDb.prepare(`INSERT INTO chunks (${insertColumns.join(", ")}) VALUES (${placeholders})`).run(...values);
    engineDb.prepare("INSERT INTO memory_confidence (chunk_id, category) VALUES (?, 'raw_log')").run(row.id);
  } finally {
    coreDb.close();
    engineDb.close();
  }
}

function writeSessionRecord(fixture, fileName, timestamp, text) {
  writeFileSync(resolve(fixture.sessionsDir, fileName), `${JSON.stringify({
    type: "message",
    timestamp,
    message: {
      role: "user",
      content: text,
    },
  })}\n`);
}

function readColumns(coreDbPath) {
  const db = new Database(coreDbPath, { readonly: true, fileMustExist: true });
  try {
    return new Set(db.prepare("PRAGMA table_info(chunks)").all().map((row) => String(row.name || "")));
  } finally {
    db.close();
  }
}

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("audit defaults to dry-run and does not write DB", () => {
  const fixture = createFixture({ includeEventAt: false, includeCreatedAt: false });
  insertRawLogChunk(fixture, {
    id: "text-only",
    text: "[2026-06-17T09:30:00.000+08:00] text only",
    updated_at: 1760000000,
  });

  const beforeColumns = readColumns(fixture.coreDbPath);
  const report = auditCoreChunkEventTimeRecovery(fixture);
  const afterColumns = readColumns(fixture.coreDbPath);

  assert.equal(report.mode, "dry_run");
  assert.equal(report.writes_db, false);
  assert.equal(report.recoverable_event_at_count, 1);
  assert.deepEqual(afterColumns, beforeColumns);
});

test("timezone-explicit text timestamp is recoverable", () => {
  const fixture = createFixture({ includeEventAt: true, includeCreatedAt: true });
  insertRawLogChunk(fixture, {
    id: "recoverable-text",
    text: "[2026-06-17 09:30:00 +08:00] explicit timezone",
    updated_at: 1760000000,
    event_at: null,
    created_at: null,
  });

  const report = auditCoreChunkEventTimeRecovery(fixture);
  assert.equal(report.recoverable_event_at_count, 1);
  assert.equal(report.recoverable_from_text_timestamp_count, 1);
  assert.equal(report.sample_recoverable[0].source, "text_timestamp");
});

test("timestamp without timezone is not recoverable", () => {
  const fixture = createFixture({ includeEventAt: true, includeCreatedAt: true });
  insertRawLogChunk(fixture, {
    id: "naive-text",
    text: "[2026-06-17 09:30:00] no timezone",
    updated_at: 1760000000,
    event_at: null,
    created_at: null,
  });

  const report = auditCoreChunkEventTimeRecovery(fixture);
  assert.equal(report.recoverable_event_at_count, 0);
  assert.equal(report.unrecoverable_event_at_null_count, 1);
});

test("session transcript exact chunk id is recoverable", () => {
  const fixture = createFixture({ includeEventAt: true, includeCreatedAt: true });
  const text = "transcript exact match";
  const ts = "2026-06-17T10:15:00.000+08:00";
  const chunkId = makeFlushChunkId(text, ts);
  writeSessionRecord(fixture, "agent-main.jsonl.reset.20260618", ts, text);
  insertRawLogChunk(fixture, {
    id: chunkId,
    text,
    updated_at: 1760000000,
    event_at: null,
    created_at: null,
  });

  const report = auditCoreChunkEventTimeRecovery(fixture);
  assert.equal(report.recoverable_event_at_count, 1);
  assert.equal(report.recoverable_from_session_transcript_count, 1);
  assert.equal(report.sample_recoverable[0].source, "session_transcript_exact_chunk_id");
});

test("matching text and transcript timestamps count as agree", () => {
  const fixture = createFixture({ includeEventAt: true, includeCreatedAt: true });
  const ts = "2026-06-17T09:30:00.000+08:00";
  const text = `[${ts}] agree`;
  const chunkId = makeFlushChunkId(text, ts);
  writeSessionRecord(fixture, "agent-main.jsonl.reset.20260618", ts, text);
  insertRawLogChunk(fixture, {
    id: chunkId,
    text,
    updated_at: 1760000000,
    event_at: null,
    created_at: null,
  });

  const report = auditCoreChunkEventTimeRecovery(fixture);
  assert.equal(report.recoverable_event_at_count, 1);
  assert.equal(report.text_and_session_transcript_agree_count, 1);
  assert.equal(report.recoverable_from_text_timestamp_count, 0);
  assert.equal(report.recoverable_from_session_transcript_count, 0);
  assert.equal(report.sample_recoverable[0].source, "text_timestamp+session_transcript_exact_chunk_id");
});

test("conflicting text and transcript timestamps do not backfill", () => {
  const fixture = createFixture({ includeEventAt: true, includeCreatedAt: true });
  const transcriptTs = "2026-06-17T10:15:00.000+08:00";
  const textTs = "2026-06-17T09:30:00.000+08:00";
  const text = `[${textTs}] conflict`;
  const chunkId = makeFlushChunkId(text, transcriptTs);
  writeSessionRecord(fixture, "agent-main.jsonl.reset.20260618", transcriptTs, text);
  insertRawLogChunk(fixture, {
    id: chunkId,
    text,
    updated_at: 1760000000,
    event_at: null,
    created_at: null,
  });

  const report = auditCoreChunkEventTimeRecovery(fixture);
  assert.equal(report.recoverable_event_at_count, 0);
  assert.equal(report.conflict_count, 1);
  assert.equal(report.sample_conflicts.length, 1);
  assert.equal(report.unrecoverable_event_at_null_count, 0);
});

test("updated_at is never used as a recovery source", () => {
  const fixture = createFixture({ includeEventAt: true, includeCreatedAt: true });
  insertRawLogChunk(fixture, {
    id: "updated-at-only",
    text: "no trusted timestamp source",
    updated_at: Date.parse("2026-06-17T09:30:00.000+08:00") / 1000,
    event_at: null,
    created_at: null,
  });

  const report = auditCoreChunkEventTimeRecovery(fixture);
  assert.equal(report.recoverable_event_at_count, 0);
  assert.equal(report.unrecoverable_event_at_null_count, 1);
});

test("CLI rejects apply-like flags", () => {
  for (const flag of ["--apply", "--force", "--write-db"]) {
    const run = runCli([flag]);
    assert.notEqual(run.status, 0, `expected failure for ${flag}`);
    assert.match(run.stderr, /unsupported flag/i);
  }
});

test("CLI json dry-run against real fixture does not add schema columns", () => {
  const fixture = createFixture({ includeEventAt: false, includeCreatedAt: false });
  insertRawLogChunk(fixture, {
    id: "legacy-row",
    text: "[2026-06-17T09:30:00.000+08:00] legacy row",
    updated_at: 1760000000,
  });
  const beforeColumns = readColumns(fixture.coreDbPath);

  const run = runCli([
    "--json",
    "--core-db", fixture.coreDbPath,
    "--engine-db", fixture.engineDbPath,
    "--sessions-dir", fixture.sessionsDir,
  ]);

  const afterColumns = readColumns(fixture.coreDbPath);
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.writes_db, false);
  assert.equal(report.has_event_at, false);
  assert.equal(report.has_created_at, false);
  assert.deepEqual(afterColumns, beforeColumns);
  assert.equal(afterColumns.has("event_at"), false);
  assert.equal(afterColumns.has("created_at"), false);
});
