import test from "node:test";
import assert from "node:assert/strict";

import { evaluateLegacyFallbackRemovalGate } from "../lib/recall/hybrid/legacy-fallback-removal-gate.js";

function readyInput(overrides = {}) {
  const base = {
    closureReadiness: { decision: { class: "ready_for_removal" } },
    evidenceWindow: { decision: "ready", status: "sufficient", window_days: 30 },
    kgRollout: { status: "full_fail_closed", production_observations: 500 },
    recentReview: { status: "healthy" },
    recentExpansion: { decision: "expand" },
    recentRollback: { status: "rollback_confirmed" },
    productionRollout: {
      target_mode: "full_fail_closed",
      kg_mode: "full_fail_closed",
      recent_mode: "full_fail_closed",
      observation_count: 500,
      window_days: 30,
      production_observed_by_surface: {
        auto_recall: 100,
        memory_engine_action_search: 100,
        memory_engine_search: 100,
      },
      kg_fallback_events: 0,
      recent_fallback_events: 0,
      unknown_surface_events: 0,
      missing_schema_version_events: 0,
      unsupported_schema_version_events: 0,
    },
    codeReachability: { inventory_complete: true, known_dynamic_references: 0 },
    rollbackStrategy: { strategy: "release_revert", tested: true, documented: true, owner_assigned: true },
  };
  return {
    ...base,
    ...overrides,
    productionRollout: { ...base.productionRollout, ...overrides.productionRollout },
    codeReachability: { ...base.codeReachability, ...overrides.codeReachability },
    rollbackStrategy: { ...base.rollbackStrategy, ...overrides.rollbackStrategy },
  };
}

test("scoped Recent canary is insufficient even when expansion was approved", () => {
  const result = evaluateLegacyFallbackRemovalGate(readyInput({
    productionRollout: {
      kg_mode: "full_fail_closed",
      recent_mode: "scoped_canary",
    },
  }));
  assert.equal(result.decision, "insufficient_evidence");
  assert.ok(result.evidence_gaps.some(issue => issue.code === "recent_full_fail_closed_rollout_not_completed"));
  assert.ok(result.evidence_gaps.some(issue => issue.code === "full_fail_closed_production_modes_not_confirmed"));
});

test("closure blocked takes precedence", () => {
  const result = evaluateLegacyFallbackRemovalGate(readyInput({
    closureReadiness: { decision: { class: "blocked" } },
    productionRollout: { observation_count: 0 },
  }));
  assert.equal(result.decision, "blocked");
  assert.ok(result.blockers.some(issue => issue.code === "closure_readiness_blocked"));
});

test("Recent review rollback blocks regardless of sample volume", () => {
  const result = evaluateLegacyFallbackRemovalGate(readyInput({
    recentReview: { status: "rollback_required" },
    productionRollout: { observation_count: 1 },
  }));
  assert.equal(result.decision, "blocked");
  assert.ok(result.blockers.some(issue => issue.code === "recent_canary_review_requires_rollback"));
});

test("production fallback events block removal", () => {
  const result = evaluateLegacyFallbackRemovalGate(readyInput({
    productionRollout: { recent_fallback_events: 1 },
  }));
  assert.equal(result.decision, "blocked");
  assert.ok(result.blockers.some(issue => issue.code === "production_fallback_events_present"));
});

test("KG scoped canary is insufficient evidence", () => {
  const result = evaluateLegacyFallbackRemovalGate(readyInput({
    kgRollout: { status: "scoped_canary" },
  }));
  assert.equal(result.decision, "insufficient_evidence");
  assert.ok(result.evidence_gaps.some(issue => issue.code === "kg_full_fail_closed_not_confirmed"));
});

test("missing rollback drill is insufficient evidence", () => {
  const result = evaluateLegacyFallbackRemovalGate(readyInput({
    recentRollback: { status: "insufficient_evidence" },
  }));
  assert.equal(result.decision, "insufficient_evidence");
});

test("legacy runtime switch is invalid after removal", () => {
  const result = evaluateLegacyFallbackRemovalGate(readyInput({
    rollbackStrategy: { strategy: "legacy_runtime_switch", tested: true, documented: true, owner_assigned: true },
  }));
  assert.equal(result.decision, "blocked");
  assert.ok(result.blockers.some(issue => issue.code === "post_removal_rollback_strategy_invalid"));
});

test("untested replacement rollback strategy is insufficient evidence", () => {
  const result = evaluateLegacyFallbackRemovalGate(readyInput({
    rollbackStrategy: { strategy: "release_revert", tested: false, documented: true, owner_assigned: true },
  }));
  assert.equal(result.decision, "insufficient_evidence");
  assert.ok(result.evidence_gaps.some(issue => issue.code === "post_removal_rollback_strategy_untested"));
});

test("incomplete code inventory is insufficient evidence", () => {
  const result = evaluateLegacyFallbackRemovalGate(readyInput({
    codeReachability: { inventory_complete: false, known_dynamic_references: 0 },
  }));
  assert.equal(result.decision, "insufficient_evidence");
  assert.ok(result.evidence_gaps.some(issue => issue.code === "legacy_code_inventory_incomplete"));
});

test("unresolved dynamic references block removal", () => {
  const result = evaluateLegacyFallbackRemovalGate(readyInput({
    codeReachability: { inventory_complete: true, known_dynamic_references: 1 },
  }));
  assert.equal(result.decision, "blocked");
  assert.ok(result.blockers.some(issue => issue.code === "unresolved_dynamic_legacy_references"));
});

test("all evidence permits code removal", () => {
  const result = evaluateLegacyFallbackRemovalGate(readyInput());
  assert.equal(result.decision, "ready_for_code_removal");
  assert.equal(result.recommendation, "begin_code_removal");
});

test("threshold equality passes", () => {
  const result = evaluateLegacyFallbackRemovalGate(readyInput({
    productionRollout: {
      observation_count: 500,
      window_days: 30,
      production_observed_by_surface: {
        auto_recall: 100,
        memory_engine_action_search: 100,
        memory_engine_search: 100,
      },
    },
  }));
  assert.equal(result.decision, "ready_for_code_removal");
});
