import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import effectiveConfigCli from "../bin/build-effective-hybrid-runtime-config-report.js";
import { buildEffectiveRuntimeConfigReport } from "../lib/recall/hybrid/effective-runtime-config-report.js";

const CHECKED_AT = "2026-07-20T03:00:00.000Z";

function config(overrides = {}) {
  return {
    providerSecret: "do-not-copy",
    plugins: {
      entries: {
        "memory-engine": {
          enabled: true,
          config: {
            recentFailClosedCanary: {
              enabled: false,
              token: "private-canary-token",
            },
            ...overrides,
          },
        },
      },
    },
  };
}

test("effective config report matches runtime resolution and replaces canary tokens with counts", () => {
  const report = buildEffectiveRuntimeConfigReport({
    openclawConfig: config(),
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.valid, true);
  assert.match(report.rollout_config_fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(report.effective_config.kgFailClosedMode, "legacy_fallback");
  assert.equal(report.effective_config.recentFailClosedCanary.token_count, 1);
  assert.equal(Object.hasOwn(report.effective_config.recentFailClosedCanary, "tokens"), false);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("private-canary-token"), false);
  assert.equal(serialized.includes("do-not-copy"), false);
});

test("missing, disabled, or malformed memory-engine plugin entries fail closed", () => {
  for (const openclawConfig of [
    { plugins: { entries: {} } },
    { plugins: { entries: { "memory-engine": { enabled: false, config: {} } } } },
    { plugins: { entries: { "memory-engine": { enabled: true, config: "bad" } } } },
  ]) {
    const report = buildEffectiveRuntimeConfigReport({ openclawConfig, checkedAt: CHECKED_AT });
    assert.equal(report.valid, false);
    assert.equal(report.effective_config, null);
    assert.equal(report.rollout_config_fingerprint, null);
  }
});

test("invalid evidence-window config remains invalid in the report", () => {
  const report = buildEffectiveRuntimeConfigReport({
    openclawConfig: config({ productionEvidenceWindow: { enabled: true } }),
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.valid, false);
  assert.equal(report.rollout_config_fingerprint, null);
  assert.ok(report.errors.includes("missing_string:productionEvidenceWindow.epochId"));
});

test("effective config CLI writes only the reduced report", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-effective-config-"));
  const configPath = join(root, "openclaw.json");
  const outPath = join(root, "effective.json");
  writeFileSync(configPath, JSON.stringify(config()), "utf8");
  const result = await effectiveConfigCli.buildEffectiveHybridRuntimeConfigCli([
    "--config", configPath,
    "--checked-at", CHECKED_AT,
    "--out", outPath,
    "--pretty",
  ]);
  assert.equal(result.exitCode, 0);
  const output = readFileSync(outPath, "utf8");
  assert.equal(output.includes("private-canary-token"), false);
  assert.equal(output.includes("do-not-copy"), false);
  assert.equal(JSON.parse(output).valid, true);
});
