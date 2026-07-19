#!/usr/bin/env node

const { readFileSync } = require("node:fs");

const THRESHOLD_FLAGS = Object.freeze({
  "--minimum-window-days": "minimum_window_days",
  "--minimum-active-utc-days": "minimum_active_utc_days",
  "--minimum-active-day-ratio": "minimum_active_day_ratio",
  "--maximum-observation-gap-hours": "maximum_observation_gap_hours",
  "--minimum-observations": "minimum_observations",
  "--minimum-surface-observations": "minimum_surface_observations",
  "--minimum-surface-active-days": "minimum_surface_active_days",
});

function readFlagValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flagName} expects a value`);
  return value;
}

function parseNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${flagName} expects a finite non-negative number`);
  return parsed;
}

function parseArgs(argv = []) {
  const options = { observationsPath: null, thresholdsPath: null, thresholds: {}, pretty: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--pretty") options.pretty = true;
    else if (arg === "--observations") {
      options.observationsPath = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--thresholds") {
      options.thresholdsPath = readFlagValue(argv, index, arg);
      index += 1;
    } else if (Object.hasOwn(THRESHOLD_FLAGS, arg)) {
      options.thresholds[THRESHOLD_FLAGS[arg]] = parseNumber(readFlagValue(argv, index, arg), arg);
      index += 1;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help && !options.observationsPath) throw new Error("--observations is required");
  return options;
}

function loadJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`failed to read ${label}: ${error.message}`);
  }
}

function loadObservations(path) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`failed to read observations: ${error.message}`);
  }
  const parseJsonLines = () => source.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`invalid observation JSONL at line ${index + 1}: ${error.message}`);
    }
  });
  if (path.toLowerCase().endsWith(".jsonl")) return parseJsonLines();
  try {
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) throw new Error("observations JSON must be an array");
    return parsed;
  } catch (error) {
    if (/Unexpected end|Unexpected token|JSON parse/i.test(String(error?.message || error))) return parseJsonLines();
    throw error;
  }
}

function exitCodeForStatus(status) {
  if (status === "continuity_ready") return 0;
  if (status === "continuity_collecting" || status === "continuity_incomplete") return 1;
  if (status === "blocked") return 2;
  return 64;
}

function usage() {
  return `Usage:
  node bin/audit-production-evidence-continuity.js
      --observations <observations.json|observations.jsonl>
      [--thresholds <thresholds.json>] [--pretty]
      [--minimum-window-days <number>]
      [--minimum-active-utc-days <number>]
      [--minimum-active-day-ratio <number>]
      [--maximum-observation-gap-hours <number>]
      [--minimum-observations <number>]
      [--minimum-surface-observations <number>]
      [--minimum-surface-active-days <number>]

This command reads observation reports only. It never opens a database or changes rollout configuration.`;
}

async function auditProductionEvidenceContinuity(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage(), report: null };
  const thresholds = options.thresholdsPath
    ? { ...loadJson(options.thresholdsPath, "thresholds JSON"), ...options.thresholds }
    : options.thresholds;
  const { evaluateProductionEvidenceContinuity } = await import(
    "../lib/recall/hybrid/production-evidence-continuity.js"
  );
  const report = evaluateProductionEvidenceContinuity({
    observations: loadObservations(options.observationsPath),
    thresholds,
  });
  return {
    exitCode: exitCodeForStatus(report.status),
    output: JSON.stringify(report, null, options.pretty ? 2 : 0),
    report,
  };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await auditProductionEvidenceContinuity(argv);
    process.stdout.write(`${result.output}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 64;
  }
}

if (require.main === module) main();

module.exports = {
  auditProductionEvidenceContinuity,
  exitCodeForStatus,
  loadObservations,
  parseArgs,
  usage,
};
