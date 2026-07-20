#!/usr/bin/env node

const { readFileSync, writeFileSync } = require("node:fs");

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} expects a value`);
  return value;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} expects a positive integer`);
  return parsed;
}

function parseArgs(argv = []) {
  const options = {
    runtimePreflight: null,
    runtimeParity: null,
    trafficForecast: null,
    configBackupManifest: null,
    authorizedAt: null,
    head: null,
    revision: 1,
    agents: [],
    topK: 3,
    timeoutMs: 4000,
    approvals: null,
    continuityThresholds: null,
    monitorThresholds: null,
    out: null,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--pretty") options.pretty = true;
    else if (arg === "--runtime-preflight") { options.runtimePreflight = readValue(argv, index, arg); index += 1; }
    else if (arg === "--runtime-parity") { options.runtimeParity = readValue(argv, index, arg); index += 1; }
    else if (arg === "--traffic-forecast") { options.trafficForecast = readValue(argv, index, arg); index += 1; }
    else if (arg === "--config-backup-manifest") { options.configBackupManifest = readValue(argv, index, arg); index += 1; }
    else if (arg === "--authorized-at") { options.authorizedAt = readValue(argv, index, arg); index += 1; }
    else if (arg === "--head") { options.head = readValue(argv, index, arg); index += 1; }
    else if (arg === "--revision") { options.revision = parsePositiveInteger(readValue(argv, index, arg), arg); index += 1; }
    else if (arg === "--agent") { options.agents.push(readValue(argv, index, arg)); index += 1; }
    else if (arg === "--top-k") { options.topK = parsePositiveInteger(readValue(argv, index, arg), arg); index += 1; }
    else if (arg === "--timeout-ms") { options.timeoutMs = parsePositiveInteger(readValue(argv, index, arg), arg); index += 1; }
    else if (arg === "--operator-approvals") { options.approvals = readValue(argv, index, arg); index += 1; }
    else if (arg === "--continuity-thresholds") { options.continuityThresholds = readValue(argv, index, arg); index += 1; }
    else if (arg === "--monitor-thresholds") { options.monitorThresholds = readValue(argv, index, arg); index += 1; }
    else if (arg === "--out") { options.out = readValue(argv, index, arg); index += 1; }
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help) {
    for (const [flag, value] of [
      ["--runtime-preflight", options.runtimePreflight],
      ["--runtime-parity", options.runtimeParity],
      ["--traffic-forecast", options.trafficForecast],
      ["--config-backup-manifest", options.configBackupManifest],
      ["--authorized-at", options.authorizedAt],
      ["--head", options.head],
    ]) if (!value) throw new Error(`${flag} is required`);
  }
  return options;
}

function loadObject(path, label) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
    return value;
  } catch (error) {
    throw new Error(`failed to read ${label}: ${error.message}`);
  }
}

function usage() {
  return `Usage:\n  node bin/build-sustained-runtime-authorization-plan.js\n    --runtime-preflight <runtime-preflight.json>\n    --runtime-parity <runtime-parity.json>\n    --traffic-forecast <forecast.json>\n    --config-backup-manifest <manifest.json>\n    --authorized-at <canonical-UTC-ISO> --head <git-commit>\n    [--revision <1-99>] [--agent <id>]... [--top-k 3] [--timeout-ms 4000]\n    [--operator-approvals <approvals.json>]\n    [--continuity-thresholds <json>] [--monitor-thresholds <json>]\n    [--out <plan.json>] [--pretty]\n\nThis command only builds and validates a machine-readable plan. It never edits OpenClaw configuration, installs a plugin, creates a scheduler, or starts an evidence epoch.`;
}

function exitCode(decision) {
  if (decision === "authorized_plan_ready") return 0;
  if (decision === "ready_for_operator_approval") return 1;
  if (decision === "blocked") return 2;
  return 64;
}

async function buildSustainedRuntimeAuthorizationPlanCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage(), report: null, out: null };
  const { buildSustainedRuntimeAuthorizationPlan } = await import("../lib/recall/hybrid/sustained-runtime-authorization.js");
  const report = buildSustainedRuntimeAuthorizationPlan({
    runtimePreflight: loadObject(options.runtimePreflight, "runtime preflight"),
    runtimeParity: loadObject(options.runtimeParity, "runtime parity"),
    trafficForecast: loadObject(options.trafficForecast, "traffic forecast"),
    configBackupManifest: loadObject(options.configBackupManifest, "config backup manifest"),
    authorizedAt: options.authorizedAt,
    head: options.head,
    revision: options.revision,
    agentAllowlist: options.agents.length > 0 ? options.agents : ["edi"],
    topK: options.topK,
    timeoutMs: options.timeoutMs,
    operatorApprovals: options.approvals ? loadObject(options.approvals, "operator approvals") : {},
    continuityThresholds: options.continuityThresholds ? loadObject(options.continuityThresholds, "continuity thresholds") : undefined,
    monitorThresholds: options.monitorThresholds ? loadObject(options.monitorThresholds, "monitor thresholds") : undefined,
  });
  const output = `${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`;
  if (options.out) writeFileSync(options.out, output, "utf8");
  return { exitCode: exitCode(report.decision), output, report, out: options.out };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await buildSustainedRuntimeAuthorizationPlanCli(argv);
    if (!result.out || result.report === null) process.stdout.write(result.output);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 64;
  }
}

module.exports = {
  parseArgs,
  buildSustainedRuntimeAuthorizationPlanCli,
  main,
};

if (require.main === module) main();
