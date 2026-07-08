#!/usr/bin/env node

const { writeSync } = require("node:fs");
const { resolve } = require("node:path");
const { homedir } = require("node:os");

const DEFAULT_CORE_DB_PATH = resolve(homedir(), ".openclaw/memory/main.sqlite");
const DEFAULT_ENGINE_DB_PATH = resolve(homedir(), ".openclaw/memory/memory-engine/memory-engine.sqlite");
const DEFAULT_SESSIONS_DIR = resolve(homedir(), ".openclaw/agents/main/sessions");
const FORBIDDEN_FLAGS = new Set(["--apply", "--force", "--write-db", "--no-backup"]);

function writeStdout(text) {
  writeSync(1, `${String(text)}\n`);
}

function writeStderr(text) {
  writeSync(2, `${String(text)}\n`);
}

function printHelp() {
  writeStdout(`Preview Core Chunk Event Time Migration Impact

Usage:
  node bin/preview-core-chunk-event-time-migration-impact.js [options]

Options:
  --help                         Show this help
  --json                         Print JSON report only
  --core-db <path>               Core DB path; default: ${DEFAULT_CORE_DB_PATH}
  --engine-db <path>             Engine DB path; default: ${DEFAULT_ENGINE_DB_PATH}
  --sessions-dir <path>          Session transcript dir; default: ${DEFAULT_SESSIONS_DIR}
  --no-session-transcript-recovery
                                 Disable exact chunk-id recovery from session transcripts

Refused:
  --apply --force --write-db --no-backup

Notes:
  - Read-only impact preview only; never writes core DB or engine DB.
  - Does not add event_at or created_at columns.
  - Does not apply migration.
  - updated_at is used only to estimate current legacy checkpoint behavior for comparison.
  - updated_at is never used as an event_at backfill source.
`);
}

function readFlagValue(args, index, flagName) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flagName} expects a value`);
  }
  return value;
}

function parseArgs(argv = []) {
  const options = {
    help: false,
    json: false,
    coreDbPath: null,
    engineDbPath: null,
    sessionsDir: null,
    sessionTranscriptRecovery: true,
  };

  const args = Array.from(argv);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
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
    if (arg === "--core-db") {
      options.coreDbPath = readFlagValue(args, i, "--core-db");
      i += 1;
      continue;
    }
    if (arg === "--engine-db") {
      options.engineDbPath = readFlagValue(args, i, "--engine-db");
      i += 1;
      continue;
    }
    if (arg === "--sessions-dir") {
      options.sessionsDir = readFlagValue(args, i, "--sessions-dir");
      i += 1;
      continue;
    }
    if (arg === "--no-session-transcript-recovery") {
      options.sessionTranscriptRecovery = false;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

function toPreviewOptions(options) {
  return {
    coreDbPath: options.coreDbPath || process.env.MEMORY_ENGINE_CORE_DB || process.env.CORE_DB_PATH || DEFAULT_CORE_DB_PATH,
    engineDbPath: options.engineDbPath || process.env.MEMORY_ENGINE_DB || process.env.ENGINE_DB_PATH || DEFAULT_ENGINE_DB_PATH,
    sessionsDir: options.sessionsDir || process.env.MEMORY_ENGINE_SESSIONS_DIR || DEFAULT_SESSIONS_DIR,
    sessionTranscriptRecovery: options.sessionTranscriptRecovery,
  };
}

function printHuman(report) {
  writeStdout(`mode: ${report.mode}`);
  writeStdout(`writes_db: ${report.writes_db}`);
  writeStdout(`core_db_path: ${report.core_db_path}`);
  writeStdout(`engine_db_path: ${report.engine_db_path}`);
  writeStdout(`sessions_dir: ${report.sessions_dir}`);
  writeStdout(`raw_log_total_count: ${report.raw_log_total_count}`);
  writeStdout(`recoverable_event_at_count: ${report.recoverable_event_at_count}`);
  writeStdout(`unrecoverable_event_at_null_count: ${report.unrecoverable_event_at_null_count}`);
  writeStdout(`estimated_rows_kept_after_migration: ${report.estimated_rows_kept_after_migration}`);
  writeStdout(`estimated_rows_dropped_from_db_raw_log_pool_after_migration: ${report.estimated_rows_dropped_from_db_raw_log_pool_after_migration}`);
  writeStdout(`legacy_time_basis: ${report.legacy_time_basis}`);
  writeStdout(`legacy_updated_at_basis_warning: ${report.legacy_updated_at_basis_warning}`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  const migration = await import("../lib/db/core-chunk-time-migration.js");
  const report = migration.previewCoreChunkEventTimeMigrationImpact(toPreviewOptions(options));
  if (options.json) {
    writeStdout(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
}

if (process.argv[1] && /preview-core-chunk-event-time-migration-impact\.js$/.test(process.argv[1])) {
  main().catch((error) => {
    writeStderr(`error: ${String(error?.message || error)}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  main,
};
