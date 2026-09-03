import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  withCoreDbReadonly,
  withEngineDbIsolated,
  withIsolatedDbSession,
} from "../lib/db/isolated-dbs.js";
import { collectQualityCandidates } from "../lib/quality/collect-quality-candidates.js";
import { exportAnnotationCandidates } from "../lib/annotation/export-annotation-candidates.js";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);

function createFixtureDbs() {
  const root = mkdtempSync(join(tmpdir(), "legacy-attached-core-retirement-a1-"));
  const coreDbPath = join(root, "core.sqlite");
  const engineDbPath = join(root, "engine", "memory-engine.sqlite");
  mkdirSync(join(root, "engine"), { recursive: true });

  const core = new Database(coreDbPath);
  const engine = new Database(engineDbPath);
  try {
    core.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT,
        source TEXT,
        text TEXT,
        updated_at INTEGER,
        start_line INTEGER,
        end_line INTEGER,
        hash TEXT
      );
    `);
    engine.exec(`
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
        created_at TEXT
      );
    `);

    const insertChunk = core.prepare(`
      INSERT INTO chunks (id, path, source, text, updated_at, start_line, end_line, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertChunk.run("active-1", "memory/episodes/active.md", "fixture", "active text", 1710000000, 1, 4, "hash-a");
    insertChunk.run("archived-1", "memory/episodes/archived.md", "fixture", "archived text", 1710000001, 5, 8, "hash-b");
    insertChunk.run("missing-1", "memory/episodes/missing.md", "fixture", "missing confidence text", 1710000002, 9, 12, "hash-c");
    insertChunk.run("category-1", "memory/episodes/category.md", "fixture", "category text", 1710000003, 13, 16, "hash-d");
    insertChunk.run("generated-1", "memory/generated-smart-add/generated.md", "fixture", "generated text", 1710000004, 17, 20, "hash-e");

    const insertConfidence = engine.prepare(`
      INSERT INTO memory_confidence
      (chunk_id, initial_confidence, confidence, last_confidence_update, base_tau, hit_count,
       is_archived, is_protected, conflict_flag, category, kg_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertConfidence.run("active-1", 0.5, 0.8, 1710000000, 7, 2, 0, 1, 0, "episodic", null);
    insertConfidence.run("archived-1", 0.5, 0.9, 1710000001, 7, 3, 1, 0, 0, "episodic", null);
    insertConfidence.run("category-1", 0.5, 0.7, 1710000003, 7, 1, 0, 0, 0, "preference", null);
    insertConfidence.run("orphan-1", 0.5, 0.6, 1710000005, 7, 1, 0, 0, 0, "episodic", null);

    engine.prepare(`
      INSERT INTO memory_events
      (event_type, session_id, trace_id, memory_id, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("memory_candidate_retrieved", "s1", "t1", "active-1", "fixture", "2026-08-01 10:00:00");
    engine.prepare(`
      INSERT INTO memory_events
      (event_type, session_id, trace_id, memory_id, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("memory_injected", "s1", "t1", "active-1", "fixture", "2026-08-01 10:01:00");
  } finally {
    core.close();
    engine.close();
  }

  return { root, coreDbPath, engineDbPath };
}

function withEnvironment(values, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function createRecordingDbAccess(record) {
  return {
    withIsolatedDbSession(fn, options) {
      record.sessions += 1;
      return withIsolatedDbSession(fn, options);
    },
    withCoreDbReadonly(fn, options) {
      return withCoreDbReadonly((db) => {
        record.core += 1;
        record.coreDatabaseLists.push(db.prepare("PRAGMA database_list").all());
        return fn(db);
      }, options);
    },
    withEngineDbIsolated(fn, options) {
      return withEngineDbIsolated((db) => {
        record.engine += 1;
        record.engineReadonly.push(Boolean(options?.readonly));
        record.engineDatabaseLists.push(db.prepare("PRAGMA database_list").all());
        return fn(db);
      }, options);
    },
  };
}

function emptyRecord() {
  return {
    sessions: 0,
    core: 0,
    engine: 0,
    engineReadonly: [],
    coreDatabaseLists: [],
    engineDatabaseLists: [],
  };
}

function databaseSnapshot(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } finally {
    db.close();
  }
}

test("production consumers no longer rely on the attached engine-db boundary", () => {
  const consumerFiles = [
    "lib/db/isolated-dbs.js",
    "lib/quality/collect-quality-candidates.js",
    "lib/annotation/export-annotation-candidates.js",
    "lib/runtime/db-runtime.js",
    "lib/quality/chunks-without-confidence-audit.js",
    "lib/quality/legacy-singleton-review.js",
    "lib/quality/confirmed-legacy-singleton-stale-cleanup.js",
    "lib/quality/confirmed-smart-add-propagation-stale-cleanup.js",
    "lib/recall/hybrid/recent-performance-probe.js",
    "lib/recall/hybrid/recent-rollout-readiness-audit.js",
    "bin/export-archived-raw-log-rescue-candidates.cjs",
  ];
  for (const relativePath of consumerFiles) {
    const source = readFileSync(resolve(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /(?:from|import\()\s*["'][^"']*engine-db\.js["']/);
  }
  for (const relativePath of consumerFiles) {
    const source = readFileSync(resolve(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /ATTACH\s+DATABASE/i);
    if (relativePath !== "lib/recall/hybrid/recent-performance-probe.js") {
      assert.doesNotMatch(source, /(?:FROM|JOIN|UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+core\./i);
    }
  }

  const engineSource = readFileSync(resolve(repoRoot, "lib/db/engine-db.js"), "utf8");
  assert.doesNotMatch(engineSource, /ATTACH\s+DATABASE/i);
  assert.doesNotMatch(engineSource, /patchWriteGuards|assertNoCoreWrites/);

  const retiredProbeSource = readFileSync(
    resolve(repoRoot, "lib/recall/hybrid/recent-performance-probe.js"),
    "utf8",
  );
  assert.match(retiredProbeSource, /denyLegacyAttachedCore/);
  assert.ok(
    retiredProbeSource.indexOf("denyLegacyAttachedCore();")
      < retiredProbeSource.indexOf("validateRealModeOptions(options)"),
  );
});

test("independent DB path resolver preserves the legacy resolver contract", async () => {
  const pathsModule = await import("../lib/db/db-paths.js");
  const legacyModule = await import("../lib/db/engine-db.js");
  const options = {
    coreDbPath: "/tmp/memory-engine-a1-core.sqlite",
    engineDbPath: "/tmp/memory-engine-a1-engine.sqlite",
  };

  assert.equal(pathsModule.resolveCoreDbPath(options), options.coreDbPath);
  assert.equal(pathsModule.resolveEngineDbPath(options), options.engineDbPath);
  assert.equal(pathsModule.resolveEngineDbDir(options), "/tmp");
  assert.equal(legacyModule.resolveCoreDbPath(options), pathsModule.resolveCoreDbPath(options));
  assert.equal(legacyModule.resolveEngineDbPath(options), pathsModule.resolveEngineDbPath(options));
  assert.equal(legacyModule.resolveEngineDbDir(options), pathsModule.resolveEngineDbDir(options));
});

test("quality collection joins readonly Core and Engine fixtures through separate main-only handles", () => {
  const fixture = createFixtureDbs();
  const record = emptyRecord();
  const dbAccess = createRecordingDbAccess(record);
  const coreBefore = databaseSnapshot(fixture.coreDbPath);
  try {
    const result = withEnvironment({
      MEMORY_ENGINE_CORE_DB: fixture.coreDbPath,
      MEMORY_ENGINE_DB: fixture.engineDbPath,
    }, () => collectQualityCandidates({
      scope: "all",
      dbOptions: fixture,
      dbAccess,
    }));

    const byId = new Map(result.candidates.map(candidate => [candidate.id, candidate]));
    assert.equal(byId.has("active-1"), true);
    assert.equal(byId.has("missing-1"), true);
    assert.equal(byId.has("category-1"), true);
    assert.equal(byId.has("archived-1"), false);
    assert.equal(byId.has("generated-1"), false);
    assert.equal(byId.get("active-1").confidence, 0.8);
    assert.equal(byId.get("missing-1").has_confidence_record, false);
    assert.equal(byId.get("active-1").retrieved_count, 1);
    assert.equal(byId.get("active-1").injected_count, 1);
    assert.equal(result.diagnostics.exact_orphan_confidence_count, 1);
    assert.equal(result.diagnostics.memory_events_count, 2);

    assert.equal(record.sessions, 1);
    assert.equal(record.core, 1);
    assert.equal(record.engine, 1);
    assert.deepEqual(record.engineReadonly, [true]);
    assert.deepEqual(record.coreDatabaseLists[0].map(row => row.name), ["main"]);
    assert.deepEqual(record.engineDatabaseLists[0].map(row => row.name), ["main"]);
  } finally {
    assert.equal(databaseSnapshot(fixture.coreDbPath), coreBefore);
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("annotation text resolution reads exact IDs from readonly Core without requiring Engine", () => {
  const fixture = createFixtureDbs();
  const record = emptyRecord();
  const dbAccess = createRecordingDbAccess(record);
  const outPath = join(fixture.root, "annotation.jsonl");
  const missingEnginePath = join(fixture.root, "not-opened", "engine.sqlite");
  try {
    const report = withEnvironment({
      MEMORY_ENGINE_CORE_DB: fixture.coreDbPath,
      MEMORY_ENGINE_DB: fixture.engineDbPath,
    }, () => exportAnnotationCandidates({
      out: outPath,
      format: "jsonl",
      limit: 10,
      dbOptions: {
        coreDbPath: fixture.coreDbPath,
        engineDbPath: missingEnginePath,
      },
      dbAccess,
      collector: () => ({
        candidates: [{
          id: "active-1",
          path: "memory/episodes/active.md",
          path_family: "episodes",
          quality_scope_family: "episode",
          quality_scope_owner: "memory_engine_lifecycle",
          category: "episodic",
          has_confidence_record: true,
          confidence: 0.8,
          retrieved_count: 0,
          injected_count: 0,
          text: "",
        }],
      }),
    }));
    const line = JSON.parse(readFileSync(outPath, "utf8").trim());
    assert.equal(report.write_db, false);
    assert.equal(line.content_preview, "active text");
    assert.equal(record.core, 1);
    assert.equal(record.engine, 0);
    assert.deepEqual(record.coreDatabaseLists[0].map(row => row.name), ["main"]);
    assert.equal(existsSync(missingEnginePath), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
