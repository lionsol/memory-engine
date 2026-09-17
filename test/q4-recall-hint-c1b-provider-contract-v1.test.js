import test from "node:test";
import assert from "node:assert/strict";

import { buildQ4RecallHintC1FreshCorpusV1 } from "../lib/benchmark/q4-recall-hint-c1-corpus-v1.js";
import {
  buildQ4RecallHintC1ManifestV1,
  buildQ4RecallHintC1ProducerInputV1,
} from "../lib/benchmark/q4-recall-hint-c1-manifest-v1.js";
import {
  Q4_RECALL_HINT_C1B_ABSOLUTE_MAX_COST_USD,
  Q4_RECALL_HINT_C1B_MAX_ACCEPTANCE_REQUESTS,
  Q4_RECALL_HINT_C1B_MAX_DEVELOPMENT_REQUESTS,
  Q4_RECALL_HINT_C1B_MAX_PROVIDER_REQUESTS,
  Q4_RECALL_HINT_C1B_OUTPUT_SCHEMA_SHA256,
  Q4_RECALL_HINT_C1B_PROMPT_SHA256,
  buildQ4RecallHintC1BExecutionPacket,
  buildQ4RecallHintC1BPrompt,
  buildQ4RecallHintC1BRequest,
  parseQ4RecallHintC1BResponse,
  q4RecallHintC1BContractIdentity,
  validateQ4RecallHintC1BExecutionPacket,
  validateQ4RecallHintC1BUsage,
} from "../lib/benchmark/q4-recall-hint-c1b-provider-contract-v1.js";
import {
  Q4RecallHintC1BProducerError,
  executeQ4RecallHintC1BProducerV1,
} from "../lib/benchmark/q4-recall-hint-c1b-producer-v1.js";

function fixture() {
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  const manifest = buildQ4RecallHintC1ManifestV1(corpus);
  const row = corpus.cases.find(item => item.family === "entity_reference");
  const producerInput = buildQ4RecallHintC1ProducerInputV1(row);
  const packet = buildQ4RecallHintC1BExecutionPacket({
    manifest,
    sourceCommit: "source-commit-fixture",
    provider: "FakeProvider",
    model: "fake-model-v1",
    endpoint: "https://provider.invalid/v1/chat/completions",
    revision: null,
    apiKeyEnv: "Q4_C1B_FAKE_API_KEY",
    maxCostUsd: 0.25,
    inputPriceUsdPerMillion: 1,
    outputPriceUsdPerMillion: 2,
  });
  return { corpus, manifest, row, producerInput, packet };
}

test("Q4-C1b provider contract freezes prompt/schema identity and request budgets", () => {
  const { producerInput } = fixture();
  const identity = q4RecallHintC1BContractIdentity();
  assert.equal(identity.prompt_sha256, Q4_RECALL_HINT_C1B_PROMPT_SHA256);
  assert.equal(identity.output_schema_sha256, Q4_RECALL_HINT_C1B_OUTPUT_SCHEMA_SHA256);

  const request = buildQ4RecallHintC1BRequest(producerInput);
  assert.equal(request.prompt_sha256, Q4_RECALL_HINT_C1B_PROMPT_SHA256);
  assert.equal(request.output_schema_sha256, Q4_RECALL_HINT_C1B_OUTPUT_SCHEMA_SHA256);
  assert.equal(request.temperature, 0);
  assert.equal(request.max_output_tokens, 256);
  assert.equal(request.deadline_ms, 15_000);
  assert.equal(request.max_response_bytes, 16_384);
});

