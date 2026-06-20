import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

function createFixtureDbs() {
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
      ["bbbbbbbbbbbbbbbb-e", "memory/episodes/2026-06-11.md", "episode duplicate", "episodic", 1781136000000]
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

async function withAuditEnv(paths, fn) {
  const oldCore = process.env.MEMORY_ENGINE_CORE_DB;
  const oldEngine = process.env.MEMORY_ENGINE_DB;
  process.env.MEMORY_ENGINE_CORE_DB = paths.corePath;
  process.env.MEMORY_ENGINE_DB = paths.enginePath;
  try {
    return await fn();
  } finally {
    if (oldCore === undefined) delete process.env.MEMORY_ENGINE_CORE_DB;
    else process.env.MEMORY_ENGINE_CORE_DB = oldCore;
    if (oldEngine === undefined) delete process.env.MEMORY_ENGINE_DB;
    else process.env.MEMORY_ENGINE_DB = oldEngine;
  }
}

function byPreview(report, preview) {
  return report.groups.find(group => group.representative_content_preview === preview);
}

async function loadAuditInEnv(paths, fn) {
  return withAuditEnv(paths, async () => {
    const mod = await import(`../lib/quality/smart-add-duplicate-audit.js?dup=${Date.now()}-${Math.random()}`);
    return fn(mod);
  });
}

test("exact duplicate grouping and scope filter only include lifecycle-owned smart_add groups by default", async () => {
  const fixture = createFixtureDbs();
  await loadAuditInEnv(fixture, async (mod) => {
    const report = mod.buildSmartAddDuplicateAudit({
      generatedAt: "2026-06-20T00:00:00.000Z",
    });
    assert.equal(report.scope, "smart_add_lifecycle_owned");
    assert.equal(report.summary.duplicate_exact_groups, 4);
    assert.equal(report.summary.duplicate_exact_entries, 8);
    assert.equal(report.groups.some(group => group.all_occurrence_paths.some(path => path.startsWith("memory/episodes/"))), false);
  });
});

test("earliest and latest occurrence selection is deterministic", async () => {
  const fixture = createFixtureDbs();
  await loadAuditInEnv(fixture, async (mod) => {
    const report = mod.buildSmartAddDuplicateAudit({
      generatedAt: "2026-06-20T00:00:00.000Z",
    });
    const group = byPreview(report, "repeated confirmed fact");
    assert.equal(group.earliest_occurrence, "2026-05-01T00:00:00.000Z");
    assert.equal(group.latest_occurrence, "2026-06-20T00:00:00.000Z");
    assert.deepEqual(group.all_occurrence_dates, ["2026-05-01", "2026-06-20"]);
  });
});

test("retrieved and injected aggregation is preserved at group level", async () => {
  const fixture = createFixtureDbs();
  await loadAuditInEnv(fixture, async (mod) => {
    const report = mod.buildSmartAddDuplicateAudit({
      generatedAt: "2026-06-20T00:00:00.000Z",
    });
    const group = byPreview(report, "used duplicate text");
    assert.equal(group.retrieved_count_total, 1);
    assert.equal(group.injected_count_total, 1);
    assert.equal(group.chunks_ever_retrieved, 1);
    assert.equal(group.chunks_ever_injected, 1);
  });
});

test("adjacent same-category smart-add duplicates classify as ingestion_bug_candidate", async () => {
  const fixture = createFixtureDbs();
  await loadAuditInEnv(fixture, async (mod) => {
    const report = mod.buildSmartAddDuplicateAudit({
      generatedAt: "2026-06-20T00:00:00.000Z",
    });
    const group = byPreview(report, "adjacent bug text");
    assert.equal(group.classification, "ingestion_bug_candidate");
    assert.equal(group.cleanup_eligibility, true);
    assert.equal(group.risk_level, "low");
    assert.equal(group.suggested_delete_candidates.length, 1);
  });
});

test("long-window duplicates classify as repeated_confirmation_candidate", async () => {
  const fixture = createFixtureDbs();
  await loadAuditInEnv(fixture, async (mod) => {
    const report = mod.buildSmartAddDuplicateAudit({
      generatedAt: "2026-06-20T00:00:00.000Z",
    });
    const group = byPreview(report, "repeated confirmed fact");
    assert.equal(group.classification, "repeated_confirmation_candidate");
    assert.equal(group.cleanup_eligibility, false);
    assert.equal(group.risk_level, "medium");
  });
});

test("retrieval or injection usage makes a duplicate group unsafe_to_cleanup", async () => {
  const fixture = createFixtureDbs();
  await loadAuditInEnv(fixture, async (mod) => {
    const report = mod.buildSmartAddDuplicateAudit({
      generatedAt: "2026-06-20T00:00:00.000Z",
    });
    const group = byPreview(report, "used duplicate text");
    assert.equal(group.classification, "unsafe_to_cleanup");
    assert.equal(group.cleanup_eligibility, false);
    assert.equal(group.risk_level, "high");
  });
});

test("non-smart-add occurrences keep the group in diagnostics and mark it unsafe", async () => {
  const fixture = createFixtureDbs();
  await loadAuditInEnv(fixture, async (mod) => {
    const report = mod.buildSmartAddDuplicateAudit({
      generatedAt: "2026-06-20T00:00:00.000Z",
    });
    const group = byPreview(report, "cross family duplicate");
    assert.equal(group.classification, "unsafe_to_cleanup");
    assert.equal(group.duplicate_count, 2);
    assert.equal(group.all_occurrence_count, 3);
    assert.equal(group.owners_touched.includes("openclaw_core"), true);
  });
});

test("JSON output ordering is deterministic", async () => {
  const fixture = createFixtureDbs();
  await loadAuditInEnv(fixture, async (mod) => {
    const first = mod.buildSmartAddDuplicateAudit({
      generatedAt: "2026-06-20T00:00:00.000Z",
    });
    const second = mod.buildSmartAddDuplicateAudit({
      generatedAt: "2026-06-20T00:00:00.000Z",
    });
    assert.deepEqual(first, second);
    assert.deepEqual(
      first.groups.map(group => group.representative_content_preview),
      [
        "repeated confirmed fact",
        "adjacent bug text",
        "used duplicate text",
        "cross family duplicate",
      ],
    );
  });
});
