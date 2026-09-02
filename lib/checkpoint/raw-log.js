const { existsSync, readFileSync, readdirSync, statSync } = require("node:fs");
const { resolve } = require("node:path");
const checkpointDate = require("./date");
const { withCheckpointDbs } = require("./db");
const { getRuntime } = require("./runtime");
const {
  buildDedupeKey,
  buildDialogueDedupeKey,
  contentToText,
  inferRoleKey,
  isCompactToolSummary,
  parseDialogueRoleBody,
  scoreAssistantSummary,
  stripOptionalMetadataHeader,
} = require("./raw-log-normalization");
const { compactToolResult } = require("./raw-log-tool-summary");
const { parseSmartAddEntries } = require("../smart-add-entry-contract.cjs");
const { createSmartAddCollector } = require("./raw-log-smart-add-collector");
const { createDbRawLogCollector } = require("./raw-log-db-collector");
const { createResetTranscriptCollector } = require("./raw-log-reset-collector");
const { dedupeCollectedLogs } = require("./raw-log-dedupe");
const {
  createRawLogReader,
  getRawLogCollectionStats,
} = require("./raw-log-assembly");
const {
  DEFAULT_BUDGETS,
  getBudgetConfig,
  applyBudgetToEntries,
  calculateCombinedTextLength,
  summarizeBudgetedEntries,
} = require("./raw-log-budget");

const SMART_ADD_INPUT_POLICY = "trusted_only:manual,agent_smart_add,session_flush";
const TRUSTED_SMART_ADD_PROVENANCE = new Set(["manual", "agent_smart_add", "session_flush"]);
const TOOL_RESULT_TYPES = new Set([
  "tool_result",
  "toolResult",
  "tool_output",
  "toolOutput",
]);
const RAW_LOG_MEMBERSHIP_BATCH_SIZE = 500;

function inferCategoryFromEntry(text) {
  const raw = String(text || "");
  if (/^KG_concept_/mi.test(raw)) return "kg_node";
  if (/^Node:\s*/mi.test(raw) && /^Properties:\s*/mi.test(raw)) return "kg_node";
  return "raw_log";
}

