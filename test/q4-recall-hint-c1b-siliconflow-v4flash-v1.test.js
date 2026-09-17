import test from "node:test";
import assert from "node:assert/strict";

import { buildQ4RecallHintC1FreshCorpusV1 } from "../lib/benchmark/q4-recall-hint-c1-corpus-v1.js";
import {
  buildQ4RecallHintC1ManifestV1,
  buildQ4RecallHintC1ProducerInputV1,
} from "../lib/benchmark/q4-recall-hint-c1-manifest-v1.js";
import {
  buildQ4RecallHintC1BRequest,
  validateQ4RecallHintC1BExecutionPacket,
} from "../lib/benchmark/q4-recall-hint-c1b-provider-contract-v1.js";
import {
  Q4_C1B_SF_BILLING_CURRENCY,
  Q4_C1B_SF_ENDPOINT,
  Q4_C1B_SF_INPUT_PRICE_PER_MILLION,
  Q4_C1B_SF_MAX_COST,
  Q4_C1B_SF_MODEL,
  Q4_C1B_SF_OUTPUT_PRICE_PER_MILLION,
  Q4_C1B_SF_PROVIDER,
  Q4_C1B_SF_THEORETICAL_MAX_COST,
  buildQ4RecallHintC1BSiliconFlowPacketV1,
  buildQ4RecallHintC1BSiliconFlowRequestBodyV1,
  parseQ4RecallHintC1BSiliconFlowResponseV1,
  q4RecallHintC1BSiliconFlowBindingIdentityV1,
} from "../lib/benchmark/q4-recall-hint-c1b-siliconflow-v4flash-v1.js";

function fixture() {
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  const manifest = buildQ4RecallHintC1ManifestV1(corpus);
  const producerInput = buildQ4RecallHintC1ProducerInputV1(corpus.cases[0]);
  const packet = buildQ4RecallHintC1BSiliconFlowPacketV1({
    manifest,
    sourceCommit: "source-commit-fixture",
  });
  return { corpus, manifest, producerInput, packet };
}

test("Q4-C1b SiliconFlow binding freezes V4-Flash endpoint, worst-case CNY rates, and cost cap", () => {
  const { manifest, packet } = fixture();
  assert.equal(packet.provider, Q4_C1B_SF_PROVIDER);
  assert.equal(packet.model, Q4_C1B_SF_MODEL);
  assert.equal(packet.endpoint, Q4_C1B_SF_ENDPOINT);
  assert.equal(packet.billing_currency, Q4_C1B_SF_BILLING_CURRENCY);
  assert.equal(packet.input_price_per_million, Q4_C1B_SF_INPUT_PRICE_PER_MILLION);
  assert.equal(packet.output_price_per_million, Q4_C1B_SF_OUTPUT_PRICE_PER_MILLION);
  assert.equal(packet.max_cost, Q4_C1B_SF_MAX_COST);
  assert.equal(Q4_C1B_SF_THEORETICAL_MAX_COST, 0.405504);
  assert.equal(Q4_C1B_SF_THEORETICAL_MAX_COST < Q4_C1B_SF_MAX_COST, true);
  assert.deepEqual(validateQ4RecallHintC1BExecutionPacket({
    packet,
    manifest,
    sourceCommit: "source-commit-fixture",
    worktreeClean: true,
  }), { valid: true, provider: Q4_C1B_SF_PROVIDER, model: Q4_C1B_SF_MODEL });
});

test("Q4-C1b SiliconFlow request adapter uses JSON mode and frozen output budget", () => {
  const { producerInput, packet } = fixture();
  const request = buildQ4RecallHintC1BRequest(producerInput);
  const body = buildQ4RecallHintC1BSiliconFlowRequestBodyV1({ packet, request });
  assert.equal(body.model, Q4_C1B_SF_MODEL);
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, "user");
  assert.equal(body.messages[0].content, request.prompt);
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 256);
  assert.equal(body.enable_thinking, false);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.stream, false);
});

test("Q4-C1b SiliconFlow response adapter maps OpenAI usage without exposing reasoning content", () => {
  const result = parseQ4RecallHintC1BSiliconFlowResponseV1({
    choices: [{
      message: {
        content: '{"version":"recall_hint_v1","project":"AtlasPlugin"}',
        reasoning_content: "private provider reasoning that must not enter C1b result",
      },
    }],
    usage: {
      prompt_tokens: 123,
      completion_tokens: 17,
      total_tokens: 140,
      completion_tokens_details: { reasoning_tokens: 9 },
    },
  });
  assert.deepEqual(result, {
    text: '{"version":"recall_hint_v1","project":"AtlasPlugin"}',
    usage: { input_tokens: 123, output_tokens: 17 },
  });
  assert.equal(JSON.stringify(result).includes("reasoning"), false);
});

test("Q4-C1b SiliconFlow binding identity records pricing provenance without secrets", () => {
  const identity = q4RecallHintC1BSiliconFlowBindingIdentityV1();
  assert.equal(identity.provider, "SiliconFlow");
  assert.equal(identity.model, "deepseek-ai/DeepSeek-V4-Flash");
  assert.equal(identity.billing_currency, "CNY");
  assert.equal(identity.input_price_per_million, 3);
  assert.equal(identity.output_price_per_million, 9);
  assert.equal(identity.max_cost, 0.5);
  assert.equal(identity.pricing_effective_date, "2026-09-01");
  assert.equal(identity.response_format, "json_object");
  assert.equal(identity.enable_thinking, false);
  assert.equal(JSON.stringify(identity).includes("api_key"), true);
  assert.equal(JSON.stringify(identity).includes("sk-"), false);
});

test("Q4-C1b SiliconFlow adapters fail closed on mismatched packet or malformed provider response", () => {
  const { producerInput, packet } = fixture();
  const request = buildQ4RecallHintC1BRequest(producerInput);
  assert.throws(
    () => buildQ4RecallHintC1BSiliconFlowRequestBodyV1({
      packet: { ...packet, model: "other-model" },
      request,
    }),
    /Q4_C1B_SF_PACKET_BINDING_MISMATCH/,
  );
  assert.throws(
    () => parseQ4RecallHintC1BSiliconFlowResponseV1({ choices: [], usage: {} }),
    /Q4_C1B_SF_RESPONSE_CONTENT_MISSING/,
  );
  assert.throws(
    () => parseQ4RecallHintC1BSiliconFlowResponseV1({
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: -1, completion_tokens: 1 },
    }),
    /Q4_C1B_SF_PROMPT_TOKENS_INVALID/,
  );
});
