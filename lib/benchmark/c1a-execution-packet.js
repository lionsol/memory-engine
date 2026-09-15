import {
  QWEN3_UTF8_BYTE_TOKEN_UPPER_BOUND_ID,
  SILICONFLOW_RERANK_ENDPOINT,
  SILICONFLOW_RERANK_LIMITS,
  SILICONFLOW_RERANK_QUALIFICATION_MODELS,
  SILICONFLOW_RERANK_PROVIDER,
} from "../recall/rerank/siliconflow-rerank-adapter.js";
import { C1A_MANIFEST_SCHEMA } from "./c1a-qualification-manifest.js";
import {
  C1A_ADAPTER_DEADLINE_MS,
  C1A_MAX_INPUT_TOKENS,
  C1A_MAX_PROVIDER_REQUESTS,
} from "./c1a-qualification-runner.js";
import { C1A_ACCEPTANCE_THRESHOLDS } from "./c1a-qualification-scorer.js";

export const C1A_EXECUTION_PACKET_SCHEMA = "memory_engine_r3_c1a_execution_packet_v1";
export const C1A_EGRESS_SCOPE = "frozen_qualification_corpus_only";

function fail(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function requireRecord(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail(code);
  return value;
}

function requireString(value, code) {
  if (typeof value !== "string" || value.trim().length === 0) throw fail(code);
  return value.trim();
}

export function validateC1AExecutionPacket({
  packet,
  manifest,
  sourceCommit,
  worktreeClean,
  executionRoot = null,
} = {}) {
  requireRecord(packet, "C1A_EXECUTION_PACKET_REQUIRED");
  requireRecord(manifest, "C1A_EXECUTION_MANIFEST_REQUIRED");
  if (packet.schema !== C1A_EXECUTION_PACKET_SCHEMA) throw fail("C1A_EXECUTION_PACKET_SCHEMA_INVALID");
  if (manifest.schema !== C1A_MANIFEST_SCHEMA) throw fail("C1A_EXECUTION_MANIFEST_SCHEMA_INVALID");
  if (worktreeClean !== true) throw fail("C1A_EXECUTION_SOURCE_WORKTREE_NOT_CLEAN");
  const normalizedSourceCommit = requireString(sourceCommit, "C1A_EXECUTION_SOURCE_COMMIT_REQUIRED");
  if (packet.source_commit !== normalizedSourceCommit) throw fail("C1A_EXECUTION_SOURCE_COMMIT_MISMATCH");
  if (packet.manifest_sha256 !== manifest.manifest_sha256) throw fail("C1A_EXECUTION_MANIFEST_MISMATCH");

  const manifestSource = requireRecord(
    manifest.source_identity?.qualification_source,
    "C1A_EXECUTION_MANIFEST_SOURCE_IDENTITY_REQUIRED",
  );
  if (manifestSource.source_commit !== normalizedSourceCommit || manifestSource.worktree_clean !== true) {
    throw fail("C1A_EXECUTION_MANIFEST_SOURCE_IDENTITY_MISMATCH");
  }
  if (manifest.source_identity?.egress_decision !== "ALLOW") {
    throw fail("C1A_EXECUTION_MANIFEST_EGRESS_NOT_ALLOWED");
  }
  const manifestProvider = requireRecord(manifest.profile?.provider, "C1A_EXECUTION_MANIFEST_PROVIDER_REQUIRED");
  if (manifestProvider.provider !== SILICONFLOW_RERANK_PROVIDER
      || !SILICONFLOW_RERANK_QUALIFICATION_MODELS.includes(manifestProvider.model)
      || manifestProvider.endpoint !== SILICONFLOW_RERANK_ENDPOINT
      || manifestProvider.revision !== null) {
    throw fail("C1A_EXECUTION_MANIFEST_PROVIDER_MISMATCH");
  }
  const tokenPreflight = requireRecord(
    manifest.profile?.token_preflight,
    "C1A_EXECUTION_MANIFEST_TOKEN_PREFLIGHT_REQUIRED",
  );
  if (tokenPreflight.counter_id !== QWEN3_UTF8_BYTE_TOKEN_UPPER_BOUND_ID
      || tokenPreflight.maxQueryTokens !== SILICONFLOW_RERANK_LIMITS.maxQueryTokens
      || tokenPreflight.maxDocumentTokens !== SILICONFLOW_RERANK_LIMITS.maxDocumentTokens
      || tokenPreflight.maxPairTokens !== SILICONFLOW_RERANK_LIMITS.maxPairTokens
      || tokenPreflight.specialTokenReservePerPair !== SILICONFLOW_RERANK_LIMITS.specialTokenReservePerPair) {
    throw fail("C1A_EXECUTION_MANIFEST_TOKEN_PREFLIGHT_MISMATCH");
  }
  if (JSON.stringify(manifest.profile?.acceptance_thresholds) !== JSON.stringify(C1A_ACCEPTANCE_THRESHOLDS)) {
    throw fail("C1A_EXECUTION_MANIFEST_THRESHOLDS_MISMATCH");
  }

  if (packet.provider !== SILICONFLOW_RERANK_PROVIDER
      || packet.model !== manifestProvider.model
      || packet.endpoint !== SILICONFLOW_RERANK_ENDPOINT) {
    throw fail("C1A_EXECUTION_PROVIDER_BINDING_MISMATCH");
  }

  const egress = requireRecord(packet.egress, "C1A_EXECUTION_EGRESS_REQUIRED");
  if (egress.query !== "ALLOW" || egress.canonical_text !== "ALLOW" || egress.scope !== C1A_EGRESS_SCOPE) {
    throw fail("C1A_EXECUTION_EGRESS_NOT_EXPLICITLY_ALLOWED");
  }

  if (packet.max_provider_requests !== C1A_MAX_PROVIDER_REQUESTS) {
    throw fail("C1A_EXECUTION_REQUEST_CAP_MISMATCH");
  }
  if (packet.max_input_tokens !== C1A_MAX_INPUT_TOKENS) {
    throw fail("C1A_EXECUTION_TOKEN_CAP_MISMATCH");
  }
  if (packet.deadline_ms !== C1A_ADAPTER_DEADLINE_MS) {
    throw fail("C1A_EXECUTION_DEADLINE_MISMATCH");
  }
  if (packet.execution_count !== 1) throw fail("C1A_EXECUTION_COUNT_MUST_BE_ONE");
  if (!Number.isFinite(packet.max_cost_usd) || packet.max_cost_usd <= 0) {
    throw fail("C1A_EXECUTION_COST_CAP_INVALID");
  }
  if (!Number.isFinite(packet.input_price_usd_per_million) || packet.input_price_usd_per_million < 0) {
    throw fail("C1A_EXECUTION_PRICE_INVALID");
  }

  const pacing = requireRecord(packet.pacing, "C1A_EXECUTION_PACING_REQUIRED");
  if (!Number.isSafeInteger(pacing.min_interval_ms) || pacing.min_interval_ms < 0
      || !Number.isSafeInteger(pacing.token_window_ms) || pacing.token_window_ms <= 0
      || !Number.isSafeInteger(pacing.max_estimated_tokens_per_window)
      || pacing.max_estimated_tokens_per_window <= 0) {
    throw fail("C1A_EXECUTION_PACING_INVALID");
  }
  const rateLimits = requireRecord(packet.rate_limits, "C1A_EXECUTION_RATE_LIMITS_REQUIRED");
  if (rateLimits.confirmed !== true || typeof rateLimits.source !== "string" || !rateLimits.source.trim()) {
    throw fail("C1A_EXECUTION_RATE_LIMITS_UNCONFIRMED");
  }

  const apiKeyEnv = requireString(packet.api_key_env, "C1A_EXECUTION_API_KEY_ENV_REQUIRED");
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(apiKeyEnv)) throw fail("C1A_EXECUTION_API_KEY_ENV_INVALID");
  const packetExecutionRoot = requireString(packet.execution_root, "C1A_EXECUTION_ROOT_REQUIRED");
  if (executionRoot !== null && packetExecutionRoot !== executionRoot) {
    throw fail("C1A_EXECUTION_ROOT_MISMATCH");
  }

  return Object.freeze({
    schema: packet.schema,
    source_commit: normalizedSourceCommit,
    manifest_sha256: manifest.manifest_sha256,
    provider: packet.provider,
    model: packet.model,
    endpoint: packet.endpoint,
    egress: Object.freeze({ ...egress }),
    max_provider_requests: packet.max_provider_requests,
    max_input_tokens: packet.max_input_tokens,
    max_cost_usd: packet.max_cost_usd,
    input_price_usd_per_million: packet.input_price_usd_per_million,
    deadline_ms: packet.deadline_ms,
    execution_count: 1,
    pacing: Object.freeze({
      min_interval_ms: pacing.min_interval_ms,
      token_window_ms: pacing.token_window_ms,
      max_estimated_tokens_per_window: pacing.max_estimated_tokens_per_window,
    }),
    rate_limits: Object.freeze({ confirmed: true, source: rateLimits.source.trim() }),
    api_key_env: apiKeyEnv,
    execution_root: packetExecutionRoot,
  });
}
