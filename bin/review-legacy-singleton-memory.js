#!/usr/bin/env node

const FORBIDDEN_FLAGS = new Set([
  "--fix",
  "--delete",
  "--archive",
  "--quarantine",
  "--apply",
  "--write-db",
  "--backfill-confidence",
]);

function printHelp() {
  console.log(`Legacy Singleton Review

Usage:
  node bin/review-legacy-singleton-memory.js [options]

Options:
  --help                Show this help
  --json                Print deterministic JSON review output
  --markdown            Print Markdown summary
  --out <path>          Also write the selected output to a file
  --path <path>         Override review target (must stay under memory/*)
  --sample-limit <n>    Limit listed chunk ids and matching samples (default: 20)

Refused:
  --fix --delete --archive --quarantine --apply --write-db --backfill-confidence

Notes:
  - Default target path is memory/daily.md
  - This command is read-only: no cleanup, no delete, no archive, no quarantine, no DB writes, no file mutation
  - No reinforce, confidence backfill, LLM, or network access
  - Default output format is JSON
`);
}

function readFlagValue(args, index, flagName) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flagName} expects a value`);
  }
  return value;
}

function parseInteger(value, flagName) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${flagName} expects a positive integer, got: ${value}`);
  }
  return n;
}

function parseArgs(argv = []) {
  const options = {
    help: false,
    json: false,
    markdown: false,
    out: null,
    path: "memory/daily.md",
    sampleLimit: 20,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (FORBIDDEN_FLAGS.has(arg)) {
      throw new Error(`unsupported destructive flag: ${arg}`);
    }
    if (arg === "--help" || arg === "help") {
      options.help = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--markdown") {
      options.markdown = true;
      continue;
    }
    if (arg === "--out") {
      options.out = readFlagValue(argv, i, "--out");
      i += 1;
      continue;
    }
    if (arg === "--path") {
      options.path = readFlagValue(argv, i, "--path");
      i += 1;
      continue;
    }
    if (arg === "--sample-limit") {
      options.sampleLimit = parseInteger(readFlagValue(argv, i, "--sample-limit"), "--sample-limit");
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (options.json && options.markdown) {
    throw new Error("choose exactly one output format: --json or --markdown");
  }
  if (!options.json && !options.markdown) {
    options.json = true;
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

    const review = await import("../lib/quality/legacy-singleton-review.js");
    const report = review.runLegacySingletonReview({
      targetPath: review.normalizeReviewPath(options.path),
      sampleLimit: options.sampleLimit,
    });
    const output = options.markdown
      ? review.renderLegacySingletonReviewMarkdown(report)
      : JSON.stringify(report, null, 2);

    if (options.out) {
      review.writeAuditReport(output, options.out);
    }

    console.log(output);
    return 0;
  } catch (error) {
    console.error(String(error?.message || error));
    return 1;
  }
}

module.exports = {
  main,
  parseArgs,
};

if (process.argv[1] && /review-legacy-singleton-memory\.js$/.test(process.argv[1])) {
  main().then(code => {
    process.exitCode = code;
  });
}
