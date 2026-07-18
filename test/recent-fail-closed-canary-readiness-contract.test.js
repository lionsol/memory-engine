import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const evaluatorSource = readFileSync(new URL(
  "../lib/recall/hybrid/recent-fail-closed-canary-readiness.js",
  import.meta.url,
), "utf8");
const cliSource = readFileSync(new URL(
  "../bin/audit-recent-fail-closed-canary-readiness.js",
  import.meta.url,
), "utf8");

test("Recent canary readiness is a pure decision layer", () => {
  for (const forbidden of [
    "better-sqlite3",
    "withLegacyDb",
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "collectLegacyRecentCandidates",
    "hybridSearch",
  ]) {
    assert.equal(evaluatorSource.includes(forbidden), false, `unexpected ${forbidden}`);
  }
  assert.match(evaluatorSource, /evaluateRecentFailClosedCanaryReadiness/);
});

test("Recent canary readiness CLI reads JSON only", () => {
  assert.match(cliSource, /--evidence-window/);
  assert.match(cliSource, /--shadow-report/);
  assert.match(cliSource, /readFileSync/);
  assert.doesNotMatch(cliSource, /better-sqlite3|withLegacyDb|hybridSearch/);
});
