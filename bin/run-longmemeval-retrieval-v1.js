#!/usr/bin/env node

const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const { basename, resolve } = require("node:path");

function parseArgs(argv) {
  const args = {
    input: null,
    output: null,
    limit: null,
    topK: 50,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--input") args.input = argv[++i] || null;
    else if (token === "--output") args.output = argv[++i] || null;
    else if (token === "--limit") args.limit = Number(argv[++i]);
    else if (token === "--top-k") args.topK = Number(argv[++i]);
    else if (token === "--json") args.json = true;
    else if (token === "--help" || token === "-h") args.help = true;
    else throw new Error(`unknown_argument:${token}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: node bin/run-longmemeval-retrieval-v1.js --input <longmemeval.json> [options]",
    "",
    "Options:",
    "  --limit <n>       Run only the first n cases",
    "  --top-k <n>       Retrieval depth (default: 50)",
    "  --output <path>   Write full per-case JSON result to a file",
    "  --json            Print full per-case JSON to stdout instead of summary only",
    "  --help            Show this help",
    "",
    "B2 profile: production_hybrid_lexical_session_v1",
    "Uses temporary benchmark-only Core/Engine SQLite state and never writes live OpenClaw data.",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.input) throw new Error("--input is required");
  if (!Number.isFinite(args.topK) || args.topK < 1) throw new Error("--top-k must be a positive number");
  if (args.limit !== null && (!Number.isFinite(args.limit) || args.limit < 0)) {
    throw new Error("--limit must be a non-negative number");
  }

  const inputPath = resolve(args.input);
  const inputBytes = readFileSync(inputPath);
  const inputSha256 = createHash("sha256").update(inputBytes).digest("hex");
  const records = JSON.parse(inputBytes.toString("utf8"));
  if (!Array.isArray(records)) throw new Error("LongMemEval input must be a JSON array");

  const {
    runLongMemEvalRetrievalDataset,
  } = await import("../lib/benchmark/longmemeval-retrieval-runner-v1.js");

  const output = await runLongMemEvalRetrievalDataset(records, {
    limit: args.limit,
    topK: Math.trunc(args.topK),
    benchmarkNowSec: Math.floor(Date.now() / 1000),
  });

  output.provenance = {
    input_file: basename(inputPath),
    input_sha256: inputSha256,
  };

  if (args.output) {
    writeFileSync(resolve(args.output), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }

  const printable = args.json ? output : {
    provenance: output.provenance,
    run: output.run,
    summary: output.summary,
  };
  process.stdout.write(`${JSON.stringify(printable, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
