import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
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

function createFixture(options = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-checkpoint-raw-log-"));
  const workspaceDir = resolve(root, "workspace");
  const memoryDir = resolve(root, "memory");
  const smartAddDir = resolve(memoryDir, "smart-add");
  const sessionsDir = resolve(root, "sessions");
  const coreDbPath = resolve(root, "core.sqlite");
  const engineDbPath = resolve(root, "engine.sqlite");
  const includeEventAt = options.includeEventAt !== false;
  const includeCreatedAt = options.includeCreatedAt !== false;

  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(smartAddDir, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });

  const coreDb = new Database(coreDbPath);
  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        text TEXT${includeEventAt ? ",\n        event_at INTEGER" : ""}${includeCreatedAt ? ",\n        created_at INTEGER" : ""},
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

function insertRawLogChunk(fixture, { id, text, updatedAt, eventAt = updatedAt, createdAt = updatedAt, category = "raw_log" }) {
  const coreDb = new Database(fixture.coreDbPath);
  const engineDb = new Database(fixture.engineDbPath);
  try {
    const columns = new Set(coreDb.prepare("PRAGMA table_info(chunks)").all().map((row) => String(row.name || "")));
    const insertColumns = ["id", "text"];
    const values = [id, text];
    if (columns.has("event_at")) {
      insertColumns.push("event_at");
      values.push(eventAt);
    }
    if (columns.has("created_at")) {
      insertColumns.push("created_at");
      values.push(createdAt);
    }
    if (columns.has("updated_at")) {
      insertColumns.push("updated_at");
      values.push(updatedAt);
    }
    const placeholders = insertColumns.map(() => "?").join(", ");
    coreDb.prepare(`INSERT INTO chunks (${insertColumns.join(", ")}) VALUES (${placeholders})`).run(...values);
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
    "Provenance: manual",
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
    "Provenance: manual",
    "",
    "other day note",
    "",
  ].join("\n"));

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", { resetDirectParseEnabled: true });
  assert.equal(logs.some((log) => log.source === "note" && log.text === "target date note"), true);
  assert.equal(logs.some((log) => log.text === "other day note"), false);
});

test("checkpoint skips smart-add entries with unknown provenance", async () => {
  const fixture = createFixture();
  writeFileSync(resolve(fixture.smartAddDir, "2026-06-17.md"), [
    "# Smart Added Memory",
    "",
    "## legacy_entry",
    "",
    "Category: raw_log",
    "",
    "legacy note without provenance",
    "",
  ].join("\n"));

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  assert.equal(logs.some((log) => log.text.includes("legacy note without provenance")), false);
  assert.equal(stats.smartAddIncluded, 0);
  assert.equal(stats.smartAddSkippedUnknownProvenance, 1);
});

test("checkpoint skips checkpoint_generated smart-add entries in input pool", async () => {
  const fixture = createFixture();
  writeFileSync(resolve(fixture.smartAddDir, "2026-06-17.md"), [
    "# Smart Added Memory",
    "",
    "## generated_entry",
    "",
    "Category: episodic",
    "Provenance: checkpoint_generated",
    "",
    "wrongly generated checkpoint residue",
    "",
  ].join("\n"));

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  assert.equal(logs.some((log) => log.text.includes("wrongly generated checkpoint residue")), false);
  assert.equal(stats.smartAddIncluded, 0);
  assert.equal(stats.smartAddSkippedCheckpointGenerated, 1);
});

test("checkpoint includes manual and agent_smart_add smart-add entries", async () => {
  const fixture = createFixture();
  writeFileSync(resolve(fixture.smartAddDir, "2026-06-17.md"), [
    "# Smart Added Memory",
    "",
    "## manual_entry",
    "",
    "Category: preference",
    "Provenance: manual",
    "",
    "manual trusted fact",
    "",
    "## agent_entry",
    "",
    "Category: raw_log",
    "Provenance: agent_smart_add",
    "",
    "agent trusted fact",
    "",
  ].join("\n"));

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  assert.equal(logs.some((log) => log.text.includes("manual trusted fact")), true);
  assert.equal(logs.some((log) => log.text.includes("agent trusted fact")), true);
  assert.equal(stats.smartAddIncluded, 2);
  assert.equal(stats.smartAddSkippedUnknownProvenance, 0);
  assert.equal(stats.smartAddSkippedCheckpointGenerated, 0);
});

