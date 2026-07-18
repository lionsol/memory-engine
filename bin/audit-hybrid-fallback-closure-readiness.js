#!/usr/bin/env node

const { readFileSync } = require("node:fs");

function readFlagValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flagName} expects a value`);
  return value;
}

function readNonNegativeNumber(argv, index, flagName) {
  const rawValue = readFlagValue(argv, index, flagName);
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${flagName} expects a non-negative number`);
  }
  return value;
}

function parseArgs(argv = []) {
  const options = {
    metricsReport: null,
    kgReport: null,
    recentReport: null,
    thresholds: {},
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--metrics-report") {
      options.metricsReport = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--kg-report") {
      options.kgReport = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--recent-report") {
      options.recentReport = readFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--minimum-observations") {
      options.thresholds.minimum_observations = readNonNegativeNumber(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--minimum-surface-observations") {
      options.thresholds.minimum_surface_observations = readNonNegativeNumber(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--minimum-window-days") {
      options.thresholds.minimum_window_days = readNonNegativeNumber(argv, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
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

function normalizeMetrics(report) {
  return report?.hybrid_fallback_observability
    && typeof report.hybrid_fallback_observability === "object"
    ? report.hybrid_fallback_observability
    : report || {};
}

function usage() {
  return `Usage:
  node bin/audit-hybrid-fallback-closure-readiness.js
      [--metrics-report <path>] [--kg-report <path>] [--recent-report <path>]
      [--minimum-observations <n>]
      [--minimum-surface-observations <n>]
      [--minimum-window-days <n>]

This command is a read-only decision evaluator. It reads JSON reports only and never opens a database.`;
}

function exitCodeForDecision(decisionClass) {
  if (["ready_for_shadow_fail_closed", "ready_for_fail_closed_canary", "ready_for_removal"].includes(decisionClass)) return 0;
  if (decisionClass === "insufficient_evidence") return 1;
  return 2;
}

async function auditHybridFallbackClosureReadiness(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage() };
  const { evaluateHybridFallbackClosureReadiness } = await import(
    "../lib/recall/hybrid/fallback-closure-readiness.js"
  );
  const report = evaluateHybridFallbackClosureReadiness({
    hybridObservability: normalizeMetrics(loadJson(options.metricsReport, "metrics")),
    kgAudit: loadJson(options.kgReport, "KG audit"),
    recentAudit: loadJson(options.recentReport, "Recent audit"),
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
    const result = await auditHybridFallbackClosureReadiness(argv);
    process.stdout.write(`${result.output}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = {
  auditHybridFallbackClosureReadiness,
  exitCodeForDecision,
  parseArgs,
  usage,
};
