import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexSource = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const originSource = readFileSync(new URL("../lib/recall/hybrid/traffic-origin.js", import.meta.url), "utf8");

test("before_tool_call contract fixture uses only host-provided identity fields", () => {
  const hostContext = {
    agentId: "edi",
    sessionKey: "session-1",
    sessionId: "session-1",
    runId: "run-1",
    toolName: "memory_engine_search",
    toolCallId: "tool-1",
  };
  assert.equal(Object.hasOwn(hostContext, "trigger"), false);
  assert.equal(Object.hasOwn(hostContext, "toolExecutionSource"), false);
  assert.equal(Object.hasOwn(hostContext, "invocationSource"), false);

  const hookStart = indexSource.indexOf('api.on("before_tool_call"');
  const hookEnd = indexSource.indexOf('if (autoRecallConfig.enabled', hookStart);
  assert.ok(hookStart >= 0 && hookEnd > hookStart);
  const hookSource = indexSource.slice(hookStart, hookEnd);
  assert.doesNotMatch(hookSource, /ctx\?\.(trigger|toolExecutionSource|invocationSource)/);
  assert.doesNotMatch(hookSource, /event\?\.(trigger|toolExecutionSource|invocationSource)/);
  assert.doesNotMatch(originSource, /toolExecutionSource|invocationSource/);
});
