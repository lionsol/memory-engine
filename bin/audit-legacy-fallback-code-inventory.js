#!/usr/bin/env node

const {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} = require("node:fs");
const { basename, resolve } = require("node:path");

function readFlagValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flagName} expects a value`);
  return value;
}

function parseArgs(argv = []) {
  const options = { root: process.cwd(), pretty: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--pretty") options.pretty = true;
    else if (arg === "--root") {
      options.root = readFlagValue(argv, index, arg);
      index += 1;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return `Usage:
  node bin/audit-legacy-fallback-code-inventory.js
      [--root <repository-root>] [--pretty]

This command performs a read-only static inventory inside the memory-engine repository. It never opens a database or modifies source files.`;
}

function readPackageName(rootDir) {
  try {
    const packageJson = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));
    return packageJson?.name;
  } catch {
    return null;
  }
}

function assertSafeRepositoryRoot(inputRoot) {
  const requestedRoot = resolve(inputRoot);
  if (!existsSync(requestedRoot) || !lstatSync(requestedRoot).isDirectory()) {
    throw new Error(`invalid inventory root: ${inputRoot}`);
  }
  const rootDir = realpathSync(requestedRoot);
  const gitPath = resolve(rootDir, ".git");
  if (!existsSync(gitPath)) throw new Error("inventory root must contain .git");
  if (readPackageName(rootDir) !== "memory-engine-plugin") {
    throw new Error("inventory root is not the memory-engine repository");
  }
  if (["", "/", ".openclaw", "workspace", "home"].includes(basename(rootDir))) {
    throw new Error("inventory root is too broad");
  }
  if (requestedRoot !== rootDir) throw new Error("inventory root symlink is not allowed");
  return rootDir;
}

function exitCodeForReport(report) {
  if (!report.inventory_complete) return 2;
  if (report.known_dynamic_references > 0) return 1;
  return 0;
}

async function auditLegacyFallbackCodeInventory(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage() };
  const rootDir = assertSafeRepositoryRoot(options.root);
  const {
    buildLegacyFallbackCodeInventory,
    collectLegacyFallbackInventoryFiles,
  } = await import("../lib/recall/hybrid/legacy-fallback-code-inventory.js");
  const { fileEntries } = collectLegacyFallbackInventoryFiles({ rootDir });
  const report = buildLegacyFallbackCodeInventory({ rootDir, fileEntries });
  return {
    exitCode: exitCodeForReport(report),
    output: JSON.stringify(report, null, options.pretty ? 2 : 0),
    report,
  };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await auditLegacyFallbackCodeInventory(argv);
    process.stdout.write(`${result.output}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 3;
  }
}

if (require.main === module) main();

module.exports = {
  assertSafeRepositoryRoot,
  auditLegacyFallbackCodeInventory,
  exitCodeForReport,
  parseArgs,
  usage,
};
