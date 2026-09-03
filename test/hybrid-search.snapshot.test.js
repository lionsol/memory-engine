import test from "node:test";
import assert from "node:assert/strict";
import { hybridSearch } from "../lib/recall/hybrid-search.js";

function withFakeDb(fn) {
  const db = {
    readonly: true,
    exec() {},
    prepare(sql) {
      const q = String(sql);
      return {
        all(...args) {
          if (q.includes("PRAGMA database_list")) return [{ name: "main" }];
          if (q.includes("SELECT chunk_id, confidence") && q.includes("FROM memory_confidence")) {
            return [{
              chunk_id: "chunk-1234567890abcdef",
              initial_confidence: 0.8,
              confidence: 0.8,
              last_confidence_update: 0,
              base_tau: 7,
              hit_count: 2,
              is_protected: 0,
              conflict_flag: 0,
              category: "raw_log",
              is_archived: 0,
            }];
          }
          if (q.includes("SELECT id, path, updated_at FROM chunks")) {
            return [{
              id: "chunk-1234567890abcdef",
              path: "memory/smart-add/2026-05-26.md",
              updated_at: 1710000000,
            }];
          }
          if (q.includes("FROM chunks c")) return [];
          if (q.includes("FROM chunks_fts f")) return [];
          if (q.includes("initial_confidence") && q.includes("FROM memory_confidence")) {
            return [{
              chunk_id: "chunk-1234567890abcdef",
              initial_confidence: 0.8,
              confidence: 0.8,
              last_confidence_update: 0,
              base_tau: 7,
              hit_count: 2,
              is_protected: 0,
              conflict_flag: 0,
              category: "raw_log",
              is_archived: 0,
            }];
          }
          if (q.includes("FROM chunks") && !q.includes("chunks_fts")) {
            return [{
              id: "chunk-1234567890abcdef",
              source: "openclaw_core",
              start_line: 1,
              end_line: 1,
              hash: null,
              text: "compat memory text",
              path: "memory/smart-add/2026-05-26.md",
              updated_at: 1710000000,
            }];
          }
          return [];
        },
        get(name) {
          return ["chunks", "chunks_fts", "memory_confidence"].includes(String(name))
            ? { 1: 1 }
            : undefined;
        },
      };
    },
  };
  return fn(db);
}

function withFakeDbScope(fn) {
  return withFakeDb(db => fn({
    withCoreDb: run => run(db),
    withEngineDb: run => run(db),
    capabilities: {
      isolatedFts: true,
      isolatedKg: true,
      isolatedRecent: true,
    },
  }));
}

