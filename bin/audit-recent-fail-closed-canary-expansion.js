#!/usr/bin/env node

const { readFileSync } = require("node:fs");

function readFlagValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flagName} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const options = { readinessPath: null, reviewPath: null, rolloutPath: null, thresholdsPath: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--readiness-report") {
      options.readinessPath = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--review-report") {
      options.reviewPath = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--rollout-report") {
      options.rolloutPath = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--thresholds") {
      options.thresholdsPath = readFlagValue(argv, index, arg);
      index += 1;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function loadJson(path, label) {
  if (!path) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`failed to read ${label} JSON: ${error.message}`);
  }
}

function usage() {
  return `Usage:
  node bin/audit-recent-fail-closed-canary-expansion.js
      [--readiness-report <path.json>] [--review-report <path.json>]
      [--rollout-report <path.json>] [--thresholds <path.json>]

This command reads JSON reports only. It never changes rollout configuration.`;
}

function exitCodeForDecision(decision) {
  if (decision === "expand") return 0;
  if (decision === "continue_current_canary") return 1;
  if (decision === "insufficient_data") return 2;
  if (decision === "rollback") return 3;
  return 4;
}

async function auditRecentFailClosedCanaryExpansion(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage() };
  const { evaluateRecentFailClosedCanaryExpansion } = await import(
    "../lib/recall/hybrid/recent-fail-closed-canary-expansion.js"
  );
  const report = evaluateRecentFailClosedCanaryExpansion({
    readiness: loadJson(options.readinessPath, "readiness report"),
    review: loadJson(options.reviewPath, "review report"),
    rolloutMetrics: loadJson(options.rolloutPath, "rollout report"),
    thresholds: loadJson(options.thresholdsPath, "thresholds"),
  });
  return { exitCode: exitCodeForDecision(report.decision), output: JSON.stringify(report, null, 2), report };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await auditRecentFailClosedCanaryExpansion(argv);
    process.stdout.write(`${result.output}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 4;
  }
}

if (require.main === module) main();

module.exports = {
  auditRecentFailClosedCanaryExpansion,
  exitCodeForDecision,
  parseArgs,
  usage,
};
