import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { collectFtsCandidates } from "../lib/recall/hybrid/channels/fts.js";
import { createCandidateCounts, createHybridDebug, createHybridWarnings } from "../lib/recall/hybrid/debug.js";
import {
  archivedIdsFromConfidenceMap,
  isArchivedLikeLegacySql,
  mergeFtsConfidenceRow,
} from "../lib/recall/hybrid/channels/fts-query.js";
import { isCandidateAllowedForRerank, normalizeExternalMemory } from "../lib/recall/hybrid/normalize-candidate.js";

const ARCHIVED_ID = "archived\"\\ 雪";
const SPECIAL_ACTIVE_ID = "active'\\ 雪";

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-hybrid-fts-"));
  const corePath = join(root, "core.sqlite");
  const enginePath = join(root, "engine.sqlite");
  const core = new Database(corePath);
  core.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source TEXT,
      start_line INTEGER,
      end_line INTEGER,
      hash TEXT,
      model TEXT,
      text TEXT NOT NULL,
      embedding TEXT,
      updated_at INTEGER
    );
    CREATE VIRTUAL TABLE chunks_fts USING fts5(
      text, id UNINDEXED, path UNINDEXED, source UNINDEXED, model UNINDEXED,
      start_line UNINDEXED, end_line UNINDEXED
    );
  `);
  const chunks = [
    [ARCHIVED_ID, "memory/smart-add/archived.md", "needle ".repeat(30)],
    ["active-1", "memory/smart-add/active-1.md", "needle active one"],
    ["active-2", "memory/smart-add/active-2.md", "needle active two"],
    ["missing-confidence", "memory/smart-add/missing.md", "needle missing confidence"],
    ["null-confidence", "memory/smart-add/null.md", "needle null confidence"],
    ["null-coalesced-fields", "memory/smart-add/null-coalesced.md", "needle null coalesced fields"],
    ["generated", "memory/generated-smart-add/generated.md", "needle ".repeat(40)],
    [SPECIAL_ACTIVE_ID, "memory/smart-add/special.md", "needle special unicode"],
  ];
  const insertChunk = core.prepare("INSERT INTO chunks (id, path, text, updated_at) VALUES (?, ?, ?, ?)");
  const insertFts = core.prepare("INSERT INTO chunks_fts (text, id, path) VALUES (?, ?, ?)");
  for (const [id, path, text] of chunks) {
    insertChunk.run(id, path, text, 1710000000);
    insertFts.run(text, id, path);
  }
  core.close();

  const engine = new Database(enginePath);
  engine.exec(`
    CREATE TABLE memory_confidence (
      chunk_id TEXT PRIMARY KEY,
      confidence REAL,
      last_confidence_update INTEGER,
      base_tau REAL,
      hit_count INTEGER,
      is_protected INTEGER,
      conflict_flag INTEGER,
      category TEXT,
      is_archived INTEGER
    );
  `);
  const insertConfidence = engine.prepare("INSERT INTO memory_confidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  insertConfidence.run(ARCHIVED_ID, 0.8, 1, 7, 1, 0, 0, "raw_log", 1);
  insertConfidence.run("active-1", 0.8, 1, 7, 1, 0, 0, "raw_log", 0);
  insertConfidence.run("active-2", 0.8, 1, 7, 1, 0, 0, "raw_log", 0);
  insertConfidence.run("null-confidence", null, 1, 7, 1, 0, 0, "raw_log", 0);
  insertConfidence.run("null-coalesced-fields", 0.8, 1, null, null, null, null, null, null);
  insertConfidence.run("generated", 0.8, 1, 7, 1, 0, 0, "raw_log", 0);
  insertConfidence.run(SPECIAL_ACTIVE_ID, 0.8, 1, 7, 1, 0, 0, "raw_log", 0);
  engine.close();
  return { root, corePath, enginePath };
}

function openLegacy(fixture) {
  const db = new Database(fixture.enginePath);
  db.exec(`ATTACH DATABASE '${fixture.corePath.replace(/'/g, "''")}' AS core`);
  return db;
}

