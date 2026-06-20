#!/usr/bin/env node

function printHelp() {
  console.log(`Timestamp Pollution Audit

Usage:
  node bin/audit-timestamp-pollution.js [options]

Options:
  --help        Show this help
  --json        Print deterministic JSON audit output
  --markdown    Print Markdown summary
  --out <path>  Also write the selected output to a file

Notes:
  - This command is read-only: no DB writes, no cleanup, no backfill
  - Default output format is JSON
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

async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      printHelp();
      return 0;
    }

    const audit = await import("../lib/quality/timestamp-pollution-audit.js");
    const report = audit.runTimestampPollutionAudit();
    const output = options.markdown
      ? audit.renderTimestampPollutionMarkdown(report)
      : JSON.stringify(report, null, 2);

    if (options.out) {
      audit.writeAuditReport(output, options.out);
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
