import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

function createCoreDb(corePath) {
  const db = new Database(corePath);
  try {
    db.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT,
        text TEXT,
        updated_at INTEGER
      )
    `);
    db.prepare("INSERT INTO chunks (id, path, text, updated_at) VALUES (?, ?, ?, ?)").run(
      "chunk-1",
      "memory/smart-add/2026-05-28.md",
      "hello memory",
      1717000000,
    );
  } finally {
    db.close();
  }
}

test("engine DB writes stay in plugin DB while core DB remains readonly", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-db-"));
  const corePath = resolve(root, "core.sqlite");
  const engineDir = resolve(root, "engine");
  const enginePath = resolve(engineDir, "memory-engine.sqlite");
  mkdirSync(engineDir, { recursive: true });
  createCoreDb(corePath);

  const oldCore = process.env.MEMORY_ENGINE_CORE_DB;
  const oldEngine = process.env.MEMORY_ENGINE_DB;
  process.env.MEMORY_ENGINE_CORE_DB = corePath;
  process.env.MEMORY_ENGINE_DB = enginePath;

  try {
    const bust = Date.now();
    const { withEngineDb } = await import(`../lib/db/engine-db.js?db-isolation=${bust}`);
    const { ensureMemoryEngineTables } = await import(`../lib/db/schema.js?db-isolation=${bust}`);

    withEngineDb((db) => {
      ensureMemoryEngineTables(db);
      const coreRow = db.prepare("SELECT id FROM chunks WHERE id = ?").get("chunk-1");
      assert.equal(coreRow?.id, "chunk-1");

      db.prepare([
        "INSERT INTO memory_events",
        "(event_type, source, memory_id)",
        "VALUES (?, ?, ?)",
      ].join(" ")).run("memory_created", "test", "chunk-1");

      assert.throws(
        () => db.prepare("DELETE FROM core.chunks WHERE id = ?").run("chunk-1"),
        /blocked|readonly|query_only/i,
      );
    });

    const coreDb = new Database(corePath, { readonly: true });
    try {
      const eventsTable = coreDb.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_events'",
      ).get();
      assert.equal(eventsTable, undefined);
      const row = coreDb.prepare("SELECT id FROM chunks WHERE id = ?").get("chunk-1");
      assert.equal(row?.id, "chunk-1");
    } finally {
      coreDb.close();
    }

    const engineDb = new Database(enginePath, { readonly: true });
    try {
      const eventsCount = engineDb.prepare("SELECT COUNT(*) AS c FROM memory_events").get();
      assert.equal(eventsCount?.c, 1);
      const confidenceTable = engineDb.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_confidence'",
      ).get();
      assert.equal(confidenceTable?.name, "memory_confidence");
    } finally {
      engineDb.close();
    }
  } finally {
    if (oldCore === undefined) delete process.env.MEMORY_ENGINE_CORE_DB;
    else process.env.MEMORY_ENGINE_CORE_DB = oldCore;
    if (oldEngine === undefined) delete process.env.MEMORY_ENGINE_DB;
    else process.env.MEMORY_ENGINE_DB = oldEngine;
  }
});
