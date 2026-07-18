#!/usr/bin/env node

const { readFileSync } = require("node:fs");

function readFlagValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flagName} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const options = { runtimeReportPath: null, shadowReportPath: null, thresholdsPath: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--runtime-report") {
      options.runtimeReportPath = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--shadow-report") {
      options.shadowReportPath = readFlagValue(argv, index, arg);
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
  node bin/audit-recent-fail-closed-canary-review.js
      [--runtime-report <path.json>] [--shadow-report <path.json>]
      [--thresholds <path.json>]

This command reads JSON reports only. It never opens a database or runtime connection.`;
}

function exitCodeForStatus(status) {
  if (status === "healthy") return 0;
  if (status === "insufficient_data") return 1;
  if (status === "rollback_required") return 2;
  return 3;
}

async function auditRecentFailClosedCanaryReview(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage() };
  const { evaluateRecentFailClosedCanaryReview } = await import(
    "../lib/recall/hybrid/recent-fail-closed-canary-review.js"
  );
  const report = evaluateRecentFailClosedCanaryReview({
    runtimeMetrics: loadJson(options.runtimeReportPath, "runtime report"),
    shadowMetrics: loadJson(options.shadowReportPath, "shadow report"),
    thresholds: loadJson(options.thresholdsPath, "thresholds"),
  });
  return { exitCode: exitCodeForStatus(report.status), output: JSON.stringify(report, null, 2), report };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await auditRecentFailClosedCanaryReview(argv);
    process.stdout.write(`${result.output}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 3;
  }
}

if (require.main === module) main();

module.exports = {
  auditRecentFailClosedCanaryReview,
  exitCodeForStatus,
  parseArgs,
  usage,
};
