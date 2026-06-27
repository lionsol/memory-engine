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
  console.log(`Preview Annotation-Derived Eligibility Suggestions

Usage:
  node bin/preview-annotation-eligibility.js --labels <labels.jsonl> [options]

Options:
  --help                Show this help
  --labels <path>       Input annotation labels JSONL
  --candidates <path>   Optional annotation candidates JSONL for bucket enrichment
  --format <name>       json | md (default: md)
  --out <path>          Output path; default reports/annotation-eligibility-preview-YYYYMMDD-HHmmss.<ext>

Notes:
  - This CLI is read-only.
  - It only generates recommendations; it does not write DB rows or mutate memory.
  - It does not quarantine, archive, delete, reinforce, or flip auto recall eligibility in storage.`);
}

function parseArgs(argv = []) {
  const options = {
    help: false,
    labelsInputPath: null,
    candidatesInputPath: null,
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
      options.labelsInputPath = resolve(readFlagValue(argv, i, arg));
      i += 1;
      continue;
    }
    if (arg === "--candidates") {
      options.candidatesInputPath = resolve(readFlagValue(argv, i, "--candidates"));
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

    const mod = await import("../lib/annotation/preview-annotation-eligibility.js");
    const report = mod.previewAnnotationEligibility(options);
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
