const {
  buildDedupeKey,
  rankLogEntry,
} = require("./raw-log-normalization");

function compareCollectedEntries(left, right) {
  if (left.timestampMs !== null && right.timestampMs !== null && left.timestampMs !== right.timestampMs) {
    return left.timestampMs - right.timestampMs;
  }
  if (left.timestampMs !== null && right.timestampMs === null) return -1;
  if (left.timestampMs === null && right.timestampMs !== null) return 1;
  return left._index - right._index;
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

  return Array.from(bestByKey.values()).sort(compareCollectedEntries);
}

module.exports = {
  compareCollectedEntries,
  dedupeCollectedLogs,
};
