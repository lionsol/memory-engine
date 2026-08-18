import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { hybridSearch } from "../lib/recall/hybrid-search.js";
import { createIsolatedHybridDbAccessScope } from "../lib/recall/hybrid/db-access.js";
import {
  createBackfillConfidenceForIndexedChunks,
  createIndexSyncRuntime,
} from "../lib/index-sync-runtime.js";
import { withCoreDbReadonly, withEngineDbIsolated } from "../lib/db/isolated-dbs.js";

function createFixture({ withConfidenceTable = true, withMissingBackfillChunk = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-hybrid-runtime-"));
  const coreDbPath = join(root, "core.sqlite");
  const engineDbPath = join(root, "engine.sqlite");
  const core = new Database(coreDbPath);
  core.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      path TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE chunks_fts USING fts5(id, text);
    INSERT INTO chunks (id, text, path, updated_at)
    VALUES ('chunk-1', 'alpha runtime memory', 'memory/smart-add/runtime.md', 10);
    INSERT INTO chunks_fts (id, text)
    VALUES ('chunk-1', 'alpha runtime memory');
  `);
  if (withMissingBackfillChunk) {
    core.prepare(
      "INSERT INTO chunks (id, text, path, updated_at) VALUES (?, ?, ?, ?)",
    ).run("chunk-2", "alpha backfill memory", "memory/smart-add/runtime.md", 9);
    core.prepare("INSERT INTO chunks_fts (id, text) VALUES (?, ?)").run("chunk-2", "alpha backfill memory");
  }
  core.close();

  const engine = new Database(engineDbPath);
  if (withConfidenceTable) {
    engine.exec(`
      CREATE TABLE memory_confidence (
        chunk_id TEXT PRIMARY KEY,
        initial_confidence REAL,
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
      INSERT INTO memory_confidence (
        chunk_id, confidence, last_confidence_update, base_tau, hit_count,
        is_protected, conflict_flag, category, is_archived, kg_data
      ) VALUES ('chunk-1', 0.9, 10, 7, 1, 0, 0, 'raw_log', 0, '{"entity":"alpha"}');
    `);
  }
  engine.close();
  return { root, coreDbPath, engineDbPath };
}

function createCurrentFixture() {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-hybrid-current-runtime-"));
  const coreDbPath = join(root, "openclaw-agent.sqlite");
  const engineDbPath = join(root, "engine.sqlite");
  const core = new Database(coreDbPath);
  core.exec(`
    CREATE TABLE memory_index_chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'memory',
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT NOT NULL,
      model TEXT NOT NULL,
      text TEXT NOT NULL,
      embedding TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE memory_index_chunks_fts USING fts5(
      id UNINDEXED,
      text,
      path UNINDEXED
    );
    INSERT INTO memory_index_chunks
      (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
    VALUES
      ('current-chunk-1', 'memory/smart-add/current.md', 'memory', 1, 1, 'hash', 'model', 'alpha current runtime memory', '[]', 10);
    INSERT INTO memory_index_chunks_fts (id, text, path)
    VALUES ('current-chunk-1', 'alpha current runtime memory', 'memory/smart-add/current.md');
  `);
  core.close();

  const engine = new Database(engineDbPath);
  engine.exec(`
    CREATE TABLE memory_confidence (
      chunk_id TEXT PRIMARY KEY,
      initial_confidence REAL,
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
    INSERT INTO memory_confidence (
      chunk_id, initial_confidence, confidence, last_confidence_update, base_tau, hit_count,
      is_protected, conflict_flag, category, is_archived, kg_data
    ) VALUES ('current-chunk-1', 0.9, 0.9, 10, 7, 1, 0, 0, 'raw_log', 0, '{"entity":"alpha"}');
  `);
  engine.close();
  return { root, coreDbPath, engineDbPath };
}

function createScope(paths, legacyCalls = []) {
  return createIsolatedHybridDbAccessScope({
    ...paths,
    withLegacyDb: run => {
      legacyCalls.push("legacy");
      return run({
        prepare() {
          throw new Error("legacy reader invoked");
        },
      });
    },
  });
}

test("factory is lazy, request-scoped, and shares handles within one request", async () => {
  const paths = createFixture();
  const scope = createScope(paths);
  let firstCore;
  let firstEngine;
  let secondCore;
  let secondEngine;
  try {
    await scope(async access => {
      firstCore = access.withCoreDb(db => db);
      assert.equal(access.withCoreDb(db => db), firstCore);
      firstEngine = access.withEngineDb(db => db);
      assert.equal(access.withEngineDb(db => db), firstEngine);
    });
    assert.throws(() => firstCore.prepare("SELECT 1").get(), /closed|not open/i);
    assert.throws(() => firstEngine.prepare("SELECT 1").get(), /closed|not open/i);

    await scope(async access => {
      secondCore = access.withCoreDb(db => db);
      secondEngine = access.withEngineDb(db => db);
    });
    assert.notEqual(secondCore, firstCore);
    assert.notEqual(secondEngine, firstEngine);
    assert.throws(() => secondCore.prepare("SELECT 1").get(), /closed|not open/i);
    assert.throws(() => secondEngine.prepare("SELECT 1").get(), /closed|not open/i);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("factory closes both native readonly handles and preserves callback errors", async () => {
  const paths = createFixture();
  const scope = createScope(paths);
  let core;
  let engine;
  try {
    await assert.rejects(scope(async access => {
      core = access.withCoreDb(db => db);
      engine = access.withEngineDb(db => db);
      throw new Error("hybrid callback failed");
    }), /hybrid callback failed/);
    assert.throws(() => core.prepare("SELECT 1").get(), /closed|not open/i);
    assert.throws(() => engine.prepare("SELECT 1").get(), /closed|not open/i);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("same-file paths fail before opening an isolated session", () => {
  const paths = createFixture();
  try {
    const scope = createIsolatedHybridDbAccessScope({
      coreDbPath: paths.coreDbPath,
      engineDbPath: paths.coreDbPath,
      withLegacyDb: () => {},
    });
    assert.throws(() => scope(() => "unreachable"), /different physical files/);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("valid FTS/KG/Recent fixture uses zero legacy accessor calls", async () => {
  const paths = createFixture();
  const legacyCalls = [];
  try {
    const result = await hybridSearch("alpha", { topK: 3 }, {
      withDb: () => {
        throw new Error("legacy base reader must not be used");
      },
      withHybridDbAccessScope: createScope(paths, legacyCalls),
      calcRealtimeConf: row => Number(row.confidence || 0),
      syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
      getMemorySearchManager: async () => ({ manager: { search: async () => ({ entries: [] }) } }),
    });
    assert.equal(legacyCalls.length, 0);
    assert.equal(result.debug.fts_error, undefined);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("current OpenClaw agent Core schema drives FTS KG and Recent without legacy access", async () => {
  const paths = createCurrentFixture();
  const legacyCalls = [];
  try {
    const result = await hybridSearch("alpha", { topK: 3 }, {
      withDb: () => {
        throw new Error("legacy base reader must not be used");
      },
      withHybridDbAccessScope: createScope(paths, legacyCalls),
      calcRealtimeConf: row => Number(row.confidence || 0),
      syncIndexIfNeeded: async () => ({ synced: false, reason: "test" }),
      getMemorySearchManager: async () => ({ manager: { search: async () => ({ entries: [] }) } }),
    });

    assert.equal(legacyCalls.length, 0);
    assert.equal(result.debug.fts_error, undefined);
    assert.equal(result.debug.kg_error, undefined);
    assert.equal(result.debug.recent_error, undefined);
    assert.equal(result.results.some(row => row.id === "current-chunk-1"), true);
    assert.equal(result.channels.includes("fts"), true);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("Hybrid search does not invoke sync or backfill", async () => {
  const paths = createFixture({ withMissingBackfillChunk: true });
  const legacyCalls = [];
  let syncCalls = 0;
  try {
    const result = await hybridSearch("alpha", { topK: 3 }, {
      withDb: () => {
        throw new Error("legacy base reader must not be used");
      },
      withHybridDbAccessScope: createScope(paths, legacyCalls),
      calcRealtimeConf: row => Number(row.confidence || 0),
      syncIndexIfNeeded: async () => {
        syncCalls += 1;
        throw new Error("read-only search must not sync");
      },
      getMemorySearchManager: async () => ({ manager: { search: async () => ({ entries: [] }) } }),
    });

    assert.equal(syncCalls, 0);
    assert.deepEqual(result.debug.sync, { synced: false, reason: "read_only_search" });
    assert.equal(legacyCalls.length, 0);
    withEngineDbIsolated(db => {
      assert.equal(db.prepare("SELECT confidence FROM memory_confidence WHERE chunk_id = 'chunk-2'").get(), undefined);
    }, { ...paths, readonly: true });
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("Explicit index sync backfills before a later read-only Hybrid search", async () => {
  const paths = createFixture({ withMissingBackfillChunk: true });
  const legacyCalls = [];
  try {
    const withCoreDb = fn => withCoreDbReadonly(fn, paths);
    const withEngineDb = fn => withEngineDbIsolated(fn, { ...paths, readonly: false });
    const backfill = createBackfillConfidenceForIndexedChunks({
      catParams: () => ({ conf: 0.5, tau: 7 }),
      inferCategoryFromChunk: () => "raw_log",
      withCoreDb,
      withEngineDb,
    });
    const syncIndexIfNeeded = createIndexSyncRuntime({
      memoryRoot: "/workspace",
      watchDirs: ["memory/smart-add"],
      withCoreDb,
      withEngineDb,
      getSharedMemoryManager: async () => ({ manager: null }),
      collectIndexedFiles: () => [{ relPath: "memory/smart-add/runtime.md", mtimeMs: 10 }],
      readIndexedPathState: () => ({ paths: ["memory/smart-add/runtime.md"], updatedAt: {} }),
      backfillConfidenceForIndexedChunks: backfill,
    });

    const syncResult = await syncIndexIfNeeded("test.explicit-sync");
    assert.equal(syncResult.backfill.inserted, 1);

    const result = await hybridSearch("alpha", { topK: 3 }, {
      withDb: () => {
        throw new Error("legacy base reader must not be used");
      },
      withHybridDbAccessScope: createScope(paths, legacyCalls),
      calcRealtimeConf: row => Number(row.confidence || 0),
      getMemorySearchManager: async () => ({ manager: { search: async () => ({ entries: [] }) } }),
    });

    assert.deepEqual(result.debug.sync, { synced: false, reason: "read_only_search" });
    assert.equal(legacyCalls.length, 0);
    withEngineDb(db => {
      assert.equal(db.prepare("SELECT confidence FROM memory_confidence WHERE chunk_id = 'chunk-2'").get().confidence, 0.5);
    });
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("missing Engine schema is not initialized by the readonly scope", async () => {
  const paths = createFixture({ withConfidenceTable: false });
  try {
    const scope = createScope(paths);
    let databaseNames;
    await scope(async access => {
      databaseNames = access.withEngineDb(db => db.prepare("PRAGMA database_list").all().map(row => row.name));
    });
    assert.deepEqual(databaseNames, ["main"]);
    const check = new Database(paths.engineDbPath, { readonly: true, fileMustExist: true });
    try {
      assert.equal(check.prepare("SELECT name FROM sqlite_master WHERE name = 'memory_confidence'").get(), undefined);
    } finally {
      check.close();
    }
  } finally {
    assert.equal(existsSync(paths.engineDbPath), true);
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("missing Engine file is not created by the readonly scope", async () => {
  const paths = createFixture();
  const missingEnginePath = join(paths.root, "missing", "engine.sqlite");
  try {
    const scope = createIsolatedHybridDbAccessScope({
      coreDbPath: paths.coreDbPath,
      engineDbPath: missingEnginePath,
      withLegacyDb: () => {
        throw new Error("legacy reader invoked");
      },
    });
    assert.throws(
      () => scope(access => access.withEngineDb(db => db.prepare("SELECT 1").get())),
      /unable to open|cannot open|not exist|directory does not exist/i,
    );
    assert.equal(existsSync(missingEnginePath), false);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("production wiring supplies the scope to AutoRecall and both search surfaces", () => {
  const indexSource = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  const dbRuntimeSource = readFileSync(new URL("../lib/runtime/db-runtime.js", import.meta.url), "utf8");
  const lifecycleSource = readFileSync(new URL("../lib/recall/auto-recall-hook-lifecycle.js", import.meta.url), "utf8");
  const actionsSource = readFileSync(new URL("../lib/tools/memory-engine-actions.js", import.meta.url), "utf8");
  assert.match(indexSource, /createMemoryEngineRuntimeAssembly/);
  assert.match(dbRuntimeSource, /createIsolatedHybridDbAccessScope/);
  assert.match(indexSource, /createHybridRuntimeContext\(\{[\s\S]*?dataAccess:\s*\{[\s\S]*?withHybridDbAccessScope/);
  assert.match(indexSource, /autoRecallLifecycle\.register\(hybridRuntimeContext\)/);
  assert.match(lifecycleSource, /buildHybridSearchRuntime\(hybridRuntimeContext/);
  assert.match(indexSource, /createMemoryEngineExecute\(\{[\s\S]*?hybrid: hybridRuntimeContext/);
  assert.match(indexSource, /createMemoryEngineSearchExecute\(\{\s*hybrid: hybridRuntimeContext/);
  assert.match(actionsSource, /normalizeHybridRuntimeContext/);
  assert.match(actionsSource, /buildHybridSearchRuntime\(/);
});

test("AutoRecall persistence is explicitly gated on an executed Hybrid result", () => {
  const lifecycleSource = readFileSync(new URL("../lib/recall/auto-recall-hook-lifecycle.js", import.meta.url), "utf8");
  const debugSource = readFileSync(new URL("../lib/recall/auto-recall-debug-metadata.js", import.meta.url), "utf8");
  assert.match(lifecycleSource, /buildAutoRecallDebugMetadata\(prompt, result, null, \{ searchExecuted: true \}\)/);
  assert.match(debugSource, /function summarizeLegacyDbFallback\(debugInfo = \{\}\)/);
  assert.match(debugSource, /legacy_db_fallback_channels/);
  assert.match(debugSource, /legacy_db_fallback_used/);
});
