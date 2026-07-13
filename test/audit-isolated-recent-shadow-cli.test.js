import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cliModulePromise = import("../bin/audit-isolated-recent-shadow.js")
  .then(module => module.default ?? module);

async function loadCliModule() {
  return cliModulePromise;
}

function createFixtureRoot() {
  return mkdtempSync(join(tmpdir(), "memory-engine-recent-shadow-cli-"));
}

function createFixture(root, { blobSnapshot = false } = {}) {
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
  core.prepare("INSERT INTO chunks VALUES (?, ?, ?, ?)")
    .run("cli-episode-id", "cli episode text", "memory/episodes/cli-episode.md", 999);
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
    .run(blobSnapshot ? Buffer.from("cli-secret-id") : "cli-secret-id", 0.82, 0, 7, 3, 0, 0, "raw_log", 0, "secret kg");
  engine.prepare("INSERT INTO memory_confidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("cli-episode-id", 0.82, 0, 7, 3, 0, 0, "episodic", 0, "episode kg");
  engine.close();
  return { coreDbPath, engineDbPath };
}

test("CLI help, parser, explicit DB paths, duplicate queries, and mutation flag rejection", async () => {
  const { auditIsolatedRecentShadow, parseArgs, usage } = await loadCliModule();
  assert.equal(usage().includes("read-only"), true);
  const parsed = parseArgs([
    "--json",
    "--core-db", "core.sqlite",
    "--engine-db", "engine.sqlite",
    "--query", "alpha",
    "--query", "alpha",
    "--derive-limit", "10",
  ]);
  assert.equal(parsed.json, true);
  assert.equal(parsed.queries.length, 2);
  assert.equal(parsed.deriveLimit, 10);

  const help = await auditIsolatedRecentShadow(["--help"]);
  assert.equal(help.exitCode, 0);
  assert.equal(help.output.includes("Usage:"), true);

  for (const flag of ["--apply", "--force", "--write-db", "--delete", "--update", "--insert", "--repair", "--migrate", "--no-backup"]) {
    await assert.rejects(
      auditIsolatedRecentShadow([flag]),
      error => String(error.message || error).includes("Isolated Recent shadow audit is read-only"),
      flag,
    );
  }

  const root = createFixtureRoot();
  try {
    const { coreDbPath, engineDbPath } = createFixture(root);
    const result = await auditIsolatedRecentShadow([
      "--json",
      "--core-db", coreDbPath,
      "--engine-db", engineDbPath,
      "--query", "alpha",
      "--query", "alpha",
    ]);
    assert.equal(result.exitCode, 3);
    assert.equal(result.report.query_corpus.explicit_input_count, 2);
    assert.equal(result.report.query_corpus.final_unique_query_count >= 1, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI supports queries-file and writes privacy-safe JSON only to caller out path", async () => {
  const { auditIsolatedRecentShadow } = await loadCliModule();
  const root = createFixtureRoot();
  try {
    const { coreDbPath, engineDbPath } = createFixture(root);
    const queriesFile = join(root, "queries.json");
    writeFileSync(queriesFile, JSON.stringify(["alpha", "episodic"]));
    const outPath = join(root, "recent-shadow-report.json");
    const result = await auditIsolatedRecentShadow([
      "--json",
      "--core-db", coreDbPath,
      "--engine-db", engineDbPath,
      "--queries-file", queriesFile,
      "--out", outPath,
    ]);
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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI exit codes cover pass/guarded-only, parameter errors, fail, and inconclusive", async () => {
  const { auditIsolatedRecentShadow } = await loadCliModule();
  const passRoot = createFixtureRoot();
  try {
    const { coreDbPath, engineDbPath } = createFixture(passRoot);
    const pass = await auditIsolatedRecentShadow([
      "--core-db", coreDbPath,
      "--engine-db", engineDbPath,
      "--query", "alpha",
      "--query", "episodic",
    ]);
    assert.equal([0, 3].includes(pass.exitCode), true);
  } finally {
    rmSync(passRoot, { recursive: true, force: true });
  }

  await assert.rejects(
    auditIsolatedRecentShadow(["--core-db", "/does/not/exist", "--engine-db", "/also/missing", "--query", "alpha"]),
    error => String(error.message || error).includes("DB does not exist"),
  );

  const failRoot = createFixtureRoot();
  try {
    const { coreDbPath, engineDbPath } = createFixture(failRoot, { blobSnapshot: true });
    const guarded = await auditIsolatedRecentShadow([
      "--core-db", coreDbPath,
      "--engine-db", engineDbPath,
      "--query", "alpha",
    ]);
    assert.equal(guarded.exitCode, 0);
    assert.equal(guarded.report.decision.class, "guarded_only");
  } finally {
    rmSync(failRoot, { recursive: true, force: true });
  }

  const injected = await auditIsolatedRecentShadow(["--help"], {
    audit: {
      runRecentShadowAudit: async () => ({
        decision: { class: "fail", reason: "mismatch" },
      }),
      writeRecentShadowReport: () => {},
    },
  });
  assert.equal(injected.exitCode, 0);

  const root = createFixtureRoot();
  try {
    const { coreDbPath, engineDbPath } = createFixture(root);
    const fail = await auditIsolatedRecentShadow([
      "--core-db", coreDbPath,
      "--engine-db", engineDbPath,
      "--query", "alpha",
    ], {
      audit: {
        runRecentShadowAudit: async () => ({
          decision: { class: "fail", reason: "mismatch" },
        }),
        writeRecentShadowReport: () => {},
      },
    });
    assert.equal(fail.exitCode, 2);

    const inconclusive = await auditIsolatedRecentShadow([
      "--core-db", coreDbPath,
      "--engine-db", engineDbPath,
      "--query", "alpha",
    ], {
      audit: {
        runRecentShadowAudit: async () => ({
          decision: { class: "inconclusive", reason: "database_changed_during_shadow_audit" },
        }),
        writeRecentShadowReport: () => {},
      },
    });
    assert.equal(inconclusive.exitCode, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
