import test from "node:test";
import assert from "node:assert/strict";

function makeDbForVector({ includeRecentRows = false } = {}) {
  return {
    prepare(sql) {
      const q = String(sql);
      return {
        all() {
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
              path: "memory/smart-add/2026-05-27.md",
              updated_at: 1710000000,
            }];
          }
          if (includeRecentRows && q.includes("FROM chunks c") && q.includes("ORDER BY c.updated_at DESC")) {
            return [{
              id: "chunk-recent-1",
              text: "query fallback text",
              path: "memory/smart-add/2026-05-27.md",
              updated_at: 1710000000,
              confidence: 0.71,
              last_confidence_update: 0,
              base_tau: 7,
              hit_count: 1,
              is_protected: 0,
              conflict_flag: 0,
              category: "raw_log",
            }];
          }
          return [];
        },
      };
    },
  };
}

function makeDbForTiered({
  confidence = 0.82,
  ftsRows = [],
  fallbackFtsRows = [],
  kgRows = [],
  recentRows = [],
  chunkPath = "memory/smart-add/2026-05-27.md",
} = {}) {
  const confidenceRows = [{
    chunk_id: "chunk-1234567890abcdef",
    confidence,
    last_confidence_update: 0,
    base_tau: 7,
    hit_count: 3,
    is_protected: 0,
    conflict_flag: 0,
    category: "raw_log",
    is_archived: 0,
  }];
  const chunkRows = [{
    id: "chunk-1234567890abcdef",
    path: chunkPath,
    updated_at: 1710000000,
  }];
  return {
    prepare(sql) {
      const q = String(sql);
      return {
        all(...args) {
          if (q.includes("SELECT chunk_id") && q.includes("FROM memory_confidence")) return confidenceRows;
          if (q.includes("SELECT id, path, updated_at FROM chunks")) return chunkRows;
          if (q.includes("FROM memory_confidence mc") && q.includes("mc.kg_data LIKE")) return kgRows;
          if (q.includes("FROM chunks_fts f")) {
            const query = String(args[0] || "");
            return query.includes(" OR ") ? fallbackFtsRows : ftsRows;
          }
          if (q.includes("ORDER BY c.updated_at DESC")) return recentRows;
          return [];
        },
      };
    },
  };
}

async function loadHybridSearchFresh() {
  const mod = await import(`../lib/recall/hybrid-search.js?ts=${Date.now()}_${Math.random()}`);
  return mod.hybridSearch;
}

test("hybridSearch passes cfg into getMemorySearchManager", async () => {
  const hybridSearch = await loadHybridSearchFresh();
  const cfg = { memory: { backend: "sqlite" } };
  let receivedParams = null;

  await hybridSearch("query", { topK: 3 }, {
    cfg,
    withDb: fn => fn(makeDbForVector()),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getMemorySearchManager: async params => {
      receivedParams = params;
      return {
        manager: {
          search: async () => ({ entries: [] }),
        },
      };
    },
  });

  assert.equal(Boolean(receivedParams), true);
  assert.equal(receivedParams.cfg, cfg);
});

test("hybridSearch prefers LanceDB vector search over memory-core manager", async () => {
  const hybridSearch = await loadHybridSearchFresh();
  let managerCalled = false;
  let lancedbSearchCalled = false;

  const result = await hybridSearch("query", { topK: 3 }, {
    cfg: { memory: { backend: "sqlite" } },
    withDb: fn => fn(makeDbForVector()),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getLancedbTable: () => ({
      search: () => ({
        limit: () => ({
          execute: async () => {
            lancedbSearchCalled = true;
            return [{
              id: "chunk-1234567890abcdef",
              text: "vector text",
              timestamp: 1710000000,
              _distance: 0.09,
            }];
          },
        }),
      }),
    }),
    generateEmbedding: async () => [0.1, 0.2, 0.3],
    getMemorySearchManager: async () => {
      managerCalled = true;
      return {
        manager: {
          search: async () => ({ entries: [] }),
        },
      };
    },
  });

  assert.equal(lancedbSearchCalled, true);
  assert.equal(managerCalled, false);
  assert.equal(result?.debug?.vector_backend, "lancedb");
  assert.equal(result?.debug?.vector_backend_attempted, "lancedb");
  assert.equal(result?.debug?.vector_ready_state, "ready");
  assert.equal(result?.debug?.vector_stage, "lancedb_search");
  assert.equal(result?.debug?.candidate_counts_before_filtering?.vector_raw, 1);
  assert.equal(result?.debug?.candidate_counts_before_filtering?.vector_raw > 0, true);
});

