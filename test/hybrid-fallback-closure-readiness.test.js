import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateHybridFallbackClosureReadiness,
} from "../lib/recall/hybrid/fallback-closure-readiness.js";

const PRODUCTION_SURFACES = {
  auto_recall: 20,
  memory_engine_action_search: 20,
  memory_engine_search: 20,
};

function metrics(overrides = {}) {
  return {
    window_days: 14,
    observed_hybrid_events: 100,
    fully_observed_events: 100,
    partial_observed_events: 0,
    fallback_events: 0,
    kg_fallback_events: 0,
    recent_fallback_events: 0,
    unknown_surface_events: 0,
    missing_schema_version_events: 0,
    unsupported_schema_version_events: 0,
    production_observed_by_surface: { ...PRODUCTION_SURFACES },
    ...overrides,
  };
}

function audits({
  kg = "pass",
  recent = "pass_canary_readiness",
  kgCanaryStatus,
  recentCanaryStatus,
} = {}) {
  const kgAudit = { decision: { class: kg } };
  const recentAudit = { decision: { class: recent } };
  if (kgCanaryStatus) kgAudit.canary = { status: kgCanaryStatus };
  if (recentCanaryStatus) recentAudit.canary = { status: recentCanaryStatus };
  return { kgAudit, recentAudit };
}

function evaluate(hybridObservability, auditOptions = {}, thresholds = {}) {
  return evaluateHybridFallbackClosureReadiness({
    hybridObservability,
    ...audits(auditOptions),
  }, thresholds);
}

test("missing audits are insufficient evidence, not blockers", () => {
  const report = evaluateHybridFallbackClosureReadiness({
    hybridObservability: {},
    kgAudit: {},
    recentAudit: {},
  });
  assert.equal(report.decision.class, "insufficient_evidence");
  assert.deepEqual(report.blockers, []);
  assert.ok(report.evidence_gaps.includes("kg_audit_missing"));
  assert.ok(report.evidence_gaps.includes("recent_audit_missing"));
});

test("fallback evidence is blocked even when audits pass", () => {
  const report = evaluate(metrics({ fallback_events: 1 }), {});
  assert.equal(report.decision.class, "blocked");
  assert.match(report.decision.reason, /fallback_events_present/);
});

test("explicit KG audit failure is blocked", () => {
  const report = evaluate(metrics(), { kg: "fail" });
  assert.equal(report.decision.class, "blocked");
  assert.ok(report.blockers.includes("kg_audit_failed"));
});

test("explicit Recent audit failure is blocked", () => {
  const report = evaluate(metrics(), { recent: "semantic_pass_latency_inconclusive" });
  assert.equal(report.decision.class, "blocked");
  assert.ok(report.blockers.includes("recent_audit_failed"));
});

test("evidence below observation thresholds is insufficient", () => {
  const report = evaluate(metrics({
    observed_hybrid_events: 10,
    fully_observed_events: 10,
    production_observed_by_surface: {
      auto_recall: 4,
      memory_engine_action_search: 3,
      memory_engine_search: 3,
    },
  }));
  assert.equal(report.decision.class, "insufficient_evidence");
});

test("complete evidence with a short window is ready for shadow fail-closed", () => {
  const report = evaluate(metrics({ window_days: 7 }));
  assert.equal(report.decision.class, "ready_for_shadow_fail_closed");
});

test("complete fourteen-day evidence is ready for fail-closed canary", () => {
  const report = evaluate(metrics({ window_days: 14 }));
  assert.equal(report.decision.class, "ready_for_fail_closed_canary");
});

test("failed canary is blocked", () => {
  const report = evaluate(metrics(), { kgCanaryStatus: "failed", recentCanaryStatus: "passed" });
  assert.equal(report.decision.class, "blocked");
  assert.ok(report.blockers.includes("kg_fail_closed_canary_failed"));
});

test("missing canary is ready for fail-closed canary", () => {
  const report = evaluate(metrics());
  assert.equal(report.decision.class, "ready_for_fail_closed_canary");
  assert.ok(report.evidence_gaps.includes("kg_fail_closed_canary_missing"));
  assert.ok(report.evidence_gaps.includes("recent_fail_closed_canary_missing"));
});

test("running canary is ready for fail-closed canary", () => {
  const report = evaluate(metrics(), { kgCanaryStatus: "running", recentCanaryStatus: "running" });
  assert.equal(report.decision.class, "ready_for_fail_closed_canary");
  assert.ok(report.evidence_gaps.includes("kg_fail_closed_canary_running"));
});

test("removal requires both channel canaries to pass", () => {
  const notReady = evaluate(metrics(), { kgCanaryStatus: "passed", recentCanaryStatus: "running" });
  assert.equal(notReady.decision.class, "ready_for_fail_closed_canary");

  const ready = evaluate(metrics(), { kgCanaryStatus: "passed", recentCanaryStatus: "passed" });
  assert.equal(ready.decision.class, "ready_for_removal");
});

test("unknown surface blocks closure", () => {
  const report = evaluate(metrics({ unknown_surface_events: 1 }));
  assert.equal(report.decision.class, "blocked");
  assert.match(report.decision.reason, /unknown_surface_events_present/);
});

test("schema coverage issues block closure", () => {
  const missing = evaluate(metrics({ missing_schema_version_events: 1 }));
  const unsupported = evaluate(metrics({ unsupported_schema_version_events: 1 }));
  assert.equal(missing.decision.class, "blocked");
  assert.equal(unsupported.decision.class, "blocked");
});

test("partial observations block closure", () => {
  const report = evaluate(metrics({ partial_observed_events: 1, fully_observed_events: 99 }));
  assert.equal(report.decision.class, "blocked");
});

test("zero production observations are insufficient evidence", () => {
  const report = evaluate(metrics({
    observed_hybrid_events: 0,
    fully_observed_events: 0,
    production_observed_by_surface: {},
  }));
  assert.equal(report.decision.class, "insufficient_evidence");
  assert.deepEqual(report.blockers, []);
  assert.ok(report.evidence_gaps.includes("production_observations_missing"));
});

test("threshold overrides support small synthetic evidence windows", () => {
  const report = evaluate(metrics({
    window_days: 1,
    observed_hybrid_events: 2,
    fully_observed_events: 2,
    production_observed_by_surface: {
      auto_recall: 1,
      memory_engine_action_search: 1,
      memory_engine_search: 1,
    },
  }), {}, {
    minimum_observations: 2,
    minimum_surface_observations: 1,
    minimum_window_days: 14,
  });
  assert.equal(report.decision.class, "ready_for_shadow_fail_closed");
  assert.deepEqual(report.thresholds.production_surfaces, [
    "auto_recall",
    "memory_engine_action_search",
    "memory_engine_search",
  ]);
});
