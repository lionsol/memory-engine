import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Recent shadow evaluator is a pure evaluation layer", () => {
  const source = readFileSync(new URL("../lib/recall/hybrid/recent-fail-closed-shadow.js", import.meta.url), "utf8");
  for (const forbidden of ["better-sqlite3", "SELECT", "INSERT", "UPDATE", "DELETE", "withLegacyDb", "hybridSearch", "fallback query"]) {
    assert.equal(source.includes(forbidden), false, `unexpected ${forbidden}`);
  }
});
