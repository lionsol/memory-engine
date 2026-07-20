#!/usr/bin/env node

const { readFileSync, writeFileSync } = require("node:fs");

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const options = {
    authorizationPlan: null,
    runtimePreflight: null,
    runtimeParity: null,
    activatedAt: undefined,
    out: null,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--pretty") options.pretty = true;
    else if (arg === "--authorization-plan") { options.authorizationPlan = readValue(argv, index, arg); index += 1; }
    else if (arg === "--runtime-preflight") { options.runtimePreflight = readValue(argv, index, arg); index += 1; }
    else if (arg === "--runtime-parity") { options.runtimeParity = readValue(argv, index, arg); index += 1; }
    else if (arg === "--activated-at") { options.activatedAt = readValue(argv, index, arg); index += 1; }
    else if (arg === "--out") { options.out = readValue(argv, index, arg); index += 1; }
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help) {
    for (const [flag, value] of [
      ["--authorization-plan", options.authorizationPlan],
      ["--runtime-preflight", options.runtimePreflight],
      ["--runtime-parity", options.runtimeParity],
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
  return `Usage:\n  node bin/finalize-sustained-runtime-activation-baseline.js\n    --authorization-plan <authorized-plan.json>\n    --runtime-preflight <post-apply-runtime-preflight.json>\n    --runtime-parity <post-apply-runtime-parity.json>\n    [--activated-at <canonical-UTC-ISO>] [--out <baseline-report.json>] [--pretty]\n\nThis command validates post-apply loaded-runtime evidence and emits an active baseline only when every identity, mode, epoch, host-config, and parity check passes. It never edits configuration, reloads runtime, or starts a scheduler.`;
}

async function finalizeSustainedRuntimeActivationBaselineCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage(), report: null, out: null };
  const { finalizeSustainedRuntimeActivationBaseline } = await import("../lib/recall/hybrid/sustained-runtime-activation-baseline.js");
  const report = finalizeSustainedRuntimeActivationBaseline({
    authorizationPlan: loadObject(options.authorizationPlan, "authorization plan"),
    runtimePreflight: loadObject(options.runtimePreflight, "runtime preflight"),
    runtimeParity: loadObject(options.runtimeParity, "runtime parity"),
    activatedAt: options.activatedAt,
  });
  const output = `${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`;
  if (options.out) writeFileSync(options.out, output, "utf8");
  return { exitCode: report.active_baseline_ready ? 0 : 2, output, report, out: options.out };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await finalizeSustainedRuntimeActivationBaselineCli(argv);
    if (!result.out || result.report === null) process.stdout.write(result.output);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 64;
  }
}

module.exports = { parseArgs, finalizeSustainedRuntimeActivationBaselineCli, main };

if (require.main === module) main();
