/**
 * memory-engine-cli.test.js — Tests for CLI DB path resolution
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolveEngineDbPath } from "../lib/db/engine-db.js";

const HOME = homedir();
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const CLI_PATH = fileURLToPath(new URL("../bin/memory-engine-cli.js", import.meta.url));
const DEFAULT_ENGINE_DB = resolve(HOME, ".openclaw/memory/memory-engine/memory-engine.sqlite");
const DEFAULT_CORE_DB = resolve(HOME, ".openclaw/memory/main.sqlite");
const DB_ENV_KEYS = ["ENGINE_DB_PATH", "MEMORY_ENGINE_DB_PATH", "MEMORY_ENGINE_DB", "MEMORY_ENGINE_CORE_DB"];
const runRealDbTests = process.env.MEMORY_ENGINE_RUN_REAL_DB_TESTS === "1";
const realDbTest = runRealDbTests ? test : test.skip;

function runCli(args, options = {}) {
  return spawnSync("node", [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 10000,
    ...options,
  });
}

function summarizeSpawnResult(result) {
  return {
    status: result.status,
    signal: result.signal,
    error: result.error && {
      name: result.error.name,
      message: result.error.message,
      code: result.error.code,
    },
    stdout: result.stdout?.toString(),
    stderr: result.stderr?.toString(),
  };
}

function skipIfSpawnBlocked(t, result) {
  if (result?.error?.code === "EPERM") {
    t.skip(`sandbox blocks child_process spawnSync: ${JSON.stringify(summarizeSpawnResult(result))}`);
    return true;
  }
  return false;
}

function withCleanDbEnv(overrides, fn) {
  const previous = Object.fromEntries(DB_ENV_KEYS.map(key => [key, process.env[key]]));
  try {
    for (const key of DB_ENV_KEYS) delete process.env[key];
    Object.assign(process.env, overrides);
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// ── Path resolution tests (pure resolver/parser checks; no DB open) ──

test("CLI default DB path resolves to engine DB (not core main.sqlite)", () => {
  assert.equal(existsSync(CLI_PATH), true, `CLI_PATH should exist: ${CLI_PATH}`);
  withCleanDbEnv({}, () => {
    assert.equal(resolveEngineDbPath(), DEFAULT_ENGINE_DB);
    assert.notEqual(resolveEngineDbPath(), DEFAULT_CORE_DB);
  });
});

test("MEMORY_ENGINE_DB_PATH overrides the default without opening a DB", () => {
  const customPath = "/tmp/test-custom.sqlite";
  withCleanDbEnv({ MEMORY_ENGINE_DB_PATH: customPath }, () => {
    assert.equal(resolveEngineDbPath(), customPath);
  });
});

test("--db flag overrides environment without opening a DB", () => {
  const flagPath = "/tmp/test-db-flag.sqlite";
  withCleanDbEnv({ MEMORY_ENGINE_DB_PATH: "/tmp/should-not-use.sqlite" }, () => {
    assert.equal(resolveEngineDbPath({ engineDbPath: flagPath }), flagPath);
  });
});

// ── Functional tests (explicit opt-in; may access real DB/LanceDB) ──

realDbTest("CLI status command succeeds with real engine DB", (t) => {
  const result = runCli(["status"]);
  if (skipIfSpawnBlocked(t, result)) return;
  const { status, stdout, stderr } = result;

  if (status !== 0) {
    // Engine DB might not exist — that's OK, error should be clear
    const output = stdout + stderr;
    assert.ok(!output.includes("no such table: memory_confidence"),
      `Error should NOT mention raw SQLite error, got: ${output.slice(0, 300)}; result=${JSON.stringify(summarizeSpawnResult(result))}`);
    assert.ok(output.includes("Memory-engine DB") || output.includes("memory-engine") || output.includes("not found"),
      `Error should mention Memory-engine DB, got: ${output.slice(0, 300)}; result=${JSON.stringify(summarizeSpawnResult(result))}`);
  } else {
    // Success — should show status info
    assert.ok(stdout.includes("Memory Engine Status") || stdout.includes("Total confidence"),
      `Output should show memory engine status, got: ${stdout.slice(0, 300)}; result=${JSON.stringify(summarizeSpawnResult(result))}`);
    assert.ok(stdout.includes(DEFAULT_ENGINE_DB) || stdout.includes("Engine DB"),
      `Status should show engine DB path, got: ${stdout.slice(0, 300)}; result=${JSON.stringify(summarizeSpawnResult(result))}`);
  }
});

realDbTest("CLI search command works with real DB", (t) => {
  const result = runCli(["search", "memory_engine", "--top-k", "2"], {
    timeout: 30000,
  });
  if (skipIfSpawnBlocked(t, result)) return;
  const { status, stdout, stderr } = result;

  const output = stdout + stderr;

  if (status !== 0) {
    // Should have a clear error, not "no such table: memory_confidence"
    assert.ok(!output.includes("no such table: memory_confidence"),
      `Search error should NOT contain raw SQLite error, got: ${output.slice(0, 300)}; result=${JSON.stringify(summarizeSpawnResult(result))}`);
  } else {
    // Should show search results
    assert.ok(output.includes("Search:") || output.includes("results"),
      `Search output should include "Search:" or "results", got: ${output.slice(0, 300)}; result=${JSON.stringify(summarizeSpawnResult(result))}`);
  }
});

test("CLI --help shows --db option and env var info", (t) => {
  const result = runCli(["--help"], {
    timeout: 5000,
  });
  if (skipIfSpawnBlocked(t, result)) return;
  const { stdout, stderr } = result;

  const output = stdout + stderr;
  assert.ok(output.includes("--db"), `--help should mention --db flag, got: ${output.slice(0, 300)}; result=${JSON.stringify(summarizeSpawnResult(result))}`);
  assert.ok(output.includes("MEMORY_ENGINE_DB_PATH"), `--help should mention MEMORY_ENGINE_DB_PATH env; result=${JSON.stringify(summarizeSpawnResult(result))}`);
});

test("CLI help exits with code 0", (t) => {
  const result = runCli(["help"], {
    timeout: 5000,
  });
  if (skipIfSpawnBlocked(t, result)) return;
  const { status } = result;

  // help is a valid subcommand now
  assert.equal(status, 0);
});
