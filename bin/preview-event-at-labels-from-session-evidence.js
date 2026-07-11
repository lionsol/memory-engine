#!/usr/bin/env node

const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const FORBIDDEN_FLAGS = new Set(["--apply", "--force", "--write-db", "--no-backup"]);
const ACTION = "recover_event_at";

function readArg(argv, index, flag) {
  const next = argv[index + 1];
  if (!next || next.startsWith("--")) throw new Error(`${flag} expects a value`);
  return resolve(next);
}

function parseArgs(argv = []) {
  const options = { labelsPath: null, evidencePath: null, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (FORBIDDEN_FLAGS.has(arg)) throw new Error(`unsupported flag: ${arg}`);
    if (arg === "--help" || arg === "help") { options.help = true; continue; }
    if (arg === "--json") { options.json = true; continue; }
    if (arg === "--labels") { options.labelsPath = readArg(argv, i, arg); i += 1; continue; }
    if (arg === "--evidence") { options.evidencePath = readArg(argv, i, arg); i += 1; continue; }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.help && (!options.labelsPath || !options.evidencePath)) throw new Error("--labels and --evidence are required");
  return options;
}

function readJsonl(path) {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function previewLabelEnrichment(labels, evidence) {
  const evidenceById = new Map(evidence.map((row) => [row.id, row]));
  const wouldSuggest = [];
  for (const label of labels) {
    const row = evidenceById.get(label.id);
    const match = row?.best_match;
    if (label.review_action === ACTION) continue;
    if (row?.resolution_status !== "unique_match" || !match?.eligible_for_event_at_apply) continue;
    if (!["exact_chunk_id", "exact_normalized_text"].includes(match.match_type) || match.event_at === null || match.event_at === undefined) continue;
    wouldSuggest.push({
      id: label.id,
      review_action: ACTION,
      event_at: new Date(Number(match.event_at) * 1000).toISOString(),
      event_at_source: "session_transcript",
      confidence: match.confidence,
      evidence_match_type: match.match_type,
    });
  }
  return { mode: "read_only", suggested_label_updates_count: wouldSuggest.length, would_suggest: wouldSuggest, writes_db: false, migration_applied: false };
}

function printHelp() {
  process.stdout.write(`Preview label enrichment from session evidence (read-only)\n\nUsage:\n  node bin/preview-event-at-labels-from-session-evidence.js --labels <path> --evidence <path> --json\n\nRefused: --apply --force --write-db --no-backup\n`);
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { printHelp(); return; }
  try {
    const summary = previewLabelEnrichment(readJsonl(options.labelsPath), readJsonl(options.evidencePath));
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`error: ${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { parseArgs, main, previewLabelEnrichment };
