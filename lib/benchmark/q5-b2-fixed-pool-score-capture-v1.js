import { createHash } from "node:crypto";

import { rerankCanonicalMemories } from "../recall/rerank/canonical-rerank-orchestrator.js";
import { projectCanonicalRerankTexts } from "../recall/rerank/canonical-text-projector.js";
import {
  createSiliconFlowRerankAdapter,
  preflightSiliconFlowRerankInput,
  qwen3Utf8ByteTokenUpperBound,
} from "../recall/rerank/siliconflow-rerank-adapter.js";
import { R3_C1_B_PROVIDER_PROFILE } from "../recall/hybrid/explicit-search-rerank-provider-policy.js";
import {
  C1A_MAX_CODE_POINTS_PER_CANDIDATE,
  C1A_MAX_TOTAL_CODE_POINTS,
} from "./c1a-locomo-qualification.js";
import { C1A_ADAPTER_DEADLINE_MS } from "./c1a-qualification-runner.js";

export const Q5_B2_CAPTURE_SCHEMA =
  "memory_engine_q5_b2_fixed_pool_score_capture_v1";
export const Q5_B2_PACKET_SCHEMA =
  "memory_engine_q5_b2_selection_signal_packet_v1";
export const Q5_B2_EXPECTED_B1_MANIFEST_SHA256 =
  "a4e3cadb8af68f2ec6a3016e42757a0025f6b1e81edf841aafff099a64d43d77";
export const Q5_B2_EXPECTED_CASE_COUNT = 512;
export const Q5_B2_PROVIDER_ATTEMPT_CAP = 512;
export const Q5_B2_API_KEY_ENV = "SILICONFLOW_API_KEY";
export const Q5_B2_RETRY_POLICY = "NO_RETRY_NO_RESUME_NO_REPLAY";

const ALLOWED_SPLITS = new Set(["development", "validation", "final_evaluation"]);
const ALLOWED_USAGE_KEYS = Object.freeze([
  "prompt_tokens",
  "completion_tokens",
  "input_tokens",
  "output_tokens",
  "total_tokens",
  "billed_input_tokens",
  "billed_output_tokens",
]);
const FORBIDDEN_KEYS = new Set([
  "gold",
  "gold_evidence_ids",
  "label",
  "labels",
  "relevance_label",
  "relevance_labels",
  "evaluator",
  "evaluator_only",
  "answer",
  "answers",
  "acceptance",
  "acceptance_case",
  "acceptance_label",
  "query",
  "text",
  "candidate_text",
  "memory_text",
  "documents",
  "prompt",
]);

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function sha256Json(value) {
  return sha256(JSON.stringify(value));
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function recursivelyRejectForbiddenKeys(value, path = "packet") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => recursivelyRejectForbiddenKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (
      FORBIDDEN_KEYS.has(normalized)
      || normalized.startsWith("gold_")
      || normalized.startsWith("evaluator_")
      || normalized.startsWith("acceptance_")
    ) {
      throw fail(`Q5_B2_FORBIDDEN_FIELD:${path}.${key}`);
    }
    recursivelyRejectForbiddenKeys(item, `${path}.${key}`);
  }
}

function exactCredential(env) {
  const value = typeof env?.[Q5_B2_API_KEY_ENV] === "string"
    ? env[Q5_B2_API_KEY_ENV].trim()
    : "";
  if (!value) throw fail("Q5_B2_CREDENTIAL_UNAVAILABLE");
  if (!value.startsWith("sk-")) throw fail("Q5_B2_CREDENTIAL_FORMAT_INVALID");
  return value;
}

function normalizeUsage(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw fail("Q5_B2_USAGE_INVALID");
  }
  const out = {};
  for (const key of ALLOWED_USAGE_KEYS) {
    const count = value[key];
    if (count === undefined || count === null) continue;
    if (!Number.isSafeInteger(count) || count < 0) throw fail("Q5_B2_USAGE_COUNT_INVALID");
    out[key] = count;
  }
  return Object.freeze(out);
}

