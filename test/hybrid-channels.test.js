import test from "node:test";
import assert from "node:assert/strict";

import { collectFtsCandidates } from "../lib/recall/hybrid/channels/fts.js";
import { collectKgCandidates } from "../lib/recall/hybrid/channels/kg.js";
import { collectRecentCandidates } from "../lib/recall/hybrid/channels/recent.js";
import { collectVectorCandidates } from "../lib/recall/hybrid/channels/vector.js";
import { createCandidateCounts, createHybridDebug, createHybridWarnings, toDebugErrorMessage } from "../lib/recall/hybrid/debug.js";
import { normalizeExternalMemory, inferCategoryFromChunk, isCandidateAllowedForRerank, normalizeUnixSeconds, toFiniteNumber, round4 } from "../lib/recall/hybrid/normalize-candidate.js";
import { enrichLexicalCandidate } from "../lib/recall/hybrid/lexical.js";
import { computeRecencyBoost, fuseChannels } from "../lib/recall/hybrid/fusion.js";

function lexicalMatchScore(haystack, terms) {
  if (!Array.isArray(terms) || terms.length === 0) return 0;
  const raw = String(haystack || "").toLowerCase();
  let matched = 0;
  for (const term of terms) {
    if (!term) continue;
    if (raw.includes(term)) matched += 1;
  }
  if (matched === 0) return 0;
  return round4(matched / terms.length);
}

function makeDebugAndCounts() {
  const candidateCounts = createCandidateCounts();
  const debug = createHybridDebug({
    rawQuery: "query",
    strippedQuery: "query",
    normalizedQuery: "query",
    queryTerms: ["query"],
    candidateCounts,
    minConfidence: 0.15,
    lexicalConfidenceThreshold: 0.7,
  });
  return { candidateCounts, debug };
}

function makeBaseCtx(overrides = {}) {
  const { candidateCounts, debug } = makeDebugAndCounts();
  const channels = {};
  const nowSec = 1710003600;
  const normalizeCandidate = row => normalizeExternalMemory(row, {
    nowSec,
    calcRealtimeConf: candidate => candidate.confidence,
    categoryMap: null,
  });
  const filterForRerank = item => isCandidateAllowedForRerank(item, 0.15);
  const warnings = [];
  const { warnVectorChannelOnce, warnHybridSearchOnce } = createHybridWarnings();
  const recordWarn = fn => (message, error = null) => {
    warnings.push({ message, error: error?.message || null });
    fn(message, error);
  };
  return {
    warnings,
    channels,
    debug,
    candidateCounts,
    nowSec,
    normalizedQuery: "query",
    strippedQuery: "query",
    fallbackFtsQuery: "query OR fallback",
    queryTerms: ["query"],
    exactFragments: [],
    ftsTopK: 20,
    likePatternTopN: 8,
    likeTopK: 30,
    recentTopK: 120,
    recentRerankTopK: 20,
    recentFallbackTopK: 20,
    vectorTopK: 30,
    vectorReadyTimeoutMs: 400,
    rankingConfig: {},
    categoryMap: null,
    cfg: { memory: { backend: "sqlite" } },
    normalizeCandidate,
    filterForRerank,
    enrichLexicalCandidate,
    inferCategoryFromChunk,
    lexicalMatchScore,
    computeRecencyBoost,
    normalizeUnixSeconds,
    toFiniteNumber,
    toDebugErrorMessage,
    warnHybridSearchOnce: recordWarn(warnHybridSearchOnce),
    warnVectorChannelOnce: recordWarn(warnVectorChannelOnce),
    uniqueVectorChannels: () => Array.isArray(channels.vector) && channels.vector.length > 0,
    confidenceMap: new Map([["chunk-1", {
      confidence: 0.82,
      last_confidence_update: 0,
      base_tau: 7,
      hit_count: 3,
      is_protected: 0,
      conflict_flag: 0,
      category: "raw_log",
      is_archived: 0,
    }]]),
    chunkMetaMap: new Map([["chunk-1", { id: "chunk-1", path: "memory/smart-add/2026-05-27.md", updated_at: 1710000000 }]]),
    getMemorySearchManagerFn: async () => ({ manager: { search: async () => ({ entries: [] }) } }),
    getLancedbRuntimeRuntime: null,
    getLancedbTableRuntime: null,
    generateEmbeddingRuntime: async () => [0.1, 0.2, 0.3],
    shouldSkipVector: false,
    withDb: fn => fn({
      prepare() {
        return { all: () => [] };
      },
    }),
    ...overrides,
  };
}

