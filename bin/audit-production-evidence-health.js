#!/usr/bin/env node

const { readFileSync } = require("node:fs");
const { loadObservationReports } = require("./lib/observation-report-input.js");

function readFlagValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flagName} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const options = {
    observationsPath: null,
    baselinePath: null,
    runtimeParityPath: null,
    productHealthPath: null,
    continuityThresholdsPath: null,
    monitorThresholdsPath: null,
    asOf: undefined,
    pretty: false,
    help: false,
  };
  const paths = new Map([
    ["--observations", "observationsPath"],
    ["--baseline", "baselinePath"],
    ["--runtime-parity", "runtimeParityPath"],
    ["--product-health", "productHealthPath"],
    ["--continuity-thresholds", "continuityThresholdsPath"],
    ["--monitor-thresholds", "monitorThresholdsPath"],
    ["--as-of", "asOf"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--pretty") options.pretty = true;
    else if (paths.has(arg)) {
      options[paths.get(arg)] = readFlagValue(argv, index, arg);
      index += 1;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help) {
    for (const [flag, key] of [
      ["--observations", "observationsPath"],
      ["--baseline", "baselinePath"],
      ["--runtime-parity", "runtimeParityPath"],
      ["--product-health", "productHealthPath"],
    ]) {
      if (!options[key]) throw new Error(`${flag} is required`);
    }
  }
  return options;
}

function loadJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`failed to read ${label}: ${error.message}`);
  }
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function loadDocument(path, label) {
  const value = loadJson(path, label);
  if (!isPlainObject(value)) throw new Error(`${label} must be an object`);
  return value;
}

function exitCodeForStatus(status) {
  if (status === "ready_for_removal_gate") return 0;
  if (status === "healthy_collecting" || status === "insufficient_evidence") return 1;
  if (status === "blocked_rollback_required") return 2;
  return 64;
}

function usage() {
  return `Usage:
  node bin/audit-production-evidence-health.js
      --observations <observations.json|observations.jsonl>
      --baseline <baseline.json>
      --runtime-parity <runtime-parity.json>
      --product-health <product-health.json>
      [--continuity-thresholds <thresholds.json>]
      [--monitor-thresholds <thresholds.json>]
      [--as-of <ISO timestamp>] [--pretty]

This command reads supplied evidence reports only. It never opens a database, connects to a gateway, or changes rollout configuration.`;
}

async function auditProductionEvidenceHealth(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage(), report: null };
  if (options.asOf !== undefined && !Number.isFinite(Date.parse(options.asOf))) {
    throw new Error("--as-of expects an ISO timestamp");
  }
  const {
    evaluateProductionEvidenceHealth,
    validateProductionEvidenceContinuityThresholds,
    validateProductionEvidenceMonitorThresholds,
    validateBaseline,
    validateRuntimeParity,
    validateProductHealth,
  } = await import("../lib/recall/hybrid/production-evidence-health-monitor.js");
  const baseline = loadDocument(options.baselinePath, "baseline JSON");
  const runtimeParity = loadDocument(options.runtimeParityPath, "runtime parity JSON");
  const productHealth = loadDocument(options.productHealthPath, "product health JSON");
  const baselineValidation = validateBaseline(baseline);
  const parityValidation = validateRuntimeParity(runtimeParity);
  const productValidation = validateProductHealth(productHealth);
  if (!baselineValidation.valid) throw new Error(baselineValidation.errors[0].code);
  if (!parityValidation.valid) throw new Error(parityValidation.errors[0].code);
  if (!productValidation.valid) throw new Error(productValidation.errors[0].code);
  const continuityThresholds = options.continuityThresholdsPath
    ? loadDocument(options.continuityThresholdsPath, "continuity thresholds JSON")
    : undefined;
  if (continuityThresholds !== undefined) {
    const continuityValidation = validateProductionEvidenceContinuityThresholds(continuityThresholds);
    if (!continuityValidation.valid) throw new Error(continuityValidation.errors[0].code);
  }
  const monitorThresholds = options.monitorThresholdsPath
    ? loadDocument(options.monitorThresholdsPath, "monitor thresholds JSON")
    : undefined;
  const monitorValidation = validateProductionEvidenceMonitorThresholds(monitorThresholds);
  if (!monitorValidation.valid) throw new Error(monitorValidation.errors[0].code);
  const report = evaluateProductionEvidenceHealth({
    observations: loadObservationReports(options.observationsPath),
    baseline,
    runtimeParity,
    productHealth,
    continuityThresholds,
    monitorThresholds,
    asOf: options.asOf,
  });
  return {
    exitCode: exitCodeForStatus(report.status),
    output: JSON.stringify(report, null, options.pretty ? 2 : 0),
    report,
  };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await auditProductionEvidenceHealth(argv);
    process.stdout.write(`${result.output}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 64;
  }
}

if (require.main === module) main();

module.exports = {
  auditProductionEvidenceHealth,
  exitCodeForStatus,
  parseArgs,
  usage,
};
