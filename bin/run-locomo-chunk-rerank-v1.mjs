#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import https from "node:https";

import { projectCanonicalRerankTexts } from "../lib/recall/rerank/canonical-text-projector.js";

export const CHUNK_RERANK_SCHEMA = "q3_locomo_chunk_rerank_runner_v1";
export const CHUNK_RERANK_PROFILE = "q3_locomo_chunk_fts_only_v1";
export const CHUNK_RERANK_MODEL = "BAAI/bge-reranker-v2-m3";
export const CHUNK_RERANK_ENDPOINT = "https://api.siliconflow.cn/v1/rerank";
export const CHUNK_RERANK_DEADLINE_MS = 2_000;
export const CHUNK_RERANK_MIN_INTERVAL_MS = 60_000;
export const CHUNK_RERANK_CASE_COUNT = 1_970;
export const CHUNK_RERANK_PRIOR_CONSUMED = 2_523;
export const CHUNK_RERANK_NEW_REQUEST_CAP = 1_970;
export const CHUNK_RERANK_CUMULATIVE_CAP = 4_493;
export const CHUNK_RERANK_MAX_CODE_POINTS_PER_CANDIDATE = 8_000;
export const CHUNK_RERANK_MAX_TOTAL_CODE_POINTS = 400_000;

const INPUT_HASHES = Object.freeze({
  "dataset/locomo10.json": "79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4",
  "population-alignment.json": "e087c36547e7bd52e970594fb9ab096a0567e398050116876195f10e3633c149",
  "chunk-material/manifest.json": "cb1106121fd15cfac98706789cc8861ba0da75b1b601aa9d293b317e2e2cdb66",
  "chunk-material/chunks.jsonl": "c6c113f9d9ce00bc6bc114c4dc26b4f8f8ecc7e4478f611532c9929cd2666d64",
  "chunk-material/turn-chunk-map.jsonl": "87a272fb44d54606e63e637c2c0d314c473df720fef1bed890dd7d173673d3ff",
  "canonical-lifecycle-overlay.json": "608c7da6fb91e818628dea29669cd247c6c11666239c38f30dfa776af91a6567",
  "canonical-lifecycle-overlay-report.json": "e56c7580dd80f8f56d8630534363445f6db2cfe5ace40842ad20fbd67d290390",
  "candidate-generation/candidate-manifest.json": "47c7d5f601e5a7ac11efc26e5ac7a3f0b0b7b9082875377768b965e6a5dba789",
  "candidate-generation/candidate-profile.json": "0394bd2071ef7878e323e375d47ca00353058d73a59f8b68fd2ef50f2ab51d9b",
  "candidate-generation/fts-index.sqlite": "e28f28548fb5215d957e3140793bdfd3bcadec8ebe31e5999eb3db199728c6a9",
  "control-score/control-score.json": "4823571187ed8900ec3a089cc3a63edfdde1f61357cf6ff1fafdba8c71cb3f28",
});

const CANDIDATE_SOURCE_COMMIT = "a687eedda9fa4e17fc5f334e7a1530e78f47933c";
const CANDIDATE_CONTRACT_SOURCE_COMMIT = "aa2e65ffa2f04d991026d03bc97aebecce944412";

const PARAMS = Object.freeze({
  return_documents: false,
  max_chunks_per_doc: 1,
  overlap_tokens: 0,
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Json(value) {
  return sha256Bytes(Buffer.from(JSON.stringify(value), "utf8"));
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readJsonl(filePath) {
  const text = readFileSync(filePath, "utf8");
  return text.trim() === "" ? [] : text.trim().split(/\n/).map(line => JSON.parse(line));
}

function atomicWrite(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, value, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, filePath);
}

function atomicWriteJson(filePath, value) {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function ensureDirs(root) {
  for (const directory of [
    root,
    join(root, "state"),
    join(root, "evidence"),
    join(root, "evidence", "main"),
  ]) mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_.:-]/gu, "_").slice(0, 180);
}

function extractApiKey(config) {
  const paths = [
    ["models", "providers", "siliconflow", "apiKey"],
    ["providers", "siliconflow", "apiKey"],
    ["siliconflow", "apiKey"],
    ["siliconflowApiKey"],
    ["SILICONFLOW_API_KEY"],
    ["SF_API_KEY"],
  ];
  for (const path of paths) {
    let current = config;
    for (const key of path) {
      current = current?.[key];
      if (!current) break;
    }
    if (typeof current === "string" && current.trim()) return current.trim();
  }
  return "";
}

export function readProviderKey({ configPath = join(homedir(), ".openclaw", "openclaw.json") } = {}) {
  if (!existsSync(configPath)) return "";
  return extractApiKey(readJson(configPath));
}

export function createHttpsTransport({ httpsImpl = https } = {}) {
  return ({ body, apiKey, timeoutMs = CHUNK_RERANK_DEADLINE_MS }) => new Promise((resolveResponse, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(CHUNK_RERANK_ENDPOINT);
    const request = httpsImpl.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(payload),
      },
      timeout: timeoutMs,
    }, response => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { raw += chunk; });
      response.on("end", () => resolveResponse({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: raw,
      }));
    });
    request.on("timeout", () => {
      const error = new Error("timeout");
      error.code = "ETIMEDOUT";
      request.destroy(error);
    });
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

