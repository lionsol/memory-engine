#!/usr/bin/env node

const { loadObservationReport } = require("./lib/observation-report-input.js");

function readFlagValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flagName} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const options = {
    observationsPath: null,
    channel: "kg",
    expectedAgent: null,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--pretty") options.pretty = true;
    else if (arg === "--observations") {
      options.observationsPath = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--channel") {
      options.channel = readFlagValue(argv, index, arg);
      index += 1;
    } else if (arg === "--expected-agent") {
      options.expectedAgent = readFlagValue(argv, index, arg);
      index += 1;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help && !options.observationsPath) throw new Error("--observations is required");
  if (!options.help && !["kg", "recent"].includes(String(options.channel).toLowerCase())) {
    throw new Error("--channel must be kg or recent");
  }
  return options;
}

function usage() {
  return `Usage:
  node bin/audit-scoped-fail-closed-canary-evidence.js
      --observations <observations.json|observations.jsonl>
      [--channel <kg|recent>]
      [--expected-agent <agent-id>]
      [--pretty]

Decision exit codes:
  0  stage2_review_eligible=true
  1  scope confirmed but Stage 2 review is incomplete
  2  canary_scope_not_confirmed
  3  canary_safety_violation
  4  invalid input or internal error

This command reads observation reports only. It never opens a database, invokes Hybrid Search, or changes rollout configuration.`;
}

function exitCodeForReport(report) {
  if (report?.status === "canary_safety_violation") return 3;
  if (report?.status === "canary_scope_not_confirmed") return 2;
  if (report?.stage2_review_eligible === true) return 0;
  if ([
    "canary_suppression_confirmed",
    "canary_scope_confirmed_no_fallback_opportunity",
  ].includes(report?.status)) return 1;
  return 4;
}

async function auditScopedFailClosedCanaryEvidence(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage(), report: null };
  const observations = loadObservationReport(options.observationsPath);
  const { buildScopedFailClosedCanaryEvidence } = await import(
    "../lib/recall/hybrid/scoped-fail-closed-canary-evidence.js"
  );
  const report = buildScopedFailClosedCanaryEvidence({
    observations,
    channel: options.channel,
    expectedAgent: options.expectedAgent,
  });
  return {
    exitCode: exitCodeForReport(report),
    output: JSON.stringify(report, null, options.pretty ? 2 : 0),
    report,
  };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await auditScopedFailClosedCanaryEvidence(argv);
    process.stdout.write(`${result.output}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 4;
  }
}

if (require.main === module) main();

module.exports = {
  auditScopedFailClosedCanaryEvidence,
  exitCodeForReport,
  parseArgs,
  usage,
};
