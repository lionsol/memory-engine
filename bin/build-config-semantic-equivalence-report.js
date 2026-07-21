#!/usr/bin/env node

const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const {
  buildConfigSemanticEquivalenceReport,
} = require("./config-semantic-equivalence-lib.js");

function usage() {
  return [
    "Usage:",
    "  node bin/build-config-semantic-equivalence-report.js",
    "    --before <config-before.json>",
    "    --after <config-after.json>",
    "    [--checked-at <canonical-UTC-ISO>] [--out <report.json>] [--pretty]",
    "",
    "Read-only fail-closed comparison. It permits only a canonical monotonic",
    "meta.lastTouchedAt host metadata update. All other JSON-path changes fail.",
    "Raw configuration values are never emitted except the approved timestamps.",
  ].join("\n");
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const args = {
    before: null,
    after: null,
    checkedAt: null,
    out: null,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--pretty") args.pretty = true;
    else if (token === "--before") {
      args.before = readValue(argv, index, token);
      index += 1;
    } else if (token === "--after") {
      args.after = readValue(argv, index, token);
      index += 1;
    } else if (token === "--checked-at") {
      args.checkedAt = readValue(argv, index, token);
      index += 1;
    } else if (token === "--out") {
      args.out = readValue(argv, index, token);
      index += 1;
    } else throw new Error(`unknown argument: ${token}`);
  }
  if (!args.help && !args.before) throw new Error("--before is required");
  if (!args.help && !args.after) throw new Error("--after is required");
  if (args.checkedAt && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(args.checkedAt)) {
    throw new Error("--checked-at must be a canonical UTC timestamp");
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const report = buildConfigSemanticEquivalenceReport({
    beforePath: args.before,
    afterPath: args.after,
    checkedAt: args.checkedAt || new Date().toISOString(),
  });
  const json = `${JSON.stringify(report, null, args.pretty ? 2 : 0)}\n`;
  if (args.out) {
    const outputPath = resolve(args.out);
    mkdirSync(dirname(outputPath), { recursive: true, mode: 0o700 });
    writeFileSync(outputPath, json, { mode: 0o600 });
  } else process.stdout.write(json);
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
