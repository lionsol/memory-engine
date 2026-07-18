import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const evaluatorSource = readFileSync(new URL(
  "../lib/recall/hybrid/recent-fail-closed-canary-expansion.js",
  import.meta.url,
), "utf8");
const cliSource = readFileSync(new URL(
  "../bin/audit-recent-fail-closed-canary-expansion.js",
  import.meta.url,
), "utf8");

test("expansion evaluator is a pure decision layer", () => {
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
  assert.match(evaluatorSource, /evaluateRecentFailClosedCanaryExpansion/);
});

test("expansion CLI only reads reports and does not mutate rollout", () => {
  assert.match(cliSource, /--readiness-report/);
  assert.match(cliSource, /--review-report/);
  assert.match(cliSource, /--rollout-report/);
  assert.match(cliSource, /readFileSync/);
  assert.doesNotMatch(cliSource, /better-sqlite3|withLegacyDb|hybridSearch|setConfig|writeFileSync/);
});
