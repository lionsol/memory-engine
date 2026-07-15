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
  node bin/probe-isolated-recent-performance.js [--mode synthetic|real] [--core-db <path>] [--engine-db <path>] [--json] [--out <path>] [--help]

Notes:
  - Isolated Recent performance probe is read-only.
  - Default mode is synthetic.
  - Real mode is opt-in and requires explicit Core and Engine DB paths.
  - It never touches production Recent, runtime capability defaults, or opens DBs writable.`;
}

function parseArgs(argv = []) {
  const options = {
    mode: "synthetic",
    json: false,
    out: null,
    help: false,
    coreDbPath: null,
    engineDbPath: null,
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
    if (arg === "--mode") {
      const mode = readFlagValue(argv, index, "--mode");
      if (!["synthetic", "real"].includes(mode)) {
        throw new Error(`unknown mode: ${mode}`);
      }
      options.mode = mode;
      index += 1;
      continue;
    }
    if (arg === "--core-db") {
      options.coreDbPath = resolve(readFlagValue(argv, index, "--core-db"));
      index += 1;
      continue;
    }
    if (arg === "--engine-db") {
      options.engineDbPath = resolve(readFlagValue(argv, index, "--engine-db"));
      index += 1;
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
  if (options.mode === "synthetic" && (options.coreDbPath || options.engineDbPath)) {
    throw new Error("db_paths_require_real_mode");
  }
  if (options.mode === "real" && (!options.coreDbPath || !options.engineDbPath)) {
    throw new Error("real_mode_requires_explicit_core_and_engine_db");
  }
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
  const report = await probe.runRecentPerformanceProbe({
    mode: options.mode,
    coreDbPath: options.coreDbPath,
    engineDbPath: options.engineDbPath,
  });
  const privacyValidation = report.privacy_validation
    || probe.validateRecentPerformancePublicReport?.(report)
    || { passed: true };
  if (!privacyValidation.passed) {
    return {
      exitCode: 2,
      output: "public_report_privacy_validation_failed",
      report: null,
    };
  }
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
