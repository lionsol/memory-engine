import { validateRecallHintV1 } from "../recall/hint/recall-hint-v1.js";
import {
  RECALL_HINT_PROVIDER_OUTPUT_SCHEMA_SHA256_V1,
  RECALL_HINT_PROVIDER_OUTPUT_SCHEMA_V1,
  RECALL_HINT_PROVIDER_PROMPT_SHA256_V1,
  RECALL_HINT_PROVIDER_PROMPT_TEXT_V1,
  RECALL_HINT_PROVIDER_PROMPT_VERSION_V1,
  buildRecallHintProviderPromptV1,
} from "../recall/hint/recall-hint-provider-contract-v1.js";
import {
  Q4_RECALL_HINT_C1_FROZEN_IDENTITY,
  Q4_RECALL_HINT_C1_MANIFEST_SCHEMA,
  Q4_RECALL_HINT_C1_PRODUCER_INPUT_SCHEMA,
} from "./q4-recall-hint-c1-manifest-v1.js";

export const Q4_RECALL_HINT_C1B_PROVIDER_CONTRACT_SCHEMA = "memory_engine_q4_recall_hint_c1b_provider_contract_v1";
export const Q4_RECALL_HINT_C1B_EXECUTION_PACKET_SCHEMA = "memory_engine_q4_recall_hint_c1b_execution_packet_v1";
export const Q4_RECALL_HINT_C1B_PROMPT_VERSION = RECALL_HINT_PROVIDER_PROMPT_VERSION_V1;
export const Q4_RECALL_HINT_C1B_MAX_PROVIDER_REQUESTS = 48;
export const Q4_RECALL_HINT_C1B_MAX_DEVELOPMENT_REQUESTS = 16;
export const Q4_RECALL_HINT_C1B_MAX_ACCEPTANCE_REQUESTS = 32;
export const Q4_RECALL_HINT_C1B_MAX_INPUT_TOKENS_PER_REQUEST = 2048;
export const Q4_RECALL_HINT_C1B_MAX_OUTPUT_TOKENS_PER_REQUEST = 256;
export const Q4_RECALL_HINT_C1B_MAX_TOTAL_INPUT_TOKENS = 98_304;
export const Q4_RECALL_HINT_C1B_MAX_TOTAL_OUTPUT_TOKENS = 12_288;
export const Q4_RECALL_HINT_C1B_MAX_RESPONSE_BYTES = 16_384;
export const Q4_RECALL_HINT_C1B_DEADLINE_MS = 15_000;
export const Q4_RECALL_HINT_C1B_TEMPERATURE = 0;
export const Q4_RECALL_HINT_C1B_EGRESS_SCOPE = "frozen_q4_c1_query_plus_bounded_context_only";

export const Q4_RECALL_HINT_C1B_OUTPUT_SCHEMA = RECALL_HINT_PROVIDER_OUTPUT_SCHEMA_V1;
export const Q4_RECALL_HINT_C1B_PROMPT_TEXT = RECALL_HINT_PROVIDER_PROMPT_TEXT_V1;
export const Q4_RECALL_HINT_C1B_PROMPT_SHA256 = RECALL_HINT_PROVIDER_PROMPT_SHA256_V1;
export const Q4_RECALL_HINT_C1B_OUTPUT_SCHEMA_SHA256 = RECALL_HINT_PROVIDER_OUTPUT_SCHEMA_SHA256_V1;

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw fail(code);
  return value.trim();
}

function requireNonNegativeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw fail(code);
  return value;
}

function assertHttpsEndpoint(value) {
  const endpoint = requireString(value, "Q4_C1B_ENDPOINT_REQUIRED");
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw fail("Q4_C1B_ENDPOINT_INVALID");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw fail("Q4_C1B_ENDPOINT_MUST_BE_HTTPS");
  }
  return endpoint;
}

