import { createHash } from "node:crypto";

import { buildRecallHintVectorQueryPlan } from "../recall/hint/recall-hint-query-plan.js";
import {
  buildQ4RecallHintC1ManifestV1,
  buildQ4RecallHintC1ProducerInputV1,
  validateQ4RecallHintC1CorpusV1,
} from "./q4-recall-hint-c1-manifest-v1.js";
import {
  Q4_RECALL_HINT_C1B_MAX_INPUT_TOKENS_PER_REQUEST,
  Q4_RECALL_HINT_C1B_MAX_OUTPUT_TOKENS_PER_REQUEST,
  validateQ4RecallHintC1BExecutionPacket,
} from "./q4-recall-hint-c1b-provider-contract-v1.js";
import { executeQ4RecallHintC1BProducerV1 } from "./q4-recall-hint-c1b-producer-v1.js";
import {
  Q4_C1B_SF_BILLING_CURRENCY,
  Q4_C1B_SF_ENDPOINT,
  Q4_C1B_SF_MODEL,
  Q4_C1B_SF_PROVIDER,
} from "./q4-recall-hint-c1b-siliconflow-v4flash-v1.js";

export const Q4_C1B_DEVELOPMENT_EXECUTION_SCHEMA = "memory_engine_q4_recall_hint_c1b_development_execution_v1";
export const Q4_C1B_DEVELOPMENT_PROGRESS_SCHEMA = "memory_engine_q4_recall_hint_c1b_development_progress_v1";
export const Q4_C1B_DEVELOPMENT_MAX_REQUESTS = 16;
export const Q4_C1B_DEVELOPMENT_MAX_INPUT_TOKENS = 32_768;
export const Q4_C1B_DEVELOPMENT_MAX_OUTPUT_TOKENS = 4_096;
export const Q4_C1B_DEVELOPMENT_MAX_COST = 0.15;
export const Q4_C1B_DEVELOPMENT_ACCEPTANCE_REQUESTS = 0;

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonNegativeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw fail(code);
  return value;
}

function caseMap(corpus) {
  return new Map(corpus.cases.map(row => [row.case_id, row]));
}

function expectedDevelopmentIds(manifest) {
  if (!Array.isArray(manifest?.development) || manifest.development.length !== Q4_C1B_DEVELOPMENT_MAX_REQUESTS) {
    throw fail("Q4_C1B_DEV_MANIFEST_DEVELOPMENT_INVALID");
  }
  const ids = manifest.development.map(row => row?.case_id);
  if (ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) {
    throw fail("Q4_C1B_DEV_MANIFEST_DEVELOPMENT_IDS_INVALID");
  }
  return ids;
}

export function buildQ4RecallHintC1BDevelopmentAuthorizationV1({ packet, manifest, sourceCommit } = {}) {
  validateQ4RecallHintC1BExecutionPacket({
    packet,
    manifest,
    sourceCommit,
    worktreeClean: true,
  });
  if (packet.provider !== Q4_C1B_SF_PROVIDER
      || packet.model !== Q4_C1B_SF_MODEL
      || packet.endpoint !== Q4_C1B_SF_ENDPOINT
      || packet.billing_currency !== Q4_C1B_SF_BILLING_CURRENCY) {
    throw fail("Q4_C1B_DEV_PROVIDER_BINDING_MISMATCH");
  }
  const developmentIds = expectedDevelopmentIds(manifest);
  const body = {
    schema: Q4_C1B_DEVELOPMENT_EXECUTION_SCHEMA,
    source_commit: sourceCommit,
    manifest_sha256: manifest.manifest_sha256,
    development_sha256: manifest.development_sha256,
    provider: packet.provider,
    model: packet.model,
    endpoint: packet.endpoint,
    prompt_sha256: packet.prompt_sha256,
    output_schema_sha256: packet.output_schema_sha256,
    billing_currency: packet.billing_currency,
    max_provider_requests: Q4_C1B_DEVELOPMENT_MAX_REQUESTS,
    max_acceptance_requests: Q4_C1B_DEVELOPMENT_ACCEPTANCE_REQUESTS,
    max_input_tokens: Q4_C1B_DEVELOPMENT_MAX_INPUT_TOKENS,
    max_output_tokens: Q4_C1B_DEVELOPMENT_MAX_OUTPUT_TOKENS,
    max_cost: Q4_C1B_DEVELOPMENT_MAX_COST,
    deadline_ms: packet.deadline_ms,
    max_output_tokens_per_request: packet.max_output_tokens_per_request,
    temperature: packet.temperature,
    acceptance_authorized: false,
    development_case_ids: developmentIds,
  };
  return Object.freeze({
    ...body,
    development_case_ids: Object.freeze([...developmentIds]),
    authorization_sha256: sha256(JSON.stringify(body)),
  });
}

