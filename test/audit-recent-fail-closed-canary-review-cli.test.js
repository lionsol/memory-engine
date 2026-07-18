import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  auditRecentFailClosedCanaryReview,
  exitCodeForStatus,
  parseArgs,
  usage,
} from "../bin/audit-recent-fail-closed-canary-review.js";

function writeReports(root, runtime, shadow, thresholds) {
  const runtimePath = join(root, "runtime.json");
  const shadowPath = join(root, "shadow.json");
  writeFileSync(runtimePath, JSON.stringify(runtime));
  writeFileSync(shadowPath, JSON.stringify(shadow));
  const paths = { runtimePath, shadowPath };
  if (thresholds) {
    paths.thresholdsPath = join(root, "thresholds.json");
    writeFileSync(paths.thresholdsPath, JSON.stringify(thresholds));
  }
  return paths;
}

const healthyRuntime = {
  recent_fail_closed_canary_runtime: {
    enabled_events: 100,
    scope_match_events: 100,
    applied_events: 100,
    suppressed_fallback_events: 100,
    empty_candidate_events: 0,
  },
};
const healthyShadow = {
  recent_fail_closed_shadow: {
    evaluated_events: 100,
    max_candidate_loss_ratio: 0,
    risk_level_distribution: { low: 100 },
  },
};

async function runWithFiles(runtime = healthyRuntime, shadow = healthyShadow) {
  const root = mkdtempSync(join(tmpdir(), "recent-canary-review-cli-"));
  const paths = writeReports(root, runtime, shadow);
  try {
    return await auditRecentFailClosedCanaryReview([
      "--runtime-report", paths.runtimePath,
      "--shadow-report", paths.shadowPath,
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("CLI returns healthy with exit code 0", async () => {
  const result = await runWithFiles();
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.output).status, "healthy");
});

test("CLI returns insufficient data with exit code 1", async () => {
  const result = await runWithFiles({}, {});
  assert.equal(result.exitCode, 1);
  assert.equal(JSON.parse(result.output).status, "insufficient_data");
});

test("CLI returns rollback required with exit code 2", async () => {
  const result = await runWithFiles(healthyRuntime, {
    recent_fail_closed_shadow: {
      evaluated_events: 100,
      max_candidate_loss_ratio: 0.2,
      risk_level_distribution: { low: 100 },
    },
  });
  assert.equal(result.exitCode, 2);
  assert.equal(JSON.parse(result.output).status, "rollback_required");
});

test("CLI returns exit code 3 for invalid JSON", async () => {
  const root = mkdtempSync(join(tmpdir(), "recent-canary-review-cli-invalid-"));
  const runtimePath = join(root, "runtime.json");
  writeFileSync(runtimePath, "not-json");
  try {
    await assert.rejects(
      auditRecentFailClosedCanaryReview(["--runtime-report", runtimePath]),
      /failed to read runtime report JSON/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.equal(exitCodeForStatus("healthy"), 0);
  assert.equal(exitCodeForStatus("insufficient_data"), 1);
  assert.equal(exitCodeForStatus("rollback_required"), 2);
  assert.equal(exitCodeForStatus("unknown"), 3);
});

test("CLI rejects mutation and unknown flags", () => {
  assert.throws(() => parseArgs(["--apply"]), /unknown argument/);
  assert.match(usage(), /never opens a database or runtime connection/);
});
