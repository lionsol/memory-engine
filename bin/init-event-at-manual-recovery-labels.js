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
  writeStdout(`Init Event-at Manual Recovery Labels

Usage:
  node bin/init-event-at-manual-recovery-labels.js --candidates <candidates.jsonl> --out <labels.jsonl>

Options:
  --help                         Show this help
  --candidates <path>            P37 candidate JSONL input
  --out <path>                   Output label template JSONL

Refused:
  --apply --force --write-db --no-backup

Notes:
  - Read-only relative to DBs and migrations.
  - Generates one label seed row per candidate row.
  - Raw log full text is never copied into the label template.`);
}

function parseArgs(argv = []) {
  const options = {
    help: false,
    candidatesPath: null,
    outPath: null,
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
    if (arg === "--candidates") {
      options.candidatesPath = resolve(readFlagValue(argv, i, "--candidates"));
      i += 1;
      continue;
    }
    if (arg === "--out") {
      options.outPath = resolve(readFlagValue(argv, i, "--out"));
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!options.help && !options.candidatesPath) {
    throw new Error("--candidates is required");
  }
  if (!options.help && !options.outPath) {
    throw new Error("--out is required");
  }
  return options;
}

function printHuman(summary) {
  writeStdout(`mode: ${summary.mode}`);
  writeStdout(`writes_db: ${summary.writes_db}`);
  writeStdout(`migration_applied: ${summary.migration_applied}`);
  writeStdout(`candidate_count: ${summary.candidate_count}`);
  writeStdout(`output_path: ${summary.output_path}`);
  writeStdout(`raw_text_exported: ${summary.raw_text_exported}`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  const mod = await import("../lib/db/core-chunk-time-migration.js");
  const summary = mod.initEventAtManualRecoveryLabels(options);
  printHuman(summary);
}

if (process.argv[1] && /init-event-at-manual-recovery-labels\.js$/.test(process.argv[1])) {
  main().catch((error) => {
    writeStderr(`error: ${String(error?.message || error)}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  main,
};
