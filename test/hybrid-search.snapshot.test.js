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
    "strict_count": 0,
    "fallback_count": 0,
    "post_rerank_topK": [],
    "sync": {
      "synced": false,
      "reason": "test"
    },
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
        "score": 0.0164,
        "rrf_score": 0.0164,
        "recency_boost": 0,
        "category_boost": 0,
        "category": "raw_log",
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
      "rrf_score": 0.0164,
      "recency_boost": 0,
      "category_boost": 0,
      "final_score": 0.0164,
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

  const after = JSON.stringify(result, null, 2);
  assert.equal(after, EXPECTED_SNAPSHOT);
});
