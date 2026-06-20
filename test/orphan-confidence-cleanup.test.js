import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_PATH = resolve(REPO_ROOT, "bin/cleanup-orphan-confidence.js");
const REPORT_JSON_PATH = resolve(REPO_ROOT, "tmp/memory-quality/orphan-confidence-cleanup-dry-run.json");
const REPORT_MD_PATH = resolve(REPO_ROOT, "tmp/memory-quality/orphan-confidence-cleanup-dry-run.md");

function createFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-orphan-cleanup-"));
  const corePath = resolve(root, "core.sqlite");
  const engineDir = resolve(root, "engine");
  const enginePath = resolve(engineDir, "memory-engine.sqlite");
  mkdirSync(engineDir, { recursive: true });

  const coreDb = new Database(corePath);
  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        text TEXT,
        updated_at INTEGER
      )
    `);
    coreDb.prepare("INSERT INTO chunks (id, text, updated_at) VALUES (?, ?, ?)").run(
      "chunk-live-1",
      "alive",
      1718000000,
    );
    coreDb.prepare("INSERT INTO chunks (id, text, updated_at) VALUES (?, ?, ?)").run(
      "chunk-live-2",
      "alive",
      1718100000,
    );
  } finally {
    coreDb.close();
  }

  const engineDb = new Database(enginePath);
  try {
    engineDb.exec(`
      CREATE TABLE memory_confidence (
        chunk_id TEXT PRIMARY KEY,
        confidence REAL,
        last_confidence_update INTEGER
      );

      CREATE TABLE memory_events (
        id INTEGER PRIMARY KEY,
        event_type TEXT,
        source TEXT,
        memory_id TEXT
      );
    `);

    engineDb.prepare("INSERT INTO memory_confidence (chunk_id, confidence, last_confidence_update) VALUES (?, ?, ?)").run(
      "chunk-live-1",
      0.9,
      Math.floor(Date.parse("2026-06-16T00:00:00.000Z") / 1000),
    );
    engineDb.prepare("INSERT INTO memory_confidence (chunk_id, confidence, last_confidence_update) VALUES (?, ?, ?)").run(
      "chunk-live-2",
      0.7,
      Math.floor(Date.parse("2026-06-14T00:00:00.000Z") / 1000),
    );
    engineDb.prepare("INSERT INTO memory_confidence (chunk_id, confidence, last_confidence_update) VALUES (?, ?, ?)").run(
      "orphan-2026-06-a",
      0.5,
      Math.floor(Date.parse("2026-06-15T00:00:00.000Z") / 1000),
    );
    engineDb.prepare("INSERT INTO memory_confidence (chunk_id, confidence, last_confidence_update) VALUES (?, ?, ?)").run(
      "1234567890abcdef-stale",
      0.3,
      Math.floor(Date.parse("2026-05-17T00:00:00.000Z") / 1000),
    );

    engineDb.prepare("INSERT INTO memory_events (event_type, source, memory_id) VALUES (?, ?, ?)").run(
      "memory_candidate_retrieved",
      "test",
      "1234567890abcdef",
    );
  } finally {
    engineDb.close();
  }

  return { corePath, enginePath };
}

async function importCleanupModule(tag) {
  return import(`../lib/quality/orphan-confidence-cleanup.js?orphan-cleanup=${tag}`);
}

function cleanupReports() {
  rmSync(REPORT_JSON_PATH, { force: true });
  rmSync(REPORT_MD_PATH, { force: true });
}

function runCli(args = [], envOverrides = {}) {
  const env = {
    ...process.env,
    ...envOverrides,
  };
  return execFileSync("node", [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runCliExpectError(args = [], envOverrides = {}) {
  try {
    runCli(args, envOverrides);
    assert.fail("expected CLI to fail");
  } catch (error) {
    return {
      stdout: String(error.stdout || ""),
      stderr: String(error.stderr || ""),
      message: String(error.message || error),
      status: error.status,
    };
  }
}

test("dry-run does not issue DELETE/UPDATE/INSERT/DROP/CREATE/ALTER/VACUUM statements", async () => {
  const fixture = createFixture();
  const executedSql = [];
  const originalPrepare = Database.prototype.prepare;
  const originalExec = Database.prototype.exec;

  Database.prototype.prepare = function patchedPrepare(sql, ...args) {
    executedSql.push(String(sql));
    return originalPrepare.call(this, sql, ...args);
  };
  Database.prototype.exec = function patchedExec(sql, ...args) {
    executedSql.push(String(sql));
    return originalExec.call(this, sql, ...args);
  };

  try {
    const { collectOrphanConfidenceDryRun } = await importCleanupModule(`writes-${Date.now()}`);
    const report = collectOrphanConfidenceDryRun({
      engineDbPath: fixture.enginePath,
      coreDbPath: fixture.corePath,
    });
    assert.equal(report.mode, "dry-run");
  } finally {
    Database.prototype.prepare = originalPrepare;
    Database.prototype.exec = originalExec;
  }

  const forbidden = executedSql.filter((sql) => /\b(DELETE|UPDATE|INSERT|DROP|CREATE|ALTER|VACUUM)\b/i.test(sql));
  assert.deepEqual(forbidden, []);
});

test("dry-run counts orphans via memory_confidence LEFT JOIN core.chunks and excludes live confidence rows", async () => {
  const fixture = createFixture();

  const { collectOrphanConfidenceDryRun } = await importCleanupModule(`join-${Date.now()}`);
  const report = collectOrphanConfidenceDryRun({
    engineDbPath: fixture.enginePath,
    coreDbPath: fixture.corePath,
    sampleLimit: 10,
  });

  assert.equal(report.mode, "dry-run");
  assert.equal(report.confidence_total_count, 4);
  assert.equal(report.chunks_total_count, 2);
  assert.equal(report.orphan_confidence_count, 2);
  assert.equal(report.would_delete_count, 2);
  assert.equal(report.orphan_ratio, 0.5);
  assert.equal(report.sample_orphan_chunk_ids.includes("chunk-live-1"), false);
  assert.equal(report.sample_orphan_chunk_ids.includes("chunk-live-2"), false);
  assert.equal(report.sample_orphan_chunk_ids.includes("orphan-2026-06-a"), true);
  assert.equal(report.sample_orphan_chunk_ids.includes("1234567890abcdef-stale"), true);
});

test("dry-run report includes required fields, correct distributions, and sampleLimit trimming", async () => {
  const fixture = createFixture();

  const { collectOrphanConfidenceDryRun } = await importCleanupModule(`report-${Date.now()}`);
  const report = collectOrphanConfidenceDryRun({
    engineDbPath: fixture.enginePath,
    coreDbPath: fixture.corePath,
    sampleLimit: 1,
  });

  assert.deepEqual(Object.keys(report).sort(), [
    "chunks_total_count",
    "confidence_total_count",
    "core_db_path",
    "engine_db_path",
    "event_prefix_seen_count",
    "generated_at",
    "id_length_distribution",
    "mode",
    "month_distribution",
    "orphan_confidence_count",
    "orphan_ratio",
    "sample_orphan_chunk_ids",
    "would_delete_count",
  ]);
  assert.deepEqual(report.month_distribution, {
    "2026-06": 1,
    "2026-05": 1,
  });
  assert.deepEqual(report.id_length_distribution, {
    "12": 2,
    "16": 1,
    "22": 1,
  });
  assert.equal(report.event_prefix_seen_count, 1);
  assert.equal(report.sample_orphan_chunk_ids.length, 1);
  assert.deepEqual(report.sample_orphan_chunk_ids, ["orphan-2026-06-a"]);
  assert.equal(report.engine_db_path, fixture.enginePath);
  assert.equal(report.core_db_path, fixture.corePath);
  assert.match(report.generated_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("CLI --help prints usage and dry-run notes", () => {
  const stdout = runCli(["--help"]);
  assert.match(stdout, /Usage:/);
  assert.match(stdout, /--sample-limit <n>/);
  assert.match(stdout, /Current version only supports dry-run/);
});

test("CLI default dry-run uses fixture DB from env and writes reports", () => {
  const fixture = createFixture();
  cleanupReports();

  const stdout = runCli([], {
    ENGINE_DB_PATH: fixture.enginePath,
    CORE_DB_PATH: fixture.corePath,
  });

  assert.match(stdout, /mode: dry-run/);
  assert.match(stdout, /confidence total count: 4/);
  assert.match(stdout, /chunks total count: 2/);
  assert.match(stdout, /orphan confidence count: 2/);
  assert.match(stdout, /would delete count: 2/);
  assert.match(stdout, /orphan ratio: 0.5/);
  assert.match(stdout, /event prefix seen count: 1/);
  assert.equal(existsSync(REPORT_MD_PATH), true);
  assert.equal(existsSync(REPORT_JSON_PATH), true);

  const markdown = readFileSync(REPORT_MD_PATH, "utf8");
  const json = JSON.parse(readFileSync(REPORT_JSON_PATH, "utf8"));
  assert.match(markdown, /# Orphan Confidence Cleanup Dry Run/);
  assert.match(markdown, /## Summary/);
  assert.match(markdown, /## Safety/);
  assert.match(markdown, /## Sample Orphan Chunk IDs/);
  assert.equal(json.mode, "dry-run");
});

test("CLI --json prints JSON summary", () => {
  const fixture = createFixture();
  cleanupReports();

  const stdout = runCli(["--json"], {
    ENGINE_DB_PATH: fixture.enginePath,
    CORE_DB_PATH: fixture.corePath,
  });
  const summary = JSON.parse(stdout);

  assert.equal(summary.mode, "dry-run");
  assert.equal(summary.confidence_total_count, 4);
  assert.equal(summary.orphan_confidence_count, 2);
  assert.equal(summary.report_output_paths.json, REPORT_JSON_PATH);
  assert.equal(summary.report_output_paths.markdown, REPORT_MD_PATH);
});

test("CLI --sample-limit trims sample orphan ids in written JSON report", () => {
  const fixture = createFixture();
  cleanupReports();

  runCli(["--sample-limit", "1"], {
    ENGINE_DB_PATH: fixture.enginePath,
    CORE_DB_PATH: fixture.corePath,
  });

  const json = JSON.parse(readFileSync(REPORT_JSON_PATH, "utf8"));
  assert.deepEqual(json.sample_orphan_chunk_ids, ["orphan-2026-06-a"]);
});

test("CLI rejects --apply with dry-run only error", () => {
  const error = runCliExpectError(["--apply"]);
  assert.equal(error.status, 1);
  assert.match(error.stderr, /Current version only supports dry-run/);
  assert.match(error.stderr, /Real deletion must be implemented later, reviewed separately, and shipped in a separate commit/);
});

test("CLI rejects --delete with dry-run only error", () => {
  const error = runCliExpectError(["--delete"]);
  assert.equal(error.status, 1);
  assert.match(error.stderr, /Current version only supports dry-run/);
});

test("CLI missing DB error includes resolved paths and existence diagnostics", () => {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-orphan-cleanup-missing-"));
  const missingEngine = resolve(root, "engine/missing.sqlite");
  const missingCore = resolve(root, "core/missing.sqlite");

  const error = runCliExpectError([
    "--engine-db", missingEngine,
    "--core-db", missingCore,
  ]);

  assert.equal(error.status, 1);
  assert.match(error.stderr, /resolved engine DB path:/);
  assert.match(error.stderr, /resolved core DB path:/);
  assert.match(error.stderr, /engine DB exists\?: false/);
  assert.match(error.stderr, /core DB exists\?: false/);
  assert.match(error.stderr, /engine DB parent directory exists\?: false/);
  assert.match(error.stderr, /core DB parent directory exists\?: false/);
  assert.match(error.stderr, /original error:/);
});
