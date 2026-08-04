import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createSmartAddCollector } = require("../lib/checkpoint/raw-log-smart-add-collector");
const { createDbRawLogCollector } = require("../lib/checkpoint/raw-log-db-collector");
const { createResetTranscriptCollector } = require("../lib/checkpoint/raw-log-reset-collector");
const { dedupeCollectedLogs } = require("../lib/checkpoint/raw-log-dedupe");
const { createRawLogReader, getRawLogCollectionStats } = require("../lib/checkpoint/raw-log-assembly");

function createStats() {
  return {
    smartAddIncluded: 0,
    smartAddSkippedUnknownProvenance: 0,
    smartAddSkippedCheckpointGenerated: 0,
    rawLogIncluded: 0,
    rawLogSkippedMissingTimestamp: 0,
    rawLogSkippedOutOfTargetDate: 0,
    rawLogMissingEventAt: 0,
    resetDirectParseEnabled: false,
    resetFilesScanned: 0,
    resetEventsIncluded: 0,
    resetEventsSkippedMissingTimestamp: 0,
    resetEventsSkippedOutOfTargetDate: 0,
    skippedResetFileCount: 0,
    droppedToolResultCount: 0,
    droppedDuplicateCount: 0,
    droppedByBudgetCount: 0,
    sourceCounts: { smartAdd: 0, dbRawLog: 0, resetTranscript: 0 },
    sourceCharCountsBefore: { smartAdd: 0, dbRawLog: 0, resetTranscript: 0 },
    sourceCharCountsAfter: { smartAdd: 0, dbRawLog: 0, resetTranscript: 0 },
    charsBySourceAfterBudget: { smartAdd: 0, dbRawLog: 0, resetTranscript: 0 },
    charsByRoleAfterBudget: {
      note: 0,
      user: 0,
      assistant_summary: 0,
      assistant_tool_summary: 0,
      assistant: 0,
      metadata_header: 0,
    },
    droppedNoise: {
      toolResult: 0,
      toolSummaryDropped: 0,
      toolSummaryRetained: 0,
      malformedJson: 0,
      nonMessageRecord: 0,
      nonDialogueRole: 0,
      emptyContent: 0,
      outOfRangeTranscript: 0,
      statFailure: 0,
    },
  };
}

test("smart-add collector resolves runtime at call time and preserves provenance filtering", () => {
  let smartAddDir = "/first";
  const readPaths = [];
  const collector = createSmartAddCollector({
    existsSync: () => true,
    readFileSync: path => {
      readPaths.push(path);
      return "fixture";
    },
    resolve: (...parts) => parts.join("/"),
    getRuntime: () => ({ smartAddDir }),
    parseSmartAddEntries: () => [
      { category: "preference", provenance: "manual", text: "keep" },
      { category: "raw_log", provenance: "checkpoint_generated", text: "drop" },
    ],
    inferCategoryFromEntry: () => "raw_log",
    buildDedupeKey: (category, text) => `${category}|${text}`,
    trustedProvenance: new Set(["manual"]),
  });

  const firstStats = createStats();
  assert.equal(collector("2026-06-17", firstStats).length, 1);
  smartAddDir = "/second";
  const secondStats = createStats();
  assert.equal(collector("2026-06-18", secondStats).length, 1);
  assert.deepEqual(readPaths, ["/first/2026-06-17.md", "/second/2026-06-18.md"]);
  assert.equal(firstStats.smartAddIncluded, 1);
  assert.equal(firstStats.smartAddSkippedCheckpointGenerated, 1);
});

test("DB collector uses readonly Engine dual handles and keeps event-time role mapping", () => {
  let dbOptions = null;
  const coreDb = {
    prepare(sql) {
      if (sql.includes("PRAGMA table_info")) return { all: () => [{ name: "event_at" }] };
      if (sql.includes("COUNT(*) AS c")) return { get: () => ({ c: 0 }) };
      if (sql.includes("SELECT id, text")) {
        return { all: () => [{ id: "id-1", text: "**User:** hello", raw_log_time: 1_718_556_000 }] };
      }
      throw new Error(`unexpected core SQL: ${sql}`);
    },
  };
  const engineDb = {
    prepare(sql) {
      if (sql.includes("category = 'raw_log'")) return { all: () => [{ chunk_id: "id-1" }] };
      throw new Error(`unexpected engine SQL: ${sql}`);
    },
  };
  const collector = createDbRawLogCollector({
    existsSync: () => true,
    getRuntime: () => ({ engineDbPath: "/engine.sqlite" }),
    withCheckpointDbs: (fn, options) => {
      dbOptions = options;
      return fn({ coreDb, engineDb });
    },
    toEpochMs: value => Number(value) * 1000,
    isTimestampInRange: () => true,
    parseDialogueRoleBody: () => ({ role: "user", body: "hello" }),
    buildDialogueDedupeKey: (role, body) => `${role}|${body}`,
    buildDedupeKey: (category, text) => `${category}|${text}`,
    scoreAssistantSummary: () => false,
    isCompactToolSummary: () => false,
  });

  const stats = createStats();
  const rows = collector("2026-06-17", "Asia/Shanghai", {
    startSec: 1,
    endSec: 2,
    startMs: 1000,
    endMs: 2000,
  }, stats);
  assert.deepEqual(dbOptions, { readonlyEngine: true });
  assert.equal(rows[0].role, "user");
  assert.equal(rows[0].chunk_id, "id-1");
  assert.equal(stats.rawLogTimeBasis, "event_at");
});

