import { request as httpsRequest } from "node:https";

import { createSiliconFlowRerankAdapter } from "../recall/rerank/siliconflow-rerank-adapter.js";
import {
  Q4_C1B_EMBEDDING_DEADLINE_MS,
  Q4_C1B_EMBEDDING_ENDPOINT,
  Q4_C1B_EMBEDDING_MAX_RESPONSE_BYTES,
  buildQ4RecallHintC1BRetrievalEffectContractV1,
} from "./q4-recall-hint-c1b-retrieval-effect-contract-v1.js";
import { buildQ4RecallHintC1BDevelopmentHintsV1 } from "./q4-recall-hint-c1b-development-hints-v1.js";

export const Q4_C1B_RETRIEVAL_EFFECT_API_KEY_ENV = "SILICONFLOW_API_KEY";

function fail(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function exactKey(env) {
  const value = typeof env?.[Q4_C1B_RETRIEVAL_EFFECT_API_KEY_ENV] === "string"
    ? env[Q4_C1B_RETRIEVAL_EFFECT_API_KEY_ENV].trim()
    : "";
  if (!value) throw fail("Q4_C1B_RETRIEVAL_SF_CREDENTIAL_UNAVAILABLE");
  if (!value.startsWith("sk-")) throw fail("Q4_C1B_RETRIEVAL_SF_CREDENTIAL_FORMAT_INVALID");
  return value;
}

function redactedMessage(error, fallback) {
  return String(error?.message || fallback)
    .replace(/authorization\s*:\s*bearer\s+[^\s]+/giu, "authorization: bearer [redacted]")
    .replace(/bearer\s+[^\s]+/giu, "bearer [redacted]")
    .replace(/(api[_-]?key|token|secret)\s*[=:]\s*[^\s,;]+/giu, "$1=[redacted]")
    .slice(0, 300);
}

function chunkBytes(chunk) {
  if (Buffer.isBuffer(chunk)) return chunk.byteLength;
  if (ArrayBuffer.isView(chunk) && !(chunk instanceof DataView)) return chunk.byteLength;
  return Buffer.byteLength(String(chunk));
}

function postJson({ requestImpl, endpoint, apiKey, body, timeoutMs, maxResponseBytes }) {
  return new Promise((resolve, reject) => {
    let request = null;
    let response = null;
    let settled = false;
    let timer = null;
    const controller = new AbortController();

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const terminate = error => {
      if (settled) return;
      try { response?.destroy?.(); } catch {}
      try { request?.destroy?.(); } catch {}
      controller.abort(error);
      finish(error);
    };

    try {
      request = requestImpl(new URL(endpoint), {
        method: "POST",
        signal: controller.signal,
        timeout: timeoutMs,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      }, res => {
        response = res;
        let data = "";
        let bytes = 0;
        let ended = false;
        res.on("data", chunk => {
          if (settled) return;
          bytes += chunkBytes(chunk);
          if (bytes > maxResponseBytes) {
            terminate(fail("Q4_C1B_RETRIEVAL_SF_EMBED_RESPONSE_TOO_LARGE"));
            return;
          }
          data += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
        });
        res.on("end", () => {
          if (settled) return;
          ended = true;
          const status = Number(res.statusCode || 0);
          if (status < 200 || status >= 300) {
            terminate(fail("Q4_C1B_RETRIEVAL_SF_EMBED_HTTP_ERROR", `SiliconFlow embedding HTTP ${status}`));
            return;
          }
          let parsed;
          try { parsed = JSON.parse(data); } catch {
            terminate(fail("Q4_C1B_RETRIEVAL_SF_EMBED_JSON_INVALID"));
            return;
          }
          finish(null, parsed);
        });
        res.on("error", error => terminate(fail(
          "Q4_C1B_RETRIEVAL_SF_EMBED_RESPONSE_FAILED",
          redactedMessage(error, "SiliconFlow embedding response failed"),
        )));
        res.on("aborted", () => terminate(fail("Q4_C1B_RETRIEVAL_SF_EMBED_RESPONSE_ABORTED")));
        res.on("close", () => {
          if (!ended && !settled) terminate(fail("Q4_C1B_RETRIEVAL_SF_EMBED_RESPONSE_CLOSED"));
        });
      });
      request.on("error", error => terminate(fail(
        "Q4_C1B_RETRIEVAL_SF_EMBED_REQUEST_FAILED",
        redactedMessage(error, "SiliconFlow embedding request failed"),
      )));
      request.on("timeout", () => terminate(fail("Q4_C1B_RETRIEVAL_SF_EMBED_TIMEOUT")));
      timer = setTimeout(() => terminate(fail("Q4_C1B_RETRIEVAL_SF_EMBED_TIMEOUT")), timeoutMs);
      timer.unref?.();
      request.write(JSON.stringify(body));
      request.end();
    } catch (error) {
      terminate(fail(
        "Q4_C1B_RETRIEVAL_SF_EMBED_REQUEST_FAILED",
        redactedMessage(error, "SiliconFlow embedding request failed"),
      ));
    }
  });
}

function parseEmbeddingResponse(parsed, contract) {
  if (parsed?.error) throw fail("Q4_C1B_RETRIEVAL_SF_EMBED_PROVIDER_ERROR");
  const embedding = parsed?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) && !ArrayBuffer.isView(embedding)) {
    throw fail("Q4_C1B_RETRIEVAL_SF_EMBED_VECTOR_MISSING");
  }
  const vector = Array.from(embedding);
  if (vector.length !== contract.embedding.dimension || !vector.every(Number.isFinite)) {
    throw fail("Q4_C1B_RETRIEVAL_SF_EMBED_VECTOR_INVALID");
  }
  return vector;
}

