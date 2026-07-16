import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const checkpoint = require("../bin/session-checkpoint.js");
const { extractConfigKey, resolveConfigConflicts } = require("../lib/checkpoint/conflict-resolver.js");

function createFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-checkpoint-conflict-"));
  const workspaceDir = resolve(root, "workspace");
  const coreDbPath = resolve(root, "core.sqlite");
  const engineDbPath = resolve(root, "engine.sqlite");
  mkdirSync(workspaceDir, { recursive: true });

  const coreDb = new Database(coreDbPath);
  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        text TEXT,
        updated_at INTEGER
      )
    `);
  } finally {
    coreDb.close();
  }

  const engineDb = new Database(engineDbPath);
  try {
    engineDb.exec(`
      CREATE TABLE memory_confidence (
        chunk_id TEXT PRIMARY KEY,
        last_confidence_update INTEGER,
        conflict_flag INTEGER NOT NULL DEFAULT 0,
        category TEXT NOT NULL DEFAULT 'raw_log',
        is_archived INTEGER NOT NULL DEFAULT 0
      )
    `);
  } finally {
    engineDb.close();
  }

  return { workspaceDir, coreDbPath, engineDbPath };
}

function insertChunk(coreDbPath, { id, text, updatedAt = 0 }) {
  const db = new Database(coreDbPath);
  try {
    db.prepare("INSERT INTO chunks (id, text, updated_at) VALUES (?, ?, ?)").run(id, text, updatedAt);
  } finally {
    db.close();
  }
}

function insertConfidence(engineDbPath, { chunkId, lastUpdate, conflictFlag = 0, category = "preference", isArchived = 0 }) {
  const db = new Database(engineDbPath);
  try {
    db.prepare(`
      INSERT INTO memory_confidence (chunk_id, last_confidence_update, conflict_flag, category, is_archived)
      VALUES (?, ?, ?, ?, ?)
    `).run(chunkId, lastUpdate, conflictFlag, category, isArchived);
  } finally {
    db.close();
  }
}

function readConflictRows(engineDbPath) {
  const db = new Database(engineDbPath, { readonly: true });
  try {
    return db.prepare("SELECT chunk_id, conflict_flag, category, is_archived, last_confidence_update FROM memory_confidence ORDER BY chunk_id").all();
  } finally {
    db.close();
  }
}

function withMutedConsoleLog(run) {
  const original = console.log;
  console.log = () => {};
  try {
    return run();
  } finally {
    console.log = original;
  }
}

test("extractConfigKey parses supported config text formats", () => {
  assert.equal(extractConfigKey("配置：theme = solarized（来源：checkpoint）"), "theme");
  assert.equal(extractConfigKey("theme = solarized"), "theme");
  assert.equal(extractConfigKey("path/to-setting: value"), "path/to-setting");
  assert.equal(extractConfigKey("no config here"), null);
});

test("single flagged preference entry is unflagged", async () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, { id: "c1", text: "配置：theme = dark（来源：checkpoint）", updatedAt: 1 });
  insertConfidence(fixture.engineDbPath, { chunkId: "c1", lastUpdate: 100, conflictFlag: 1 });

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    const flagged = resolveConfigConflicts();
    assert.equal(flagged, 0);
  });

  const rows = readConflictRows(fixture.engineDbPath);
  assert.equal(rows[0].conflict_flag, 0);
});

test("same key multiple preference rows flag old entries and keep newest unflagged", async () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, { id: "new", text: "配置：theme = dark（来源：checkpoint）", updatedAt: 2 });
  insertChunk(fixture.coreDbPath, { id: "old", text: "配置：theme = light（来源：checkpoint）", updatedAt: 1 });
  insertConfidence(fixture.engineDbPath, { chunkId: "new", lastUpdate: 200, conflictFlag: 0 });
  insertConfidence(fixture.engineDbPath, { chunkId: "old", lastUpdate: 100, conflictFlag: 0 });

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    const flagged = resolveConfigConflicts();
    assert.equal(flagged, 1);
  });

  const rows = readConflictRows(fixture.engineDbPath);
  const byId = Object.fromEntries(rows.map((row) => [row.chunk_id, row]));
  assert.equal(byId.new.conflict_flag, 0);
  assert.equal(byId.old.conflict_flag, 1);
});

test("newest flagged entry is unflagged and older unflagged entries are newly flagged", async () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, { id: "new", text: "配置：theme = dark（来源：checkpoint）", updatedAt: 2 });
  insertChunk(fixture.coreDbPath, { id: "old", text: "配置：theme = light（来源：checkpoint）", updatedAt: 1 });
  insertConfidence(fixture.engineDbPath, { chunkId: "new", lastUpdate: 200, conflictFlag: 1 });
  insertConfidence(fixture.engineDbPath, { chunkId: "old", lastUpdate: 100, conflictFlag: 0 });

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    const flagged = resolveConfigConflicts();
    assert.equal(flagged, 1);
  });

  const rows = readConflictRows(fixture.engineDbPath);
  const byId = Object.fromEntries(rows.map((row) => [row.chunk_id, row]));
  assert.equal(byId.new.conflict_flag, 0);
  assert.equal(byId.old.conflict_flag, 1);
});

test("archived entries do not participate", async () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, { id: "new", text: "配置：theme = dark（来源：checkpoint）", updatedAt: 2 });
  insertChunk(fixture.coreDbPath, { id: "archived", text: "配置：theme = light（来源：checkpoint）", updatedAt: 1 });
  insertConfidence(fixture.engineDbPath, { chunkId: "new", lastUpdate: 200, conflictFlag: 0, isArchived: 0 });
  insertConfidence(fixture.engineDbPath, { chunkId: "archived", lastUpdate: 100, conflictFlag: 0, isArchived: 1 });

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    const flagged = resolveConfigConflicts();
    assert.equal(flagged, 0);
  });

  const rows = readConflictRows(fixture.engineDbPath);
  const byId = Object.fromEntries(rows.map((row) => [row.chunk_id, row]));
  assert.equal(byId.new.conflict_flag, 0);
  assert.equal(byId.archived.conflict_flag, 0);
});

test("different config keys do not conflict with each other", async () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, { id: "theme", text: "配置：theme = dark（来源：checkpoint）", updatedAt: 2 });
  insertChunk(fixture.coreDbPath, { id: "language", text: "配置：language = zh（来源：checkpoint）", updatedAt: 1 });
  insertConfidence(fixture.engineDbPath, { chunkId: "theme", lastUpdate: 200 });
  insertConfidence(fixture.engineDbPath, { chunkId: "language", lastUpdate: 100 });

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    const flagged = resolveConfigConflicts();
    assert.equal(flagged, 0);
  });

  const rows = readConflictRows(fixture.engineDbPath);
  assert.deepEqual(rows.map((row) => row.conflict_flag), [0, 0]);
});

test("non-preference categories do not participate", async () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, { id: "pref", text: "配置：theme = dark（来源：checkpoint）", updatedAt: 2 });
  insertChunk(fixture.coreDbPath, { id: "episodic", text: "配置：theme = light（来源：checkpoint）", updatedAt: 1 });
  insertConfidence(fixture.engineDbPath, { chunkId: "pref", lastUpdate: 200, category: "preference" });
  insertConfidence(fixture.engineDbPath, { chunkId: "episodic", lastUpdate: 100, category: "episodic" });

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    const flagged = resolveConfigConflicts();
    assert.equal(flagged, 0);
  });

  const rows = readConflictRows(fixture.engineDbPath);
  const byId = Object.fromEntries(rows.map((row) => [row.chunk_id, row]));
  assert.equal(byId.pref.conflict_flag, 0);
  assert.equal(byId.episodic.conflict_flag, 0);
});

test("latest row is chosen by engine last_confidence_update ordering, not insertion order", async () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, { id: "older", text: "配置：theme = light（来源：checkpoint）", updatedAt: 1 });
  insertChunk(fixture.coreDbPath, { id: "newer", text: "配置：theme = dark（来源：checkpoint）", updatedAt: 2 });
  insertConfidence(fixture.engineDbPath, { chunkId: "older", lastUpdate: 100 });
  insertConfidence(fixture.engineDbPath, { chunkId: "newer", lastUpdate: 200 });

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    const flagged = resolveConfigConflicts();
    assert.equal(flagged, 1);
  });

  const rows = readConflictRows(fixture.engineDbPath);
  const byId = Object.fromEntries(rows.map((row) => [row.chunk_id, row]));
  assert.equal(byId.newer.conflict_flag, 0);
  assert.equal(byId.older.conflict_flag, 1);
});

test("missing core chunks are excluded by the same semantics as the old inner join", async () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, { id: "existing", text: "配置：theme = dark（来源：checkpoint）", updatedAt: 1 });
  insertConfidence(fixture.engineDbPath, { chunkId: "existing", lastUpdate: 200, conflictFlag: 0 });
  insertConfidence(fixture.engineDbPath, { chunkId: "missing-core", lastUpdate: 100, conflictFlag: 0 });

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    const flagged = resolveConfigConflicts();
    assert.equal(flagged, 0);
  });

  const rows = readConflictRows(fixture.engineDbPath);
  const byId = Object.fromEntries(rows.map((row) => [row.chunk_id, row]));
  assert.equal(byId.existing.conflict_flag, 0);
  assert.equal(byId["missing-core"].conflict_flag, 0);
});

test("empty engine returns zero flagged conflicts", async () => {
  const fixture = createFixture();

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    const flagged = resolveConfigConflicts();
    assert.equal(flagged, 0);
  });

  assert.deepEqual(readConflictRows(fixture.engineDbPath), []);
});

test("empty core yields zero flagged conflicts and does not mutate engine rows", async () => {
  const fixture = createFixture();
  insertConfidence(fixture.engineDbPath, { chunkId: "missing-1", lastUpdate: 200, conflictFlag: 0 });
  insertConfidence(fixture.engineDbPath, { chunkId: "missing-2", lastUpdate: 100, conflictFlag: 1 });

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    const flagged = resolveConfigConflicts();
    assert.equal(flagged, 0);
  });

  const rows = readConflictRows(fixture.engineDbPath);
  const byId = Object.fromEntries(rows.map((row) => [row.chunk_id, row]));
  assert.equal(byId["missing-1"].conflict_flag, 0);
  assert.equal(byId["missing-2"].conflict_flag, 1);
});

test("batch core reads handle more than one IN batch and keep only the newest entry unflagged", async () => {
  const fixture = createFixture();
  for (let index = 0; index < 700; index += 1) {
    const chunkId = `c-${String(index).padStart(4, "0")}`;
    insertChunk(fixture.coreDbPath, {
      id: chunkId,
      text: `配置：theme = value-${index}（来源：checkpoint）`,
      updatedAt: index,
    });
    insertConfidence(fixture.engineDbPath, {
      chunkId,
      lastUpdate: 1000 - index,
      conflictFlag: 0,
    });
  }

  await checkpoint.withRuntime({
    workspaceDir: fixture.workspaceDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
  }, async () => {
    const flagged = withMutedConsoleLog(() => resolveConfigConflicts());
    assert.equal(flagged, 699);
  });

  const rows = readConflictRows(fixture.engineDbPath);
  const newest = rows.find((row) => row.chunk_id === "c-0000");
  const flaggedRows = rows.filter((row) => row.conflict_flag === 1);
  assert.equal(newest.conflict_flag, 0);
  assert.equal(flaggedRows.length, 699);
});

test("conflict resolver source uses dual handles and no attached schema references", () => {
  const source = readFileSync(resolve("lib/checkpoint/conflict-resolver.js"), "utf8");
  assert.doesNotMatch(source, /chunks_db\./);
  assert.doesNotMatch(source, /withMeDb\s*\(/);
  assert.doesNotMatch(source, /ATTACH DATABASE/);
  assert.doesNotMatch(source, /patchWriteGuards/);
  assert.match(source, /withCheckpointDbs\s*\(/);
  assert.match(source, /engineDb/);
  assert.match(source, /coreDb/);
  assert.match(source, /CONFLICT_CORE_BATCH_SIZE/);
});
