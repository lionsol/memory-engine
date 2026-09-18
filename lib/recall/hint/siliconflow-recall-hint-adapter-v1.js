import https from "node:https";

import {
  RECALL_HINT_PROVIDER_MAX_OUTPUT_TOKENS_V1,
  RECALL_HINT_PROVIDER_MAX_RESPONSE_BYTES_V1,
  RECALL_HINT_PROVIDER_OUTPUT_SCHEMA_SHA256_V1,
  RECALL_HINT_PROVIDER_PROMPT_SHA256_V1,
  RECALL_HINT_PROVIDER_PROMPT_VERSION_V1,
  RECALL_HINT_RUNTIME_PROVIDER_RESULT_SCHEMA_V1,
  buildRecallHintProviderPromptV1,
  parseRecallHintProviderResponseV1,
} from "./recall-hint-provider-contract-v1.js";

export const SILICONFLOW_RECALL_HINT_PROVIDER = "SiliconFlow";
export const SILICONFLOW_RECALL_HINT_MODEL_V1 = "deepseek-ai/DeepSeek-V4-Flash";
export const SILICONFLOW_RECALL_HINT_ENDPOINT_V1 = "https://api.siliconflow.cn/v1/chat/completions";
export const SILICONFLOW_RECALL_HINT_REVISION_V1 = null;
export { RECALL_HINT_RUNTIME_PROVIDER_RESULT_SCHEMA_V1 };
export const RECALL_HINT_RUNTIME_MAX_QUERY_CODE_POINTS_V1 = 240;
export const RECALL_HINT_RUNTIME_MAX_PROMPT_BYTES_V1 = 8192;
export const RECALL_HINT_RUNTIME_MAX_INPUT_TOKENS_V1 = 2048;
export const RECALL_HINT_RUNTIME_DEADLINE_MS_V1 = 2500;

function adapterError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function codePointLength(value) {
  return [...String(value)].length;
}

function boundedUsageInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw adapterError(code);
  return value;
}

function redactedTransportMessage(error, fallback) {
  return String(error?.message || fallback)
    .replace(/authorization\s*:\s*bearer\s+[^\s]+/giu, "authorization: bearer [redacted]")
    .replace(/bearer\s+[^\s]+/giu, "bearer [redacted]")
    .replace(/(api[_-]?key|token|secret)\s*[=:]\s*[^\s,;]+/giu, "$1=[redacted]")
    .slice(0, 240);
}

export function createSiliconFlowRecallHintHttpsTransportV1({ httpsImpl = https } = {}) {
  if (!httpsImpl || typeof httpsImpl.request !== "function") {
    throw adapterError("RECALL_HINT_SF_HTTPS_IMPL_INVALID");
  }
  return ({ endpoint, body, apiKey, signal, maxResponseBytes }) => new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(endpoint);
    let settled = false;
    let request = null;
    let response = null;
    let bytes = 0;
    let raw = "";

    const cleanup = () => signal?.removeEventListener?.("abort", onAbort);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const terminate = error => {
      if (settled) return;
      try { response?.destroy?.(); } catch {}
      try { request?.destroy?.(); } catch {}
      finish(reject, error);
    };
    const onAbort = () => terminate(
      signal?.reason instanceof Error
        ? signal.reason
        : adapterError("RECALL_HINT_SF_ABORTED"),
    );

    if (signal?.aborted) {
      onAbort();
      return;
    }

    try {
      request = httpsImpl.request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Length": Buffer.byteLength(payload),
        },
      }, res => {
        response = res;
        res.setEncoding?.("utf8");
        res.on("data", chunk => {
          if (settled) return;
          const text = String(chunk);
          bytes += Buffer.byteLength(text);
          if (bytes > maxResponseBytes) {
            terminate(adapterError("RECALL_HINT_SF_RESPONSE_TOO_LARGE"));
            return;
          }
          raw += text;
        });
        res.on("end", () => finish(resolve, {
          status: Number(res.statusCode || 0),
          body: raw,
        }));
        res.on("error", error => terminate(adapterError(
          "RECALL_HINT_SF_RESPONSE_FAILED",
          { detail: redactedTransportMessage(error, "response failed") },
        )));
        res.on("aborted", () => terminate(adapterError("RECALL_HINT_SF_RESPONSE_ABORTED")));
      });
      request.on("error", error => terminate(adapterError(
        "RECALL_HINT_SF_REQUEST_FAILED",
        { detail: redactedTransportMessage(error, "request failed") },
      )));
      signal?.addEventListener?.("abort", onAbort, { once: true });
      request.write(payload);
      request.end();
    } catch (error) {
      terminate(adapterError(
        "RECALL_HINT_SF_REQUEST_FAILED",
        { detail: redactedTransportMessage(error, "request failed") },
      ));
    }
  });
}

