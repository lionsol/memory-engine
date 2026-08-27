import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";

import { CATEGORY_MAP, calcRealtimeConf } from "../memory-confidence.js";
import { hybridSearch } from "../recall/hybrid-search.js";
import {
  LONGMEMEVAL_RETRIEVAL_KS,
  LONGMEMEVAL_V1_SCHEMA,
  hasLongMemEvalUserTarget,
  normalizeLongMemEvalCase,
  scoreLongMemEvalSessionMetrics,
  scoreLongMemEvalSessionRetrieval,
} from "./longmemeval-v1.js";

export const LONGMEMEVAL_RETRIEVAL_RUNNER_SCHEMA = "memory_engine_longmemeval_retrieval_v1";
export const LONGMEMEVAL_RETRIEVAL_PROFILE = "production_hybrid_lexical_session_v1";

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function normalizeCase(record) {
  return record?.schema === LONGMEMEVAL_V1_SCHEMA ? record : normalizeLongMemEvalCase(record);
}

function sanitizePathPart(value) {
  const normalized = String(value || "case")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || "case";
}

export function buildOfficialLongMemEvalSessionDocument(session) {
  if (!session || typeof session !== "object") throw new Error("session_required");
  if (!Array.isArray(session.turns)) throw new Error("session_turns_required");
  return session.turns
    .filter(turn => turn?.role === "user")
    .map(turn => String(turn.content ?? ""))
    .join(" ");
}

