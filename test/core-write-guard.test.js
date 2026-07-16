import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  isWriteSql,
  patchWriteGuards,
  writeTargetIsCore,
} from "../lib/db/core-write-guard.js";

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

function openAttachedDb() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-guard-"));
  const corePath = resolve(root, "core.sqlite");
  const engineDir = resolve(root, "engine");
  const enginePath = resolve(engineDir, "memory-engine.sqlite");
  mkdirSync(engineDir, { recursive: true });
  createCoreDb(corePath);

  const db = new Database(enginePath);
  db.exec("CREATE TABLE engine_items (id TEXT PRIMARY KEY, value TEXT)");
  db.exec(`ATTACH DATABASE '${String(corePath).replace(/'/g, "''")}' AS core`);
  patchWriteGuards(db, { message: "writes to OpenClaw core DB are blocked in test" });
  return db;
}

function openCheckpointAttachedDb() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-checkpoint-guard-"));
  const corePath = resolve(root, "core.sqlite");
  const enginePath = resolve(root, "engine.sqlite");
  createCoreDb(corePath);

  const db = new Database(enginePath);
  db.exec("CREATE TABLE memory_confidence (chunk_id TEXT PRIMARY KEY, confidence REAL)");
  db.exec(`ATTACH DATABASE '${String(corePath).replace(/'/g, "''")}' AS chunks_db`);
  patchWriteGuards(db, { message: "writes to OpenClaw core DB are blocked in checkpoint DB access" });
  return db;
}

function openOrphanCleanupAttachedDb() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-orphan-guard-"));
  const corePath = resolve(root, "core.sqlite");
  const enginePath = resolve(root, "engine.sqlite");
  createCoreDb(corePath);

  const db = new Database(enginePath);
  db.exec("CREATE TABLE memory_confidence (chunk_id TEXT PRIMARY KEY, confidence REAL)");
  db.exec(`ATTACH DATABASE '${String(corePath).replace(/'/g, "''")}' AS core`);
  patchWriteGuards(db, { message: "writes to OpenClaw core DB are blocked in orphan confidence cleanup" });
  return db;
}

test("pure SQL helpers detect core writes through casing, whitespace, and comments", () => {
  const blocked = [
    "INSERT INTO core.chunks (id) VALUES ('x')",
    "  update core.chunks set text = 'x' where id = 'chunk-1'",
    "\n\tDELETE FROM core.chunks WHERE id = 'chunk-1'",
    "ALTER TABLE core.chunks ADD COLUMN event_at INTEGER",
    "/* lead comment */ DROP TABLE core.chunks",
    "-- one line comment\nCREATE TABLE core.xxx (id TEXT)",
    "CREATE INDEX idx_core_chunks_event_at ON core.chunks(event_at)",
    "CREATE INDEX core.idx_chunks_event_at ON chunks(event_at)",
    "DROP INDEX core.idx_chunks_event_at",
  ];

  for (const sql of blocked) {
    assert.equal(isWriteSql(sql), true, sql);
    assert.equal(writeTargetIsCore(sql), true, sql);
  }

  assert.equal(isWriteSql("SELECT * FROM core.chunks"), false);
  assert.equal(writeTargetIsCore("INSERT INTO engine_items SELECT * FROM core.chunks"), false);
  assert.equal(writeTargetIsCore("INSERT INTO chunks_db.chunks (id) VALUES ('x')"), true);
  assert.equal(writeTargetIsCore("UPDATE chunks_db.chunks SET text = 'x' WHERE id = 'chunk-1'"), true);
});

test("core reads are allowed while core writes are blocked", () => {
  const db = openAttachedDb();
  try {
    const row = db.prepare("SELECT id, text FROM core.chunks WHERE id = ?").get("chunk-1");
    assert.equal(row?.id, "chunk-1");
    assert.equal(row?.text, "hello memory");

    assert.throws(
      () => db.prepare("INSERT INTO core.chunks (id, path, text, updated_at) VALUES (?, ?, ?, ?)").run("x", "p", "t", 1),
      /blocked/i,
    );
    assert.throws(
      () => db.prepare("UPDATE core.chunks SET text = ? WHERE id = ?").run("changed", "chunk-1"),
      /blocked/i,
    );
    assert.throws(
      () => db.prepare("DELETE FROM core.chunks WHERE id = ?").run("chunk-1"),
      /blocked/i,
    );
    assert.throws(
      () => db.exec("DROP TABLE core.chunks"),
      /blocked/i,
    );
    assert.throws(
      () => db.exec("CREATE TABLE core.xxx (id TEXT)"),
      /blocked/i,
    );
    assert.throws(
      () => db.exec("ALTER TABLE core.chunks ADD COLUMN event_at INTEGER"),
      /blocked/i,
    );
    assert.throws(
      () => db.exec("CREATE INDEX idx_core_chunks_event_at ON core.chunks(event_at)"),
      /blocked/i,
    );
  } finally {
    db.close();
  }
});