function parseSiliconFlowRecallHintResponseV1(response) {
  if (!isRecord(response) || !Number.isInteger(response.status)) {
    throw adapterError("RECALL_HINT_SF_TRANSPORT_RESPONSE_INVALID");
  }
  if (response.status < 200 || response.status >= 300) {
    throw adapterError("RECALL_HINT_SF_HTTP_ERROR", { httpStatus: response.status });
  }
  if (typeof response.body === "string"
      && Buffer.byteLength(response.body, "utf8") > RECALL_HINT_PROVIDER_MAX_RESPONSE_BYTES_V1) {
    throw adapterError("RECALL_HINT_SF_RESPONSE_TOO_LARGE");
  }

  let parsed;
  try {
    parsed = typeof response.body === "string" ? JSON.parse(response.body) : response.body;
  } catch {
    throw adapterError("RECALL_HINT_SF_RESPONSE_JSON_INVALID");
  }
  if (!isRecord(parsed) || parsed.error) {
    throw adapterError("RECALL_HINT_SF_PROVIDER_ERROR");
  }
  const text = parsed.choices?.[0]?.message?.content;
  if (typeof text !== "string" || text.length === 0) {
    throw adapterError("RECALL_HINT_SF_RESPONSE_CONTENT_MISSING");
  }
  const usage = isRecord(parsed.usage) ? parsed.usage : null;
  if (!usage) throw adapterError("RECALL_HINT_SF_USAGE_MISSING");
  const inputTokens = boundedUsageInteger(
    usage.prompt_tokens,
    "RECALL_HINT_SF_INPUT_TOKENS_INVALID",
  );
  const outputTokens = boundedUsageInteger(
    usage.completion_tokens,
    "RECALL_HINT_SF_OUTPUT_TOKENS_INVALID",
  );
  if (inputTokens > RECALL_HINT_RUNTIME_MAX_INPUT_TOKENS_V1) {
    throw adapterError("RECALL_HINT_SF_INPUT_TOKEN_LIMIT");
  }
  if (outputTokens > RECALL_HINT_PROVIDER_MAX_OUTPUT_TOKENS_V1) {
    throw adapterError("RECALL_HINT_SF_OUTPUT_TOKEN_LIMIT");
  }

  let hint;
  try {
    hint = parseRecallHintProviderResponseV1(text);
  } catch (error) {
    throw adapterError("RECALL_HINT_SF_HINT_INVALID", {
      providerCode: typeof error?.code === "string" ? error.code : null,
    });
  }
  return {
    hint,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  };
}

