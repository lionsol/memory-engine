import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  auditRecentIsolationReadiness,
  parseArgs,
  usage,
} = require("../bin/audit-recent-isolation-readiness.js");

function createFixtureRoot() {
  return mkdtempSync(join(tmpdir(), "memory-engine-recent-readiness-cli-"));
}

function createFixture(root, { blobEngine = false } = {}) {
  const coreDbPath = join(root, "core.sqlite");
  const engineDbPath = join(root, "engine.sqlite");
  const core = new Database(coreDbPath);
  core.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      text TEXT,
      path TEXT,
      updated_at INTEGER
    );
  `);
  core.prepare("INSERT INTO chunks VALUES (?, ?, ?, ?)")
    .run("cli-secret-id", "cli secret text", "memory/smart-add/cli-secret-path.md", 1000);
  core.close();

  const engine = new Database(engineDbPath);
  engine.exec(`
    CREATE TABLE memory_confidence (
      chunk_id TEXT PRIMARY KEY,
      confidence REAL,
      last_confidence_update INTEGER,
      base_tau REAL,
      hit_count INTEGER,
      is_protected INTEGER,
      conflict_flag INTEGER,
      category TEXT,
      is_archived INTEGER,
      kg_data TEXT
    );
  `);
  engine.prepare("INSERT INTO memory_confidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(blobEngine ? Buffer.from("cli-secret-id") : "cli-secret-id", 0.82, 0, 7, 3, 0, 0, "raw_log", 0, "secret kg");
  engine.close();
  return { coreDbPath, engineDbPath };
}

test("CLI help, parser, default resolver injection, and mutation flag rejection", async () => {
  assert.equal(usage().includes("read-only"), true);
  assert.deepEqual(parseArgs(["--json", "--core-db", "core.sqlite", "--engine-db", "engine.sqlite"]).json, true);
  const help = await auditRecentIsolationReadiness(["--help"]);
  assert.equal(help.exitCode, 0);
  assert.equal(help.output.includes("Usage:"), true);

  for (const flag of ["--apply", "--force", "--write-db", "--delete", "--update", "--insert", "--repair", "--migrate", "--no-backup"]) {
    await assert.rejects(
      auditRecentIsolationReadiness([flag]),
      error => String(error.message || error).includes("Recent isolation readiness audit is read-only"),
      flag,
    );
  }

  const root = createFixtureRoot();
  try {
    const { coreDbPath, engineDbPath } = createFixture(root);
    const result = await auditRecentIsolationReadiness([], {
      engineDbMod: {
        resolveCoreDbPath: () => coreDbPath,
        resolveEngineDbPath: () => engineDbPath,
      },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.report.decision.class, "pass_current_snapshot");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI writes JSON output, keeps report out of repo by caller path, and redacts sensitive fixture values", async () => {
  const root = createFixtureRoot();
  try {
    const { coreDbPath, engineDbPath } = createFixture(root);
    const outPath = join(root, "recent-readiness-report.json");
    const result = await auditRecentIsolationReadiness([
      "--json",
      "--out", outPath,
      "--core-db", coreDbPath,
      "--engine-db", engineDbPath,
    ]);
    assert.equal(result.exitCode, 0);
    assert.equal(existsSync(outPath), true);
    const report = JSON.parse(readFileSync(outPath, "utf8"));
    assert.deepEqual(report.decision, result.report.decision);
    const json = JSON.stringify(report);
    for (const secret of [
      "cli-secret-id",
      "cli secret text",
      "cli-secret-path.md",
      "1000",
      "secret kg",
    ]) {
      assert.equal(json.includes(secret), false, secret);
    }
    assert.equal(json.includes("storage_classes"), true);
    assert.equal(json.includes("pass_current_snapshot"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI exit codes map runtime errors, non-TEXT failures, and inconclusive decisions", async () => {
  const failRoot = createFixtureRoot();
  try {
    const { coreDbPath, engineDbPath } = createFixture(failRoot, { blobEngine: true });
    const fail = await auditRecentIsolationReadiness([
      "--core-db", coreDbPath,
      "--engine-db", engineDbPath,
    ]);
    assert.equal(fail.exitCode, 2);
    assert.equal(fail.report.decision.class, "fail_non_text_ids");
  } finally {
    rmSync(failRoot, { recursive: true, force: true });
  }

  await assert.rejects(
    auditRecentIsolationReadiness(["--core-db", "/does/not/exist", "--engine-db", "/also/missing"]),
    error => String(error.message || error).includes("DB does not exist"),
  );

  const inconclusiveRoot = createFixtureRoot();
  try {
    const { coreDbPath, engineDbPath } = createFixture(inconclusiveRoot);
    const inconclusive = await auditRecentIsolationReadiness([
      "--core-db", coreDbPath,
      "--engine-db", engineDbPath,
    ], {
      audit: {
        runRecentIsolationReadinessAudit: async () => ({
          decision: { class: "inconclusive", reason: "database_changed_during_audit" },
        }),
        writeRecentIsolationReadinessReport: () => {},
      },
    });
    assert.equal(inconclusive.exitCode, 3);
    assert.equal(inconclusive.report.decision.class, "inconclusive");
  } finally {
    rmSync(inconclusiveRoot, { recursive: true, force: true });
  }
});
