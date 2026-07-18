#!/usr/bin/env node

const { readFileSync } = require("node:fs");

function readFlagValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flagName} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const options = { observationsPath: null, thresholdsPath: null, pretty: false, help: false };
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
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help && !options.observationsPath) throw new Error("--observations is required");
  return options;
}

function usage() {
  return `Usage:
  node bin/audit-full-fail-closed-rollout-evidence.js
      --observations <observations.json|observations.jsonl>
      [--thresholds <thresholds.json>] [--pretty]

This command reads observation reports only. It never opens a database or changes rollout configuration.`;
}

function loadJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`failed to read ${label}: ${error.message}`);
  }
}

function loadObservations(path) {
  const source = readFileSync(path, "utf8");
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
  if (status === "full_fail_closed_confirmed") return 0;
  if (status === "insufficient_evidence") return 1;
  if (status === "partial_rollout") return 2;
  if (status === "blocked") return 3;
  return 4;
}

async function auditFullFailClosedRolloutEvidence(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage() };
  const observations = loadObservations(options.observationsPath);
  const thresholds = options.thresholdsPath ? loadJson(options.thresholdsPath, "thresholds JSON") : {};
  const { buildFullFailClosedRolloutEvidence } = await import(
    "../lib/recall/hybrid/full-fail-closed-rollout-evidence.js"
  );
  const report = buildFullFailClosedRolloutEvidence({ observations, thresholds });
  return {
    exitCode: exitCodeForStatus(report.status),
    output: JSON.stringify(report, null, options.pretty ? 2 : 0),
    report,
  };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await auditFullFailClosedRolloutEvidence(argv);
    process.stdout.write(`${result.output}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 4;
  }
}

if (require.main === module) main();

module.exports = {
  auditFullFailClosedRolloutEvidence,
  exitCodeForStatus,
  loadObservations,
  parseArgs,
  usage,
};
