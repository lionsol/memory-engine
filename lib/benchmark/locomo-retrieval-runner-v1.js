import { execFileSync as defaultExecFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import Database from "better-sqlite3";

import { hybridSearch } from "../recall/hybrid-search.js";
import { createBenchmarkHybridRuntime } from "./longmemeval-retrieval-runner-v1.js";
import {
  LOCOMO_BLIP_CAPTION_POLICY,
  LOCOMO_DIALOG_TEXT_PROJECTION,
  LOCOMO_DIALOG_PROJECTION_VERSION,
  LOCOMO_EVIDENCE_CANONICALIZED_V1,
  LOCOMO_EVIDENCE_STRICT_V1,
  LOCOMO_INCLUDE_SESSION_DATETIME,
  LOCOMO_RETRIEVAL_KS,
  buildLocomoConversationDialogDocuments,
  buildLocomoSearchRequest,
  getLocomoProvenance,
  normalizeLocomoDataset,
  scoreLocomoRetrieval,
} from "./locomo-v1.js";

export const LOCOMO_RETRIEVAL_RUNNER_SCHEMA = "memory_engine_locomo_lexical_retrieval_v1";
export const LOCOMO_LEXICAL_RETRIEVAL_PROFILE = "production_hybrid_lexical_dialog_locomo_v1";
export const LOCOMO_RETRIEVAL_PROFILE = LOCOMO_LEXICAL_RETRIEVAL_PROFILE;
export const LOCOMO_VECTOR_MODE = "disabled_empty_backend";
export const LOCOMO_HOST_MANAGER_MODE = "disabled";
export const LOCOMO_BENCHMARK_NOW_PROVENANCE_KEY = "benchmark_now_sec";
export {
  LOCOMO_BLIP_CAPTION_POLICY,
  LOCOMO_DIALOG_PROJECTION_VERSION,
  LOCOMO_INCLUDE_SESSION_DATETIME,
};

const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const METRIC_NAMES = Object.freeze(["recall_any", "recall_all", "ndcg_any"]);
const CORE_PROVENANCE_FIELDS = new Set([
  "profile",
  "repository_commit",
  "repository_worktree_clean",
  "repository_provenance_source",
  "dataset_sha256",
  "dataset_sha256_source",
  "upstream_repository",
  "upstream_commit",
  "dataset_file_commit",
  "dataset_path",
  "license_identity",
  "locomo_dialog_text_projection",
  "dialog_projection_version",
  "include_session_datetime",
  "blip_caption_policy",
  "vector_mode",
  "host_manager_mode",
  "lexical_confidence_threshold",
  "gold_leakage_boundary",
  LOCOMO_BENCHMARK_NOW_PROVENANCE_KEY,
  "materialization_now_sec",
  "search_now_sec",
  "benchmark_clock_contract",
  "input_file",
  "input_sha256",
  "official_shape_matches",
]);

function assertProjectionOptions(options) {
  if (!options || typeof options !== "object") return;
  if (Object.hasOwn(options, "includeBlipCaption")) {
    throw new Error("locomo_projection_option_reserved:includeBlipCaption");
  }
  const reservedValues = [
    ["dialogProjectionVersion", LOCOMO_DIALOG_PROJECTION_VERSION],
    ["includeSessionDatetime", LOCOMO_INCLUDE_SESSION_DATETIME],
    ["blipCaptionPolicy", LOCOMO_BLIP_CAPTION_POLICY],
  ];
  for (const [key, expected] of reservedValues) {
    if (Object.hasOwn(options, key) && options[key] !== expected) {
      throw new Error(`locomo_projection_option_reserved:${key}`);
    }
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function textSha256(value) {
  return sha256(Buffer.from(String(value), "utf8"));
}

export function validateBenchmarkNowSec(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("locomo_benchmark_now_sec_must_be_positive_safe_integer");
  }
  return value;
}

export function resolveBenchmarkNowSec(value, nowMs = Date.now) {
  if (value !== undefined) return validateBenchmarkNowSec(value);
  const currentMs = nowMs();
  if (typeof currentMs !== "number" || !Number.isFinite(currentMs)) {
    throw new Error("locomo_benchmark_clock_unavailable");
  }
  return validateBenchmarkNowSec(Math.floor(currentMs / 1000));
}

function normalizeProfileProvenance(value) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("locomo_profile_provenance_must_be_object");
  }
  const reserved = Object.keys(value).filter(key => CORE_PROVENANCE_FIELDS.has(key));
  if (reserved.length > 0) {
    throw new Error(`locomo_provenance_reserved:${reserved.join(",")}`);
  }
  return { ...value };
}