function mappedSessionTimeSec(item, session, benchmarkNowSec) {
  const questionMs = Number(item.question_timestamp_ms);
  const sessionMs = Number(session.timestamp_ms);
  if (Number.isFinite(questionMs) && Number.isFinite(sessionMs)) {
    const deltaSec = Math.trunc((sessionMs - questionMs) / 1000);
    return Math.min(benchmarkNowSec, benchmarkNowSec + deltaSec);
  }
  return benchmarkNowSec;
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

export function materializeLongMemEvalCaseDatabases(item, { benchmarkNowSec = Math.floor(Date.now() / 1000) } = {}) {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-longmemeval-v1-"));
  const corePath = join(root, "core.sqlite");
  const enginePath = join(root, "engine.sqlite");
  const sessionByMemoryId = new Map();

  const core = new Database(corePath);
  const engine = new Database(enginePath);
  try {
    createCoreSchema(core);
    createEngineSchema(engine);

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

    const questionPath = sanitizePathPart(item.question_id);
    const insertAll = core.transaction(() => {
      for (let index = 0; index < item.sessions.length; index += 1) {
        const session = item.sessions[index];
        const text = buildOfficialLongMemEvalSessionDocument(session);
        const memoryId = sha256(`${item.question_id}\u0000${index}\u0000${session.session_id}`);
        const path = `benchmark/longmemeval/${questionPath}/${String(index).padStart(4, "0")}.md`;
        const updatedAt = mappedSessionTimeSec(item, session, benchmarkNowSec);
        const contentHash = sha256(text);

        insertChunk.run(
          memoryId,
          path,
          "benchmark_longmemeval",
          1,
          Math.max(1, text.split("\n").length),
          contentHash,
          "benchmark-session-v1",
          text,
          null,
          updatedAt,
        );
        insertFts.run(
          text,
          memoryId,
          path,
          "benchmark_longmemeval",
          "benchmark-session-v1",
          1,
          Math.max(1, text.split("\n").length),
        );
        sessionByMemoryId.set(memoryId, session.session_id);
      }
    });

    const insertAllConfidence = engine.transaction(() => {
      for (const memoryId of sessionByMemoryId.keys()) {
        // B2 isolates retrieval/ranking from lifecycle decay. Confidence is
        // intentionally neutral and equal across all benchmark sessions.
        insertConfidence.run(memoryId, 1, 1, null, 365, 0, 0, 0, 0, "episodic", null);
      }
    });

    insertAll();
    insertAllConfidence();
  } finally {
    core.close();
    engine.close();
  }

  return {
    root,
    corePath,
    enginePath,
    sessionByMemoryId,
    benchmarkNowSec,
  };
}

export function createBenchmarkHybridRuntime(materialized, {
  topK,
  vectorTable = null,
  generateEmbedding = async () => [0],
  getMemorySearchManager = async () => ({
    manager: null,
    error: "benchmark_vector_disabled",
  }),
  lexicalConfidenceThreshold = null,
} = {}) {
  const core = new Database(materialized.corePath, { readonly: true, fileMustExist: true });
  const engine = new Database(materialized.enginePath, { readonly: true, fileMustExist: true });
  const maxCandidateK = Math.max(50, topK);
  const emptyVectorTable = {
    search() {
      return {
        limit() {
          return {
            async execute() {
              return [];
            },
          };
        },
      };
    },
  };
  const selectedVectorTable = vectorTable || emptyVectorTable;
  const recallConfig = {
    topK,
    vectorTopK: maxCandidateK,
    ftsTopK: maxCandidateK,
    lexicalConfidenceThreshold: lexicalConfidenceThreshold ?? 0,
    likePatternTopN: 8,
    likeTopK: maxCandidateK,
    recentTopK: maxCandidateK,
    recentRerankTopK: maxCandidateK,
    recentFallbackTopK: maxCandidateK,
  };
  const cfg = {
    confidence: { min: 0 },
    recall: recallConfig,
  };
  if (lexicalConfidenceThreshold !== null && lexicalConfidenceThreshold !== undefined) {
    // Explicitly bind the B4 gate ahead of any host environment override.
    cfg.memory = { autoRecallLexicalConfidenceThreshold: lexicalConfidenceThreshold };
  }

  return {
    close() {
      if (core.open) core.close();
      if (engine.open) engine.close();
    },
    runtime: {
      withHybridDbAccessScope: async callback => callback({
        withCoreDb: run => run(core),
        withEngineDb: run => run(engine),
        withLegacyDb: null,
        capabilities: {
          isolatedFts: true,
          isolatedKg: true,
          isolatedRecent: true,
          legacyFallbackAllowed: false,
        },
      }),
      calcRealtimeConf,
      categoryMap: CATEGORY_MAP,
      cfg,
      // The default B2 profile intentionally has no semantic backend.
      // Supplying an empty deterministic vector backend prevents production
      // Hybrid from emitting fallback warnings when FTS has no hits, while
      // still returning zero vector candidates. B4 injects its own table.
      getLancedbRuntime: async () => ({
        table: selectedVectorTable,
        readyState: "ready",
        initError: null,
        timedOut: false,
      }),
      generateEmbedding,
      getMemorySearchManager,
    },
  };
}

function mapSearchResultsToSessions(results, sessionByMemoryId) {
  const mapped = [];
  for (const result of Array.isArray(results) ? results : []) {
    const memoryId = String(result?.memory_id || "");
    const sessionId = sessionByMemoryId.get(memoryId);
    if (!sessionId) continue;
    // Preserve corpus occurrences: LongMemEval session-level retrieval allows
    // duplicate session ids to occupy independent ranking positions.
    mapped.push(sessionId);
  }
  return mapped;
}

function maskMetricsBeyondDepth(metrics, retrievalDepth) {
  const depth = Math.max(1, Math.trunc(Number(retrievalDepth) || 1));
  return Object.fromEntries(Object.entries(metrics || {}).map(([key, value]) => {
    const cutoff = Number(key.split("@")[1]);
    return [key, Number.isFinite(cutoff) && cutoff > depth ? null : value];
  }));
}

function boundedDiagnostics(search) {
  const canonical = search?.debug?.canonical_result_projection || null;
  return {
    pool: Number(search?.pool || 0),
    channels: Array.isArray(search?.channels) ? [...search.channels] : [],
    channel_sizes: search?.channel_sizes || {},
    vector_mode: "disabled_empty_backend",
    vector_skipped: search?.debug?.vector_skipped === true,
    vector_skip_reason: search?.debug?.vector_skip_reason || null,
    lexical_confidence: Number.isFinite(search?.debug?.lexical_confidence)
      ? search.debug.lexical_confidence
      : null,
    canonical_result_projection: canonical
      ? {
        requested_count: canonical.requested_count,
        resolved_count: canonical.resolved_count,
        dropped_count: canonical.dropped_count,
        dropped_reasons: canonical.dropped_reasons,
      }
      : null,
  };
}

export async function runLongMemEvalRetrievalCase(record, {
  topK = 50,
  benchmarkNowSec = Math.floor(Date.now() / 1000),
  keepTemp = false,
} = {}) {
  const item = normalizeCase(record);
  const k = Math.max(1, Math.trunc(Number(topK) || 50));
  const officialSkipReason = item.abstention
    ? "official_retrieval_abstention"
    : hasLongMemEvalUserTarget(item)
      ? null
      : "official_retrieval_no_user_target";
  if (officialSkipReason) {
    return {
      schema: LONGMEMEVAL_RETRIEVAL_RUNNER_SCHEMA,
      profile: LONGMEMEVAL_RETRIEVAL_PROFILE,
      question_id: item.question_id,
      question_type: item.question_type,
      skipped: true,
      skip_reason: officialSkipReason,
      retrieved_session_ids: [],
      metrics: null,
      diagnostic_metrics: null,
      diagnostics: null,
      latency_ms: 0,
      corpus_sessions: item.sessions.length,
    };
  }

  const materialized = materializeLongMemEvalCaseDatabases(item, { benchmarkNowSec });
  let runtime = null;
  try {
    runtime = createBenchmarkHybridRuntime(materialized, { topK: k });
    const started = performance.now();
    const search = await hybridSearch(item.question, { topK: k }, runtime.runtime);
    const latencyMs = performance.now() - started;
    const retrievedSessionIds = mapSearchResultsToSessions(search.results, materialized.sessionByMemoryId);

    return {
      schema: LONGMEMEVAL_RETRIEVAL_RUNNER_SCHEMA,
      profile: LONGMEMEVAL_RETRIEVAL_PROFILE,
      question_id: item.question_id,
      question_type: item.question_type,
      skipped: false,
      skip_reason: null,
      retrieved_session_ids: retrievedSessionIds,
      metrics: maskMetricsBeyondDepth(
        scoreLongMemEvalSessionMetrics(item, retrievedSessionIds).metrics,
        k,
      ),
      diagnostic_metrics: scoreLongMemEvalSessionRetrieval(item, retrievedSessionIds, { topK: k }),
      diagnostics: boundedDiagnostics(search),
      latency_ms: latencyMs,
      corpus_sessions: item.sessions.length,
    };
  } finally {
    runtime?.close();
    if (!keepTemp) rmSync(materialized.root, { recursive: true, force: true });
  }
}

function mean(values) {
  const finite = values.filter(value => Number.isFinite(value));
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function aggregateMetricMap(results) {
  const metrics = {};
  for (const k of LONGMEMEVAL_RETRIEVAL_KS) {
    for (const name of ["recall_any", "recall_all", "ndcg_any"]) {
      const key = `${name}@${k}`;
      metrics[key] = mean(results.map(result => result.metrics?.[key]));
    }
  }
  return metrics;
}

export function aggregateLongMemEvalRetrievalResults(caseResults, {
  profile = LONGMEMEVAL_RETRIEVAL_PROFILE,
  schema = LONGMEMEVAL_RETRIEVAL_RUNNER_SCHEMA,
} = {}) {
  const results = Array.isArray(caseResults) ? caseResults : [];
  const scored = results.filter(result => result && result.skipped !== true && result.metrics);
  const skipped = results.filter(result => result?.skipped === true);
  const byType = {};
  for (const result of scored) {
    if (!byType[result.question_type]) byType[result.question_type] = [];
    byType[result.question_type].push(result);
  }

  const skippedByReason = {};
  for (const result of skipped) {
    const reason = result.skip_reason || "unknown";
    skippedByReason[reason] = (skippedByReason[reason] || 0) + 1;
  }

  return {
    schema,
    profile,
    cases: results.length,
    scored_cases: scored.length,
    skipped_cases: skipped.length,
    skipped_by_reason: skippedByReason,
    metrics: aggregateMetricMap(scored),
    mean_latency_ms: mean(scored.map(result => result.latency_ms)),
    mean_corpus_sessions: mean(scored.map(result => result.corpus_sessions)),
    by_question_type: Object.fromEntries(
      Object.entries(byType).map(([questionType, group]) => [questionType, {
        cases: group.length,
        metrics: aggregateMetricMap(group),
      }]),
    ),
  };
}

export async function runLongMemEvalRetrievalDataset(records, {
  limit = null,
  topK = 50,
  benchmarkNowSec = Math.floor(Date.now() / 1000),
} = {}) {
  if (!Array.isArray(records)) throw new Error("longmemeval_dataset_must_be_array");
  const boundedLimit = limit == null
    ? records.length
    : Math.max(0, Math.min(records.length, Math.trunc(Number(limit) || 0)));
  const selected = records.slice(0, boundedLimit);
  const results = [];
  for (const record of selected) {
    results.push(await runLongMemEvalRetrievalCase(record, { topK, benchmarkNowSec }));
  }
  return {
    run: {
      profile: LONGMEMEVAL_RETRIEVAL_PROFILE,
      top_k: Math.max(1, Math.trunc(Number(topK) || 50)),
      benchmark_now_sec: benchmarkNowSec,
      requested_limit: limit,
    },
    summary: aggregateLongMemEvalRetrievalResults(results),
    results,
  };
}
