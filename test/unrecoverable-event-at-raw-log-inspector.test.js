import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
  inspectUnrecoverableEventAtRawLog,
} from "../lib/db/core-chunk-time-migration.js";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const scriptPath = resolve(repoRoot, "bin/inspect-unrecoverable-event-at-raw-log.js");

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
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-unrecoverable-inspector-"));
  const coreDbPath = resolve(root, "core.sqlite");
  const engineDbPath = resolve(root, "engine.sqlite");
  const sessionsDir = resolve(root, "sessions");
  const memoryDir = resolve(root, "memory");
  const smartAddDir = resolve(memoryDir, "smart-add");
  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(smartAddDir, { recursive: true });

  writeFileSync(resolve(smartAddDir, "2026-06-21.md"), "# Smart Added Memory\n", "utf8");

  const transcriptText = "transcript recoverable row";
  const transcriptTs = "2026-06-21T10:15:00.000+08:00";
  const transcriptChunkId = makeFlushChunkId(transcriptText, transcriptTs);
  writeFileSync(resolve(sessionsDir, "agent-main.jsonl.reset.20260621"), `${JSON.stringify({
    type: "message",
    timestamp: transcriptTs,
    message: {
      role: "assistant",
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
      "meta-header",
      "memory/smart-add/2026-06-21.md",
      "h1",
      "# Smart Added Memory\n\nCategory: raw_log\n<!-- smart-add-fingerprint: abcdef -->",
      Date.parse("2026-06-21T01:00:00.000Z") / 1000,
    );
    insert.run(
      "tool-output",
      "memory/smart-add/2026-06-21.md",
      "h2",
      "```bash\nnpm test\nstdout: all green\n```",
      Date.parse("2026-06-21T02:00:00.000Z") / 1000,
    );
    insert.run(
      "same-day-keep-null",
      "memory/smart-add/2026-06-21.md",
      "h2b",
      "**Assistant:** retained in smart-add file without trusted event_at",
      Date.parse("2026-06-21T02:30:00.000Z") / 1000,
    );
    insert.run(
      "user-manual",
      "memory/smart-add/2026-06-20.md",
      "h3",
      "**User:** follow up on migration TODO and preference update",
      Date.parse("2026-06-21T03:00:00.000Z") / 1000,
    );
    insert.run(
      transcriptChunkId,
      "memory/smart-add/2026-06-21.md",
      "h4",
      transcriptText,
      Date.parse("2026-06-21T04:00:00.000Z") / 1000,
    );
    insert.run(
      "other-date",
      "memory/smart-add/2026-06-15.md",
      "h5",
      "**Assistant:** another day",
      Date.parse("2026-06-15T04:00:00.000Z") / 1000,
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
    for (const id of ["meta-header", "tool-output", "same-day-keep-null", "user-manual", transcriptChunkId, "other-date"]) {
      insertConfidence.run(id, "raw_log");
    }
  } finally {
    engineDb.close();
  }

  return { coreDbPath, engineDbPath, sessionsDir, memoryDir, transcriptChunkId };
}

test("inspector defaults to dry-run and filters by legacy updated_at date", () => {
  const fixture = createFixture();
  const report = inspectUnrecoverableEventAtRawLog({
    ...fixture,
    date: "2026-06-21",
  });

  assert.equal(report.mode, "dry_run");
  assert.equal(report.dry_run, true);
  assert.equal(report.writes_db, false);
  assert.equal(report.legacy_rows, 5);
  assert.equal(report.unrecoverable_rows, 4);
  assert.equal(report.recoverable_rows, 1);
});

test("recoverable rows are excluded from unrecoverable samples", () => {
  const fixture = createFixture();
  const report = inspectUnrecoverableEventAtRawLog({
    ...fixture,
    date: "2026-06-21",
  });

  assert.equal(report.sample_unrecoverable.some((row) => row.id === fixture.transcriptChunkId), false);
});

test("role, tag, tool, checkpoint, and file existence hints are aggregated without exposing raw text", () => {
  const fixture = createFixture();
  const report = inspectUnrecoverableEventAtRawLog({
    ...fixture,
    date: "2026-06-21",
  });

  assert.deepEqual(report.role_breakdown.map((row) => row.key), ["assistant", "metadata_header", "unknown", "user"]);
  assert.equal(report.available_in_smart_add_file_count, 3);
  assert.equal(report.path_date_match_count, 3);
  assert.equal(report.looks_like_tool_output_count, 1);
  assert.equal(report.looks_like_checkpoint_generated_count, 0);
  assert.deepEqual(report.recommended_action_breakdown.map((row) => row.key), [
    "ignore_low_value",
    "keep_null",
    "manual_recovery_candidate",
  ]);
  assert.equal("text" in report.sample_unrecoverable[0], false);
  assert.equal("raw_text" in report.sample_unrecoverable[0], false);
});

test("smart-add file existence uses memory dir only and path match affects recommendation", () => {
  const fixture = createFixture();
  const report = inspectUnrecoverableEventAtRawLog({
    ...fixture,
    date: "2026-06-21",
  });

  const keepNullRows = report.sample_unrecoverable.filter((row) => row.recommended_action === "keep_null");
  assert.equal(keepNullRows.length, 1);
  assert.equal(keepNullRows[0].id, "same-day-keep-null");
  assert.equal(keepNullRows[0].available_in_smart_add_file, true);
  assert.equal(keepNullRows[0].path_date_matches_legacy_updated_at_date, true);
});

test("CLI --json runs and forbidden flags are rejected", () => {
  const fixture = createFixture();
  const baseEnv = {
    ...process.env,
    MEMORY_ENGINE_CORE_DB: fixture.coreDbPath,
    MEMORY_ENGINE_DB: fixture.engineDbPath,
    MEMORY_ENGINE_DB_PATH: fixture.engineDbPath,
    MEMORY_ENGINE_SESSIONS_DIR: fixture.sessionsDir,
    MEMORY_ENGINE_MEMORY_DIR: fixture.memoryDir,
  };

  const run = spawnSync(process.execPath, [scriptPath, "--date", "2026-06-21", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: baseEnv,
  });
  assert.equal(run.status, 0);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.writes_db, false);
  assert.equal(parsed.unrecoverable_rows, 4);
  assert.equal(JSON.stringify(parsed).includes("follow up on migration"), false);

  for (const flag of ["--apply", "--force", "--write-db", "--no-backup"]) {
    const rejected = spawnSync(process.execPath, [scriptPath, "--date", "2026-06-21", flag], {
      cwd: repoRoot,
      encoding: "utf8",
      env: baseEnv,
    });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /unsupported flag/);
  }
});
