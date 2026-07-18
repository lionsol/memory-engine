import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  auditRecentFailClosedCanaryReadiness,
  exitCodeForDecision,
  parseArgs,
  usage,
} from "../bin/audit-recent-fail-closed-canary-readiness.js";

function writeReports(root, evidence = {}, shadow = {}) {
  const evidencePath = join(root, "evidence.json");
  const shadowPath = join(root, "shadow.json");
  writeFileSync(evidencePath, JSON.stringify(evidence));
  writeFileSync(shadowPath, JSON.stringify(shadow));
  return { evidencePath, shadowPath };
}

function completeReports() {
  return {
    evidence: {
      window: { duration_days: 14 },
      counts: {
        production_events: 100,
        production_by_surface: {
          auto_recall: 40,
          memory_engine_action_search: 30,
          memory_engine_search: 30,
        },
      },
      decision: "ready",
    },
    shadow: {
      recent_fail_closed_shadow: {
        events: 10,
        max_candidate_loss_ratio: 0,
        risk_level_distribution: { low: 10 },
      },
    },
  };
}

test("CLI returns ready_for_canary for complete reports", async () => {
  const root = mkdtempSync(join(tmpdir(), "recent-canary-readiness-cli-"));
  try {
    const reports = completeReports();
    const paths = writeReports(root, reports.evidence, reports.shadow);
    const result = await auditRecentFailClosedCanaryReadiness([
      "--evidence-window", paths.evidencePath,
      "--shadow-report", paths.shadowPath,
    ]);
    assert.equal(result.exitCode, 0);
    assert.equal(JSON.parse(result.output).decision.class, "ready_for_canary");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI maps readiness decisions to exit codes", () => {
  assert.equal(exitCodeForDecision("ready_for_canary"), 0);
  assert.equal(exitCodeForDecision("insufficient_evidence"), 1);
  assert.equal(exitCodeForDecision("blocked"), 2);
});

test("CLI empty input is insufficient and mutation flags are rejected", async () => {
  const result = await auditRecentFailClosedCanaryReadiness([]);
  assert.equal(result.exitCode, 1);
  assert.equal(JSON.parse(result.output).decision.class, "insufficient_evidence");
  assert.throws(() => parseArgs(["--apply"]), /unknown argument/);
  assert.match(usage(), /never opens a database/);
});
