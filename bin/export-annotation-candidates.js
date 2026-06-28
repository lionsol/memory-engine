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
  console.log(`Export Human Annotation Gold Set Candidates

Usage:
  node bin/export-annotation-candidates.js [options]

Options:
  --help                Show this help
  --limit <n>           Export at most N memory-level samples (default: 200)
  --per-bucket-limit <n>
                        Export at most N samples per primary risk bucket before global backfill (default: 30)
  --preview-chars <n>   Content preview length in chars (default: 700)
  --include-buckets <list>
                        Comma-separated bucket allowlist, e.g. dreaming_duplicate
  --exclude-buckets <list>
                        Comma-separated bucket denylist
  --format <name>       jsonl | md (default: jsonl)
  --out <path>          Output path; default reports/annotation-candidates-YYYYMMDD-HHmmss.<ext>

Notes:
  - This CLI is read-only.
  - It does not modify DB rows, memory files, quarantine state, or recall eligibility.
  - First version exports memory-level candidates only.`);
}

function parseArgs(argv = []) {
  const options = {
    help: false,
    limit: 200,
    perBucketLimit: 30,
    previewChars: 700,
    includeBuckets: [],
    excludeBuckets: [],
    format: "jsonl",
    out: null,
    fixturePath: process.env.MEMORY_ENGINE_ANNOTATION_CANDIDATE_FIXTURE_PATH || null,
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
    if (arg === "--limit") {
      options.limit = Number.parseInt(readFlagValue(argv, i, "--limit"), 10);
      i += 1;
      continue;
    }
    if (arg === "--per-bucket-limit") {
      options.perBucketLimit = Number.parseInt(readFlagValue(argv, i, "--per-bucket-limit"), 10);
      i += 1;
      continue;
    }
    if (arg === "--preview-chars") {
      options.previewChars = Number.parseInt(readFlagValue(argv, i, "--preview-chars"), 10);
      i += 1;
      continue;
    }
    if (arg === "--include-buckets") {
      options.includeBuckets = readFlagValue(argv, i, "--include-buckets")
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
      i += 1;
      continue;
    }
    if (arg === "--exclude-buckets") {
      options.excludeBuckets = readFlagValue(argv, i, "--exclude-buckets")
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
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

    const mod = await import("../lib/annotation/export-annotation-candidates.js");
    const report = mod.exportAnnotationCandidates(options);
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
