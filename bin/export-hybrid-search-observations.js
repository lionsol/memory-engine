#!/usr/bin/env node

const { existsSync, writeFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { resolve } = require("node:path");
const Database = require("better-sqlite3");

const PRODUCTION_SURFACES = Object.freeze([
  "auto_recall",
  "memory_engine_action_search",
  "memory_engine_search",
]);

function expandHome(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text === "~") return homedir();
  if (text.startsWith("~/")) return resolve(homedir(), text.slice(2));
  return resolve(text);
}

function parseIso(value, flagName) {
  const text = String(value || "").trim();
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  if (!text || !hasTimeZone || !Number.isFinite(Date.parse(text))) {
    throw new Error(`${flagName} must be a valid ISO date-time with an explicit timezone`);
  }
  return new Date(text).toISOString();
}

function readFlagValue(args, index, flagName) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flagName} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const options = {
    help: false,
    db: null,
    out: null,
    format: "jsonl",
    since: null,
    until: null,
    surfaces: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "help") {
      options.help = true;
      continue;
    }
    if (arg === "--db") {
      options.db = expandHome(readFlagValue(argv, index, "--db"));
      index += 1;
      continue;
    }
    if (arg === "--out") {
      options.out = expandHome(readFlagValue(argv, index, "--out"));
      index += 1;
      continue;
    }
    if (arg === "--format") {
      options.format = String(readFlagValue(argv, index, "--format")).trim();
      index += 1;
      continue;
    }
    if (arg === "--since") {
      options.since = parseIso(readFlagValue(argv, index, "--since"), "--since");
      index += 1;
      continue;
    }
    if (arg === "--until") {
      options.until = parseIso(readFlagValue(argv, index, "--until"), "--until");
      index += 1;
      continue;
    }
    if (arg === "--surface") {
      const surface = String(readFlagValue(argv, index, "--surface")).trim();
      if (!PRODUCTION_SURFACES.includes(surface)) {
        throw new Error(`--surface must be one of: ${PRODUCTION_SURFACES.join(", ")}`);
      }
      options.surfaces.push(surface);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  options.surfaces = [...new Set(options.surfaces)];
  if (!options.help && !options.db) throw new Error("--db is required");
  if (!["json", "jsonl"].includes(options.format)) {
    throw new Error("--format must be one of: json, jsonl");
  }
  if (options.since && options.until && Date.parse(options.since) > Date.parse(options.until)) {
    throw new Error("--since must not be later than --until");
  }
  return options;
}

function printHelp() {
  console.log(`Export Hybrid Search Observations

Usage:
  node bin/export-hybrid-search-observations.js
      --db <engine.sqlite>
      [--since <ISO>] [--until <ISO>]
      [--surface <production-surface>]...
      [--format <json|jsonl>] [--out <path>]

Production surfaces:
  ${PRODUCTION_SURFACES.join("\n  ")}

Safety:
  - Opens only the explicitly supplied SQLite file.
  - Opens SQLite in readonly and file-must-exist mode.
  - Reads only hybrid_search_observation rows from memory_events.
  - Does not change plugin configuration or runtime state.
  - Writes a report file only when --out is supplied.`);
}

function safeMetadata(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function timestampMs(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function filterObservationRows(rows, {
  since = null,
  until = null,
  surfaces = [],
} = {}) {
  const sinceMs = since ? Date.parse(since) : null;
  const untilMs = until ? Date.parse(until) : null;
  const surfaceSet = new Set(surfaces);

  return (Array.isArray(rows) ? rows : []).filter(row => {
    const createdAtMs = timestampMs(row?.created_at);
    if (sinceMs !== null && (createdAtMs === null || createdAtMs < sinceMs)) return false;
    if (untilMs !== null && (createdAtMs === null || createdAtMs > untilMs)) return false;
    if (surfaceSet.size > 0) {
      const metadata = safeMetadata(row?.metadata_json);
      if (!metadata || !surfaceSet.has(metadata.surface)) return false;
    }
    return true;
  });
}

function exportObservations(options = {}) {
  const dbPath = expandHome(options.db);
  if (!dbPath) throw new Error("database path is required");
  if (!existsSync(dbPath)) throw new Error(`database does not exist: ${dbPath}`);

  const db = new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
  });

  try {
    db.pragma("query_only = ON");
    const table = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get("memory_events");
    if (!table?.name) throw new Error("memory_events table is missing");

    const rows = db.prepare(`
      SELECT
        id,
        event_type,
        session_id,
        trace_id,
        source,
        metadata_json,
        created_at
      FROM memory_events
      WHERE event_type = ?
      ORDER BY created_at ASC, id ASC
    `).all("hybrid_search_observation");

    return filterObservationRows(rows, options);
  } finally {
    db.close();
  }
}

function serializeRows(rows, format = "jsonl") {
  if (format === "json") return `${JSON.stringify(rows, null, 2)}\n`;
  if (!Array.isArray(rows) || rows.length === 0) return "";
  return `${rows.map(row => JSON.stringify(row)).join("\n")}\n`;
}

function writeOutput(output, outPath = null) {
  if (outPath) {
    writeFileSync(outPath, output, "utf8");
    return;
  }
  process.stdout.write(output);
}

async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      printHelp();
      return 0;
    }
    const rows = exportObservations(options);
    writeOutput(serializeRows(rows, options.format), options.out);
    return 0;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    return 1;
  }
}

module.exports = {
  PRODUCTION_SURFACES,
  expandHome,
  parseArgs,
  filterObservationRows,
  exportObservations,
  serializeRows,
  main,
};

if (process.argv[1] && /export-hybrid-search-observations\.js$/.test(process.argv[1])) {
  main().then(code => {
    process.exitCode = code;
  });
}
