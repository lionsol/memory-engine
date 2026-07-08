import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
  previewCoreChunkEventTimeMigrationImpact,
} from "../lib/db/core-chunk-time-migration.js";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const scriptPath = resolve(repoRoot, "bin/preview-core-chunk-event-time-migration-impact.js");

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
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-core-time-impact-"));
  const coreDbPath = resolve(root, "core.sqlite");
  const engineDbPath = resolve(root, "engine.sqlite");
  const sessionsDir = resolve(root, "sessions");
  mkdirSync(sessionsDir, { recursive: true });

  const transcriptText = "transcript-only recoverable raw log";
  const transcriptTs = "2026-06-18T10:15:00.000+08:00";
  const transcriptChunkId = makeFlushChunkId(transcriptText, transcriptTs);
  writeFileSync(resolve(sessionsDir, "agent-main.jsonl.reset.20260618"), `${JSON.stringify({
    type: "message",
    timestamp: transcriptTs,
    message: {
      role: "user",
      content: transcriptText,
    },
  })}\n`);

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
      VALUES (?, ?, 'memory', 0, 0, ?, 'test', ?, '', ?)
    `);
    insert.run(
      "recoverable-text",
      "memory/smart-add/2026-06-17.md",
      "h1",
      "[2026-06-17T09:30:00.000+08:00 | session:abc] **User:** recoverable raw log",
      Date.parse("2026-07-01T10:00:00.000Z") / 1000,
    );
    insert.run(
      transcriptChunkId,
      "memory/smart-add/2026-06-18.md",
      "h2",
      transcriptText,
      Date.parse("2026-07-02T10:00:00.000Z") / 1000,
    );
    insert.run(
      "unrecoverable-null",
      "memory/smart-add/2026-06-18.md",
      "h3",
      "**User:** no trusted event time here",
      Date.parse("2026-07-02T11:00:00.000Z") / 1000,
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
    insertConfidence.run("recoverable-text", "raw_log");
    insertConfidence.run(transcriptChunkId, "raw_log");
    insertConfidence.run("unrecoverable-null", "raw_log");
  } finally {
    engineDb.close();
  }

  return { coreDbPath, engineDbPath, sessionsDir, transcriptChunkId };
}

test("preview defaults to dry-run and does not write DB", () => {
  const fixture = createFixture();
  const report = previewCoreChunkEventTimeMigrationImpact(fixture);

  assert.equal(report.mode, "dry_run");
  assert.equal(report.dry_run, true);
  assert.equal(report.writes_db, false);
  assert.equal(report.has_event_at, false);
  assert.equal(report.raw_log_total_count, 3);
});

test("recoverable text timestamp rows and transcript exact-id rows are kept after migration", () => {
  const fixture = createFixture();
  const report = previewCoreChunkEventTimeMigrationImpact(fixture);

  assert.equal(report.recoverable_event_at_count, 2);
  assert.equal(report.recoverable_from_text_timestamp_count, 1);
  assert.equal(report.recoverable_from_session_transcript_count, 1);
  assert.deepEqual(report.recovery_source_distribution.map((row) => row.key), [
    "session_transcript_exact_chunk_id",
    "text_timestamp",
  ]);
});

test("rows without trusted event_at recovery are counted as estimated dropped", () => {
  const fixture = createFixture();
  const report = previewCoreChunkEventTimeMigrationImpact(fixture);

  assert.equal(report.unrecoverable_event_at_null_count, 1);
  assert.equal(report.estimated_rows_dropped_from_db_raw_log_pool_after_migration, 1);
  assert.equal(report.sample_unrecoverable_chunk_ids.length, 1);
  assert.equal(report.sample_unrecoverable_chunk_ids[0].id, "unrecoverable-null");
});

test("updated_at is used only for legacy impact grouping and not as recovery source", () => {
  const fixture = createFixture();
  const report = previewCoreChunkEventTimeMigrationImpact(fixture);

  assert.match(report.legacy_updated_at_basis_warning, /never used as event_at backfill source/);
  assert.equal(report.recoverable_event_at_count, 2);
  assert.equal(report.impact_by_legacy_updated_at_date.length >= 2, true);
  const july2 = report.impact_by_legacy_updated_at_date.find((row) => row.date === "2026-07-02");
  assert.equal(july2.legacy_rows, 2);
  assert.equal(july2.recoverable_rows, 1);
  assert.equal(july2.unrecoverable_rows, 1);
});

test("preview includes impact grouped by legacy updated_at date and by path", () => {
  const fixture = createFixture();
  const report = previewCoreChunkEventTimeMigrationImpact(fixture);

  assert.equal(Array.isArray(report.impact_by_legacy_updated_at_date), true);
  assert.equal(Array.isArray(report.impact_by_path), true);
  assert.equal(report.impact_by_path[0].path.startsWith("memory/smart-add/"), true);
  assert.equal(Array.isArray(report.top_unrecoverable_dates), true);
  assert.equal(report.top_unrecoverable_dates[0].unrecoverable_rows >= 1, true);
});

test("CLI --json runs and forbidden flags are rejected", () => {
  const fixture = createFixture();
  const baseEnv = {
    ...process.env,
    MEMORY_ENGINE_CORE_DB: fixture.coreDbPath,
    MEMORY_ENGINE_DB: fixture.engineDbPath,
    MEMORY_ENGINE_DB_PATH: fixture.engineDbPath,
    MEMORY_ENGINE_SESSIONS_DIR: fixture.sessionsDir,
  };

  const run = spawnSync(process.execPath, [scriptPath, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: baseEnv,
  });
  assert.equal(run.status, 0);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.writes_db, false);
  assert.equal(parsed.raw_log_total_count, 3);

  for (const flag of ["--apply", "--force", "--write-db", "--no-backup"]) {
    const rejected = spawnSync(process.execPath, [scriptPath, flag], {
      cwd: repoRoot,
      encoding: "utf8",
      env: baseEnv,
    });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /unsupported flag/);
  }
});
