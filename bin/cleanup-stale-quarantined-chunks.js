#!/usr/bin/env node

function printHelp() {
  console.log(`Cleanup Stale Quarantined Chunks

Usage:
  node bin/cleanup-stale-quarantined-chunks.js [options]

Options:
  --help                      Show this help
  --json                      Print deterministic JSON output
  --root <path>               Workspace root; defaults to ~/.openclaw/workspace
  --memory-dir <path>         Memory directory; defaults to <root>/memory
  --core-db <path>            Core DB path; defaults to ~/.openclaw/memory/main.sqlite
  --apply                     Delete confirmed stale chunk rows from core DB
  --confirm <token>           Required with --apply; use cleanup-stale-quarantined-chunks

Notes:
  - Default mode is dry-run
  - Only confirmed quarantined legacy mirror root paths are eligible for deletion
  - Apply mode also deletes matching rows from chunks_fts and creates a core DB backup first
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
    apply: false,
    confirm: null,
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

    const mod = await import("../lib/quality/stale-quarantined-chunk-cleanup.js");
    const result = options.apply
      ? mod.applyStaleQuarantinedChunkCleanup(options)
      : mod.auditStaleQuarantinedChunks(options);
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
