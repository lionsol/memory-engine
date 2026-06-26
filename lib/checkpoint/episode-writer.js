const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { getRuntime } = require("./runtime");

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
    ["smartAddSkippedUnknownProvenance", diagnostics.smartAddSkippedUnknownProvenance],
    ["smartAddSkippedCheckpointGenerated", diagnostics.smartAddSkippedCheckpointGenerated],
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

function writeEpisodeFiles({ episodeDate, generatedAt, episodeText, configs, diagnostics = {} }) {
  const runtime = getRuntime();
  const episodeDir = runtime.episodesDir;
  const episodePath = resolve(episodeDir, `${episodeDate}.md`);
  mkdirSync(episodeDir, { recursive: true });
  writeFileSync(episodePath, [
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
  ].join("\n"));

  if (runtime.checkpointLegacyDailyMirror) {
    const dailyDir = runtime.memoryDir;
    const dailyPath = resolve(dailyDir, `${episodeDate}.md`);
    mkdirSync(dailyDir, { recursive: true });
    if (!existsSync(dailyPath)) {
      writeFileSync(dailyPath, `# ${episodeDate}\n\n${episodeText}\n\n`);
    }
  }

  console.log(`[checkpoint] Episode written: ${episodeText.slice(0, 80)}...`);
}

module.exports = {
  metadataLines,
  writeEpisodeFiles,
};
