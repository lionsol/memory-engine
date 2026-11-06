import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkpoint = require("../bin/session-checkpoint.js");
const { factResponse } = require("./checkpoint-fact-fixture.cjs");
// This file exercises legacy extraction and its downstream writes in an isolated test process.
process.env.MEMORY_ENGINE_CHECKPOINT_SUMMARY_MODE = "legacy";
// These downstream integration tests do not invoke the host Core indexer.
const completeCoreIndex = async ({ targetDate }) => ({
  ok: true, status: "complete", index_invocation: { status: "succeeded" },
  target_date_coverage: { status: "complete", target_date: targetDate,
    path: `memory/smart-add/${targetDate}.md`, required_fingerprints: 1,
    matched_fingerprints: 1, missing_fingerprints: 0 },
});
const confidenceWriter = require("../lib/checkpoint/confidence-writer.js");
const smartAddWriter = require("../lib/checkpoint/smart-add-writer.js");
const stableIdentity = require("../lib/db/stable-memory-identity.cjs");

async function withStubbedCheckpointConfidence(writeConfidenceImpl, run) {
  const checkpointPath = require.resolve("../bin/session-checkpoint.js");
  const confidencePath = require.resolve("../lib/checkpoint/confidence-writer.js");
  const originalCheckpoint = require.cache[checkpointPath];
  const originalConfidence = require.cache[confidencePath];

  delete require.cache[checkpointPath];
  require.cache[confidencePath] = {
    id: confidencePath,
    filename: confidencePath,
    loaded: true,
    exports: { writeConfidence: writeConfidenceImpl },
  };

  const stubbedCheckpoint = require("../bin/session-checkpoint.js");

  try {
    return await run(stubbedCheckpoint);
  } finally {
    delete require.cache[checkpointPath];
    delete require.cache[confidencePath];
    if (originalCheckpoint) require.cache[checkpointPath] = originalCheckpoint;
    if (originalConfidence) require.cache[confidencePath] = originalConfidence;
  }
}

