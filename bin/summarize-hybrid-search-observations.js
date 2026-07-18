#!/usr/bin/env node

const { loadObservationReports } = require("./lib/observation-report-input.js");

function readFlagValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flagName} expects a value`);
  return value;
}

function parseNowMs(value) {
  if (value === null || value === undefined) return Date.now();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) throw new Error("--now must be an ISO timestamp or Unix milliseconds");
  return parsed;
}

function parseArgs(argv = []) {
  const options = {
    observationPaths: [],
    windowDays: 7,
    nowMs: null,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--pretty") options.pretty = true;
    else if (arg === "--observations") {
      options.observationPaths.push(readFlagValue(argv, index, arg));
      index += 1;
    } else if (arg === "--window-days") {
      options.windowDays = Number(readFlagValue(argv, index, arg));
      index += 1;
    } else if (arg === "--now") {
      options.nowMs = parseNowMs(readFlagValue(argv, index, arg));
      index += 1;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help && options.observationPaths.length === 0) throw new Error("--observations is required");
  if (!options.help && (!Number.isFinite(options.windowDays) || options.windowDays < 1)) {
    throw new Error("--window-days must be a number greater than or equal to 1");
  }
  return options;
}

function usage() {
  return `Usage:
  node bin/summarize-hybrid-search-observations.js
      --observations <observations.json|observations.jsonl> [repeatable]
      [--window-days <n>]
      [--now <ISO|unix-ms>]
      [--pretty]

This command reads JSON or JSONL observation reports only. It never opens a database, invokes Hybrid Search, or changes rollout configuration.`;
}

async function summarizeHybridSearchObservations(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage(), report: null };
  const observations = loadObservationReports(options.observationPaths);
  const { buildHybridFallbackObservabilitySummary } = await import(
    "../console/services/metrics-service.js"
  );
  const nowMs = options.nowMs ?? Date.now();
  const summary = buildHybridFallbackObservabilitySummary(observations, {
    windowDays: options.windowDays,
    nowMs,
  });
  const report = {
    schema_version: 1,
    input_row_count: observations.length,
    window_days: options.windowDays,
    evaluated_at: new Date(nowMs).toISOString(),
    summary,
  };
  return {
    exitCode: 0,
    output: JSON.stringify(report, null, options.pretty ? 2 : 0),
    report,
  };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await summarizeHybridSearchObservations(argv);
    process.stdout.write(`${result.output}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 4;
  }
}

if (require.main === module) main();

module.exports = {
  parseArgs,
  parseNowMs,
  summarizeHybridSearchObservations,
  usage,
};
