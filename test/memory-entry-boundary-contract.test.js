import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const auditDocPath = resolve(repoRoot, "docs", "memory-entry-boundary-audit.md");

const REQUIRED_INVENTORY = [
  "index.js",
  "lib/tools/register-memory-engine-tools.js",
  "lib/tools/memory-engine-actions.js",
  "lib/services/memory-engine-cli-service.js",
  "bin/memory-engine.js",
  "skills/scripts/memory-engine.js",
  "bin/memory-engine-cli.js",
  "bin/nightly-maintenance.js",
];

const REGISTERED_PRODUCTION_LIKE = [
  ...REQUIRED_INVENTORY,
  "bin/nightly-maintenance-command.cjs",
];

const CANONICAL_RUNTIME_FILES = [
  "index.js",
  "lib/tools/register-memory-engine-tools.js",
  "lib/tools/memory-engine-actions.js",
];

const MAINTENANCE_PREFIXES = [
  "audit-",
  "backfill-",
  "benchmark-",
  "build-",
  "cleanup-",
  "commit-",
  "detect-conflicts",
  "evaluate-",
  "export-",
  "flush-",
  "init-",
  "inspect-",
  "migrate-",
  "migration-",
  "observe-",
  "preview-",
  "probe-",
  "quarantine-",
  "reconcile-",
  "repair-",
  "report-",
  "resolve-",
  "review-",
  "run-",
  "sample-",
  "summarize-",
  "sync-",
  "validate-",
  "v4-",
  "memory-stats",
  "memory-weekly-stats",
  "checkpoint-size-healthcheck",
  "session-checkpoint",
  "static-check",
  "task-classifier",
];

const ACTION_NAMES = ["add", "search", "update", "archive", "status", "diagnose"];

function readRepoFile(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

function assertFileIncludes(relativePath, patterns) {
  const source = readRepoFile(relativePath);
  for (const pattern of patterns) {
    assert.match(source, pattern, `${relativePath} must include ${pattern}`);
  }
}

function assertFileExcludes(relativePath, patterns) {
  const source = readRepoFile(relativePath);
  for (const pattern of patterns) {
    assert.doesNotMatch(source, pattern, `${relativePath} must exclude ${pattern}`);
  }
}

function extractInventoryEntries(markdown) {
  const entries = new Set();
  for (const line of markdown.split("\n")) {
    for (const match of line.matchAll(/`([^`\n]+)`/g)) {
      const value = match[1].trim();
      if (/^(?:index\.js|(?:bin|lib|skills)\/[^`\s]+)$/.test(value)) entries.add(value);
    }
  }
  return entries;
}

