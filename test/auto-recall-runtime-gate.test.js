import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAutoRecallRuntimeGate } from "../lib/recall/auto-recall-runtime-gate.js";

function allowedEvent(overrides = {}) {
  return {
    agent_id: "edi",
    chat_type: "interactive_user_chat",
    message_role: "user",
    ...overrides,
  };
}

test("runtime gate allows only default edi interactive user chat", () => {
  const result = evaluateAutoRecallRuntimeGate({
    event: allowedEvent(),
    ctx: {},
    config: {},
  });

  assert.deepEqual(result, {
    allowed: true,
    agentId: "edi",
    chatType: "interactive_user_chat",
    messageRole: "user",
  });
});

test("runtime gate denies missing agent, chat type, and message role by default", () => {
  assert.deepEqual(
    evaluateAutoRecallRuntimeGate({
      event: {
        chat_type: "interactive_user_chat",
        message_role: "user",
      },
      ctx: {},
      config: {},
    }),
    { allowed: false, reason: "denied_missing_agent_id" }
  );

  assert.deepEqual(
    evaluateAutoRecallRuntimeGate({
      event: {
        agent_id: "edi",
        message_role: "user",
      },
      ctx: {},
      config: {},
    }),
    { allowed: false, reason: "denied_missing_chat_type" }
  );

  assert.deepEqual(
    evaluateAutoRecallRuntimeGate({
      event: {
        agent_id: "edi",
        chat_type: "interactive_user_chat",
      },
      ctx: {},
      config: {},
    }),
    { allowed: false, reason: "denied_missing_message_role" }
  );
});

test("runtime gate denies non-allowlisted agents, chat types, and roles", () => {
  assert.deepEqual(
    evaluateAutoRecallRuntimeGate({
      event: allowedEvent({ agent_id: "codex" }),
      ctx: {},
      config: {},
    }),
    { allowed: false, reason: "denied_by_agent_allowlist", agentId: "codex" }
  );

  assert.deepEqual(
    evaluateAutoRecallRuntimeGate({
      event: allowedEvent({ chat_type: "system_task" }),
      ctx: {},
      config: {},
    }),
    { allowed: false, reason: "denied_by_chat_type_allowlist", chatType: "system_task" }
  );

  assert.deepEqual(
    evaluateAutoRecallRuntimeGate({
      event: allowedEvent({ message_role: "assistant" }),
      ctx: {},
      config: {},
    }),
    { allowed: false, reason: "denied_by_message_role_allowlist", messageRole: "assistant" }
  );
});

test("runtime gate supports config override allowlists", () => {
  const result = evaluateAutoRecallRuntimeGate({
    event: {
      agent_id: "task-planner",
      chat_type: "planner_chat",
      message_role: "user",
    },
    ctx: {},
    config: {
      agentAllowlist: ["task-planner"],
      chatTypeAllowlist: ["planner_chat"],
      messageRoleAllowlist: ["user"],
    },
  });

  assert.equal(result.allowed, true);
  assert.equal(result.agentId, "task-planner");
  assert.equal(result.chatType, "planner_chat");
  assert.equal(result.messageRole, "user");
});

test("runtime gate can read agent id from ctx but requires event chat and role", () => {
  const result = evaluateAutoRecallRuntimeGate({
    event: {
      chat_type: "interactive_user_chat",
      message_role: "user",
    },
    ctx: {
      agentId: "edi",
    },
    config: {},
  });

  assert.equal(result.allowed, true);
  assert.equal(result.agentId, "edi");
  assert.equal(result.chatType, "interactive_user_chat");
  assert.equal(result.messageRole, "user");
});