test("hybridSearch degrades when generateEmbedding throws and exposes embedding stage error", async () => {
  const hybridSearch = await loadHybridSearchFresh();
  let memoryCoreSearchCalled = false;
  let lancedbSearchCalled = false;

  const result = await hybridSearch("query", { topK: 3 }, {
    cfg: { memory: { backend: "sqlite" } },
    withDb: fn => fn(makeDbForVector()),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getLancedbTable: () => ({
      search: () => ({
        limit: () => ({
          execute: async () => {
            lancedbSearchCalled = true;
            return [];
          },
        }),
      }),
    }),
    generateEmbedding: async () => {
      throw new Error("embed boom");
    },
    getMemorySearchManager: async () => ({
      manager: {
        search: async () => {
          memoryCoreSearchCalled = true;
          return { entries: [{ id: "chunk-1234567890abcdef", text: "fallback vector text", similarity: 0.91 }] };
        },
      },
    }),
  });

  assert.equal(memoryCoreSearchCalled, true);
  assert.equal(lancedbSearchCalled, false);
  assert.equal(result?.debug?.vector_backend, "memory-core-sqlite");
  assert.equal(result?.debug?.vector_stage, "embedding");
  assert.equal(typeof result?.debug?.vector_error, "string");
  assert.equal(result?.debug?.vector_error.includes("embed boom"), true);
});

test("hybridSearch degrades when embedding is empty and exposes error", async () => {
  const hybridSearch = await loadHybridSearchFresh();
  let memoryCoreSearchCalled = false;
  let lancedbSearchCalled = false;

  const result = await hybridSearch("query", { topK: 3 }, {
    cfg: { memory: { backend: "sqlite" } },
    withDb: fn => fn(makeDbForVector()),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getLancedbTable: () => ({
      search: () => ({
        limit: () => ({
          execute: async () => {
            lancedbSearchCalled = true;
            return [];
          },
        }),
      }),
    }),
    generateEmbedding: async () => [],
    getMemorySearchManager: async () => ({
      manager: {
        search: async () => {
          memoryCoreSearchCalled = true;
          return { entries: [{ id: "chunk-1234567890abcdef", text: "fallback vector text", similarity: 0.91 }] };
        },
      },
    }),
  });

  assert.equal(memoryCoreSearchCalled, true);
  assert.equal(lancedbSearchCalled, false);
  assert.equal(result?.debug?.vector_backend, "memory-core-sqlite");
  assert.equal(result?.debug?.vector_stage, "embedding");
  assert.equal(result?.debug?.vector_error, "empty embedding");
});

test("hybridSearch degrades when LanceDB search throws and exposes search stage error", async () => {
  const hybridSearch = await loadHybridSearchFresh();
  let memoryCoreSearchCalled = false;

  const result = await hybridSearch("query", { topK: 3 }, {
    cfg: { memory: { backend: "sqlite" } },
    withDb: fn => fn(makeDbForVector()),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getLancedbTable: () => ({
      search: () => ({
        limit: () => ({
          execute: async () => {
            throw new Error("lancedb search boom");
          },
        }),
      }),
    }),
    generateEmbedding: async () => [0.1, 0.2, 0.3],
    getMemorySearchManager: async () => ({
      manager: {
        search: async () => {
          memoryCoreSearchCalled = true;
          return { entries: [{ id: "chunk-1234567890abcdef", text: "fallback vector text", similarity: 0.91 }] };
        },
      },
    }),
  });

  assert.equal(memoryCoreSearchCalled, true);
  assert.equal(result?.debug?.vector_backend, "memory-core-sqlite");
  assert.equal(result?.debug?.vector_stage, "lancedb_search");
  assert.equal(typeof result?.debug?.vector_error, "string");
  assert.equal(result?.debug?.vector_error.includes("lancedb search boom"), true);
});

test("hybridSearch pending readiness falls back to memory-core and marks pending state", async () => {
  const hybridSearch = await loadHybridSearchFresh();
  let memoryCoreSearchCalled = false;
  const result = await hybridSearch("query", { topK: 3 }, {
    cfg: { memory: { backend: "sqlite" } },
    withDb: fn => fn(makeDbForVector()),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getLancedbRuntime: async () => ({ table: null, readyState: "pending", timedOut: true }),
    getMemorySearchManager: async () => ({
      manager: {
        search: async () => {
          memoryCoreSearchCalled = true;
          return { entries: [{ id: "chunk-1234567890abcdef", text: "vector text", similarity: 0.91 }] };
        },
      },
    }),
  });

  assert.equal(memoryCoreSearchCalled, true);
  assert.equal(result?.debug?.vector_ready_state, "pending");
  assert.equal(result?.debug?.vector_backend, "memory-core-sqlite");
});

