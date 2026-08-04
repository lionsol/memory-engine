const {
  contentToText,
  normalizeWhitespace,
} = require("./raw-log-normalization");

function getEntryText(entry) {
  if (!entry) return "";
  if (typeof entry.output === "string") return entry.output;
  if (typeof entry.result === "string") return entry.result;
  if (typeof entry.stdout === "string") return entry.stdout;
  if (typeof entry.stderr === "string") return entry.stderr;
  if (typeof entry.text === "string") return entry.text;
  if (entry.message && typeof entry.message.content === "string") return entry.message.content;
  if (entry.message && Array.isArray(entry.message.content)) return contentToText(entry.message.content);
  return "";
}

function getToolName(entry) {
  return String(
    entry?.tool_name
    || entry?.toolName
    || entry?.name
    || entry?.tool
    || entry?.command_name
    || entry?.commandName
    || entry?.metadata?.tool_name
    || entry?.metadata?.toolName
    || ""
  ).trim();
}

function getToolCommand(entry) {
  return String(
    entry?.command
    || entry?.argv
    || entry?.input
    || entry?.args
    || entry?.metadata?.command
    || ""
  ).trim();
}

function countMatches(text, pattern) {
  const matches = String(text || "").match(pattern);
  return matches ? matches.length : 0;
}

