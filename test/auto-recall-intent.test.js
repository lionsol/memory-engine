import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeAutoRecallIntent,
  classifyRecallIntent,
  classifyTaskIntent,
} from "../lib/recall/auto-recall-intent.js";
import {
  AUTO_RECALL_RECALL_INTENTS,
  AUTO_RECALL_TASK_INTENTS,
} from "../lib/recall/auto-recall-intent-contract.js";

function longBody(prefix, repeated = "LOG_LINE keep this body out of focused query\n", count = 80) {
  return `${prefix}\n${repeated.repeat(count)}`;
}

function longErrorBody(prefix) {
  return longBody(prefix, "2026-07-01 10:00:00 ERROR request failed at memory-engine pipeline\n", 40);
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

test("deterministic classifiers cover every frozen seed intent without changing legacy fields", () => {
  const cases = [
    {
      prompt: longBody("请润色下面这段文字，保持原意。"),
      task_intent: "rewrite_current_text",
      recall_intent: ["none"],
      legacy: {
        should_recall: false,
        intent_reason: "generic_task_without_history_context_long_input",
        focused_query: "请润色下面这段文字，保持原意。",
      },
    },
    {
      prompt: longBody("总结当前文本，提取要点。"),
      task_intent: "summarize_current_text",
      recall_intent: ["none"],
      legacy: {
        should_recall: false,
        intent_reason: "generic_task_without_history_context_long_input",
        focused_query: "总结当前文本，提取要点。",
      },
    },
    {
      prompt: longErrorBody("是不是之前那个 memory-engine autoRecall focused query 问题？"),
      task_intent: "debug_error",
      recall_intent: ["project_state", "historical_context"],
    },
    {
      prompt: longBody("结合 memory-engine 当前基线 review 这段方案，并和之前方案对比。"),
      task_intent: "review_plan",
      recall_intent: ["project_state", "prior_decision"],
    },
    {
      prompt: "继续上次 session-checkpoint 拆分",
      task_intent: "continue_prior_work",
      recall_intent: ["task_state", "historical_context"],
    },
    {
      prompt: "结合我们之前的方案，润色这段 memory-engine 说明。",
      task_intent: "rewrite_current_text",
      recall_intent: ["prior_decision", "project_state"],
    },
    {
      prompt: "按 memory-engine 当前状态，判断 P1 runtime gate 还有什么缺口？",
      task_intent: "answer_question",
      recall_intent: ["project_state", "task_state"],
    },
  ];

  assert.deepEqual([...AUTO_RECALL_TASK_INTENTS].sort(), [
    "answer_question",
    "casual_chat",
    "continue_prior_work",
    "debug_error",
    "extract_structured_info",
    "make_decision",
    "operate_tool",
    "plan_project",
    "review_plan",
    "rewrite_current_text",
    "summarize_current_text",
    "translate_current_text",
    "write_artifact",
  ].sort());
  assert.deepEqual([...AUTO_RECALL_RECALL_INTENTS].sort(), [
    "entity_background",
    "historical_context",
    "none",
    "prior_decision",
    "project_state",
    "task_state",
    "user_preference",
    "workflow_rule",
  ].sort());

  for (const item of cases) {
    const first = analyzeAutoRecallIntent(item.prompt);
    const second = analyzeAutoRecallIntent(item.prompt);
    assert.equal(first.task_intent, item.task_intent);
    assert.deepEqual(first.recall_intent, item.recall_intent);
    assert.equal(classifyTaskIntent(item.prompt), item.task_intent);
    assert.deepEqual(classifyRecallIntent(item.prompt, first), item.recall_intent);
    assert.deepEqual(second, first);
    if (item.legacy) {
      assert.deepEqual({
        should_recall: first.should_recall,
        intent_reason: first.intent_reason,
        focused_query: first.focused_query,
      }, item.legacy);
    }
  }
});

test("classifiers cover non-seed task intents and conservative memory-specific recall intents", () => {
  assert.equal(classifyTaskIntent("帮我制定 memory-engine 下一阶段项目计划。"), "plan_project");
  assert.equal(classifyTaskIntent("帮我在方案 A 和方案 B 之间做决定。"), "make_decision");
  assert.equal(classifyTaskIntent("运行 memory-engine 状态检查命令。"), "operate_tool");
  assert.equal(classifyTaskIntent("你好，今天怎么样？"), "casual_chat");

  assert.deepEqual(
    classifyRecallIntent("我之前说过我偏好什么终端输出？", { explicit_history_context: true }),
    ["user_preference", "historical_context"],
  );
  assert.deepEqual(
    classifyRecallIntent("我之前定的工作流规则是什么？", { explicit_history_context: true }),
    ["workflow_rule", "historical_context"],
  );
  assert.deepEqual(
    classifyRecallIntent("之前提到的 X 背景是什么？", { explicit_history_context: true }),
    ["entity_background", "historical_context"],
  );
  assert.deepEqual(classifyRecallIntent("以后每次都使用这个工作流规则。"), ["none"]);
  assert.deepEqual(classifyRecallIntent("ordinary question without memory signal"), ["none"]);
});

test("v2-B2 semantic lookup signals generalize continuation, state, decision, and entity history", () => {
  const cases = [
    {
      prompt: "我们做到哪一步了？",
      task_intent: "continue_prior_work",
      recall_intent: ["task_state", "historical_context"],
    },
    {
      prompt: "What were we working on before?",
      task_intent: "continue_prior_work",
      recall_intent: ["task_state", "historical_context"],
    },
    {
      prompt: "memory-engine 当前进度如何？",
      task_intent: "answer_question",
      recall_intent: ["project_state", "task_state"],
    },
    {
      prompt: "这个项目还剩哪些工作？",
      task_intent: "answer_question",
      recall_intent: ["project_state", "task_state"],
    },
    {
      prompt: "Phase 2 还有哪些 gaps？",
      task_intent: "answer_question",
      recall_intent: ["project_state", "task_state"],
    },
    {
      prompt: "这个设计与先前版本相比如何？",
      task_intent: "review_plan",
      recall_intent: ["prior_decision", "project_state"],
    },
    {
      prompt: "原来我们如何决定这个方案？",
      task_intent: "answer_question",
      recall_intent: ["prior_decision", "historical_context"],
    },
    {
      prompt: "当前实现是否背离先前的决策？",
      task_intent: "review_plan",
      recall_intent: ["prior_decision", "project_state"],
    },
    {
      prompt: "之前聊过的 Zed 是什么定位？",
      task_intent: "answer_question",
      recall_intent: ["entity_background", "historical_context"],
    },
    {
      prompt: "The tool we discussed earlier, what was it for?",
      task_intent: "answer_question",
      recall_intent: ["entity_background", "historical_context"],
    },
  ];

  for (const item of cases) {
    const result = analyzeAutoRecallIntent(item.prompt);
    assert.equal(result.task_intent, item.task_intent, item.prompt);
    assert.deepEqual(result.recall_intent, item.recall_intent, item.prompt);
  }
});

test("v2-B2 minimal pairs keep fresh work and new instructions out of historical lookup", () => {
  const cases = [
    {
      prompt: "review 当前这段 memory-engine 代码",
      task_intent: "review_plan",
      recall_intent: ["none"],
    },
    {
      prompt: "解释 memory-engine 是什么",
      task_intent: "answer_question",
      recall_intent: ["none"],
    },
    {
      prompt: "为一个全新项目制定开发计划",
      task_intent: "plan_project",
      recall_intent: ["none"],
    },
    {
      prompt: "这个方案怎么样？",
      task_intent: "answer_question",
      recall_intent: ["none"],
    },
    {
      prompt: "我以前偏好哪种终端输出？",
      task_intent: "answer_question",
      recall_intent: ["user_preference", "historical_context"],
    },
    {
      prompt: "以后回答简洁一点",
      task_intent: "answer_question",
      recall_intent: ["none"],
    },
    {
      prompt: "我们之前约定的提交流程是什么？",
      task_intent: "answer_question",
      recall_intent: ["workflow_rule", "historical_context"],
    },
    {
      prompt: "从现在起提交前先运行测试",
      task_intent: "operate_tool",
      recall_intent: ["none"],
    },
    {
      prompt: "Cognee 是什么？",
      task_intent: "answer_question",
      recall_intent: ["none"],
    },
    {
      prompt: "介绍一下 Honcho",
      task_intent: "answer_question",
      recall_intent: ["none"],
    },
  ];

  for (const item of cases) {
    const result = analyzeAutoRecallIntent(item.prompt);
    assert.equal(result.task_intent, item.task_intent, item.prompt);
    assert.deepEqual(result.recall_intent, item.recall_intent, item.prompt);
  }
});

test("v2-B2 preserves representative v1 policy and focused-query outputs", () => {
  const cases = [
    {
      prompt: longBody("请润色下面这段文字，保持原意。"),
      legacy: {
        should_recall: false,
        intent_reason: "generic_task_without_history_context_long_input",
        focused_query: "请润色下面这段文字，保持原意。",
      },
    },
    {
      prompt: longBody("总结当前文本，提取要点。"),
      legacy: {
        should_recall: false,
        intent_reason: "generic_task_without_history_context_long_input",
        focused_query: "总结当前文本，提取要点。",
      },
    },
    {
      prompt: longBody("Translate this current text into English."),
      legacy: {
        should_recall: false,
        intent_reason: "generic_task_without_history_context_long_input",
        focused_query: "Translate this current text into English.",
      },
    },
    {
      prompt: longErrorBody("帮我看一下这个报错。"),
      legacy: {
        should_recall: false,
        intent_reason: "long_input_without_history_context",
        focused_query: "memory-engine | 帮我看一下这个报错。",
      },
    },
    {
      prompt: longErrorBody("是不是之前那个 memory-engine autoRecall focused query 问题？"),
      legacy: {
        should_recall: true,
        intent_reason: "long_input_with_history_context_use_focused_query",
        focused_query: "结合之前上下文 | memory-engine autoRecall | 是不是之前那个 memory-engine autoRecall focused query 问题？",
      },
    },
    {
      prompt: longBody("结合 memory-engine 当前基线 review 这段方案，并和之前方案对比。"),
      legacy: {
        should_recall: true,
        intent_reason: "long_input_with_history_context_use_focused_query",
        focused_query: "结合之前上下文 | memory-engine | 结合 memory-engine 当前基线 review 这段方案，并和之前方案对比。",
      },
    },
    {
      prompt: "继续上次 session-checkpoint 拆分",
      legacy: {
        should_recall: true,
        intent_reason: "explicit_history_context",
        focused_query: "结合之前上下文 | session-checkpoint | 继续上次 session-checkpoint 拆分",
      },
    },
    {
      prompt: "结合我们之前的方案，润色这段 memory-engine 说明。",
      legacy: {
        should_recall: true,
        intent_reason: "explicit_history_context",
        focused_query: "结合之前上下文 | memory-engine | 结合我们之前的方案，润色这段 memory-engine 说明。",
      },
    },
  ];

  for (const item of cases) {
    const result = analyzeAutoRecallIntent(item.prompt);
    assert.deepEqual({
      should_recall: result.should_recall,
      intent_reason: result.intent_reason,
      focused_query: result.focused_query,
    }, item.legacy, item.prompt);
  }
});
