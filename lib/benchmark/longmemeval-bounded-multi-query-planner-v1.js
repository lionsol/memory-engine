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
  url.search = "";
  url.hash = "";
  return url;
}

function requestPlannerResponse(requestImpl, url, apiKey, body) {
  return new Promise((resolve, reject) => {
    const request = requestImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    }, response => {
      let data = "";
      response.on("data", chunk => data += chunk);
      response.on("end", () => {
        const statusCode = Number(response?.statusCode || 0);
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`planner request failed: HTTP ${statusCode}`));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const content = parsed?.choices?.[0]?.message?.content;
          if (typeof content !== "string") throw new Error("planner response content unavailable");
          resolve(content);
        } catch (error) {
          reject(new Error(error?.message || "planner response parse failed"));
        }
      });
    });
    request.on("error", error => reject(new Error(`planner request failed: ${error?.message || "network error"}`)));
    request.write(JSON.stringify(body));
    request.end();
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
    planner_model: H2_QUERY_PLANNER_MODEL,
    planner_model_revision: H2_QUERY_PLANNER_MODEL_REVISION,
    planner_prompt_version: H2_QUERY_PLANNER_PROMPT_VERSION,
    planner_prompt_text: H2_QUERY_PLANNER_PROMPT_TEXT,
    planner_prompt_sha256: H2_QUERY_PLANNER_PROMPT_SHA256,
    planner_temperature: H2_QUERY_PLANNER_TEMPERATURE,
    planner_output_schema: H2_QUERY_PLANNER_OUTPUT_SCHEMA,
    planner_query_count: H2_QUERY_PLANNER_QUERY_COUNT,
    planner_query_max_chars: H2_QUERY_PLANNER_QUERY_MAX_CHARS,
  };
}
