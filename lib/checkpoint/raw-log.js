const { existsSync, readFileSync, readdirSync, statSync } = require("node:fs");
const { resolve } = require("node:path");
const checkpointDate = require("./date");
const { withMeDb } = require("./db");
const { getRuntime } = require("./runtime");

const ENTRY_SEPARATOR = "\n---\n";
const SMART_ADD_INPUT_POLICY = "trusted_only:manual,agent_smart_add";
const TRUSTED_SMART_ADD_PROVENANCE = new Set(["manual", "agent_smart_add"]);
const TOOL_RESULT_TYPES = new Set([
  "tool_result",
  "toolResult",
  "tool_output",
  "toolOutput",
]);
const DEFAULT_BUDGETS = {
  maxFinalCombinedChars: 40000,
  smartAddChars: 16000,
  conversationChars: 24000,
  perSessionChars: 8000,
  toolSummaryChars: 4000,
};

function inferCategoryFromEntry(text) {
  const raw = String(text || "");
  if (/^KG_concept_/mi.test(raw)) return "kg_node";
  if (/^Node:\s*/mi.test(raw) && /^Properties:\s*/mi.test(raw)) return "kg_node";
  return "raw_log";
}

function parseSmartAddEntries(content) {
  const normalized = String(content || "").replace(/\r\n/g, "\n");
  const blockRe = /(?:<!--\s*smart-add-fingerprint:\s*[a-f0-9]{8,64}\s*-->\s*\n)?##\s+[\s\S]*?(?=\n(?:<!--\s*smart-add-fingerprint:\s*[a-f0-9]{8,64}\s*-->\s*\n)?##\s+|$)/gi;
  const blocks = (normalized.match(blockRe) || []).map((b) => b.trim());

  const entries = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length === 0) continue;
    const entryId = String(lines[0] || "").replace(/^##\s*/, "").trim();
    const categoryLine = lines.find((line) => /^\s*Category:\s*/i.test(line));
    const category = categoryLine
      ? String(categoryLine.replace(/^\s*Category:\s*/i, "").split("|")[0] || "").trim()
      : null;
    const provenanceLine = lines.find((line) => /^\s*Provenance:\s*/i.test(line));
    const provenance = provenanceLine
      ? String(provenanceLine.replace(/^\s*Provenance:\s*/i, "") || "").trim().toLowerCase()
      : "unknown";
    const text = lines
      .filter((line) =>
        !/^\s*Category:\s*/i.test(line)
        && !/^\s*Provenance:\s*/i.test(line)
        && !/^\s*kg_data:\s*/i.test(line)
        && !/^\s*##\s*/.test(line)
        && !/^\s*<!--\s*smart-add-fingerprint:\s*[a-f0-9]{8,64}\s*-->\s*$/i.test(line)
      )
      .join("\n")
      .trim();

    if (!text) continue;
    entries.push({ entryId, category, provenance, text, raw: block });
  }
  return entries;
}

