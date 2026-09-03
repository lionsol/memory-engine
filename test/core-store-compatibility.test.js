import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";

import {
  detectCoreStoreDialect,
  getCoreFtsReference,
} from "../lib/db/core-store.js";
import { withCoreDbReadonly, withEngineDbIsolated } from "../lib/db/isolated-dbs.js";
import { createBackfillConfidenceForIndexedChunks } from "../lib/index-sync-runtime.js";
import { buildIsolatedFtsSql } from "../lib/recall/hybrid/channels/fts-query.js";

function createCurrentCoreDb(path) {
  const db = new Database(path);
  db.exec(`
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
  `);
  const rows = [
    ["current-1", "memory/smart-add/a.md", "alpha current memory", 100],
    ["current-2", "memory/episodes/b.md", "beta episode", 200],
  ];
  const insertChunk = db.prepare(`
    INSERT INTO memory_index_chunks
      (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
    VALUES (?, ?, 'memory', 1, 1, 'hash', 'model', ?, '[]', ?)
  `);
  const insertFts = db.prepare(
    "INSERT INTO memory_index_chunks_fts (id, text, path) VALUES (?, ?, ?)",
  );
  for (const [id, pathValue, text, updatedAt] of rows) {
    insertChunk.run(id, pathValue, text, updatedAt);
    insertFts.run(id, text, pathValue);
  }
  db.close();
}

test("current OpenClaw Core store exposes canonical readonly chunks and physical FTS", () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-current-core-"));
  const coreDbPath = join(root, "openclaw-agent.sqlite");
  const engineDbPath = join(root, "engine.sqlite");
  createCurrentCoreDb(coreDbPath);

  try {
    withCoreDbReadonly((db) => {
      const descriptor = detectCoreStoreDialect(db, { schema: "main" });
      assert.equal(descriptor.dialect, "openclaw_memory_index");
      assert.equal(descriptor.chunksTable, "memory_index_chunks");

      const rows = db.prepare(
        "SELECT id, path, text, updated_at FROM chunks ORDER BY updated_at, id",
      ).all();
      assert.deepEqual(rows.map(row => row.id), ["current-1", "current-2"]);

      const fts = getCoreFtsReference(db, { schema: "main" });
      assert.equal(fts.from, "memory_index_chunks_fts");
      assert.equal(fts.matchName, "memory_index_chunks_fts");
      const matches = db.prepare(buildIsolatedFtsSql(fts)).all("alpha", "[]", 5);
      assert.deepEqual(matches.map(row => row.id), ["current-1"]);

      assert.deepEqual(
        db.prepare("PRAGMA database_list").all().map(row => String(row.name)),
        ["main", "temp"],
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS c FROM sqlite_temp_master WHERE name = 'chunks'").get().c,
        1,
      );
    }, { coreDbPath, engineDbPath });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("current OpenClaw Core chunks backfill into an empty Engine through canonical access", () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-current-backfill-"));
  const coreDbPath = join(root, "openclaw-agent.sqlite");
  const engineDbPath = join(root, "engine.sqlite");
  createCurrentCoreDb(coreDbPath);
  const engine = new Database(engineDbPath);
  engine.exec(`
    CREATE TABLE memory_confidence (
      chunk_id TEXT PRIMARY KEY,
      initial_confidence REAL NOT NULL DEFAULT 0.5,
      confidence REAL NOT NULL DEFAULT 0.5,
      last_confidence_update INTEGER,
      base_tau REAL NOT NULL DEFAULT 7.0,
      hit_count INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      is_protected INTEGER NOT NULL DEFAULT 0,
      conflict_flag INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'raw_log',
      kg_data TEXT
    );
  `);
  engine.close();

  try {
    const backfill = createBackfillConfidenceForIndexedChunks({
      catParams: category => category === "episodic"
        ? { conf: 0.7, tau: 30 }
        : { conf: 0.5, tau: 7 },
      inferCategoryFromChunk: path => path.includes("/episodes/") ? "episodic" : "raw_log",
      withCoreDb: run => withCoreDbReadonly(run, { coreDbPath, engineDbPath }),
      withEngineDb: run => withEngineDbIsolated(run, {
        coreDbPath,
        engineDbPath,
        engineDbDir: root,
        readonly: false,
      }),
    });
    const result = backfill(1234);
    assert.deepEqual(result, { scanned: 2, inserted: 2 });
    withEngineDbIsolated((db) => {
      assert.deepEqual(
        db.prepare("SELECT chunk_id, category FROM memory_confidence ORDER BY chunk_id").all(),
        [
          { chunk_id: "current-1", category: "raw_log" },
          { chunk_id: "current-2", category: "episodic" },
        ],
      );
    }, { coreDbPath, engineDbPath, readonly: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Engine compatibility access is isolated from the readonly Core handle", () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-current-isolated-"));
  const coreDbPath = join(root, "openclaw-agent.sqlite");
  const engineDbPath = join(root, "engine.sqlite");
  createCurrentCoreDb(coreDbPath);
  new Database(engineDbPath).close();

  try {
    withCoreDbReadonly((coreDb) => {
      assert.deepEqual(
        coreDb.prepare("PRAGMA database_list").all().map(row => String(row.name)),
        ["main", "temp"],
      );
      assert.equal(
        detectCoreStoreDialect(coreDb, { schema: "main" }).dialect,
        "openclaw_memory_index",
      );
      assert.equal(coreDb.prepare("SELECT COUNT(*) AS c FROM chunks").get().c, 2);
      assert.throws(
        () => coreDb.prepare(
          "UPDATE memory_index_chunks SET text = 'blocked' WHERE id = 'current-1'",
        ).run(),
        /readonly|read-only/i,
      );
    }, { coreDbPath, engineDbPath });

    withEngineDbIsolated((engineDb) => {
      assert.deepEqual(
        engineDb.prepare("PRAGMA database_list").all().map(row => String(row.name)),
        ["main"],
      );
      assert.throws(
        () => engineDb.prepare("SELECT COUNT(*) AS c FROM chunks").get(),
        /no such table/i,
      );
    }, { coreDbPath, engineDbPath, engineDbDir: root, readonly: true });

    withEngineDbIsolated((engineDb) => {
      engineDb.exec("CREATE TABLE engine_probe (id TEXT PRIMARY KEY)");
      engineDb.prepare("INSERT INTO engine_probe (id) VALUES ('ok')").run();
      assert.equal(engineDb.prepare("SELECT COUNT(*) AS c FROM engine_probe").get().c, 1);
    }, { coreDbPath, engineDbPath, engineDbDir: root, readonly: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