function gitProvenance(repositoryRoot) {
  const commit = spawnSync("git", ["-C", repositoryRoot, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (commit.status !== 0) throw new Error("rerank_git_commit_unavailable");
  const status = spawnSync("git", ["-C", repositoryRoot, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" });
  if (status.status !== 0) throw new Error("rerank_git_status_unavailable");
  return {
    repository_commit: commit.stdout.trim(),
    repository_worktree_clean: status.stdout.trim() === "",
    repository_provenance_source: "git",
  };
}

function sourceKey(sampleId, sessionId) {
  return `${sampleId}\u0000${sessionId}`;
}

function validateInputHashes(root) {
  const inputRoot = join(root, "input");
  const hashes = {};
  for (const [relativePath, expected] of Object.entries(INPUT_HASHES)) {
    const filePath = join(inputRoot, relativePath);
    if (!existsSync(filePath)) throw new Error(`rerank_input_missing:${relativePath}`);
    const actual = sha256Bytes(readFileSync(filePath));
    if (actual !== expected) throw new Error(`rerank_input_hash_mismatch:${relativePath}`);
    hashes[relativePath] = actual;
  }
  return { inputRoot, hashes };
}

function validateControl(control, candidateManifestHash) {
  if (control.schema !== "q3_locomo_chunk_control_score_v1" || control.status !== "completed") {
    throw new Error("rerank_control_not_completed");
  }
  if (control.control_review?.status !== "closed") throw new Error("rerank_control_review_not_closed");
  if (control.population?.fixed_case_count !== CHUNK_RERANK_CASE_COUNT
      || control.population?.final_scoreable_case_count !== CHUNK_RERANK_CASE_COUNT
      || control.population?.final_unknown_case_count !== 0) {
    throw new Error("rerank_control_population_mismatch");
  }
  if (control.inputs?.candidate_manifest_sha256 !== candidateManifestHash) {
    throw new Error("rerank_control_candidate_manifest_mismatch");
  }
}

function validateCanonicalMemory(memory, materialById) {
  if (!isRecord(memory) || typeof memory.memory_id !== "string") throw new Error("rerank_overlay_memory_invalid");
  const material = materialById.get(memory.memory_id);
  if (!material) throw new Error(`rerank_overlay_memory_not_in_material:${memory.memory_id}`);
  if (!isRecord(memory.source) || memory.source.record_type !== "chunk"
      || memory.source.record_id !== memory.memory_id
      || memory.source.text !== material.text) {
    throw new Error(`rerank_overlay_memory_source_mismatch:${memory.memory_id}`);
  }
  if (!isRecord(memory.lifecycle) || memory.lifecycle.management !== "external"
      || memory.lifecycle.category !== null) {
    throw new Error(`rerank_overlay_memory_lifecycle_mismatch:${memory.memory_id}`);
  }
  return memory;
}

function loadFrozenInputs(root, repositoryRoot) {
  const { inputRoot, hashes } = validateInputHashes(root);
  const dataset = readJson(join(inputRoot, "dataset/locomo10.json"));
  const alignment = readJson(join(inputRoot, "population-alignment.json"));
  const chunkManifest = readJson(join(inputRoot, "chunk-material/manifest.json"));
  const chunks = readJsonl(join(inputRoot, "chunk-material/chunks.jsonl"));
  const candidateManifest = readJson(join(inputRoot, "candidate-generation/candidate-manifest.json"));
  const candidateProfile = readJson(join(inputRoot, "candidate-generation/candidate-profile.json"));
  const overlay = readJson(join(inputRoot, "canonical-lifecycle-overlay.json"));
  const control = readJson(join(inputRoot, "control-score/control-score.json"));

  if (candidateManifest.profile_id !== CHUNK_RERANK_PROFILE
      || candidateManifest.case_count !== CHUNK_RERANK_CASE_COUNT
      || candidateManifest.sample_count !== 10
      || candidateManifest.provider_calls !== 0
      || candidateManifest.retrieval_runs !== CHUNK_RERANK_CASE_COUNT
      || candidateManifest.source_commit !== CANDIDATE_SOURCE_COMMIT
      || candidateManifest.contract_source_commit !== CANDIDATE_CONTRACT_SOURCE_COMMIT) {
    throw new Error("rerank_candidate_manifest_identity_invalid");
  }
  if (candidateProfile.profile_id !== CHUNK_RERANK_PROFILE
      || candidateProfile.candidate_depth !== 50
      || candidateProfile.channels?.fts !== true
      || candidateProfile.channels?.vector !== false
      || candidateProfile.channels?.kg !== false
      || candidateProfile.channels?.recent !== false) {
    throw new Error("rerank_candidate_profile_invalid");
  }
  if (overlay.schema !== "q3_locomo_experimental_canonical_lifecycle_overlay_v1"
      || overlay.status !== "experimental"
      || overlay.productionEquivalent !== false
      || overlay.provider_calls !== 0
      || overlay.retrieval_runs !== 0
      || overlay.live_sources_read !== false
      || overlay.gold_read !== false
      || !Array.isArray(overlay.memories)
      || overlay.memories.length !== chunks.length) {
    throw new Error("rerank_overlay_identity_invalid");
  }
  if (chunkManifest.counts?.chunkCount !== chunks.length || chunks.length !== 714) {
    throw new Error("rerank_chunk_material_count_invalid");
  }
  const materialById = new Map();
  for (const chunk of chunks) {
    if (!isRecord(chunk) || typeof chunk.memoryId !== "string" || materialById.has(chunk.memoryId)) {
      throw new Error("rerank_chunk_material_id_invalid");
    }
    materialById.set(chunk.memoryId, chunk);
  }
  const memoryById = new Map();
  for (const memory of overlay.memories) {
    const validated = validateCanonicalMemory(memory, materialById);
    if (memoryById.has(validated.memory_id)) throw new Error("rerank_overlay_duplicate_memory_id");
    memoryById.set(validated.memory_id, validated);
  }
  const scoreablePopulation = new Set(alignment.rows
    .filter(row => row.new?.state === "scoreable")
    .map(row => row.question_id));
  if (scoreablePopulation.size !== CHUNK_RERANK_CASE_COUNT) throw new Error("rerank_population_count_invalid");
  const samplesById = new Map(dataset.map(sample => [sample.sample_id, sample]));
  const preparedCases = candidateManifest.cases.map((row, ordinal) => {
    if (!scoreablePopulation.has(row.question_id)) throw new Error(`rerank_case_not_in_population:${row.question_id}`);
    if (!Array.isArray(row.candidate_ids) || row.candidate_ids.length > 50
        || row.candidate_count !== row.candidate_ids.length) {
      throw new Error(`rerank_candidate_ids_invalid:${row.question_id}`);
    }
    if (new Set(row.candidate_ids).size !== row.candidate_ids.length) {
      throw new Error(`rerank_candidate_ids_duplicate:${row.question_id}`);
    }
    const sample = samplesById.get(row.sample_id);
    const question = sample?.qa?.[row.qa_index];
    if (!question || typeof question.question !== "string" || sha256Bytes(Buffer.from(question.question, "utf8")) !== row.query_sha256) {
      throw new Error(`rerank_query_identity_invalid:${row.question_id}`);
    }
    const memories = row.candidate_ids.map(id => {
      const memory = memoryById.get(id);
      if (!memory) throw new Error(`rerank_candidate_memory_missing:${row.question_id}:${id}`);
      if (memory.source.path?.startsWith(`memory/q3-locomo-v1.2/locomo/${row.sample_id}/`) !== true) {
        throw new Error(`rerank_candidate_sample_scope_invalid:${row.question_id}:${id}`);
      }
      return memory;
    });
    const projection = projectCanonicalRerankTexts({
      memories,
      maxCodePointsPerCandidate: CHUNK_RERANK_MAX_CODE_POINTS_PER_CANDIDATE,
      maxTotalCodePoints: CHUNK_RERANK_MAX_TOTAL_CODE_POINTS,
    });
    return {
      ordinal,
      question_id: row.question_id,
      sample_id: row.sample_id,
      qa_index: row.qa_index,
      query: question.question,
      candidate_ids: row.candidate_ids,
      memories,
      projection,
    };
  });
  validateControl(control, hashes["candidate-generation/candidate-manifest.json"]);
  if (preparedCases.length !== CHUNK_RERANK_CASE_COUNT) throw new Error("rerank_prepared_case_count_invalid");
  if (candidateManifest.execution_source?.repository_provenance_source !== "git"
      || candidateManifest.execution_source?.repository_worktree_clean !== true) {
    throw new Error("rerank_candidate_git_provenance_invalid");
  }
  return {
    dataset,
    alignment,
    chunkManifest,
    candidateManifest,
    candidateProfile,
    overlay,
    control,
    cases: preparedCases,
    hashes,
    material_identity: {
      input_hashes: hashes,
      candidate_manifest_sha256: hashes["candidate-generation/candidate-manifest.json"],
      overlay_sha256: hashes["canonical-lifecycle-overlay.json"],
      control_score_sha256: hashes["control-score/control-score.json"],
      chunk_count: chunks.length,
      case_count: preparedCases.length,
      profile_id: candidateManifest.profile_id,
    },
    execution_source: gitProvenance(repositoryRoot),
  };
}

function buildRequest(materialCase) {
  const submitted = materialCase.projection.candidates
    .map((candidate, originalIndex) => ({ ...candidate, originalIndex }))
    .filter(candidate => candidate.text.length > 0);
  const body = {
    model: CHUNK_RERANK_MODEL,
    query: materialCase.query,
    documents: submitted.map(candidate => candidate.text),
    top_n: submitted.length,
    ...PARAMS,
  };
  const requestId = `q3-locomo-chunk-rerank-v1:main:${materialCase.ordinal}:${materialCase.question_id}`;
  const requestIdentity = {
    request_id: requestId,
    phase: "main",
    ordinal: materialCase.ordinal,
    question_id: materialCase.question_id,
    query: materialCase.query,
    candidate_ids: materialCase.candidate_ids,
    submitted_candidate_ids: submitted.map(candidate => candidate.id),
    provider_documents: body.documents,
    params: {
      endpoint: CHUNK_RERANK_ENDPOINT,
      model: CHUNK_RERANK_MODEL,
      top_n: body.top_n,
      deadline_ms: CHUNK_RERANK_DEADLINE_MS,
      return_documents: false,
      max_chunks_per_doc: 1,
      overlap_tokens: 0,
    },
    projection_metadata: materialCase.projection.metadata,
    total_code_points: materialCase.projection.totalCodePoints,
    serialization: "node_json_stringify_utf8_sha256_v1",
  };
  return {
    body,
    submitted,
    requestId,
    requestIdentity,
    requestIdentitySha256: sha256Json(requestIdentity),
    bodySha256: sha256Json(body),
  };
}

function validateProviderResponse(rawBody, submittedCount) {
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: "response_json_parse_failed", parsed: null };
  }
  if (!Array.isArray(parsed?.results)) return { ok: false, reason: "response_results_not_array", parsed };
  const seen = new Set();
  const scores = new Array(submittedCount);
  for (const result of parsed.results) {
    const index = result?.index;
    if (!Number.isInteger(index) || index < 0 || index >= submittedCount) {
      return { ok: false, reason: `response_index_out_of_bounds:${String(index)}`, parsed };
    }
    if (seen.has(index)) return { ok: false, reason: `response_index_duplicate:${index}`, parsed };
    if (!Number.isFinite(result.relevance_score)) {
      return { ok: false, reason: `response_score_not_finite:${index}`, parsed };
    }
    seen.add(index);
    scores[index] = result.relevance_score;
  }
  if (parsed.results.length !== submittedCount || seen.size !== submittedCount
      || scores.some(score => !Number.isFinite(score))) {
    return { ok: false, reason: "response_index_set_incomplete", parsed };
  }
  return { ok: true, parsed, scores, fingerprint: sha256Json(scores) };
}

function parseOptionalJson(rawBody) {
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

function requestWithDeadline(transport, request, apiKey) {
  const transportPromise = Promise.resolve().then(() => transport({
    body: request.body,
    apiKey,
    timeoutMs: CHUNK_RERANK_DEADLINE_MS,
  }));
  // A late transport settlement is intentionally observed and discarded so
  // an ignored deadline cannot create an unhandled rejection or mutate state.
  transportPromise.catch(() => {});
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("deadline_exceeded");
      error.code = "ETIMEDOUT";
      reject(error);
    }, CHUNK_RERANK_DEADLINE_MS);
  });
  return Promise.race([transportPromise, deadline]).finally(() => clearTimeout(timer));
}

