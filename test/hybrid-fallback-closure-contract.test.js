import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const evaluatorSource = readFileSync(new URL(
  "../lib/recall/hybrid/fallback-closure-readiness.js",
  import.meta.url,
), "utf8");
const cliSource = readFileSync(new URL(
  "../bin/audit-hybrid-fallback-closure-readiness.js",
  import.meta.url,
), "utf8");

test("closure evaluator is a decision layer, not a runtime or database layer", () => {
  assert.match(evaluatorSource, /evaluateHybridFallbackClosureReadiness/);
  assert.match(evaluatorSource, /hybridObservability/);
  assert.match(evaluatorSource, /kgAudit/);
  assert.match(evaluatorSource, /recentAudit/);
  assert.doesNotMatch(evaluatorSource, /better-sqlite3/);
  assert.doesNotMatch(evaluatorSource, /withLegacyDb/);
  assert.doesNotMatch(evaluatorSource, /legacy fallback query/i);
  assert.doesNotMatch(evaluatorSource, /hybridSearch/);
});

test("closure CLI reads JSON and does not open a database", () => {
  assert.match(cliSource, /--metrics-report/);
  assert.match(cliSource, /--kg-report/);
  assert.match(cliSource, /--recent-report/);
  assert.match(cliSource, /readFileSync/);
  assert.doesNotMatch(cliSource, /better-sqlite3/);
  assert.doesNotMatch(cliSource, /withLegacyDb/);
  assert.doesNotMatch(cliSource, /hybridSearch/);
});

test("runtime and channel files are outside the closure evaluator boundary", () => {
  assert.doesNotMatch(evaluatorSource, /kg-access\.js|recent-access\.js|hybrid-search\.js/);
});