export function createSiliconFlowRecallHintAdapterV1({
  apiKey,
  transport = createSiliconFlowRecallHintHttpsTransportV1(),
  deadlineMs = RECALL_HINT_RUNTIME_DEADLINE_MS_V1,
} = {}) {
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw adapterError("RECALL_HINT_SF_API_KEY_REQUIRED");
  }
  if (typeof transport !== "function") throw adapterError("RECALL_HINT_SF_TRANSPORT_REQUIRED");
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > 60_000) {
    throw adapterError("RECALL_HINT_SF_DEADLINE_INVALID");
  }
  const credential = apiKey.trim();
  const identity = Object.freeze({
    provider: SILICONFLOW_RECALL_HINT_PROVIDER,
    model: SILICONFLOW_RECALL_HINT_MODEL_V1,
    endpoint: SILICONFLOW_RECALL_HINT_ENDPOINT_V1,
    revision: SILICONFLOW_RECALL_HINT_REVISION_V1,
    prompt_version: RECALL_HINT_PROVIDER_PROMPT_VERSION_V1,
    prompt_sha256: RECALL_HINT_PROVIDER_PROMPT_SHA256_V1,
    output_schema_sha256: RECALL_HINT_PROVIDER_OUTPUT_SCHEMA_SHA256_V1,
  });

  const provider = async ({ query, signal: externalSignal } = {}) => {
    if (typeof query !== "string" || query.trim().length === 0) {
      throw adapterError("RECALL_HINT_SF_QUERY_INVALID");
    }
    const normalizedQuery = query.trim();
    if (codePointLength(normalizedQuery) > RECALL_HINT_RUNTIME_MAX_QUERY_CODE_POINTS_V1) {
      throw adapterError("RECALL_HINT_SF_QUERY_TOO_LONG");
    }

    const prompt = buildRecallHintProviderPromptV1({
      query: normalizedQuery,
      bounded_context: {},
    });
    if (Buffer.byteLength(prompt, "utf8") > RECALL_HINT_RUNTIME_MAX_PROMPT_BYTES_V1) {
      throw adapterError("RECALL_HINT_SF_PROMPT_TOO_LARGE");
    }

    const body = {
      model: SILICONFLOW_RECALL_HINT_MODEL_V1,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: RECALL_HINT_PROVIDER_MAX_OUTPUT_TOKENS_V1,
      enable_thinking: false,
      response_format: { type: "json_object" },
      stream: false,
    };

    const controller = new AbortController();
    if (externalSignal?.aborted) {
      throw externalSignal.reason instanceof Error
        ? externalSignal.reason
        : adapterError("RECALL_HINT_SF_ABORTED");
    }

    let timer = null;
    let rejectGuard = null;
    const guardPromise = new Promise((_, reject) => {
      rejectGuard = reject;
    });
    const abortWith = error => {
      if (!controller.signal.aborted) controller.abort(error);
      rejectGuard?.(error);
    };
    const onExternalAbort = () => abortWith(
      externalSignal?.reason instanceof Error
        ? externalSignal.reason
        : adapterError("RECALL_HINT_SF_ABORTED"),
    );
    externalSignal?.addEventListener?.("abort", onExternalAbort, { once: true });
    timer = setTimeout(() => {
      abortWith(adapterError("RECALL_HINT_SF_DEADLINE_EXCEEDED"));
    }, deadlineMs);
    timer.unref?.();

    const started = performance.now();
    try {
      const transportPromise = Promise.resolve().then(() => transport({
        endpoint: SILICONFLOW_RECALL_HINT_ENDPOINT_V1,
        body,
        apiKey: credential,
        signal: controller.signal,
        maxResponseBytes: RECALL_HINT_PROVIDER_MAX_RESPONSE_BYTES_V1,
      }));
      const response = await Promise.race([transportPromise, guardPromise]);
      const parsed = parseSiliconFlowRecallHintResponseV1(response);
      return Object.freeze({
        schema: RECALL_HINT_RUNTIME_PROVIDER_RESULT_SCHEMA_V1,
        hint: parsed.hint,
        usage: Object.freeze(parsed.usage),
        latency_ms: performance.now() - started,
      });
    } finally {
      if (timer !== null) clearTimeout(timer);
      externalSignal?.removeEventListener?.("abort", onExternalAbort);
    }
  };

  Object.defineProperties(provider, {
    adapterIdentity: { value: identity, enumerable: true },
    deadlineMs: { value: deadlineMs, enumerable: true },
    handlesDeadline: { value: true, enumerable: true },
  });
  return provider;
}

export function siliconFlowRecallHintAdapterIdentityV1() {
  return Object.freeze({
    provider: SILICONFLOW_RECALL_HINT_PROVIDER,
    model: SILICONFLOW_RECALL_HINT_MODEL_V1,
    endpoint: SILICONFLOW_RECALL_HINT_ENDPOINT_V1,
    revision: SILICONFLOW_RECALL_HINT_REVISION_V1,
    deadline_ms: RECALL_HINT_RUNTIME_DEADLINE_MS_V1,
    max_query_code_points: RECALL_HINT_RUNTIME_MAX_QUERY_CODE_POINTS_V1,
    max_prompt_bytes: RECALL_HINT_RUNTIME_MAX_PROMPT_BYTES_V1,
    max_response_bytes: RECALL_HINT_PROVIDER_MAX_RESPONSE_BYTES_V1,
    max_input_tokens: RECALL_HINT_RUNTIME_MAX_INPUT_TOKENS_V1,
    max_output_tokens: RECALL_HINT_PROVIDER_MAX_OUTPUT_TOKENS_V1,
    prompt_version: RECALL_HINT_PROVIDER_PROMPT_VERSION_V1,
    prompt_sha256: RECALL_HINT_PROVIDER_PROMPT_SHA256_V1,
    output_schema_sha256: RECALL_HINT_PROVIDER_OUTPUT_SCHEMA_SHA256_V1,
    retry_policy: "none",
  });
}
