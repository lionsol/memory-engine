#!/usr/bin/env node

const FORBIDDEN_FLAGS = new Set([
  "--delete",
  "--archive",
  "--quarantine",
  "--fix",
  "--write-db",
  "--backfill-confidence",
]);

function printHelp() {
  console.log(`Cleanup Confirmed Legacy Singleton Stale Chunk

Usage:
  node bin/cleanup-confirmed-legacy-singleton-stale.js [options]

Options:
  --help                Show this help
  --json                Print deterministic JSON output
  --markdown            Print Markdown summary
  --out <path>          Also write the selected output to a file
  --path <path>         Target singleton path; defaults to memory/daily.md
  --dry-run             Explicit dry-run mode; this is also the default
  --apply               Apply exact stale-row deletion after strict preflight
  --confirm <token>     Required with --apply; use cleanup-confirmed-legacy-singleton-stale
  --backup-dir <path>   Override backup directory for the core DB snapshot
  --sample-limit <n>    Limit listed chunk ids and samples in the review step

Refused:
  --delete --archive --quarantine --fix --write-db --backfill-confidence

Notes:
  - Default mode is dry-run and never writes any DB
  - Apply is confirmed-only and fail-closed
  - No memory file mutation, archive, quarantine, reinforce, confidence backfill, LLM, or network access
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
    dryRun: true,
    apply: false,
    confirm: null,
    backupDir: null,
    sampleLimit: 20,
  };
  let sawDryRun = false;
  let sawApply = false;

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
    if (arg === "--dry-run") {
      sawDryRun = true;
      options.dryRun = true;
      options.apply = false;
      continue;
    }
    if (arg === "--apply") {
      sawApply = true;
      options.apply = true;
      options.dryRun = false;
      continue;
    }
    if (arg === "--confirm") {
      options.confirm = readFlagValue(argv, i, "--confirm");
      i += 1;
      continue;
    }
    if (arg === "--backup-dir") {
      options.backupDir = readFlagValue(argv, i, "--backup-dir");
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

  if (sawDryRun && sawApply) {
    throw new Error("choose exactly one mode: --dry-run or --apply");
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

    const cleanup = await import("../lib/quality/confirmed-legacy-singleton-stale-cleanup.js");
    const report = options.apply
      ? cleanup.applyConfirmedLegacySingletonStaleCleanup(options)
      : cleanup.collectConfirmedLegacySingletonStaleCleanupDryRun(options);
    const output = options.markdown
      ? cleanup.renderConfirmedLegacySingletonStaleCleanupMarkdown(report)
      : JSON.stringify(report, null, 2);

    if (options.out) {
      cleanup.writeAuditReport(output, options.out);
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

if (process.argv[1] && /cleanup-confirmed-legacy-singleton-stale\.js$/.test(process.argv[1])) {
  main().then(code => {
    process.exitCode = code;
  });
}
