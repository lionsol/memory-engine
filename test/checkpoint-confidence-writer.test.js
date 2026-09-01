import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkpoint = require("../bin/session-checkpoint.js");
const {
  CHECKPOINT_CHUNK_IDENTITY_AMBIGUOUS,
  CHECKPOINT_CORE_IDENTITY_UNAVAILABLE,
  CHECKPOINT_ENTRY_CATEGORY_MISMATCH,
  CHECKPOINT_ENTRY_IDENTITY_AMBIGUOUS,
  CHECKPOINT_ENTRY_IDENTITY_NOT_FOUND,
  writeConfidence,
} = require("../lib/checkpoint/confidence-writer.js");
const { parseCanonicalSmartAddBlocks } = require("../lib/checkpoint/smart-add-entry-identity.js");

const FILE_REL = "memory/generated-smart-add/2026-06-18.md";

function makeSource(entries = []) {
  const lines = ["# Smart Added Memory", ""];
  for (const entry of entries) {
    lines.push(
      `## ${entry.id}`,
      "",
      `Category: ${entry.category}`,
      `Provenance: ${entry.provenance || "checkpoint_generated"}`,
      "",
      ...(Array.isArray(entry.body) ? entry.body : [String(entry.body || "body")]),
      "",
    );
  }
  const content = `${lines.join("\n")}\n`;
  const blocks = parseCanonicalSmartAddBlocks(content);
  const ranges = Object.fromEntries(blocks.map(block => [block.entryId, {
    startLine: block.startLine,
    endLine: block.endLine,
  }]));
  return { content, blocks, ranges };
}

