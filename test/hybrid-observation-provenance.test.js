import test from "node:test";
import assert from "node:assert/strict";

import {
  PRODUCTION_HYBRID_OBSERVATION_SURFACES,
  summarizeProductionHybridObservationProvenance,
  validateProductionHybridObservationProvenance,
} from "../lib/recall/hybrid/hybrid-observation-provenance.js";

function observation(surface, overrides = {}) {
  const completedAt = Object.hasOwn(overrides, "completed_at")
    ? overrides.completed_at
    : "2026-07-18T16:15:27.266Z";
  const metadata = {
    schema_version: 1,
    surface,
    search_executed: true,
    completed_at: completedAt,
    kg_access_mode: "isolated",
    recent_access_mode: "isolated",
    ...overrides.metadata,
  };
  return {
    id: overrides.id ?? 1,
    event_type: "hybrid_search_observation",
    source: Object.hasOwn(overrides, "source") ? overrides.source : `hybrid.${surface}`,
    session_id: Object.hasOwn(overrides, "session_id")
      ? overrides.session_id
      : surface === "auto_recall"
        ? "session-1"
        : null,
    trace_id: Object.hasOwn(overrides, "trace_id") ? overrides.trace_id : "trace-1",
    metadata_json: Object.hasOwn(overrides, "metadata_json")
      ? overrides.metadata_json
      : JSON.stringify(metadata),
  };
}

test("all production surfaces accept canonical runtime provenance", () => {
  for (const surface of PRODUCTION_HYBRID_OBSERVATION_SURFACES) {
    const result = validateProductionHybridObservationProvenance(observation(surface));
    assert.equal(result.valid, true, `${surface}: ${result.reasons.join(", ")}`);
    assert.deepEqual(result.reasons, []);
    assert.equal(result.expected_source, `hybrid.${surface}`);
  }
});

test("AutoRecall requires runtime source, session, trace, and canonical completion time", () => {
  const result = validateProductionHybridObservationProvenance(observation("auto_recall", {
    id: 11087,
    source: null,
    session_id: null,
    trace_id: null,
    metadata: {
      completed_at: null,
    },
  }));

  assert.equal(result.valid, false);
  assert.equal(result.row_id, 11087);
  for (const reason of [
    "source_mismatch",
    "invalid_completed_at",
    "missing_trace_id",
    "missing_auto_recall_session_id",
  ]) {
    assert.ok(result.reasons.includes(reason), `missing reason: ${reason}`);
  }
});

test("tool surfaces require trace provenance but do not require a session id", () => {
  const valid = validateProductionHybridObservationProvenance(observation("memory_engine_search", {
    session_id: null,
  }));
  assert.equal(valid.valid, true);

  const invalid = validateProductionHybridObservationProvenance(observation("memory_engine_search", {
    trace_id: null,
  }));
  assert.equal(invalid.valid, false);
  assert.ok(invalid.reasons.includes("missing_trace_id"));
  assert.equal(invalid.reasons.includes("missing_auto_recall_session_id"), false);
});

test("schema, search execution, source, and exact production surface are enforced", () => {
  const cases = [
    [observation("memory_engine_search", { metadata: { schema_version: 2 } }), "unsupported_schema_version"],
    [observation("memory_engine_search", { metadata: { search_executed: false } }), "search_not_executed"],
    [observation("memory_engine_search", { source: "hybrid.auto_recall" }), "source_mismatch"],
    [observation("future_surface"), "unknown_production_surface"],
  ];

  for (const [row, reason] of cases) {
    const result = validateProductionHybridObservationProvenance(row);
    assert.equal(result.valid, false);
    assert.ok(result.reasons.includes(reason), `missing reason: ${reason}`);
  }
});

test("summary isolates invalid observations and exposes ids plus reason distribution", () => {
  const summary = summarizeProductionHybridObservationProvenance([
    observation("auto_recall", { id: 10 }),
    observation("memory_engine_search", { id: 11 }),
    observation("auto_recall", {
      id: 11087,
      source: null,
      session_id: null,
      trace_id: null,
      metadata: { completed_at: null },
    }),
  ]);

  assert.equal(summary.valid_count, 2);
  assert.equal(summary.invalid_count, 1);
  assert.deepEqual(summary.invalid_observation_ids, [11087]);
  assert.equal(summary.invalid_reason_distribution.source_mismatch, 1);
  assert.equal(summary.invalid_reason_distribution.missing_auto_recall_session_id, 1);
});
