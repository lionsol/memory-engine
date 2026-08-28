import { createHash } from "node:crypto";

import {
  DEFAULT_SF_BASE_URL,
  getSFBaseUrl,
  resolveSFKey,
} from "../siliconflow-runtime.js";
import { normalizeEmbeddingBaseUrlIdentity } from "./longmemeval-semantic-retrieval-runner-v1.js";

export const H2_QUERY_PLANNER_PROVIDER = "SiliconFlow";
export const H2_QUERY_PLANNER_ENDPOINT = "/chat/completions";
export const H2_QUERY_PLANNER_MODEL = "deepseek-ai/DeepSeek-V3.2";
export const H2_QUERY_PLANNER_MODEL_REVISION = "unavailable/unpinned";
export const H2_QUERY_PLANNER_TEMPERATURE = 0;
export const H2_QUERY_PLANNER_MAX_TOKENS = 256;
export const H2_QUERY_PLANNER_TIMEOUT_MS = 45_000;
export const H2_QUERY_PLANNER_MAX_RESPONSE_BYTES = 65_536;
export const H2_QUERY_PLANNER_QUERY_COUNT = 2;
export const H2_QUERY_PLANNER_QUERY_MAX_CHARS = 200;
export const H2_QUERY_PLANNER_OUTPUT_SCHEMA = '{"queries":["...", "..."]}';
export const H2_QUERY_PLANNER_PROMPT_VERSION = "bounded_multi_query_planner_prompt_v1";
export const H2_QUERY_PLANNER_PROMPT_TEXT = [
  "Generate exactly two short, complementary queries that can independently retrieve past conversation passages.",
  "Cover different evidence needed for a complete answer.",
  "Preserve entities, quantities, and time constraints.",
  "Do not answer the question or invent facts.",
  `Return only strict JSON matching ${H2_QUERY_PLANNER_OUTPUT_SCHEMA}.`,
].join(" ");
export const H2_QUERY_PLANNER_PROMPT_SHA256 = createHash("sha256")
  .update(H2_QUERY_PLANNER_PROMPT_TEXT)
  .digest("hex");
export const H2_QUERY_PLANNER_OUTPUT_SCHEMA_SHA256 = createHash("sha256")
  .update(H2_QUERY_PLANNER_OUTPUT_SCHEMA)
  .digest("hex");

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export class BoundedMultiQueryPlannerError extends Error {
  constructor(stage, message) {
    super(`bounded_multi_query_planner_${stage}: ${String(message || "invalid planner response")}`);
    this.name = "BoundedMultiQueryPlannerError";
    this.stage = stage;
    this.code = `bounded_multi_query_planner_${stage}`;
  }
}

function assertQuestion(question) {
  if (typeof question !== "string") throw new BoundedMultiQueryPlannerError("input", "question must be a string");
  if (question.length === 0) throw new BoundedMultiQueryPlannerError("input", "question must not be empty");
}

function planHash(queries) {
  return sha256(JSON.stringify({ queries }));
}

function validatePlanObject(value, { exactProductionQuery = null } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BoundedMultiQueryPlannerError("parse", "planner output must be a JSON object");
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "queries") {
    throw new BoundedMultiQueryPlannerError("parse", "planner output must contain only queries");
  }
  if (!Array.isArray(value.queries) || value.queries.length !== H2_QUERY_PLANNER_QUERY_COUNT) {
    throw new BoundedMultiQueryPlannerError("parse", "planner output must contain exactly two queries");
  }
  const queries = value.queries.map(query => {
    if (typeof query !== "string") {
      throw new BoundedMultiQueryPlannerError("parse", "planner queries must be strings");
    }
    if (query.trim().length === 0) {
      throw new BoundedMultiQueryPlannerError("parse", "planner queries must not be empty");
    }
    if (query.length > H2_QUERY_PLANNER_QUERY_MAX_CHARS) {
      throw new BoundedMultiQueryPlannerError("parse", "planner query exceeds the frozen length limit");
    }
    return query;
  });
  const trimmed = queries.map(query => query.trim());
  if (new Set(trimmed).size !== queries.length) {
    throw new BoundedMultiQueryPlannerError("parse", "planner queries must be distinct after trim");
  }
  if (exactProductionQuery !== null && trimmed.some(query => query === String(exactProductionQuery).trim())) {
    throw new BoundedMultiQueryPlannerError("parse", "planner query duplicates the production query");
  }
  return {
    queries,
    plan_hash: planHash(queries),
  };
}

