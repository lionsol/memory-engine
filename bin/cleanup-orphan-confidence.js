#!/usr/bin/env node

const { existsSync, mkdirSync, writeFileSync, writeSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const { homedir } = require("node:os");

const DEFAULT_ENGINE_DB_PATH = resolve(homedir(), ".openclaw/memory/memory-engine/memory-engine.sqlite");
const DEFAULT_CORE_DB_PATH = resolve(homedir(), ".openclaw/memory/main.sqlite");
const OUTPUT_DIR = resolve(process.cwd(), "tmp/memory-quality");
const OUTPUT_JSON_PATH = resolve(OUTPUT_DIR, "orphan-confidence-cleanup-dry-run.json");
const OUTPUT_MD_PATH = resolve(OUTPUT_DIR, "orphan-confidence-cleanup-dry-run.md");
const FORBIDDEN_FLAGS = new Set(["--apply", "--delete", "--write-db", "--force"]);

function printHelp() {
  writeStdout(`Orphan Confidence Cleanup Dry Run

Usage:
  node bin/cleanup-orphan-confidence.js [options]

Options:
  --help                     Show this help
  --json                     Print stdout summary as JSON
  --sample-limit <n>         Limit sample orphan chunk ids (default: 50)
  --engine-db <path>         Override engine DB path
  --core-db <path>           Override core DB path

Environment:
  ENGINE_DB_PATH             Engine DB path override
  CORE_DB_PATH               Core DB path override

Refused:
  --apply --delete --write-db --force

Notes:
  - Current version only supports dry-run
  - No DB writes, no deletes, no network, no LLM
  - Reports are written to tmp/memory-quality/
`);
}

function writeStdout(text) {
  writeSync(1, `${String(text)}\n`);
}

function writeStderr(text) {
  writeSync(2, `${String(text)}\n`);
}

function parseInteger(value, flagName) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${flagName} expects a positive integer, got: ${value}`);
  }
  return n;
}

function readFlagValue(args, index, flagName) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flagName} expects a value`);
  }
  return value;
}

