import test from "node:test";
import assert from "node:assert/strict";

import {
  RECALL_HINT_PROVIDER_OUTPUT_SCHEMA_SHA256_V1,
  RECALL_HINT_PROVIDER_PROMPT_SHA256_V1,
  RECALL_HINT_PROVIDER_PROMPT_VERSION_V1,
} from "../lib/recall/hint/recall-hint-provider-contract-v1.js";
import {
  RECALL_HINT_RUNTIME_DEADLINE_MS_V1,
  RECALL_HINT_RUNTIME_MAX_INPUT_TOKENS_V1,
  RECALL_HINT_RUNTIME_MAX_QUERY_CODE_POINTS_V1,
  RECALL_HINT_RUNTIME_PROVIDER_RESULT_SCHEMA_V1,
  SILICONFLOW_RECALL_HINT_ENDPOINT_V1,
  SILICONFLOW_RECALL_HINT_MODEL_V1,
  createSiliconFlowRecallHintAdapterV1,
  siliconFlowRecallHintAdapterIdentityV1,
} from "../lib/recall/hint/siliconflow-recall-hint-adapter-v1.js";
import { createRecallHintRuntimeProviderPolicyV1 } from "../lib/recall/hint/recall-hint-runtime-provider-policy-v1.js";
import {
  Q4_RECALL_HINT_C1B_OUTPUT_SCHEMA_SHA256,
  Q4_RECALL_HINT_C1B_PROMPT_SHA256,
  Q4_RECALL_HINT_C1B_PROMPT_VERSION,
} from "../lib/benchmark/q4-recall-hint-c1b-provider-contract-v1.js";

function enabledConfig() {
  return {
    valid: true,
    recallHintRuntimeCanary: {
      enabled: true,
      sessionIds: ["session-rh"],
      vectorExecutionMode: "parallel",
    },
  };
}

test("RH-L2-B production provider identity reuses the frozen Q4 prompt/schema identity", () => {
  const identity = siliconFlowRecallHintAdapterIdentityV1();

  assert.equal(identity.model, "deepseek-ai/DeepSeek-V4-Flash");
  assert.equal(identity.endpoint, "https://api.siliconflow.cn/v1/chat/completions");
  assert.equal(identity.deadline_ms, 2500);
  assert.equal(identity.max_query_code_points, 240);
  assert.equal(identity.max_input_tokens, 2048);
  assert.equal(identity.max_output_tokens, 256);
  assert.equal(identity.retry_policy, "none");

  assert.equal(RECALL_HINT_PROVIDER_PROMPT_VERSION_V1, Q4_RECALL_HINT_C1B_PROMPT_VERSION);
  assert.equal(RECALL_HINT_PROVIDER_PROMPT_SHA256_V1, Q4_RECALL_HINT_C1B_PROMPT_SHA256);
  assert.equal(RECALL_HINT_PROVIDER_OUTPUT_SCHEMA_SHA256_V1, Q4_RECALL_HINT_C1B_OUTPUT_SCHEMA_SHA256);
  assert.equal(identity.prompt_sha256, Q4_RECALL_HINT_C1B_PROMPT_SHA256);
  assert.equal(identity.output_schema_sha256, Q4_RECALL_HINT_C1B_OUTPUT_SCHEMA_SHA256);
});

test("RH-L2-B policy is null by default and does not require a credential while disabled", () => {
  assert.equal(createRecallHintRuntimeProviderPolicyV1({
    valid: true,
    recallHintRuntimeCanary: {
      enabled: false,
      sessionIds: [],
      vectorExecutionMode: "sequential",
    },
  }), null);

  assert.equal(createRecallHintRuntimeProviderPolicyV1({
    valid: true,
    recallHintRuntimeCanary: {
      enabled: true,
      sessionIds: [],
      vectorExecutionMode: "parallel",
    },
  }), null);

  assert.equal(createRecallHintRuntimeProviderPolicyV1({
    valid: false,
    recallHintRuntimeCanary: {
      enabled: true,
      sessionIds: ["session-rh"],
      vectorExecutionMode: "parallel",
    },
  }), null);
});

test("RH-L3 deterministic execution probe suppresses Recall Hint provider construction", () => {
  assert.equal(createRecallHintRuntimeProviderPolicyV1({
    valid: true,
    recallHintRuntimeCanary: {
      enabled: true,
      sessionIds: ["session-rh-l3"],
      vectorExecutionMode: "parallel",
      executionProbe: "rh_l3_canonical_v1",
    },
  }), null);
});