function assertFrozenManifest(manifest) {
  if (!isRecord(manifest) || manifest.schema !== Q4_RECALL_HINT_C1_MANIFEST_SCHEMA) {
    throw fail("Q4_C1B_MANIFEST_INVALID");
  }
  const checks = {
    corpus_sha256: manifest.corpus_identity?.corpus_sha256,
    development_sha256: manifest.development_sha256,
    acceptance_sha256: manifest.acceptance_sha256,
    manifest_sha256: manifest.manifest_sha256,
  };
  for (const [field, expected] of Object.entries(Q4_RECALL_HINT_C1_FROZEN_IDENTITY)) {
    if (checks[field] !== expected) throw fail(`Q4_C1B_MANIFEST_FROZEN_IDENTITY_MISMATCH:${field}`);
  }
  if (manifest.population?.development_count !== Q4_RECALL_HINT_C1B_MAX_DEVELOPMENT_REQUESTS
      || manifest.population?.acceptance_count !== Q4_RECALL_HINT_C1B_MAX_ACCEPTANCE_REQUESTS) {
    throw fail("Q4_C1B_MANIFEST_POPULATION_MISMATCH");
  }
  return manifest;
}

function sanitizeBoundedContext(value) {
  if (!isRecord(value)) throw fail("Q4_C1B_BOUNDED_CONTEXT_INVALID");
  const allowed = new Set(["active_project", "recent_entities", "temporal_anchor"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw fail(`Q4_C1B_BOUNDED_CONTEXT_UNKNOWN_FIELD:${key}`);
  }
  return structuredClone(value);
}

export function buildQ4RecallHintC1BPrompt(producerInput) {
  if (!isRecord(producerInput) || producerInput.schema !== Q4_RECALL_HINT_C1_PRODUCER_INPUT_SCHEMA) {
    throw fail("Q4_C1B_PRODUCER_INPUT_INVALID");
  }
  const query = requireString(producerInput.query, "Q4_C1B_QUERY_REQUIRED");
  const boundedContext = sanitizeBoundedContext(producerInput.bounded_context);
  return buildRecallHintProviderPromptV1({
    query,
    bounded_context: boundedContext,
  });
}

export function buildQ4RecallHintC1BRequest(producerInput) {
  return Object.freeze({
    prompt_version: Q4_RECALL_HINT_C1B_PROMPT_VERSION,
    prompt_sha256: Q4_RECALL_HINT_C1B_PROMPT_SHA256,
    output_schema_sha256: Q4_RECALL_HINT_C1B_OUTPUT_SCHEMA_SHA256,
    temperature: Q4_RECALL_HINT_C1B_TEMPERATURE,
    max_output_tokens: Q4_RECALL_HINT_C1B_MAX_OUTPUT_TOKENS_PER_REQUEST,
    deadline_ms: Q4_RECALL_HINT_C1B_DEADLINE_MS,
    max_response_bytes: Q4_RECALL_HINT_C1B_MAX_RESPONSE_BYTES,
    prompt: buildQ4RecallHintC1BPrompt(producerInput),
  });
}

export function parseQ4RecallHintC1BResponse(raw) {
  if (typeof raw !== "string") throw fail("Q4_C1B_RESPONSE_MUST_BE_STRING");
  if (Buffer.byteLength(raw, "utf8") > Q4_RECALL_HINT_C1B_MAX_RESPONSE_BYTES) {
    throw fail("Q4_C1B_RESPONSE_TOO_LARGE");
  }
  if (raw.includes("```")) throw fail("Q4_C1B_RESPONSE_MARKDOWN_FORBIDDEN");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw fail("Q4_C1B_RESPONSE_NOT_STRICT_JSON");
  }
  const validation = validateRecallHintV1(parsed);
  if (!validation.valid) {
    throw fail("Q4_C1B_RESPONSE_HINT_INVALID", { errors: validation.errors });
  }
  return validation.normalized;
}

