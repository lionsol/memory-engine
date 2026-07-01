#!/usr/bin/env node

function printHelp() {
  console.log(`Run AutoRecall Long Input Gate Smoke

Usage:
  node bin/run-auto-recall-long-input-smoke.js [options]

Options:
  --help        Show this help
  --json        Print deterministic JSON output
  --markdown    Print Markdown summary

Notes:
  - Read-only smoke for long input gate and focused query behavior
  - Does not run retrieval, inject memory, write DB, mutate memory files, reinforce, call LLM, or access network
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

function longBody(prefix, repeated = "LOG_LINE keep this body out of focused query\n", count = 80) {
  return `${prefix}\n${repeated.repeat(count)}`;
}

function longDebugLog(prefix) {
  const repeated = [
    "2026-07-01 10:00:00 ERROR request failed at memory-engine pipeline",
    "Traceback (most recent call last):",
    "  at Object.handle (/tmp/runtime/index.js:42:13)",
    "[WARN] retrying without historical context",
  ].join("\n");
  return longBody(prefix, `${repeated}\n`, 45);
}

function buildCheck({ id, name, pass, details }) {
  return {
    id,
    name,
    pass: pass === true,
    details,
  };
}

function intentTelemetry(intent) {
  return {
    should_recall: intent.should_recall,
    intent_reason: intent.intent_reason,
    long_input_detected: intent.long_input_detected,
    generic_task_detected: intent.generic_task_detected,
    original_input_chars: intent.original_input_chars,
    original_input_lines: intent.original_input_lines,
    focused_query: intent.focused_query,
    focused_query_chars: intent.focused_query_chars,
    skipped_by_recall_intent: intent.skipped_by_recall_intent,
    explicit_history_context: intent.explicit_history_context,
    project_entities: intent.project_entities,
  };
}

async function runLongInputSmoke() {
  const { analyzeAutoRecallIntent } = await import("../lib/recall/auto-recall-intent.js");

  const rewriteIntent = analyzeAutoRecallIntent(longBody("请润色下面这段文字，保持原意。"));
  const summarizeIntent = analyzeAutoRecallIntent(longBody("总结当前文本，提取要点。"));
  const translateIntent = analyzeAutoRecallIntent(longBody("Translate this current text into English."));
  const debugNoHistoryIntent = analyzeAutoRecallIntent(longDebugLog("帮我看一下这个报错。"));
  const projectReviewIntent = analyzeAutoRecallIntent(longBody("结合 memory-engine 当前基线 review 这段方案，并和之前方案对比。"));
  const debugWithHistoryIntent = analyzeAutoRecallIntent(longDebugLog("是不是之前那个 memory-engine autoRecall focused query 问题？"));

  const checks = [
    buildCheck({
      id: "long_rewrite_skips_recall",
      name: "long rewrite task skips autoRecall",
      pass: rewriteIntent.should_recall === false &&
        rewriteIntent.long_input_detected === true &&
        rewriteIntent.generic_task_detected === true &&
        rewriteIntent.intent_reason === "generic_task_without_history_context_long_input" &&
        rewriteIntent.skipped_by_recall_intent === true,
      details: intentTelemetry(rewriteIntent),
    }),
    buildCheck({
      id: "long_summarize_skips_recall",
      name: "long summarize current text task skips autoRecall",
      pass: summarizeIntent.should_recall === false &&
        summarizeIntent.long_input_detected === true &&
        summarizeIntent.generic_task_detected === true &&
        summarizeIntent.intent_reason === "generic_task_without_history_context_long_input" &&
        summarizeIntent.skipped_by_recall_intent === true,
      details: intentTelemetry(summarizeIntent),
    }),
    buildCheck({
      id: "long_translate_skips_recall",
      name: "long translate current text task skips autoRecall",
      pass: translateIntent.should_recall === false &&
        translateIntent.long_input_detected === true &&
        translateIntent.generic_task_detected === true &&
        translateIntent.skipped_by_recall_intent === true,
      details: intentTelemetry(translateIntent),
    }),
    buildCheck({
      id: "long_debug_without_history_skips_recall",
      name: "long debug log without history signal skips autoRecall",
      pass: debugNoHistoryIntent.should_recall === false &&
        debugNoHistoryIntent.long_input_detected === true &&
        debugNoHistoryIntent.generic_task_detected === false &&
        debugNoHistoryIntent.intent_reason === "long_input_without_history_context" &&
        debugNoHistoryIntent.skipped_by_recall_intent === true,
      details: intentTelemetry(debugNoHistoryIntent),
    }),
    buildCheck({
      id: "long_project_review_uses_focused_query",
      name: "long project review with explicit history uses focused query",
      pass: projectReviewIntent.should_recall === true &&
        projectReviewIntent.long_input_detected === true &&
        projectReviewIntent.explicit_history_context === true &&
        projectReviewIntent.intent_reason === "long_input_with_history_context_use_focused_query" &&
        projectReviewIntent.focused_query_chars > 0 &&
        projectReviewIntent.focused_query_chars < projectReviewIntent.original_input_chars &&
        projectReviewIntent.focused_query.includes("memory-engine") &&
        !projectReviewIntent.focused_query.includes("LOG_LINE keep this body out of focused query") &&
        projectReviewIntent.skipped_by_recall_intent === false,
      details: intentTelemetry(projectReviewIntent),
    }),
    buildCheck({
      id: "long_debug_with_history_uses_focused_query",
      name: "long debug log with explicit history uses focused query",
      pass: debugWithHistoryIntent.should_recall === true &&
        debugWithHistoryIntent.long_input_detected === true &&
        debugWithHistoryIntent.explicit_history_context === true &&
        debugWithHistoryIntent.intent_reason === "long_input_with_history_context_use_focused_query" &&
        debugWithHistoryIntent.focused_query_chars > 0 &&
        debugWithHistoryIntent.focused_query_chars < debugWithHistoryIntent.original_input_chars &&
        debugWithHistoryIntent.focused_query.includes("memory-engine") &&
        !debugWithHistoryIntent.focused_query.includes("Traceback") &&
        !debugWithHistoryIntent.focused_query.includes("2026-07-01 10:00:00") &&
        debugWithHistoryIntent.skipped_by_recall_intent === false,
      details: intentTelemetry(debugWithHistoryIntent),
    }),
  ];

  const failedChecks = checks.filter(check => !check.pass);
  return {
    summary: {
      mode: "read_only_long_input_smoke",
      status: failedChecks.length === 0 ? "pass" : "fail",
      check_count: checks.length,
      passed_count: checks.length - failedChecks.length,
      failed_count: failedChecks.length,
      failed_check_ids: failedChecks.map(check => check.id),
    },
    side_effects: {
      db_writes: false,
      memory_file_mutation: false,
      retrieval: false,
      injection: false,
      cleanup_apply: false,
      archive: false,
      quarantine: false,
      reinforce: false,
      llm: false,
      network: false,
      runtime_report_files: false,
    },
    checks,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# AutoRecall Long Input Gate Smoke",
    "",
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

    const report = await runLongInputSmoke();
    console.log(options.markdown ? renderMarkdown(report) : JSON.stringify(report, null, 2));
    return report.summary.status === "pass" ? 0 : 1;
  } catch (error) {
    console.error(String(error?.message || error));
    return 1;
  }
}

module.exports = {
  parseArgs,
  runLongInputSmoke,
  renderMarkdown,
  main,
};

if (process.argv[1] && /run-auto-recall-long-input-smoke\.js$/.test(process.argv[1])) {
  main().then(code => {
    process.exitCode = code;
  });
}
