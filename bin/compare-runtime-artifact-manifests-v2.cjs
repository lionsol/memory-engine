#!/usr/bin/env node

const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const {
  ARTIFACT_MANIFEST_V2_POLICIES,
  compareRuntimeArtifactManifests,
} = require("./runtime-artifact-manifest-v2-lib.cjs");

function usage() {
  return [
    "Usage:",
    "  node bin/compare-runtime-artifact-manifests-v2.cjs --candidate <manifest> --installed <manifest>",
    "    [--policy exact|allow_internal_hardlink_split_v1|allow_install_root_mode_and_internal_hardlink_split_v1] [--out <file>] [--pretty]",
    "",
    "Compares two validated v2 manifests. The omitted policy defaults to exact.",
  ].join("\n");
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const args = { candidate: null, installed: null, policy: undefined, out: null, pretty: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--pretty") args.pretty = true;
    else if (token === "--candidate") {
      args.candidate = readValue(argv, index, token);
      index += 1;
    } else if (token === "--installed") {
      args.installed = readValue(argv, index, token);
      index += 1;
    } else if (token === "--policy") {
      args.policy = readValue(argv, index, token);
      index += 1;
    } else if (token === "--out") {
      args.out = readValue(argv, index, token);
      index += 1;
    } else throw new Error(`unknown argument: ${token}`);
  }
  if (!args.help && (!args.candidate || !args.installed)) throw new Error("--candidate and --installed are required");
  if (args.policy !== undefined && !Object.values(ARTIFACT_MANIFEST_V2_POLICIES).includes(args.policy)) throw new Error(`unsupported policy: ${args.policy}`);
  return args;
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const report = compareRuntimeArtifactManifests({
    candidateManifest: readJson(args.candidate),
    installedManifest: readJson(args.installed),
    policy: args.policy,
  });
  const json = `${JSON.stringify(report, null, args.pretty ? 2 : 0)}\n`;
  if (args.out) {
    const outputPath = resolve(args.out);
    mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
    writeFileSync(outputPath, json, { mode: 0o600 });
  } else process.stdout.write(json);
  return report.accepted ? 0 : 2;
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
