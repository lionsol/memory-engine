import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import boundaryCli from "../bin/build-sustained-runtime-boundary-report.js";
import {
  buildSustainedRuntimeBoundaryReport,
  resolveActiveMemoryBoundary,
} from "../lib/recall/hybrid/sustained-runtime-boundary.js";

const CHECKED_AT = "2026-07-20T03:00:00.000Z";

test("active-memory absence is conflict because OpenClaw runtime defaults it enabled", () => {
  const resolved = resolveActiveMemoryBoundary({ plugins: { entries: {} } });
  assert.equal(resolved.valid, true);
  assert.equal(resolved.enabled, true);
  assert.equal(resolved.resolution, "enabled_by_active_memory_runtime_default");
  const report = buildSustainedRuntimeBoundaryReport({
    openclawConfig: { plugins: { entries: {} } },
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.status, "conflict");
  assert.deepEqual(report.blockers, ["active_memory_enabled"]);
});

test("either plugin entry false or plugin config false explicitly closes active-memory", () => {
  const entryDisabled = buildSustainedRuntimeBoundaryReport({
    openclawConfig: { plugins: { entries: { "active-memory": { enabled: false } } } },
    checkedAt: CHECKED_AT,
  });
  assert.equal(entryDisabled.status, "clean");
  assert.equal(entryDisabled.active_memory_resolution, "disabled_by_plugin_entry");

  const configDisabled = buildSustainedRuntimeBoundaryReport({
    openclawConfig: { plugins: { entries: { "active-memory": { enabled: true, config: { enabled: false } } } } },
    checkedAt: CHECKED_AT,
  });
  assert.equal(configDisabled.status, "clean");
  assert.equal(configDisabled.active_memory_resolution, "disabled_by_plugin_config");
});

test("malformed active-memory config fails closed", () => {
  const report = buildSustainedRuntimeBoundaryReport({
    openclawConfig: { plugins: { entries: { "active-memory": { enabled: "false" } } } },
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.status, "invalid");
  assert.equal(report.active_memory_enabled, null);
  assert.ok(report.blockers.includes("invalid_boolean:plugins.entries.active-memory.enabled"));
});

test("boundary CLI outputs only the reduced report and never copies raw secrets", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-boundary-"));
  const configPath = join(root, "openclaw.json");
  const outPath = join(root, "boundary.json");
  writeFileSync(configPath, JSON.stringify({
    secret: "do-not-copy",
    plugins: { entries: { "active-memory": { enabled: false } } },
  }), "utf8");
  const result = await boundaryCli.buildSustainedRuntimeBoundaryCli([
    "--config", configPath,
    "--checked-at", CHECKED_AT,
    "--out", outPath,
    "--pretty",
  ]);
  assert.equal(result.exitCode, 0);
  const output = readFileSync(outPath, "utf8");
  assert.equal(output.includes("do-not-copy"), false);
  assert.equal(JSON.parse(output).status, "clean");
});
