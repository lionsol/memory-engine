import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const RUNBOOK = new URL("../docs/smoke-tests/full-fail-closed-safety-smoke.md", import.meta.url);

function readRunbook() {
  return readFileSync(RUNBOOK, "utf8");
}

test("full fail-closed safety smoke runbook exists", () => {
  assert.equal(existsSync(RUNBOOK), true);
});

test("runbook records the complete A5 matrix and production surfaces", () => {
  const runbook = readRunbook();
  for (const token of [
    "F1-D-B8-A5",
    "auto_recall",
    "memory_engine_action_search",
    "memory_engine_search",
    "Legacy mode executes KG and Recent fallback",
    "Scoped canary hit suppresses KG and Recent fallback",
    "Scoped canary miss restores KG and Recent fallback",
    "Full mode suppresses fallback without canary scope",
    "KG full mode leaves Recent, FTS, and vector available",
    "Recent full mode leaves KG, FTS, and vector available",
    "Full-mode events do not increment scoped-canary metrics",
    "Switching back to legacy mode restores fallback immediately",
  ]) {
    assert.equal(runbook.includes(token), true, `missing A5 runbook token: ${token}`);
  }
});

test("runbook keeps the synthetic-only and no-removal boundary explicit", () => {
  const runbook = readRunbook();
  for (const token of [
    "SQLite `:memory:`",
    "real OpenClaw core database",
    "real memory-engine database",
    "reload or reinstall the plugin",
    "mutate OpenClaw configuration",
    "network or an LLM",
    "write a runtime report file",
    "remove or disable legacy fallback code",
    "does not authorize B8-B legacy fallback deletion",
  ]) {
    assert.equal(runbook.includes(token), true, `missing safety boundary token: ${token}`);
  }
});

test("runbook exposes Node 24 smoke and focused regression commands", () => {
  const runbook = readRunbook();
  for (const token of [
    "bin/run-full-fail-closed-safety-smoke.js --markdown",
    "bin/run-full-fail-closed-safety-smoke.js --json",
    "node --test test/full-fail-closed-safety-smoke.test.js",
  ]) {
    assert.equal(runbook.includes(token), true, `missing smoke command token: ${token}`);
  }
});
