import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

export function createSmartAddDuplicateFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "smart-add-duplicate-audit-"));
  const corePath = resolve(root, "core.sqlite");
  const engineDir = resolve(root, "engine");
  const enginePath = resolve(engineDir, "memory-engine.sqlite");
  mkdirSync(engineDir, { recursive: true });

  const coreDb = new Database(corePath);
  const engineDb = new Database(enginePath);

  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT,
        source TEXT,
        start_line INTEGER,
        end_line INTEGER,
        hash TEXT,
        text TEXT,
        updated_at INTEGER
      );
      CREATE TABLE files (
        path TEXT PRIMARY KEY,
        source TEXT NOT NULL DEFAULT 'memory',
        hash TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        size INTEGER NOT NULL
      );
      CREATE TABLE memory_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        session_id TEXT,
        trace_id TEXT,
        memory_id TEXT,
        latency_ms INTEGER,
        candidate_count INTEGER,
        injected_count INTEGER,
        cited_count INTEGER,
        vector_score REAL,
        fts_score REAL,
        final_score REAL,
        source TEXT,
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    engineDb.exec(`
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
      );
      CREATE TABLE memory_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        session_id TEXT,
        trace_id TEXT,
        memory_id TEXT,
        latency_ms INTEGER,
        candidate_count INTEGER,
        injected_count INTEGER,
        cited_count INTEGER,
        vector_score REAL,
        fts_score REAL,
        final_score REAL,
        source TEXT,
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const rows = [
      ["1111111111111111-a", "memory/smart-add/2026-06-10.md", "adjacent bug text", "raw_log", 1781049600000],
      ["2222222222222222-a", "memory/smart-add/2026-06-11.md", "adjacent bug text", "raw_log", 1781136000000],
      ["3333333333333333-b", "memory/smart-add/2026-05-01.md", "repeated confirmed fact", "preference", 1777593600000],
      ["4444444444444444-b", "memory/smart-add/2026-06-20.md", "repeated confirmed fact", "preference", 1781913600000],
      ["5555555555555555-c", "memory/smart-add/2026-06-12.md", "used duplicate text", "raw_log", 1781222400000],
      ["6666666666666666-c", "memory/smart-add/2026-06-13.md", "used duplicate text", "raw_log", 1781308800000],
      ["7777777777777777-d", "memory/smart-add/2026-06-14.md", "cross family duplicate", "raw_log", 1781395200000],
      ["8888888888888888-d", "memory/smart-add/2026-06-15.md", "cross family duplicate", "raw_log", 1781481600000],
      ["9999999999999999-d", "memory/2026-06-15.md", "cross family duplicate", null, 1781481600000],
      ["aaaaaaaaaaaaaaaa-e", "memory/episodes/2026-06-10.md", "episode duplicate", "episodic", 1781049600000],
      ["bbbbbbbbbbbbbbbb-e", "memory/episodes/2026-06-11.md", "episode duplicate", "episodic", 1781136000000],
    ];

    const insertChunk = coreDb.prepare(`
      INSERT INTO chunks (id, path, source, start_line, end_line, hash, text, updated_at)
      VALUES (?, ?, 'memory', 1, 10, ?, ?, ?)
    `);
    const insertFile = coreDb.prepare(`
      INSERT INTO files (path, source, hash, mtime, size)
      VALUES (?, 'memory', ?, ?, 100)
    `);
    const insertConfidence = engineDb.prepare(`
      INSERT INTO memory_confidence
      (chunk_id, initial_confidence, confidence, last_confidence_update, base_tau, hit_count, is_archived, is_protected, conflict_flag, category, kg_data)
      VALUES (?, 0.5, 0.5, ?, 7, 0, 0, 0, 0, ?, NULL)
    `);

    for (const [id, path, text, category, updatedAt] of rows) {
      insertChunk.run(id, path, `hash-${id}`, text, updatedAt);
      insertFile.run(path, `hash-${id}`, updatedAt);
      if (category) {
        insertConfidence.run(id, Math.floor(updatedAt / 1000), category);
      }
    }

    engineDb.prepare(`
      INSERT INTO memory_events
      (event_type, session_id, trace_id, memory_id, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("memory_candidate_retrieved", "s1", "t1", "5555555555555555", "autoRecall", "2026-06-20 10:00:00");
    coreDb.prepare(`
      INSERT INTO memory_events
      (event_type, session_id, trace_id, memory_id, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("memory_injected", "s1", "t1", "6666666666666666", "autoRecall", "2026-06-20 10:01:00");
  } finally {
    coreDb.close();
    engineDb.close();
  }

  return { root, corePath, enginePath };
}

export async function withSmartAddDuplicateEnv(fixture, fn) {
  const oldCore = process.env.MEMORY_ENGINE_CORE_DB;
  const oldEngine = process.env.MEMORY_ENGINE_DB;
  const oldEnginePath = process.env.MEMORY_ENGINE_DB_PATH;
  process.env.MEMORY_ENGINE_CORE_DB = fixture.corePath;
  process.env.MEMORY_ENGINE_DB = fixture.enginePath;
  process.env.MEMORY_ENGINE_DB_PATH = fixture.enginePath;
  try {
    return await fn();
  } finally {
    if (oldCore === undefined) delete process.env.MEMORY_ENGINE_CORE_DB;
    else process.env.MEMORY_ENGINE_CORE_DB = oldCore;
    if (oldEngine === undefined) delete process.env.MEMORY_ENGINE_DB;
    else process.env.MEMORY_ENGINE_DB = oldEngine;
    if (oldEnginePath === undefined) delete process.env.MEMORY_ENGINE_DB_PATH;
    else process.env.MEMORY_ENGINE_DB_PATH = oldEnginePath;
  }
}
