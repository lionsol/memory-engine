import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  evaluateArchivedRawLogRescueRules,
} = require("../lib/annotation/archived-raw-log-rescue-rules.cjs");
const {
  describeSignalPolarity,
  inferArchivedRawLogRescueSignals,
} = require("../lib/annotation/archived-raw-log-rescue-signals.cjs");
const {
  DEFAULT_RESCUE_SCORING_THRESHOLD,
  computeArchivedRawLogRescueScore,
} = require("../lib/annotation/archived-raw-log-rescue-scoring.cjs");

function sample(overrides = {}) {
  return {
    sample_id: "rescue:test",
    primary_bucket: "archived_raw_log_project",
    risk_signals: [],
    quality_flags: ["archived_raw_log", "raw_log_leak"],
    annotation: {},
    ...overrides,
  };
}

test("v0.1 rules treat keyword bucket as terminal drop", () => {
  const result = evaluateArchivedRawLogRescueRules(sample({
    primary_bucket: "archived_raw_log_keyword",
    risk_signals: ["project:memory-engine", "decision_signal", "preference_signal"],
  }));

  assert.equal(result.keep_active, "no");
  assert.equal(result.rule_id, "K1_KEYWORD_HARD_DROP");
  assert.equal(result.safety.db_writes, false);
  assert.equal(result.safety.unarchive, false);
});

test("manual keep_active=no overrides target category", () => {
  const result = evaluateArchivedRawLogRescueRules(sample({
    annotation: {
      keep_active: "no",
      target_category: "project",
      rescue_confidence: "medium",
    },
    risk_signals: ["project:memory-engine"],
  }));

  assert.equal(result.keep_active, "no");
  assert.equal(result.target_category, "project");
  assert.equal(result.rule_id, "M1_MANUAL_KEEP_ACTIVE_NO");
});

test("project-related decision is kept for manual review", () => {
  const result = evaluateArchivedRawLogRescueRules(sample({
    risk_signals: ["project:memory-engine", "decision_signal"],
  }));

  assert.equal(result.keep_active, "yes");
  assert.equal(result.target_category, "project");
  assert.equal(result.rule_id, "D1_PROJECT_DECISION_KEEP");
  assert.equal(result.requires_manual_review, true);
});

test("non-project decision is dropped", () => {
  const result = evaluateArchivedRawLogRescueRules(sample({
    primary_bucket: "archived_raw_log_decision",
    risk_signals: ["decision_signal"],
  }));

  assert.equal(result.keep_active, "no");
  assert.equal(result.rule_id, "D2_NON_PROJECT_DECISION_DROP");
});

test("low rescue confidence suppresses otherwise positive unlabeled sample", () => {
  const result = evaluateArchivedRawLogRescueRules(sample({
    risk_signals: ["project:openclaw"],
    annotation: {
      rescue_confidence: "low",
      target_category: "project",
    },
  }));

  assert.equal(result.keep_active, "no");
  assert.equal(result.rule_id, "S1_LOW_CONFIDENCE_SUPPRESSION");
});

test("v0.2 scoring weakens project todo below keep threshold", () => {
  const result = computeArchivedRawLogRescueScore(sample({
    primary_bucket: "archived_raw_log_todo",
    risk_signals: ["project:memory-engine", "todo_signal"],
  }));

  assert.equal(DEFAULT_RESCUE_SCORING_THRESHOLD, 55);
  assert.equal(result.score, 44);
  assert.equal(result.predicted_keep_active, "unsure");
  assert.equal(result.boundary_distance, 11);
  assert.deepEqual(
    result.parts.map(p => p.name),
    ["project_signal", "project_todo_signal", "archived_raw_log_penalty"],
  );
});

test("v0.2 scoring keeps project-related decision over threshold", () => {
  const result = computeArchivedRawLogRescueScore(sample({
    primary_bucket: "archived_raw_log_decision",
    risk_signals: ["project:memory-engine", "decision_signal"],
  }));

  assert.equal(result.score, 56);
  assert.equal(result.predicted_keep_active, "yes");
});

test("v0.2 scoring hard-penalizes keyword bucket", () => {
  const result = computeArchivedRawLogRescueScore(sample({
    primary_bucket: "archived_raw_log_keyword",
    risk_signals: ["project:memory-engine", "decision_signal", "preference_signal"],
  }));

  assert.equal(result.predicted_keep_active, "no");
  assert.ok(result.parts.some(p => p.name === "keyword_hard_drop" && p.value === -55));
});

test("refined signals identify engineering evidence separately from tool output", () => {
  const signals = inferArchivedRawLogRescueSignals(`
    全部通过。最终状态：
    openclaw doctor → ✅ 零 warning
    openclaw plugins inspect --runtime --json → ✅ memory_engine_search loaded
    node --test # tests 352 # pass 352 # fail 0
  `);
  const polarity = describeSignalPolarity(signals);

  assert.ok(signals.includes("runtime_verification_signal"));
  assert.ok(signals.includes("test_result_summary_signal"));
  assert.ok(signals.includes("engineering_evidence_signal"));
  assert.ok(polarity.positive_evidence.includes("engineering_evidence_signal"));
  assert.equal(polarity.negative_evidence.includes("pure_tool_output_signal"), false);
});

test("refined signals identify transient cron and healthcheck noise", () => {
  const signals = inferArchivedRawLogRescueSignals(`
    [cron:123 硅基流动健康检查 03:00] 运行脚本: python3 healthcheck.py '03:00'
    Current time: Monday, June 22nd, 2026 - 7:26 AM
    Reference UTC: 2026-06-21 23:26 UTC
  `);
  const polarity = describeSignalPolarity(signals);

  assert.ok(signals.includes("transient_cron_prompt_signal"));
  assert.ok(signals.includes("healthcheck_prompt_signal"));
  assert.ok(signals.includes("transient_runtime_noise_signal"));
  assert.ok(polarity.negative_evidence.includes("transient_runtime_noise_signal"));
});

test("v0.2 scoring gives engineering evidence sampling boost", () => {
  const result = computeArchivedRawLogRescueScore(sample({
    primary_bucket: "archived_raw_log_project",
    risk_signals: [
      "project:memory-engine",
      "tool_output_or_code_signal",
      "runtime_verification_signal",
      "test_result_summary_signal",
      "engineering_evidence_signal",
    ],
  }));

  assert.equal(result.score, 60);
  assert.equal(result.predicted_keep_active, "yes");
  assert.ok(result.parts.some(p => p.name === "engineering_evidence_signal" && p.value === 22));
  assert.equal(result.parts.some(p => p.name === "tool_output_penalty"), false);
});

test("v0.2 scoring penalizes transient runtime noise", () => {
  const result = computeArchivedRawLogRescueScore(sample({
    primary_bucket: "archived_raw_log_transient",
    risk_signals: [
      "project:openclaw",
      "transient_cron_prompt_signal",
      "healthcheck_prompt_signal",
      "transient_runtime_noise_signal",
    ],
  }));

  assert.equal(result.predicted_keep_active, "no");
  assert.ok(result.parts.some(p => p.name === "transient_runtime_noise_penalty" && p.value === -35));
});
