import test from "node:test";
import assert from "node:assert/strict";
import { hybridSearch } from "../lib/recall/hybrid-search.js";

function withFakeDb(fn) {
  const db = {
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
        get() {
          return null;
        },
      };
    },
  };
  return fn(db);
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
    "post_rerank_topK": [],
    "min_confidence": 0.15,
    "lexical_candidate_count": 0,
    "lexical_top_score": 0,
    "lexical_confidence": 0,
    "lexical_confidence_threshold": 0.7,
    "sync": {
      "synced": false,
      "reason": "test"
    },
    "recent_canary_mode": "off",
    "recent_canary_reason": "provider_unavailable",
    "recent_canary_scope_class": null,
    "recent_canary_sampled": false,
    "recent_canary_shadow_executed": false,
    "recent_canary_served_mode": "legacy",
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
    withDb: withFakeDb,
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
  assert.equal(after, EXPECTED_SNAPSHOT);
});

test("hybridSearch reuses one scoped DB session across internal withDb calls", async () => {
  let baseWithDbCalls = 0;
  let scopedRuns = 0;
  let scopedWithDbCalls = 0;
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
        get() {
          return null;
        },
      };
    },
  };
  const withScopedDb = fn => {
    baseWithDbCalls += 1;
    return fn({
      prepare() {
        throw new Error("hybridSearch should prefer withDb.scoped in this test");
      },
    });
  };
  withScopedDb.scoped = async (run) => {
    scopedRuns += 1;
    try {
      return await run((fn) => {
        scopedWithDbCalls += 1;
        return fn(scopedDb);
      });
    } finally {
      scopedCloseCount += 1;
    }
  };

  const result = await hybridSearch("x", { topK: 3 }, {
    withDb: withScopedDb,
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
  assert.equal(scopedWithDbCalls > 1, true);
  assert.equal(scopedCloseCount, 1);
  assert.equal(baseWithDbCalls, 0);
});

test("hybridSearch minConfidence default and override come from unified config", async () => {
  const baseRuntime = {
    withDb: withFakeDb,
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
