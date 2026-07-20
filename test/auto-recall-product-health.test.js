import test from "node:test";
import assert from "node:assert/strict";
import { buildAutoRecallProductHealthReport } from "../lib/recall/hybrid/auto-recall-product-health.js";

const CHECKED_AT = "2026-07-20T02:00:00.000Z";

function row(eventType, overrides = {}) {
  return {
    id: overrides.id ?? 1,
    event_type: eventType,
    trace_id: overrides.trace_id ?? "trace-1",
    memory_id: overrides.memory_id ?? null,
    source: "autoRecall",
    latency_ms: overrides.latency_ms ?? null,
    metadata_json: overrides.metadata_json ?? {},
    created_at: overrides.created_at ?? "2026-07-20 01:55:00",
  };
}

function qualityReview(overrides = {}) {
  return {
    schema_version: 1,
    reviewed_at: CHECKED_AT,
    sample_size: 1,
    sampled_injection_keys: ["trace-1:memory-1"],
    irrelevant_count: 0,
    severe_irrelevant_or_context_conflict_count: 0,
    user_reported_bad_injection_count: 0,
    ...overrides,
  };
}

function healthyEvents(overrides = {}) {
  return [
    row("recall_started"),
    row("auto_recall_debug", {
      memory_id: "memory-1",
      metadata_json: {
        debug_type: "gate_decision",
        injected: true,
        allowed: true,
        rejection_reason: null,
        rejected_reason: null,
        reinforcement_allowed: true,
        deny_reasons: [],
      },
    }),
    row("memory_injected", {
      memory_id: "memory-1",
      metadata_json: { reinforcement_allowed: true, deny_reasons: [] },
    }),
    row("recall_completed", { latency_ms: overrides.latency_ms ?? 100, metadata_json: {} }),
  ];
}

test("product health is healthy only with complete telemetry and fresh quality review", () => {
  const report = buildAutoRecallProductHealthReport({
    events: healthyEvents(),
    qualityReview: qualityReview(),
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.status, "healthy");
  assert.deepEqual(report.blockers, []);
  assert.equal(report.telemetry.injected_without_allowed_gate_count, 0);
});

test("early window accepts review of all available injections when fewer than thirty exist", () => {
  const report = buildAutoRecallProductHealthReport({
    events: healthyEvents(),
    qualityReview: qualityReview({ sample_size: 1 }),
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.status, "healthy");
  assert.equal(report.quality_review.available_injection_count, 1);
  assert.equal(report.quality_review.required_sample_size, 1);
});

test("quality review cannot claim more samples than available injections", () => {
  const report = buildAutoRecallProductHealthReport({
    events: healthyEvents(),
    qualityReview: qualityReview({
      sample_size: 30,
      sampled_injection_keys: Array.from({ length: 30 }, (_, index) => `trace-${index}:memory-${index}`),
    }),
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.status, "not_evaluated");
  assert.ok(report.blockers.includes("quality_review_sample_exceeds_available_injections"));
});

test("legacy count-only quality review is not auditable", () => {
  const review = qualityReview();
  delete review.sampled_injection_keys;
  const report = buildAutoRecallProductHealthReport({
    events: healthyEvents(),
    qualityReview: review,
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.status, "not_evaluated");
  assert.ok(report.blockers.includes("quality_review_sampled_injection_keys_missing"));
});

test("quality review must cover the most recent required injection sample", () => {
  const events = [];
  for (let index = 0; index < 31; index += 1) {
    const traceId = `trace-${index}`;
    const memoryId = `memory-${index}`;
    const createdAt = `2026-07-20 01:${String(index).padStart(2, "0")}:00`;
    events.push(
      row("recall_started", { trace_id: traceId, created_at: createdAt }),
      row("auto_recall_debug", {
        trace_id: traceId,
        memory_id: memoryId,
        created_at: createdAt,
        metadata_json: {
          debug_type: "gate_decision",
          injected: true,
          allowed: true,
          reinforcement_allowed: true,
          deny_reasons: [],
        },
      }),
      row("memory_injected", {
        trace_id: traceId,
        memory_id: memoryId,
        created_at: createdAt,
        metadata_json: { reinforcement_allowed: true, deny_reasons: [] },
      }),
      row("recall_completed", { trace_id: traceId, created_at: createdAt, latency_ms: 100 }),
    );
  }
  const report = buildAutoRecallProductHealthReport({
    events,
    qualityReview: qualityReview({
      sample_size: 30,
      sampled_injection_keys: Array.from({ length: 30 }, (_, index) => `trace-${index}:memory-${index}`),
    }),
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.status, "not_evaluated");
  assert.ok(report.blockers.includes("quality_review_required_recent_sample_missing"));
  assert.equal(report.quality_review.required_recent_injection_keys[0], "trace-30:memory-30");
});

test("missing or stale quality review is not evaluated rather than healthy", () => {
  const missing = buildAutoRecallProductHealthReport({ events: healthyEvents(), checkedAt: CHECKED_AT });
  assert.equal(missing.status, "not_evaluated");
  assert.ok(missing.blockers.includes("quality_review_missing"));

  const stale = buildAutoRecallProductHealthReport({
    events: healthyEvents(),
    qualityReview: qualityReview({ reviewed_at: "2026-07-16T00:00:00.000Z" }),
    checkedAt: CHECKED_AT,
  });
  assert.equal(stale.status, "not_evaluated");
  assert.ok(stale.blockers.includes("quality_review_stale"));
});

test("injection without a matching allowed gate decision requires rollback", () => {
  const events = healthyEvents().filter(item => item.event_type !== "auto_recall_debug");
  const report = buildAutoRecallProductHealthReport({ events, qualityReview: qualityReview(), checkedAt: CHECKED_AT });
  assert.equal(report.status, "rollback_required");
  assert.ok(report.blockers.includes("injected_without_allowed_gate_present"));
});

test("hard-denied artifact injection and excessive latency require rollback", () => {
  const events = healthyEvents({ latency_ms: 4500 });
  events.find(item => item.event_type === "memory_injected").metadata_json.deny_reasons = ["denied_by_dreaming_artifact"];
  const report = buildAutoRecallProductHealthReport({ events, qualityReview: qualityReview(), checkedAt: CHECKED_AT });
  assert.equal(report.status, "rollback_required");
  assert.ok(report.blockers.includes("hard_denied_artifact_injected"));
  assert.ok(report.blockers.includes("p95_auto_recall_latency_above_threshold"));
  assert.ok(report.blockers.includes("max_auto_recall_latency_above_threshold"));
});

test("incomplete trace prevents product health evaluation", () => {
  const report = buildAutoRecallProductHealthReport({
    events: [row("recall_started")],
    qualityReview: qualityReview(),
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.status, "not_evaluated");
  assert.ok(report.blockers.includes("incomplete_auto_recall_trace_present"));
  assert.ok(report.blockers.includes("no_completed_auto_recall_trace"));
});
