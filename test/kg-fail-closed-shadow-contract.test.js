import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL(
  "../lib/recall/hybrid/kg-fail-closed-shadow.js",
  import.meta.url,
), "utf8");

test("KG shadow evaluator is a pure evaluation layer", () => {
  assert.match(source, /evaluateKgFailClosedShadow/);
  assert.match(source, /shadow_fail_closed/);
  assert.doesNotMatch(source, /better-sqlite3/);
  assert.doesNotMatch(source, /withLegacyDb/);
  assert.doesNotMatch(source, /\bSELECT\b/);
  assert.doesNotMatch(source, /\bINSERT\b/);
  assert.doesNotMatch(source, /\bUPDATE\b/);
  assert.doesNotMatch(source, /\bDELETE\b/);
  assert.doesNotMatch(source, /hybridSearch/);
});
