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

test("pure SQL helpers detect core writes through casing, whitespace, and comments", () => {
  const blocked = [
    "INSERT INTO core.chunks (id) VALUES ('x')",
    "  update core.chunks set text = 'x' where id = 'chunk-1'",
    "\n\tDELETE FROM core.chunks WHERE id = 'chunk-1'",
    "/* lead comment */ DROP TABLE core.chunks",
    "-- one line comment\nCREATE TABLE core.xxx (id TEXT)",
  ];

  for (const sql of blocked) {
    assert.equal(isWriteSql(sql), true, sql);
    assert.equal(writeTargetIsCore(sql), true, sql);
  }

  assert.equal(isWriteSql("SELECT * FROM core.chunks"), false);
  assert.equal(writeTargetIsCore("INSERT INTO engine_items SELECT * FROM core.chunks"), false);
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
    ];

    for (const sql of blocked) {
      assert.throws(() => db.exec(sql), /blocked/i, sql);
    }
  } finally {
    db.close();
  }
});
