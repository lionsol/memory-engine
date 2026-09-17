import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { buildQ4RecallHintC1FreshCorpusV1 } from "../lib/benchmark/q4-recall-hint-c1-corpus-v1.js";
import {
  createQ4RecallHintC1BSiliconFlowRetrievalProvidersV1,
  q4RecallHintC1BRetrievalEffectCredentialPreflightV1,
} from "../lib/benchmark/q4-recall-hint-c1b-siliconflow-retrieval-effect-v1.js";

function fakeRequestImpl({ responseBody, statusCode = 200, requestError = null, capture }) {
  return (url, options, callback) => {
    const req = new EventEmitter();
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

function embeddingResponse() {
  const vector = new Array(2560).fill(0);
  vector[0] = 1;
  return {
    object: "list",
    model: "Qwen/Qwen3-Embedding-4B",
    data: [{ object: "embedding", embedding: vector, index: 0 }],
    usage: { prompt_tokens: 12, completion_tokens: 0, total_tokens: 12 },
  };
}

test("Q4-C1b retrieval-effect credential preflight requires exact SiliconFlow sk- key", () => {
  assert.deepEqual(q4RecallHintC1BRetrievalEffectCredentialPreflightV1({
    env: { SILICONFLOW_API_KEY: "sk-test-key" },
  }), {
    credential_env: "SILICONFLOW_API_KEY",
    available: true,
  });
  assert.throws(
    () => q4RecallHintC1BRetrievalEffectCredentialPreflightV1({ env: {} }),
    /Q4_C1B_RETRIEVAL_SF_CREDENTIAL_UNAVAILABLE/,
  );
  assert.throws(
    () => q4RecallHintC1BRetrievalEffectCredentialPreflightV1({ env: { SILICONFLOW_API_KEY: "wrong" } }),
    /Q4_C1B_RETRIEVAL_SF_CREDENTIAL_FORMAT_INVALID/,
  );
});

test("Q4-C1b retrieval-effect embedding adapter binds endpoint/model/dimension without leaking other context", async () => {
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  const capture = {};
  const providers = createQ4RecallHintC1BSiliconFlowRetrievalProvidersV1({
    corpus,
    env: { SILICONFLOW_API_KEY: "sk-test-key" },
    requestImpl: fakeRequestImpl({ capture, responseBody: embeddingResponse() }),
    rerankTransport: async () => ({ status: 200, body: { results: [], meta: { tokens: {} } } }),
  });
  const vector = await providers.embeddingProvider("bounded synthetic input");
  assert.equal(vector.length, 2560);
  assert.equal(capture.url, "https://api.siliconflow.cn/v1/embeddings");
  assert.equal(capture.options.method, "POST");
  assert.equal(capture.options.headers.Authorization, "Bearer sk-test-key");
  const body = JSON.parse(capture.body);
  assert.deepEqual(body, {
    model: "Qwen/Qwen3-Embedding-4B",
    input: "bounded synthetic input",
    dimensions: 2560,
    encoding_format: "float",
  });
  assert.equal(providers.contract.scope, "development_only");
  assert.equal(providers.contract.acceptance_case_count, 0);
});

test("Q4-C1b retrieval-effect embedding transport redacts credential-bearing failures", async () => {
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  const providers = createQ4RecallHintC1BSiliconFlowRetrievalProvidersV1({
    corpus,
    env: { SILICONFLOW_API_KEY: "sk-test-secret" },
    requestImpl: fakeRequestImpl({
      capture: {},
      responseBody: null,
      requestError: new Error("Authorization: Bearer sk-test-secret token=sk-test-secret"),
    }),
    rerankTransport: async () => ({ status: 200, body: { results: [], meta: { tokens: {} } } }),
  });
  await assert.rejects(
    providers.embeddingProvider("bounded synthetic input"),
    error => {
      assert.equal(error.code, "Q4_C1B_RETRIEVAL_SF_EMBED_REQUEST_FAILED");
      assert.equal(error.message.includes("sk-test-secret"), false);
      return true;
    },
  );
});
