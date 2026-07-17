import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  withCoreDbReadonly,
  withEngineDbIsolated,
} from "../lib/db/isolated-dbs.js";
import {
  createBackfillConfidenceForIndexedChunks,
  createIndexSyncRuntime,
} from "../lib/index-sync-runtime.js";

const BATCH_SIZE = 500;

function createDbFixture({ coreRows = [], confidenceRows = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-index-sync-"));
  const coreDbPath = join(root, "core.sqlite");
  const engineDbPath = join(root, "engine.sqlite");
  const core = new Database(coreDbPath);
  core.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      text TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  const insertCore = core.prepare(
    "INSERT INTO chunks (id, path, text, updated_at) VALUES (?, ?, ?, ?)",
  );
  for (const row of coreRows) insertCore.run(row.id, row.path, row.text, row.updated_at);
  core.close();

  const engine = new Database(engineDbPath);
  engine.exec(`
    CREATE TABLE memory_confidence (
      chunk_id TEXT PRIMARY KEY,
      initial_confidence REAL NOT NULL DEFAULT 0.5,
      confidence REAL NOT NULL DEFAULT 0.5,
      last_confidence_update INTEGER,
      base_tau REAL NOT NULL DEFAULT 7,
      hit_count INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      is_protected INTEGER NOT NULL DEFAULT 0,
      conflict_flag INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'raw_log',
      kg_data TEXT
    )
  `);
  const insertConfidence = engine.prepare(`
    INSERT INTO memory_confidence
      (chunk_id, initial_confidence, confidence, last_confidence_update,
       base_tau, hit_count, is_archived, is_protected, conflict_flag, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of confidenceRows) {
    insertConfidence.run(
      row.chunk_id,
      row.initial_confidence ?? 0.8,
      row.confidence ?? 0.8,
      row.last_confidence_update ?? 1,
      row.base_tau ?? 7,
      row.hit_count ?? 0,
      row.is_archived ?? 0,
      row.is_protected ?? 0,
      row.conflict_flag ?? 0,
      row.category ?? "raw_log",
    );
  }
  engine.close();

  const withCoreDb = fn => withCoreDbReadonly(fn, { coreDbPath, engineDbPath });
  const withEngineDb = fn => withEngineDbIsolated(fn, {
    coreDbPath,
    engineDbPath,
    readonly: false,
  });
  return { root, coreDbPath, engineDbPath, withCoreDb, withEngineDb };
}

function closeFixture(fixture) {
  rmSync(fixture.root, { recursive: true, force: true });
}

function createBackfill(fixture, overrides = {}) {
  return createBackfillConfidenceForIndexedChunks({
    catParams: () => ({ conf: 0.5, tau: 7 }),
    inferCategoryFromChunk: (_path, text) => text === "unknown" ? "raw_log" : "episodic",
    withCoreDb: fixture.withCoreDb,
    withEngineDb: fixture.withEngineDb,
    ...overrides,
  });
}

function createRuntime({ fixture, backfill, collectIndexedFiles, readIndexedPathState, manager }) {
  return createIndexSyncRuntime({
    memoryRoot: "/workspace",
    watchDirs: ["memory/smart-add", "memory/episodes"],
    withCoreDb: fixture.withCoreDb,
    withEngineDb: fixture.withEngineDb,
    getSharedMemoryManager: async () => ({ manager }),
    collectIndexedFiles,
    readIndexedPathState,
    backfillConfidenceForIndexedChunks: backfill,
  });
}

test("backfill inserts one missing managed chunk with the legacy field contract", () => {
  const fixture = createDbFixture({
    coreRows: [{ id: "chunk-1", path: "memory/smart-add/2026-06-08.md", text: "body", updated_at: 10 }],
  });
  try {
    const result = createBackfill(fixture)(123);
    assert.deepEqual(result, { scanned: 1, inserted: 1 });
    fixture.withCoreDb(db => {
      assert.deepEqual(db.prepare("PRAGMA database_list").all().map(row => row.name), ["main"]);
      assert.throws(
        () => db.prepare("INSERT INTO chunks (id, path, text, updated_at) VALUES ('blocked', 'memory/smart-add/a.md', 'x', 1)").run(),
        error => error?.code === "SQLITE_READONLY",
      );
    });
    fixture.withEngineDb(db => {
      assert.deepEqual(db.prepare("PRAGMA database_list").all().map(row => row.name), ["main"]);
      db.prepare("INSERT INTO memory_confidence (chunk_id) VALUES ('engine-write')").run();
      const row = db.prepare("SELECT * FROM memory_confidence WHERE chunk_id = ?").get("chunk-1");
      assert.deepEqual({
        chunk_id: row.chunk_id,
        initial_confidence: row.initial_confidence,
        confidence: row.confidence,
        last_confidence_update: row.last_confidence_update,
        base_tau: row.base_tau,
        hit_count: row.hit_count,
        is_archived: row.is_archived,
        is_protected: row.is_protected,
        conflict_flag: row.conflict_flag,
        category: row.category,
      }, {
        chunk_id: "chunk-1",
        initial_confidence: 0.5,
        confidence: 0.5,
        last_confidence_update: 123,
        base_tau: 7,
        hit_count: 0,
        is_archived: 0,
        is_protected: 0,
        conflict_flag: 0,
        category: "episodic",
      });
    });
  } finally {
    closeFixture(fixture);
  }
});

test("existing confidence rows are excluded regardless of archive, conflict, or category state", () => {
  const fixture = createDbFixture({
    coreRows: [{ id: "chunk-1", path: "memory/smart-add/a.md", text: "body", updated_at: 10 }],
    confidenceRows: [{
      chunk_id: "chunk-1",
      confidence: 0.91,
      is_archived: 1,
      conflict_flag: 1,
      category: "preference",
    }],
  });
  try {
    assert.deepEqual(createBackfill(fixture)(123), { scanned: 0, inserted: 0 });
    fixture.withEngineDb(db => {
      assert.deepEqual(db.prepare("SELECT confidence, is_archived, conflict_flag, category FROM memory_confidence").get(), {
        confidence: 0.91,
        is_archived: 1,
        conflict_flag: 1,
        category: "preference",
      });
    });
  } finally {
    closeFixture(fixture);
  }
});

test("only smart-add and episode paths participate, with unknown category fallback", () => {
  const fixture = createDbFixture({
    coreRows: [
      { id: "smart", path: "memory/smart-add/a.md", text: "unknown", updated_at: 3 },
      { id: "episode", path: "memory/episodes/a.md", text: "known", updated_at: 2 },
      { id: "memory", path: "memory.md", text: "unknown", updated_at: 5 },
      { id: "dream", path: "memory/dreaming/a.md", text: "unknown", updated_at: 4 },
      { id: "other", path: "docs/a.md", text: "unknown", updated_at: 1 },
    ],
  });
  try {
    assert.deepEqual(createBackfill(fixture)(123), { scanned: 2, inserted: 2 });
    fixture.withEngineDb(db => {
      assert.deepEqual(db.prepare("SELECT chunk_id, category FROM memory_confidence ORDER BY chunk_id").all(), [
        { chunk_id: "episode", category: "episodic" },
        { chunk_id: "smart", category: "raw_log" },
      ]);
    });
  } finally {
    closeFixture(fixture);
  }
});

test("applies LIMIT 500 after global Engine existence filtering", () => {
  const coreRows = [];
  const confidenceRows = [];
  for (let i = 0; i < 500; i += 1) {
    coreRows.push({ id: `existing-${i}`, path: "memory/smart-add/a.md", text: "known", updated_at: 2000 - i });
    confidenceRows.push({ chunk_id: `existing-${i}` });
  }
  for (let i = 0; i < 501; i += 1) {
    coreRows.push({ id: `missing-${i}`, path: "memory/smart-add/a.md", text: "known", updated_at: 1500 - i });
  }
  const fixture = createDbFixture({ coreRows, confidenceRows });
  try {
    assert.deepEqual(createBackfill(fixture)(123), { scanned: 500, inserted: 500 });
    fixture.withEngineDb(db => {
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM memory_confidence WHERE chunk_id LIKE 'missing-%'").get().count, 500);
      assert.equal(db.prepare("SELECT 1 FROM memory_confidence WHERE chunk_id = 'missing-500'").get(), undefined);
    });
  } finally {
    closeFixture(fixture);
  }
});

test("batches Engine existence reads globally and preserves Core order", () => {
  const coreRows = Array.from({ length: 700 }, (_, i) => ({
    id: `chunk-${String(i).padStart(3, "0")}`,
    path: "memory/episodes/a.md",
    text: "known",
    updated_at: 2000 - i,
  }));
  const fixture = createDbFixture({
    coreRows,
    confidenceRows: [0, 500, 699].map(i => ({ chunk_id: coreRows[i].id })),
  });
  try {
    const result = createBackfill(fixture)(123);
    assert.deepEqual(result, { scanned: 500, inserted: 500 });
    fixture.withEngineDb(db => {
      const inserted = db.prepare("SELECT chunk_id FROM memory_confidence WHERE last_confidence_update = 123").all();
      assert.deepEqual(inserted.map(row => row.chunk_id), coreRows
        .filter((_, i) => ![0, 500, 699].includes(i))
        .slice(0, 500)
        .map(row => row.id));
    });
  } finally {
    closeFixture(fixture);
  }
});

test("text IDs with numeric-looking values are matched without string normalization", () => {
  const fixture = createDbFixture({
    coreRows: [
      { id: "1", path: "memory/smart-add/a.md", text: "known", updated_at: 3 },
      { id: "001", path: "memory/smart-add/a.md", text: "known", updated_at: 2 },
      { id: "0001", path: "memory/smart-add/a.md", text: "known", updated_at: 1 },
    ],
    confidenceRows: [{ chunk_id: "1" }],
  });
  try {
    assert.deepEqual(createBackfill(fixture)(123), { scanned: 2, inserted: 2 });
    fixture.withEngineDb(db => {
      assert.deepEqual(db.prepare("SELECT chunk_id FROM memory_confidence ORDER BY chunk_id").all(), [
        { chunk_id: "0001" },
        { chunk_id: "001" },
        { chunk_id: "1" },
      ]);
    });
  } finally {
    closeFixture(fixture);
  }
});

test("same Core and Engine paths are rejected before backfill", () => {
  const fixture = createDbFixture({
    coreRows: [{ id: "chunk-1", path: "memory/smart-add/a.md", text: "known", updated_at: 1 }],
  });
  try {
    const sameFile = createBackfillConfidenceForIndexedChunks({
      catParams: () => ({ conf: 0.5, tau: 7 }),
      inferCategoryFromChunk: () => "raw_log",
      withCoreDb: fn => withCoreDbReadonly(fn, {
        coreDbPath: fixture.engineDbPath,
        engineDbPath: fixture.engineDbPath,
      }),
      withEngineDb: fixture.withEngineDb,
    });
    assert.throws(() => sameFile(123), /different physical files/);
  } finally {
    closeFixture(fixture);
  }
});

test("backfill is idempotent after the first insert", () => {
  const fixture = createDbFixture({
    coreRows: [{ id: "chunk-1", path: "memory/smart-add/a.md", text: "known", updated_at: 1 }],
  });
  try {
    const backfill = createBackfill(fixture);
    assert.deepEqual(backfill(123), { scanned: 1, inserted: 1 });
    assert.deepEqual(backfill(456), { scanned: 0, inserted: 0 });
  } finally {
    closeFixture(fixture);
  }
});

test("concurrent backfills remain safe through INSERT OR IGNORE", async () => {
  const fixture = createDbFixture({
    coreRows: [{ id: "chunk-1", path: "memory/smart-add/a.md", text: "known", updated_at: 1 }],
  });
  try {
    const [first, second] = await Promise.all([
      Promise.resolve().then(() => createBackfill(fixture)(123)),
      Promise.resolve().then(() => createBackfill(fixture)(123)),
    ]);
    assert.equal(first.inserted + second.inserted, 1);
    fixture.withEngineDb(db => {
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM memory_confidence WHERE chunk_id = 'chunk-1'").get().count, 1);
    });
  } finally {
    closeFixture(fixture);
  }
});

test("Core is closed before the writable Engine phase", () => {
  const fixture = createDbFixture({
    coreRows: [{ id: "chunk-1", path: "memory/smart-add/a.md", text: "known", updated_at: 1 }],
  });
  const events = [];
  try {
    const backfill = createBackfill(fixture, {
      withCoreDb: fn => fixture.withCoreDb(db => {
        events.push("core-open");
        const result = fn(db);
        events.push("core-closed");
        return result;
      }),
      withEngineDb: fn => fixture.withEngineDb(db => {
        events.push("engine-open");
        const result = fn(db);
        events.push("engine-closed");
        return result;
      }),
    });
    backfill(123);
    assert.deepEqual(events, ["core-open", "core-closed", "engine-open", "engine-closed"]);
  } finally {
    closeFixture(fixture);
  }
});

test("Core missing fails before the writable Engine file is created", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-index-sync-missing-core-"));
  const fixture = {
    root,
    coreDbPath: join(root, "missing-core.sqlite"),
    engineDbPath: join(root, "engine.sqlite"),
  };
  try {
    const runtime = createRuntime({
      fixture: {
        ...fixture,
        withCoreDb: fn => withCoreDbReadonly(fn, fixture),
        withEngineDb: fn => withEngineDbIsolated(fn, { ...fixture, readonly: false }),
      },
      backfill: () => ({ scanned: 0, inserted: 0 }),
      collectIndexedFiles: () => [],
      readIndexedPathState: () => ({ paths: [], updatedAt: {} }),
      manager: null,
    });
    await assert.rejects(runtime("test"), /unable to open|not found|no such file/i);
    assert.equal(existsSync(fixture.engineDbPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Engine schema is not initialized by index sync", async () => {
  const fixture = createDbFixture({
    coreRows: [{ id: "chunk-1", path: "memory/smart-add/a.md", text: "known", updated_at: 1 }],
  });
  const emptyEngine = new Database(fixture.engineDbPath);
  emptyEngine.exec("DROP TABLE memory_confidence");
  emptyEngine.close();
  try {
    const runtime = createRuntime({
      fixture,
      backfill: createBackfill(fixture),
      collectIndexedFiles: () => [],
      readIndexedPathState: () => ({ paths: [], updatedAt: {} }),
      manager: null,
    });
    await assert.rejects(runtime("test"), /no such table/i);
    const check = new Database(fixture.engineDbPath, { readonly: true, fileMustExist: true });
    try {
      assert.equal(check.prepare("SELECT name FROM sqlite_master WHERE name = 'memory_confidence'").get(), undefined);
    } finally {
      check.close();
    }
  } finally {
    closeFixture(fixture);
  }
});

test("missing writable Engine file may be created but schema is not initialized", () => {
  const fixture = createDbFixture({
    coreRows: [{ id: "chunk-1", path: "memory/smart-add/a.md", text: "known", updated_at: 1 }],
  });
  rmSync(fixture.engineDbPath, { force: true });
  try {
    assert.throws(createBackfill(fixture).bind(null, 123), /no such table/);
    assert.equal(existsSync(fixture.engineDbPath), true);
    const check = new Database(fixture.engineDbPath, { readonly: true, fileMustExist: true });
    try {
      assert.equal(check.prepare("SELECT name FROM sqlite_master WHERE name = 'memory_confidence'").get(), undefined);
    } finally {
      check.close();
    }
  } finally {
    closeFixture(fixture);
  }
});

test("initial manager failure keeps the existing retry state behavior", async () => {
  let managerCalls = 0;
  const fixture = createDbFixture();
  try {
    const runtime = createRuntime({
      fixture,
      manager: {
        status() {
          return { dirty: false };
        },
        async sync() {
          managerCalls += 1;
          if (managerCalls === 1) throw new Error("manager unavailable");
        },
      },
      collectIndexedFiles: () => [{ relPath: "memory/smart-add/a.md", mtimeMs: 100 }],
      readIndexedPathState: (_db, paths) => ({ paths: [...paths], updatedAt: {} }),
      backfill: () => ({ scanned: 0, inserted: 0 }),
    });
    const first = await runtime("first");
    const second = await runtime("second");
    assert.equal(first.synced, false);
    assert.equal(first.reason, "manager_unavailable");
    assert.equal(second.synced, true);
    assert.equal(second.reason, "second");
    assert.equal(managerCalls, 2);
  } finally {
    closeFixture(fixture);
  }
});

test("createIndexSyncRuntime preserves manager success and fresh scheduling", async () => {
  let syncCalls = 0;
  const fixture = createDbFixture();
  try {
    const runtime = createRuntime({
      fixture,
      manager: {
        status() {
          return { dirty: false };
        },
        async sync() {
          syncCalls += 1;
        },
      },
      collectIndexedFiles: () => [{ relPath: "memory/smart-add/a.md", mtimeMs: 100 }],
      readIndexedPathState: (_db, paths) => ({
        paths: [...paths],
        updatedAt: Object.fromEntries(paths.map(path => [path, 1])),
      }),
      backfill: () => ({ scanned: 0, inserted: 0 }),
    });
    const originalGetManager = runtime;
    assert.equal(typeof originalGetManager, "function");
    const first = await runtime("test");
    const second = await runtime("test");
    assert.equal(first.reason, "test");
    assert.equal(first.synced, true);
    assert.equal(second.reason, "fresh");
    assert.equal(second.synced, false);
    assert.equal(syncCalls, 1);
  } finally {
    closeFixture(fixture);
  }
});

test("index sync production source has no legacy attached database dependency", async () => {
  const source = await import("node:fs").then(({ readFileSync }) => readFileSync(
    new URL("../lib/index-sync-runtime.js", import.meta.url),
    "utf8",
  ));
  assert.doesNotMatch(source, /\bwithDb\b|ATTACH DATABASE|DETACH DATABASE|patchWriteGuards|\bcore\./);
  assert.match(source, /withCoreDb/);
  assert.match(source, /withEngineDb/);
});