export function buildQ4RecallHintC1BExecutionPacket({
  manifest,
  sourceCommit,
  provider,
  model,
  endpoint,
  revision = null,
  apiKeyEnv,
  billingCurrency,
  maxCost,
  inputPricePerMillion,
  outputPricePerMillion,
} = {}) {
  assertFrozenManifest(manifest);
  const selectedProvider = requireString(provider, "Q4_C1B_PROVIDER_REQUIRED");
  const selectedModel = requireString(model, "Q4_C1B_MODEL_REQUIRED");
  const selectedEndpoint = assertHttpsEndpoint(endpoint);
  const selectedSourceCommit = requireString(sourceCommit, "Q4_C1B_SOURCE_COMMIT_REQUIRED");
  const selectedApiKeyEnv = requireString(apiKeyEnv, "Q4_C1B_API_KEY_ENV_REQUIRED");
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(selectedApiKeyEnv)) throw fail("Q4_C1B_API_KEY_ENV_INVALID");
  if (revision !== null && (typeof revision !== "string" || revision.trim() === "")) {
    throw fail("Q4_C1B_REVISION_INVALID");
  }
  const selectedBillingCurrency = requireString(billingCurrency, "Q4_C1B_BILLING_CURRENCY_REQUIRED").toUpperCase();
  if (!/^[A-Z]{3,8}$/u.test(selectedBillingCurrency)) throw fail("Q4_C1B_BILLING_CURRENCY_INVALID");
  if (!Number.isFinite(maxCost) || maxCost <= 0) throw fail("Q4_C1B_COST_CAP_INVALID");
  for (const [field, value] of [
    ["input_price_per_million", inputPricePerMillion],
    ["output_price_per_million", outputPricePerMillion],
  ]) {
    if (!Number.isFinite(value) || value < 0) throw fail(`Q4_C1B_${field.toUpperCase()}_INVALID`);
  }

  return Object.freeze({
    schema: Q4_RECALL_HINT_C1B_EXECUTION_PACKET_SCHEMA,
    source_commit: selectedSourceCommit,
    manifest_sha256: manifest.manifest_sha256,
    corpus_sha256: manifest.corpus_identity.corpus_sha256,
    development_sha256: manifest.development_sha256,
    acceptance_sha256: manifest.acceptance_sha256,
    provider: selectedProvider,
    model: selectedModel,
    endpoint: selectedEndpoint,
    revision: revision === null ? null : revision.trim(),
    prompt_version: Q4_RECALL_HINT_C1B_PROMPT_VERSION,
    prompt_sha256: Q4_RECALL_HINT_C1B_PROMPT_SHA256,
    output_schema_sha256: Q4_RECALL_HINT_C1B_OUTPUT_SCHEMA_SHA256,
    egress: Object.freeze({
      query: "ALLOW",
      bounded_context: "ALLOW",
      memory_records: "DENY",
      gold_evidence_ids: "DENY",
      retrieval_results: "DENY",
      full_session: "DENY",
      tool_trace: "DENY",
      scope: Q4_RECALL_HINT_C1B_EGRESS_SCOPE,
    }),
    max_provider_requests: Q4_RECALL_HINT_C1B_MAX_PROVIDER_REQUESTS,
    max_development_requests: Q4_RECALL_HINT_C1B_MAX_DEVELOPMENT_REQUESTS,
    max_acceptance_requests: Q4_RECALL_HINT_C1B_MAX_ACCEPTANCE_REQUESTS,
    max_input_tokens_per_request: Q4_RECALL_HINT_C1B_MAX_INPUT_TOKENS_PER_REQUEST,
    max_output_tokens_per_request: Q4_RECALL_HINT_C1B_MAX_OUTPUT_TOKENS_PER_REQUEST,
    max_total_input_tokens: Q4_RECALL_HINT_C1B_MAX_TOTAL_INPUT_TOKENS,
    max_total_output_tokens: Q4_RECALL_HINT_C1B_MAX_TOTAL_OUTPUT_TOKENS,
    max_response_bytes: Q4_RECALL_HINT_C1B_MAX_RESPONSE_BYTES,
    deadline_ms: Q4_RECALL_HINT_C1B_DEADLINE_MS,
    temperature: Q4_RECALL_HINT_C1B_TEMPERATURE,
    billing_currency: selectedBillingCurrency,
    max_cost: maxCost,
    input_price_per_million: inputPricePerMillion,
    output_price_per_million: outputPricePerMillion,
    execution_count: 1,
    acceptance_replay_count: 0,
    api_key_env: selectedApiKeyEnv,
  });
}