test("hybridSearch uses LanceDB after readiness resolves", async () => {
  const hybridSearch = await loadHybridSearchFresh();
  let ready = false;
  let lancedbSearchCalled = false;
  let memoryCoreSearchCalled = false;

  const runtime = async () => (ready
    ? {
      table: {
        search: () => ({
          limit: () => ({
            execute: async () => {
              lancedbSearchCalled = true;
              return [{
                id: "chunk-1234567890abcdef",
                text: "vector text",
                timestamp: 1710000000,
                _distance: 0.09,
              }];
            },
          }),
        }),
      },
      readyState: "ready",
      timedOut: false,
    }
    : { table: null, readyState: "pending", timedOut: true }
  );

  await hybridSearch("query", { topK: 3 }, {
    cfg: { memory: { backend: "sqlite" } },
    withDb: fn => fn(makeDbForVector()),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getLancedbRuntime: runtime,
    getMemorySearchManager: async () => ({
      manager: {
        search: async () => {
          memoryCoreSearchCalled = true;
          return { entries: [{ id: "chunk-1234567890abcdef", text: "vector text", similarity: 0.91 }] };
        },
      },
    }),
  });

  ready = true;
  memoryCoreSearchCalled = false;
  const result = await hybridSearch("query", { topK: 3 }, {
    cfg: { memory: { backend: "sqlite" } },
    withDb: fn => fn(makeDbForVector()),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getLancedbRuntime: runtime,
    generateEmbedding: async () => [0.1, 0.2, 0.3],
    getMemorySearchManager: async () => ({
      manager: {
        search: async () => {
          memoryCoreSearchCalled = true;
          return { entries: [] };
        },
      },
    }),
  });

  assert.equal(lancedbSearchCalled, true);
  assert.equal(memoryCoreSearchCalled, false);
  assert.equal(result?.debug?.vector_ready_state, "ready");
  assert.equal(result?.debug?.vector_backend, "lancedb");
});

test("hybridSearch warns when manager init fails instead of silent swallow", async () => {
  const hybridSearch = await loadHybridSearchFresh();
  const cfg = { memory: { backend: "sqlite" } };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(v => String(v)).join(" "));

  try {
    await hybridSearch("query", { topK: 3 }, {
      cfg,
      withDb: fn => fn(makeDbForVector()),
      calcRealtimeConf: row => row.confidence,
      syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
      getMemorySearchManager: async () => {
        throw new Error("init boom");
      },
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length > 0, true);
  assert.equal(warnings.some(line => line.includes("hybridSearch vector channel unavailable")), true);
});

test("hybridSearch falls back when LanceDB unavailable and memory-core search backend fails", async () => {
  const hybridSearch = await loadHybridSearchFresh();
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(v => String(v)).join(" "));

  try {
    const result = await hybridSearch("query", { topK: 3 }, {
      cfg: { memory: { backend: "sqlite" } },
      withDb: fn => fn(makeDbForVector({ includeRecentRows: true })),
      calcRealtimeConf: row => row.confidence,
      syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
      getLancedbRuntime: async () => ({ table: null, readyState: "pending", timedOut: true }),
      getMemorySearchManager: async () => ({
        manager: {
          search: async () => {
            throw new Error("no such table: chunks_vec");
          },
        },
      }),
    });

    assert.equal(result?.results?.length > 0, true);
    assert.equal(result?.debug?.vector_backend, "disabled");
    assert.equal(result?.debug?.vector_ready_state, "pending");
    assert.equal(
      Array.isArray(result?.debug?.fallbacks_triggered) && result.debug.fallbacks_triggered.includes("recent_episodic"),
      true
    );
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.some(line => line.includes("hybridSearch vector channel unavailable")), true);
  assert.equal(warnings.some(line => line.includes("lancedb_pending_timeout")), true);
  assert.equal(warnings.some(line => line.includes("chunks_vec")), true);
});

test("hybridSearch marks failed readiness and exposes init error while falling back", async () => {
  const hybridSearch = await loadHybridSearchFresh();
  let memoryCoreSearchCalled = false;
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(v => String(v)).join(" "));

  try {
    const result = await hybridSearch("query", { topK: 3 }, {
      cfg: { memory: { backend: "sqlite" } },
      withDb: fn => fn(makeDbForVector()),
      calcRealtimeConf: row => row.confidence,
      syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
      getLancedbRuntime: async () => ({ table: null, readyState: "failed", initError: "lance boom", timedOut: false }),
      getMemorySearchManager: async () => ({
        manager: {
          search: async () => {
            memoryCoreSearchCalled = true;
            return { entries: [{ id: "chunk-1234567890abcdef", text: "vector text", similarity: 0.91 }] };
          },
        },
      }),
    });

    assert.equal(memoryCoreSearchCalled, true);
    assert.equal(result?.debug?.vector_ready_state, "failed");
    assert.equal(result?.debug?.vector_init_error, "lance boom");
    assert.equal(result?.debug?.vector_backend, "memory-core-sqlite");
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.some(line => line.includes("lancedb_init_failed")), true);
});

