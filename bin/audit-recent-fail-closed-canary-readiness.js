#!/usr/bin/env node

const { readFileSync } = require("node:fs");

function readFlagValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flagName} expects a value`);
  return value;
}

function readNonNegativeNumber(argv, index, flagName) {
  const value = Number(readFlagValue(argv, index, flagName));
  if (!Number.isFinite(value) || value < 0) throw new Error(`${flagName} expects a non-negative number`);
  return value;
}

function parseArgs(argv = []) {
  const options = { evidenceWindowPath: null, shadowReportPath: null, thresholds: {}, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--evidence-window") {
      options.evidenceWindowPath = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--shadow-report") {
      options.shadowReportPath = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--minimum-window-days") {
      options.thresholds.minimum_window_days = readNonNegativeNumber(argv, index, arg);
      index += 1;
    } else if (arg === "--minimum-observations") {
      options.thresholds.minimum_observations = readNonNegativeNumber(argv, index, arg);
      index += 1;
    } else if (arg === "--minimum-surface-observations") {
      options.thresholds.minimum_surface_observations = readNonNegativeNumber(argv, index, arg);
      index += 1;
    } else if (arg === "--max-candidate-loss-ratio") {
      options.thresholds.max_candidate_loss_ratio = readNonNegativeNumber(argv, index, arg);
      index += 1;
    } else if (arg === "--max-high-risk-events") {
      options.thresholds.max_high_risk_events = readNonNegativeNumber(argv, index, arg);
      index += 1;
    } else if (arg === "--max-medium-risk-events") {
      options.thresholds.max_medium_risk_events = readNonNegativeNumber(argv, index, arg);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
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
  node bin/audit-recent-fail-closed-canary-readiness.js
      [--evidence-window <path.json>] [--shadow-report <path.json>]
      [--minimum-window-days <n>]
      [--minimum-observations <n>]
      [--minimum-surface-observations <n>]
      [--max-candidate-loss-ratio <n>]
      [--max-high-risk-events <n>]
      [--max-medium-risk-events <n>]

This command reads JSON reports only. It never opens a database or runtime connection.`;
}

function exitCodeForDecision(decisionClass) {
  if (decisionClass === "ready_for_canary") return 0;
  if (decisionClass === "insufficient_evidence") return 1;
  return 2;
}

async function auditRecentFailClosedCanaryReadiness(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage() };
  const { evaluateRecentFailClosedCanaryReadiness } = await import(
    "../lib/recall/hybrid/recent-fail-closed-canary-readiness.js"
  );
  const report = evaluateRecentFailClosedCanaryReadiness({
    evidenceWindow: loadJson(options.evidenceWindowPath, "evidence window"),
    shadowMetrics: loadJson(options.shadowReportPath, "shadow report"),
    thresholds: options.thresholds,
  });
  return {
    exitCode: exitCodeForDecision(report.decision.class),
    output: JSON.stringify(report, null, 2),
    report,
  };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await auditRecentFailClosedCanaryReadiness(argv);
    process.stdout.write(`${result.output}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = {
  auditRecentFailClosedCanaryReadiness,
  exitCodeForDecision,
  parseArgs,
  usage,
};
