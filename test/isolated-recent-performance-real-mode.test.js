import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MAX_PUBLIC_REPORT_BYTES,
  runRealRecentPerformanceProbe,
  runRecentPerformanceProbe,
} from "../lib/recall/hybrid/recent-performance-probe.js";

function createFixtureRoot() {
  return mkdtempSync(join(tmpdir(), "memory-engine-recent-performance-real-"));
}

function createRealFixture(root) {
  const coreDbPath = join(root, "core.sqlite");
  const engineDbPath = join(root, "engine.sqlite");
  const core = new Database(coreDbPath);
  const engine = new Database(engineDbPath);

  core.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      text TEXT,
      path TEXT,
      updated_at INTEGER
    );
  `);

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

  for (const row of [
    ["A", "alpha first secret", "memory/smart-add/A-secret.md", 500],
    ["B", "alpha archived secret", "memory/smart-add/B-secret.md", 600],
    ["C", "alpha episode secret", "memory/episodes/C-secret.md", 400],
    ["D", "snow 雪 alpha secret", "memory/smart-add/D-secret.md", 300],
    ["E", "generated alpha secret", "memory/generated-smart-add/E-secret.md", 700],
  ]) {
    core.prepare("INSERT INTO chunks (id, text, path, updated_at) VALUES (?, ?, ?, ?)").run(...row);
  }

  for (const row of [
    ["A", 0.9, 0, 7, 3, 0, 0, "raw_log", 0, "alpha first kg secret"],
    ["B", 0.9, 0, 7, 3, 0, 0, "raw_log", 1, "alpha archived kg secret"],
    ["C", 0.8, 0, 7, 3, 0, 0, "episodic", 0, "alpha episode kg secret"],
    ["D", 0.7, 0, 7, 3, 0, 0, "raw_log", 0, "snow alpha kg secret"],
    ["E", 0.7, 0, 7, 3, 0, 0, "raw_log", 0, "generated alpha kg secret"],
  ]) {
    engine.prepare(`
      INSERT INTO memory_confidence (
        chunk_id, confidence, last_confidence_update, base_tau, hit_count,
        is_protected, conflict_flag, category, is_archived, kg_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...row);
  }

  core.close();
  engine.close();
  return { coreDbPath, engineDbPath };
}

test("real mode runner returns readonly topology, stable public report, and no raw leaks", async () => {
  const root = createFixtureRoot();
  try {
    const { coreDbPath, engineDbPath } = createRealFixture(root);
    const report = await runRealRecentPerformanceProbe({
      coreDbPath,
      engineDbPath,
      limits: [20, 30, 120],
      warmupCount: 0,
      repetitionCount: 1,
    });
    const serialized = JSON.stringify(report);

    assert.equal(report.mode, "real");
    assert.equal(report.topology.legacy.readonly, true);
    assert.deepEqual(report.topology.legacy.database_names, ["main", "core"]);
    assert.equal(report.topology.core.readonly, true);
    assert.deepEqual(report.topology.core.database_names, ["main"]);
    assert.equal(report.topology.engine.readonly, true);
    assert.deepEqual(report.topology.engine.database_names, ["main"]);

    assert.equal(report.database_stability.stable, true);
    assert.equal(report.privacy_validation.passed, true);
    assert.equal(report.privacy_validation.forbidden_key_count, 0);
    assert.equal(report.privacy_validation.raw_value_leak_count, 0);
    assert.equal(report.privacy_validation.invalid_hash_count, 0);
    assert.equal(report.report_size_bytes < MAX_PUBLIC_REPORT_BYTES, true);
    assert.equal(report.candidate_level_details_included, false);

    assert.equal(typeof report.performance.real.strategy_a_current_not_exists, "object");
    assert.equal(typeof report.performance.real.strategy_b_not_in, "object");
    assert.equal(typeof report.performance.real.strategy_c_materialized_cte, "object");
    assert.equal(typeof report.performance.real.strategy_e_snapshot_reuse, "object");
    assert.equal(Object.keys(report.performance.real.strategy_b_not_in.branches).length > 0, true);

    assert.equal(["recommended_sql_rewrite", "inconclusive", "fail"].includes(report.decision.class), true);
    assert.equal(report.benchmark_query_descriptor.query_id.length, 16);

    for (const secret of [
      "A-secret.md",
      "B-secret.md",
      "alpha first secret",
      "alpha archived kg secret",
      "\"id\":",
      "\"text\":",
      "\"path\":",
      "\"updated_at\":",
    ]) {
      assert.equal(serialized.includes(secret), false, secret);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runRecentPerformanceProbe defaults to synthetic and real mode requires explicit file paths", async () => {
  const synthetic = await runRecentPerformanceProbe({});
  assert.notEqual(synthetic.mode, "real");

  await assert.rejects(
    runRealRecentPerformanceProbe({}),
    error => error?.message === "real_mode_requires_explicit_core_and_engine_db",
  );

  await assert.rejects(
    runRecentPerformanceProbe({
      mode: "real",
      coreDbPath: "/does/not/exist/core.sqlite",
      engineDbPath: "/does/not/exist/engine.sqlite",
    }),
    error => String(error?.message || error).startsWith("real_mode_db_path_not_found:"),
  );
});

test("real mode runner marks database changes as inconclusive", async () => {
  const root = createFixtureRoot();
  try {
    const { coreDbPath, engineDbPath } = createRealFixture(root);
    const report = await runRealRecentPerformanceProbe({
      coreDbPath,
      engineDbPath,
      limits: [20, 30, 120],
      warmupCount: 0,
      repetitionCount: 1,
      __testHooks: {
        afterBeforeSnapshot() {
          const db = new Database(coreDbPath);
          db.prepare("INSERT INTO chunks (id, text, path, updated_at) VALUES (?, ?, ?, ?)")
            .run("Z", "late change", "memory/smart-add/Z.md", 250);
          db.close();
        },
      },
    });

    assert.equal(report.database_stability.stable, false);
    assert.equal(report.decision.class, "inconclusive");
    assert.equal(report.decision.reason, "database_changed_during_real_probe");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
