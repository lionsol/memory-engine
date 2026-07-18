import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  auditRecentFailClosedCanaryExpansion,
  exitCodeForDecision,
  parseArgs,
  usage,
} from "../bin/audit-recent-fail-closed-canary-expansion.js";

const readiness = { decision: { class: "ready_for_canary" } };
const review = { status: "healthy" };
const rollout = {
  applied_events: 800,
  window_days: 45,
  candidate_loss_ratio: 0,
  empty_candidate_rate: 0,
  scope_mismatch_rate: 0,
  high_risk_events: 0,
  medium_risk_events: 0,
  stable_reviews: 5,
};

function writeReports(root, values) {
  const paths = {};
  for (const [name, value] of Object.entries(values)) {
    paths[name] = join(root, `${name}.json`);
    writeFileSync(paths[name], JSON.stringify(value));
  }
  return paths;
}

async function run(values = { readiness, review, rollout }) {
  const root = mkdtempSync(join(tmpdir(), "recent-canary-expansion-cli-"));
  const paths = writeReports(root, values);
  try {
    return await auditRecentFailClosedCanaryExpansion([
      "--readiness-report", paths.readiness,
      "--review-report", paths.review,
      "--rollout-report", paths.rollout,
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("CLI maps expansion decision to exit code 0", async () => {
  const result = await run();
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.output).decision, "expand");
});

test("CLI maps continue decision to exit code 1", async () => {
  const result = await run({ readiness, review, rollout: { ...rollout, stable_reviews: 1 } });
  assert.equal(result.exitCode, 1);
  assert.equal(JSON.parse(result.output).decision, "continue_current_canary");
});

test("CLI maps insufficient data to exit code 2", async () => {
  const result = await run({ readiness: {}, review, rollout: {} });
  assert.equal(result.exitCode, 2);
  assert.equal(JSON.parse(result.output).decision, "insufficient_data");
});

test("CLI maps rollback to exit code 3", async () => {
  const result = await run({ readiness, review: { status: "rollback_required" }, rollout });
  assert.equal(result.exitCode, 3);
  assert.equal(JSON.parse(result.output).decision, "rollback");
});

test("CLI rejects invalid input with exit code 4 contract", async () => {
  const root = mkdtempSync(join(tmpdir(), "recent-canary-expansion-cli-invalid-"));
  const readinessPath = join(root, "readiness.json");
  writeFileSync(readinessPath, "not-json");
  try {
    await assert.rejects(
      auditRecentFailClosedCanaryExpansion(["--readiness-report", readinessPath]),
      /failed to read readiness report JSON/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.equal(exitCodeForDecision("expand"), 0);
  assert.equal(exitCodeForDecision("continue_current_canary"), 1);
  assert.equal(exitCodeForDecision("insufficient_data"), 2);
  assert.equal(exitCodeForDecision("rollback"), 3);
  assert.equal(exitCodeForDecision("invalid"), 4);
});

test("CLI rejects unknown flags and advertises read-only behavior", () => {
  assert.throws(() => parseArgs(["--apply"]), /unknown argument/);
  assert.match(usage(), /never changes rollout configuration/);
});
