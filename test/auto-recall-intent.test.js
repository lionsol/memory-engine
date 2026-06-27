import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAutoRecallIntent } from "../lib/recall/auto-recall-intent.js";

function longBody(prefix, repeated = "LOG_LINE keep this body out of focused query\n", count = 80) {
  return `${prefix}\n${repeated.repeat(count)}`;
}

test("long rewrite task skips autoRecall", () => {
  const result = analyzeAutoRecallIntent(longBody("请润色下面这段文字，保持原意。"));
  assert.equal(result.should_recall, false);
  assert.equal(result.long_input_detected, true);
  assert.equal(result.generic_task_detected, true);
  assert.equal(result.intent_reason, "generic_task_without_history_context_long_input");
});

test("long summarize task skips autoRecall", () => {
  const result = analyzeAutoRecallIntent(longBody("总结当前文本，提取要点。"));
  assert.equal(result.should_recall, false);
  assert.equal(result.intent_reason, "generic_task_without_history_context_long_input");
});

test("long project review task triggers autoRecall with focused query", () => {
  const prompt = longBody("结合 memory-engine 当前基线 review 这段方案，并和之前方案对比。");
  const result = analyzeAutoRecallIntent(prompt);
  assert.equal(result.should_recall, true);
  assert.equal(result.long_input_detected, true);
  assert.equal(result.focused_query_chars < result.original_input_chars, true);
  assert.equal(result.focused_query.includes("memory-engine"), true);
  assert.equal(result.focused_query.includes("LOG_LINE keep this body out of focused query"), false);
});

test("short continue prior work query triggers recall", () => {
  const result = analyzeAutoRecallIntent("继续上次 session-checkpoint 拆分");
  assert.equal(result.should_recall, true);
  assert.equal(result.intent_reason, "explicit_history_context");
});

test("generic task with explicit historical context triggers recall", () => {
  const result = analyzeAutoRecallIntent("结合我们之前的方案，润色这段 memory-engine 说明。");
  assert.equal(result.should_recall, true);
  assert.equal(result.generic_task_detected, true);
  assert.equal(result.intent_reason, "explicit_history_context");
});
