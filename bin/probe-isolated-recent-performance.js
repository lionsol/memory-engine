#!/usr/bin/env node

const { resolve } = require("node:path");

const MUTATION_FLAGS = new Set([
  "--apply",
  "--force",
  "--write-db",
  "--delete",
  "--update",
  "--insert",
  "--repair",
  "--migrate",
  "--no-backup",
]);

function readFlagValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flagName} expects a value`);
  return value;
}

function usage() {
  return `Usage:
  node bin/probe-isolated-recent-performance.js [--json] [--out <path>] [--help]

Notes:
  - Isolated Recent performance probe is read-only.
  - It uses synthetic SQLite fixtures only.
  - It never touches production Recent, real DBs, or runtime capability defaults.`;
}

function parseArgs(argv = []) {
  const options = {
    json: false,
    out: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h" || arg === "help") {
      options.help = true;
      continue;
    }
    if (MUTATION_FLAGS.has(arg)) {
      throw new Error(`Isolated Recent performance probe is read-only; rejected mutation flag: ${arg}`);
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--out") {
      options.out = resolve(readFlagValue(argv, index, "--out"));
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!options.json) options.json = true;
  return options;
}

function exitCodeForDecision(decisionClass) {
  if (decisionClass === "fail") return 2;
  if (decisionClass === "inconclusive") return 3;
  return 0;
}

async function probeIsolatedRecentPerformance(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage() };

  const probe = deps.probe || await import("../lib/recall/hybrid/recent-performance-probe.js");
  const report = await probe.runRecentPerformanceProbe();
  const output = JSON.stringify(report, null, 2);
  if (options.out) probe.writeRecentPerformanceReport(output, options.out);
  return {
    exitCode: exitCodeForDecision(report.decision.class),
    output,
    report,
  };
}

if (require.main === module) {
  probeIsolatedRecentPerformance()
    .then(result => {
      if (result.output) process.stdout.write(`${result.output}\n`);
      process.exit(result.exitCode);
    })
    .catch(error => {
      process.stderr.write(`${error.message || error}\n`);
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  probeIsolatedRecentPerformance,
  usage,
};
