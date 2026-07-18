import test from "node:test";
import assert from "node:assert/strict";

import { evaluateRecentFailClosedCanaryReview } from "../lib/recall/hybrid/recent-fail-closed-canary-review.js";

function healthyInput(overrides = {}) {
  return {
    runtimeMetrics: {
      enabled_events: 100,
      scope_match_events: 100,
      applied_events: 100,
      suppressed_fallback_events: 100,
      empty_candidate_events: 0,
      ...overrides.runtimeMetrics,
    },
    shadowMetrics: {
      evaluated_events: 100,
      max_candidate_loss_ratio: 0,
      high_risk_events: 0,
      medium_risk_events: 0,
      low_risk_events: 100,
      ...overrides.shadowMetrics,
    },
    thresholds: overrides.thresholds,
  };
}

test("empty metrics require more data", () => {
  const result = evaluateRecentFailClosedCanaryReview({ runtimeMetrics: {}, shadowMetrics: {} });
  assert.equal(result.status, "insufficient_data");
  assert.equal(result.recommendation, "collect_more_data");
  assert.ok(result.evidence_gaps.some(issue => issue.code === "missing_runtime_telemetry"));
  assert.ok(result.evidence_gaps.some(issue => issue.code === "missing_shadow_telemetry"));
});

test("healthy canary recommends continuing the current scope", () => {
  const result = evaluateRecentFailClosedCanaryReview(healthyInput());
  assert.equal(result.status, "healthy");
  assert.equal(result.recommendation, "continue_canary");
  assert.deepEqual(result.blockers, []);
});

test("insufficient applied events do not imply rollback", () => {
  const result = evaluateRecentFailClosedCanaryReview(healthyInput({
    runtimeMetrics: { enabled_events: 10, scope_match_events: 10, applied_events: 10, suppressed_fallback_events: 10 },
    shadowMetrics: { evaluated_events: 10, low_risk_events: 10 },
  }));
  assert.equal(result.status, "insufficient_data");
  assert.ok(result.evidence_gaps.some(issue => issue.code === "insufficient_applied_events"));
});

test("empty candidate regression requires rollback", () => {
  const result = evaluateRecentFailClosedCanaryReview(healthyInput({
    runtimeMetrics: { empty_candidate_events: 10 },
  }));
  assert.equal(result.status, "rollback_required");
  assert.ok(result.blockers.some(issue => issue.code === "empty_candidate_rate_exceeded"));
});

test("candidate loss above threshold requires rollback", () => {
  const result = evaluateRecentFailClosedCanaryReview(healthyInput({
    shadowMetrics: { max_candidate_loss_ratio: 0.2 },
  }));
  assert.equal(result.status, "rollback_required");
  assert.ok(result.blockers.some(issue => issue.code === "candidate_loss_ratio_exceeded"));
});

test("high risk overrides insufficient sample size", () => {
  const result = evaluateRecentFailClosedCanaryReview(healthyInput({
    runtimeMetrics: { enabled_events: 5, scope_match_events: 5, applied_events: 5, suppressed_fallback_events: 5 },
    shadowMetrics: { evaluated_events: 5, high_risk_events: 1 },
  }));
  assert.equal(result.status, "rollback_required");
  assert.ok(result.blockers.some(issue => issue.code === "high_risk_events_exceeded"));
});

test("medium risk requires rollback by default", () => {
  const result = evaluateRecentFailClosedCanaryReview(healthyInput({
    shadowMetrics: { medium_risk_events: 1 },
  }));
  assert.equal(result.status, "rollback_required");
  assert.ok(result.blockers.some(issue => issue.code === "medium_risk_events_exceeded"));
});

test("scope mismatch above threshold requires rollback", () => {
  const result = evaluateRecentFailClosedCanaryReview(healthyInput({
    runtimeMetrics: { enabled_events: 100, scope_match_events: 80 },
  }));
  assert.equal(result.status, "rollback_required");
  assert.equal(result.evidence.runtime.scope_mismatch_rate, 0.2);
  assert.ok(result.blockers.some(issue => issue.code === "scope_mismatch_rate_exceeded"));
});

test("runtime applied and suppression counts must agree", () => {
  const result = evaluateRecentFailClosedCanaryReview(healthyInput({
    runtimeMetrics: { suppressed_fallback_events: 0 },
  }));
  assert.equal(result.status, "rollback_required");
  assert.ok(result.blockers.some(issue => issue.code === "runtime_telemetry_inconsistent"));
});

test("non-numeric and negative telemetry fields are invalid", () => {
  const result = evaluateRecentFailClosedCanaryReview(healthyInput({
    runtimeMetrics: { enabled_events: "100", empty_candidate_events: -1 },
  }));
  assert.equal(result.status, "rollback_required");
  assert.ok(result.blockers.some(issue => issue.code === "invalid_runtime_metrics"));
});

test("threshold equality is allowed", () => {
  const result = evaluateRecentFailClosedCanaryReview(healthyInput({
    runtimeMetrics: { empty_candidate_events: 1 },
    thresholds: { max_empty_candidate_rate: 0.01 },
  }));
  assert.equal(result.status, "healthy");
  assert.equal(result.evidence.runtime.empty_candidate_rate, 0.01);
});
