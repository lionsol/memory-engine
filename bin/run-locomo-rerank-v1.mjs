#!/usr/bin/env node

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { resolve, join, basename } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import https from "node:https";

import { assertOfficialLocomoDataset } from "../lib/benchmark/locomo-v1.js";

export const LOCOMO_RERANK_SCHEMA = "q3_v1_2_locomo_rerank_runner_v1";
export const LOCOMO_RERANK_MODEL = "BAAI/bge-reranker-v2-m3";
export const LOCOMO_RERANK_ENDPOINT = "https://api.siliconflow.cn/v1/rerank";
export const LOCOMO_RERANK_MIN_INTERVAL_MS = 60_000;
export const LOCOMO_RERANK_NEW_REQUEST_CAP = 2_004;
export const LOCOMO_RERANK_CUMULATIVE_CAP = 2_523;
export const LOCOMO_RERANK_PRIOR_CONSUMED = 519;
export const LOCOMO_RERANK_CASE_COUNT = 1_972;
export const LOCOMO_RERANK_SENTINEL_CASE_COUNT = 16;

const EXPECTED = Object.freeze({
  datasetSha256: "79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4",
  candidatesSha256: "55ef0a20d18ea60b4bcdfc08ff346706c1ba202059e974cc7b78fe6d641f51b6",
  mapSha256: "b9d8d70bb19543424058eb74c3ca75659de3548d79a34cd864ab4b94a85dcff2",
});

const PARAMS = Object.freeze({
  return_documents: false,
  max_chunks_per_doc: 1,
  overlap_tokens: 0,
});

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256Json(value) {
  return sha256Bytes(Buffer.from(JSON.stringify(value), "utf8"));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function atomicWrite(path, value) {
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temp, value, { encoding: "utf8", mode: 0o600 });
  renameSync(temp, path);
}

function atomicWriteJson(path, value) {
  atomicWrite(path, JSON.stringify(value, null, 2));
}

function ensureDirs(root) {
  for (const path of [
    root,
    join(root, "material"),
    join(root, "state"),
    join(root, "evidence", "pre_sentinel"),
    join(root, "evidence", "main"),
    join(root, "evidence", "post_sentinel"),
  ]) mkdirSync(path, { recursive: true, mode: 0o700 });
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_.:-]/gu, "_").slice(0, 160);
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
  return ({ body, apiKey, timeoutMs = 60_000 }) => new Promise((resolveResponse, reject) => {
    const url = new URL(LOCOMO_RERANK_ENDPOINT);
    const payload = JSON.stringify(body);
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
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

function locomoSessionText(sample, sessionId) {
  const turns = sample.conversation?.[sessionId];
  if (!Array.isArray(turns)) throw new Error(`locomo_session_missing:${sessionId}`);
  const dateTime = sample.conversation?.[`${sessionId}_date_time`];
  return turns.map(turn => {
    let line = `(${dateTime ?? ""}) ${turn.speaker}: ${turn.text}`;
    if (typeof turn.blip_caption === "string" && turn.blip_caption.trim() !== "") {
      line += `\n[shares ${turn.blip_caption}]`;
    }
    return line;
  }).join("\n");
}

function questionParts(questionId) {
  const match = /^(.*):qa:(\d+)$/u.exec(questionId);
  if (!match) throw new Error(`locomo_question_id_invalid:${questionId}`);
  return { sampleId: match[1], questionIndex: Number(match[2]) };
}

function validateMaterialHashes(root) {
  const material = join(root, "material");
  const recordedPath = join(root, "material.sha256.before-run");
  if (!existsSync(recordedPath)) throw new Error("locomo_material_sha256_manifest_missing");
  const paths = {
    dataset: join(material, "locomo10.json"),
    candidates: join(material, "q3-rerank-candidates-locomo.json"),
    map: join(material, "q3-v1.2-nonempty-map-locomo.json"),
  };
  const hashes = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, sha256Bytes(readFileSync(path))]));
  if (hashes.dataset !== EXPECTED.datasetSha256) throw new Error("locomo_dataset_sha256_mismatch");
  if (hashes.candidates !== EXPECTED.candidatesSha256) throw new Error("locomo_candidates_sha256_mismatch");
  if (hashes.map !== EXPECTED.mapSha256) throw new Error("locomo_map_sha256_mismatch");
  const recorded = new Map(readFileSync(recordedPath, "utf8").trim().split("\n").filter(Boolean).map(line => {
    const match = /^([0-9a-f]{64})  (.+)$/u.exec(line);
    if (!match) throw new Error("locomo_material_sha256_manifest_invalid");
    return [basename(match[2]), match[1]];
  }));
  for (const name of recorded.keys()) {
    const path = join(material, name);
    if (!existsSync(path) || sha256Bytes(readFileSync(path)) !== recorded.get(name)) {
      throw new Error(`locomo_material_hash_changed:${name}`);
    }
  }
  return { paths, hashes };
}

