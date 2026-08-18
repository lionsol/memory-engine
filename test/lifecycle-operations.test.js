import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  applyKgBridge,
  archiveLowConfidence,
  detectRelatedConflicts,
  detectRelatedConflictsIsolated,
} from "../lib/lifecycle/operations.js";

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      text TEXT,
      path TEXT
    );
    CREATE TABLE memory_confidence (
      chunk_id TEXT PRIMARY KEY,
      confidence REAL,
      last_confidence_update INTEGER,
      hit_count INTEGER DEFAULT 0,
      base_tau REAL DEFAULT 7,
      is_protected INTEGER DEFAULT 0,
      is_archived INTEGER DEFAULT 0,
      conflict_flag INTEGER DEFAULT 0,
      category TEXT,
      kg_data TEXT
    );
  `);
  return db;
}

test("archiveLowConfidence owns the archive mutation and supports dry-run", () => {
  const db = createDb();
  try {
    db.prepare(`
      INSERT INTO memory_confidence
      (chunk_id, confidence, last_confidence_update, hit_count, base_tau, is_protected, is_archived, category)
      VALUES (?, ?, ?, 0, 7, 0, 0, 'raw_log')
    `).run("low", 0.1, 100);
    db.prepare(`
      INSERT INTO memory_confidence
      (chunk_id, confidence, last_confidence_update, hit_count, base_tau, is_protected, is_archived, category)
      VALUES (?, ?, ?, 0, 7, 0, 0, 'raw_log')
    `).run("high", 0.9, 100);

    const dry = archiveLowConfidence(db, {
      threshold: 0.15,
      dryRun: true,
      shouldArchive: row => row.confidence < 0.15,
    });
    assert.equal(dry.archived, 1);
    assert.equal(db.prepare("SELECT is_archived FROM memory_confidence WHERE chunk_id = 'low'").get().is_archived, 0);

    const events = [];
    const applied = archiveLowConfidence(db, {
      threshold: 0.15,
      shouldArchive: row => row.confidence < 0.15,
      onArchived: id => events.push(id),
    });
    assert.deepEqual(applied.ids, ["low"]);
    assert.deepEqual(events, ["low"]);
    assert.equal(db.prepare("SELECT is_archived FROM memory_confidence WHERE chunk_id = 'low'").get().is_archived, 1);
  } finally {
    db.close();
  }
});

test("applyKgBridge writes one shared payload to the newest eligible rows", () => {
  const db = createDb();
  try {
    const insert = db.prepare(`
      INSERT INTO memory_confidence
      (chunk_id, confidence, last_confidence_update, is_archived, category)
      VALUES (?, 0.5, ?, 0, ?)
    `);
    insert.run("newest", 300, "kg_node");
    insert.run("middle", 200, "raw_log");
    insert.run("oldest", 100, "raw_log");
    insert.run("ignored", 400, "preference");

    const completed = [];
    const result = applyKgBridge(db, {
      nodes: [{ id: "n1", name: "Node" }],
      edges: [{ source: "n1", target: "n2" }],
      limit: 2,
      onCompleted: metadata => completed.push(metadata),
    });

    assert.equal(result.chunks_updated, 2);
    assert.equal(db.prepare("SELECT kg_data FROM memory_confidence WHERE chunk_id = 'newest'").get().kg_data !== null, true);
    assert.equal(db.prepare("SELECT kg_data FROM memory_confidence WHERE chunk_id = 'middle'").get().kg_data !== null, true);
    assert.equal(db.prepare("SELECT kg_data FROM memory_confidence WHERE chunk_id = 'oldest'").get().kg_data, null);
    assert.deepEqual(completed, [{ nodes: 1, edges: 1, chunks_updated: 2 }]);
  } finally {
    db.close();
  }
});

test("detectRelatedConflicts flags one unique lower-confidence related memory", () => {
  const db = createDb();
  try {
    const insertChunk = db.prepare("INSERT INTO chunks (id, text, path) VALUES (?, ?, ?)");
    insertChunk.run("old", "prefers compact terminal output and vim keybindings", "preferences/editor-a.md");
    insertChunk.run("new", "prefers compact terminal output and vim keybindings with tabs", "preferences/editor-b.md");
    insertChunk.run("other", "database vector retrieval architecture", "systems/vector-index.md");

    const insertConfidence = db.prepare(`
      INSERT INTO memory_confidence
      (chunk_id, confidence, last_confidence_update, hit_count, is_archived, category)
      VALUES (?, ?, ?, ?, 0, 'preference')
    `);
    insertConfidence.run("old", 0.2, 100, 0);
    insertConfidence.run("new", 0.9, 300, 8);
    insertConfidence.run("other", 0.1, 200, 0);

    const flagged = [];
    const result = detectRelatedConflicts(db, {
      onFlagged: id => flagged.push(id),
    });

    assert.equal(result.pairs_checked >= 1, true);
    assert.deepEqual(result.ids, ["old"]);
    assert.deepEqual(flagged, ["old"]);
    assert.equal(db.prepare("SELECT conflict_flag FROM memory_confidence WHERE chunk_id = 'old'").get().conflict_flag, 1);
    assert.equal(db.prepare("SELECT conflict_flag FROM memory_confidence WHERE chunk_id = 'other'").get().conflict_flag, 0);
  } finally {
    db.close();
  }
});

test("detectRelatedConflictsIsolated preserves conflict behavior without cross-database SQL", () => {
  const coreDb = new Database(":memory:");
  const engineDb = new Database(":memory:");
  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        text TEXT,
        path TEXT
      );
    `);
    engineDb.exec(`
      CREATE TABLE memory_confidence (
        chunk_id TEXT PRIMARY KEY,
        confidence REAL,
        last_confidence_update INTEGER,
        hit_count INTEGER DEFAULT 0,
        base_tau REAL DEFAULT 7,
        is_protected INTEGER DEFAULT 0,
        is_archived INTEGER DEFAULT 0,
        conflict_flag INTEGER DEFAULT 0,
        category TEXT,
        kg_data TEXT
      );
    `);

    const insertChunk = coreDb.prepare("INSERT INTO chunks (id, text, path) VALUES (?, ?, ?)");
    insertChunk.run("old", "prefers compact terminal output and vim keybindings", "preferences/editor-a.md");
    insertChunk.run("new", "prefers compact terminal output and vim keybindings with tabs", "preferences/editor-b.md");
    insertChunk.run("other", "database vector retrieval architecture", "systems/vector-index.md");

    const insertConfidence = engineDb.prepare(`
      INSERT INTO memory_confidence
      (chunk_id, confidence, last_confidence_update, hit_count, is_archived, category)
      VALUES (?, ?, ?, ?, 0, 'preference')
    `);
    insertConfidence.run("old", 0.2, 100, 0);
    insertConfidence.run("new", 0.9, 300, 8);
    insertConfidence.run("other", 0.1, 200, 0);

    const flagged = [];
    const result = detectRelatedConflictsIsolated({
      withCoreDb: run => run(coreDb),
      withEngineDb: run => run(engineDb),
      onFlagged: id => flagged.push(id),
    });

    assert.deepEqual(coreDb.prepare("PRAGMA database_list").all().map(row => row.name), ["main"]);
    assert.deepEqual(engineDb.prepare("PRAGMA database_list").all().map(row => row.name), ["main"]);
    assert.equal(result.pairs_checked >= 1, true);
    assert.deepEqual(result.ids, ["old"]);
    assert.deepEqual(flagged, ["old"]);
    assert.equal(engineDb.prepare("SELECT conflict_flag FROM memory_confidence WHERE chunk_id = 'old'").get().conflict_flag, 1);
    assert.equal(engineDb.prepare("SELECT conflict_flag FROM memory_confidence WHERE chunk_id = 'other'").get().conflict_flag, 0);
  } finally {
    engineDb.close();
    coreDb.close();
  }
});
