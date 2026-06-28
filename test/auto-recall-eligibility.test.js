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

test("dreaming maintenance log bucket is denied by autoRecall hard gate", () => {
  const candidate = {
    id: "dream-maint-1",
    category: "dreaming",
    path: "memory/dreaming/2026-06-27.md",
    text: "# Deep Sleep\nRepaired recall artifacts",
    final_score: 0.7,
    primary_bucket: "dreaming_maintenance_log",
    sample_buckets: ["dreaming_maintenance_log", "dreaming_duplicate"],
  };

  const eligibility = evaluateAutoRecallEligibility(candidate);
  const gate = shouldInjectCandidate(candidate, "continue prior memory-engine work", {});

  assert.equal(eligibility.allowed, false);
  assert.deepEqual(eligibility.deny_reasons, ["denied_by_dreaming_artifact"]);
  assert.equal(eligibility.reinforcement_allowed, false);
  assert.equal(gate.inject, false);
  assert.equal(gate.reason, "denied_by_dreaming_artifact");
});

test("dreaming candidate staging bucket is denied by autoRecall hard gate", () => {
  const candidate = {
    id: "dream-stage-1",
    category: "dreaming",
    path: "memory/dreaming/2026-06-28.md",
    text: "- Candidate: x\nconfidence: 0.8\nevidence: seen in recalls\nstatus: staged",
    final_score: 0.72,
    primary_bucket: "dreaming_candidate_staging",
    sample_buckets: ["dreaming_candidate_staging", "dreaming_duplicate"],
  };

  const eligibility = evaluateAutoRecallEligibility(candidate);
  const gate = shouldInjectCandidate(candidate, "continue prior memory-engine work", {});

  assert.equal(eligibility.allowed, false);
  assert.deepEqual(eligibility.deny_reasons, ["denied_by_dreaming_artifact"]);
  assert.equal(eligibility.reinforcement_allowed, false);
  assert.equal(gate.inject, false);
  assert.equal(gate.reason, "denied_by_dreaming_artifact");
});

test("dreaming_duplicate alone is not hard denied", () => {
  const candidate = {
    id: "dream-dup-1",
    category: "dreaming",
    path: "memory/dreaming/2026-06-25.md",
    text: "duplicate dreaming body without maintenance or staging markers",
    final_score: 0.68,
    primary_bucket: "dreaming_duplicate",
    sample_buckets: ["dreaming_duplicate"],
  };

  const eligibility = evaluateAutoRecallEligibility(candidate);

  assert.equal(eligibility.allowed, true);
  assert.deepEqual(eligibility.deny_reasons, []);
  assert.equal(eligibility.reinforcement_allowed, true);
});

test("suspected_tool_output still takes precedence over dreaming artifact deny", () => {
  const candidate = {
    id: "dream-tool-1",
    category: "dreaming",
    path: "memory/dreaming/2026-06-29.md",
    text: "# Deep Sleep\nProcess exited with code 1\nRepaired recall artifacts",
    final_score: 0.7,
    primary_bucket: "suspected_tool_output",
    sample_buckets: ["suspected_tool_output", "dreaming_maintenance_log"],
  };

  const eligibility = evaluateAutoRecallEligibility(candidate);

  assert.equal(eligibility.allowed, false);
  assert.deepEqual(eligibility.deny_reasons, ["denied_by_suspected_tool_output"]);
  assert.equal(eligibility.reinforcement_allowed, false);
});
