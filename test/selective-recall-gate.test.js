import test from "node:test";
import assert from "node:assert/strict";

import {
  SELECTIVE_RECALL_GATE_DECISIONS,
  applySelectiveRecallGateToV1,
  classifySelectiveRecallGate,
} from "../lib/recall/selective-recall-gate.js";

test("C1 safe-skip accepts explicit current-only scope", () => {
  const result = classifySelectiveRecallGate("只分析这份日志，不补充背景。");
  assert.equal(result.decision, SELECTIVE_RECALL_GATE_DECISIONS.SAFE_SKIP);
  assert.equal(result.reason, "explicit_current_input_only");
});

test("C1 safe-skip accepts supplied current-text transformation", () => {
  const result = classifySelectiveRecallGate("从这段内联代码 `previousDecision = \"A\"` 里提取变量和值。");
  assert.equal(result.decision, SELECTIVE_RECALL_GATE_DECISIONS.SAFE_SKIP);
  assert.equal(result.reason, "supplied_current_text_transformation");
});

test("C1 safe-skip masks history inside quoted transformation input", () => {
  const result = classifySelectiveRecallGate("润色这句话：“我们上次决定先做 recall。”只润色引号内容。");
  assert.equal(result.decision, SELECTIVE_RECALL_GATE_DECISIONS.SAFE_SKIP);
  assert.equal(result.reason, "explicit_current_input_only");
  assert.equal(result.history_reference, false);
});

for (const prompt of [
  "只看当前日志，然后告诉我上次为什么失败。",
  "只分析这段代码，但也提醒我之前定下的数据库边界。",
  "不要参考旧方案，只看当前代码，不过告诉我上次的报错原因。",
]) {
  test(`C1 abstains on unmasked mixed-scope history reference: ${prompt}`, () => {
    const result = classifySelectiveRecallGate(prompt);
    assert.equal(result.decision, SELECTIVE_RECALL_GATE_DECISIONS.ABSTAIN);
    assert.equal(result.reason, "unmasked_history_reference");
    assert.equal(result.history_reference, true);
  });
}

test("C1 abstains on mixed-scope suppression plus history lookup request", () => {
  const result = classifySelectiveRecallGate("Ignore the old plan for the new design, but remind me what decision we made about AutoRecall.");
  assert.equal(result.decision, SELECTIVE_RECALL_GATE_DECISIONS.ABSTAIN);
});

test("C1 abstains on ordinary history-required request", () => {
  const result = classifySelectiveRecallGate("我们手头这条开发线现在走到哪了？");
  assert.equal(result.decision, SELECTIVE_RECALL_GATE_DECISIONS.ABSTAIN);
});

test("ABSTAIN preserves V1 decision exactly", () => {
  const result = applySelectiveRecallGateToV1("设计一个新的 memory-engine 路线图。", true);
  assert.equal(result.decision, SELECTIVE_RECALL_GATE_DECISIONS.ABSTAIN);
  assert.equal(result.should_recall, true);
});
