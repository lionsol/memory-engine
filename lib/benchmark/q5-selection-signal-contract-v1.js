import { createHash } from "node:crypto";

import { R3_C1_B_PROVIDER_PROFILE } from "../recall/hybrid/explicit-search-rerank-provider-policy.js";

export const Q5_SELECTION_SIGNAL_SCHEMA =
  "memory_engine_q5_selection_signal_capture_v1";
export const Q5_SELECTION_SIGNAL_PROFILE =
  "q5_a3_fixed_pool_rerank_signal_capture_v1";
export const Q5_SELECTION_SIGNAL_TOP_K = 3;
export const Q5_SELECTION_SIGNAL_CANDIDATE_DEPTH = 20;

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

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function nonEmptyString(value, code) {
  if (typeof value !== "string" || value.trim() === "") throw fail(code);
  return value.trim();
}

function exactHex(value, length, code) {
  if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${length}}$`).test(value)) {
    throw fail(code);
  }
  return value;
}

function codePointLength(value) {
  return Array.from(String(value)).length;
}

function recursivelyRejectForbiddenKeys(value, path = "packet") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => recursivelyRejectForbiddenKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (FORBIDDEN_KEYS.has(normalized)
        || normalized.startsWith("gold_")
        || normalized.startsWith("evaluator_")
        || normalized.startsWith("acceptance_")) {
      throw fail(`Q5_A3_FORBIDDEN_FIELD:${path}.${key}`);
    }
    recursivelyRejectForbiddenKeys(item, `${path}.${key}`);
  }
}

function adapterIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw fail("Q5_A3_ADAPTER_IDENTITY_REQUIRED");
  }
  const provider = nonEmptyString(value.provider, "Q5_A3_ADAPTER_PROVIDER_REQUIRED");
  const model = nonEmptyString(value.model, "Q5_A3_ADAPTER_MODEL_REQUIRED");
  const revision = value.revision === null ? null : nonEmptyString(
    value.revision,
    "Q5_A3_ADAPTER_REVISION_INVALID",
  );
  const expected = R3_C1_B_PROVIDER_PROFILE.adapterIdentity;
  if (provider !== expected.provider || model !== expected.model || revision !== expected.revision) {
    throw fail("Q5_A3_ADAPTER_IDENTITY_DRIFT");
  }
  return Object.freeze({ provider, model, revision });
}

function normalizeProjectionMetadata(value, expectedIds) {
  if (!Array.isArray(value) || value.length !== expectedIds.length) {
    throw fail("Q5_A3_PROJECTION_METADATA_COUNT_MISMATCH");
  }
  return Object.freeze(value.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw fail("Q5_A3_PROJECTION_METADATA_INVALID");
    }
    if (row.id !== expectedIds[index]) throw fail("Q5_A3_PROJECTION_METADATA_ORDER_MISMATCH");
    if (!Number.isSafeInteger(row.originalCodePoints) || row.originalCodePoints < 0) {
      throw fail("Q5_A3_PROJECTION_ORIGINAL_LENGTH_INVALID");
    }
    if (!Number.isSafeInteger(row.outputCodePoints) || row.outputCodePoints < 0) {
      throw fail("Q5_A3_PROJECTION_OUTPUT_LENGTH_INVALID");
    }
    if (typeof row.truncated !== "boolean") throw fail("Q5_A3_PROJECTION_TRUNCATED_INVALID");
    return Object.freeze({
      id: row.id,
      original_code_points: row.originalCodePoints,
      output_code_points: row.outputCodePoints,
      truncated: row.truncated,
    });
  }));
}

function normalizeScores(scores, candidateIds) {
  if (!scores || typeof scores !== "object" || Array.isArray(scores)) {
    throw fail("Q5_A3_SCORES_REQUIRED");
  }
  const keys = Object.keys(scores);
  if (keys.length !== candidateIds.length || new Set(keys).size !== candidateIds.length) {
    throw fail("Q5_A3_SCORE_KEY_COUNT_MISMATCH");
  }
  const candidateSet = new Set(candidateIds);
  const out = new Map();
  for (const id of keys) {
    if (!candidateSet.has(id)) throw fail("Q5_A3_SCORE_UNKNOWN_CANDIDATE");
    const score = scores[id];
    if (!Number.isFinite(score)) throw fail("Q5_A3_SCORE_MUST_BE_FINITE");
    out.set(id, Number(score));
  }
  return out;
}

function normalizeOrderedIds(value, candidateIds) {
  if (!Array.isArray(value) || value.length !== candidateIds.length) {
    throw fail("Q5_A3_RERANK_ORDER_COUNT_MISMATCH");
  }
  const ids = value.map(String);
  if (new Set(ids).size !== ids.length) throw fail("Q5_A3_RERANK_ORDER_DUPLICATE");
  const expected = new Set(candidateIds);
  if (ids.some(id => !expected.has(id))) throw fail("Q5_A3_RERANK_ORDER_UNKNOWN_ID");
  return Object.freeze(ids);
}

function normalizeUsage(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw fail("Q5_A3_USAGE_INVALID");
  }
  const allowed = [
    "prompt_tokens",
    "completion_tokens",
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "billed_input_tokens",
    "billed_output_tokens",
  ];
  const out = {};
  for (const field of allowed) {
    const count = value[field];
    if (count === undefined || count === null) continue;
    if (!Number.isSafeInteger(count) || count < 0) {
      throw fail("Q5_A3_USAGE_COUNT_INVALID");
    }
    out[field] = count;
  }
  return Object.freeze(out);
}

export function buildQ5SelectionSignalCaptureCaseV1({
  sourceName,
  caseId,
  arm,
  query,
  preRerankCandidates,
  projectionMetadata,
  rerankResult,
} = {}) {
  const normalizedSourceName = nonEmptyString(sourceName, "Q5_A3_SOURCE_NAME_REQUIRED");
  const normalizedCaseId = nonEmptyString(caseId, "Q5_A3_CASE_ID_REQUIRED");
  if (!["baseline", "hint"].includes(arm)) throw fail("Q5_A3_ARM_INVALID");
  const normalizedQuery = nonEmptyString(query, "Q5_A3_QUERY_REQUIRED");

  if (!Array.isArray(preRerankCandidates)
      || preRerankCandidates.length === 0
      || preRerankCandidates.length > Q5_SELECTION_SIGNAL_CANDIDATE_DEPTH) {
    throw fail("Q5_A3_CANDIDATE_COUNT_INVALID");
  }

  const candidateIds = [];
  const candidateTexts = new Map();
  for (const [index, row] of preRerankCandidates.entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw fail("Q5_A3_CANDIDATE_INVALID");
    }
    const id = nonEmptyString(row.id, "Q5_A3_CANDIDATE_ID_REQUIRED");
    const text = nonEmptyString(row.text, "Q5_A3_CANDIDATE_TEXT_REQUIRED");
    if (candidateTexts.has(id)) throw fail("Q5_A3_CANDIDATE_ID_DUPLICATE");
    candidateIds.push(id);
    candidateTexts.set(id, text);
    if (index >= Q5_SELECTION_SIGNAL_CANDIDATE_DEPTH) throw fail("Q5_A3_CANDIDATE_DEPTH_EXCEEDED");
  }

  if (!rerankResult || typeof rerankResult !== "object" || Array.isArray(rerankResult)) {
    throw fail("Q5_A3_RERANK_RESULT_REQUIRED");
  }
  if (rerankResult.status !== "applied" || rerankResult.reason !== "complete") {
    throw fail("Q5_A3_RERANK_RESULT_NOT_COMPLETE");
  }

  const projection = normalizeProjectionMetadata(projectionMetadata, candidateIds);
  const orderedIds = normalizeOrderedIds(rerankResult.orderedIds, candidateIds);
  const scoreMap = normalizeScores(rerankResult.scores, candidateIds);
  const identity = adapterIdentity(rerankResult.adapterIdentity);
  const usage = normalizeUsage(rerankResult.usage);
  const rerankRank = new Map(orderedIds.map((id, index) => [id, index + 1]));

  const candidates = candidateIds.map((id, index) => {
    const text = candidateTexts.get(id);
    const projectionRow = projection[index];
    return Object.freeze({
      id,
      pre_rerank_rank: index + 1,
      text_sha256: sha256(text),
      original_code_points: projectionRow.original_code_points,
      output_code_points: projectionRow.output_code_points,
      truncated: projectionRow.truncated,
      rerank_score: scoreMap.get(id),
      rerank_rank: rerankRank.get(id),
    });
  });

  return Object.freeze({
    source_name: normalizedSourceName,
    case_id: normalizedCaseId,
    arm,
    query_sha256: sha256(normalizedQuery),
    candidate_count: candidates.length,
    candidates: Object.freeze(candidates),
    rerank_order_ids: orderedIds,
    served_top3_ids: Object.freeze(orderedIds.slice(0, Q5_SELECTION_SIGNAL_TOP_K)),
    adapter_identity: identity,
    usage,
  });
}

export function buildQ5SelectionSignalPacketV1({
  sourceCommit,
  fixtureSha256,
  cases,
} = {}) {
  exactHex(sourceCommit, 40, "Q5_A3_SOURCE_COMMIT_INVALID");
  exactHex(fixtureSha256, 64, "Q5_A3_FIXTURE_SHA_INVALID");
  if (!Array.isArray(cases) || cases.length === 0) throw fail("Q5_A3_CASES_REQUIRED");

  const body = {
    schema: Q5_SELECTION_SIGNAL_SCHEMA,
    profile: Q5_SELECTION_SIGNAL_PROFILE,
    source_commit: sourceCommit,
    fixture_sha256: fixtureSha256,
    top_k: Q5_SELECTION_SIGNAL_TOP_K,
    candidate_depth: Q5_SELECTION_SIGNAL_CANDIDATE_DEPTH,
    contains_gold_fields: false,
    cases: Object.freeze(cases),
  };
  recursivelyRejectForbiddenKeys(body);

  const packet = Object.freeze({
    ...body,
    packet_sha256: sha256(JSON.stringify(body)),
  });
  validateQ5SelectionSignalPacketV1(packet);
  return packet;
}

export function validateQ5SelectionSignalPacketV1(packet) {
  if (!packet || packet.schema !== Q5_SELECTION_SIGNAL_SCHEMA) {
    throw fail("Q5_A3_PACKET_SCHEMA_INVALID");
  }
  recursivelyRejectForbiddenKeys(packet);
  exactHex(packet.source_commit, 40, "Q5_A3_PACKET_SOURCE_COMMIT_INVALID");
  exactHex(packet.fixture_sha256, 64, "Q5_A3_PACKET_FIXTURE_SHA_INVALID");
  if (packet.profile !== Q5_SELECTION_SIGNAL_PROFILE) throw fail("Q5_A3_PACKET_PROFILE_INVALID");
  if (packet.top_k !== Q5_SELECTION_SIGNAL_TOP_K) throw fail("Q5_A3_PACKET_TOPK_DRIFT");
  if (packet.candidate_depth !== Q5_SELECTION_SIGNAL_CANDIDATE_DEPTH) {
    throw fail("Q5_A3_PACKET_CANDIDATE_DEPTH_DRIFT");
  }
  if (packet.contains_gold_fields !== false) throw fail("Q5_A3_PACKET_GOLD_BOUNDARY_INVALID");
  if (!Array.isArray(packet.cases) || packet.cases.length === 0) throw fail("Q5_A3_PACKET_CASES_REQUIRED");

  const identities = new Set();
  for (const row of packet.cases) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw fail("Q5_A3_PACKET_CASE_INVALID");
    nonEmptyString(row.source_name, "Q5_A3_PACKET_SOURCE_NAME_REQUIRED");
    nonEmptyString(row.case_id, "Q5_A3_PACKET_CASE_ID_REQUIRED");
    if (!["baseline", "hint"].includes(row.arm)) throw fail("Q5_A3_PACKET_ARM_INVALID");
    const identity = `${row.source_name}\0${row.case_id}\0${row.arm}`;
    if (identities.has(identity)) throw fail("Q5_A3_PACKET_CASE_DUPLICATE");
    identities.add(identity);
    exactHex(row.query_sha256, 64, "Q5_A3_PACKET_QUERY_SHA_INVALID");

    if (!Number.isSafeInteger(row.candidate_count)
        || row.candidate_count < 1
        || row.candidate_count > Q5_SELECTION_SIGNAL_CANDIDATE_DEPTH) {
      throw fail("Q5_A3_PACKET_CANDIDATE_COUNT_INVALID");
    }
    if (!Array.isArray(row.candidates) || row.candidates.length !== row.candidate_count) {
      throw fail("Q5_A3_PACKET_CANDIDATE_ROWS_INVALID");
    }

    const ids = row.candidates.map(candidate => candidate.id);
    if (new Set(ids).size !== ids.length) throw fail("Q5_A3_PACKET_CANDIDATE_ID_DUPLICATE");
    for (const [index, candidate] of row.candidates.entries()) {
      nonEmptyString(candidate.id, "Q5_A3_PACKET_CANDIDATE_ID_REQUIRED");
      if (candidate.pre_rerank_rank !== index + 1) throw fail("Q5_A3_PACKET_PRE_RANK_INVALID");
      exactHex(candidate.text_sha256, 64, "Q5_A3_PACKET_TEXT_SHA_INVALID");
      if (!Number.isSafeInteger(candidate.original_code_points) || candidate.original_code_points < 0) {
        throw fail("Q5_A3_PACKET_ORIGINAL_LENGTH_INVALID");
      }
      if (!Number.isSafeInteger(candidate.output_code_points) || candidate.output_code_points < 0) {
        throw fail("Q5_A3_PACKET_OUTPUT_LENGTH_INVALID");
      }
      if (typeof candidate.truncated !== "boolean") throw fail("Q5_A3_PACKET_TRUNCATED_INVALID");
      if (!Number.isFinite(candidate.rerank_score)) throw fail("Q5_A3_PACKET_SCORE_INVALID");
      if (!Number.isSafeInteger(candidate.rerank_rank)
          || candidate.rerank_rank < 1
          || candidate.rerank_rank > row.candidate_count) {
        throw fail("Q5_A3_PACKET_RERANK_RANK_INVALID");
      }
    }

    const orderedIds = normalizeOrderedIds(row.rerank_order_ids, ids);
    const rankMap = new Map(row.candidates.map(candidate => [candidate.id, candidate.rerank_rank]));
    for (const [index, id] of orderedIds.entries()) {
      if (rankMap.get(id) !== index + 1) throw fail("Q5_A3_PACKET_RERANK_ORDER_RANK_MISMATCH");
    }
    if (!Array.isArray(row.served_top3_ids)
        || JSON.stringify(row.served_top3_ids) !== JSON.stringify(orderedIds.slice(0, Q5_SELECTION_SIGNAL_TOP_K))) {
      throw fail("Q5_A3_PACKET_SERVED_TOP3_MISMATCH");
    }
    adapterIdentity(row.adapter_identity);
    normalizeUsage(row.usage);
  }

  const { packet_sha256: packetSha256, ...body } = packet;
  if (packetSha256 !== sha256(JSON.stringify(body))) throw fail("Q5_A3_PACKET_HASH_MISMATCH");

  return Object.freeze({
    valid: true,
    case_count: packet.cases.length,
    packet_sha256: packet.packet_sha256,
  });
}
