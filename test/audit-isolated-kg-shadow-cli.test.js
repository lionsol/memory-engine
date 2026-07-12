import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";

import { auditIsolatedKgShadow, parseArgs, usage } from "../bin/audit-isolated-kg-shadow.js";

function createFixtureRoot() {
  return mkdtempSync(join(tmpdir(), "memory-engine-kg-shadow-cli-"));
}

function createFixture(root) {
  const corePath = join(root, "core.sqlite");
  const enginePath = join(root, "engine.sqlite");
  const core = new Database(corePath);
  core.exec("CREATE TABLE chunks (id TEXT PRIMARY KEY, text TEXT, path TEXT, updated_at INTEGER)");
  core.prepare("INSERT INTO chunks VALUES (?, ?, ?, ?)").run("chunk-1", "shadow explicit query fixture secret text", "memory/secret/shadow-path.md", 1000);
  core.close();
  const engine = new Database(enginePath);
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
    )
  `);
  engine.prepare("INSERT INTO memory_confidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("chunk-1", 0.82, 0, 7, 3, 0, 0, "raw_log", 0, "shadow explicit query");
  engine.close();
  return { corePath, enginePath };
}

function createLowConfidenceFixture(root) {
  const { corePath, enginePath } = createFixture(root);
  const engine = new Database(enginePath);
  engine.prepare("DELETE FROM memory_confidence").run();
  engine.prepare("INSERT INTO memory_confidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("chunk-1", 0.05, 0, 7, 3, 0, 0, "raw_log", 0, "shadow explicit query");
  engine.close();
  return { corePath, enginePath };
}

function createGuardedFixture(root) {
  const { corePath, enginePath } = createFixture(root);
  const engine = new Database(enginePath);
  engine.prepare("INSERT INTO memory_confidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(Buffer.from("blob-only"), 0.82, 0, 7, 3, 0, 0, "raw_log", 0, "shadow explicit query");
  engine.close();
  return { corePath, enginePath };
}

function createBrokenSchemaFixture(root) {
  const corePath = join(root, "core.sqlite");
  const enginePath = join(root, "engine.sqlite");
  const core = new Database(corePath);
  core.exec("CREATE TABLE chunks (id TEXT PRIMARY KEY, text TEXT, path TEXT)");
  core.prepare("INSERT INTO chunks VALUES (?, ?, ?)").run("chunk-1", "shadow explicit query fixture secret text", "memory/secret/shadow-path.md");
  core.close();
  const engine = new Database(enginePath);
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
    )
  `);
  engine.prepare("INSERT INTO memory_confidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("chunk-1", 0.82, 0, 7, 3, 0, 0, "raw_log", 0, "shadow explicit query");
  engine.close();
  return { corePath, enginePath };
}

test("CLI help, arg parsing, and mutation-flag rejection stay read-only", async () => {
  assert.equal(usage().includes("read-only audit"), true);
  const help = await auditIsolatedKgShadow(["--help"]);
  assert.equal(help.exitCode, 0);
  assert.equal(help.output.includes("Usage:"), true);

  const parsed = parseArgs(["--query", "one", "--query", "two", "--derive-from-kg", "3", "--top-k", "4", "--like-pattern-top-n", "5", "--min-confidence", "0.25", "--json"]);
  assert.deepEqual(parsed.queries, ["one", "two"]);
  assert.equal(parsed.deriveFromKg, 3);
  assert.equal(parsed.topK, 4);
  assert.equal(parsed.likePatternTopN, 5);
  assert.equal(parsed.minConfidence, 0.25);

  for (const flag of ["--apply", "--force", "--write-db", "--delete", "--update", "--insert", "--no-backup"]) {
    await assert.rejects(
      auditIsolatedKgShadow([flag]),
      error => String(error.message || error).includes("read-only audit"),
      flag,
    );
  }
});

test("CLI rejects missing query sources and invalid ranges", async () => {
  for (const argv of [
    [],
    ["--derive-from-kg", "1001"],
    ["--top-k", "0", "--query", "x"],
    ["--like-pattern-top-n", "101", "--query", "x"],
    ["--min-confidence", "1.5", "--query", "x"],
  ]) {
    await assert.rejects(auditIsolatedKgShadow(argv), argv.join(" "));
  }
});

