#!/usr/bin/env node

const { createRequire } = require("node:module");

const requireFromHere = createRequire(__filename);
const autoRecallSmoke = requireFromHere("./run-auto-recall-safety-smoke.js");

function printHelp() {
  console.log(`Run Memory Quality Baseline Smoke

Usage:
  node bin/run-memory-quality-baseline-smoke.js [options]

Options:
  --help        Show this help
  --json        Print deterministic JSON output
  --markdown    Print Markdown summary

Notes:
  - Read-only regression smoke only
  - No DB writes, memory file mutation, cleanup apply, archive, quarantine, reinforce, confidence backfill, LLM, or network access
  - No runtime report files are written by this smoke
`);
}

function parseArgs(argv = []) {
  const options = {
    help: false,
    json: false,
    markdown: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "help") {
      options.help = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--markdown") {
      options.markdown = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (options.json && options.markdown) {
    throw new Error("choose exactly one output format: --json or --markdown");
  }
  if (!options.json && !options.markdown) {
    options.json = true;
  }

  return options;
}

function buildCheck({ id, name, pass, details }) {
  return {
    id,
    name,
    pass: pass === true,
    details,
  };
}

function hasNoActionableLegacySingletonTarget(report) {
  const wouldDelete = report?.would_delete || {};
  const wouldDeleteTotal = Number(wouldDelete.core_chunks || 0)
    + Number(wouldDelete.core_chunks_fts || 0)
    + Number(wouldDelete.engine_memory_confidence || 0);
  const indexedChunkCount = Number(report?.review?.indexed_chunk_count || 0);
  const chunkIds = Array.isArray(report?.review?.chunk_ids) ? report.review.chunk_ids : [];
  return wouldDeleteTotal === 0 && indexedChunkCount === 0 && chunkIds.length === 0;
}

async function runBaselineSmoke() {
  const [
    unknownAudit,
    qualityCandidates,
    boundaryAudit,
    legacyCleanup,
  ] = await Promise.all([
    import("../lib/quality/unknown-memory-path-audit.js"),
    import("../lib/quality/collect-quality-candidates.js"),
    import("../lib/quality/memory-process-boundary-audit.js"),
    import("../lib/quality/confirmed-legacy-singleton-stale-cleanup.js"),
  ]);

  const unknownReport = unknownAudit.runUnknownMemoryPathAudit({
    includeArchived: false,
    sampleLimit: 20,
  });
  const qualityCollected = qualityCandidates.collectQualityCandidates({
    includeArchived: false,
    includeStatsHistory: false,
    pathFamily: null,
    pathPrefix: null,
    category: null,
    scope: "active-memory",
  });
  const boundaryReport = await boundaryAudit.runMemoryProcessBoundaryAudit();
  const legacyCleanupReport = legacyCleanup.collectConfirmedLegacySingletonStaleCleanupDryRun({
    path: legacyCleanup.DEFAULT_CONFIRMED_LEGACY_SINGLETON_STALE_PATH || "memory/daily.md",
    sampleLimit: 20,
  });
  const autoRecallReport = await autoRecallSmoke.runSmoke();

  const autoRecallByName = new Map((autoRecallReport?.checks || []).map(check => [check.name, check]));
  const suspectedToolOutputCheck = autoRecallByName.get(
    "suspected_tool_output candidate is rejected with denied_by_suspected_tool_output",
  );
  const dreamingArtifactCheck = autoRecallByName.get(
    "dreaming_candidate_staging candidate is rejected with denied_by_dreaming_artifact",
  );

  const checks = [
    buildCheck({
      id: "unknown_memory_paths_clean",
      name: "unknown memory path audit reports unknown_count === 0",
      pass: Number(unknownReport?.summary?.unknown_count || 0) === 0,
      details: {
        unknown_count: Number(unknownReport?.summary?.unknown_count || 0),
      },
    }),
    buildCheck({
      id: "active_memory_chunks_without_confidence_zero",
      name: "memory quality eval active-memory chunks_without_confidence_count === 0",
      pass: Number(qualityCollected?.diagnostics?.chunks_without_confidence_count || 0) === 0,
      details: {
        chunks_without_confidence_count: Number(qualityCollected?.diagnostics?.chunks_without_confidence_count || 0),
      },
    }),
    buildCheck({
      id: "active_memory_lifecycle_owned_chunks_without_confidence_zero",
      name: "memory quality eval active-memory lifecycle_owned_chunks_without_confidence_count === 0",
      pass: Number(qualityCollected?.diagnostics?.chunks_without_confidence_lifecycle_owned_count || 0) === 0,
      details: {
        lifecycle_owned_chunks_without_confidence_count: Number(qualityCollected?.diagnostics?.chunks_without_confidence_lifecycle_owned_count || 0),
      },
    }),
    buildCheck({
      id: "process_boundary_pass",
      name: "memory process boundary audit still passes",
      pass: String(boundaryReport?.status || "") === "pass",
      details: {
        status: boundaryReport?.status || "unknown",
        boundary_failures: Array.isArray(boundaryReport?.boundary_failures) ? boundaryReport.boundary_failures : [],
      },
    }),
    buildCheck({
      id: "legacy_singleton_cleanup_no_actionable_target",
      name: "confirmed legacy singleton stale cleanup dry-run has no actionable target",
      pass: hasNoActionableLegacySingletonTarget(legacyCleanupReport),
      details: {
        preflight_passed: Boolean(legacyCleanupReport?.preflight_passed),
        indexed_chunk_count: Number(legacyCleanupReport?.review?.indexed_chunk_count || 0),
        chunk_ids: Array.isArray(legacyCleanupReport?.review?.chunk_ids) ? legacyCleanupReport.review.chunk_ids : [],
        would_delete: legacyCleanupReport?.would_delete || null,
      },
    }),
    buildCheck({
      id: "auto_recall_suspected_tool_output_denied",
      name: "autoRecall safety smoke denies suspected_tool_output",
      pass: Boolean(suspectedToolOutputCheck?.pass),
      details: suspectedToolOutputCheck?.details || null,
    }),
    buildCheck({
      id: "auto_recall_dreaming_artifact_denied",
      name: "autoRecall safety smoke denies dreaming artifact candidate",
      pass: Boolean(dreamingArtifactCheck?.pass),
      details: dreamingArtifactCheck?.details || null,
    }),
  ];

  const failedChecks = checks.filter(check => !check.pass);
  const summary = {
    mode: "read_only_smoke",
    status: failedChecks.length === 0 ? "pass" : "fail",
    check_count: checks.length,
    passed_count: checks.length - failedChecks.length,
    failed_count: failedChecks.length,
    failed_check_ids: failedChecks.map(check => check.id),
  };

  return {
    generated_at: new Date().toISOString(),
    summary,
    side_effects: {
      db_writes: false,
      memory_file_mutation: false,
      cleanup_apply: false,
      archive: false,
      quarantine: false,
      reinforce: false,
      confidence_backfill: false,
      llm: false,
      network: false,
      runtime_report_files: false,
    },
    checks,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Memory Quality Baseline Smoke",
    "",
    `- generated_at: ${report.generated_at}`,
    `- status: ${report.summary.status}`,
    `- checks_passed: ${report.summary.passed_count}/${report.summary.check_count}`,
    `- failed_check_ids: ${report.summary.failed_check_ids.length > 0 ? report.summary.failed_check_ids.join(", ") : "none"}`,
    "",
    "## Checks",
    "",
  ];

  for (const check of report.checks) {
    lines.push(`- ${check.pass ? "PASS" : "FAIL"}: ${check.id} :: ${check.name}`);
    lines.push(`  details: ${JSON.stringify(check.details)}`);
  }

  lines.push("", "## Side Effects", "");
  for (const [key, value] of Object.entries(report.side_effects || {})) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      printHelp();
      return 0;
    }

    const report = await runBaselineSmoke();
    const output = options.markdown
      ? renderMarkdown(report)
      : JSON.stringify(report, null, 2);
    console.log(output);
    return report.summary.status === "pass" ? 0 : 1;
  } catch (error) {
    console.error(String(error?.message || error));
    return 1;
  }
}

module.exports = {
  parseArgs,
  runBaselineSmoke,
  renderMarkdown,
  main,
};

if (process.argv[1] && /run-memory-quality-baseline-smoke\.js$/.test(process.argv[1])) {
  main().then(code => {
    process.exitCode = code;
  });
}
