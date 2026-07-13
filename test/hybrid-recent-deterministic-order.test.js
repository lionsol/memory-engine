import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
import probeModule from "../bin/probe-isolated-recent-equivalence.js";

const { runIsolatedRecentEquivalenceProbe } = probeModule;

function createFixtureRoot() {
  return mkdtempSync(join(tmpdir(), "memory-engine-recent-deterministic-"));
}

function createDb(root) {
  const db = new Database(join(root, "recent.sqlite"));
  db.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      text TEXT,
      path TEXT,
      updated_at INTEGER
    );

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
  text = `alpha recent note ${id}`,
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
}) {
  db.prepare(`
    INSERT INTO memory_confidence (
      chunk_id, confidence, last_confidence_update, base_tau, hit_count,
      is_protected, conflict_flag, category, is_archived, kg_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, confidence, 0, 7, 3, 0, 0, category, isArchived, "alpha kg");
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

function makeBaseCtx(db, records, overrides = {}) {
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
  const recordingDb = {
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        all(...params) {
          const rows = statement.all(...params);
          records.push({ sql: String(sql), params, rows });
          return rows;
        },
      };
    },
  };

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
    withDb: fn => fn(recordingDb),
    ftsIsEmpty: false,
    minConfidence,
    ...overrides,
  };
}

async function collect(db, overrides = {}) {
  const records = [];
  const ctx = makeBaseCtx(db, records, overrides);
  await collectRecentCandidates(ctx);
  return { ctx, records };
}

function ids(rows = []) {
  return rows.map(row => row.id);
}

function recentSqlRecords(records = []) {
  return records.filter(record => record.sql.includes("memory/smart-add/%"));
}

function likeSqlRecord(records = []) {
  return records.find(record => record.sql.includes("(c.path LIKE ? OR c.text LIKE ?)"));
}

function withFixture(run) {
  const root = createFixtureRoot();
  const db = createDb(root);
  return Promise.resolve()
    .then(() => run(db))
    .finally(() => {
      db.close();
      rmSync(root, { recursive: true, force: true });
    });
}

function seedRows(db, order, options = {}) {
  for (const id of order) {
    insertChunk(db, {
      id,
      updatedAt: options.updatedAtById?.[id] ?? 1000,
      text: options.textById?.[id] ?? `alpha recent note ${id}`,
      path: options.pathById?.[id] ?? `memory/smart-add/${id}.md`,
    });
    if (!options.missingConfidenceIds?.has(id)) {
      insertConfidence(db, {
        id,
        isArchived: options.archivedIds?.has(id) ? 1 : 0,
        category: options.categoryById?.[id] ?? "raw_log",
      });
    }
  }
}

test("Recent source contract gives every updated_at sort an id ASC tie-breaker", () => {
  const source = readFileSync(resolve("lib/recall/hybrid/channels/recent.js"), "utf8");
  const orderMatches = [...source.matchAll(/ORDER BY\s+c\.updated_at\s+DESC(?:\s*,\s*c\.id\s+ASC)?/gi)]
    .map(match => match[0]);

  assert.equal(orderMatches.length, 3);
  assert.equal(orderMatches.every(text => /c\.id\s+ASC/i.test(text)), true);
  assert.equal(/ORDER BY\s+c\.updated_at\s+DESC\s+LIMIT\s+\?/i.test(source), false);
});

test("Recent scored SQL applies id ASC tie-breaker before LIMIT and is stable across insert order and index", async () => {
  await withFixture(async (db) => {
    seedRows(db, ["C", "B", "A"]);
    const { ctx, records } = await collect(db, { recentTopK: 2, recentRerankTopK: 2 });
    const [recentRecord] = recentSqlRecords(records);

    assert.deepEqual(ids(recentRecord.rows), ["A", "B"]);
    assert.deepEqual(ids(ctx.channels.recent), ["A", "B"]);
    assert.equal(ctx.candidateCounts.recent_raw, 2);
  });

  await withFixture(async (db) => {
    seedRows(db, ["A", "B", "C"]);
    const forward = await collect(db, { recentTopK: 3, recentRerankTopK: 3 });

    const root = createFixtureRoot();
    const reverseDb = createDb(root);
    try {
      seedRows(reverseDb, ["C", "B", "A"]);
      const reverse = await collect(reverseDb, { recentTopK: 3, recentRerankTopK: 3 });
      assert.deepEqual(ids(forward.ctx.channels.recent), ids(reverse.ctx.channels.recent));
      assert.deepEqual(ids(forward.ctx.channels.recent), ["A", "B", "C"]);
    } finally {
      reverseDb.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  await withFixture(async (db) => {
    seedRows(db, ["C", "B", "A"]);
    db.exec("CREATE INDEX idx_chunks_updated ON chunks(updated_at DESC)");
    const { ctx, records } = await collect(db, { recentTopK: 2, recentRerankTopK: 2 });
    assert.deepEqual(ids(recentSqlRecords(records)[0].rows), ["A", "B"]);
    assert.deepEqual(ids(ctx.channels.recent), ["A", "B"]);
  });
});

test("Recent scored ordering keeps updated_at primary, handles NULL timestamps, and follows SQLite id collation", async () => {
  await withFixture(async (db) => {
    seedRows(db, ["B", "A", "C"], {
      updatedAtById: { C: 3000, A: 1000, B: 1000 },
    });
    const { ctx, records } = await collect(db, { recentTopK: 3, recentRerankTopK: 3 });
    assert.deepEqual(ids(recentSqlRecords(records)[0].rows), ["C", "A", "B"]);
    assert.deepEqual(ids(ctx.channels.recent), ["C", "A", "B"]);
  });

  await withFixture(async (db) => {
    seedRows(db, ["D", "C", "B", "A"], {
      updatedAtById: { A: 1000, B: 1000, C: null, D: null },
    });
    const { ctx, records } = await collect(db, { recentTopK: 4, recentRerankTopK: 4 });
    assert.deepEqual(ids(recentSqlRecords(records)[0].rows), ["A", "B", "C", "D"]);
    assert.deepEqual(ids(ctx.channels.recent), ["A", "B", "C", "D"]);
  });

  await withFixture(async (db) => {
    const specialIds = ["雪", "space id", "alpha", "Alpha", "01", "slash\\"];
    seedRows(db, specialIds);
    const control = db.prepare(`
      SELECT c.id
      FROM chunks c
      LEFT JOIN memory_confidence mc ON c.id = mc.chunk_id
      WHERE COALESCE(mc.is_archived, 0) = 0
        AND c.path NOT LIKE 'memory/generated-smart-add/%'
        AND (c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%')
      ORDER BY c.updated_at DESC, c.id ASC
      LIMIT ?
    `).all(20).map(row => row.id);
    const { ctx, records } = await collect(db, { recentTopK: 20, recentRerankTopK: 20 });
    assert.deepEqual(ids(recentSqlRecords(records)[0].rows), control);
    assert.deepEqual(ids(ctx.channels.recent), control);
  });
});

test("Recent like and fallback branches use deterministic SQL ordering without changing filters", async () => {
  await withFixture(async (db) => {
    seedRows(db, ["D", "C", "B", "A"], {
      updatedAtById: { A: 1000, B: 1000, C: 1000, D: 1000 },
    });
    insertChunk(db, {
      id: "0-archived",
      updatedAt: 5000,
      text: "alpha archived",
      path: "memory/smart-add/0-archived.md",
    });
    insertConfidence(db, { id: "0-archived", isArchived: 1 });
    insertChunk(db, {
      id: "00-generated",
      updatedAt: 6000,
      text: "alpha generated",
      path: "memory/generated-smart-add/00-generated.md",
    });
    insertConfidence(db, { id: "00-generated" });

    const { ctx, records } = await collect(db, {
      ftsIsEmpty: true,
      likeTopK: 2,
      recentTopK: 2,
      recentFallbackTopK: 2,
      recentRerankTopK: 2,
    });

    assert.deepEqual(ids(likeSqlRecord(records).rows), ["A", "B"]);
    assert.deepEqual(ids(ctx.channels.like), ["A", "B"]);

    const recentRecords = recentSqlRecords(records);
    assert.deepEqual(ids(recentRecords[0].rows), ["A", "B"]);
    assert.deepEqual(ids(recentRecords[1].rows), ["A", "B"]);
    assert.deepEqual(ids(ctx.channels.recent), ["A", "B"]);
    assert.deepEqual(ids(ctx.channels.recent_fallback), ["A", "B"]);
    assert.equal(ctx.debug.fallbacks_triggered.includes("like_search"), true);
    assert.equal(ctx.debug.fallbacks_triggered.includes("recent_episodic"), true);
  });
});

test("Recent semantic regressions stay unchanged for archived LIMIT, missing confidence, generated paths, and episode projection", async () => {
  await withFixture(async (db) => {
    insertChunk(db, { id: "A", updatedAt: 3000, text: "alpha archived" });
    insertConfidence(db, { id: "A", isArchived: 1 });
    insertChunk(db, { id: "B", updatedAt: 2000, text: "alpha active B" });
    insertConfidence(db, { id: "B" });
    insertChunk(db, { id: "C", updatedAt: 1000, text: "alpha active C" });
    insertConfidence(db, { id: "C" });

    const { records } = await collect(db, { recentTopK: 2, recentRerankTopK: 2 });
    assert.deepEqual(ids(recentSqlRecords(records)[0].rows), ["B", "C"]);
  });

  await withFixture(async (db) => {
    insertChunk(db, { id: "A", updatedAt: 1000, text: "alpha missing confidence" });
    const { ctx, records } = await collect(db, {
      recentTopK: 1,
      recentRerankTopK: 1,
      minConfidence: 0,
    });
    const row = recentSqlRecords(records)[0].rows[0];
    assert.equal(row.id, "A");
    assert.equal(row.confidence, null);
    assert.equal(row.base_tau, 7);
    assert.equal(row.hit_count, 0);
    assert.equal(row.is_archived, 0);
    assert.equal(ctx.channels.recent[0].confidence_mode, "managed");
    assert.equal(ctx.channels.recent[0].confidence, 0);
  });

  await withFixture(async (db) => {
    insertChunk(db, {
      id: "generated",
      updatedAt: 3000,
      text: "alpha generated",
      path: "memory/generated-smart-add/generated.md",
    });
    insertConfidence(db, { id: "generated" });
    insertChunk(db, { id: "A", updatedAt: 1000, text: "alpha normal" });
    insertConfidence(db, { id: "A" });
    const { records } = await collect(db, { recentTopK: 5, recentRerankTopK: 5 });
    assert.deepEqual(ids(recentSqlRecords(records)[0].rows), ["A"]);
  });

  await withFixture(async (db) => {
    insertChunk(db, {
      id: "episode-A",
      updatedAt: 1000,
      text: "alpha episode",
      path: "memory/episodes/episode-A.md",
    });
    insertConfidence(db, { id: "episode-A", category: "episodic" });
    insertChunk(db, {
      id: "episode-B",
      updatedAt: 1000,
      text: "alpha episode",
      path: "memory/episodes/episode-B.md",
    });
    insertConfidence(db, { id: "episode-B", category: "episodic" });
    const { ctx, records } = await collect(db, { recentTopK: 2, recentRerankTopK: 2 });
    assert.equal(recentSqlRecords(records).length, 1);
    assert.deepEqual(ids(ctx.channels.recent), ["episode-A", "episode-B"]);
    assert.deepEqual(ids(ctx.channels.episode), ["episode-A", "episode-B"]);
  });
});

test("Recent deterministic tie-order is reflected in Phase 1B4A probe prerequisites", async () => {
  const result = await runIsolatedRecentEquivalenceProbe();
  assert.equal(result.legacy_recent_order_contract.deterministic, true);
  assert.equal(result.legacy_recent_order_contract.reason, "explicit_secondary_tie_breaker_present");
  assert.equal(result.migration_prerequisites.includes("deterministic recent tie ordering"), false);
  assert.equal(result.migration_prerequisites.includes("TEXT-only Core/Engine ID invariant"), true);
  assert.equal(result.recommendation_class, "C");
  assert.equal(result.conditional_recommendation_class, "B");
  assert.equal(result.conditional_preferred_strategy, "core_first_archived_json_exclusion");
});
