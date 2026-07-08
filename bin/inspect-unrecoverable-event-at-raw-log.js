#!/usr/bin/env node

const { writeSync } = require("node:fs");
const { resolve } = require("node:path");
const { homedir } = require("node:os");

const DEFAULT_CORE_DB_PATH = resolve(homedir(), ".openclaw/memory/main.sqlite");
const DEFAULT_ENGINE_DB_PATH = resolve(homedir(), ".openclaw/memory/memory-engine/memory-engine.sqlite");
const DEFAULT_SESSIONS_DIR = resolve(homedir(), ".openclaw/agents/main/sessions");
const DEFAULT_MEMORY_DIR = resolve(process.cwd(), "memory");
const FORBIDDEN_FLAGS = new Set(["--apply", "--force", "--write-db", "--no-backup"]);

function writeStdout(text) {
  writeSync(1, `${String(text)}\n`);
}

function writeStderr(text) {
  writeSync(2, `${String(text)}\n`);
}

function printHelp() {
  writeStdout(`Inspect Unrecoverable Event-At Raw Log

Usage:
  node bin/inspect-unrecoverable-event-at-raw-log.js --date <YYYY-MM-DD> [options]

Options:
  --help                         Show this help
  --json                         Print JSON report only
  --date <YYYY-MM-DD>            Required legacy updated_at date to inspect
  --core-db <path>               Core DB path; default: ${DEFAULT_CORE_DB_PATH}
  --engine-db <path>             Engine DB path; default: ${DEFAULT_ENGINE_DB_PATH}
  --sessions-dir <path>          Session transcript dir; default: ${DEFAULT_SESSIONS_DIR}
  --memory-dir <path>            Workspace memory dir for file existence checks; default: ${DEFAULT_MEMORY_DIR}
  --no-session-transcript-recovery
                                 Disable exact chunk-id recovery index lookup

Refused:
  --apply --force --write-db --no-backup

Notes:
  - Read-only forensic preview only; never writes core DB or engine DB.
  - Does not output raw_log full text.
  - updated_at is used only as a legacy grouping / forensic clue.
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
    date: null,
    coreDbPath: null,
    engineDbPath: null,
    sessionsDir: null,
    memoryDir: null,
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
    if (arg === "--date") {
      options.date = readFlagValue(args, i, "--date");
      i += 1;
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
    if (arg === "--memory-dir") {
      options.memoryDir = readFlagValue(args, i, "--memory-dir");
      i += 1;
      continue;
    }
    if (arg === "--no-session-transcript-recovery") {
      options.sessionTranscriptRecovery = false;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!options.help && !options.date) {
    throw new Error("--date is required");
  }

  return options;
}

function toInspectOptions(options) {
  return {
    date: options.date,
    coreDbPath: options.coreDbPath || process.env.MEMORY_ENGINE_CORE_DB || process.env.CORE_DB_PATH || DEFAULT_CORE_DB_PATH,
    engineDbPath: options.engineDbPath || process.env.MEMORY_ENGINE_DB || process.env.ENGINE_DB_PATH || DEFAULT_ENGINE_DB_PATH,
    sessionsDir: options.sessionsDir || process.env.MEMORY_ENGINE_SESSIONS_DIR || DEFAULT_SESSIONS_DIR,
    memoryDir: options.memoryDir || process.env.MEMORY_ENGINE_MEMORY_DIR || DEFAULT_MEMORY_DIR,
    sessionTranscriptRecovery: options.sessionTranscriptRecovery,
  };
}

function printHuman(report) {
  writeStdout(`mode: ${report.mode}`);
  writeStdout(`writes_db: ${report.writes_db}`);
  writeStdout(`date: ${report.date}`);
  writeStdout(`legacy_rows: ${report.legacy_rows}`);
  writeStdout(`recoverable_rows: ${report.recoverable_rows}`);
  writeStdout(`unrecoverable_rows: ${report.unrecoverable_rows}`);
  writeStdout(`available_in_smart_add_file_count: ${report.available_in_smart_add_file_count}`);
  writeStdout(`looks_like_tool_output_count: ${report.looks_like_tool_output_count}`);
  writeStdout(`looks_like_checkpoint_generated_count: ${report.looks_like_checkpoint_generated_count}`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  const mod = await import("../lib/db/core-chunk-time-migration.js");
  const report = mod.inspectUnrecoverableEventAtRawLog(toInspectOptions(options));
  if (options.json) {
    writeStdout(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
}

if (process.argv[1] && /inspect-unrecoverable-event-at-raw-log\.js$/.test(process.argv[1])) {
  main().catch((error) => {
    writeStderr(`error: ${String(error?.message || error)}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  main,
};