const EXPECTED_SNAPSHOT = `{
  "pool": 1,
  "channels": [
    "vector"
  ],
  "channel_sizes": {
    "vector": 1
  },
  "debug": {
    "query_original": "x",
    "query_stripped": "x",
    "query_normalized": "x",
    "fts_query_final": "x",
    "vector_query": "x",
    "query_terms": [],
    "candidate_counts_before_filtering": {
      "kg_raw": 0,
      "kg_after_conf_filter": 0,
      "vector_raw": 1,
      "vector_after_conf_filter": 1,
      "fts_raw_primary": 0,
      "fts_raw_final": 0,
      "like_raw": 0,
      "recent_raw": 0,
      "episode_raw": 0,
      "recent_fallback_raw": 0
    },
    "fallbacks_triggered": [
      "fts_empty",
      "vector_only"
    ],
    "vector_backend": "memory-core-sqlite",
    "vector_backend_attempted": "lancedb",
    "vector_ready_state": "disabled",
    "vector_stage": "fallback",
    "vector_skipped": false,
    "vector_skip_reason": null,
    "vector_error": null,
    "vector_ms": 0,
    "vector_query_length": 1,
    "strict_count": 0,
    "fallback_count": 0,
    "fts_rerank_term_source": "primary_query",
    "fts_rerank_term_count": 0,
    "post_rerank_topK": [],
    "min_confidence": 0.15,
    "lexical_candidate_count": 0,
    "lexical_top_score": 0,
    "lexical_confidence": 0,
    "lexical_confidence_threshold": 0.7,
    "sync": {
      "synced": false,
      "reason": "read_only_search"
    },
    "recent_canary_mode": "off",
    "recent_canary_reason": "provider_unavailable",
    "recent_canary_scope_class": null,
    "recent_canary_sampled": false,
    "recent_canary_shadow_executed": false,
    "recent_canary_served_mode": "none",
    "recent_canary_policy_error": false,
    "recent_runtime_mode": "legacy_fallback",
    "recent_rollout_scope": "none",
    "recent_scope_required": false,
    "recent_fail_closed_applied": null,
    "recent_fail_closed_fallback_suppressed": null,
    "recent_fail_closed_scope_match": null,
    "recent_fail_closed_empty_candidate": null,
    "like_patterns": [],
    "channel_sizes": {
      "vector": 1
    },
    "channel_candidate_provenance": {
      "vector": {
        "count": 1,
        "captured_count": 1,
        "truncated": false,
        "ids": [
          "chunk-1234567890"
        ]
      }
    },
    "fusion_candidate_provenance": {
      "pre_rerank_ids": [
        "chunk-1234567890"
      ],
      "post_rerank_ids": [
        "chunk-1234567890"
      ]
    },
    "source_breakdown": {
      "vector": 1,
      "smart-add": 1
    },
    "category_breakdown": {
      "raw_log": 1
    },
    "pre_rerank_top": [
      {
        "id": "chunk-1234567890",
        "score": 0.0164,
        "category": "raw_log",
        "confidence_mode": "managed",
        "source_type": "memory-engine-managed",
        "external_badge": false,
        "decay_eligible": true,
        "archive_eligible": true,
        "sources": [
          "vector",
          "smart-add"
        ],
        "path": "memory/smart-add/2026-05-26.md",
        "preview": "compat memory text"
      }
    ],
    "post_rerank_top": [
      {
        "id": "chunk-1234567890",
        "score": 1.0064,
        "semantic_score": 0.91,
        "rrf_score": 0.0164,
        "recency_boost": 0,
        "category_boost": 0,
        "confidence_boost": 0.08,
        "external_boost": 0,
        "category": "raw_log",
        "confidence_mode": "managed",
        "source_type": "memory-engine-managed",
        "external_badge": false,
        "decay_eligible": true,
        "archive_eligible": true,
        "sources": [
          "vector",
          "smart-add"
        ],
        "path": "memory/smart-add/2026-05-26.md",
        "preview": "compat memory text"
      }
    ]
  },
  "results": [
    {
      "id": "chunk-1234567890",
      "text": "compat memory text",
      "path": "memory/smart-add/2026-05-26.md",
      "category": "raw_log",
      "confidence_mode": "managed",
      "source_type": "memory-engine-managed",
      "external_badge": false,
      "decay_eligible": true,
      "archive_eligible": true,
      "semantic_score": 0.91,
      "rrf_score": 0.0164,
      "recency_boost": 0,
      "category_boost": 0,
      "confidence_boost": 0.08,
      "external_boost": 0,
      "final_score": 1.0064,
      "sources": [
        "vector",
        "smart-add"
      ],
      "similarity": 0.91,
      "confidence": 0.8,
      "hits": 2,
      "created_at": 1710000000
    }
  ]
}`;

