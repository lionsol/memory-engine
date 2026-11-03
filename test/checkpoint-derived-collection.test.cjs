"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { getRuntime, withRuntime } = require("../lib/checkpoint/runtime");
const { nightlyCheckpoint } = require("../bin/session-checkpoint");
const { createRawLogReader } = require("../lib/checkpoint/raw-log-assembly");
const budget = require("../lib/checkpoint/raw-log-budget");
const { dedupeCollectedLogs } = require("../lib/checkpoint/raw-log-dedupe");
const { readDerivedSummary, archiveDirectory } = require("../lib/checkpoint/derived-summary");
const DATE = "2026-10-20";
function stats() {
  const chars = () => ({ smartAdd: 0, dbRawLog: 0, resetTranscript: 0 });
  return { droppedDuplicateCount: 0, droppedByBudgetCount: 0, budgetCoverageComplete: true,
    budgetApplied: false, budgetTruncatedCount: 0, budgetUncoveredEntries: [],
    sourceCharCountsAfter: chars(), charsBySourceAfterBudget: chars(),
    charsByRoleAfterBudget: { user: 0 } };
}
async function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "derived-collection-"));
  const episodesDir = path.join(root, "episodes"), episode = path.join(episodesDir, DATE + ".md");
  fs.mkdirSync(episodesDir); fs.writeFileSync(episode, "OLD");
  const entries = [
    { entryId: "long", text: "**User:** " + "完整原文".repeat(5500) + " 尾部更正：原结论已撤回。😀",
      sessionId: "same-session", dedupeKey: "long", timestampMs: 1 },
    { entryId: "later", text: "**User:** 后续补充也必须保留。",
      sessionId: "same-session", dedupeKey: "later", timestampMs: 2 },
  ].map(entry => ({ category: "raw_log", source: "conversation", sourceKind: "smartAdd",
    provenance: "session_flush", role: "user", ...entry }));
  const reader = createRawLogReader({ ...budget, getRuntime,
    yesterdayDateStr: () => DATE, getTargetDateRange: () => ({}), makeCollectorStats: stats,
    collectSmartAddLogs: () => entries.map(entry => ({ ...entry })),
    collectDbRawLogs: () => [], collectSessionTranscriptLogs: () => [], dedupeCollectedLogs,
    inferRoleKey: () => "user", logger: { log() {} } });
  let calls = 0;
  try {
    await withRuntime({ checkpointSummaryMode: "derived", workspaceDir: root, memoryDir: root,
      episodesDir, configJsonPath: path.join(root, "absent.json"),
      derivedSummaryGenerator: async request => {
        calls++;
        const packet = JSON.parse(request.prompt);
        return { summary: { version: packet.version, target_date: DATE, binding: packet.binding,
          items: [{ topic: "实验", text: "有损摘要，具体内容回读原文。",
            evidence: [packet.SOURCE.sources[0].units.at(-1)[0]], corrects: [] }] },
          generator: { model: "offline-fixture", transport: "test" } };
      } }, () => run({ entries, reader, episode, root, calls: () => calls }));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test("derived collection bypasses legacy truncation and exclusion and archives full source text", async () => {
  await fixture(async ({ entries, reader, root, calls }) => {
    const legacy = await withRuntime({ checkpointSummaryMode: "legacy" }, () => reader({ targetDate: DATE }));
    assert.equal(legacy.checkpointStats.budgetCoverageComplete, false);
    assert.equal(legacy.length, 1); assert.ok(legacy[0].text.length <= 8000);
    const logs = reader({ targetDate: DATE });
    assert.deepEqual(logs.map(log => log.text), entries.map(entry => entry.text));
    assert.equal(logs.checkpointStats.inputPolicy, "full_collected_records");
    assert.equal(logs.checkpointStats.budgetCoverageComplete, true);
    assert.equal(logs.checkpointStats.budgetApplied, false);
    const result = await nightlyCheckpoint(logs, {
      targetDate: DATE, inputReady: true, rawLogStats: logs.checkpointStats });
    assert.equal(result.publication.published, true, result.reason); assert.equal(calls(), 1);
    const directory = archiveDirectory(root);
    for (const [index, entry] of entries.entries()) {
      const original = readDerivedSummary(result.archive_id, { directory, sourceId: "s" + index });
      assert.equal(original.record.text, entry.text);
    }
    const read = readDerivedSummary(result.archive_id, { directory });
    assert.deepEqual(read.source_catalog.map(source => source.entry_id), ["long", "later"]);
  });
});
test("full collected sources still detect changes during the one generation call", async () => {
  await fixture(async ({ entries, reader, episode }) => {
    const logs = reader({ targetDate: DATE });
    const result = await withRuntime({ derivedSummaryGenerator: async () => {
      entries[1].text += " 新更正";
      return {};
    } }, () => nightlyCheckpoint(logs, {
      targetDate: DATE, inputReady: true, rawLogStats: logs.checkpointStats }));
    assert.equal(result.reason, "source_version_changed");
    assert.equal(fs.readFileSync(episode, "utf8"), "OLD");
  });
});
test("oversized derived input is batched without silently truncating the original", async () => {
  await fixture(async ({ entries, reader, episode, calls }) => {
    entries[0].text = "**User:** " + "超".repeat(205000);
    const logs = reader({ targetDate: DATE });
    assert.equal(logs[0].text, entries[0].text);
    const result = await nightlyCheckpoint(logs, {
      targetDate: DATE, inputReady: true, rawLogStats: logs.checkpointStats });
    assert.equal(result.status, "valid_summary", result.reason);
    assert.equal(calls(), 2); assert.ok(fs.readFileSync(episode, "utf8").includes("批次完成：2/2"));
  });
});
