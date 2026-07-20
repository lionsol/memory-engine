import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUNBOOK_PATH = new URL(
  "../docs/smoke-tests/sustained-runtime-remediation.md",
  import.meta.url,
);

function runbook() {
  return readFileSync(RUNBOOK_PATH, "utf8");
}

function escaped(value) {
  return value.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&");
}

function has(text, value) {
  assert.match(text, new RegExp(escaped(value)));
}

test("runbook records all three runtime ABI identities and equality gate", () => {
  const text = runbook();
  for (const value of [
    "OpenClaw CLI Node/ABI",
    "OpenClaw gateway Node/ABI",
    "installed native dependency Node/ABI",
    "CLI ABI = gateway ABI = installed native dependency ABI",
    "process.versions.modules",
    "actual service process",
    "npm rebuild",
    "npm install",
    "not default fixes",
  ]) {
    has(text, value);
  }
});

test("runbook requires an independent exact configuration backup", () => {
  const text = runbook();
  for (const value of [
    "openclaw config file",
    "independent ordinary-file backup",
    "not be a symlink, hardlink",
    "owner-only",
    "exact original bytes",
    "SHA-256",
    "byte count",
    "restore",
  ]) {
    has(text, value);
  }
});

test("runbook preserves the safe initial state and disables active-memory", () => {
  const text = runbook();
  for (const value of [
    "active-memory effective enabled=false",
    "status=clean",
    "active_memory_enabled=false",
    "blockers=[]",
    "autoRecall.enabled=false",
    "kgFailClosedMode=legacy_fallback",
    "recentFailClosedMode=legacy_fallback",
    "productionEvidenceWindow disabled or absent",
    "no evidence epoch",
    "no scheduler or cron",
    "difference_count=0",
  ]) {
    has(text, value);
  }
});

test("runbook permits preflight only and withholds activation", () => {
  const text = runbook();
  has(text, "memoryEngine.sustainedRuntimePreflight");
  has(text, "memoryEngine.productionEvidenceHealthcheck");
  has(text, "Only the preflight method may be called");
  has(text, "Do not call the scheduled healthcheck");
  has(text, "B8-A7 sustained runtime window=NOT AUTHORIZED");
  has(text, "B8-B removal=NOT AUTHORIZED");
});

test("runbook is an operator procedure, not an executable mutation path", () => {
  const text = runbook();
  for (const value of [
    "does not change OpenClaw configuration",
    "does not install or reload the plugin",
    "does not access either database",
    "does not create a scheduler",
    "does not enable an evidence epoch",
    "does not generate production traffic",
  ]) {
    has(text, value);
  }
  assert.doesNotMatch(text, /node\s+-e|spawnSync|execSync/);
});
