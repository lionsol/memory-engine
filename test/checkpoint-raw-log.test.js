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

  return {
    workspaceDir,
    memoryDir,
    smartAddDir,
    sessionsDir,
    coreDbPath,
    engineDbPath,
  };
}

function insertRawLogChunk(fixture, { id, text, updatedAt, category = "raw_log" }) {
  const coreDb = new Database(fixture.coreDbPath);
  const engineDb = new Database(fixture.engineDbPath);
  try {
    coreDb.prepare("INSERT INTO chunks (id, text, updated_at) VALUES (?, ?, ?)").run(id, text, updatedAt);
    engineDb.prepare("INSERT INTO memory_confidence (chunk_id, category) VALUES (?, ?)").run(id, category);
  } finally {
    coreDb.close();
    engineDb.close();
  }
}

function writeSessionFile(fixture, fileName, records, mtimeIso) {
  const filePath = resolve(fixture.sessionsDir, fileName);
  writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join("\n"));
  setFileMtime(filePath, mtimeIso);
  return filePath;
}

function getLogsForTargetDate(fixture, targetDate, options = {}) {
  return checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    memoryDir: fixture.memoryDir,
    smartAddDir: fixture.smartAddDir,
    sessionsDir: fixture.sessionsDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-23T04:00:00.000+08:00"),
  }, async () => checkpointRawLog.readCheckpointRawLogs({
    targetDate,
    timeZone: "Asia/Shanghai",
    ...(options || {}),
  }));
}

test("readCheckpointRawLogs reads only the explicit targetDate smart-add file", async () => {
  const fixture = createFixture();
  writeFileSync(resolve(fixture.smartAddDir, "2026-06-17.md"), [
    "# Smart Added Memory",
    "",
    "## target_entry",
    "",
    "Category: raw_log",
    "",
    "target date note",
    "",
  ].join("\n"));
  writeFileSync(resolve(fixture.smartAddDir, "2026-06-18.md"), [
    "# Smart Added Memory",
    "",
    "## other_entry",
    "",
    "Category: raw_log",
    "",
    "other day note",
    "",
  ].join("\n"));

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  assert.equal(logs.some((log) => log.source === "note" && log.text === "target date note"), true);
  assert.equal(logs.some((log) => log.text === "other day note"), false);
});

test("DB raw_log entries outside targetDate are excluded and kept in chronological order", async () => {
  const fixture = createFixture();
  insertRawLogChunk(fixture, {
    id: "chunk-old",
    text: "**User:** previous day",
    updatedAt: Date.parse("2026-06-16T23:10:00.000+08:00") / 1000,
  });
  insertRawLogChunk(fixture, {
    id: "chunk-a",
    text: "**User:** first on target day",
    updatedAt: Date.parse("2026-06-17T08:00:00.000+08:00") / 1000,
  });
  insertRawLogChunk(fixture, {
    id: "chunk-b",
    text: "**Assistant:** second on target day",
    updatedAt: Date.parse("2026-06-17T09:00:00.000+08:00") / 1000,
  });
  insertRawLogChunk(fixture, {
    id: "chunk-new",
    text: "**User:** next day",
    updatedAt: Date.parse("2026-06-18T00:05:00.000+08:00") / 1000,
  });

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const conversationTexts = logs.filter((log) => log.source === "conversation").map((log) => log.text);
  assert.deepEqual(conversationTexts, [
    "**User:** first on target day",
    "**Assistant:** second on target day",
  ]);
});

test("timestamp-prefixed **User:** DB raw_log is classified as user", async () => {
  const fixture = createFixture();
  insertRawLogChunk(fixture, {
    id: "chunk-meta-user",
    text: "[2026-06-17T08:00:00.000Z | session:abc] **User:** prefixed user message",
    updatedAt: Date.parse("2026-06-17T08:00:00.000+08:00") / 1000,
  });

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  assert.equal(logs.some((log) => log.text.includes("prefixed user message")), true);
  assert.equal(stats.charsByRoleAfterBudget.user > 0, true);
  assert.equal(stats.charsByRoleAfterBudget.metadata_header, 0);
});

