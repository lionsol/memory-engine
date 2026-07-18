import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const evaluatorSource = readFileSync(new URL(
  "../lib/recall/hybrid/recent-fail-closed-rollback-validation.js",
  import.meta.url,
), "utf8");
const cliSource = readFileSync(new URL(
  "../bin/audit-recent-fail-closed-rollback-validation.js",
  import.meta.url,
), "utf8");

test("rollback validator is a pure report decision layer", () => {
  for (const forbidden of [
    "better-sqlite3",
    "withLegacyDb",
    "collectLegacyRecentCandidates",
    "hybridSearch",
    "channels/recent",
    "recentFailClosedMode =",
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
  ]) {
    assert.equal(evaluatorSource.includes(forbidden), false, `unexpected ${forbidden}`);
  }
  assert.match(evaluatorSource, /evaluateRecentFailClosedRollbackValidation/);
});

test("rollback validator CLI is read-only", () => {
  assert.match(cliSource, /--before-report/);
  assert.match(cliSource, /--after-report/);
  assert.match(cliSource, /readFileSync/);
  assert.doesNotMatch(cliSource, /better-sqlite3|withLegacyDb|hybridSearch|writeFileSync|setConfig/);
});
