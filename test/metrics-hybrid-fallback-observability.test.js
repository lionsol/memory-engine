import test from "node:test";
import assert from "node:assert/strict";
import { buildHybridFallbackObservabilitySummary } from "../console/services/metrics-service.js";

const NOW_MS = Date.parse("2026-05-30T00:00:00Z");
const IN_WINDOW = "2026-05-29 12:00:00";
const OUT_WINDOW = "2026-05-01 12:00:00";

function debugRow(id, metadata, createdAt = IN_WINDOW, eventType = "auto_recall_debug") {
  return {
    id,
    event_type: eventType,
    trace_id: `trace-${id}`,
    metadata_json: typeof metadata === "string" ? metadata : JSON.stringify(metadata),
    created_at: createdAt,
  };
}

test("hybrid fallback observability: empty data returns zero summary", () => {
  assert.deepEqual(
    buildHybridFallbackObservabilitySummary([], { windowDays: 7, nowMs: NOW_MS }),
    {
      window_days: 7,
      observed_hybrid_events: 0,
      fully_observed_events: 0,
      partial_observed_events: 0,
      fully_isolated_events: 0,
      fallback_events: 0,
      fallback_rate: 0,
      kg_fallback_events: 0,
      recent_fallback_events: 0,
      both_fallback_events: 0,
      kg_modes: {},
      recent_modes: {},
      kg_fallback_reasons: {},
      recent_fallback_reasons: {},
    },
  );
});

test("hybrid fallback observability excludes skips, child debug events, other types, and invalid JSON", () => {
  const summary = buildHybridFallbackObservabilitySummary([
    debugRow(1, { skipped: true, skip_reason: "intent" }),
    debugRow(2, { debug_type: "gate_decision", kg_access_mode: "legacy_fallback" }),
    debugRow(3, { kg_access_mode: "isolated" }, IN_WINDOW, "recall_completed"),
    debugRow(4, "not-json"),
    debugRow(5, { kg_access_mode: "isolated" }),
  ], { windowDays: 7, nowMs: NOW_MS });

  assert.equal(summary.observed_hybrid_events, 1);
  assert.equal(summary.fully_isolated_events, 0);
  assert.equal(summary.fallback_events, 0);
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