test("hybridSearch snapshot stays JSON-stringify compatible", async () => {
  const result = await hybridSearch("x", { topK: 3 }, {
    withHybridDbAccessScope: withFakeDbScope,
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    categoryMap: { raw_log: { conf: 0.5, tau: 7 } },
    getMemorySearchManager: async () => ({
      manager: {
        search: async () => ({
          entries: [{ id: "chunk-1234567890abcdef", text: "compat memory text", similarity: 0.91 }],
        }),
      },
    }),
  });

  if (result?.debug && Number.isFinite(result.debug.vector_ms)) {
    result.debug.vector_ms = 0;
  }
  const after = JSON.stringify(result, null, 2);
  const actualSnapshot = JSON.parse(after);
  const expectedSnapshot = JSON.parse(EXPECTED_SNAPSHOT);
  assert.deepEqual({
    pool: actualSnapshot.pool,
    channels: actualSnapshot.channels,
    channel_sizes: actualSnapshot.channel_sizes,
    candidate_counts: actualSnapshot.debug.candidate_counts_before_filtering,
    result: {
      id: actualSnapshot.results[0]?.id,
      text: actualSnapshot.results[0]?.text,
      path: actualSnapshot.results[0]?.path,
      category: actualSnapshot.results[0]?.category,
      confidence_mode: actualSnapshot.results[0]?.confidence_mode,
      semantic_score: actualSnapshot.results[0]?.semantic_score,
      rrf_score: actualSnapshot.results[0]?.rrf_score,
      final_score: actualSnapshot.results[0]?.final_score,
      sources: actualSnapshot.results[0]?.sources,
    },
  }, {
    pool: expectedSnapshot.pool,
    channels: expectedSnapshot.channels,
    channel_sizes: expectedSnapshot.channel_sizes,
    candidate_counts: expectedSnapshot.debug.candidate_counts_before_filtering,
    result: {
      id: expectedSnapshot.results[0]?.id,
      text: expectedSnapshot.results[0]?.text,
      path: expectedSnapshot.results[0]?.path,
      category: expectedSnapshot.results[0]?.category,
      confidence_mode: expectedSnapshot.results[0]?.confidence_mode,
      semantic_score: expectedSnapshot.results[0]?.semantic_score,
      rrf_score: expectedSnapshot.results[0]?.rrf_score,
      final_score: expectedSnapshot.results[0]?.final_score,
      sources: expectedSnapshot.results[0]?.sources,
    },
  });
  assert.equal(actualSnapshot.debug.recent_access_mode, "isolated");
  assert.equal(actualSnapshot.debug.canonical_result_projection.resolved_count, 1);
  assert.equal(actualSnapshot.results[0]?.memory_id, "chunk-1234567890abcdef");
  assert.equal(actualSnapshot.results[0]?.canonical_id, "cmem:core:chunk-1234567890abcdef");
});

test("hybridSearch reuses one scoped DB session across isolated reader calls", async () => {
  let scopedRuns = 0;
  let scopedReaderCalls = 0;
  let scopedCloseCount = 0;
  const scopedDb = {
    prepare(sql) {
      const q = String(sql);
      return {
        all() {
          if (q.includes("SELECT chunk_id") && q.includes("FROM memory_confidence")) {
            return [{
              chunk_id: "chunk-1234567890abcdef",
              confidence: 0.8,
              last_confidence_update: 0,
              base_tau: 7,
              hit_count: 2,
              is_protected: 0,
              conflict_flag: 0,
              category: "raw_log",
              is_archived: 0,
            }];
          }
          if (q.includes("SELECT id, path, updated_at FROM chunks")) {
            return [{
              id: "chunk-1234567890abcdef",
              path: "memory/smart-add/2026-05-26.md",
              updated_at: 1710000000,
            }];
          }
          return [];
        },
        get(name) {
          return ["chunks", "chunks_fts", "memory_confidence"].includes(String(name))
            ? { 1: 1 }
            : null;
        },
      };
    },
  };
  const withHybridDbAccessScope = async run => {
    scopedRuns += 1;
    try {
      return await run({
        withCoreDb: fn => {
          scopedReaderCalls += 1;
          return fn(scopedDb);
        },
        withEngineDb: fn => {
          scopedReaderCalls += 1;
          return fn(scopedDb);
        },
        capabilities: {
          isolatedFts: true,
          isolatedKg: true,
          isolatedRecent: true,
        },
      });
    } finally {
      scopedCloseCount += 1;
    }
  };

  const result = await hybridSearch("x", { topK: 3 }, {
    withHybridDbAccessScope,
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    categoryMap: { raw_log: { conf: 0.5, tau: 7 } },
    getMemorySearchManager: async () => ({
      manager: {
        search: async () => ({
          entries: [{ id: "chunk-1234567890abcdef", text: "compat memory text", similarity: 0.91 }],
        }),
      },
    }),
  });

  assert.equal(result.pool, 1);
  assert.equal(scopedRuns, 1);
  assert.equal(scopedReaderCalls > 1, true);
  assert.equal(scopedCloseCount, 1);
});

