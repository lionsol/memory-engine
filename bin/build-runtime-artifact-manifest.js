#!/usr/bin/env node

const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const { buildRuntimeArtifactManifest } = require("./runtime-artifact-manifest-lib.js");

function usage() {
  return [
    "Usage:",
    "  node bin/build-runtime-artifact-manifest.js --root <directory> [--checked-at <ISO>] [--out <file>] [--pretty]",
    "",
    "Builds a deterministic, read-only artifact manifest covering paths, types, modes,",
    "file content hashes, symlink targets, and internal hardlink groups.",
  ].join("\n");
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const args = { root: null, checkedAt: null, out: null, pretty: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
    } else if (token === "--pretty") {
      args.pretty = true;
    } else if (token === "--root") {
      args.root = readValue(argv, index, token);
      index += 1;
    } else if (token === "--checked-at") {
      args.checkedAt = readValue(argv, index, token);
      index += 1;
    } else if (token === "--out") {
      args.out = readValue(argv, index, token);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  if (!args.help && !args.root) throw new Error("--root is required");
  if (args.checkedAt && Number.isNaN(Date.parse(args.checkedAt))) {
    throw new Error("--checked-at must be a valid ISO timestamp");
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const report = buildRuntimeArtifactManifest({
    rootDir: args.root,
    checkedAt: args.checkedAt || new Date().toISOString(),
  });
  const json = `${JSON.stringify(report, null, args.pretty ? 2 : 0)}\n`;
  if (args.out) {
    const outputPath = resolve(args.out);
    mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
    writeFileSync(outputPath, json, { mode: 0o600 });
  } else {
    process.stdout.write(json);
  }
  return report.valid ? 0 : 2;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, parseArgs, usage };
