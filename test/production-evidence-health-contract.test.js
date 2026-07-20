import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const productionFiles = [
  "../lib/recall/hybrid/production-evidence-health-monitor.js",
  "../bin/audit-production-evidence-health.js",
];

test("health monitor and CLI are report-only and runtime independent", () => {
  const forbidden = [
    "better-sqlite3",
    "withLegacyDb",
    "hybridSearch(",
    "openclaw/plugin-sdk",
    "openclaw gateway",
    "setConfig",
    "writeFileSync",
    "unlinkSync",
    "rmSync",
  ];
  for (const path of productionFiles) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    for (const token of forbidden) assert.equal(source.includes(token), false, `${path} contains ${token}`);
  }
});
test("health monitor exposes explicit status and stop-condition contracts", async () => {
  const module = await import("../lib/recall/hybrid/production-evidence-health-monitor.js");
  assert.equal(typeof module.evaluateProductionEvidenceHealth, "function");
  assert.equal(typeof module.validateProductionEvidenceMonitorThresholds, "function");
  assert.deepEqual(module.DEFAULT_PRODUCTION_EVIDENCE_MONITOR_THRESHOLDS, {
    maximum_latest_observation_age_hours: 26,
    maximum_healthcheck_age_hours: 26,
    maximum_runtime_parity_age_hours: 26,
    maximum_product_health_age_hours: 26,
  });
});
