import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  auditIsolatedRecentRolloutReadiness,
  exitCodeForDecision,
  parseArgs,
  usage,
} = require("../bin/audit-isolated-recent-rollout-readiness.js");

function createFixtureRoot() {
  return mkdtempSync(join(tmpdir(), "memory-engine-recent-rollout-cli-"));
}

function createFixture(root) {
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
    .run("cli-secret-id", 0.82, 0, 7, 3, 0, 0, "raw_log", 0, "secret kg");
  engine.close();
  return { coreDbPath, engineDbPath };
}

async function backupDatabase(sourcePath, destPath) {
  const source = new Database(sourcePath, { readonly: true });
  try {
    await source.backup(destPath);
  } finally {
    source.close();
  }
}

test("CLI help, parser, exit codes, and mutation flag rejection", async () => {
  assert.equal(usage().includes("read-only"), true);
  assert.equal(usage().includes("--isolated-snapshot"), true);
  assert.equal(parseArgs(["--query", "alpha", "--json"]).queries[0], "alpha");
  assert.equal(parseArgs(["--hash-main-files"]).hashMainFiles, true);
  assert.equal(parseArgs(["--isolated-snapshot"]).isolatedSnapshot, true);
  assert.equal(exitCodeForDecision("pass_canary_readiness"), 0);
  assert.equal(exitCodeForDecision("semantic_pass_latency_inconclusive"), 2);
  assert.equal(exitCodeForDecision("fail"), 1);
  const help = await auditIsolatedRecentRolloutReadiness(["--help"]);
  assert.equal(help.exitCode, 0);
  assert.equal(help.output.includes("Usage:"), true);

  for (const flag of ["--apply", "--force", "--write-db", "--delete", "--update", "--insert", "--repair", "--migrate", "--no-backup"]) {
    await assert.rejects(
      auditIsolatedRecentRolloutReadiness([flag]),
      error => String(error.message || error).includes("read-only"),
      flag,
    );
  }
});

