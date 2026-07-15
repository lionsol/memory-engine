import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  parseArgs,
  probeIsolatedRecentPerformance,
  usage,
} = require("../bin/probe-isolated-recent-performance.js");

function createFixtureRoot() {
  return mkdtempSync(join(tmpdir(), "memory-engine-recent-performance-real-cli-"));
}

function createRealFixture(root) {
  const coreDbPath = join(root, "core.sqlite");
  const engineDbPath = join(root, "engine.sqlite");
  const core = new Database(coreDbPath);
  const engine = new Database(engineDbPath);
  core.exec("CREATE TABLE chunks (id TEXT PRIMARY KEY, text TEXT, path TEXT, updated_at INTEGER)");
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
  core.prepare("INSERT INTO chunks VALUES (?, ?, ?, ?)")
    .run("A", "alpha secret body", "memory/smart-add/A-secret.md", 987654321012);
  engine.prepare("INSERT INTO memory_confidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("A", 0.9, 0, 7, 3, 0, 0, "raw_log", 0, "alpha kg secret");
  core.close();
  engine.close();
  return { coreDbPath, engineDbPath };
}

test("real-mode CLI parser enforces explicit mode and explicit DB paths", () => {
  assert.equal(parseArgs([]).mode, "synthetic");
  assert.equal(parseArgs(["--mode", "synthetic"]).mode, "synthetic");
  assert.equal(usage().includes("--mode synthetic|real"), true);

  assert.throws(
    () => parseArgs(["--mode", "REAL"]),
    /unknown mode: REAL/,
  );
  assert.throws(
    () => parseArgs(["--mode", "real"]),
    /real_mode_requires_explicit_core_and_engine_db/,
  );
  assert.throws(
    () => parseArgs(["--mode", "real", "--core-db", "core.sqlite"]),
    /real_mode_requires_explicit_core_and_engine_db/,
  );
  assert.throws(
    () => parseArgs(["--mode", "synthetic", "--core-db", "core.sqlite", "--engine-db", "engine.sqlite"]),
    /db_paths_require_real_mode/,
  );
});

test("real-mode CLI ignores env variables and only uses explicit caller paths", async () => {
  const previous = {
    CORE_DB_PATH: process.env.CORE_DB_PATH,
    ENGINE_DB_PATH: process.env.ENGINE_DB_PATH,
    MEMORY_ENGINE_DB: process.env.MEMORY_ENGINE_DB,
    MEMORY_ENGINE_CORE_DB: process.env.MEMORY_ENGINE_CORE_DB,
    HOME: process.env.HOME,
  };
  process.env.CORE_DB_PATH = "/implicit/core.sqlite";
  process.env.ENGINE_DB_PATH = "/implicit/engine.sqlite";
  process.env.MEMORY_ENGINE_DB = "/implicit/engine.sqlite";
  process.env.MEMORY_ENGINE_CORE_DB = "/implicit/core.sqlite";
  process.env.HOME = "/implicit-home";
  try {
    await assert.rejects(
      probeIsolatedRecentPerformance(["--mode", "real", "--json"]),
      error => String(error?.message || error).includes("real_mode_requires_explicit_core_and_engine_db"),
    );

    let captured = null;
    const root = createFixtureRoot();
    try {
      const { coreDbPath, engineDbPath } = createRealFixture(root);
      const result = await probeIsolatedRecentPerformance([
        "--mode", "real",
        "--core-db", coreDbPath,
        "--engine-db", engineDbPath,
        "--json",
      ], {
        probe: {
          async runRecentPerformanceProbe(options) {
            captured = options;
            return {
              mode: "real",
              decision: { class: "recommended_sql_rewrite", strategy: "strategy_b_not_in" },
              privacy_validation: { passed: true, forbidden_key_count: 0, raw_value_leak_count: 0, invalid_hash_count: 0, checked_sensitive_value_count: 0 },
            };
          },
          writeRecentPerformanceReport() {},
        },
      });

      assert.equal(result.exitCode, 0);
      assert.deepEqual(captured, {
        mode: "real",
        coreDbPath,
        engineDbPath,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("real-mode CLI succeeds with explicit temp DB paths and fail-closes on privacy failure without overwriting out", async () => {
  const root = createFixtureRoot();
  try {
    const { coreDbPath, engineDbPath } = createRealFixture(root);
    const live = await probeIsolatedRecentPerformance([
      "--mode", "real",
      "--core-db", coreDbPath,
      "--engine-db", engineDbPath,
      "--json",
    ]);
    assert.equal([0, 2, 3].includes(live.exitCode), true);
    assert.equal(live.report?.mode, "real");

    const outPath = join(root, "report.json");
    writeFileSync(outPath, "KEEP");
    const failed = await probeIsolatedRecentPerformance([
      "--mode", "real",
      "--core-db", coreDbPath,
      "--engine-db", engineDbPath,
      "--json",
      "--out", outPath,
    ], {
      probe: {
        async runRecentPerformanceProbe() {
          return {
            mode: "real",
            decision: { class: "recommended_sql_rewrite", strategy: "strategy_b_not_in" },
            privacy_validation: {
              passed: false,
              forbidden_key_count: 1,
              raw_value_leak_count: 0,
              invalid_hash_count: 0,
              checked_sensitive_value_count: 1,
            },
            rows: [{ id: "SHOULD-NOT-BE-WRITTEN" }],
          };
        },
        writeRecentPerformanceReport() {
          throw new Error("must not write");
        },
      },
    });

    assert.equal(failed.exitCode, 2);
    assert.equal(failed.output, "public_report_privacy_validation_failed");
    assert.equal(readFileSync(outPath, "utf8"), "KEEP");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("real-mode CLI covers explicit path errors, help, mutation flags, and out writes", async () => {
  const root = createFixtureRoot();
  try {
    const help = await probeIsolatedRecentPerformance(["--help"]);
    assert.equal(help.exitCode, 0);
    assert.equal(help.output.includes("Default mode is synthetic."), true);

    await assert.rejects(
      probeIsolatedRecentPerformance([
        "--mode", "real",
        "--core-db", join(root, "missing-core.sqlite"),
        "--engine-db", join(root, "missing-engine.sqlite"),
      ]),
      error => String(error?.message || error).includes("real_mode_db_path_not_found"),
    );

    for (const flag of ["--apply", "--force", "--write-db", "--delete", "--update", "--insert", "--repair", "--migrate", "--no-backup"]) {
      await assert.rejects(
        probeIsolatedRecentPerformance([flag]),
        error => String(error?.message || error).includes("Isolated Recent performance probe is read-only"),
      );
    }

    const { coreDbPath, engineDbPath } = createRealFixture(root);
    const outPath = join(root, "written.json");
    const written = await probeIsolatedRecentPerformance([
      "--mode", "real",
      "--core-db", coreDbPath,
      "--engine-db", engineDbPath,
      "--json",
      "--out", outPath,
    ], {
      probe: {
        async runRecentPerformanceProbe() {
          return {
            mode: "real",
            decision: { class: "inconclusive", reason: "database_changed_during_real_probe" },
            privacy_validation: { passed: true, forbidden_key_count: 0, raw_value_leak_count: 0, invalid_hash_count: 0, checked_sensitive_value_count: 0 },
          };
        },
        writeRecentPerformanceReport(output, path) {
          writeFileSync(path, output);
        },
      },
    });

    assert.equal(written.exitCode, 3);
    assert.equal(existsSync(outPath), true);
    assert.equal(JSON.parse(readFileSync(outPath, "utf8")).mode, "real");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
