#!/usr/bin/env node
const { resolve } = require("node:path");

function readFlagValue(argv, index, flagName) {
  const value = argv[index + 1];
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
    rootDir: null,
    memoryDir: null,
    coreDbPath: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h" || arg === "help") {
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
    if (arg === "--root-dir") {
      options.rootDir = resolve(readFlagValue(argv, i, "--root-dir"));
      i += 1;
      continue;
    }
    if (arg === "--memory-dir") {
      options.memoryDir = resolve(readFlagValue(argv, i, "--memory-dir"));
      i += 1;
      continue;
    }
    if (arg === "--core-db-path") {
      options.coreDbPath = resolve(readFlagValue(argv, i, "--core-db-path"));
      i += 1;
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

function usage() {
  console.error(`Usage:
  node bin/audit-smart-add-propagation.js [--json|--markdown] [--out <path>]
      [--root-dir <workspace-root>] [--memory-dir <memory-dir>] [--core-db-path <main.sqlite>]

Notes:
  - Default mode is read-only.
  - Scans memory/smart-add/*.md and memory/episodes/*.md for propagation keywords.
  - Reports suspected polluted targets and stale indexed chunks without modifying files or DB.`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    usage();
    process.exit(0);
  }
  const audit = await import("../lib/quality/smart-add-propagation-audit.js");
  const report = audit.runSmartAddPropagationAudit(options);
  const output = options.markdown
    ? audit.renderSmartAddPropagationAuditMarkdown(report)
    : JSON.stringify(report, null, 2);
  if (options.out) {
    audit.writeAuditReport(output, options.out);
  }
  console.log(output);
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exit(1);
});

module.exports = {
  main,
  parseArgs,
};