export function loadLocomoMaterial(root) {
  const { paths, hashes } = validateMaterialHashes(root);
  const records = readJson(paths.dataset);
  assertOfficialLocomoDataset(records, readFileSync(paths.dataset));
  const candidates = readJson(paths.candidates);
  const mapping = readJson(paths.map);
  if (!Array.isArray(candidates.entries) || candidates.entries.length !== LOCOMO_RERANK_CASE_COUNT) {
    throw new Error("locomo_candidate_case_count_mismatch");
  }
  if (mapping.summary?.cases !== LOCOMO_RERANK_CASE_COUNT || mapping.summary?.total_empty_candidates !== 0) {
    throw new Error("locomo_mapping_summary_mismatch");
  }
  if (!Array.isArray(mapping.entries) || mapping.entries.length !== candidates.entries.length) {
    throw new Error("locomo_mapping_entry_count_mismatch");
  }

  const bySample = new Map(records.map(record => [record.sample_id, record]));
  const mappingById = new Map(mapping.entries.map(entry => [entry.question_id, entry]));
  const cases = candidates.entries.map((entry, index) => {
    const mapEntry = mappingById.get(entry.question_id);
    if (!mapEntry || mapEntry.question_id !== entry.question_id) throw new Error(`locomo_mapping_missing:${entry.question_id}`);
    if (mapEntry.original_candidate_count !== entry.retrieved_session_ids.length
        || mapEntry.nonempty_candidate_count !== entry.retrieved_session_ids.length
        || mapEntry.empty_candidate_count !== 0) {
      throw new Error(`locomo_mapping_count_mismatch:${entry.question_id}`);
    }
    const expectedIndexes = entry.retrieved_session_ids.map((_, candidateIndex) => candidateIndex);
    if (JSON.stringify(mapEntry.provider_to_original_index) !== JSON.stringify(expectedIndexes)) {
      throw new Error(`locomo_mapping_order_mismatch:${entry.question_id}`);
    }
    const { sampleId, questionIndex } = questionParts(entry.question_id);
    const sample = bySample.get(sampleId);
    const question = sample?.qa?.[questionIndex];
    if (!sample || !question || typeof question.question !== "string") {
      throw new Error(`locomo_question_missing:${entry.question_id}`);
    }
    const documents = entry.retrieved_session_ids.map(sessionId => locomoSessionText(sample, sessionId));
    if (documents.some(document => document === "")) throw new Error(`locomo_empty_document:${entry.question_id}`);
    return {
      ordinal: index,
      question_id: entry.question_id,
      family: entry.family,
      gold_evidence_ids: entry.gold_evidence_ids,
      retrieved_session_ids: entry.retrieved_session_ids,
      query: question.question,
      documents,
      sample_id: sampleId,
      question_index: questionIndex,
    };
  });
  return {
    root,
    paths,
    hashes,
    candidates,
    mapping,
    records,
    cases,
    material_identity: {
      dataset_sha256: hashes.dataset,
      candidates_sha256: hashes.candidates,
      mapping_sha256: hashes.map,
      material_sha256_manifest: sha256Bytes(readFileSync(join(root, "material.sha256.before-run"))),
      candidate_count: cases.length,
      candidate_pairs: cases.reduce((sum, item) => sum + item.documents.length, 0),
      empty_document_count: 0,
    },
  };
}

function buildRequest(materialCase, phase, phaseOrdinal) {
  const body = {
    model: LOCOMO_RERANK_MODEL,
    query: materialCase.query,
    documents: materialCase.documents,
    top_n: materialCase.documents.length,
    ...PARAMS,
  };
  const requestId = `q3-v1.2-locomo:${phase}:${phaseOrdinal}:${materialCase.question_id}`;
  const requestIdentity = {
    request_id: requestId,
    phase,
    phase_ordinal: phaseOrdinal,
    question_id: materialCase.question_id,
    query: materialCase.query,
    original_candidate_session_ids: materialCase.retrieved_session_ids,
    provider_documents: materialCase.documents,
    params: {
      endpoint: LOCOMO_RERANK_ENDPOINT,
      model: LOCOMO_RERANK_MODEL,
      top_n: body.top_n,
      return_documents: false,
      max_chunks_per_doc: 1,
      overlap_tokens: 0,
    },
    serialization: "node_json_stringify_utf8_sha256_v1",
  };
  return {
    requestId,
    body,
    requestIdentity,
    requestIdentitySha256: sha256Json(requestIdentity),
    bodySha256: sha256Json(body),
  };
}

