#!/usr/bin/env node

const { mkdirSync, writeFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { runReplay, DEFAULT_DATASET } = require("./run-turn-gold-set-replay.js");

const CONFIRM_TOKEN = "WRITE_TURN_GOLD_REPLAY_REPORT";

function pad(value) {
  return String(value).padStart(2, "0");
}

function timestampForDate(date = new Date()) {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "-",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

function validateTimestamp(value) {
  const timestamp = String(value || "").trim();
  if (!/^\d{8}-\d{6}$/.test(timestamp)) {
    throw new Error("--timestamp must match YYYYMMDD-HHMMSS");
  }
  return timestamp;
}

function reportNameForTimestamp(timestamp) {
  return `auto-recall-turn-gold-set-replay-${timestamp}.json`;
}

function printHelp() {
  console.log(`Export AutoRecall turn gold-set replay report

Usage:
  node bin/export-turn-gold-set-replay-report.js [options]

Options:
  --dataset <path>                 JSONL dataset path, default: ${DEFAULT_DATASET}
  --reports-dir <path>             Reports directory, default: Console reports dir
  --timestamp <YYYYMMDD-HHMMSS>    Deterministic report timestamp, default: current UTC time
  --write-report                   Write JSON report file; default is dry-run only
  --confirm-write-report <token>   Required with --write-report; token: ${CONFIRM_TOKEN}
  --json                           Print JSON export summary, default
  --help                           Show this help

Notes:
  - Default mode is dry-run and writes no files
  - --write-report writes only one allowlisted Console report JSON file
  - Does not write DB, mutate memory files, run retrieval, inject, reinforce, call LLM, or access network
`);
}

function parseArgs(argv = []) {
  const options = {
    dataset: DEFAULT_DATASET,
    reportsDir: null,
    timestamp: null,
    writeReport: false,
    confirmWriteReport: "",
    json: true,
    help: false,
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
    if (arg === "--write-report") {
      options.writeReport = true;
      continue;
    }
    if (arg === "--dataset") {
      const value = argv[i + 1];
      if (!value) throw new Error("--dataset requires a path");
      options.dataset = value;
      i += 1;
      continue;
    }
    if (arg === "--reports-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--reports-dir requires a path");
      options.reportsDir = value;
      i += 1;
      continue;
    }
    if (arg === "--timestamp") {
      const value = argv[i + 1];
      if (!value) throw new Error("--timestamp requires a value");
      options.timestamp = validateTimestamp(value);
      i += 1;
      continue;
    }
    if (arg === "--confirm-write-report") {
      const value = argv[i + 1];
      if (!value) throw new Error("--confirm-write-report requires a token");
      options.confirmWriteReport = value;
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

function buildReportPayload({ datasetPath, report, generatedAt }) {
  return {
    kind: "auto_recall_turn_gold_set_replay",
    generated_at: generatedAt,
    dataset: datasetPath,
    replay: report.replay,
    feedback: report.feedback,
    expansion_plan: report.expansion_plan,
    export_side_effects: {
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
    },
  };
}

async function resolveReportsDir(optionReportsDir) {
  if (optionReportsDir) return resolve(process.cwd(), optionReportsDir);
  const { getReportsDir } = await import("../console/services/reports-service.js");
  return getReportsDir();
}

async function validateReportName(name) {
  const { validateReportName: validate } = await import("../console/services/reports-service.js");
  return validate(name);
}

async function buildExport(options) {
  const timestamp = options.timestamp || timestampForDate(new Date());
  const reportName = reportNameForTimestamp(timestamp);
  const validReportName = await validateReportName(reportName);
  const reportsDir = await resolveReportsDir(options.reportsDir);
  const reportPath = join(reportsDir, validReportName);
  const { datasetPath, report } = await runReplay({
    dataset: options.dataset,
    json: true,
    summary: false,
  });
  const payload = buildReportPayload({
    datasetPath,
    report,
    generatedAt: new Date().toISOString(),
  });

  const errors = [];
  if (options.writeReport && options.confirmWriteReport !== CONFIRM_TOKEN) {
    errors.push("missing_or_invalid_confirm_write_report_token");
  }
  if (report.replay.summary.failed_count !== 0) {
    errors.push("replay_has_failures");
  }
  if (report.replay.summary.invalid_count !== 0) {
    errors.push("replay_has_invalid_rows");
  }

  const canWrite = options.writeReport && errors.length === 0;
  const summary = {
    mode: "turn_gold_set_replay_report_export",
    dry_run: !options.writeReport,
    write_requested: options.writeReport,
    wrote_report: false,
    report_name: validReportName,
    report_path: reportPath,
    replay_total: report.replay.summary.total_count,
    replay_failed: report.replay.summary.failed_count,
    replay_invalid: report.replay.summary.invalid_count,
    card_projection_count: report.replay.summary.card_projection_count || 0,
    errors,
    side_effects: {
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
      runtime_report_files: canWrite,
    },
  };

  return {
    summary,
    payload,
    _can_write: canWrite,
    _report_path: reportPath,
    _reports_dir: reportsDir,
  };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      printHelp();
      return 0;
    }

    const exportResult = await buildExport(options);
    if (exportResult._can_write) {
      mkdirSync(exportResult._reports_dir, { recursive: true });
      writeFileSync(exportResult._report_path, `${JSON.stringify(exportResult.payload, null, 2)}\n`, "utf8");
      exportResult.summary.wrote_report = true;
    }

    const output = {
      summary: exportResult.summary,
      report: exportResult.payload,
    };
    console.log(JSON.stringify(output, null, 2));
    return exportResult.summary.errors.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(String(error?.message || error));
    return 1;
  }
}

module.exports = {
  CONFIRM_TOKEN,
  DEFAULT_DATASET,
  buildExport,
  buildReportPayload,
  parseArgs,
  reportNameForTimestamp,
  timestampForDate,
  validateTimestamp,
  main,
};

if (process.argv[1] && /export-turn-gold-set-replay-report\.js$/.test(process.argv[1])) {
  main().then(code => {
    process.exitCode = code;
  });
}