export function buildBoundedMultiQueryPlannerPrompt(question) {
  assertQuestion(question);
  return `${H2_QUERY_PLANNER_PROMPT_TEXT}\nQuestion:${question}`;
}

export function buildBoundedMultiQueryPlannerRequest(question) {
  return {
    model: H2_QUERY_PLANNER_MODEL,
    temperature: H2_QUERY_PLANNER_TEMPERATURE,
    max_tokens: H2_QUERY_PLANNER_MAX_TOKENS,
    messages: [{
      role: "user",
      content: buildBoundedMultiQueryPlannerPrompt(question),
    }],
  };
}

export function parseBoundedMultiQueryPlannerResponse(raw, { exactProductionQuery = null } = {}) {
  if (typeof raw !== "string") {
    throw new BoundedMultiQueryPlannerError("parse", "planner response must be a JSON string");
  }
  if (raw.includes("```")) {
    throw new BoundedMultiQueryPlannerError("parse", "markdown code fences are not allowed");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BoundedMultiQueryPlannerError("parse", "planner response is not strict JSON");
  }
  return validatePlanObject(parsed, { exactProductionQuery });
}

export function validateCachedBoundedMultiQueryPlan(value, { exactProductionQuery = null } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BoundedMultiQueryPlannerError("cache", "cached planner result must be an object");
  }
  const canonical = validatePlanObject({ queries: value.queries }, { exactProductionQuery });
  if (value.plan_hash !== undefined && value.plan_hash !== canonical.plan_hash) {
    throw new BoundedMultiQueryPlannerError("cache", "cached planner hash mismatch");
  }
  return canonical;
}

function plannerRequestUrl(baseUrl) {
  const url = new URL(String(baseUrl || DEFAULT_SF_BASE_URL));
  const pathname = url.pathname.replace(/\/+$/u, "");
  url.pathname = `${pathname.endsWith("/v1") ? pathname : `${pathname}/v1`}${H2_QUERY_PLANNER_ENDPOINT}`;
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url;
}

function responseChunkByteLength(chunk) {
  if (Buffer.isBuffer(chunk)) return chunk.byteLength;
  if (ArrayBuffer.isView(chunk) && !(chunk instanceof DataView)) return chunk.byteLength;
  return Buffer.byteLength(String(chunk));
}

function safeTransportMessage(error, fallback, secrets = []) {
  let message = String(error?.message || fallback);
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0) message = message.split(secret).join("[redacted]");
  }
  return message
    .replace(/authorization\s*:\s*bearer\s+[^\s]+/giu, "authorization: bearer [redacted]")
    .replace(/bearer\s+[^\s]+/giu, "bearer [redacted]")
    .replace(/(api[_-]?key|token|secret)\s*[=:]\s*[^\s,;]+/giu, "$1=[redacted]")
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/giu, "https://[redacted]@");
}