function validateResponse(rawBody, candidateCount) {
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: "response_json_parse_failed", parsed: null };
  }
  const results = parsed?.results;
  if (!Array.isArray(results)) return { ok: false, reason: "response_results_not_array", parsed };
  const seen = new Set();
  const scores = new Array(candidateCount);
  for (const result of results) {
    const index = result?.index;
    if (!Number.isInteger(index) || index < 0 || index >= candidateCount) {
      return { ok: false, reason: `response_index_out_of_bounds:${String(index)}`, parsed };
    }
    if (seen.has(index)) return { ok: false, reason: `response_index_duplicate:${index}`, parsed };
    seen.add(index);
    if (!Number.isFinite(result.relevance_score)) return { ok: false, reason: `response_score_not_finite:${index}`, parsed };
    scores[index] = result.relevance_score;
  }
  if (results.length !== candidateCount) return { ok: false, reason: "response_count_mismatch", parsed };
  if (seen.size !== candidateCount || scores.some(score => !Number.isFinite(score))) {
    return { ok: false, reason: "response_index_set_incomplete", parsed };
  }
  return {
    ok: true,
    parsed,
    scores,
    fingerprint: sha256Json(scores),
  };
}

function rankedSessionIds(materialCase, scores) {
  return materialCase.retrieved_session_ids
    .map((sessionId, originalIndex) => ({ sessionId, originalIndex, score: scores[originalIndex] }))
    .sort((left, right) => (right.score - left.score) || (left.originalIndex - right.originalIndex))
    .map(item => item.sessionId);
}

function initialState(material, now = new Date().toISOString()) {
  return {
    schema: LOCOMO_RERANK_SCHEMA,
    runner_version: "q3_v1.2",
    status: "ready",
    created_at: now,
    updated_at: now,
    material_identity: material.material_identity,
    config: {
      model: LOCOMO_RERANK_MODEL,
      endpoint: LOCOMO_RERANK_ENDPOINT,
      params: PARAMS,
      min_interval_ms: LOCOMO_RERANK_MIN_INTERVAL_MS,
      new_request_cap: LOCOMO_RERANK_NEW_REQUEST_CAP,
      cumulative_cap: LOCOMO_RERANK_CUMULATIVE_CAP,
      prior_consumed: LOCOMO_RERANK_PRIOR_CONSUMED,
    },
    budget: {
      attempts: 0,
      valid_responses: 0,
      failed_responses: 0,
      unknown_requests: 0,
      cumulative_consumed: LOCOMO_RERANK_PRIOR_CONSUMED,
    },
    phases: {
      pre_sentinel: { expected: LOCOMO_RERANK_SENTINEL_CASE_COUNT, results: [] },
      main: { expected: LOCOMO_RERANK_CASE_COUNT, results: [] },
      post_sentinel: { expected: LOCOMO_RERANK_SENTINEL_CASE_COUNT, results: [] },
    },
    attempts: [],
    inflight: null,
    stop: null,
    last_request_started_at: null,
  };
}

function phaseComplete(state, phase) {
  return state.phases[phase].results.filter(result => result.validation_ok === true).length >= state.phases[phase].expected;
}

function allComplete(state) {
  return ["pre_sentinel", "main", "post_sentinel"].every(phase => phaseComplete(state, phase));
}

function readOrCreateState(root, material) {
  const path = join(root, "state", "runner-state.json");
  if (!existsSync(path)) {
    const state = initialState(material);
    atomicWriteJson(path, state);
    return { path, state };
  }
  const state = readJson(path);
  if (state.schema !== LOCOMO_RERANK_SCHEMA) throw new Error("locomo_runner_state_schema_mismatch");
  if (JSON.stringify(state.material_identity) !== JSON.stringify(material.material_identity)) {
    throw new Error("locomo_runner_material_identity_mismatch");
  }
  return { path, state };
}

function saveState(path, state) {
  state.updated_at = new Date().toISOString();
  atomicWriteJson(path, state);
}