function materialIndex(material) {
  if (!material || material.schema !== "memory_engine_r3_c1a_locomo_material_v1") {
    throw fail("Q5_B2_MATERIAL_SCHEMA_INVALID");
  }
  if (material.evidence_limitations?.production_equivalent_candidate_generation !== false) {
    throw fail("Q5_B2_PRODUCTION_EQUIVALENCE_BOUNDARY_INVALID");
  }
  if (!Array.isArray(material.cases) || material.cases.length !== 1970) {
    throw fail("Q5_B2_MATERIAL_CASE_COUNT_DRIFT");
  }
  return new Map(material.cases.map(row => [row.case_id, row]));
}

function validateManifest(manifest) {
  if (!manifest || manifest.schema !== "memory_engine_q5_b1_fixed_pool_score_capture_manifest_v1") {
    throw fail("Q5_B2_MANIFEST_SCHEMA_INVALID");
  }
  if (manifest.manifest_sha256 !== Q5_B2_EXPECTED_B1_MANIFEST_SHA256) {
    throw fail("Q5_B2_MANIFEST_IDENTITY_DRIFT");
  }
  if (manifest.provider_execution_authorized !== false || manifest.provider_requests !== 0) {
    throw fail("Q5_B2_MANIFEST_AUTHORITY_BOUNDARY_DRIFT");
  }
  if (manifest.provider !== R3_C1_B_PROVIDER_PROFILE.adapterIdentity.provider
      || manifest.model !== R3_C1_B_PROVIDER_PROFILE.adapterIdentity.model
      || manifest.revision !== R3_C1_B_PROVIDER_PROFILE.adapterIdentity.revision) {
    throw fail("Q5_B2_MANIFEST_PROVIDER_IDENTITY_DRIFT");
  }
  if (!Array.isArray(manifest.cases) || manifest.cases.length !== Q5_B2_EXPECTED_CASE_COUNT) {
    throw fail("Q5_B2_MANIFEST_CASE_COUNT_DRIFT");
  }
  const ids = new Set();
  for (const row of manifest.cases) {
    if (!row || typeof row.case_id !== "string" || ids.has(row.case_id)) {
      throw fail("Q5_B2_MANIFEST_CASE_ID_INVALID");
    }
    ids.add(row.case_id);
    if (!ALLOWED_SPLITS.has(row.split)) throw fail("Q5_B2_MANIFEST_SPLIT_INVALID");
  }
  return manifest;
}

function canonicalMemories(row) {
  return row.candidates.map(candidate => ({
    memory_id: candidate.id,
    source: {
      record_type: "chunk",
      record_id: candidate.id,
      text: candidate.text,
    },
  }));
}

function validateSelectedCase(manifestRow, materialRow) {
  if (!materialRow) throw fail("Q5_B2_SELECTED_CASE_MISSING");
  if (manifestRow.sample_id !== materialRow.sample_id) throw fail("Q5_B2_SAMPLE_ID_DRIFT");
  if (manifestRow.query_sha256 !== sha256(materialRow.query)) throw fail("Q5_B2_QUERY_HASH_DRIFT");
  if (manifestRow.candidate_count !== materialRow.candidates.length) {
    throw fail("Q5_B2_CANDIDATE_COUNT_DRIFT");
  }
  const ids = materialRow.candidates.map(row => row.id);
  const texts = materialRow.candidates.map(row => row.text);
  if (manifestRow.ordered_candidate_ids_sha256 !== sha256Json(ids)) {
    throw fail("Q5_B2_CANDIDATE_IDS_HASH_DRIFT");
  }
  if (manifestRow.canonical_texts_sha256 !== sha256Json(texts)) {
    throw fail("Q5_B2_CANONICAL_TEXTS_HASH_DRIFT");
  }
  if (manifestRow.control_top3_sha256 !== sha256Json(materialRow.control_top3)) {
    throw fail("Q5_B2_CONTROL_TOP3_HASH_DRIFT");
  }

  const memories = canonicalMemories(materialRow);
  const projection = projectCanonicalRerankTexts({
    memories,
    maxCodePointsPerCandidate: C1A_MAX_CODE_POINTS_PER_CANDIDATE,
    maxTotalCodePoints: C1A_MAX_TOTAL_CODE_POINTS,
  });
  if (sha256Json(projection.candidates.map(row => row.id))
      !== manifestRow.ordered_candidate_ids_sha256) {
    throw fail("Q5_B2_REPROJECTION_ID_DRIFT");
  }
  if (sha256Json(projection.candidates.map(row => row.text))
      !== manifestRow.canonical_texts_sha256) {
    throw fail("Q5_B2_REPROJECTION_TEXT_DRIFT");
  }

  const tokenPreflight = preflightSiliconFlowRerankInput({
    query: materialRow.query,
    documents: projection.candidates.map(candidate => candidate.text),
    tokenCounter: qwen3Utf8ByteTokenUpperBound,
  });

  return Object.freeze({
    manifest_row: manifestRow,
    material_row: materialRow,
    memories: Object.freeze(memories),
    projected_candidates: projection.candidates,
    projection_metadata: projection.metadata,
    estimated_input_tokens_upper_bound: tokenPreflight.estimatedRequestTokens,
  });
}

