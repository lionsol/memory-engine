import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { evaluateAutoRecallRuntimeGate } from "../lib/recall/auto-recall-runtime-gate.js";

const CONTRACT = new URL("./fixtures/openclaw-before-prompt-build-hook-contract.json", import.meta.url);
const GATE = new URL("../lib/recall/auto-recall-runtime-gate.js", import.meta.url);

test("host contract fixture keeps chat type and message role optional", () => {
  const contract = JSON.parse(readFileSync(CONTRACT, "utf8"));
  assert.deepEqual(contract.event.required, ["prompt", "messages"]);
  assert.ok(contract.context.trustedFields.includes("agentId"));
  assert.ok(contract.context.trustedFields.includes("trigger"));
  assert.deepEqual(contract.context.optionalCompatibilityFields, ["chatType", "messageRole"]);

  const result = evaluateAutoRecallRuntimeGate({
    event: { prompt: "question", messages: [] },
    ctx: { agentId: "edi", trigger: "user" },
    config: {},
  });
  assert.equal(result.allowed, true);
});

test("runtime gate source does not deny missing optional host fields", () => {
  const source = readFileSync(GATE, "utf8");
  assert.doesNotMatch(source, /allowChatTypes\.length\s*&&\s*!chatType/);
  assert.doesNotMatch(source, /allowRoles\.length\s*&&\s*!messageRole/);
  assert.doesNotMatch(source, /denied_missing_chat_type/);
  assert.doesNotMatch(source, /denied_missing_message_role/);
});
