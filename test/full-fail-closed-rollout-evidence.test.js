import test from "node:test";
import assert from "node:assert/strict";

import { buildFullFailClosedRolloutEvidence } from "../lib/recall/hybrid/full-fail-closed-rollout-evidence.js";

const SURFACES = ["auto_recall", "memory_engine_action_search", "memory_engine_search"];

function observation(surface, overrides = {}) {
  const metadata = {
    schema_version: 1,
    surface,
    search_executed: true,
    completed_at: "2026-07-15T00:00:00.000Z",
    created_at: "2026-07-01T00:00:00.000Z",
    kg_access_mode: "full_fail_closed",
    recent_access_mode: "full_fail_closed",
    kg_runtime_mode: "full_fail_closed",
    recent_runtime_mode: "full_fail_closed",
    kg_rollout_scope: "full",
    recent_rollout_scope: "full",
    kg_scope_required: false,
    recent_scope_required: false,
    kg_fail_closed_applied: true,
    recent_fail_closed_applied: true,
    ...overrides,
  };
  return { event_type: "hybrid_search_observation", metadata_json: metadata };
}

function fullFixture(overrides = {}) {
  const observations = SURFACES.flatMap(surface => [
    observation(surface, { completed_at: "2026-07-01T00:00:00.000Z" }),
    observation(surface, { completed_at: "2026-07-15T00:00:00.000Z" }),
  ]);
  return {
    observations,
    thresholds: {
      minimum_window_days: 14,
      minimum_observations: 6,
      minimum_surface_observations: 2,
      ...overrides.thresholds,
    },
    generatedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  };
}

test("empty input is insufficient evidence", () => {
  const report = buildFullFailClosedRolloutEvidence({ thresholds: { minimum_window_days: 0 } });
  assert.equal(report.status, "insufficient_evidence");
  assert.ok(report.evidence_gaps.some(issue => issue.code === "production_observations_missing"));
});

test("Recent scoped canary is never classified as full rollout", () => {
  const report = buildFullFailClosedRolloutEvidence({
    observations: [observation("memory_engine_search", {
      kg_access_mode: "isolated",
      kg_runtime_mode: null,
      kg_fail_closed_applied: null,
      recent_access_mode: "isolated_blocked",
      recent_runtime_mode: "fail_closed_canary",
      recent_fail_closed_applied: true,
      recent_fail_closed_scope_match: true,
    })],
    thresholds: { minimum_window_days: 0, minimum_observations: 1, minimum_surface_observations: 1 },
  });
  assert.equal(report.recent_mode, "scoped_canary");
  assert.notEqual(report.recent_mode, "full_fail_closed");
  assert.equal(report.status, "partial_rollout");
  assert.ok(report.evidence_gaps.some(issue => issue.code === "kg_full_fail_closed_mode_not_observable"));
});

test("expansion approval fields are ignored", () => {
  const report = buildFullFailClosedRolloutEvidence({
    observations: [observation("memory_engine_search", {
      decision: "expand",
      kg_access_mode: "isolated",
      kg_runtime_mode: null,
      kg_fail_closed_applied: null,
      recent_access_mode: "isolated_blocked",
      recent_runtime_mode: "fail_closed_canary",
      recent_fail_closed_applied: true,
      recent_fail_closed_scope_match: true,
    })],
    thresholds: { minimum_window_days: 0, minimum_observations: 1, minimum_surface_observations: 1 },
  });
  assert.equal(report.recent_mode, "scoped_canary");
  assert.notEqual(report.status, "full_fail_closed_confirmed");
});

test("legacy fallback blocks the report", () => {
  const report = buildFullFailClosedRolloutEvidence({
    observations: [observation("memory_engine_search", { recent_access_mode: "guarded_fallback", recent_runtime_mode: "legacy_fallback", recent_fail_closed_applied: null })],
    thresholds: { minimum_window_days: 0, minimum_observations: 1, minimum_surface_observations: 1 },
  });
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.some(issue => issue.code === "production_fallback_events_present"));
});

test("legacy and scoped modes are mixed and blocked", () => {
  const observations = [
    observation("memory_engine_search", { recent_access_mode: "guarded_fallback", recent_runtime_mode: "legacy_fallback", recent_fail_closed_applied: null }),
    observation("memory_engine_search", { recent_access_mode: "isolated_blocked", recent_runtime_mode: "fail_closed_canary", recent_fail_closed_applied: true, recent_fail_closed_scope_match: true }),
  ];
  const report = buildFullFailClosedRolloutEvidence({
    observations,
    thresholds: { minimum_window_days: 0, minimum_observations: 1, minimum_surface_observations: 1 },
  });
  assert.equal(report.recent_mode, "mixed");
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.some(issue => issue.code === "mixed_rollout_with_legacy_fallback"));
});

