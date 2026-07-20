#!/usr/bin/env node

const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const Database = require("better-sqlite3");
const { loadObservationReports } = require("./lib/observation-report-input.js");

const PRODUCT_EVENT_TYPES = Object.freeze([
  "recall_started",
  "recall_completed",
  "auto_recall_debug",
  "memory_injected",
]);

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const options = {
    db: null,
    events: null,
    qualityReview: null,
    thresholds: null,
    checkedAt: undefined,
    out: null,
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--pretty") options.pretty = true;
    else if (arg === "--db") { options.db = readValue(argv, index, arg); index += 1; }
    else if (arg === "--events") { options.events = readValue(argv, index, arg); index += 1; }
    else if (arg === "--quality-review") { options.qualityReview = readValue(argv, index, arg); index += 1; }
    else if (arg === "--thresholds") { options.thresholds = readValue(argv, index, arg); index += 1; }
    else if (arg === "--checked-at") { options.checkedAt = readValue(argv, index, arg); index += 1; }
    else if (arg === "--out") { options.out = readValue(argv, index, arg); index += 1; }
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help && Boolean(options.db) === Boolean(options.events)) throw new Error("exactly one of --db or --events is required");
  return options;
}

function loadJson(path, label) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
    return value;
  } catch (error) {
    throw new Error(`failed to read ${label}: ${error.message}`);
  }
}

function loadProductEventsFromDb(dbPath) {
  if (!existsSync(dbPath)) throw new Error(`database does not exist: ${dbPath}`);
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma("query_only = ON");
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get("memory_events");
    if (!table?.name) throw new Error("memory_events table is missing");
    const placeholders = PRODUCT_EVENT_TYPES.map(() => "?").join(",");
    return db.prepare(`
      SELECT id, event_type, session_id, trace_id, memory_id, source,
             latency_ms, candidate_count, injected_count, metadata_json, created_at
      FROM memory_events
      WHERE event_type IN (${placeholders})
      ORDER BY created_at ASC, id ASC
    `).all(...PRODUCT_EVENT_TYPES);
  } finally {
    db.close();
  }
}

function usage() {
  return `Usage:\n  node bin/build-auto-recall-product-health-report.js\n    (--db <engine.sqlite> | --events <events.json|events.jsonl>)\n    [--quality-review <review.json>] [--thresholds <thresholds.json>]\n    [--checked-at <canonical-UTC-ISO>] [--out <report.json>] [--pretty]\n\nThe command is read-only. Missing, stale, or undersized quality review evidence returns status=not_evaluated rather than healthy.`;
}

function exitCode(status) {
  if (status === "healthy") return 0;
  if (status === "not_evaluated") return 1;
  if (status === "rollback_required") return 2;
  return 64;
}

async function buildAutoRecallProductHealthCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage(), report: null, out: null };
  const { buildAutoRecallProductHealthReport } = await import("../lib/recall/hybrid/auto-recall-product-health.js");
  const events = options.db ? loadProductEventsFromDb(options.db) : loadObservationReports(options.events);
  const report = buildAutoRecallProductHealthReport({
    events,
    qualityReview: options.qualityReview ? loadJson(options.qualityReview, "quality review") : undefined,
    thresholds: options.thresholds ? loadJson(options.thresholds, "product health thresholds") : undefined,
    checkedAt: options.checkedAt,
  });
  const output = `${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`;
  if (options.out) writeFileSync(options.out, output, "utf8");
  return { exitCode: exitCode(report.status), output, report, out: options.out };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await buildAutoRecallProductHealthCli(argv);
    if (!result.out || result.report === null) process.stdout.write(result.output);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 64;
  }
}

module.exports = {
  PRODUCT_EVENT_TYPES,
  parseArgs,
  loadProductEventsFromDb,
  buildAutoRecallProductHealthCli,
  main,
};

if (require.main === module) main();
