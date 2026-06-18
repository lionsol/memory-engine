import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkpoint = require("../bin/session-checkpoint.js");
const checkpointDb = require("../lib/checkpoint/db.js");

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

test("withMeDb opens engineDbPath and ATTACHes coreDbPath as chunks_db", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    const row = checkpointDb.withMeDb((db) => {
      const attached = db.prepare("PRAGMA database_list").all();
      const chunk = db.prepare("SELECT text FROM chunks_db.chunks WHERE id = ?").get("chunk-1");
      return { attached, chunk };
    });

    assert.equal(row.chunk.text, "hello core");
    assert.equal(row.attached.some((entry) => entry.name === "chunks_db"), true);
  });
});

test("withMeDb non-readonly creates memory_confidence table and indexes", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    checkpointDb.withMeDb(() => null);

    const db = new Database(fixture.engineDbPath, { readonly: true });
    try {
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_confidence'").get();
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_mc_archived', 'idx_mc_category') ORDER BY name").all();
      assert.equal(table?.name, "memory_confidence");
      assert.deepEqual(indexes.map((row) => row.name), ["idx_mc_archived", "idx_mc_category"]);
    } finally {
      db.close();
    }
  });
});

test("withMeDb readonly true does not create schema", async () => {
  const fixture = createFixture();
  const emptyEngine = new Database(fixture.engineDbPath);
  emptyEngine.close();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    checkpointDb.withMeDb(() => null, { readonly: true });

    const db = new Database(fixture.engineDbPath, { readonly: true });
    try {
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_confidence'").get();
      assert.equal(table, undefined);
    } finally {
      db.close();
    }
  });
});

test("withMeDb closes DB even when callback throws", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    assert.throws(
      () => checkpointDb.withMeDb(() => {
        throw new Error("boom");
      }),
      /boom/,
    );

    const renamedPath = `${fixture.engineDbPath}.moved`;
    renameSync(fixture.engineDbPath, renamedPath);
    const reopened = new Database(renamedPath, { readonly: true });
    reopened.close();
  });
});

test("inspectBusyTimeouts keeps return shape", async () => {
  const fixture = createFixture();
  const emptyEngine = new Database(fixture.engineDbPath);
  emptyEngine.close();

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
  });
});
