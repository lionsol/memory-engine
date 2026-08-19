import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeAutoRecallIntent,
} from "../lib/recall/auto-recall-intent.js";
import {
  extractAutoRecallIntentEvidence,
} from "../lib/recall/auto-recall-intent-evidence.js";

test("request-scope evidence masks quoted history before classification", () => {
  const prompt = "总结这句话：“我们之前讨论了三个数据库方案。”不要补充背景。";
  const evidence = extractAutoRecallIntentEvidence(prompt);
  const result = analyzeAutoRecallIntent(prompt);

  assert.equal(evidence.quoted_or_supplied_content_detected, true);
  assert.equal(evidence.current_input_only, true);
  assert.equal(evidence.history_reference, false);
  assert.equal(evidence.request_text.includes("三个数据库方案"), false);
  assert.equal(result.task_intent, "summarize_current_text");
  assert.deepEqual(result.recall_intent, ["none"]);
  assert.equal(Object.hasOwn(result, "request_text"), false);
});

test("quoted history cannot contaminate task or recall intent", () => {
  const cases = [
    [
      "润色这句话：“我们上次决定先做 recall。”只润色引号内容。",
      "rewrite_current_text",
    ],
    [
      "Translate this sentence: “之前方案已经通过。” Only translate the quoted text.",
      "translate_current_text",
    ],
    [
      "总结这句话：“我们之前讨论了三个数据库方案。”不要补充背景。",
      "summarize_current_text",
    ],
    [
      "从“上次测试失败、这次测试通过”这句话里提取两个状态。",
      "extract_structured_info",
    ],
  ];

  for (const [prompt, taskIntent] of cases) {
    const result = analyzeAutoRecallIntent(prompt);
    assert.equal(result.task_intent, taskIntent, prompt);
    assert.deepEqual(result.recall_intent, ["none"], prompt);
  }
});

test("suppression and current-input-only evidence override positive history cues", () => {
  const cases = [
    "别参考我们上次的方案，只看现在这个。",
    "不要结合项目历史，单独解释这个概念。",
    "Ignore the previous plan and evaluate only the current input.",
    "Disregard the earlier decision; use this proposal only.",
  ];

  for (const prompt of cases) {
    const evidence = extractAutoRecallIntentEvidence(prompt);
    const result = analyzeAutoRecallIntent(prompt);
    assert.equal(evidence.history_reference, true, prompt);
    assert.equal(evidence.history_suppressed, true, prompt);
    assert.deepEqual(result.recall_intent, ["none"], prompt);
  }
});

test("structured project-state evidence requires an anchor and state relation", () => {
  const cases = [
    ["memory-engine 现在还卡在哪个环节？", ["project_state", "task_state"]],
    ["这个项目目前还有哪些步骤没有落地？", ["project_state", "task_state"]],
    ["review 当前这段 memory-engine 代码，只看这段实现。", ["none"]],
    ["给一个全新项目制定 roadmap。", ["none"]],
  ];

  for (const [prompt, recallIntent] of cases) {
    const result = analyzeAutoRecallIntent(prompt);
    assert.deepEqual(result.recall_intent, recallIntent, prompt);
  }
});

test("continuation evidence distinguishes prior work from current-input continuation", () => {
  const positive = [
    "我们昨天停在哪一步？",
    "Where did we leave off on the rollout?",
  ];
  for (const prompt of positive) {
    const evidence = extractAutoRecallIntentEvidence(prompt);
    const result = analyzeAutoRecallIntent(prompt);
    assert.equal(evidence.continuation_lookup, true, prompt);
    assert.deepEqual(result.recall_intent, ["task_state", "historical_context"], prompt);
  }

  const currentOnly = [
    "继续把这段文字整理成表格。",
    "Continue analyzing this code.",
  ];
  for (const prompt of currentOnly) {
    const evidence = extractAutoRecallIntentEvidence(prompt);
    const result = analyzeAutoRecallIntent(prompt);
    assert.equal(evidence.current_input_only, true, prompt);
    assert.equal(evidence.continuation_lookup, false, prompt);
    assert.deepEqual(result.recall_intent, ["none"], prompt);
  }
});

test("decision and entity lookup use relations, not anchors alone", () => {
  const positive = [
    ["这个架构最初为什么这样取舍？", ["prior_decision", "project_state"]],
    ["Why did we choose the current architecture?", ["prior_decision", "project_state"]],
    ["上回提到的 Zed 是做什么的？", ["entity_background", "historical_context"]],
    ["Earlier we discussed Vector — what mattered for us?", ["entity_background", "historical_context"]],
  ];
  for (const [prompt, recallIntent] of positive) {
    const result = analyzeAutoRecallIntent(prompt);
    assert.deepEqual(result.recall_intent, recallIntent, prompt);
  }

  const negative = [
    "这个方案怎么样？",
    "Zed 是什么？",
    "介绍一下 Vector。",
  ];
  for (const prompt of negative) {
    assert.deepEqual(analyzeAutoRecallIntent(prompt).recall_intent, ["none"], prompt);
  }
});

test("preference and workflow evidence separates lookup from new instruction", () => {
  const pairs = [
    ["我过去更偏向哪种终端输出？", ["user_preference", "historical_context"]],
    ["以后技术回答少用表格。", ["none"]],
    ["原先约定的提交流程是什么？", ["workflow_rule", "historical_context"]],
    ["从现在起提交前先跑测试。", ["none"]],
  ];

  for (const [prompt, recallIntent] of pairs) {
    assert.deepEqual(analyzeAutoRecallIntent(prompt).recall_intent, recallIntent, prompt);
  }
});

test("evidence extraction is deterministic and bounded", () => {
  const prompt = "我们之前讨论过 Zed；请说明当前项目还剩什么。";
  const first = extractAutoRecallIntentEvidence(prompt);
  const second = extractAutoRecallIntentEvidence(prompt);
  assert.deepEqual(second, first);
  assert.deepEqual(Object.keys(first), [
    "request_text",
    "quoted_or_supplied_content_detected",
    "history_suppressed",
    "current_input_only",
    "history_reference",
    "historical_context_lookup",
    "project_anchor",
    "phase_anchor",
    "continuation_lookup",
    "project_state_lookup",
    "prior_decision_lookup",
    "preference_lookup",
    "workflow_lookup",
    "entity_background_lookup",
    "decision_record_lookup",
    "fresh_project_request",
  ]);
});
