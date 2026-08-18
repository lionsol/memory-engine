import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import {
  ensureMemoryEngineTables,
  migrateLegacyMemoryEventsFromCore,
} from "../lib/db/schema.js";
import { applyCoreChunkTimeMigration } from "../lib/db/core-chunk-time-migration.js";
import { applyStaleQuarantinedChunkCleanup } from "../lib/quality/stale-quarantined-chunk-cleanup.js";
import {
  PRODUCTION_HYBRID_OBSERVATION_SURFACES,
  validateProductionHybridObservationProvenance,
} from "../lib/recall/hybrid/hybrid-observation-provenance.js";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function createLegacyEventsCore() {
  const db = new Database(":memory:");
  db.exec(`
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
      created_at DATETIME
    );
  `);
  db.prepare(`
    INSERT INTO memory_events
      (event_type, session_id, trace_id, memory_id, candidate_count, source, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "memory_created",
    "session-1",
    "trace-1",
    "chunk-1",
    3,
    "legacy-core",
    '{"legacy":true}',
    "2026-08-18 01:00:00",
  );
  return db;
}

test("legacy memory_events migration reads Core and writes Engine through separate handles", () => {
  const coreDb = createLegacyEventsCore();
  const engineDb = new Database(":memory:");
  try {
    ensureMemoryEngineTables(engineDb);
    const result = migrateLegacyMemoryEventsFromCore(engineDb, coreDb);

    assert.deepEqual(coreDb.prepare("PRAGMA database_list").all().map(row => row.name), ["main"]);
    assert.deepEqual(engineDb.prepare("PRAGMA database_list").all().map(row => row.name), ["main"]);
    assert.deepEqual(result, { migrated: 1, reason: "ok" });

    const migrated = engineDb.prepare(`
      SELECT event_type, session_id, trace_id, memory_id, candidate_count, source, metadata_json, created_at
      FROM memory_events
    `).get();
    assert.deepEqual(migrated, {
      event_type: "memory_created",
      session_id: "session-1",
      trace_id: "trace-1",
      memory_id: "chunk-1",
      candidate_count: 3,
      source: "legacy-core",
      metadata_json: '{"legacy":true}',
      created_at: "2026-08-18 01:00:00",
    });

    const second = migrateLegacyMemoryEventsFromCore(engineDb, coreDb);
    assert.deepEqual(second, { migrated: 0, reason: "local_not_empty" });
  } finally {
    engineDb.close();
    coreDb.close();
  }
});

test("production runtime assembly no longer exposes the combined Engine-plus-Core DB API", () => {
  const dbRuntime = source("lib/runtime/db-runtime.js");
  const pluginEntry = source("index.js");
  const cliService = source("lib/services/memory-engine-cli-service.js");
  const consoleDb = source("console/services/db.js");
  const nightlyCommand = source("bin/nightly-maintenance-command.cjs");

  assert.doesNotMatch(dbRuntime, /from\s+["']\.\.\/db\/engine-db\.js["']/);
  assert.doesNotMatch(dbRuntime, /\bopenEngineDb\b/);
  assert.doesNotMatch(dbRuntime, /\bwithEngineDbSession\b/);
  assert.doesNotMatch(dbRuntime, /\bwithDb\b/);
  assert.match(dbRuntime, /withEngineDbReadonly/);
  assert.match(dbRuntime, /withEngineDbWritable/);
  assert.match(dbRuntime, /createIsolatedHybridDbAccessScope\(dbOptions\)/);

  assert.doesNotMatch(pluginEntry, /database\.withDb/);
  assert.doesNotMatch(pluginEntry, /withIsolatedEngineDb/);
  assert.doesNotMatch(pluginEntry, /dataAccess:\s*\{\s*withDb[,\s]/);
  assert.match(pluginEntry, /withDb:\s*withEngineDbWritable/);
  assert.match(pluginEntry, /withCoreDb/);
  assert.match(pluginEntry, /withEngineDbReadonly/);
  assert.match(pluginEntry, /withEngineDbWritable/);

  assert.doesNotMatch(cliService, /database\.withDb/);
  assert.doesNotMatch(cliService, /dataAccess:\s*\{\s*withDb[,\s]/);
  assert.match(cliService, /withCoreDb/);
  assert.match(cliService, /withEngineDbWritable/);

  assert.doesNotMatch(consoleDb, /database\.openDb|database\.withDb/);
  assert.match(consoleDb, /withCoreDb/);
  assert.match(consoleDb, /withEngineDbReadonly/);
  assert.match(consoleDb, /withEngineDbWritable/);

  assert.doesNotMatch(nightlyCommand, /ATTACH DATABASE|patchWriteGuards|core\.chunks/);
  assert.match(nightlyCommand, /openCoreDbReadonly/);
  assert.match(nightlyCommand, /openEngineDbIsolated/);
  assert.match(nightlyCommand, /readonly:\s*DRY_RUN/);
});

test("normal production entrypoints cannot reach direct writable Core maintenance modules", () => {
  const normalRuntimeSource = [
    source("index.js"),
    source("lib/runtime/db-runtime.js"),
    source("lib/services/memory-engine-cli-service.js"),
    source("lib/tools/memory-engine-actions.js"),
  ].join("\n");

  assert.doesNotMatch(normalRuntimeSource, /core-chunk-time-migration/);
  assert.doesNotMatch(normalRuntimeSource, /stale-quarantined-chunk-cleanup/);

  assert.throws(
    () => applyCoreChunkTimeMigration({}),
    /suspended and must not be applied/i,
  );
  assert.throws(
    () => applyStaleQuarantinedChunkCleanup({}),
    /apply mode requires --confirm/i,
  );
});

test("normal Core mutation remains delegated to explicit OpenClaw index sync after source write", () => {
  const actions = source("lib/tools/memory-engine-actions.js");
  const matches = actions.match(/syncIndexIfNeeded\("memory_engine\.add"\)/g) || [];
  assert.equal(matches.length, 1);
  assert.match(actions, /appendSmartAdd/);
});

test("Console memory reads merge isolated Core facts with Engine metadata", () => {
  const coreDb = new Database(":memory:");
  const engineDb = new Database(":memory:");
  const handleSnapshots = [];
  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT,
        source TEXT,
        start_line INTEGER,
        end_line INTEGER,
        hash TEXT,
        model TEXT,
        text TEXT,
        updated_at INTEGER
      );
      INSERT INTO chunks (id, path, source, text, updated_at) VALUES
        ('managed-1', 'memory/project.md', 'core', 'Core managed text', 2),
        ('external-1', 'memory/daily/2026-08-18.md', 'core', 'Core external text', 1);
    `);
    engineDb.exec(`
      CREATE TABLE memory_confidence (
        chunk_id TEXT PRIMARY KEY,
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
      );
      INSERT INTO memory_confidence
        (chunk_id, initial_confidence, confidence, last_confidence_update, base_tau,
         hit_count, is_archived, is_protected, conflict_flag, category, kg_data)
      VALUES ('managed-1', 0.7, 0.9, 10, 7, 2, 0, 1, 0, 'project', '{"node":"p1"}');
    `);

    const withCoreDb = fn => {
      handleSnapshots.push({ kind: "core", databases: coreDb.prepare("PRAGMA database_list").all() });
      return fn(coreDb);
    };
    const withDb = fn => {
      handleSnapshots.push({ kind: "engine", databases: engineDb.prepare("PRAGMA database_list").all() });
      return fn(engineDb);
    };
    const contextSource = source("console/services/memory-service.js")
      .replace(/^import[^\n]*\n/gm, "")
      .replace(/export function /g, "function ");
    const context = {
      safeJson(value, fallback = null) {
        if (!value) return fallback;
        try { return JSON.parse(value); } catch { return fallback; }
      },
      tableExists(db, name) {
        return Boolean(db.prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
        ).get(name));
      },
      withCoreDb,
      withDb,
      inferCategoryFromPath(path) {
        return String(path).includes("daily") ? "daily" : "unknown";
      },
      Map,
      Number,
      String,
    };
    vm.runInNewContext(
      `${contextSource}\nthis.__consoleMemoryService = { listMemories, getMemory };`,
      context,
    );
    const { listMemories, getMemory } = context.__consoleMemoryService;

    const listed = listMemories({ limit: 10 });
    assert.deepEqual(listed.map(row => row.id), ["managed-1", "external-1"]);
    assert.equal(listed[0].text, "Core managed text");
    assert.equal(listed[0].confidence, 0.9);
    assert.equal(listed[0].confidence_mode, "managed");
    assert.deepEqual(listed[0].kg_data, { node: "p1" });
    assert.equal(listed[1].text, "Core external text");
    assert.equal(listed[1].confidence, null);
    assert.equal(listed[1].confidence_mode, "external");
    assert.equal(listed[1].external_badge, true);

    const external = getMemory("external");
    assert.equal(external.id, "external-1");
    assert.equal(external.text, "Core external text");
    assert.equal(external.confidence, null);
    assert.equal(external.source_type, "openclaw-core");
    assert.deepEqual(handleSnapshots.map(entry => entry.kind), ["core", "engine", "core", "engine"]);
    for (const entry of handleSnapshots) {
      assert.deepEqual(entry.databases.map(row => row.name), ["main"]);
    }
  } finally {
    engineDb.close();
    coreDb.close();
  }
});

