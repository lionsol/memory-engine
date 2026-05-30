import test from "node:test";
import assert from "node:assert/strict";
import { buildAutoRecallInjectionRateSummary } from "../console/services/metrics-service.js";

const NOW_MS = Date.parse("2026-05-30T00:00:00Z");
const IN_WINDOW = "2026-05-29 12:00:00";
const OUT_WINDOW = "2026-05-01 12:00:00";

function debugRow({
  id,
  candidateCount,
  candidateCountAfterGate,
  injectedCount,
  createdAt = IN_WINDOW,
} = {}) {
  const metadata = {};
  if (candidateCount !== undefined) metadata.candidate_count = candidateCount;
  if (candidateCountAfterGate !== undefined) metadata.candidate_count_after_gate = candidateCountAfterGate;
  if (injectedCount !== undefined) metadata.injected_count = injectedCount;
  return {
    id,
    event_type: "auto_recall_debug",
    trace_id: `t-${id}`,
    session_id: "s1",
    memory_id: null,
    metadata_json: JSON.stringify(metadata),
    created_at: createdAt,
  };
}

test("auto recall injection rate: empty data returns zeros", () => {
  const summary = buildAutoRecallInjectionRateSummary([], { windowDays: 7, nowMs: NOW_MS });
  assert.equal(summary.candidate_count, 0);
  assert.equal(summary.candidate_count_after_gate, 0);
  assert.equal(summary.injected_count, 0);
  assert.equal(summary.injection_rate, 0);
  assert.equal(summary.gate_pass_rate, 0);
});

test("auto recall injection rate: all injected yields rate=1", () => {
  const rows = [debugRow({ id: 1, candidateCount: 10, candidateCountAfterGate: 10, injectedCount: 10 })];
  const summary = buildAutoRecallInjectionRateSummary(rows, { windowDays: 7, nowMs: NOW_MS });
  assert.equal(summary.candidate_count, 10);
  assert.equal(summary.injected_count, 10);
  assert.equal(summary.injection_rate, 1);
});

test("auto recall injection rate: partial injected computes rate correctly", () => {
  const rows = [debugRow({ id: 1, candidateCount: 10, candidateCountAfterGate: 4, injectedCount: 3 })];
  const summary = buildAutoRecallInjectionRateSummary(rows, { windowDays: 7, nowMs: NOW_MS });
  assert.equal(summary.candidate_count, 10);
  assert.equal(summary.injected_count, 3);
  assert.equal(summary.injection_rate, 0.3);
});

test("auto recall injection rate: gate pass rate is computed", () => {
  const rows = [debugRow({ id: 1, candidateCount: 10, candidateCountAfterGate: 4, injectedCount: 3 })];
  const summary = buildAutoRecallInjectionRateSummary(rows, { windowDays: 7, nowMs: NOW_MS });
  assert.equal(summary.gate_pass_rate, 0.4);
});

test("auto recall injection rate: windowDays excludes out-of-window rows", () => {
  const rows = [
    debugRow({ id: 1, candidateCount: 10, candidateCountAfterGate: 10, injectedCount: 10, createdAt: OUT_WINDOW }),
    debugRow({ id: 2, candidateCount: 2, candidateCountAfterGate: 1, injectedCount: 1, createdAt: IN_WINDOW }),
  ];
  const summary = buildAutoRecallInjectionRateSummary(rows, { windowDays: 7, nowMs: NOW_MS });
  assert.equal(summary.candidate_count, 2);
  assert.equal(summary.injected_count, 1);
});

test("auto recall injection rate: missing payload fields fallback to 0", () => {
  const rows = [debugRow({ id: 1 })];
  const summary = buildAutoRecallInjectionRateSummary(rows, { windowDays: 7, nowMs: NOW_MS });
  assert.equal(summary.candidate_count, 0);
  assert.equal(summary.candidate_count_after_gate, 0);
  assert.equal(summary.injected_count, 0);
  assert.equal(summary.injection_rate, 0);
  assert.equal(summary.gate_pass_rate, 0);
});

