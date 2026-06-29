#!/usr/bin/env node

function printHelp() {
  console.log(`Memory Process Boundary Audit

Usage:
  node bin/audit-memory-process-boundary.js [options]

Options:
  --help         Show this help
  --json         Print deterministic JSON audit output
  --markdown     Print Markdown summary
  --since <time> Override boundary time; default is latest local 03:00 boundary
  --out <path>   Also write the selected output to a file

Notes:
  - This command is read-only: no DB writes, no memory file mutation, no config mutation
  - No archive, quarantine, or reinforce actions are performed
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
    since: null,
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
    if (arg === "--since") {
      options.since = readFlagValue(argv, i, "--since");
      i += 1;
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

    const audit = await import("../lib/quality/memory-process-boundary-audit.js");
    const report = await audit.runMemoryProcessBoundaryAudit({
      since: options.since,
    });
    const output = options.markdown
      ? audit.renderMemoryProcessBoundaryMarkdown(report)
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

module.exports = {
  main,
  parseArgs,
};

if (process.argv[1] && /audit-memory-process-boundary\.js$/.test(process.argv[1])) {
  main().then(code => {
    process.exitCode = code;
  });
}
