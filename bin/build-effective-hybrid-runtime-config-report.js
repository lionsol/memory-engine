#!/usr/bin/env node

const { readFileSync, writeFileSync } = require("node:fs");

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const options = { config: null, checkedAt: undefined, out: null, pretty: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--pretty") options.pretty = true;
    else if (arg === "--config") { options.config = readValue(argv, index, arg); index += 1; }
    else if (arg === "--checked-at") { options.checkedAt = readValue(argv, index, arg); index += 1; }
    else if (arg === "--out") { options.out = readValue(argv, index, arg); index += 1; }
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help && !options.config) throw new Error("--config is required");
  return options;
}

function loadConfig(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("OpenClaw config must be an object");
    return value;
  } catch (error) {
    throw new Error(`failed to read OpenClaw config: ${error.message}`);
  }
}

function usage() {
  return `Usage:\n  node bin/build-effective-hybrid-runtime-config-report.js\n    --config <openclaw-config.json>\n    [--checked-at <canonical-UTC-ISO>] [--out <report.json>] [--pretty]\n\nThe report reproduces the plugin's effective AutoRecall/KG/Recent/retrieval config resolution, stores only normalized non-secret fields, and replaces canary token values with counts.`;
}

async function buildEffectiveHybridRuntimeConfigCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage(), report: null, out: null };
  const { buildEffectiveRuntimeConfigReport } = await import("../lib/recall/hybrid/effective-runtime-config-report.js");
  const report = buildEffectiveRuntimeConfigReport({
    openclawConfig: loadConfig(options.config),
    checkedAt: options.checkedAt,
  });
  const output = `${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`;
  if (options.out) writeFileSync(options.out, output, "utf8");
  return { exitCode: report.valid ? 0 : 64, output, report, out: options.out };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await buildEffectiveHybridRuntimeConfigCli(argv);
    if (!result.out || result.report === null) process.stdout.write(result.output);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 64;
  }
}

module.exports = { parseArgs, loadConfig, buildEffectiveHybridRuntimeConfigCli, main };

if (require.main === module) main();
