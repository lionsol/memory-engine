#!/usr/bin/env node

const { resolve } = require("node:path");

const MUTATION_FLAGS = new Set(["--apply", "--force", "--write-db", "--delete", "--update", "--insert", "--no-backup"]);

function readFlagValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flagName} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const options = {
    queries: [],
    queriesFile: null,
    deriveFromKg: 0,
    includeNoHitControl: false,
    topK: 20,
    likePatternTopN: 8,
    minConfidence: 0.15,
    json: false,
    out: null,
    help: false,
    coreDbPath: null,
    engineDbPath: null,
    argv,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h" || arg === "help") {
      options.help = true;
      continue;
    }
    if (MUTATION_FLAGS.has(arg)) {
      throw new Error(`read-only audit rejects mutation flag: ${arg}`);
    }
    if (arg === "--query") {
      options.queries.push(readFlagValue(argv, i, "--query"));
      i += 1;
      continue;
    }
    if (arg === "--queries-file") {
      options.queriesFile = resolve(readFlagValue(argv, i, "--queries-file"));
      i += 1;
      continue;
    }
    if (arg === "--derive-from-kg") {
      options.deriveFromKg = Number.parseInt(readFlagValue(argv, i, "--derive-from-kg"), 10);
      i += 1;
      continue;
    }
    if (arg === "--include-no-hit-control") {
      options.includeNoHitControl = true;
      continue;
    }
    if (arg === "--top-k") {
      options.topK = Number.parseInt(readFlagValue(argv, i, "--top-k"), 10);
      i += 1;
      continue;
    }
    if (arg === "--like-pattern-top-n") {
      options.likePatternTopN = Number.parseInt(readFlagValue(argv, i, "--like-pattern-top-n"), 10);
      i += 1;
      continue;
    }
    if (arg === "--min-confidence") {
      options.minConfidence = Number.parseFloat(readFlagValue(argv, i, "--min-confidence"));
      i += 1;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--out") {
      options.out = resolve(readFlagValue(argv, i, "--out"));
      i += 1;
      continue;
    }
    if (arg === "--core-db-path") {
      options.coreDbPath = resolve(readFlagValue(argv, i, "--core-db-path"));
      i += 1;
      continue;
    }
    if (arg === "--engine-db-path") {
      options.engineDbPath = resolve(readFlagValue(argv, i, "--engine-db-path"));
      i += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.json) options.json = true;
  return options;
}

function usage() {
  return `Usage:
  node bin/audit-isolated-kg-shadow.js --query <text> [--query <text> ...]
  node bin/audit-isolated-kg-shadow.js --queries-file <path>
  node bin/audit-isolated-kg-shadow.js --derive-from-kg <N> [--include-no-hit-control]
      [--top-k <1..1000>] [--like-pattern-top-n <1..100>] [--min-confidence <0..1>]
      [--json] [--out <path>]
      [--core-db-path <path>] [--engine-db-path <path>]

Notes:
  - This tool is a read-only audit harness and never enables production isolatedKg.
  - It compares legacy KG against guarded isolated KG on the same query corpus.
  - It never outputs raw query text, chunk text, paths, kg_data, or raw IDs.
  - It rejects mutation flags such as --apply, --force, --write-db, --delete, --update, --insert, --no-backup.`;
}

function withEnvOverride(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function auditIsolatedKgShadow(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    return { exitCode: 0, output: usage() };
  }

  const engineDb = await import("../lib/db/engine-db.js");
  const isolatedDbs = await import("../lib/db/isolated-dbs.js");
  const audit = await import("../lib/recall/hybrid/kg-shadow-audit.js");

  const coreDbPath = options.coreDbPath || engineDb.resolveCoreDbPath();
  const engineDbPath = options.engineDbPath || engineDb.resolveEngineDbPath();
  audit.validateShadowAuditOptions({ ...options, coreDbPath, engineDbPath });
  audit.assertShadowAuditPathsExist({ coreDbPath, engineDbPath });

  let legacyDb;
  let isolatedEngineDb;
  let isolatedCoreDb;
  try {
    legacyDb = withEnvOverride({
      CORE_DB_PATH: coreDbPath,
      ENGINE_DB_PATH: engineDbPath,
    }, () => engineDb.openEngineDb({ readonly: true }));
    isolatedEngineDb = isolatedDbs.openEngineDbIsolated({ readonly: true, engineDbPath, coreDbPath });
    isolatedCoreDb = isolatedDbs.openCoreDbReadonly({ coreDbPath, engineDbPath });

    const report = await audit.runKgShadowAudit({
      legacyDb,
      isolatedEngineDb,
      isolatedCoreDb,
      coreDbPath,
      engineDbPath,
      queries: options.queries,
      queriesFile: options.queriesFile,
      deriveFromKg: options.deriveFromKg,
      includeNoHitControl: options.includeNoHitControl,
      topK: options.topK,
      likePatternTopN: options.likePatternTopN,
      minConfidence: options.minConfidence,
    });
    const output = JSON.stringify(report, null, 2);
    if (options.out) audit.writeShadowAuditReport(output, options.out);

    let exitCode = 0;
    if (report.decision.class === "fail") exitCode = 2;
    else if (report.decision.class === "inconclusive") exitCode = 3;

    return { exitCode, output, report };
  } finally {
    if (legacyDb?.open) legacyDb.close();
    if (isolatedEngineDb?.open) isolatedEngineDb.close();
    if (isolatedCoreDb?.open) isolatedCoreDb.close();
  }
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await auditIsolatedKgShadow(argv);
    const stream = result.exitCode === 0 ? process.stdout : process.stderr;
    stream.write(`${result.output}\n`);
    process.exit(result.exitCode);
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  auditIsolatedKgShadow,
  parseArgs,
  usage,
};
