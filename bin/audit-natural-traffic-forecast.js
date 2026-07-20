#!/usr/bin/env node

const { readFileSync, writeFileSync } = require("node:fs");
const { loadObservationReports } = require("./lib/observation-report-input.js");

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const options = { observations: [], thresholds: null, asOf: undefined, out: null, pretty: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--pretty") options.pretty = true;
    else if (arg === "--observations") { options.observations.push(readValue(argv, index, arg)); index += 1; }
    else if (arg === "--thresholds") { options.thresholds = readValue(argv, index, arg); index += 1; }
    else if (arg === "--as-of") { options.asOf = readValue(argv, index, arg); index += 1; }
    else if (arg === "--out") { options.out = readValue(argv, index, arg); index += 1; }
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help && options.observations.length === 0) throw new Error("at least one --observations path is required");
  return options;
}

function loadObject(path) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("thresholds JSON must be an object");
  return value;
}

function usage() {
  return `Usage:\n  node bin/audit-natural-traffic-forecast.js\n    --observations <observations.json|observations.jsonl> [--observations <more>...]\n    [--thresholds <thresholds.json>] [--as-of <canonical-UTC-ISO>]\n    [--out <forecast.json>] [--pretty]\n\nOperator probes, scheduled healthchecks, CLI rows, synthetic rows, and unknown origin never satisfy the natural denominator.`;
}

async function auditNaturalTrafficForecastCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage(), report: null, out: null };
  const { buildNaturalTrafficForecast } = await import("../lib/recall/hybrid/natural-traffic-forecast.js");
  const report = buildNaturalTrafficForecast({
    observations: loadObservationReports(options.observations),
    thresholds: options.thresholds ? loadObject(options.thresholds) : undefined,
    asOf: options.asOf,
  });
  const output = `${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`;
  if (options.out) writeFileSync(options.out, output, "utf8");
  return { exitCode: report.ready ? 0 : 2, output, report, out: options.out };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await auditNaturalTrafficForecastCli(argv);
    if (!result.out || result.report === null) process.stdout.write(result.output);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 64;
  }
}

module.exports = { parseArgs, auditNaturalTrafficForecastCli, main };

if (require.main === module) main();
