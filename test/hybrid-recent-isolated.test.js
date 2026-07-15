import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openCoreDbReadonly, openEngineDbIsolated } from "../lib/db/isolated-dbs.js";
import { openEngineDb } from "../lib/db/engine-db.js";
import { collectRecentCandidates } from "../lib/recall/hybrid/channels/recent.js";
import {
  createCandidateCounts,
  createHybridDebug,
  createHybridWarnings,
  toDebugErrorMessage,
} from "../lib/recall/hybrid/debug.js";
import {
  inferCategoryFromChunk,
  isCandidateAllowedForRerank,
  normalizeExternalMemory,
  normalizeUnixSeconds,
  round4,
  toFiniteNumber,
} from "../lib/recall/hybrid/normalize-candidate.js";
import { enrichLexicalCandidate } from "../lib/recall/hybrid/lexical.js";
import { computeRecencyBoost } from "../lib/recall/hybrid/fusion.js";

function createFixtureRoot() {
  return mkdtempSync(join(tmpdir(), "memory-engine-recent-isolated-"));
}

function withDbEnv(paths, fn) {
  const previous = {
    CORE_DB_PATH: process.env.CORE_DB_PATH,
    ENGINE_DB_PATH: process.env.ENGINE_DB_PATH,
  };
  process.env.CORE_DB_PATH = paths.corePath;
  process.env.ENGINE_DB_PATH = paths.enginePath;
  try {
    return fn();
  } finally {
    if (previous.CORE_DB_PATH == null) delete process.env.CORE_DB_PATH;
    else process.env.CORE_DB_PATH = previous.CORE_DB_PATH;
    if (previous.ENGINE_DB_PATH == null) delete process.env.ENGINE_DB_PATH;
    else process.env.ENGINE_DB_PATH = previous.ENGINE_DB_PATH;
  }
}

function createCoreDb(root) {
  const db = new Database(join(root, "core.sqlite"));
  db.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      text TEXT,
      path TEXT,
      updated_at INTEGER
    );
  `);
  return db;
}

function createEngineDb(root) {
  const db = new Database(join(root, "engine.sqlite"));
  db.exec(`
    CREATE TABLE memory_confidence (
      chunk_id TEXT PRIMARY KEY,
      confidence REAL,
      last_confidence_update INTEGER,
      base_tau REAL,
      hit_count INTEGER,
      is_protected INTEGER,
      conflict_flag INTEGER,
      category TEXT,
      is_archived INTEGER,
      kg_data TEXT
    );
  `);
  return db;
}

function insertChunk(db, {
  id,
  updatedAt = 1000,
  text = `alpha recent ${id}`,
  path = `memory/smart-add/${id}.md`,
}) {
  db.prepare(`
    INSERT INTO chunks (id, text, path, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(id, text, path, updatedAt);
}

