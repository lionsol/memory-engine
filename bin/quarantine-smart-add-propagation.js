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
    apply: false,
    confirm: null,
    confirmedPaths: [],
    confirmedFingerprints: [],
    confirmedPrefixes: [],
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
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--confirm") {
      options.confirm = readFlagValue(argv, i, "--confirm");
      i += 1;
      continue;
    }
    if (arg === "--confirmed-path") {
      options.confirmedPaths.push(readFlagValue(argv, i, "--confirmed-path"));
      i += 1;
      continue;
    }
    if (arg === "--confirmed-fingerprint") {
      options.confirmedFingerprints.push(readFlagValue(argv, i, "--confirmed-fingerprint"));
      i += 1;
      continue;
    }
    if (arg === "--confirmed-prefix") {
      options.confirmedPrefixes.push(readFlagValue(argv, i, "--confirmed-prefix"));
      i += 1;
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
  node bin/quarantine-smart-add-propagation.js [--json|--markdown] [--out <path>]
      [--root-dir <workspace-root>] [--memory-dir <memory-dir>] [--core-db-path <main.sqlite>]
      --confirmed-path <memory/...md> [--confirmed-path <memory/...md> ...]
      [--confirmed-fingerprint <fingerprint-prefix> ...]
      [--confirmed-prefix <block-id-prefix> ...]
      [--apply --confirm quarantine-smart-add-propagation]

Notes:
  - Default mode is dry-run and will not modify live memory.
  - Apply mode only handles explicitly confirmed paths and never auto-applies all suspected audit hits.
  - smart-add manual quarantine selectors are explicit only; passing a fingerprint or block-id prefix does not widen automatic detection.
  - If a safe block boundary cannot be found, the tool reports requires_manual_review and leaves the source file untouched.`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    usage();
    process.exit(0);
  }
  const quarantine = await import("../lib/quality/smart-add-propagation-quarantine.js");
  const report = quarantine.runSmartAddPropagationQuarantine(options);
  const output = options.markdown
    ? quarantine.renderSmartAddPropagationQuarantineMarkdown(report)
    : JSON.stringify(report, null, 2);
  if (options.out) {
    quarantine.writeQuarantineReport(output, options.out);
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
