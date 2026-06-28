#!/usr/bin/env node

const { resolve } = require("node:path");

const FORBIDDEN_FLAGS = new Set([
  "--apply",
  "--write-db",
  "--delete",
  "--archive",
  "--quarantine",
  "--reinforce",
]);

function readFlagValue(args, index, flagName) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flagName} expects a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Summarize Human Annotation Labels

Usage:
  node bin/summarize-annotation-labels.js --labels <labels.jsonl> [options]

Options:
  --help                Show this help
  --labels <path>       Input annotation labels JSONL
  --in <path>           Backward-compatible alias for --labels
  --format <name>       json | md (default: md)
  --out <path>          Output path; default reports/annotation-summary-YYYYMMDD-HHmmss.<ext>

Notes:
  - This CLI is read-only.
  - It validates schema and enums, then writes a local summary file.
  - It does not write DB rows, modify memory, quarantine, archive, delete, or reinforce.`);
}

function parseArgs(argv = []) {
  const options = {
    help: false,
    inputPath: null,
    format: "md",
    out: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (FORBIDDEN_FLAGS.has(arg)) {
      throw new Error(`unsupported write flag: ${arg}`);
    }
    if (arg === "--help" || arg === "help") {
      options.help = true;
      continue;
    }
    if (arg === "--labels" || arg === "--in") {
      options.inputPath = resolve(readFlagValue(argv, i, arg));
      i += 1;
      continue;
    }
    if (arg === "--format") {
      options.format = readFlagValue(argv, i, "--format");
      i += 1;
      continue;
    }
    if (arg === "--out") {
      options.out = resolve(readFlagValue(argv, i, "--out"));
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      printHelp();
      return 0;
    }

    const mod = await import("../lib/annotation/summarize-annotation-labels.js");
    const report = mod.summarizeAnnotationLabels(options);
    console.log(JSON.stringify(report, null, 2));
    return 0;
  } catch (error) {
    console.error(String(error?.message || error));
    return 1;
  }
}

if (require.main === module) {
  main().then(code => {
    process.exitCode = code;
  });
}

module.exports = {
  main,
  parseArgs,
};
