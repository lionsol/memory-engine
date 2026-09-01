#!/usr/bin/env node

const { writeSync } = require("node:fs");
const { resolve } = require("node:path");
const { homedir } = require("node:os");

const DEFAULT_CORE_DB_PATH = resolve(homedir(), ".openclaw/memory/main.sqlite");
const DEFAULT_ENGINE_DB_PATH = resolve(homedir(), ".openclaw/memory/memory-engine/memory-engine.sqlite");
const DEFAULT_SESSIONS_DIR = resolve(homedir(), ".openclaw/agents/main/sessions");
const FORBIDDEN_FLAGS = new Set(["--force", "--write-db", "--no-backup"]);

function writeStdout(text) {
  writeSync(1, `${String(text)}\n`);
}

function writeStderr(text) {
  writeSync(2, `${String(text)}\n`);
}

function printHelp() {
  writeStdout(`Core Chunk Time Migration

Usage:
  node bin/migrate-core-chunk-times.js [options]

Options:
  --help                         Show this help
  --json                         Print JSON report only
  --core-db <path>               Core DB path; default: ${DEFAULT_CORE_DB_PATH}
  --engine-db <path>             Engine DB path; default: ${DEFAULT_ENGINE_DB_PATH}
  --sessions-dir <path>          Session transcript dir; default: ${DEFAULT_SESSIONS_DIR}
  --no-session-transcript-recovery
                                 Disable exact chunk-id recovery from session transcripts
  --apply                        Retired; always refused by Core ownership boundary
  --confirm-core-time-migration <token>
                                 Legacy compatibility option; cannot authorize Core writes
  --confirm-unrecoverable-event-at-nulls <token>
                                 Legacy compatibility option; cannot authorize Core writes

Retired compatibility options:
  --backup-dir <path>            Historical backup option; cannot authorize Core writes

Refused:
  --force --write-db --no-backup

Notes:
  - Default mode is dry-run and writes no DB files.
  - Core event_at migration is retired and must not be applied.
  - --apply and historical confirmation tokens always fail with CORE_WRITE_PROHIBITED.
  - Default mode is read-only audit; it never changes Core schema, rows, or backup files.
  - event_at diagnostics are conservative: only leading ISO timestamps and exact session transcript chunk-id matches are reported.
  - updated_at is never treated as event_at.
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
    apply: false,
    confirmToken: null,
    confirmUnrecoverableEventAtNulls: null,
    coreDbPath: null,
    engineDbPath: null,
    sessionsDir: null,
    sessionTranscriptRecovery: true,
    backupDir: null,
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
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--confirm-core-time-migration") {
      options.confirmToken = readFlagValue(args, i, "--confirm-core-time-migration");
      i += 1;
      continue;
    }
    if (arg === "--confirm-unrecoverable-event-at-nulls") {
      options.confirmUnrecoverableEventAtNulls = readFlagValue(args, i, "--confirm-unrecoverable-event-at-nulls");
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
    if (arg === "--no-session-transcript-recovery") {
      options.sessionTranscriptRecovery = false;
      continue;
    }
    if (arg === "--backup-dir") {
      options.backupDir = readFlagValue(args, i, "--backup-dir");
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

function toMigrationOptions(options) {
  return {
    coreDbPath: options.coreDbPath || process.env.MEMORY_ENGINE_CORE_DB || process.env.CORE_DB_PATH || DEFAULT_CORE_DB_PATH,
    engineDbPath: options.engineDbPath || process.env.MEMORY_ENGINE_DB || process.env.ENGINE_DB_PATH || DEFAULT_ENGINE_DB_PATH,
    sessionsDir: options.sessionsDir || process.env.MEMORY_ENGINE_SESSIONS_DIR || DEFAULT_SESSIONS_DIR,
    sessionTranscriptRecovery: options.sessionTranscriptRecovery,
    backupDir: options.backupDir || null,
    confirmToken: options.confirmToken,
    confirmUnrecoverableEventAtNulls: options.confirmUnrecoverableEventAtNulls,
  };
}

function printHuman(report) {
  writeStdout(`mode: ${report.mode}`);
  writeStdout(`core_db_path: ${report.core_db_path}`);
  writeStdout(`engine_db_path: ${report.engine_db_path}`);
  writeStdout(`sessions_dir: ${report.sessions_dir}`);
  if (report.mode === "dry_run") {
    writeStdout(`would_add_columns: ${(report.would_add_columns || []).join(", ") || "none"}`);
    writeStdout(`raw_log_total_count: ${report.raw_log_total_count}`);
    writeStdout(`event_at_null_count: ${report.event_at_null_count}`);
    writeStdout(`session_files_scanned: ${report.session_files_scanned}`);
    writeStdout(`session_messages_indexed: ${report.session_messages_indexed}`);
    writeStdout(`recoverable_event_at_backfill_count: ${report.recoverable_event_at_backfill_count}`);
    writeStdout(`session_transcript_exact_id_backfill_count: ${report.session_transcript_exact_id_backfill_count}`);
    writeStdout(`unrecoverable_event_at_null_count: ${report.unrecoverable_event_at_null_count}`);
    writeStdout(`apply_prohibited: ${report.apply_prohibited}`);
    writeStdout(`write_prohibition_code: ${report.write_prohibition_code}`);
    return;
  }
  writeStdout(`backup_paths: ${(report.backup_paths || []).join(", ")}`);
  writeStdout(`added_columns: ${(report.added_columns || []).join(", ") || "none"}`);
  writeStdout(`backfilled_event_at_count: ${report.backfilled_event_at_count}`);
  writeStdout(`remaining_unrecoverable_event_at_null_count: ${report.remaining_unrecoverable_event_at_null_count}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const migration = await import("../lib/db/core-chunk-time-migration.js");
  let report;
  if (options.apply) {
    report = migration.applyCoreChunkTimeMigration(toMigrationOptions(options));
  } else {
    report = migration.inspectCoreChunkTimeMigration(toMigrationOptions(options));
  }

  if (options.json) {
    writeStdout(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
}

main().catch((error) => {
  writeStderr(`error: ${String(error?.message || error)}`);
  process.exit(1);
});
