const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { getRuntime } = require("./runtime");

function currentIsoString() {
  return new Date(getRuntime().now()).toISOString();
}

function writeEmptyEpisode(today) {
  const episodeDir = getRuntime().episodesDir;
  const episodePath = resolve(episodeDir, `${today}.md`);
  mkdirSync(episodeDir, { recursive: true });
  if (!existsSync(episodePath)) {
    writeFileSync(episodePath, `# Episode: ${today}\n\ntargetDate: ${today}\ngeneratedAt: ${currentIsoString()}\ncategory: episodic\nsource_type: checkpoint_llm\n\n（无今日内容）\n\n---\n_Generated at ${currentIsoString()}_\n`);
  }
}

function writeIncompleteEpisode(today, noteCount) {
  const episodeDir = getRuntime().episodesDir;
  const episodePath = resolve(episodeDir, `${today}.md`);
  mkdirSync(episodeDir, { recursive: true });
  writeFileSync(episodePath, [
    `# Episode: ${today}`,
    "",
    `targetDate: ${today}`,
    `generatedAt: ${currentIsoString()}`,
    "category: episodic",
    "source_type: checkpoint_llm",
    "",
    "⚠️ **数据不完整 — 当日无有效对话记录**",
    "",
    `会话日志数据缺失（DB raw_log 条目为空），仅包含 ${noteCount} 条配置笔记/自动写入条目。`,
    "无足够数据生成可靠摘要，跳过 LLM 摘要生成。",
    "",
    "可能原因：",
    "- DB 损坏后从备份恢复，当天后续对话丢失",
    "- 当日仅有 cron 任务运行，无用户对话",
    "- checkpoint 运行时间早于对话发生时间",
    "",
    "---",
    `_Generated at ${currentIsoString()}_`,
    "",
  ].join("\n"));
  console.log(`[checkpoint] Incomplete-data episode marker written for ${today} (${noteCount} notes, 0 conversations)`);
}

function writeLLMTimeoutEpisode(today) {
  const episodeDir = getRuntime().episodesDir;
  const episodePath = resolve(episodeDir, `${today}.md`);
  mkdirSync(episodeDir, { recursive: true });
  writeFileSync(episodePath, `# Episode: ${today}\n\ntargetDate: ${today}\ngeneratedAt: ${currentIsoString()}\ncategory: episodic\nsource_type: checkpoint_llm\n\n⚠️ llm超时 — 当日日志未处理（SiliconFlow + DeepSeek 均不可用）\n\n---\n_Generated at ${currentIsoString()}_\n`);
  console.log("[checkpoint] LLM timeout episode marker written");
}

module.exports = {
  writeEmptyEpisode,
  writeIncompleteEpisode,
  writeLLMTimeoutEpisode,
};
