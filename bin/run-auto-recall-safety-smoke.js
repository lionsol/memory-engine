#!/usr/bin/env node

const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const vm = require("node:vm");

function timestampForFile(now = new Date()) {
  const iso = new Date(now).toISOString();
  return iso.slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
}

function defaultOutPath({ cwd = process.cwd(), format = "md", now = new Date() } = {}) {
  return resolve(cwd, "reports", `auto-recall-safety-smoke-${timestampForFile(now)}.${format}`);
}

function readFlagValue(args, index, flagName) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flagName} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const options = {
    help: false,
    format: "md",
    out: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "help") {
      options.help = true;
      continue;
    }
    if (arg === "--format") {
      options.format = readFlagValue(argv, i, "--format");
      i += 1;
      continue;
    }
    if (arg === "--out") {
      options.out = resolve(readFlagValue(argv, i, "--out"));
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!["md", "json"].includes(String(options.format))) {
    throw new Error("--format must be one of: md, json");
  }
  return options;
}

function printHelp() {
  console.log(`Run AutoRecall Safety Smoke

Usage:
  node bin/run-auto-recall-safety-smoke.js [options]

Options:
  --format <md|json>    Output format (default: md)
  --out <path>          Output path; default reports/auto-recall-safety-smoke-YYYYMMDD-HHmmss.<ext>
  --help                Show this help

Notes:
  - Read-only smoke only.
  - Does not write DB, enable autoRecall by default, or mutate memory/quarantine/delete state.`);
}

function extractFunctionSource(code, functionName) {
  const marker = `function ${functionName}(`;
  const start = code.indexOf(marker);
  if (start < 0) throw new Error(`function not found: ${functionName}`);
  const braceStart = code.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) return code.slice(start, i + 1);
  }
  throw new Error(`function parse failed: ${functionName}`);
}

