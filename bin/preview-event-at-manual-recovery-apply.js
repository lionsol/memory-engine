#!/usr/bin/env node

const { writeSync } = require("node:fs");
const { resolve } = require("node:path");

const FORBIDDEN_FLAGS = new Set(["--apply", "--force", "--write-db", "--no-backup"]);

function writeStdout(text) {
  writeSync(1, `${String(text)}\n`);
}

function writeStderr(text) {
  writeSync(2, `${String(text)}\n`);
}

function readFlagValue(args, index, flagName) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flagName} expects a value`);
  }
  return value;
}

function printHelp() {
  writeStdout(`Preview Event-at Manual Recovery Apply

Usage:
  node bin/preview-event-at-manual-recovery-apply.js --labels <labels.jsonl> [--json]

Options:
  --help                         Show this help
  --labels <path>                Input label JSONL
  --json                         Print JSON preview

Refused:
  --apply --force --write-db --no-backup

Notes:
  - Dry-run preview only.
  - Accepts only valid recover_event_at labels.
  - Does not write DB, does not apply migration, does not backfill automatically.`);
}

function parseArgs(argv = []) {
  const options = {
    help: false,
    json: false,
    labelsPath: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (FORBIDDEN_FLAGS.has(arg)) {
      throw new Error(`unsupported flag: ${arg}`);
    }
    if (arg === "--help" || arg === "help") {
      options.help = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--labels") {
      options.labelsPath = resolve(readFlagValue(argv, i, "--labels"));
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!options.help && !options.labelsPath) {
    throw new Error("--labels is required");
  }
  return options;
}

function printHuman(summary) {
  writeStdout(`mode: ${summary.mode}`);
  writeStdout(`writes_db: ${summary.writes_db}`);
  writeStdout(`migration_applied: ${summary.migration_applied}`);
  writeStdout(`candidate_updates_count: ${summary.candidate_updates_count}`);
  writeStdout(`valid_recover_event_at_count: ${summary.valid_recover_event_at_count}`);
  writeStdout(`invalid_recover_event_at_count: ${summary.invalid_recover_event_at_count}`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  const mod = await import("../lib/db/core-chunk-time-migration.js");
  const summary = mod.previewEventAtManualRecoveryApply(options);
  if (options.json) {
    writeStdout(JSON.stringify(summary, null, 2));
  } else {
    printHuman(summary);
  }
}

if (process.argv[1] && /preview-event-at-manual-recovery-apply\.js$/.test(process.argv[1])) {
  main().catch((error) => {
    writeStderr(`error: ${String(error?.message || error)}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  main,
};
