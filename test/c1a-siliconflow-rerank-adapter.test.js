import assert from "node:assert/strict";
import test from "node:test";

import {
  createSiliconFlowRerankAdapter,
  preflightSiliconFlowRerankInput,
  qwen3Utf8ByteTokenUpperBound,
  validateSiliconFlowRerankResponse,
} from "../lib/recall/rerank/siliconflow-rerank-adapter.js";
import { rerankCandidates } from "../lib/recall/rerank/relevance-reranker.js";

const tokenCounter = text => [...text].length;

function response(results, extra = {}) {
  return JSON.stringify({ results, ...extra });
}

test("SiliconFlow adapter emits the frozen request shape and maps complete indexes", async () => {
  let captured;
  const adapter = createSiliconFlowRerankAdapter({
    apiKey: "super-secret",
    tokenCounter,
    transport: async request => {
      captured = request;
      return {
        status: 200,
        headers: { "x-request-id": "req-1" },
        body: response([
          { index: 1, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.1 },
        ], { tokens: { input_tokens: 12, output_tokens: 0 } }),
      };
    },
  });

  const result = await adapter("query", ["doc-a", "doc-b"], new AbortController().signal);
  assert.equal(captured.endpoint, "https://api.siliconflow.cn/v1/rerank");
  assert.equal(captured.apiKey, "super-secret");
  assert.deepEqual(captured.body, {
    model: "Qwen/Qwen3-Reranker-8B",
    query: "query",
    documents: ["doc-a", "doc-b"],
    top_n: 2,
    return_documents: false,
  });
  assert.equal(Object.hasOwn(captured.body, "instruction"), false);
  assert.deepEqual(result.scores, [
    { index: 1, score: 0.9 },
    { index: 0, score: 0.1 },
  ]);
  assert.deepEqual(result.usage, {
    input_tokens: 12,
    output_tokens: 0,
    total_tokens: null,
    billed_input_tokens: null,
    billed_output_tokens: null,
  });
  assert.deepEqual(result.adapterIdentity, {
    provider: "siliconflow",
    model: "Qwen/Qwen3-Reranker-8B",
    revision: null,
  });
});

test("SiliconFlow response validation rejects incomplete, duplicate, out-of-range, and non-finite scores", () => {
  assert.throws(
    () => validateSiliconFlowRerankResponse(response([{ index: 0, relevance_score: 1 }]), 2),
    /SILICONFLOW_RERANK_RESULT_COUNT_MISMATCH/,
  );
  assert.throws(
    () => validateSiliconFlowRerankResponse(response([
      { index: 0, relevance_score: 1 },
      { index: 0, relevance_score: 2 },
    ]), 2),
    /SILICONFLOW_RERANK_INDEX_DUPLICATE/,
  );
  assert.throws(
    () => validateSiliconFlowRerankResponse(response([
      { index: 0, relevance_score: 1 },
      { index: 2, relevance_score: 2 },
    ]), 2),
    /SILICONFLOW_RERANK_INDEX_OUT_OF_RANGE/,
  );
  assert.throws(
    () => validateSiliconFlowRerankResponse({
      results: [
        { index: 0, relevance_score: 1 },
        { index: 1, relevance_score: Number.NaN },
      ],
    }, 2),
    /SILICONFLOW_RERANK_SCORE_INVALID/,
  );
});

test("token preflight is local and rejects query, document, and pair limits", () => {
  const ok = preflightSiliconFlowRerankInput({
    query: "abcd",
    documents: ["123", "4567"],
    tokenCounter,
    limits: {
      maxQueryTokens: 10,
      maxDocumentTokens: 10,
      maxPairTokens: 20,
      specialTokenReservePerPair: 2,
    },
  });
  assert.equal(ok.estimatedRequestTokens, (4 + 3 + 2) + (4 + 4 + 2));

  assert.throws(() => preflightSiliconFlowRerankInput({
    query: "too-long",
    documents: ["x"],
    tokenCounter,
    limits: { maxQueryTokens: 2, maxDocumentTokens: 10, maxPairTokens: 20, specialTokenReservePerPair: 0 },
  }), /SILICONFLOW_RERANK_QUERY_TOKEN_LIMIT/);

  assert.throws(() => preflightSiliconFlowRerankInput({
    query: "q",
    documents: ["too-long"],
    tokenCounter,
    limits: { maxQueryTokens: 10, maxDocumentTokens: 2, maxPairTokens: 20, specialTokenReservePerPair: 0 },
  }), /SILICONFLOW_RERANK_DOCUMENT_TOKEN_LIMIT/);

  assert.throws(() => preflightSiliconFlowRerankInput({
    query: "1234",
    documents: ["5678"],
    tokenCounter,
    limits: { maxQueryTokens: 10, maxDocumentTokens: 10, maxPairTokens: 7, specialTokenReservePerPair: 0 },
  }), /SILICONFLOW_RERANK_PAIR_TOKEN_LIMIT/);
});

test("malformed provider JSON becomes generic invalid_response for atomic fallback", async () => {
  const adapter = createSiliconFlowRerankAdapter({
    apiKey: "key",
    tokenCounter,
    transport: async () => ({ status: 200, headers: {}, body: "{not-json" }),
  });
  const result = await rerankCandidates({
    query: "query",
    candidates: [{ id: "a", text: "doc" }],
    deadlineMs: 100,
    adapter,
  });
  assert.equal(result.status, "fallback");
  assert.equal(result.reason, "invalid_response");
  assert.deepEqual(result.orderedIds, ["a"]);
});

test("HTTP 4xx/429/5xx failures do not echo provider bodies or credentials", async () => {
  for (const status of [400, 429, 500]) {
    const adapter = createSiliconFlowRerankAdapter({
      apiKey: "Bearer-do-not-leak",
      tokenCounter,
      transport: async () => ({
        status,
        headers: {},
        body: "provider secret response Bearer-do-not-leak",
      }),
    });
    await assert.rejects(
      () => adapter("query", ["doc"], new AbortController().signal),
      error => {
        assert.equal(error.code, "SILICONFLOW_RERANK_HTTP_ERROR");
        assert.equal(error.httpStatus, status);
        assert.doesNotMatch(error.message, /Bearer-do-not-leak|provider secret response/);
        return true;
      },
    );
  }
});

test("default Qwen3 counter uses a conservative UTF-8 byte upper bound", async () => {
  assert.equal(qwen3Utf8ByteTokenUpperBound("abc"), 3);
  assert.equal(qwen3Utf8ByteTokenUpperBound("中文"), Buffer.byteLength("中文", "utf8"));
  const adapter = createSiliconFlowRerankAdapter({
    apiKey: "key",
    transport: async () => ({
      status: 200,
      headers: {},
      body: response([{ index: 0, relevance_score: 0.5 }]),
    }),
  });
  const result = await adapter("query", ["document"], new AbortController().signal);
  assert.equal(result.scores.length, 1);
});
