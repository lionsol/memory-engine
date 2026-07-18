import test from "node:test";
import assert from "node:assert/strict";
import { buildHybridFallbackObservabilitySummary } from "../console/services/metrics-service.js";

const NOW_MS = Date.parse("2026-05-30T00:00:00Z");
const IN_WINDOW = "2026-05-29 12:00:00";
const OUT_WINDOW = "2026-05-01 12:00:00";

function debugRow(id, metadata, createdAt = IN_WINDOW, eventType = "hybrid_search_observation") {
  const payload = eventType === "hybrid_search_observation" && metadata && typeof metadata === "object"
    ? {
      surface: "memory_engine_search",
      search_executed: true,
      ...metadata,
    }
    : metadata;
  return {
    id,
    event_type: eventType,
    trace_id: `trace-${id}`,
    metadata_json: typeof payload === "string" ? payload : JSON.stringify(payload),
    created_at: createdAt,
  };
}

test("hybrid fallback observability: empty data returns zero summary", () => {
  assert.deepEqual(
    buildHybridFallbackObservabilitySummary([], { windowDays: 7, nowMs: NOW_MS }),
    {
      window_days: 7,
      observation_schema_version: null,
      observation_schema_versions: {},
      missing_schema_version_events: 0,
      unsupported_schema_version_events: 0,
      observation_start_at: null,
      search_executed_events: 0,
      search_not_executed_events: 0,
      observed_hybrid_events: 0,
      fully_observed_events: 0,
      partial_observed_events: 0,
      fully_isolated_events: 0,
      fallback_events: 0,
      fallback_rate: 0,
      kg_fallback_events: 0,
      recent_fallback_events: 0,
      both_fallback_events: 0,
      observed_by_surface: {},
      production_observed_by_surface: {},
      excluded_from_production_by_surface: {},
      unknown_surface_events: 0,
      fully_observed_by_surface: {},
      fallback_by_surface: {},
      kg_attempted_events: 0,
      recent_attempted_events: 0,
      kg_isolated_events: 0,
      recent_isolated_events: 0,
      kg_fallback_rate: 0,
      recent_fallback_rate: 0,
      partial_observation_rate: 0,
      kg_modes: {},
      recent_modes: {},
      kg_runtime_mode_distribution: {},
      recent_runtime_mode_distribution: {},
      kg_full_fail_closed_events: 0,
      recent_full_fail_closed_events: 0,
      kg_fallback_reasons: {},
      recent_fallback_reasons: {},
      kg_fail_closed_shadow: {
        events: 0,
        would_fail_closed_events: 0,
        average_candidate_loss_ratio: 0,
        max_candidate_loss_ratio: 0,
        total_dropped_candidates: 0,
      },
      kg_fail_closed_canary: {
        enabled_events: 0,
        applied_events: 0,
        suppressed_fallback_events: 0,
        empty_candidate_events: 0,
        candidate_loss_ratio: 0,
        result_change_events: 0,
      },
      recent_fail_closed_shadow: {
        events: 0,
        would_fail_closed_events: 0,
        average_candidate_loss_ratio: 0,
        max_candidate_loss_ratio: 0,
        risk_level_distribution: {},
      },
      recent_fail_closed_canary_runtime: {
        enabled_events: 0,
        scope_match_events: 0,
        applied_events: 0,
        suppressed_fallback_events: 0,
        empty_candidate_events: 0,
      },
    },
  );
});

test("KG fail-closed shadow metrics count only explicit shadow observations", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, {
      kg_access_mode: "legacy_fallback",
      recent_access_mode: "isolated",
      kg_shadow_mode: "shadow_fail_closed",
      kg_shadow_would_fail_closed: true,
      kg_shadow_dropped_candidate_count: 2,
      kg_shadow_candidate_loss_ratio: 0.5,
      kg_shadow_overlap_count: 2,
    }),
    debugRow(2, {
      kg_access_mode: "isolated",
      recent_access_mode: "isolated",
    }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.deepEqual(summary.kg_fail_closed_shadow, {
    events: 1,
    would_fail_closed_events: 1,
    average_candidate_loss_ratio: 0.5,
    max_candidate_loss_ratio: 0.5,
    total_dropped_candidates: 2,
  });
});

