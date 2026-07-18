#!/usr/bin/env node

const { readFileSync } = require("node:fs");

function readFlagValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flagName} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const options = { beforePath: null, afterPath: null, thresholdsPath: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--before-report") {
      options.beforePath = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--after-report") {
      options.afterPath = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--thresholds") {
      options.thresholdsPath = readFlagValue(argv, index, arg);
      index += 1;
    } else throw new Error(`unknown argument: ${arg}`);
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

function usage() {
  return `Usage:
  node bin/audit-recent-fail-closed-rollback-validation.js
      [--before-report <path.json>] [--after-report <path.json>]
      [--thresholds <path.json>]

This command reads JSON reports only. It never changes runtime configuration or executes rollback.`;
}

function exitCodeForStatus(status) {
  if (status === "rollback_confirmed") return 0;
  if (status === "insufficient_evidence") return 1;
  if (status === "rollback_failed") return 2;
  return 3;
}

async function auditRecentFailClosedRollbackValidation(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage() };
  const { evaluateRecentFailClosedRollbackValidation } = await import(
    "../lib/recall/hybrid/recent-fail-closed-rollback-validation.js"
  );
  const report = evaluateRecentFailClosedRollbackValidation({
    beforeRollback: loadJson(options.beforePath, "before report"),
    afterRollback: loadJson(options.afterPath, "after report"),
    thresholds: loadJson(options.thresholdsPath, "thresholds"),
  });
  return { exitCode: exitCodeForStatus(report.status), output: JSON.stringify(report, null, 2), report };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await auditRecentFailClosedRollbackValidation(argv);
    process.stdout.write(`${result.output}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 3;
  }
}

if (require.main === module) main();

module.exports = {
  auditRecentFailClosedRollbackValidation,
  exitCodeForStatus,
  parseArgs,
  usage,
};