test("hybridSearch minConfidence default and override come from unified config", async () => {
  const baseRuntime = {
    withHybridDbAccessScope: withFakeDbScope,
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    categoryMap: { raw_log: { conf: 0.5, tau: 7 } },
    getMemorySearchManager: async () => ({
      manager: {
        search: async () => ({
          entries: [{ id: "chunk-1234567890abcdef", text: "compat memory text", similarity: 0.91 }],
        }),
      },
    }),
  };

  const defaultResult = await hybridSearch("x", { topK: 3 }, baseRuntime);
  const overrideResult = await hybridSearch("x", { topK: 3 }, {
    ...baseRuntime,
    cfg: {
      memoryEngine: {
        confidence: {
          min: 0.22,
        },
      },
    },
  });

  assert.equal(defaultResult.debug.min_confidence, 0.15);
  assert.equal(overrideResult.debug.min_confidence, 0.22);
});

test("hybridSearch captures bounded channel provenance without changing result order or scores", async () => {
  const ids = Array.from({ length: 33 }, (_, index) => `c${String(index).padStart(15, "0")}`);
  const confidenceRows = ids.map(id => ({
    chunk_id: id,
    initial_confidence: 0.8,
    confidence: 0.8,
    last_confidence_update: 0,
    base_tau: 7,
    hit_count: 2,
    is_protected: 0,
    conflict_flag: 0,
    category: "raw_log",
    is_archived: 0,
  }));
  const chunkRows = ids.map((id, index) => ({
    id,
    source: "openclaw_core",
    start_line: 1,
    end_line: 1,
    hash: null,
    text: "compat memory text",
    path: `memory/${index}.md`,
    updated_at: 1710000000,
  }));
  const db = {
    readonly: true,
    exec() {},
    prepare(sql) {
      const query = String(sql);
      return {
        all() {
          if (query.includes("PRAGMA database_list")) return [{ name: "main" }];
          if (query.includes("chunk_id") && query.includes("FROM memory_confidence")) {
            return confidenceRows;
          }
          if (query.includes("SELECT id, path, updated_at FROM chunks")) return chunkRows;
          if (query.includes("FROM chunks c")) return [];
          if (query.includes("FROM chunks") && !query.includes("chunks_fts")) return chunkRows;
          return [];
        },
        get(name) {
          return ["chunks", "chunks_fts", "memory_confidence"].includes(String(name))
            ? { 1: 1 }
            : null;
        },
      };
    },
  };
  const result = await hybridSearch("x", { topK: 5 }, {
    withHybridDbAccessScope: async run => run({
      withCoreDb: fn => fn(db),
      withEngineDb: fn => fn(db),
      capabilities: {
        isolatedFts: true,
        isolatedKg: true,
        isolatedRecent: true,
      },
    }),
    calcRealtimeConf: row => row.confidence,
    cfg: {
      memoryEngine: {
        recall: { vectorTopK: 40 },
      },
    },
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    categoryMap: { raw_log: { conf: 0.5, tau: 7 } },
    getMemorySearchManager: async () => ({
      manager: {
        search: async () => ({
          entries: ids.map(id => ({ id, text: "compat memory text", similarity: 0.91 })),
        }),
      },
    }),
  });

  assert.deepEqual(result.results.map(item => item.id), ids.slice(0, 5));
  assert.deepEqual(result.results.map(item => item.final_score), [1.0064, 1.0061, 1.0059, 1.0056, 1.0054]);
  assert.deepEqual(result.debug.channel_candidate_provenance.vector, {
    count: 33,
    captured_count: 32,
    truncated: true,
    ids: ids.slice(0, 32),
  });
  assert.deepEqual(result.debug.fusion_candidate_provenance, {
    pre_rerank_ids: ids.slice(0, 8),
    post_rerank_ids: ids.slice(0, 8),
  });
});