function summarizeTestToolResult(toolName, toolCommand, outputText) {
  const combined = `${toolName} ${toolCommand} ${outputText}`.toLowerCase();
  if (!/\b(test|jest|mocha|tap|vitest|node --test|npm test|xargs -0 node --test)\b/.test(combined)) return null;

  const explicitPass = String(outputText).match(/#\s*pass\s+(\d+)/i);
  const explicitFail = String(outputText).match(/#\s*fail\s+(\d+)/i);
  const pass = explicitPass ? Number(explicitPass[1]) : countMatches(outputText, /(^|\n)(ok\s+\d+\s+-|PASS\b)/gmi);
  const fail = explicitFail ? Number(explicitFail[1]) : countMatches(outputText, /(^|\n)(not ok\s+\d+\s+-|FAIL\b)/gmi);
  const skipped = countMatches(outputText, /\bskipped\b/gmi);
  const todo = countMatches(outputText, /\btodo\b/gmi);
  const durationMatch = String(outputText).match(/duration_ms(?:[:=]|\s)\s*([0-9.]+)/i);
  const fragments = [`tests pass=${pass}`];
  if (fail > 0) fragments.push(`fail=${fail}`);
  if (skipped > 0) fragments.push(`skipped=${skipped}`);
  if (todo > 0) fragments.push(`todo=${todo}`);
  if (durationMatch) fragments.push(`duration_ms=${durationMatch[1]}`);
  return `Tool summary: ${fragments.join(", ")}`;
}

function summarizeGitToolResult(toolName, toolCommand, outputText) {
  const combined = `${toolName} ${toolCommand}`.toLowerCase();
  if (!/\bgit\b/.test(combined)) return null;

  const branchMatch = String(outputText).match(/^\*\s+([^\s]+)/m)
    || String(outputText).match(/\bOn branch\s+([^\s]+)/i)
    || String(outputText).match(/\b##\s+([^\s.]+)/);
  const commitMatch = String(outputText).match(/\bcommit\s+([0-9a-f]{7,40})\b/i)
    || String(outputText).match(/\b([0-9a-f]{7,40})\s+-\s+/i);
  const modified = countMatches(outputText, /^\s*[AMDRC?]{1,2}\s+/gm)
    || countMatches(outputText, /\bmodified:\s+/gmi);
  const untracked = countMatches(outputText, /\buntracked files?:/gmi) || countMatches(outputText, /^\?\?\s+/gm);
  const aheadBehind = String(outputText).match(/\bahead (\d+).+behind (\d+)/i)
    || String(outputText).match(/\[(ahead \d+[^\]]*)\]/i);

  const fragments = [];
  if (branchMatch) fragments.push(`branch=${branchMatch[1]}`);
  if (commitMatch) fragments.push(`commit=${commitMatch[1].slice(0, 12)}`);
  if (modified > 0) fragments.push(`modified=${modified}`);
  if (untracked > 0) fragments.push(`untracked=${untracked}`);
  if (aheadBehind) fragments.push(`status=${aheadBehind[1]}`);
  if (fragments.length === 0) return "Tool summary: git command ran";
  return `Tool summary: git ${fragments.join(", ")}`;
}

function summarizeDoctorToolResult(toolName, toolCommand, outputText) {
  const combined = `${toolName} ${toolCommand} ${outputText}`.toLowerCase();
  if (!/\b(doctor|status|healthcheck|health check)\b/.test(combined)) return null;

  const warningCount = countMatches(outputText, /\bwarning\b|⚠️|warn:/gmi);
  const errorCount = countMatches(outputText, /\berror\b|❌|fail(ed)?:/gmi);
  const keyWarnings = String(outputText)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /\bwarning\b|⚠️|warn:|error|❌/i.test(line))
    .slice(0, 2)
    .map((line) => normalizeWhitespace(line).slice(0, 120));
  const fragments = [`warnings=${warningCount}`, `errors=${errorCount}`];
  if (keyWarnings.length > 0) fragments.push(`highlights=${keyWarnings.join(" | ")}`);
  return `Tool summary: doctor ${fragments.join(", ")}`;
}

function summarizeCheckpointDryRunResult(outputText) {
  if (!/\[checkpoint\]\s+Input stats/i.test(outputText) && !/\[checkpoint\]\s+Dry run summary/i.test(outputText)) return null;

  let inputStats = null;
  let dryRunSummary = null;
  const inputMatch = String(outputText).match(/\[checkpoint\]\s+Input stats\s+(\{.+\})/);
  const summaryMatch = String(outputText).match(/\[checkpoint\]\s+Dry run summary\s+(\{.+\})/);
  try {
    if (inputMatch) inputStats = JSON.parse(inputMatch[1]);
  } catch (_) {}
  try {
    if (summaryMatch) dryRunSummary = JSON.parse(summaryMatch[1]);
  } catch (_) {}
  if (!inputStats && !dryRunSummary) return null;

  const targetDate = dryRunSummary?.targetDate || inputStats?.targetDate;
  const combinedChars = dryRunSummary?.combinedTextCharCount || inputStats?.finalCombinedTextCharCount;
  const rawCount = dryRunSummary?.rawCount;
  const droppedBudget = inputStats?.droppedByBudgetCount;
  const budgetApplied = inputStats?.budgetApplied;
  const fragments = [];
  if (targetDate) fragments.push(`targetDate=${targetDate}`);
  if (rawCount !== undefined) fragments.push(`rawCount=${rawCount}`);
  if (combinedChars !== undefined) fragments.push(`combinedChars=${combinedChars}`);
  if (budgetApplied !== undefined) fragments.push(`budgetApplied=${budgetApplied}`);
  if (droppedBudget !== undefined) fragments.push(`droppedByBudget=${droppedBudget}`);
  return `Tool summary: checkpoint dry-run ${fragments.join(", ")}`;
}

function compactToolResult(entry) {
  const toolName = getToolName(entry);
  const toolCommand = getToolCommand(entry);
  const outputText = getEntryText(entry);
  if (!outputText.trim()) return null;

  return summarizeCheckpointDryRunResult(outputText)
    || summarizeTestToolResult(toolName, toolCommand, outputText)
    || summarizeGitToolResult(toolName, toolCommand, outputText)
    || summarizeDoctorToolResult(toolName, toolCommand, outputText);
}

module.exports = {
  getEntryText,
  getToolName,
  getToolCommand,
  summarizeTestToolResult,
  summarizeGitToolResult,
  summarizeDoctorToolResult,
  summarizeCheckpointDryRunResult,
  compactToolResult,
};