test("unknown surfaces are blockers and are excluded from production counts", () => {
  const report = buildFullFailClosedRolloutEvidence({
    observations: [observation("unknown")],
    thresholds: { minimum_window_days: 0, minimum_observations: 0, minimum_surface_observations: 0 },
  });
  assert.equal(report.observation_count, 0);
  assert.equal(report.unknown_surface_events, 1);
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.some(issue => issue.code === "unknown_production_surfaces_present"));
});

test("unsupported schema blocks the report", () => {
  const report = buildFullFailClosedRolloutEvidence({
    observations: [observation("memory_engine_search", { schema_version: 2 })],
    thresholds: { minimum_window_days: 0, minimum_observations: 1, minimum_surface_observations: 1 },
  });
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.some(issue => issue.code === "invalid_observation_schema_present"));
});

test("surface coverage below threshold is insufficient evidence", () => {
  const report = buildFullFailClosedRolloutEvidence({
    observations: [observation("auto_recall")],
    thresholds: { minimum_window_days: 0, minimum_observations: 1, minimum_surface_observations: 1 },
  });
  assert.equal(report.status, "insufficient_evidence");
  assert.ok(report.evidence_gaps.some(issue => issue.code === "surface_observations_below_threshold:memory_engine_search"));
});

test("short window is insufficient evidence", () => {
  const report = buildFullFailClosedRolloutEvidence({
    observations: SURFACES.map(surface => observation(surface, { completed_at: "2026-07-02T00:00:00.000Z" })),
    thresholds: { minimum_window_days: 14, minimum_observations: 3, minimum_surface_observations: 1 },
  });
  assert.equal(report.window_days, 0);
  assert.equal(report.status, "insufficient_evidence");
  assert.ok(report.evidence_gaps.some(issue => issue.code === "production_window_below_threshold"));
});

test("normal isolated modes cannot prove full fail-closed", () => {
  const report = buildFullFailClosedRolloutEvidence({
    observations: SURFACES.map(surface => observation(surface, {
      kg_access_mode: "isolated",
      recent_access_mode: "isolated",
      kg_runtime_mode: null,
      recent_runtime_mode: null,
      kg_fail_closed_applied: null,
      recent_fail_closed_applied: null,
    })),
    thresholds: { minimum_window_days: 0, minimum_observations: 3, minimum_surface_observations: 1 },
  });
  assert.equal(report.status, "insufficient_evidence");
  assert.ok(report.evidence_gaps.some(issue => issue.code === "kg_full_fail_closed_mode_not_observable"));
  assert.ok(report.evidence_gaps.some(issue => issue.code === "recent_full_fail_closed_mode_not_observable"));
});

test("full mode without an explicit full rollout scope is not confirmed", () => {
  const report = buildFullFailClosedRolloutEvidence({
    observations: [observation("memory_engine_search", {
      kg_rollout_scope: null,
      recent_rollout_scope: null,
      kg_scope_required: null,
      recent_scope_required: null,
    })],
    thresholds: { minimum_window_days: 0, minimum_observations: 1, minimum_surface_observations: 1 },
  });
  assert.notEqual(report.status, "full_fail_closed_confirmed");
  assert.ok(report.evidence_gaps.some(issue => issue.code === "kg_full_fail_closed_mode_not_observable"));
  assert.ok(report.evidence_gaps.some(issue => issue.code === "recent_full_fail_closed_mode_not_observable"));
});

test("explicit non-scoped full mode can satisfy the synthetic schema capability", () => {
  const report = buildFullFailClosedRolloutEvidence(fullFixture());
  assert.equal(report.status, "full_fail_closed_confirmed");
  assert.equal(report.kg_mode, "full_fail_closed");
  assert.equal(report.recent_mode, "full_fail_closed");
  assert.equal(report.observation_count, 6);
  assert.deepEqual(report.production_observed_by_surface, {
    auto_recall: 2,
    memory_engine_action_search: 2,
    memory_engine_search: 2,
  });
});

test("output is deterministic apart from generated timestamp", () => {
  const input = fullFixture();
  const first = buildFullFailClosedRolloutEvidence(input);
  const second = buildFullFailClosedRolloutEvidence({ ...input, observations: [...input.observations].reverse() });
  assert.deepEqual({ ...first, generated_at: "" }, { ...second, generated_at: "" });
});

test("completed_at takes priority over created_at", () => {
  const report = buildFullFailClosedRolloutEvidence({
    observations: [
      observation("auto_recall", { completed_at: "2026-07-15T00:00:00.000Z", created_at: "2026-07-01T00:00:00.000Z" }),
      observation("memory_engine_action_search", { completed_at: "2026-07-16T00:00:00.000Z", created_at: "2026-07-01T00:00:00.000Z" }),
    ],
    thresholds: { minimum_window_days: 0, minimum_observations: 2, minimum_surface_observations: 0 },
    generatedAt: "2026-07-18T00:00:00.000Z",
  });
  assert.equal(report.evidence.observation_window.first_observed_at, "2026-07-15T00:00:00.000Z");
  assert.equal(report.evidence.observation_window.last_observed_at, "2026-07-16T00:00:00.000Z");
});