function parseArgs(argv = []) {
  const args = Array.from(argv);
  const options = {
    help: false,
    json: false,
    sampleLimit: 50,
    engineDbPath: null,
    coreDbPath: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (FORBIDDEN_FLAGS.has(arg)) {
      throw new Error(
        `unsupported flag: ${arg}\n` +
        `Current version only supports dry-run.\n` +
        `Real deletion must be implemented later, reviewed separately, and shipped in a separate commit.`,
      );
    }
    if (arg === "--help" || arg === "help") {
      options.help = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--sample-limit") {
      options.sampleLimit = parseInteger(readFlagValue(args, i, "--sample-limit"), "--sample-limit");
      i += 1;
      continue;
    }
    if (arg === "--engine-db") {
      options.engineDbPath = readFlagValue(args, i, "--engine-db");
      i += 1;
      continue;
    }
    if (arg === "--core-db") {
      options.coreDbPath = readFlagValue(args, i, "--core-db");
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

function resolveDbPaths(options = {}) {
  return {
    engineDbPath: options.engineDbPath
      || process.env.ENGINE_DB_PATH
      || DEFAULT_ENGINE_DB_PATH,
    coreDbPath: options.coreDbPath
      || process.env.CORE_DB_PATH
      || DEFAULT_CORE_DB_PATH,
  };
}

function buildMissingDbError({ engineDbPath, coreDbPath, originalError }) {
  return [
    "orphan-confidence cleanup dry-run could not open configured DB files.",
    `resolved engine DB path: ${engineDbPath}`,
    `resolved core DB path: ${coreDbPath}`,
    `engine DB exists?: ${existsSync(engineDbPath)}`,
    `core DB exists?: ${existsSync(coreDbPath)}`,
    `engine DB parent directory exists?: ${existsSync(dirname(engineDbPath))}`,
    `core DB parent directory exists?: ${existsSync(dirname(coreDbPath))}`,
    `original error: ${String(originalError?.message || originalError)}`,
  ].join("\n");
}

function buildStdoutSummary(result) {
  const topMonths = Object.entries(result.month_distribution || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5);

  return {
    mode: result.mode,
    engine_db_path: result.engine_db_path,
    core_db_path: result.core_db_path,
    confidence_total_count: result.confidence_total_count,
    chunks_total_count: result.chunks_total_count,
    orphan_confidence_count: result.orphan_confidence_count,
    would_delete_count: result.would_delete_count,
    orphan_ratio: result.orphan_ratio,
    event_prefix_seen_count: result.event_prefix_seen_count,
    top_month_distribution: Object.fromEntries(topMonths),
    report_output_paths: {
      markdown: OUTPUT_MD_PATH,
      json: OUTPUT_JSON_PATH,
    },
  };
}

function printTextSummary(summary) {
  writeStdout([
    "Orphan Confidence Cleanup Dry Run",
    `mode: ${summary.mode}`,
    `engine DB path: ${summary.engine_db_path}`,
    `core DB path: ${summary.core_db_path}`,
    `confidence total count: ${summary.confidence_total_count}`,
    `chunks total count: ${summary.chunks_total_count}`,
    `orphan confidence count: ${summary.orphan_confidence_count}`,
    `would delete count: ${summary.would_delete_count}`,
    `orphan ratio: ${summary.orphan_ratio}`,
    `event prefix seen count: ${summary.event_prefix_seen_count}`,
    `top month distribution: ${JSON.stringify(summary.top_month_distribution)}`,
    `report markdown: ${summary.report_output_paths.markdown}`,
    `report json: ${summary.report_output_paths.json}`,
  ].join("\n"));
}

function buildMarkdownReport(result) {
  return [
    "# Orphan Confidence Cleanup Dry Run",
    "",
    "## Summary",
    "",
    `- mode: ${result.mode}`,
    `- generated_at: ${result.generated_at}`,
    `- engine_db_path: ${result.engine_db_path}`,
    `- core_db_path: ${result.core_db_path}`,
    `- confidence_total_count: ${result.confidence_total_count}`,
    `- chunks_total_count: ${result.chunks_total_count}`,
    `- orphan_confidence_count: ${result.orphan_confidence_count}`,
    `- would_delete_count: ${result.would_delete_count}`,
    `- orphan_ratio: ${result.orphan_ratio}`,
    "",
    "## Safety",
    "",
    "- 本次没有删除任何记录。",
    "- 本次没有修改 DB。",
    "- 本次只读。",
    "- 真正 cleanup 需要后续 `--apply` 实现、备份与单独 review。",
    "",
    "## Month Distribution",
    "",
    "```json",
    JSON.stringify(result.month_distribution, null, 2),
    "```",
    "",
    "## ID Length Distribution",
    "",
    "```json",
    JSON.stringify(result.id_length_distribution, null, 2),
    "```",
    "",
    "## Event Prefix Seen",
    "",
    `- event_prefix_seen_count: ${result.event_prefix_seen_count}`,
    "",
    "## Sample Orphan Chunk IDs",
    "",
    "```json",
    JSON.stringify(result.sample_orphan_chunk_ids, null, 2),
    "```",
    "",
    "## Next Steps",
    "",
    "- Review whether orphan confidence rows are confirmed stale data in the current DB snapshot.",
    "- Implement `--apply` separately with backup steps, explicit review, and its own tests.",
    "- Do not delete any data from this dry-run output alone.",
    "",
  ].join("\n");
}

function writeReports(result) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_JSON_PATH, `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(OUTPUT_MD_PATH, `${buildMarkdownReport(result)}\n`);
  return {
    jsonPath: OUTPUT_JSON_PATH,
    markdownPath: OUTPUT_MD_PATH,
  };
}

async function loadCleanupModule() {
  const mod = await import("../lib/quality/orphan-confidence-cleanup.js");
  return mod.collectOrphanConfidenceDryRun;
}

async function runCleanupOrphanConfidenceCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return { ok: true, code: 0, help: true };
  }

  const collectOrphanConfidenceDryRun = await loadCleanupModule();
  const { engineDbPath, coreDbPath } = resolveDbPaths(options);
  let result;
  try {
    result = collectOrphanConfidenceDryRun({
      engineDbPath,
      coreDbPath,
      sampleLimit: options.sampleLimit,
    });
  } catch (error) {
    throw new Error(buildMissingDbError({
      engineDbPath,
      coreDbPath,
      originalError: error,
    }));
  }

  const reportPaths = writeReports(result);
  const summary = buildStdoutSummary(result);
  summary.report_output_paths = {
    markdown: reportPaths.markdownPath,
    json: reportPaths.jsonPath,
  };

  if (options.json) {
    writeStdout(JSON.stringify(summary, null, 2));
  } else {
    printTextSummary(summary);
  }

  return {
    ok: true,
    code: 0,
    result,
    summary,
    reportPaths,
  };
}

if (require.main === module) {
  runCleanupOrphanConfidenceCli().catch((error) => {
    writeStderr(String(error?.message || error));
    process.exitCode = 1;
  });
}

module.exports = {
  runCleanupOrphanConfidenceCli,
};
