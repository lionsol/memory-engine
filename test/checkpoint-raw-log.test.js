import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkpoint = require("../bin/session-checkpoint.js");
const checkpointRawLog = require("../lib/checkpoint/raw-log.js");

function setFileMtime(filePath, isoString) {
  const time = new Date(isoString);
  utimesSync(filePath, time, time);
}

async function withMockedSystemDate(isoString, fn) {
  const RealDate = Date;
  const fixedNow = new RealDate(isoString);

  class MockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(fixedNow);
        return;
      }
      super(...args);
    }

    static now() {
      return fixedNow.getTime();
    }
  }

  globalThis.Date = MockDate;
  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

function createFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-checkpoint-raw-log-"));
  const workspaceDir = resolve(root, "workspace");
  const memoryDir = resolve(root, "memory");
  const smartAddDir = resolve(memoryDir, "smart-add");
  const sessionsDir = resolve(root, "sessions");
  const coreDbPath = resolve(root, "core.sqlite");
  const engineDbPath = resolve(root, "engine.sqlite");

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(smartAddDir, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });

  const coreDb = new Database(coreDbPath);
  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        text TEXT,
        updated_at INTEGER
      )
    `);
    coreDb.prepare("INSERT INTO chunks (id, text, updated_at) VALUES (?, ?, ?)").run(
      "chunk-1",
      "**User:** archived conversation",
      1718587800,
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
    engineDb.prepare("INSERT INTO memory_confidence (chunk_id, category) VALUES (?, ?)").run("chunk-1", "raw_log");
  } finally {
    engineDb.close();
  }

  return {
    workspaceDir,
    memoryDir,
    smartAddDir,
    sessionsDir,
    coreDbPath,
    engineDbPath,
  };
}

test("smart-add yesterday file yields note entries with source note", async () => {
  const fixture = createFixture();
  writeFileSync(resolve(fixture.smartAddDir, "2026-06-17.md"), [
    "# Smart Added Memory",
    "",
    "## note_entry",
    "",
    "Category: raw_log",
    "",
    "note body",
    "",
  ].join("\n"));

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    memoryDir: fixture.memoryDir,
    smartAddDir: fixture.smartAddDir,
    sessionsDir: fixture.sessionsDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T04:00:00.000+08:00"),
  }, async () => {
    const logs = checkpointRawLog.readYesterdayRawLogs();
    assert.equal(logs.some((log) => log.source === "note" && log.text === "note body" && log.category === "raw_log"), true);
  });
});

test("engine DB raw_log rows yield conversation entries", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    memoryDir: fixture.memoryDir,
    smartAddDir: fixture.smartAddDir,
    sessionsDir: fixture.sessionsDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T04:00:00.000+08:00"),
  }, async () => {
    const logs = checkpointRawLog.readYesterdayRawLogs();
    assert.equal(logs.some((log) => log.source === "conversation" && log.text === "**User:** archived conversation" && log.category === "raw_log"), true);
  });
});

test("reset session .jsonl.reset.* files yield conversation entries", async () => {
  const fixture = createFixture();
  const filePath = resolve(fixture.sessionsDir, "session.jsonl.reset.1");
  writeFileSync(filePath, [
    JSON.stringify({ type: "message", message: { role: "user", content: "resume this task" } }),
    JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "I can help" }] } }),
  ].join("\n"));
  setFileMtime(filePath, "2026-06-17T10:00:00.000+08:00");

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    memoryDir: fixture.memoryDir,
    smartAddDir: fixture.smartAddDir,
    sessionsDir: fixture.sessionsDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T04:00:00.000+08:00"),
  }, async () => {
    await withMockedSystemDate("2026-06-18T04:00:00.000+08:00", async () => {
      const logs = checkpointRawLog.readYesterdayRawLogs();
      assert.equal(logs.some((log) => log.text === "**User:** resume this task" && log.source === "conversation"), true);
      assert.equal(logs.some((log) => log.text === "**Assistant:** I can help" && log.source === "conversation"), true);
    });
  });
});

test("stale .jsonl without reset counterpart is scanned for ended sessions", async () => {
  const fixture = createFixture();
  const filePath = resolve(fixture.sessionsDir, "session.jsonl");
  writeFileSync(filePath, JSON.stringify({
    type: "message",
    message: { role: "user", content: "ended without reset" },
  }));
  setFileMtime(filePath, "2026-06-17T12:00:00.000+08:00");

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    memoryDir: fixture.memoryDir,
    smartAddDir: fixture.smartAddDir,
    sessionsDir: fixture.sessionsDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T04:00:00.000+08:00"),
  }, async () => {
    await withMockedSystemDate("2026-06-18T04:00:00.000+08:00", async () => {
      const logs = checkpointRawLog.readYesterdayRawLogs();
      assert.equal(logs.some((log) => log.text === "**User:** ended without reset" && log.source === "conversation"), true);
    });
  });
});

test(".reset.* uses file mtime filter and skips old history", async () => {
  const fixture = createFixture();
  const recentResetPath = resolve(fixture.sessionsDir, "recent.jsonl.reset.1");
  const oldResetPath = resolve(fixture.sessionsDir, "old.jsonl.reset.9");

  writeFileSync(recentResetPath, JSON.stringify({
    type: "message",
    message: { role: "user", content: "recent reset session" },
  }));
  writeFileSync(oldResetPath, JSON.stringify({
    type: "message",
    message: { role: "user", content: "historical reset session" },
  }));
  setFileMtime(recentResetPath, "2026-06-17T09:00:00.000+08:00");
  setFileMtime(oldResetPath, "2026-06-15T09:00:00.000+08:00");

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    memoryDir: fixture.memoryDir,
    smartAddDir: fixture.smartAddDir,
    sessionsDir: fixture.sessionsDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T04:00:00.000+08:00"),
  }, async () => {
    await withMockedSystemDate("2026-06-18T04:00:00.000+08:00", async () => {
      const logs = checkpointRawLog.readYesterdayRawLogs();
      assert.equal(logs.some((log) => log.text === "**User:** recent reset session"), true);
      assert.equal(logs.some((log) => log.text === "**User:** historical reset session"), false);
    });
  });
});

test(".jsonl with matching .reset.* is not scanned twice", async () => {
  const fixture = createFixture();
  const jsonlPath = resolve(fixture.sessionsDir, "dedupe-session.jsonl");
  const resetPath = resolve(fixture.sessionsDir, "dedupe-session.jsonl.reset.2");

  writeFileSync(jsonlPath, JSON.stringify({
    type: "message",
    message: { role: "user", content: "should come only from reset" },
  }));
  writeFileSync(resetPath, JSON.stringify({
    type: "message",
    message: { role: "user", content: "reset version wins" },
  }));
  setFileMtime(jsonlPath, "2026-06-17T08:00:00.000+08:00");
  setFileMtime(resetPath, "2026-06-17T08:30:00.000+08:00");

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    memoryDir: fixture.memoryDir,
    smartAddDir: fixture.smartAddDir,
    sessionsDir: fixture.sessionsDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T04:00:00.000+08:00"),
  }, async () => {
    await withMockedSystemDate("2026-06-18T04:00:00.000+08:00", async () => {
      const logs = checkpointRawLog.readYesterdayRawLogs();
      assert.equal(logs.some((log) => log.text === "**User:** reset version wins"), true);
      assert.equal(logs.some((log) => log.text === "**User:** should come only from reset"), false);
    });
  });
});

test("trajectory files are excluded from checkpoint session scan", async () => {
  const fixture = createFixture();
  const trajectoryPath = resolve(fixture.sessionsDir, "session.trajectory.1.jsonl");

  writeFileSync(trajectoryPath, JSON.stringify({
    type: "message",
    message: { role: "user", content: "trajectory should be ignored" },
  }));
  setFileMtime(trajectoryPath, "2026-06-17T11:00:00.000+08:00");

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    memoryDir: fixture.memoryDir,
    smartAddDir: fixture.smartAddDir,
    sessionsDir: fixture.sessionsDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T04:00:00.000+08:00"),
  }, async () => {
    await withMockedSystemDate("2026-06-18T04:00:00.000+08:00", async () => {
      const logs = checkpointRawLog.readYesterdayRawLogs();
      assert.equal(logs.some((log) => log.text === "**User:** trajectory should be ignored"), false);
    });
  });
});

test("DB read failure logs warning and loader still returns other sources", async () => {
  const fixture = createFixture();
  writeFileSync(resolve(fixture.smartAddDir, "2026-06-17.md"), [
    "# Smart Added Memory",
    "",
    "## note_entry",
    "",
    "Category: raw_log",
    "",
    "note body survives db warning",
    "",
  ].join("\n"));

  const badEngineDbPath = resolve(fixture.workspaceDir, "bad-engine.sqlite");
  const badEngineDb = new Database(badEngineDbPath);
  badEngineDb.close();

  const errors = [];
  const prevError = console.error;
  console.error = (...args) => {
    errors.push(args.map((arg) => String(arg)).join(" "));
  };

  try {
    await checkpoint.withRuntime({
      workspaceDir: fixture.workspaceDir,
      memoryDir: fixture.memoryDir,
      smartAddDir: fixture.smartAddDir,
      sessionsDir: fixture.sessionsDir,
      coreDbPath: fixture.coreDbPath,
      engineDbPath: badEngineDbPath,
      timeZone: "Asia/Shanghai",
      now: () => Date.parse("2026-06-18T04:00:00.000+08:00"),
    }, async () => {
      const logs = checkpointRawLog.readYesterdayRawLogs();
      assert.equal(logs.some((log) => log.text === "note body survives db warning" && log.source === "note"), true);
    });
  } finally {
    console.error = prevError;
  }

  assert.equal(errors.some((line) => line.includes("[checkpoint] DB read warning:")), true);
});