async function runSmoke(options = {}) {
  const { analyzeAutoRecallIntent } = await import("../lib/recall/auto-recall-intent.js");
  const { evaluateAutoRecallEligibility } = await import("../lib/recall/auto-recall-eligibility.js");
  const { buildReinforcementAllowedIds, filterCitedIdsForReinforcement } = await import("../lib/recall/auto-recall-reinforcement.js");
  const autoRecall = await import("../auto-recall.js");
  const { buildFtsFallbackQuery, normalizeFtsQuery, stripPromptMetadataPrefix } = await import("../query-utils.js");

  const indexCode = readFileSync(resolve(process.cwd(), "index.js"), "utf8");
  const source = extractFunctionSource(indexCode, "buildAutoRecallDebugMetadata");
  const context = { buildFtsFallbackQuery, normalizeFtsQuery, stripPromptMetadataPrefix };
  vm.runInNewContext(`${source}\nthis.__fn = buildAutoRecallDebugMetadata;`, context);
  const buildAutoRecallDebugMetadata = context.__fn;

  const longBody = (prefix) => `${prefix}\n${"LOG_LINE keep this body out of focused query\n".repeat(80)}`;

  const rewriteIntent = analyzeAutoRecallIntent(longBody("请润色下面这段文字，保持原意。"));
  const summarizeIntent = analyzeAutoRecallIntent(longBody("总结当前文本，提取要点。"));
  const projectReviewIntent = analyzeAutoRecallIntent(longBody("结合 memory-engine 当前基线 review 这段方案，并和之前方案对比。"));
  const suspectedCandidate = {
    id: "suspected-tool-output-1",
    category: "episodic",
    path: "memory/dreaming/light/2026-05-16.md",
    text: "tool transcript residue",
    final_score: 0.9,
    primary_bucket: "suspected_tool_output",
  };
  const suspectedGate = autoRecall.shouldInjectCandidate(suspectedCandidate, "memory engine baseline", {});
  const noTraceReinforcement = filterCitedIdsForReinforcement(
    ["hallucinated99999"],
    buildReinforcementAllowedIds({ traceState: null, currentTurnMemoryEngineGetIds: [] }).reinforcement_allowed_ids,
  );
  const getOnlyAllowlist = buildReinforcementAllowedIds({
    traceState: null,
    currentTurnMemoryEngineGetIds: ["getonly1234567890"],
  });
  const getOnlyReinforcement = filterCitedIdsForReinforcement(
    ["getonly1234567890", "searchonly1234567"],
    getOnlyAllowlist.reinforcement_allowed_ids,
  );

  const telemetrySkip = buildAutoRecallDebugMetadata("full prompt", {
    results: [],
    debug: {
      recall_intent_should_recall: rewriteIntent.should_recall,
      recall_intent_reason: rewriteIntent.intent_reason,
      long_input_detected: rewriteIntent.long_input_detected,
      generic_task_detected: rewriteIntent.generic_task_detected,
      focused_query: rewriteIntent.focused_query,
      focused_query_chars: rewriteIntent.focused_query_chars,
      original_input_chars: rewriteIntent.original_input_chars,
      skipped_by_recall_intent: true,
    },
  }, rewriteIntent.intent_reason);

  const telemetryFocused = buildAutoRecallDebugMetadata("full prompt", {
    results: [],
    debug: {
      query_stripped: projectReviewIntent.focused_query,
      recall_intent_should_recall: projectReviewIntent.should_recall,
      recall_intent_reason: projectReviewIntent.intent_reason,
      long_input_detected: projectReviewIntent.long_input_detected,
      generic_task_detected: projectReviewIntent.generic_task_detected,
      focused_query: projectReviewIntent.focused_query,
      focused_query_chars: projectReviewIntent.focused_query_chars,
      original_input_chars: projectReviewIntent.original_input_chars,
      skipped_by_recall_intent: false,
      rejected_candidates: [{
        id: "suspected-tool-ou",
        deny_reasons: suspectedGate.deny_reasons,
      }],
    },
  });

  const checks = [
    {
      name: "long rewrite skips autoRecall",
      pass: rewriteIntent.should_recall === false && rewriteIntent.long_input_detected === true,
      details: rewriteIntent,
    },
    {
      name: "long summarize skips autoRecall",
      pass: summarizeIntent.should_recall === false && summarizeIntent.generic_task_detected === true,
      details: summarizeIntent,
    },
    {
      name: "long project review with explicit history uses focused_query",
      pass: projectReviewIntent.should_recall === true &&
        projectReviewIntent.focused_query_chars < projectReviewIntent.original_input_chars &&
        !projectReviewIntent.focused_query.includes("LOG_LINE keep this body out of focused query"),
      details: projectReviewIntent,
    },
    {
      name: "suspected_tool_output candidate is rejected with denied_by_suspected_tool_output",
      pass: suspectedGate.inject === false && suspectedGate.reason === "denied_by_suspected_tool_output",
      details: suspectedGate,
    },
    {
      name: "no trace + no get + cited ids does not reinforce",
      pass: noTraceReinforcement.reinforced_ids.length === 0 &&
        noTraceReinforcement.ignored_cited_ids.length === 1,
      details: noTraceReinforcement,
    },
    {
      name: "memory_engine_get + cited reinforces only get id",
      pass: JSON.stringify(getOnlyReinforcement.reinforced_ids) === JSON.stringify(["getonly123456789"]) &&
        JSON.stringify(getOnlyReinforcement.ignored_cited_ids) === JSON.stringify(["searchonly123456"]),
      details: {
        allowlist: getOnlyAllowlist,
        reinforcement: getOnlyReinforcement,
      },
    },
  ];

  const telemetryPresence = {
    recall_intent_should_recall: "recall_intent_should_recall" in telemetrySkip && "recall_intent_should_recall" in telemetryFocused,
    recall_intent_reason: "recall_intent_reason" in telemetrySkip && "recall_intent_reason" in telemetryFocused,
    long_input_detected: "long_input_detected" in telemetrySkip && "long_input_detected" in telemetryFocused,
    focused_query: "focused_query" in telemetrySkip && "focused_query" in telemetryFocused,
    skipped_by_recall_intent: "skipped_by_recall_intent" in telemetrySkip && "skipped_by_recall_intent" in telemetryFocused,
    rejected_candidates_deny_reasons: Array.isArray(telemetryFocused.rejected_candidates) &&
      Array.isArray(telemetryFocused.rejected_candidates[0]?.deny_reasons),
    reinforcement_allowed_ids: Array.isArray(getOnlyAllowlist.reinforcement_allowed_ids),
    reinforced_ids: Array.isArray(getOnlyReinforcement.reinforced_ids),
    ignored_cited_ids: Array.isArray(getOnlyReinforcement.ignored_cited_ids),
  };

  const summary = {
    mode: "dry_run",
    write_db: false,
    enable_auto_recall_by_default: false,
    modify_memory: false,
    quarantine_or_delete: false,
    check_count: checks.length,
    passed_count: checks.filter(item => item.pass).length,
    telemetry_presence: telemetryPresence,
  };

  return {
    generated_at: new Date().toISOString(),
    summary,
    checks,
    telemetry_examples: {
      skip: telemetrySkip,
      focused_query: telemetryFocused,
      reinforcement_allowlist: getOnlyAllowlist,
      reinforcement_filter: getOnlyReinforcement,
    },
  };
}

function renderMarkdown(report) {
  const lines = [
    "# AutoRecall Safety Smoke",
    "",
    `- generated_at: ${report.generated_at}`,
    `- mode: ${report.summary.mode}`,
    `- write_db: ${report.summary.write_db}`,
    `- enable_auto_recall_by_default: ${report.summary.enable_auto_recall_by_default}`,
    `- modify_memory: ${report.summary.modify_memory}`,
    `- quarantine_or_delete: ${report.summary.quarantine_or_delete}`,
    `- checks_passed: ${report.summary.passed_count}/${report.summary.check_count}`,
    "",
    "## Checks",
    "",
  ];
  for (const check of report.checks) {
    lines.push(`- ${check.pass ? "PASS" : "FAIL"}: ${check.name}`);
  }
  lines.push("", "## Telemetry Presence", "");
  for (const [key, value] of Object.entries(report.summary.telemetry_presence || {})) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("", "## Telemetry Examples", "", "```json", JSON.stringify(report.telemetry_examples, null, 2), "```", "");
  return lines.join("\n");
}

async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      printHelp();
      return 0;
    }
    const report = await runSmoke(options);
    const outPath = options.out || defaultOutPath({ format: options.format });
    mkdirSync(dirname(outPath), { recursive: true });
    const content = options.format === "json"
      ? JSON.stringify(report, null, 2)
      : renderMarkdown(report);
    writeFileSync(outPath, content, "utf8");
    console.log(JSON.stringify({
      output_path: outPath,
      summary: report.summary,
    }, null, 2));
    return 0;
  } catch (error) {
    console.error(String(error?.message || error));
    return 1;
  }
}

if (require.main === module) {
  main().then(code => {
    process.exitCode = code;
  });
}

module.exports = {
  main,
  parseArgs,
  runSmoke,
};
