import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { buildQ4RecallHintC1FreshCorpusV1 } from "../lib/benchmark/q4-recall-hint-c1-corpus-v1.js";
import {
  buildQ4RecallHintC1ManifestV1,
  buildQ4RecallHintC1ProducerInputV1,
} from "../lib/benchmark/q4-recall-hint-c1-manifest-v1.js";
import { buildQ4RecallHintC1BRequest } from "../lib/benchmark/q4-recall-hint-c1b-provider-contract-v1.js";
import { buildQ4RecallHintC1BSiliconFlowPacketV1 } from "../lib/benchmark/q4-recall-hint-c1b-siliconflow-v4flash-v1.js";
import {
  createQ4RecallHintC1BSiliconFlowTransportV1,
  q4RecallHintC1BSiliconFlowCredentialPreflightV1,
} from "../lib/benchmark/q4-recall-hint-c1b-siliconflow-transport-v1.js";

function fixture() {
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  const manifest = buildQ4RecallHintC1ManifestV1(corpus);
  const packet = buildQ4RecallHintC1BSiliconFlowPacketV1({
    manifest,
    sourceCommit: "transport-source-fixture",
  });
  const row = corpus.cases.find(item => item.family === "entity_reference");
  const producerInput = buildQ4RecallHintC1ProducerInputV1(row);
  const request = buildQ4RecallHintC1BRequest(producerInput);
  return { packet, request };
}

function fakeRequestImpl({ responseBody, statusCode = 200, requestError = null, capture }) {
  return (url, options, callback) => {
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.destroy = () => {};
    let body = "";
    req.write = chunk => { body += String(chunk); };
    req.end = () => {
      capture.url = url.toString();
      capture.options = options;
      capture.body = body;
      if (requestError) {
        queueMicrotask(() => req.emit("error", requestError));
        return;
      }
      const res = new EventEmitter();
      res.statusCode = statusCode;
      res.destroy = () => {};
      callback(res);
      queueMicrotask(() => {
        if (responseBody !== null) res.emit("data", Buffer.from(JSON.stringify(responseBody)));
        res.emit("end");
        res.emit("close");
      });
    };
    return req;
  };
}

test("Q4-C1b SiliconFlow credential preflight checks exact env name without exposing value", () => {
  assert.deepEqual(q4RecallHintC1BSiliconFlowCredentialPreflightV1({
    env: { SILICONFLOW_API_KEY: "secret-value" },
  }), {
    credential_env: "SILICONFLOW_API_KEY",
    available: true,
  });
  assert.throws(
    () => q4RecallHintC1BSiliconFlowCredentialPreflightV1({ env: {} }),
    /Q4_C1B_SF_CREDENTIAL_UNAVAILABLE/,
  );
});

test("Q4-C1b SiliconFlow transport sends frozen JSON request and maps usage", async () => {
  const { packet, request } = fixture();
  const capture = {};
  const requestImpl = fakeRequestImpl({
    capture,
    responseBody: {
      choices: [{ message: { content: '{"version":"recall_hint_v1","project":"AtlasPlugin"}' } }],
      usage: { prompt_tokens: 222, completion_tokens: 33 },
    },
  });
  const transport = createQ4RecallHintC1BSiliconFlowTransportV1({
    packet,
    env: { SILICONFLOW_API_KEY: "secret-value" },
    requestImpl,
  });
  const response = await transport({
    provider: packet.provider,
    model: packet.model,
    endpoint: packet.endpoint,
    apiKeyEnv: packet.api_key_env,
    request,
    signal: new AbortController().signal,
  });
  assert.equal(capture.url, packet.endpoint);
  assert.equal(capture.options.method, "POST");
  assert.equal(capture.options.headers.Authorization, "Bearer secret-value");
  const body = JSON.parse(capture.body);
  assert.equal(body.model, "deepseek-ai/DeepSeek-V4-Flash");
  assert.equal(body.enable_thinking, false);
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 256);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.stream, false);
  assert.deepEqual(response, {
    text: '{"version":"recall_hint_v1","project":"AtlasPlugin"}',
    usage: { input_tokens: 222, output_tokens: 33 },
  });
});

test("Q4-C1b SiliconFlow transport fails closed on destination mismatch and redacts credential-bearing errors", async () => {
  const { packet, request } = fixture();
  const transport = createQ4RecallHintC1BSiliconFlowTransportV1({
    packet,
    env: { SILICONFLOW_API_KEY: "secret-value" },
    requestImpl: fakeRequestImpl({
      capture: {},
      responseBody: null,
      requestError: new Error("Authorization: Bearer secret-value token=secret-value"),
    }),
  });
  await assert.rejects(
    transport({
      provider: packet.provider,
      model: packet.model,
      endpoint: packet.endpoint,
      apiKeyEnv: packet.api_key_env,
      request,
      signal: new AbortController().signal,
    }),
    error => {
      assert.equal(error.code, "Q4_C1B_SF_REQUEST_FAILED");
      assert.equal(error.message.includes("secret-value"), false);
      return true;
    },
  );
  await assert.rejects(
    transport({
      provider: packet.provider,
      model: "other-model",
      endpoint: packet.endpoint,
      apiKeyEnv: packet.api_key_env,
      request,
      signal: new AbortController().signal,
    }),
    /Q4_C1B_SF_TRANSPORT_BINDING_MISMATCH/,
  );
});
