#!/usr/bin/env node

const { readFileSync } = require("node:fs");

function readFlagValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flagName} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const options = { observationsPath: null, pretty: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--pretty") options.pretty = true;
    else if (arg === "--observations") {
      options.observationsPath = readFlagValue(argv, index, arg);
      index += 1;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help && !options.observationsPath) throw new Error("--observations is required");
  return options;
}

function loadObservations(path) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`failed to read observations: ${error.message}`);
  }
  if (path.toLowerCase().endsWith(".jsonl")) {
    return source.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`invalid observation JSONL at line ${index + 1}: ${error.message}`);
      }
    });
  }
  try {
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) throw new Error("observations JSON must be an array");
    return parsed;
  } catch (error) {
    throw new Error(`failed to parse observations: ${error.message}`);
  }
}

function exitCodeForStatus(status) {
  if (status === "identity_ready") return 0;
  if (status === "identity_incomplete") return 1;
  if (status === "identity_mixed" || status === "blocked") return 2;
  return 64;
}

function usage() {
  return `Usage:
  node bin/audit-production-evidence-identity.js
      --observations <observations.json|observations.jsonl> [--pretty]

This command reads observation reports only and never opens a database or changes runtime configuration.`;
}

async function auditProductionEvidenceIdentity(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage() };
  const { evaluateProductionEvidenceIdentity } = await import(
    "../lib/recall/hybrid/production-evidence-identity.js"
  );
  const report = evaluateProductionEvidenceIdentity({ observations: loadObservations(options.observationsPath) });
  return {
    exitCode: exitCodeForStatus(report.status),
    output: JSON.stringify(report, null, options.pretty ? 2 : 0),
    report,
  };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await auditProductionEvidenceIdentity(argv);
    process.stdout.write(`${result.output}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 64;
  }
}

if (require.main === module) main();

module.exports = {
  auditProductionEvidenceIdentity,
  exitCodeForStatus,
  parseArgs,
  usage,
};
