#!/usr/bin/env node

const { resolve } = require("node:path");
const { homedir, tmpdir } = require("node:os");

const FORBIDDEN_FLAGS = new Set(["--apply", "--force", "--write-db", "--no-backup"]);
const DEFAULT_SESSIONS_DIR = resolve(homedir(), ".openclaw/agents/main/sessions");
const DEFAULT_OUT = resolve(tmpdir(), "memory-engine-reports/event-at-session-evidence.jsonl");

function value(argv, index, flag) {
  const next = argv[index + 1];
  if (!next || next.startsWith("--")) throw new Error(`${flag} expects a value`);
  return next;
}

function parseArgs(argv = []) {
  const options = { candidatesPath: null, labelsPath: null, sessionsDir: DEFAULT_SESSIONS_DIR, outPath: DEFAULT_OUT, onlyAction: null, limit: null, json: false, includeContext: true, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (FORBIDDEN_FLAGS.has(arg)) throw new Error(`unsupported flag: ${arg}`);
    if (arg === "--help" || arg === "help") { options.help = true; continue; }
    if (arg === "--json") { options.json = true; continue; }
    if (arg === "--no-context") { options.includeContext = false; continue; }
    if (["--candidates", "--labels", "--sessions-dir", "--out", "--only-action", "--limit"].includes(arg)) {
      const raw = value(argv, i, arg); i += 1;
      if (arg === "--candidates") options.candidatesPath = resolve(raw);
      if (arg === "--labels") options.labelsPath = resolve(raw);
      if (arg === "--sessions-dir") options.sessionsDir = resolve(raw);
      if (arg === "--out") options.outPath = resolve(raw);
      if (arg === "--only-action") options.onlyAction = raw;
      if (arg === "--limit") options.limit = Number(raw);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help && (!options.candidatesPath || !options.labelsPath)) throw new Error("--candidates and --labels are required");
  if (!options.help && options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) throw new Error("--limit must be a positive integer");
  return options;
}

function printHelp() {
  process.stdout.write(`Resolve event_at session evidence (read-only)\n\nUsage:\n  node bin/resolve-event-at-session-evidence.js --candidates <path> --labels <path> [options]\n\nOptions:\n  --sessions-dir <path>       Session JSONL directory\n  --out <path>                Evidence JSONL output\n  --only-action <action>      Restrict to one review action\n  --limit <n>                 Limit candidates\n  --no-context                Omit capped context\n  --json                      Print summary JSON\n  --help                      Show help\n\nRefused: --apply --force --write-db --no-backup\n`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { printHelp(); return; }
  try {
    const { resolveEvidence } = await import("../lib/event-at-session-evidence.js");
    const summary = resolveEvidence(options);
    const { rows: _rows, ...report } = summary;
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`error: ${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`error: ${String(error?.message || error)}\n`); process.exitCode = 1; });

module.exports = { parseArgs, main };
