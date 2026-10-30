const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { getRuntime } = require("./runtime");
const { publishEpisode } = require("./episode-publication");

function metadataLines({ episodeDate, generatedAt, diagnostics = {} }) {
  const pairs = [
    ["targetDate", episodeDate],
    ["generatedAt", generatedAt],
    ["timeZone", diagnostics.timeZone],
    ["category", "episodic"],
    ["source_type", "checkpoint_llm"],
    ["smartAddPath", diagnostics.smartAddPath],
    ["smartAddInputPolicy", diagnostics.smartAddInputPolicy],
    ["smartAddIncluded", diagnostics.smartAddIncluded],
    ["smartAddConversationIncluded", diagnostics.smartAddConversationIncluded],
    ["smartAddSkippedUnknownProvenance", diagnostics.smartAddSkippedUnknownProvenance],
    ["smartAddSkippedCheckpointGenerated", diagnostics.smartAddSkippedCheckpointGenerated],
    ["segmentedSummary", diagnostics.segmentedSummary ? JSON.stringify(diagnostics.segmentedSummary) : undefined],
    ["ordinarySummary", diagnostics.ordinarySummary ? JSON.stringify(diagnostics.ordinarySummary) : undefined],
    ["derivedSummary", diagnostics.derivedSummary ? JSON.stringify(diagnostics.derivedSummary) : undefined],
    ["budgetCoverageComplete", diagnostics.budgetCoverageComplete],
    ["budgetExcludedCount", diagnostics.budgetExcludedCount],
    ["budgetTruncatedCount", diagnostics.budgetTruncatedCount],
    ["budgetUncoveredEntries", Array.isArray(diagnostics.budgetUncoveredEntries)
      ? JSON.stringify(diagnostics.budgetUncoveredEntries)
      : diagnostics.budgetUncoveredEntries],
    ["rawLogTimeBasis", diagnostics.rawLogTimeBasis],
    ["rawLogTimeBasisNote", diagnostics.rawLogTimeBasisNote],
    ["rawLogIncluded", diagnostics.rawLogIncluded],
    ["rawLogSkippedOutOfTargetDate", diagnostics.rawLogSkippedOutOfTargetDate],
    ["resetDirectParseEnabled", diagnostics.resetDirectParseEnabled],
    ["resetFilesScanned", diagnostics.resetFilesScanned],
    ["resetEventsIncluded", diagnostics.resetEventsIncluded],
    ["resetEventsSkippedOutOfTargetDate", diagnostics.resetEventsSkippedOutOfTargetDate],
    ["resetEventsSkippedMissingTimestamp", diagnostics.resetEventsSkippedMissingTimestamp],
    ["evidenceDateFilter", diagnostics.evidenceDateFilter],
  ];
  return pairs
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}: ${value}`);
}

function writeEpisodeFiles({ episodeDate, generatedAt, episodeText, configs, diagnostics = {}, publication }) {
  const runtime = getRuntime();
  const episodeDir = runtime.episodesDir;
  const episodePath = resolve(episodeDir, `${episodeDate}.md`);
  mkdirSync(episodeDir, { recursive: true });
  const published = publishEpisode(episodePath, [
    `# Episode: ${episodeDate}`,
    "",
    ...metadataLines({ episodeDate, generatedAt, diagnostics }),
    "",
    episodeText,
    "",
    configs && configs.length > 0
      ? "### 配置记忆\n" + configs.map(c => `- ${c.key} = ${c.value}（${c.context}）`).join("\n")
      : "",
    "",
    "---",
    `_Generated at ${generatedAt}_`,
    "",
  ].join("\n"), publication);

  published.mirror = { status: "disabled" };
  if (runtime.checkpointLegacyDailyMirror) {
    const dailyDir = runtime.memoryDir;
    const dailyPath = resolve(dailyDir, `${episodeDate}.md`);
    try {
      mkdirSync(dailyDir, { recursive: true });
      if (existsSync(dailyPath)) published.mirror = { status: "existing_preserved" };
      else {
        try {
          writeFileSync(dailyPath, `# ${episodeDate}\n\n${episodeText}\n\n`, { flag: "wx" });
          published.mirror = { status: "written" };
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          published.mirror = { status: "existing_preserved" };
        }
      }
    } catch (error) {
      published.mirror = { status: "failed", code: error.code || "unknown" };
      console.warn("[checkpoint] Episode published; legacy mirror failed");
    }
  }

  console.log(`[checkpoint] Episode written: chars=${episodeText.length}`);
  return published;
}

module.exports = {
  metadataLines,
  writeEpisodeFiles,
};