function createFixture({
  now = "2026-06-16T17:30:00.000Z",
  includeFts = false,
  includeEngineSchema = false,
} = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-checkpoint-"));
  const workspaceDir = resolve(root, "workspace");
  const memoryDir = resolve(workspaceDir, "memory");
  const sessionsDir = resolve(root, "sessions");
  const coreDbPath = resolve(root, "core.sqlite");
  const engineDbPath = resolve(root, "memory-engine.sqlite");
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(memoryDir, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });

  const smartAddPath = "memory/generated-smart-add/2026-06-17.md";
  const coreDb = new Database(coreDbPath);
  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        text TEXT,
        updated_at INTEGER,
        start_line INTEGER,
        end_line INTEGER
      )
    `);
    coreDb.prepare("INSERT INTO chunks (id, path, text, updated_at, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?)").run(
      "smartadd-chunk-1",
      smartAddPath,
      "placeholder chunk for checkpoint confidence writes",
      1718587800,
      3,
      12,
    );
    if (includeFts) coreDb.exec("CREATE VIRTUAL TABLE chunks_fts USING fts5(text)");
  } finally {
    coreDb.close();
  }
  if (includeEngineSchema) {
    const engineDb = new Database(engineDbPath);
    try {
      engineDb.exec(`
        CREATE TABLE memory_confidence (
          chunk_id TEXT PRIMARY KEY,
          is_archived INTEGER NOT NULL DEFAULT 0
        )
      `);
    } finally {
      engineDb.close();
    }
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

test("flush checkpoint child receives the current canonical business timezone", async () => {
  const calls = [];
  await checkpoint.withRuntime({ timeZone: "Asia/Singapore" }, async () => {
    const result = checkpoint.runFlushSessionRawlogCheckpoint({
      spawnSyncImpl: (...args) => {
        calls.push(args);
        return { status: 0, stdout: "{}\n", stderr: "" };
      },
      nodeExecPath: "/fake/node",
      scriptPath: "/fake/flush-session-rawlog.js",
      cwd: "/fake/project",
      env: { MEMORY_ENGINE_TIME_ZONE: "UTC", TEST_ENV: "1" },
      targetDate: "2026-06-18",
    });

    assert.equal(result.ok, true);
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    "/fake/node",
    ["/fake/flush-session-rawlog.js", "--checkpoint", "--target-date", "2026-06-18"],
    {
      cwd: "/fake/project",
      env: { MEMORY_ENGINE_TIME_ZONE: "Asia/Singapore", TEST_ENV: "1" },
      encoding: "utf8",
    },
  ]);
});

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
    assert.deepEqual(result, {
      status: "empty_input",
      memories: 0,
      episode: false,
      configs: 0,
      writes: { file_written: 0, confidence_bound: 0, pending: 0, failed: 0 },
    });
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
    assert.deepEqual(result, {
      status: "empty_input",
      memories: 0,
      episode: false,
      configs: 0,
      writes: { file_written: 0, confidence_bound: 0, pending: 0, failed: 0 },
    });
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
      llmNightlyExtract: async input => {
        llmCalls += 1;
        return factResponse(input);
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
      llmNightlyExtract: async input => factResponse(input, () => ({
        config: { key: "theme", value: "solarized" },
      })),
      repairOrphanVectors: async () => 0,
      resolveConfigConflicts: () => 0,
      readCheckpointRawLogs: () => ([
        { chunk_id: "conv-1", category: "raw_log", text: "**User:** MOCK SUMMARY: checkpoint integration test; theme = solarized", source: "conversation" },
      ]),
      flushCheckpointRawLog: () => ({ ok: true }),
      syncCoreMemoryIndex: completeCoreIndex,
    }, () => checkpoint.main());

    assert.equal(result.businessStatus.status, "valid_summary");
    assert.equal(result.businessStatus.business_complete, false);

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
    const smartAddPath = resolve(fixture.memoryDir, "generated-smart-add", "2026-06-17.md");
    const legacyInputSmartAddPath = resolve(fixture.memoryDir, "smart-add", "2026-06-17.md");
    const episode = readFileSync(episodePath, "utf8");
    const smartAdd = readFileSync(smartAddPath, "utf8");
    const confidenceRows = readEngineConfidenceRows(fixture.engineDbPath);
    const coreRowsAfter = readCoreChunkCount(fixture.coreDbPath);

    assert.equal(coreRowsAfter, coreRowsBefore);
    assert.ok(episodePath.startsWith(fixture.root));
    assert.ok(smartAddPath.startsWith(fixture.root));
    assert.equal(existsSync(legacyInputSmartAddPath), false);
    assert.match(episode, /MOCK SUMMARY: checkpoint integration test/);
    assert.match(episode, /targetDate: 2026-06-16/);
    assert.match(episode, /generatedAt: 2026-06-16T17:30:00.000Z/);
    assert.match(episode, /timeZone: Asia\/Shanghai/);
    assert.match(episode, /category: episodic/);
    assert.match(episode, /source_type: checkpoint_llm/);
    assert.match(episode, /smartAddPath: memory\/smart-add\/2026-06-16\.md/);
    assert.match(episode, /smartAddInputPolicy: trusted_only:manual,agent_smart_add,session_flush/);
    assert.match(episode, /smartAddIncluded: 0/);
    assert.match(episode, /smartAddSkippedUnknownProvenance: 0/);
    assert.match(episode, /smartAddSkippedCheckpointGenerated: 0/);
    assert.match(episode, /rawLogTimeBasis: event_at\/legacy_event_time/);
    assert.match(episode, /rawLogIncluded: 0|rawLogIncluded: 1/);
    assert.match(episode, /resetDirectParseEnabled: false/);
    assert.match(smartAdd, /## [a-f0-9]{16}/);
    assert.match(smartAdd, /Category: episodic/);
    assert.match(smartAdd, /Provenance: checkpoint_generated/);
    assert.match(smartAdd, /"generatedAt":"2026-06-16T17:30:00.000Z"/);
    assert.match(smartAdd, /"targetDate":"2026-06-16"/);
    assert.ok(confidenceRows.length >= 1);
    assert.equal(confidenceRows[0].chunk_id, "smartadd-chunk-1");
  } finally {
    fixture.cleanup();
  }
});

test("session checkpoint exports legacy and official busy-timeout inspectors", () => {
  assert.equal(typeof checkpoint.inspectBusyTimeouts, "function");
  assert.equal(typeof checkpoint.inspectCheckpointBusyTimeouts, "function");
});

test("session checkpoint dry-run reads targetDate-bounded raw logs without flushing and keeps reset direct parse off by default", async () => {
  const fixture = createFixture();
  let flushed = 0;
  let reconciled = 0;
  let readerOptions = null;

  try {
    await checkpoint.withRuntime({
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
      workspaceDir: fixture.workspaceDir,
      memoryDir: fixture.memoryDir,
      sessionsDir: fixture.sessionsDir,
      timeZone: "Asia/Shanghai",
      now: () => Date.parse(fixture.now),
      flushCheckpointRawLog: () => {
        flushed += 1;
        return { ok: true };
      },
      reconcileSessionFlushManagedState: async () => {
        reconciled += 1;
        return { engine_converged: true };
      },
      readCheckpointRawLogs: (options) => {
        readerOptions = options;
        return [];
      },
      repairOrphanVectors: async () => 0,
      resolveConfigConflicts: () => 0,
    }, () => checkpoint.main(["--dry-run"]));

    assert.equal(flushed, 0);
    assert.equal(reconciled, 0);
    assert.equal(readerOptions.targetDate, "2026-06-16");
    assert.equal(readerOptions.resetDirectParseEnabled, false);
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
    assert.equal(result.status, "summary_invalid");
    assert.equal(result.reason, "summary_extraction_failed");
    assert.equal(existsSync(episodePath), false);
    assert.equal(existsSync(resolve(fixture.memoryDir, "generated-smart-add")), false);
  } finally {
    fixture.cleanup();
  }
});

test("session checkpoint warns and continues when confidence writes fail", async () => {
  const fixture = createFixture({ includeFts: true, includeEngineSchema: true });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(" "));

  try {
    let result;
    await withStubbedCheckpointConfidence(() => {
      throw new Error("confidence write exploded");
    }, async (stubbedCheckpoint) => {
      result = await stubbedCheckpoint.withRuntime({
        coreDbPath: fixture.coreDbPath,
        engineDbPath: fixture.engineDbPath,
        workspaceDir: fixture.workspaceDir,
        memoryDir: fixture.memoryDir,
        sessionsDir: fixture.sessionsDir,
        timeZone: "Asia/Shanghai",
        now: () => Date.parse(fixture.now),
        llmNightlyExtract: async input => factResponse(input, () => ({
          memory_type: "preference", config: { key: "theme", value: "solarized" },
        })),
        repairOrphanVectors: async () => 0,
        resolveConfigConflicts: () => 0,
      }, () => stubbedCheckpoint.nightlyCheckpoint([
        { chunk_id: "conv-1", category: "raw_log", text: "**User:** User prefers concise warnings; theme = solarized.", source: "conversation" },
      ]));
    });

    assert.equal(result.memories, 1);
    assert.equal(result.episode, true);
    assert.equal(result.configs, 1);
    assert.deepEqual(result.writes, {
      file_written: 3,
      confidence_bound: 0,
      pending: 0,
      failed: 3,
    });
    assert.equal(warnings.length, 3);

    const smartMemoryWarning = warnings.find((line) => line.includes("section=smart_memory"));
    const episodeWarning = warnings.find((line) => line.includes("section=episode_summary"));
    const configWarning = warnings.find((line) => line.includes("section=config"));

    assert.ok(smartMemoryWarning);
    assert.match(smartMemoryWarning, /type=preference/);
    assert.match(smartMemoryWarning, /entryId=\S+/);
    assert.match(smartMemoryWarning, /category=preference/);
    assert.match(smartMemoryWarning, /error=confidence write exploded/);

    assert.ok(episodeWarning);
    assert.match(episodeWarning, /entryId=\S+/);
    assert.match(episodeWarning, /category=episodic/);
    assert.match(episodeWarning, /error=confidence write exploded/);

    assert.ok(configWarning);
    assert.match(configWarning, /key=theme/);
    assert.match(configWarning, /entryId=\S+/);
    assert.match(configWarning, /category=preference/);
    assert.match(configWarning, /error=confidence write exploded/);
  } finally {
    console.warn = originalWarn;
    fixture.cleanup();
  }
});

test("generated entries use content fingerprints and report pending confidence separately", async () => {
  const fixture = createFixture({ includeFts: true, includeEngineSchema: true });
  try {
    const result = await withStubbedCheckpointConfidence(
      () => ({ ok: true, status: "pending", reason: "exact_core_chunk_not_indexed" }),
      async (stubbedCheckpoint) => stubbedCheckpoint.withRuntime({
        coreDbPath: fixture.coreDbPath,
        engineDbPath: fixture.engineDbPath,
        workspaceDir: fixture.workspaceDir,
        memoryDir: fixture.memoryDir,
        sessionsDir: fixture.sessionsDir,
        timeZone: "Asia/Shanghai",
        now: () => Date.parse(fixture.now),
        llmNightlyExtract: async input => factResponse(input, () => ({ memory_type: "preference" })),
      }, () => stubbedCheckpoint.nightlyCheckpoint([
        { chunk_id: "conv-1", category: "raw_log", text: "**User:** first generated preference\n\nsecond generated preference", source: "conversation" },
      ])),
    );
    assert.deepEqual(result.writes, {
      file_written: 3,
      confidence_bound: 0,
      pending: 3,
      failed: 0,
    });
    const smartAddPath = resolve(fixture.memoryDir, "generated-smart-add", "2026-06-17.md");
    const smartAdd = readFileSync(smartAddPath, "utf8");
    const headings = smartAdd.match(/^## ([a-f0-9]{16})$/gm) || [];
    assert.equal(headings.length, 3);
    assert.notEqual(headings[0], headings[1]);
  } finally {
    fixture.cleanup();
  }
});

test("pending generated entry is rebound after Core indexing without duplicating its file", async () => {
  const fixture = createFixture({ includeFts: true, includeEngineSchema: true });
  let coreIndexed = false;
  const confidenceCalls = [];
  try {
    const first = await withStubbedCheckpointConfidence((entryId) => {
      confidenceCalls.push({ entryId, coreIndexed });
      return coreIndexed
        ? { ok: true, status: "initialized", initialized: 1 }
        : { ok: true, status: "pending", reason: "exact_core_chunk_not_indexed" };
    }, async stubbedCheckpoint => stubbedCheckpoint.withRuntime({
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
      workspaceDir: fixture.workspaceDir,
      memoryDir: fixture.memoryDir,
      sessionsDir: fixture.sessionsDir,
      timeZone: "Asia/Shanghai",
      now: () => Date.parse(fixture.now),
      llmNightlyExtract: async input => factResponse(input, () => ({ memory_type: "preference" })),
    }, () => stubbedCheckpoint.nightlyCheckpoint([
      { chunk_id: "conv-1", category: "raw_log", text: "**User:** pending then indexed preference", source: "conversation" },
    ])));
    assert.equal(first.writes.pending, 2);
    const generatedPath = resolve(fixture.memoryDir, "generated-smart-add", "2026-06-17.md");
    const firstContent = readFileSync(generatedPath, "utf8");
    assert.equal((firstContent.match(/^## [a-f0-9]{16}$/gm) || []).length, 2);
    const firstEntryId = firstContent.match(/^## ([a-f0-9]{16})$/m)?.[1];
    const firstLines = firstContent.split("\n");
    const firstEntryStart = firstLines.findIndex(line => /^## [a-f0-9]{16}$/.test(line)) + 1;
    const core = new Database(fixture.coreDbPath);
    core.prepare("DELETE FROM chunks").run();
    core.prepare(
      "INSERT INTO chunks (id, path, text, updated_at, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("indexed-pending", "memory/generated-smart-add/2026-06-17.md", "pending then indexed preference", 2, firstEntryStart, firstLines.length - 1);
    core.close();
    coreIndexed = true;

    const second = await withStubbedCheckpointConfidence((entryId) => {
      confidenceCalls.push({ entryId, coreIndexed });
      return { ok: true, status: "initialized", initialized: 1 };
    }, async stubbedCheckpoint => stubbedCheckpoint.withRuntime({
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
      workspaceDir: fixture.workspaceDir,
      memoryDir: fixture.memoryDir,
      sessionsDir: fixture.sessionsDir,
      timeZone: "Asia/Shanghai",
      now: () => Date.parse(fixture.now),
      llmNightlyExtract: async input => factResponse(input, () => ({ memory_type: "preference" })),
    }, () => stubbedCheckpoint.nightlyCheckpoint([
      { chunk_id: "conv-1", category: "raw_log", text: "**User:** pending then indexed preference", source: "conversation" },
    ])));
    assert.equal(second.writes.file_written, 0);
    assert.equal(second.writes.confidence_bound, 2);
    assert.equal(confidenceCalls.length, 4);
    assert.equal(confidenceCalls[0].entryId, firstEntryId);
    assert.equal(confidenceCalls[2].entryId, firstEntryId);
    const secondContent = readFileSync(generatedPath, "utf8");
    assert.equal((secondContent.match(/^## [a-f0-9]{16}$/gm) || []).length, 2);
  } finally {
    fixture.cleanup();
  }
});

test("already-written pending entry is rebound by the bounded retry path without LLM", async () => {
  const fixture = createFixture({ includeEngineSchema: true });
  const targetDate = "2026-06-17";
  const fileRel = `memory/generated-smart-add/${targetDate}.md`;
  const generatedPath = resolve(fixture.memoryDir, "generated-smart-add", `${targetDate}.md`);
  try {
    const engine = new Database(fixture.engineDbPath);
    engine.exec(`
      DROP TABLE memory_confidence;
      CREATE TABLE memory_confidence (
        chunk_id TEXT PRIMARY KEY,
        initial_confidence REAL NOT NULL DEFAULT 0.5,
        confidence REAL NOT NULL DEFAULT 0.5,
        last_confidence_update INTEGER,
        base_tau REAL NOT NULL DEFAULT 7,
        hit_count INTEGER NOT NULL DEFAULT 0,
        is_archived INTEGER NOT NULL DEFAULT 0,
        is_protected INTEGER NOT NULL DEFAULT 0,
        conflict_flag INTEGER NOT NULL DEFAULT 0,
        category TEXT NOT NULL DEFAULT 'raw_log',
        kg_data TEXT
      )
    `);
    stableIdentity.ensureStableMemoryIdentityTables(engine, { addConfidenceColumns: true });
    engine.close();
    const core = new Database(fixture.coreDbPath);
    core.prepare("DELETE FROM chunks").run();
    core.close();

    const first = await checkpoint.withRuntime({
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
      workspaceDir: fixture.workspaceDir,
      memoryDir: fixture.memoryDir,
      sessionsDir: fixture.sessionsDir,
      timeZone: "Asia/Shanghai",
      now: () => Date.parse("2026-06-17T09:00:00+08:00"),
    }, () => {
      const entryId = smartAddWriter.appendSmartAdd("real pending item", "preference", {
        generatedAt: "2026-06-17T09:00:00.000+08:00",
        provenance: smartAddWriter.SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED,
      });
      const confidence = confidenceWriter.writeConfidence(entryId, "real pending item", "preference", { fileRel });
      return { entryId, confidence };
    });
    assert.equal(first.confidence.status, "pending");
    const firstContent = readFileSync(generatedPath, "utf8");
    const lines = firstContent.split("\n");
    const startLine = lines.findIndex(line => line.startsWith("## ")) + 1;
    const coreAfterPending = new Database(fixture.coreDbPath);
    coreAfterPending.prepare(
      "INSERT INTO chunks (id, path, text, updated_at, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      "indexed-pending-item",
      fileRel,
      "real pending item",
      Date.parse("2026-06-17T10:00:00+08:00") / 1000,
      startLine,
      lines.length - 1,
    );
    coreAfterPending.close();

    let llmCalls = 0;
    await checkpoint.withRuntime({
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
      workspaceDir: fixture.workspaceDir,
      memoryDir: fixture.memoryDir,
      sessionsDir: fixture.sessionsDir,
      timeZone: "Asia/Shanghai",
      now: () => Date.parse("2026-06-17T11:00:00+08:00"),
      flushCheckpointRawLog: () => ({ ok: true }),
      readCheckpointRawLogs: () => [],
      syncCoreMemoryIndex: completeCoreIndex,
      llmNightlyExtract: async () => {
        llmCalls += 1;
        throw new Error("LLM must not be called for pending-only recovery");
      },
      repairOrphanVectors: async () => 0,
      resolveConfigConflicts: () => 0,
    }, () => checkpoint.main(["--target-date", targetDate]));

    assert.equal(llmCalls, 0);
    const engineAfter = new Database(fixture.engineDbPath, { readonly: true });
    const row = engineAfter.prepare(
      "SELECT chunk_id, entity_id FROM memory_confidence WHERE chunk_id = ?",
    ).get("indexed-pending-item");
    engineAfter.close();
    assert.equal(row.chunk_id, "indexed-pending-item");
    assert.equal(typeof row.entity_id, "string");
    assert.ok(row.entity_id.length > 0);
    const secondContent = readFileSync(generatedPath, "utf8");
    assert.equal((secondContent.match(/^## [a-f0-9]{16}$/gm) || []).length, 1);
  } finally {
    fixture.cleanup();
  }
});

test("bounded pending recovery skips completed and deferred entries so the 51st indexed entry binds", async () => {
  const fixture = createFixture({ includeEngineSchema: true });
  const targetDate = "2026-06-17";
  const fileRel = `memory/generated-smart-add/${targetDate}.md`;
  const generatedPath = resolve(fixture.memoryDir, "generated-smart-add", `${targetDate}.md`);
  const runtimeOptions = {
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    workspaceDir: fixture.workspaceDir,
    memoryDir: fixture.memoryDir,
    sessionsDir: fixture.sessionsDir,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-17T11:00:00+08:00"),
  };

  try {
    const engine = new Database(fixture.engineDbPath);
    engine.exec(`
      DROP TABLE memory_confidence;
      CREATE TABLE memory_confidence (
        chunk_id TEXT PRIMARY KEY,
        initial_confidence REAL NOT NULL DEFAULT 0.5,
        confidence REAL NOT NULL DEFAULT 0.5,
        last_confidence_update INTEGER,
        base_tau REAL NOT NULL DEFAULT 7,
        hit_count INTEGER NOT NULL DEFAULT 0,
        is_archived INTEGER NOT NULL DEFAULT 0,
        is_protected INTEGER NOT NULL DEFAULT 0,
        conflict_flag INTEGER NOT NULL DEFAULT 0,
        category TEXT NOT NULL DEFAULT 'raw_log',
        kg_data TEXT
      )
    `);
    stableIdentity.ensureStableMemoryIdentityTables(engine, { addConfidenceColumns: true });
    engine.close();

    await checkpoint.withRuntime(runtimeOptions, () => {
      for (let index = 1; index <= 51; index += 1) {
        smartAddWriter.appendSmartAdd(`bulk pending item ${index}`, "preference", {
          generatedAt: "2026-06-17T11:00:00.000+08:00",
          provenance: smartAddWriter.SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED,
        });
      }
    });

    const lines = readFileSync(generatedPath, "utf8").split("\n");
    const headings = lines
      .map((line, index) => line.startsWith("## ") ? index : -1)
      .filter(index => index >= 0);
    assert.equal(headings.length, 51);
    const core = new Database(fixture.coreDbPath);
    core.prepare("DELETE FROM chunks").run();
    const insertCore = core.prepare(
      "INSERT INTO chunks (id, path, text, updated_at, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (let index = 0; index < 50; index += 1) {
      insertCore.run(
        `bulk-indexed-${index + 1}`,
        fileRel,
        `bulk pending item ${index + 1}`,
        1,
        headings[index] + 1,
        headings[index + 1] ?? lines.length - 1,
      );
    }
    core.close();

    await checkpoint.withRuntime(runtimeOptions, () => {
      for (let index = 1; index <= 50; index += 1) {
        const result = confidenceWriter.writeConfidence(
          smartAddWriter.resolveSmartAddEntryId(`bulk pending item ${index}`, "preference", {
            targetDate,
            provenance: smartAddWriter.SMART_ADD_PROVENANCE.CHECKPOINT_GENERATED,
          }),
          `bulk pending item ${index}`,
          "preference",
          { fileRel },
        );
        assert.equal(result.status, "initialized");
      }
    });

    const engineBefore = new Database(fixture.engineDbPath, { readonly: true });
    const before = engineBefore.prepare(`
      SELECT chunk_id, initial_confidence, confidence, last_confidence_update, entity_id
      FROM memory_confidence
      WHERE chunk_id LIKE 'bulk-indexed-%'
      ORDER BY CAST(REPLACE(chunk_id, 'bulk-indexed-', '') AS INTEGER)
    `).all();
    engineBefore.close();
    assert.equal(before.length, 50);

    const coreAfterFirstFifty = new Database(fixture.coreDbPath);
    coreAfterFirstFifty.prepare(
      "INSERT INTO chunks (id, path, text, updated_at, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      "bulk-indexed-51",
      fileRel,
      "bulk pending item 51",
      1,
      headings[50] + 1,
      lines.length - 1,
    );
    coreAfterFirstFifty.close();

    let llmCalls = 0;
    await checkpoint.withRuntime({
      ...runtimeOptions,
      flushCheckpointRawLog: () => ({ ok: true }),
      readCheckpointRawLogs: () => [],
      syncCoreMemoryIndex: completeCoreIndex,
      llmNightlyExtract: async () => {
        llmCalls += 1;
        throw new Error("LLM must not be called for bounded pending recovery");
      },
      repairOrphanVectors: async () => 0,
      resolveConfigConflicts: () => 0,
    }, () => checkpoint.main(["--target-date", targetDate]));

    assert.equal(llmCalls, 0);
    const engineAfter = new Database(fixture.engineDbPath, { readonly: true });
    const after = engineAfter.prepare(`
      SELECT chunk_id, initial_confidence, confidence, last_confidence_update, entity_id
      FROM memory_confidence
      WHERE chunk_id LIKE 'bulk-indexed-%'
      ORDER BY CAST(REPLACE(chunk_id, 'bulk-indexed-', '') AS INTEGER)
    `).all();
    engineAfter.close();
    assert.deepEqual(after.slice(0, 50), before);
    const fiftyFirst = after.find(row => row.chunk_id === "bulk-indexed-51");
    assert.ok(fiftyFirst);
    assert.equal(typeof fiftyFirst.entity_id, "string");
    assert.ok(fiftyFirst.entity_id.length > 0);
    const secondContent = readFileSync(generatedPath, "utf8");
    assert.equal((secondContent.match(/^## [a-f0-9]{16}$/gm) || []).length, 51);
  } finally {
    fixture.cleanup();
  }
});
