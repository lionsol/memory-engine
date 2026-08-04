import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";

const require = createRequire(import.meta.url);
const checkpoint = require("../bin/session-checkpoint.js");
const rawLog = require("../lib/checkpoint/raw-log.js");

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-checkpoint-current-core-"));
  const workspaceDir = join(root, "workspace");
  const memoryDir = join(workspaceDir, "memory");
  const smartAddDir = join(memoryDir, "smart-add");
  const episodesDir = join(memoryDir, "episodes");
  const sessionsDir = join(root, "sessions");
  const coreDbPath = join(root, "openclaw-agent.sqlite");
  const engineDbPath = join(root, "engine.sqlite");
  for (const path of [workspaceDir, memoryDir, smartAddDir, episodesDir, sessionsDir]) {
    mkdirSync(path, { recursive: true });
  }

  const core = new Database(coreDbPath);
  core.exec(`
    CREATE TABLE memory_index_chunks (
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
    );
    CREATE VIRTUAL TABLE memory_index_chunks_fts USING fts5(
      id UNINDEXED,
      text,
      path UNINDEXED
    );
  `);
  core.prepare(`
    INSERT INTO memory_index_chunks
      (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
    VALUES (?, ?, 'memory', 1, 1, 'hash', 'model', ?, '[]', ?)
  `).run(
    "current-raw-log",
    "memory/smart-add/current.md",
    "**User:** current Core checkpoint evidence",
    Date.parse("2026-06-17T10:00:00+08:00") / 1000,
  );
  core.close();

  const engine = new Database(engineDbPath);
  engine.exec(`
    CREATE TABLE memory_confidence (
      chunk_id TEXT PRIMARY KEY,
      category TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO memory_confidence (chunk_id, category, is_archived)
    VALUES ('current-raw-log', 'raw_log', 0);
  `);
  engine.close();

  return {
    root,
    workspaceDir,
    memoryDir,
    smartAddDir,
    episodesDir,
    sessionsDir,
    coreDbPath,
    engineDbPath,
  };
}

test("checkpoint reads target-date raw_log from the current OpenClaw Core schema", async () => {
  const fixture = createFixture();
  try {
    await checkpoint.withRuntime({
      workspaceDir: fixture.workspaceDir,
      memoryDir: fixture.memoryDir,
      smartAddDir: fixture.smartAddDir,
      episodesDir: fixture.episodesDir,
      sessionsDir: fixture.sessionsDir,
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
      timeZone: "Asia/Shanghai",
      now: () => Date.parse("2026-06-18T03:30:00+08:00"),
    }, async () => {
      const logs = rawLog.readCheckpointRawLogs({
        targetDate: "2026-06-17",
        timeZone: "Asia/Shanghai",
      });
      assert.deepEqual(logs, [{
        category: "raw_log",
        text: "**User:** current Core checkpoint evidence",
        source: "conversation",
        chunk_id: "current-raw-log",
      }]);
      const stats = rawLog.getRawLogCollectionStats(logs);
      assert.equal(stats.rawLogTimeBasis, "updated_at_event_time");
      assert.equal(stats.rawLogIncluded, 1);
      assert.equal(stats.rawLogSkippedOutOfTargetDate, 0);
    });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
