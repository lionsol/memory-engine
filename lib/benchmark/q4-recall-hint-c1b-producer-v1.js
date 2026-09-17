import {
  Q4_RECALL_HINT_C1B_MAX_INPUT_TOKENS_PER_REQUEST,
  Q4_RECALL_HINT_C1B_MAX_OUTPUT_TOKENS_PER_REQUEST,
  buildQ4RecallHintC1BRequest,
  parseQ4RecallHintC1BResponse,
} from "./q4-recall-hint-c1b-provider-contract-v1.js";

export class Q4RecallHintC1BProducerError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "Q4RecallHintC1BProducerError";
    this.code = code;
  }
}

function requireUsageInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Q4RecallHintC1BProducerError(`Q4_C1B_PRODUCER_${field}_INVALID`);
  }
  return value;
}

function requestCostUsd(inputTokens, outputTokens, packet) {
  return (
    inputTokens * packet.input_price_usd_per_million
    + outputTokens * packet.output_price_usd_per_million
  ) / 1_000_000;
}

export async function executeQ4RecallHintC1BProducerV1({ producerInput, packet, transport } = {}) {
  if (typeof transport !== "function") {
    throw new Q4RecallHintC1BProducerError("Q4_C1B_PRODUCER_TRANSPORT_REQUIRED");
  }
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    throw new Q4RecallHintC1BProducerError("Q4_C1B_PRODUCER_PACKET_REQUIRED");
  }

  const request = buildQ4RecallHintC1BRequest(producerInput);
  const controller = new AbortController();
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort(new Q4RecallHintC1BProducerError("Q4_C1B_PRODUCER_DEADLINE_EXCEEDED"));
      reject(new Q4RecallHintC1BProducerError("Q4_C1B_PRODUCER_DEADLINE_EXCEEDED"));
    }, packet.deadline_ms);
    timeout.unref?.();
  });

  let response;
  const started = performance.now();
  try {
    response = await Promise.race([
      Promise.resolve().then(() => transport({
        provider: packet.provider,
        model: packet.model,
        endpoint: packet.endpoint,
        revision: packet.revision,
        apiKeyEnv: packet.api_key_env,
        request,
        signal: controller.signal,
      })),
      timeoutPromise,
    ]);
  } catch (error) {
    if (error?.code === "Q4_C1B_PRODUCER_DEADLINE_EXCEEDED") throw error;
    throw new Q4RecallHintC1BProducerError(
      "Q4_C1B_PRODUCER_TRANSPORT_FAILED",
      String(error?.message || "producer transport failed"),
    );
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }

  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Q4RecallHintC1BProducerError("Q4_C1B_PRODUCER_RESPONSE_INVALID");
  }
  const inputTokens = requireUsageInteger(response.usage?.input_tokens, "INPUT_TOKENS");
  const outputTokens = requireUsageInteger(response.usage?.output_tokens, "OUTPUT_TOKENS");
  if (inputTokens > Q4_RECALL_HINT_C1B_MAX_INPUT_TOKENS_PER_REQUEST
      || outputTokens > Q4_RECALL_HINT_C1B_MAX_OUTPUT_TOKENS_PER_REQUEST) {
    throw new Q4RecallHintC1BProducerError("Q4_C1B_PRODUCER_REQUEST_TOKEN_BUDGET_EXCEEDED");
  }

  const hint = parseQ4RecallHintC1BResponse(response.text);
  const costUsd = requestCostUsd(inputTokens, outputTokens, packet);
  if (costUsd > packet.max_cost_usd) {
    throw new Q4RecallHintC1BProducerError("Q4_C1B_PRODUCER_REQUEST_COST_CAP_EXCEEDED");
  }

  return Object.freeze({
    hint,
    usage: Object.freeze({
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd,
    }),
    latency_ms: performance.now() - started,
  });
}
