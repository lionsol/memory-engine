import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";

import { withCoreDbReadonly, withEngineDbIsolated } from "../lib/db/isolated-dbs.js";
import { createMemoryEngineExecute } from "../lib/tools/memory-engine-actions.js";

function createFixture({ coreRows, engineRows = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-canonical-writers-"));
  const workspaceDir = join(root, "workspace");
  const coreDbPath = join(root, "core.sqlite");
  const engineDbPath = join(root, "engine.sqlite");
  mkdirSync(workspaceDir, { recursive: true });

  const core = new Database(coreDbPath);
  core.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT,
      text TEXT,
      updated_at INTEGER
    )
  `);
  const insertCore = core.prepare(`
    INSERT INTO chunks
      (id, path, source, start_line, end_line, hash, text, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of coreRows) {
    insertCore.run(
      row.id,
      row.path,
      row.source ?? row.path,
      row.start_line ?? 1,
      row.end_line ?? 1,
      row.hash ?? null,
      row.text,
      row.updated_at ?? 1,
    );
  }
  core.close();

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
    )
  `);
  const insertEngine = engine.prepare(`
    INSERT INTO memory_confidence
      (chunk_id, initial_confidence, confidence, last_confidence_update,
       base_tau, hit_count, is_archived, is_protected, conflict_flag, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of engineRows) {
    insertEngine.run(
      row.chunk_id,
      row.initial_confidence ?? 0.5,
      row.confidence ?? 0.5,
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

  return {
    root,
    workspaceDir,
    coreDbPath,
    engineDbPath,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function createActionRuntime(fixture, overrides = {}) {
  const accessorOptions = {
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  };
  const accessorCalls = { core: 0, engineWritable: 0, engineReadonly: 0 };
  const tableRows = [];
  const embeddingInputs = [];
  const runtime = {
    api: { config: {} },
    autoRouteCategory: () => "raw_log",
    dateStrInTimeZone: () => "2026-08-18",
    SMART_ADD_TIME_ZONE: "Asia/Shanghai",
    resolve: posix.resolve,
    WORKSPACE: fixture.workspaceDir,
    SMART_ADD_DIR: "memory/smart-add",
    buildSmartAddFingerprint: () => "fingerprint",
    appendSmartAdd: async () => ({ appended: true, sync: { synced: true } }),
    syncIndexIfNeeded: async () => ({ synced: true }),
    catParams: () => ({ conf: 0.5, tau: 7 }),
    withDb: () => {
      throw new Error("combined DB accessor must not be used");
    },
    withCoreDb: fn => {
      accessorCalls.core += 1;
      return withCoreDbReadonly(fn, accessorOptions);
    },
    withEngineDb: fn => {
      accessorCalls.engineWritable += 1;
      return withEngineDbIsolated(fn, { ...accessorOptions, readonly: false });
    },
    withEngineDbReadonly: fn => {
      accessorCalls.engineReadonly += 1;
      return withEngineDbIsolated(fn, { ...accessorOptions, readonly: true });
    },
    getLancedbTable: () => ({
      add: async rows => tableRows.push(...rows),
    }),
    generateEmbedding: async text => {
      embeddingInputs.push(text);
      return [0.11, 0.22, 0.33];
    },
    now: () => 1780000000000,
    recordMemoryEvent: () => {},
    getMemorySearchManager: async () => ({ manager: null }),
    calcRealtimeConf: () => 0,
    existsSync: () => false,
    readFileSync: () => "",
    KG_PATH: join(fixture.workspaceDir, "knowledge-graph.json"),
    resolvePrefixes: () => [],
    batchReinforce: () => 0,
    CATEGORY_MAP: {},
    calcTau: () => 0,
    ...overrides,
  };
  return { runtime, accessorCalls, tableRows, embeddingInputs };
}

function readEngineRows(fixture) {
  const db = new Database(fixture.engineDbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare("SELECT * FROM memory_confidence ORDER BY chunk_id").all();
  } finally {
    db.close();
  }
}

test("memory_engine.add uses exact Core canonical text for both embedding and Lance row", async () => {
  const id = `exact-core-${"x".repeat(48)}`;
  const rawInput = `RAW SOURCE INPUT ${"A".repeat(2500)}`;
  const coreText = `CANONICAL CORE CHUNK ${"B".repeat(2500)}`;
  const fixture = createFixture({
    coreRows: [{
      id,
      path: "memory/smart-add/2026-08-18.md",
      text: coreText,
      start_line: 1,
      end_line: 3,
      updated_at: 17,
    }],
  });

  try {
    const harness = createActionRuntime(fixture);
    const execute = createMemoryEngineExecute(harness.runtime);
    const result = await execute("canonical-add", { action: "add", text: rawInput });

    assert.equal(result.lance_written, 1);
    assert.equal(result.vector_error, null);
    assert.deepEqual(harness.embeddingInputs, [coreText.slice(0, 2000)]);
    assert.equal(harness.embeddingInputs[0], harness.tableRows[0].text);
    assert.notEqual(harness.embeddingInputs[0], rawInput.slice(0, 2000));
    assert.equal(harness.tableRows[0].id, id);
    assert.deepEqual(Object.keys(harness.tableRows[0]).sort(), ["id", "text", "timestamp", "vector"]);
    assert.equal(harness.tableRows[0].timestamp, 1780000000000);
    assert.equal(harness.accessorCalls.engineWritable > 0, true);
    assert.equal(harness.accessorCalls.engineReadonly > 0, true);
    assert.equal(harness.accessorCalls.core > 0, true);
    assert.equal(readEngineRows(fixture).length, 1);
  } finally {
    fixture.cleanup();
  }
});

test("memory_engine.add fails closed on canonical lookup without a Lance fallback", async () => {
  const id = "canonical-failure-id";
  const fixture = createFixture({
    coreRows: [{ id, path: "memory/smart-add/2026-08-18.md", text: "core text" }],
  });
  let embeddingCalls = 0;
  try {
    const harness = createActionRuntime(fixture, {
      getCanonicalMemoryById: () => ({ ok: false, memory: null, reason: "core_not_found" }),
      generateEmbedding: async () => {
        embeddingCalls += 1;
        return [0.1];
      },
    });
    const execute = createMemoryEngineExecute(harness.runtime);
    const result = await execute("canonical-failure", { action: "add", text: "raw input" });

    assert.equal(result.lance_written, 0);
    assert.equal(result.vector_error, "canonical_lookup_core_not_found");
    assert.equal(result.needs_reconcile, true);
    assert.equal(result.derived_state, "partial");
    assert.equal(embeddingCalls, 0);
    assert.deepEqual(harness.tableRows, []);
    assert.equal(readEngineRows(fixture).length, 1);
  } finally {
    fixture.cleanup();
  }
});

test("memory_engine.add preserves one-direct-Lance-write behavior for multiple new Core chunks", async () => {
  const path = "memory/smart-add/2026-08-18.md";
  const fixture = createFixture({
    coreRows: [
      { id: "first-new-chunk", path, text: "first canonical text" },
      { id: "second-new-chunk", path, text: "second canonical text" },
    ],
  });

  try {
    const harness = createActionRuntime(fixture);
    const execute = createMemoryEngineExecute(harness.runtime);
    const result = await execute("one-direct-write", { action: "add", text: "raw add input" });

    assert.equal(result.chunks_added, 2);
    assert.equal(result.lance_written, 1);
    assert.deepEqual(harness.tableRows.map(row => row.id), ["first-new-chunk"]);
    assert.equal(readEngineRows(fixture).length, 2);
  } finally {
    fixture.cleanup();
  }
});

test("the three direct writers do not retain manual vector-row construction", () => {
  const addSource = readFileSync(new URL("../lib/tools/memory-engine-actions.js", import.meta.url), "utf8");
  const orphanSource = readFileSync(new URL("../lib/checkpoint/orphan-repair.js", import.meta.url), "utf8");

  assert.match(addSource, /getCanonicalMemoryById/);
  assert.match(addSource, /projectCanonicalMemoryToVectorProjection/);
  assert.match(addSource, /materializeCanonicalLanceRow/);
  assert.doesNotMatch(addSource, /generateEmbedding\(text\)/);
  assert.doesNotMatch(addSource, /text:\s*text\.slice\(0,\s*2000\)/);

  assert.match(orphanSource, /getCanonicalMemoriesByIds/);
  assert.match(orphanSource, /projectCanonicalMemoryToVectorProjection/);
  assert.match(orphanSource, /materializeCanonicalLanceRow/);
  assert.doesNotMatch(orphanSource, /SELECT text FROM chunks/);
  assert.doesNotMatch(orphanSource, /table\.add\(\[\{\s*id:/);
});