function positiveInteger(value, label) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label}_must_be_positive_integer`);
  return parsed;
}

function boundedLimit(value, length) {
  if (value === null || value === undefined) return length;
  const parsed = Math.trunc(Number(value));
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("limit_must_be_non_negative_integer");
  return Math.min(parsed, length);
}

function validateRepositoryProvenance(value) {
  const commit = String(value?.repository_commit ?? value?.repositoryCommit ?? "").trim();
  if (!GIT_COMMIT_PATTERN.test(commit)) throw new Error("locomo_repository_provenance_invalid_commit");
  const clean = value?.repository_worktree_clean ?? value?.repositoryWorktreeClean;
  if (typeof clean !== "boolean") throw new Error("locomo_repository_provenance_invalid_worktree_state");
  const source = value?.repository_provenance_source ?? value?.repositoryProvenanceSource;
  if (source !== "git") throw new Error("locomo_repository_provenance_invalid_source");
  return {
    repository_commit: commit,
    repository_worktree_clean: clean,
    repository_provenance_source: "git",
  };
}

export function resolveLocomoRepositoryProvenance({
  repositoryRoot = process.cwd(),
  execFileSync = defaultExecFileSync,
} = {}) {
  let commit;
  let status;
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
  } catch {
    throw new Error("locomo_repository_provenance_unavailable");
  }
  return validateRepositoryProvenance({
    repository_commit: String(commit).trim(),
    repository_worktree_clean: String(status).trim().length === 0,
    repository_provenance_source: "git",
  });
}

function assertBenchmarkTemporaryParent(parent) {
  const candidate = resolve(parent);
  const liveRoot = resolve(homedir(), ".openclaw", "memory");
  const temporaryRoot = resolve(tmpdir());
  if (candidate === liveRoot || candidate.startsWith(`${liveRoot}${sep}`)) {
    throw new Error("locomo_live_memory_path_rejected");
  }
  if (!(candidate === temporaryRoot || candidate.startsWith(`${temporaryRoot}${sep}`))) {
    throw new Error("locomo_temporary_root_required");
  }
  return candidate;
}

function createCoreSchema(db) {
  db.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT,
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
}

function createEngineSchema(db) {
  db.exec(`
    CREATE TABLE memory_confidence (
      chunk_id TEXT PRIMARY KEY,
      initial_confidence REAL NOT NULL,
      confidence REAL NOT NULL,
      last_confidence_update INTEGER,
      base_tau REAL NOT NULL,
      hit_count INTEGER NOT NULL,
      is_archived INTEGER NOT NULL,
      is_protected INTEGER NOT NULL,
      conflict_flag INTEGER NOT NULL,
      category TEXT NOT NULL,
      kg_data TEXT
    );
  `);
}

function safePathPart(value) {
  const normalized = String(value || "conversation")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || "conversation";
}

function documentUpdatedAt(document, benchmarkNowSec) {
  const timestampMs = Number(document.timestamp_ms);
  return Number.isFinite(timestampMs) ? Math.trunc(timestampMs / 1000) : benchmarkNowSec;
}

/**
 * Materialize exactly one LoCoMo conversation into benchmark-owned Core and
 * Engine SQLite files. The returned object owns its temporary root.
 */
export function materializeLocomoConversationDataPlane(record, options = {}) {
  assertProjectionOptions(options);
  const {
    benchmarkNowSec,
    temporaryParent = tmpdir(),
    removeOnClose = true,
  } = options;
  const item = record?.schema ? record : normalizeLocomoDataset([record], {
    evidencePolicy: LOCOMO_EVIDENCE_CANONICALIZED_V1,
  })[0];
  if (!item || typeof item.sample_id !== "string") throw new Error("locomo_conversation_required");
  const parent = assertBenchmarkTemporaryParent(temporaryParent);
  const resolvedBenchmarkNowSec = validateBenchmarkNowSec(benchmarkNowSec);
  let root = null;
  let core = null;
  let engine = null;
  try {
    root = mkdtempSync(join(parent, "memory-engine-locomo-v1-"));
    assertBenchmarkTemporaryParent(root);
    const corePath = join(root, "core.sqlite");
    const enginePath = join(root, "engine.sqlite");
    core = new Database(corePath);
    engine = new Database(enginePath);
    createCoreSchema(core);
    createEngineSchema(engine);

    const documents = buildLocomoConversationDialogDocuments(item, {
      evidencePolicy: item.evidence_policy,
    });
    const memoryToDialog = new Map();
    const insertChunk = core.prepare(`
      INSERT INTO chunks (
        id, path, source, start_line, end_line, hash, model, text, embedding, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = core.prepare(`
      INSERT INTO chunks_fts (text, id, path, source, model, start_line, end_line)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertConfidence = engine.prepare(`
      INSERT INTO memory_confidence (
        chunk_id, initial_confidence, confidence, last_confidence_update,
        base_tau, hit_count, is_archived, is_protected, conflict_flag, category, kg_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertAll = core.transaction(() => {
      for (const document of documents) {
        const path = [
          "benchmark",
          "locomo",
          safePathPart(item.sample_id),
          safePathPart(document.session_id),
          `${safePathPart(document.dia_id)}.md`,
        ].join("/");
        const endLine = Math.max(1, document.content.split("\n").length);
        const updatedAt = documentUpdatedAt(document, resolvedBenchmarkNowSec);
        insertChunk.run(
          document.memory_id,
          path,
          "benchmark_locomo_dialog",
          1,
          endLine,
          textSha256(document.content),
          "benchmark-locomo-dialog-v1",
          document.content,
          null,
          updatedAt,
        );
        insertFts.run(
          document.content,
          document.memory_id,
          path,
          "benchmark_locomo_dialog",
          "benchmark-locomo-dialog-v1",
          1,
          endLine,
        );
        memoryToDialog.set(document.memory_id, {
          sample_id: item.sample_id,
          dia_id: document.dia_id,
          session_id: document.session_id,
        });
      }
    });
    const insertAllConfidence = engine.transaction(() => {
      for (const memoryId of memoryToDialog.keys()) {
        insertConfidence.run(memoryId, 1, 1, null, 365, 0, 0, 0, 0, "episodic", null);
      }
    });

    insertAll();
    insertAllConfidence();
    core.close();
    engine.close();
    core = null;
    engine = null;

    let closed = false;
    return {
      owner: "runner",
      sample_id: item.sample_id,
      root,
      corePath,
      enginePath,
      document_count: documents.length,
      session_count: item.sessions.length,
      documents,
      memoryToDialog,
      benchmarkNowSec: resolvedBenchmarkNowSec,
      dialog_projection_version: LOCOMO_DIALOG_PROJECTION_VERSION,
      include_session_datetime: LOCOMO_INCLUDE_SESSION_DATETIME,
      blip_caption_policy: LOCOMO_BLIP_CAPTION_POLICY,
      close() {
        if (closed) return;
        closed = true;
        if (removeOnClose) rmSync(root, { recursive: true, force: true });
      },
      get closed() {
        return closed;
      },
    };
  } catch (error) {
    if (core?.open) core.close();
    if (engine?.open) engine.close();
    if (root) rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Return the production hybrid adapter with B5's vector and host-manager
 * fallbacks explicitly disabled. The empty vector table is benchmark-local;
 * no live LanceDB or OpenClaw manager is resolved.
 */
export function createLocomoProductionHybridRuntime(materialized, {
  topK = 50,
  searchNowSec = undefined,
  channelCapabilities = undefined,
} = {}) {
  const runtimeOptions = {
    topK: positiveInteger(topK, "top_k"),
    lexicalConfidenceThreshold: 0,
    generateEmbedding: async () => [0],
    getMemorySearchManager: async () => ({
      manager: null,
      error: "locomo_host_memory_manager_disabled",
    }),
  };
  if (searchNowSec !== undefined) runtimeOptions.searchNowSec = searchNowSec;
  if (channelCapabilities !== undefined) runtimeOptions.channelCapabilities = channelCapabilities;
  const runtimeAdapter = createBenchmarkHybridRuntime(materialized, runtimeOptions);
  return {
    ...runtimeAdapter,
    vector_mode: LOCOMO_VECTOR_MODE,
    host_manager_mode: LOCOMO_HOST_MANAGER_MODE,
  };
}

function memoryIdFromSearchResult(result) {
  if (typeof result?.memory_id === "string" && result.memory_id !== "") return result.memory_id;
  if (typeof result?.id === "string" && result.id !== "") return result.id;
  throw new Error("locomo_search_result_memory_id_missing");
}

export function mapLocomoSearchResultsToDialogs(results, memoryToDialog) {
  if (!(memoryToDialog instanceof Map)) throw new Error("locomo_memory_mapping_required");
  if (!Array.isArray(results)) throw new Error("locomo_search_results_must_be_array");
  return results.map((result, index) => {
    const memoryId = memoryIdFromSearchResult(result);
    const identity = memoryToDialog.get(memoryId);
    if (!identity) throw new Error(`locomo_cross_conversation_memory_id:${index}`);
    return {
      memory_id: memoryId,
      sample_id: identity.sample_id,
      dia_id: identity.dia_id,
      session_id: identity.session_id,
    };
  });
}

function boundedSearchDiagnostics(search) {
  const debug = search?.debug || {};
  const canonical = debug.canonical_result_projection || null;
  return {
    channels: Array.isArray(search?.channels) ? [...search.channels] : [],
    channel_sizes: search?.channel_sizes || {},
    lexical_confidence: Number.isFinite(debug.lexical_confidence)
      ? debug.lexical_confidence
      : null,
    vector_mode: LOCOMO_VECTOR_MODE,
    vector_skipped: debug.vector_skipped === true,
    vector_skip_reason: debug.vector_skip_reason || null,
    vector_backend: debug.vector_backend || null,
    vector_stage: debug.vector_stage || null,
    host_manager_fallback: LOCOMO_HOST_MANAGER_MODE,
    canonical_result_projection: canonical
      ? {
        requested_count: canonical.requested_count,
        resolved_count: canonical.resolved_count,
        dropped_count: canonical.dropped_count,
        dropped_reasons: canonical.dropped_reasons,
      }
      : null,
    ...(Object.hasOwn(debug, "search_now_sec")
      ? { search_now_sec: debug.search_now_sec }
      : {}),
  };
}

export function publicMetrics(score) {
  if (!score) return null;
  return {
    metric_level: score.metric_level,
    question_id: score.question_id,
    category: score.category,
    category_name: score.category_name,
    scoreable: score.scoreable,
    skip_reason: score.skip_reason,
    first_relevant_rank: score.first_relevant_rank,
    metrics: score.metrics,
  };
}

export function skippedMetrics(question) {
  return {
    metric_level: null,
    question_id: question.question_id,
    category: question.category,
    category_name: question.category_name,
    scoreable: false,
    skip_reason: question.skip_reason,
    first_relevant_rank: null,
    metrics: Object.fromEntries(LOCOMO_RETRIEVAL_KS.flatMap(k => METRIC_NAMES.map(name => [
      `${name}@${k}`,
      null,
    ]))),
  };
}

function mean(values) {
  const finite = values.filter(value => Number.isFinite(value));
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function aggregateMetrics(scores) {
  return Object.fromEntries(LOCOMO_RETRIEVAL_KS.flatMap(k => METRIC_NAMES.map(name => {
    const key = `${name}@${k}`;
    return [key, mean(scores.map(score => score?.metrics?.[key]))];
  })));
}

function aggregateMetricLevel(results, level) {
  const scores = results
    .map(result => result?.[level])
    .filter(score => score?.scoreable === true);
  return {
    metrics: aggregateMetrics(scores),
    mean_first_relevant_rank: mean(scores.map(score => score.first_relevant_rank)),
    scored_cases: scores.length,
  };
}

export function aggregatePolicy(results, policy) {
  const evidencePolicy = policy === "strict"
    ? LOCOMO_EVIDENCE_STRICT_V1
    : LOCOMO_EVIDENCE_CANONICALIZED_V1;
  const all = results.map(result => ({
    dialog: result?.[policy],
    session: result?.[`${policy}_session`],
  }));
  const scored = all.filter(score => score.dialog?.scoreable === true);
  const skipped = all.filter(score => score.dialog?.scoreable !== true);
  const skippedByReason = {};
  for (const score of skipped) {
    const reason = score.dialog?.skip_reason || "unknown";
    skippedByReason[reason] = (skippedByReason[reason] || 0) + 1;
  }

  const byCategory = {};
  for (const result of results) {
    const category = String(result.category);
    byCategory[category] ||= [];
    byCategory[category].push(result);
  }
  return {
    evidence_policy: evidencePolicy,
    cases: all.length,
    scored_cases: scored.length,
    skipped_cases: skipped.length,
    skipped_by_reason: skippedByReason,
    // Dialog is the primary metric level. Session is compatibility-only.
    dialog: aggregateMetricLevel(results.map(result => ({
      dialog: result?.[policy],
      session: result?.[`${policy}_session`],
    })), "dialog"),
    session: aggregateMetricLevel(results.map(result => ({
      dialog: result?.[policy],
      session: result?.[`${policy}_session`],
    })), "session"),
    metrics: aggregateMetricLevel(results.map(result => ({
      dialog: result?.[policy],
      session: result?.[`${policy}_session`],
    })), "dialog").metrics,
    by_category: Object.fromEntries(Object.entries(byCategory).map(([category, group]) => {
      const categoryResults = group.map(result => ({
        dialog: result?.[policy],
        session: result?.[`${policy}_session`],
      }));
      return [category, {
        cases: group.length,
        scored_cases: categoryResults.filter(result => result.dialog?.scoreable === true).length,
        skipped_cases: categoryResults.filter(result => result.dialog?.scoreable !== true).length,
        dialog: aggregateMetricLevel(categoryResults, "dialog"),
        session: aggregateMetricLevel(categoryResults, "session"),
      }];
    })),
  };
}

function normalizeDatasetSha256(records, datasetSha256) {
  if (datasetSha256 !== undefined && datasetSha256 !== null) {
    const value = String(datasetSha256).trim();
    if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error("locomo_dataset_sha256_invalid");
    return value;
  }
  return textSha256(JSON.stringify(records));
}

function normalizeRunnerProvenance(repositoryProvenance) {
  const candidate = repositoryProvenance || resolveLocomoRepositoryProvenance();
  return validateRepositoryProvenance(candidate);
}

function selectConversationItems(records, limit) {
  if (!Array.isArray(records)) throw new Error("locomo_dataset_must_be_array");
  const selectedCount = boundedLimit(limit, records.length);
  return {
    selectedCount,
    strictItems: normalizeLocomoDataset(records.slice(0, selectedCount), {
      evidencePolicy: LOCOMO_EVIDENCE_STRICT_V1,
    }),
    sensitivityItems: normalizeLocomoDataset(records.slice(0, selectedCount), {
      evidencePolicy: LOCOMO_EVIDENCE_CANONICALIZED_V1,
    }),
  };
}

export async function runLocomoLexicalRetrievalDataset(records, options = {}) {
  assertProjectionOptions(options);
  const {
    limit = null,
    topK = 50,
    datasetSha256 = null,
    repositoryProvenance = null,
    profileProvenance = null,
    temporaryParent = tmpdir(),
    materialize = materializeLocomoConversationDataPlane,
    createRuntime = createLocomoProductionHybridRuntime,
    search = hybridSearch,
  } = options;
  if (typeof materialize !== "function") throw new Error("locomo_materializer_required");
  if (typeof createRuntime !== "function") throw new Error("locomo_runtime_factory_required");
  if (typeof search !== "function") throw new Error("locomo_search_function_required");
  const k = positiveInteger(topK, "top_k");
  const benchmarkNowSec = resolveBenchmarkNowSec(options.benchmarkNowSec);
  const provenance = normalizeRunnerProvenance(repositoryProvenance);
  const extensionProvenance = normalizeProfileProvenance(profileProvenance);
  const normalizedDataset = selectConversationItems(records, limit);
  const resultRows = [];
  let corporaBuilt = 0;
  let corpusReuseSearches = 0;
  let retrievalCases = 0;
  let totalCorpusBuildLatencyMs = 0;
  let totalRetrievalLatencyMs = 0;

  for (let index = 0; index < normalizedDataset.sensitivityItems.length; index += 1) {
    const sensitivityItem = normalizedDataset.sensitivityItems[index];
    const strictItem = normalizedDataset.strictItems[index];
    const corpusBuildStarted = performance.now();
    const dataPlane = materialize(sensitivityItem, {
      benchmarkNowSec,
      temporaryParent,
    });
    totalCorpusBuildLatencyMs += performance.now() - corpusBuildStarted;
    corporaBuilt += 1;
    let runtimeAdapter = null;
    try {
      runtimeAdapter = createRuntime(dataPlane, { topK: k });
      for (let questionIndex = 0; questionIndex < sensitivityItem.questions.length; questionIndex += 1) {
        const sensitivityQuestion = sensitivityItem.questions[questionIndex];
        const strictQuestion = strictItem.questions[questionIndex];
        let retrieved = [];
        let retrievedMemoryIds = [];
        let retrievedDialogIdentities = [];
        let searchDiagnostics = null;
        let latencyMs = 0;
        if (sensitivityQuestion.scoreable) {
          const request = buildLocomoSearchRequest(sensitivityItem, {
            questionIndex,
            topK: k,
            evidencePolicy: LOCOMO_EVIDENCE_CANONICALIZED_V1,
          });
          const started = performance.now();
          const searchResult = await search(
            request.query,
            { topK: k },
            runtimeAdapter.runtime || runtimeAdapter,
          );
          if (!searchResult || !Array.isArray(searchResult.results)) {
            throw new Error("locomo_search_result_invalid");
          }
          latencyMs = performance.now() - started;
          totalRetrievalLatencyMs += latencyMs;
          retrievalCases += 1;
          corpusReuseSearches += 1;
          const mapped = mapLocomoSearchResultsToDialogs(
            searchResult?.results || [],
            dataPlane.memoryToDialog,
          );
          retrievedMemoryIds = mapped.map(value => value.memory_id);
          retrievedDialogIdentities = mapped.map(value => ({
            sample_id: value.sample_id,
            dia_id: value.dia_id,
            session_id: value.session_id,
          }));
          retrieved = mapped.map(value => value.dia_id);
          searchDiagnostics = boundedSearchDiagnostics(searchResult);
        }

        const sensitivityScore = sensitivityQuestion.scoreable
          ? scoreLocomoRetrieval(sensitivityItem, retrieved, {
            questionIndex,
            evidencePolicy: LOCOMO_EVIDENCE_CANONICALIZED_V1,
          })
          : null;
        const strictScore = strictQuestion.scoreable && sensitivityQuestion.scoreable
          ? scoreLocomoRetrieval(strictItem, retrieved, {
            questionIndex,
            evidencePolicy: LOCOMO_EVIDENCE_STRICT_V1,
          })
          : null;
        const projectedSessions = sensitivityScore?.projected_session_ids || [];

        resultRows.push({
          question_id: sensitivityQuestion.question_id,
          sample_id: sensitivityItem.sample_id,
          qa_index: sensitivityQuestion.qa_index,
          category: sensitivityQuestion.category,
          category_name: sensitivityQuestion.category_name,
          retrieved_memory_ids: retrievedMemoryIds,
          retrieved_dialog_identities: retrievedDialogIdentities,
          retrieved_dialog_ids: retrieved,
          retrieved_session_ids: projectedSessions,
          corpus_sessions: sensitivityItem.sessions.length,
          latency_ms: latencyMs,
          strict: strictScore ? publicMetrics(strictScore.dialog) : skippedMetrics(strictQuestion),
          strict_session: strictScore ? publicMetrics(strictScore.session) : skippedMetrics(strictQuestion),
          sensitivity: sensitivityScore
            ? publicMetrics(sensitivityScore.dialog)
            : skippedMetrics(sensitivityQuestion),
          sensitivity_session: sensitivityScore
            ? publicMetrics(sensitivityScore.session)
            : skippedMetrics(sensitivityQuestion),
          diagnostics: searchDiagnostics,
        });
      }
    } finally {
      runtimeAdapter?.close?.();
      dataPlane?.close?.();
    }
  }

  const summary = {
    schema: LOCOMO_RETRIEVAL_RUNNER_SCHEMA,
    profile: LOCOMO_LEXICAL_RETRIEVAL_PROFILE,
    cases: resultRows.length,
    retrieval_cases: retrievalCases,
    conversations: normalizedDataset.sensitivityItems.length,
    corpora_built: corporaBuilt,
    corpus_reuse_searches: corpusReuseSearches,
    corpus_build_latency_ms_total: totalCorpusBuildLatencyMs,
    mean_retrieval_latency_ms: retrievalCases > 0 ? totalRetrievalLatencyMs / retrievalCases : null,
    strict: aggregatePolicy(resultRows, "strict"),
    sensitivity: aggregatePolicy(resultRows, "sensitivity"),
  };

  return {
    schema: LOCOMO_RETRIEVAL_RUNNER_SCHEMA,
    profile: LOCOMO_LEXICAL_RETRIEVAL_PROFILE,
    provenance: {
      ...getLocomoProvenance(),
      ...provenance,
      dataset_sha256: normalizeDatasetSha256(records, datasetSha256),
      dataset_sha256_source: datasetSha256 ? "cli_input_bytes" : "runner_input_serialization",
      locomo_dialog_text_projection: LOCOMO_DIALOG_TEXT_PROJECTION,
      dialog_projection_version: LOCOMO_DIALOG_PROJECTION_VERSION,
      include_session_datetime: LOCOMO_INCLUDE_SESSION_DATETIME,
      blip_caption_policy: LOCOMO_BLIP_CAPTION_POLICY,
      vector_mode: LOCOMO_VECTOR_MODE,
      host_manager_mode: LOCOMO_HOST_MANAGER_MODE,
      lexical_confidence_threshold: 0,
      gold_leakage_boundary: "evaluator_only_gold_not_in_search_path",
      benchmark_now_sec: benchmarkNowSec,
      ...extensionProvenance,
    },
    run: {
      profile: LOCOMO_LEXICAL_RETRIEVAL_PROFILE,
      top_k: k,
      benchmark_now_sec: benchmarkNowSec,
      requested_conversation_limit: limit,
      conversations: normalizedDataset.sensitivityItems.length,
      corpus_owner: "conversation",
      corpus_reuse: "same_conversation_questions_share_one_temporary_data_plane",
      corpus_build_latency_ms_total: summary.corpus_build_latency_ms_total,
      retrieval_latency_ms_total: totalRetrievalLatencyMs,
      dialog_projection_version: LOCOMO_DIALOG_PROJECTION_VERSION,
      include_session_datetime: LOCOMO_INCLUDE_SESSION_DATETIME,
      blip_caption_policy: LOCOMO_BLIP_CAPTION_POLICY,
      evidence_policies: [LOCOMO_EVIDENCE_STRICT_V1, LOCOMO_EVIDENCE_CANONICALIZED_V1],
      primary_metric_level: "dialog",
      compatibility_metric_level: "session_projection",
      vector_mode: LOCOMO_VECTOR_MODE,
      host_manager_mode: LOCOMO_HOST_MANAGER_MODE,
    },
    summary,
    results: resultRows,
  };
}