function makeFailureEvidence({ materialCase, request, attempt, startedAtMs, response = null, validation, transportError = null }) {
  return {
    schema: "q3_locomo_chunk_rerank_request_evidence_v1",
    attempt: attempt.attempt,
    phase: "main",
    ordinal: materialCase.ordinal,
    question_id: materialCase.question_id,
    candidate_ids: materialCase.candidate_ids,
    control_ordered_ids: materialCase.candidate_ids,
    fallback_ordered_ids: materialCase.candidate_ids,
    status: "fallback",
    result_scores_by_memory_id: Object.fromEntries(materialCase.candidate_ids.map(id => [id, null])),
    request_identity: request.requestIdentity,
    request_identity_sha256: request.requestIdentitySha256,
    request_body_sha256: request.bodySha256,
    request_serialization: "node_json_stringify_utf8_sha256_v1",
    projection_metadata: materialCase.projection.metadata,
    total_code_points: materialCase.projection.totalCodePoints,
    adapter_identity: {
      provider: "siliconflow",
      endpoint: CHUNK_RERANK_ENDPOINT,
      model: CHUNK_RERANK_MODEL,
      revision: null,
    },
    started_at_ms: startedAtMs,
    response_received_at_ms: response ? Date.now() : null,
    request_latency_ms: response ? Math.max(0, Date.now() - startedAtMs) : null,
    http_status: response?.status ?? null,
    response_headers: response?.headers ?? {},
    raw_response_body: response?.body ?? null,
    usage: validation?.parsed?.usage ?? null,
    validation: { ok: false, reason: validation?.reason ?? null },
    transport_error: transportError,
  };
}