function markUnknownAndStop(path, state, reason) {
  const inflight = state.inflight;
  if (inflight) {
    const attempt = state.attempts.find(item => item.attempt === inflight.attempt);
    if (attempt) attempt.outcome = "unknown";
    state.budget.unknown_requests += 1;
    state.stop = { reason, phase: inflight.phase, key: inflight.key, attempt: inflight.attempt };
    state.status = "stopped";
    state.inflight = null;
    saveState(path, state);
  }
}

function waitMs(ms, sleep) {
  return ms > 0 ? sleep(ms) : Promise.resolve();
}

function defaultSleep(ms) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}

function nextWork(state, material) {
  for (const phase of ["pre_sentinel", "main", "post_sentinel"]) {
    const expected = phase === "main" ? material.cases : material.cases.slice(0, LOCOMO_RERANK_SENTINEL_CASE_COUNT);
    const done = new Set(state.phases[phase].results.filter(result => result.validation_ok === true).map(result => result.key));
    for (let index = 0; index < expected.length; index += 1) {
      const key = expected[index].question_id;
      if (!done.has(key)) return { phase, ordinal: index, materialCase: expected[index], key };
    }
  }
  return null;
}

function requireFreshOrResumable(state, statePath) {
  if (state.status === "complete") return;
  if (state.status === "stopped") throw new Error(`locomo_runner_stopped:${state.stop?.reason || "unknown"}`);
  if (state.inflight) {
    markUnknownAndStop(statePath, state, "prior_inflight_request_unconfirmed");
    throw new Error("locomo_runner_prior_inflight_request_marked_unknown");
  }
}