test("full fail-closed runtime modes remain separate from scoped canary metrics", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, {
      kg_runtime_mode: "full_fail_closed",
      recent_runtime_mode: "full_fail_closed",
      kg_rollout_scope: "full",
      recent_rollout_scope: "full",
    }),
    debugRow(2, {
      kg_runtime_mode: "fail_closed_canary",
      recent_runtime_mode: "fail_closed_canary",
      kg_rollout_scope: "scoped_canary",
      recent_rollout_scope: "scoped_canary",
    }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.deepEqual(summary.kg_runtime_mode_distribution, {
    fail_closed_canary: 1,
    full_fail_closed: 1,
  });
  assert.deepEqual(summary.recent_runtime_mode_distribution, {
    fail_closed_canary: 1,
    full_fail_closed: 1,
  });
  assert.equal(summary.kg_full_fail_closed_events, 1);
  assert.equal(summary.recent_full_fail_closed_events, 1);
});

test("KG fail-closed canary metrics count only explicit canary observations", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, {
      kg_access_mode: "isolated_blocked",
      recent_access_mode: "isolated",
      kg_runtime_mode: "fail_closed_canary",
      kg_fail_closed_applied: true,
      kg_fail_closed_would_have_used_fallback: true,
      kg_fail_closed_fallback_suppressed: true,
      kg_fail_closed_empty_candidate: true,
    }),
    debugRow(2, {
      kg_access_mode: "legacy_fallback",
      recent_access_mode: "isolated",
      kg_runtime_mode: null,
      kg_fail_closed_applied: true,
      kg_fail_closed_fallback_suppressed: true,
      kg_fail_closed_empty_candidate: true,
    }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.deepEqual(summary.kg_fail_closed_canary, {
    enabled_events: 1,
    applied_events: 1,
    suppressed_fallback_events: 1,
    empty_candidate_events: 1,
    candidate_loss_ratio: 0,
    result_change_events: 1,
  });
  assert.equal(summary.fallback_events, 1);
});

test("Recent fail-closed shadow metrics stay separate from real fallback counts", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, {
      kg_access_mode: "isolated",
      recent_access_mode: "guarded_fallback",
      recent_isolated_fallback_reason: "isolated_recent_metadata_duplicate_id",
      recent_shadow_mode: "shadow_fail_closed",
      recent_shadow_would_fail_closed: true,
      recent_shadow_dropped_candidate_count: 1,
      recent_shadow_candidate_loss_ratio: 0.333,
      recent_shadow_overlap_count: 2,
      recent_shadow_risk_level: "medium",
    }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.deepEqual(summary.recent_fail_closed_shadow, {
    events: 1,
    would_fail_closed_events: 1,
    average_candidate_loss_ratio: 0.333,
    max_candidate_loss_ratio: 0.333,
    risk_level_distribution: { medium: 1 },
  });
  assert.equal(summary.recent_fallback_events, 1);
});

test("Recent fail-closed canary metrics stay separate from real fallback counts", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, {
      kg_access_mode: "isolated",
      recent_access_mode: "isolated_blocked",
      recent_runtime_mode: "fail_closed_canary",
      recent_fail_closed_scope_match: true,
      recent_fail_closed_applied: true,
      recent_fail_closed_fallback_suppressed: true,
      recent_fail_closed_empty_candidate: true,
    }),
    debugRow(2, {
      kg_access_mode: "isolated",
      recent_access_mode: "guarded_fallback",
      recent_runtime_mode: "legacy_fallback",
      recent_fail_closed_scope_match: false,
    }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.deepEqual(summary.recent_fail_closed_canary_runtime, {
    enabled_events: 2,
    scope_match_events: 1,
    applied_events: 1,
    suppressed_fallback_events: 1,
    empty_candidate_events: 1,
  });
  assert.equal(summary.recent_fallback_events, 1);
});

test("hybrid fallback observability excludes skips, child debug events, other types, and invalid JSON", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, { skipped: true, skip_reason: "intent" }, IN_WINDOW, "auto_recall_debug"),
    debugRow(2, { debug_type: "gate_decision", kg_access_mode: "legacy_fallback" }, IN_WINDOW, "auto_recall_debug"),
    debugRow(3, { kg_access_mode: "isolated" }, IN_WINDOW, "recall_completed"),
    debugRow(4, "not-json"),
    debugRow(5, { kg_access_mode: "isolated" }),
    debugRow(6, { kg_access_mode: "legacy_fallback" }, IN_WINDOW, "auto_recall_debug"),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.equal(summary.observed_hybrid_events, 1);
  assert.equal(summary.fully_isolated_events, 0);
  assert.equal(summary.fallback_events, 0);
  assert.deepEqual(summary.observed_by_surface, { memory_engine_search: 1 });
});