function openConfidenceMap(enginePath) {
  const db = new Database(enginePath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare("SELECT * FROM memory_confidence").all();
    return new Map(rows.map(row => [row.chunk_id, row]));
  } finally {
    db.close();
  }
}

function makeContext({
  withDb,
  withCoreDb,
  confidenceMap,
  query = "needle",
  fallback = "needle OR fallback",
  ftsTopK = 3,
  mode = "legacy",
  calls = [],
  minConfidence = 0,
  normalizeCandidate = row => row,
  filterForRerank = () => true,
}) {
  const candidateCounts = createCandidateCounts();
  const debug = createHybridDebug({
    rawQuery: query,
    strippedQuery: query,
    normalizedQuery: query,
    queryTerms: ["needle"],
    candidateCounts,
    minConfidence,
    lexicalConfidenceThreshold: 0.7,
  });
  const { warnHybridSearchOnce } = createHybridWarnings();
  const channels = {};
  return {
    withDb: withDb || (() => { throw new Error("legacy FTS reader used"); }),
    withCoreDb: withCoreDb || (() => { throw new Error("Core FTS reader missing"); }),
    ftsAccessMode: mode,
    confidenceMap,
    channels,
    debug,
    candidateCounts,
    normalizedQuery: query,
    fallbackFtsQuery: fallback,
    strippedQuery: query,
    queryTerms: ["needle"],
    exactFragments: [],
    nowSec: 1710003600,
    ftsTopK,
    normalizeCandidate,
    filterForRerank,
    enrichLexicalCandidate: row => row,
    toDebugErrorMessage: error => error.message,
    warnHybridSearchOnce,
    calls,
  };
}

function normalizeForProduction(row) {
  return normalizeExternalMemory(row, {
    nowSec: 1710003600,
    calcRealtimeConf: candidate => candidate.confidence,
    categoryMap: null,
  });
}

async function collectBoth(fixture, options = {}) {
  const confidenceMap = openConfidenceMap(fixture.enginePath);
  const legacy = openLegacy(fixture);
  const core = new Database(fixture.corePath, { readonly: true, fileMustExist: true });
  try {
    const legacyCalls = [];
    const isolatedCalls = [];
    const legacyCtx = makeContext({
      confidenceMap,
      ftsTopK: options.ftsTopK || 3,
      query: options.query || "needle",
      fallback: options.fallback || "needle OR fallback",
      calls: legacyCalls,
      withDb: run => {
        legacyCalls.push("legacy");
        return run(legacy);
      },
      withCoreDb: run => run(core),
    });
    const isolatedCtx = makeContext({
      confidenceMap,
      ftsTopK: options.ftsTopK || 3,
      query: options.query || "needle",
      fallback: options.fallback || "needle OR fallback",
      calls: isolatedCalls,
      mode: "isolated",
      withDb: () => { throw new Error("isolated FTS used legacy reader"); },
      withCoreDb: run => {
        isolatedCalls.push("core");
        return run(core);
      },
    });
    await collectFtsCandidates(legacyCtx);
    await collectFtsCandidates(isolatedCtx);
    return { legacyCtx, isolatedCtx, confidenceMap };
  } finally {
    core.close();
    legacy.close();
  }
}