function prepareRows(manifest, material) {
  validateManifest(manifest);
  const byId = materialIndex(material);
  const rows = manifest.cases.map(row => validateSelectedCase(row, byId.get(row.case_id)));
  if (rows.length !== Q5_B2_EXPECTED_CASE_COUNT) throw fail("Q5_B2_PREPARED_CASE_COUNT_DRIFT");
  return Object.freeze(rows);
}

function buildCaptureRow(prepared, reranked) {
  if (reranked?.status !== "applied" || reranked.reason !== "complete") {
    throw fail("Q5_B2_RERANK_RESULT_NOT_COMPLETE");
  }
  const candidateIds = prepared.projected_candidates.map(row => row.id);
  if (!Array.isArray(reranked.orderedIds)
      || reranked.orderedIds.length !== candidateIds.length
      || new Set(reranked.orderedIds).size !== candidateIds.length) {
    throw fail("Q5_B2_RERANK_ORDER_INVALID");
  }
  const scores = reranked.scores;
  if (!scores || typeof scores !== "object" || Array.isArray(scores)) {
    throw fail("Q5_B2_RERANK_SCORES_INVALID");
  }
  const rerankRank = new Map(reranked.orderedIds.map((id, index) => [id, index + 1]));
  const projectionById = new Map((reranked.projectionMetadata || []).map(row => [row.id, row]));

  const candidates = prepared.projected_candidates.map((candidate, index) => {
    const score = scores[candidate.id];
    const meta = projectionById.get(candidate.id);
    if (!Number.isFinite(score)) throw fail("Q5_B2_RERANK_SCORE_MISSING");
    if (!meta) throw fail("Q5_B2_PROJECTION_METADATA_MISSING");
    return Object.freeze({
      id: candidate.id,
      pre_rerank_rank: index + 1,
      text_sha256: sha256(candidate.text),
      original_code_points: meta.originalCodePoints,
      output_code_points: meta.outputCodePoints,
      truncated: meta.truncated,
      rerank_score: Number(score),
      rerank_rank: rerankRank.get(candidate.id),
    });
  });

  return Object.freeze({
    case_id: prepared.manifest_row.case_id,
    sample_id: prepared.manifest_row.sample_id,
    split: prepared.manifest_row.split,
    selection_reason: prepared.manifest_row.selection_reason,
    query_sha256: prepared.manifest_row.query_sha256,
    candidate_count: candidates.length,
    candidates: Object.freeze(candidates),
    rerank_order_ids: Object.freeze([...reranked.orderedIds]),
    served_top3_ids: Object.freeze(reranked.orderedIds.slice(0, 3)),
    adapter_identity: Object.freeze({ ...reranked.adapterIdentity }),
    usage: normalizeUsage(reranked.usage),
  });
}

function buildPacket({ sourceCommit, manifest, cases }) {
  const body = {
    schema: Q5_B2_PACKET_SCHEMA,
    source_commit: sourceCommit,
    source_b1_manifest_sha256: manifest.manifest_sha256,
    provider: R3_C1_B_PROVIDER_PROFILE.adapterIdentity.provider,
    model: R3_C1_B_PROVIDER_PROFILE.adapterIdentity.model,
    revision: R3_C1_B_PROVIDER_PROFILE.adapterIdentity.revision,
    candidate_depth_max: 20,
    top_k: 3,
    contains_gold_fields: false,
    case_count: cases.length,
    cases: Object.freeze(cases),
  };
  recursivelyRejectForbiddenKeys(body);
  return Object.freeze({
    ...body,
    packet_sha256: sha256(JSON.stringify(body)),
  });
}

