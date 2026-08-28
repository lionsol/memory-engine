#!/usr/bin/env node

const {
  parseArgs: parseSemanticArgs,
  runLongMemEvalSemanticCli,
} = require("./run-longmemeval-semantic-retrieval-v1.js");

const LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE =
  "production_hybrid_semantic_bounded_multi_query_session_v1";

function usage() {
  return [
    "Usage: node bin/run-longmemeval-semantic-bounded-multi-query-retrieval-v1.js --input <longmemeval.json> [options]",
    "",
    "Options:",
    "  --limit <n>                       Run only the first n cases",
    "  --top-k <n>                       Retrieval depth (default: 50)",
    "  --cache-path <path>               Benchmark-owned SQLite embedding cache",
    "  --query-plan-cache-path <path>    Benchmark-owned SQLite query-plan cache",
    "  --embedding-base-url <url>        SiliconFlow embedding base URL identity override",
    "  --planner-base-url <url>          SiliconFlow planner base URL identity override",
    "  --output <path>                   Write full per-case JSON result to a file",
    "  --json                            Print full per-case JSON to stdout instead of summary only",
    "  --help                            Show this help",
    "",
    `H2 profile: ${LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE}`,
    "Planner sees only the exact question and must return exactly two strict JSON queries.",
    "The vector channel executes exactly three searches and fuses them with query-level RRF k=60.",
    "Uses temporary benchmark-only Core/Engine/LanceDB state and never falls back to the host memory manager.",
    "A real SiliconFlow embedding and planner credential is required unless providers are injected by a test seam.",
  ].join("\n");
}

function parseH2Args(argv = []) {
  const baseArgv = [];
  let queryPlanCachePath = null;
  let plannerBaseUrl = null;
  let queryPlanSeen = false;
  let plannerBaseSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token !== "--query-plan-cache-path" && token !== "--planner-base-url") {
      baseArgv.push(token);
      continue;
    }
    const isQueryPlan = token === "--query-plan-cache-path";
    if ((isQueryPlan && queryPlanSeen) || (!isQueryPlan && plannerBaseSeen)) {
      throw new Error(`duplicate_argument:${token}`);
    }
    const value = argv[index + 1];
    if (!value || String(value).startsWith("--")) throw new Error(`missing_argument_value:${token}`);
    index += 1;
    if (isQueryPlan) {
      queryPlanSeen = true;
      queryPlanCachePath = String(value);
    } else {
      plannerBaseSeen = true;
      plannerBaseUrl = String(value);
    }
  }
  parseSemanticArgs(baseArgv);
  return { baseArgv, queryPlanCachePath, plannerBaseUrl };
}

async function runLongMemEvalSemanticBoundedMultiQueryCli(argv = process.argv.slice(2), deps = {}) {
  const parsed = parseH2Args(argv);
  const runDataset = deps.runDataset || (await import(
    "../lib/benchmark/longmemeval-semantic-bounded-multi-query-retrieval-runner-v1.js"
  )).runLongMemEvalSemanticBoundedMultiQueryRetrievalDataset;
  return runLongMemEvalSemanticCli(parsed.baseArgv, {
    ...deps,
    runDataset,
    usage: deps.usage || usage,
    runnerOptions: {
      ...(deps.runnerOptions || {}),
      queryPlanCachePath: parsed.queryPlanCachePath,
      plannerBaseUrl: parsed.plannerBaseUrl,
    },
  });
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const result = await runLongMemEvalSemanticBoundedMultiQueryCli(argv, deps);
  if (result.help) {
    process.stdout.write(`${result.usage}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(result.printable, null, 2)}\n`);
}

module.exports = {
  LONGMEMEVAL_SEMANTIC_BOUNDED_MULTI_QUERY_PROFILE,
  main,
  parseH2Args,
  runLongMemEvalSemanticBoundedMultiQueryCli,
  usage,
};

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