test("pollution chain replay: checkpoint_generated residue is not promoted into next checkpoint evidence", async () => {
  const fixture = createFixture();
  writeFileSync(resolve(fixture.smartAddDir, "2026-06-25.md"), [
    "# Smart Added Memory",
    "",
    "## polluted_entry",
    "",
    "Category: episodic",
    "Provenance: checkpoint_generated",
    "",
    "2026-06-10 opencode env prefix fix happened here",
    "",
  ].join("\n"));
  insertRawLogChunk(fixture, {
    id: "target-day-conv",
    text: "**User:** summarize only today's real work",
    updatedAt: Date.parse("2026-06-25T12:00:00.000+08:00") / 1000,
  });

  const logs = await getLogsForTargetDate(fixture, "2026-06-25");
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  const combinedText = logs.map((log) => log.text).join("\n");
  assert.equal(combinedText.includes("2026-06-10 opencode env prefix fix"), false);
  assert.equal(combinedText.includes("summarize only today's real work"), true);
  assert.equal(stats.smartAddSkippedCheckpointGenerated, 1);
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

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", { resetDirectParseEnabled: true });
  const conversationTexts = logs.filter((log) => log.source === "conversation").map((log) => log.text);
  assert.deepEqual(conversationTexts, [
    "**User:** first on target day",
    "**Assistant:** second on target day",
  ]);
});

test("DB raw_log date filter prefers event_at over later updated_at", async () => {
  const fixture = createFixture();
  insertRawLogChunk(fixture, {
    id: "chunk-old-reflushed",
    text: "**User:** old conversation reflushed today should be excluded",
    eventAt: Date.parse("2026-06-10T09:00:00.000+08:00") / 1000,
    createdAt: Date.parse("2026-06-17T09:00:00.000+08:00") / 1000,
    updatedAt: Date.parse("2026-06-17T09:00:00.000+08:00") / 1000,
  });
  insertRawLogChunk(fixture, {
    id: "chunk-real-target",
    text: "**User:** real target-day conversation should be included",
    eventAt: Date.parse("2026-06-17T10:00:00.000+08:00") / 1000,
    createdAt: Date.parse("2026-06-18T10:00:00.000+08:00") / 1000,
    updatedAt: Date.parse("2026-06-18T10:00:00.000+08:00") / 1000,
  });

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  const conversationTexts = logs.filter((log) => log.source === "conversation").map((log) => log.text);
  assert.deepEqual(conversationTexts, ["**User:** real target-day conversation should be included"]);
  assert.equal(stats.rawLogTimeBasis, "event_at");
  assert.match(stats.evidenceDateFilter, /raw_log=event_at bounded to targetDate/);
});

test("DB raw_log with NULL event_at does not fall back to updated_at", async () => {
  const fixture = createFixture();
  insertRawLogChunk(fixture, {
    id: "chunk-null-event-at",
    text: "**User:** null event_at with target-day updated_at should be excluded",
    eventAt: null,
    createdAt: Date.parse("2026-06-17T09:00:00.000+08:00") / 1000,
    updatedAt: Date.parse("2026-06-17T09:00:00.000+08:00") / 1000,
  });

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  const conversationTexts = logs.filter((log) => log.source === "conversation").map((log) => log.text);
  assert.deepEqual(conversationTexts, []);
  assert.equal(stats.rawLogTimeBasis, "event_at");
  assert.equal(stats.rawLogMissingEventAt, 1);
});

test("legacy DB raw_log without event_at still falls back to updated_at_event_time", async () => {
  const fixture = createFixture({ includeEventAt: false, includeCreatedAt: false });
  insertRawLogChunk(fixture, {
    id: "chunk-legacy-target",
    text: "**User:** legacy updated_at event time should be included",
    updatedAt: Date.parse("2026-06-17T09:00:00.000+08:00") / 1000,
  });

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  const conversationTexts = logs.filter((log) => log.source === "conversation").map((log) => log.text);
  assert.deepEqual(conversationTexts, ["**User:** legacy updated_at event time should be included"]);
  assert.equal(stats.rawLogTimeBasis, "updated_at_event_time");
});

test("legacy DB raw_log without event_at and with created_at prefers created_at legacy event time", async () => {
  const fixture = createFixture({ includeEventAt: false, includeCreatedAt: true });
  insertRawLogChunk(fixture, {
    id: "chunk-created-target",
    text: "**User:** created_at legacy event time should be included",
    createdAt: Date.parse("2026-06-17T09:00:00.000+08:00") / 1000,
    updatedAt: Date.parse("2026-06-18T09:00:00.000+08:00") / 1000,
  });

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  const conversationTexts = logs.filter((log) => log.source === "conversation").map((log) => log.text);
  assert.deepEqual(conversationTexts, ["**User:** created_at legacy event time should be included"]);
  assert.equal(stats.rawLogTimeBasis, "created_at_legacy_event_time");
});

