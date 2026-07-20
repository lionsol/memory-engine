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

test("Phase 0 collects identities without preselecting a Node runtime", () => {
  const text = runbook();
  const phase0 = text.slice(
    text.indexOf("## Phase 0:"),
    text.indexOf("## Phase 1:"),
  );
  assert.doesNotMatch(phase0, /export PATH|Node 22|Node 24/);
  for (const value of [
    "command -v openclaw",
    "readlink -f",
    "startup method",
    "actual service process or service definition",
    "original operator environment",
  ]) {
    has(phase0, value);
  }
});

test("Phase 0 requires a proven no-load metadata source and fails closed otherwise", () => {
  const text = runbook();
  const phase0 = text.slice(
    text.indexOf("## Phase 0:"),
    text.indexOf("## Phase 1:"),
  );
  assert.doesNotMatch(
    phase0,
    /openclaw plugins inspect memory-engine --runtime --json/,
  );
  for (const value of [
    "No-Load Metadata Gate",
    "authoritative no-load metadata source",
    "does not import plugin entrypoint",
    "does not register plugin",
    "does not initialize plugin",
    "does not access memory-engine/core DB",
    "does not initialize LanceDB",
    "installed runtime metadata=no-load source unavailable",
    "Phase 0 result=blocked",
    "host remediation execution=NOT AUTHORIZED",
  ]) {
    has(phase0, value);
  }
});

test("loaded-runtime checks are later and do not replace no-load planning", () => {
  const text = runbook();
  const phase0End = text.indexOf("## Phase 1:");
  const loadedRuntime = text.indexOf("## Phase 7: Loaded-Runtime Preflight Only");
  assert.ok(phase0End >= 0);
  assert.ok(loadedRuntime > phase0End);
  has(text.slice(loadedRuntime), "After reviewed install and separate authorization");
  has(text.slice(loadedRuntime), "not part of the no-load baseline");
  has(text, "Prior Runtime Recovery Gate");
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

test("runbook defines independent C0 and C1 checkpoints and rollback branches", () => {
  const text = runbook();
  for (const value of [
    "C0 Original Configuration Checkpoint",
    "C1 Safe Configuration Checkpoint",
    "distinct backup path",
    "inode distinct from both the live file and C0",
    "The live config, C0, and C1 paths must remain different",
    "C0 must not be a symlink or hardlink",
    "C1 must not be a symlink or hardlink",
    "only intended semantic difference",
    "reduced/sanitized diff",
    "Configuration remediation failure",
    "Plugin installation or reload failure",
    "Complete abandonment",
    "Restore C0 byte-for-byte",
    "retain or restore C1",
    "B8-A7 authorization remains WITHHELD",
  ]) {
    has(text, value);
  }
  assert.doesNotMatch(
    text,
    /backup at the same live path/,
  );
});

test("runbook defines sanitized semantic diff without exposing raw configuration", () => {
  const text = runbook();
  for (const value of [
    "raw configuration contents",
    "secrets",
    "tokens",
    "environment variables",
    "normalized configuration paths",
    "boolean states",
    "changed_semantic_path_count=1",
    "active_memory_effective_enabled_before=true",
    "active_memory_effective_enabled_after=false",
    "unrelated_semantic_change_count=0",
    "C1 must exactly match the live configuration after",
    "C0 must continue to exactly match the original",
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

test("runbook separates preflight, parity, and scheduler evidence", () => {
  const text = runbook();
  for (const value of [
    "Preflight is responsible for proving only the loaded-host facts",
    "does not independently prove source/runtime parity or host scheduler state",
    "Runtime/Source Parity Evidence",
    "source_runtime_equal=true",
    "reviewed dependency closure matches",
    "Host Scheduler Inventory Evidence",
    "actual OpenClaw scheduler inventory",
    "user systemd timer inventory",
    "user crontab",
  ]) {
    has(text, value);
  }
});

test("runbook requires prior runtime recovery before installation", () => {
  const text = runbook();
  for (const value of [
    "Prior Runtime Recovery Gate",
    "Immutable source recovery",
    "Independent runtime rollback artifact",
    "lockfile identity",
    "install/reload=NOT AUTHORIZED",
    "does not rely on the current installed directory",
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
    "No runbook command deliberately queries or mutates either database",
    "does not change OpenClaw configuration",
    "does not create or invoke any scheduler",
    "enable an evidence epoch",
    "generate production traffic",
  ]) {
    has(text, value);
  }
  assert.doesNotMatch(text, /node\s+-e|spawnSync|execSync/);
});
