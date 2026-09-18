import { readFileSync } from "node:fs";

import { rerankCanonicalMemories } from "../recall/rerank/canonical-rerank-orchestrator.js";
import { createSiliconFlowRerankAdapter } from "../recall/rerank/siliconflow-rerank-adapter.js";
import { R3_C1_B_PROVIDER_PROFILE } from "../recall/hybrid/explicit-search-rerank-provider-policy.js";
import {
  buildQ5SelectionSignalCaptureCaseV1,
  buildQ5SelectionSignalPacketV1,
} from "./q5-selection-signal-contract-v1.js";

export const Q5_FIXED_POOL_SCORE_CAPTURE_SCHEMA =
  "memory_engine_q5_fixed_pool_rerank_score_capture_v1";
export const Q5_FIXED_POOL_SCORE_CAPTURE_API_KEY_ENV = "SILICONFLOW_API_KEY";
export const Q5_FIXED_POOL_SCORE_CAPTURE_EXPECTED_FIXTURE_SHA256 =
  "077b02f16c7bd463eb5f5120930473f653bf5ae37e1a16cdb377e88fd3a6b405";
export const Q5_FIXED_POOL_SCORE_CAPTURE_EXPECTED_CASE_COUNT = 40;
export const Q5_FIXED_POOL_SCORE_CAPTURE_EXPECTED_CALL_COUNT = 80;
export const Q5_FIXED_POOL_SCORE_CAPTURE_RETRY_POLICY =
  "NO_RETRY_NO_RESUME_NO_REPLAY";