function makeCollectorStats(targetDate, timeZone) {
  return {
    targetDate,
    timeZone,
    smartAddPath: `memory/smart-add/${targetDate}.md`,
    smartAddInputPolicy: SMART_ADD_INPUT_POLICY,
    evidenceDateFilter: `targetDate=${targetDate}; timeZone=${timeZone}; smartAdd=memory/smart-add/${targetDate}.md; raw_log=event_at/legacy_event_time bounded to targetDate`,
    smartAddIncluded: 0,
    smartAddSkippedUnknownProvenance: 0,
    smartAddSkippedCheckpointGenerated: 0,
    budgets: { ...DEFAULT_BUDGETS },
    rawLogTimeBasis: "event_at/legacy_event_time",
    rawLogTimeBasisNote: "prefer event_at as original event time; legacy fallback is only allowed before event_at exists",
    rawLogIncluded: 0,
    rawLogSkippedOutOfTargetDate: 0,
    rawLogSkippedMissingTimestamp: 0,
    rawLogMissingEventAt: 0,
    resetDirectParseEnabled: false,
    resetEventsIncluded: 0,
    resetEventsSkippedOutOfTargetDate: 0,
    resetEventsSkippedMissingTimestamp: 0,
    sourceCounts: {
      smartAdd: 0,
      dbRawLog: 0,
      resetTranscript: 0,
    },
    sourceCharCountsBefore: {
      smartAdd: 0,
      dbRawLog: 0,
      resetTranscript: 0,
    },
    sourceCharCountsAfter: {
      smartAdd: 0,
      dbRawLog: 0,
      resetTranscript: 0,
    },
    droppedToolResultCount: 0,
    skippedResetFileCount: 0,
    droppedDuplicateCount: 0,
    droppedByBudgetCount: 0,
    budgetApplied: false,
    charsBeforeBudget: 0,
    charsAfterBudget: 0,
    charsBySourceAfterBudget: {
      smartAdd: 0,
      dbRawLog: 0,
      resetTranscript: 0,
    },
    charsByRoleAfterBudget: {
      note: 0,
      user: 0,
      assistant_summary: 0,
      assistant_tool_summary: 0,
      assistant: 0,
      metadata_header: 0,
    },
    resetFilesScanned: 0,
    finalCombinedTextCharCount: 0,
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

function toEpochMs(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 1e12 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTimeZoneOffsetMinutes(offsetText) {
  const raw = String(offsetText || "").trim();
  if (!raw || raw === "GMT" || raw === "UTC") return 0;
  const match = raw.match(/^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  return sign * ((hours * 60) + minutes);
}

function getTimeZoneOffsetMinutes(atMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(atMs));
  const offset = parts.find((part) => part.type === "timeZoneName")?.value;
  return parseTimeZoneOffsetMinutes(offset);
}

function zonedDateTimeToUtcMs(dateStr, timeZone, hour = 0, minute = 0, second = 0) {
  const [year, month, day] = String(dateStr || "").split("-").map((value) => Number(value));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  const wallClockUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  let offsetMinutes = getTimeZoneOffsetMinutes(wallClockUtcMs, timeZone);
  let utcMs = wallClockUtcMs - (offsetMinutes * 60 * 1000);
  const verifiedOffsetMinutes = getTimeZoneOffsetMinutes(utcMs, timeZone);
  if (verifiedOffsetMinutes !== offsetMinutes) {
    offsetMinutes = verifiedOffsetMinutes;
    utcMs = wallClockUtcMs - (offsetMinutes * 60 * 1000);
  }
  return utcMs;
}

function getTargetDateRange(targetDate, timeZone) {
  const startMs = zonedDateTimeToUtcMs(targetDate, timeZone, 0, 0, 0);
  const nextDate = checkpointDate.shiftDateString(targetDate, 1);
  const endMs = zonedDateTimeToUtcMs(nextDate, timeZone, 0, 0, 0);
  return {
    startMs,
    endMs,
    startSec: Math.floor(startMs / 1000),
    endSec: Math.floor(endMs / 1000),
  };
}

function extractEntryTimestampMs(entry, message) {
  const candidates = [
    message?.timestamp,
    message?.ts,
    message?.created_at,
    entry?.timestamp,
    entry?.ts,
    entry?.created_at,
    entry?.time,
  ];
  for (const value of candidates) {
    const ts = toEpochMs(value);
    if (ts !== null) return ts;
  }
  return null;
}

function extractSessionId(entry, fileName) {
  const value = entry?.session_id || entry?.sessionId || entry?.message?.session_id || entry?.message?.sessionId;
  if (value) return String(value);
  return String(fileName || "").replace(/\.jsonl(?:\.reset\..+)?$/, "");
}

function formatDialogueText({ role, body, timestampMs, sessionId }) {
  const meta = [];
  if (timestampMs !== null) meta.push(new Date(timestampMs).toISOString());
  if (sessionId) meta.push(`session:${sessionId}`);
  const prefix = meta.length > 0 ? `[${meta.join(" | ")}] ` : "";
  const label = role === "assistant" ? "**Assistant:**" : "**User:**";
  return `${prefix}${label} ${body}`;
}

function formatToolSummaryText({ body, timestampMs, sessionId }) {
  return formatDialogueText({
    role: "assistant",
    body,
    timestampMs,
    sessionId,
  });
}

function isTimestampInRange(timestampMs, range) {
  return timestampMs !== null && timestampMs >= range.startMs && timestampMs < range.endMs;
}

const collectSmartAddLogs = createSmartAddCollector({
  existsSync,
  readFileSync,
  resolve,
  getRuntime,
  parseSmartAddEntries,
  inferCategoryFromEntry,
  buildDedupeKey,
  trustedProvenance: TRUSTED_SMART_ADD_PROVENANCE,
});

const collectDbRawLogs = createDbRawLogCollector({
  existsSync,
  getRuntime,
  withCheckpointDbs,
  toEpochMs,
  isTimestampInRange,
  parseDialogueRoleBody,
  buildDialogueDedupeKey,
  buildDedupeKey,
  scoreAssistantSummary,
  isCompactToolSummary,
  membershipBatchSize: RAW_LOG_MEMBERSHIP_BATCH_SIZE,
});

const collectSessionTranscriptLogs = createResetTranscriptCollector({
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  resolve,
  getRuntime,
  contentToText,
  compactToolResult,
  extractEntryTimestampMs,
  extractSessionId,
  formatDialogueText,
  formatToolSummaryText,
  isTimestampInRange,
  buildDialogueDedupeKey,
  scoreAssistantSummary,
  isCompactToolSummary,
  toolResultTypes: TOOL_RESULT_TYPES,
});

const readCheckpointRawLogs = createRawLogReader({
  getRuntime,
  yesterdayDateStr: checkpointDate.yesterdayDateStr,
  getTargetDateRange,
  makeCollectorStats,
  getBudgetConfig,
  collectSmartAddLogs,
  collectDbRawLogs,
  collectSessionTranscriptLogs,
  dedupeCollectedLogs,
  calculateCombinedTextLength,
  applyBudgetToEntries,
  summarizeBudgetedEntries,
  inferRoleKey,
});

function readYesterdayRawLogs(options = {}) {
  return readCheckpointRawLogs(options);
}

module.exports = {
  parseSmartAddEntries,
  parseDialogueRoleBody,
  stripOptionalMetadataHeader,
  readCheckpointRawLogs,
  readYesterdayRawLogs,
  getRawLogCollectionStats,
  getTargetDateRange,
  getBudgetConfig,
  DEFAULT_BUDGETS,
  SMART_ADD_INPUT_POLICY,
};
