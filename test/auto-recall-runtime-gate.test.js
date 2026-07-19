import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateAutoRecallRuntimeGate } from "../lib/recall/auto-recall-runtime-gate.js";

const MANIFEST = new URL("../openclaw.plugin.json", import.meta.url);

function hostEvent(overrides = {}) {
  return {
    prompt: "question",
    messages: [],
    ...overrides,
  };
}

function hostContext(overrides = {}) {
  return {
    agentId: "edi",
    trigger: "user",
    runId: "run-1",
    sessionId: "session-1",
    ...overrides,
  };
}

test("runtime gate allows a host-shaped user turn without chat or role fields", () => {
  const result = evaluateAutoRecallRuntimeGate({
    event: hostEvent(),
    ctx: hostContext(),
    config: {},
  });

  assert.deepEqual(result, {
    allowed: true,
    agentId: "edi",
    trigger: "user",
    chatType: null,
    messageRole: null,
  });
});

test("runtime gate keeps agent and trigger default-deny", () => {
  assert.equal(
    evaluateAutoRecallRuntimeGate({
      event: hostEvent(),
      ctx: { trigger: "user" },
      config: {},
    }).reason,
    "denied_missing_agent_id",
  );

  assert.equal(
    evaluateAutoRecallRuntimeGate({
      event: hostEvent(),
      ctx: { agentId: "edi" },
      config: {},
    }).reason,
    "denied_missing_trigger",
  );
});

test("runtime gate rejects every known non-user trigger", () => {
  for (const trigger of [
    "heartbeat",
    "cron",
    "memory",
    "budget",
    "manual",
    "timeout_recovery",
    "overflow",
  ]) {
    const result = evaluateAutoRecallRuntimeGate({
      event: hostEvent(),
      ctx: hostContext({ trigger }),
      config: {},
    });
    assert.equal(result.reason, "denied_by_trigger_allowlist", trigger);
    assert.equal(result.trigger, trigger);
  }
});

test("runtime gate rejects non-allowlisted agents", () => {
  const result = evaluateAutoRecallRuntimeGate({
    event: hostEvent(),
    ctx: hostContext({ agentId: "codex" }),
    config: {},
  });

  assert.deepEqual(result, {
    allowed: false,
    reason: "denied_by_agent_allowlist",
    agentId: "codex",
  });
});

test("explicit chat type and message role remain supplementary constraints", () => {
  assert.equal(
    evaluateAutoRecallRuntimeGate({
      event: hostEvent({ chat_type: "interactive_user_chat" }),
      ctx: hostContext(),
      config: {},
    }).allowed,
    true,
  );
  assert.equal(
    evaluateAutoRecallRuntimeGate({
      event: hostEvent({ chat_type: "system_task" }),
      ctx: hostContext(),
      config: {},
    }).reason,
    "denied_by_chat_type_allowlist",
  );
  assert.equal(
    evaluateAutoRecallRuntimeGate({
      event: hostEvent({ message_role: "user" }),
      ctx: hostContext(),
      config: {},
    }).allowed,
    true,
  );
  assert.equal(
    evaluateAutoRecallRuntimeGate({
      event: hostEvent({ message_role: "assistant" }),
      ctx: hostContext(),
      config: {},
    }).reason,
    "denied_by_message_role_allowlist",
  );
});

test("manifest exposes strict agent and trigger defaults plus optional compatibility constraints", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const autoRecall = manifest.configSchema.properties.autoRecall;

  assert.equal(autoRecall.additionalProperties, false);
  const expected = {
    agentAllowlist: ["edi"],
    triggerAllowlist: ["user"],
    chatTypeAllowlist: ["interactive_user_chat"],
    messageRoleAllowlist: ["user"],
  };

  for (const [key, defaultValue] of Object.entries(expected)) {
    const schema = autoRecall.properties[key];
    assert.equal(schema.type, "array");
    assert.deepEqual(schema.default, defaultValue);
    assert.equal(schema.uniqueItems, true);
    assert.equal(schema.items.type, "string");
    assert.equal(schema.items.minLength, 1);
  }

  assert.match(autoRecall.properties.agentAllowlist.description, /controlled runtime verification/i);
  assert.match(autoRecall.properties.triggerAllowlist.description, /user-only/i);
});

test("runtime gate supports camel-case config overrides", () => {
  const result = evaluateAutoRecallRuntimeGate({
    event: hostEvent({
      chat_type: "planner_chat",
      message_role: "user",
    }),
    ctx: hostContext({ agentId: "task-planner", trigger: "manual" }),
    config: {
      agentAllowlist: ["task-planner"],
      triggerAllowlist: ["manual"],
      chatTypeAllowlist: ["planner_chat"],
      messageRoleAllowlist: ["user"],
    },
  });

  assert.equal(result.allowed, true);
  assert.equal(result.agentId, "task-planner");
  assert.equal(result.trigger, "manual");
  assert.equal(result.chatType, "planner_chat");
  assert.equal(result.messageRole, "user");
});

test("runtime gate preserves snake-case config aliases", () => {
  const result = evaluateAutoRecallRuntimeGate({
    event: hostEvent({ chat_type: "planner_chat", message_role: "user" }),
    ctx: hostContext({ agentId: "task-planner", trigger: "manual" }),
    config: {
      agent_allowlist: ["task-planner"],
      trigger_allowlist: ["manual"],
      chat_type_allowlist: ["planner_chat"],
      message_role_allowlist: ["user"],
    },
  });

  assert.equal(result.allowed, true);
});

test("runtime gate reads agent and trigger from trusted ctx before optional event fields", () => {
  const result = evaluateAutoRecallRuntimeGate({
    event: hostEvent(),
    ctx: hostContext({ chatType: "interactive_user_chat", messageRole: "user" }),
    config: {},
  });

  assert.equal(result.allowed, true);
  assert.equal(result.agentId, "edi");
  assert.equal(result.trigger, "user");
  assert.equal(result.chatType, "interactive_user_chat");
  assert.equal(result.messageRole, "user");
});

test("explicit event trigger remains a compatibility fallback", () => {
  const result = evaluateAutoRecallRuntimeGate({
    event: hostEvent({ trigger: "user" }),
    ctx: { agentId: "edi" },
    config: {},
  });
  assert.equal(result.allowed, true);
  assert.equal(result.trigger, "user");
});
