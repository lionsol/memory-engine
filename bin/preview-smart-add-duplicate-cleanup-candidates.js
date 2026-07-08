#!/usr/bin/env node

const { writeFileSync } = require("node:fs");

const FLAG_PREFIX = "--";
const FORBIDDEN_FLAGS = new Set([
  `${FLAG_PREFIX}apply`,
  `${FLAG_PREFIX}fix`,
  `${FLAG_PREFIX}delete`,
  `${FLAG_PREFIX}archive`,
  `${FLAG_PREFIX}quarantine`,
  `${FLAG_PREFIX}backfill-confidence`,
  `${FLAG_PREFIX}write-db`,
]);

function writeStdout(value = "") {
  writeFileSync(process.stdout.fd, `${value}\n`, "utf8");
}

function writeStderr(value = "") {
  writeFileSync(process.stderr.fd, `${value}\n`, "utf8");
}

function printHelp() {
  console.log(`Preview Smart-Add Duplicate Cleanup Candidates

Usage:
  node bin/preview-smart-add-duplicate-cleanup-candidates.js [options]

Options:
  --help        Show this help
  --json        Print deterministic JSON output
  --markdown    Print Markdown summary
  --limit <n>   Limit previewed groups

Notes:
  - Read-only preview only
  - No DB writes, memory file mutation, cleanup apply, archive, quarantine, reinforce, confidence backfill, LLM, or network access
  - No runtime report files are written by this preview
`);
}

function readFlagValue(args, index, flagName) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flagName} expects a value`);
  }
  return value;
}

function parsePositiveInteger(value, flagName) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${flagName} expects a positive integer, got: ${value}`);
  }
  return n;
}