export function buildQ5B2PreflightV1({
  manifest,
  material,
  sourceCommit,
  env = process.env,
} = {}) {
  const rows = prepareRows(manifest, material);
  const credentialAvailable = (() => {
    try {
      exactCredential(env);
      return true;
    } catch {
      return false;
    }
  })();
  const bySplit = {};
  let tokenUpperBound = 0;
  let candidateCount = 0;
  for (const row of rows) {
    bySplit[row.manifest_row.split] = (bySplit[row.manifest_row.split] || 0) + 1;
    tokenUpperBound += row.estimated_input_tokens_upper_bound;
    candidateCount += row.projected_candidates.length;
  }
  return Object.freeze({
    schema: Q5_B2_CAPTURE_SCHEMA,
    status: "PASS",
    mode: "PREFLIGHT_ONLY",
    source_commit: sourceCommit,
    source_b1_manifest_sha256: manifest.manifest_sha256,
    planned_provider_calls: rows.length,
    provider_attempt_cap: Q5_B2_PROVIDER_ATTEMPT_CAP,
    split_counts: Object.freeze(bySplit),
    candidate_count_total: candidateCount,
    estimated_input_tokens_upper_bound: tokenUpperBound,
    provider: R3_C1_B_PROVIDER_PROFILE.adapterIdentity.provider,
    model: R3_C1_B_PROVIDER_PROFILE.adapterIdentity.model,
    revision: R3_C1_B_PROVIDER_PROFILE.adapterIdentity.revision,
    deadline_ms: C1A_ADAPTER_DEADLINE_MS,
    credential_env: Q5_B2_API_KEY_ENV,
    credential_available: credentialAvailable,
    retry_policy: Q5_B2_RETRY_POLICY,
    embedding_calls: 0,
    candidate_generation_runs: 0,
    hint_producer_calls: 0,
    model_training_runs: 0,
    runtime_mutation: false,
  });
}

export async function runQ5B2ScoreCaptureV1({
  manifest,
  material,
  sourceCommit,
  env = process.env,
  adapterFactory = createSiliconFlowRerankAdapter,
  onProviderAttempt = null,
} = {}) {
  const rows = prepareRows(manifest, material);
  const apiKey = exactCredential(env);
  const baseAdapter = adapterFactory({
    apiKey,
    model: R3_C1_B_PROVIDER_PROFILE.adapterIdentity.model,
  });
  if (typeof baseAdapter !== "function") throw fail("Q5_B2_ADAPTER_INVALID");

  let attempts = 0;
  let successes = 0;
  const wrappedAdapter = async (...args) => {
    attempts += 1;
    if (attempts > Q5_B2_PROVIDER_ATTEMPT_CAP) {
      throw fail("Q5_B2_PROVIDER_ATTEMPT_CAP_EXCEEDED");
    }
    if (typeof onProviderAttempt === "function") {
      await onProviderAttempt(Object.freeze({
        attempt: attempts,
        max_attempts: Q5_B2_PROVIDER_ATTEMPT_CAP,
      }));
    }
    const result = await baseAdapter(...args);
    successes += 1;
    return result;
  };
  Object.defineProperty(wrappedAdapter, "adapterIdentity", {
    value: baseAdapter.adapterIdentity,
    enumerable: true,
  });

  const captures = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let billedInputTokens = 0;
  let billedOutputTokens = 0;

  for (const row of rows) {
    const reranked = await rerankCanonicalMemories({
      query: row.material_row.query,
      memories: row.memories,
      maxCodePointsPerCandidate: C1A_MAX_CODE_POINTS_PER_CANDIDATE,
      maxTotalCodePoints: C1A_MAX_TOTAL_CODE_POINTS,
      deadlineMs: C1A_ADAPTER_DEADLINE_MS,
      adapter: wrappedAdapter,
    });
    const capture = buildCaptureRow(row, reranked);
    captures.push(capture);
    inputTokens += Number(capture.usage?.input_tokens ?? capture.usage?.prompt_tokens ?? 0);
    outputTokens += Number(capture.usage?.output_tokens ?? capture.usage?.completion_tokens ?? 0);
    totalTokens += Number(capture.usage?.total_tokens || 0);
    billedInputTokens += Number(capture.usage?.billed_input_tokens || 0);
    billedOutputTokens += Number(capture.usage?.billed_output_tokens || 0);
  }

  if (attempts !== Q5_B2_EXPECTED_CASE_COUNT || successes !== Q5_B2_EXPECTED_CASE_COUNT) {
    throw fail("Q5_B2_PROVIDER_CALL_COUNT_MISMATCH");
  }

  const packet = buildPacket({
    sourceCommit,
    manifest,
    cases: captures,
  });

  return Object.freeze({
    schema: Q5_B2_CAPTURE_SCHEMA,
    status: "PASS",
    mode: "REAL_FIXED_POOL_RERANK_SCORE_CAPTURE",
    source_commit: sourceCommit,
    source_b1_manifest_sha256: manifest.manifest_sha256,
    provider_attempts: attempts,
    provider_successes: successes,
    provider_attempt_cap: Q5_B2_PROVIDER_ATTEMPT_CAP,
    retry_policy: Q5_B2_RETRY_POLICY,
    provider_usage: Object.freeze({
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      billed_input_tokens: billedInputTokens,
      billed_output_tokens: billedOutputTokens,
    }),
    packet,
  });
}

