import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildScopedFailClosedCanaryEvidence,
} from "../lib/recall/hybrid/scoped-fail-closed-canary-evidence.js";

const FIXTURE = new URL("./fixtures/scoped-fail-closed-canary-no-opportunity.jsonl", import.meta.url);

function row(surface, overrides = {}) {
  return {
    event_type: "hybrid_search_observation",
    created_at: "2026-07-18T14:00:00.000Z",
    metadata_json: {
      schema_version: 1,
      surface,
      search_executed: true,
      legacy_db_fallback_used: false,
      legacy_db_fallback_channels: [],
      channel_error_count: 0,
      kg_access_mode: "isolated",
      kg_runtime_mode: surface === "auto_recall" ? "fail_closed_canary" : "legacy_fallback",
      kg_rollout_scope: surface === "auto_recall" ? "scoped_canary" : null,
      kg_scope_required: surface === "auto_recall" ? true : null,
      kg_fail_closed_scope_match: surface === "auto_recall" ? true : null,
      kg_fail_closed_applied: false,
      kg_fail_closed_would_have_used_fallback: false,
      kg_fail_closed_fallback_suppressed: false,
      recent_access_mode: "isolated",
      recent_runtime_mode: "legacy_fallback",
      ...overrides,
    },
  };
}

function fixtureRows() {
  return readFileSync(FIXTURE, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

test("real-shaped no-opportunity fixture confirms scope without pretending suppression", () => {
  const report = buildScopedFailClosedCanaryEvidence({
    observations: fixtureRows(),
    channel: "kg",
    expectedAgent: "edi",
    generatedAt: "2026-07-18T14:12:00.000Z",
  });

  assert.equal(report.status, "canary_scope_confirmed_no_fallback_opportunity");
  assert.equal(report.scope_status, "confirmed");
  assert.equal(report.suppression_status, "no_opportunity");
  assert.equal(report.surface_coverage_status, "auto_recall_only");
  assert.equal(report.isolation_status, "clean");
  assert.equal(report.observation_count, 6);
  assert.equal(report.auto_recall_canary_scope_hit_count, 6);
  assert.equal(report.fallback_opportunity_count, 0);
  assert.equal(report.tool_surface_observation_count, 0);
  assert.equal(report.stage2_review_eligible, false);
  assert.equal(report.recommendation, "do_not_enter_stage2");
  assert.ok(report.warnings.some(issue => issue.code === "real_fallback_opportunity_not_observed"));
  assert.ok(report.warnings.some(issue => issue.code === "expected_agent_not_observation_schema_verified"));
  assert.ok(report.evidence_gaps.some(issue => issue.code === "surface_observation_missing:memory_engine_search"));
  assert.equal(report.safety_boundary.do_not_induce_fallback_by_mutating_production_db_or_topology, true);
});

test("healthy no-opportunity canary becomes eligible for Stage 2 review after full surface coverage", () => {
  const observations = [
    row("auto_recall"),
    row("memory_engine_action_search", {
      kg_runtime_mode: "legacy_fallback",
      kg_rollout_scope: null,
      kg_scope_required: null,
      kg_fail_closed_scope_match: null,
    }),
    row("memory_engine_search", {
      kg_runtime_mode: "legacy_fallback",
      kg_rollout_scope: null,
      kg_scope_required: null,
      kg_fail_closed_scope_match: null,
    }),
  ];

  const report = buildScopedFailClosedCanaryEvidence({ observations, channel: "kg" });
  assert.equal(report.status, "canary_scope_confirmed_no_fallback_opportunity");
  assert.equal(report.suppression_status, "no_opportunity");
  assert.equal(report.surface_coverage_status, "complete");
  assert.equal(report.stage2_review_eligible, true);
  assert.equal(report.stage2_review_eligibility_scope, "observation_evidence_only");
  assert.equal(report.recommendation, "eligible_for_stage2_review");
  assert.equal(report.external_preconditions.verified_by_this_report, false);
  assert.equal(report.external_preconditions.operator_approval_required, true);
  assert.ok(report.warnings.some(issue => issue.code === "real_fallback_opportunity_not_observed"));
  assert.equal(
    report.safety_boundary.real_fallback_opportunity_is_enhancing_not_mandatory_for_stage2_review,
    true,
  );
});

test("suppression plus all production surfaces becomes eligible for Stage 2 review", () => {
  const observations = [
    row("auto_recall", {
      kg_access_mode: "isolated_blocked",
      kg_fail_closed_applied: true,
      kg_fail_closed_would_have_used_fallback: true,
      kg_fail_closed_fallback_suppressed: true,
      kg_fail_closed_empty_candidate: true,
    }),
    row("memory_engine_action_search", {
      kg_runtime_mode: "legacy_fallback",
      kg_rollout_scope: null,
      kg_scope_required: null,
      kg_fail_closed_scope_match: null,
    }),
    row("memory_engine_search", {
      kg_runtime_mode: "legacy_fallback",
      kg_rollout_scope: null,
      kg_scope_required: null,
      kg_fail_closed_scope_match: null,
    }),
  ];

  const report = buildScopedFailClosedCanaryEvidence({ observations, channel: "kg" });
  assert.equal(report.status, "canary_suppression_confirmed");
  assert.equal(report.suppression_status, "confirmed");
  assert.equal(report.surface_coverage_status, "complete");
  assert.equal(report.fallback_opportunity_count, 1);
  assert.equal(report.fallback_suppression_failure_count, 0);
  assert.equal(report.tool_surface_observation_count, 2);
  assert.equal(report.tool_surface_scope_violation_count, 0);
  assert.equal(report.stage2_review_eligible, true);
  assert.equal(report.recommendation, "eligible_for_stage2_review");
});

test("Recent canary suppression is evaluated without a Recent would-have-fallback field", () => {
  const base = {
    schema_version: 1,
    search_executed: true,
    legacy_db_fallback_used: false,
    legacy_db_fallback_channels: [],
    channel_error_count: 0,
    kg_access_mode: "isolated",
    kg_runtime_mode: "legacy_fallback",
  };
  const observations = [
    {
      event_type: "hybrid_search_observation",
      metadata_json: {
        ...base,
        surface: "auto_recall",
        recent_access_mode: "isolated_blocked",
        recent_runtime_mode: "fail_closed_canary",
        recent_rollout_scope: "scoped_canary",
        recent_scope_required: true,
        recent_fail_closed_scope_match: true,
        recent_fail_closed_applied: true,
        recent_fail_closed_fallback_suppressed: true,
      },
    },
    {
      event_type: "hybrid_search_observation",
      metadata_json: {
        ...base,
        surface: "memory_engine_action_search",
        recent_access_mode: "isolated",
        recent_runtime_mode: "legacy_fallback",
      },
    },
    {
      event_type: "hybrid_search_observation",
      metadata_json: {
        ...base,
        surface: "memory_engine_search",
        recent_access_mode: "isolated",
        recent_runtime_mode: "legacy_fallback",
      },
    },
  ];

  const report = buildScopedFailClosedCanaryEvidence({ observations, channel: "recent" });
  assert.equal(report.status, "canary_suppression_confirmed");
  assert.equal(report.channel, "recent");
  assert.equal(report.fallback_opportunity_count, 1);
  assert.equal(report.fallback_suppression_failure_count, 0);
  assert.equal(report.surface_coverage_status, "complete");
  assert.equal(report.stage2_review_eligible, true);
});

test("tool scope, other-channel rollout, errors, and failed suppression block the canary", () => {
  const observations = [
    row("auto_recall", {
      kg_access_mode: "legacy_fallback",
      kg_fail_closed_applied: false,
      kg_fail_closed_would_have_used_fallback: true,
      kg_fail_closed_fallback_suppressed: false,
      legacy_db_fallback_used: true,
      legacy_db_fallback_channels: ["kg"],
      channel_error_count: 1,
      recent_runtime_mode: "full_fail_closed",
      recent_rollout_scope: "full",
    }),
    row("memory_engine_search", {
      kg_runtime_mode: "fail_closed_canary",
      kg_rollout_scope: "scoped_canary",
      kg_scope_required: true,
      kg_fail_closed_scope_match: true,
    }),
  ];

  const report = buildScopedFailClosedCanaryEvidence({ observations, channel: "kg" });
  assert.equal(report.status, "canary_safety_violation");
  assert.equal(report.isolation_status, "violation");
  assert.equal(report.fallback_suppression_failure_count, 1);
  assert.equal(report.tool_surface_scope_violation_count, 1);
  assert.equal(report.other_channel_rollout_violation_count, 1);
  assert.equal(report.channel_error_observation_count, 1);
  assert.ok(report.violations.some(issue => issue.code === "fallback_suppression_failed"));
  assert.ok(report.violations.some(issue => issue.code === "tool_surface_canary_scope_violation"));
  assert.ok(report.violations.some(issue => issue.code === "other_channel_rollout_present"));
  assert.equal(report.stage2_review_eligible, false);
});

test("non-executed observations do not satisfy scope or surface coverage", () => {
  const report = buildScopedFailClosedCanaryEvidence({
    observations: [row("auto_recall", { search_executed: false })],
    channel: "kg",
  });
  assert.equal(report.status, "canary_scope_not_confirmed");
  assert.equal(report.search_executed_observation_count, 0);
  assert.equal(report.search_not_executed_count, 1);
  assert.equal(report.production_observed_by_surface.auto_recall, 0);
  assert.ok(report.warnings.some(issue => issue.code === "search_not_executed_observations_excluded"));
  assert.ok(report.evidence_gaps.some(issue => issue.code === "surface_observation_missing:auto_recall"));
});

test("absence of a trusted AutoRecall scope hit stays distinct from a safety violation", () => {
  const report = buildScopedFailClosedCanaryEvidence({
    observations: [row("memory_engine_search", {
      kg_runtime_mode: "legacy_fallback",
      kg_rollout_scope: null,
      kg_scope_required: null,
      kg_fail_closed_scope_match: null,
    })],
    channel: "kg",
  });
  assert.equal(report.status, "canary_scope_not_confirmed");
  assert.equal(report.scope_status, "not_confirmed");
  assert.equal(report.suppression_status, "not_observed");
  assert.equal(report.isolation_status, "clean");
  assert.ok(report.evidence_gaps.some(issue => issue.code === "auto_recall_canary_scope_hit_missing"));
});

test("unsupported channels fail explicitly", () => {
  assert.throws(
    () => buildScopedFailClosedCanaryEvidence({ observations: [], channel: "fts" }),
    /unsupported channel/,
  );
});
