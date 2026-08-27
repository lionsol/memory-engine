#!/usr/bin/env node

const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const { basename, resolve } = require("node:path");

function parseArgs(argv) {
  const args = {
    input: null,
    output: null,
    cachePath: null,
    limit: null,
    topK: 50,
    embeddingBaseUrl: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--input") args.input = argv[++i] || null;
    else if (token === "--output") args.output = argv[++i] || null;
    else if (token === "--cache-path") args.cachePath = argv[++i] || null;
    else if (token === "--limit") args.limit = Number(argv[++i]);
    else if (token === "--top-k") args.topK = Number(argv[++i]);
    else if (token === "--embedding-base-url") args.embeddingBaseUrl = argv[++i] || null;
    else if (token === "--json") args.json = true;
    else if (token === "--help" || token === "-h") args.help = true;
    else throw new Error(`unknown_argument:${token}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: node bin/run-longmemeval-semantic-retrieval-v1.js --input <longmemeval.json> [options]",
    "",
    "Options:",
    "  --limit <n>                 Run only the first n cases",
    "  --top-k <n>                 Retrieval depth (default: 50)",
    "  --cache-path <path>         Benchmark-owned embedding cache JSON",
    "  --embedding-base-url <url>  SiliconFlow base URL identity override",
    "  --output <path>             Write full per-case JSON result to a file",
    "  --json                      Print full per-case JSON to stdout instead of summary only",
    "  --help                      Show this help",
    "",
    "B4 profile: production_hybrid_semantic_session_v1",
    "Uses temporary benchmark-only Core/Engine/LanceDB state and never falls back to the host memory manager.",
    "A real SiliconFlow API key is required unless an embedding provider is injected by a test seam.",
  ].join("\n");
}

async function runLongMemEvalSemanticCli(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  if (args.help) return { help: true, usage: usage() };
  if (!args.input) throw new Error("--input is required");
  if (!Number.isFinite(args.topK) || args.topK < 1) throw new Error("--top-k must be a positive number");
  if (args.limit !== null && (!Number.isFinite(args.limit) || args.limit < 0)) {
    throw new Error("--limit must be a non-negative number");
  }

  const inputPath = resolve(args.input);
  const readFile = deps.readFile || readFileSync;
  const inputBytes = readFile(inputPath);
  const inputBuffer = Buffer.from(inputBytes);
  const inputSha256 = createHash("sha256").update(inputBuffer).digest("hex");
  const records = JSON.parse(inputBuffer.toString("utf8"));
  if (!Array.isArray(records)) throw new Error("LongMemEval input must be a JSON array");

  const runDataset = deps.runDataset || (await import("../lib/benchmark/longmemeval-semantic-retrieval-runner-v1.js"))
    .runLongMemEvalSemanticRetrievalDataset;
  const runnerOptions = {
    ...(deps.runnerOptions || {}),
    limit: args.limit,
    topK: Math.trunc(args.topK),
    cachePath: args.cachePath,
    embeddingBaseUrl: args.embeddingBaseUrl,
    datasetSha256: inputSha256,
  };
  if (Object.hasOwn(deps, "embeddingProvider")) runnerOptions.embeddingProvider = deps.embeddingProvider;
  const output = await runDataset(records, runnerOptions);
  output.provenance = {
    ...(output.provenance || {}),
    input_file: basename(inputPath),
    input_sha256: inputSha256,
  };

  if (args.output) {
    const writeFile = deps.writeFile || writeFileSync;
    writeFile(resolve(args.output), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }

  return {
    help: false,
    output,
    printable: args.json ? output : {
      provenance: output.provenance,
      run: output.run,
      summary: output.summary,
    },
  };
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const result = await runLongMemEvalSemanticCli(argv, deps);
  if (result.help) {
    process.stdout.write(`${result.usage}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(result.printable, null, 2)}\n`);
}

module.exports = {
  main,
  parseArgs,
  runLongMemEvalSemanticCli,
  usage,
};

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
