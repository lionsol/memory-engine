import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getCanonicalMemoryById } from "../lib/canonical/read-adapter.js";

function createFixture({ coreRows = [], engineRows = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-canonical-adapter-"));
  const coreDbPath = join(root, "core.sqlite");
  const engineDbPath = join(root, "engine.sqlite");
  const core = new Database(coreDbPath);
  const engine = new Database(engineDbPath);
  try {
    core.exec(`
      CREATE TABLE chunks (
        id TEXT,
        path TEXT,
        source TEXT,
        start_line INTEGER,
        end_line INTEGER,
        hash TEXT,
        model TEXT,
        text TEXT,
        embedding TEXT,
        updated_at
      )
    `);
    engine.exec(`
      CREATE TABLE memory_confidence (
        chunk_id TEXT,
        initial_confidence REAL,
        confidence REAL,
        last_confidence_update INTEGER,
        base_tau REAL,
        hit_count INTEGER,
        is_archived INTEGER,
        is_protected INTEGER,
        conflict_flag INTEGER,
        category TEXT,
        kg_data TEXT
      )
    `);
    const insertCore = core.prepare(`
      INSERT INTO chunks
        (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of coreRows) {
      insertCore.run(
        row.id,
        row.path,
        row.source,
        row.start_line,
        row.end_line,
        row.hash,
        row.model ?? "model-not-canonical",
        row.text,
        row.embedding ?? "[0.1]",
        row.updated_at,
      );
    }
    const insertEngine = engine.prepare(`
      INSERT INTO memory_confidence
        (chunk_id, initial_confidence, confidence, last_confidence_update,
         base_tau, hit_count, is_archived, is_protected, conflict_flag, category, kg_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of engineRows) {
      insertEngine.run(
        row.chunk_id,
        row.initial_confidence,
        row.confidence,
        row.last_confidence_update,
        row.base_tau,
        row.hit_count,
        row.is_archived,
        row.is_protected,
        row.conflict_flag,
        row.category,
        row.kg_data ?? "engine-only-data",
      );
    }
  } finally {
    core.close();
    engine.close();
  }
  return { root, coreDbPath, engineDbPath };
}

function coreRow(overrides = {}) {
  return {
    id: "core-1",
    path: "memory/projects/adapter.md",
    source: "memory",
    start_line: 1,
    end_line: 3,
    hash: "hash-core-1",
    text: "adapter fixture text",
    updated_at: 1780000000123,
    ...overrides,
  };
}

function engineRow(overrides = {}) {
  return {
    chunk_id: "core-1",
    initial_confidence: 0.7,
    confidence: 0.8,
    last_confidence_update: 1780000000,
    base_tau: 30,
    hit_count: 2,
    is_archived: 0,
    is_protected: 1,
    conflict_flag: 0,
    category: "project",
    ...overrides,
  };
}

function openHandles(fixture, { coreReadonly = true, engineReadonly = true } = {}) {
  return {
    core: new Database(fixture.coreDbPath, { readonly: coreReadonly, fileMustExist: true }),
    engine: new Database(fixture.engineDbPath, { readonly: engineReadonly, fileMustExist: true }),
  };
}

async function readFixture(fixture, id = "core-1", options = {}) {
  const handles = openHandles(fixture, options);
  try {
    return await getCanonicalMemoryById(id, {
      withCoreDb: run => run(options.coreHandle || handles.core),
      withEngineDb: run => run(options.engineHandle || handles.engine),
    });
  } finally {
    if (handles.core.open) handles.core.close();
    if (handles.engine.open) handles.engine.close();
  }
}

test("adapter reads a managed object through two readonly main-only handles", async () => {
  const fixture = createFixture({
    coreRows: [coreRow()],
    engineRows: [engineRow()],
  });
  try {
    const result = await readFixture(fixture);
    assert.equal(result.ok, true);
    assert.equal(result.memory.memory_id, "core-1");
    assert.equal(result.memory.lifecycle.management, "managed");
    assert.equal(result.memory.lifecycle.category, "project");
    assert.deepEqual(result.memory.source, {
      system: "openclaw_core",
      record_type: "chunk",
      record_id: "core-1",
      path: "memory/projects/adapter.md",
      core_source: "memory",
      line_start: 1,
      line_end: 3,
      text: "adapter fixture text",
      core_hash: "hash-core-1",
      updated_at: 1780000000123,
    });

    const handles = openHandles(fixture);
    try {
      assert.deepEqual(handles.core.prepare("PRAGMA database_list").all().map(row => row.name), ["main"]);
      assert.deepEqual(handles.engine.prepare("PRAGMA database_list").all().map(row => row.name), ["main"]);
    } finally {
      handles.core.close();
      handles.engine.close();
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("adapter returns a valid external object when Core has no Engine row", async () => {
  const fixture = createFixture({ coreRows: [coreRow()], engineRows: [] });
  try {
    const result = await readFixture(fixture);
    assert.equal(result.ok, true);
    assert.equal(result.memory.lifecycle.management, "external");
    assert.equal(result.memory.lifecycle.category, null);
    assert.equal(result.memory.lifecycle.confidence, null);
    assert.equal(result.memory.classification.category, "project");
    assert.equal(result.memory.classification.category_authority, "path_inference");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("adapter reports missing and ambiguous Core/Engine rows without synthesizing identity", async () => {
  const missing = createFixture({ coreRows: [coreRow()] });
  try {
    assert.deepEqual(await readFixture(missing, "does-not-exist"), {
      ok: false,
      memory: null,
      reason: "core_not_found",
    });
  } finally {
    rmSync(missing.root, { recursive: true, force: true });
  }

  const duplicateCore = createFixture({ coreRows: [coreRow(), coreRow()] });
  try {
    assert.deepEqual(await readFixture(duplicateCore), {
      ok: false,
      memory: null,
      reason: "core_ambiguous",
    });
  } finally {
    rmSync(duplicateCore.root, { recursive: true, force: true });
  }

  const duplicateEngine = createFixture({
    coreRows: [coreRow()],
    engineRows: [engineRow(), engineRow()],
  });
  try {
    assert.deepEqual(await readFixture(duplicateEngine), {
      ok: false,
      memory: null,
      reason: "engine_ambiguous",
    });
  } finally {
    rmSync(duplicateEngine.root, { recursive: true, force: true });
  }
});

test("adapter rejects invalid ids and writable Core or Engine handles", async () => {
  const fixture = createFixture({ coreRows: [coreRow()], engineRows: [engineRow()] });
  try {
    assert.deepEqual(await getCanonicalMemoryById("", {}), {
      ok: false,
      memory: null,
      reason: "invalid_memory_id",
    });
    assert.deepEqual(await readFixture(fixture, "core-1", { engineReadonly: false }), {
      ok: false,
      memory: null,
      reason: "invalid_db_topology",
    });
    assert.deepEqual(await readFixture(fixture, "core-1", { coreReadonly: false }), {
      ok: false,
      memory: null,
      reason: "invalid_db_topology",
    });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("adapter rejects an attached persistent database even when wrapper claims readonly", async () => {
  const fixture = createFixture({ coreRows: [coreRow()], engineRows: [engineRow()] });
  const extraPath = join(fixture.root, "extra.sqlite");
  const extra = new Database(extraPath);
  const core = new Database(fixture.coreDbPath, { readonly: true, fileMustExist: true });
  const engine = new Database(fixture.engineDbPath);
  try {
    extra.exec("CREATE TABLE extra_only (value TEXT)");
    engine.exec("ATTACH DATABASE ? AS extra", [extraPath]);
    const readonlyFacade = {
      readonly: true,
      prepare: engine.prepare.bind(engine),
    };
    const result = await getCanonicalMemoryById("core-1", {
      withCoreDb: run => run(core),
      withEngineDb: run => run(readonlyFacade),
    });
    assert.deepEqual(result, {
      ok: false,
      memory: null,
      reason: "invalid_db_topology",
    });
  } finally {
    if (core.open) core.close();
    if (engine.open) engine.close();
    if (extra.open) extra.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("adapter does not mutate source database rows or use a combined topology", async () => {
  const fixture = createFixture({ coreRows: [coreRow()], engineRows: [engineRow()] });
  let beforeCore;
  let beforeEngine;
  try {
    const core = new Database(fixture.coreDbPath);
    const engine = new Database(fixture.engineDbPath);
    try {
      beforeCore = core.prepare("SELECT * FROM chunks").all();
      beforeEngine = engine.prepare("SELECT * FROM memory_confidence").all();
    } finally {
      core.close();
      engine.close();
    }

    const result = await readFixture(fixture);
    assert.equal(result.ok, true);

    const afterCoreDb = new Database(fixture.coreDbPath, { readonly: true, fileMustExist: true });
    const afterEngineDb = new Database(fixture.engineDbPath, { readonly: true, fileMustExist: true });
    try {
      assert.deepEqual(afterCoreDb.prepare("SELECT * FROM chunks").all(), beforeCore);
      assert.deepEqual(afterEngineDb.prepare("SELECT * FROM memory_confidence").all(), beforeEngine);
      assert.deepEqual(afterCoreDb.prepare("PRAGMA database_list").all().map(row => row.name), ["main"]);
      assert.deepEqual(afterEngineDb.prepare("PRAGMA database_list").all().map(row => row.name), ["main"]);
    } finally {
      afterCoreDb.close();
      afterEngineDb.close();
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
