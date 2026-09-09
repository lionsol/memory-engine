import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import {
  buildFtsFallbackQuery,
  extractExactQueryFragments,
  extractFtsFallbackTerms,
  normalizeFtsQuery,
  stripPromptMetadataPrefix,
} from "../../query-utils.js";
import { collectFtsCandidates } from "../recall/hybrid/channels/fts.js";
import { fuseChannels } from "../recall/hybrid/fusion.js";
import {
  isCandidateAllowedForRerank,
  isRetrievalExcludedPath,
  normalizeExternalMemory,
} from "../recall/hybrid/normalize-candidate.js";
import { enrichLexicalCandidate, tokenizeQuery } from "../recall/hybrid/lexical.js";
import {
  createCandidateCounts,
  createHybridDebug,
} from "../recall/hybrid/debug.js";

export const LOCOMO_CHUNK_CANDIDATE_SCHEMA = "q3_locomo_chunk_candidate_manifest_v1";
export const LOCOMO_CHUNK_CANDIDATE_PROFILE_ID = "q3_locomo_chunk_fts_only_v1";
export const LOCOMO_CHUNK_CANDIDATE_INDEX_SCHEMA = "q3_locomo_chunk_fts5_index_v1";
export const LOCOMO_CHUNK_CANDIDATE_CONTRACT_SOURCE_COMMIT = "aa2e65ffa2f04d991026d03bc97aebecce944412";

const REQUIRED_LIFECYCLE_FIELDS = [
  "management",
  "category",
  "initial_confidence",
  "confidence",
  "last_confidence_update",
  "base_tau_days",
  "hit_count",
  "archived",
  "protected",
  "conflict",
];

const REQUIRED_SOURCE_FIELDS = [
  "record_type",
  "record_id",
  "path",
  "core_source",
  "line_start",
  "line_end",
  "text",
  "core_hash",
  "updated_at",
];

const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;

const RANKING_CONFIG = Object.freeze({
  recencyBoost: Object.freeze({ base: 0.06, decayDays: 2.5 }),
  categoryBoost: Object.freeze({
    managed: Object.freeze({ episodic: 0.12, sessionCheckpoint: 0.1 }),
    external: Object.freeze({
      core_profile: 0.06,
      project: 0.05,
      daily_journal: 0.02,
      dreaming: 0,
      stats: -0.05,
      external: 0.03,
    }),
  }),
  externalBoost: Object.freeze({ value: 0.05, excludedCategories: ["dreaming", "stats"] }),
  confidenceWeight: 0.1,
});

export const LOCOMO_CHUNK_FTS_ONLY_PROFILE = Object.freeze({
  profile_id: LOCOMO_CHUNK_CANDIDATE_PROFILE_ID,
  index_schema: LOCOMO_CHUNK_CANDIDATE_INDEX_SCHEMA,
  contract_source_commit: LOCOMO_CHUNK_CANDIDATE_CONTRACT_SOURCE_COMMIT,
  candidate_depth: 50,
  fts_top_k: 50,
  fts_tie_break: "bm25_asc_then_memory_id_asc",
  min_confidence: 0.15,
  lexical_confidence_threshold: 0.7,
  rrf_k: 60,
  benchmark_now_sec: 1705066861,
  channels: Object.freeze({
    fts: true,
    kg: false,
    recent: false,
    vector: false,
  }),
  vector_query_plan: null,
  ranking_config: RANKING_CONFIG,
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}_must_be_nonempty_string`);
  }
  return value;
}

function requireRecord(value, label) {
  if (!isRecord(value)) throw new Error(`${label}_must_be_record`);
  return value;
}

function requireOwn(value, key, label) {
  if (!hasOwn(value, key) || value[key] === undefined) {
    throw new Error(`${label}_${key}_missing`);
  }
  return value[key];
}

function requireSafeInteger(value, label, { minimum = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label}_must_be_safe_integer`);
  }
  return value;
}

function requireNullableFiniteNumber(value, label) {
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(`${label}_must_be_finite_number_or_null`);
  }
  return value;
}