test("timestamp-prefixed **Assistant:** DB raw_log is classified as assistant", async () => {
  const fixture = createFixture();
  insertRawLogChunk(fixture, {
    id: "chunk-meta-assistant",
    text: "[2026-06-17T09:00:00.000Z | session:def] **Assistant:** prefixed assistant message",
    updatedAt: Date.parse("2026-06-17T09:00:00.000+08:00") / 1000,
  });

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  assert.equal(logs.some((log) => log.text.includes("prefixed assistant message")), true);
  assert.equal(stats.charsByRoleAfterBudget.assistant > 0, true);
  assert.equal(stats.charsByRoleAfterBudget.metadata_header, 0);
});

test("bare DB raw_log text without role evidence remains metadata_header", async () => {
  const fixture = createFixture();
  insertRawLogChunk(fixture, {
    id: "chunk-bare",
    text: "system marker without explicit speaker",
    updatedAt: Date.parse("2026-06-17T10:00:00.000+08:00") / 1000,
  });

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  assert.equal(logs.some((log) => log.text.includes("system marker without explicit speaker")), true);
  assert.equal(stats.charsByRoleAfterBudget.metadata_header > 0, true);
  assert.equal(stats.charsByRoleAfterBudget.user, 0);
});

test("long episode-like DB raw_log text is not misclassified as user", async () => {
  const fixture = createFixture();
  insertRawLogChunk(fixture, {
    id: "chunk-episode-like",
    text: "Summary for the day: investigated boundary bugs, reviewed configs, coordinated next steps, and documented the result in detail without any explicit speaker prefix.",
    updatedAt: Date.parse("2026-06-17T11:00:00.000+08:00") / 1000,
  });

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  assert.equal(logs.some((log) => log.text.includes("Summary for the day")), true);
  assert.equal(stats.charsByRoleAfterBudget.user, 0);
  assert.equal(stats.charsByRoleAfterBudget.metadata_header > 0, true);
});

test("reset transcript files outside targetDate are excluded", async () => {
  const fixture = createFixture();
  writeSessionFile(fixture, "target.jsonl.reset.1", [
    { type: "message", message: { role: "user", content: "target day dialogue" } },
  ], "2026-06-17T09:00:00.000+08:00");
  writeSessionFile(fixture, "old.jsonl.reset.1", [
    { type: "message", message: { role: "user", content: "historical dialogue" } },
  ], "2026-06-10T09:00:00.000+08:00");

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  assert.equal(logs.some((log) => log.text.includes("target day dialogue")), true);
  assert.equal(logs.some((log) => log.text.includes("historical dialogue")), false);
  assert.equal(checkpointRawLog.getRawLogCollectionStats(logs).skippedResetFileCount >= 1, true);
});

test("toolResult records are dropped and target-date user-assistant dialogue is retained", async () => {
  const fixture = createFixture();
  writeSessionFile(fixture, "session.jsonl.reset.2", [
    { type: "message", message: { role: "user", content: "please inspect the bug" }, timestamp: "2026-06-17T10:00:00.000+08:00" },
    { type: "toolResult", output: "VERY LARGE TOOL OUTPUT ".repeat(200) },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "I found the boundary issue." }] }, timestamp: "2026-06-17T10:05:00.000+08:00" },
  ], "2026-06-17T10:05:00.000+08:00");

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const combinedText = logs.map((log) => log.text).join("\n");
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  assert.equal(combinedText.includes("please inspect the bug"), true);
  assert.equal(combinedText.includes("I found the boundary issue."), true);
  assert.equal(combinedText.includes("VERY LARGE TOOL OUTPUT"), false);
  assert.equal(stats.droppedToolResultCount, 1);
});

