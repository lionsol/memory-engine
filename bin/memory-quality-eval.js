#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { homedir } = require("node:os");
const { resolve } = require("node:path");

const SUPPORTED_PATH_FAMILIES = new Set([
  "smart-add",
  "dreaming",
  "episodes",
  "daily-root",
  "memory-root",
  "memory-other",
]);

const FORBIDDEN_FLAGS = new Set([
  "--fix",
  "--archive",
  "--delete",
  "--write-db",
  "--llm-judge",
]);

function resolveDbPaths() {
  const home = homedir();
  return {
    coreDbPath: process.env.MEMORY_ENGINE_CORE_DB || resolve(home, ".openclaw/memory/main.sqlite"),
    engineDbPath: process.env.MEMORY_ENGINE_DB_PATH
      || process.env.MEMORY_ENGINE_DB
      || resolve(home, ".openclaw/memory/memory-engine/memory-engine.sqlite"),
  };
}

function printHelp() {
  console.log(`Memory Quality Eval MVP v4

Usage:
  node bin/memory-quality-eval.js [options]

Options:
  --help                     Show this help
  --json                     Print stdout summary as JSON
  --top <n>                  Limit report worst/top sections (default: 20)
  --scope <name>             active-memory | all
  --path-family <name>       smart-add | dreaming | episodes | daily-root | memory-root | memory-other
  --include-stats-history    Include memory/stats-history.md
  --category <name>          Filter by category
  --path-prefix <prefix>     Filter by path prefix, e.g. memory/episodes
  --include-archived         Include archived memory_confidence rows

Refused:
  --fix --archive --delete --write-db --llm-judge

Notes:
  - Default scope is active-memory
  - Default outputs are tmp/memory-quality/latest.md and latest.json
  - This command is read-only: no DB writes, no LLM, no network
`);
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
    json: false,
    top: 20,
    scope: "active-memory",
    pathFamily: null,
    includeStatsHistory: false,
    category: null,
    pathPrefix: null,
    includeArchived: false,
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (FORBIDDEN_FLAGS.has(arg)) {
      throw new Error(`unsupported destructive flag: ${arg}`);
    }
    if (arg === "--help" || arg === "help") {
      options.help = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--include-stats-history") {
      options.includeStatsHistory = true;
      continue;
    }
    if (arg === "--include-archived") {
      options.includeArchived = true;
      continue;
    }
    if (arg === "--top") {
      options.top = parseInteger(readFlagValue(args, i, "--top"), "--top");
      i += 1;
      continue;
    }
    if (arg === "--scope") {
      options.scope = readFlagValue(args, i, "--scope");
      i += 1;
      continue;
    }
    if (arg === "--path-family") {
      options.pathFamily = readFlagValue(args, i, "--path-family");
      i += 1;
      continue;
    }
    if (arg === "--category") {
      options.category = readFlagValue(args, i, "--category");
      i += 1;
      continue;
    }
    if (arg === "--path-prefix") {
      options.pathPrefix = readFlagValue(args, i, "--path-prefix");
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!["active-memory", "all"].includes(options.scope)) {
    throw new Error(`--scope must be one of: active-memory, all`);
  }
  if (options.pathFamily && !SUPPORTED_PATH_FAMILIES.has(options.pathFamily)) {
    throw new Error(`--path-family must be one of: ${Array.from(SUPPORTED_PATH_FAMILIES).join(", ")}`);
  }

  return options;
}

async function loadQualityModules() {
  const [
    collector,
    rules,
    score,
    report,
  ] = await Promise.all([
    import("../lib/quality/collect-quality-candidates.js"),
    import("../lib/quality/quality-rules.js"),
    import("../lib/quality/quality-score.js"),
    import("../lib/quality/quality-report.js"),
  ]);

  return {
    collectQualityCandidates: collector.collectQualityCandidates,
    evaluateDuplicateFlags: rules.evaluateDuplicateFlags,
    evaluateQualityFlags: rules.evaluateQualityFlags,
    scoreQualityItem: score.scoreQualityItem,
    buildQualityReport: report.buildQualityReport,
    writeQualityReports: report.writeQualityReports,
  };
}

function getGitSha() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch (error) {
    return null;
  }
}

function ensureRequiredDiagnostics(diagnostics) {
  const requiredKeys = [
    "chunks_count",
    "memory_confidence_count",
    "memory_events_count",
    "exact_orphan_confidence_count",
    "truly_missing_orphan_confidence_count",
    "fake_orphan_confidence_count",
    "orphan_confidence_month_distribution",
    "orphan_confidence_event_prefix_seen_count",
    "sample_orphan_confidence_ids",
    "chunks_without_confidence_count",
    "confidence_id_length_distribution",
    "event_type_distribution",
    "chunk_prefix_unique_count",
    "chunk_prefix_ambiguous_count",
    "event_prefix_total_distinct",
    "event_prefix_matched_count",
    "event_prefix_unmatched_count",
    "event_prefix_ambiguous_count",
    "cite_signal_sparse",
    "path_family_distribution",
  ];
  const missing = requiredKeys.filter(key => !(key in (diagnostics || {})));
  if (missing.length > 0) {
    throw new Error(`memory-quality-eval diagnostics missing required fields: ${missing.join(", ")}`);
  }
}

