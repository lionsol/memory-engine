import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateRecentFailClosedCanaryReadiness,
} from "../lib/recall/hybrid/recent-fail-closed-canary-readiness.js";

const SURFACES = {
  auto_recall: 40,
  memory_engine_action_search: 30,
  memory_engine_search: 30,
};

function evidenceWindow(overrides = {}) {
  return {
    window: { duration_days: 14 },
    counts: {
      production_events: 100,
      production_by_surface: { ...SURFACES },
      unknown_surface_events: 0,
      unsupported_schema_version_events: 0,
      invalid_observation_events: 0,
    },
    gaps: [],
    blockers: [],
    decision: "ready",
    ...overrides,
  };
}

function shadowMetrics(overrides = {}) {
  return {
    recent_fail_closed_shadow: {
      events: 10,
      would_fail_closed_events: 0,
      average_candidate_loss_ratio: 0,
      max_candidate_loss_ratio: 0,
      risk_level_distribution: { low: 10 },
      ...overrides,
    },
  };
}

test("empty evidence is insufficient", () => {
  const result = evaluateRecentFailClosedCanaryReadiness({});
  assert.equal(result.decision.class, "insufficient_evidence");
  assert.equal(result.blockers.length, 0);
});

test("short evidence window is insufficient", () => {
  const result = evaluateRecentFailClosedCanaryReadiness({
    evidenceWindow: evidenceWindow({ window: { duration_days: 3 } }),
    shadowMetrics: shadowMetrics(),
  });
  assert.equal(result.decision.class, "insufficient_evidence");
  assert.ok(result.evidence_gaps.includes("observation_window_below_threshold"));
});

test("high Recent shadow risk is blocked", () => {
  const result = evaluateRecentFailClosedCanaryReadiness({
    evidenceWindow: evidenceWindow(),
    shadowMetrics: shadowMetrics({ risk_level_distribution: { high: 1, low: 9 } }),
  });
  assert.equal(result.decision.class, "blocked");
  assert.ok(result.blockers.includes("recent_shadow_high_risk_present"));
});

test("candidate loss above threshold is blocked", () => {
  const result = evaluateRecentFailClosedCanaryReadiness({
    evidenceWindow: evidenceWindow(),
    shadowMetrics: shadowMetrics({ max_candidate_loss_ratio: 0.2 }),
  });
  assert.equal(result.decision.class, "blocked");
  assert.ok(result.blockers.includes("recent_shadow_candidate_loss_above_threshold"));
});

test("complete evidence is ready for Recent canary", () => {
  const result = evaluateRecentFailClosedCanaryReadiness({
    evidenceWindow: evidenceWindow(),
    shadowMetrics: shadowMetrics(),
  });
  assert.equal(result.decision.class, "ready_for_canary");
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.evidence_gaps, []);
});

test("medium Recent shadow risk is blocked by default", () => {
  const result = evaluateRecentFailClosedCanaryReadiness({
    evidenceWindow: evidenceWindow(),
    shadowMetrics: shadowMetrics({ risk_level_distribution: { medium: 1, low: 9 } }),
  });
  assert.equal(result.decision.class, "blocked");
  assert.ok(result.blockers.includes("recent_shadow_medium_risk_present"));
});

test("thresholds are configurable", () => {
  const result = evaluateRecentFailClosedCanaryReadiness({
    evidenceWindow: evidenceWindow(),
    shadowMetrics: shadowMetrics({
      risk_level_distribution: { medium: 1, low: 9 },
      max_candidate_loss_ratio: 0.1,
    }),
    thresholds: {
      max_medium_risk_events: 1,
      max_candidate_loss_ratio: 0.1,
    },
  });
  assert.equal(result.decision.class, "ready_for_canary");
});

test("unexpected suppression telemetry is blocked", () => {
  const result = evaluateRecentFailClosedCanaryReadiness({
    evidenceWindow: evidenceWindow(),
    shadowMetrics: shadowMetrics({ suppressed_fallback_events: 1 }),
  });
  assert.equal(result.decision.class, "blocked");
  assert.ok(result.blockers.includes("unexpected_recent_fail_closed_suppression"));
});
