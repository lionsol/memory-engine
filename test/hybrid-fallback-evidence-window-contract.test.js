import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL(
  "../lib/recall/hybrid/fallback-evidence-window.js",
  import.meta.url,
), "utf8");
const cliSource = readFileSync(new URL(
  "../bin/audit-hybrid-fallback-evidence-window.js",
  import.meta.url,
), "utf8");

test("evidence window evaluator is pure and database independent", () => {
  assert.match(source, /evaluateHybridFallbackEvidenceWindow/);
  assert.match(source, /createHybridFallbackEvidenceSnapshot/);
  assert.match(source, /completed_at/);
  assert.match(source, /created_at/);
  assert.doesNotMatch(source, /better-sqlite3/);
  assert.doesNotMatch(source, /withLegacyDb/);
  assert.doesNotMatch(source, /hybridSearch/);
  assert.doesNotMatch(source, /ATTACH DATABASE/);
  assert.doesNotMatch(source, /SELECT\s+.+chunks/i);
});

test("evidence window CLI only reads JSON", () => {
  assert.match(cliSource, /--events/);
  assert.match(cliSource, /readFileSync/);
  assert.doesNotMatch(cliSource, /better-sqlite3/);
  assert.doesNotMatch(cliSource, /withLegacyDb/);
  assert.doesNotMatch(cliSource, /hybridSearch/);
});