test("timezone-aware boundary includes start and excludes end for Asia/Shanghai targetDate", async () => {
  const fixture = createFixture();
  insertRawLogChunk(fixture, {
    id: "chunk-at-start",
    text: "**User:** included at exact targetDate start",
    updatedAt: Date.parse("2026-06-16T16:00:00.000Z") / 1000,
  });
  insertRawLogChunk(fixture, {
    id: "chunk-before-start",
    text: "**User:** excluded before targetDate start",
    updatedAt: Date.parse("2026-06-16T15:59:59.999Z") / 1000,
  });
  insertRawLogChunk(fixture, {
    id: "chunk-at-end",
    text: "**User:** excluded at exact targetDate end",
    updatedAt: Date.parse("2026-06-17T16:00:00.000Z") / 1000,
  });

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const conversationTexts = logs.filter((log) => log.source === "conversation").map((log) => log.text);

  assert.deepEqual(conversationTexts, [
    "**User:** included at exact targetDate start",
  ]);
});

test("DB raw_log keeps stable ordering by normalized timestamp then chunk id", async () => {
  const fixture = createFixture();
  insertRawLogChunk(fixture, {
    id: "b-id",
    text: "**User:** b",
    updatedAt: Date.parse("2026-06-17T09:00:00.000+08:00") / 1000,
  });
  insertRawLogChunk(fixture, {
    id: "a-id",
    text: "**User:** a",
    updatedAt: Date.parse("2026-06-17T09:00:00.000+08:00") / 1000,
  });

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const conversationIds = logs.filter((log) => log.source === "conversation").map((log) => log.chunk_id);
  assert.deepEqual(conversationIds, ["a-id", "b-id"]);
});

test("DB raw_log mixed second and millisecond timestamps are normalized and ordered by real time", async () => {
  const fixture = createFixture();
  insertRawLogChunk(fixture, {
    id: "sec-row",
    text: "**User:** second timestamp first",
    updatedAt: Date.parse("2026-06-17T09:00:00.000+08:00") / 1000,
  });
  insertRawLogChunk(fixture, {
    id: "ms-row",
    text: "**User:** millisecond timestamp second",
    updatedAt: Date.parse("2026-06-17T09:05:00.000+08:00"),
  });

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const conversationIds = logs.filter((log) => log.source === "conversation").map((log) => log.chunk_id);
  assert.deepEqual(conversationIds, ["sec-row", "ms-row"]);
});

test("engine category filtering preserves core order after application-side filtering", async () => {
  const fixture = createFixture();
  insertRawLogChunk(fixture, {
    id: "A",
    text: "**User:** A",
    updatedAt: Date.parse("2026-06-17T08:00:00.000+08:00") / 1000,
    category: "project",
  });
  insertRawLogChunk(fixture, {
    id: "B",
    text: "**User:** B",
    updatedAt: Date.parse("2026-06-17T09:00:00.000+08:00") / 1000,
    category: "raw_log",
  });
  insertRawLogChunk(fixture, {
    id: "C",
    text: "**User:** C",
    updatedAt: Date.parse("2026-06-17T10:00:00.000+08:00") / 1000,
    category: "project",
  });
  insertRawLogChunk(fixture, {
    id: "D",
    text: "**User:** D",
    updatedAt: Date.parse("2026-06-17T11:00:00.000+08:00") / 1000,
    category: "raw_log",
  });

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const conversationIds = logs.filter((log) => log.source === "conversation").map((log) => log.chunk_id);
  assert.deepEqual(conversationIds, ["B", "D"]);
});

test("empty core returns no DB raw_log rows and avoids invalid IN clauses", async () => {
  const fixture = createFixture();
  const engineDb = new Database(fixture.engineDbPath);
  try {
    engineDb.prepare("INSERT INTO memory_confidence (chunk_id, category) VALUES (?, ?)").run("orphan-only", "raw_log");
  } finally {
    engineDb.close();
  }

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const conversationLogs = logs.filter((log) => log.source === "conversation");
  assert.deepEqual(conversationLogs, []);
});

test("empty engine or no raw_log category returns no DB raw_log rows", async () => {
  const fixture = createFixture();
  insertRawLogChunk(fixture, {
    id: "not-raw",
    text: "**User:** should be filtered out",
    updatedAt: Date.parse("2026-06-17T09:00:00.000+08:00") / 1000,
    category: "project",
  });

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const conversationLogs = logs.filter((log) => log.source === "conversation");
  assert.deepEqual(conversationLogs, []);
});

