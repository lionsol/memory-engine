#!/usr/bin/env node

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { resolve, dirname, join } = require("node:path");
const { execFileSync } = require("node:child_process");

const MUTATION_FLAGS = new Set([
  "--apply",
  "--force",
  "--write-db",
  "--delete",
  "--update",
  "--insert",
  "--repair",
  "--migrate",
]);

function readFlagValue(argv, index, flagName) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flagName} expects a value`);
  return value;
}

function usage() {
  return `Usage:
  node bin/audit-recent-canary-scope-source.js [--json] [--out <path>]

Notes:
  - Recent canary scope audit is static/read-only by default.
  - It does not enable shadow mode, inject providers, access real databases, or modify plugin wiring.
  - It only reports field availability, trust classification, propagation feasibility, and privacy-safe probe summaries.`;
}

function parseArgs(argv = []) {
  const options = {
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
      throw new Error(`Recent canary scope audit is read-only; rejected mutation flag: ${arg}`);
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

function safeExecFileSync(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function detectOpenClawInstall() {
  const whichOpenClaw = safeExecFileSync("which", ["openclaw"]);
  const resolvedEntry = whichOpenClaw
    ? safeExecFileSync("readlink", ["-f", whichOpenClaw]) || whichOpenClaw
    : null;
  const npmGlobalRoot = safeExecFileSync("npm", ["root", "-g"]) || null;
  const packageLine = safeExecFileSync("npm", ["list", "-g", "--depth=0"]);
  const versionMatch = packageLine.match(/openclaw@([0-9A-Za-z._-]+)/);
  let packageVersion = versionMatch ? versionMatch[1] : null;
  let packageName = versionMatch ? "openclaw" : null;

  const candidatePackageJsonPaths = [
    npmGlobalRoot ? join(npmGlobalRoot, "openclaw", "package.json") : null,
    resolvedEntry ? join(dirname(resolvedEntry), "package.json") : null,
  ].filter(Boolean);

  for (const packageJsonPath of candidatePackageJsonPaths) {
    if (packageVersion || !existsSync(packageJsonPath)) continue;
    try {
      const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      if (typeof parsed?.version === "string" && parsed.version.trim()) {
        packageVersion = parsed.version.trim();
        packageName = typeof parsed?.name === "string" && parsed.name.trim()
          ? parsed.name.trim()
          : "openclaw";
      }
    } catch {
      // Ignore fallback parse failures and preserve nulls.
    }
  }

  return {
    which_openclaw: whichOpenClaw || null,
    resolved_entry: resolvedEntry,
    npm_global_root: npmGlobalRoot,
    package_name: packageName,
    package_version: packageVersion,
  };
}

function exitCodeForDecision(decisionClass) {
  if (decisionClass === "pass_trusted_scope_feasibility") return 0;
  if (decisionClass === "partial_scope_feasibility" || decisionClass === "inconclusive") return 3;
  return 2;
}

async function auditRecentCanaryScopeSource(argv = process.argv.slice(2), deps = {}) {
  const options = parseArgs(argv);
  if (options.help) return { exitCode: 0, output: usage() };

  const audit = deps.audit || await import("../lib/recall/hybrid/recent-canary-scope-audit.js");
  const installInfo = deps.installInfo || detectOpenClawInstall();
  const report = deps.report || audit.buildCurrentRecentCanaryScopeAuditReport({
    openclaw_install: installInfo,
    runtime_probe: deps.runtimeProbe || null,
  });
  const output = JSON.stringify(report, null, 2);

  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    if (existsSync(options.out) && !options.out.startsWith("/tmp/")) {
      throw new Error("scope audit report path must be caller-chosen and outside the repository; use /tmp or another scratch path");
    }
    writeFileSync(options.out, output);
  }

  return {
    exitCode: exitCodeForDecision(report.decision.class),
    output,
    report,
  };
}

if (require.main === module) {
  auditRecentCanaryScopeSource()
    .then((result) => {
      if (result.output) process.stdout.write(`${result.output}\n`);
      process.exitCode = result.exitCode;
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 2;
    });
}

module.exports = {
  usage,
  parseArgs,
  detectOpenClawInstall,
  exitCodeForDecision,
  auditRecentCanaryScopeSource,
};
