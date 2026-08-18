import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getCanonicalMemoriesByIds } from "../lib/canonical/read-adapter.js";

function coreRow(id, overrides = {}) {
  return {
    id,
    path: `memory/projects/${id}.md`,
    source: "memory",
    start_line: 1,
    end_line: 2,
    hash: `core-hash-${id}`,
    text: `full Core text for ${id}`,
    updated_at: 1780000000000,
    ...overrides,
  };
}

function engineRow(id, overrides = {}) {
  return {
    chunk_id: id,
    initial_confidence: 0.7,
    confidence: 0.8,
    last_confidence_update: 1780000000,
    base_tau: 30,
    hit_count: 3,
    is_archived: 0,
    is_protected: 0,
    conflict_flag: 0,
    category: "project",
    ...overrides,
  };
}

function createFixture({ coreRows = [], engineRows = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-canonical-batch-"));
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
        "implementation-only-model",
        row.text,
        "[0.1]",
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
        "engine-only-kg-data",
      );
    }
  } finally {
    core.close();
    engine.close();
  }
  return { root, coreDbPath, engineDbPath };
}

function openBatchHandles(fixture, { coreReadonly = true, engineReadonly = true } = {}) {
  const core = new Database(fixture.coreDbPath, { readonly: coreReadonly, fileMustExist: true });
  const engine = new Database(fixture.engineDbPath, { readonly: engineReadonly, fileMustExist: true });
  const coreSql = [];
  const engineSql = [];
  const coreHandle = {
    readonly: coreReadonly,
    prepare(sql) {
      coreSql.push(String(sql));
      return core.prepare(sql);
    },
  };
  const engineHandle = {
    readonly: engineReadonly,
    prepare(sql) {
      engineSql.push(String(sql));
      return engine.prepare(sql);
    },
  };
  return { core, engine, coreHandle, engineHandle, coreSql, engineSql };
}

function readBatch(fixture, ids, options = {}) {
  const handles = openBatchHandles(fixture, options);
  try {
    const result = getCanonicalMemoriesByIds(ids, {
      withCoreDb: run => run(handles.coreHandle),
      withEngineDb: run => run(handles.engineHandle),
    });
    return { result, handles };
  } finally {
    if (handles.core.open) handles.core.close();
    if (handles.engine.open) handles.engine.close();
  }
}

test("batch adapter dedupes SQL ids, preserves requested order, and returns managed/external objects", () => {
  const fixture = createFixture({
    coreRows: [coreRow("external-id"), coreRow("managed-id")],
    engineRows: [engineRow("managed-id")],
  });
  try {
    const { result, handles } = readBatch(fixture, ["external-id", "managed-id", "external-id"]);

    assert.equal(result.ok, true);
    assert.deepEqual(result.results.map(item => item.memory_id), ["external-id", "managed-id", "external-id"]);
    assert.equal(result.results[0].memory.lifecycle.management, "external");
    assert.equal(result.results[0].memory.lifecycle.confidence, null);
    assert.equal(result.results[1].memory.lifecycle.management, "managed");
    assert.equal(result.results[1].memory.lifecycle.hit_count, 3);
    assert.equal(handles.coreSql.filter(sql => sql.includes("FROM chunks WHERE id IN")).length, 1);
    assert.equal(handles.engineSql.filter(sql => sql.includes("FROM memory_confidence WHERE chunk_id IN")).length, 1);
    assert.equal(handles.coreSql.find(sql => sql.includes("FROM chunks WHERE id IN")).includes("?, ?"), true);
    assert.equal(handles.coreSql.some(sql => /\bmodel\b|\bembedding\b/i.test(sql)), false);
    assert.equal(handles.engineSql.some(sql => /kg_data|JOIN|ATTACH/i.test(sql)), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("batch adapter isolates per-id failures without dropping healthy results", () => {
  const fixture = createFixture({
    coreRows: [
      coreRow("healthy"),
      coreRow("duplicate-core"),
      coreRow("duplicate-core"),
      coreRow("malformed-core", { text: null }),
      coreRow("duplicate-engine"),
      coreRow("malformed-engine"),
    ],
    engineRows: [
      engineRow("healthy"),
      engineRow("duplicate-engine"),
      engineRow("duplicate-engine"),
      engineRow("malformed-engine", { confidence: null }),
    ],
  });
  try {
    const { result } = readBatch(fixture, [
      "healthy",
      "missing",
      "duplicate-core",
      "malformed-core",
      "duplicate-engine",
      "malformed-engine",
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.results[0].ok, true);
    assert.deepEqual(result.results.slice(1).map(item => item.reason), [
      "core_not_found",
      "core_ambiguous",
      "core_malformed",
      "engine_ambiguous",
      "engine_malformed",
    ]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("batch adapter fails the whole batch for invalid isolated topology", () => {
  const fixture = createFixture({ coreRows: [coreRow("healthy")], engineRows: [engineRow("healthy")] });
  try {
    const { result } = readBatch(fixture, ["healthy"], { coreReadonly: false });
    assert.deepEqual(result, {
      ok: false,
      results: [],
      reason: "invalid_db_topology",
    });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