function insertConfidence(db, {
  id,
  confidence = 0.82,
  category = "raw_log",
  isArchived = 0,
  baseTau = 7,
  hitCount = 3,
  isProtected = 0,
  conflictFlag = 0,
  lastConfidenceUpdate = 0,
  kgData = "alpha kg",
}) {
  db.prepare(`
    INSERT INTO memory_confidence (
      chunk_id, confidence, last_confidence_update, base_tau, hit_count,
      is_protected, conflict_flag, category, is_archived, kg_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    confidence,
    lastConfidenceUpdate,
    baseTau,
    hitCount,
    isProtected,
    conflictFlag,
    category,
    isArchived,
    kgData,
  );
}

function openHandles(paths) {
  return withDbEnv(paths, () => ({
    legacyDb: openEngineDb({ readonly: true }),
    isolatedCoreDb: openCoreDbReadonly({ coreDbPath: paths.corePath, engineDbPath: paths.enginePath }),
    isolatedEngineDb: openEngineDbIsolated({ readonly: true, coreDbPath: paths.corePath, engineDbPath: paths.enginePath }),
  }));
}

function recordAccessor(db, name, records) {
  return run => run({
    readonly: db.readonly,
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        all(...params) {
          const rows = statement.all(...params);
          records.push({ db: name, sql: String(sql), params, rows });
          return rows;
        },
        get(...params) {
          const row = statement.get(...params);
          records.push({ db: name, sql: String(sql), params, row });
          return row;
        },
      };
    },
  });
}

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

function makeCtx(accessors, overrides = {}) {
  const minConfidence = overrides.minConfidence ?? 0;
  const candidateCounts = createCandidateCounts();
  const debug = createHybridDebug({
    rawQuery: "alpha",
    strippedQuery: "alpha",
    normalizedQuery: "alpha",
    queryTerms: ["alpha"],
    candidateCounts,
    minConfidence,
    lexicalConfidenceThreshold: 0.7,
  });
  const channels = {};
  const nowSec = 1710003600;
  const warnings = [];
  const { warnHybridSearchOnce } = createHybridWarnings();
  return {
    channels,
    debug,
    candidateCounts,
    warnings,
    nowSec,
    normalizedQuery: "alpha",
    strippedQuery: "alpha",
    queryTerms: ["alpha"],
    likePatternTopN: 8,
    likeTopK: 20,
    recentTopK: 20,
    recentRerankTopK: 20,
    recentFallbackTopK: 20,
    rankingConfig: {},
    categoryMap: null,
    normalizeCandidate: row => normalizeExternalMemory(row, {
      nowSec,
      calcRealtimeConf: candidate => candidate.confidence,
      categoryMap: null,
    }),
    filterForRerank: item => isCandidateAllowedForRerank(item, minConfidence),
    enrichLexicalCandidate,
    inferCategoryFromChunk,
    lexicalMatchScore,
    computeRecencyBoost,
    normalizeUnixSeconds,
    toFiniteNumber,
    toDebugErrorMessage,
    warnHybridSearchOnce: (message, error = null) => {
      warnings.push({ message, error: error?.message || null });
      warnHybridSearchOnce(message, error);
    },
    uniqueVectorChannels: () => false,
    withDb: accessors.withDb,
    withCoreDb: accessors.withCoreDb,
    withEngineDb: accessors.withEngineDb,
    ftsIsEmpty: false,
    recentAccessMode: "legacy",
    recentIsolationRequested: false,
    recentIsolationFallbackReason: null,
    minConfidence,
    ...overrides,
  };
}

async function runRecent(paths, overrides = {}) {
  const handles = openHandles(paths);
  const records = [];
  try {
    const accessors = {
      withDb: recordAccessor(handles.legacyDb, "legacy", records),
      withCoreDb: recordAccessor(handles.isolatedCoreDb, "core", records),
      withEngineDb: recordAccessor(handles.isolatedEngineDb, "engine", records),
    };
    const ctx = makeCtx(accessors, overrides);
    await collectRecentCandidates(ctx);
    return { ctx, records };
  } finally {
    if (handles.legacyDb.open) handles.legacyDb.close();
    if (handles.isolatedCoreDb.open) handles.isolatedCoreDb.close();
    if (handles.isolatedEngineDb.open) handles.isolatedEngineDb.close();
  }
}

function canonicalCandidate(row) {
  return row == null ? null : {
    id: row.id ?? null,
    text: row.text ?? null,
    path: row.path ?? null,
    updated_at: row.updated_at ?? null,
    confidence: row.confidence ?? null,
    last_confidence_update: row.last_confidence_update ?? null,
    base_tau: row.base_tau ?? null,
    hit_count: row.hit_count ?? null,
    is_protected: row.is_protected ?? null,
    conflict_flag: row.conflict_flag ?? null,
    category: row.category ?? null,
    is_archived: row.is_archived ?? null,
    confidence_mode: row.confidence_mode ?? null,
    hits: row.hits ?? null,
    created_at: row.created_at ?? null,
    semantic_score: row.semantic_score ?? null,
    similarity: row.similarity ?? null,
    source_type: row.source_type ?? null,
  };
}

function channelSnapshot(channels, name) {
  return (channels[name] || []).map(canonicalCandidate);
}

function withFixture(seed, run) {
  const root = createFixtureRoot();
  const paths = {
    corePath: join(root, "core.sqlite"),
    enginePath: join(root, "engine.sqlite"),
  };
  const core = createCoreDb(root);
  const engine = createEngineDb(root);
  return Promise.resolve()
    .then(() => seed({ core, engine }))
    .finally(() => {
      core.close();
      engine.close();
    })
    .then(() => run(paths))
    .finally(() => {
      rmSync(root, { recursive: true, force: true });
    });
}

function ids(rows = []) {
  return rows.map(row => row.id);
}

function explainPlanDetails(db, sql, params = []) {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map(row => String(row.detail || ""));
}

test("isolated Recent matches legacy across like, recent, episode, and recent_fallback branches", async () => {
  await withFixture(({ core, engine }) => {
    insertChunk(core, { id: "C", updatedAt: 1000, path: "memory/smart-add/C.md", text: "alpha smart add C" });
    insertChunk(core, { id: "B", updatedAt: 1000, path: "memory/episodes/B.md", text: "alpha episodic B" });
    insertChunk(core, { id: "A", updatedAt: 1000, path: "memory/smart-add/A.md", text: "alpha smart add A" });
    insertChunk(core, { id: "Z-archived", updatedAt: 5000, path: "memory/smart-add/Z-archived.md", text: "alpha archived" });
    insertConfidence(engine, { id: "A", category: "raw_log", kgData: "alpha archived-limit" });
    insertConfidence(engine, { id: "B", category: "episodic", kgData: "alpha archived-limit" });
    insertConfidence(engine, { id: "C", category: "raw_log", kgData: "alpha archived-limit" });
    insertConfidence(engine, { id: "Z-archived", category: "raw_log", isArchived: 1, kgData: "alpha archived-limit" });
  }, async (paths) => {
    const legacy = await runRecent(paths, {
      ftsIsEmpty: true,
      recentAccessMode: "legacy",
      recentTopK: 3,
      recentRerankTopK: 3,
      recentFallbackTopK: 3,
      likeTopK: 3,
    });
    const isolated = await runRecent(paths, {
      ftsIsEmpty: true,
      recentAccessMode: "isolated",
      recentIsolationRequested: true,
      recentTopK: 3,
      recentRerankTopK: 3,
      recentFallbackTopK: 3,
      likeTopK: 3,
    });

    for (const name of ["like", "recent", "episode", "recent_fallback"]) {
      assert.deepEqual(channelSnapshot(isolated.ctx.channels, name), channelSnapshot(legacy.ctx.channels, name), name);
    }

    assert.equal(isolated.ctx.debug.recent_access_mode, "isolated");
    assert.equal(isolated.ctx.debug.recent_archived_row_count, 1);
    assert.equal(isolated.ctx.debug.recent_archived_unique_id_count, 1);
    assert.equal(isolated.ctx.debug.recent_archived_duplicate_id_count, 0);
    assert.equal(isolated.ctx.debug.recent_archived_payload_large, false);
    assert.equal(isolated.ctx.debug.recent_isolated_engine_query_count, 1);
    assert.equal(isolated.ctx.debug.recent_isolated_core_query_count, 3);
    assert.equal(isolated.ctx.debug.recent_isolated_metadata_query_count, 1);
    assert.deepEqual(isolated.ctx.debug.recent_isolated_branches, ["like_fallback", "recent_scored", "recent_fallback"]);
    assert.deepEqual(ids(isolated.ctx.channels.recent), ["A", "B", "C"]);
    assert.deepEqual(ids(isolated.ctx.channels.episode), ["B"]);
    assert.deepEqual(ids(isolated.ctx.channels.recent_fallback), ["A", "B", "C"]);
    assert.equal(isolated.records.some(record => record.db === "core" && record.sql.includes("json_each(?) AS archived")), true);
    assert.equal(isolated.records.some(record => record.db === "core" && record.sql.includes("NOT IN")), true);
    assert.equal(isolated.records.some(record => record.db === "core" && record.sql.includes("NOT EXISTS")), false);
    assert.equal(isolated.records.some(record => record.db === "engine" && record.sql.includes("COALESCE(is_archived, 0) != 0")), true);
    assert.equal(isolated.records.some(record => record.db === "engine" && record.sql.includes("WITH selected AS")), true);
  });
});

test("isolated Recent preserves missing-confidence semantics and ordering", async () => {
  await withFixture(({ core, engine }) => {
    insertChunk(core, { id: "B", updatedAt: 1000, path: "memory/smart-add/B.md", text: "alpha missing confidence" });
    insertChunk(core, { id: "A", updatedAt: 1000, path: "memory/smart-add/A.md", text: "alpha managed confidence" });
    insertConfidence(engine, { id: "A", category: "raw_log", kgData: "alpha missing confidence" });
  }, async (paths) => {
    const legacy = await runRecent(paths, {
      recentAccessMode: "legacy",
      ftsIsEmpty: false,
      recentTopK: 2,
      recentRerankTopK: 2,
    });
    const isolated = await runRecent(paths, {
      recentAccessMode: "isolated",
      recentIsolationRequested: true,
      ftsIsEmpty: false,
      recentTopK: 2,
      recentRerankTopK: 2,
    });

    assert.deepEqual(channelSnapshot(isolated.ctx.channels, "recent"), channelSnapshot(legacy.ctx.channels, "recent"));
    assert.deepEqual(ids(isolated.ctx.channels.recent), ["A", "B"]);
    assert.equal(isolated.ctx.channels.recent[1].confidence, legacy.ctx.channels.recent[1].confidence);
    assert.equal(isolated.ctx.channels.recent[1].hits, legacy.ctx.channels.recent[1].hits);
    assert.equal(isolated.ctx.channels.recent[1].category, legacy.ctx.channels.recent[1].category);
    assert.equal(isolated.ctx.candidateCounts.recent_raw, legacy.ctx.candidateCounts.recent_raw);
  });
});

test("isolated Recent keeps deterministic order for ties, indexes, and NULL timestamps", async () => {
  await withFixture(({ core, engine }) => {
    insertChunk(core, { id: "C", updatedAt: 1000, path: "memory/smart-add/C.md" });
    insertChunk(core, { id: "B", updatedAt: 1000, path: "memory/smart-add/B.md" });
    insertChunk(core, { id: "A", updatedAt: 1000, path: "memory/smart-add/A.md" });
    insertChunk(core, { id: "N2", updatedAt: null, path: "memory/smart-add/N2.md" });
    insertChunk(core, { id: "N1", updatedAt: null, path: "memory/smart-add/N1.md" });
    for (const id of ["A", "B", "C", "N1", "N2"]) {
      insertConfidence(engine, { id, kgData: "alpha tie set" });
    }
    core.exec("CREATE INDEX idx_chunks_updated ON chunks(updated_at DESC)");
  }, async (paths) => {
    const isolated = await runRecent(paths, {
      recentAccessMode: "isolated",
      recentIsolationRequested: true,
      ftsIsEmpty: false,
      recentTopK: 5,
      recentRerankTopK: 5,
    });
    assert.deepEqual(ids(isolated.ctx.channels.recent), ["A", "B", "C", "N1", "N2"]);
  });
});

test("isolated Recent marks large archived payloads but still executes", async () => {
  await withFixture(({ core, engine }) => {
    insertChunk(core, { id: "active", updatedAt: 1000, path: "memory/smart-add/active.md", text: "alpha active" });
    insertConfidence(engine, { id: "active", kgData: "alpha active" });
    const insertMany = engine.transaction(() => {
      for (let index = 0; index < 4500; index += 1) {
        insertConfidence(engine, {
          id: `archived-${String(index).padStart(5, "0")}-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`,
          isArchived: 1,
          kgData: "alpha archived payload",
        });
      }
    });
    insertMany();
  }, async (paths) => {
    const isolated = await runRecent(paths, {
      recentAccessMode: "isolated",
      recentIsolationRequested: true,
      ftsIsEmpty: false,
      recentTopK: 1,
      recentRerankTopK: 1,
    });
    assert.equal(isolated.ctx.debug.recent_archived_payload_large, true);
    assert.equal(isolated.ctx.debug.recent_archived_json_bytes > 262144, true);
    assert.deepEqual(ids(isolated.ctx.channels.recent), ["active"]);
    assert.equal(isolated.ctx.debug.recent_access_mode, "isolated");
  });
});

test("isolated Recent falls back to legacy on archived or metadata TEXT guard failures", async () => {
  const candidateFallback = await (async () => {
    const records = [];
    const ctx = makeCtx({
      withDb: run => run({
        prepare: () => ({ all: () => [{ id: "legacy", text: "alpha", path: "memory/smart-add/legacy.md", updated_at: 1, confidence: 0.8, last_confidence_update: 0, base_tau: 7, hit_count: 3, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 0 }] }),
      }),
      withCoreDb: run => run({
        readonly: true,
        prepare(sql) {
          records.push({ db: "core", sql: String(sql) });
          return { all: () => [{ id: Buffer.from("blob"), text: "alpha", path: "memory/smart-add/blob.md", updated_at: 1 }] };
        },
      }),
      withEngineDb: run => run({
        readonly: true,
        prepare(sql) {
          const query = String(sql);
          records.push({ db: "engine", sql: query });
          if (query.includes("COALESCE(is_archived, 0) != 0")) return { all: () => [] };
          if (query.includes("WITH selected AS")) return { all: () => [] };
          return { all: () => [] };
        },
      }),
    }, {
      ftsIsEmpty: false,
      recentAccessMode: "isolated",
      recentIsolationRequested: true,
    });
    await collectRecentCandidates(ctx);
    return { ctx, records };
  })();

  assert.equal(candidateFallback.ctx.debug.recent_access_mode, "guarded_fallback");
  assert.equal(candidateFallback.ctx.debug.recent_isolated_fallback_reason, "isolated_recent_core_candidate_id_invariant_failed");
  assert.deepEqual(ids(candidateFallback.ctx.channels.recent), ["legacy"]);

  const metadataFallback = await (async () => {
    const ctx = makeCtx({
      withDb: run => run({
        prepare: () => ({ all: () => [{ id: "legacy", text: "alpha", path: "memory/smart-add/legacy.md", updated_at: 1, confidence: 0.8, last_confidence_update: 0, base_tau: 7, hit_count: 3, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 0 }] }),
      }),
      withCoreDb: run => run({
        readonly: true,
        prepare: () => ({ all: () => [{ id: "safe-text", text: "alpha", path: "memory/smart-add/safe.md", updated_at: 1 }] }),
      }),
      withEngineDb: run => run({
        readonly: true,
        prepare(sql) {
          const query = String(sql);
          if (query.includes("COALESCE(is_archived, 0) != 0")) return { all: () => [] };
          if (query.includes("WITH selected AS")) return { all: () => [{ chunk_id: "safe-text" }, { chunk_id: "safe-text" }] };
          return { all: () => [] };
        },
      }),
    }, {
      ftsIsEmpty: false,
      recentAccessMode: "isolated",
      recentIsolationRequested: true,
    });
    await collectRecentCandidates(ctx);
    return ctx;
  })();

  assert.equal(metadataFallback.debug.recent_access_mode, "guarded_fallback");
  assert.equal(metadataFallback.debug.recent_isolated_fallback_reason, "isolated_recent_metadata_duplicate_id");
  assert.deepEqual(ids(metadataFallback.channels.recent), ["legacy"]);
});

test("isolated Recent falls back to legacy when archived IDs are null, blob, integer, or real before Core SQL", async () => {
  for (const [label, archivedValue] of [
    ["null", null],
    ["blob", Buffer.from("blob-id")],
    ["integer", 42],
    ["real", 1.5],
  ]) {
    let coreCalls = 0;
    const ctx = makeCtx({
      withDb: run => run({
        prepare: () => ({ all: () => [{ id: "legacy", text: "alpha", path: "memory/smart-add/legacy.md", updated_at: 1, confidence: 0.8, last_confidence_update: 0, base_tau: 7, hit_count: 3, is_protected: 0, conflict_flag: 0, category: "raw_log", is_archived: 0 }] }),
      }),
      withCoreDb: run => run({
        readonly: true,
        prepare() {
          coreCalls += 1;
          return { all: () => [] };
        },
      }),
      withEngineDb: run => run({
        readonly: true,
        prepare(sql) {
          const query = String(sql);
          if (query.includes("COALESCE(is_archived, 0) != 0")) return { all: () => [{ chunk_id: archivedValue }] };
          if (query.includes("WITH selected AS")) return { all: () => [] };
          return { all: () => [] };
        },
      }),
    }, {
      ftsIsEmpty: false,
      recentAccessMode: "isolated",
      recentIsolationRequested: true,
    });
    await collectRecentCandidates(ctx);
    assert.equal(coreCalls, 0, label);
    assert.equal(ctx.debug.recent_access_mode, "guarded_fallback", label);
    assert.equal(ctx.debug.recent_isolated_fallback_reason, "isolated_recent_archived_id_invariant_failed", label);
    assert.deepEqual(ids(ctx.channels.recent), ["legacy"], label);
  }
});

test("isolated Recent keeps empty archived payload equivalent and production SQL plan is non-correlated NOT IN", async () => {
  await withFixture(({ core, engine }) => {
    insertChunk(core, { id: "B", updatedAt: 900, path: "memory/episodes/B.md", text: "alpha episodic" });
    insertChunk(core, { id: "A", updatedAt: 1000, path: "memory/smart-add/A.md", text: "alpha smart" });
    insertConfidence(engine, { id: "A", category: "raw_log", kgData: "alpha smart" });
    insertConfidence(engine, { id: "B", category: "episodic", kgData: "alpha episodic" });
  }, async (paths) => {
    const legacy = await runRecent(paths, {
      ftsIsEmpty: true,
      recentAccessMode: "legacy",
      recentTopK: 2,
      recentRerankTopK: 2,
      recentFallbackTopK: 2,
      likeTopK: 2,
    });
    const isolated = await runRecent(paths, {
      ftsIsEmpty: true,
      recentAccessMode: "isolated",
      recentIsolationRequested: true,
      recentTopK: 2,
      recentRerankTopK: 2,
      recentFallbackTopK: 2,
      likeTopK: 2,
    });

    assert.equal(isolated.ctx.debug.recent_archived_row_count, 0);
    assert.equal(isolated.ctx.debug.recent_archived_unique_id_count, 0);
    assert.equal(isolated.ctx.debug.recent_archived_json_bytes, 2);
    for (const name of ["like", "recent", "episode", "recent_fallback"]) {
      assert.deepEqual(channelSnapshot(isolated.ctx.channels, name), channelSnapshot(legacy.ctx.channels, name), name);
    }

    const coreDb = new Database(paths.corePath, { readonly: true, fileMustExist: true });
    try {
      const coreSqlRecords = isolated.records.filter(record => record.db === "core" && record.sql.includes("json_each(?) AS archived"));
      assert.equal(coreSqlRecords.length, 3);
      for (const record of coreSqlRecords) {
        assert.equal(record.sql.includes("NOT IN"), true);
        assert.equal(record.sql.includes("NOT EXISTS"), false);
        const details = explainPlanDetails(coreDb, record.sql, record.params);
        assert.equal(details.some(detail => detail.includes("CORRELATED SCALAR SUBQUERY")), false, record.sql);
        assert.equal(details.some(detail => detail.includes("SCAN json_each") || detail.includes("SCAN archived VIRTUAL TABLE")), true, details.join("\n"));
        assert.equal(details.some(detail => detail.includes("LIST SUBQUERY")), true, details.join("\n"));
      }
    } finally {
      coreDb.close();
    }
  });
});