test("compact test summary is retained while full tool output is absent", async () => {
  const fixture = createFixture();
  writeSessionFile(fixture, "tests.jsonl.reset.2", [
    {
      type: "toolResult",
      toolName: "node --test",
      command: "find test -name '*.test.js' -print0 | xargs -0 node --test",
      output: [
        "TAP version 13",
        "ok 1 - alpha",
        "ok 2 - beta",
        "not ok 3 - gamma",
        "# pass 2",
        "# fail 1",
        "# duration_ms 1234.5",
      ].join("\n"),
      timestamp: "2026-06-17T10:01:00.000+08:00",
    },
  ], "2026-06-17T10:01:00.000+08:00");

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const combinedText = logs.map((log) => log.text).join("\n");
  assert.equal(combinedText.includes("Tool summary: tests pass=3") || combinedText.includes("Tool summary: tests pass=2"), true);
  assert.equal(combinedText.includes("duration_ms=1234.5"), true);
  assert.equal(combinedText.includes("TAP version 13"), false);
  assert.equal(combinedText.includes("ok 1 - alpha"), false);
});

test("compact doctor summary is retained", async () => {
  const fixture = createFixture();
  writeSessionFile(fixture, "doctor.jsonl.reset.2", [
    {
      type: "tool_result",
      tool_name: "doctor",
      command: "openclaw doctor",
      output: [
        "WARNING: config path missing",
        "ERROR: memory db locked",
        "WARNING: stale session file",
      ].join("\n"),
      timestamp: "2026-06-17T10:02:00.000+08:00",
    },
  ], "2026-06-17T10:02:00.000+08:00");

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const combinedText = logs.map((log) => log.text).join("\n");
  assert.equal(combinedText.includes("Tool summary: doctor warnings=2, errors=1"), true);
  assert.equal(combinedText.includes("config path missing"), true);
  assert.equal(combinedText.includes("memory db locked"), true);
});

test("large config file style tool output is dropped", async () => {
  const fixture = createFixture();
  writeSessionFile(fixture, "config-cat.jsonl.reset.2", [
    {
      type: "toolOutput",
      toolName: "cat",
      command: "cat ~/.openclaw/openclaw.json",
      output: "{\n" + "\"k\":\"v\",\n".repeat(5000) + "}",
      timestamp: "2026-06-17T10:03:00.000+08:00",
    },
    { type: "message", message: { role: "user", content: "config dump should not pollute summary" }, timestamp: "2026-06-17T10:04:00.000+08:00" },
  ], "2026-06-17T10:04:00.000+08:00");

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const combinedText = logs.map((log) => log.text).join("\n");
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  assert.equal(combinedText.includes("\"k\":\"v\""), false);
  assert.equal(combinedText.includes("config dump should not pollute summary"), true);
  assert.equal(stats.droppedNoise.toolSummaryDropped >= 1, true);
});

test("duplicate DB raw_log and reset transcript dialogue is included only once", async () => {
  const fixture = createFixture();
  insertRawLogChunk(fixture, {
    id: "chunk-dup",
    text: "**User:** investigate checkpoint leak",
    updatedAt: Date.parse("2026-06-17T11:00:00.000+08:00") / 1000,
  });
  writeSessionFile(fixture, "duplicate.jsonl.reset.5", [
    { type: "message", message: { role: "user", content: "investigate checkpoint leak" }, timestamp: "2026-06-17T11:00:00.000+08:00" },
  ], "2026-06-17T11:00:00.000+08:00");

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const matching = logs.filter((log) => log.text.includes("investigate checkpoint leak"));
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  assert.equal(matching.length, 1);
  assert.equal(matching[0].text.includes("session:duplicate"), true);
  assert.equal(stats.droppedDuplicateCount, 1);
});

test("large tool output does not dominate final combinedText", async () => {
  const fixture = createFixture();
  writeSessionFile(fixture, "large-output.jsonl.reset.9", [
    { type: "message", message: { role: "user", content: "summarize the failed run" }, timestamp: "2026-06-17T14:00:00.000+08:00" },
    { type: "tool_output", output: "x".repeat(50000) },
    { type: "message", message: { role: "assistant", content: "The failing run was caused by cross-day transcript bleed." }, timestamp: "2026-06-17T14:05:00.000+08:00" },
  ], "2026-06-17T14:05:00.000+08:00");

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  assert.equal(stats.finalCombinedTextCharCount < 5000, true);
  assert.equal(logs.some((log) => log.text.includes("cross-day transcript bleed")), true);
});

