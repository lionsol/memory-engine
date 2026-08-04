function createDbRawLogCollector({
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
  membershipBatchSize = 500,
  logger = console,
}) {
  function getDbRawLogTimeSelector(coreDb) {
    const columns = new Set(
      coreDb.prepare("PRAGMA table_info(chunks)").all().map((row) => String(row.name || "")),
    );
    if (columns.has("event_at")) {
      return {
        column: "event_at",
        basis: "event_at",
        note: "event_at is the original raw-log event time; rows with NULL event_at are not recovered from updated_at",
      };
    }
    if (columns.has("created_at")) {
      return {
        column: "created_at",
        basis: "created_at_legacy_event_time",
        note: "legacy schema only: created_at is used as event time only when event_at is absent",
      };
    }
    return {
      column: "updated_at",
      basis: "updated_at_event_time",
      note: "legacy core chunks has no event_at column; updated_at must contain the raw-log event timestamp, not the flush/update time",
    };
  }

  function chunkItems(items, batchSize = membershipBatchSize) {
    const chunks = [];
    for (let index = 0; index < items.length; index += batchSize) {
      chunks.push(items.slice(index, index + batchSize));
    }
    return chunks;
  }

  function collectRawLogIds(engineDb, chunkIds) {
    const rawLogIds = new Set();
    for (const batch of chunkItems(chunkIds)) {
      if (batch.length === 0) continue;
      const placeholders = batch.map(() => "?").join(", ");
      const rows = engineDb.prepare(`
        SELECT chunk_id
        FROM memory_confidence
        WHERE category = 'raw_log'
          AND chunk_id IN (${placeholders})
      `).all(...batch);
      for (const row of rows) rawLogIds.add(String(row.chunk_id || ""));
    }
    return rawLogIds;
  }

  function countNullEventAtRawLogs(coreDb, rawLogIds) {
    let missingCount = 0;
    for (const batch of chunkItems(Array.from(rawLogIds))) {
      if (batch.length === 0) continue;
      const placeholders = batch.map(() => "?").join(", ");
      const row = coreDb.prepare(`
        SELECT COUNT(*) AS c
        FROM chunks
        WHERE event_at IS NULL
          AND id IN (${placeholders})
      `).get(...batch);
      missingCount += Number(row?.c || 0);
    }
    return missingCount;
  }

  return function collectDbRawLogs(targetDate, timeZone, range, stats) {
    const rt = getRuntime();
    const collected = [];
    if (!existsSync(rt.engineDbPath)) return collected;

    try {
      withCheckpointDbs(({ engineDb, coreDb }) => {
        const timeSelector = getDbRawLogTimeSelector(coreDb);
        stats.rawLogTimeBasis = timeSelector.basis;
        stats.rawLogTimeBasisNote = timeSelector.note;
        stats.evidenceDateFilter = `targetDate=${targetDate}; timeZone=${timeZone}; smartAdd=memory/smart-add/${targetDate}.md; raw_log=${timeSelector.basis} bounded to targetDate`;
        const timeColumn = timeSelector.column;
        if (timeColumn === "event_at") {
          const rawLogRows = engineDb.prepare(`
            SELECT chunk_id
            FROM memory_confidence
            WHERE category = 'raw_log'
          `).all();
          stats.rawLogMissingEventAt = countNullEventAtRawLogs(
            coreDb,
            new Set(rawLogRows.map((row) => String(row.chunk_id || ""))),
          );
        }
        const coreRows = coreDb.prepare(
          `SELECT id, text, ${timeColumn} AS raw_log_time
           FROM chunks
           WHERE (
               (${timeColumn} >= @startSec AND ${timeColumn} < @endSec)
               OR
               (${timeColumn} >= @startMs AND ${timeColumn} < @endMs)
             )
           ORDER BY CASE
             WHEN ${timeColumn} >= 1000000000000 THEN ${timeColumn}
             ELSE ${timeColumn} * 1000
           END ASC, id ASC`
        ).all({
          startSec: range.startSec,
          endSec: range.endSec,
          startMs: range.startMs,
          endMs: range.endMs,
        });
        const rawLogIds = collectRawLogIds(
          engineDb,
          coreRows.map((row) => String(row.id || "")),
        );
        const rows = coreRows.filter((row) => rawLogIds.has(String(row.id || "")));

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
            : buildDedupeKey("raw_log", body);
          stats.sourceCounts.dbRawLog += 1;
          stats.sourceCharCountsBefore.dbRawLog += body.length;
          stats.rawLogIncluded += 1;
          collected.push({
            category: "raw_log",
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
      }, { readonlyEngine: true });
    } catch (error) {
      logger.error("[checkpoint] DB read warning:", error.message);
    }

    return collected;
  };
}

module.exports = {
  createDbRawLogCollector,
};
