import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkpoint = require("../bin/session-checkpoint.js");
const checkpointDb = require("../lib/checkpoint/db.js");

function isReadonlySqliteError(error) {
  return error?.code === "SQLITE_READONLY" || /readonly/i.test(String(error?.message || ""));
}

function createFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-checkpoint-db-"));
  const workspaceDir = resolve(root, "workspace");
  const coreDbPath = resolve(root, "core.sqlite");
  const engineDbPath = resolve(root, "engine.sqlite");
  mkdirSync(workspaceDir, { recursive: true });

  const coreDb = new Database(coreDbPath);
  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        text TEXT
      )
    `);
    coreDb.prepare("INSERT INTO chunks (id, text) VALUES (?, ?)").run("chunk-1", "hello core");
  } finally {
    coreDb.close();
  }

  const engineDb = new Database(engineDbPath);
  engineDb.close();

  return { root, workspaceDir, coreDbPath, engineDbPath };
}

test("withDb opens coreDbPath readonly and reads fixture core DB", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    const row = checkpointDb.withDb((db) => db.prepare("SELECT text FROM chunks WHERE id = ?").get("chunk-1"));
    assert.equal(row.text, "hello core");
  });
});

test("withDb preserves fileMustExist error for missing coreDbPath", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: resolve(fixture.root, "missing-core.sqlite"),
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    assert.throws(
      () => checkpointDb.withDb(() => null),
      /no such file|Cannot open database|unable to open database file/i,
    );
  });
});

test("withCheckpointDbs exposes separate engineDb and coreDb handles without ATTACH", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    const result = checkpointDb.withCheckpointDbs(({ engineDb, coreDb }) => ({
      sameHandle: engineDb === coreDb,
      attached: engineDb.prepare("PRAGMA database_list").all(),
      chunk: coreDb.prepare("SELECT text FROM chunks WHERE id = ?").get("chunk-1"),
      engineTable: engineDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_confidence'").get(),
    }));

    assert.equal(result.sameHandle, false);
    assert.equal(result.chunk.text, "hello core");
    assert.equal(result.engineTable?.name, "memory_confidence");
    assert.deepEqual(result.attached.map((entry) => entry.name), ["main"]);
  });
});

test("withCheckpointDbs coreDb is native SQLite readonly", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    checkpointDb.withCheckpointDbs(({ coreDb }) => {
      assert.throws(
        () => coreDb.prepare("INSERT INTO chunks (id, text) VALUES (?, ?)").run("x", "y"),
        /readonly/i,
      );
      assert.throws(
        () => coreDb.prepare("UPDATE chunks SET text = ? WHERE id = ?").run("changed", "chunk-1"),
        /readonly/i,
      );
      assert.throws(
        () => coreDb.prepare("DELETE FROM chunks WHERE id = ?").run("chunk-1"),
        /readonly/i,
      );
      assert.throws(
        () => coreDb.exec("CREATE TABLE forbidden (id INTEGER)"),
        /readonly/i,
      );
    });
  });
});

test("withCheckpointDbs writable engine allows memory_confidence writes", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    checkpointDb.withCheckpointDbs(({ engineDb }) => {
      engineDb.prepare(`
        INSERT INTO memory_confidence
        (chunk_id, initial_confidence, confidence, last_confidence_update, base_tau, hit_count, is_archived, is_protected, conflict_flag, category)
        VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?)
      `).run("chunk-1", 0.8, 0.8, 123, 30, "preference");
      engineDb.prepare("UPDATE memory_confidence SET confidence = ? WHERE chunk_id = ?").run(0.9, "chunk-1");
    });

    const db = new Database(fixture.engineDbPath, { readonly: true });
    try {
      const row = db.prepare("SELECT confidence FROM memory_confidence WHERE chunk_id = ?").get("chunk-1");
      assert.equal(row.confidence, 0.9);
    } finally {
      db.close();
    }
  });
});

test("withCheckpointDbs readonlyEngine keeps engine readonly and does not initialize schema", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    checkpointDb.withCheckpointDbs(({ engineDb }) => {
      engineDb.prepare(`
        INSERT INTO memory_confidence
        (chunk_id, initial_confidence, confidence, last_confidence_update, base_tau, hit_count, is_archived, is_protected, conflict_flag, category)
        VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?)
      `).run("existing-engine-row", 0.8, 0.8, 456, 30, "preference");
    });
  });

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    checkpointDb.withCheckpointDbs(({ engineDb, coreDb }) => {
      const existing = engineDb.prepare(`
        SELECT chunk_id, confidence
        FROM memory_confidence
        WHERE chunk_id = ?
      `).get("existing-engine-row");
      assert.equal(existing.chunk_id, "existing-engine-row");
      assert.equal(existing.confidence, 0.8);
      assert.equal(coreDb.prepare("SELECT text FROM chunks WHERE id = ?").get("chunk-1").text, "hello core");
      assert.throws(
        () => engineDb.prepare(`
          INSERT INTO memory_confidence
          (chunk_id, initial_confidence, confidence, last_confidence_update, base_tau, hit_count, is_archived, is_protected, conflict_flag, category)
          VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?)
        `).run("readonly-insert", 0.7, 0.7, 789, 14, "raw_log"),
        isReadonlySqliteError,
      );
      assert.throws(
        () => engineDb.prepare(`
          UPDATE memory_confidence
          SET confidence = ?
          WHERE chunk_id = ?
        `).run(0.9, "existing-engine-row"),
        isReadonlySqliteError,
      );
      assert.throws(
        () => engineDb.prepare(`
          DELETE FROM memory_confidence
          WHERE chunk_id = ?
        `).run("existing-engine-row"),
        isReadonlySqliteError,
      );
      assert.throws(
        () => engineDb.exec("CREATE TABLE forbidden_engine_write (id INTEGER)"),
        isReadonlySqliteError,
      );
      assert.throws(
        () => coreDb.prepare("INSERT INTO chunks (id, text) VALUES (?, ?)").run("x", "y"),
        /readonly/i,
      );
    }, { readonlyEngine: true });

    const db = new Database(fixture.engineDbPath, { readonly: true });
    try {
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_confidence'").get();
      const row = db.prepare("SELECT chunk_id, confidence FROM memory_confidence WHERE chunk_id = ?").get("existing-engine-row");
      assert.equal(table?.name, "memory_confidence");
      assert.equal(row.chunk_id, "existing-engine-row");
      assert.equal(row.confidence, 0.8);
    } finally {
      db.close();
    }
  });
});

test("withCheckpointDbs returns callback result", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    const result = checkpointDb.withCheckpointDbs(() => "ok");
    assert.equal(result, "ok");
  });
});

test("withCheckpointDbs closes both handles and preserves callback error", async () => {
  const fixture = createFixture();
  let capturedEngineDb;
  let capturedCoreDb;

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    assert.throws(
      () => checkpointDb.withCheckpointDbs(({ engineDb, coreDb }) => {
        capturedEngineDb = engineDb;
        capturedCoreDb = coreDb;
        throw new Error("expected callback failure");
      }),
      /expected callback failure/,
    );
  });

  assert.throws(() => capturedEngineDb.prepare("SELECT 1").get(), /not open|closed/i);
  assert.throws(() => capturedCoreDb.prepare("SELECT 1").get(), /not open|closed/i);
});

test("withCheckpointDbs closes both handles after successful completion", async () => {
  const fixture = createFixture();
  let capturedEngineDb;
  let capturedCoreDb;

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    checkpointDb.withCheckpointDbs(({ engineDb, coreDb }) => {
      capturedEngineDb = engineDb;
      capturedCoreDb = coreDb;
      return null;
    });
  });

  assert.throws(() => capturedEngineDb.prepare("SELECT 1").get(), /not open|closed/i);
  assert.throws(() => capturedCoreDb.prepare("SELECT 1").get(), /not open|closed/i);
});

test("checkpoint DB exports remove withMeDb and retain both inspectors", () => {
  assert.equal(checkpointDb.withMeDb, undefined);
  assert.equal(typeof checkpointDb.withDb, "function");
  assert.equal(typeof checkpointDb.withCheckpointDbs, "function");
  assert.equal(typeof checkpointDb.ensureCheckpointTables, "function");
  assert.equal(typeof checkpointDb.inspectCheckpointBusyTimeouts, "function");
  assert.equal(typeof checkpointDb.inspectBusyTimeouts, "function");
});

test("checkpoint DB source has no attached Core compatibility path", () => {
  const source = readFileSync(resolve(process.cwd(), "lib/checkpoint/db.js"), "utf8");
  assert.doesNotMatch(source, /withMeDb|chunks_db|ATTACH DATABASE|DETACH DATABASE|patchWriteGuards/);
});

test("inspectBusyTimeouts keeps legacy shape as a compatibility alias", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    const busy = checkpointDb.inspectBusyTimeouts();
    assert.deepEqual(Object.keys(busy).sort(), ["attachedCore", "core", "engine"]);
    assert.equal(typeof busy.core, "number");
    assert.equal(typeof busy.engine, "number");
    assert.equal(typeof busy.attachedCore, "number");
    assert.equal(busy.attachedCore, busy.engine);
  });
});

test("inspectCheckpointBusyTimeouts returns native engine/core busy timeout values", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    const busy = checkpointDb.inspectCheckpointBusyTimeouts();
    assert.deepEqual(Object.keys(busy).sort(), ["coreBusyTimeoutMs", "engineBusyTimeoutMs"]);
    assert.equal(typeof busy.engineBusyTimeoutMs, "number");
    assert.equal(typeof busy.coreBusyTimeoutMs, "number");
    assert.equal(busy.engineBusyTimeoutMs > 0, true);
    assert.equal(busy.coreBusyTimeoutMs > 0, true);
  });
});

test("inspectCheckpointBusyTimeouts is readonly and does not initialize schema", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    const busy = checkpointDb.inspectCheckpointBusyTimeouts({ readonlyEngine: false });
    assert.equal(typeof busy.engineBusyTimeoutMs, "number");
    assert.equal(typeof busy.coreBusyTimeoutMs, "number");
  });

  const db = new Database(fixture.engineDbPath, { readonly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    assert.deepEqual(tables, []);
  } finally {
    db.close();
  }
});

test("inspectCheckpointBusyTimeouts does not create a missing Engine file", async () => {
  const fixture = createFixture();
  const missingEnginePath = resolve(fixture.root, "missing-engine.sqlite");

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: missingEnginePath,
  }, async () => {
    assert.throws(
      () => checkpointDb.inspectCheckpointBusyTimeouts(),
      /no such file|Cannot open database|unable to open database file/i,
    );
  });
  assert.equal(existsSync(missingEnginePath), false);
});