function fail(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function exactCredential(env) {
  const value = typeof env?.[Q5_FIXED_POOL_SCORE_CAPTURE_API_KEY_ENV] === "string"
    ? env[Q5_FIXED_POOL_SCORE_CAPTURE_API_KEY_ENV].trim()
    : "";
  if (!value) throw fail("Q5_SCORE_CAPTURE_CREDENTIAL_UNAVAILABLE");
  if (!value.startsWith("sk-")) throw fail("Q5_SCORE_CAPTURE_CREDENTIAL_FORMAT_INVALID");
  return value;
}

function memoryIndex(source) {
  return new Map((source.memories || []).map(row => [row.id, row]));
}

function canonicalMemory(row) {
  return {
    memory_id: row.id,
    source: {
      record_type: "chunk",
      record_id: row.id,
      text: row.text,
    },
  };
}

function preRerankCandidates(poolIds, memoryMap) {
  return poolIds.map(id => {
    const row = memoryMap.get(id);
    if (!row) throw fail("Q5_SCORE_CAPTURE_POOL_MEMORY_MISSING");
    return Object.freeze({ id: row.id, text: row.text });
  });
}

function normalizeFixture(fixture) {
  if (!fixture || typeof fixture !== "object") throw fail("Q5_SCORE_CAPTURE_FIXTURE_REQUIRED");
  if (fixture.fixture_sha256 !== Q5_FIXED_POOL_SCORE_CAPTURE_EXPECTED_FIXTURE_SHA256) {
    throw fail("Q5_SCORE_CAPTURE_FIXTURE_SHA_DRIFT");
  }
  if (fixture.top_k !== 3 || fixture.candidate_depth !== 20) {
    throw fail("Q5_SCORE_CAPTURE_FIXTURE_SHAPE_DRIFT");
  }
  if (!Array.isArray(fixture.sources) || fixture.sources.length !== 2) {
    throw fail("Q5_SCORE_CAPTURE_SOURCE_COUNT_DRIFT");
  }
  const caseCount = fixture.sources.reduce((sum, source) => sum + (source.cases?.length || 0), 0);
  if (caseCount !== Q5_FIXED_POOL_SCORE_CAPTURE_EXPECTED_CASE_COUNT) {
    throw fail("Q5_SCORE_CAPTURE_CASE_COUNT_DRIFT");
  }

  const executionRows = [];
  for (const source of fixture.sources) {
    const memories = memoryIndex(source);
    for (const row of source.cases || []) {
      for (const arm of ["baseline", "hint"]) {
        const run = row[arm];
        if (!run || !Array.isArray(run.candidate_pool_ids) || run.candidate_pool_ids.length === 0) {
          throw fail("Q5_SCORE_CAPTURE_POOL_REQUIRED");
        }
        if (run.candidate_pool_ids.length > 20) throw fail("Q5_SCORE_CAPTURE_POOL_DEPTH_EXCEEDED");
        executionRows.push(Object.freeze({
          source_name: source.source_name,
          case_id: row.case_id,
          arm,
          query: row.query,
          pool_ids: Object.freeze([...run.candidate_pool_ids]),
          memory_map: memories,
        }));
      }
    }
  }
  if (executionRows.length !== Q5_FIXED_POOL_SCORE_CAPTURE_EXPECTED_CALL_COUNT) {
    throw fail("Q5_SCORE_CAPTURE_CALL_COUNT_DRIFT");
  }
  return Object.freeze(executionRows);
}

export function q5FixedPoolScoreCaptureCredentialPreflightV1({ env = process.env } = {}) {
  exactCredential(env);
  return Object.freeze({
    credential_env: Q5_FIXED_POOL_SCORE_CAPTURE_API_KEY_ENV,
    available: true,
  });
}

export function buildQ5FixedPoolScoreCapturePreflightV1({
  fixture,
  sourceCommit,
  env = process.env,
} = {}) {
  const rows = normalizeFixture(fixture);
  const credential = q5FixedPoolScoreCaptureCredentialPreflightV1({ env });
  return Object.freeze({
    schema: Q5_FIXED_POOL_SCORE_CAPTURE_SCHEMA,
    status: "PASS",
    mode: "PREFLIGHT_ONLY",
    source_commit: sourceCommit,
    fixture_sha256: fixture.fixture_sha256,
    case_count: Q5_FIXED_POOL_SCORE_CAPTURE_EXPECTED_CASE_COUNT,
    planned_provider_calls: rows.length,
    candidate_depth: 20,
    top_k: 3,
    provider: R3_C1_B_PROVIDER_PROFILE.adapterIdentity.provider,
    model: R3_C1_B_PROVIDER_PROFILE.adapterIdentity.model,
    revision: R3_C1_B_PROVIDER_PROFILE.adapterIdentity.revision,
    deadline_ms: R3_C1_B_PROVIDER_PROFILE.deadlineMs,
    credential_env: credential.credential_env,
    credential_available: credential.available,
    retry_policy: Q5_FIXED_POOL_SCORE_CAPTURE_RETRY_POLICY,
    embedding_calls: 0,
    hint_producer_calls: 0,
    model_training_runs: 0,
    runtime_mutation: false,
  });
}

export async function runQ5FixedPoolScoreCaptureV1({
  fixture,
  sourceCommit,
  env = process.env,
  adapterFactory = createSiliconFlowRerankAdapter,
  onProviderAttempt = null,
} = {}) {
  const rows = normalizeFixture(fixture);
  const apiKey = exactCredential(env);
  const baseAdapter = adapterFactory({
    apiKey,
    model: R3_C1_B_PROVIDER_PROFILE.adapterIdentity.model,
  });
  if (typeof baseAdapter !== "function") throw fail("Q5_SCORE_CAPTURE_ADAPTER_INVALID");

  let providerAttempts = 0;
  let providerSuccesses = 0;
  const wrappedAdapter = async (...args) => {
    providerAttempts += 1;
    if (providerAttempts > Q5_FIXED_POOL_SCORE_CAPTURE_EXPECTED_CALL_COUNT) {
      throw fail("Q5_SCORE_CAPTURE_PROVIDER_ATTEMPT_CAP_EXCEEDED");
    }
    if (typeof onProviderAttempt === "function") {
      await onProviderAttempt(Object.freeze({
        attempt: providerAttempts,
        max_attempts: Q5_FIXED_POOL_SCORE_CAPTURE_EXPECTED_CALL_COUNT,
      }));
    }
    const result = await baseAdapter(...args);
    providerSuccesses += 1;
    return result;
  };
  Object.defineProperty(wrappedAdapter, "adapterIdentity", {
    value: baseAdapter.adapterIdentity,
    enumerable: true,
  });

  const captures = [];
  let usagePromptTokens = 0;
  let usageCompletionTokens = 0;
  let usageTotalTokens = 0;
  for (const row of rows) {
    const candidates = preRerankCandidates(row.pool_ids, row.memory_map);
    const memories = candidates.map(candidate => canonicalMemory({
      id: candidate.id,
      text: candidate.text,
    }));
    const reranked = await rerankCanonicalMemories({
      query: row.query,
      memories,
      maxCodePointsPerCandidate: R3_C1_B_PROVIDER_PROFILE.maxCodePointsPerCandidate,
      maxTotalCodePoints: R3_C1_B_PROVIDER_PROFILE.maxTotalCodePoints,
      deadlineMs: R3_C1_B_PROVIDER_PROFILE.deadlineMs,
      adapter: wrappedAdapter,
    });
    const capture = buildQ5SelectionSignalCaptureCaseV1({
      sourceName: row.source_name,
      caseId: row.case_id,
      arm: row.arm,
      query: row.query,
      preRerankCandidates: candidates,
      projectionMetadata: reranked.projectionMetadata,
      rerankResult: reranked,
    });
    captures.push(capture);
    usagePromptTokens += Number(capture.usage?.prompt_tokens || 0);
    usageCompletionTokens += Number(capture.usage?.completion_tokens || 0);
    usageTotalTokens += Number(capture.usage?.total_tokens || 0);
  }

  if (providerAttempts !== Q5_FIXED_POOL_SCORE_CAPTURE_EXPECTED_CALL_COUNT
      || providerSuccesses !== Q5_FIXED_POOL_SCORE_CAPTURE_EXPECTED_CALL_COUNT) {
    throw fail("Q5_SCORE_CAPTURE_PROVIDER_CALL_COUNT_MISMATCH");
  }

  const packet = buildQ5SelectionSignalPacketV1({
    sourceCommit,
    fixtureSha256: fixture.fixture_sha256,
    cases: captures,
  });

  return Object.freeze({
    schema: Q5_FIXED_POOL_SCORE_CAPTURE_SCHEMA,
    status: "PASS",
    mode: "REAL_FIXED_POOL_RERANK_SCORE_CAPTURE",
    source_commit: sourceCommit,
    fixture_sha256: fixture.fixture_sha256,
    provider_attempts: providerAttempts,
    provider_successes: providerSuccesses,
    provider_attempt_cap: Q5_FIXED_POOL_SCORE_CAPTURE_EXPECTED_CALL_COUNT,
    retry_policy: Q5_FIXED_POOL_SCORE_CAPTURE_RETRY_POLICY,
    provider_usage: Object.freeze({
      prompt_tokens: usagePromptTokens,
      completion_tokens: usageCompletionTokens,
      total_tokens: usageTotalTokens,
    }),
    packet,
  });
}

export function readQ5FixedPoolScoreCaptureFixtureV1(path) {
  const fixture = JSON.parse(readFileSync(path, "utf8"));
  normalizeFixture(fixture);
  return fixture;
}
