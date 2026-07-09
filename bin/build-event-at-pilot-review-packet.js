#!/usr/bin/env node

const { writeSync } = require("node:fs");
const { resolve } = require("node:path");
const { tmpdir } = require("node:os");

const DEFAULT_REPORT_DIR = resolve(tmpdir(), "memory-engine-reports");
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
  writeStdout(`Build Event-at Pilot Review Packet

Usage:
  node bin/build-event-at-pilot-review-packet.js --labels <labels.jsonl> --candidates <candidates.jsonl> [options]

Options:
  --help                         Show this help
  --labels <path>                Pilot label JSONL
  --candidates <path>            P37 candidate JSONL
  --format <md|jsonl>            Output format; inferred from --out when omitted
  --out <path>                   Output path; must stay under ${DEFAULT_REPORT_DIR}

Refused:
  --apply --force --write-db --no-backup

Notes:
  - Read-only join only.
  - Does not write DB, apply migration, or backfill.
  - Uses only capped preview from candidate export; never emits raw_log full text.`);
}

function parseArgs(argv = []) {
  const options = {
    help: false,
    labelsPath: null,
    candidatesPath: null,
    format: null,
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
    if (arg === "--labels") {
      options.labelsPath = resolve(readFlagValue(argv, i, "--labels"));
      i += 1;
      continue;
    }
    if (arg === "--candidates") {
      options.candidatesPath = resolve(readFlagValue(argv, i, "--candidates"));
      i += 1;
      continue;
    }
    if (arg === "--format") {
      options.format = readFlagValue(argv, i, "--format");
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

  if (!options.help && !options.labelsPath) {
    throw new Error("--labels is required");
  }
  if (!options.help && !options.candidatesPath) {
    throw new Error("--candidates is required");
  }
  return options;
}

function printHuman(summary) {
  writeStdout(`mode: ${summary.mode}`);
  writeStdout(`writes_db: ${summary.writes_db}`);
  writeStdout(`migration_applied: ${summary.migration_applied}`);
  writeStdout(`packet_count: ${summary.packet_count}`);
  writeStdout(`missing_candidate_count: ${summary.missing_candidate_count}`);
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
  const summary = mod.buildEventAtPilotReviewPacket(options);
  printHuman(summary);
}

if (process.argv[1] && /build-event-at-pilot-review-packet\.js$/.test(process.argv[1])) {
  main().catch((error) => {
    writeStderr(`error: ${String(error?.message || error)}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  main,
};
