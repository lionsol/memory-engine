import test from "node:test";
import assert from "node:assert/strict";

import { evaluateRecentFailClosedRollbackValidation } from "../lib/recall/hybrid/recent-fail-closed-rollback-validation.js";

function reports(overrides = {}) {
  return {
    beforeRollback: {
      runtime_mode: "fail_closed_canary",
      observation_count: 20,
      applied_events: 20,
      suppressed_fallback_events: 20,
      legacy_fallback_events: 0,
      scope_match_events: 20,
      empty_candidate_events: 0,
      guard_failure_events: 20,
      ...overrides.beforeRollback,
    },
    afterRollback: {
      runtime_mode: "legacy_fallback",
      observation_count: 100,
      applied_events: 0,
      suppressed_fallback_events: 0,
      legacy_fallback_events: 10,
      scope_match_events: 0,
      empty_candidate_events: 0,
      guard_failure_events: 10,
      ...overrides.afterRollback,
    },
    thresholds: overrides.thresholds,
  };
}

test("rollback is confirmed by pre/post behavioral evidence", () => {
  const result = evaluateRecentFailClosedRollbackValidation(reports());
  assert.equal(result.status, "rollback_confirmed");
  assert.equal(result.recommendation, "close_canary");
  assert.equal(result.evidence.deltas.window_comparison, "independent_observation_windows");
});

test("rollback mode not applied is a hard failure", () => {
  const result = evaluateRecentFailClosedRollbackValidation(reports({
    afterRollback: { runtime_mode: "fail_closed_canary" },
  }));
  assert.equal(result.status, "rollback_failed");
  assert.ok(result.blockers.some(issue => issue.code === "rollback_mode_not_applied"));
});

test("suppression residue fails even with too few observations", () => {
  const result = evaluateRecentFailClosedRollbackValidation(reports({
    afterRollback: {
      observation_count: 2,
      suppressed_fallback_events: 1,
      legacy_fallback_events: 0,
      guard_failure_events: 0,
    },
  }));
  assert.equal(result.status, "rollback_failed");
  assert.ok(result.blockers.some(issue => issue.code === "fallback_suppression_after_rollback"));
});

test("applied residue fails rollback validation", () => {
  const result = evaluateRecentFailClosedRollbackValidation(reports({
    afterRollback: { applied_events: 1 },
  }));
  assert.equal(result.status, "rollback_failed");
  assert.ok(result.blockers.some(issue => issue.code === "fail_closed_applied_after_rollback"));
});

test("missing restored fallback after guard failures fails", () => {
  const result = evaluateRecentFailClosedRollbackValidation(reports({
    afterRollback: { guard_failure_events: 10, legacy_fallback_events: 0 },
  }));
  assert.equal(result.status, "rollback_failed");
  assert.ok(result.blockers.some(issue => issue.code === "legacy_fallback_not_restored"));
});

test("no post-rollback guard failures remains insufficient evidence", () => {
  const result = evaluateRecentFailClosedRollbackValidation(reports({
    afterRollback: { guard_failure_events: 0, legacy_fallback_events: 0 },
  }));
  assert.equal(result.status, "insufficient_evidence");
  assert.ok(result.evidence_gaps.some(issue => issue.code === "missing_post_rollback_guard_failure_evidence"));
});

test("no pre-rollback canary evidence remains insufficient evidence", () => {
  const result = evaluateRecentFailClosedRollbackValidation(reports({
    beforeRollback: { applied_events: 0 },
  }));
  assert.equal(result.status, "insufficient_evidence");
  assert.ok(result.evidence_gaps.some(issue => issue.code === "missing_pre_rollback_canary_evidence"));
});

test("telemetry inconsistency is a hard failure", () => {
  const result = evaluateRecentFailClosedRollbackValidation(reports({
    afterRollback: { applied_events: 0, suppressed_fallback_events: 2 },
  }));
  assert.equal(result.status, "rollback_failed");
  assert.ok(result.blockers.some(issue => issue.code === "rollback_telemetry_inconsistent"));
});

test("threshold overrides are supported", () => {
  const result = evaluateRecentFailClosedRollbackValidation(reports({
    beforeRollback: { applied_events: 1 },
    afterRollback: {
      observation_count: 5,
      guard_failure_events: 1,
      legacy_fallback_events: 1,
    },
    thresholds: {
      minimum_after_observations: 5,
      minimum_after_guard_failure_events: 1,
    },
  }));
  assert.equal(result.status, "rollback_confirmed");
});
