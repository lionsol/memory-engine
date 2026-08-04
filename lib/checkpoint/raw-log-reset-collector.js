function createResetTranscriptCollector({
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
  toolResultTypes,
  logger = console,
}) {
  const resultTypes = toolResultTypes instanceof Set
    ? toolResultTypes
    : new Set(toolResultTypes || []);

  function shouldConsiderResetFile(fileName, stats, sessionsDir) {
    if (fileName.includes(".trajectory.")) return false;
    if (!fileName.includes(".jsonl.reset.")) return false;
    const filePath = resolve(sessionsDir, fileName);
    try {
      statSync(filePath);
    } catch (_) {
      stats.skippedResetFileCount += 1;
      stats.droppedNoise.statFailure += 1;
      return false;
    }
    return { filePath };
  }

  return function collectSessionTranscriptLogs(targetDate, timeZone, range, stats, options = {}) {
    const rt = getRuntime();
    const collected = [];
    stats.resetDirectParseEnabled = options.resetDirectParseEnabled === true;
    if (!stats.resetDirectParseEnabled) return collected;
    if (!existsSync(rt.sessionsDir)) return collected;

    try {
      const allFiles = readdirSync(rt.sessionsDir);
      const sessionFiles = [];
      for (const fileName of allFiles) {
        const decision = shouldConsiderResetFile(fileName, stats, rt.sessionsDir);
        if (decision) sessionFiles.push({ fileName, ...decision });
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

          if (resultTypes.has(String(entry?.type || "")) || entry?.message?.role === "tool") {
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
              const sessionId = extractSessionId(entry, file.fileName);
              const summaryText = formatToolSummaryText({
                body: compactSummary,
                timestampMs,
                sessionId,
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
                sessionId,
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

          const sessionId = extractSessionId(entry, file.fileName);
          const text = formatDialogueText({ role, body, timestampMs, sessionId });
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
            sessionId,
          });
        }
      }

      if (sessionFiles.length > 0) {
        logger.log(`[checkpoint] Scanned ${sessionFiles.length} session files for targetDate ${targetDate} (${timeZone})`);
      }
    } catch (error) {
      logger.error("[checkpoint] Reset file scan warning:", error.message);
    }

    return collected;
  };
}

module.exports = {
  createResetTranscriptCollector,
};