test("fully isolated events require both canonical modes", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, { kg_access_mode: "isolated", recent_access_mode: "isolated" }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.equal(summary.observed_hybrid_events, 1);
  assert.equal(summary.fully_observed_events, 1);
  assert.equal(summary.fully_isolated_events, 1);
  assert.equal(summary.fallback_rate, 0);
});

test("KG-only fallback counts the KG canonical reason", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, {
      kg_access_mode: "legacy_fallback",
      recent_access_mode: "isolated",
      kg_isolated_fallback_reason: "text_id_invariant_failed",
    }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.equal(summary.fallback_events, 1);
  assert.equal(summary.kg_fallback_events, 1);
  assert.equal(summary.recent_fallback_events, 0);
  assert.deepEqual(summary.kg_fallback_reasons, { text_id_invariant_failed: 1 });
});

test("Recent-only fallback counts the Recent canonical reason", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, {
      kg_access_mode: "isolated",
      recent_access_mode: "guarded_fallback",
      recent_isolated_fallback_reason: "topology_guard_failed",
    }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.equal(summary.fallback_events, 1);
  assert.equal(summary.kg_fallback_events, 0);
  assert.equal(summary.recent_fallback_events, 1);
  assert.deepEqual(summary.recent_fallback_reasons, { topology_guard_failed: 1 });
});

test("both fallback channels count one fallback event", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, {
      kg_access_mode: "legacy_fallback",
      recent_access_mode: "guarded_fallback",
      kg_isolated_fallback_reason: "kg_reason",
      recent_isolated_fallback_reason: "recent_reason",
    }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.equal(summary.fallback_events, 1);
  assert.equal(summary.both_fallback_events, 1);
  assert.equal(summary.kg_fallback_events, 1);
  assert.equal(summary.recent_fallback_events, 1);
});

test("fallback rate uses observed Hybrid events as denominator", () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, index) => debugRow(index, { kg_access_mode: "isolated", recent_access_mode: "isolated" })),
    debugRow(8, { kg_access_mode: "legacy_fallback", recent_access_mode: "isolated" }),
    debugRow(9, { kg_access_mode: "isolated", recent_access_mode: "guarded_fallback" }),
  ];
  const summary = buildHybridFallbackObservabilitySummary(rows, { windowDays: 7, nowMs: NOW_MS });

  assert.equal(summary.observed_hybrid_events, 10);
  assert.equal(summary.fallback_events, 2);
  assert.equal(summary.fallback_rate, 0.2);
});

test("partial observations do not infer the missing channel", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, { kg_access_mode: "isolated" }),
    debugRow(2, { recent_access_mode: "guarded_fallback" }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.equal(summary.observed_hybrid_events, 2);
  assert.equal(summary.fully_observed_events, 0);
  assert.equal(summary.partial_observed_events, 2);
  assert.equal(summary.fallback_events, 1);
  assert.equal(summary.recent_fallback_events, 1);
  assert.deepEqual(summary.kg_modes, { isolated: 1 });
});

test("channel errors and inconsistent stored summaries do not create fallback counts", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, {
      kg_access_mode: "isolated",
      recent_access_mode: "isolated",
      kg_error: "query failed",
      legacy_db_fallback_used: true,
      legacy_db_fallback_channels: ["kg"],
      kg_isolation_fallback_reason: "fake_alias_reason",
    }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.equal(summary.fallback_events, 0);
  assert.deepEqual(summary.kg_fallback_reasons, {});
});

test("canonical reasons win over aliases and missing reasons are unknown", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, {
      kg_access_mode: "legacy_fallback",
      kg_isolation_fallback_reason: "alias_reason",
    }),
    debugRow(2, {
      kg_access_mode: "legacy_fallback",
      kg_isolated_fallback_reason: "canonical_reason",
    }),
    debugRow(3, {
      recent_access_mode: "guarded_fallback",
      recent_isolated_fallback_reason: "",
    }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.deepEqual(summary.kg_fallback_reasons, { canonical_reason: 1, unknown: 1 });
  assert.deepEqual(summary.recent_fallback_reasons, { unknown: 1 });
});

test("invalid mode and reason values use unknown, with stable lexical tie ordering", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, { kg_access_mode: "z-mode", recent_access_mode: "guarded_fallback", recent_isolated_fallback_reason: "zeta" }),
    debugRow(2, { kg_access_mode: "a-mode", recent_access_mode: "guarded_fallback", recent_isolated_fallback_reason: "alpha" }),
    debugRow(3, { kg_access_mode: "", recent_access_mode: "guarded_fallback", recent_isolated_fallback_reason: 42 }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.deepEqual(Object.keys(summary.kg_modes), ["a-mode", "unknown", "z-mode"]);
  assert.deepEqual(Object.keys(summary.recent_fallback_reasons), ["alpha", "unknown", "zeta"]);
});

