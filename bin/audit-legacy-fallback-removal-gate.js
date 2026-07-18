#!/usr/bin/env node

const { readFileSync } = require("node:fs");

function readFlagValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flagName} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const options = { thresholdsPath: null, help: false };
  const flags = {
    "--closure-report": "closureReadinessPath",
    "--evidence-window-report": "evidenceWindowPath",
    "--kg-rollout-report": "kgRolloutPath",
    "--recent-review-report": "recentReviewPath",
    "--recent-expansion-report": "recentExpansionPath",
    "--recent-rollback-report": "recentRollbackPath",
    "--production-rollout-report": "productionRolloutPath",
    "--code-reachability-report": "codeReachabilityPath",
    "--rollback-strategy-report": "rollbackStrategyPath",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--thresholds") {
      options.thresholdsPath = readFlagValue(argv, index, arg);
      index += 1;
    } else if (Object.hasOwn(flags, arg)) {
      options[flags[arg]] = readFlagValue(argv, index, arg);
      index += 1;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help) {
    for (const [flag, key] of Object.entries(flags)) {
      if (!options[key]) throw new Error(`${flag} is required`);
    }
  }
  return options;
}

function loadJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`failed to read ${label} JSON: ${error.message}`);
  }
}

function usage() {
  return `Usage:
  node bin/audit-legacy-fallback-removal-gate.js
      --closure-report <path.json>
      --evidence-window-report <path.json>
      --kg-rollout-report <path.json>
      --recent-review-report <path.json>
      --recent-expansion-report <path.json>
      --recent-rollback-report <path.json>
      --production-rollout-report <path.json>
      --code-reachability-report <path.json>
      --rollback-strategy-report <path.json>
      [--thresholds <path.json>]

This command reads reports only. It never removes code or changes rollout configuration.`;
}

function exitCodeForDecision(decision) {
  if (decision === "ready_for_code_removal") return 0;
  if (decision === "insufficient_evidence") return 1;
  if (decision === "blocked") return 2;
  return 3;
}

async function auditLegacyFallbackRemovalGate(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage() };
  const { evaluateLegacyFallbackRemovalGate } = await import(
    "../lib/recall/hybrid/legacy-fallback-removal-gate.js"
  );
  const report = evaluateLegacyFallbackRemovalGate({
    closureReadiness: loadJson(options.closureReadinessPath, "closure report"),
    evidenceWindow: loadJson(options.evidenceWindowPath, "evidence window report"),
    kgRollout: loadJson(options.kgRolloutPath, "KG rollout report"),
    recentReview: loadJson(options.recentReviewPath, "Recent review report"),
    recentExpansion: loadJson(options.recentExpansionPath, "Recent expansion report"),
    recentRollback: loadJson(options.recentRollbackPath, "Recent rollback report"),
    productionRollout: loadJson(options.productionRolloutPath, "production rollout report"),
    codeReachability: loadJson(options.codeReachabilityPath, "code reachability report"),
    rollbackStrategy: loadJson(options.rollbackStrategyPath, "rollback strategy report"),
    thresholds: options.thresholdsPath ? loadJson(options.thresholdsPath, "thresholds") : {},
  });
  return { exitCode: exitCodeForDecision(report.decision), output: JSON.stringify(report, null, 2), report };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await auditLegacyFallbackRemovalGate(argv);
    process.stdout.write(`${result.output}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 3;
  }
}

if (require.main === module) main();

module.exports = {
  auditLegacyFallbackRemovalGate,
  exitCodeForDecision,
  parseArgs,
  usage,
};