test("DB raw_log batch membership query handles more than one IN batch and preserves order", async () => {
  const fixture = createFixture();
  const baseMs = Date.parse("2026-06-17T09:00:00.000+08:00");
  for (let index = 0; index < 700; index += 1) {
    const id = `chunk-${String(index).padStart(4, "0")}`;
    insertRawLogChunk(fixture, {
      id,
      text: `**User:** entry ${index}`,
      updatedAt: Math.floor((baseMs + (index * 1000)) / 1000),
      category: index % 3 === 0 ? "raw_log" : "project",
    });
  }

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const conversationIds = logs.filter((log) => log.source === "conversation").map((log) => log.chunk_id);
  const expectedIds = [];
  for (let index = 0; index < 700; index += 1) {
    if (index % 3 === 0) expectedIds.push(`chunk-${String(index).padStart(4, "0")}`);
  }
  assert.equal(conversationIds.length, expectedIds.length);
  assert.deepEqual(conversationIds.slice(0, 5), expectedIds.slice(0, 5));
  assert.deepEqual(conversationIds.slice(-5), expectedIds.slice(-5));
});

test("timestamp-prefixed **User:** DB raw_log is classified as user", async () => {
  const fixture = createFixture();
  insertRawLogChunk(fixture, {
    id: "chunk-meta-user",
    text: "[2026-06-17T08:00:00.000Z | session:abc] **User:** prefixed user message",
    updatedAt: Date.parse("2026-06-17T08:00:00.000+08:00") / 1000,
  });

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", { resetDirectParseEnabled: true });
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

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", { resetDirectParseEnabled: true });
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

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", { resetDirectParseEnabled: true });
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

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", { resetDirectParseEnabled: true });
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  assert.equal(logs.some((log) => log.text.includes("Summary for the day")), true);
  assert.equal(stats.charsByRoleAfterBudget.user, 0);
  assert.equal(stats.charsByRoleAfterBudget.metadata_header > 0, true);
});

test("reset transcript files outside targetDate are excluded", async () => {
  const fixture = createFixture();
  writeSessionFile(fixture, "target.jsonl.reset.1", [
    { type: "message", message: { role: "user", content: "target day dialogue" }, timestamp: "2026-06-17T09:00:00.000+08:00" },
  ], "2026-06-17T09:00:00.000+08:00");
  writeSessionFile(fixture, "old.jsonl.reset.1", [
    { type: "message", message: { role: "user", content: "historical dialogue" }, timestamp: "2026-06-10T09:00:00.000+08:00" },
  ], "2026-06-10T09:00:00.000+08:00");

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", { resetDirectParseEnabled: true });
  assert.equal(logs.some((log) => log.text.includes("target day dialogue")), true);
  assert.equal(logs.some((log) => log.text.includes("historical dialogue")), false);
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  assert.equal(stats.resetDirectParseEnabled, true);
  assert.equal(stats.resetEventsIncluded, 1);
  assert.equal(stats.resetEventsSkippedOutOfTargetDate, 1);
});

test("toolResult records are dropped and target-date user-assistant dialogue is retained", async () => {
  const fixture = createFixture();
  writeSessionFile(fixture, "session.jsonl.reset.2", [
    { type: "message", message: { role: "user", content: "please inspect the bug" }, timestamp: "2026-06-17T10:00:00.000+08:00" },
    { type: "toolResult", output: "VERY LARGE TOOL OUTPUT ".repeat(200) },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "I found the boundary issue." }] }, timestamp: "2026-06-17T10:05:00.000+08:00" },
  ], "2026-06-17T10:05:00.000+08:00");

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", { resetDirectParseEnabled: true });
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

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", { resetDirectParseEnabled: true });
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

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", { resetDirectParseEnabled: true });
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

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", { resetDirectParseEnabled: true });
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

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", { resetDirectParseEnabled: true });
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

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", { resetDirectParseEnabled: true });
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

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", { resetDirectParseEnabled: true });
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
    resetDirectParseEnabled: true,
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
    resetDirectParseEnabled: true,
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
    "Provenance: manual",
    "",
    "Decision: keep strict checkpoint boundaries.",
    "",
  ].join("\n"));
  writeSessionFile(fixture, "pressure.jsonl.reset.1", [
    { type: "message", message: { role: "assistant", content: "assistant chatter ".repeat(200) }, timestamp: "2026-06-17T10:00:00.000+08:00" },
    { type: "message", message: { role: "assistant", content: "assistant chatter 2 ".repeat(200) }, timestamp: "2026-06-17T10:05:00.000+08:00" },
  ], "2026-06-17T10:05:00.000+08:00");

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", {
    resetDirectParseEnabled: true,
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
    resetDirectParseEnabled: true,
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

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", { resetDirectParseEnabled: true });
  assert.equal(logs.some((log) => log.text.includes("late-night target work")), true);
  assert.equal(logs.some((log) => log.text.includes("captured from reset transcript")), true);
});

