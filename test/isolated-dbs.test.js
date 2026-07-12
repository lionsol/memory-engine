import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, linkSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  closeIsolatedDbSession,
  createIsolatedDbSession,
  openCoreDbReadonly,
  openEngineDbIsolated,
  withCoreDbReadonly,
  withEngineDbIsolated,
  withIsolatedDbSession,
} from "../lib/db/isolated-dbs.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-isolated-dbs-"));
  const coreDbPath = join(root, "core.sqlite");
  const engineDbPath = join(root, "nested", "engine.sqlite");
  const core = new Database(coreDbPath);
  core.exec("CREATE TABLE chunks (id TEXT PRIMARY KEY, text TEXT); INSERT INTO chunks VALUES ('chunk-1', 'original');");
  core.close();
  return { root, coreDbPath, engineDbPath };
}

function databaseList(db) {
  return db.prepare("PRAGMA database_list").all();
}

function assertOnlyMain(db, expectedPath) {
  const rows = databaseList(db);
  assert.deepEqual(rows.map((row) => row.name), ["main"]);
  assert.equal(rows[0].file, expectedPath);
}

function assertNoSuchTable(fn) {
  assert.throws(fn, (error) => error.code === "SQLITE_ERROR" && /no such table/i.test(error.message));
}

test("isolated Core readonly handle uses SQLite-native readonly protection", () => {
  const paths = fixture();
  let db;
  try {
    db = openCoreDbReadonly(paths);
    assertOnlyMain(db, paths.coreDbPath);
    assert.equal(db.prepare("SELECT text FROM chunks WHERE id = 'chunk-1'").get()?.text, "original");
    for (const sql of [
      "UPDATE chunks SET text = 'changed' WHERE id = 'chunk-1'",
      "WITH x AS (SELECT 1) UPDATE chunks SET text = 'cte' WHERE id = 'chunk-1'",
      "INSERT INTO chunks (id, text) VALUES ('chunk-2', 'inserted')",
      "DELETE FROM chunks WHERE id = 'chunk-1'",
      "PRAGMA user_version = 9",
    ]) {
      assert.throws(() => db.exec(sql), (error) => error.code === "SQLITE_READONLY", sql);
    }
  } finally {
    if (db?.open) db.close();
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("isolated writable Engine supports schema writes, transactions, WAL, and persistence", () => {
  const paths = fixture();
  let db;
  try {
    db = openEngineDbIsolated(paths);
    assertOnlyMain(db, paths.engineDbPath);
    db.exec("CREATE TABLE probe_items (id INTEGER PRIMARY KEY, value TEXT)");
    db.prepare("INSERT INTO probe_items(value) VALUES ('first')").run();
    db.transaction(() => {
      db.prepare("INSERT INTO probe_items(value) VALUES ('transaction')").run();
      db.prepare("UPDATE probe_items SET value = 'updated' WHERE value = 'first'").run();
    })();
    assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM probe_items").get().count, 2);
  } finally {
    if (db?.open) db.close();
  }
  try {
    const reopened = openEngineDbIsolated({ ...paths, readonly: true });
    try {
      assert.deepEqual(reopened.prepare("SELECT value FROM probe_items ORDER BY id").all().map((row) => row.value), ["updated", "transaction"]);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("isolated handles have no attached schemas and cannot cross-read", () => {
  const paths = fixture();
  let core;
  let engine;
  try {
    engine = openEngineDbIsolated(paths);
    engine.exec("CREATE TABLE engine_only (value TEXT)");
    core = openCoreDbReadonly(paths);
    assertOnlyMain(core, paths.coreDbPath);
    assertOnlyMain(engine, paths.engineDbPath);
    assertNoSuchTable(() => engine.prepare("SELECT * FROM chunks").all());
    assertNoSuchTable(() => core.prepare("SELECT * FROM engine_only").all());
  } finally {
    if (core?.open) core.close();
    if (engine?.open) engine.close();
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("session reuses distinct handles, fixes paths, and closes on sync and async exits", async () => {
  const paths = fixture();
  const other = fixture();
  try {
    const session = createIsolatedDbSession(paths);
    let coreOne;
    let coreTwo;
    let engineOne;
    let engineTwo;
    withCoreDbReadonly((db) => { coreOne = db; }, { ...paths, session });
    withCoreDbReadonly((db) => { coreTwo = db; }, { session });
    withEngineDbIsolated((db) => { engineOne = db; }, { ...paths, session });
    withEngineDbIsolated((db) => { engineTwo = db; }, { session });
    assert.equal(coreOne, coreTwo);
    assert.equal(engineOne, engineTwo);
    assert.notEqual(coreOne, engineOne);
    assert.throws(() => withCoreDbReadonly(() => {}, { ...other, session }), /path cannot change/i);
    closeIsolatedDbSession(session);
    assert.throws(() => withCoreDbReadonly(() => {}, { session }), /already closed/i);
    assert.throws(() => coreOne.prepare("SELECT 1").get(), /closed|not open/i);
    assert.throws(() => engineOne.prepare("SELECT 1").get(), /closed|not open/i);

    let syncHandle;
    assert.throws(() => withIsolatedDbSession((scoped) => {
      withCoreDbReadonly((db) => { syncHandle = db; }, { session: scoped, ...paths });
      throw new Error("sync failure");
    }, paths), /sync failure/);
    assert.throws(() => syncHandle.prepare("SELECT 1").get(), /closed|not open/i);

    let resolvedHandle;
    const resolved = await withIsolatedDbSession(async (scoped) => {
      await withCoreDbReadonly(async (db) => {
        resolvedHandle = db;
        return Promise.resolve();
      }, { session: scoped, ...paths });
      return "resolved";
    }, paths);
    assert.equal(resolved, "resolved");
    assert.throws(() => resolvedHandle.prepare("SELECT 1").get(), /closed|not open/i);

    let asyncHandle;
    await assert.rejects(withIsolatedDbSession(async (scoped) => {
      await withEngineDbIsolated(async (db) => {
        asyncHandle = db;
        return Promise.resolve();
      }, { session: scoped, ...paths });
      throw new Error("async failure");
    }, paths), /async failure/);
    assert.throws(() => asyncHandle.prepare("SELECT 1").get(), /closed|not open/i);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
    rmSync(other.root, { recursive: true, force: true });
  }
});

test("readonly Engine mode requires an existing database and does not create directories", () => {
  const paths = fixture();
  const missing = { ...paths, engineDbPath: join(paths.root, "missing", "engine.sqlite") };
  let created;
  let db;
  try {
    assert.throws(() => openEngineDbIsolated({ ...missing, readonly: true }), /unable to open|cannot open|not exist/i);
    assert.equal(existsSync(join(paths.root, "missing")), false);
    assert.equal(existsSync(missing.engineDbPath), false);
    created = openEngineDbIsolated(paths);
    created.close();
    db = openEngineDbIsolated({ ...paths, readonly: true });
    assertOnlyMain(db, paths.engineDbPath);
  } finally {
    if (created?.open) created.close();
    if (db?.open) db.close();
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("exact and normalized Core/Engine path collisions fail before any Engine directory or sidecar is created", () => {
  const paths = fixture();
  const normalizedAlias = join(paths.root, "missing", "..", "core.sqlite");
  const engineDir = join(paths.root, "missing");
  try {
    assert.throws(() => openEngineDbIsolated({ ...paths, engineDbPath: paths.coreDbPath }), /different physical files/);
    assert.throws(() => openEngineDbIsolated({ ...paths, engineDbPath: normalizedAlias }), /different physical files/);
    assert.throws(() => openCoreDbReadonly({ ...paths, engineDbPath: paths.coreDbPath }), /different physical files/);
    assert.equal(existsSync(engineDir), false);
    assert.equal(existsSync(`${paths.coreDbPath}-wal`), false);
    assert.equal(existsSync(`${paths.coreDbPath}-shm`), false);

    const check = new Database(paths.coreDbPath, { readonly: true, fileMustExist: true });
    try {
      assert.equal(check.prepare("SELECT text FROM chunks WHERE id = 'chunk-1'").get()?.text, "original");
    } finally {
      check.close();
    }
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("symlink aliases fail closed", () => {
  const paths = fixture();
  const alias = join(paths.root, "engine-symlink.sqlite");
  try {
    symlinkSync(paths.coreDbPath, alias);
    assert.throws(() => openEngineDbIsolated({ ...paths, engineDbPath: alias }), /different physical files/);
    assert.equal(existsSync(`${alias}-wal`), false);
    assert.equal(existsSync(`${alias}-shm`), false);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("hard-link aliases fail closed when supported", (t) => {
  const paths = fixture();
  const alias = join(paths.root, "engine-hardlink.sqlite");
  try {
    try {
      linkSync(paths.coreDbPath, alias);
    } catch (error) {
      t.skip(`hard links unavailable: ${error.code || error.message}`);
      return;
    }
    assert.throws(() => openEngineDbIsolated({ ...paths, engineDbPath: alias }), /different physical files/);
    assert.equal(existsSync(`${alias}-wal`), false);
    assert.equal(existsSync(`${alias}-shm`), false);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("session rejects Core/Engine aliases during creation", () => {
  const paths = fixture();
  const alias = join(paths.root, "engine-symlink.sqlite");
  try {
    symlinkSync(paths.coreDbPath, alias);
    assert.throws(() => createIsolatedDbSession({ ...paths, engineDbPath: alias }), /different physical files/);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});
