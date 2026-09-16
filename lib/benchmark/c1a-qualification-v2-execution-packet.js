import { createHash } from "node:crypto";

import {
  QWEN3_UTF8_BYTE_TOKEN_UPPER_BOUND_ID,
  SILICONFLOW_RERANK_ENDPOINT,
  SILICONFLOW_RERANK_LIMITS,
  SILICONFLOW_RERANK_MODEL_0_6B,
  SILICONFLOW_RERANK_PROVIDER,
} from "../recall/rerank/siliconflow-rerank-adapter.js";
import {
  C1A_V2_ACCEPTANCE_THRESHOLDS,
  C1A_V2_MANIFEST_SCHEMA,
} from "./c1a-qualification-v2-contract.js";
import {
  C1A_ADAPTER_DEADLINE_MS,
  C1A_MAX_INPUT_TOKENS,
} from "./c1a-qualification-runner.js";

export const C1A_V2_EXECUTION_PACKET_SCHEMA = "memory_engine_r3_c1a_execution_packet_v2";
export const C1A_V2_EGRESS_SCOPE = "frozen_disjoint_holdout_corpus_only";
export const C1A_V2_MAX_PROVIDER_REQUESTS = 336;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

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

export function validateC1AV2ExecutionPacket({
  packet,
  manifest,
  sourceCommit,
  worktreeClean,
  executionRoot = null,
} = {}) {
  requireRecord(packet, "C1A_V2_EXECUTION_PACKET_REQUIRED");
  requireRecord(manifest, "C1A_V2_EXECUTION_MANIFEST_REQUIRED");
  if (packet.schema !== C1A_V2_EXECUTION_PACKET_SCHEMA) throw fail("C1A_V2_EXECUTION_PACKET_SCHEMA_INVALID");
  if (manifest.schema !== C1A_V2_MANIFEST_SCHEMA) throw fail("C1A_V2_EXECUTION_MANIFEST_SCHEMA_INVALID");
  if (worktreeClean !== true) throw fail("C1A_V2_EXECUTION_SOURCE_WORKTREE_NOT_CLEAN");

  const { manifest_sha256: declaredManifestHash, ...manifestBody } = manifest;
  if (typeof declaredManifestHash !== "string" || declaredManifestHash.length !== 64
      || sha256(JSON.stringify(manifestBody)) !== declaredManifestHash) {
    throw fail("C1A_V2_EXECUTION_MANIFEST_HASH_MISMATCH");
  }
  if (!Array.isArray(manifest.primary) || manifest.primary.length !== 256) {
    throw fail("C1A_V2_EXECUTION_PRIMARY_COUNT_INVALID");
  }
  const diagnosticRows = Object.values(requireRecord(
    manifest.diagnostics,
    "C1A_V2_EXECUTION_DIAGNOSTICS_REQUIRED",
  )).flat();
  if (diagnosticRows.length !== 64) throw fail("C1A_V2_EXECUTION_DIAGNOSTIC_COUNT_INVALID");
  if (!Array.isArray(manifest.sentinels) || manifest.sentinels.length !== 16) {
    throw fail("C1A_V2_EXECUTION_SENTINEL_COUNT_INVALID");
  }
  const primaryIds = new Set(manifest.primary.map(row => row?.case_id));
  const diagnosticIds = new Set(diagnosticRows.map(row => row?.case_id));
  if (primaryIds.has(undefined) || primaryIds.size !== 256
      || diagnosticIds.has(undefined) || diagnosticIds.size !== 64
      || [...diagnosticIds].some(id => primaryIds.has(id))) {
    throw fail("C1A_V2_EXECUTION_MAIN_POPULATION_INVALID");
  }
  if (manifest.sentinels.some(row => !primaryIds.has(row?.case_id))) {
    throw fail("C1A_V2_EXECUTION_SENTINEL_NOT_PRIMARY");
  }
  if (manifest.population?.primary_count !== 256
      || manifest.population?.diagnostic_count !== 64
      || manifest.population?.sentinel_count !== 16) {
    throw fail("C1A_V2_EXECUTION_POPULATION_METADATA_INVALID");
  }

  const normalizedSourceCommit = requireString(sourceCommit, "C1A_V2_EXECUTION_SOURCE_COMMIT_REQUIRED");
  if (packet.source_commit !== normalizedSourceCommit) throw fail("C1A_V2_EXECUTION_SOURCE_COMMIT_MISMATCH");
  if (packet.manifest_sha256 !== manifest.manifest_sha256) throw fail("C1A_V2_EXECUTION_MANIFEST_MISMATCH");
  if (packet.prior_observed_manifest_sha256 !== manifest.prior_observed_manifest_sha256) {
    throw fail("C1A_V2_EXECUTION_PRIOR_MANIFEST_MISMATCH");
  }

  const manifestSource = requireRecord(
    manifest.source_identity?.qualification_source,
    "C1A_V2_EXECUTION_MANIFEST_SOURCE_IDENTITY_REQUIRED",
  );
  if (manifestSource.source_commit !== normalizedSourceCommit || manifestSource.worktree_clean !== true) {
    throw fail("C1A_V2_EXECUTION_MANIFEST_SOURCE_IDENTITY_MISMATCH");
  }
  if (manifest.source_identity?.egress_decision !== "ALLOW") {
    throw fail("C1A_V2_EXECUTION_MANIFEST_EGRESS_NOT_ALLOWED");
  }

  const provider = requireRecord(manifest.profile?.provider, "C1A_V2_EXECUTION_MANIFEST_PROVIDER_REQUIRED");
  if (provider.provider !== SILICONFLOW_RERANK_PROVIDER
      || provider.model !== SILICONFLOW_RERANK_MODEL_0_6B
      || provider.endpoint !== SILICONFLOW_RERANK_ENDPOINT
      || provider.revision !== null) {
    throw fail("C1A_V2_EXECUTION_MANIFEST_PROVIDER_MISMATCH");
  }

  const tokenPreflight = requireRecord(
    manifest.profile?.token_preflight,
    "C1A_V2_EXECUTION_MANIFEST_TOKEN_PREFLIGHT_REQUIRED",
  );
  if (tokenPreflight.counter_id !== QWEN3_UTF8_BYTE_TOKEN_UPPER_BOUND_ID
      || tokenPreflight.maxQueryTokens !== SILICONFLOW_RERANK_LIMITS.maxQueryTokens
      || tokenPreflight.maxDocumentTokens !== SILICONFLOW_RERANK_LIMITS.maxDocumentTokens
      || tokenPreflight.maxPairTokens !== SILICONFLOW_RERANK_LIMITS.maxPairTokens
      || tokenPreflight.specialTokenReservePerPair !== SILICONFLOW_RERANK_LIMITS.specialTokenReservePerPair) {
    throw fail("C1A_V2_EXECUTION_MANIFEST_TOKEN_PREFLIGHT_MISMATCH");
  }
  if (JSON.stringify(manifest.profile?.acceptance_thresholds) !== JSON.stringify(C1A_V2_ACCEPTANCE_THRESHOLDS)) {
    throw fail("C1A_V2_EXECUTION_MANIFEST_THRESHOLDS_MISMATCH");
  }

  if (packet.provider !== SILICONFLOW_RERANK_PROVIDER
      || packet.model !== SILICONFLOW_RERANK_MODEL_0_6B
      || packet.endpoint !== SILICONFLOW_RERANK_ENDPOINT) {
    throw fail("C1A_V2_EXECUTION_PROVIDER_BINDING_MISMATCH");
  }

  const egress = requireRecord(packet.egress, "C1A_V2_EXECUTION_EGRESS_REQUIRED");
  if (egress.query !== "ALLOW"
      || egress.canonical_text !== "ALLOW"
      || egress.scope !== C1A_V2_EGRESS_SCOPE) {
    throw fail("C1A_V2_EXECUTION_EGRESS_NOT_EXPLICITLY_ALLOWED");
  }

  if (packet.max_provider_requests !== C1A_V2_MAX_PROVIDER_REQUESTS) {
    throw fail("C1A_V2_EXECUTION_REQUEST_CAP_MISMATCH");
  }
  if (packet.max_input_tokens !== C1A_MAX_INPUT_TOKENS) {
    throw fail("C1A_V2_EXECUTION_TOKEN_CAP_MISMATCH");
  }
  if (packet.deadline_ms !== C1A_ADAPTER_DEADLINE_MS) {
    throw fail("C1A_V2_EXECUTION_DEADLINE_MISMATCH");
  }
  if (packet.execution_count !== 1) throw fail("C1A_V2_EXECUTION_COUNT_MUST_BE_ONE");
  if (!Number.isFinite(packet.max_cost_usd) || packet.max_cost_usd <= 0) {
    throw fail("C1A_V2_EXECUTION_COST_CAP_INVALID");
  }
  if (!Number.isFinite(packet.input_price_usd_per_million) || packet.input_price_usd_per_million < 0) {
    throw fail("C1A_V2_EXECUTION_PRICE_INVALID");
  }

  const pacing = requireRecord(packet.pacing, "C1A_V2_EXECUTION_PACING_REQUIRED");
  if (!Number.isSafeInteger(pacing.min_interval_ms) || pacing.min_interval_ms < 0
      || !Number.isSafeInteger(pacing.token_window_ms) || pacing.token_window_ms <= 0
      || !Number.isSafeInteger(pacing.max_estimated_tokens_per_window)
      || pacing.max_estimated_tokens_per_window <= 0) {
    throw fail("C1A_V2_EXECUTION_PACING_INVALID");
  }

  const rateLimits = requireRecord(packet.rate_limits, "C1A_V2_EXECUTION_RATE_LIMITS_REQUIRED");
  if (rateLimits.confirmed !== true || typeof rateLimits.source !== "string" || !rateLimits.source.trim()) {
    throw fail("C1A_V2_EXECUTION_RATE_LIMITS_UNCONFIRMED");
  }

  const apiKeyEnv = requireString(packet.api_key_env, "C1A_V2_EXECUTION_API_KEY_ENV_REQUIRED");
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(apiKeyEnv)) throw fail("C1A_V2_EXECUTION_API_KEY_ENV_INVALID");
  const packetExecutionRoot = requireString(packet.execution_root, "C1A_V2_EXECUTION_ROOT_REQUIRED");
  if (executionRoot !== null && packetExecutionRoot !== executionRoot) {
    throw fail("C1A_V2_EXECUTION_ROOT_MISMATCH");
  }

  return Object.freeze({
    schema: packet.schema,
    source_commit: normalizedSourceCommit,
    manifest_sha256: manifest.manifest_sha256,
    prior_observed_manifest_sha256: manifest.prior_observed_manifest_sha256,
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