test("FTS channel collects candidates and updates debug/count fields", async () => {
  let seenSql = "";
  const ctx = makeBaseCtx({
    normalizedQuery: "memory engine",
    fallbackFtsQuery: "memory OR engine",
    queryTerms: ["memory", "engine"],
    withDb: fn => fn({
      prepare(sql) {
        seenSql = String(sql);
        return {
          all(query) {
            if (String(query).includes(" OR ")) return [];
            return [{
              id: "chunk-1",
              text: "memory engine note",
              path: "memory/smart-add/2026-05-27.md",
              updated_at: 1710000000,
              confidence: 0.82,
              last_confidence_update: 0,
              base_tau: 7,
              hit_count: 3,
              is_protected: 0,
              conflict_flag: 0,
              category: "raw_log",
              is_archived: 0,
            }];
          },
        };
      },
    }),
  });

  const { ftsIsEmpty } = await collectFtsCandidates(ctx);
  assert.equal(ftsIsEmpty, false);
  assert.equal(seenSql.includes("COALESCE(mc.is_archived, 0) = 0"), true);
  assert.equal(ctx.candidateCounts.fts_raw_primary, 1);
  assert.equal(ctx.candidateCounts.fts_raw_final, 1);
  assert.equal(ctx.debug.strict_count, 1);
  assert.equal(ctx.channels.fts.length, 1);
});

test("KG channel normalizes candidates and updates debug/count fields", async () => {
  const ctx = makeBaseCtx({
    normalizedQuery: "session checkpoint",
    queryTerms: ["session", "checkpoint"],
    withDb: fn => fn({
      prepare() {
        return {
          all() {
            return [{
              id: "chunk-1",
              text: "session checkpoint note",
              path: "memory/episodes/session-checkpoint.md",
              updated_at: 1710000000,
              confidence: 0.82,
              last_confidence_update: 0,
              base_tau: 7,
              hit_count: 3,
              is_protected: 0,
              conflict_flag: 0,
              category: "",
              is_archived: 0,
              kg_data: "session checkpoint project",
            }];
          },
        };
      },
    }),
  });

  await collectKgCandidates(ctx);
  assert.equal(ctx.candidateCounts.kg_raw, 1);
  assert.equal(ctx.candidateCounts.kg_after_conf_filter, 1);
  assert.equal(ctx.channels.kg[0].path, "memory/episodes/session-checkpoint.md");
  assert.equal(ctx.channels.kg[0].category, "episodic");
});

test("recent channel preserves fallback/debug semantics", async () => {
  const ctx = makeBaseCtx({
    normalizedQuery: "compatibility",
    queryTerms: ["compatibility"],
    channels: { vector: [{ id: "vector-1" }] },
    uniqueVectorChannels: () => true,
    withDb: fn => fn({
      prepare(sql) {
        const q = String(sql);
        return {
          all() {
            if (q.includes("(c.path LIKE ? OR c.text LIKE ?)")) return [];
            return [{
              id: "chunk-1",
              text: "compatibility note",
              path: "memory/smart-add/2026-05-27.md",
              updated_at: 1710000000,
              confidence: 0.82,
              last_confidence_update: 0,
              base_tau: 7,
              hit_count: 3,
              is_protected: 0,
              conflict_flag: 0,
              category: "raw_log",
              is_archived: 0,
            }];
          },
        };
      },
    }),
  });

  await collectRecentCandidates({ ...ctx, ftsIsEmpty: true });
  assert.equal(ctx.debug.fallbacks_triggered.includes("fts_empty"), true);
  assert.equal(ctx.debug.fallbacks_triggered.includes("vector_only"), true);
  assert.equal(ctx.debug.fallbacks_triggered.includes("recent_episodic"), true);
  assert.equal(ctx.candidateCounts.recent_raw, 1);
  assert.equal(ctx.candidateCounts.recent_fallback_raw, 1);
});