test("hybridSearch skips vector on strong KG/FTS lexical confidence", async () => {
  const hybridSearch = await loadHybridSearchFresh();
  let lancedbSearchCalled = false;
  let managerCalled = false;

  const result = await hybridSearch("memory-engine compatibility", { topK: 3 }, {
    withDb: fn => fn(makeDbForTiered({
      ftsRows: [{
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
      }],
      kgRows: [{
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
      }],
    })),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getLancedbTable: () => ({
      search: () => ({
        limit: () => ({
          execute: async () => {
            lancedbSearchCalled = true;
            return [];
          },
        }),
      }),
    }),
    generateEmbedding: async () => [0.1, 0.2, 0.3],
    getMemorySearchManager: async () => {
      managerCalled = true;
      return { manager: { search: async () => ({ entries: [] }) } };
    },
  });

  assert.equal(lancedbSearchCalled, false);
  assert.equal(managerCalled, false);
  assert.equal(result?.results?.length > 0, true);
  assert.equal(result?.debug?.vector_skipped, true);
  assert.equal(result?.debug?.vector_skip_reason, "lexical_confidence_threshold_met");
  assert.equal(result?.debug?.vector_stage, "skipped");
  assert.equal(result?.debug?.lexical_confidence >= 0.7, true);
});

test("hybridSearch runs vector on weak KG/FTS lexical confidence", async () => {
  const hybridSearch = await loadHybridSearchFresh();
  let lancedbSearchCalled = false;

  const result = await hybridSearch("compatibility", { topK: 3 }, {
    withDb: fn => fn(makeDbForTiered({
      ftsRows: [{
        id: "chunk-1234567890abcdef",
        text: "generic note",
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
      }],
    })),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getLancedbTable: () => ({
      search: () => ({
        limit: () => ({
          execute: async () => {
            lancedbSearchCalled = true;
            return [{
              id: "chunk-1234567890abcdef",
              text: "vector text",
              timestamp: 1710000000,
              _distance: 0.09,
            }];
          },
        }),
      }),
    }),
    generateEmbedding: async () => [0.1, 0.2, 0.3],
    getMemorySearchManager: async () => ({ manager: { search: async () => ({ entries: [] }) } }),
  });

  assert.equal(lancedbSearchCalled, true);
  assert.equal(result?.debug?.vector_skipped, false);
  assert.equal(result?.debug?.lexical_confidence < 0.7, true);
  assert.equal(result?.debug?.vector_backend, "lancedb");
});

test("hybridSearch keeps fallback zero coverage filter and surfaces lexical debug metadata", async () => {
  const hybridSearch = await loadHybridSearchFresh();
  let lancedbSearchCalled = false;

  const result = await hybridSearch("5.20+ 和 memory-engine 兼容性", { topK: 3 }, {
    withDb: fn => fn(makeDbForTiered({
      fallbackFtsRows: [
        {
          id: "chunk-1234567890abcdef",
          text: "兼容性检查：5.20+ 与 memory-engine 可用",
          path: "memory/smart-add/2026-05-27.md",
          updated_at: 1710000000,
          confidence: 0.82,
          last_confidence_update: 0,
          base_tau: 7,
          hit_count: 3,
          is_protected: 0,
          conflict_flag: 0,
          category: "episodic",
          is_archived: 0,
        },
        {
          id: "chunk-zero-coverage",
          text: "memory engine tuning notes",
          path: "memory/archive/2025-01-01.md",
          updated_at: 1700000000,
          confidence: 0.82,
          last_confidence_update: 0,
          base_tau: 7,
          hit_count: 1,
          is_protected: 0,
          conflict_flag: 0,
          category: "raw_log",
          is_archived: 0,
        },
      ],
    })),
    calcRealtimeConf: row => row.confidence,
    syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
    getLancedbTable: () => ({
      search: () => ({
        limit: () => ({
          execute: async () => {
            lancedbSearchCalled = true;
            return [];
          },
        }),
      }),
    }),
    generateEmbedding: async () => [0.1, 0.2, 0.3],
    getMemorySearchManager: async () => ({ manager: { search: async () => ({ entries: [] }) } }),
  });

  assert.equal(result?.results?.length, 1);
  assert.equal(result?.results?.[0]?.id, "chunk-1234567890");
  assert.equal(result?.debug?.candidate_counts_before_filtering?.fts_raw_primary, 0);
  assert.equal(result?.debug?.candidate_counts_before_filtering?.fts_raw_final, 1);
  assert.equal(typeof result?.debug?.lexical_candidate_count, "number");
  assert.equal(typeof result?.debug?.lexical_top_score, "number");
  assert.equal(typeof result?.debug?.lexical_confidence, "number");
  assert.equal(typeof result?.debug?.vector_skipped, "boolean");
  assert.equal(typeof lancedbSearchCalled, "boolean");
});
