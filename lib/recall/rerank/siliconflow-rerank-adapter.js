import https from "node:https";

export const SILICONFLOW_RERANK_PROVIDER = "siliconflow";
export const SILICONFLOW_RERANK_MODEL_8B = "Qwen/Qwen3-Reranker-8B";
export const SILICONFLOW_RERANK_MODEL_0_6B = "Qwen/Qwen3-Reranker-0.6B";
export const SILICONFLOW_RERANK_MODEL = SILICONFLOW_RERANK_MODEL_8B;
export const SILICONFLOW_RERANK_QUALIFICATION_MODELS = Object.freeze([
  SILICONFLOW_RERANK_MODEL_8B,
  SILICONFLOW_RERANK_MODEL_0_6B,
]);
export const SILICONFLOW_RERANK_ENDPOINT = "https://api.siliconflow.cn/v1/rerank";
export const QWEN3_UTF8_BYTE_TOKEN_UPPER_BOUND_ID = "qwen3_utf8_byte_token_upper_bound_v1";

export const SILICONFLOW_RERANK_LIMITS = Object.freeze({
  maxQueryTokens: 4096,
  maxDocumentTokens: 8192,
  maxPairTokens: 12288,
  specialTokenReservePerPair: 256,
});

// Qwen's tokenizer family uses byte-level BPE. UTF-8 byte length is therefore
// a conservative upper bound on raw text token count because BPE merges byte
// symbols rather than splitting a byte into multiple tokens. The separate
// per-pair reserve covers provider-side framing that is not part of raw text.
export function qwen3Utf8ByteTokenUpperBound(text) {
  if (typeof text !== "string") throw adapterError("SILICONFLOW_RERANK_TOKEN_INPUT_INVALID");
  return Buffer.byteLength(text, "utf8");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function adapterError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  for (const [key, value] of Object.entries(details)) error[key] = value;
  return error;
}

function requireTokenCount(tokenCounter, text, label) {
  const count = tokenCounter(text);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw adapterError("SILICONFLOW_RERANK_TOKEN_COUNTER_INVALID", { field: label });
  }
  return count;
}

export function preflightSiliconFlowRerankInput({
  query,
  documents,
  tokenCounter,
  limits = SILICONFLOW_RERANK_LIMITS,
} = {}) {
  if (typeof query !== "string" || query.trim().length === 0) {
    throw adapterError("SILICONFLOW_RERANK_QUERY_INVALID");
  }
  if (!Array.isArray(documents) || documents.length === 0) {
    throw adapterError("SILICONFLOW_RERANK_DOCUMENTS_INVALID");
  }
  if (documents.some(document => typeof document !== "string" || document.length === 0)) {
    throw adapterError("SILICONFLOW_RERANK_DOCUMENT_INVALID");
  }
  if (typeof tokenCounter !== "function") {
    throw adapterError("SILICONFLOW_RERANK_TOKEN_COUNTER_REQUIRED");
  }

  const queryTokens = requireTokenCount(tokenCounter, query, "query");
  if (queryTokens > limits.maxQueryTokens) {
    throw adapterError("SILICONFLOW_RERANK_QUERY_TOKEN_LIMIT", { observedTokens: queryTokens });
  }

  const documentTokens = documents.map((document, index) => {
    const count = requireTokenCount(tokenCounter, document, `document_${index}`);
    if (count > limits.maxDocumentTokens) {
      throw adapterError("SILICONFLOW_RERANK_DOCUMENT_TOKEN_LIMIT", {
        documentIndex: index,
        observedTokens: count,
      });
    }
    const pairTokens = queryTokens + count + limits.specialTokenReservePerPair;
    if (pairTokens > limits.maxPairTokens) {
      throw adapterError("SILICONFLOW_RERANK_PAIR_TOKEN_LIMIT", {
        documentIndex: index,
        observedTokens: pairTokens,
      });
    }
    return count;
  });

  const estimatedRequestTokens = documentTokens.reduce(
    (sum, count) => sum + queryTokens + count + limits.specialTokenReservePerPair,
    0,
  );

  return Object.freeze({
    queryTokens,
    documentTokens: Object.freeze(documentTokens),
    estimatedRequestTokens,
  });
}

