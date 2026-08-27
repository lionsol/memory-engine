#!/usr/bin/env node

const { runLongMemEvalSemanticCli } = require("./run-longmemeval-semantic-retrieval-v1.js");

const LONGMEMEVAL_SEMANTIC_QUERY_INSTRUCTION_PROFILE =
  "production_hybrid_semantic_query_instruction_session_v1";

function usage() {
  return [
    "Usage: node bin/run-longmemeval-semantic-query-instruction-retrieval-v1.js --input <longmemeval.json> [options]",
    "",
    "Options:",
    "  --limit <n>                 Run only the first n cases",
    "  --top-k <n>                 Retrieval depth (default: 50)",
    "  --cache-path <path>         Benchmark-owned SQLite embedding cache",
    "  --embedding-base-url <url>  SiliconFlow base URL identity override",
    "  --output <path>             Write full per-case JSON result to a file",
    "  --json                      Print full per-case JSON to stdout instead of summary only",
    "  --help                      Show this help",
    "",
    `RH1 profile: ${LONGMEMEVAL_SEMANTIC_QUERY_INSTRUCTION_PROFILE}`,
    "Only the vector query embedding input receives the fixed query instruction; document and lexical inputs remain unchanged.",
    "Uses temporary benchmark-only Core/Engine/LanceDB state and never falls back to the host memory manager.",
    "A real SiliconFlow API key is required unless an embedding provider is injected by a test seam.",
  ].join("\n");
}

async function runLongMemEvalSemanticQueryInstructionCli(argv = process.argv.slice(2), deps = {}) {
  const runDataset = deps.runDataset || (await import(
    "../lib/benchmark/longmemeval-semantic-query-instruction-retrieval-runner-v1.js"
  )).runLongMemEvalSemanticQueryInstructionRetrievalDataset;
  return runLongMemEvalSemanticCli(argv, {
    ...deps,
    runDataset,
    usage: deps.usage || usage,
  });
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const result = await runLongMemEvalSemanticQueryInstructionCli(argv, deps);
  if (result.help) {
    process.stdout.write(`${result.usage}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(result.printable, null, 2)}\n`);
}

module.exports = {
  LONGMEMEVAL_SEMANTIC_QUERY_INSTRUCTION_PROFILE,
  main,
  runLongMemEvalSemanticQueryInstructionCli,
  usage,
};

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
