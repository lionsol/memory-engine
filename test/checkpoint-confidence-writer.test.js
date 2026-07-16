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

function readDatabaseList(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare("PRAGMA database_list").all();
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

test("writeConfidence replaces existing engine row for the same chunk without creating duplicates", async () => {
  const fixture = createFixture();
  insertSmartAddChunk(fixture.coreDbPath, { chunkId: "replace-chunk" });
  const originalNow = Date.now;

  try {
    await checkpoint.withRuntime({
      workspaceDir: fixture.workspaceDir,
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
      timeZone: "Asia/Shanghai",
      now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
    }, async () => {
      Date.now = () => 1718678400123;
      assert.equal(writeConfidence("entry-1", "body", "raw_log"), undefined);
      Date.now = () => 1718678460456;
      assert.equal(writeConfidence("entry-2", "body", "preference"), undefined);
    });
  } finally {
    Date.now = originalNow;
  }

  const rows = readConfidenceRows(fixture.engineDbPath);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    chunk_id: "replace-chunk",
    initial_confidence: 0.8,
    confidence: 0.8,
    last_confidence_update: 1718678460,
    base_tau: 90.0,
    category: "preference",
  });
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
    assert.equal(writeConfidence("entry-1", "body", "preference"), undefined);
  });

  assert.deepEqual(readConfidenceRows(fixture.engineDbPath), []);
  assert.equal(existsSync(fixture.engineDbPath), false);
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

test("writeConfidence propagates isolated engine open failures without writing", async () => {
  const fixture = createFixture();
  insertSmartAddChunk(fixture.coreDbPath);

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.coreDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, async () => {
    assert.throws(
      () => writeConfidence("entry-1", "body", "preference"),
      /different physical files/i,
    );
  });

  const coreDb = new Database(fixture.coreDbPath, { readonly: true });
  try {
    assert.equal(
      coreDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_confidence'").get(),
      undefined,
    );
  } finally {
    coreDb.close();
  }
});

test("writeConfidence supports repeated calls without attached schemas", async () => {
  const fixture = createFixture();
  insertSmartAddChunk(fixture.coreDbPath, { chunkId: "repeat-a", path: "memory/smart-add/2026-06-18.md" });
  insertSmartAddChunk(fixture.coreDbPath, { chunkId: "repeat-b", path: "memory/smart-add/2026-06-19.md" });

  const originalNow = Date.now;
  try {
    await checkpoint.withRuntime({
      workspaceDir: fixture.workspaceDir,
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
      timeZone: "Asia/Shanghai",
      now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
    }, async () => {
      Date.now = () => 1718678400123;
      assert.equal(writeConfidence("entry-1", "body", "raw_log"), undefined);
      assert.equal(
        writeConfidence("entry-2", "body", "episodic", {
          fileRel: "memory/smart-add/2026-06-19.md",
        }),
        undefined,
      );
    });
  } finally {
    Date.now = originalNow;
  }

  const rows = readConfidenceRows(fixture.engineDbPath);
  assert.deepEqual(rows.map((row) => row.chunk_id), ["repeat-a", "repeat-b"]);

  const databaseList = readDatabaseList(fixture.engineDbPath);
  assert.deepEqual(databaseList.map((row) => row.name), ["main"]);
  assert.equal(databaseList[0].file, fixture.engineDbPath);
});

test("writeConfidence source no longer references attached checkpoint schema", () => {
  const source = require("node:fs").readFileSync(resolve("lib/checkpoint/confidence-writer.js"), "utf8");
  assert.doesNotMatch(source, /withMeDb/);
  assert.doesNotMatch(source, /chunks_db/);
  assert.doesNotMatch(source, /ATTACH DATABASE/);
  assert.doesNotMatch(source, /patchWriteGuards/);
  assert.match(source, /withDb/);
  assert.match(source, /withEngineDbIsolated/);
});
