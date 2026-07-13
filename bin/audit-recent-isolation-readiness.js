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
  node bin/audit-recent-isolation-readiness.js [--json] [--out <path>]
      [--core-db <path>] [--engine-db <path>]

Notes:
  - Recent isolation readiness audit is read-only.
  - It opens Core and Engine through isolated readonly handles.
  - It never outputs raw IDs, chunk text, paths, timestamps, queries, or memory content.
  - It rejects mutation flags such as --apply, --force, --write-db, --delete, --update, --insert, --repair, --migrate, --no-backup.`;
}

function parseArgs(argv = []) {
  const options = {
    coreDbPath: null,
    engineDbPath: null,
    json: false,
    out: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h" || arg === "help") {
      options.help = true;
      continue;
    }
    if (MUTATION_FLAGS.has(arg)) {
      throw new Error(`Recent isolation readiness audit is read-only; rejected mutation flag: ${arg}`);
    }
    if (arg === "--core-db" || arg === "--core-db-path") {
      options.coreDbPath = resolve(readFlagValue(argv, i, arg));
      i += 1;
      continue;
    }
    if (arg === "--engine-db" || arg === "--engine-db-path") {
      options.engineDbPath = resolve(readFlagValue(argv, i, arg));
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
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.json) options.json = true;
  return options;
}

function assertDbExists(path, role) {
  if (!existsSync(path)) throw new Error(`${role} DB does not exist: ${path}`);
}

function exitCodeForDecision(decisionClass) {
  if (decisionClass === "pass_current_snapshot") return 0;
  if (decisionClass === "inconclusive") return 3;
  return 2;
}

async function auditRecentIsolationReadiness(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage() };

  const engineDbMod = deps.engineDbMod || await import("../lib/db/engine-db.js");
  const isolatedDbs = deps.isolatedDbs || await import("../lib/db/isolated-dbs.js");
  const audit = deps.audit || await import("../lib/recall/hybrid/recent-isolation-readiness-audit.js");

  const coreDbPath = options.coreDbPath || engineDbMod.resolveCoreDbPath();
  const engineDbPath = options.engineDbPath || engineDbMod.resolveEngineDbPath();
  assertDbExists(coreDbPath, "Core");
  assertDbExists(engineDbPath, "Engine");

  let coreDb;
  let engineDb;
  try {
    coreDb = isolatedDbs.openCoreDbReadonly({ coreDbPath, engineDbPath });
    engineDb = isolatedDbs.openEngineDbIsolated({ coreDbPath, engineDbPath, readonly: true });
    const report = await audit.runRecentIsolationReadinessAudit({
      coreDb,
      engineDb,
      coreDbPath,
      engineDbPath,
      deterministicRecentOrderComplete: true,
    });
    const output = JSON.stringify(report, null, 2);
    if (options.out) audit.writeRecentIsolationReadinessReport(output, options.out);
    return {
      exitCode: exitCodeForDecision(report.decision.class),
      output,
      report,
    };
  } finally {
    if (coreDb?.open) coreDb.close();
    if (engineDb?.open) engineDb.close();
  }
}

if (require.main === module) {
  auditRecentIsolationReadiness()
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
  auditRecentIsolationReadiness,
  parseArgs,
  usage,
};