test("Q4-C1b producer prompt contains only query plus bounded context, not hidden evidence", () => {
  const { row, producerInput } = fixture();
  const prompt = buildQ4RecallHintC1BPrompt(producerInput);
  assert.match(prompt, new RegExp(row.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(prompt.includes(row.bounded_context.active_project), true);
  for (const goldId of row.gold_evidence_ids) assert.equal(prompt.includes(goldId), false);
  for (const memory of row.memory_records) {
    assert.equal(prompt.includes(memory.id), false);
    assert.equal(prompt.includes(memory.text), false);
  }
  assert.equal(prompt.includes("gold_evidence_ids"), false);
  assert.equal(prompt.includes("memory_records"), false);
});

test("Q4-C1b strict parser accepts empty/valid RecallHint and rejects prose or unknown fields", () => {
  assert.deepEqual(parseQ4RecallHintC1BResponse('{"version":"recall_hint_v1"}'), {
    version: "recall_hint_v1",
  });
  assert.deepEqual(parseQ4RecallHintC1BResponse(JSON.stringify({
    version: "recall_hint_v1",
    project: "AtlasPlugin",
    entities: ["AtlasPlugin"],
    query_facets: ["fallback strategy"],
  })), {
    version: "recall_hint_v1",
    project: "AtlasPlugin",
    entities: ["AtlasPlugin"],
    query_facets: ["fallback strategy"],
  });
  assert.throws(() => parseQ4RecallHintC1BResponse("Here is the answer"), /Q4_C1B_RESPONSE_NOT_STRICT_JSON/);
  assert.throws(
    () => parseQ4RecallHintC1BResponse('{"version":"recall_hint_v1","hidden":"x"}'),
    /Q4_C1B_RESPONSE_HINT_INVALID/,
  );
  assert.throws(
    () => parseQ4RecallHintC1BResponse('```json\n{"version":"recall_hint_v1"}\n```'),
    /Q4_C1B_RESPONSE_MARKDOWN_FORBIDDEN/,
  );
});

test("Q4-C1b execution packet has no provider/model defaults and binds frozen egress/budgets", () => {
  const { manifest, packet } = fixture();
  assert.equal(packet.max_provider_requests, Q4_RECALL_HINT_C1B_MAX_PROVIDER_REQUESTS);
  assert.equal(packet.max_development_requests, Q4_RECALL_HINT_C1B_MAX_DEVELOPMENT_REQUESTS);
  assert.equal(packet.max_acceptance_requests, Q4_RECALL_HINT_C1B_MAX_ACCEPTANCE_REQUESTS);
  assert.equal(packet.execution_count, 1);
  assert.equal(packet.acceptance_replay_count, 0);
  assert.deepEqual(packet.egress, {
    query: "ALLOW",
    bounded_context: "ALLOW",
    memory_records: "DENY",
    gold_evidence_ids: "DENY",
    retrieval_results: "DENY",
    full_session: "DENY",
    tool_trace: "DENY",
    scope: "frozen_q4_c1_query_plus_bounded_context_only",
  });
  assert.deepEqual(validateQ4RecallHintC1BExecutionPacket({
    packet,
    manifest,
    sourceCommit: "source-commit-fixture",
    worktreeClean: true,
  }), { valid: true, provider: "FakeProvider", model: "fake-model-v1" });

  assert.throws(() => buildQ4RecallHintC1BExecutionPacket({
    manifest,
    sourceCommit: "x",
    model: "m",
    endpoint: "https://provider.invalid/v1",
    apiKeyEnv: "KEY",
    maxCostUsd: 0.1,
    inputPriceUsdPerMillion: 1,
    outputPriceUsdPerMillion: 1,
  }), /Q4_C1B_PROVIDER_REQUIRED/);
});

test("Q4-C1b execution packet rejects insecure endpoint and excessive cost cap", () => {
  const { manifest } = fixture();
  const base = {
    manifest,
    sourceCommit: "x",
    provider: "P",
    model: "M",
    apiKeyEnv: "KEY",
    inputPriceUsdPerMillion: 1,
    outputPriceUsdPerMillion: 1,
  };
  assert.throws(
    () => buildQ4RecallHintC1BExecutionPacket({ ...base, endpoint: "http://provider.invalid/v1", maxCostUsd: 0.1 }),
    /Q4_C1B_ENDPOINT_MUST_BE_HTTPS/,
  );
  assert.throws(
    () => buildQ4RecallHintC1BExecutionPacket({
      ...base,
      endpoint: "https://provider.invalid/v1",
      maxCostUsd: Q4_RECALL_HINT_C1B_ABSOLUTE_MAX_COST_USD + 0.01,
    }),
    /Q4_C1B_COST_CAP_INVALID/,
  );
});

test("Q4-C1b fake transport receives AbortSignal and returns validated Hint with bounded usage", async () => {
  const { producerInput, packet } = fixture();
  let observed = null;
  const result = await executeQ4RecallHintC1BProducerV1({
    producerInput,
    packet,
    transport: async input => {
      observed = input;
      return {
        text: '{"version":"recall_hint_v1","project":"AtlasPlugin","entities":["AtlasPlugin"]}',
        usage: { input_tokens: 200, output_tokens: 40 },
      };
    },
  });
  assert.equal(observed.signal instanceof AbortSignal, true);
  assert.equal(observed.signal.aborted, false);
  assert.equal(observed.provider, "FakeProvider");
  assert.equal(observed.model, "fake-model-v1");
  assert.equal(observed.apiKeyEnv, "Q4_C1B_FAKE_API_KEY");
  assert.deepEqual(result.hint, {
    version: "recall_hint_v1",
    project: "AtlasPlugin",
    entities: ["AtlasPlugin"],
  });
  assert.equal(result.usage.input_tokens, 200);
  assert.equal(result.usage.output_tokens, 40);
  assert.equal(result.usage.cost_usd, 0.00028);
});

test("Q4-C1b fake transport deadline aborts and token budgets fail closed", async () => {
  const { producerInput, packet } = fixture();
  let sawAbort = false;
  const shortPacket = { ...packet, deadline_ms: 10 };
  await assert.rejects(
    executeQ4RecallHintC1BProducerV1({
      producerInput,
      packet: shortPacket,
      transport: ({ signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          sawAbort = true;
          reject(signal.reason);
        }, { once: true });
        setTimeout(() => resolve({
          text: '{"version":"recall_hint_v1"}',
          usage: { input_tokens: 1, output_tokens: 1 },
        }), 100);
      }),
    }),
    error => error instanceof Q4RecallHintC1BProducerError && error.code === "Q4_C1B_PRODUCER_DEADLINE_EXCEEDED",
  );
  assert.equal(sawAbort, true);

  await assert.rejects(
    executeQ4RecallHintC1BProducerV1({
      producerInput,
      packet,
      transport: async () => ({
        text: '{"version":"recall_hint_v1"}',
        usage: { input_tokens: 2049, output_tokens: 1 },
      }),
    }),
    /Q4_C1B_PRODUCER_REQUEST_TOKEN_BUDGET_EXCEEDED/,
  );
});

test("Q4-C1b aggregate usage cannot exceed split, token, or absolute cost budgets", () => {
  assert.deepEqual(validateQ4RecallHintC1BUsage({
    providerRequests: 48,
    developmentRequests: 16,
    acceptanceRequests: 32,
    totalInputTokens: 50_000,
    totalOutputTokens: 5_000,
    costUsd: 0.5,
  }), {
    providerRequests: 48,
    developmentRequests: 16,
    acceptanceRequests: 32,
    totalInputTokens: 50_000,
    totalOutputTokens: 5_000,
    costUsd: 0.5,
  });
  assert.throws(() => validateQ4RecallHintC1BUsage({
    providerRequests: 49,
    developmentRequests: 16,
    acceptanceRequests: 33,
    totalInputTokens: 1,
    totalOutputTokens: 1,
    costUsd: 0.01,
  }), /Q4_C1B_USAGE_BUDGET_EXCEEDED/);
});
