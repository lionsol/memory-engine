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
    authorizationPlan: null,
    activationBaseline: null,
    restoredConfigManifest: null,
    runtimePreflight: null,
    runtimeParity: null,
    rollbackObservations: [],
    safetySmoke: null,
    checkedAt: undefined,
    out: null,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--pretty") options.pretty = true;
    else if (arg === "--authorization-plan") { options.authorizationPlan = readValue(argv, index, arg); index += 1; }
    else if (arg === "--activation-baseline") { options.activationBaseline = readValue(argv, index, arg); index += 1; }
    else if (arg === "--restored-config-manifest") { options.restoredConfigManifest = readValue(argv, index, arg); index += 1; }
    else if (arg === "--runtime-preflight") { options.runtimePreflight = readValue(argv, index, arg); index += 1; }
    else if (arg === "--runtime-parity") { options.runtimeParity = readValue(argv, index, arg); index += 1; }
    else if (arg === "--rollback-observations") { options.rollbackObservations.push(readValue(argv, index, arg)); index += 1; }
    else if (arg === "--safety-smoke") { options.safetySmoke = readValue(argv, index, arg); index += 1; }
    else if (arg === "--checked-at") { options.checkedAt = readValue(argv, index, arg); index += 1; }
    else if (arg === "--out") { options.out = readValue(argv, index, arg); index += 1; }
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help) {
    for (const [flag, value] of [
      ["--authorization-plan", options.authorizationPlan],
      ["--activation-baseline", options.activationBaseline],
      ["--restored-config-manifest", options.restoredConfigManifest],
      ["--runtime-preflight", options.runtimePreflight],
      ["--runtime-parity", options.runtimeParity],
      ["--safety-smoke", options.safetySmoke],
    ]) if (!value) throw new Error(`${flag} is required`);
    if (options.rollbackObservations.length === 0) throw new Error("at least one --rollback-observations path is required");
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
  return `Usage:\n  node bin/verify-sustained-runtime-rollback.js\n    --authorization-plan <authorized-plan.json>\n    --activation-baseline <active-baseline-report.json>\n    --restored-config-manifest <restored-config-manifest.json>\n    --runtime-preflight <post-rollback-runtime-preflight.json>\n    --runtime-parity <post-rollback-runtime-parity.json>\n    --rollback-observations <post-rollback-observations.jsonl> [--rollback-observations <more>...]\n    --safety-smoke <a5-safety-smoke.json>\n    [--checked-at <canonical-UTC-ISO>] [--out <verification.json>] [--pretty]\n\nThis verifier is read-only. It never restores configuration, reloads runtime, invokes probes, or runs the safety smoke; it validates their supplied evidence.`;
}

async function verifySustainedRuntimeRollbackCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage(), report: null, out: null };
  const { verifySustainedRuntimeRollback } = await import("../lib/recall/hybrid/sustained-runtime-rollback-verification.js");
  const report = verifySustainedRuntimeRollback({
    authorizationPlan: loadObject(options.authorizationPlan, "authorization plan"),
    activationBaselineReport: loadObject(options.activationBaseline, "activation baseline"),
    restoredConfigManifest: loadObject(options.restoredConfigManifest, "restored config manifest"),
    runtimePreflight: loadObject(options.runtimePreflight, "runtime preflight"),
    runtimeParity: loadObject(options.runtimeParity, "runtime parity"),
    rollbackObservations: loadObservationReports(options.rollbackObservations),
    safetySmoke: loadObject(options.safetySmoke, "safety smoke"),
    checkedAt: options.checkedAt,
  });
  const output = `${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`;
  if (options.out) writeFileSync(options.out, output, "utf8");
  return { exitCode: report.rollback_verified ? 0 : 2, output, report, out: options.out };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await verifySustainedRuntimeRollbackCli(argv);
    if (!result.out || result.report === null) process.stdout.write(result.output);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 64;
  }
}

module.exports = { parseArgs, verifySustainedRuntimeRollbackCli, main };

if (require.main === module) main();
