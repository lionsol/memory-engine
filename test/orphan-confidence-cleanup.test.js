import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withCoreDbReadonly } from "../lib/db/isolated-dbs.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI_PATH = resolve(REPO_ROOT, "bin/cleanup-orphan-confidence.js");
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

function createEmptyFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-orphan-cleanup-empty-"));
  const corePath = resolve(root, "core.sqlite");
  const engineDir = resolve(root, "engine");
  const enginePath = resolve(engineDir, "memory-engine.sqlite");
  mkdirSync(engineDir, { recursive: true });

  const coreDb = new Database(corePath);
  coreDb.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      text TEXT,
      updated_at INTEGER
    )
  `);
  coreDb.close();

  const engineDb = new Database(enginePath);
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
  engineDb.close();

  return { corePath, enginePath };
}

async function importCleanupModule(tag) {
  return import(`../lib/quality/orphan-confidence-cleanup.js?orphan-cleanup=${tag}`);
}

function cleanupReports() {
}

function createCliRunContext() {
  const cwd = mkdtempSync(resolve(tmpdir(), "memory-engine-orphan-cli-"));
  return {
    cwd,
    dryRunJsonPath: resolve(cwd, "tmp/memory-quality/orphan-confidence-cleanup-dry-run.json"),
    dryRunMdPath: resolve(cwd, "tmp/memory-quality/orphan-confidence-cleanup-dry-run.md"),
    applyJsonPath: resolve(cwd, "tmp/memory-quality/orphan-confidence-cleanup-apply.json"),
    applyMdPath: resolve(cwd, "tmp/memory-quality/orphan-confidence-cleanup-apply.md"),
  };
}

function runCli(args = [], envOverrides = {}, cwd = REPO_ROOT) {
  const env = {
    ...process.env,
    ...envOverrides,
  };
  return execFileSync("node", [CLI_PATH, ...args], {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runCliExpectError(args = [], envOverrides = {}, cwd = REPO_ROOT) {
  try {
    runCli(args, envOverrides, cwd);
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

test("core handle is real SQLite readonly and rejects writes without SQL guard", () => {
  const fixture = createFixture();

  withCoreDbReadonly((coreDb) => {
    assert.throws(
      () => coreDb.prepare("INSERT INTO chunks (id, text, updated_at) VALUES (?, ?, ?)").run("new", "x", 1),
      /readonly/i,
    );
    assert.throws(
      () => coreDb.prepare("UPDATE chunks SET text = ? WHERE id = ?").run("changed", "chunk-live-1"),
      /readonly/i,
    );
    assert.throws(
      () => coreDb.prepare("DELETE FROM chunks WHERE id = ?").run("chunk-live-1"),
      /readonly/i,
    );
    assert.throws(
      () => coreDb.exec("CREATE TABLE forbidden (id INTEGER)"),
      /readonly/i,
    );
  }, {
    coreDbPath: fixture.corePath,
    engineDbPath: fixture.enginePath,
  });
});

test("dry-run counts orphans via two-phase core existence scan and excludes live confidence rows", async () => {
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

test("dry-run reports zero orphans when engine confidence is empty", async () => {
  const fixture = createEmptyFixture();

  const { collectOrphanConfidenceDryRun } = await importCleanupModule(`empty-engine-${Date.now()}`);
  const report = collectOrphanConfidenceDryRun({
    engineDbPath: fixture.enginePath,
    coreDbPath: fixture.corePath,
  });

  assert.equal(report.confidence_total_count, 0);
  assert.equal(report.chunks_total_count, 0);
  assert.equal(report.orphan_confidence_count, 0);
  assert.equal(report.would_delete_count, 0);
  assert.deepEqual(report.sample_orphan_chunk_ids, []);
});

test("dry-run reports all engine confidence rows as orphan when core chunks is empty", async () => {
  const fixture = createEmptyFixture();
  const engineDb = new Database(fixture.enginePath);
  try {
    engineDb.prepare("INSERT INTO memory_confidence (chunk_id, confidence, last_confidence_update) VALUES (?, ?, ?)").run("id-a", 0.4, 100);
    engineDb.prepare("INSERT INTO memory_confidence (chunk_id, confidence, last_confidence_update) VALUES (?, ?, ?)").run("id-b", 0.6, 200);
  } finally {
    engineDb.close();
  }

  const { collectOrphanConfidenceDryRun } = await importCleanupModule(`empty-core-${Date.now()}`);
  const report = collectOrphanConfidenceDryRun({
    engineDbPath: fixture.enginePath,
    coreDbPath: fixture.corePath,
  });

  assert.equal(report.confidence_total_count, 2);
  assert.equal(report.chunks_total_count, 0);
  assert.equal(report.orphan_confidence_count, 2);
  assert.equal(report.would_delete_count, 2);
});

test("dry-run batches core existence checks to avoid bind limit overflow", async () => {
  const fixture = createEmptyFixture();
  const coreDb = new Database(fixture.corePath);
  const engineDb = new Database(fixture.enginePath);
  try {
    const insertChunk = coreDb.prepare("INSERT INTO chunks (id, text, updated_at) VALUES (?, ?, ?)");
    const insertConfidence = engineDb.prepare("INSERT INTO memory_confidence (chunk_id, confidence, last_confidence_update) VALUES (?, ?, ?)");
    for (let index = 0; index < 1203; index += 1) {
      const id = `chunk-${String(index).padStart(4, "0")}`;
      insertConfidence.run(id, 0.5, 1000 + index);
      if (index < 701) {
        insertChunk.run(id, `text-${index}`, 2000 + index);
      }
    }
  } finally {
    coreDb.close();
    engineDb.close();
  }

  const { collectOrphanConfidenceDryRun } = await importCleanupModule(`batched-${Date.now()}`);
  const report = collectOrphanConfidenceDryRun({
    engineDbPath: fixture.enginePath,
    coreDbPath: fixture.corePath,
    sampleLimit: 5,
  });

  assert.equal(report.confidence_total_count, 1203);
  assert.equal(report.chunks_total_count, 701);
  assert.equal(report.orphan_confidence_count, 502);
  assert.equal(report.would_delete_count, 502);
});

test("cleanup path source no longer uses ATTACH or core schema SQL", () => {
  const source = readFileSync(resolve(REPO_ROOT, "lib/quality/orphan-confidence-cleanup.js"), "utf8");
  assert.doesNotMatch(source, /ATTACH DATABASE/i);
  assert.doesNotMatch(source, /core\.chunks/i);
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
  assert.match(stdout, /--apply/);
  assert.match(stdout, /--confirm-delete-orphan-confidence/);
});

test("CLI default dry-run uses fixture DB from env and writes reports", () => {
  const fixture = createFixture();
  const cliCtx = createCliRunContext();

  const stdout = runCli([], {
    ENGINE_DB_PATH: fixture.enginePath,
    CORE_DB_PATH: fixture.corePath,
  }, cliCtx.cwd);

  assert.match(stdout, /mode: dry-run/);
  assert.match(stdout, /confidence total count: 4/);
  assert.match(stdout, /chunks total count: 2/);
  assert.match(stdout, /orphan confidence count: 2/);
  assert.match(stdout, /would delete count: 2/);
  assert.match(stdout, /orphan ratio: 0.5/);
  assert.match(stdout, /event prefix seen count: 1/);
  assert.equal(existsSync(cliCtx.dryRunMdPath), true);
  assert.equal(existsSync(cliCtx.dryRunJsonPath), true);

  const markdown = readFileSync(cliCtx.dryRunMdPath, "utf8");
  const json = JSON.parse(readFileSync(cliCtx.dryRunJsonPath, "utf8"));
  assert.match(markdown, /# Orphan Confidence Cleanup Dry Run/);
  assert.match(markdown, /## Summary/);
  assert.match(markdown, /## Safety/);
  assert.match(markdown, /## Sample Orphan Chunk IDs/);
  assert.equal(json.mode, "dry-run");
});

test("CLI --json prints JSON summary", () => {
  const fixture = createFixture();
  const cliCtx = createCliRunContext();

  const stdout = runCli(["--json"], {
    ENGINE_DB_PATH: fixture.enginePath,
    CORE_DB_PATH: fixture.corePath,
  }, cliCtx.cwd);
  const summary = JSON.parse(stdout);

  assert.equal(summary.mode, "dry-run");
  assert.equal(summary.confidence_total_count, 4);
  assert.equal(summary.orphan_confidence_count, 2);
  assert.equal(summary.report_output_paths.json, cliCtx.dryRunJsonPath);
  assert.equal(summary.report_output_paths.markdown, cliCtx.dryRunMdPath);
});

test("CLI --sample-limit trims sample orphan ids in written JSON report", () => {
  const fixture = createFixture();
  const cliCtx = createCliRunContext();

  runCli(["--sample-limit", "1"], {
    ENGINE_DB_PATH: fixture.enginePath,
    CORE_DB_PATH: fixture.corePath,
  }, cliCtx.cwd);

  const json = JSON.parse(readFileSync(cliCtx.dryRunJsonPath, "utf8"));
  assert.deepEqual(json.sample_orphan_chunk_ids, ["orphan-2026-06-a"]);
});

test("CLI rejects --apply with dry-run only error", () => {
  const error = runCliExpectError(["--apply"]);
  assert.equal(error.status, 1);
  assert.match(error.stderr, /refusing to execute --apply without --confirm-delete-orphan-confidence/);
  assert.match(error.stderr, /Run dry-run first and review the report before apply/);
});

test("CLI rejects --delete with dry-run only error", () => {
  const error = runCliExpectError(["--delete"]);
  assert.equal(error.status, 1);
  assert.match(error.stderr, /Unsupported flag: --delete/);
  assert.match(error.stderr, /This command defaults to dry-run/);
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

test("confirm without --apply stays in dry-run and does not write DB", () => {
  const fixture = createFixture();
  const cliCtx = createCliRunContext();

  const stdout = runCli(["--confirm-delete-orphan-confidence"], {
    ENGINE_DB_PATH: fixture.enginePath,
    CORE_DB_PATH: fixture.corePath,
  }, cliCtx.cwd);
  assert.match(stdout, /mode: dry-run/);

  const engineDb = new Database(fixture.enginePath, { readonly: true });
  try {
    const count = engineDb.prepare("SELECT COUNT(*) AS c FROM memory_confidence").get()?.c;
    assert.equal(count, 4);
  } finally {
    engineDb.close();
  }
});

test("apply creates backup and deletes only orphan confidence", () => {
  const fixture = createFixture();
  const cliCtx = createCliRunContext();

  const stdout = runCli([
    "--apply",
    "--confirm-delete-orphan-confidence",
  ], {
    ENGINE_DB_PATH: fixture.enginePath,
    CORE_DB_PATH: fixture.corePath,
  }, cliCtx.cwd);

  assert.match(stdout, /mode: apply/);
  assert.match(stdout, /deleted count: 2/);
  assert.match(stdout, /remaining orphan confidence count: 0/);
  assert.equal(existsSync(cliCtx.applyJsonPath), true);
  assert.equal(existsSync(cliCtx.applyMdPath), true);

  const json = JSON.parse(readFileSync(cliCtx.applyJsonPath, "utf8"));
  const markdown = readFileSync(cliCtx.applyMdPath, "utf8");
  assert.equal(json.mode, "apply");
  assert.equal(json.before_orphan_confidence_count, 2);
  assert.equal(json.precomputed_would_delete_count, 2);
  assert.equal(json.deleted_count, 2);
  assert.equal(json.remaining_orphan_confidence_count, 0);
  assert.equal(typeof json.backup_path, "string");
  assert.equal(existsSync(json.backup_path), true);
  assert.match(markdown, /# Orphan Confidence Cleanup Apply Report/);
  assert.match(markdown, /## Backup/);
  assert.match(markdown, /## Deleted Rows/);
  assert.match(markdown, /## Remaining Orphans/);
  assert.match(markdown, /## Safety/);
  assert.match(markdown, /node bin\/memory-quality-eval.js --top 20/);

  const engineDb = new Database(fixture.enginePath, { readonly: true });
  try {
    const confidenceRows = engineDb.prepare("SELECT chunk_id FROM memory_confidence ORDER BY chunk_id ASC").all();
    const eventsCount = engineDb.prepare("SELECT COUNT(*) AS c FROM memory_events").get()?.c;
    assert.deepEqual(confidenceRows.map((row) => row.chunk_id), ["chunk-live-1", "chunk-live-2"]);
    assert.equal(eventsCount, 1);
  } finally {
    engineDb.close();
  }

  const coreDb = new Database(fixture.corePath, { readonly: true });
  try {
    const chunkCount = coreDb.prepare("SELECT COUNT(*) AS c FROM chunks").get()?.c;
    assert.equal(chunkCount, 2);
  } finally {
    coreDb.close();
  }
});

test("apply backup failure aborts delete", () => {
  const fixture = createFixture();
  const backupsBlocker = resolve(dirname(fixture.enginePath), "backups");
  writeFileSync(backupsBlocker, "not-a-directory");

  const error = runCliExpectError([
    "--apply",
    "--confirm-delete-orphan-confidence",
  ], {
    ENGINE_DB_PATH: fixture.enginePath,
    CORE_DB_PATH: fixture.corePath,
  });

  assert.equal(error.status, 1);
  assert.match(error.stderr, /orphan-confidence cleanup apply failed/);
  assert.match(error.stderr, /original error:/);

  const engineDb = new Database(fixture.enginePath, { readonly: true });
  try {
    const count = engineDb.prepare("SELECT COUNT(*) AS c FROM memory_confidence").get()?.c;
    assert.equal(count, 4);
  } finally {
    engineDb.close();
  }
});

test("apply transaction rolls back if delete phase throws", async () => {
  const fixture = createFixture();
  const originalPrepare = Database.prototype.prepare;

  Database.prototype.prepare = function patchedPrepare(sql, ...args) {
    const stmt = originalPrepare.call(this, sql, ...args);
    if (/DELETE FROM memory_confidence/i.test(String(sql))) {
      return {
        ...stmt,
        run(...runArgs) {
          const result = stmt.run(...runArgs);
          throw new Error(`forced delete failure after ${result?.changes || 0} changes`);
        },
      };
    }
    return stmt;
  };

  try {
    const { applyOrphanConfidenceCleanup } = await importCleanupModule(`rollback-${Date.now()}`);
    assert.throws(
      () => applyOrphanConfidenceCleanup({
        engineDbPath: fixture.enginePath,
        coreDbPath: fixture.corePath,
      }),
      /forced delete failure/,
    );
  } finally {
    Database.prototype.prepare = originalPrepare;
  }

  const engineDb = new Database(fixture.enginePath, { readonly: true });
  try {
    const count = engineDb.prepare("SELECT COUNT(*) AS c FROM memory_confidence").get()?.c;
    const orphanCount = engineDb.prepare(`
      SELECT COUNT(*) AS c
      FROM memory_confidence
      WHERE chunk_id IN ('orphan-2026-06-a', '1234567890abcdef-stale')
    `).get()?.c;
    assert.equal(count, 4);
    assert.equal(orphanCount, 2);
  } finally {
    engineDb.close();
  }
});