export async function runLocomoRerank({
  root,
  transport = createHttpsTransport(),
  apiKey,
  sleep = defaultSleep,
  now = () => Date.now(),
  timeoutMs = 60_000,
  checkOnly = false,
  requestLimit = null,
} = {}) {
  if (!root) throw new Error("locomo_runner_root_required");
  ensureDirs(root);
  const material = loadLocomoMaterial(root);
  if (checkOnly) return { check_only: true, material_identity: material.material_identity };
  if (!apiKey) throw new Error("locomo_runner_api_key_missing");
  const { path: statePath, state } = readOrCreateState(root, material);
  requireFreshOrResumable(state, statePath);
  if (state.status === "complete") return { status: state.status, state_path: statePath };
  state.status = "running";
  saveState(statePath, state);

  while (true) {
    const work = nextWork(state, material);
    if (!work) {
      state.status = "complete";
      saveState(statePath, state);
      return { status: state.status, state_path: statePath, budget: state.budget };
    }
    if (state.budget.attempts >= LOCOMO_RERANK_NEW_REQUEST_CAP
        || state.budget.cumulative_consumed >= LOCOMO_RERANK_CUMULATIVE_CAP) {
      state.stop = { reason: "request_budget_exhausted", phase: work.phase, key: work.key };
      state.status = "stopped";
      saveState(statePath, state);
      throw new Error("locomo_runner_request_budget_exhausted");
    }

    const request = buildRequest(work.materialCase, work.phase, work.ordinal);
    const lastStarted = state.last_request_started_at ? Number(state.last_request_started_at) : null;
    const throttleWaitMs = lastStarted === null
      ? 0
      : Math.max(0, LOCOMO_RERANK_MIN_INTERVAL_MS - (now() - lastStarted));
    await waitMs(throttleWaitMs, sleep);
    const startedAtMs = now();
    const attemptNumber = state.attempts.length + 1;
    state.budget.attempts += 1;
    state.budget.cumulative_consumed += 1;
    state.last_request_started_at = String(startedAtMs);
    const attempt = {
      attempt: attemptNumber,
      phase: work.phase,
      key: work.key,
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
      phase: work.phase,
      key: work.key,
      request_id: request.requestId,
      request_identity_sha256: request.requestIdentitySha256,
      body_sha256: request.bodySha256,
      started_at_ms: startedAtMs,
    };
    saveState(statePath, state);

    let response;
    try {
      response = await transport({ body: request.body, apiKey, timeoutMs });
    } catch (error) {
      const evidencePath = join(root, "evidence", work.phase, `${String(attemptNumber).padStart(4, "0")}-${safeName(work.key)}.json`);
      atomicWriteJson(evidencePath, {
        schema: "q3_v1_2_locomo_request_evidence_v1",
        attempt: attemptNumber,
        phase: work.phase,
        phase_ordinal: work.ordinal,
        question_id: work.materialCase.question_id,
        request_identity: request.requestIdentity,
        request_identity_sha256: request.requestIdentitySha256,
        request_body_sha256: request.bodySha256,
        request_serialization: "node_json_stringify_utf8_sha256_v1",
        started_at_ms: startedAtMs,
        http_status: null,
        raw_response_body: null,
        validation: { ok: false, reason: "transport_error_unconfirmed" },
        transport_error: String(error?.message || error),
      });
      attempt.outcome = "unknown";
      attempt.evidence_path = evidencePath;
      state.budget.unknown_requests += 1;
      state.stop = { reason: "transport_error", error: String(error?.message || error), phase: work.phase, key: work.key };
      state.status = "stopped";
      state.inflight = null;
      saveState(statePath, state);
      throw error;
    }
    const latencyMs = Math.max(0, now() - startedAtMs);
    const evidencePath = join(root, "evidence", work.phase, `${String(attemptNumber).padStart(4, "0")}-${safeName(work.key)}.json`);
    const evidence = {
      schema: "q3_v1_2_locomo_request_evidence_v1",
      attempt: attemptNumber,
      phase: work.phase,
      phase_ordinal: work.ordinal,
      question_id: work.materialCase.question_id,
      request_identity: request.requestIdentity,
      request_identity_sha256: request.requestIdentitySha256,
      request_body_sha256: request.bodySha256,
      request_serialization: "node_json_stringify_utf8_sha256_v1",
      started_at_ms: startedAtMs,
      response_received_at_ms: startedAtMs + latencyMs,
      request_latency_ms: latencyMs,
      http_status: response.status,
      response_headers: response.headers || {},
      raw_response_body: response.body,
    };
    const validation = response.status >= 200 && response.status < 300
      ? validateResponse(response.body, work.materialCase.documents.length)
      : { ok: false, reason: `http_${response.status}`, parsed: null };
    evidence.validation = { ok: validation.ok, reason: validation.reason || null };
    if (validation.parsed) evidence.usage = validation.parsed.usage ?? validation.parsed.meta ?? null;
    if (validation.ok) {
      const scores = validation.scores;
      evidence.raw_scores_by_original_index = scores;
      evidence.fingerprint = validation.fingerprint;
      evidence.sorted_session_ids = rankedSessionIds(work.materialCase, scores);
      evidence.provider_index_to_original_index = work.materialCase.retrieved_session_ids.map((_, index) => index);
    }
    atomicWriteJson(evidencePath, evidence);
    attempt.outcome = validation.ok ? "confirmed_valid" : "http_or_validation_failure";
    attempt.completed_at_ms = startedAtMs + latencyMs;
    attempt.latency_ms = latencyMs;
    attempt.evidence_path = evidencePath;
    attempt.validation_reason = validation.reason || null;
    state.inflight = null;
    if (validation.ok) {
      state.budget.valid_responses += 1;
      state.phases[work.phase].results.push({
        key: work.key,
        question_id: work.materialCase.question_id,
        attempt: attemptNumber,
        evidence_path: evidencePath,
        validation_ok: true,
        fingerprint: validation.fingerprint,
        request_latency_ms: latencyMs,
      });
    } else {
      state.budget.failed_responses += 1;
      state.stop = { reason: validation.reason || `http_${response.status}`, phase: work.phase, key: work.key, attempt: attemptNumber, evidence_path: evidencePath };
      state.status = "stopped";
    }
    saveState(statePath, state);
    if (!validation.ok) throw new Error(`locomo_runner_stopped:${validation.reason || "response_invalid"}`);
    if (Number.isSafeInteger(requestLimit) && requestLimit > 0 && state.budget.attempts >= requestLimit) {
      state.status = "paused";
      saveState(statePath, state);
      return { status: state.status, state_path: statePath, budget: state.budget };
    }
  }
}

function parseArgs(argv) {
  const args = { root: process.env.Q3_LOCOMO_ROOT || "/tmp/q3-locomo-v1.2", checkOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--root") {
      args.root = argv[++index];
      if (!args.root) throw new Error("--root requires a value");
    } else if (token === "--check-only") {
      args.checkOnly = true;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else {
      throw new Error(`unknown_argument:${token}`);
    }
  }
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log("Usage: node bin/run-locomo-rerank-v1.js [--root <experiment-root>] [--check-only]");
      process.exit(0);
    }
    const result = await runLocomoRerank({
      root: resolve(args.root),
      apiKey: args.checkOnly ? "check-only" : readProviderKey(),
      checkOnly: args.checkOnly,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`LOCOMO_RERANK_STOPPED ${error?.message || error}`);
    process.exitCode = 1;
  }
}
