#!/usr/bin/env node

const { writeSync } = require("node:fs");
const { resolve } = require("node:path");
const { homedir, tmpdir } = require("node:os");

const DEFAULT_CORE_DB_PATH = resolve(homedir(), ".openclaw/memory/main.sqlite");
const DEFAULT_ENGINE_DB_PATH = resolve(homedir(), ".openclaw/memory/memory-engine/memory-engine.sqlite");
const DEFAULT_SESSIONS_DIR = resolve(homedir(), ".openclaw/agents/main/sessions");
const DEFAULT_MEMORY_DIR = resolve(process.cwd(), "memory");
const DEFAULT_REPORT_DIR = resolve(tmpdir(), "memory-engine-reports");
const FORBIDDEN_FLAGS = new Set(["--apply", "--force", "--write-db", "--no-backup"]);

function writeStdout(text) {
  writeSync(1, `${String(text)}\n`);
}

function writeStderr(text) {
  writeSync(2, `${String(text)}\n`);
}

function printHelp() {
  writeStdout(`Export Event-at Manual Recovery Candidates

Usage:
  node bin/export-event-at-manual-recovery-candidates.js --date <YYYY-MM-DD> [options]

Options:
  --help                         Show this help
  --json                         Print summary JSON to stdout
  --date <YYYY-MM-DD>            Required legacy updated_at date to export
  --format <jsonl|md>            Output format; default: jsonl
  --out <path>                   Output file path; default: ${DEFAULT_REPORT_DIR}/event-at-manual-recovery-<date>.<format>
  --preview-chars <n>            Preview cap; default: 240
  --no-preview                   Do not include preview field/column
  --core-db <path>               Core DB path; default: ${DEFAULT_CORE_DB_PATH}
  --engine-db <path>             Engine DB path; default: ${DEFAULT_ENGINE_DB_PATH}
  --sessions-dir <path>          Session transcript dir; default: ${DEFAULT_SESSIONS_DIR}
  --memory-dir <path>            Workspace memory dir for existence checks; default: ${DEFAULT_MEMORY_DIR}
  --no-session-transcript-recovery
                                 Disable exact chunk-id recovery index lookup

Refused:
  --apply --force --write-db --no-backup

Notes:
  - Read-only export only; never writes core DB or engine DB.
  - Exports only recommended_action=manual_recovery_candidate rows.
  - Raw log full text is never exported.
  - Preview text is optional, single-line, and capped.
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
    format: "jsonl",
    outPath: null,
    previewChars: 240,
    includePreview: true,
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
    if (arg === "--format") {
      options.format = readFlagValue(args, i, "--format");
      i += 1;
      continue;
    }
    if (arg === "--out") {
      options.outPath = readFlagValue(args, i, "--out");
      i += 1;
      continue;
    }
    if (arg === "--preview-chars") {
      options.previewChars = Number(readFlagValue(args, i, "--preview-chars"));
      i += 1;
      continue;
    }
    if (arg === "--no-preview") {
      options.includePreview = false;
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

function resolveDefaultOutPath(date, format) {
  return resolve(DEFAULT_REPORT_DIR, `event-at-manual-recovery-${date}.${format}`);
}

function toExportOptions(options) {
  return {
    date: options.date,
    format: options.format,
    outPath: options.outPath || resolveDefaultOutPath(options.date, options.format),
    previewChars: options.previewChars,
    includePreview: options.includePreview,
    coreDbPath: options.coreDbPath || process.env.MEMORY_ENGINE_CORE_DB || process.env.CORE_DB_PATH || DEFAULT_CORE_DB_PATH,
    engineDbPath: options.engineDbPath || process.env.MEMORY_ENGINE_DB || process.env.ENGINE_DB_PATH || DEFAULT_ENGINE_DB_PATH,
    sessionsDir: options.sessionsDir || process.env.MEMORY_ENGINE_SESSIONS_DIR || DEFAULT_SESSIONS_DIR,
    memoryDir: options.memoryDir || process.env.MEMORY_ENGINE_MEMORY_DIR || DEFAULT_MEMORY_DIR,
    sessionTranscriptRecovery: options.sessionTranscriptRecovery,
  };
}

function printHuman(summary) {
  writeStdout(`mode: ${summary.mode}`);
  writeStdout(`writes_db: ${summary.writes_db}`);
  writeStdout(`date: ${summary.date}`);
  writeStdout(`candidate_count: ${summary.candidate_count}`);
  writeStdout(`output_path: ${summary.output_path}`);
  writeStdout(`preview_chars: ${summary.preview_chars}`);
  writeStdout(`raw_text_exported: ${summary.raw_text_exported}`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  const mod = await import("../lib/db/core-chunk-time-migration.js");
  const summary = mod.exportEventAtManualRecoveryCandidates(toExportOptions(options));
  if (options.json) {
    writeStdout(JSON.stringify(summary, null, 2));
  } else {
    printHuman(summary);
  }
}

if (process.argv[1] && /export-event-at-manual-recovery-candidates\.js$/.test(process.argv[1])) {
  main().catch((error) => {
    writeStderr(`error: ${String(error?.message || error)}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  main,
};
