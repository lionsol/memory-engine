import { createHash } from "node:crypto";

import {
  RECALL_HINT_V1_BOUNDS,
  RECALL_HINT_V1_RELATIONS,
  RECALL_HINT_V1_VERSION,
  validateRecallHintV1,
} from "./recall-hint-v1.js";

export const RECALL_HINT_PROVIDER_PROMPT_VERSION_V1 = "q4_recall_hint_producer_prompt_v1";
export const RECALL_HINT_PROVIDER_MAX_RESPONSE_BYTES_V1 = 16_384;
export const RECALL_HINT_PROVIDER_MAX_OUTPUT_TOKENS_V1 = 256;
export const RECALL_HINT_RUNTIME_PROVIDER_RESULT_SCHEMA_V1 = "memory_engine_recall_hint_provider_result_v1";

export const RECALL_HINT_PROVIDER_OUTPUT_SCHEMA_V1 = JSON.stringify({
  type: "object",
  additionalProperties: false,
  required: ["version"],
  properties: {
    version: { const: RECALL_HINT_V1_VERSION },
    project: { type: "string", maxCodePoints: RECALL_HINT_V1_BOUNDS.projectCodePoints },
    entities: {
      type: "array",
      maxItems: RECALL_HINT_V1_BOUNDS.maxEntities,
      items: { type: "string", maxCodePoints: RECALL_HINT_V1_BOUNDS.entityCodePoints },
    },
    time_relation: {
      type: "object",
      additionalProperties: false,
      required: ["relation"],
      properties: {
        relation: { enum: [...RECALL_HINT_V1_RELATIONS] },
        anchor: { type: "string", maxCodePoints: RECALL_HINT_V1_BOUNDS.anchorCodePoints },
      },
    },
    query_facets: {
      type: "array",
      maxItems: RECALL_HINT_V1_BOUNDS.maxQueryFacets,
      items: { type: "string", maxCodePoints: RECALL_HINT_V1_BOUNDS.queryFacetCodePoints },
    },
  },
});

export const RECALL_HINT_PROVIDER_PROMPT_TEXT_V1 = [
  "Generate one bounded Recall Hint for retrieving relevant past-memory evidence.",
  "Use only the supplied current query and bounded caller context.",
  "Do not answer the user's question.",
  "Do not invent entities, projects, dates, events, facts, or context that was not supplied.",
  "If the supplied information does not justify a hint field, omit that field.",
  `Always return version=${RECALL_HINT_V1_VERSION}; an otherwise empty Recall Hint is valid.`,
  "Project, entities, time relation, and query facets are soft retrieval hints only.",
  "For before/after/during, include an anchor only when the supplied input supports it.",
  "Return strict JSON only: no Markdown, no prose, no code fence.",
  `The output must satisfy this schema: ${RECALL_HINT_PROVIDER_OUTPUT_SCHEMA_V1}`,
].join(" ");

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export const RECALL_HINT_PROVIDER_PROMPT_SHA256_V1 = sha256(RECALL_HINT_PROVIDER_PROMPT_TEXT_V1);
export const RECALL_HINT_PROVIDER_OUTPUT_SCHEMA_SHA256_V1 = sha256(RECALL_HINT_PROVIDER_OUTPUT_SCHEMA_V1);

function contractError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedContext(value) {
  const source = value === undefined || value === null ? {} : value;
  if (!isRecord(source)) throw contractError("RECALL_HINT_PROVIDER_BOUNDED_CONTEXT_INVALID");
  const allowed = new Set(["active_project", "recent_entities", "temporal_anchor"]);
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) throw contractError(`RECALL_HINT_PROVIDER_BOUNDED_CONTEXT_UNKNOWN_FIELD:${key}`);
  }
  return structuredClone(source);
}

export function buildRecallHintProviderPromptV1({ query, bounded_context: context = {} } = {}) {
  if (typeof query !== "string" || query.trim().length === 0) {
    throw contractError("RECALL_HINT_PROVIDER_QUERY_REQUIRED");
  }
  return [
    RECALL_HINT_PROVIDER_PROMPT_TEXT_V1,
    `INPUT_JSON=${JSON.stringify({
      query: query.trim(),
      bounded_context: boundedContext(context),
    })}`,
  ].join("\n");
}

export function parseRecallHintProviderResponseV1(raw) {
  if (typeof raw !== "string") throw contractError("RECALL_HINT_PROVIDER_RESPONSE_MUST_BE_STRING");
  if (Buffer.byteLength(raw, "utf8") > RECALL_HINT_PROVIDER_MAX_RESPONSE_BYTES_V1) {
    throw contractError("RECALL_HINT_PROVIDER_RESPONSE_TOO_LARGE");
  }
  if (raw.includes("```")) throw contractError("RECALL_HINT_PROVIDER_RESPONSE_MARKDOWN_FORBIDDEN");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw contractError("RECALL_HINT_PROVIDER_RESPONSE_NOT_STRICT_JSON");
  }
  const validation = validateRecallHintV1(parsed);
  if (!validation.valid) throw contractError("RECALL_HINT_PROVIDER_RESPONSE_HINT_INVALID");
  return validation.normalized;
}

export function recallHintProviderContractIdentityV1() {
  return Object.freeze({
    prompt_version: RECALL_HINT_PROVIDER_PROMPT_VERSION_V1,
    prompt_sha256: RECALL_HINT_PROVIDER_PROMPT_SHA256_V1,
    output_schema_sha256: RECALL_HINT_PROVIDER_OUTPUT_SCHEMA_SHA256_V1,
    max_response_bytes: RECALL_HINT_PROVIDER_MAX_RESPONSE_BYTES_V1,
    max_output_tokens: RECALL_HINT_PROVIDER_MAX_OUTPUT_TOKENS_V1,
  });
}
