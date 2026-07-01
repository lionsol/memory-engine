#!/usr/bin/env node

const { existsSync, readFileSync, appendFileSync } = require("node:fs");
const { resolve } = require("node:path");

const CONFIRM_TOKEN = "APPEND_TURN_GOLD_SET";

function printHelp() {
  console.log(`Commit reviewed AutoRecall turn gold-set expansion candidates

Usage:
  node bin/commit-turn-gold-set-expansion.js --dataset <jsonl> --plan <json> [options]

Options:
  --dataset <path>                  Target JSONL dataset to append to
  --plan <path>                     Expansion plan JSON from replay output or expansion_plan object
  --candidate <id>                  Candidate id to include; can be repeated
  --all-approved                    Include every candidate with status approved or human_approved
  --dry-run                         Validate and report only; default mode
  --apply                           Append rows to dataset; requires confirmation token
  --confirm-append-turn-gold-set <token>
                                  Required for --apply; token must be ${CONFIRM_TOKEN}
  --json                            Print JSON report; default
  --help                            Show this help

Safety:
  - Dry-run by default
  - Apply requires explicit --apply plus confirmation token
  - Only approved/human_approved candidates are appendable
  - Duplicate turn_id rows are rejected
  - Candidate row_template is schema-validated before append
`);
}

function parseArgs(argv = []) {
  const options = {
    dataset: null,
    plan: null,
    candidates: [],
    allApproved: false,
    dryRun: true,
    apply: false,
    confirmToken: null,
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
    if (arg === "--dry-run") {
      options.dryRun = true;
      options.apply = false;
      continue;
    }
    if (arg === "--apply") {
      options.apply = true;
      options.dryRun = false;
      continue;
    }
    if (arg === "--all-approved") {
      options.allApproved = true;
      continue;
    }
    if (arg === "--dataset") {
      const value = argv[i + 1];
      if (!value) throw new Error("--dataset requires a path");
      options.dataset = value;
      i += 1;
      continue;
    }
    if (arg === "--plan") {
      const value = argv[i + 1];
      if (!value) throw new Error("--plan requires a path");
      options.plan = value;
      i += 1;
      continue;
    }
    if (arg === "--candidate") {
      const value = argv[i + 1];
      if (!value) throw new Error("--candidate requires an id");
      options.candidates.push(value);
      i += 1;
      continue;
    }
    if (arg === "--confirm-append-turn-gold-set") {
      const value = argv[i + 1];
      if (!value) throw new Error("--confirm-append-turn-gold-set requires a token");
      options.confirmToken = value;
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!options.help) {
    if (!options.dataset) throw new Error("--dataset is required");
    if (!options.plan) throw new Error("--plan is required");
    if (!options.allApproved && options.candidates.length === 0) {
      throw new Error("choose candidates with --candidate or --all-approved");
    }
  }

  return options;
}

function parseJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function normalizePlan(payload) {
  if (Array.isArray(payload?.candidates)) return payload;
  if (Array.isArray(payload?.expansion_plan?.candidates)) return payload.expansion_plan;
  throw new Error("plan file must contain expansion_plan.candidates or candidates");
}

function parseDatasetTurnIds(content) {
  const ids = new Set();
  const invalidLines = [];
  String(content || "").split(/\r?\n/u).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const row = JSON.parse(line);
      if (row?.turn_id) ids.add(String(row.turn_id));
    } catch (error) {
      invalidLines.push({ line_number: index + 1, error: String(error?.message || error) });
    }
  });
  return { ids, invalidLines };
}

function isApprovedCandidate(candidate) {
  return ["approved", "human_approved", "approved_for_append"].includes(String(candidate?.status || ""));
}

function selectCandidates(plan, options) {
  const candidates = Array.isArray(plan?.candidates) ? plan.candidates : [];
  const requested = new Set(options.candidates || []);
  return candidates.filter(candidate => {
    if (options.allApproved) return isApprovedCandidate(candidate);
    return requested.has(String(candidate?.candidate_id || ""));
  });
}