function makeCollectorStats(targetDate, timeZone) {
  return {
    targetDate,
    timeZone,
    smartAddPath: `memory/smart-add/${targetDate}.md`,
    smartAddInputPolicy: SMART_ADD_INPUT_POLICY,
    evidenceDateFilter: `targetDate=${targetDate}; timeZone=${timeZone}; smartAdd=memory/smart-add/${targetDate}.md; raw_log=created_at/event_time bounded to targetDate`,
    smartAddIncluded: 0,
    smartAddSkippedUnknownProvenance: 0,
    smartAddSkippedCheckpointGenerated: 0,
    budgets: { ...DEFAULT_BUDGETS },
    rawLogTimeBasis: "created_at/event_time",
    rawLogTimeBasisNote: "prefer original event creation time; fallback requires updated_at to carry event time, not flush time",
    rawLogIncluded: 0,
    rawLogSkippedOutOfTargetDate: 0,
    rawLogSkippedMissingTimestamp: 0,
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

function clampPositiveNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function getBudgetConfig(options = {}) {
  const overrides = options.budgets || {};
  return {
    maxFinalCombinedChars: clampPositiveNumber(
      overrides.maxFinalCombinedChars || process.env.MEMORY_ENGINE_CHECKPOINT_MAX_FINAL_CHARS,
      DEFAULT_BUDGETS.maxFinalCombinedChars,
    ),
    smartAddChars: clampPositiveNumber(
      overrides.smartAddChars || process.env.MEMORY_ENGINE_CHECKPOINT_SMARTADD_CHARS,
      DEFAULT_BUDGETS.smartAddChars,
    ),
    conversationChars: clampPositiveNumber(
      overrides.conversationChars || process.env.MEMORY_ENGINE_CHECKPOINT_CONVERSATION_CHARS,
      DEFAULT_BUDGETS.conversationChars,
    ),
    perSessionChars: clampPositiveNumber(
      overrides.perSessionChars || process.env.MEMORY_ENGINE_CHECKPOINT_PER_SESSION_CHARS,
      DEFAULT_BUDGETS.perSessionChars,
    ),
    toolSummaryChars: clampPositiveNumber(
      overrides.toolSummaryChars || process.env.MEMORY_ENGINE_CHECKPOINT_TOOL_SUMMARY_CHARS,
      DEFAULT_BUDGETS.toolSummaryChars,
    ),
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

function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function buildDedupeKey(category, text) {
  return `${String(category || "raw_log").toLowerCase()}|${normalizeWhitespace(text).toLowerCase()}`;
}

function buildDialogueDedupeKey(role, body) {
  return `${String(role || "message").toLowerCase()}|${normalizeWhitespace(body).toLowerCase()}`;
}

function stripOptionalMetadataHeader(text) {
  return String(text || "").replace(/^\s*\[[^\]]+\]\s*/, "").trim();
}

function parseDialogueRoleBody(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const normalized = stripOptionalMetadataHeader(raw);
  const match = normalized.match(/^\*\*(User|Assistant):\*\*\s*([\s\S]+)$/i);
  if (!match) return null;
  return {
    role: String(match[1]).toLowerCase(),
    body: String(match[2] || "").trim(),
  };
}

function inferRoleKey(entry) {
  if (entry.sourceKind === "smartAdd") return "note";
  if (entry.role === "user") return "user";
  if (entry.role === "assistant" && entry.isAssistantSummary) return "assistant_summary";
  if (entry.role === "assistant" && entry.isToolSummary) return "assistant_tool_summary";
  if (entry.role === "assistant") return "assistant";
  return "metadata_header";
}

function isTaggedSmartAdd(entry) {
  if (!entry || entry.sourceKind !== "smartAdd") return false;
  if (["preference", "user_identity"].includes(String(entry.category || "").toLowerCase())) return true;
  return /\b(decision|decided|lesson|learned|todo|follow-up|next step|preference|resolved)\b|决定|结论|教训|经验|待办|偏好|总结/i
    .test(String(entry.text || ""));
}

function isCompactToolSummary(text) {
  const normalized = normalizeWhitespace(text);
  return normalized.length <= 400 && /\b(tool summary|command summary|result summary)\b/i.test(normalized);
}

function scoreAssistantSummary(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return false;
  if (normalized.length > 1200) return false;
  return /\b(summary|in short|root cause|resolved|fix|caused by|final|conclusion)\b|总结|结论|原因|修复|已解决/i.test(normalized);
}

function contentToText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item && item.type === "text" && typeof item.text === "string" && item.text.trim())
    .map((item) => item.text.trim())
    .join(" ")
    .trim();
}

function getEntryText(entry) {
  if (!entry) return "";
  if (typeof entry.output === "string") return entry.output;
  if (typeof entry.result === "string") return entry.result;
  if (typeof entry.stdout === "string") return entry.stdout;
  if (typeof entry.stderr === "string") return entry.stderr;
  if (typeof entry.text === "string") return entry.text;
  if (entry.message && typeof entry.message.content === "string") return entry.message.content;
  if (entry.message && Array.isArray(entry.message.content)) return contentToText(entry.message.content);
  return "";
}

function getToolName(entry) {
  return String(
    entry?.tool_name
    || entry?.toolName
    || entry?.name
    || entry?.tool
    || entry?.command_name
    || entry?.commandName
    || entry?.metadata?.tool_name
    || entry?.metadata?.toolName
    || ""
  ).trim();
}

function getToolCommand(entry) {
  return String(
    entry?.command
    || entry?.argv
    || entry?.input
    || entry?.args
    || entry?.metadata?.command
    || ""
  ).trim();
}

function countMatches(text, pattern) {
  const matches = String(text || "").match(pattern);
  return matches ? matches.length : 0;
}

function summarizeTestToolResult(toolName, toolCommand, outputText) {
  const combined = `${toolName} ${toolCommand} ${outputText}`.toLowerCase();
  if (!/\b(test|jest|mocha|tap|vitest|node --test|npm test|xargs -0 node --test)\b/.test(combined)) return null;

  const explicitPass = String(outputText).match(/#\s*pass\s+(\d+)/i);
  const explicitFail = String(outputText).match(/#\s*fail\s+(\d+)/i);
  const pass = explicitPass ? Number(explicitPass[1]) : countMatches(outputText, /(^|\n)(ok\s+\d+\s+-|PASS\b)/gmi);
  const fail = explicitFail ? Number(explicitFail[1]) : countMatches(outputText, /(^|\n)(not ok\s+\d+\s+-|FAIL\b)/gmi);
  const skipped = countMatches(outputText, /\bskipped\b/gmi);
  const todo = countMatches(outputText, /\btodo\b/gmi);
  const durationMatch = String(outputText).match(/duration_ms(?:[:=]|\s)\s*([0-9.]+)/i);
  const fragments = [`tests pass=${pass}`];
  if (fail > 0) fragments.push(`fail=${fail}`);
  if (skipped > 0) fragments.push(`skipped=${skipped}`);
  if (todo > 0) fragments.push(`todo=${todo}`);
  if (durationMatch) fragments.push(`duration_ms=${durationMatch[1]}`);
  return `Tool summary: ${fragments.join(", ")}`;
}

function summarizeGitToolResult(toolName, toolCommand, outputText) {
  const combined = `${toolName} ${toolCommand}`.toLowerCase();
  if (!/\bgit\b/.test(combined)) return null;

  const branchMatch = String(outputText).match(/^\*\s+([^\s]+)/m)
    || String(outputText).match(/\bOn branch\s+([^\s]+)/i)
    || String(outputText).match(/\b##\s+([^\s.]+)/);
  const commitMatch = String(outputText).match(/\bcommit\s+([0-9a-f]{7,40})\b/i)
    || String(outputText).match(/\b([0-9a-f]{7,40})\s+-\s+/i);
  const modified = countMatches(outputText, /^\s*[AMDRC?]{1,2}\s+/gm)
    || countMatches(outputText, /\bmodified:\s+/gmi);
  const untracked = countMatches(outputText, /\buntracked files?:/gmi) || countMatches(outputText, /^\?\?\s+/gm);
  const aheadBehind = String(outputText).match(/\bahead (\d+).+behind (\d+)/i)
    || String(outputText).match(/\[(ahead \d+[^\]]*)\]/i);

  const fragments = [];
  if (branchMatch) fragments.push(`branch=${branchMatch[1]}`);
  if (commitMatch) fragments.push(`commit=${commitMatch[1].slice(0, 12)}`);
  if (modified > 0) fragments.push(`modified=${modified}`);
  if (untracked > 0) fragments.push(`untracked=${untracked}`);
  if (aheadBehind) fragments.push(`status=${aheadBehind[1]}`);
  if (fragments.length === 0) return "Tool summary: git command ran";
  return `Tool summary: git ${fragments.join(", ")}`;
}

function summarizeDoctorToolResult(toolName, toolCommand, outputText) {
  const combined = `${toolName} ${toolCommand} ${outputText}`.toLowerCase();
  if (!/\b(doctor|status|healthcheck|health check)\b/.test(combined)) return null;

  const warningCount = countMatches(outputText, /\bwarning\b|⚠️|warn:/gmi);
  const errorCount = countMatches(outputText, /\berror\b|❌|fail(ed)?:/gmi);
  const keyWarnings = String(outputText)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /\bwarning\b|⚠️|warn:|error|❌/i.test(line))
    .slice(0, 2)
    .map((line) => normalizeWhitespace(line).slice(0, 120));
  const fragments = [`warnings=${warningCount}`, `errors=${errorCount}`];
  if (keyWarnings.length > 0) fragments.push(`highlights=${keyWarnings.join(" | ")}`);
  return `Tool summary: doctor ${fragments.join(", ")}`;
}

function summarizeCheckpointDryRunResult(outputText) {
  if (!/\[checkpoint\]\s+Input stats/i.test(outputText) && !/\[checkpoint\]\s+Dry run summary/i.test(outputText)) return null;

  let inputStats = null;
  let dryRunSummary = null;
  const inputMatch = String(outputText).match(/\[checkpoint\]\s+Input stats\s+(\{.+\})/);
  const summaryMatch = String(outputText).match(/\[checkpoint\]\s+Dry run summary\s+(\{.+\})/);
  try {
    if (inputMatch) inputStats = JSON.parse(inputMatch[1]);
  } catch (_) {}
  try {
    if (summaryMatch) dryRunSummary = JSON.parse(summaryMatch[1]);
  } catch (_) {}
  if (!inputStats && !dryRunSummary) return null;

  const targetDate = dryRunSummary?.targetDate || inputStats?.targetDate;
  const combinedChars = dryRunSummary?.combinedTextCharCount || inputStats?.finalCombinedTextCharCount;
  const rawCount = dryRunSummary?.rawCount;
  const droppedBudget = inputStats?.droppedByBudgetCount;
  const budgetApplied = inputStats?.budgetApplied;
  const fragments = [];
  if (targetDate) fragments.push(`targetDate=${targetDate}`);
  if (rawCount !== undefined) fragments.push(`rawCount=${rawCount}`);
  if (combinedChars !== undefined) fragments.push(`combinedChars=${combinedChars}`);
  if (budgetApplied !== undefined) fragments.push(`budgetApplied=${budgetApplied}`);
  if (droppedBudget !== undefined) fragments.push(`droppedByBudget=${droppedBudget}`);
  return `Tool summary: checkpoint dry-run ${fragments.join(", ")}`;
}

function compactToolResult(entry) {
  const toolName = getToolName(entry);
  const toolCommand = getToolCommand(entry);
  const outputText = getEntryText(entry);
  if (!outputText.trim()) return null;

  return summarizeCheckpointDryRunResult(outputText)
    || summarizeTestToolResult(toolName, toolCommand, outputText)
    || summarizeGitToolResult(toolName, toolCommand, outputText)
    || summarizeDoctorToolResult(toolName, toolCommand, outputText);
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

function rankLogEntry(entry) {
  let score = 0;
  if (entry.sourceKind === "resetTranscript") score += 20;
  if (entry.sourceKind === "dbRawLog") score += 10;
  if (entry.timestampMs !== null) score += 2;
  if (entry.sessionId) score += 1;
  return score;
}

function isTimestampInRange(timestampMs, range) {
  return timestampMs !== null && timestampMs >= range.startMs && timestampMs < range.endMs;
}

function collectSmartAddLogs(targetDate, stats) {
  const rt = getRuntime();
  const collected = [];
  const smartAddPath = resolve(rt.smartAddDir, `${targetDate}.md`);
  if (!existsSync(smartAddPath)) return collected;

  const content = readFileSync(smartAddPath, "utf-8");
  const entries = parseSmartAddEntries(content);
  for (const parsed of entries) {
    const provenance = String(parsed.provenance || "unknown").toLowerCase();
    if (!TRUSTED_SMART_ADD_PROVENANCE.has(provenance)) {
      if (provenance === "checkpoint_generated") {
        stats.smartAddSkippedCheckpointGenerated += 1;
      } else {
        stats.smartAddSkippedUnknownProvenance += 1;
      }
      continue;
    }
    const category = parsed.category || inferCategoryFromEntry(parsed.raw || parsed.text);
    const body = String(parsed.text || parsed.raw || "").trim();
    if (!body) continue;
    stats.sourceCounts.smartAdd += 1;
    stats.sourceCharCountsBefore.smartAdd += body.length;
    stats.smartAddIncluded += 1;
    collected.push({
      category,
      text: body,
      source: "note",
      sourceKind: "smartAdd",
      role: "note",
      provenance,
      dedupeKey: buildDedupeKey(category, body),
      timestampMs: null,
      sessionId: null,
    });
  }
  return collected;
}

function getDbRawLogTimeSelector(meDb) {
  const columns = new Set(
    meDb.prepare("PRAGMA chunks_db.table_info(chunks)").all().map((row) => String(row.name || "")),
  );
  if (columns.has("created_at")) {
    return {
      column: "created_at",
      basis: "created_at",
      note: "created_at is treated as the original raw-log event creation time",
    };
  }
  return {
    column: "updated_at",
    basis: "updated_at_event_time",
    note: "core chunks has no created_at column; updated_at must contain the raw-log event timestamp, not the flush/update time",
  };
}

function collectDbRawLogs(targetDate, timeZone, range, stats) {
  const rt = getRuntime();
  const collected = [];
  if (!existsSync(rt.engineDbPath)) return collected;

  try {
    withMeDb((meDb) => {
      const timeSelector = getDbRawLogTimeSelector(meDb);
      stats.rawLogTimeBasis = timeSelector.basis;
      stats.rawLogTimeBasisNote = timeSelector.note;
      stats.evidenceDateFilter = `targetDate=${targetDate}; timeZone=${timeZone}; smartAdd=memory/smart-add/${targetDate}.md; raw_log=${timeSelector.basis} bounded to targetDate`;
      const timeColumn = `c.${timeSelector.column}`;
      const rows = meDb
        .prepare(
          `SELECT c.id, c.text, mc.category, ${timeColumn} AS raw_log_time
           FROM chunks_db.chunks c
           JOIN memory_confidence mc ON c.id = mc.chunk_id
           WHERE mc.category = 'raw_log'
             AND (
               (${timeColumn} >= @startSec AND ${timeColumn} < @endSec)
               OR
               (${timeColumn} >= @startMs AND ${timeColumn} < @endMs)
             )
           ORDER BY CASE
             WHEN ${timeColumn} >= 1000000000000 THEN ${timeColumn}
             ELSE ${timeColumn} * 1000
           END ASC, c.id ASC`
        )
        .all({
          startSec: range.startSec,
          endSec: range.endSec,
          startMs: range.startMs,
          endMs: range.endMs,
        });

      for (const row of rows) {
        const body = String(row.text || "").trim();
        if (!body) continue;
        const timestampMs = toEpochMs(row.raw_log_time);
        if (timestampMs === null) {
          stats.rawLogSkippedMissingTimestamp += 1;
          continue;
        }
        if (!isTimestampInRange(timestampMs, range)) {
          stats.rawLogSkippedOutOfTargetDate += 1;
          continue;
        }
        const dialogueMatch = parseDialogueRoleBody(body);
        const dedupeKey = dialogueMatch
          ? buildDialogueDedupeKey(dialogueMatch.role, dialogueMatch.body)
          : buildDedupeKey(row.category || "raw_log", body);
        stats.sourceCounts.dbRawLog += 1;
        stats.sourceCharCountsBefore.dbRawLog += body.length;
        stats.rawLogIncluded += 1;
        collected.push({
          category: row.category || "raw_log",
          text: body,
          source: "conversation",
          sourceKind: "dbRawLog",
          role: dialogueMatch ? dialogueMatch.role : "other",
          isAssistantSummary: dialogueMatch ? scoreAssistantSummary(dialogueMatch.body) : false,
          isToolSummary: dialogueMatch ? isCompactToolSummary(dialogueMatch.body) : false,
          dedupeKey,
          timestampMs,
          sessionId: null,
          chunk_id: row.id,
        });
      }
    }, { readonly: true });
  } catch (error) {
    console.error("[checkpoint] DB read warning:", error.message);
  }

  return collected;
}

function shouldConsiderResetFile(fileName, stats) {
  if (fileName.includes(".trajectory.")) return false;
  if (!fileName.includes(".jsonl.reset.")) return false;
  const filePath = resolve(getRuntime().sessionsDir, fileName);
  try {
    statSync(filePath);
  } catch (_) {
    stats.skippedResetFileCount += 1;
    stats.droppedNoise.statFailure += 1;
    return false;
  }
  return { filePath };
}

function collectSessionTranscriptLogs(targetDate, timeZone, range, stats, options = {}) {
  const rt = getRuntime();
  const collected = [];
  stats.resetDirectParseEnabled = options.resetDirectParseEnabled === true;
  if (!stats.resetDirectParseEnabled) return collected;
  if (!existsSync(rt.sessionsDir)) return collected;

  try {
    const allFiles = readdirSync(rt.sessionsDir);
    const sessionFiles = [];
    for (const fileName of allFiles) {
      const decision = shouldConsiderResetFile(fileName, stats);
      if (decision) {
        sessionFiles.push({ fileName, ...decision });
      }
    }

    for (const file of sessionFiles) {
      stats.resetFilesScanned += 1;
      const fileContent = readFileSync(file.filePath, "utf-8");
      const lines = fileContent.split("\n").filter(Boolean);
      for (const line of lines) {
        let entry;
        try {
          entry = JSON.parse(line);
        } catch (_) {
          stats.droppedNoise.malformedJson += 1;
          continue;
        }

        if (TOOL_RESULT_TYPES.has(String(entry?.type || "")) || entry?.message?.role === "tool") {
          stats.droppedToolResultCount += 1;
          stats.droppedNoise.toolResult += 1;
          const compactSummary = compactToolResult(entry);
          if (compactSummary) {
            const timestampMs = extractEntryTimestampMs(entry, entry.message);
            if (timestampMs === null) {
              stats.resetEventsSkippedMissingTimestamp += 1;
              continue;
            }
            if (!isTimestampInRange(timestampMs, range)) {
              stats.resetEventsSkippedOutOfTargetDate += 1;
              stats.droppedNoise.outOfRangeTranscript += 1;
              continue;
            }
            const summaryText = formatToolSummaryText({
              body: compactSummary,
              timestampMs,
              sessionId: extractSessionId(entry, file.fileName),
            });
            stats.sourceCounts.resetTranscript += 1;
            stats.sourceCharCountsBefore.resetTranscript += compactSummary.length;
            stats.resetEventsIncluded += 1;
            collected.push({
              category: "raw_log",
              text: summaryText,
              source: "conversation",
              sourceKind: "resetTranscript",
              role: "assistant",
              isAssistantSummary: false,
              isToolSummary: true,
              dedupeKey: buildDialogueDedupeKey("assistant_tool_summary", compactSummary),
              timestampMs,
              sessionId: extractSessionId(entry, file.fileName),
            });
            stats.droppedNoise.toolSummaryRetained += 1;
          } else {
            stats.droppedNoise.toolSummaryDropped += 1;
          }
          continue;
        }

        if (entry?.type !== "message" || !entry.message) {
          stats.droppedNoise.nonMessageRecord += 1;
          continue;
        }
        const role = String(entry.message.role || "").toLowerCase();
        if (role !== "user" && role !== "assistant") {
          stats.droppedNoise.nonDialogueRole += 1;
          continue;
        }

        const body = contentToText(entry.message.content);
        if (!body) {
          stats.droppedNoise.emptyContent += 1;
          continue;
        }
        const timestampMs = extractEntryTimestampMs(entry, entry.message);
        if (timestampMs === null) {
          stats.resetEventsSkippedMissingTimestamp += 1;
          continue;
        }
        if (!isTimestampInRange(timestampMs, range)) {
          stats.resetEventsSkippedOutOfTargetDate += 1;
          stats.droppedNoise.outOfRangeTranscript += 1;
          continue;
        }

        const text = formatDialogueText({
          role,
          body,
          timestampMs,
          sessionId: extractSessionId(entry, file.fileName),
        });

        stats.sourceCounts.resetTranscript += 1;
        stats.sourceCharCountsBefore.resetTranscript += body.length;
        stats.resetEventsIncluded += 1;
        collected.push({
          category: "raw_log",
          text,
          source: "conversation",
          sourceKind: "resetTranscript",
          role,
          isAssistantSummary: role === "assistant" && scoreAssistantSummary(body),
          isToolSummary: role === "assistant" && isCompactToolSummary(body),
          dedupeKey: buildDialogueDedupeKey(role, body),
          timestampMs,
          sessionId: extractSessionId(entry, file.fileName),
        });
      }
    }

    if (sessionFiles.length > 0) {
      console.log(`[checkpoint] Scanned ${sessionFiles.length} session files for targetDate ${targetDate} (${timeZone})`);
    }
  } catch (error) {
    console.error("[checkpoint] Reset file scan warning:", error.message);
  }

  return collected;
}

function dedupeCollectedLogs(entries, stats) {
  const bestByKey = new Map();
  const allEntries = Array.isArray(entries) ? entries : [];

  allEntries.forEach((entry, index) => {
    entry._index = index;
    const dedupeKey = entry.dedupeKey || buildDedupeKey(entry.category, entry.text);
    const existing = bestByKey.get(dedupeKey);
    if (!existing) {
      bestByKey.set(dedupeKey, entry);
      return;
    }

    if (rankLogEntry(entry) > rankLogEntry(existing)) {
      bestByKey.set(dedupeKey, entry);
    }
    stats.droppedDuplicateCount += 1;
  });

  const deduped = Array.from(bestByKey.values()).sort((left, right) => {
    if (left.timestampMs !== null && right.timestampMs !== null && left.timestampMs !== right.timestampMs) {
      return left.timestampMs - right.timestampMs;
    }
    if (left.timestampMs !== null && right.timestampMs === null) return -1;
    if (left.timestampMs === null && right.timestampMs !== null) return 1;
    return left._index - right._index;
  });

  return deduped;
}

function attachStats(logs, stats) {
  Object.defineProperty(logs, "checkpointStats", {
    value: stats,
    enumerable: false,
    writable: false,
  });
  return logs;
}

function getRawLogCollectionStats(rawLogs) {
  return rawLogs && rawLogs.checkpointStats ? rawLogs.checkpointStats : null;
}

function getEntryCharCost(text, selectedCount) {
  return String(text || "").length + (selectedCount > 0 ? ENTRY_SEPARATOR.length : 0);
}

function getSourceBudgetKey(entry) {
  return entry && entry.sourceKind === "smartAdd" ? "smartAddChars" : "conversationChars";
}

function getSourceStatsKey(entry) {
  return entry?.sourceKind || "dbRawLog";
}

function getEntryPriority(entry) {
  if (isTaggedSmartAdd(entry)) return 500;
  if (entry?.role === "user") return 400;
  if (entry?.isAssistantSummary) return 300;
  if (entry?.isToolSummary) return 200;
  if (entry?.role === "assistant") return 100;
  return 50;
}

function truncateTextToFit(text, maxChars) {
  const normalized = String(text || "").trim();
  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= 1) return "";
  if (maxChars <= 3) return normalized.slice(0, maxChars);
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

function applyBudgetToEntries(entries, stats, budgetConfig) {
  const selected = [];
  const sourceUsage = {
    smartAddChars: 0,
    conversationChars: 0,
    toolSummaryChars: 0,
  };
  const sessionUsage = new Map();
  const ranked = [...entries].sort((left, right) => {
    const priorityDiff = getEntryPriority(right) - getEntryPriority(left);
    if (priorityDiff !== 0) return priorityDiff;
    if (left.timestampMs !== null && right.timestampMs !== null && left.timestampMs !== right.timestampMs) {
      return left.timestampMs - right.timestampMs;
    }
    if (left.timestampMs !== null && right.timestampMs === null) return -1;
    if (left.timestampMs === null && right.timestampMs !== null) return 1;
    return left._index - right._index;
  });

  for (const entry of ranked) {
    const sourceBudgetKey = getSourceBudgetKey(entry);
    const sourceLimit = budgetConfig[sourceBudgetKey];
    const currentSourceUsage = sourceUsage[sourceBudgetKey];
    const currentToolSummaryUsage = entry.isToolSummary ? sourceUsage.toolSummaryChars : 0;
    const currentSessionUsage = entry.sessionId ? (sessionUsage.get(entry.sessionId) || 0) : 0;
    const remainingFinal = budgetConfig.maxFinalCombinedChars - calculateCombinedTextLength(selected);
    const remainingSource = sourceLimit - currentSourceUsage;
    const remainingToolSummary = entry.isToolSummary
      ? (budgetConfig.toolSummaryChars - currentToolSummaryUsage)
      : Number.POSITIVE_INFINITY;
    const remainingSession = entry.sessionId ? (budgetConfig.perSessionChars - currentSessionUsage) : Number.POSITIVE_INFINITY;
    const maxAllowed = Math.min(remainingFinal, remainingSource, remainingToolSummary, remainingSession);
    if (maxAllowed <= 0) {
      stats.droppedByBudgetCount += 1;
      stats.budgetApplied = true;
      continue;
    }

    const separatorCost = selected.length > 0 ? ENTRY_SEPARATOR.length : 0;
    const textLimit = maxAllowed - separatorCost;
    if (textLimit <= 0) {
      stats.droppedByBudgetCount += 1;
      stats.budgetApplied = true;
      continue;
    }

    const finalText = truncateTextToFit(entry.text, textLimit);
    if (!finalText) {
      stats.droppedByBudgetCount += 1;
      stats.budgetApplied = true;
      continue;
    }

    const charCost = getEntryCharCost(finalText, selected.length);
    if (finalText.length < String(entry.text || "").length) {
      stats.budgetApplied = true;
    }
    if (charCost > remainingFinal || charCost > remainingSource || charCost > remainingToolSummary || charCost > remainingSession) {
      stats.droppedByBudgetCount += 1;
      stats.budgetApplied = true;
      continue;
    }

    selected.push({
      ...entry,
      text: finalText,
    });
    sourceUsage[sourceBudgetKey] += charCost;
    if (entry.isToolSummary) sourceUsage.toolSummaryChars += charCost;
    if (entry.sessionId) {
      sessionUsage.set(entry.sessionId, currentSessionUsage + charCost);
    }
  }

  return selected.sort((left, right) => {
    if (left.timestampMs !== null && right.timestampMs !== null && left.timestampMs !== right.timestampMs) {
      return left.timestampMs - right.timestampMs;
    }
    if (left.timestampMs !== null && right.timestampMs === null) return -1;
    if (left.timestampMs === null && right.timestampMs !== null) return 1;
    return left._index - right._index;
  });
}

function calculateCombinedTextLength(entries) {
  return (entries || [])
    .filter((entry) => entry && entry.text && entry.text.trim())
    .map((entry) => entry.text.trim())
    .join(ENTRY_SEPARATOR)
    .length;
}

function summarizeBudgetedEntries(entries, stats) {
  for (const entry of entries) {
    const sourceKey = getSourceStatsKey(entry);
    const roleKey = inferRoleKey(entry);
    if (stats.sourceCharCountsAfter[sourceKey] !== undefined) {
      stats.sourceCharCountsAfter[sourceKey] += String(entry.text || "").length;
    }
    if (stats.charsBySourceAfterBudget[sourceKey] !== undefined) {
      stats.charsBySourceAfterBudget[sourceKey] += String(entry.text || "").length;
    }
    if (stats.charsByRoleAfterBudget[roleKey] !== undefined) {
      stats.charsByRoleAfterBudget[roleKey] += String(entry.text || "").length;
    } else {
      stats.charsByRoleAfterBudget.metadata_header += String(entry.text || "").length;
    }
  }
}

function readCheckpointRawLogs(options = {}) {
  const rt = getRuntime();
  const timeZone = options.timeZone || rt.timeZone;
  const targetDate = options.targetDate || checkpointDate.yesterdayDateStr(rt.now(), timeZone);
  const range = getTargetDateRange(targetDate, timeZone);
  const stats = makeCollectorStats(targetDate, timeZone);
  const budgetConfig = getBudgetConfig(options);
  stats.budgets = { ...budgetConfig };

  const collected = [
    ...collectSmartAddLogs(targetDate, stats),
    ...collectDbRawLogs(targetDate, timeZone, range, stats),
    ...collectSessionTranscriptLogs(targetDate, timeZone, range, stats, options),
  ];

  const dedupedEntries = dedupeCollectedLogs(collected, stats);
  stats.charsBeforeBudget = calculateCombinedTextLength(dedupedEntries);
  const budgetedEntries = applyBudgetToEntries(dedupedEntries, stats, budgetConfig);
  stats.charsAfterBudget = calculateCombinedTextLength(budgetedEntries);
  summarizeBudgetedEntries(budgetedEntries, stats);
  debugOtherBucket(budgetedEntries, stats);
  const logs = budgetedEntries.map((entry) => ({
    category: entry.category,
    text: entry.text,
    source: entry.source,
    chunk_id: entry.chunk_id,
  }));
  stats.finalCombinedTextCharCount = stats.charsAfterBudget;

  return attachStats(logs, stats);
}

/**
 * Debug: sample entries that fell into metadata_header bucket and show source breakdown.
 */
function debugOtherBucket(budgetedEntries, stats) {
  const metaEntries = budgetedEntries.filter((e) => inferRoleKey(e) === "metadata_header");
  if (metaEntries.length === 0) return;

  const sourceBreakdown = {};
  for (const e of metaEntries) {
    const sk = e.sourceKind || "unknown";
    sourceBreakdown[sk] = (sourceBreakdown[sk] || 0) + 1;
  }

  const samples = metaEntries
    .slice(0, 5)
    .map((e) => {
      const preview = String(e.text || "").replace(/\n/g, " ").slice(0, 120);
      return `  [${e.sourceKind || "?"}] role=${e.role || "?"} ${preview}`;
    })
    .join("\n");

  console.log(`[checkpoint] debug metadata_header bucket: count=${metaEntries.length}, chars=${metaEntries.reduce((s, e) => s + String(e.text || "").length, 0)}`);
  console.log(`[checkpoint]   sourceBreakdown: ${JSON.stringify(sourceBreakdown)}`);
  console.log(`[checkpoint]   top samples:\n${samples}`);
}

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
