#!/usr/bin/env node

const { readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

function writeStdout(value = "") {
  writeFileSync(process.stdout.fd, `${value}\n`, "utf8");
}

function writeStderr(value = "") {
  writeFileSync(process.stderr.fd, `${value}\n`, "utf8");
}

const DEFAULT_DATASET = "test/fixtures/auto-recall-turn-gold-set.seed.jsonl";

function printHelp() {
  console.log(`Run AutoRecall Turn Gold Set Replay

Usage:
  node bin/run-turn-gold-set-replay.js [options]

Options:
  --dataset <path>   JSONL dataset path, default: ${DEFAULT_DATASET}
  --json             Print full JSON replay + feedback + expansion-plan report
  --summary          Print compact summary only
  --help             Show this help

Notes:
  - Read-only replay, mismatch feedback, and expansion-plan preview
  - Does not run retrieval, inject memory, write DB, mutate memory files, reinforce, call LLM, or access network
  - No runtime report files are written by this command
`);
}

function parseArgs(argv = []) {
  const options = {
    dataset: DEFAULT_DATASET,
    json: false,
    summary: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "help") {
      options.help = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--summary") {
      options.summary = true;
      continue;
    }
    if (arg === "--dataset") {
      const value = argv[i + 1];
      if (!value) throw new Error("--dataset requires a path");
      options.dataset = value;
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!options.json && !options.summary) options.summary = true;
  if (options.json && options.summary) throw new Error("choose exactly one output format: --json or --summary");
  return options;
}

function compactReport(report, datasetPath) {
  return {
    dataset: datasetPath,
    replay: report.replay.summary,
    feedback: report.feedback.summary,
    expansion_plan: report.expansion_plan.summary,
    side_effects: report.expansion_plan.side_effects,
  };
}

function renderSummary(report, datasetPath) {
  const lines = [
    "# AutoRecall Turn Gold Set Replay",
    "",
    `- dataset: ${datasetPath}`,
    `- replay_total: ${report.replay.summary.total_count}`,
    `- replay_passed: ${report.replay.summary.passed_count}`,
    `- replay_failed: ${report.replay.summary.failed_count}`,
    `- replay_pass_rate: ${report.replay.summary.pass_rate}`,
    `- feedback_clusters: ${report.feedback.summary.cluster_count}`,
    `- expansion_candidates: ${report.expansion_plan.summary.candidate_count}`,
  ];

  if (report.feedback.clusters.length > 0) {
    lines.push("", "## Feedback Clusters", "");
    for (const cluster of report.feedback.clusters) {
      lines.push(`- ${cluster.category}: ${cluster.count} turn(s)`);
      lines.push(`  suggestion: ${cluster.suggestion.suggested_action}`);
    }
  }

  if (report.expansion_plan.candidates.length > 0) {
    lines.push("", "## Expansion Candidates", "");
    for (const candidate of report.expansion_plan.candidates) {
      lines.push(`- ${candidate.candidate_id}: ${candidate.suggested_dataset_action}`);
      lines.push(`  status: ${candidate.status}`);
    }
  }

  lines.push("", "## Side Effects", "");
  for (const [key, value] of Object.entries(report.expansion_plan.side_effects || {})) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function runReplay(options) {
  const { replayTurnGoldSetJsonlWithFeedback } = await import("../lib/recall/auto-recall-turn-gold-set.js");
  const datasetPath = resolve(process.cwd(), options.dataset);
  const content = readFileSync(datasetPath, "utf8");
  const report = replayTurnGoldSetJsonlWithFeedback(content);
  return { datasetPath, report };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      printHelp();
      return 0;
    }
    const { datasetPath, report } = await runReplay(options);
    const output = options.json
      ? JSON.stringify({ dataset: datasetPath, ...report }, null, 2)
      : renderSummary(report, datasetPath);
    writeStdout(output);
    return report.replay.summary.failed_count === 0 ? 0 : 1;
  } catch (error) {
    writeStderr(String(error?.message || error));
    return 1;
  }
}

module.exports = {
  DEFAULT_DATASET,
  parseArgs,
  compactReport,
  renderSummary,
  runReplay,
  main,
};

if (process.argv[1] && /run-turn-gold-set-replay\.js$/.test(process.argv[1])) {
  main().then(code => {
    process.exitCode = code;
  });
}