function requestPlannerResponse(
  requestImpl,
  url,
  apiKey,
  body,
  {
    timeoutMs = H2_QUERY_PLANNER_TIMEOUT_MS,
    maxResponseBytes = H2_QUERY_PLANNER_MAX_RESPONSE_BYTES,
  } = {},
) {
  return new Promise((resolve, reject) => {
    let request = null;
    let response = null;
    let timer = null;
    let settled = false;

    const finish = (error, value) => {
      if (settled) return false;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
      return true;
    };
    const terminate = error => {
      if (!finish(error)) return;
      try {
        response?.destroy?.();
      } catch {
        // The request result is already failed; destruction is best effort.
      }
      try {
        request?.destroy?.();
      } catch {
        // The request result is already failed; destruction is best effort.
      }
    };
    const requestError = error => terminate(new Error(
      `planner request failed: ${safeTransportMessage(error, "network error", [apiKey])}`,
    ));
    const timeoutError = () => terminate(new Error(`planner request timed out after ${timeoutMs}ms`));

    try {
      request = requestImpl(url, {
        method: "POST",
        timeout: timeoutMs,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      }, responseValue => {
        response = responseValue;
        let data = "";
        let responseBytes = 0;
        let responseEnded = false;
        const responseError = error => terminate(new Error(
          `planner response failed: ${safeTransportMessage(error, "response error", [apiKey])}`,
        ));
        const responseData = chunk => {
          if (settled) return;
          responseBytes += responseChunkByteLength(chunk);
          if (responseBytes > maxResponseBytes) {
            terminate(new Error(`planner response exceeded ${maxResponseBytes} bytes`));
            return;
          }
          data += Buffer.isBuffer(chunk) || (ArrayBuffer.isView(chunk) && !(chunk instanceof DataView))
            ? Buffer.from(chunk).toString("utf8")
            : String(chunk);
        };
        const responseEnd = () => {
          if (settled) return;
          responseEnded = true;
          const statusCode = Number(response?.statusCode || 0);
          if (statusCode < 200 || statusCode >= 300) {
            terminate(new Error(`planner request failed: HTTP ${statusCode}`));
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            terminate(new Error("planner response JSON is invalid"));
            return;
          }
          if (parsed?.error) {
            terminate(new Error("planner provider returned an error"));
            return;
          }
          const content = parsed?.choices?.[0]?.message?.content;
          if (typeof content !== "string" || content.length === 0) {
            terminate(new Error("planner response content unavailable"));
            return;
          }
          finish(null, content);
        };
        if (!responseValue || typeof responseValue.on !== "function") {
          terminate(new Error("planner response stream unavailable"));
          return;
        }
        responseValue.on("data", responseData);
        responseValue.on("end", responseEnd);
        responseValue.on("error", responseError);
        responseValue.on("aborted", () => responseError(new Error("response aborted")));
        responseValue.on("close", () => {
          if (!responseEnded && !settled) responseError(new Error("response closed"));
        });
      });
      if (settled) return;
      if (!request || typeof request.on !== "function") {
        terminate(new Error("planner request stream unavailable"));
        return;
      }
      request.on("error", requestError);
      request.on("timeout", timeoutError);
      if (typeof request.setTimeout === "function") request.setTimeout(timeoutMs, timeoutError);
      timer = setTimeout(timeoutError, timeoutMs);
      request.write(JSON.stringify(body));
      request.end();
    } catch (error) {
      terminate(new Error(`planner request failed: ${safeTransportMessage(error, "request error", [apiKey])}`));
    }
  });
}

export function createSiliconFlowBoundedMultiQueryPlanner({
  baseUrl = null,
  providerConfig = undefined,
  providerEnv = undefined,
  providerHomeDir = undefined,
  providerReadFile = undefined,
  requestImpl = null,
} = {}) {
  const resolvedBaseUrl = baseUrl || getSFBaseUrl({ env: providerEnv });
  return async question => {
    assertQuestion(question);
    const apiKey = resolveSFKey({
      cfg: providerConfig,
      env: providerEnv,
      homeDir: providerHomeDir,
      readFile: providerReadFile,
    });
    if (!apiKey) throw new Error("planner provider credential unavailable");
    const request = requestImpl || (await import("node:https")).request;
    return requestPlannerResponse(
      request,
      plannerRequestUrl(resolvedBaseUrl),
      apiKey,
      buildBoundedMultiQueryPlannerRequest(question),
    );
  };
}

export function boundedMultiQueryPlannerProvenance(baseUrl = DEFAULT_SF_BASE_URL) {
  return {
    planner_provider: H2_QUERY_PLANNER_PROVIDER,
    planner_endpoint: H2_QUERY_PLANNER_ENDPOINT,
    planner_base_url_identity: normalizeEmbeddingBaseUrlIdentity(baseUrl),
    planner_request_url_identity: plannerRequestUrl(baseUrl).toString(),
    planner_api_path: plannerRequestUrl(baseUrl).pathname,
    planner_model: H2_QUERY_PLANNER_MODEL,
    planner_model_revision: H2_QUERY_PLANNER_MODEL_REVISION,
    planner_prompt_version: H2_QUERY_PLANNER_PROMPT_VERSION,
    planner_prompt_text: H2_QUERY_PLANNER_PROMPT_TEXT,
    planner_prompt_sha256: H2_QUERY_PLANNER_PROMPT_SHA256,
    planner_temperature: H2_QUERY_PLANNER_TEMPERATURE,
    planner_output_schema: H2_QUERY_PLANNER_OUTPUT_SCHEMA,
    planner_output_schema_sha256: H2_QUERY_PLANNER_OUTPUT_SCHEMA_SHA256,
    planner_max_tokens: H2_QUERY_PLANNER_MAX_TOKENS,
    planner_timeout_ms: H2_QUERY_PLANNER_TIMEOUT_MS,
    planner_max_response_bytes: H2_QUERY_PLANNER_MAX_RESPONSE_BYTES,
    planner_query_count: H2_QUERY_PLANNER_QUERY_COUNT,
    planner_query_max_chars: H2_QUERY_PLANNER_QUERY_MAX_CHARS,
  };
}