export function validateQ4RecallHintC1BExecutionPacket({ packet, manifest, sourceCommit, worktreeClean } = {}) {
  if (!isRecord(packet) || packet.schema !== Q4_RECALL_HINT_C1B_EXECUTION_PACKET_SCHEMA) {
    throw fail("Q4_C1B_EXECUTION_PACKET_INVALID");
  }
  assertFrozenManifest(manifest);
  if (worktreeClean !== true) throw fail("Q4_C1B_WORKTREE_NOT_CLEAN");
  if (packet.source_commit !== requireString(sourceCommit, "Q4_C1B_SOURCE_COMMIT_REQUIRED")) {
    throw fail("Q4_C1B_SOURCE_COMMIT_MISMATCH");
  }
  for (const [field, expected] of [
    ["manifest_sha256", manifest.manifest_sha256],
    ["corpus_sha256", manifest.corpus_identity.corpus_sha256],
    ["development_sha256", manifest.development_sha256],
    ["acceptance_sha256", manifest.acceptance_sha256],
    ["prompt_sha256", Q4_RECALL_HINT_C1B_PROMPT_SHA256],
    ["output_schema_sha256", Q4_RECALL_HINT_C1B_OUTPUT_SCHEMA_SHA256],
    ["max_provider_requests", Q4_RECALL_HINT_C1B_MAX_PROVIDER_REQUESTS],
    ["max_development_requests", Q4_RECALL_HINT_C1B_MAX_DEVELOPMENT_REQUESTS],
    ["max_acceptance_requests", Q4_RECALL_HINT_C1B_MAX_ACCEPTANCE_REQUESTS],
    ["max_input_tokens_per_request", Q4_RECALL_HINT_C1B_MAX_INPUT_TOKENS_PER_REQUEST],
    ["max_output_tokens_per_request", Q4_RECALL_HINT_C1B_MAX_OUTPUT_TOKENS_PER_REQUEST],
    ["max_total_input_tokens", Q4_RECALL_HINT_C1B_MAX_TOTAL_INPUT_TOKENS],
    ["max_total_output_tokens", Q4_RECALL_HINT_C1B_MAX_TOTAL_OUTPUT_TOKENS],
    ["max_response_bytes", Q4_RECALL_HINT_C1B_MAX_RESPONSE_BYTES],
    ["deadline_ms", Q4_RECALL_HINT_C1B_DEADLINE_MS],
    ["temperature", Q4_RECALL_HINT_C1B_TEMPERATURE],
    ["execution_count", 1],
    ["acceptance_replay_count", 0],
  ]) {
    if (packet[field] !== expected) throw fail(`Q4_C1B_EXECUTION_PACKET_MISMATCH:${field}`);
  }
  requireString(packet.provider, "Q4_C1B_PROVIDER_REQUIRED");
  requireString(packet.model, "Q4_C1B_MODEL_REQUIRED");
  assertHttpsEndpoint(packet.endpoint);
  if (packet.revision !== null && (typeof packet.revision !== "string" || !packet.revision.trim())) {
    throw fail("Q4_C1B_REVISION_INVALID");
  }
  const billingCurrency = requireString(packet.billing_currency, "Q4_C1B_BILLING_CURRENCY_REQUIRED").toUpperCase();
  if (!/^[A-Z]{3,8}$/u.test(billingCurrency)) throw fail("Q4_C1B_BILLING_CURRENCY_INVALID");
  if (!Number.isFinite(packet.max_cost) || packet.max_cost <= 0) throw fail("Q4_C1B_COST_CAP_INVALID");
  if (!Number.isFinite(packet.input_price_per_million) || packet.input_price_per_million < 0
      || !Number.isFinite(packet.output_price_per_million) || packet.output_price_per_million < 0) {
    throw fail("Q4_C1B_PRICE_INVALID");
  }
  const egress = packet.egress;
  if (!isRecord(egress)
      || egress.query !== "ALLOW"
      || egress.bounded_context !== "ALLOW"
      || egress.memory_records !== "DENY"
      || egress.gold_evidence_ids !== "DENY"
      || egress.retrieval_results !== "DENY"
      || egress.full_session !== "DENY"
      || egress.tool_trace !== "DENY"
      || egress.scope !== Q4_RECALL_HINT_C1B_EGRESS_SCOPE) {
    throw fail("Q4_C1B_EGRESS_SCOPE_INVALID");
  }
  requireString(packet.api_key_env, "Q4_C1B_API_KEY_ENV_REQUIRED");
  return Object.freeze({ valid: true, provider: packet.provider, model: packet.model });
}

