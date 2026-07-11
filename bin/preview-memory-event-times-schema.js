#!/usr/bin/env node

const Database = require("better-sqlite3");
const { existsSync } = require("node:fs");
const { homedir } = require("node:os");
const { resolve } = require("node:path");

const DEFAULT_ENGINE_DB = resolve(homedir(), ".openclaw/memory/memory-engine/memory-engine.sqlite");

function parseArgs(argv = []) {
  const options = { engineDbPath: process.env.MEMORY_ENGINE_DB || DEFAULT_ENGINE_DB, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "help") { options.help = true; continue; }
    if (arg === "--json") { options.json = true; continue; }
    if (arg === "--engine-db") { const next = argv[++i]; if (!next || next.startsWith("--")) throw new Error("--engine-db expects a value"); options.engineDbPath = resolve(next); continue; }
    throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write("Preview memory_event_times sidecar schema (read-only)\n\nUsage: node bin/preview-memory-event-times-schema.js [--engine-db <path>] --json\n\nNo CREATE TABLE is executed. Core DB is never opened.\n");
    return;
  }
  process.stdout.write(`${JSON.stringify(previewMemoryEventTimesSchema(options.engineDbPath), null, 2)}\n`);
}

function previewMemoryEventTimesSchema(engineDbPath) {
  if (!existsSync(engineDbPath)) return { table: "memory_event_times", exists: false, would_create: true, columns: [], indexes: [], writes_db: false, core_db_modified: false };
  const db = new Database(engineDbPath, { readonly: true, fileMustExist: true });
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_event_times'").get();
    const columns = table ? db.prepare("PRAGMA table_info(memory_event_times)").all().map((row) => ({ name: row.name, type: row.type, notnull: row.notnull, pk: row.pk })) : [];
    const indexes = table ? db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'memory_event_times' AND name NOT LIKE 'sqlite_%'").all() : [];
    return { table: "memory_event_times", exists: Boolean(table), would_create: !table, columns, indexes, writes_db: false, core_db_modified: false };
  } finally { db.close(); }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`error: ${String(error?.message || error)}\n`); process.exitCode = 1; });

module.exports = { main, parseArgs, previewMemoryEventTimesSchema };