test("reset collector remains disabled by default and scans only reset transcript files when enabled", () => {
  let readdirCalls = 0;
  const records = [
    JSON.stringify({
      type: "message",
      timestamp: "2026-06-17T01:00:00.000Z",
      message: { role: "user", content: "hello" },
    }),
  ].join("\n");
  const collector = createResetTranscriptCollector({
    existsSync: () => true,
    readFileSync: () => records,
    readdirSync: () => {
      readdirCalls += 1;
      return ["session.jsonl.reset.1", "session.trajectory.jsonl.reset.2", "session.jsonl"];
    },
    statSync: () => ({}),
    resolve: (...parts) => parts.join("/"),
    getRuntime: () => ({ sessionsDir: "/sessions" }),
    contentToText: value => String(value || ""),
    compactToolResult: () => null,
    extractEntryTimestampMs: () => Date.parse("2026-06-17T01:00:00.000Z"),
    extractSessionId: () => "session",
    formatDialogueText: ({ role, body }) => `**${role}:** ${body}`,
    formatToolSummaryText: ({ body }) => body,
    isTimestampInRange: () => true,
    buildDialogueDedupeKey: (role, body) => `${role}|${body}`,
    scoreAssistantSummary: () => false,
    isCompactToolSummary: () => false,
    toolResultTypes: new Set(["tool_result"]),
    logger: { log() {}, error() {} },
  });

  const disabledStats = createStats();
  assert.deepEqual(collector("2026-06-17", "Asia/Shanghai", {}, disabledStats), []);
  assert.equal(readdirCalls, 0);

  const enabledStats = createStats();
  const rows = collector("2026-06-17", "Asia/Shanghai", {}, enabledStats, {
    resetDirectParseEnabled: true,
  });
  assert.equal(readdirCalls, 1);
  assert.equal(rows.length, 1);
  assert.equal(enabledStats.resetFilesScanned, 1);
});

test("dedupe prefers reset transcript over DB raw-log while preserving chronological output", () => {
  const stats = createStats();
  const rows = dedupeCollectedLogs([
    { sourceKind: "dbRawLog", dedupeKey: "user|same", timestampMs: 200, text: "db", category: "raw_log" },
    { sourceKind: "resetTranscript", dedupeKey: "user|same", timestampMs: 100, text: "reset", category: "raw_log" },
    { sourceKind: "smartAdd", dedupeKey: "note|other", timestampMs: null, text: "note", category: "preference" },
  ], stats);

  assert.deepEqual(rows.map(row => row.text), ["reset", "note"]);
  assert.equal(stats.droppedDuplicateCount, 1);
});

test("raw-log assembly preserves collector order and attaches non-enumerable stats", () => {
  const calls = [];
  const reader = createRawLogReader({
    getRuntime: () => ({ timeZone: "Asia/Shanghai", now: () => 1 }),
    yesterdayDateStr: () => "2026-06-17",
    getTargetDateRange: () => ({ startMs: 0, endMs: 1, startSec: 0, endSec: 1 }),
    makeCollectorStats: (targetDate, timeZone) => ({
      ...createStats(),
      targetDate,
      timeZone,
      budgets: {},
    }),
    getBudgetConfig: () => ({ maxFinalCombinedChars: 100 }),
    collectSmartAddLogs: () => {
      calls.push("smartAdd");
      return [{ category: "preference", text: "note", source: "note" }];
    },
    collectDbRawLogs: () => {
      calls.push("dbRawLog");
      return [{ category: "raw_log", text: "db", source: "conversation" }];
    },
    collectSessionTranscriptLogs: () => {
      calls.push("resetTranscript");
      return [{ category: "raw_log", text: "reset", source: "conversation" }];
    },
    dedupeCollectedLogs: entries => entries,
    calculateCombinedTextLength: entries => entries.map(entry => entry.text).join("\n---\n").length,
    applyBudgetToEntries: entries => entries,
    summarizeBudgetedEntries() {},
    inferRoleKey: () => "metadata_header",
    logger: { log() {} },
  });

  const logs = reader({});
  assert.deepEqual(calls, ["smartAdd", "dbRawLog", "resetTranscript"]);
  assert.deepEqual(logs.map(row => row.text), ["note", "db", "reset"]);
  assert.equal(Object.keys(logs).includes("checkpointStats"), false);
  assert.equal(getRawLogCollectionStats(logs).targetDate, "2026-06-17");
});
