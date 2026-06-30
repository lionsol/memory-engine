#!/usr/bin/env node

function printHelp() {
  console.log(`Run Smart-Add Duplicate Baseline Smoke

Usage:
  node bin/run-smart-add-duplicate-baseline-smoke.js [options]

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
  if (!options.help && !options.json && !options.markdown) {
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

function compactValue(value) {
  if (Array.isArray(value)) {
    return {
      count: value.length,
    };
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const compacted = {};
  for (const [key, entry] of Object.entries(value)) {
    compacted[key] = compactValue(entry);
  }
  return compacted;
}

function compactReportForCli(report) {
  return {
    generated_at: report.generated_at,
    summary: report.summary,
    baseline: report.baseline,
    side_effects: report.side_effects,
    checks: (report.checks || []).map(check => ({
      id: check.id,
      name: check.name,
      pass: check.pass,
      details: compactValue(check.details),
    })),
  };
}

function hasNoNonSmartAddOccurrence(group) {
  const owners = Array.isArray(group?.owners_touched) ? group.owners_touched : [];
  const families = Array.isArray(group?.families_touched) ? group.families_touched : [];
  return owners.length === 1
    && owners[0] === "memory_engine_lifecycle"
    && families.length === 1
    && families[0] === "smart_add"
    && Number(group?.all_occurrence_count || 0) === Number(group?.duplicate_count || 0);
}

async function runSmartAddDuplicateBaselineSmoke() {
  const { runSmartAddDuplicateAudit } = await import("../lib/quality/smart-add-duplicate-audit.js");
  const report = runSmartAddDuplicateAudit();
  const groups = Array.isArray(report?.groups) ? report.groups : [];
  const byClassification = classification => groups.filter(group => group.classification === classification);
  const cleanupEligibleGroups = groups.filter(group => group.cleanup_eligibility === true);
  const usageGroups = groups.filter(group => Number(group.retrieved_count_total || 0) > 0 || Number(group.injected_count_total || 0) > 0);

  const checks = [
    buildCheck({
      id: "cleanup_eligible_groups_count",
      name: "cleanup eligible group count remains 10",
      pass: Number(report?.summary?.cleanup_eligible_groups || 0) === 10,
      details: {
        cleanup_eligible_groups: Number(report?.summary?.cleanup_eligible_groups || 0),
      },
    }),
    buildCheck({
      id: "cleanup_eligible_entries_count",
      name: "cleanup eligible entry count remains 27",
      pass: Number(report?.summary?.cleanup_eligible_entries || 0) === 27,
      details: {
        cleanup_eligible_entries: Number(report?.summary?.cleanup_eligible_entries || 0),
      },
    }),
    buildCheck({
      id: "ingestion_bug_candidate_groups_count",
      name: "ingestion bug candidate group count remains 10",
      pass: Number(report?.summary?.ingestion_bug_candidate_groups || 0) === 10,
      details: {
        ingestion_bug_candidate_groups: Number(report?.summary?.ingestion_bug_candidate_groups || 0),
      },
    }),
    buildCheck({
      id: "unsafe_to_cleanup_groups_count",
      name: "unsafe to cleanup group count remains 37",
      pass: Number(report?.summary?.unsafe_to_cleanup_groups || 0) === 37,
      details: {
        unsafe_to_cleanup_groups: Number(report?.summary?.unsafe_to_cleanup_groups || 0),
      },
    }),
    buildCheck({
      id: "cleanup_eligible_groups_are_safe",
      name: "cleanup eligible groups stay ingestion bug candidates with no retrieval or injection usage",
      pass: cleanupEligibleGroups.length > 0 && cleanupEligibleGroups.every(group => (
        group.classification === "ingestion_bug_candidate"
        && Number(group.retrieved_count_total || 0) === 0
        && Number(group.injected_count_total || 0) === 0
        && hasNoNonSmartAddOccurrence(group)
      )),
      details: cleanupEligibleGroups.map(group => ({
        preview: group.representative_content_preview,
        classification: group.classification,
        cleanup_eligibility: group.cleanup_eligibility,
        retrieved_count_total: Number(group.retrieved_count_total || 0),
        injected_count_total: Number(group.injected_count_total || 0),
        owners_touched: group.owners_touched,
        families_touched: group.families_touched,
      })),
    }),
    buildCheck({
      id: "usage_groups_are_not_cleanup_eligible",
      name: "groups with retrieval or injection usage are not cleanup eligible and stay unsafe",
      pass: usageGroups.length > 0 && usageGroups.every(group => (
        group.cleanup_eligibility !== true
        && group.classification === "unsafe_to_cleanup"
      )),
      details: usageGroups.map(group => ({
        preview: group.representative_content_preview,
        classification: group.classification,
        cleanup_eligibility: group.cleanup_eligibility,
        retrieved_count_total: Number(group.retrieved_count_total || 0),
        injected_count_total: Number(group.injected_count_total || 0),
      })),
    }),
    buildCheck({
      id: "repeated_confirmation_groups_are_not_cleanup_eligible",
      name: "repeated confirmation groups stay manual-review only",
      pass: byClassification("repeated_confirmation_candidate").every(group => group.cleanup_eligibility !== true),
      details: byClassification("repeated_confirmation_candidate").map(group => ({
        preview: group.representative_content_preview,
        classification: group.classification,
        cleanup_eligibility: group.cleanup_eligibility,
        duplicate_count: Number(group.duplicate_count || 0),
      })),
    }),
    buildCheck({
      id: "mixed_or_unclear_groups_are_not_cleanup_eligible",
      name: "mixed or unclear groups stay manual-review only",
      pass: byClassification("mixed_or_unclear").every(group => group.cleanup_eligibility !== true),
      details: byClassification("mixed_or_unclear").map(group => ({
        preview: group.representative_content_preview,
        classification: group.classification,
        cleanup_eligibility: group.cleanup_eligibility,
        duplicate_count: Number(group.duplicate_count || 0),
      })),
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
    baseline: {
      duplicate_exact_groups: Number(report?.summary?.duplicate_exact_groups || 0),
      duplicate_exact_entries: Number(report?.summary?.duplicate_exact_entries || 0),
      cleanup_eligible_groups: Number(report?.summary?.cleanup_eligible_groups || 0),
      cleanup_eligible_entries: Number(report?.summary?.cleanup_eligible_entries || 0),
      retrieved_duplicate_groups: Number(report?.summary?.retrieved_duplicate_groups || 0),
      injected_duplicate_groups: Number(report?.summary?.injected_duplicate_groups || 0),
      ingestion_bug_candidate_groups: Number(report?.summary?.ingestion_bug_candidate_groups || 0),
      repeated_confirmation_groups: Number(report?.summary?.repeated_confirmation_groups || 0),
      mixed_or_unclear_groups: Number(report?.summary?.mixed_or_unclear_groups || 0),
      unsafe_to_cleanup_groups: Number(report?.summary?.unsafe_to_cleanup_groups || 0),
    },
    checks,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Smart-Add Duplicate Baseline Smoke",
    "",
    `- generated_at: ${report.generated_at}`,
    `- status: ${report.summary.status}`,
    `- checks_passed: ${report.summary.passed_count}/${report.summary.check_count}`,
    `- failed_check_ids: ${report.summary.failed_check_ids.length > 0 ? report.summary.failed_check_ids.join(", ") : "none"}`,
    "",
    "## Baseline",
    "",
    `- cleanup_eligible_groups: ${report.baseline.cleanup_eligible_groups}`,
    `- cleanup_eligible_entries: ${report.baseline.cleanup_eligible_entries}`,
    `- ingestion_bug_candidate_groups: ${report.baseline.ingestion_bug_candidate_groups}`,
    `- unsafe_to_cleanup_groups: ${report.baseline.unsafe_to_cleanup_groups}`,
    "",
    "## Checks",
    "",
  ];

  for (const check of report.checks) {
    lines.push(`- ${check.pass ? "PASS" : "FAIL"}: ${check.id} :: ${check.name}`);
    lines.push(`  details: ${JSON.stringify(compactValue(check.details))}`);
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

    const report = await runSmartAddDuplicateBaselineSmoke();
    const outputReport = compactReportForCli(report);
    const output = options.markdown
      ? renderMarkdown(outputReport)
      : JSON.stringify(outputReport, null, 2);
    console.log(output);
    return report.summary.status === "pass" ? 0 : 1;
  } catch (error) {
    console.error(String(error?.message || error));
    return 1;
  }
}

module.exports = {
  parseArgs,
  runSmartAddDuplicateBaselineSmoke,
  renderMarkdown,
  main,
};

if (process.argv[1] && /run-smart-add-duplicate-baseline-smoke\.js$/.test(process.argv[1])) {
  main().then(code => {
    process.exitCode = code;
  });
}
