#!/usr/bin/env node

const { writeFileSync } = require("node:fs");

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const options = { sourceRoot: null, runtimeRoot: null, checkedAt: undefined, out: null, pretty: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--pretty") options.pretty = true;
    else if (arg === "--source-root") { options.sourceRoot = readValue(argv, index, arg); index += 1; }
    else if (arg === "--runtime-root") { options.runtimeRoot = readValue(argv, index, arg); index += 1; }
    else if (arg === "--checked-at") { options.checkedAt = readValue(argv, index, arg); index += 1; }
    else if (arg === "--out") { options.out = readValue(argv, index, arg); index += 1; }
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help && !options.sourceRoot) throw new Error("--source-root is required");
  if (!options.help && !options.runtimeRoot) throw new Error("--runtime-root is required");
  return options;
}

function usage() {
  return `Usage:\n  node bin/build-runtime-source-parity-report.js\n    --source-root <repository-root>\n    --runtime-root <installed-runtime-root>\n    [--checked-at <canonical-UTC-ISO>] [--out <report.json>] [--pretty]\n\nRead-only: hashes the reviewed runtime dependency closure in both roots and never installs or reloads the plugin.`;
}

async function buildRuntimeSourceParityCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage(), report: null };
  const { buildRuntimeSourceParityReport } = await import("../lib/version/runtime-source-parity.js");
  const report = buildRuntimeSourceParityReport({
    sourceRoot: options.sourceRoot,
    runtimeRoot: options.runtimeRoot,
    checkedAt: options.checkedAt,
  });
  const output = `${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`;
  if (options.out) writeFileSync(options.out, output, "utf8");
  return { exitCode: report.source_runtime_equal ? 0 : 2, output, report };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await buildRuntimeSourceParityCli(argv);
    if (!parseArgs(argv).out || result.report === null) process.stdout.write(result.output);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 64;
  }
}

module.exports = { parseArgs, usage, buildRuntimeSourceParityCli, main };

if (require.main === module) main();