function parseArgs(argv = []) {
  const options = {
    help: false,
    json: false,
    markdown: false,
    limit: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
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
    if (arg === "--markdown") {
      options.markdown = true;
      continue;
    }
    if (arg === "--limit") {
      options.limit = parsePositiveInteger(readFlagValue(argv, i, "--limit"), "--limit");
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (options.json && options.markdown) {
    throw new Error("choose exactly one output format: --json or --markdown");
  }
  if (!options.help && !options.json && !options.markdown) {
    options.json = true;
  }

  return options;
}

function toOccurrencePreview(occurrence) {
  return {
    chunk_id: occurrence.chunk_id,
    path: occurrence.path,
    occurrence_date: occurrence.occurrence_date,
    category: occurrence.category,
    fingerprint_hash: occurrence.fingerprint_hash,
    retrieved_count: Number(occurrence.retrieved_count || 0),
    injected_count: Number(occurrence.injected_count || 0),
  };
}

function toGroupPreview(group) {
  return {
    group_hash: group.group_hash,
    normalized_content_hash: group.normalized_content_hash,
    classification: group.classification,
    risk_level: group.risk_level,
    likely_cause: group.likely_cause,
    cleanup_eligibility: Boolean(group.cleanup_eligibility),
    duplicate_count: Number(group.duplicate_count || 0),
    retrieved_count_total: Number(group.retrieved_count_total || 0),
    injected_count_total: Number(group.injected_count_total || 0),
    representative_content_preview: group.representative_content_preview,
    owners_touched: Array.isArray(group.owners_touched) ? group.owners_touched : [],
    families_touched: Array.isArray(group.families_touched) ? group.families_touched : [],
    category_breakdown: Array.isArray(group.category_breakdown) ? group.category_breakdown : [],
    all_occurrence_paths: Array.isArray(group.all_occurrence_paths) ? group.all_occurrence_paths : [],
    all_occurrence_dates: Array.isArray(group.all_occurrence_dates) ? group.all_occurrence_dates : [],
    suggested_keep_candidate: group.suggested_keep_candidate || null,
    suggested_delete_candidates: Array.isArray(group.suggested_delete_candidates) ? group.suggested_delete_candidates : [],
    occurrences: Array.isArray(group.occurrences) ? group.occurrences.map(toOccurrencePreview) : [],
  };
}

async function runCleanupCandidatePreview(options = {}) {
  const { runSmartAddDuplicateAudit } = await import("../lib/quality/smart-add-duplicate-audit.js");
  const audit = runSmartAddDuplicateAudit();
  const groups = Array.isArray(audit?.groups) ? audit.groups : [];
  const cleanupEligibleGroups = groups
    .filter(group => group.cleanup_eligibility === true && group.classification === "ingestion_bug_candidate")
    .map(toGroupPreview);
  const previewedGroups = options.limit ? cleanupEligibleGroups.slice(0, options.limit) : cleanupEligibleGroups;

  return {
    generated_at: new Date().toISOString(),
    summary: {
      mode: "read_only_preview",
      status: "pass",
      cleanup_eligible_groups: Number(audit?.summary?.cleanup_eligible_groups || cleanupEligibleGroups.length),
      cleanup_eligible_entries: Number(audit?.summary?.cleanup_eligible_entries || 0),
      previewed_groups: previewedGroups.length,
      limit: options.limit ?? null,
    },
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
    groups: previewedGroups,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Smart-Add Duplicate Cleanup Candidate Preview",
    "",
    `- generated_at: ${report.generated_at}`,
    `- status: ${report.summary.status}`,
    `- cleanup_eligible_groups: ${report.summary.cleanup_eligible_groups}`,
    `- cleanup_eligible_entries: ${report.summary.cleanup_eligible_entries}`,
    `- previewed_groups: ${report.summary.previewed_groups}`,
    `- limit: ${report.summary.limit ?? "none"}`,
    "",
    "## Candidate Groups",
    "",
  ];

  if ((report.groups || []).length === 0) {
    lines.push("- none", "");
  } else {
    for (const group of report.groups) {
      lines.push(`### ${group.group_hash}`);
      lines.push(`- normalized_content_hash: ${group.normalized_content_hash}`);
      lines.push(`- classification: ${group.classification}`);
      lines.push(`- risk_level: ${group.risk_level}`);
      lines.push(`- likely_cause: ${group.likely_cause}`);
      lines.push(`- duplicate_count: ${group.duplicate_count}`);
      lines.push(`- retrieved_count_total: ${group.retrieved_count_total}`);
      lines.push(`- injected_count_total: ${group.injected_count_total}`);
      lines.push(`- representative_content_preview: ${group.representative_content_preview}`);
      lines.push(`- owners_touched: ${JSON.stringify(group.owners_touched)}`);
      lines.push(`- families_touched: ${JSON.stringify(group.families_touched)}`);
      lines.push(`- category_breakdown: ${JSON.stringify(group.category_breakdown)}`);
      lines.push(`- all_occurrence_paths: ${JSON.stringify(group.all_occurrence_paths)}`);
      lines.push(`- all_occurrence_dates: ${JSON.stringify(group.all_occurrence_dates)}`);
      lines.push(`- suggested_keep_candidate: ${JSON.stringify(group.suggested_keep_candidate)}`);
      lines.push(`- suggested_delete_candidates: ${JSON.stringify(group.suggested_delete_candidates)}`);
      lines.push(`- occurrences: ${JSON.stringify(group.occurrences)}`);
      lines.push("");
    }
  }

  lines.push("## Side Effects", "");
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
    const report = await runCleanupCandidatePreview(options);
    const output = options.markdown
      ? renderMarkdown(report)
      : JSON.stringify(report, null, 2);
    writeStdout(output);
    return 0;
  } catch (error) {
    writeStderr(String(error?.message || error));
    return 1;
  }
}

module.exports = {
  parseArgs,
  runCleanupCandidatePreview,
  renderMarkdown,
  main,
};

if (process.argv[1] && /preview-smart-add-duplicate-cleanup-candidates\.js$/.test(process.argv[1])) {
  main().then(code => {
    process.exitCode = code;
  });
}
