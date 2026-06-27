import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAutoRecallEligibility } from "../lib/recall/auto-recall-eligibility.js";
import { shouldInjectCandidate } from "../auto-recall.js";

test("suspected_tool_output candidate is denied by autoRecall hard gate", () => {
  const candidate = {
    id: "tool-output-1",
    category: "episodic",
    path: "memory/dreaming/light/2026-05-16.md",
    text: "tool transcript residue",
    final_score: 0.9,
    primary_bucket: "suspected_tool_output",
  };

  const eligibility = evaluateAutoRecallEligibility(candidate);
  const gate = shouldInjectCandidate(candidate, "memory engine compatibility", {});

  assert.equal(eligibility.allowed, false);
  assert.deepEqual(eligibility.deny_reasons, ["denied_by_suspected_tool_output"]);
  assert.equal(eligibility.reinforcement_allowed, false);
  assert.equal(gate.inject, false);
  assert.equal(gate.reason, "denied_by_suspected_tool_output");
  assert.deepEqual(gate.deny_reasons, ["denied_by_suspected_tool_output"]);
  assert.equal(gate.reinforcement_allowed, false);
});

test("raw_log_leak only candidate is not denied and only emits risk reason", () => {
  const candidate = {
    id: "raw-log-1",
    category: "raw_log",
    path: "memory/smart-add/2026-06-24.md",
    text: "OpenClaw memory-engine 5.20 compatibility note",
    final_score: 0.8,
    primary_bucket: "raw_log_leak",
    sample_buckets: ["raw_log_leak"],
  };

  const eligibility = evaluateAutoRecallEligibility(candidate);

  assert.equal(eligibility.allowed, true);
  assert.deepEqual(eligibility.deny_reasons, []);
  assert.deepEqual(eligibility.risk_reasons, ["risk_raw_log_leak_review_required"]);
  assert.equal(eligibility.reinforcement_allowed, true);
});

test("suspected_tool_output plus raw_log_leak is still denied", () => {
  const candidate = {
    id: "mixed-1",
    category: "raw_log",
    path: "memory/smart-add/2026-06-24.md",
    text: "tool residue with raw log leak markers",
    final_score: 0.8,
    primary_bucket: "raw_log_leak",
    sample_buckets: ["raw_log_leak", "suspected_tool_output"],
  };

  const eligibility = evaluateAutoRecallEligibility(candidate);
  const gate = shouldInjectCandidate(candidate, "memory engine compatibility", {});

  assert.equal(eligibility.allowed, false);
  assert.deepEqual(eligibility.deny_reasons, ["denied_by_suspected_tool_output"]);
  assert.equal(gate.inject, false);
  assert.equal(gate.reinforcement_allowed, false);
});
