import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

function createAuditFixtureDbs() {
  const root = mkdtempSync(resolve(tmpdir(), "chunks-without-confidence-audit-"));
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

    const insertChunk = coreDb.prepare(`
      INSERT INTO chunks (id, path, source, start_line, end_line, hash, text, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFile = coreDb.prepare(`
      INSERT INTO files (path, source, hash, mtime, size)
      VALUES (?, ?, ?, ?, ?)
    `);

    const rows = [
      ["1111111111111111-dream", "memory/dreaming/light/2026-06-18.md", "memory", 1, 10, "hash-dream", "dreaming chunk text", 1718668800000, 1718668700000, 120],
      ["2222222222222222-daily", "memory/2026-06-18.md", "memory", 1, 10, "hash-daily", "daily chunk text", 1718669800000, 1718669700000, 90],
      ["3333333333333333-core", "MEMORY.md", "memory", 1, 10, "hash-core", "curated memory text", 1718670800000, 1718670700000, 80],
      ["4444444444444444-raw", "memory/raw_log/2026-06-09T0100_healthcheck.md", "memory", 1, 10, "hash-raw", "raw log artifact text", 1718671800000, 1718671700000, 70],
      ["5555555555555555-smart", "memory/smart-add/2026-06-18.md", "memory", 1, 10, "hash-smart", "smart add text", 1718672800000, 1718672700000, 60],
      ["6666666666666666-episode", "memory/episodes/2026-06-18.md", "memory", 1, 10, "hash-episode", "episode text", 1718673800000, 1718673700000, 50],
      ["9999999999999999-generated", "memory/generated-smart-add/2026-06-18.md", "memory", 1, 10, "hash-generated", "generated smart add text", 1718674300000, 1718674200000, 45],
      ["7777777777777777-stats", "memory/stats-history.md", "memory", 1, 10, "hash-stats", "stats history", 1718674800000, 1718674700000, 40],
      ["8888888888888888-quarantine", "memory/legacy-daily-mirrors/2026-06-18.md", "memory", 1, 10, "hash-quarantine", "quarantined mirror", 1718675800000, 1718675700000, 30],
    ];

    for (const [id, path, source, start, end, hash, text, updatedAt, mtime, size] of rows) {
      insertChunk.run(id, path, source, start, end, hash, text, updatedAt);
      insertFile.run(path, source, hash, mtime, size);
    }

    engineDb.prepare(`
      INSERT INTO memory_confidence
      (chunk_id, initial_confidence, confidence, last_confidence_update, base_tau, hit_count, is_archived, is_protected, conflict_flag, category, kg_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("5555555555555555-smart", 0.5, 0.5, 1718672800, 7, 0, 0, 0, 0, "raw_log", null);

    engineDb.prepare(`
      INSERT INTO memory_confidence
      (chunk_id, initial_confidence, confidence, last_confidence_update, base_tau, hit_count, is_archived, is_protected, conflict_flag, category, kg_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("6666666666666666-episode", 0.7, 0.8, 1718673800, 30, 2, 0, 0, 0, "episodic", null);

    engineDb.prepare(`
      INSERT INTO memory_events
      (event_type, session_id, trace_id, memory_id, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("memory_candidate_retrieved", "s1", "t1", "1111111111111111", "autoRecall", "2026-06-19 10:00:00");
    engineDb.prepare(`
      INSERT INTO memory_events
      (event_type, session_id, trace_id, memory_id, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("memory_injected", "s1", "t1", "1111111111111111", "autoRecall", "2026-06-19 10:01:00");
    coreDb.prepare(`
      INSERT INTO memory_events
      (event_type, session_id, trace_id, memory_id, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("memory_candidate_retrieved", "s2", "t2", "2222222222222222", "autoRecall", "2026-06-19 10:02:00");
  } finally {
    coreDb.close();
    engineDb.close();
  }

  return { root, corePath, enginePath };
}

async function importAuditModule(tag = Date.now()) {
  return import(`../lib/quality/chunks-without-confidence-audit.js?audit=${tag}`);
}

async function importCliModule() {
  return import("../bin/audit-chunks-without-confidence.js");
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

test("family inference covers dreaming, smart-add, episodes, projects, daily, MEMORY.md, raw_log, and unknown", async () => {
  const { inferAuditFamily } = await importAuditModule();
  assert.equal(inferAuditFamily("memory/dreaming/light/2026-06-18.md"), "dreaming");
  assert.equal(inferAuditFamily("memory/generated-smart-add/2026-06-18.md"), "generated_smart_add");
  assert.equal(inferAuditFamily("memory/smart-add/2026-06-18.md"), "smart_add");
  assert.equal(inferAuditFamily("memory/episodes/2026-06-18.md"), "episode");
  assert.equal(inferAuditFamily("memory/projects/demo.md"), "project");
  assert.equal(inferAuditFamily("memory/2026-06-18.md"), "daily_memory");
  assert.equal(inferAuditFamily("memory/legacy-daily-mirrors/2026-06-18.md"), "quarantined_daily_mirror");
  assert.equal(inferAuditFamily("MEMORY.md"), "curated_memory");
  assert.equal(inferAuditFamily("memory/raw_log/run.md"), "raw_log");
  assert.equal(inferAuditFamily("memory/custom/random.md"), "unknown");
});

test("compareFlagSets confirms missing confidence and missing category are the same chunk set", async () => {
  const fixture = createAuditFixtureDbs();
  const mod = await importAuditModule();
  await withAuditEnv(fixture, async () => {
    const db = mod.openAuditDb();
    try {
      const report = mod.buildChunksWithoutConfidenceAudit({
        db,
        generatedAt: "2026-06-20T00:00:00.000Z",
      });
      assert.deepEqual(report.counts, {
        chunks_without_confidence: 4,
        missing_category: 4,
        intersection_count: 4,
        only_without_confidence: 0,
        only_missing_category: 0,
      });
    } finally {
      db.close();
    }
  });
});

test("generated-smart-add stays out of chunks-without-confidence candidates and path prefix inference is explicit", async () => {
  const fixture = createAuditFixtureDbs();
  const mod = await importAuditModule();
  assert.equal(mod.inferAuditPathPrefix("memory/generated-smart-add/2026-06-18.md"), "memory/generated-smart-add");
  await withAuditEnv(fixture, async () => {
    const report = mod.runChunksWithoutConfidenceAudit({
      generatedAt: "2026-06-20T00:00:00.000Z",
    });
    const samplePaths = [
      ...report.samples.dreaming_examples.map(item => item.path),
      ...report.samples.non_dreaming_examples.map(item => item.path),
      ...report.samples.retrieved_examples.map(item => item.path),
      ...report.samples.injected_examples.map(item => item.path),
    ];
    assert.equal(samplePaths.some(path => path === "memory/generated-smart-add/2026-06-18.md"), false);
    assert.equal(report.breakdowns.by_path_prefix.some(row => row.path_prefix === "memory/generated-smart-add"), false);
  });
});

test("openAuditDb installs a no-write guard", async () => {
  const fixture = createAuditFixtureDbs();
  const mod = await importAuditModule();
  await withAuditEnv(fixture, async () => {
    const db = mod.openAuditDb();
    try {
      assert.throws(
        () => db.prepare("INSERT INTO memory_confidence (chunk_id) VALUES ('x')"),
        /read-only audit refused write SQL/i,
      );
    } finally {
      db.close();
    }
  });
});

test("audit JSON output shape includes counts, breakdowns, dreaming summary, samples, and hypotheses", async () => {
  const fixture = createAuditFixtureDbs();
  const mod = await importAuditModule();
  await withAuditEnv(fixture, async () => {
    const report = mod.runChunksWithoutConfidenceAudit({
      generatedAt: "2026-06-20T00:00:00.000Z",
    });
    assert.equal(report.mode, "read_only");
    assert.equal(report.db_paths.engine, fixture.enginePath);
    assert.equal(report.db_paths.core, fixture.corePath);
    assert.equal(Array.isArray(report.breakdowns.by_path_prefix), true);
    assert.equal(Array.isArray(report.breakdowns.by_family), true);
    assert.equal(Array.isArray(report.breakdowns.by_source_type), true);
    assert.equal(Array.isArray(report.breakdowns.by_category), true);
    assert.equal(Array.isArray(report.breakdowns.by_memory_engine_managed_status), true);
    assert.equal(Array.isArray(report.breakdowns.by_created_month), true);
    assert.equal(report.dreaming.count, 1);
    assert.equal(report.dreaming.retrieval_usage.retrieved_count_total, 1);
    assert.equal(report.dreaming.retrieval_usage.injected_count_total, 1);
    assert.equal(report.samples.dreaming_examples[0].family, "dreaming");
    assert.equal(report.samples.non_dreaming_examples[0].family, "curated_memory");
    assert.equal(report.samples.retrieved_examples.length, 2);
    assert.equal(report.samples.injected_examples.length, 1);
    assert.equal(report.root_cause_hypotheses.length >= 2, true);
  });
});

test("audit grouping and ordering are deterministic", async () => {
  const fixture = createAuditFixtureDbs();
  const mod = await importAuditModule();
  await withAuditEnv(fixture, async () => {
    const reportA = mod.runChunksWithoutConfidenceAudit({
      generatedAt: "2026-06-20T00:00:00.000Z",
    });
    const reportB = mod.runChunksWithoutConfidenceAudit({
      generatedAt: "2026-06-20T00:00:00.000Z",
    });
    assert.deepEqual(reportA, reportB);
    assert.deepEqual(
      reportA.breakdowns.by_family.map(row => [row.family, row.count]),
      [
        ["curated_memory", 1],
        ["daily_memory", 1],
        ["dreaming", 1],
        ["raw_log", 1],
      ],
    );
  });
});

test("CLI --json writes a report file and prints the audit JSON", async () => {
  const fixture = createAuditFixtureDbs();
  const cliModule = await importCliModule();
  const cli = cliModule.default || cliModule;
  const outputPath = resolve(fixture.root, "reports", "chunks-without-confidence-audit.json");
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => {
    lines.push(args.join(" "));
  };
  try {
    await withAuditEnv(fixture, async () => {
      const code = await cli.main(["--json", "--out", outputPath]);
      assert.equal(code, 0);
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(existsSync(outputPath), true);
  const written = JSON.parse(readFileSync(outputPath, "utf8"));
  const printed = JSON.parse(lines.join("\n"));
  assert.equal(written.counts.chunks_without_confidence, 4);
  assert.deepEqual(printed.counts, written.counts);
});
