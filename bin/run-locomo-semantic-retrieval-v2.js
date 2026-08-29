#!/usr/bin/env node

const { createHash } = require("node:crypto");
const { execFileSync: defaultExecFileSync } = require("node:child_process");
const { homedir } = require("node:os");
const { basename, resolve, sep } = require("node:path");
const { readFileSync, writeFileSync } = require("node:fs");

const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const DECIMAL_INTEGER_PATTERN = /^[0-9]+$/u;
const LOCOMO_SEMANTIC_PROFILE = "production_hybrid_semantic_dialog_locomo_time_frozen_v2";
const LOCOMO_SEMANTIC_RUNNER_SCHEMA = "memory_engine_locomo_semantic_retrieval_time_frozen_v2";
const LOCOMO_SEMANTIC_TOP_K = 50;
const LOCOMO_SEMANTIC_BENCHMARK_CLOCK_CONTRACT = "locomo_materialization_and_search_fixed_v2";
const LOCOMO_SEMANTIC_VECTOR_MODE = "temporary_lancedb";
const LOCOMO_SEMANTIC_HOST_MANAGER_MODE = "forbidden";

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing_argument_value:${option}`);
  return value;
}

function parseBenchmarkNowSec(value) {
  if (typeof value !== "string" || !DECIMAL_INTEGER_PATTERN.test(value)) {
    throw new Error("benchmark_now_sec_must_be_positive_safe_integer");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("benchmark_now_sec_must_be_positive_safe_integer");
  }
  return parsed;
}

function parseSafeInteger(value, label, { minimum = 0 } = {}) {
  if (typeof value !== "string" || !DECIMAL_INTEGER_PATTERN.test(value)) {
    throw new Error(`${label}_must_be_safe_integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${label}_must_be_safe_integer`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    input: null,
    output: null,
    cachePath: null,
    limit: null,
    topK: LOCOMO_SEMANTIC_TOP_K,
    benchmarkNowSec: null,
    requireOfficial: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input") {
      args.input = requireValue(argv, index, token);
      index += 1;
    } else if (token === "--output") {
      args.output = requireValue(argv, index, token);
      index += 1;
    } else if (token === "--cache-path") {
      args.cachePath = requireValue(argv, index, token);
      index += 1;
    } else if (token === "--limit") {
      args.limit = parseSafeInteger(requireValue(argv, index, token), "limit");
      index += 1;
    } else if (token === "--top-k") {
      args.topK = parseSafeInteger(requireValue(argv, index, token), "top_k", { minimum: 1 });
      if (args.topK !== LOCOMO_SEMANTIC_TOP_K) throw new Error("locomo_semantic_top_k_must_be_50");
      index += 1;
    } else if (token === "--benchmark-now-sec") {
      if (args.benchmarkNowSec !== null) throw new Error("duplicate_argument:--benchmark-now-sec");
      args.benchmarkNowSec = parseBenchmarkNowSec(requireValue(argv, index, token));
      index += 1;
    } else if (token === "--require-official") {
      args.requireOfficial = true;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else {
      throw new Error(`unknown_argument:${token}`);
    }
  }
  return args;
}

function usage() {
  return [
    "Usage: node bin/run-locomo-semantic-retrieval-v2.js --input <locomo10.json> --benchmark-now-sec <n> [options]",
    "",
    "Options:",
    "  --limit <n>              Run only the first n conversations",
    "  --top-k <n>              Fixed semantic retrieval depth; must be 50",
    "  --benchmark-now-sec <n>  Required fixed materialization/search clock",
    "  --cache-path <path>      Benchmark-owned SQLite embedding cache",
    "  --require-official       Require the pinned official dataset SHA and shape",
    "  --output <path>          Write full per-question JSON result to a file",
    "  --json                   Print full per-question JSON to stdout",
    "  --help                   Show this help",
    "",
    `B5-I3 profile: ${LOCOMO_SEMANTIC_PROFILE}`,
    `Clock contract: ${LOCOMO_SEMANTIC_BENCHMARK_CLOCK_CONTRACT}`,
    "Embedding: SiliconFlow Qwen/Qwen3-Embedding-4B, dimension 2560",
    "Canonical vector projection: v1, max 2000 characters",
    "Vector backend: temporary LanceDB; host-manager fallback is forbidden",
  ].join("\n");
}

function validateRepositoryProvenance(value) {
  const commit = String(value?.repository_commit ?? value?.repositoryCommit ?? "").trim();
  if (!GIT_COMMIT_PATTERN.test(commit)) throw new Error("locomo_semantic_repository_provenance_invalid_commit");
  const clean = value?.repository_worktree_clean ?? value?.repositoryWorktreeClean;
  if (typeof clean !== "boolean") throw new Error("locomo_semantic_repository_provenance_invalid_worktree_state");
  const source = value?.repository_provenance_source ?? value?.repositoryProvenanceSource;
  if (source !== "git") throw new Error("locomo_semantic_repository_provenance_invalid_source");
  return {
    repository_commit: commit,
    repository_worktree_clean: clean,
    repository_provenance_source: "git",
  };
}

function resolveRepositoryProvenance({ repositoryRoot, execFileSync = defaultExecFileSync } = {}) {
  let commit;
  let status;
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" });
    status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
  } catch {
    throw new Error("locomo_semantic_repository_provenance_unavailable");
  }
  return validateRepositoryProvenance({
    repository_commit: String(commit).trim(),
    repository_worktree_clean: String(status).trim().length === 0,
    repository_provenance_source: "git",
  });
}

function assertNotLivePath(value, label) {
  const candidate = resolve(String(value));
  const liveRoot = resolve(homedir(), ".openclaw", "memory");
  if (candidate === liveRoot || candidate.startsWith(`${liveRoot}${sep}`)) {
    throw new Error(`locomo_semantic_${label}_live_memory_path_rejected`);
  }
  return candidate;
}

function rejectRunnerOverrides(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("locomo_semantic_runner_options_must_be_object");
  }
  const reserved = [
    "profile",
    "repositoryProvenance",
    "repository_commit",
    "repository_worktree_clean",
    "repository_provenance_source",
    "datasetSha256",
    "benchmarkNowSec",
    "benchmark_now_sec",
    "materializationNowSec",
    "materialization_now_sec",
    "searchNowSec",
    "search_now_sec",
    "benchmarkClockContract",
    "benchmark_clock_contract",
    "topK",
    "limit",
    "lexicalConfidenceThreshold",
    "lexical_confidence_threshold",
    "vectorTopK",
    "vector_top_k",
  ];
  const conflicts = reserved.filter(key => Object.hasOwn(options, key));
  if (conflicts.length > 0) throw new Error(`locomo_semantic_cli_reserved_override:${conflicts.join(",")}`);
}

function assertOutputContract(output, benchmarkNowSec, repositoryProvenance, datasetSha256) {
  if (!output || typeof output !== "object") throw new Error("locomo_semantic_output_invalid");
  if (output.schema !== LOCOMO_SEMANTIC_RUNNER_SCHEMA || output.profile !== LOCOMO_SEMANTIC_PROFILE) {
    throw new Error("locomo_semantic_profile_mismatch");
  }
  for (const scope of [output.provenance, output.run]) {
    if (scope?.profile !== LOCOMO_SEMANTIC_PROFILE
        || scope?.benchmark_now_sec !== benchmarkNowSec
        || scope?.materialization_now_sec !== benchmarkNowSec
        || scope?.search_now_sec !== benchmarkNowSec
        || scope?.benchmark_clock_contract !== LOCOMO_SEMANTIC_BENCHMARK_CLOCK_CONTRACT
        || scope?.repository_commit !== repositoryProvenance.repository_commit
        || scope?.repository_worktree_clean !== repositoryProvenance.repository_worktree_clean
        || scope?.repository_provenance_source !== repositoryProvenance.repository_provenance_source
        || scope?.dataset_sha256 !== datasetSha256) {
      throw new Error("locomo_semantic_clock_or_profile_mismatch");
    }
  }
  for (const result of output.results || []) {
    if (result?.sensitivity?.scoreable !== true) continue;
    if (result.diagnostics?.search_now_sec !== benchmarkNowSec) {
      throw new Error("locomo_semantic_result_clock_mismatch");
    }
  }
}

async function runLocomoSemanticCli(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  if (args.help) return { help: true, usage: usage() };
  if (!args.input) throw new Error("--input is required");
  if (args.benchmarkNowSec === null) throw new Error("locomo_semantic_benchmark_now_sec_required");
  if (args.topK !== LOCOMO_SEMANTIC_TOP_K) throw new Error("locomo_semantic_top_k_must_be_50");

  const repositoryRoot = deps.repositoryRoot || resolve(__dirname, "..");
  const repositoryCandidate = Object.hasOwn(deps, "repositoryProvenance")
    ? (typeof deps.repositoryProvenance === "function"
      ? deps.repositoryProvenance({ repositoryRoot })
      : deps.repositoryProvenance)
    : (deps.resolveRepositoryProvenance || resolveRepositoryProvenance)({
      repositoryRoot,
      execFileSync: deps.execFileSync || defaultExecFileSync,
    });
  const repositoryProvenance = validateRepositoryProvenance(repositoryCandidate);
  if (!repositoryProvenance.repository_worktree_clean) {
    throw new Error("locomo_semantic_repository_provenance_dirty_worktree");
  }

  const inputPath = resolve(args.input);
  const readFile = deps.readFile || readFileSync;
  const inputBytes = Buffer.from(readFile(inputPath));
  const inputSha256 = createHash("sha256").update(inputBytes).digest("hex");
  const records = JSON.parse(inputBytes.toString("utf8"));
  if (!Array.isArray(records)) throw new Error("LoCoMo input must be a JSON array");

  const contract = await import("../lib/benchmark/locomo-v1.js");
  const validation = contract.validateLocomoDataset(records);
  if (args.requireOfficial) contract.assertOfficialLocomoDataset(records, inputBytes);

  const callerRunnerOptions = deps.runnerOptions || {};
  rejectRunnerOverrides(callerRunnerOptions);
  if (Object.hasOwn(callerRunnerOptions, "profileProvenance")) {
    const value = callerRunnerOptions.profileProvenance;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("locomo_semantic_profile_provenance_must_be_object");
    }
  }
  if (args.cachePath !== null) assertNotLivePath(args.cachePath, "cache");
  if (args.output !== null) assertNotLivePath(args.output, "output");

  const runnerModule = await import("../lib/benchmark/locomo-semantic-retrieval-runner-v2.js");
  const runDataset = deps.runDataset || runnerModule.runLocomoSemanticRetrievalDataset;
  const runnerOptions = {
    ...callerRunnerOptions,
    limit: args.limit,
    topK: args.topK,
    benchmarkNowSec: args.benchmarkNowSec,
    datasetSha256: inputSha256,
    repositoryProvenance,
    cachePath: args.cachePath,
  };
  if (Object.hasOwn(deps, "embeddingProvider")) runnerOptions.embeddingProvider = deps.embeddingProvider;
  const output = await runDataset(records, runnerOptions);
  assertOutputContract(output, args.benchmarkNowSec, repositoryProvenance, inputSha256);

  const cliFields = {
    input_file: basename(inputPath),
    input_sha256: inputSha256,
    official_shape_matches: validation.official_shape_matches,
  };
  output.provenance = { ...(output.provenance || {}), ...cliFields };
  output.run = { ...(output.run || {}), ...cliFields };
  if (args.output !== null) {
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
  const result = await runLocomoSemanticCli(argv, deps);
  if (result.help) {
    process.stdout.write(`${result.usage}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(result.printable, null, 2)}\n`);
}

module.exports = {
  main,
  parseArgs,
  parseBenchmarkNowSec,
  resolveRepositoryProvenance,
  runLocomoSemanticCli,
  usage,
  validateRepositoryProvenance,
};

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
