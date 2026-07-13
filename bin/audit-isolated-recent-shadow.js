#!/usr/bin/env node

const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const MUTATION_FLAGS = new Set([
  "--apply",
  "--force",
  "--write-db",
  "--delete",
  "--update",
  "--insert",
  "--repair",
  "--migrate",
  "--no-backup",
]);

function readFlagValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flagName} expects a value`);
  return value;
}

function usage() {
  return `Usage:
  node bin/audit-isolated-recent-shadow.js [--json] [--out <path>]
      [--core-db <path>] [--engine-db <path>]
      [--query <text>] [--queries-file <path>] [--derive-limit <n>]

Notes:
  - Isolated Recent shadow audit is read-only.
  - It compares legacy Recent and guarded isolated Recent on the same DB snapshot.
  - It rejects mutation flags such as --apply, --force, --write-db, --delete, --update, --insert, --repair, --migrate, --no-backup.
  - It never outputs raw queries, IDs, paths, text, timestamps, archived JSON, or memory content.`;
}

function parseArgs(argv = []) {
  const options = {
    coreDbPath: null,
    engineDbPath: null,
    queries: [],
    queriesFile: null,
    deriveLimit: 12,
    json: false,
    out: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h" || arg === "help") {
      options.help = true;
      continue;
    }
    if (MUTATION_FLAGS.has(arg)) {
      throw new Error(`Isolated Recent shadow audit is read-only; rejected mutation flag: ${arg}`);
    }
    if (arg === "--core-db" || arg === "--core-db-path") {
      options.coreDbPath = resolve(readFlagValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--engine-db" || arg === "--engine-db-path") {
      options.engineDbPath = resolve(readFlagValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--query") {
      options.queries.push(readFlagValue(argv, index, "--query"));
      index += 1;
      continue;
    }
    if (arg === "--queries-file") {
      options.queriesFile = resolve(readFlagValue(argv, index, "--queries-file"));
      index += 1;
      continue;
    }
    if (arg === "--derive-limit") {
      const value = Number(readFlagValue(argv, index, "--derive-limit"));
      if (!Number.isInteger(value) || value < 1 || value > 1000) {
        throw new Error("--derive-limit must be an integer between 1 and 1000");
      }
      options.deriveLimit = value;
      index += 1;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--out") {
      options.out = resolve(readFlagValue(argv, index, "--out"));
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!options.json) options.json = true;
  return options;
}

function assertDbExists(path, role) {
  if (!existsSync(path)) throw new Error(`${role} DB does not exist: ${path}`);
}

function exitCodeForDecision(decisionClass) {
  if (decisionClass === "pass" || decisionClass === "guarded_only") return 0;
  if (decisionClass === "inconclusive") return 3;
  return 2;
}

function withResolvedEnvPaths(coreDbPath, engineDbPath, run) {
  const previous = {
    CORE_DB_PATH: process.env.CORE_DB_PATH,
    ENGINE_DB_PATH: process.env.ENGINE_DB_PATH,
  };
  process.env.CORE_DB_PATH = coreDbPath;
  process.env.ENGINE_DB_PATH = engineDbPath;
  try {
    return run();
  } finally {
    if (previous.CORE_DB_PATH == null) delete process.env.CORE_DB_PATH;
    else process.env.CORE_DB_PATH = previous.CORE_DB_PATH;
    if (previous.ENGINE_DB_PATH == null) delete process.env.ENGINE_DB_PATH;
    else process.env.ENGINE_DB_PATH = previous.ENGINE_DB_PATH;
  }
}

async function auditIsolatedRecentShadow(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage() };

  const engineDbMod = deps.engineDbMod || await import("../lib/db/engine-db.js");
  const isolatedDbs = deps.isolatedDbs || await import("../lib/db/isolated-dbs.js");
  const audit = deps.audit || await import("../lib/recall/hybrid/recent-shadow-audit.js");

  const coreDbPath = options.coreDbPath || engineDbMod.resolveCoreDbPath();
  const engineDbPath = options.engineDbPath || engineDbMod.resolveEngineDbPath();
  assertDbExists(coreDbPath, "Core");
  assertDbExists(engineDbPath, "Engine");

  let legacyDb;
  let isolatedCoreDb;
  let isolatedEngineDb;
  try {
    legacyDb = withResolvedEnvPaths(coreDbPath, engineDbPath, () => engineDbMod.openEngineDb({
      readonly: true,
    }));
    isolatedCoreDb = isolatedDbs.openCoreDbReadonly({ coreDbPath, engineDbPath });
    isolatedEngineDb = isolatedDbs.openEngineDbIsolated({ coreDbPath, engineDbPath, readonly: true });
    const report = await audit.runRecentShadowAudit({
      legacyDb,
      isolatedCoreDb,
      isolatedEngineDb,
      coreDbPath,
      engineDbPath,
      queries: options.queries,
      queriesFile: options.queriesFile,
      deriveLimit: options.deriveLimit,
      includeNoHitControl: true,
    });
    const output = JSON.stringify(report, null, 2);
    if (options.out) audit.writeRecentShadowReport(output, options.out);
    return {
      exitCode: exitCodeForDecision(report.decision.class),
      output,
      report,
    };
  } finally {
    if (legacyDb?.open) legacyDb.close();
    if (isolatedCoreDb?.open) isolatedCoreDb.close();
    if (isolatedEngineDb?.open) isolatedEngineDb.close();
  }
}

if (require.main === module) {
  auditIsolatedRecentShadow()
    .then(result => {
      if (result.output) process.stdout.write(`${result.output}\n`);
      process.exit(result.exitCode);
    })
    .catch(error => {
      process.stderr.write(`${error.message || error}\n`);
      process.exit(1);
    });
}

module.exports = {
  auditIsolatedRecentShadow,
  parseArgs,
  usage,
};
