import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL(
  "../lib/recall/hybrid/full-fail-closed-rollout-evidence.js",
  import.meta.url,
), "utf8");
const cliSource = readFileSync(new URL(
  "../bin/audit-full-fail-closed-rollout-evidence.js",
  import.meta.url,
), "utf8");

test("rollout evidence builder is pure and database independent", () => {
  assert.match(source, /buildFullFailClosedRolloutEvidence/);
  assert.match(source, /evaluateHybridFallbackEvidenceWindow/);
  assert.match(source, /PRODUCTION_SURFACES/);
  for (const forbidden of [
    "better-sqlite3",
    "withLegacyDb",
    "collectLegacyRecentCandidates",
    "hybridSearch",
    "channels/recent",
    "channels/kg",
    "writeFileSync",
    "unlinkSync",
    "rmSync",
    "setConfig",
  ]) assert.equal(source.includes(forbidden), false, `unexpected ${forbidden}`);
});

test("rollout evidence CLI only reads JSON or JSONL", () => {
  assert.match(cliSource, /--observations/);
  assert.match(cliSource, /JSONL/);
  assert.match(cliSource, /readFileSync/);
  assert.doesNotMatch(cliSource, /better-sqlite3|withLegacyDb|hybridSearch|writeFileSync|setConfig/);
});