test("Console overview count reads Core without attaching it to Engine", () => {
  const coreDb = new Database(":memory:");
  const engineDb = new Database(":memory:");
  const handleSnapshots = [];
  try {
    coreDb.exec(`
      CREATE TABLE chunks (id TEXT PRIMARY KEY, text TEXT);
      INSERT INTO chunks (id, text) VALUES ('core-1', 'one'), ('core-2', 'two');
    `);
    engineDb.exec(`
      CREATE TABLE memory_events (id INTEGER PRIMARY KEY, event_type TEXT);
      CREATE TABLE memory_confidence (
        chunk_id TEXT PRIMARY KEY,
        confidence REAL,
        is_archived INTEGER DEFAULT 0,
        conflict_flag INTEGER DEFAULT 0,
        is_protected INTEGER DEFAULT 0,
        hit_count INTEGER DEFAULT 0
      );
      INSERT INTO memory_confidence (chunk_id, confidence, hit_count) VALUES ('engine-1', 0.8, 1);
    `);
    const transformed = source("console/services/metrics-service.js")
      .replace(/^import[\s\S]*?;\n/gm, "")
      .replace(/export function /g, "function ");
    const context = {
      tableExists(db, name) {
        return Boolean(db.prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
        ).get(name));
      },
      withCoreDb: fn => {
        handleSnapshots.push({ kind: "core", databases: coreDb.prepare("PRAGMA database_list").all() });
        return fn(coreDb);
      },
      withDb: fn => {
        handleSnapshots.push({ kind: "engine", databases: engineDb.prepare("PRAGMA database_list").all() });
        return fn(engineDb);
      },
      getMemoryEngineConfig: () => ({ metrics: { topN: 10 } }),
      PRODUCTION_HYBRID_OBSERVATION_SURFACES,
      validateProductionHybridObservationProvenance,
      Math,
      Number,
      String,
      Array,
      Object,
    };
    vm.runInNewContext(`${transformed}\nthis.__overviewMetrics = overviewMetrics;`, context);
    const result = context.__overviewMetrics();

    assert.equal(result.memories, 2);
    assert.equal(result.confidence.tracked, 1);
    assert.deepEqual(handleSnapshots.map(entry => entry.kind), ["core", "engine"]);
    for (const entry of handleSnapshots) {
      assert.deepEqual(entry.databases.map(row => row.name), ["main"]);
    }
  } finally {
    engineDb.close();
    coreDb.close();
  }
});
