import {
  Q4_RECALL_HINT_C1B_MAX_TOTAL_INPUT_TOKENS,
  Q4_RECALL_HINT_C1B_MAX_TOTAL_OUTPUT_TOKENS,
  buildQ4RecallHintC1BExecutionPacket,
} from "./q4-recall-hint-c1b-provider-contract-v1.js";

export const Q4_C1B_SF_PROVIDER = "SiliconFlow";
export const Q4_C1B_SF_MODEL = "deepseek-ai/DeepSeek-V4-Flash";
export const Q4_C1B_SF_ENDPOINT = "https://api.siliconflow.cn/v1/chat/completions";
export const Q4_C1B_SF_MODEL_REVISION = null;
export const Q4_C1B_SF_API_KEY_ENV = "SILICONFLOW_API_KEY";
export const Q4_C1B_SF_BILLING_CURRENCY = "CNY";

// Frozen against SiliconFlow's 2026-09-01 time-of-day pricing using the
// non-discounted / non-cache-hit rates so the experiment packet remains
// valid regardless of execution hour or cache behavior.
export const Q4_C1B_SF_INPUT_PRICE_PER_MILLION = 3;
export const Q4_C1B_SF_OUTPUT_PRICE_PER_MILLION = 9;
export const Q4_C1B_SF_MAX_COST = 0.5;
export const Q4_C1B_SF_PRICING_EFFECTIVE_DATE = "2026-09-01";
export const Q4_C1B_SF_PRICING_BASIS = "worst_case_non_discounted_non_cached";
export const Q4_C1B_SF_PRICING_SOURCE = "SiliconFlow release notes: DeepSeek-V4-Flash time-based pricing";

export const Q4_C1B_SF_THEORETICAL_MAX_COST = (
  Q4_RECALL_HINT_C1B_MAX_TOTAL_INPUT_TOKENS * Q4_C1B_SF_INPUT_PRICE_PER_MILLION
  + Q4_RECALL_HINT_C1B_MAX_TOTAL_OUTPUT_TOKENS * Q4_C1B_SF_OUTPUT_PRICE_PER_MILLION
) / 1_000_000;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requireRecord(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail(code);
  return value;
}

function requireTokenCount(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw fail(code);
  return value;
}

export function buildQ4RecallHintC1BSiliconFlowPacketV1({ manifest, sourceCommit } = {}) {
  return buildQ4RecallHintC1BExecutionPacket({
    manifest,
    sourceCommit,
    provider: Q4_C1B_SF_PROVIDER,
    model: Q4_C1B_SF_MODEL,
    endpoint: Q4_C1B_SF_ENDPOINT,
    revision: Q4_C1B_SF_MODEL_REVISION,
    apiKeyEnv: Q4_C1B_SF_API_KEY_ENV,
    billingCurrency: Q4_C1B_SF_BILLING_CURRENCY,
    maxCost: Q4_C1B_SF_MAX_COST,
    inputPricePerMillion: Q4_C1B_SF_INPUT_PRICE_PER_MILLION,
    outputPricePerMillion: Q4_C1B_SF_OUTPUT_PRICE_PER_MILLION,
  });
}

export function buildQ4RecallHintC1BSiliconFlowRequestBodyV1({ packet, request } = {}) {
  requireRecord(packet, "Q4_C1B_SF_PACKET_REQUIRED");
  requireRecord(request, "Q4_C1B_SF_REQUEST_REQUIRED");
  if (packet.provider !== Q4_C1B_SF_PROVIDER
      || packet.model !== Q4_C1B_SF_MODEL
      || packet.endpoint !== Q4_C1B_SF_ENDPOINT) {
    throw fail("Q4_C1B_SF_PACKET_BINDING_MISMATCH");
  }
  if (typeof request.prompt !== "string" || request.prompt.length === 0) {
    throw fail("Q4_C1B_SF_PROMPT_REQUIRED");
  }
  return Object.freeze({
    model: Q4_C1B_SF_MODEL,
    messages: Object.freeze([
      Object.freeze({ role: "user", content: request.prompt }),
    ]),
    temperature: request.temperature,
    max_tokens: request.max_output_tokens,
    enable_thinking: false,
    response_format: Object.freeze({ type: "json_object" }),
    stream: false,
  });
}

export function parseQ4RecallHintC1BSiliconFlowResponseV1(response) {
  const parsed = requireRecord(response, "Q4_C1B_SF_RESPONSE_REQUIRED");
  if (parsed.error) throw fail("Q4_C1B_SF_PROVIDER_ERROR");
  const text = parsed.choices?.[0]?.message?.content;
  if (typeof text !== "string" || text.length === 0) {
    throw fail("Q4_C1B_SF_RESPONSE_CONTENT_MISSING");
  }
  const usage = requireRecord(parsed.usage, "Q4_C1B_SF_USAGE_REQUIRED");
  const inputTokens = requireTokenCount(usage.prompt_tokens, "Q4_C1B_SF_PROMPT_TOKENS_INVALID");
  const outputTokens = requireTokenCount(usage.completion_tokens, "Q4_C1B_SF_COMPLETION_TOKENS_INVALID");
  return Object.freeze({
    text,
    usage: Object.freeze({
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    }),
  });
}

export function q4RecallHintC1BSiliconFlowBindingIdentityV1() {
  return Object.freeze({
    provider: Q4_C1B_SF_PROVIDER,
    model: Q4_C1B_SF_MODEL,
    endpoint: Q4_C1B_SF_ENDPOINT,
    revision: Q4_C1B_SF_MODEL_REVISION,
    api_key_env: Q4_C1B_SF_API_KEY_ENV,
    billing_currency: Q4_C1B_SF_BILLING_CURRENCY,
    input_price_per_million: Q4_C1B_SF_INPUT_PRICE_PER_MILLION,
    output_price_per_million: Q4_C1B_SF_OUTPUT_PRICE_PER_MILLION,
    max_cost: Q4_C1B_SF_MAX_COST,
    theoretical_max_cost: Q4_C1B_SF_THEORETICAL_MAX_COST,
    pricing_effective_date: Q4_C1B_SF_PRICING_EFFECTIVE_DATE,
    pricing_basis: Q4_C1B_SF_PRICING_BASIS,
    pricing_source: Q4_C1B_SF_PRICING_SOURCE,
    response_format: "json_object",
    enable_thinking: false,
  });
}
