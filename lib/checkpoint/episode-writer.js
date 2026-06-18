const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { getRuntime } = require("./runtime");

function writeEpisodeFiles({ episodeDate, generatedAt, episodeText, configs }) {
  const episodeDir = getRuntime().episodesDir;
  const episodePath = resolve(episodeDir, `${episodeDate}.md`);
  mkdirSync(episodeDir, { recursive: true });
  writeFileSync(episodePath, [
    `# Episode: ${episodeDate}`,
    "",
    `targetDate: ${episodeDate}`,
    `generatedAt: ${generatedAt}`,
    "category: episodic",
    "source_type: checkpoint_llm",
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

  const dailyDir = getRuntime().memoryDir;
  const dailyPath = resolve(dailyDir, `${episodeDate}.md`);
  mkdirSync(dailyDir, { recursive: true });
  if (!existsSync(dailyPath)) {
    writeFileSync(dailyPath, `# ${episodeDate}\n\n${episodeText}\n\n`);
  }

  console.log(`[checkpoint] Episode written: ${episodeText.slice(0, 80)}...`);
}

module.exports = {
  writeEpisodeFiles,
};
