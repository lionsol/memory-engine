#!/usr/bin/env node

function printHelp() {
  console.log(`Run AutoRecall Card Runtime Smoke

Usage:
  node bin/run-auto-recall-card-runtime-smoke.js [options]

Options:
  --help        Show this help
  --json        Print deterministic JSON output
  --markdown    Print Markdown summary

Notes:
  - Read-only smoke for gated card-first autoRecall runtime formatting
  - Does not register OpenClaw hooks, run retrieval, inject memory, write DB, mutate memory files, reinforce, call LLM, or access network
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
  if (!options.json && !options.markdown) options.json = true;
  return options;
}

function baseCandidate(overrides = {}) {
  return {
    id: "abc123def4567890",
    path: "memory/projects/memory-engine.md",
    start_line: 20,
    end_line: 30,
    category: "project",
    kind: "decision",
    confidence: 0.88,
    final_score: 0.76,
    sources: ["fts", "kg"],
    title: "P4 card-first runtime decision",
    summary: "Use memory cards before full content when the runtime experiment is explicitly enabled.",
    text: "FULL_BODY_SHOULD_NOT_LEAK: detailed implementation notes, raw source span, and long body text.",
    ...overrides,
  };
}

function rawLogCandidate() {
  return baseCandidate({
    id: "feedfacecafebeef",
    path: "memory/smart-add/2026-07-02.md",
    category: "raw_log",
    kind: "diagnostic",
    title: "Raw runtime error log",
    summary: "",
    text: "2026-07-02 10:00:00 ERROR request failed\nTraceback at Object.handle (/tmp/runtime/index.js:42)",
    sources: ["fts"],
  });
}

function sideEffects() {
  return {
    db_writes: false,
    memory_file_mutation: false,
    dataset_file_mutation: false,
    retrieval: false,
    injection: false,
    cleanup_apply: false,
    archive: false,
    quarantine: false,
    reinforce: false,
    llm: false,
    network: false,
    runtime_report_files: false,
  };
}

function buildCheck({ id, name, pass, details }) {
  return {
    id,
    name,
    pass: pass === true,
    details,
  };
}

async function formatSyntheticRuntimeContext({ config, runtimeGate, candidates, topK = 3, traceId = "trace_card_runtime_smoke" }) {
  const {
    buildAutoRecallCardContext,
    formatAutoRecallContext,
    shouldUseAutoRecallCardRuntime,
  } = await import("../auto-recall.js");

  const cardRuntimeEnabled = shouldUseAutoRecallCardRuntime(config, runtimeGate);
  if (!cardRuntimeEnabled) {
    return {
      card_first_runtime_enabled: false,
      disclosure_mode: "raw_text",
      context: formatAutoRecallContext(candidates, { topK }),
      card_count: 0,
      cards: [],
      side_effects: sideEffects(),
    };
  }

  const report = buildAutoRecallCardContext(candidates, {
    topK,
    agentScope: runtimeGate?.agentId || "unknown",
    agentId: runtimeGate?.agentId || "unknown",
    traceId,
  });
  return {
    card_first_runtime_enabled: true,
    disclosure_mode: "memory_card",
    context: report.context,
    card_count: report.cards.length,
    cards: report.cards,
    side_effects: report.side_effects,
  };
}

function contextContains(value, token) {
  return String(value || "").includes(token);
}

async function runCardRuntimeSmoke() {
  const defaultRuntime = await formatSyntheticRuntimeContext({
    config: {},
    runtimeGate: { agentId: "edi" },
    candidates: [baseCandidate()],
  });
  const enabledEdiRuntime = await formatSyntheticRuntimeContext({
    config: { cardFirstRuntime: { enabled: true } },
    runtimeGate: { agentId: "edi" },
    candidates: [baseCandidate()],
  });
  const enabledPlannerRuntime = await formatSyntheticRuntimeContext({
    config: { cardFirstRuntime: { enabled: true } },
    runtimeGate: { agentId: "task-planner" },
    candidates: [baseCandidate()],
  });
  const rawLogRuntime = await formatSyntheticRuntimeContext({
    config: { cardFirstRuntime: { enabled: true } },
    runtimeGate: { agentId: "edi" },
    candidates: [rawLogCandidate()],
  });

  const checks = [
    buildCheck({
      id: "default_runtime_uses_raw_text",
      name: "default runtime keeps legacy raw-text supplement",
      pass: defaultRuntime.card_first_runtime_enabled === false &&
        defaultRuntime.disclosure_mode === "raw_text" &&
        contextContains(defaultRuntime.context, "## Auto Recall - relevant memory") &&
        contextContains(defaultRuntime.context, "FULL_BODY_SHOULD_NOT_LEAK") &&
        !contextContains(defaultRuntime.context, "## Auto Recall - memory cards"),
      details: {
        card_first_runtime_enabled: defaultRuntime.card_first_runtime_enabled,
        disclosure_mode: defaultRuntime.disclosure_mode,
        context_has_raw_body: contextContains(defaultRuntime.context, "FULL_BODY_SHOULD_NOT_LEAK"),
        context_has_card_header: contextContains(defaultRuntime.context, "## Auto Recall - memory cards"),
      },
    }),
    buildCheck({
      id: "enabled_edi_runtime_uses_memory_cards",
      name: "edi with explicit cardFirstRuntime flag uses memory-card supplement",
      pass: enabledEdiRuntime.card_first_runtime_enabled === true &&
        enabledEdiRuntime.disclosure_mode === "memory_card" &&
        enabledEdiRuntime.card_count === 1 &&
        contextContains(enabledEdiRuntime.context, "## Auto Recall - memory cards") &&
        contextContains(enabledEdiRuntime.context, "P4 card-first runtime decision") &&
        contextContains(enabledEdiRuntime.context, "memory_engine_get:abc123def4567890") &&
        !contextContains(enabledEdiRuntime.context, "FULL_BODY_SHOULD_NOT_LEAK"),
      details: {
        card_first_runtime_enabled: enabledEdiRuntime.card_first_runtime_enabled,
        disclosure_mode: enabledEdiRuntime.disclosure_mode,
        card_count: enabledEdiRuntime.card_count,
        context_has_get_token: contextContains(enabledEdiRuntime.context, "memory_engine_get:abc123def4567890"),
        context_leaked_raw_body: contextContains(enabledEdiRuntime.context, "FULL_BODY_SHOULD_NOT_LEAK"),
      },
    }),
    buildCheck({
      id: "enabled_non_edi_runtime_stays_raw_text",
      name: "non-edi runtime does not use card-first supplement even when flag is enabled",
      pass: enabledPlannerRuntime.card_first_runtime_enabled === false &&
        enabledPlannerRuntime.disclosure_mode === "raw_text" &&
        contextContains(enabledPlannerRuntime.context, "## Auto Recall - relevant memory") &&
        contextContains(enabledPlannerRuntime.context, "FULL_BODY_SHOULD_NOT_LEAK"),
      details: {
        card_first_runtime_enabled: enabledPlannerRuntime.card_first_runtime_enabled,
        disclosure_mode: enabledPlannerRuntime.disclosure_mode,
        context_has_raw_body: contextContains(enabledPlannerRuntime.context, "FULL_BODY_SHOULD_NOT_LEAK"),
      },
    }),
    buildCheck({
      id: "enabled_card_runtime_withholds_raw_log_body",
      name: "card-first supplement withholds raw log and tool output body",
      pass: rawLogRuntime.card_first_runtime_enabled === true &&
        rawLogRuntime.disclosure_mode === "memory_card" &&
        rawLogRuntime.card_count === 1 &&
        contextContains(rawLogRuntime.context, "withheld") &&
        !contextContains(rawLogRuntime.context, "Traceback") &&
        !contextContains(rawLogRuntime.context, "Object.handle") &&
        !contextContains(rawLogRuntime.context, "2026-07-02 10:00:00"),
      details: {
        card_first_runtime_enabled: rawLogRuntime.card_first_runtime_enabled,
        disclosure_mode: rawLogRuntime.disclosure_mode,
        card_count: rawLogRuntime.card_count,
        risk_flags: rawLogRuntime.cards[0]?.risk_flags || [],
        leaked_traceback: contextContains(rawLogRuntime.context, "Traceback"),
        leaked_timestamp: contextContains(rawLogRuntime.context, "2026-07-02 10:00:00"),
      },
    }),
  ];

  const failedChecks = checks.filter(check => !check.pass);
  return {
    summary: {
      mode: "read_only_card_runtime_smoke",
      status: failedChecks.length === 0 ? "pass" : "fail",
      check_count: checks.length,
      passed_count: checks.length - failedChecks.length,
      failed_count: failedChecks.length,
      failed_check_ids: failedChecks.map(check => check.id),
    },
    side_effects: sideEffects(),
    checks,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# AutoRecall Card Runtime Smoke",
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
    const report = await runCardRuntimeSmoke();
    console.log(options.markdown ? renderMarkdown(report) : JSON.stringify(report, null, 2));
    return report.summary.failed_count === 0 ? 0 : 1;
  } catch (error) {
    console.error(String(error?.message || error));
    return 1;
  }
}

module.exports = {
  parseArgs,
  baseCandidate,
  rawLogCandidate,
  formatSyntheticRuntimeContext,
  runCardRuntimeSmoke,
  renderMarkdown,
  main,
};

if (process.argv[1] && /run-auto-recall-card-runtime-smoke\.js$/.test(process.argv[1])) {
  main().then(code => {
    process.exitCode = code;
  });
}
