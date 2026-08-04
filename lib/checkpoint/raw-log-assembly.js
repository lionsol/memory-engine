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

function debugOtherBucket(budgetedEntries, stats, { inferRoleKey, logger = console } = {}) {
  const metaEntries = budgetedEntries.filter((entry) => inferRoleKey(entry) === "metadata_header");
  if (metaEntries.length === 0) return;

  const sourceBreakdown = {};
  for (const entry of metaEntries) {
    const sourceKind = entry.sourceKind || "unknown";
    sourceBreakdown[sourceKind] = (sourceBreakdown[sourceKind] || 0) + 1;
  }

  const samples = metaEntries
    .slice(0, 5)
    .map((entry) => {
      const preview = String(entry.text || "").replace(/\n/g, " ").slice(0, 120);
      return `  [${entry.sourceKind || "?"}] role=${entry.role || "?"} ${preview}`;
    })
    .join("\n");

  logger.log(`[checkpoint] debug metadata_header bucket: count=${metaEntries.length}, chars=${metaEntries.reduce((sum, entry) => sum + String(entry.text || "").length, 0)}`);
  logger.log(`[checkpoint]   sourceBreakdown: ${JSON.stringify(sourceBreakdown)}`);
  logger.log(`[checkpoint]   top samples:\n${samples}`);
}

function createRawLogReader({
  getRuntime,
  yesterdayDateStr,
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
  logger = console,
}) {
  return function readCheckpointRawLogs(options = {}) {
    const runtime = getRuntime();
    const timeZone = options.timeZone || runtime.timeZone;
    const targetDate = options.targetDate || yesterdayDateStr(runtime.now(), timeZone);
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
    debugOtherBucket(budgetedEntries, stats, { inferRoleKey, logger });

    const logs = budgetedEntries.map((entry) => ({
      category: entry.category,
      text: entry.text,
      source: entry.source,
      chunk_id: entry.chunk_id,
    }));
    stats.finalCombinedTextCharCount = stats.charsAfterBudget;
    return attachStats(logs, stats);
  };
}

module.exports = {
  attachStats,
  createRawLogReader,
  debugOtherBucket,
  getRawLogCollectionStats,
};