test("engine DB writes remain allowed", () => {
  const db = openAttachedDb();
  try {
    db.prepare("INSERT INTO engine_items (id, value) VALUES (?, ?)").run("item-1", "v1");
    db.prepare("UPDATE engine_items SET value = ? WHERE id = ?").run("v2", "item-1");
    const row = db.prepare("SELECT value FROM engine_items WHERE id = ?").get("item-1");
    assert.equal(row?.value, "v2");
  } finally {
    db.close();
  }
});

test("comment-prefixed and mixed-case core writes are still blocked", () => {
  const db = openAttachedDb();
  try {
    const blocked = [
      "   INSERT INTO core.chunks (id, path, text, updated_at) VALUES ('x', 'p', 't', 1)",
      "\n\tUpDaTe core.chunks SET text = 'x' WHERE id = 'chunk-1'",
      "/* c1 */ /* c2 */ DELETE FROM core.chunks WHERE id = 'chunk-1'",
      "-- c1\nDROP TABLE core.chunks",
      "/* c1 */\nCREATE TABLE core.xxx (id TEXT)",
      "SELECT 1; ALTER TABLE core.chunks ADD COLUMN event_at INTEGER",
    ];

    for (const sql of blocked) {
      assert.throws(() => db.exec(sql), /blocked/i, sql);
    }
  } finally {
    db.close();
  }
});

test("checkpoint path blocks chunks_db writes while engine writes stay allowed", () => {
  const db = openCheckpointAttachedDb();
  try {
    const row = db.prepare("SELECT id, text FROM chunks_db.chunks WHERE id = ?").get("chunk-1");
    assert.equal(row?.id, "chunk-1");

    assert.throws(
      () => db.prepare("INSERT INTO chunks_db.chunks (id, path, text, updated_at) VALUES (?, ?, ?, ?)").run("x", "p", "t", 1),
      /blocked/i,
    );
    assert.throws(
      () => db.prepare("UPDATE chunks_db.chunks SET text = ? WHERE id = ?").run("changed", "chunk-1"),
      /blocked/i,
    );
    assert.throws(
      () => db.prepare("DELETE FROM chunks_db.chunks WHERE id = ?").run("chunk-1"),
      /blocked/i,
    );

    db.prepare("INSERT INTO memory_confidence (chunk_id, confidence) VALUES (?, ?)").run("chunk-1", 0.5);
    db.prepare("UPDATE memory_confidence SET confidence = ? WHERE chunk_id = ?").run(0.9, "chunk-1");
    assert.equal(db.prepare("SELECT confidence FROM memory_confidence WHERE chunk_id = ?").get("chunk-1")?.confidence, 0.9);
  } finally {
    db.close();
  }
});

test("orphan cleanup path blocks core writes while memory_confidence cleanup remains allowed", () => {
  const db = openOrphanCleanupAttachedDb();
  try {
    db.prepare("INSERT INTO memory_confidence (chunk_id, confidence) VALUES (?, ?)").run("chunk-1", 0.5);

    assert.throws(
      () => db.prepare("DELETE FROM core.chunks WHERE id = ?").run("chunk-1"),
      /blocked/i,
    );
    assert.throws(
      () => db.prepare("UPDATE core.chunks SET text = ? WHERE id = ?").run("changed", "chunk-1"),
      /blocked/i,
    );

    db.prepare("DELETE FROM memory_confidence WHERE chunk_id = ?").run("chunk-1");
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM memory_confidence WHERE chunk_id = ?").get("chunk-1")?.c, 0);
  } finally {
    db.close();
  }
});
