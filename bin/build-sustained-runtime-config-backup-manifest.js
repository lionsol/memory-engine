#!/usr/bin/env node

const { writeFileSync } = require("node:fs");

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const options = { configBackup: null, liveConfig: null, createdAt: undefined, out: null, pretty: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--pretty") options.pretty = true;
    else if (arg === "--config-backup") { options.configBackup = readValue(argv, index, arg); index += 1; }
    else if (arg === "--live-config") { options.liveConfig = readValue(argv, index, arg); index += 1; }
    else if (arg === "--created-at") { options.createdAt = readValue(argv, index, arg); index += 1; }
    else if (arg === "--out") { options.out = readValue(argv, index, arg); index += 1; }
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help && !options.configBackup) throw new Error("--config-backup is required");
  if (!options.help && !options.liveConfig) throw new Error("--live-config is required");
  return options;
}

function usage() {
  return `Usage:\n  node bin/build-sustained-runtime-config-backup-manifest.js\n    --live-config <current-openclaw-config.json>\n    --config-backup <independent-exact-backup.json>\n    [--created-at <canonical-UTC-ISO>] [--out <manifest.json>] [--pretty]\n\nThe command never copies or prints raw config content. The backup must be a distinct non-symlink file with owner-only permissions and exact byte equality to the live config.`;
}

async function buildSustainedRuntimeConfigBackupManifestCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage(), report: null, out: null };
  const { buildSustainedRuntimeConfigBackupManifest } = await import("../lib/recall/hybrid/sustained-runtime-config-backup.js");
  const report = buildSustainedRuntimeConfigBackupManifest({
    configPath: options.configBackup,
    liveConfigPath: options.liveConfig,
    createdAt: options.createdAt,
  });
  const output = `${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`;
  if (options.out) writeFileSync(options.out, output, "utf8");
  return { exitCode: report.valid ? 0 : 2, output, report, out: options.out };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await buildSustainedRuntimeConfigBackupManifestCli(argv);
    if (!result.out || result.report === null) process.stdout.write(result.output);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 64;
  }
}

module.exports = { parseArgs, buildSustainedRuntimeConfigBackupManifestCli, main };

if (require.main === module) main();