function makeSuccessEvidence({ materialCase, request, attempt, startedAtMs, response, validation, latencyMs }) {
  const scoresByOriginalIndex = new Array(materialCase.candidate_ids.length).fill(null);
  for (const [submittedIndex, score] of validation.scores.entries()) {
    scoresByOriginalIndex[request.submitted[submittedIndex].originalIndex] = score;
  }
  const ranked = request.submitted
    .map((candidate, submittedIndex) => ({
      id: candidate.id,
      originalIndex: candidate.originalIndex,
      score: validation.scores[submittedIndex],
    }))
    .sort((left, right) => right.score - left.score || left.originalIndex - right.originalIndex)
    .map(item => item.id);
  const emptyIds = materialCase.projection.candidates
    .filter(candidate => candidate.text.length === 0)
    .map(candidate => candidate.id);
  const orderedIds = [...ranked, ...emptyIds];
  return {
    schema: "q3_locomo_chunk_rerank_request_evidence_v1",
    attempt: attempt.attempt,
    phase: "main",
    ordinal: materialCase.ordinal,
    question_id: materialCase.question_id,
    candidate_ids: materialCase.candidate_ids,
    control_ordered_ids: materialCase.candidate_ids,
    ordered_ids: orderedIds,
    status: request.submitted.length === materialCase.candidate_ids.length ? "applied" : "bypassed_empty_text_tail",
    reason: request.submitted.length === materialCase.candidate_ids.length ? "complete" : "mixed_empty_text",
    result_scores_by_memory_id: Object.fromEntries(materialCase.candidate_ids.map((id, index) => [id, scoresByOriginalIndex[index]])),
    raw_scores_by_submitted_index: validation.scores,
    raw_provider_results: validation.parsed.results,
    provider_index_to_original_index: request.submitted.map(candidate => candidate.originalIndex),
    provider_index_to_memory_id: request.submitted.map(candidate => candidate.id),
    request_identity: request.requestIdentity,
    request_identity_sha256: request.requestIdentitySha256,
    request_body_sha256: request.bodySha256,
    request_serialization: "node_json_stringify_utf8_sha256_v1",
    projection_metadata: materialCase.projection.metadata,
    total_code_points: materialCase.projection.totalCodePoints,
    adapter_identity: {
      provider: "siliconflow",
      endpoint: CHUNK_RERANK_ENDPOINT,
      model: CHUNK_RERANK_MODEL,
      revision: null,
    },
    started_at_ms: startedAtMs,
    response_received_at_ms: startedAtMs + latencyMs,
    request_latency_ms: latencyMs,
    rerank_elapsed_ms: latencyMs,
    http_status: response.status,
    response_headers: response.headers || {},
    raw_response_body: response.body,
    usage: validation.parsed.usage ?? null,
    fingerprint: validation.fingerprint,
    validation: { ok: true, reason: null },
  };
}