test("legacy and isolated FTS match archived-before-LIMIT, generated exclusion, and ordering", async () => {
  const fixture = createFixture();
  try {
    const { legacyCtx, isolatedCtx } = await collectBoth(fixture, { ftsTopK: 3 });
    const legacyIds = legacyCtx.channels.fts.map(row => row.id);
    const isolatedIds = isolatedCtx.channels.fts.map(row => row.id);
    assert.deepEqual(isolatedIds, legacyIds);
    assert.equal(isolatedIds.length, 3);
    assert.equal(isolatedIds.includes(ARCHIVED_ID), false);
    assert.equal(isolatedIds.includes("generated"), false);
    assert.equal(isolatedCtx.candidateCounts.fts_raw_final, 3);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("isolated FTS merges missing and NULL confidence fields like legacy", async () => {
  const fixture = createFixture();
  try {
    const { legacyCtx, isolatedCtx } = await collectBoth(fixture, { ftsTopK: 20 });
    for (const id of ["missing-confidence", "null-confidence", "null-coalesced-fields"]) {
      const legacy = legacyCtx.channels.fts.find(row => row.id === id);
      const isolated = isolatedCtx.channels.fts.find(row => row.id === id);
      assert.ok(legacy);
      assert.deepEqual(isolated, legacy);
    }
    const missing = isolatedCtx.channels.fts.find(row => row.id === "missing-confidence");
    const nullConfidence = isolatedCtx.channels.fts.find(row => row.id === "null-confidence");
    const nullCoalesced = isolatedCtx.channels.fts.find(row => row.id === "null-coalesced-fields");
    assert.equal(isolatedCtx.channels.fts.some(row => row.id === SPECIAL_ACTIVE_ID), true);
    assert.equal(missing.confidence, null);
    assert.equal(missing.base_tau, 7);
    assert.equal(missing.hit_count, 0);
    assert.equal(missing.category, null);
    assert.equal(missing.is_archived, 0);
    assert.equal(nullConfidence.confidence, null);
    assert.equal(nullConfidence.base_tau, 7);
    assert.equal(nullConfidence.hit_count, 1);
    assert.equal(nullConfidence.category, "raw_log");
    assert.equal(nullConfidence.is_archived, 0);
    assert.equal(nullCoalesced.confidence, 0.8);
    assert.equal(nullCoalesced.base_tau, 7);
    assert.equal(nullCoalesced.hit_count, 0);
    assert.equal(nullCoalesced.is_protected, 0);
    assert.equal(nullCoalesced.conflict_flag, 0);
    assert.equal(nullCoalesced.category, null);
    assert.equal(nullCoalesced.is_archived, 0);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("missing confidence stays managed in production normalization for both legacy and isolated modes", async () => {
  const fixture = createFixture();
  try {
    const confidenceMap = openConfidenceMap(fixture.enginePath);
    const legacy = openLegacy(fixture);
    const core = new Database(fixture.corePath, { readonly: true, fileMustExist: true });
    try {
      for (const [mode, withDb, withCoreDb] of [
        ["legacy", run => run(legacy), run => run(core)],
        ["isolated", () => { throw new Error("isolated should not use legacy reader"); }, run => run(core)],
      ]) {
        const keptCtx = makeContext({
          mode,
          minConfidence: 0,
          confidenceMap,
          ftsTopK: 20,
          withDb,
          withCoreDb,
          normalizeCandidate: normalizeForProduction,
          filterForRerank: item => isCandidateAllowedForRerank(item, 0),
        });
        await collectFtsCandidates(keptCtx);
        const kept = keptCtx.channels.fts.find(row => row.id === "missing-confidence");
        assert.ok(kept, mode);
        assert.equal(kept.confidence_mode, "managed", mode);
        assert.equal(kept.confidence, 0, mode);
        assert.equal(keptCtx.debug.strict_count > 0, true, mode);
        assert.equal(keptCtx.debug.fallback_count, 0, mode);

        const filteredCtx = makeContext({
          mode,
          minConfidence: 0.15,
          confidenceMap,
          ftsTopK: 20,
          withDb,
          withCoreDb,
          normalizeCandidate: normalizeForProduction,
          filterForRerank: item => isCandidateAllowedForRerank(item, 0.15),
        });
        await collectFtsCandidates(filteredCtx);
        assert.equal(filteredCtx.debug.strict_count > 0, true, mode);
        assert.equal(filteredCtx.debug.fallback_count, 0, mode);
        assert.equal(filteredCtx.channels.fts.some(row => row.id === "missing-confidence"), false, mode);
      }
    } finally {
      core.close();
      legacy.close();
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("strict success and fallback use the same selector semantics", async () => {
  const fixture = createFixture();
  try {
    const strict = await collectBoth(fixture, { query: "needle", fallback: "needle OR fallback", ftsTopK: 3 });
    assert.equal(strict.legacyCtx.debug.fallback_count, 0);
    assert.equal(strict.isolatedCtx.debug.fallback_count, 0);
    assert.deepEqual(strict.isolatedCtx.channels.fts.map(row => row.id), strict.legacyCtx.channels.fts.map(row => row.id));

    const fallback = await collectBoth(fixture, { query: "absenttoken", fallback: "needle", ftsTopK: 3 });
    assert.equal(fallback.legacyCtx.debug.strict_count, 0);
    assert.equal(fallback.isolatedCtx.debug.strict_count, 0);
    assert.equal(fallback.legacyCtx.debug.fallback_count, fallback.isolatedCtx.debug.fallback_count);
    assert.equal(fallback.legacyCtx.debug.fts_query_final, "needle");
    assert.equal(fallback.isolatedCtx.debug.fts_query_final, "needle");
    assert.deepEqual(fallback.isolatedCtx.channels.fts.map(row => row.id), fallback.legacyCtx.channels.fts.map(row => row.id));
    assert.deepEqual(fallback.isolatedCtx.debug.post_rerank_topK, fallback.legacyCtx.debug.post_rerank_topK);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("large and special archived IDs use one JSON bind without variable-limit errors", async () => {
  const fixture = createFixture();
  try {
    const confidenceMap = openConfidenceMap(fixture.enginePath);
    for (let i = 0; i < 1500; i += 1) confidenceMap.set(`archived-${i}`, { is_archived: 1 });
    assert.equal(archivedIdsFromConfidenceMap(confidenceMap).length >= 1500, true);
    const core = new Database(fixture.corePath, { readonly: true, fileMustExist: true });
    let args;
    try {
      const ctx = makeContext({
        mode: "isolated",
        confidenceMap,
        ftsTopK: 3,
        withDb: () => { throw new Error("legacy FTS reader used"); },
        withCoreDb: run => run({
          prepare(sql) {
            const statement = core.prepare(sql);
            return { all: (...received) => { args = received; return statement.all(...received); } };
          },
        }),
      });
      await collectFtsCandidates(ctx);
      assert.equal(args.length, 3);
      assert.equal(JSON.parse(args[1]).length >= 1500, true);
      assert.equal(ctx.debug.fts_error, undefined);
      assert.equal(ctx.channels.fts.length > 0, true);
    } finally {
      core.close();
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("archived ID collection matches SQLite COALESCE semantics across stored types", () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-hybrid-fts-archived-types-"));
  const enginePath = join(root, "engine.sqlite");
  const db = new Database(enginePath);
  try {
    db.exec(`
      CREATE TABLE memory_confidence (
        chunk_id TEXT PRIMARY KEY,
        is_archived INTEGER
      );
    `);
    const insert = db.prepare("INSERT INTO memory_confidence (chunk_id, is_archived) VALUES (?, ?)");
    for (const [id, value] of [
      ["null", null],
      ["zero", 0],
      ["one", 1],
      ["minus-one", -1],
      ["half", 0.5],
      ["empty-string", ""],
      ["abc", "abc"],
      ["string-zero", "0"],
      ["string-one", "1"],
    ]) {
      insert.run(id, value);
    }
    const rows = db.prepare(`
      SELECT
        chunk_id,
        is_archived,
        typeof(is_archived) AS archived_type,
        COALESCE(is_archived, 0) = 0 AS legacy_allowed
      FROM memory_confidence
      ORDER BY chunk_id
    `).all();
    const confidenceMap = new Map(rows.map(row => [row.chunk_id, { is_archived: row.is_archived }]));
    const archivedIds = new Set(archivedIdsFromConfidenceMap(confidenceMap));
    for (const row of rows) {
      assert.equal(archivedIds.has(row.chunk_id), !Boolean(row.legacy_allowed), row.chunk_id);
      assert.equal(isArchivedLikeLegacySql(row.is_archived), !Boolean(row.legacy_allowed), row.chunk_id);
    }
    const emptyString = rows.find(row => row.chunk_id === "empty-string");
    assert.equal(emptyString.archived_type, "text");
    assert.equal(Boolean(emptyString.legacy_allowed), false);
    assert.equal(archivedIds.has("empty-string"), true);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("archived ID collection ignores non-text chunk IDs like legacy JOIN", () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-hybrid-fts-chunk-id-types-"));
  const dbPath = join(root, "fixture.sqlite");
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE memory_confidence (
        chunk_id TEXT PRIMARY KEY,
        is_archived INTEGER
      );
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY
      );
    `);
    const insertConfidence = db.prepare("INSERT INTO memory_confidence (chunk_id, is_archived) VALUES (?, ?)");
    insertConfidence.run(null, 1);
    insertConfidence.run(Buffer.from("null"), 1);
    insertConfidence.run("valid-archived", 1);
    insertConfidence.run("valid-active", 0);

    const insertChunk = db.prepare("INSERT INTO chunks (id) VALUES (?)");
    insertChunk.run("null");
    insertChunk.run("valid-archived");
    insertChunk.run("valid-active");

    const confidenceRows = db.prepare(`
      SELECT
        chunk_id,
        typeof(chunk_id) AS chunk_id_type,
        is_archived
      FROM memory_confidence
      ORDER BY rowid
    `).all();
    assert.equal(confidenceRows.some(row => row.chunk_id_type === "null"), true);
    assert.equal(confidenceRows.some(row => row.chunk_id_type === "blob"), true);

    const confidenceMap = new Map(confidenceRows.map(row => [row.chunk_id, row]));
    const archivedIds = archivedIdsFromConfidenceMap(confidenceMap);
    assert.equal(archivedIds.includes("null"), false);
    assert.equal(archivedIds.includes("valid-archived"), true);
    assert.equal(archivedIds.includes("valid-active"), false);

    const legacyIds = db.prepare(`
      SELECT c.id
      FROM chunks c
      LEFT JOIN memory_confidence mc
        ON c.id = mc.chunk_id
      WHERE COALESCE(mc.is_archived, 0) = 0
      ORDER BY c.id
    `).all().map(row => row.id);
    const archivedSet = new Set(archivedIds);
    const isolatedIds = db.prepare("SELECT id FROM chunks ORDER BY id")
      .all()
      .map(row => row.id)
      .filter(id => !archivedSet.has(id));

    assert.deepEqual(isolatedIds, legacyIds);
    assert.deepEqual(legacyIds, ["null", "valid-active"]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("isolated FTS preserves Core readonly topology and no temp schema", async () => {
  const fixture = createFixture();
  let core;
  try {
    core = new Database(fixture.corePath, { readonly: true, fileMustExist: true });
    const confidenceMap = openConfidenceMap(fixture.enginePath);
    const ctx = makeContext({
      mode: "isolated",
      confidenceMap,
      withDb: () => { throw new Error("legacy FTS reader used"); },
      withCoreDb: run => run(core),
    });
    await collectFtsCandidates(ctx);
    assert.deepEqual(core.prepare("PRAGMA database_list").all().map(row => row.name), ["main"]);
    assert.throws(() => core.exec("UPDATE chunks SET text = 'mutated' WHERE id = 'active-1'"), error => error.code === "SQLITE_READONLY");
  } finally {
    if (core?.open) core.close();
    assert.equal(existsSync(`${fixture.corePath}-wal`), false);
    assert.equal(existsSync(`${fixture.corePath}-shm`), false);
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("confidence merge keeps special IDs as data, not SQL", () => {
  const merged = mergeFtsConfidenceRow({ id: SPECIAL_ACTIVE_ID, text: "x" }, new Map([[SPECIAL_ACTIVE_ID, { is_archived: 0, category: null }]]));
  assert.equal(merged.id, SPECIAL_ACTIVE_ID);
  assert.equal(merged.is_archived, 0);
});