function buildTopFlags(items, limit) {
  const counts = new Map();
  for (const item of items) {
    for (const flag of item.flags || []) {
      counts.set(flag, (counts.get(flag) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([flag, count]) => ({ flag, count }));
}

function buildStdoutSummary(report, outputPaths, topLimit) {
  const total = report.items.length;
  const averageScore = total > 0
    ? Math.round((report.items.reduce((sum, item) => sum + Number(item.score || 0), 0) / total) * 100) / 100
    : 0;
  return {
    total_evaluated: total,
    average_score: averageScore,
    grade_distribution: report.summary.grades,
    top_flags: buildTopFlags(report.items, Math.min(10, topLimit)),
    output_paths: outputPaths,
    orphan_diagnostics_count: report.diagnostics.exact_orphan_confidence_count,
    chunks_without_confidence_count: report.diagnostics.chunks_without_confidence_count,
  };
}

function printTextSummary(summary) {
  const topFlags = summary.top_flags.length > 0
    ? summary.top_flags.map(item => `${item.flag}:${item.count}`).join(", ")
    : "none";
  console.log("Memory Quality Eval Summary");
  console.log(`total evaluated: ${summary.total_evaluated}`);
  console.log(`average score: ${summary.average_score}`);
  console.log(`grade distribution: ${JSON.stringify(summary.grade_distribution)}`);
  console.log(`top flags: ${topFlags}`);
  console.log(`orphan diagnostics count: ${summary.orphan_diagnostics_count}`);
  console.log(`chunks_without_confidence count: ${summary.chunks_without_confidence_count}`);
  console.log(`output json: ${summary.output_paths.latest_json}`);
  console.log(`output md: ${summary.output_paths.latest_md}`);
}

async function runMemoryQualityEval(rawOptions = {}) {
  const {
    collectQualityCandidates,
    evaluateDuplicateFlags,
    evaluateQualityFlags,
    scoreQualityItem,
    buildQualityReport,
    writeQualityReports,
  } = await loadQualityModules();

  const { coreDbPath, engineDbPath } = resolveDbPaths();
  if (!existsSync(engineDbPath)) {
    throw new Error(
      `Memory-engine DB not found at ${engineDbPath}\n` +
      `Run plugin once or initialize/sync memory-engine first.\n` +
      `Override: MEMORY_ENGINE_DB_PATH=<path> or MEMORY_ENGINE_DB=<path>`
    );
  }
  if (!existsSync(coreDbPath)) {
    throw new Error(
      `OpenClaw core DB not found at ${coreDbPath}\n` +
      `Make sure OpenClaw gateway has been started at least once.\n` +
      `Override: MEMORY_ENGINE_CORE_DB=<path>`
    );
  }

  let collected;
  try {
    collected = collectQualityCandidates({
      includeArchived: rawOptions.includeArchived,
      includeStatsHistory: rawOptions.includeStatsHistory,
      pathFamily: rawOptions.pathFamily,
      pathPrefix: rawOptions.pathPrefix,
      category: rawOptions.category,
      scope: rawOptions.scope,
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (/no such table|no such column|has no column/i.test(message)) {
      throw new Error(`memory-quality-eval schema check failed: ${message}`);
    }
    if (/unable to open database file/i.test(message)) {
      throw new Error(
        `memory-quality-eval could not open configured DB files.\n` +
        `engine DB: ${engineDbPath}\n` +
        `core DB: ${coreDbPath}\n` +
        `Original error: ${message}`
      );
    }
    throw error;
  }

  ensureRequiredDiagnostics(collected.diagnostics);

  const duplicateFlags = evaluateDuplicateFlags(collected.candidates);
  const items = collected.candidates.map(candidate => {
    const evaluated = evaluateQualityFlags(candidate, {
      nowSec: Math.floor(Date.now() / 1000),
      duplicateFlags,
    });
    const scored = scoreQualityItem(evaluated.flags, candidate);
    return {
      ...candidate,
      ...evaluated,
      ...scored,
    };
  });

  const report = buildQualityReport({
    items,
    diagnostics: collected.diagnostics,
    options: {
      runId: rawOptions.runId,
      generatedAt: rawOptions.generatedAt || new Date(),
      gitSha: rawOptions.gitSha || getGitSha(),
      scope: rawOptions.scope,
      topN: rawOptions.top,
    },
  });

  const outputPaths = writeQualityReports(report, {
    outputDir: rawOptions.outputDir || process.env.MEMORY_QUALITY_OUTPUT_DIR || "tmp/memory-quality",
    writeRunIdFiles: true,
  });

  const summary = buildStdoutSummary(report, outputPaths, rawOptions.top || 20);
  return { report, outputPaths, summary };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }

  const { summary } = await runMemoryQualityEval(options);
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printTextSummary(summary);
  }
  return 0;
}

module.exports = {
  parseArgs,
  runMemoryQualityEval,
  main,
};

if (process.argv[1] && /memory-quality-eval\.js$/.test(process.argv[1])) {
  main().then(
    code => {
      process.exitCode = code;
    },
    error => {
      console.error(String(error?.message || error));
      if (error?.stack) console.error(error.stack);
      process.exitCode = 1;
    }
  );
}