export function validateQ4RecallHintC1BDevelopmentUsageV1({
  providerRequests,
  inputTokens,
  outputTokens,
  cost,
  billingCurrency,
} = {}) {
  const requests = nonNegativeInteger(providerRequests, "Q4_C1B_DEV_REQUEST_COUNT_INVALID");
  const inputs = nonNegativeInteger(inputTokens, "Q4_C1B_DEV_INPUT_TOKENS_INVALID");
  const outputs = nonNegativeInteger(outputTokens, "Q4_C1B_DEV_OUTPUT_TOKENS_INVALID");
  if (!Number.isFinite(cost) || cost < 0) throw fail("Q4_C1B_DEV_COST_INVALID");
  if (billingCurrency !== Q4_C1B_SF_BILLING_CURRENCY) throw fail("Q4_C1B_DEV_CURRENCY_MISMATCH");
  if (requests > Q4_C1B_DEVELOPMENT_MAX_REQUESTS
      || inputs > Q4_C1B_DEVELOPMENT_MAX_INPUT_TOKENS
      || outputs > Q4_C1B_DEVELOPMENT_MAX_OUTPUT_TOKENS
      || cost > Q4_C1B_DEVELOPMENT_MAX_COST + 1e-12) {
    throw fail("Q4_C1B_DEV_BUDGET_EXCEEDED");
  }
  return Object.freeze({
    provider_requests: requests,
    input_tokens: inputs,
    output_tokens: outputs,
    cost,
    billing_currency: billingCurrency,
  });
}

function normalizeExistingProgress(existingProgress, authorization) {
  if (existingProgress === null || existingProgress === undefined) {
    return {
      schema: Q4_C1B_DEVELOPMENT_PROGRESS_SCHEMA,
      authorization_sha256: authorization.authorization_sha256,
      source_commit: authorization.source_commit,
      manifest_sha256: authorization.manifest_sha256,
      development_sha256: authorization.development_sha256,
      provider: authorization.provider,
      model: authorization.model,
      endpoint: authorization.endpoint,
      prompt_sha256: authorization.prompt_sha256,
      output_schema_sha256: authorization.output_schema_sha256,
      completed: [],
      inflight_case_id: null,
      usage: {
        provider_requests: 0,
        input_tokens: 0,
        output_tokens: 0,
        cost: 0,
        billing_currency: authorization.billing_currency,
      },
      status: "IN_PROGRESS",
    };
  }
  if (!isRecord(existingProgress) || existingProgress.schema !== Q4_C1B_DEVELOPMENT_PROGRESS_SCHEMA) {
    throw fail("Q4_C1B_DEV_PROGRESS_INVALID");
  }
  for (const field of [
    "authorization_sha256",
    "source_commit",
    "manifest_sha256",
    "development_sha256",
    "provider",
    "model",
    "endpoint",
    "prompt_sha256",
    "output_schema_sha256",
  ]) {
    if (existingProgress[field] !== authorization[field]) throw fail(`Q4_C1B_DEV_PROGRESS_MISMATCH:${field}`);
  }
  if (existingProgress.inflight_case_id !== null && existingProgress.inflight_case_id !== undefined) {
    throw fail("Q4_C1B_DEV_PROGRESS_INFLIGHT_AMBIGUOUS", {
      caseId: existingProgress.inflight_case_id,
    });
  }
  if (!Array.isArray(existingProgress.completed)) throw fail("Q4_C1B_DEV_PROGRESS_COMPLETED_INVALID");
  const ids = existingProgress.completed.map(row => row?.case_id);
  if (ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) {
    throw fail("Q4_C1B_DEV_PROGRESS_DUPLICATE_CASE");
  }
  if (ids.some(id => !authorization.development_case_ids.includes(id))) {
    throw fail("Q4_C1B_DEV_PROGRESS_CASE_OUT_OF_SCOPE");
  }
  validateQ4RecallHintC1BDevelopmentUsageV1({
    providerRequests: existingProgress.usage?.provider_requests,
    inputTokens: existingProgress.usage?.input_tokens,
    outputTokens: existingProgress.usage?.output_tokens,
    cost: existingProgress.usage?.cost,
    billingCurrency: existingProgress.usage?.billing_currency,
  });
  return structuredClone(existingProgress);
}

function summarizeCompleted(completed) {
  const fieldCounts = { project: 0, entities: 0, time_relation: 0, query_facets: 0 };
  let emptyHintCount = 0;
  let expansionCount = 0;
  let noExpansionCount = 0;
  const family = {};
  for (const row of completed) {
    const hint = row.hint;
    const keys = Object.keys(hint).filter(key => key !== "version");
    if (keys.length === 0) emptyHintCount += 1;
    for (const key of Object.keys(fieldCounts)) if (Object.hasOwn(hint, key)) fieldCounts[key] += 1;
    const planQueries = row.query_plan?.queries?.length || 0;
    expansionCount += planQueries;
    if (planQueries === 0) noExpansionCount += 1;
    const stats = family[row.family] || { cases: 0, empty_hints: 0, expansions: 0 };
    stats.cases += 1;
    stats.empty_hints += Number(keys.length === 0);
    stats.expansions += planQueries;
    family[row.family] = stats;
  }
  return {
    case_count: completed.length,
    valid_hint_count: completed.length,
    empty_hint_count: emptyHintCount,
    no_expansion_count: noExpansionCount,
    expansion_query_count: expansionCount,
    field_counts: fieldCounts,
    family,
  };
}