test("CLI writes JSON report to caller path and keeps secrets out of output", async () => {
  const root = createFixtureRoot();
  try {
    const { coreDbPath, engineDbPath } = createFixture(root);
    const outPath = join(root, "rollout-readiness.json");
    const result = await auditIsolatedRecentRolloutReadiness([
      "--json",
      "--out", outPath,
      "--core-db", coreDbPath,
      "--engine-db", engineDbPath,
      "--query", "alpha",
      "--include-no-hit-control",
      "--warmups", "0",
      "--repetitions", "1",
    ], {
      audit: {
        runRecentRolloutReadinessAudit: async () => ({
          report_schema_version: 2,
          decision: { class: "pass_canary_readiness", reason: "ok" },
          privacy_validation: { passed: true, checked_value_count: 4, leak_count: 0 },
          query_corpus: { final_unique_query_count: 2 },
          database_stability: {
            stable: true,
            logical_database_stable: true,
            sidecar_activity_class: "none",
          },
        }),
        writeRecentRolloutReadinessReport: (output, path) => require("node:fs").writeFileSync(path, output),
      },
      engineDbMod: {
        openEngineDb: () => ({ open: true, readonly: true, close() {} }),
      },
      isolatedDbs: {
        openCoreDbReadonly: () => ({ open: true, readonly: true, close() {} }),
        openEngineDbIsolated: () => ({ open: true, readonly: true, close() {} }),
      },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(existsSync(outPath), true);
    const json = readFileSync(outPath, "utf8");
    assert.equal(json.includes("cli-secret-id"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI maps inconclusive and fail decisions, and rejects missing DBs", async () => {
  const root = createFixtureRoot();
  try {
    const { coreDbPath, engineDbPath } = createFixture(root);
    const inconclusive = await auditIsolatedRecentRolloutReadiness([
      "--core-db", coreDbPath,
      "--engine-db", engineDbPath,
      "--query", "alpha",
    ], {
      audit: {
        runRecentRolloutReadinessAudit: async () => ({
          report_schema_version: 2,
          decision: { class: "semantic_pass_latency_inconclusive", reason: "latency" },
          privacy_validation: { passed: true, checked_value_count: 1, leak_count: 0 },
        }),
        writeRecentRolloutReadinessReport: () => {},
      },
      engineDbMod: {
        openEngineDb: () => ({ open: true, readonly: true, close() {} }),
      },
      isolatedDbs: {
        openCoreDbReadonly: () => ({ open: true, readonly: true, close() {} }),
        openEngineDbIsolated: () => ({ open: true, readonly: true, close() {} }),
      },
    });
    assert.equal(inconclusive.exitCode, 2);

    const failed = await auditIsolatedRecentRolloutReadiness([
      "--core-db", coreDbPath,
      "--engine-db", engineDbPath,
      "--query", "alpha",
    ], {
      audit: {
        runRecentRolloutReadinessAudit: async () => ({
          report_schema_version: 2,
          decision: { class: "fail", reason: "recent_error" },
          privacy_validation: { passed: true, checked_value_count: 1, leak_count: 0 },
        }),
        writeRecentRolloutReadinessReport: () => {},
      },
      engineDbMod: {
        openEngineDb: () => ({ open: true, readonly: true, close() {} }),
      },
      isolatedDbs: {
        openCoreDbReadonly: () => ({ open: true, readonly: true, close() {} }),
        openEngineDbIsolated: () => ({ open: true, readonly: true, close() {} }),
      },
    });
    assert.equal(failed.exitCode, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  await assert.rejects(
    auditIsolatedRecentRolloutReadiness([
      "--core-db", "/does/not/exist",
      "--engine-db", "/also/missing",
      "--query", "alpha",
    ]),
    error => String(error.message || error).includes("DB does not exist"),
  );
});

test("CLI rejects isolated snapshot for live-identity inputs and allows independent copies", async () => {
  const root = createFixtureRoot();
  try {
    const { coreDbPath, engineDbPath } = createFixture(root);

    // Symlink pointing to default should be rejected
    const symCore = join(root, "sym-core.sqlite");
    const symEngine = join(root, "sym-engine.sqlite");
    const { symlinkSync } = require("node:fs");
    symlinkSync(coreDbPath, symCore);
    symlinkSync(engineDbPath, symEngine);
    await assert.rejects(
      auditIsolatedRecentRolloutReadiness([
        "--core-db", symCore,
        "--engine-db", symEngine,
        "--isolated-snapshot",
        "--query", "alpha",
      ], {
        engineDbMod: {
          resolveCoreDbPath: () => coreDbPath,
          resolveEngineDbPath: () => engineDbPath,
          openEngineDb: () => ({ open: true, readonly: true, close() {} }),
        },
        isolatedDbs: {
          openCoreDbReadonly: () => ({ open: true, readonly: true, close() {} }),
          openEngineDbIsolated: () => ({ open: true, readonly: true, close() {} }),
        },
        audit: {
          runRecentRolloutReadinessAudit: async () => ({ decision: { class: "pass_canary_readiness" } }),
          writeRecentRolloutReadinessReport: () => {},
        },
      }),
      error => String(error.message || error).includes("--isolated-snapshot rejected"),
      "symlink",
    );

    // Hardlink pointing to default should be rejected
    const hardCore = join(root, "hard-core.sqlite");
    const hardEngine = join(root, "hard-engine.sqlite");
    const { linkSync } = require("node:fs");
    linkSync(coreDbPath, hardCore);
    linkSync(engineDbPath, hardEngine);
    await assert.rejects(
      auditIsolatedRecentRolloutReadiness([
        "--core-db", hardCore,
        "--engine-db", hardEngine,
        "--isolated-snapshot",
        "--query", "alpha",
      ], {
        engineDbMod: {
          resolveCoreDbPath: () => coreDbPath,
          resolveEngineDbPath: () => engineDbPath,
          openEngineDb: () => ({ open: true, readonly: true, close() {} }),
        },
        isolatedDbs: {
          openCoreDbReadonly: () => ({ open: true, readonly: true, close() {} }),
          openEngineDbIsolated: () => ({ open: true, readonly: true, close() {} }),
        },
        audit: {
          runRecentRolloutReadinessAudit: async () => ({ decision: { class: "pass_canary_readiness" } }),
          writeRecentRolloutReadinessReport: () => {},
        },
      }),
      error => String(error.message || error).includes("--isolated-snapshot rejected"),
      "hardlink",
    );

    // file:// URI pointing to default should be rejected
    const coreUri = `file://${coreDbPath}`;
    const engineUri = `file://${engineDbPath}`;
    await assert.rejects(
      auditIsolatedRecentRolloutReadiness([
        "--core-db", coreUri,
        "--engine-db", engineUri,
        "--isolated-snapshot",
        "--query", "alpha",
      ], {
        engineDbMod: {
          resolveCoreDbPath: () => coreDbPath,
          resolveEngineDbPath: () => engineDbPath,
          openEngineDb: () => ({ open: true, readonly: true, close() {} }),
        },
        isolatedDbs: {
          openCoreDbReadonly: () => ({ open: true, readonly: true, close() {} }),
          openEngineDbIsolated: () => ({ open: true, readonly: true, close() {} }),
        },
        audit: {
          runRecentRolloutReadinessAudit: async () => ({ decision: { class: "pass_canary_readiness" } }),
          writeRecentRolloutReadinessReport: () => {},
        },
      }),
      error => String(error.message || error).includes("file_uri_not_allowed"),
      "file URI",
    );

    const encodedCoreUri = encodeURIComponent(`file://${coreDbPath}`);
    const encodedEngineUri = encodeURIComponent(`file://${engineDbPath}`);
    await assert.rejects(
      auditIsolatedRecentRolloutReadiness([
        "--core-db", encodedCoreUri,
        "--engine-db", encodedEngineUri,
        "--isolated-snapshot",
        "--query", "alpha",
      ], {
        engineDbMod: {
          resolveCoreDbPath: () => coreDbPath,
          resolveEngineDbPath: () => engineDbPath,
          openEngineDb: () => ({ open: true, readonly: true, close() {} }),
        },
        isolatedDbs: {
          openCoreDbReadonly: () => ({ open: true, readonly: true, close() {} }),
          openEngineDbIsolated: () => ({ open: true, readonly: true, close() {} }),
        },
        audit: {
          runRecentRolloutReadinessAudit: async () => ({ decision: { class: "pass_canary_readiness" } }),
          writeRecentRolloutReadinessReport: () => {},
        },
      }),
      error => String(error.message || error).includes("encoded_file_uri_not_allowed"),
      "encoded file URI",
    );

    const copyCore = join(root, "copy-core.sqlite");
    const copyEngine = join(root, "copy-engine.sqlite");
    await backupDatabase(coreDbPath, copyCore);
    await backupDatabase(engineDbPath, copyEngine);
    const backupResult = await auditIsolatedRecentRolloutReadiness([
      "--core-db", copyCore,
      "--engine-db", copyEngine,
      "--isolated-snapshot",
      "--query", "alpha",
    ], {
      engineDbMod: {
        resolveCoreDbPath: () => coreDbPath,
        resolveEngineDbPath: () => engineDbPath,
        openEngineDb: () => ({ open: true, readonly: true, close() {} }),
      },
      isolatedDbs: {
        openCoreDbReadonly: () => ({ open: true, readonly: true, close() {} }),
        openEngineDbIsolated: () => ({ open: true, readonly: true, close() {} }),
      },
      audit: {
        runRecentRolloutReadinessAudit: async () => ({
          report_schema_version: 2,
          decision: { class: "pass_canary_readiness", reason: "ok" },
          privacy_validation: { passed: true, checked_value_count: 1, leak_count: 0 },
          snapshot_context: {
            requested: true,
            verified_non_live_identity: true,
            database_open_mode: "readonly",
            sqlite_immutable: false,
            expected_external_writer: false,
            creation_method_claim: "sqlite_backup_api",
            creation_method_verified: false,
          },
        }),
        writeRecentRolloutReadinessReport: () => {},
      },
    });
    assert.equal(backupResult.exitCode, 0, "Independent backup copy should be allowed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI rejects isolated snapshot on default resolved DB paths", async () => {
  const root = createFixtureRoot();
  try {
    const { coreDbPath, engineDbPath } = createFixture(root);
    await assert.rejects(
      auditIsolatedRecentRolloutReadiness([
        "--core-db", coreDbPath,
        "--engine-db", engineDbPath,
        "--isolated-snapshot",
        "--query", "alpha",
      ], {
        engineDbMod: {
          resolveCoreDbPath: () => coreDbPath,
          resolveEngineDbPath: () => engineDbPath,
          openEngineDb: () => ({ open: true, readonly: true, close() {} }),
        },
        isolatedDbs: {
          openCoreDbReadonly: () => ({ open: true, readonly: true, close() {} }),
          openEngineDbIsolated: () => ({ open: true, readonly: true, close() {} }),
        },
        audit: {
          runRecentRolloutReadinessAudit: async () => ({ decision: { class: "pass_canary_readiness" } }),
          writeRecentRolloutReadinessReport: () => {},
        },
      }),
      error => String(error.message || error).includes("identity-distinct from the default databases"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI passes isolated snapshot verification into audit without changing readonly open flags", async () => {
  const root = createFixtureRoot();
  try {
    const { coreDbPath, engineDbPath } = createFixture(root);
    const copyCore = join(root, "copy-core.sqlite");
    const copyEngine = join(root, "copy-engine.sqlite");
    await backupDatabase(coreDbPath, copyCore);
    await backupDatabase(engineDbPath, copyEngine);

    let received = null;
    const openCalls = [];
    const result = await auditIsolatedRecentRolloutReadiness([
      "--core-db", copyCore,
      "--engine-db", copyEngine,
      "--isolated-snapshot",
      "--query", "alpha",
    ], {
      engineDbMod: {
        resolveCoreDbPath: () => coreDbPath,
        resolveEngineDbPath: () => engineDbPath,
        openEngineDb: (options = {}) => {
          openCalls.push({ target: "legacy", options });
          return { open: true, readonly: true, close() {} };
        },
      },
      isolatedDbs: {
        openCoreDbReadonly: (options = {}) => {
          openCalls.push({ target: "core", options });
          return { open: true, readonly: true, close() {} };
        },
        openEngineDbIsolated: (options = {}) => {
          openCalls.push({ target: "engine", options });
          return { open: true, readonly: true, close() {} };
        },
      },
      audit: {
        runRecentRolloutReadinessAudit: async (options) => {
          received = {
            isolatedSnapshot: options.isolatedSnapshot,
            snapshotIdentityVerified: options.snapshotIdentityVerified,
          };
          return {
            report_schema_version: 2,
            decision: { class: "pass_canary_readiness", reason: "ok" },
            privacy_validation: { passed: true, checked_value_count: 1, leak_count: 0 },
          };
        },
        writeRecentRolloutReadinessReport: () => {},
      },
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(received, {
      isolatedSnapshot: true,
      snapshotIdentityVerified: true,
    });
    assert.deepEqual(openCalls, [
      { target: "legacy", options: { readonly: true } },
      { target: "core", options: { coreDbPath: copyCore, engineDbPath: copyEngine } },
      { target: "engine", options: { coreDbPath: copyCore, engineDbPath: copyEngine, readonly: true } },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