function createEngineSchema(db) {
  db.exec(`
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
}

function createFixture({
  fileRel = FILE_REL,
  sourceContent,
  coreRows = [],
  engineRows = null,
} = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-checkpoint-confidence-"));
  const workspaceDir = resolve(root, "workspace");
  const coreDbPath = resolve(root, "core.sqlite");
  const engineDbPath = resolve(root, "engine.sqlite");
  const sourcePath = resolve(workspaceDir, fileRel);
  mkdirSync(resolve(sourcePath, ".."), { recursive: true });
  if (sourceContent !== undefined) writeFileSync(sourcePath, sourceContent);

  const coreDb = new Database(coreDbPath);
  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        text TEXT,
        updated_at INTEGER,
        start_line INTEGER,
        end_line INTEGER
      )
    `);
    const insert = coreDb.prepare(
      "INSERT INTO chunks (id, path, text, updated_at, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const row of coreRows) {
      insert.run(
        row.id,
        row.path || fileRel,
        row.text || "fixture chunk",
        row.updated_at ?? 1,
        row.start_line ?? null,
        row.end_line ?? null,
      );
    }
  } finally {
    coreDb.close();
  }

  if (Array.isArray(engineRows)) {
    const engineDb = new Database(engineDbPath);
    try {
      createEngineSchema(engineDb);
      const insert = engineDb.prepare(`
        INSERT INTO memory_confidence
          (chunk_id, initial_confidence, confidence, last_confidence_update,
           base_tau, hit_count, is_archived, is_protected, conflict_flag, category, kg_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const row of engineRows) {
        insert.run(
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
          row.kg_data ?? null,
        );
      }
    } finally {
      engineDb.close();
    }
  }

  return {
    root,
    workspaceDir,
    coreDbPath,
    engineDbPath,
    fileRel,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function runWriter(fixture, entryId, category, options = {}) {
  return checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    timeZone: "Asia/Shanghai",
    now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
  }, () => writeConfidence(entryId, "non-authoritative caller text", category, {
    fileRel: fixture.fileRel,
    nowSec: 1718678400,
    ...options,
  }));
}

function readConfidenceRows(engineDbPath) {
  if (!existsSync(engineDbPath)) return [];
  const db = new Database(engineDbPath, { readonly: true });
  try {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_confidence'").get();
    if (!table) return [];
    return db.prepare("SELECT * FROM memory_confidence ORDER BY chunk_id").all();
  } finally {
    db.close();
  }
}

function readCoreRows(coreDbPath) {
  const db = new Database(coreDbPath, { readonly: true });
  try {
    return db.prepare("SELECT * FROM chunks ORDER BY id").all();
  } finally {
    db.close();
  }
}

async function assertCode(code, fn) {
  await assert.rejects(fn, error => error?.code === code && error.message === code);
}

for (const [category, conf, tau] of [
  ["preference", 0.8, 90.0],
  ["episodic", 0.7, 30.0],
  ["raw_log", 0.5, 7.0],
  ["user_identity", 0.95, 365.0],
  ["kg_node", 0.85, 90.0],
  ["temporary", 0.4, 2.0],
]) {
  test(`writeConfidence keeps ${category} mapping after exact identity resolution`, async () => {
    const source = makeSource([{ id: "entry-1", category, body: ["body"] }]);
    const fixture = createFixture({
      sourceContent: source.content,
      coreRows: [{
        id: "chunk-1",
        path: FILE_REL,
        start_line: source.ranges["entry-1"].startLine,
        end_line: source.ranges["entry-1"].endLine,
      }],
    });
    try {
      const result = await runWriter(fixture, "entry-1", category);
      const rows = readConfidenceRows(fixture.engineDbPath);
      assert.equal(result.status, "initialized");
      assert.deepEqual(result.chunkIds, ["chunk-1"]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].chunk_id, "chunk-1");
      assert.equal(rows[0].initial_confidence, conf);
      assert.equal(rows[0].confidence, conf);
      assert.equal(rows[0].base_tau, tau);
      assert.equal(rows[0].category, category);
      assert.equal(rows[0].last_confidence_update, 1718678400);
    } finally {
      fixture.cleanup();
    }
  });
}

test("unknown category keeps the fallback confidence mapping", async () => {
  const source = makeSource([{ id: "entry-unknown", category: "unknown_category", body: ["body"] }]);
  const fixture = createFixture({
    sourceContent: source.content,
    coreRows: [{
      id: "unknown-chunk",
      path: FILE_REL,
      start_line: source.ranges["entry-unknown"].startLine,
      end_line: source.ranges["entry-unknown"].endLine,
    }],
  });
  try {
    await runWriter(fixture, "entry-unknown", "unknown_category");
    const row = readConfidenceRows(fixture.engineDbPath)[0];
    assert.equal(row.initial_confidence, 0.5);
    assert.equal(row.base_tau, 7.0);
    assert.equal(row.category, "unknown_category");
  } finally {
    fixture.cleanup();
  }
});

test("entryId selects the exact source entry regardless of newer same-path Core rows", async () => {
  const source = makeSource([
    { id: "entry-A", category: "preference", body: ["A body", "A second line"] },
    { id: "entry-B", category: "episodic", body: ["B body", "B second line"] },
  ]);
  const fixture = createFixture({
    sourceContent: source.content,
    coreRows: [
      {
        id: "chunk-A",
        path: FILE_REL,
        start_line: source.ranges["entry-A"].startLine,
        end_line: source.ranges["entry-A"].endLine,
        updated_at: 1,
      },
      {
        id: "chunk-B-newer",
        path: FILE_REL,
        start_line: source.ranges["entry-B"].startLine,
        end_line: source.ranges["entry-B"].endLine,
        updated_at: 999,
      },
    ],
  });
  try {
    const result = await runWriter(fixture, "entry-A", "preference");
    assert.deepEqual(result.chunkIds, ["chunk-A"]);
    assert.deepEqual(readConfidenceRows(fixture.engineDbPath).map(row => row.chunk_id), ["chunk-A"]);
  } finally {
    fixture.cleanup();
  }
});

test("an exact entry with no indexed Core chunk is pending and never falls back to a neighbor", async () => {
  const source = makeSource([
    { id: "entry-A", category: "preference", body: ["A body"] },
    { id: "entry-B", category: "preference", body: ["B body"] },
  ]);
  const fixture = createFixture({
    sourceContent: source.content,
    coreRows: [{
      id: "chunk-B",
      path: FILE_REL,
      start_line: source.ranges["entry-B"].startLine,
      end_line: source.ranges["entry-B"].endLine,
    }],
  });
  try {
    const result = await runWriter(fixture, "entry-A", "preference");
    assert.deepEqual(result, {
      ok: true,
      entryId: "entry-A",
      fileRel: FILE_REL,
      chunkIds: [],
      initialized: 0,
      status: "pending",
      reason: "exact_core_chunk_not_indexed",
    });
    assert.deepEqual(readConfidenceRows(fixture.engineDbPath), []);
  } finally {
    fixture.cleanup();
  }
});

test("all wholly contained chunks for one entry initialize, while its neighbor is excluded", async () => {
  const source = makeSource([
    { id: "entry-A", category: "episodic", body: ["A1", "A2", "A3", "A4", "A5", "A6"] },
    { id: "entry-B", category: "episodic", body: ["B1", "B2"] },
  ]);
  const a = source.ranges["entry-A"];
  const b = source.ranges["entry-B"];
  const fixture = createFixture({
    sourceContent: source.content,
    coreRows: [
      { id: "chunk-A1", path: FILE_REL, start_line: a.startLine + 5, end_line: a.startLine + 7 },
      { id: "chunk-A2", path: FILE_REL, start_line: a.startLine + 8, end_line: a.endLine - 1 },
      { id: "chunk-B", path: FILE_REL, start_line: b.startLine, end_line: b.endLine },
    ],
  });
  try {
    const result = await runWriter(fixture, "entry-A", "episodic");
    assert.deepEqual(result.chunkIds, ["chunk-A1", "chunk-A2"]);
    assert.deepEqual(readConfidenceRows(fixture.engineDbPath).map(row => row.chunk_id), ["chunk-A1", "chunk-A2"]);
  } finally {
    fixture.cleanup();
  }
});

test("a Core chunk spanning the target entry boundary fails closed before Engine mutation", async () => {
  const source = makeSource([
    { id: "entry-A", category: "raw_log", body: ["A1", "A2", "A3"] },
    { id: "entry-B", category: "raw_log", body: ["B1", "B2"] },
  ]);
  const a = source.ranges["entry-A"];
  const b = source.ranges["entry-B"];
  const fixture = createFixture({
    sourceContent: source.content,
    coreRows: [{
      id: "cross-boundary",
      path: FILE_REL,
      start_line: a.startLine + 5,
      end_line: b.startLine + 1,
    }],
  });
  try {
    await assertCode(CHECKPOINT_CHUNK_IDENTITY_AMBIGUOUS, () => runWriter(fixture, "entry-A", "raw_log"));
    assert.deepEqual(readConfidenceRows(fixture.engineDbPath), []);
  } finally {
    fixture.cleanup();
  }
});

test("duplicate source entryIds fail closed before any Core or Engine mutation", async () => {
  const source = makeSource([
    { id: "duplicate-entry", category: "preference", body: ["first"] },
    { id: "duplicate-entry", category: "preference", body: ["second"] },
  ]);
  const fixture = createFixture({
    sourceContent: source.content,
    coreRows: [{ id: "chunk-duplicate", path: FILE_REL, start_line: 3, end_line: 8 }],
  });
  try {
    await assertCode(CHECKPOINT_ENTRY_IDENTITY_AMBIGUOUS, () => runWriter(fixture, "duplicate-entry", "preference"));
    assert.deepEqual(readConfidenceRows(fixture.engineDbPath), []);
  } finally {
    fixture.cleanup();
  }
});

test("source category mismatch fails closed and cannot be overridden by the caller", async () => {
  const source = makeSource([{ id: "category-entry", category: "episodic", body: ["body"] }]);
  const fixture = createFixture({
    sourceContent: source.content,
    coreRows: [{
      id: "category-chunk",
      path: FILE_REL,
      start_line: source.ranges["category-entry"].startLine,
      end_line: source.ranges["category-entry"].endLine,
    }],
  });
  try {
    await assertCode(CHECKPOINT_ENTRY_CATEGORY_MISMATCH, () => runWriter(fixture, "category-entry", "preference"));
    assert.deepEqual(readConfidenceRows(fixture.engineDbPath), []);
  } finally {
    fixture.cleanup();
  }
});

test("missing source entry fails closed", async () => {
  const source = makeSource([{ id: "known-entry", category: "raw_log", body: ["body"] }]);
  const fixture = createFixture({ sourceContent: source.content });
  try {
    await assertCode(CHECKPOINT_ENTRY_IDENTITY_NOT_FOUND, () => runWriter(fixture, "missing-entry", "raw_log"));
    assert.deepEqual(readConfidenceRows(fixture.engineDbPath), []);
  } finally {
    fixture.cleanup();
  }
});

test("Core line metadata unavailable fails closed without path-only fallback", async () => {
  const source = makeSource([{ id: "missing-lines", category: "raw_log", body: ["body"] }]);
  const fixture = createFixture({
    sourceContent: source.content,
    coreRows: [{
      id: "missing-line-chunk",
      path: FILE_REL,
      start_line: null,
      end_line: null,
    }],
  });
  try {
    await assertCode(CHECKPOINT_CORE_IDENTITY_UNAVAILABLE, () => runWriter(fixture, "missing-lines", "raw_log"));
    assert.deepEqual(readConfidenceRows(fixture.engineDbPath), []);
  } finally {
    fixture.cleanup();
  }
});

test("existing lifecycle state is preserved by checkpoint initialization", async () => {
  const source = makeSource([{ id: "existing-entry", category: "preference", body: ["body"] }]);
  const fixture = createFixture({
    sourceContent: source.content,
    coreRows: [{
      id: "existing-chunk",
      path: FILE_REL,
      start_line: source.ranges["existing-entry"].startLine,
      end_line: source.ranges["existing-entry"].endLine,
    }],
    engineRows: [{
      chunk_id: "existing-chunk",
      initial_confidence: 0.31,
      confidence: 0.42,
      last_confidence_update: 123,
      base_tau: 88,
      hit_count: 7,
      is_archived: 1,
      is_protected: 1,
      conflict_flag: 1,
      category: "custom",
      kg_data: "{\"keep\":true}",
    }],
  });
  try {
    const before = readConfidenceRows(fixture.engineDbPath);
    const result = await runWriter(fixture, "existing-entry", "preference");
    const after = readConfidenceRows(fixture.engineDbPath);
    assert.equal(result.status, "already_initialized");
    assert.deepEqual(after, before);
  } finally {
    fixture.cleanup();
  }
});

test("Core remains unchanged while exact chunks initialize in the separate Engine DB", async () => {
  const source = makeSource([{ id: "readonly-entry", category: "episodic", body: ["body"] }]);
  const fixture = createFixture({
    sourceContent: source.content,
    coreRows: [{
      id: "readonly-chunk",
      path: FILE_REL,
      text: "core content",
      updated_at: 99,
      start_line: source.ranges["readonly-entry"].startLine,
      end_line: source.ranges["readonly-entry"].endLine,
    }],
  });
  try {
    const before = readCoreRows(fixture.coreDbPath);
    await runWriter(fixture, "readonly-entry", "episodic");
    assert.deepEqual(readCoreRows(fixture.coreDbPath), before);
    assert.deepEqual(readConfidenceRows(fixture.engineDbPath).map(row => row.chunk_id), ["readonly-chunk"]);
  } finally {
    fixture.cleanup();
  }
});

test("repeated exact-entry initialization is idempotent without attached Core schema", async () => {
  const source = makeSource([
    { id: "repeat-A", category: "raw_log", body: ["A"] },
    { id: "repeat-B", category: "episodic", body: ["B"] },
  ]);
  const fixture = createFixture({
    sourceContent: source.content,
    coreRows: [
      { id: "repeat-chunk-A", path: FILE_REL, start_line: source.ranges["repeat-A"].startLine, end_line: source.ranges["repeat-A"].endLine },
      { id: "repeat-chunk-B", path: FILE_REL, start_line: source.ranges["repeat-B"].startLine, end_line: source.ranges["repeat-B"].endLine },
    ],
  });
  try {
    const first = await runWriter(fixture, "repeat-A", "raw_log");
    const second = await runWriter(fixture, "repeat-B", "episodic");
    assert.equal(first.status, "initialized");
    assert.equal(second.status, "initialized");
    assert.deepEqual(readConfidenceRows(fixture.engineDbPath).map(row => row.chunk_id), ["repeat-chunk-A", "repeat-chunk-B"]);
    const databaseList = new Database(fixture.engineDbPath, { readonly: true });
    try {
      assert.deepEqual(databaseList.prepare("PRAGMA database_list").all().map(row => row.name), ["main"]);
    } finally {
      databaseList.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test("Core/Engine physical-file guard prevents a same-file confidence write", async () => {
  const source = makeSource([{ id: "same-file-entry", category: "preference", body: ["body"] }]);
  const fixture = createFixture({
    sourceContent: source.content,
    coreRows: [{
      id: "same-file-chunk",
      path: FILE_REL,
      start_line: source.ranges["same-file-entry"].startLine,
      end_line: source.ranges["same-file-entry"].endLine,
    }],
  });
  try {
    await assertCode(CHECKPOINT_CORE_IDENTITY_UNAVAILABLE, () => checkpoint.withRuntime({
      workspaceDir: fixture.workspaceDir,
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.coreDbPath,
      timeZone: "Asia/Shanghai",
      now: () => Date.parse("2026-06-18T09:10:11.000+08:00"),
    }, () => writeConfidence("same-file-entry", "ignored", "preference", {
      fileRel: FILE_REL,
      nowSec: 1718678400,
    })));
    const coreDb = new Database(fixture.coreDbPath, { readonly: true });
    try {
      assert.equal(
        coreDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_confidence'").get(),
        undefined,
      );
    } finally {
      coreDb.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test("writer source is Core-readonly and does not use newest-row path authority", () => {
  const source = readFileSync(resolve("lib/checkpoint/confidence-writer.js"), "utf8");
  assert.doesNotMatch(source, /ORDER BY\s+updated_at\s+DESC/i);
  assert.doesNotMatch(source, /INSERT OR REPLACE/i);
  assert.match(source, /start_line/);
  assert.match(source, /end_line/);
  assert.match(source, /INSERT OR IGNORE/);
  assert.match(source, /withDb/);
  assert.match(source, /withEngineDbIsolated/);
});
