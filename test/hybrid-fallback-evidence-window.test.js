import test from "node:test";
import assert from "node:assert/strict";

import {
  createHybridFallbackEvidenceSnapshot,
  evaluateHybridFallbackEvidenceWindow,
} from "../lib/recall/hybrid/fallback-evidence-window.js";

const SURFACES = ["auto_recall", "memory_engine_action_search", "memory_engine_search"];

function event(surface, timestamp, overrides = {}) {
  const completedAtInput = overrides.completed_at ?? timestamp;
  const completedAt = typeof completedAtInput === "string" && completedAtInput.trim()
    ? new Date(completedAtInput).toISOString()
    : null;
  const metadata = {
    surface,
    schema_version: 1,
    search_executed: true,
    completed_at: completedAt,
    kg_access_mode: "isolated",
    recent_access_mode: "isolated",
    ...overrides.metadata,
  };
  const row = {
    ...overrides,
    event_type: "hybrid_search_observation",
    source: `hybrid.${surface}`,
    session_id: surface === "auto_recall" ? `session-${timestamp || "missing"}` : null,
    trace_id: `trace-${surface}-${timestamp || "missing"}`,
    metadata_json: JSON.stringify(metadata),
    created_at: timestamp,
  };
  delete row.metadata;
  delete row.completed_at;
  return row;
}

function balancedEvents({ start = "2026-07-01T00:00:00Z", end = "2026-07-15T00:00:00Z" } = {}) {
  return Array.from({ length: 100 }, (_, index) => event(
    SURFACES[index % SURFACES.length],
    index === 99 ? end : start,
  ));
}

test("empty observations are insufficient evidence", () => {
  const snapshot = evaluateHybridFallbackEvidenceWindow({ observations: [] });
  assert.equal(snapshot.decision, "insufficient_evidence");
  assert.deepEqual(snapshot.window, {
    first_observed_at: null,
    last_observed_at: null,
    duration_days: 0,
  });
  assert.equal(snapshot.counts.production_events, 0);
});

test("100 balanced observations over three days are insufficient", () => {
  const observations = balancedEvents({
    start: "2026-07-01T00:00:00Z",
    end: "2026-07-04T00:00:00Z",
  });
  const snapshot = evaluateHybridFallbackEvidenceWindow({ observations });
  assert.equal(snapshot.decision, "insufficient_evidence");
  assert.equal(snapshot.coverage.sufficient_events, true);
  assert.equal(snapshot.coverage.sufficient_surface_events, true);
  assert.equal(snapshot.coverage.sufficient_window, false);
});

test("balanced production observations over fourteen days are ready", () => {
  const snapshot = evaluateHybridFallbackEvidenceWindow({
    observations: balancedEvents(),
  });
  assert.equal(snapshot.decision, "ready");
  assert.deepEqual(snapshot.counts.production_by_surface, {
    auto_recall: 34,
    memory_engine_action_search: 33,
    memory_engine_search: 33,
  });
  assert.equal(snapshot.window.duration_days, 14);
  assert.equal(snapshot.observed_hybrid_events, 100);
});

test("completed_at takes precedence over created_at", () => {
  const snapshot = evaluateHybridFallbackEvidenceWindow({
    observations: [
      event("auto_recall", "2026-07-01T00:00:00Z", { completed_at: "2026-07-14T00:00:00Z" }),
      event("memory_engine_action_search", "2026-07-01T00:00:00Z", { completed_at: "2026-07-15T00:00:00Z" }),
    ],
    thresholds: {
      minimum_observations: 2,
      minimum_surface_observations: 1,
      minimum_window_days: 1,
    },
  });
  assert.equal(snapshot.window.first_observed_at, "2026-07-14T00:00:00.000Z");
  assert.equal(snapshot.window.last_observed_at, "2026-07-15T00:00:00.000Z");
  assert.equal(snapshot.window.duration_days, 1);
});

test("missing canonical completion timestamp blocks production evidence", () => {
  const snapshot = evaluateHybridFallbackEvidenceWindow({
    observations: [event("auto_recall", null)],
    thresholds: {
      minimum_observations: 1,
      minimum_surface_observations: 1,
      minimum_window_days: 0,
    },
  });
  assert.equal(snapshot.decision, "blocked");
  assert.equal(snapshot.counts.missing_timestamp_events, 1);
  assert.equal(snapshot.counts.invalid_provenance_observation_events, 1);
  assert.ok(snapshot.blockers.includes("invalid_observation_provenance"));
});