test("CLI supports repeated queries, queries-file, derive-from-kg, --out, and safe JSON output", async () => {
  const root = createFixtureRoot();
  try {
    const { corePath, enginePath } = createFixture(root);
    const queriesFile = join(root, "queries.txt");
    writeFileSync(queriesFile, "# ignore\nshadow explicit query\n", "utf8");
    const outPath = join(root, "report.json");
    const result = await auditIsolatedKgShadow([
      "--query", "shadow explicit query",
      "--query", "shadow explicit query",
      "--queries-file", queriesFile,
      "--derive-from-kg", "1",
      "--include-no-hit-control",
      "--top-k", "20",
      "--like-pattern-top-n", "8",
      "--min-confidence", "0.15",
      "--json",
      "--out", outPath,
      "--core-db-path", corePath,
      "--engine-db-path", enginePath,
    ]);
    assert.equal(result.exitCode, 0);
    assert.equal(existsSync(outPath), true);
    const report = JSON.parse(String(result.output || ""));
    const fileReport = JSON.parse(readFileSync(outPath, "utf8"));
    assert.equal(report.summary.query_count >= 2, true);
    assert.deepEqual(fileReport.summary, report.summary);
    assert.equal(report.decision.class, "pass");
    assert.equal(report.query_corpus.derived_source_row_count, 1);
    assert.equal(report.query_corpus.derived_unique_full_query_count, 1);
    assert.equal(report.query_corpus.derived_duplicate_query_count, 0);
    assert.equal(report.query_corpus.final_unique_query_count, 4);
    assert.equal(report.summary.raw_hit_query_count >= 1, true);
    assert.equal(report.summary.positive_candidate_query_count >= 1, true);
    const json = JSON.stringify(report);
    assert.equal(json.includes("shadow explicit query"), false);
    assert.equal(json.includes("fixture secret text"), false);
    assert.equal(json.includes("memory/secret/shadow-path.md"), false);
    assert.equal(json.includes("chunk-1"), false);
    assert.equal(json.includes("row_fingerprint"), true);
    assert.equal(json.includes("id_hash"), true);
    assert.equal(json.includes("path_hash"), true);
    assert.equal(report.queries.every(item => item.query.query_id.length === 16), true);
    assert.equal(report.queries.every(item => item.legacy.candidate_summaries.every(summary => summary.id_hash.length === 16 && summary.path_hash.length === 16 && summary.row_fingerprint.length === 64)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI returns 0 for pass and guarded_only, 2 for fail, and 3 for inconclusive", async () => {
  const passRoot = createFixtureRoot();
  const guardedRoot = createFixtureRoot();
  const failRoot = createFixtureRoot();
  const inconclusiveRoot = createFixtureRoot();
  try {
    const passFixture = createFixture(passRoot);
    const pass = await auditIsolatedKgShadow([
      "--query", "shadow explicit query",
      "--core-db-path", passFixture.corePath,
      "--engine-db-path", passFixture.enginePath,
    ]);
    assert.equal(pass.exitCode, 0);
    assert.equal(pass.report.decision.class, "pass");
    assert.equal(pass.report.decision.reason, "all_queries_isolated_equivalent_with_multi_term_evidence");

    const guardedFixture = createGuardedFixture(guardedRoot);
    const guarded = await auditIsolatedKgShadow([
      "--query", "shadow explicit query",
      "--core-db-path", guardedFixture.corePath,
      "--engine-db-path", guardedFixture.enginePath,
    ]);
    assert.equal(guarded.exitCode, 0);
    assert.equal(guarded.report.decision.class, "guarded_only");

    const failFixture = createBrokenSchemaFixture(failRoot);
    const fail = await auditIsolatedKgShadow([
      "--query", "shadow explicit query",
      "--core-db-path", failFixture.corePath,
      "--engine-db-path", failFixture.enginePath,
    ]);
    assert.equal(fail.exitCode, 2);
    assert.equal(fail.report.decision.class, "fail");

    const inconclusiveFixture = createLowConfidenceFixture(inconclusiveRoot);
    const inconclusive = await auditIsolatedKgShadow([
      "--query", "shadow explicit query",
      "--core-db-path", inconclusiveFixture.corePath,
      "--engine-db-path", inconclusiveFixture.enginePath,
    ]);
    assert.equal(inconclusive.exitCode, 3);
    assert.equal(inconclusive.report.decision.class, "inconclusive");
    assert.equal(inconclusive.report.decision.reason, "no_positive_candidate_evidence");
    assert.equal(inconclusive.report.summary.raw_hit_query_count, 1);
    assert.equal(inconclusive.report.summary.no_raw_hit_query_count, 0);
    assert.equal(inconclusive.report.summary.positive_candidate_query_count, 0);
    assert.equal(inconclusive.report.summary.zero_post_filter_query_count, 1);

    await assert.rejects(
      auditIsolatedKgShadow([
        "--query", "shadow explicit query",
        "--core-db-path", join(inconclusiveRoot, "missing-core.sqlite"),
        "--engine-db-path", inconclusiveFixture.enginePath,
      ]),
    );
  } finally {
    rmSync(passRoot, { recursive: true, force: true });
    rmSync(guardedRoot, { recursive: true, force: true });
    rmSync(failRoot, { recursive: true, force: true });
    rmSync(inconclusiveRoot, { recursive: true, force: true });
  }
});
