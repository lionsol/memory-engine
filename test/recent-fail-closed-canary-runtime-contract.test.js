import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const policySource = readFileSync(new URL(
  "../lib/recall/hybrid/recent-fail-closed-policy.js",
  import.meta.url,
), "utf8");
const channelSource = readFileSync(new URL(
  "../lib/recall/hybrid/channels/recent.js",
  import.meta.url,
), "utf8");
const hybridSource = readFileSync(new URL(
  "../lib/recall/hybrid-search.js",
  import.meta.url,
), "utf8");
const indexSource = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const actionsSource = readFileSync(new URL(
  "../lib/tools/memory-engine-actions.js",
  import.meta.url,
), "utf8");

test("policy is free of database and legacy query dependencies", () => {
  for (const forbidden of ["better-sqlite3", "SELECT", "INSERT", "UPDATE", "DELETE", "withLegacyDb"]) {
    assert.equal(policySource.includes(forbidden), false, `unexpected ${forbidden}`);
  }
  assert.match(policySource, /evaluateRecentFailClosedPolicy/);
});

test("runtime keeps legacy fallback and contains only scoped suppression", () => {
  assert.match(channelSource, /collectLegacyRecentCandidates\(ctx\)/);
  assert.match(channelSource, /recentFailClosedDecision\?\.eligible === true/);
  assert.match(channelSource, /recent_fail_closed_fallback_suppressed/);
  assert.doesNotMatch(channelSource, /recentFailClosedMode.*always|force.*fail_closed/i);
});

test("production wiring forwards the Recent canary configuration", () => {
  assert.match(hybridSource, /evaluateRecentFailClosedPolicy/);
  assert.match(hybridSource, /recentFailClosedMode/);
  assert.match(hybridSource, /recentFailClosedCanary/);
  assert.match(indexSource, /recentFailClosedMode/);
  assert.match(indexSource, /recentFailClosedCanary/);
  assert.match(actionsSource, /recentFailClosedMode/);
  assert.match(actionsSource, /recentFailClosedCanary/);
});

test("policy supports only the documented fail-closed modes", () => {
  assert.match(policySource, /legacy_fallback/);
  assert.match(policySource, /shadow_fail_closed/);
  assert.match(policySource, /fail_closed_canary/);
  assert.match(policySource, /full_fail_closed/);
});
