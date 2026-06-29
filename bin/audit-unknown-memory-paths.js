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
  console.log(`Unknown Memory Path Audit

Usage:
  node bin/audit-unknown-memory-paths.js [options]

Options:
  --help                Show this help
  --json                Print deterministic JSON audit output
  --markdown            Print Markdown summary
  --out <path>          Also write the selected output to a file
  --include-archived    Include archived confidence rows in candidate collection
  --sample-limit <n>    Limit rendered item samples (default: 20)

Refused:
  --fix --delete --archive --quarantine --apply --write-db --backfill-confidence

Notes:
  - Default output format is JSON
  - This command is audit-only and read-only: no cleanup, no DB writes, no file mutation, no config mutation
  - No archive, quarantine, reinforce, confidence backfill, LLM, or network access
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
    includeArchived: false,
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
    if (arg === "--include-archived") {
      options.includeArchived = true;
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

    const audit = await import("../lib/quality/unknown-memory-path-audit.js");
    const report = audit.runUnknownMemoryPathAudit({
      includeArchived: options.includeArchived,
      sampleLimit: options.sampleLimit,
    });
    const output = options.markdown
      ? audit.renderUnknownMemoryPathMarkdown(report)
      : JSON.stringify(report, null, 2);

    if (options.out) {
      audit.writeAuditReport(output, options.out);
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

if (process.argv[1] && /audit-unknown-memory-paths\.js$/.test(process.argv[1])) {
  main().then(code => {
    process.exitCode = code;
  });
}