function initialState(material, now = new Date().toISOString()) {
  const executionConfig = {
    profile_id: CHUNK_RERANK_PROFILE,
    model: CHUNK_RERANK_MODEL,
    endpoint: CHUNK_RERANK_ENDPOINT,
    deadline_ms: CHUNK_RERANK_DEADLINE_MS,
    min_interval_ms: CHUNK_RERANK_MIN_INTERVAL_MS,
    max_code_points_per_candidate: CHUNK_RERANK_MAX_CODE_POINTS_PER_CANDIDATE,
    max_total_code_points: CHUNK_RERANK_MAX_TOTAL_CODE_POINTS,
    params: PARAMS,
    candidate_count: CHUNK_RERANK_CASE_COUNT,
    prior_consumed: CHUNK_RERANK_PRIOR_CONSUMED,
    new_request_cap: CHUNK_RERANK_NEW_REQUEST_CAP,
    cumulative_cap: CHUNK_RERANK_CUMULATIVE_CAP,
  };
  return {
    schema: CHUNK_RERANK_SCHEMA,
    runner_version: "q3_locomo_chunk_rerank_v1",
    status: "ready",
    created_at: now,
    updated_at: now,
    material_identity: material.material_identity,
    execution_source: material.execution_source,
    execution_config: executionConfig,
    execution_config_sha256: sha256Json(executionConfig),
    budget: {
      prior_consumed: CHUNK_RERANK_PRIOR_CONSUMED,
      new_request_cap: CHUNK_RERANK_NEW_REQUEST_CAP,
      cumulative_cap: CHUNK_RERANK_CUMULATIVE_CAP,
      attempts: 0,
      valid_responses: 0,
      failed_responses: 0,
      unknown_requests: 0,
      cumulative_consumed: CHUNK_RERANK_PRIOR_CONSUMED,
    },
    phases: {
      main: { expected: CHUNK_RERANK_CASE_COUNT, results: [] },
    },
    attempts: [],
    inflight: null,
    stop: null,
    last_request_started_at_ms: null,
  };
}

