import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const evaluatorSource = readFileSync(new URL(
  "../lib/recall/hybrid/legacy-fallback-removal-gate.js",
  import.meta.url,
), "utf8");
const cliSource = readFileSync(new URL(
  "../bin/audit-legacy-fallback-removal-gate.js",
  import.meta.url,
), "utf8");

test("removal gate is a pure report composition layer", () => {
  for (const forbidden of [
    "better-sqlite3",
    "withLegacyDb",
    "collectLegacyRecentCandidates",
    "hybridSearch",
    "channels/recent",
    "channels/kg",
    "unlinkSync",
    "rmSync",
    "writeFileSync",
  ]) {
    assert.equal(evaluatorSource.includes(forbidden), false, `unexpected ${forbidden}`);
  }
  assert.match(evaluatorSource, /evaluateLegacyFallbackRemovalGate/);
});

test("removal gate CLI only reads supplied JSON reports", () => {
  for (const flag of [
    "--closure-report",
    "--evidence-window-report",
    "--kg-rollout-report",
    "--recent-review-report",
    "--recent-expansion-report",
    "--recent-rollback-report",
    "--production-rollout-report",
    "--code-reachability-report",
    "--rollback-strategy-report",
  ]) assert.match(cliSource, new RegExp(flag));
  assert.match(cliSource, /readFileSync/);
  assert.doesNotMatch(cliSource, /better-sqlite3|withLegacyDb|hybridSearch|unlinkSync|rmSync|writeFileSync/);
});
