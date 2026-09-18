import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  evaluateRecallHintRuntimeCanaryV1,
  sanitizeRecallHintRuntimeContextV1,
} from "../lib/recall/hint/recall-hint-runtime-canary-v1.js";

test("Recall Hint runtime canary is default-off and requires an exact trusted session", () => {
  assert.deepEqual(evaluateRecallHintRuntimeCanaryV1(), {
    enabled: false,
    in_scope: false,
    provider_allowed: false,
    vector_execution_mode: "sequential",
    reason: "disabled",
    session_id_present: false,
  });

  assert.equal(evaluateRecallHintRuntimeCanaryV1({
    config: { enabled: true, sessionIds: [], vectorExecutionMode: "parallel" },
  }).reason, "empty_session_allowlist");

  assert.equal(evaluateRecallHintRuntimeCanaryV1({
    config: { enabled: true, sessionIds: ["session-a"], vectorExecutionMode: "parallel" },
    runtimeContext: { source: "untrusted", sessionIdentity: "session-a" },
  }).reason, "trusted_runtime_context_missing");

  assert.equal(evaluateRecallHintRuntimeCanaryV1({
    config: { enabled: true, sessionIds: ["session-a"], vectorExecutionMode: "parallel" },
    runtimeContext: { source: "openclaw_runtime", sessionIdentity: "session-b" },
  }).reason, "session_not_allowlisted");
});

test("Recall Hint runtime canary allows only the exact trusted session and preserves the selected mode", () => {
  const decision = evaluateRecallHintRuntimeCanaryV1({
    config: {
      enabled: true,
      sessionIds: ["session-a"],
      vectorExecutionMode: "parallel",
    },
    runtimeContext: {
      source: "openclaw_runtime",
      sessionIdentity: "session-a",
      requestIdentity: "tool-1",
    },
  });

  assert.deepEqual(decision, {
    enabled: true,
    in_scope: true,
    provider_allowed: true,
    vector_execution_mode: "parallel",
    reason: "session_allowlisted",
    session_id_present: true,
  });
});

test("RH-L2-A production assembly wires only the canary control plane and no Recall Hint provider", () => {
  const indexSource = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  const manifest = JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"));

  assert.match(indexSource, /recallHintRuntimeCanary:\s*effectiveRuntimeConfig\.recallHintRuntimeCanary/);
  assert.match(indexSource, /resolveExplicitSearchRuntimeContext:\s*autoRecallLifecycle\.resolveExplicitSearchRuntimeContext/);
  assert.doesNotMatch(indexSource, /recallHintProvider\s*:/);

  assert.deepEqual(manifest.configSchema.properties.recallHintRuntimeCanary.default, {
    enabled: false,
    sessionIds: [],
    vectorExecutionMode: "sequential",
  });
  assert.equal(
    manifest.configSchema.properties.recallHintRuntimeCanary.properties.sessionIds.uniqueItems,
    true,
  );
});

test("Recall Hint runtime canary fails closed on invalid mode and sanitizer drops untrusted fields", () => {
  const invalid = evaluateRecallHintRuntimeCanaryV1({
    config: {
      enabled: true,
      sessionIds: ["session-a"],
      vectorExecutionMode: "automatic",
    },
    runtimeContext: {
      source: "openclaw_runtime",
      sessionIdentity: "session-a",
    },
  });
  assert.equal(invalid.provider_allowed, false);
  assert.equal(invalid.reason, "invalid_vector_execution_mode");

  const sanitized = sanitizeRecallHintRuntimeContextV1({
    source: "openclaw_runtime",
    sessionId: "session-a",
    toolCallId: "tool-1",
    runId: "run-1",
    secret: "must-not-propagate",
  });
  assert.deepEqual(sanitized, {
    source: "openclaw_runtime",
    sessionIdentity: "session-a",
    requestIdentity: "tool-1",
    runIdentity: "run-1",
  });
  assert.equal(Object.hasOwn(sanitized, "secret"), false);
});
