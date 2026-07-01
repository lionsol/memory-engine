import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAutoRecallIntent } from "../lib/recall/auto-recall-intent.js";
import { buildAutoRecallDecisionTrace } from "../lib/recall/auto-recall-decision-trace.js";

function longBody(prefix, repeated = "LOG_LINE keep this body out of focused query\n", count = 80) {
  return `${prefix}\n${repeated.repeat(count)}`;
}

function longDebugLog(prefix) {
  const repeated = [
    "2026-07-01 10:00:00 ERROR request failed at memory-engine pipeline",
    "Traceback (most recent call last):",
    "  at Object.handle (/tmp/runtime/index.js:42:13)",
    "[WARN] retrying without historical context",
  ].join("\n");
  return longBody(prefix, `${repeated}\n`, 45);
}

test("decision trace maps long rewrite skip", () => {
  const intent = analyzeAutoRecallIntent(longBody("请润色下面这段文字，保持原意。"));
  const trace = buildAutoRecallDecisionTrace(intent);
  assert.deepEqual(trace, {
    long_input_detected: true,
    generic_task_detected: true,
    explicit_history_context: false,
    should_recall: false,
    intent_reason: "generic_task_without_history_context_long_input",
    focused_query: intent.focused_query,
  });
});

test("decision trace maps long debug with history focused query", () => {
  const intent = analyzeAutoRecallIntent(longDebugLog("是不是之前那个 memory-engine autoRecall focused query 问题？"));
  const trace = buildAutoRecallDecisionTrace(intent);
  assert.equal(trace.should_recall, true);
  assert.equal(trace.long_input_detected, true);
  assert.equal(trace.explicit_history_context, true);
  assert.equal(trace.intent_reason, "long_input_with_history_context_use_focused_query");
  assert.match(trace.focused_query, /memory-engine/);
  assert.equal(trace.focused_query.includes("Traceback"), false);
});

test("decision trace output structure is stable", () => {
  const intent = analyzeAutoRecallIntent("继续上次 session-checkpoint 拆分");
  const trace = buildAutoRecallDecisionTrace(intent);
  assert.deepEqual(Object.keys(trace), [
    "long_input_detected",
    "generic_task_detected",
    "explicit_history_context",
    "should_recall",
    "intent_reason",
    "focused_query",
  ]);
});