function findInventoryRow(markdown, relativePath) {
  return markdown
    .split("\n")
    .find(line => line.includes(`| \`${relativePath}\` |`));
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1")
    .replace(/^\s*#.*$/gm, "");
}

function isNamedMaintenanceUtility(relativePath) {
  const basename = relativePath.split("/").at(-1).replace(/\.(?:cjs|js|py|sh)$/, "");
  return MAINTENANCE_PREFIXES.some(prefix => basename.startsWith(prefix));
}

function exposesProductionActions(relativePath, source) {
  if (isNamedMaintenanceUtility(relativePath)) return false;
  const uncommented = stripComments(source);
  if (!/process\.argv|argv\.slice|sys\.argv|\$\d/.test(uncommented)) return false;
  const actionCount = ACTION_NAMES.filter(action =>
    new RegExp(`(?:['"]|\\b)${action}(?:['"]|\\b)`, "i").test(uncommented),
  ).length;
  return actionCount >= 3;
}

function listCandidateFiles(relativeDir) {
  const absoluteDir = resolve(repoRoot, relativeDir);
  return readdirSync(absoluteDir)
    .map(name => `${relativeDir}/${name}`)
    .filter(relativePath => statSync(resolve(repoRoot, relativePath)).isFile());
}

test("entrypoint inventory is complete", () => {
  assert.equal(existsSync(auditDocPath), true, "missing entry boundary audit document");
  const inventory = extractInventoryEntries(readFileSync(auditDocPath, "utf8"));
  for (const entry of REQUIRED_INVENTORY) {
    assert.equal(inventory.has(entry), true, `audit document must register ${entry}`);
  }
});

test("canonical runtime does not hard-code the Core DB path", () => {
  for (const relativePath of CANONICAL_RUNTIME_FILES) {
    assertFileExcludes(relativePath, [/\.openclaw\/memory\/main\.sqlite/]);
  }
});

test("tool registration remains declarative", () => {
  const source = readRepoFile("lib/tools/register-memory-engine-tools.js");
  for (const toolName of ["memory_engine", "memory_engine_search", "memory_engine_get"]) {
    assert.match(source, new RegExp(String.raw`name:\s*["']${toolName}["']`));
  }
  assertFileExcludes("lib/tools/register-memory-engine-tools.js", [
    /better-sqlite3/,
    /ATTACH DATABASE/i,
    /main\.sqlite/,
  ]);
});

test("legacy entrypoints are documented as compatibility shims", () => {
  const audit = readFileSync(auditDocPath, "utf8");
  for (const relativePath of ["bin/memory-engine.js", "skills/scripts/memory-engine.js"]) {
    assert.equal(existsSync(resolve(repoRoot, relativePath)), true, `missing ${relativePath}`);
    const row = findInventoryRow(audit, relativePath);
    assert.ok(row, `audit must inventory ${relativePath}`);
    assert.match(row, /legacy compatibility shim/);
    assert.doesNotMatch(row, /unsafe legacy/);
  }
  assert.match(audit, /P1-A Step 3 removed the duplicated business implementations/);
  assert.match(audit, /Both now directly invoke `bin\/memory-engine-cli\.js`/);
  assert.match(audit, /The canonical runtime action layer for the plugin is:/);
});

test("new production-like entrypoints must be inventoried", () => {
  const audit = readFileSync(auditDocPath, "utf8");
  const inventory = extractInventoryEntries(audit);
  const candidateFiles = [
    ...listCandidateFiles("bin"),
    ...listCandidateFiles("skills/scripts"),
  ];
  const productionLike = candidateFiles.filter(relativePath => {
    const basename = relativePath.split("/").at(-1);
    if (/memory-engine|nightly-maintenance/i.test(basename)) return true;
    return exposesProductionActions(relativePath, readRepoFile(relativePath));
  });
  const unregistered = productionLike.filter(relativePath => !inventory.has(relativePath));
  assert.deepEqual(unregistered, [], `unregistered production-like entrypoints: ${unregistered.join(", ")}`);
  for (const relativePath of REGISTERED_PRODUCTION_LIKE) {
    assert.equal(inventory.has(relativePath), true, `registered production-like entrypoint missing: ${relativePath}`);
  }
});

test("canonical runtime uniqueness is stated without promoting the transitional CLI", () => {
  const audit = readFileSync(auditDocPath, "utf8");
  assert.match(audit, /`lib\/tools\/memory-engine-actions\.js` is the unique canonical action layer/);
  assert.match(audit, /`bin\/memory-engine-cli\.js` is not declared canonical/);
  assert.match(audit, /transitional\/admin adapter/);
  assert.match(audit, /service-backed/);
});

test("CLI service boundary is documented and reuses canonical actions", () => {
  const audit = readFileSync(auditDocPath, "utf8");
  assert.match(audit, /`lib\/services\/memory-engine-cli-service\.js` \| CLI service boundary/);
  assert.match(audit, /maps CLI commands to action parameters/i);
  assert.match(audit, /delegates execution to `lib\/tools\/memory-engine-actions\.js`/);
  assert.match(audit, /does not copy action SQL/i);
});

test("default CLI DB tests require explicit real-data opt-in", () => {
  const source = readRepoFile("test/memory-engine-cli.test.js");
  assert.match(source, /MEMORY_ENGINE_RUN_REAL_DB_TESTS/);
  assert.match(source, /const realDbTest = runRealDbTests \? test : test\.skip/);
  assert.match(source, /realDbTest\("CLI status command succeeds with real engine DB"/);
  assert.match(source, /realDbTest\("CLI search command works with real DB"/);
});

test("legacy fallback contract is fail-closed", () => {
  const audit = readFileSync(auditDocPath, "utf8");
  assert.match(audit, /canonical entrypoint is missing, the caller must fail closed/i);
  assert.match(audit, /must not silently fall back to an old business implementation/i);
  assert.match(audit, /legacy shim must not copy business logic/i);
});
