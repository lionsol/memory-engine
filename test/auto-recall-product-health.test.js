import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildAutoRecallProductHealthReport } from "../lib/recall/hybrid/auto-recall-product-health.js";

const require = createRequire(import.meta.url);
const { buildAutoRecallProductHealthCli, parseArgs } = require("../bin/build-auto-recall-product-health-report.js");

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

function aggregateDebug(traceId, overrides = {}) {
  return row("auto_recall_debug", {
    trace_id: traceId,
    metadata_json: {
      gate_decisions: [],
      rejected_candidates: [],
      ...overrides,
    },
  });
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

test("aggregate gate decisions alone authorize a matching injection", () => {
  const events = [
    row("recall_started", { trace_id: "trace-aggregate" }),
    aggregateDebug("trace-aggregate", {
      vector_ms: 12,
      gate_decisions: [{
        id: "memory-1",
        injected: true,
        allowed: true,
        rejection_reason: null,
        rejected_reason: null,
        reinforcement_allowed: true,
        deny_reasons: [],
      }],
    }),
    row("memory_injected", { trace_id: "trace-aggregate", memory_id: "memory-1" }),
    row("recall_completed", { trace_id: "trace-aggregate", latency_ms: 100, metadata_json: {} }),
  ];
  const report = buildAutoRecallProductHealthReport({
    events,
    qualityReview: qualityReview({ sampled_injection_keys: ["trace-aggregate:memory-1"] }),
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.telemetry.injected_without_allowed_gate_count, 0);
  assert.deepEqual(report.reconstruction.gate, {
    decision_trace_count: 1,
    pass_trace_count: 1,
    full_reject_trace_count: 0,
    unknown_trace_count: 0,
    rejection_reason_counts: {},
    full_reject_reason_counts: {},
  });
});

test("aggregate full-reject gate evidence reconstructs bounded rejection reasons", () => {
  const traceId = "trace-full-reject";
  const report = buildAutoRecallProductHealthReport({
    events: [
      row("recall_started", { trace_id: traceId }),
      aggregateDebug(traceId, {
        gate_decisions: [
          { id: "memory-raw", injected: false, allowed: true, rejected_reason: "raw_log_low_coverage_no_exact" },
          { id: "memory-episodic", injected: false, allowed: true, rejection_reason: "episodic_final_score_below_minimum" },
          { id: "memory-policy", injected: false, allowed: false, reason: "policy_scope_denied" },
        ],
      }),
      row("recall_completed", { trace_id: traceId, latency_ms: 100, metadata_json: {} }),
    ],
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.reconstruction.gate.full_reject_trace_count, 1);
  assert.deepEqual(report.reconstruction.gate.rejection_reason_counts, {
    episodic_final_score_below_minimum: 1,
    policy_scope_denied: 1,
    raw_log_low_coverage_no_exact: 1,
  });
  assert.deepEqual(report.reconstruction.gate.full_reject_reason_counts, {
    episodic_final_score_below_minimum: 1,
    policy_scope_denied: 1,
    raw_log_low_coverage_no_exact: 1,
  });
});

test("aggregate gate evidence takes precedence over individual evidence", () => {
  const traceId = "trace-no-double-count";
  const report = buildAutoRecallProductHealthReport({
    events: [
      row("recall_started", { trace_id: traceId }),
      aggregateDebug(traceId, {
        gate_decisions: [{ id: "memory-1", injected: true, allowed: true }],
      }),
      row("auto_recall_debug", {
        trace_id: traceId,
        memory_id: "memory-1",
        metadata_json: {
          debug_type: "gate_decision",
          injected: false,
          allowed: false,
          rejected_reason: "should_not_be_counted",
        },
      }),
      row("memory_injected", { trace_id: traceId, memory_id: "memory-1" }),
      row("recall_completed", { trace_id: traceId, latency_ms: 100, metadata_json: {} }),
    ],
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.telemetry.injected_without_allowed_gate_count, 0);
  assert.equal(report.reconstruction.gate.decision_trace_count, 1);
  assert.equal(report.reconstruction.gate.pass_trace_count, 1);
  assert.deepEqual(report.reconstruction.gate.rejection_reason_counts, {});
});

test("execution-only latency excludes explicitly skipped completions", () => {
  const report = buildAutoRecallProductHealthReport({
    events: [
      row("recall_completed", {
        trace_id: "trace-explicit-skip",
        latency_ms: 9000,
        metadata_json: { skipped: true, skip_reason: "short_input" },
      }),
      row("recall_started", { trace_id: "trace-executed" }),
      row("recall_completed", { trace_id: "trace-executed", latency_ms: 100, metadata_json: {} }),
    ],
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.telemetry.p95_auto_recall_latency_ms, 9000);
  assert.deepEqual(report.reconstruction.executed_completed_hook_latency_ms, {
    sample_count: 1,
    p50: 100,
    p95: 100,
    max: 100,
  });
  assert.equal(report.reconstruction.explicitly_skipped_completed_count, 1);
});

test("started and completed traces populate execution latency with nearest-rank p50 and p95", () => {
  const events = [10, 20, 30].flatMap((latency, index) => [
    row("recall_started", { trace_id: `trace-latency-${index}` }),
    row("recall_completed", {
      trace_id: `trace-latency-${index}`,
      latency_ms: latency,
      metadata_json: {},
    }),
  ]);
  const report = buildAutoRecallProductHealthReport({ events, checkedAt: CHECKED_AT });
  assert.deepEqual(report.reconstruction.executed_completed_hook_latency_ms, {
    sample_count: 3,
    p50: 20,
    p95: 30,
    max: 30,
  });
});

test("started without completed is incomplete and excluded from execution percentile", () => {
  const report = buildAutoRecallProductHealthReport({
    events: [row("recall_started", { trace_id: "trace-incomplete" })],
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.reconstruction.executed_started_count, 1);
  assert.equal(report.reconstruction.executed_completed_count, 0);
  assert.equal(report.reconstruction.executed_incomplete_count, 1);
  assert.deepEqual(report.reconstruction.executed_completed_hook_latency_ms, {
    sample_count: 0,
    p50: null,
    p95: null,
    max: null,
  });
});

test("completion without started is unclassified unless skip is explicit", () => {
  const report = buildAutoRecallProductHealthReport({
    events: [
      row("recall_completed", { trace_id: "trace-unclassified", latency_ms: 100, metadata_json: {} }),
      row("recall_completed", {
        trace_id: "trace-skipped",
        latency_ms: 100,
        metadata_json: { skipped: true },
      }),
    ],
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.reconstruction.explicitly_skipped_completed_count, 1);
  assert.equal(report.reconstruction.unclassified_completed_count, 1);
});

test("aggregate vector_ms provides an independent vector timing summary", () => {
  const events = [10, 30, 20, -1, "NaN"].map((vectorMs, index) => aggregateDebug(`trace-vector-${index}`, {
    vector_ms: vectorMs,
  }));
  const report = buildAutoRecallProductHealthReport({ events, checkedAt: CHECKED_AT });
  assert.deepEqual(report.reconstruction.vector_latency_ms, {
    sample_count: 3,
    p50: 20,
    p95: 30,
    max: 30,
  });
});

test("Q6 shadow decisions are separate from actual injection counts", () => {
  const report = buildAutoRecallProductHealthReport({
    events: [row("auto_recall_debug", {
      trace_id: "trace-shadow",
      metadata_json: {
        debug_type: "q6_shadow_decision",
        mode: "shadow",
        would_inject_count: 2,
      },
    })],
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.telemetry.injected_count, 0);
  assert.deepEqual(report.reconstruction.shadow, {
    decision_trace_count: 1,
    would_inject_trace_count: 1,
    executed_started_count: 0,
    executed_completed_count: 0,
    executed_incomplete_count: 0,
    executed_completed_hook_latency_ms: {
      sample_count: 0,
      p50: null,
      p95: null,
      max: null,
    },
    vector_latency_ms: {
      sample_count: 0,
      p50: null,
      p95: null,
      max: null,
    },
    gate: {
      decision_trace_count: 0,
      pass_trace_count: 0,
      full_reject_trace_count: 0,
      unknown_trace_count: 0,
      rejection_reason_counts: {},
      full_reject_reason_counts: {},
    },
  });
});

test("explicit builder and CLI evidence windows exclude older events", async () => {
  const oldEvent = row("recall_completed", {
    trace_id: "trace-old",
    created_at: "2026-07-20 00:30:00",
    latency_ms: 10,
    metadata_json: {},
  });
  const currentEvent = row("recall_completed", {
    trace_id: "trace-current",
    created_at: "2026-07-20 01:30:00",
    latency_ms: 20,
    metadata_json: {},
  });
  const windowStart = "2026-07-20T01:00:00.000Z";
  const direct = buildAutoRecallProductHealthReport({
    events: [oldEvent, currentEvent],
    checkedAt: CHECKED_AT,
    windowStart,
  });
  assert.equal(direct.telemetry.event_count, 1);
  assert.deepEqual(direct.analysis_window, {
    start: windowStart,
    end: CHECKED_AT,
    source: "explicit",
  });

  const tempRoot = mkdtempSync(join(tmpdir(), "auto-recall-product-health-"));
  const eventsPath = join(tempRoot, "events.json");
  try {
    writeFileSync(eventsPath, JSON.stringify([oldEvent, currentEvent]));
    const parsed = parseArgs(["--events", eventsPath, "--window-start", windowStart]);
    assert.equal(parsed.windowStart, windowStart);
    const cliResult = await buildAutoRecallProductHealthCli([
      "--events", eventsPath,
      "--checked-at", CHECKED_AT,
      "--window-start", windowStart,
    ]);
    assert.equal(cliResult.report.telemetry.event_count, 1);
    assert.equal(cliResult.report.analysis_window.source, "explicit");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("invalid explicit windowStart fails closed", () => {
  assert.throws(
    () => buildAutoRecallProductHealthReport({
      events: [],
      checkedAt: CHECKED_AT,
      windowStart: "2026-07-20T01:00:00Z",
    }),
    /windowStart must be a canonical UTC ISO timestamp/,
  );
  assert.throws(
    () => buildAutoRecallProductHealthReport({
      events: [],
      checkedAt: CHECKED_AT,
      windowStart: "2026-07-20T03:00:00.000Z",
    }),
    /windowStart must not be after checkedAt/,
  );
});

test("gate diagnostics partition all, non-shadow, and shadow traces", () => {
  const report = buildAutoRecallProductHealthReport({
    events: [
      row("recall_started", { trace_id: "trace-non-shadow" }),
      aggregateDebug("trace-non-shadow", {
        gate_decisions: [{ id: "memory-pass", injected: true, allowed: true }],
      }),
      row("recall_completed", { trace_id: "trace-non-shadow", latency_ms: 100, metadata_json: {} }),
      row("recall_started", { trace_id: "trace-shadow-reject" }),
      aggregateDebug("trace-shadow-reject", {
        gate_decisions: [{
          id: "memory-shadow-reject",
          injected: false,
          allowed: true,
          rejected_reason: "shadow_gate_rejected",
        }],
      }),
      row("auto_recall_debug", {
        trace_id: "trace-shadow-reject",
        metadata_json: {
          debug_type: "q6_shadow_decision",
          mode: "shadow",
          would_inject_count: 0,
        },
      }),
      row("recall_completed", { trace_id: "trace-shadow-reject", latency_ms: 200, metadata_json: {} }),
    ],
    checkedAt: CHECKED_AT,
  });

  assert.equal(report.reconstruction.gate.decision_trace_count, 2);
  assert.equal(report.reconstruction.non_shadow.gate.decision_trace_count, 1);
  assert.equal(report.reconstruction.non_shadow.gate.pass_trace_count, 1);
  assert.equal(report.reconstruction.shadow.gate.decision_trace_count, 1);
  assert.equal(report.reconstruction.shadow.gate.full_reject_trace_count, 1);
  assert.equal(report.reconstruction.shadow.gate.full_reject_reason_counts.shadow_gate_rejected, 1);
});

test("shadow execution and vector timing stay out of non-shadow diagnostics", () => {
  const report = buildAutoRecallProductHealthReport({
    events: [
      row("recall_started", { trace_id: "trace-non-shadow-timing" }),
      aggregateDebug("trace-non-shadow-timing", { vector_ms: 11 }),
      row("recall_completed", { trace_id: "trace-non-shadow-timing", latency_ms: 100, metadata_json: {} }),
      row("recall_started", { trace_id: "trace-shadow-timing" }),
      aggregateDebug("trace-shadow-timing", { vector_ms: 22 }),
      row("auto_recall_debug", {
        trace_id: "trace-shadow-timing",
        metadata_json: {
          debug_type: "q6_shadow_decision",
          mode: "shadow",
          would_inject_count: 1,
        },
      }),
      row("recall_completed", { trace_id: "trace-shadow-timing", latency_ms: 200, metadata_json: {} }),
    ],
    checkedAt: CHECKED_AT,
  });

  assert.deepEqual(report.reconstruction.non_shadow.executed_completed_hook_latency_ms, {
    sample_count: 1,
    p50: 100,
    p95: 100,
    max: 100,
  });
  assert.deepEqual(report.reconstruction.shadow.executed_completed_hook_latency_ms, {
    sample_count: 1,
    p50: 200,
    p95: 200,
    max: 200,
  });
  assert.deepEqual(report.reconstruction.non_shadow.vector_latency_ms, {
    sample_count: 1,
    p50: 11,
    p95: 11,
    max: 11,
  });
  assert.deepEqual(report.reconstruction.shadow.vector_latency_ms, {
    sample_count: 1,
    p50: 22,
    p95: 22,
    max: 22,
  });
});

test("overall rejection reasons include rejected candidates on partial-pass traces", () => {
  const traceId = "trace-partial-pass";
  const report = buildAutoRecallProductHealthReport({
    events: [
      row("recall_started", { trace_id: traceId }),
      aggregateDebug(traceId, {
        gate_decisions: [
          { id: "memory-pass", injected: true, allowed: true },
          { id: "memory-x", injected: false, allowed: true, rejected_reason: "reason_x" },
          { id: "memory-y", injected: false, allowed: true, rejection_reason: "reason_y" },
        ],
      }),
      row("recall_completed", { trace_id: traceId, latency_ms: 100, metadata_json: {} }),
    ],
    checkedAt: CHECKED_AT,
  });

  assert.equal(report.reconstruction.gate.pass_trace_count, 1);
  assert.deepEqual(report.reconstruction.gate.rejection_reason_counts, {
    reason_x: 1,
    reason_y: 1,
  });
  assert.deepEqual(report.reconstruction.gate.full_reject_reason_counts, {});
});