test("RH-L2-B fake transport receives one bounded JSON request and returns a normalized telemetry envelope", async () => {
  const calls = [];
  const adapter = createSiliconFlowRecallHintAdapterV1({
    apiKey: "secret-key-must-not-leak",
    transport: async input => {
      calls.push(input);
      return {
        status: 200,
        body: JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                version: "recall_hint_v1",
                project: "AtlasPlugin",
                query_facets: ["fallback strategy"],
              }),
            },
          }],
          usage: {
            prompt_tokens: 420,
            completion_tokens: 38,
          },
        }),
      };
    },
  });

  const result = await adapter({ query: "Why did AtlasPlugin change its fallback strategy?" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, SILICONFLOW_RECALL_HINT_ENDPOINT_V1);
  assert.equal(calls[0].body.model, SILICONFLOW_RECALL_HINT_MODEL_V1);
  assert.equal(calls[0].body.temperature, 0);
  assert.equal(calls[0].body.max_tokens, 256);
  assert.equal(calls[0].body.enable_thinking, false);
  assert.deepEqual(calls[0].body.response_format, { type: "json_object" });
  assert.equal(calls[0].body.stream, false);
  assert.equal(calls[0].signal instanceof AbortSignal, true);
  assert.match(calls[0].body.messages[0].content, /AtlasPlugin/);
  assert.match(calls[0].body.messages[0].content, /INPUT_JSON=/);
  assert.equal(calls[0].body.messages[0].content.includes("secret-key-must-not-leak"), false);

  assert.equal(result.schema, RECALL_HINT_RUNTIME_PROVIDER_RESULT_SCHEMA_V1);
  assert.deepEqual(result.hint, {
    version: "recall_hint_v1",
    project: "AtlasPlugin",
    query_facets: ["fallback strategy"],
  });
  assert.deepEqual(result.usage, {
    input_tokens: 420,
    output_tokens: 38,
  });
  assert.ok(result.latency_ms >= 0);
  assert.equal(adapter.deadlineMs, RECALL_HINT_RUNTIME_DEADLINE_MS_V1);
  assert.equal(JSON.stringify(adapter.adapterIdentity).includes("secret-key-must-not-leak"), false);
});

test("RH-L2-B provider enforces query, response, token, and HTTP bounds without retry", async () => {
  let calls = 0;
  const adapter = createSiliconFlowRecallHintAdapterV1({
    apiKey: "test-key",
    transport: async () => {
      calls += 1;
      return {
        status: 200,
        body: JSON.stringify({
          choices: [{ message: { content: '{"version":"recall_hint_v1"}' } }],
          usage: {
            prompt_tokens: RECALL_HINT_RUNTIME_MAX_INPUT_TOKENS_V1 + 1,
            completion_tokens: 1,
          },
        }),
      };
    },
  });

  await assert.rejects(
    adapter({ query: "x".repeat(RECALL_HINT_RUNTIME_MAX_QUERY_CODE_POINTS_V1 + 1) }),
    /RECALL_HINT_SF_QUERY_TOO_LONG/,
  );
  assert.equal(calls, 0);

  await assert.rejects(
    adapter({ query: "bounded query" }),
    /RECALL_HINT_SF_INPUT_TOKEN_LIMIT/,
  );
  assert.equal(calls, 1);

  const httpAdapter = createSiliconFlowRecallHintAdapterV1({
    apiKey: "test-key",
    transport: async () => {
      calls += 1;
      return { status: 429, body: '{"error":"rate limited"}' };
    },
  });
  await assert.rejects(httpAdapter({ query: "bounded query" }), /RECALL_HINT_SF_HTTP_ERROR/);
  assert.equal(calls, 2);

  const oversizedAdapter = createSiliconFlowRecallHintAdapterV1({
    apiKey: "test-key",
    transport: async () => {
      calls += 1;
      return { status: 200, body: "x".repeat(16_385) };
    },
  });
  await assert.rejects(
    oversizedAdapter({ query: "bounded query" }),
    /RECALL_HINT_SF_RESPONSE_TOO_LARGE/,
  );
  assert.equal(calls, 3);
});

test("RH-L2-B provider deadline rejects even when an injected transport ignores AbortSignal", async () => {
  let calls = 0;
  let sawAbort = false;
  const adapter = createSiliconFlowRecallHintAdapterV1({
    apiKey: "test-key",
    deadlineMs: 20,
    transport: ({ signal }) => {
      calls += 1;
      signal.addEventListener("abort", () => {
        sawAbort = true;
      }, { once: true });
      return new Promise(resolve => {
        setTimeout(() => resolve({
          status: 200,
          body: JSON.stringify({
            choices: [{ message: { content: '{"version":"recall_hint_v1"}' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
        }), 100);
      });
    },
  });

  await assert.rejects(
    adapter({ query: "bounded query" }),
    /RECALL_HINT_SF_DEADLINE_EXCEEDED/,
  );
  assert.equal(calls, 1);
  assert.equal(sawAbort, true);
});

test("RH-L2-B enabled canary disables only the provider policy when its credential is unavailable", () => {
  const warnings = [];
  const policy = createRecallHintRuntimeProviderPolicyV1(enabledConfig(), {
    apiKey: "",
    onCredentialMissing: code => warnings.push(code),
  });

  assert.equal(policy, null);
  assert.deepEqual(warnings, ["RECALL_HINT_SF_API_KEY_REQUIRED"]);
});

test("RH-L2-B policy constructs the adapter only for an enabled non-empty canary", async () => {
  let calls = 0;
  const policy = createRecallHintRuntimeProviderPolicyV1(enabledConfig(), {
    apiKey: "test-key",
    transport: async input => {
      calls += 1;
      return {
        status: 200,
        body: JSON.stringify({
          choices: [{ message: { content: '{"version":"recall_hint_v1","entities":["AtlasPlugin"]}' } }],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
      };
    },
  });

  assert.equal(policy.enabled, true);
  assert.equal(policy.deadlineMs, 2500);
  assert.equal(calls, 0);
  const result = await policy.provider({ query: "AtlasPlugin" });
  assert.equal(calls, 1);
  assert.deepEqual(result.hint, {
    version: "recall_hint_v1",
    entities: ["AtlasPlugin"],
  });
});