test("vector channel preserves success and fallback debug semantics", async () => {
  const successCtx = makeBaseCtx({
    confidenceMap: new Map([["chunk-1", {
      confidence: 0.82,
      last_confidence_update: 0,
      base_tau: 7,
      hit_count: 3,
      is_protected: 0,
      conflict_flag: 0,
      category: "raw_log",
      is_archived: 0,
    }]]),
    chunkMetaMap: new Map([["chunk-1", { id: "chunk-1", path: "memory/smart-add/2026-05-27.md", updated_at: 1710000000 }]]),
    getLancedbTableRuntime: () => ({
      search: () => ({
        limit: () => ({
          execute: async () => [{
            id: "chunk-1",
            text: "vector text",
            timestamp: 1710000000,
            _distance: 0.09,
          }],
        }),
      }),
    }),
  });

  await collectVectorCandidates(successCtx);
  assert.equal(successCtx.debug.vector_backend, "lancedb");
  assert.equal(successCtx.debug.vector_stage, "lancedb_search");
  assert.equal(typeof successCtx.debug.vector_ms, "number");
  assert.equal(successCtx.candidateCounts.vector_raw, 1);

  const fallbackCtx = makeBaseCtx({
    getLancedbRuntimeRuntime: async () => ({ table: null, readyState: "pending", timedOut: true }),
    getMemorySearchManagerFn: async () => ({
      manager: {
        search: async () => {
          throw new Error("no such table: chunks_vec");
        },
      },
    }),
  });

  await collectVectorCandidates(fallbackCtx);
  assert.equal(fallbackCtx.debug.vector_ready_state, "pending");
  assert.equal(fallbackCtx.debug.vector_stage, "fallback");
  assert.equal(fallbackCtx.warnings.some(w => w.message === "lancedb_pending_timeout"), true);
  assert.equal(fallbackCtx.warnings.some(w => w.message === "search_error"), true);
});

test("hybridSearch integration smoke keeps topK order and debug compatibility", async () => {
  const { hybridSearch } = await import(`../lib/recall/hybrid-search.js?ts=${Date.now()}_${Math.random()}`);
  const result = await hybridSearch("memory-engine compatibility", { topK: 3 }, {
    withDb: fn => fn({
      prepare(sql) {
        const q = String(sql);
        return {
          all(...args) {
            if (q.includes("SELECT chunk_id") && q.includes("FROM memory_confidence")) {
              return [{
                chunk_id: "chunk-1234567890abcdef",
                confidence: 0.82,
                last_confidence_update: 0,
                base_tau: 7,
                hit_count: 3,
                is_protected: 0,
                conflict_flag: 0,
                category: "raw_log",
                is_archived: 0,
              }];
            }
            if (q.includes("SELECT id, path, updated_at FROM chunks")) {
              return [{
                id: "chunk-1234567890abcdef",
                path: "memory/smart-add/memory-engine-compatibility.md",
                updated_at: 1710000000,
              }];
            }
            if (q.includes("FROM memory_confidence mc") && q.includes("mc.kg_data LIKE")) {
              return [{
                id: "chunk-1234567890abcdef",
                text: "memory-engine compatibility notes",
                path: "memory/smart-add/memory-engine-compatibility.md",
                updated_at: 1710000000,
                confidence: 0.82,
                last_confidence_update: 0,
                base_tau: 7,
                hit_count: 3,
                is_protected: 0,
                conflict_flag: 0,
                category: "raw_log",
                is_archived: 0,
                kg_data: "memory-engine compatibility stable module",
              }];
            }
            if (q.includes("FROM chunks_fts f")) {
              const query = String(args[0] || "");
              if (query.includes(" OR ")) return [];
              return [{
                id: "chunk-1234567890abcdef",
                text: "memory-engine compatibility notes",
                path: "memory/smart-add/memory-engine-compatibility.md",
                updated_at: 1710000000,
                confidence: 0.82,
                last_confidence_update: 0,
                base_tau: 7,
                hit_count: 3,
                is_protected: 0,
                conflict_flag: 0,
                category: "raw_log",
                is_archived: 0,
              }];
            }
            return [];
          },
        };
      },
    }),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getMemorySearchManager: async () => ({ manager: { search: async () => ({ entries: [] }) } }),
  });

  assert.deepEqual(result.results.map(item => item.id), ["chunk-1234567890"]);
  assert.equal(typeof result.debug.lexical_confidence, "number");
  assert.equal(Array.isArray(result.debug.post_rerank_topK), true);
});