test("budget defaults are exposed and applied to final combined text", async () => {
  assert.deepEqual(checkpointRawLog.DEFAULT_BUDGETS, {
    maxFinalCombinedChars: 40000,
    smartAddChars: 16000,
    conversationChars: 24000,
    perSessionChars: 8000,
    toolSummaryChars: 4000,
  });

  const fixture = createFixture();
  writeSessionFile(fixture, "budget-default.jsonl.reset.1", [
    { type: "message", message: { role: "user", content: "u".repeat(50000) }, timestamp: "2026-06-17T09:00:00.000+08:00" },
  ], "2026-06-17T09:00:00.000+08:00");

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  assert.equal(stats.finalCombinedTextCharCount <= checkpointRawLog.DEFAULT_BUDGETS.maxFinalCombinedChars, true);
  assert.equal(stats.budgetApplied, true);
});

test("huge same-day reset transcript is capped and stats report budget application", async () => {
  const fixture = createFixture();
  writeSessionFile(fixture, "huge-session.jsonl.reset.7", [
    { type: "message", message: { role: "user", content: "user prompt " + "a".repeat(18000) }, timestamp: "2026-06-17T09:00:00.000+08:00" },
    { type: "message", message: { role: "assistant", content: "assistant follow-up " + "b".repeat(18000) }, timestamp: "2026-06-17T09:05:00.000+08:00" },
    { type: "message", message: { role: "assistant", content: "summary: capped transcript retained" }, timestamp: "2026-06-17T09:10:00.000+08:00" },
  ], "2026-06-17T09:10:00.000+08:00");

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", {
    budgets: {
      maxFinalCombinedChars: 800,
      smartAddChars: 200,
      conversationChars: 800,
      perSessionChars: 500,
    },
  });
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  assert.equal(stats.budgetApplied, true);
  assert.equal(stats.droppedByBudgetCount >= 1, true);
  assert.equal(stats.charsBeforeBudget > stats.charsAfterBudget, true);
  assert.equal(stats.finalCombinedTextCharCount <= 800, true);
});

test("tool summaries cannot exceed their own budget", async () => {
  const fixture = createFixture();
  writeSessionFile(fixture, "tool-budget.jsonl.reset.5", [
    {
      type: "toolResult",
      toolName: "doctor",
      command: "openclaw doctor",
      output: [
        "WARNING: alpha issue",
        "WARNING: beta issue",
        "ERROR: gamma issue",
      ].join("\n"),
      timestamp: "2026-06-17T12:00:00.000+08:00",
    },
    {
      type: "toolResult",
      toolName: "git",
      command: "git status --short && git branch --show-current",
      output: [
        "## feature/checkpoint",
        " M bin/session-checkpoint.js",
        " M lib/checkpoint/raw-log.js",
      ].join("\n"),
      timestamp: "2026-06-17T12:01:00.000+08:00",
    },
    { type: "message", message: { role: "user", content: "preserve this user request" }, timestamp: "2026-06-17T12:02:00.000+08:00" },
  ], "2026-06-17T12:02:00.000+08:00");

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", {
    budgets: {
      maxFinalCombinedChars: 500,
      smartAddChars: 100,
      conversationChars: 500,
      perSessionChars: 500,
      toolSummaryChars: 120,
    },
  });
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  const combinedText = logs.map((log) => log.text).join("\n");
  assert.equal(combinedText.includes("preserve this user request"), true);
  assert.equal(stats.charsByRoleAfterBudget.assistant_tool_summary <= 120, true);
});

