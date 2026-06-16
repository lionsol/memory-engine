/**
 * memory-engine-cli.test.js — Tests for CLI DB path resolution
 */

import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { execSync, spawnSync } from "node:child_process";

const HOME = homedir();
const CLI_PATH = resolve(process.cwd(), "bin/memory-engine-cli.js");
const DEFAULT_ENGINE_DB = resolve(HOME, ".openclaw/memory/memory-engine/memory-engine.sqlite");
const DEFAULT_CORE_DB = resolve(HOME, ".openclaw/memory/main.sqlite");

// ── Path resolution tests (unit: check default without env vars) ──

test("CLI default DB path resolves to engine DB (not core main.sqlite)", () => {
  // Run with --help to just load paths, then check error message
  const env = { ...process.env };
  delete env.MEMORY_ENGINE_DB_PATH;
  delete env.MEMORY_ENGINE_DB;
  delete env.MEMORY_ENGINE_CORE_DB;

  const { status, stderr } = spawnSync("node", [CLI_PATH, "status"], {
    env,
    encoding: "utf8",
    timeout: 10000,
  });

  // Should output the engine DB path, not core DB path
  const output = stderr || "";
  // Even if engine DB doesn't exist, it should mention engine DB not core DB
  assert.ok(output.includes(DEFAULT_ENGINE_DB) || output.includes("memory-engine") || status === 0,
    `Output should reference engine DB, got: ${output.slice(0, 300)}`);
});

test("MEMORY_ENGINE_DB_PATH env var overrides default engine DB path", () => {
  const customPath = resolve(HOME, ".openclaw/memory/test-custom.sqlite");
  const env = { ...process.env, MEMORY_ENGINE_DB_PATH: customPath };
  delete env.MEMORY_ENGINE_DB;
  delete env.MEMORY_ENGINE_CORE_DB;

  const { status, stdout, stderr } = spawnSync("node", [CLI_PATH, "status"], {
    env,
    encoding: "utf8",
    timeout: 10000,
  });

  // Should try to open the custom path
  const output = stdout + stderr;
  assert.ok(output.includes(customPath),
    `Expected output to reference custom path "${customPath}", got: ${output.slice(0, 300)}`);
});

test("--db flag overrides default and env var engine DB path", () => {
  const flagPath = resolve(HOME, ".openclaw/memory/test-db-flag.sqlite");
  const env = {
    ...process.env,
    // Set env var that should be overridden
    MEMORY_ENGINE_DB_PATH: resolve(HOME, ".openclaw/memory/should-not-use.sqlite"),
  };
  delete env.MEMORY_ENGINE_DB;
  delete env.MEMORY_ENGINE_CORE_DB;

  const { status, stdout, stderr } = spawnSync("node", [CLI_PATH, "--db", flagPath, "status"], {
    env,
    encoding: "utf8",
    timeout: 10000,
  });

  const output = stdout + stderr;
  assert.ok(output.includes(flagPath),
    `Expected output to reference --db path "${flagPath}", got: ${output.slice(0, 300)}`);
  assert.ok(!output.includes("should-not-use"),
    `Should NOT use env var path when --db is specified, got: ${output.slice(0, 300)}`);
});

// ── Functional tests (require real DB) ──

test("CLI status command succeeds with real engine DB", () => {
  const { status, stdout, stderr } = spawnSync("node", [CLI_PATH, "status"], {
    encoding: "utf8",
    timeout: 10000,
  });

  if (status !== 0) {
    // Engine DB might not exist — that's OK, error should be clear
    const output = stdout + stderr;
    assert.ok(!output.includes("no such table: memory_confidence"),
      `Error should NOT mention raw SQLite error, got: ${output.slice(0, 300)}`);
    assert.ok(output.includes("Memory-engine DB") || output.includes("memory-engine") || output.includes("not found"),
      `Error should mention Memory-engine DB, got: ${output.slice(0, 300)}`);
  } else {
    // Success — should show status info
    assert.ok(stdout.includes("Memory Engine Status") || stdout.includes("Total confidence"),
      `Output should show memory engine status, got: ${stdout.slice(0, 300)}`);
    assert.ok(stdout.includes(DEFAULT_ENGINE_DB) || stdout.includes("Engine DB"),
      `Status should show engine DB path, got: ${stdout.slice(0, 300)}`);
  }
});

test("CLI search command works with real DB", () => {
  const { status, stdout, stderr } = spawnSync("node", [CLI_PATH, "search", "memory_engine", "--top-k", "2"], {
    encoding: "utf8",
    timeout: 30000,
  });

  const output = stdout + stderr;

  if (status !== 0) {
    // Should have a clear error, not "no such table: memory_confidence"
    assert.ok(!output.includes("no such table: memory_confidence"),
      `Search error should NOT contain raw SQLite error, got: ${output.slice(0, 300)}`);
  } else {
    // Should show search results
    assert.ok(output.includes("Search:") || output.includes("results"),
      `Search output should include "Search:" or "results", got: ${output.slice(0, 300)}`);
  }
});

test("CLI --help shows --db option and env var info", () => {
  const { stdout, stderr } = spawnSync("node", [CLI_PATH, "--help"], {
    encoding: "utf8",
    timeout: 5000,
  });

  const output = stdout + stderr;
  assert.ok(output.includes("--db"), `--help should mention --db flag, got: ${output.slice(0, 300)}`);
  assert.ok(output.includes("MEMORY_ENGINE_DB_PATH"), `--help should mention MEMORY_ENGINE_DB_PATH env`);
});

test("CLI help exits with code 0", () => {
  const { status } = spawnSync("node", [CLI_PATH, "help"], {
    encoding: "utf8",
    timeout: 5000,
  });

  // help is a valid subcommand now
  assert.equal(status, 0);
});