export function validateQ5B2PacketV1(packet) {
  if (!packet || packet.schema !== Q5_B2_PACKET_SCHEMA) throw fail("Q5_B2_PACKET_SCHEMA_INVALID");
  recursivelyRejectForbiddenKeys(packet);
  if (packet.source_b1_manifest_sha256 !== Q5_B2_EXPECTED_B1_MANIFEST_SHA256) {
    throw fail("Q5_B2_PACKET_MANIFEST_DRIFT");
  }
  if (packet.provider !== R3_C1_B_PROVIDER_PROFILE.adapterIdentity.provider
      || packet.model !== R3_C1_B_PROVIDER_PROFILE.adapterIdentity.model
      || packet.revision !== R3_C1_B_PROVIDER_PROFILE.adapterIdentity.revision) {
    throw fail("Q5_B2_PACKET_PROVIDER_IDENTITY_DRIFT");
  }
  if (packet.contains_gold_fields !== false || packet.case_count !== Q5_B2_EXPECTED_CASE_COUNT) {
    throw fail("Q5_B2_PACKET_BOUNDARY_INVALID");
  }
  if (!Array.isArray(packet.cases) || packet.cases.length !== Q5_B2_EXPECTED_CASE_COUNT) {
    throw fail("Q5_B2_PACKET_CASE_COUNT_INVALID");
  }
  const ids = new Set();
  for (const row of packet.cases) {
    if (ids.has(row.case_id)) throw fail("Q5_B2_PACKET_CASE_DUPLICATE");
    ids.add(row.case_id);
    if (!ALLOWED_SPLITS.has(row.split)) throw fail("Q5_B2_PACKET_SPLIT_INVALID");
    if (!Number.isSafeInteger(row.candidate_count) || row.candidate_count < 1 || row.candidate_count > 20) {
      throw fail("Q5_B2_PACKET_CANDIDATE_COUNT_INVALID");
    }
    if (!Array.isArray(row.candidates) || row.candidates.length !== row.candidate_count) {
      throw fail("Q5_B2_PACKET_CANDIDATES_INVALID");
    }
    if (!Array.isArray(row.rerank_order_ids) || row.rerank_order_ids.length !== row.candidate_count) {
      throw fail("Q5_B2_PACKET_RERANK_ORDER_INVALID");
    }
    if (!Array.isArray(row.served_top3_ids)
        || JSON.stringify(row.served_top3_ids) !== JSON.stringify(row.rerank_order_ids.slice(0, 3))) {
      throw fail("Q5_B2_PACKET_TOP3_INVALID");
    }
    for (const candidate of row.candidates) {
      if (!Number.isFinite(candidate.rerank_score)) throw fail("Q5_B2_PACKET_SCORE_INVALID");
      if (!Number.isSafeInteger(candidate.pre_rerank_rank)
          || !Number.isSafeInteger(candidate.rerank_rank)) {
        throw fail("Q5_B2_PACKET_RANK_INVALID");
      }
    }
    normalizeUsage(row.usage);
  }
  const { packet_sha256: packetSha, ...body } = packet;
  if (packetSha !== sha256(JSON.stringify(body))) throw fail("Q5_B2_PACKET_HASH_MISMATCH");
  return Object.freeze({
    valid: true,
    case_count: packet.cases.length,
    packet_sha256: packet.packet_sha256,
  });
}
