import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkpoint = require("../bin/session-checkpoint.js");
const { writeConfidence } = require("../lib/checkpoint/confidence-writer.js");

function createFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-checkpoint-confidence-"));
  const workspaceDir = resolve(root, "workspace");
  const coreDbPath = resolve(root, "core.sqlite");
  const engineDbPath = resolve(root, "engine.sqlite");
  mkdirSync(workspaceDir, { recursive: true });

  const coreDb = new Database(coreDbPath);
  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        text TEXT,
        updated_at INTEGER
      )
    `);
  } finally {
    coreDb.close();
  }

  return { root, workspaceDir, coreDbPath, engineDbPath };
}

function insertSmartAddChunk(coreDbPath, { chunkId = "smartadd-chunk-1", path = "memory/smart-add/2026-06-18.md" } = {}) {
  const db = new Database(coreDbPath);
  try {
    db.prepare("INSERT INTO chunks (id, path, text, updated_at) VALUES (?, ?, ?, ?)").run(
      chunkId,
      path,
      "placeholder chunk",
      1718587800,
    );
  } finally {
    db.close();
  }
}

function readConfidenceRows(engineDbPath) {
  if (!existsSync(engineDbPath)) return [];
  const db = new Database(engineDbPath, { readonly: true });
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_confidence'").get();
    if (!table) return [];
    return db.prepare(`
      SELECT chunk_id, initial_confidence, confidence, last_confidence_update, base_tau, category
      FROM memory_confidence
      ORDER BY chunk_id
    `).all();
  } finally {
    db.close();
  }
}

function readCoreChunkCount(coreDbPath) {
  const db = new Database(coreDbPath, { readonly: true });
  try {
    return Number(db.prepare("SELECT COUNT(*) AS c FROM chunks").get()?.c || 0);
  } finally {
    db.close();
  }
}

for (const [category, conf, tau] of [
  ["preference", 0.8, 90.0],
  ["episodic", 0.7, 30.0],
  ["raw_log", 0.5, 7.0],
  ["user_identity", 0.95, 365.0],
  ["kg_node", 0.85, 90.0],
  ["temporary", 0.4, 2.0],
]) {
  test(`writeConfidence keeps ${category} mapping`, async () => {
    const fixture = createFixture();
    insertSmartAddChunk(fixture.coreDbPath);
    const originalNow = Date.now;
    Date.now = () => 1718678400123;

    try {
      await checkpoint.withRuntime({
        workspaceDir: fixture.workspaceDir,
        coreDbPath: fixture.coreDbPath,
        engineDbPath: fixture.engineDbPath,
        timeZone: "Asia/Shanghai",
        now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
      }, async () => {
        writeConfidence("entry-1", "body", category);
      });

      const rows = readConfidenceRows(fixture.engineDbPath);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].chunk_id, "smartadd-chunk-1");
      assert.equal(rows[0].initial_confidence, conf);
      assert.equal(rows[0].confidence, conf);
      assert.equal(rows[0].base_tau, tau);
      assert.equal(rows[0].category, category);
      assert.equal(rows[0].last_confidence_update, 1718678400);
    } finally {
      Date.now = originalNow;
    }
  });
}

test("unknown category falls back to conf 0.5 and tau 7.0", async () => {
  const fixture = createFixture();
  insertSmartAddChunk(fixture.coreDbPath);
  const originalNow = Date.now;
  Date.now = () => 1718678400123;

  try {
    await checkpoint.withRuntime({
      workspaceDir: fixture.workspaceDir,
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
      timeZone: "Asia/Shanghai",
      now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
    }, async () => {
      writeConfidence("entry-1", "body", "unknown_category");
    });

    const rows = readConfidenceRows(fixture.engineDbPath);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].initial_confidence, 0.5);
    assert.equal(rows[0].confidence, 0.5);
    assert.equal(rows[0].base_tau, 7.0);
    assert.equal(rows[0].category, "unknown_category");
    assert.equal(rows[0].last_confidence_update, 1718678400);
  } finally {
    Date.now = originalNow;
  }
});

test("writeConfidence writes engine row by resolving chunk through core chunks query", async () => {
  const fixture = createFixture();
  insertSmartAddChunk(fixture.coreDbPath, { chunkId: "resolved-chunk" });

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    writeConfidence("entry-1", "body", "preference");
  });

  const rows = readConfidenceRows(fixture.engineDbPath);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].chunk_id, "resolved-chunk");
});

test("writeConfidence does not write when matching chunk is not found", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    writeConfidence("entry-1", "body", "preference");
  });

  assert.deepEqual(readConfidenceRows(fixture.engineDbPath), []);
});

test("writeConfidence keeps core DB readonly and only writes engine DB", async () => {
  const fixture = createFixture();
  insertSmartAddChunk(fixture.coreDbPath);
  const before = readCoreChunkCount(fixture.coreDbPath);

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    writeConfidence("entry-1", "body", "episodic");
  });

  const after = readCoreChunkCount(fixture.coreDbPath);
  assert.equal(after, before);
  assert.equal(readConfidenceRows(fixture.engineDbPath).length, 1);
});