function saveState(statePath, state) {
  state.updated_at = new Date().toISOString();
  atomicWriteJson(statePath, state);
}

function completedKeys(state) {
  return new Set(state.phases.main.results
    .filter(result => result.completion_confirmed === true)
    .map(result => result.question_id));
}

function nextWork(state, cases) {
  const done = completedKeys(state);
  return cases.find(materialCase => !done.has(materialCase.question_id)) ?? null;
}

function markPriorInflightUnknown(statePath, state) {
  if (!state.inflight) return;
  const attempt = state.attempts.find(item => item.attempt === state.inflight.attempt);
  if (attempt && attempt.outcome === "inflight") attempt.outcome = "unknown";
  state.budget.unknown_requests += 1;
  state.stop = {
    reason: "prior_inflight_request_unconfirmed",
    attempt: state.inflight.attempt,
    question_id: state.inflight.question_id,
    request_id: state.inflight.request_id,
  };
  state.status = "stopped";
  state.inflight = null;
  saveState(statePath, state);
}

function readOrCreateState(root, material) {
  const statePath = join(root, "state", "runner-state.json");
  if (!existsSync(statePath)) {
    const state = initialState(material);
    atomicWriteJson(statePath, state);
    return { statePath, state };
  }
  const state = readJson(statePath);
  if (state.schema !== CHUNK_RERANK_SCHEMA) throw new Error("rerank_state_schema_mismatch");
  if (sha256Json(state.material_identity) !== sha256Json(material.material_identity)) {
    throw new Error("rerank_state_material_identity_mismatch");
  }
  if (state.execution_source?.repository_commit !== material.execution_source.repository_commit) {
    throw new Error("rerank_state_execution_source_mismatch");
  }
  return { statePath, state };
}

function markStopped(statePath, state, stop) {
  state.stop = stop;
  state.status = "stopped";
  state.inflight = null;
  saveState(statePath, state);
}

function defaultSleep(ms) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}

function waitMs(ms, sleep) {
  return ms > 0 ? sleep(ms) : Promise.resolve();
}