export function validateQ4RecallHintC1BUsage({
  providerRequests,
  developmentRequests,
  acceptanceRequests,
  totalInputTokens,
  totalOutputTokens,
  billingCurrency,
  cost,
  maxCost,
} = {}) {
  const values = {
    providerRequests: requireNonNegativeInteger(providerRequests, "Q4_C1B_USAGE_PROVIDER_REQUESTS_INVALID"),
    developmentRequests: requireNonNegativeInteger(developmentRequests, "Q4_C1B_USAGE_DEVELOPMENT_REQUESTS_INVALID"),
    acceptanceRequests: requireNonNegativeInteger(acceptanceRequests, "Q4_C1B_USAGE_ACCEPTANCE_REQUESTS_INVALID"),
    totalInputTokens: requireNonNegativeInteger(totalInputTokens, "Q4_C1B_USAGE_INPUT_TOKENS_INVALID"),
    totalOutputTokens: requireNonNegativeInteger(totalOutputTokens, "Q4_C1B_USAGE_OUTPUT_TOKENS_INVALID"),
  };
  const selectedBillingCurrency = requireString(billingCurrency, "Q4_C1B_USAGE_BILLING_CURRENCY_REQUIRED").toUpperCase();
  if (!/^[A-Z]{3,8}$/u.test(selectedBillingCurrency)) throw fail("Q4_C1B_USAGE_BILLING_CURRENCY_INVALID");
  if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(maxCost) || maxCost <= 0) {
    throw fail("Q4_C1B_USAGE_COST_INVALID");
  }
  if (values.providerRequests > Q4_RECALL_HINT_C1B_MAX_PROVIDER_REQUESTS
      || values.developmentRequests > Q4_RECALL_HINT_C1B_MAX_DEVELOPMENT_REQUESTS
      || values.acceptanceRequests > Q4_RECALL_HINT_C1B_MAX_ACCEPTANCE_REQUESTS
      || values.developmentRequests + values.acceptanceRequests !== values.providerRequests
      || values.totalInputTokens > Q4_RECALL_HINT_C1B_MAX_TOTAL_INPUT_TOKENS
      || values.totalOutputTokens > Q4_RECALL_HINT_C1B_MAX_TOTAL_OUTPUT_TOKENS
      || cost > maxCost) {
    throw fail("Q4_C1B_USAGE_BUDGET_EXCEEDED");
  }
  return Object.freeze({ ...values, billingCurrency: selectedBillingCurrency, cost, maxCost });
}

export function q4RecallHintC1BContractIdentity() {
  return Object.freeze({
    schema: Q4_RECALL_HINT_C1B_PROVIDER_CONTRACT_SCHEMA,
    prompt_version: Q4_RECALL_HINT_C1B_PROMPT_VERSION,
    prompt_sha256: Q4_RECALL_HINT_C1B_PROMPT_SHA256,
    output_schema_sha256: Q4_RECALL_HINT_C1B_OUTPUT_SCHEMA_SHA256,
    manifest_sha256: Q4_RECALL_HINT_C1_FROZEN_IDENTITY.manifest_sha256,
  });
}
