import test from "node:test";
import assert from "node:assert/strict";

import { collectFtsCandidates } from "../lib/recall/hybrid/channels/fts.js";
import {
  ISOLATED_FTS_SQL,
  isArchivedLikeLegacySql,
  mergeFtsConfidenceRow,
} from "../lib/recall/hybrid/channels/fts-query.js";
import { collectKgCandidates } from "../lib/recall/hybrid/channels/kg.js";
import { CORE_KG_JSON_JOIN_SQL } from "../lib/recall/hybrid/channels/kg-query.js";
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

function makeDebugAndCounts(minConfidence = 0.15) {
  const candidateCounts = createCandidateCounts();
  const debug = createHybridDebug({
    rawQuery: "query",
    strippedQuery: "query",
    normalizedQuery: "query",
    queryTerms: ["query"],
    candidateCounts,
    minConfidence,
    lexicalConfidenceThreshold: 0.7,
  });
  return { candidateCounts, debug };
}

function makeBaseCtx(overrides = {}) {
  const minConfidence = overrides.minConfidence ?? 0.15;
  const { candidateCounts, debug } = makeDebugAndCounts(minConfidence);
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
    withEngineDb: fn => fn({
      prepare() {
        return { all: () => [] };
      },
    }),
    withCoreDb: fn => fn({
      prepare() {
        return { all: () => [] };
      },
    }),
    ftsAccessMode: "legacy",
    kgAccessMode: "legacy",
    kgIsolationRequested: false,
    kgIsolationFallbackReason: null,
    recentAccessMode: "legacy",
    recentIsolationRequested: false,
    recentIsolationFallbackReason: null,
    minConfidence,
    filterForRerank: item => isCandidateAllowedForRerank(item, minConfidence),
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

test("FTS isolated mode uses Core JSON archived filtering and never legacy SQL", async () => {
  let legacyCalls = 0;
  let coreSql = "";
  let coreArgs = [];
  const ctx = makeBaseCtx({
    ftsAccessMode: "isolated",
    normalizedQuery: "memory engine",
    fallbackFtsQuery: "memory OR engine",
    queryTerms: ["memory", "engine"],
    confidenceMap: new Map([
      ["archived\"id", { is_archived: 1 }],
      ["active", { confidence: 0.8, category: "raw_log", is_archived: 0 }],
    ]),
    withDb: fn => {
      legacyCalls += 1;
      return fn({ prepare: () => ({ all: () => [] }) });
    },
    withCoreDb: fn => fn({
      prepare(sql) {
        coreSql = String(sql);
        return { all: (...args) => { coreArgs = args; return [{ id: "active", text: "memory engine", path: "memory/a.md", updated_at: 1 }]; } };
      },
    }),
  });

  await collectFtsCandidates(ctx);
  assert.equal(coreSql.includes("chunks_fts"), true);
  assert.equal(coreSql.includes("json_each"), true);
  assert.equal(coreSql.includes("NOT EXISTS"), true);
  assert.equal(coreSql.includes("memory_confidence"), false);
  assert.equal(coreSql.includes("ATTACH"), false);
  assert.equal(coreSql.includes("TEMP"), false);
  assert.deepEqual(JSON.parse(coreArgs[1]), ["archived\"id"]);
  assert.equal(legacyCalls, 0);
  assert.equal(ctx.channels.fts[0].confidence, 0.8);
});

test("FTS confidence merge preserves legacy LEFT JOIN defaults", () => {
  const missing = mergeFtsConfidenceRow({ id: "missing", text: "x" }, new Map());
  assert.equal(missing.confidence, null);
  assert.equal(missing.last_confidence_update, null);
  assert.equal(missing.base_tau, 7);
  assert.equal(missing.hit_count, 0);
  assert.equal(missing.category, null);
  assert.equal(missing.is_archived, 0);
  const nulled = mergeFtsConfidenceRow({ id: "nulled", text: "x" }, new Map([["nulled", {
    confidence: null,
    last_confidence_update: null,
    base_tau: null,
    hit_count: null,
    is_protected: null,
    conflict_flag: null,
    category: null,
    is_archived: null,
  }]]));
  assert.equal(nulled.confidence, null);
  assert.equal(nulled.base_tau, 7);
  assert.equal(nulled.hit_count, 0);
  assert.equal(nulled.is_protected, 0);
  assert.equal(nulled.conflict_flag, 0);
  assert.equal(nulled.category, null);
  assert.equal(nulled.is_archived, 0);
  assert.equal(ISOLATED_FTS_SQL.includes("LIMIT ?"), true);
});

test("legacy archived semantics match COALESCE(is_archived, 0) = 0 for SQLite values", () => {
  const cases = [
    [null, false],
    [undefined, false],
    [0, false],
    [0.0, false],
    [1, true],
    [-1, true],
    [0.5, true],
    ["", true],
    ["abc", true],
    [{}, true],
    [Buffer.from([1]), true],
  ];
  for (const [value, archived] of cases) {
    assert.equal(isArchivedLikeLegacySql(value), archived, String(value));
  }
});

test("legacy default path preserves null-confidence normalization from 8334887", async () => {
  const makeReader = () => ({
    prepare() {
      return {
        all() {
          return [{
            id: "missing-confidence",
            text: "query memory",
            path: "memory/smart-add/missing.md",
            updated_at: 1710000000,
            confidence: null,
            last_confidence_update: null,
            base_tau: 7,
            hit_count: 0,
            is_protected: 0,
            conflict_flag: 0,
            category: null,
            is_archived: 0,
          }];
        },
      };
    },
  });

  for (const mode of ["legacy", "isolated"]) {
    const keptCtx = makeBaseCtx({
      ftsAccessMode: mode,
      minConfidence: 0,
      confidenceMap: new Map(),
      withDb: fn => fn(makeReader()),
      withCoreDb: fn => fn(makeReader()),
    });
    await collectFtsCandidates(keptCtx);
    assert.equal(keptCtx.debug.strict_count, 1, mode);
    assert.equal(keptCtx.candidateCounts.fts_raw_primary, 1, mode);
    assert.equal(keptCtx.debug.fallback_count, 0, mode);
    assert.equal(keptCtx.channels.fts.length, 1, mode);
    assert.equal(keptCtx.channels.fts[0].confidence_mode, "managed", mode);
    assert.equal(keptCtx.channels.fts[0].confidence, 0, mode);

    const filteredCtx = makeBaseCtx({
      ftsAccessMode: mode,
      minConfidence: 0.15,
      confidenceMap: new Map(),
      withDb: fn => fn(makeReader()),
      withCoreDb: fn => fn(makeReader()),
    });
    await collectFtsCandidates(filteredCtx);
    assert.equal(filteredCtx.debug.strict_count, 1, mode);
    assert.equal(filteredCtx.candidateCounts.fts_raw_primary, 1, mode);
    assert.equal(filteredCtx.debug.fallback_count, 0, mode);
    assert.deepEqual(filteredCtx.channels.fts, [], mode);
  }
});

test("KG channel normalizes candidates and updates debug/count fields", async () => {
  let preparedSql = "";
  const ctx = makeBaseCtx({
    normalizedQuery: "session checkpoint",
    queryTerms: ["session", "checkpoint"],
    withDb: fn => fn({
      prepare(sql) {
        preparedSql = String(sql);
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
  assert.match(
    preparedSql,
    /ORDER BY\s+c\.updated_at\s+DESC\s*,\s*c\.id\s+ASC\s+LIMIT\s+\?/i,
  );
  assert.equal(ctx.candidateCounts.kg_raw, 1);
  assert.equal(ctx.candidateCounts.kg_after_conf_filter, 1);
  assert.equal(ctx.channels.kg[0].path, "memory/episodes/session-checkpoint.md");
  assert.equal(ctx.channels.kg[0].category, "episodic");
});

test("KG isolated mode uses Engine candidate SQL plus Core JSON JOIN and never legacy SQL", async () => {
  let legacyCalls = 0;
  let engineSql = "";
  let coreSql = "";
  let coreArgs = [];
  const ctx = makeBaseCtx({
    normalizedQuery: "session checkpoint",
    strippedQuery: "session checkpoint",
    queryTerms: ["session", "checkpoint"],
    kgAccessMode: "isolated",
    kgIsolationRequested: true,
    withDb: () => {
      legacyCalls += 1;
      throw new Error("legacy KG reader should not run");
    },
    withEngineDb: fn => fn({
      prepare(sql) {
        engineSql = String(sql);
        return {
          all() {
            return [{
              chunk_id: "chunk-1",
              chunk_id_storage_class: "text",
              confidence: 0.82,
              last_confidence_update: 0,
              base_tau: 7,
              hit_count: 3,
              is_protected: 0,
              conflict_flag: 0,
              category: "raw_log",
              is_archived: 0,
              kg_data: "session checkpoint project",
            }];
          },
        };
      },
    }),
    withCoreDb: fn => fn({
      prepare(sql) {
        coreSql = String(sql);
        return {
          all(...args) {
            coreArgs = args;
            return [{
              id: "chunk-1",
              text: "session checkpoint note",
              path: "memory/episodes/session-checkpoint.md",
              updated_at: 1710000000,
            }];
          },
        };
      },
    }),
  });

  await collectKgCandidates(ctx);
  assert.equal(engineSql.includes("typeof(chunk_id) AS chunk_id_storage_class"), true);
  assert.equal(engineSql.includes("LIMIT"), false);
  assert.equal(engineSql.includes("chunks"), false);
  assert.equal(engineSql.includes("ATTACH"), false);
  assert.equal(engineSql.includes("TEMP"), false);
  assert.equal(coreSql.includes("json_each(?)"), true);
  assert.equal(coreSql.includes("JOIN chunks"), true);
  assert.equal(coreSql.includes("memory_confidence"), false);
  assert.equal(coreSql.includes("ATTACH"), false);
  assert.equal(coreSql.includes("TEMP"), false);
  assert.deepEqual(JSON.parse(coreArgs[0]), ["chunk-1"]);
  assert.equal(coreArgs[1], 20);
  assert.equal(legacyCalls, 0);
  assert.equal(ctx.debug.kg_access_mode, "isolated");
  assert.equal(ctx.channels.kg[0].path, "memory/episodes/session-checkpoint.md");
  assert.equal(CORE_KG_JSON_JOIN_SQL.includes("ORDER BY c.updated_at DESC, c.id ASC"), true);
});

test("KG isolated mode fail-closes to legacy when a matching candidate has non-text ID", async () => {
  let legacyCalls = 0;
  let coreCalls = 0;
  const ctx = makeBaseCtx({
    normalizedQuery: "session checkpoint",
    strippedQuery: "session checkpoint",
    queryTerms: ["session", "checkpoint"],
    kgAccessMode: "isolated",
    kgIsolationRequested: true,
    withEngineDb: fn => fn({
      prepare() {
        return {
          all() {
            return [{
              chunk_id: Buffer.from("blob-id"),
              chunk_id_storage_class: "blob",
              confidence: 0.82,
              last_confidence_update: 0,
              base_tau: 7,
              hit_count: 3,
              is_protected: 0,
              conflict_flag: 0,
              category: "raw_log",
              is_archived: 0,
              kg_data: "session checkpoint project",
            }];
          },
        };
      },
    }),
    withCoreDb: () => {
      coreCalls += 1;
      throw new Error("Core JSON JOIN should not run");
    },
    withDb: fn => {
      legacyCalls += 1;
      return fn({
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
                category: "raw_log",
                is_archived: 0,
                kg_data: "session checkpoint project",
              }];
            },
          };
        },
      });
    },
  });

  await collectKgCandidates(ctx);
  assert.equal(legacyCalls, 1);
  assert.equal(coreCalls, 0);
  assert.equal(ctx.debug.kg_access_mode, "legacy_fallback");
  assert.equal(ctx.debug.kg_isolated_fallback_reason, "non_text_matching_candidate_id");
  assert.equal(ctx.channels.kg.length, 1);
});

test("KG isolated Engine SQL errors surface through kg_error and never fall back to legacy", async () => {
  let legacyCalls = 0;
  let coreCalls = 0;

  const ctx = makeBaseCtx({
    normalizedQuery: "session checkpoint",
    strippedQuery: "session checkpoint",
    queryTerms: ["session", "checkpoint"],
    kgAccessMode: "isolated",
    kgIsolationRequested: true,
    withEngineDb: fn => fn({
      prepare() {
        throw new Error("isolated engine failure");
      },
    }),
    withCoreDb: () => {
      coreCalls += 1;
      throw new Error("Core reader must not run");
    },
    withDb: () => {
      legacyCalls += 1;
      throw new Error("Legacy reader must not run");
    },
  });

  await collectKgCandidates(ctx);

  assert.equal(legacyCalls, 0);
  assert.equal(coreCalls, 0);
  assert.equal(ctx.debug.kg_error, "isolated engine failure");
  assert.equal(
    ctx.warnings.some(item =>
      item.message === "kg_search_error"
      && item.error === "isolated engine failure"
    ),
    true,
  );
  assert.equal(Object.hasOwn(ctx.debug, "kg_isolated_fallback_reason"), false);
  assert.equal(ctx.candidateCounts.kg_raw, 0);
  assert.equal(ctx.candidateCounts.kg_after_conf_filter, 0);
  assert.equal(Object.hasOwn(ctx.channels, "kg"), false);
});

test("KG isolated Core SQL errors surface through kg_error and never fall back to legacy", async () => {
  let coreCalls = 0;
  let legacyCalls = 0;

  const ctx = makeBaseCtx({
    normalizedQuery: "session checkpoint",
    strippedQuery: "session checkpoint",
    queryTerms: ["session", "checkpoint"],
    kgAccessMode: "isolated",
    kgIsolationRequested: true,
    withEngineDb: fn => fn({
      prepare() {
        return {
          all() {
            return [{
              chunk_id: "chunk-1",
              chunk_id_storage_class: "text",
              confidence: 0.82,
              last_confidence_update: 0,
              base_tau: 7,
              hit_count: 3,
              is_protected: 0,
              conflict_flag: 0,
              category: "raw_log",
              is_archived: 0,
              kg_data: "session checkpoint project",
            }];
          },
        };
      },
    }),
    withCoreDb: fn => {
      coreCalls += 1;
      return fn({
        prepare() {
          return {
            all() {
              throw new Error("isolated core failure");
            },
          };
        },
      });
    },
    withDb: () => {
      legacyCalls += 1;
      throw new Error("Legacy reader must not run");
    },
  });

  await collectKgCandidates(ctx);

  assert.equal(coreCalls, 1);
  assert.equal(legacyCalls, 0);
  assert.equal(ctx.debug.kg_error, "isolated core failure");
  assert.equal(
    ctx.warnings.some(item =>
      item.message === "kg_search_error"
      && item.error === "isolated core failure"
    ),
    true,
  );
  assert.equal(Object.hasOwn(ctx.debug, "kg_isolated_fallback_reason"), false);
  assert.equal(ctx.candidateCounts.kg_raw, 0);
  assert.equal(ctx.candidateCounts.kg_after_conf_filter, 0);
  assert.equal(Object.hasOwn(ctx.channels, "kg"), false);
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

test("Recent isolated archived SQL errors surface through recent_error and never fall back to legacy", async () => {
  let legacyCalls = 0;
  let coreCalls = 0;
  const ctx = makeBaseCtx({
    normalizedQuery: "session checkpoint",
    strippedQuery: "session checkpoint",
    queryTerms: ["session", "checkpoint"],
    recentAccessMode: "isolated",
    recentIsolationRequested: true,
    withEngineDb: fn => fn({
      readonly: true,
      prepare() {
        throw new Error("isolated recent archived failure");
      },
    }),
    withCoreDb: () => {
      coreCalls += 1;
      throw new Error("Core reader must not run");
    },
    withDb: () => {
      legacyCalls += 1;
      throw new Error("Legacy reader must not run");
    },
  });

  await collectRecentCandidates(ctx);

  assert.equal(legacyCalls, 0);
  assert.equal(coreCalls, 0);
  assert.equal(ctx.debug.recent_error, "isolated recent archived failure");
  assert.equal(
    ctx.warnings.some(item =>
      item.message === "recent_search_error"
      && item.error === "isolated recent archived failure"
    ),
    true,
  );
  assert.equal(Object.hasOwn(ctx.debug, "recent_isolated_fallback_reason"), false);
  assert.equal(ctx.candidateCounts.like_raw, 0);
  assert.equal(ctx.candidateCounts.recent_raw, 0);
  assert.equal(ctx.candidateCounts.episode_raw, 0);
  assert.equal(ctx.candidateCounts.recent_fallback_raw, 0);
  assert.equal(Object.hasOwn(ctx.channels, "recent"), false);
  assert.equal(Object.hasOwn(ctx.channels, "like"), false);
});

test("Recent isolated Core SQL errors surface through recent_error and never fall back to legacy", async () => {
  let coreCalls = 0;
  let legacyCalls = 0;
  const ctx = makeBaseCtx({
    normalizedQuery: "session checkpoint",
    strippedQuery: "session checkpoint",
    queryTerms: ["session", "checkpoint"],
    recentAccessMode: "isolated",
    recentIsolationRequested: true,
    withEngineDb: fn => fn({
      readonly: true,
      prepare(sql) {
        const query = String(sql);
        if (query.includes("COALESCE(is_archived, 0) != 0")) {
          return { all: () => [] };
        }
        if (query.includes("WITH selected AS")) {
          return { all: () => [] };
        }
        return { all: () => [] };
      },
    }),
    withCoreDb: fn => {
      coreCalls += 1;
      return fn({
        readonly: true,
        prepare() {
          return {
            all() {
              throw new Error("isolated recent core failure");
            },
          };
        },
      });
    },
    withDb: () => {
      legacyCalls += 1;
      throw new Error("Legacy reader must not run");
    },
  });

  await collectRecentCandidates(ctx);

  assert.equal(coreCalls, 1);
  assert.equal(legacyCalls, 0);
  assert.equal(ctx.debug.recent_error, "isolated recent core failure");
  assert.equal(
    ctx.warnings.some(item =>
      item.message === "recent_search_error"
      && item.error === "isolated recent core failure"
    ),
    true,
  );
  assert.equal(Object.hasOwn(ctx.debug, "recent_isolated_fallback_reason"), false);
  assert.equal(ctx.candidateCounts.recent_raw, 0);
  assert.equal(ctx.candidateCounts.recent_fallback_raw, 0);
  assert.equal(Object.hasOwn(ctx.channels, "recent"), false);
});

test("Recent isolated metadata SQL errors surface through recent_error and never fall back to legacy", async () => {
  let legacyCalls = 0;
  const ctx = makeBaseCtx({
    normalizedQuery: "session checkpoint",
    strippedQuery: "session checkpoint",
    queryTerms: ["session", "checkpoint"],
    recentAccessMode: "isolated",
    recentIsolationRequested: true,
    withEngineDb: fn => fn({
      readonly: true,
      prepare(sql) {
        const query = String(sql);
        if (query.includes("COALESCE(is_archived, 0) != 0")) {
          return { all: () => [] };
        }
        if (query.includes("WITH selected AS")) {
          return {
            all() {
              throw new Error("isolated recent metadata failure");
            },
          };
        }
        return { all: () => [] };
      },
    }),
    withCoreDb: fn => fn({
      readonly: true,
      prepare() {
        return {
          all() {
            return [{
              id: "chunk-1",
              text: "session checkpoint note",
              path: "memory/smart-add/checkpoint.md",
              updated_at: 1710000000,
            }];
          },
        };
      },
    }),
    withDb: () => {
      legacyCalls += 1;
      throw new Error("Legacy reader must not run");
    },
  });

  await collectRecentCandidates(ctx);

  assert.equal(legacyCalls, 0);
  assert.equal(ctx.debug.recent_error, "isolated recent metadata failure");
  assert.equal(
    ctx.warnings.some(item =>
      item.message === "recent_search_error"
      && item.error === "isolated recent metadata failure"
    ),
    true,
  );
  assert.equal(Object.hasOwn(ctx.debug, "recent_isolated_fallback_reason"), false);
  assert.equal(ctx.candidateCounts.recent_raw, 0);
  assert.equal(Object.hasOwn(ctx.channels, "recent"), false);
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