export async function runLocomoChunkRerank({
  root,
  repositoryRoot = resolve(new URL("..", import.meta.url).pathname),
  transport = createHttpsTransport(),
  apiKey,
  sleep = defaultSleep,
  now = () => Date.now(),
  checkOnly = false,
  requestLimit = null,
} = {}) {
  if (!root) throw new Error("rerank_root_required");
  ensureDirs(root);
  const material = loadFrozenInputs(root, repositoryRoot);
  if (checkOnly) return { check_only: true, material_identity: material.material_identity, execution_source: material.execution_source };
  if (!apiKey) throw new Error("rerank_api_key_missing");
  const { statePath, state } = readOrCreateState(root, material);
  if (state.status === "complete") return { status: state.status, state_path: statePath, budget: state.budget };
  if (state.status === "stopped") throw new Error(`rerank_runner_stopped:${state.stop?.reason || "unknown"}`);
  if (state.inflight) {
    markPriorInflightUnknown(statePath, state);
    throw new Error("rerank_prior_inflight_request_marked_unknown");
  }
  state.status = "running";
  saveState(statePath, state);

  while (true) {
    const materialCase = nextWork(state, material.cases);
    if (!materialCase) {
      state.status = "complete";
      state.completed_at = new Date().toISOString();
      saveState(statePath, state);
      return { status: state.status, state_path: statePath, budget: state.budget };
    }
    if (state.budget.attempts >= CHUNK_RERANK_NEW_REQUEST_CAP
        || state.budget.cumulative_consumed >= CHUNK_RERANK_CUMULATIVE_CAP) {
      markStopped(statePath, state, {
        reason: "request_budget_exhausted",
        question_id: materialCase.question_id,
      });
      throw new Error("rerank_request_budget_exhausted");
    }

    const request = buildRequest(materialCase);
    if (request.submitted.length === 0) {
      const bypassPath = join(root, "evidence", "main", `bypass-${safeName(materialCase.question_id)}.json`);
      atomicWriteJson(bypassPath, {
        schema: "q3_locomo_chunk_rerank_request_evidence_v1",
        phase: "main",
        ordinal: materialCase.ordinal,
        question_id: materialCase.question_id,
        candidate_ids: materialCase.candidate_ids,
        control_ordered_ids: materialCase.candidate_ids,
        ordered_ids: materialCase.candidate_ids,
        status: "bypassed",
        reason: "all_text_empty",
        result_scores_by_memory_id: Object.fromEntries(materialCase.candidate_ids.map(id => [id, null])),
        projection_metadata: materialCase.projection.metadata,
        total_code_points: materialCase.projection.totalCodePoints,
        provider_called: false,
        validation: { ok: true, reason: "all_text_empty" },
      });
      state.phases.main.results.push({
        question_id: materialCase.question_id,
        ordinal: materialCase.ordinal,
        completion_confirmed: true,
        provider_called: false,
        status: "bypassed",
        evidence_path: bypassPath,
      });
      saveState(statePath, state);
      continue;
    }

    const lastStarted = state.last_request_started_at_ms === null ? null : Number(state.last_request_started_at_ms);
    const throttleWaitMs = lastStarted === null ? 0 : Math.max(0, CHUNK_RERANK_MIN_INTERVAL_MS - (now() - lastStarted));
    await waitMs(throttleWaitMs, sleep);
    const startedAtMs = now();
    const attemptNumber = state.attempts.length + 1;
    state.budget.attempts += 1;
    state.budget.cumulative_consumed += 1;
    state.last_request_started_at_ms = startedAtMs;
    const attempt = {
      attempt: attemptNumber,
      phase: "main",
      ordinal: materialCase.ordinal,
      question_id: materialCase.question_id,
      request_id: request.requestId,
      budget_before: state.budget.cumulative_consumed - 1,
      budget_after: state.budget.cumulative_consumed,
      throttle_wait_ms: throttleWaitMs,
      started_at_ms: startedAtMs,
      outcome: "inflight",
    };
    state.attempts.push(attempt);
    state.inflight = {
      attempt: attemptNumber,
      phase: "main",
      ordinal: materialCase.ordinal,
      question_id: materialCase.question_id,
      request_id: request.requestId,
      request_identity_sha256: request.requestIdentitySha256,
      body_sha256: request.bodySha256,
      started_at_ms: startedAtMs,
    };
    saveState(statePath, state);

    let response;
    try {
      response = await requestWithDeadline(transport, request, apiKey);
    } catch (error) {
      const evidencePath = join(root, "evidence", "main", `${String(attemptNumber).padStart(4, "0")}-${safeName(materialCase.question_id)}.json`);
      const evidence = makeFailureEvidence({
        materialCase,
        request,
        attempt,
        startedAtMs,
        validation: { ok: false, reason: "transport_error_unconfirmed", parsed: null },
        transportError: String(error?.message || error),
      });
      try {
        atomicWriteJson(evidencePath, evidence);
      } catch (persistError) {
        attempt.outcome = "unknown";
        state.budget.unknown_requests += 1;
        state.stop = { reason: "evidence_persist_failed", question_id: materialCase.question_id, error: String(persistError?.message || persistError) };
        state.status = "stopped";
        try { saveState(statePath, state); } catch { /* The inflight marker remains the recovery guard. */ }
        throw persistError;
      }
      attempt.outcome = "unknown";
      attempt.evidence_path = evidencePath;
      attempt.error = String(error?.message || error);
      state.budget.unknown_requests += 1;
      state.stop = { reason: "transport_error_unconfirmed", question_id: materialCase.question_id, attempt: attemptNumber, evidence_path: evidencePath };
      state.status = "stopped";
      state.inflight = null;
      saveState(statePath, state);
      throw error;
    }

    const latencyMs = Math.max(0, now() - startedAtMs);
    const validation = response.status >= 200 && response.status < 300
      ? validateProviderResponse(response.body, request.submitted.length)
      : { ok: false, reason: `http_${response.status}`, parsed: parseOptionalJson(response.body) };
    let evidence;
    try {
      evidence = validation.ok
        ? makeSuccessEvidence({ materialCase, request, attempt, startedAtMs, response, validation, latencyMs })
        : makeFailureEvidence({ materialCase, request, attempt, startedAtMs, response, validation });
      const evidencePath = join(root, "evidence", "main", `${String(attemptNumber).padStart(4, "0")}-${safeName(materialCase.question_id)}.json`);
      atomicWriteJson(evidencePath, evidence);
      attempt.evidence_path = evidencePath;
      attempt.completed_at_ms = startedAtMs + latencyMs;
      attempt.latency_ms = latencyMs;
      attempt.validation_reason = validation.reason || null;
      state.inflight = null;
      if (validation.ok) {
        attempt.outcome = "confirmed_valid";
        state.budget.valid_responses += 1;
        state.phases.main.results.push({
          question_id: materialCase.question_id,
          ordinal: materialCase.ordinal,
          attempt: attemptNumber,
          completion_confirmed: true,
          provider_called: true,
          status: evidence.status,
          reason: evidence.reason,
          evidence_path: evidencePath,
          latency_ms: latencyMs,
          usage: validation.parsed.usage ?? null,
        });
      } else {
        attempt.outcome = "confirmed_failure";
        state.budget.failed_responses += 1;
        state.stop = {
          reason: validation.reason || `http_${response.status}`,
          question_id: materialCase.question_id,
          attempt: attemptNumber,
          evidence_path: evidencePath,
        };
        state.status = "stopped";
      }
      saveState(statePath, state);
      if (!validation.ok) throw new Error(`rerank_runner_stopped:${validation.reason || "response_invalid"}`);
    } catch (error) {
      if (state.inflight !== null || !attempt.evidence_path) {
        attempt.outcome = "unknown";
        state.budget.unknown_requests += 1;
        state.stop = { reason: "evidence_or_state_persist_failed", question_id: materialCase.question_id, attempt: attemptNumber, error: String(error?.message || error) };
        state.status = "stopped";
        try { saveState(statePath, state); } catch { /* Preserve the pre-request inflight marker if state cannot be written. */ }
      }
      throw error;
    }
    if (Number.isSafeInteger(requestLimit) && requestLimit > 0 && state.budget.attempts >= requestLimit) {
      state.status = "paused";
      saveState(statePath, state);
      return { status: state.status, state_path: statePath, budget: state.budget };
    }
  }
}

function parseArgs(argv) {
  const args = {
    root: process.env.Q3_LOCOMO_CHUNK_RERANK_ROOT || "/home/lionsol/.openclaw/workspace/q3-locomo-v1.2/runs/q3-locomo-chunk-fts-rerank-v1",
    checkOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--root") args.root = argv[++index];
    else if (token === "--check-only") args.checkOnly = true;
    else if (token === "--request-limit") args.requestLimit = Number(argv[++index]);
    else if (token === "--help" || token === "-h") args.help = true;
    else throw new Error(`unknown_argument:${token}`);
  }
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log("Usage: node bin/run-locomo-chunk-rerank-v1.mjs [--root <experiment-root>] [--check-only] [--request-limit <n>]");
      process.exit(0);
    }
    const result = await runLocomoChunkRerank({
      root: resolve(args.root),
      apiKey: args.checkOnly ? "check-only" : readProviderKey(),
      checkOnly: args.checkOnly,
      requestLimit: args.requestLimit ?? null,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`LOCOMO_CHUNK_RERANK_STOPPED ${error?.message || error}`);
    process.exitCode = 1;
  }
}