test("windowDays excludes old observations", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, { kg_access_mode: "legacy_fallback" }, OUT_WINDOW),
    debugRow(2, { kg_access_mode: "isolated" }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.equal(summary.observed_hybrid_events, 1);
  assert.equal(summary.fallback_events, 0);
});

test("zero-mode production observations count as partial instrumentation coverage", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, { schema_version: 1 }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.equal(summary.observed_by_surface.memory_engine_search, 1);
  assert.equal(summary.production_observed_by_surface.memory_engine_search, 1);
  assert.equal(summary.observed_hybrid_events, 1);
  assert.equal(summary.fully_observed_events, 0);
  assert.equal(summary.partial_observed_events, 1);
  assert.equal(summary.partial_observation_rate, 1);
  assert.equal(summary.kg_attempted_events, 0);
  assert.equal(summary.recent_attempted_events, 0);
});

test("one access mode is a partial production observation", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, { surface: "memory_engine_action_search", kg_access_mode: "isolated" }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.equal(summary.observed_hybrid_events, 1);
  assert.equal(summary.fully_observed_events, 0);
  assert.equal(summary.partial_observed_events, 1);
  assert.equal(summary.kg_attempted_events, 1);
  assert.equal(summary.recent_attempted_events, 0);
});

test("CLI observations are visible by surface but excluded from the production denominator", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, {
      surface: "cli_search",
      schema_version: 1,
      kg_access_mode: "legacy_fallback",
      recent_access_mode: "isolated",
      kg_isolated_fallback_reason: "cli_reason",
    }),
    debugRow(2, {
      surface: "memory_engine_search",
      schema_version: 1,
      kg_access_mode: "isolated",
      recent_access_mode: "isolated",
    }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.equal(summary.observed_hybrid_events, 1);
  assert.equal(summary.fallback_events, 0);
  assert.deepEqual(summary.observed_by_surface, {
    cli_search: 1,
    memory_engine_search: 1,
  });
  assert.deepEqual(summary.fallback_by_surface, { cli_search: 1 });
  assert.deepEqual(summary.excluded_from_production_by_surface, { cli_search: 1 });
});

test("unknown surfaces are visible but excluded from production metrics", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, {
      surface: "unknown",
      kg_access_mode: "legacy_fallback",
      recent_access_mode: "isolated",
    }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.equal(summary.observed_by_surface.unknown, 1);
  assert.equal(summary.unknown_surface_events, 1);
  assert.equal(summary.observed_hybrid_events, 0);
  assert.equal(summary.fallback_events, 0);
  assert.deepEqual(summary.excluded_from_production_by_surface, { unknown: 1 });
});

test("only the three production surfaces enter the denominator", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, { surface: "auto_recall", kg_access_mode: "isolated" }),
    debugRow(2, { surface: "memory_engine_action_search", kg_access_mode: "isolated" }),
    debugRow(3, { surface: "memory_engine_search", kg_access_mode: "isolated" }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.equal(summary.observed_hybrid_events, 3);
  assert.deepEqual(summary.production_observed_by_surface, {
    auto_recall: 1,
    memory_engine_action_search: 1,
    memory_engine_search: 1,
  });
});

test("schema distributions expose mixed, missing, and unsupported versions", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, { schema_version: 1 }),
    debugRow(2, { schema_version: 1 }),
    debugRow(3, { schema_version: 2 }),
    debugRow(4, { schema_version: undefined }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.deepEqual(summary.observation_schema_versions, { "1": 2, "2": 1, unknown: 1 });
  assert.equal(summary.missing_schema_version_events, 1);
  assert.equal(summary.unsupported_schema_version_events, 1);
});

test("search_executed controls the production denominator without hiding coverage", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, { search_executed: false, kg_access_mode: "legacy_fallback" }),
    debugRow(2, { kg_access_mode: "isolated" }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.equal(summary.search_executed_events, 1);
  assert.equal(summary.search_not_executed_events, 1);
  assert.equal(summary.observed_by_surface.memory_engine_search, 2);
  assert.equal(summary.observed_hybrid_events, 1);
  assert.equal(summary.fallback_events, 0);
  assert.equal(summary.excluded_from_production_by_surface.memory_engine_search, 1);
});
