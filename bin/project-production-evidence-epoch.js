#!/usr/bin/env node

const { readFileSync, writeFileSync } = require("node:fs");
const { loadObservationReports } = require("./lib/observation-report-input.js");

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const options = {
    observations: [],
    baseline: null,
    asOf: undefined,
    selectedOut: null,
    reportOut: null,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--pretty") options.pretty = true;
    else if (arg === "--observations") { options.observations.push(readValue(argv, index, arg)); index += 1; }
    else if (arg === "--baseline") { options.baseline = readValue(argv, index, arg); index += 1; }
    else if (arg === "--as-of") { options.asOf = readValue(argv, index, arg); index += 1; }
    else if (arg === "--selected-out") { options.selectedOut = readValue(argv, index, arg); index += 1; }
    else if (arg === "--report-out") { options.reportOut = readValue(argv, index, arg); index += 1; }
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help && options.observations.length === 0) throw new Error("at least one --observations path is required");
  if (!options.help && !options.baseline) throw new Error("--baseline is required");
  return options;
}

function loadObject(path, label) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function serializeJsonl(rows) {
  return rows.length > 0 ? `${rows.map(row => JSON.stringify(row)).join("\n")}\n` : "";
}

function usage() {
  return `Usage:\n  node bin/project-production-evidence-epoch.js\n    --observations <raw.json|raw.jsonl> [--observations <more>...]\n    --baseline <baseline.json> [--as-of <canonical-UTC-ISO>]\n    [--selected-out <canonical.jsonl>] [--report-out <projection.json>] [--pretty]\n\nThe raw input remains authoritative. The projection reports every blocking rejection instead of silently filtering mixed, malformed, or out-of-window evidence.`;
}

function exitCode(status) {
  if (status === "ready") return 0;
  if (status === "insufficient_evidence") return 1;
  if (status === "blocked") return 2;
  return 64;
}

async function projectProductionEvidenceEpochCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage(), report: null, out: null };
  const { projectProductionEvidenceEpoch } = await import("../lib/recall/hybrid/production-evidence-epoch-export.js");
  const result = projectProductionEvidenceEpoch({
    observations: loadObservationReports(options.observations),
    baseline: loadObject(options.baseline, "baseline"),
    asOf: options.asOf,
  });
  if (options.selectedOut) writeFileSync(options.selectedOut, serializeJsonl(result.selectedRows), "utf8");
  const output = `${JSON.stringify(result.report, null, options.pretty ? 2 : 0)}\n`;
  if (options.reportOut) writeFileSync(options.reportOut, output, "utf8");
  return { exitCode: exitCode(result.report.status), output, report: result.report, out: options.reportOut };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await projectProductionEvidenceEpochCli(argv);
    if (!result.out || result.report === null) process.stdout.write(result.output);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 64;
  }
}

module.exports = { parseArgs, serializeJsonl, projectProductionEvidenceEpochCli, main };

if (require.main === module) main();