export function q4RecallHintC1BRetrievalEffectCredentialPreflightV1({ env = process.env } = {}) {
  exactKey(env);
  return Object.freeze({
    credential_env: Q4_C1B_RETRIEVAL_EFFECT_API_KEY_ENV,
    available: true,
  });
}

export function createQ4RecallHintC1BSiliconFlowRetrievalProvidersV1({
  corpus,
  hintSnapshot = null,
  env = process.env,
  requestImpl = httpsRequest,
  rerankTransport = undefined,
} = {}) {
  const hints = hintSnapshot || buildQ4RecallHintC1BDevelopmentHintsV1(corpus);
  const contract = buildQ4RecallHintC1BRetrievalEffectContractV1({ corpus, hintSnapshot: hints });
  const apiKey = exactKey(env);
  if (typeof requestImpl !== "function") throw fail("Q4_C1B_RETRIEVAL_SF_REQUEST_IMPL_REQUIRED");

  const embeddingProvider = async input => {
    if (typeof input !== "string" || input.length === 0) throw fail("Q4_C1B_RETRIEVAL_SF_EMBED_INPUT_INVALID");
    if (Buffer.byteLength(input, "utf8") > contract.embedding.max_input_tokens_per_request) {
      throw fail("Q4_C1B_RETRIEVAL_SF_EMBED_INPUT_BOUND_EXCEEDED");
    }
    const parsed = await postJson({
      requestImpl,
      endpoint: Q4_C1B_EMBEDDING_ENDPOINT,
      apiKey,
      timeoutMs: Q4_C1B_EMBEDDING_DEADLINE_MS,
      maxResponseBytes: Q4_C1B_EMBEDDING_MAX_RESPONSE_BYTES,
      body: {
        model: contract.embedding.model,
        input,
        dimensions: contract.embedding.dimension,
        encoding_format: "float",
      },
    });
    return parseEmbeddingResponse(parsed, contract);
  };

  const rerankAdapter = createSiliconFlowRerankAdapter({
    apiKey,
    model: contract.rerank.model,
    endpoint: contract.rerank.endpoint,
    ...(typeof rerankTransport === "function" ? { transport: rerankTransport } : {}),
  });

  return Object.freeze({ contract, embeddingProvider, rerankAdapter });
}
