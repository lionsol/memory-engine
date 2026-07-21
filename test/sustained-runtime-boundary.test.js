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

test("non-empty host allowlist exclusion disables bundled active-memory", () => {
  const report = buildSustainedRuntimeBoundaryReport({
    openclawConfig: {
      plugins: {
        allow: ["memory-engine", "memory-core"],
        entries: { "memory-engine": { enabled: true } },
      },
    },
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.status, "clean");
  assert.equal(report.active_memory_enabled, false);
  assert.equal(report.active_memory_resolution, "disabled_by_plugins_allowlist");
  assert.equal(report.active_memory_allowlist_configured, true);
  assert.equal(report.active_memory_allowlisted, false);
  assert.deepEqual(report.blockers, []);
});

test("allowlisting active-memory preserves bundled default enablement", () => {
  const report = buildSustainedRuntimeBoundaryReport({
    openclawConfig: {
      plugins: {
        allow: ["memory-engine", "active-memory"],
        entries: {},
      },
    },
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.status, "conflict");
  assert.equal(report.active_memory_enabled, true);
  assert.equal(report.active_memory_resolution, "enabled_by_active_memory_runtime_default");
  assert.equal(report.active_memory_allowlisted, true);
});

test("global disable and denylist precede bundled default enablement", () => {
  const globalDisabled = buildSustainedRuntimeBoundaryReport({
    openclawConfig: { plugins: { enabled: false, allow: ["active-memory"], entries: {} } },
    checkedAt: CHECKED_AT,
  });
  assert.equal(globalDisabled.status, "clean");
  assert.equal(globalDisabled.active_memory_resolution, "disabled_by_plugins_global");

  const denylisted = buildSustainedRuntimeBoundaryReport({
    openclawConfig: {
      plugins: {
        allow: ["active-memory"],
        deny: ["active-memory"],
        entries: { "active-memory": { enabled: true } },
      },
    },
    checkedAt: CHECKED_AT,
  });
  assert.equal(denylisted.status, "clean");
  assert.equal(denylisted.active_memory_resolution, "disabled_by_plugins_denylist");
  assert.equal(denylisted.active_memory_denylisted, true);
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

test("malformed plugin activation policy fails closed", () => {
  const invalidAllow = buildSustainedRuntimeBoundaryReport({
    openclawConfig: { plugins: { allow: "active-memory", entries: {} } },
    checkedAt: CHECKED_AT,
  });
  assert.equal(invalidAllow.status, "invalid");
  assert.ok(invalidAllow.blockers.includes("invalid_array:plugins.allow"));

  const invalidGlobal = buildSustainedRuntimeBoundaryReport({
    openclawConfig: { plugins: { enabled: "false", entries: {} } },
    checkedAt: CHECKED_AT,
  });
  assert.equal(invalidGlobal.status, "invalid");
  assert.ok(invalidGlobal.blockers.includes("invalid_boolean:plugins.enabled"));
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
