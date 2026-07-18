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
  const options = { eventsPath: null, thresholds: {}, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--events") {
      options.eventsPath = readFlagValue(argv, index, arg);
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
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function loadEvents(path) {
  if (!path) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (Array.isArray(parsed)) return parsed;
  return Array.isArray(parsed?.observations) ? parsed.observations : [];
}

function usage() {
  return `Usage:
  node bin/audit-hybrid-fallback-evidence-window.js
      --events <path.json>
      [--minimum-window-days <n>]
      [--minimum-observations <n>]
      [--minimum-surface-observations <n>]

This command reads JSON observations only. It never opens a database or runtime connection.`;
}

function exitCodeForDecision(decision) {
  if (decision === "ready") return 0;
  if (decision === "insufficient_evidence") return 1;
  return 2;
}

async function auditHybridFallbackEvidenceWindow(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage() };
  const { evaluateHybridFallbackEvidenceWindow } = await import(
    "../lib/recall/hybrid/fallback-evidence-window.js"
  );
  const snapshot = evaluateHybridFallbackEvidenceWindow({
    observations: loadEvents(options.eventsPath),
    thresholds: options.thresholds,
  });
  return {
    exitCode: exitCodeForDecision(snapshot.decision),
    output: JSON.stringify(snapshot, null, 2),
    snapshot,
  };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await auditHybridFallbackEvidenceWindow(argv);
    process.stdout.write(`${result.output}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = {
  auditHybridFallbackEvidenceWindow,
  exitCodeForDecision,
  parseArgs,
  usage,
};