function requireNullableSafeInteger(value, label, { minimum = 0 } = {}) {
  if (value !== null && (!Number.isSafeInteger(value) || value < minimum)) {
    throw new Error(`${label}_must_be_safe_integer_or_null`);
  }
  return value;
}

function validateRepositoryProvenance(value) {
  const provenance = requireRecord(value, "candidate_execution_source");
  const commit = requireNonEmptyString(
    provenance.repository_commit,
    "candidate_execution_source_repository_commit",
  );
  if (!GIT_COMMIT_PATTERN.test(commit)) {
    throw new Error("candidate_execution_source_commit_invalid");
  }
  if (typeof provenance.repository_worktree_clean !== "boolean") {
    throw new Error("candidate_execution_source_worktree_state_invalid");
  }
  if (provenance.repository_provenance_source !== "git") {
    throw new Error("candidate_execution_source_provenance_source_invalid");
  }
  return {
    repository_commit: commit,
    repository_worktree_clean: provenance.repository_worktree_clean,
    repository_provenance_source: "git",
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateProfile(profile) {
  requireRecord(profile, "candidate_profile");
  if (profile.profile_id !== LOCOMO_CHUNK_CANDIDATE_PROFILE_ID) {
    throw new Error("candidate_profile_id_invalid");
  }
  if (profile.index_schema !== LOCOMO_CHUNK_CANDIDATE_INDEX_SCHEMA) {
    throw new Error("candidate_profile_index_schema_invalid");
  }
  if (profile.contract_source_commit !== LOCOMO_CHUNK_CANDIDATE_CONTRACT_SOURCE_COMMIT) {
    throw new Error("candidate_profile_contract_source_commit_invalid");
  }
  if (profile.candidate_depth !== 50 || profile.fts_top_k !== 50) {
    throw new Error("candidate_profile_depth_must_be_50");
  }
  if (profile.fts_tie_break !== "bm25_asc_then_memory_id_asc") {
    throw new Error("candidate_profile_tie_break_invalid");
  }
  if (profile.min_confidence !== 0.15 || profile.lexical_confidence_threshold !== 0.7) {
    throw new Error("candidate_profile_thresholds_invalid");
  }
  if (profile.rrf_k !== 60 || profile.benchmark_now_sec !== 1705066861) {
    throw new Error("candidate_profile_clock_or_fusion_invalid");
  }
  const channels = requireRecord(profile.channels, "candidate_profile_channels");
  for (const [name, expected] of Object.entries({ fts: true, kg: false, recent: false, vector: false })) {
    if (channels[name] !== expected) throw new Error(`candidate_profile_channel_${name}_invalid`);
  }
  if (profile.vector_query_plan !== null) throw new Error("candidate_profile_vector_plan_must_be_null");
  requireRecord(profile.ranking_config, "candidate_profile_ranking_config");
  if (stableJson(profile.ranking_config) !== stableJson(RANKING_CONFIG)) {
    throw new Error("candidate_profile_ranking_config_invalid");
  }
  return profile;
}

function validateMaterialChunk(chunk, index) {
  const row = requireRecord(chunk, `material_chunk:${index}`);
  const sampleId = requireNonEmptyString(row.sampleId, `material_chunk:${index}:sample_id`);
  const memoryId = requireNonEmptyString(row.memoryId, `material_chunk:${index}:memory_id`);
  const text = requireNonEmptyString(row.text, `material_chunk:${index}:text`);
  const hash = requireNonEmptyString(row.hash, `material_chunk:${index}:hash`);
  if (sha256(text) !== hash) throw new Error(`material_chunk:${index}:hash_mismatch`);
  const source = requireRecord(row.source, `material_chunk:${index}:source`);
  if (source.recordType !== "chunk") throw new Error(`material_chunk:${index}:record_type_invalid`);
  if (source.recordId !== memoryId) throw new Error(`material_chunk:${index}:record_id_mismatch`);
  requireNonEmptyString(source.path, `material_chunk:${index}:source_path`);
  requireNonEmptyString(source.coreSource, `material_chunk:${index}:core_source`);
  requireSafeInteger(row.startLine, `material_chunk:${index}:start_line`, { minimum: 1 });
  requireSafeInteger(row.endLine, `material_chunk:${index}:end_line`, { minimum: row.startLine });
  return { row, sampleId, memoryId, text, hash, source };
}

function validateCanonicalMemory(canonical, material, index) {
  const memory = requireRecord(canonical, `canonical_memory:${index}`);
  const memoryId = requireNonEmptyString(memory.memory_id, `canonical_memory:${index}:memory_id`);
  if (memoryId !== material.memoryId) throw new Error(`canonical_memory:${index}:memory_id_mismatch`);
  const source = requireRecord(memory.source, `canonical_memory:${index}:source`);
  for (const key of REQUIRED_SOURCE_FIELDS) requireOwn(source, key, `canonical_memory:${index}:source`);
  if (source.record_type !== "chunk") throw new Error(`canonical_memory:${index}:record_type_invalid`);
  if (source.record_id !== memoryId) throw new Error(`canonical_memory:${index}:record_id_mismatch`);
  if (source.path !== material.source.path) throw new Error(`canonical_memory:${index}:path_mismatch`);
  if (source.core_source !== material.source.coreSource) throw new Error(`canonical_memory:${index}:core_source_mismatch`);
  if (source.line_start !== material.row.startLine || source.line_end !== material.row.endLine) {
    throw new Error(`canonical_memory:${index}:line_range_mismatch`);
  }
  if (source.text !== material.text) throw new Error(`canonical_memory:${index}:text_mismatch`);
  if (source.core_hash !== material.hash) throw new Error(`canonical_memory:${index}:core_hash_mismatch`);
  if (typeof source.updated_at !== "number" && source.updated_at !== null) {
    throw new Error(`canonical_memory:${index}:updated_at_invalid`);
  }
  const lifecycle = requireRecord(memory.lifecycle, `canonical_memory:${index}:lifecycle`);
  for (const key of REQUIRED_LIFECYCLE_FIELDS) requireOwn(lifecycle, key, `canonical_memory:${index}:lifecycle`);
  if (!["managed", "external"].includes(lifecycle.management)) {
    throw new Error(`canonical_memory:${index}:management_invalid`);
  }
  if (lifecycle.management === "external") {
    if (lifecycle.category !== null) throw new Error(`canonical_memory:${index}:external_category_must_be_null`);
    if (lifecycle.archived !== null) throw new Error(`canonical_memory:${index}:external_archived_must_be_null`);
    if (lifecycle.protected !== null) throw new Error(`canonical_memory:${index}:external_protected_must_be_null`);
    if (lifecycle.conflict !== null) throw new Error(`canonical_memory:${index}:external_conflict_must_be_null`);
    requireNullableFiniteNumber(lifecycle.initial_confidence, `canonical_memory:${index}:initial_confidence`);
    requireNullableFiniteNumber(lifecycle.confidence, `canonical_memory:${index}:confidence`);
    requireNullableFiniteNumber(lifecycle.last_confidence_update, `canonical_memory:${index}:last_confidence_update`);
    requireNullableFiniteNumber(lifecycle.base_tau_days, `canonical_memory:${index}:base_tau_days`);
    requireNullableSafeInteger(lifecycle.hit_count, `canonical_memory:${index}:hit_count`);
  } else {
    if (typeof lifecycle.archived !== "boolean") throw new Error(`canonical_memory:${index}:archived_invalid`);
    if (typeof lifecycle.protected !== "boolean") throw new Error(`canonical_memory:${index}:protected_invalid`);
    if (typeof lifecycle.conflict !== "boolean") throw new Error(`canonical_memory:${index}:conflict_invalid`);
    requireNullableFiniteNumber(lifecycle.initial_confidence, `canonical_memory:${index}:initial_confidence`);
    requireNullableFiniteNumber(lifecycle.confidence, `canonical_memory:${index}:confidence`);
    requireNullableFiniteNumber(lifecycle.last_confidence_update, `canonical_memory:${index}:last_confidence_update`);
    requireNullableFiniteNumber(lifecycle.base_tau_days, `canonical_memory:${index}:base_tau_days`);
    requireSafeInteger(lifecycle.hit_count, `canonical_memory:${index}:hit_count`);
  }
  if (lifecycle.management === "managed" && lifecycle.confidence === null) {
    throw new Error(`canonical_memory:${index}:managed_confidence_missing`);
  }
  const classification = requireRecord(memory.classification, `canonical_memory:${index}:classification`);
  requireNonEmptyString(classification.category, `canonical_memory:${index}:classification_category`);
  return memory;
}

export function validateLocomoChunkCanonicalMapping({ materialChunks, canonicalMemories } = {}) {
  if (!Array.isArray(materialChunks)) throw new Error("candidate_material_chunks_must_be_array");
  if (!Array.isArray(canonicalMemories)) throw new Error("candidate_canonical_memories_must_be_array");
  const materialById = new Map();
  for (const [index, chunk] of materialChunks.entries()) {
    const normalized = validateMaterialChunk(chunk, index);
    if (materialById.has(normalized.memoryId)) throw new Error(`duplicate_material_memory_id:${normalized.memoryId}`);
    materialById.set(normalized.memoryId, normalized);
  }
  const memoryById = new Map();
  for (const [index, canonical] of canonicalMemories.entries()) {
    const memoryId = canonical?.memory_id;
    if (memoryById.has(memoryId)) throw new Error(`duplicate_canonical_memory_id:${memoryId}`);
    const material = materialById.get(memoryId);
    if (!material) throw new Error(`canonical_material_mapping_missing:${memoryId}`);
    const memory = validateCanonicalMemory(canonical, material, index);
    memoryById.set(memoryId, {
      sampleId: material.sampleId,
      canonical: memory,
    });
  }
  if (memoryById.size !== materialById.size) {
    const missing = [...materialById.keys()].find(id => !memoryById.has(id));
    throw new Error(`material_canonical_mapping_missing:${missing}`);
  }
  return { materialById, memoryById };
}

function validateCase(item, index) {
  const row = requireRecord(item, `case:${index}`);
  const questionId = requireNonEmptyString(row.question_id, `case:${index}:question_id`);
  const sampleId = requireNonEmptyString(row.sample_id, `case:${index}:sample_id`);
  const question = requireNonEmptyString(row.question, `case:${index}:question`);
  requireSafeInteger(row.qa_index, `case:${index}:qa_index`);
  return { questionId, sampleId, question, qaIndex: row.qa_index };
}

function createIndexDatabase(indexPath) {
  const db = new Database(indexPath);
  db.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      sample_id TEXT NOT NULL,
      path TEXT NOT NULL,
      source TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT NOT NULL,
      model TEXT,
      text TEXT NOT NULL,
      embedding TEXT,
      updated_at INTEGER
    );
    CREATE VIRTUAL TABLE chunks_fts USING fts5(
      text,
      id UNINDEXED,
      path UNINDEXED,
      source UNINDEXED,
      model UNINDEXED,
      start_line UNINDEXED,
      end_line UNINDEXED
    );
  `);
  return db;
}

function materializeCanonicalRow({ sampleId, memory }) {
  const lifecycle = memory.lifecycle;
  const source = memory.source;
  return {
    id: memory.memory_id,
    sample_id: sampleId,
    path: source.path,
    source: source.core_source,
    start_line: source.line_start,
    end_line: source.line_end,
    hash: source.core_hash,
    model: null,
    text: source.text,
    embedding: null,
    updated_at: source.updated_at,
    confidence: lifecycle.management === "managed" ? lifecycle.confidence : null,
    confidence_realtime: lifecycle.management === "managed" ? lifecycle.confidence : null,
    last_confidence_update: lifecycle.last_confidence_update,
    base_tau: lifecycle.base_tau_days,
    hit_count: lifecycle.hit_count,
    is_archived: lifecycle.archived ? 1 : 0,
    is_protected: lifecycle.protected ? 1 : 0,
    conflict_flag: lifecycle.conflict ? 1 : 0,
    category: lifecycle.category ?? memory.classification.category,
  };
}

function classifyStaticExclusion(memory, minConfidence) {
  const sourcePath = memory.source.path.replace(/\\/g, "/");
  if (isRetrievalExcludedPath(sourcePath)) return "retrieval_excluded";
  if (memory.lifecycle.archived) return "canonical_archived";
  if (memory.lifecycle.management === "managed" && memory.lifecycle.confidence < minConfidence) {
    return "below_min_confidence";
  }
  return null;
}

function incrementReason(target, reason, count = 1) {
  if (count <= 0) return;
  target[reason] = (target[reason] || 0) + count;
}

function makeCaseQueryContext({ item, profile, db, confidenceMap }) {
  const strippedQuery = stripPromptMetadataPrefix(item.question);
  const normalizedQuery = normalizeFtsQuery(strippedQuery);
  const fallbackFtsQuery = buildFtsFallbackQuery(strippedQuery);
  const queryTerms = tokenizeQuery(normalizedQuery);
  const exactFragments = extractExactQueryFragments(strippedQuery, 8);
  const fallbackRerankTerms = extractFtsFallbackTerms(fallbackFtsQuery);
  const candidateCounts = createCandidateCounts();
  const debug = createHybridDebug({
    rawQuery: item.question,
    strippedQuery,
    normalizedQuery,
    queryTerms,
    candidateCounts,
    minConfidence: profile.min_confidence,
    lexicalConfidenceThreshold: profile.lexical_confidence_threshold,
  });
  const channels = {};
  return {
    withCoreDb: callback => callback(db),
    ftsAccessMode: "isolated",
    confidenceMap,
    channels,
    debug,
    candidateCounts,
    normalizedQuery,
    fallbackFtsQuery,
    fallbackRerankTerms,
    strippedQuery,
    queryTerms,
    exactFragments,
    sampleId: item.sampleId,
    stableFtsOrder: true,
    nowSec: profile.benchmark_now_sec,
    ftsTopK: profile.fts_top_k,
    normalizeCandidate: row => normalizeExternalMemory(row, {
      nowSec: profile.benchmark_now_sec,
      categoryMap: null,
    }),
    filterForRerank: candidate => isCandidateAllowedForRerank(candidate, profile.min_confidence),
    enrichLexicalCandidate,
    toDebugErrorMessage: error => String(error?.message || error),
    warnHybridSearchOnce: () => {},
  };
}

function buildCaseOutput({ item, profile, context, memoryById }) {
  const ftsItems = context.channels.fts || [];
  const originalRank = new Map(ftsItems.map((candidate, index) => [candidate.id, index]));
  const fused = fuseChannels(
    { fts: ftsItems },
    {
      rrfK: profile.rrf_k,
      nowSec: profile.benchmark_now_sec,
      rankingConfig: profile.ranking_config,
    },
  ).fused;
  const ranked = fused
    .toSorted((left, right) => (
      right.finalScore - left.finalScore
      || (originalRank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (originalRank.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    ))
    .slice(0, profile.candidate_depth);
  const staticExclusions = {};
  let eligibleBeforeQuery = 0;
  for (const memory of memoryById.values()) {
    if (memory.sampleId !== item.sampleId) continue;
    const reason = classifyStaticExclusion(memory.canonical, profile.min_confidence);
    if (reason) incrementReason(staticExclusions, reason);
    else eligibleBeforeQuery += 1;
  }
  incrementReason(staticExclusions, "not_in_fts_top_k_or_query", eligibleBeforeQuery - ranked.length);
  return {
    question_id: item.questionId,
    sample_id: item.sampleId,
    qa_index: item.qaIndex,
    query_sha256: sha256(item.question),
    scope: {
      column: "chunks.sample_id",
      value: item.sampleId,
      isolation: "sample_exact_match",
    },
    channel_usage: { fts: 1, kg: 0, recent: 0, vector: 0 },
    candidate_ids: ranked.map(candidate => candidate.id),
    candidates: ranked.map((candidate, rank) => ({
      rank: rank + 1,
      memory_id: candidate.id,
      final_score: candidate.finalScore,
      fts_score: candidate.semanticScore,
      source: memoryById.get(candidate.id)?.canonical.source.path ?? null,
    })),
    candidate_count: ranked.length,
    eligible_before_query_count: eligibleBeforeQuery,
    excluded_count: Object.values(staticExclusions).reduce((sum, count) => sum + count, 0),
    excluded_reasons: staticExclusions,
    diagnostics: {
      fts_query_final: context.debug.fts_query_final ?? null,
      fts_raw_primary: context.candidateCounts.fts_raw_primary || 0,
      fts_raw_final: context.candidateCounts.fts_raw_final || 0,
      candidate_depth: profile.candidate_depth,
    },
  };
}

function writeArtifact(filePath, value) {
  writeFileSync(filePath, typeof value === "string" ? value : stableJson(value), "utf8");
}

function caseIdentity(item) {
  return {
    question_id: item.questionId,
    sample_id: item.sampleId,
    qa_index: item.qaIndex,
    query_sha256: sha256(item.question),
  };
}

function buildFtsFailureDiagnostic({
  item,
  context,
  caseIndex,
  completedCases,
  plannedCaseCount,
  profile,
  materialIdentity,
  executionSource,
}) {
  return {
    schema: "q3_locomo_chunk_candidate_failure_v1",
    status: "failed",
    failure_stage: "fts_query",
    failure_reason: "fts_error",
    provider_calls: 0,
    live_sources_read: false,
    candidate_generation_runs: 1,
    query_case_count: caseIndex + 1,
    retrieval_runs: caseIndex + 1,
    planned_query_case_count: plannedCaseCount,
    completed_case_count: completedCases.length,
    completed_cases: completedCases.map(caseRow => ({
      question_id: caseRow.question_id,
      sample_id: caseRow.sample_id,
      qa_index: caseRow.qa_index,
      query_sha256: caseRow.query_sha256,
    })),
    failed_case: caseIdentity(item),
    diagnostics: {
      fts_error: context.debug.fts_error,
      fts_query_final: context.debug.fts_query_final ?? null,
      strict_count: context.debug.strict_count ?? null,
      fallback_count: context.debug.fallback_count ?? null,
      candidate_counts: context.candidateCounts,
    },
    material_identity: materialIdentity,
    profile_id: profile.profile_id,
    contract_source_commit: profile.contract_source_commit,
    source_commit: executionSource.repository_commit,
    execution_source: executionSource,
  };
}

function makeFtsFailureError({ failure, failurePath }) {
  const error = new Error(`locomo_chunk_candidate_fts_error:${failure.failed_case.question_id}`);
  error.code = "locomo_chunk_candidate_fts_error";
  error.case = failure.failed_case;
  error.diagnostic = failure.diagnostics;
  error.failurePath = failurePath;
  return error;
}

function assertEmptyOutputDirectory(outputDir) {
  mkdirSync(outputDir, { recursive: true });
  if (readdirSync(outputDir).length > 0) throw new Error("candidate_output_directory_must_be_empty");
}

function writeChecksums(outputDir, files) {
  const rows = files
    .toSorted((left, right) => left.localeCompare(right))
    .map(relativePath => {
      const bytes = readFileSync(path.join(outputDir, relativePath));
      return `${sha256(bytes)}  ${relativePath}`;
    });
  writeFileSync(path.join(outputDir, "SHA256SUMS"), `${rows.join("\n")}\n`, "utf8");
  return rows;
}

/**
 * Build a sample-scoped, FTS-only candidate manifest from explicit canonical
 * memories and the frozen LoCoMo chunk material rows. The output directory
 * must be caller-owned; this function never opens live Core/Engine/LanceDB.
 */
export async function buildLocomoChunkCandidateManifest({
  cases,
  materialChunks,
  canonicalMemories,
  materialIdentity,
  profile,
  outputDir,
  repositoryProvenance,
  collectFtsCandidatesFn = collectFtsCandidates,
} = {}) {
  validateProfile(profile);
  if (!Array.isArray(cases)) throw new Error("candidate_cases_must_be_array");
  requireRecord(materialIdentity, "candidate_material_identity");
  requireNonEmptyString(materialIdentity.dataset_sha256, "candidate_material_identity_dataset_sha256");
  requireNonEmptyString(
    materialIdentity.chunk_material_manifest_sha256,
    "candidate_material_identity_chunk_material_manifest_sha256",
  );
  requireNonEmptyString(outputDir, "candidate_output_dir");
  if (typeof collectFtsCandidatesFn !== "function") {
    throw new Error("candidate_fts_collector_must_be_function");
  }
  const executionSource = validateRepositoryProvenance(repositoryProvenance);
  const normalizedCases = cases.map(validateCase);
  const { materialById, memoryById } = validateLocomoChunkCanonicalMapping({
    materialChunks,
    canonicalMemories,
  });
  const sampleIds = new Set([...memoryById.values()].map(entry => entry.sampleId));
  const seenQuestionIds = new Set();
  for (const item of normalizedCases) {
    if (seenQuestionIds.has(item.questionId)) throw new Error(`duplicate_question_id:${item.questionId}`);
    seenQuestionIds.add(item.questionId);
    if (!sampleIds.has(item.sampleId)) throw new Error(`case_sample_mapping_missing:${item.sampleId}`);
  }

  assertEmptyOutputDirectory(outputDir);
  const indexPath = path.join(outputDir, "fts-index.sqlite");
  const profilePath = path.join(outputDir, "candidate-profile.json");
  const manifestPath = path.join(outputDir, "candidate-manifest.json");
  const failurePath = path.join(outputDir, "candidate-build-failure.json");
  const db = createIndexDatabase(indexPath);
  try {
    const insertChunk = db.prepare(`
      INSERT INTO chunks (
        id, sample_id, path, source, start_line, end_line, hash, model,
        text, embedding, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = db.prepare(`
      INSERT INTO chunks_fts (text, id, path, source, model, start_line, end_line)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAll = db.transaction(() => {
      for (const { sampleId, canonical } of memoryById.values()) {
        const row = materializeCanonicalRow({ sampleId, memory: canonical });
        insertChunk.run(
          row.id,
          row.sample_id,
          row.path,
          row.source,
          row.start_line,
          row.end_line,
          row.hash,
          row.model,
          row.text,
          row.embedding,
          row.updated_at,
        );
        insertFts.run(row.text, row.id, row.path, row.source, row.model, row.start_line, row.end_line);
      }
    });
    insertAll();

    const confidenceMap = new Map([...memoryById.values()].map(({ canonical }) => {
      const row = materializeCanonicalRow({
        sampleId: "unused",
        memory: canonical,
      });
      return [row.id, row];
    }));
    const builtCases = [];
    for (const [caseIndex, item] of normalizedCases.entries()) {
      const context = makeCaseQueryContext({ item, profile, db, confidenceMap });
      await collectFtsCandidatesFn(context);
      if (hasOwn(context.debug, "fts_error")) {
        const failure = buildFtsFailureDiagnostic({
          item,
          context,
          caseIndex,
          completedCases: builtCases,
          plannedCaseCount: normalizedCases.length,
          profile,
          materialIdentity,
          executionSource,
        });
        writeArtifact(failurePath, failure);
        throw makeFtsFailureError({ failure, failurePath });
      }
      builtCases.push(buildCaseOutput({ item, profile, context, memoryById }));
    }

    writeArtifact(profilePath, profile);
    writeArtifact(manifestPath, {
      schema: LOCOMO_CHUNK_CANDIDATE_SCHEMA,
      provider_calls: 0,
      candidate_generation_runs: 1,
      query_case_count: builtCases.length,
      retrieval_runs: builtCases.length,
      live_sources_read: false,
      profile_id: profile.profile_id,
      index_schema: profile.index_schema,
      material_identity: materialIdentity,
      contract_source_commit: profile.contract_source_commit,
      source_commit: executionSource.repository_commit,
      execution_source: executionSource,
      channels: profile.channels,
      index_artifact: "fts-index.sqlite",
      case_count: builtCases.length,
      sample_count: sampleIds.size,
      cases: builtCases,
    });
  } finally {
    db.close();
  }

  const checksumRows = writeChecksums(outputDir, [
    "candidate-manifest.json",
    "candidate-profile.json",
    "fts-index.sqlite",
  ]);
  return {
    outputDir,
    manifestPath,
    profilePath,
    indexPath,
    checksumsPath: path.join(outputDir, "SHA256SUMS"),
    checksums: checksumRows,
  };
}