export async function runQ4RecallHintC1BDevelopmentV1({
  corpus,
  manifest = null,
  packet,
  sourceCommit,
  transport,
  existingProgress = null,
  onProgress = null,
} = {}) {
  const normalizedCorpus = validateQ4RecallHintC1CorpusV1(corpus);
  const selectedManifest = manifest || buildQ4RecallHintC1ManifestV1(normalizedCorpus);
  const authorization = buildQ4RecallHintC1BDevelopmentAuthorizationV1({
    packet,
    manifest: selectedManifest,
    sourceCommit,
  });
  if (typeof transport !== "function") throw fail("Q4_C1B_DEV_TRANSPORT_REQUIRED");
  if (onProgress !== null && typeof onProgress !== "function") throw fail("Q4_C1B_DEV_ON_PROGRESS_INVALID");

  const progress = normalizeExistingProgress(existingProgress, authorization);
  const completedIds = new Set(progress.completed.map(row => row.case_id));
  const rowsById = caseMap(normalizedCorpus);

  for (const caseId of authorization.development_case_ids) {
    if (completedIds.has(caseId)) continue;
    const row = rowsById.get(caseId);
    if (!row) throw fail("Q4_C1B_DEV_CASE_MISSING", { caseId });

    // Fail closed before issuing another request if one maximum-size request
    // could breach any authorized development budget.
    const worstCaseNextCost = (
      Q4_RECALL_HINT_C1B_MAX_INPUT_TOKENS_PER_REQUEST * packet.input_price_per_million
      + Q4_RECALL_HINT_C1B_MAX_OUTPUT_TOKENS_PER_REQUEST * packet.output_price_per_million
    ) / 1_000_000;
    validateQ4RecallHintC1BDevelopmentUsageV1({
      providerRequests: progress.usage.provider_requests + 1,
      inputTokens: progress.usage.input_tokens + Q4_RECALL_HINT_C1B_MAX_INPUT_TOKENS_PER_REQUEST,
      outputTokens: progress.usage.output_tokens + Q4_RECALL_HINT_C1B_MAX_OUTPUT_TOKENS_PER_REQUEST,
      cost: progress.usage.cost + worstCaseNextCost,
      billingCurrency: progress.usage.billing_currency,
    });

    // Persist the intended case before network egress. A crash after this
    // checkpoint is deliberately ambiguous and must not auto-reissue.
    progress.inflight_case_id = caseId;
    if (onProgress) await onProgress(structuredClone(progress));

    const producerInput = buildQ4RecallHintC1ProducerInputV1(row);
    const result = await executeQ4RecallHintC1BProducerV1({ producerInput, packet, transport });
    const queryPlan = buildRecallHintVectorQueryPlan(row.query, result.hint);

    const nextUsage = validateQ4RecallHintC1BDevelopmentUsageV1({
      providerRequests: progress.usage.provider_requests + 1,
      inputTokens: progress.usage.input_tokens + result.usage.input_tokens,
      outputTokens: progress.usage.output_tokens + result.usage.output_tokens,
      cost: progress.usage.cost + result.usage.cost,
      billingCurrency: result.usage.billing_currency,
    });

    progress.completed.push({
      case_id: row.case_id,
      family: row.family,
      hint: result.hint,
      query_plan: queryPlan,
      latency_ms: result.latency_ms,
      usage: result.usage,
    });
    progress.inflight_case_id = null;
    progress.usage = {
      provider_requests: nextUsage.provider_requests,
      input_tokens: nextUsage.input_tokens,
      output_tokens: nextUsage.output_tokens,
      cost: nextUsage.cost,
      billing_currency: nextUsage.billing_currency,
    };
    completedIds.add(caseId);
    if (onProgress) await onProgress(structuredClone(progress));
  }

  if (progress.completed.length !== Q4_C1B_DEVELOPMENT_MAX_REQUESTS) {
    throw fail("Q4_C1B_DEV_INCOMPLETE");
  }
  progress.status = "PASS";
  progress.summary = summarizeCompleted(progress.completed);
  progress.result_sha256 = sha256(JSON.stringify({
    authorization_sha256: authorization.authorization_sha256,
    completed: progress.completed,
    usage: progress.usage,
    summary: progress.summary,
  }));
  if (onProgress) await onProgress(structuredClone(progress));
  return Object.freeze({
    authorization,
    progress: Object.freeze(progress),
  });
}