function candidateError(candidate, datasetTurnIds, validateTurnGoldSetRow) {
  const errors = [];
  if (!candidate || typeof candidate !== "object") return ["candidate_object"];
  if (!candidate.candidate_id) errors.push("candidate_id");
  if (!isApprovedCandidate(candidate)) errors.push("candidate_not_approved");
  const row = candidate.row_template;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    errors.push("row_template");
  } else {
    const validation = validateTurnGoldSetRow(row);
    if (!validation.valid) errors.push(...validation.errors.map(error => `row_template:${error}`));
    if (datasetTurnIds.has(String(row.turn_id || ""))) errors.push("duplicate_turn_id");
  }
  return Array.from(new Set(errors));
}

function serializeRows(candidates) {
  return candidates.map(candidate => JSON.stringify(candidate.row_template)).join("\n") + "\n";
}

async function buildCommitReport(options) {
  const { validateTurnGoldSetRow } = await import("../lib/recall/auto-recall-turn-gold-set.js");
  const datasetPath = resolve(process.cwd(), options.dataset);
  const planPath = resolve(process.cwd(), options.plan);
  if (!existsSync(datasetPath)) throw new Error(`dataset not found: ${datasetPath}`);
  if (!existsSync(planPath)) throw new Error(`plan not found: ${planPath}`);

  const datasetContent = readFileSync(datasetPath, "utf8");
  const { ids: datasetTurnIds, invalidLines } = parseDatasetTurnIds(datasetContent);
  const plan = normalizePlan(parseJsonFile(planPath));
  const selected = selectCandidates(plan, options);
  const candidateReports = selected.map(candidate => {
    const errors = candidateError(candidate, datasetTurnIds, validateTurnGoldSetRow);
    return {
      candidate_id: candidate?.candidate_id || null,
      row_turn_id: candidate?.row_template?.turn_id || null,
      appendable: errors.length === 0,
      errors,
      status: candidate?.status || null,
    };
  });

  const appendable = candidateReports.filter(item => item.appendable);
  const blocked = candidateReports.filter(item => !item.appendable);
  const preflightFailures = [];
  if (invalidLines.length > 0) preflightFailures.push("dataset_jsonl_has_invalid_rows");
  if (selected.length === 0) preflightFailures.push("no_candidates_selected");
  if (blocked.length > 0) preflightFailures.push("selected_candidates_blocked");
  if (options.apply && options.confirmToken !== CONFIRM_TOKEN) preflightFailures.push("missing_or_invalid_confirm_token");

  const canApply = options.apply && preflightFailures.length === 0 && appendable.length > 0;
  const appendContent = serializeRows(selected);

  return {
    dataset: datasetPath,
    plan: planPath,
    mode: options.apply ? "apply" : "dry_run",
    confirm_token_required: CONFIRM_TOKEN,
    preflight_passed: preflightFailures.length === 0,
    preflight_failures: preflightFailures,
    selected_count: selected.length,
    appendable_count: appendable.length,
    blocked_count: blocked.length,
    candidate_reports: candidateReports,
    dataset_invalid_lines: invalidLines,
    would_append_turn_ids: appendable.map(item => item.row_turn_id),
    side_effects: {
      db_writes: false,
      memory_file_mutation: false,
      dataset_file_mutation: canApply,
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
    _append_content: appendContent,
    _can_apply: canApply,
  };
}

function publicReport(report) {
  const { _append_content, _can_apply, ...rest } = report;
  return rest;
}

async function runCommit(options) {
  const report = await buildCommitReport(options);
  if (report._can_apply) {
    appendFileSync(report.dataset, report._append_content, "utf8");
  }
  return {
    ...publicReport(report),
    applied: Boolean(report._can_apply),
  };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      printHelp();
      return 0;
    }
    const report = await runCommit(options);
    console.log(JSON.stringify(report, null, 2));
    return report.preflight_passed ? 0 : 1;
  } catch (error) {
    console.error(String(error?.message || error));
    return 1;
  }
}

module.exports = {
  CONFIRM_TOKEN,
  parseArgs,
  normalizePlan,
  parseDatasetTurnIds,
  isApprovedCandidate,
  selectCandidates,
  buildCommitReport,
  runCommit,
  main,
};

if (process.argv[1] && /commit-turn-gold-set-expansion\.js$/.test(process.argv[1])) {
  main().then(code => {
    process.exitCode = code;
  });
}
