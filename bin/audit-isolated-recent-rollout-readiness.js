#!/usr/bin/env node

const { existsSync } = require("node:fs");
const { resolve, isAbsolute } = require("node:path");

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

function resolvePathOrUri(input) {
  if (input.startsWith("file:///") || input.startsWith("file%3A///") || input.startsWith("file%3A%2F%2F%2F")) {
    try {
      const decoded = decodeURIComponent(input);
      const { fileURLToPath } = require("node:url");
      return resolve(fileURLToPath(decoded));
    } catch {
      throw new Error(`Cannot resolve file URI: ${input}`);
    }
  }
  // Relative path or regular absolute path
  return resolve(input);
}

function usage() {
  return `Usage:
  node bin/audit-isolated-recent-rollout-readiness.js [--json] [--out <path>]
      [--core-db <path>] [--engine-db <path>]
      [--query <text>] [--queries-file <path>] [--derive-limit <n>]
      [--include-no-hit-control] [--warmups <n>] [--repetitions <n>]
      [--concurrency-levels 2,4] [--hash-main-files] [--isolated-snapshot]

Notes:
  - This legacy attached-Core rollout comparison tool is retired and fails closed.
  - Use isolated read-only checks for current diagnostics.
  - It never outputs raw queries, IDs, text, paths, timestamps, archived JSON, or memory content.
  - It rejects mutation flags such as --apply, --force, --write-db, --delete, --update, --insert, --repair, --migrate, --no-backup.`;
}

function parseInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} expects a non-negative integer`);
  return parsed;
}

function parseArgs(argv = []) {
  const options = {
    coreDbPath: null,
    engineDbPath: null,
    json: false,
    out: null,
    help: false,
    queries: [],
    queriesFile: null,
    deriveLimit: 24,
    includeNoHitControl: false,
    warmups: 1,
    repetitions: 5,
    concurrencyLevels: [2, 4],
    hashMainFiles: false,
    isolatedSnapshot: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h" || arg === "help") {
      options.help = true;
      continue;
    }
    if (MUTATION_FLAGS.has(arg)) {
      throw new Error(`Isolated Recent rollout readiness audit is read-only; rejected mutation flag: ${arg}`);
    }
    if (arg === "--core-db" || arg === "--core-db-path") {
      options.coreDbPath = readFlagValue(argv, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--engine-db" || arg === "--engine-db-path") {
      options.engineDbPath = readFlagValue(argv, i, arg);
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
    if (arg === "--derive-limit") {
      options.deriveLimit = parseInteger(readFlagValue(argv, i, "--derive-limit"), "--derive-limit");
      i += 1;
      continue;
    }
    if (arg === "--include-no-hit-control") {
      options.includeNoHitControl = true;
      continue;
    }
    if (arg === "--warmups") {
      options.warmups = parseInteger(readFlagValue(argv, i, "--warmups"), "--warmups");
      i += 1;
      continue;
    }
    if (arg === "--repetitions") {
      options.repetitions = parseInteger(readFlagValue(argv, i, "--repetitions"), "--repetitions");
      i += 1;
      continue;
    }
    if (arg === "--concurrency-levels") {
      const raw = readFlagValue(argv, i, "--concurrency-levels");
      options.concurrencyLevels = raw.split(",").map(part => parseInteger(part.trim(), "--concurrency-levels"));
      i += 1;
      continue;
    }
    if (arg === "--hash-main-files") {
      options.hashMainFiles = true;
      continue;
    }
    if (arg === "--isolated-snapshot") {
      options.isolatedSnapshot = true;
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
  if (decisionClass === "pass_canary_readiness") return 0;
  if (decisionClass === "semantic_pass_latency_inconclusive" || decisionClass === "inconclusive") return 2;
  return 1;
}

async function auditIsolatedRecentRolloutReadiness(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage() };
  const { denyLegacyAttachedCore } = await import("../lib/db/legacy-attached-core.js");
  denyLegacyAttachedCore();
}

if (require.main === module) {
  auditIsolatedRecentRolloutReadiness()
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
  auditIsolatedRecentRolloutReadiness,
  exitCodeForDecision,
  parseArgs,
  usage,
};