function numericField(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function boundedSiliconFlowUsage(parsed) {
  if (!isRecord(parsed)) return null;
  const usage = isRecord(parsed.usage) ? parsed.usage : {};
  const directTokens = isRecord(parsed.tokens) ? parsed.tokens : {};
  const meta = isRecord(parsed.meta) ? parsed.meta : {};
  const metaTokens = isRecord(meta.tokens) ? meta.tokens : {};
  const billed = isRecord(meta.billed_units) ? meta.billed_units : {};
  const bounded = {
    input_tokens: numericField(usage.input_tokens ?? directTokens.input_tokens ?? metaTokens.input_tokens),
    output_tokens: numericField(usage.output_tokens ?? directTokens.output_tokens ?? metaTokens.output_tokens),
    total_tokens: numericField(usage.total_tokens ?? directTokens.total_tokens ?? metaTokens.total_tokens),
    billed_input_tokens: numericField(billed.input_tokens),
    billed_output_tokens: numericField(billed.output_tokens),
  };
  return Object.values(bounded).some(value => value !== null) ? bounded : null;
}

export function validateSiliconFlowRerankResponse(rawBody, submittedCount) {
  let parsed;
  try {
    parsed = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
  } catch {
    throw adapterError("SILICONFLOW_RERANK_RESPONSE_JSON_INVALID");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.results)) {
    throw adapterError("SILICONFLOW_RERANK_RESULTS_INVALID");
  }
  if (parsed.results.length !== submittedCount) {
    throw adapterError("SILICONFLOW_RERANK_RESULT_COUNT_MISMATCH");
  }

  const seen = new Set();
  const scores = [];
  for (const result of parsed.results) {
    const index = result?.index;
    const score = result?.relevance_score;
    if (!Number.isInteger(index) || index < 0 || index >= submittedCount) {
      throw adapterError("SILICONFLOW_RERANK_INDEX_OUT_OF_RANGE");
    }
    if (seen.has(index)) throw adapterError("SILICONFLOW_RERANK_INDEX_DUPLICATE");
    if (!Number.isFinite(score)) throw adapterError("SILICONFLOW_RERANK_SCORE_INVALID");
    seen.add(index);
    scores.push({ index, score });
  }
  if (seen.size !== submittedCount) {
    throw adapterError("SILICONFLOW_RERANK_INDEX_SET_INCOMPLETE");
  }
  return {
    scores,
    usage: boundedSiliconFlowUsage(parsed),
  };
}

export function createSiliconFlowHttpsTransport({ httpsImpl = https } = {}) {
  return ({ endpoint, body, apiKey, signal }) => new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const payload = JSON.stringify(body);
    let settled = false;
    let request;

    const cleanup = () => signal?.removeEventListener("abort", abortRequest);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const abortRequest = () => {
      const error = adapterError("SILICONFLOW_RERANK_ABORTED");
      request?.destroy(error);
      finish(reject, error);
    };

    if (signal?.aborted) {
      abortRequest();
      return;
    }

    request = httpsImpl.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(payload),
      },
    }, response => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { raw += chunk; });
      response.on("end", () => finish(resolve, {
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: raw,
      }));
    });
    request.on("error", error => finish(reject, error));
    signal?.addEventListener("abort", abortRequest, { once: true });
    request.write(payload);
    request.end();
  });
}

export function createSiliconFlowRerankAdapter({
  apiKey,
  transport = createSiliconFlowHttpsTransport(),
  tokenCounter = qwen3Utf8ByteTokenUpperBound,
  model = SILICONFLOW_RERANK_MODEL,
  endpoint = SILICONFLOW_RERANK_ENDPOINT,
  limits = SILICONFLOW_RERANK_LIMITS,
} = {}) {
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw adapterError("SILICONFLOW_RERANK_API_KEY_REQUIRED");
  }
  if (typeof transport !== "function") throw adapterError("SILICONFLOW_RERANK_TRANSPORT_REQUIRED");
  if (typeof tokenCounter !== "function") throw adapterError("SILICONFLOW_RERANK_TOKEN_COUNTER_REQUIRED");

  const identity = Object.freeze({
    provider: SILICONFLOW_RERANK_PROVIDER,
    model,
    revision: null,
  });

  const adapter = async (query, documents, signal) => {
    preflightSiliconFlowRerankInput({ query, documents, tokenCounter, limits });
    const body = {
      model,
      query,
      documents,
      top_n: documents.length,
      return_documents: false,
    };
    const response = await transport({
      endpoint,
      body,
      apiKey: apiKey.trim(),
      signal,
    });
    if (!isRecord(response) || !Number.isInteger(response.status)) {
      throw adapterError("SILICONFLOW_RERANK_TRANSPORT_RESPONSE_INVALID");
    }
    if (response.status < 200 || response.status >= 300) {
      throw adapterError("SILICONFLOW_RERANK_HTTP_ERROR", { httpStatus: response.status });
    }
    let validated;
    try {
      validated = validateSiliconFlowRerankResponse(response.body, documents.length);
    } catch (error) {
      if (typeof error?.code === "string" && (
        error.code.startsWith("SILICONFLOW_RERANK_RESPONSE_")
        || error.code.startsWith("SILICONFLOW_RERANK_RESULTS_")
        || error.code.startsWith("SILICONFLOW_RERANK_RESULT_")
        || error.code.startsWith("SILICONFLOW_RERANK_INDEX_")
        || error.code.startsWith("SILICONFLOW_RERANK_SCORE_")
      )) {
        return {
          scores: null,
          adapterIdentity: identity,
          usage: null,
          adapterErrorCode: error.code,
        };
      }
      throw error;
    }
    return {
      scores: validated.scores,
      adapterIdentity: identity,
      usage: validated.usage,
    };
  };
  Object.defineProperty(adapter, "adapterIdentity", { value: identity, enumerable: true });
  return adapter;
}
