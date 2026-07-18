import test from "node:test";
import assert from "node:assert/strict";

import { evaluateRecentFailClosedCanaryExpansion } from "../lib/recall/hybrid/recent-fail-closed-canary-expansion.js";

function input(overrides = {}) {
  return {
    readiness: { decision: { class: "ready_for_canary" } },
    review: overrides.review || { status: "healthy" },
    rolloutMetrics: {
      applied_events: 800,
      window_days: 45,
      candidate_loss_ratio: 0.001,
      empty_candidate_rate: 0,
      scope_mismatch_rate: 0,
      high_risk_events: 0,
      medium_risk_events: 0,
      stable_reviews: 5,
      ...overrides.rolloutMetrics,
    },
    thresholds: overrides.thresholds,
  };
}

test("rollback takes precedence over expansion", () => {
  const result = evaluateRecentFailClosedCanaryExpansion(input({
    review: { status: "rollback_required", blockers: [{ code: "candidate_loss_ratio_exceeded" }] },
  }));
  assert.equal(result.decision, "rollback");
});

test("missing readiness or rollout evidence is insufficient data", () => {
  const result = evaluateRecentFailClosedCanaryExpansion({
    readiness: {},
    review: { status: "healthy" },
    rolloutMetrics: {},
  });
  assert.equal(result.decision, "insufficient_data");
  assert.ok(result.evidence_gaps.length > 0);
});

test("healthy canary continues when stable review threshold is not met", () => {
  const result = evaluateRecentFailClosedCanaryExpansion(input({
    rolloutMetrics: { stable_reviews: 2 },
  }));
  assert.equal(result.decision, "continue_current_canary");
});

test("all expansion requirements produce expand", () => {
  const result = evaluateRecentFailClosedCanaryExpansion(input());
  assert.equal(result.decision, "expand");
  assert.equal(result.evidence.applied_events, 800);
  assert.equal(result.evidence.window_days, 45);
  assert.equal(result.evidence.stable_reviews, 5);
  assert.deepEqual(result.blockers, []);
});

test("candidate loss above expansion threshold rolls back", () => {
  const result = evaluateRecentFailClosedCanaryExpansion(input({
    rolloutMetrics: { candidate_loss_ratio: 0.03 },
  }));
  assert.equal(result.decision, "rollback");
  assert.ok(result.blockers.some(issue => issue.code === "candidate_loss_ratio_exceeded"));
});

test("risk events prevent expansion and require rollback", () => {
  const result = evaluateRecentFailClosedCanaryExpansion(input({
    rolloutMetrics: { high_risk_events: 1 },
  }));
  assert.equal(result.decision, "rollback");
  assert.ok(result.blockers.some(issue => issue.code === "high_risk_events_present"));
});

test("scope mismatch keeps the current canary active", () => {
  const result = evaluateRecentFailClosedCanaryExpansion(input({
    rolloutMetrics: { scope_mismatch_rate: 0.01 },
  }));
  assert.equal(result.decision, "continue_current_canary");
});

test("threshold overrides are supported", () => {
  const result = evaluateRecentFailClosedCanaryExpansion(input({
    rolloutMetrics: { stable_reviews: 1, candidate_loss_ratio: 0.04 },
    thresholds: { max_candidate_loss_ratio: 0.05, required_stable_reviews: 1 },
  }));
  assert.equal(result.decision, "expand");
});
