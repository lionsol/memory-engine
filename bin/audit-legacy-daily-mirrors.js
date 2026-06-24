#!/usr/bin/env node

function printHelp() {
  console.log(`Legacy Daily Mirror Audit

Usage:
  node bin/audit-legacy-daily-mirrors.js [options]

Options:
  --help                  Show this help
  --json                  Print deterministic JSON output
  --markdown              Print Markdown summary
  --out <path>            Also write the selected output to a file
  --root <path>           Repository root; defaults to cwd
  --memory-dir <path>     Memory directory; defaults to <root>/memory
  --apply                 Move confirmed legacy mirror files into quarantine
  --confirm <token>       Required with --apply; use quarantine-legacy-daily-mirrors
  --review-report         Generate quarantine review report JSON without modifying quarantine-log.jsonl

Notes:
  - Default mode is dry-run
  - Apply mode only moves files classified as legacy_daily_mirror_candidates
  - Review report writes memory/legacy-daily-mirrors/quarantine-review-YYYY-MM-DD.json
`);
}

function readFlagValue(args, index, flagName) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flagName} expects a value`);
  }
  return value;
}

function parseArgs(argv = []) {
  const options = {
    json: false,
    markdown: false,
    out: null,
    root: process.cwd(),
    memoryDir: null,
    apply: false,
    reviewReport: false,
    confirm: null,
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
    if (arg === "--markdown") {
      options.markdown = true;
      continue;
    }
    if (arg === "--out") {
      options.out = readFlagValue(argv, i, "--out");
      i += 1;
      continue;
    }
    if (arg === "--root") {
      options.root = readFlagValue(argv, i, "--root");
      i += 1;
      continue;
    }
    if (arg === "--memory-dir") {
      options.memoryDir = readFlagValue(argv, i, "--memory-dir");
      i += 1;
      continue;
    }
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--review-report") {
      options.reviewReport = true;
      continue;
    }
    if (arg === "--confirm") {
      options.confirm = readFlagValue(argv, i, "--confirm");
      i += 1;
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

function renderMarkdown(report) {
  return [
    "# Legacy Daily Mirror Audit",
    "",
    `- mode: ${report.mode}`,
    `- scanned_daily_root_files: ${report.summary.scanned_daily_root_files}`,
    `- legacy_daily_mirror_candidates: ${report.summary.legacy_daily_mirror_candidates}`,
    `- manual_daily_journal_candidates: ${report.summary.manual_daily_journal_candidates}`,
    `- ambiguous_daily_files: ${report.summary.ambiguous_daily_files}`,
    `- moved_count: ${report.summary.moved_count}`,
    "",
    "## Legacy Candidates",
    ...report.legacy_daily_mirror_candidates.map(item => `- ${item.path} (${item.reason}, similarity=${item.similarity})`),
    "",
    "## Manual Candidates",
    ...report.manual_daily_journal_candidates.map(item => `- ${item.path} (${item.reason}, similarity=${item.similarity})`),
    "",
    "## Ambiguous Files",
    ...report.ambiguous_daily_files.map(item => `- ${item.path} (${item.reason}, similarity=${item.similarity})`),
  ].join("\n");
}

async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      printHelp();
      return 0;
    }

    const mod = await import("../lib/quality/legacy-daily-mirror-audit.js");
    const report = options.reviewReport
      ? mod.generateLegacyDailyMirrorQuarantineReview({
        rootDir: options.root,
        memoryDir: options.memoryDir || undefined,
      })
      : mod.runLegacyDailyMirrorAudit({
        rootDir: options.root,
        memoryDir: options.memoryDir || undefined,
        apply: options.apply,
        confirm: options.confirm,
      });
    const output = options.markdown
      ? renderMarkdown(report)
      : JSON.stringify(report, null, 2);

    if (options.out) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(options.out, output);
    }

    console.log(output);
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
};
