import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkpoint = require("../bin/session-checkpoint.js");

function createFixture({ now = "2026-06-16T17:30:00.000Z" } = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-checkpoint-"));
  const workspaceDir = resolve(root, "workspace");
  const memoryDir = resolve(root, "memory-output");
  const sessionsDir = resolve(root, "sessions");
  const coreDbPath = resolve(root, "core.sqlite");
  const engineDbPath = resolve(root, "memory-engine.sqlite");
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });

  const smartAddPath = "memory/smart-add/2026-06-17.md";
  const coreDb = new Database(coreDbPath);
  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        text TEXT,
        updated_at INTEGER
      )
    `);
    coreDb.prepare("INSERT INTO chunks (id, path, text, updated_at) VALUES (?, ?, ?, ?)").run(
      "smartadd-chunk-1",
      smartAddPath,
      "placeholder chunk for checkpoint confidence writes",
      1718587800,
    );
  } finally {
    coreDb.close();
  }

  return {
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
    coreDbPath,
    engineDbPath,
    memoryDir,
    now,
    root,
    sessionsDir,
    smartAddPath,
    workspaceDir,
  };
}

function readCoreChunkCount(coreDbPath) {
  const db = new Database(coreDbPath, { readonly: true });
  try {
    return Number(db.prepare("SELECT COUNT(*) AS c FROM chunks").get()?.c || 0);
  } finally {
    db.close();
  }
}

function readEngineConfidenceRows(engineDbPath) {
  const db = new Database(engineDbPath, { readonly: true });
  try {
    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_confidence'",
    ).get();
    if (!table) return [];
    return db.prepare("SELECT chunk_id, category, confidence FROM memory_confidence ORDER BY chunk_id").all();
  } finally {
    db.close();
  }
}

test("session checkpoint skips summary on note-only logs and never calls LLM", async () => {
  const fixture = createFixture();
  let llmCalls = 0;

  try {
    const result = await checkpoint.withRuntime({
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
      workspaceDir: fixture.workspaceDir,
      memoryDir: fixture.memoryDir,
      sessionsDir: fixture.sessionsDir,
      timeZone: "Asia/Shanghai",
      now: () => Date.parse(fixture.now),
      llmNightlyExtract: async () => {
        llmCalls += 1;
        return { episode_summary: "should not happen", smart_memories: [], configs: [] };
      },
    }, () => checkpoint.nightlyCheckpoint([
      { category: "preference", text: "just a note", source: "note" },
    ]));

    const episodePath = resolve(fixture.memoryDir, "episodes", "2026-06-16.md");
    const episode = readFileSync(episodePath, "utf8");

    assert.equal(llmCalls, 0);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "no_conversation_data");
    assert.equal(result.episode, false);
    assert.match(episode, /数据不完整|incomplete/i);
    assert.match(episode, /跳过 LLM 摘要生成/);
    assert.doesNotMatch(episode, /should not happen/);
    assert.ok(episodePath.startsWith(fixture.root));
  } finally {
    fixture.cleanup();
  }
});

test("session checkpoint with no raw logs never calls LLM", async () => {
  const fixture = createFixture();
  let llmCalls = 0;

  try {
    const result = await checkpoint.withRuntime({
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
      workspaceDir: fixture.workspaceDir,
      memoryDir: fixture.memoryDir,
      sessionsDir: fixture.sessionsDir,
      timeZone: "Asia/Shanghai",
      now: () => Date.parse(fixture.now),
      llmNightlyExtract: async () => {
        llmCalls += 1;
        return { episode_summary: "should not happen", smart_memories: [], configs: [] };
      },
    }, () => checkpoint.nightlyCheckpoint([]));

    assert.equal(llmCalls, 0);
    assert.deepEqual(result, { memories: 0, episode: false, configs: 0 });
  } finally {
    fixture.cleanup();
  }
});

test("session checkpoint with all-empty logs never calls LLM", async () => {
  const fixture = createFixture();
  let llmCalls = 0;

  try {
    const result = await checkpoint.withRuntime({
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
      workspaceDir: fixture.workspaceDir,
      memoryDir: fixture.memoryDir,
      sessionsDir: fixture.sessionsDir,
      timeZone: "Asia/Shanghai",
      now: () => Date.parse(fixture.now),
      llmNightlyExtract: async () => {
        llmCalls += 1;
        return { episode_summary: "should not happen", smart_memories: [], configs: [] };
      },
    }, () => checkpoint.nightlyCheckpoint([
      { category: "raw_log", text: "   ", source: "conversation" },
      { category: "preference", text: "\n", source: "note" },
    ]));

    assert.equal(llmCalls, 0);
    assert.deepEqual(result, { memories: 0, episode: false, configs: 0 });
  } finally {
    fixture.cleanup();
  }
});

test("session checkpoint with conversation logs calls LLM", async () => {
  const fixture = createFixture();
  let llmCalls = 0;

  try {
    await checkpoint.withRuntime({
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
      workspaceDir: fixture.workspaceDir,
      memoryDir: fixture.memoryDir,
      sessionsDir: fixture.sessionsDir,
      timeZone: "Asia/Shanghai",
      now: () => Date.parse(fixture.now),
      llmNightlyExtract: async () => {
        llmCalls += 1;
        return { episode_summary: "summary", smart_memories: [], configs: [] };
      },
      repairOrphanVectors: async () => 0,
      resolveConfigConflicts: () => 0,
    }, () => checkpoint.nightlyCheckpoint([
      { chunk_id: "conv-1", category: "raw_log", text: "**User:** summarize today", source: "conversation" },
    ]));

    assert.equal(llmCalls, 1);
  } finally {
    fixture.cleanup();
  }
});

test("session checkpoint writes only temp outputs, keeps targetDate/generatedAt stable, leaves core readonly, and writes engine DB", async () => {
  const fixture = createFixture();
  const coreRowsBefore = readCoreChunkCount(fixture.coreDbPath);

  try {
    const result = await checkpoint.withRuntime({
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
      workspaceDir: fixture.workspaceDir,
      memoryDir: fixture.memoryDir,
      sessionsDir: fixture.sessionsDir,
      timeZone: "Asia/Shanghai",
      now: () => Date.parse(fixture.now),
      llmNightlyExtract: async () => ({
        episode_summary: "MOCK SUMMARY: checkpoint integration test",
        smart_memories: [],
        configs: [{ key: "theme", value: "solarized", context: "mock" }],
      }),
      repairOrphanVectors: async () => 0,
      resolveConfigConflicts: () => 0,
      readYesterdayRawLogs: () => ([
        { chunk_id: "conv-1", category: "raw_log", text: "**User:** summarize today", source: "conversation" },
      ]),
    }, () => checkpoint.main());

    assert.equal(result, undefined);

    const busy = await checkpoint.withRuntime({
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
      workspaceDir: fixture.workspaceDir,
      memoryDir: fixture.memoryDir,
      sessionsDir: fixture.sessionsDir,
      timeZone: "Asia/Shanghai",
      now: () => Date.parse(fixture.now),
    }, () => checkpoint.inspectBusyTimeouts());
    assert.equal(busy.core, 5000);
    assert.equal(busy.engine, 5000);
    assert.equal(busy.attachedCore, 5000);

    const episodePath = resolve(fixture.memoryDir, "episodes", "2026-06-16.md");
    const smartAddPath = resolve(fixture.memoryDir, "smart-add", "2026-06-17.md");
    const episode = readFileSync(episodePath, "utf8");
    const smartAdd = readFileSync(smartAddPath, "utf8");
    const confidenceRows = readEngineConfidenceRows(fixture.engineDbPath);
    const coreRowsAfter = readCoreChunkCount(fixture.coreDbPath);

    assert.equal(coreRowsAfter, coreRowsBefore);
    assert.ok(episodePath.startsWith(fixture.root));
    assert.ok(smartAddPath.startsWith(fixture.root));
    assert.match(episode, /MOCK SUMMARY: checkpoint integration test/);
    assert.match(episode, /targetDate: 2026-06-16/);
    assert.match(episode, /generatedAt: 2026-06-16T17:30:00.000Z/);
    assert.match(episode, /category: episodic/);
    assert.match(episode, /source_type: checkpoint_llm/);
    assert.match(smartAdd, /## 2026-06-16_episodic_nightly_generated_013000/);
    assert.match(smartAdd, /Category: episodic/);
    assert.match(smartAdd, /"generatedAt":"2026-06-16T17:30:00.000Z"/);
    assert.match(smartAdd, /"targetDate":"2026-06-16"/);
    assert.ok(confidenceRows.length >= 1);
    assert.equal(confidenceRows[0].chunk_id, "smartadd-chunk-1");
  } finally {
    fixture.cleanup();
  }
});

test("session checkpoint records explicit failure when LLM throws and does not write hallucinated summary", async () => {
  const fixture = createFixture();

  try {
    const result = await checkpoint.withRuntime({
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
      workspaceDir: fixture.workspaceDir,
      memoryDir: fixture.memoryDir,
      sessionsDir: fixture.sessionsDir,
      timeZone: "Asia/Shanghai",
      now: () => Date.parse(fixture.now),
      llmNightlyExtract: async () => {
        throw new Error("mock llm down");
      },
    }, () => checkpoint.nightlyCheckpoint([
      { chunk_id: "conv-1", category: "raw_log", text: "**User:** summarize today", source: "conversation" },
    ]));

    const episodePath = resolve(fixture.memoryDir, "episodes", "2026-06-16.md");
    const episode = readFileSync(episodePath, "utf8");

    assert.equal(result.timeout, true);
    assert.match(String(result.error || ""), /mock llm down/);
    assert.match(episode, /llm超时/);
    assert.match(episode, /generatedAt: 2026-06-16T17:30:00.000Z/);
    assert.doesNotMatch(episode, /MOCK SUMMARY|summarize today/);
  } finally {
    fixture.cleanup();
  }
});