test("smart-add tagged lines are preserved under budget pressure", async () => {
  const fixture = createFixture();
  writeFileSync(resolve(fixture.smartAddDir, "2026-06-17.md"), [
    "# Smart Added Memory",
    "",
    "## pref_entry",
    "",
    "Category: preference",
    "",
    "Decision: keep strict checkpoint boundaries.",
    "",
  ].join("\n"));
  writeSessionFile(fixture, "pressure.jsonl.reset.1", [
    { type: "message", message: { role: "assistant", content: "assistant chatter ".repeat(200) }, timestamp: "2026-06-17T10:00:00.000+08:00" },
    { type: "message", message: { role: "assistant", content: "assistant chatter 2 ".repeat(200) }, timestamp: "2026-06-17T10:05:00.000+08:00" },
  ], "2026-06-17T10:05:00.000+08:00");

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", {
    budgets: {
      maxFinalCombinedChars: 500,
      smartAddChars: 200,
      conversationChars: 400,
      perSessionChars: 400,
    },
  });
  assert.equal(logs.some((log) => log.source === "note" && log.text.includes("strict checkpoint boundaries")), true);
});

test("user messages outrank assistant chatter under budget pressure", async () => {
  const fixture = createFixture();
  writeSessionFile(fixture, "priority.jsonl.reset.4", [
    { type: "message", message: { role: "assistant", content: "assistant chatter ".repeat(250) }, timestamp: "2026-06-17T11:00:00.000+08:00" },
    { type: "message", message: { role: "user", content: "user asks for the root cause" }, timestamp: "2026-06-17T11:05:00.000+08:00" },
    { type: "message", message: { role: "assistant", content: "another assistant chatter ".repeat(250) }, timestamp: "2026-06-17T11:10:00.000+08:00" },
  ], "2026-06-17T11:10:00.000+08:00");

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", {
    budgets: {
      maxFinalCombinedChars: 450,
      smartAddChars: 100,
      conversationChars: 450,
      perSessionChars: 450,
    },
  });
  const combinedText = logs.map((log) => log.text).join("\n");
  assert.equal(combinedText.includes("user asks for the root cause"), true);
});

test("readCheckpointRawLogs honors embedded timestamps when reset file mtime is adjacent to targetDate", async () => {
  const fixture = createFixture();
  writeSessionFile(fixture, "boundary.jsonl.reset.3", [
    { type: "message", message: { role: "user", content: "late-night target work" }, timestamp: "2026-06-17T23:55:00.000+08:00" },
    { type: "message", message: { role: "assistant", content: "captured from reset transcript" }, timestamp: "2026-06-17T23:56:00.000+08:00" },
  ], "2026-06-18T00:10:00.000+08:00");

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  assert.equal(logs.some((log) => log.text.includes("late-night target work")), true);
  assert.equal(logs.some((log) => log.text.includes("captured from reset transcript")), true);
});

test("trajectory files are excluded from checkpoint session scan", async () => {
  const fixture = createFixture();
  writeSessionFile(fixture, "session.trajectory.1.jsonl", [
    { type: "message", message: { role: "user", content: "trajectory should be ignored" } },
  ], "2026-06-17T11:00:00.000+08:00");

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  assert.equal(logs.some((log) => log.text.includes("trajectory should be ignored")), false);
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
    const logs = await checkpoint.withRuntime({
      workspaceDir: fixture.workspaceDir,
      memoryDir: fixture.memoryDir,
      smartAddDir: fixture.smartAddDir,
      sessionsDir: fixture.sessionsDir,
      coreDbPath: fixture.coreDbPath,
      engineDbPath: badEngineDbPath,
      timeZone: "Asia/Shanghai",
      now: () => Date.parse("2026-06-23T04:00:00.000+08:00"),
    }, async () => checkpointRawLog.readCheckpointRawLogs({ targetDate: "2026-06-17", timeZone: "Asia/Shanghai" }));
    assert.equal(logs.some((log) => log.text === "note body survives db warning" && log.source === "note"), true);
  } finally {
    console.error = prevError;
  }

  assert.equal(errors.some((line) => line.includes("[checkpoint] DB read warning:")), true);
});

test("parseCliArgs supports explicit targetDate semantics", async () => {
  assert.deepEqual(checkpoint.parseCliArgs(["--dry-run", "--target-date", "2026-06-22"]), {
    dryRun: true,
    targetDate: "2026-06-22",
  });
});