test("trajectory files are excluded from checkpoint session scan", async () => {
  const fixture = createFixture();
  writeSessionFile(fixture, "session.trajectory.1.jsonl", [
    { type: "message", message: { role: "user", content: "trajectory should be ignored" } },
  ], "2026-06-17T11:00:00.000+08:00");

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", { resetDirectParseEnabled: true });
  assert.equal(logs.some((log) => log.text.includes("trajectory should be ignored")), false);
});

test("reset direct parse is disabled by default so checkpoint does not re-consume reset files", async () => {
  const fixture = createFixture();
  writeSessionFile(fixture, "default-off.jsonl.reset.1", [
    { type: "message", message: { role: "user", content: "should stay out of default checkpoint input" }, timestamp: "2026-06-17T09:00:00.000+08:00" },
  ], "2026-06-17T09:00:00.000+08:00");

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  assert.equal(logs.some((log) => log.text.includes("should stay out of default checkpoint input")), false);
  assert.equal(stats.resetDirectParseEnabled, false);
  assert.equal(stats.resetFilesScanned, 0);
  assert.equal(stats.resetEventsIncluded, 0);
});

test("reset direct parse skips records without timestamp and records diagnostics", async () => {
  const fixture = createFixture();
  writeSessionFile(fixture, "missing-ts.jsonl.reset.1", [
    { type: "message", message: { role: "user", content: "missing timestamp should be skipped" } },
    { type: "message", message: { role: "assistant", content: "timestamped keep" }, timestamp: "2026-06-17T10:05:00.000+08:00" },
  ], "2026-06-17T10:05:00.000+08:00");

  const logs = await getLogsForTargetDate(fixture, "2026-06-17", { resetDirectParseEnabled: true });
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  assert.equal(logs.some((log) => log.text.includes("missing timestamp should be skipped")), false);
  assert.equal(logs.some((log) => log.text.includes("timestamped keep")), true);
  assert.equal(stats.resetEventsSkippedMissingTimestamp, 1);
});

test("DB raw_log reader does not fall back to latest 100 outside targetDate", async () => {
  const fixture = createFixture();
  for (let index = 0; index < 120; index++) {
    insertRawLogChunk(fixture, {
      id: `outside-${index}`,
      text: `**User:** outside target ${index}`,
      updatedAt: Date.parse("2026-06-18T08:00:00.000+08:00") / 1000,
    });
  }

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const stats = checkpointRawLog.getRawLogCollectionStats(logs);
  assert.equal(logs.filter((log) => log.source === "conversation").length, 0);
  assert.equal(stats.rawLogIncluded, 0);
});

test("DB raw_log returns stable output fields for conversation rows", async () => {
  const fixture = createFixture();
  insertRawLogChunk(fixture, {
    id: "field-check",
    text: "**User:** field check",
    updatedAt: Date.parse("2026-06-17T09:00:00.000+08:00") / 1000,
  });

  const logs = await getLogsForTargetDate(fixture, "2026-06-17");
  const conversationRow = logs.find((log) => log.chunk_id === "field-check");
  assert.deepEqual(conversationRow, {
    category: "raw_log",
    text: "**User:** field check",
    source: "conversation",
    chunk_id: "field-check",
  });
});

test("raw-log dual-handle path no longer references attached checkpoint schema", () => {
  const source = readFileSync(resolve("lib/checkpoint/raw-log.js"), "utf8");
  assert.doesNotMatch(source, /chunks_db\./);
  assert.doesNotMatch(source, /withMeDb\s*\(/);
  assert.doesNotMatch(source, /ATTACH DATABASE/);
  assert.match(source, /withCheckpointDbs\s*\(/);
});

test("DB read failure logs warning and loader still returns other sources", async () => {
  const fixture = createFixture();
  writeFileSync(resolve(fixture.smartAddDir, "2026-06-17.md"), [
    "# Smart Added Memory",
    "",
    "## note_entry",
    "",
    "Category: raw_log",
    "Provenance: manual",
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
    legacyResetDirectParse: false,
  });
});

test("parseCliArgs supports legacy reset direct parse flag", async () => {
  assert.deepEqual(checkpoint.parseCliArgs(["--legacy-reset-direct-parse"]), {
    dryRun: false,
    targetDate: null,
    legacyResetDirectParse: true,
  });
});
