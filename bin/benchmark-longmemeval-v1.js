#!/usr/bin/env node

const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

function usage() {
  return [
    "Usage: node bin/benchmark-longmemeval-v1.js --input <longmemeval.json> [--json]",
    "",
    "Validates and summarizes a LongMemEval dataset without writing memory-engine runtime data.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { input: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") {
      args.input = argv[i + 1] || null;
      i += 1;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`unknown_argument:${arg}`);
    }
  }
  return args;
}

function renderSummary(summary) {
  const lines = [
    `schema=${summary.schema}`,
    `cases=${summary.cases}`,
    `sessions=${summary.sessions}`,
    `turns=${summary.turns}`,
    `evidence_sessions=${summary.evidence_sessions}`,
    `abstention_cases=${summary.abstention_cases}`,
  ];
  for (const [type, count] of Object.entries(summary.by_question_type).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`question_type.${type}=${count}`);
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.input) throw new Error("--input is required");

  const { summarizeLongMemEvalDataset } = await import("../lib/benchmark/longmemeval-v1.js");
  const inputPath = resolve(args.input);
  const parsed = JSON.parse(readFileSync(inputPath, "utf8"));
  const summary = summarizeLongMemEvalDataset(parsed);
  console.log(args.json ? JSON.stringify(summary, null, 2) : renderSummary(summary));
}

main().catch(error => {
  console.error(`benchmark-longmemeval-v1: ${error?.message || error}`);
  console.error(usage());
  process.exitCode = 1;
});
