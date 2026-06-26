#!/usr/bin/env node

function printHelp() {
  console.log(`Cleanup Confirmed Smart-Add Propagation Stale Chunks

Usage:
  node bin/cleanup-confirmed-smart-add-propagation-stale-chunks.js [options]

Options:
  --help                      Show this help
  --json                      Print deterministic JSON output
  --root <path>               Workspace root; defaults to ~/.openclaw/workspace
  --memory-dir <path>         Memory directory; defaults to <root>/memory
  --core-db <path>            Core DB path; defaults to ~/.openclaw/memory/main.sqlite
  --engine-db <path>          Engine DB path; defaults to ~/.openclaw/memory/memory-engine/memory-engine.sqlite
  --confirmed-path <path>     Explicit confirmed path; current allowlist only permits memory/smart-add/2026-06-24.md
  --apply                     Delete confirmed stale chunk rows from DBs
  --confirm <token>           Required with --apply; use cleanup-confirmed-smart-add-propagation-stale-chunks

Notes:
  - Default mode is dry-run
  - Cleanup is confirmed-only and never expands to suspected audit hits
  - Deletion matches chunk ids whose path and content satisfy the confirmed smart-add propagation markers
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
    help: false,
    json: false,
    rootDir: null,
    memoryDir: null,
    coreDbPath: null,
    engineDbPath: null,
    apply: false,
    confirm: null,
    confirmedPaths: [],
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
    if (arg === "--root") {
      options.rootDir = readFlagValue(argv, i, "--root");
      i += 1;
      continue;
    }
    if (arg === "--memory-dir") {
      options.memoryDir = readFlagValue(argv, i, "--memory-dir");
      i += 1;
      continue;
    }
    if (arg === "--core-db") {
      options.coreDbPath = readFlagValue(argv, i, "--core-db");
      i += 1;
      continue;
    }
    if (arg === "--engine-db") {
      options.engineDbPath = readFlagValue(argv, i, "--engine-db");
      i += 1;
      continue;
    }
    if (arg === "--confirmed-path") {
      options.confirmedPaths.push(readFlagValue(argv, i, "--confirmed-path"));
      i += 1;
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
    throw new Error(`unknown argument: ${arg}`);
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

    const mod = await import("../lib/quality/confirmed-smart-add-propagation-stale-cleanup.js");
    const result = options.apply
      ? mod.applyConfirmedSmartAddPropagationStaleChunkCleanup(options)
      : mod.collectConfirmedSmartAddPropagationStaleChunksDryRun(options);
    console.log(JSON.stringify(result, null, 2));
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