test("invalid AutoRecall provenance is isolated with ids and reason distribution", () => {
  const invalid = event("auto_recall", "2026-07-01T00:00:00Z");
  invalid.id = 11087;
  invalid.source = null;
  invalid.session_id = null;
  invalid.trace_id = null;
  const metadata = JSON.parse(invalid.metadata_json);
  metadata.completed_at = null;
  invalid.metadata_json = JSON.stringify(metadata);

  const snapshot = evaluateHybridFallbackEvidenceWindow({
    observations: [
      invalid,
      event("memory_engine_search", "2026-07-01T00:00:00Z"),
    ],
    thresholds: {
      minimum_observations: 1,
      minimum_surface_observations: 0,
      minimum_window_days: 0,
    },
  });

  assert.equal(snapshot.decision, "blocked");
  assert.equal(snapshot.counts.production_events, 1);
  assert.equal(snapshot.invalid_provenance_observation_count, 1);
  assert.deepEqual(snapshot.invalid_provenance_observation_ids, [11087]);
  assert.equal(snapshot.invalid_provenance_reason_distribution.source_mismatch, 1);
  assert.ok(snapshot.blockers.includes("invalid_observation_provenance"));
});

test("CLI observations are excluded from production evidence", () => {
  const snapshot = evaluateHybridFallbackEvidenceWindow({
    observations: [event("cli_search", "2026-07-01T00:00:00Z")],
  });
  assert.equal(snapshot.decision, "insufficient_evidence");
  assert.equal(snapshot.counts.total_events, 1);
  assert.equal(snapshot.counts.production_events, 0);
  assert.equal(snapshot.counts.excluded_surfaces.cli_search, 1);
});

test("unknown surface is a hard blocker", () => {
  const snapshot = evaluateHybridFallbackEvidenceWindow({
    observations: [event("future_surface", "2026-07-01T00:00:00Z")],
  });
  assert.equal(snapshot.decision, "blocked");
  assert.ok(snapshot.blockers.includes("unknown_surface_contamination"));
});

test("unsupported-schema fallback rows are rejected before production counting", () => {
  const snapshot = evaluateHybridFallbackEvidenceWindow({
    observations: [event("auto_recall", "2026-07-01T00:00:00Z", {
      metadata: {
        schema_version: 2,
        kg_access_mode: "legacy_fallback",
      },
    })],
    thresholds: {
      minimum_observations: 1,
      minimum_surface_observations: 1,
      minimum_window_days: 0,
    },
  });
  assert.equal(snapshot.decision, "blocked");
  assert.equal(snapshot.counts.production_events, 0);
  assert.equal(snapshot.counts.fallback_events, 0);
  assert.equal(snapshot.counts.invalid_provenance_observation_events, 1);
  assert.ok(snapshot.blockers.includes("invalid_observation_provenance"));
  assert.ok(snapshot.blockers.includes("unsupported_schema_version"));
});

test("canonical legacy fallback markers count even without access-mode fallback", () => {
  const snapshot = evaluateHybridFallbackEvidenceWindow({
    observations: [event("auto_recall", "2026-07-01T00:00:00Z", {
      metadata: {
        legacy_db_fallback_used: true,
        legacy_db_fallback_channels: ["kg"],
      },
    })],
    thresholds: {
      minimum_observations: 1,
      minimum_surface_observations: 1,
      minimum_window_days: 0,
    },
  });
  assert.equal(snapshot.counts.fallback_events, 1);
  assert.equal(snapshot.counts.kg_fallback_events, 1);
  assert.equal(snapshot.counts.recent_fallback_events, 0);
  assert.ok(snapshot.blockers.includes("fallback_events_present"));
});

test("unattributed legacy fallback markers remain global fallback evidence", () => {
  const snapshot = evaluateHybridFallbackEvidenceWindow({
    observations: [event("auto_recall", "2026-07-01T00:00:00Z", {
      metadata: {
        legacy_db_fallback_used: true,
        legacy_db_fallback_channels: [],
      },
    })],
    thresholds: {
      minimum_observations: 1,
      minimum_surface_observations: 1,
      minimum_window_days: 0,
    },
  });
  assert.equal(snapshot.counts.fallback_events, 1);
  assert.equal(snapshot.counts.kg_fallback_events, 0);
  assert.equal(snapshot.counts.recent_fallback_events, 0);
  assert.equal(snapshot.counts.fallback_channel_attribution_missing_events, 1);
  assert.equal(snapshot.warnings[0].code, "fallback_channel_attribution_missing");
  assert.ok(snapshot.blockers.includes("fallback_events_present"));
});

test("snapshot helper returns the same B5-compatible evidence shape", () => {
  const input = { observations: balancedEvents() };
  const direct = evaluateHybridFallbackEvidenceWindow(input);
  const snapshot = createHybridFallbackEvidenceSnapshot(input);
  assert.deepEqual(
    { ...snapshot, generated_at: null },
    { ...direct, generated_at: null },
  );
  assert.deepEqual(snapshot.production_observed_by_surface, snapshot.counts.production_by_surface);
  assert.equal(snapshot.observation_window_days, snapshot.window.duration_days);
});
