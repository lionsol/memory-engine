import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const evaluatorSource = readFileSync(new URL(
  "../lib/recall/hybrid/recent-fail-closed-canary-review.js",
  import.meta.url,
), "utf8");
const cliSource = readFileSync(new URL(
  "../bin/audit-recent-fail-closed-canary-review.js",
  import.meta.url,
), "utf8");

test("review evaluator is a pure telemetry decision layer", () => {
  for (const forbidden of [
    "better-sqlite3",
    "withLegacyDb",
    "collectLegacyRecentCandidates",
    "hybridSearch",
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
  ]) {
    assert.equal(evaluatorSource.includes(forbidden), false, `unexpected ${forbidden}`);
  }
  assert.match(evaluatorSource, /evaluateRecentFailClosedCanaryReview/);
});

test("review CLI reads JSON only and exposes decision exit states", () => {
  assert.match(cliSource, /--runtime-report/);
  assert.match(cliSource, /--shadow-report/);
  assert.match(cliSource, /--thresholds/);
  assert.match(cliSource, /readFileSync/);
  assert.doesNotMatch(cliSource, /better-sqlite3|withLegacyDb|hybridSearch|collectLegacyRecentCandidates/);
});
