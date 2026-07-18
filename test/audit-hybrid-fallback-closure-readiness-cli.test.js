import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  auditHybridFallbackClosureReadiness,
  exitCodeForDecision,
  parseArgs,
  usage,
} from "../bin/audit-hybrid-fallback-closure-readiness.js";

function reports() {
  return {
    metrics: {
      window_days: 14,
      observed_hybrid_events: 100,
      fully_observed_events: 100,
      partial_observed_events: 0,
      fallback_events: 0,
      unknown_surface_events: 0,
      missing_schema_version_events: 0,
      unsupported_schema_version_events: 0,
      production_observed_by_surface: {
        auto_recall: 20,
        memory_engine_action_search: 20,
        memory_engine_search: 60,
      },
    },
    kg: { decision: { class: "pass" }, kg_canary_passed: false },
    recent: { decision: { class: "pass_canary_readiness" }, recent_canary_passed: false },
  };
}

test("CLI parses report paths and returns JSON without database access", async () => {
  const root = mkdtempSync(join(tmpdir(), "hybrid-closure-cli-"));
  try {
    const input = reports();
    const metricsPath = join(root, "metrics.json");
    const kgPath = join(root, "kg.json");
    const recentPath = join(root, "recent.json");
    writeFileSync(metricsPath, JSON.stringify({ hybrid_fallback_observability: input.metrics }));
    writeFileSync(kgPath, JSON.stringify(input.kg));
    writeFileSync(recentPath, JSON.stringify(input.recent));

    const result = await auditHybridFallbackClosureReadiness([
      "--metrics-report", metricsPath,
      "--kg-report", kgPath,
      "--recent-report", recentPath,
    ]);
    assert.equal(result.exitCode, 0);
    assert.equal(JSON.parse(result.output).decision.class, "ready_for_fail_closed_canary");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI maps decision classes to the documented exit codes", () => {
  assert.equal(exitCodeForDecision("ready_for_shadow_fail_closed"), 0);
  assert.equal(exitCodeForDecision("ready_for_fail_closed_canary"), 0);
  assert.equal(exitCodeForDecision("ready_for_removal"), 0);
  assert.equal(exitCodeForDecision("insufficient_evidence"), 1);
  assert.equal(exitCodeForDecision("blocked"), 2);
});

test("CLI with no reports is insufficient evidence and mutation arguments are rejected", async () => {
  const empty = await auditHybridFallbackClosureReadiness([]);
  assert.equal(empty.exitCode, 1);
  assert.equal(JSON.parse(empty.output).decision.class, "insufficient_evidence");
  assert.throws(() => parseArgs(["--apply"]), /unknown argument/);
  assert.match(usage(), /never opens a database/);
});

test("CLI reports explicit canary failure as blocked", async () => {
  const root = mkdtempSync(join(tmpdir(), "hybrid-closure-cli-failed-canary-"));
  try {
    const input = reports();
    const metricsPath = join(root, "metrics.json");
    const kgPath = join(root, "kg.json");
    const recentPath = join(root, "recent.json");
    writeFileSync(metricsPath, JSON.stringify({ hybrid_fallback_observability: input.metrics }));
    writeFileSync(kgPath, JSON.stringify({ ...input.kg, canary: { status: "failed" } }));
    writeFileSync(recentPath, JSON.stringify({ ...input.recent, canary: { status: "passed" } }));

    const result = await auditHybridFallbackReadinessWithPaths(metricsPath, kgPath, recentPath);
    assert.equal(result.exitCode, 2);
    assert.equal(JSON.parse(result.output).decision.class, "blocked");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

async function auditHybridFallbackReadinessWithPaths(metricsPath, kgPath, recentPath) {
  return auditHybridFallbackClosureReadiness([
    "--metrics-report", metricsPath,
    "--kg-report", kgPath,
    "--recent-report", recentPath,
  ]);
}
