"use strict";
// Read original JSONL files without flushing sessions or touching either database.
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const businessTime = require("../business-time.cjs");
const sha = value => createHash("sha256").update(value).digest("hex");
const isTrajectory = name => /\.trajectory(?:[.-]|$)/.test(name);
const isTranscript = name => !isTrajectory(name) && /\.jsonl(?:\.(?:reset|deleted)\..+)?$/.test(name);
function transcriptNames(directory) {
  return fs.readdirSync(directory).filter(isTranscript).sort();
}
function contentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content.filter(block => block?.type === "text" && typeof block.text === "string")
      .map(block => block.text).join("\n");
    return text || JSON.stringify(content);
  }
  return content == null ? "" : JSON.stringify(content);
}
function collectTranscriptSources({ directory, targetDate, timeZone }) {
  businessTime.validateBusinessDate(targetDate);
  businessTime.validateBusinessTimeZone(timeZone);
  directory = path.resolve(directory);
  const names = transcriptNames(directory), files = [], rows = [], seen = new Map();
  const audit = { directory, target_date: targetDate, time_zone: timeZone, files,
    records_included: 0, duplicates: 0, out_of_date: 0, non_dialogue: 0,
    ignored_trajectory_files: fs.readdirSync(directory).filter(isTrajectory).length,
    excluded_cron_sessions: 0, included_roles: ["user", "assistant", "tool", "toolResult"] };
  for (const name of names) {
    const file = path.join(directory, name);
    if (!fs.lstatSync(file).isFile()) throw new Error("transcript_not_regular:" + name);
    const bytes = fs.readFileSync(file), text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const info = { file: name, sha256: sha(bytes), bytes: bytes.length, matched: 0 };
    files.push(info);
    const parsed = text.split(/\r?\n/).flatMap((line, index) => {
      if (!line.trim()) return [];
      try { return [{ entry: JSON.parse(line), line, index }]; }
      catch { throw new Error("transcript_invalid_json:" + name + ":" + (index + 1)); }
    });
    const users = parsed.filter(row => row.entry?.message?.role === "user");
    // Only classify an explicitly tagged, isolated cron transcript. An ordinary
    // user mentioning cron in a conversation is still input.
    if (users.length && users.every(row => /^\[cron:[^\]]+\]/.test(contentText(row.entry.message.content).trim()))) {
      info.excluded = "cron_session"; audit.excluded_cron_sessions++; continue;
    }
    for (const { entry, line, index } of parsed) {
      const message = entry?.message;
      if (entry?.type !== "message" || !message
        || !["user", "assistant", "tool", "toolResult"].includes(message.role)) {
        audit.non_dialogue++; continue;
      }
      const timestamp = entry.timestamp ?? message.timestamp;
      let date;
      try {
        // businessDateFromInstant(undefined) defaults to now; never use that
        // default when classifying an original message.
        if (timestamp == null || timestamp === "") throw new Error("missing timestamp");
        date = businessTime.businessDateFromInstant(timestamp, timeZone);
      } catch { throw new Error("transcript_missing_or_invalid_timestamp:" + name + ":" + (index + 1)); }
      if (date !== targetDate) { audit.out_of_date++; continue; }
      const body = contentText(message.content);
      if (!body.trim()) { audit.non_dialogue++; continue; }
      info.matched++;
      const sessionId = name.replace(/\.jsonl(?:\..+)?$/, "");
      // Duplicate copies of one session are common after reset/cleanup. Keep every
      // physical locator, but don't collapse identical turns in different sessions.
      const key = sha(sessionId + "\n" + line), locator = { file: name, line: index + 1, file_sha256: info.sha256 };
      if (seen.has(key)) {
        seen.get(key).transcript_locations.push(locator); audit.duplicates++; continue;
      }
      const role = message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "Tool";
      const row = { category: "raw_log", source: "conversation", role: message.role,
        entry_id: "transcript:" + key, timestampMs: typeof timestamp === "number" ? timestamp : Date.parse(timestamp),
        sessionId, provenance: "transcript_replay",
        text: "**" + role + ":** " + body,
        transcript_locations: [locator], original_jsonl_line: line };
      seen.set(key, row); rows.push(row);
    }
  }
  rows.sort((a, b) => a.timestampMs - b.timestampMs || a.entry_id.localeCompare(b.entry_id));
  audit.records_included = rows.length;
  const unchanged = () => {
    try {
      return JSON.stringify(transcriptNames(directory)) === JSON.stringify(names)
        && files.every(file => sha(fs.readFileSync(path.join(directory, file.file))) === file.sha256);
    } catch { return false; }
  };
  Object.defineProperty(rows, "segmentedInput", { value: {
    targetDate, entries: rows.map(row => ({ ...row, entryId: row.entry_id })),
    source_audit: audit, unchanged,
  } });
  Object.defineProperty(rows, "checkpointStats", { value: {
    inputPolicy: "transcript_replay", budgetCoverageComplete: true, sourceAudit: audit,
    finalCombinedTextCharCount: rows.reduce((sum, row) => sum + row.text.length, 0),
  } });
  return { logs: rows, audit, unchanged };
}
module.exports = { collectTranscriptSources };
