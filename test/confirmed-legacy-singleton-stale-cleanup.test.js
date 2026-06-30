import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import {
  CONFIRMED_LEGACY_SINGLETON_STALE_CLEANUP_CONFIRM_TOKEN,
  collectConfirmedLegacySingletonStaleCleanupDryRun,
  applyConfirmedLegacySingletonStaleCleanup,
  renderConfirmedLegacySingletonStaleCleanupMarkdown,
} from "../lib/quality/confirmed-legacy-singleton-stale-cleanup.js";

const require = createRequire(import.meta.url);
const cli = require("../bin/cleanup-confirmed-legacy-singleton-stale.js");

async function withEnv(entries, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(entries)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function createFixture({ withConfidenceTable = true, withEventsTable = true, ftsHasIdColumn = true } = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "confirmed-legacy-singleton-stale-cleanup-"));
  const memoryDir = resolve(root, "memory");
  const coreDbPath = resolve(root, "main.sqlite");
  const engineDbPath = resolve(root, "memory-engine.sqlite");
  mkdirSync(memoryDir, { recursive: true });

  const coreDb = new Database(coreDbPath);
  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'memory',
        start_line INTEGER NOT NULL DEFAULT 1,
        end_line INTEGER NOT NULL DEFAULT 1,
        hash TEXT NOT NULL DEFAULT 'hash',
        model TEXT NOT NULL DEFAULT 'model',
        text TEXT NOT NULL DEFAULT 'body',
        embedding TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL DEFAULT 1
      );
    `);
    if (ftsHasIdColumn) {
      coreDb.exec(`
        CREATE VIRTUAL TABLE chunks_fts USING fts5(
          text,
          id UNINDEXED,
          path UNINDEXED,
          source UNINDEXED,
          model UNINDEXED,
          start_line UNINDEXED,
          end_line UNINDEXED
        );
      `);
    } else {
      coreDb.exec(`
        CREATE VIRTUAL TABLE chunks_fts USING fts5(
          text,
          path UNINDEXED,
          source UNINDEXED,
          model UNINDEXED,
          start_line UNINDEXED,
          end_line UNINDEXED
        );
      `);
    }
  } finally {
    coreDb.close();
  }

  const engineDb = new Database(engineDbPath);
  try {
    if (withConfidenceTable) {
      engineDb.exec(`
        CREATE TABLE memory_confidence (
          chunk_id TEXT PRIMARY KEY,
          confidence REAL DEFAULT 0.5,
          category TEXT DEFAULT 'daily',
          is_archived INTEGER DEFAULT 0
        );
      `);
    }
    if (withEventsTable) {
      engineDb.exec(`
        CREATE TABLE memory_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT,
          session_id TEXT,
          trace_id TEXT,
          memory_id TEXT,
          latency_ms REAL,
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
    }
  } finally {
    engineDb.close();
  }

  return { root, memoryDir, coreDbPath, engineDbPath };
}

function insertChunk(coreDbPath, { id, path = "memory/daily.md", text = "stale singleton chunk" } = {}) {
  const db = new Database(coreDbPath);
  try {
    db.prepare(`
      INSERT INTO chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
      VALUES (?, ?, 'memory', 1, 1, ?, 'mock', ?, '[]', 1)
    `).run(id, path, `hash-${id}`, text);
    const columns = db.prepare("PRAGMA table_info(chunks_fts)").all().map(row => String(row.name || ""));
    if (columns.includes("id")) {
      db.prepare(`
        INSERT INTO chunks_fts (text, id, path, source, model, start_line, end_line)
        VALUES (?, ?, ?, 'memory', 'mock', 1, 1)
      `).run(text, id, path);
    } else {
      db.prepare(`
        INSERT INTO chunks_fts (text, path, source, model, start_line, end_line)
        VALUES (?, ?, 'memory', 'mock', 1, 1)
      `).run(text, path);
    }
  } finally {
    db.close();
  }
}

function insertExtraFtsRow(coreDbPath, { id, path, text = "other row" } = {}) {
  const db = new Database(coreDbPath);
  try {
    db.prepare(`
      INSERT INTO chunks_fts (text, id, path, source, model, start_line, end_line)
      VALUES (?, ?, ?, 'memory', 'mock', 1, 1)
    `).run(text, id, path);
  } finally {
    db.close();
  }
}

function insertConfidence(engineDbPath, chunkId) {
  const db = new Database(engineDbPath);
  try {
    db.prepare(`
      INSERT INTO memory_confidence (chunk_id, confidence, category, is_archived)
      VALUES (?, 0.5, 'daily', 0)
    `).run(chunkId);
  } finally {
    db.close();
  }
}

function insertEvent(engineDbPath, { eventType, chunkId, path = "memory/daily.md" }) {
  const db = new Database(engineDbPath);
  try {
    db.prepare(`
      INSERT INTO memory_events (
        event_type, session_id, trace_id, memory_id,
        latency_ms, candidate_count, injected_count, cited_count,
        vector_score, fts_score, final_score, source, metadata_json, created_at
      ) VALUES (?, 's1', 't1', ?, 0, 0, 0, 0, 0, 0, 0, 'test', ?, '2026-06-30 00:00:00')
    `).run(eventType, chunkId, JSON.stringify({ chunk_id: chunkId, path }));
  } finally {
    db.close();
  }
}

function countRows(dbPath, tableName, whereClause = "", params = []) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${tableName}${whereClause ? ` WHERE ${whereClause}` : ""}`).get(...params);
    return Number(row?.c || 0);
  } finally {
    db.close();
  }
}

function defaultOptions(fixture, overrides = {}) {
  return {
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
    coreDbPath: fixture.coreDbPath,
    engineDbPath: fixture.engineDbPath,
    path: "memory/daily.md",
    sampleLimit: 20,
    ...overrides,
  };
}

test("parseArgs accepts expected flags", () => {
  assert.equal(cli.parseArgs(["--json"]).json, true);
  assert.equal(cli.parseArgs(["--markdown"]).markdown, true);
  assert.equal(cli.parseArgs(["--out", "/tmp/out.json"]).out, "/tmp/out.json");
  assert.equal(cli.parseArgs(["--path", "memory/daily.md"]).path, "memory/daily.md");
  const dryRun = cli.parseArgs(["--dry-run"]);
  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.apply, false);
  const apply = cli.parseArgs(["--apply", "--confirm", CONFIRMED_LEGACY_SINGLETON_STALE_CLEANUP_CONFIRM_TOKEN]);
  assert.equal(apply.apply, true);
  assert.equal(apply.dryRun, false);
  assert.equal(apply.confirm, CONFIRMED_LEGACY_SINGLETON_STALE_CLEANUP_CONFIRM_TOKEN);
  assert.equal(cli.parseArgs(["--backup-dir", "/tmp/backup"]).backupDir, "/tmp/backup");
  assert.equal(cli.parseArgs(["--sample-limit", "7"]).sampleLimit, 7);
});

test("parseArgs rejects conflicting and destructive flags", () => {
  assert.throws(() => cli.parseArgs(["--wat"]), /unknown argument/);
  assert.throws(() => cli.parseArgs(["--json", "--markdown"]), /choose exactly one output format/);
  assert.throws(() => cli.parseArgs(["--dry-run", "--apply"]), /choose exactly one mode: --dry-run or --apply/);
  assert.throws(() => cli.parseArgs(["--apply", "--dry-run"]), /choose exactly one mode: --dry-run or --apply/);
  for (const flag of ["--delete", "--archive", "--quarantine", "--fix", "--write-db", "--backfill-confidence"]) {
    assert.throws(() => cli.parseArgs([flag]), /unsupported destructive flag/);
  }
});

test("dry-run reports preflight passed and does not modify DB", () => {
  const fixture = createFixture();
  const chunkId = "9e31c92ffb496582dbb40c2d16c19fdd9e8c6d098484f7fcd1a5810b2c929f7f";
  insertChunk(fixture.coreDbPath, { id: chunkId });

  const beforeChunks = countRows(fixture.coreDbPath, "chunks");
  const beforeFts = countRows(fixture.coreDbPath, "chunks_fts");
  const report = collectConfirmedLegacySingletonStaleCleanupDryRun(defaultOptions(fixture));

  assert.equal(report.preflight_passed, true);
  assert.deepEqual(report.preflight_failures, []);
  assert.equal(report.review.exists_on_disk, false);
  assert.equal(report.review.indexed_chunk_count, 1);
  assert.deepEqual(report.review.chunk_ids, [chunkId]);
  assert.deepEqual(report.would_delete, {
    core_chunks: 1,
    core_chunks_fts: 1,
    engine_memory_confidence: 0,
  });
  assert.equal(countRows(fixture.coreDbPath, "chunks"), beforeChunks);
  assert.equal(countRows(fixture.coreDbPath, "chunks_fts"), beforeFts);
});

test("apply requires confirm token", () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, { id: "chunk-1" });
  assert.throws(
    () => applyConfirmedLegacySingletonStaleCleanup(defaultOptions(fixture)),
    /apply mode requires --confirm cleanup-confirmed-legacy-singleton-stale/,
  );
});

test("apply creates backup and deletes only exact stale singleton rows", () => {
  const fixture = createFixture();
  const backupDir = resolve(fixture.root, "backups");
  const chunkId = "chunk-1";
  insertChunk(fixture.coreDbPath, { id: chunkId, path: "memory/daily.md" });
  insertEvent(fixture.engineDbPath, { eventType: "memory_note", chunkId });

  const result = applyConfirmedLegacySingletonStaleCleanup(defaultOptions(fixture, {
    confirm: CONFIRMED_LEGACY_SINGLETON_STALE_CLEANUP_CONFIRM_TOKEN,
    backupDir,
  }));

  assert.equal(existsSync(result.backup_path), true);
  assert.deepEqual(result.deleted, {
    core_chunks: 1,
    core_chunks_fts: 1,
    engine_memory_confidence: 0,
  });
  assert.equal(result.post_apply.indexed_chunk_count, 0);
  assert.equal(countRows(fixture.coreDbPath, "chunks"), 0);
  assert.equal(countRows(fixture.coreDbPath, "chunks_fts"), 0);
  assert.equal(countRows(fixture.engineDbPath, "memory_confidence"), 0);
  assert.equal(countRows(fixture.engineDbPath, "memory_events"), 1);
});

test("apply fails closed when same path has more than one chunk id", () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, { id: "chunk-1" });
  insertChunk(fixture.coreDbPath, { id: "chunk-2" });

  assert.throws(
    () => applyConfirmedLegacySingletonStaleCleanup(defaultOptions(fixture, {
      confirm: CONFIRMED_LEGACY_SINGLETON_STALE_CLEANUP_CONFIRM_TOKEN,
    })),
    /indexed_chunk_count_must_equal_1:2/,
  );
  assert.equal(countRows(fixture.coreDbPath, "chunks"), 2);
});

test("apply fails closed when chunks_fts lacks id column", () => {
  const fixture = createFixture({ ftsHasIdColumn: false });
  insertChunk(fixture.coreDbPath, { id: "chunk-1" });

  const report = collectConfirmedLegacySingletonStaleCleanupDryRun(defaultOptions(fixture));
  assert.equal(report.preflight_passed, false);
  assert.ok(report.preflight_failures.includes("chunks_fts_missing_id_column"));
  assert.throws(
    () => applyConfirmedLegacySingletonStaleCleanup(defaultOptions(fixture, {
      confirm: CONFIRMED_LEGACY_SINGLETON_STALE_CLEANUP_CONFIRM_TOKEN,
    })),
    /preflight failed: chunks_fts_missing_id_column/,
  );
  assert.equal(countRows(fixture.coreDbPath, "chunks"), 1);
});

test("apply fails closed when same id appears under a mismatched chunks_fts path", () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, { id: "chunk-1" });
  insertExtraFtsRow(fixture.coreDbPath, { id: "chunk-1", path: "memory/other.md" });

  const report = collectConfirmedLegacySingletonStaleCleanupDryRun(defaultOptions(fixture));
  assert.equal(report.preflight_passed, false);
  assert.ok(report.preflight_failures.includes("chunks_fts_id_has_mismatched_paths:1"));
  assert.throws(
    () => applyConfirmedLegacySingletonStaleCleanup(defaultOptions(fixture, {
      confirm: CONFIRMED_LEGACY_SINGLETON_STALE_CLEANUP_CONFIRM_TOKEN,
    })),
    /chunks_fts_id_has_mismatched_paths:1/,
  );
  assert.equal(countRows(fixture.coreDbPath, "chunks"), 1);
  assert.equal(countRows(fixture.coreDbPath, "chunks_fts"), 2);
});

test("preflight fails when file exists on disk", () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, { id: "chunk-1" });
  writeFileSync(resolve(fixture.memoryDir, "daily.md"), "legacy file", "utf8");

  const report = collectConfirmedLegacySingletonStaleCleanupDryRun(defaultOptions(fixture));
  assert.equal(report.preflight_passed, false);
  assert.ok(report.preflight_failures.includes("exists_on_disk_must_be_false"));
});

test("preflight fails when indexed chunk count is zero", () => {
  const fixture = createFixture();
  const report = collectConfirmedLegacySingletonStaleCleanupDryRun(defaultOptions(fixture));
  assert.equal(report.preflight_passed, false);
  assert.ok(report.preflight_failures.includes("indexed_chunk_count_must_equal_1:0"));
});

test("preflight fails when retrieved count is non-zero", () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, { id: "chunk-1" });
  insertEvent(fixture.engineDbPath, { eventType: "memory_candidate_retrieved", chunkId: "chunk-1" });

  const report = collectConfirmedLegacySingletonStaleCleanupDryRun(defaultOptions(fixture));
  assert.equal(report.preflight_passed, false);
  assert.ok(report.preflight_failures.includes("retrieved_count_must_equal_0:1"));
});

test("preflight fails when injected count is non-zero", () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, { id: "chunk-1" });
  insertEvent(fixture.engineDbPath, { eventType: "memory_injected", chunkId: "chunk-1" });

  const report = collectConfirmedLegacySingletonStaleCleanupDryRun(defaultOptions(fixture));
  assert.equal(report.preflight_passed, false);
  assert.ok(report.preflight_failures.includes("injected_count_must_equal_0:1"));
});

test("preflight fails when confidence exists", () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, { id: "chunk-1" });
  insertConfidence(fixture.engineDbPath, "chunk-1");

  const report = collectConfirmedLegacySingletonStaleCleanupDryRun(defaultOptions(fixture));
  assert.equal(report.preflight_passed, false);
  assert.ok(report.preflight_failures.includes("has_confidence_record_count_must_equal_0:1"));
});

test("path outside memory is rejected", () => {
  const fixture = createFixture();
  assert.throws(
    () => collectConfirmedLegacySingletonStaleCleanupDryRun(defaultOptions(fixture, { path: "../daily.md" })),
    /path must stay under memory\/*/,
  );
});

test("backup creation failure aborts before delete", () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, { id: "chunk-1" });

  assert.throws(
    () => applyConfirmedLegacySingletonStaleCleanup(defaultOptions(fixture, {
      confirm: CONFIRMED_LEGACY_SINGLETON_STALE_CLEANUP_CONFIRM_TOKEN,
      __testDeps: {
        copyFileSync: () => {
          throw new Error("backup failed");
        },
      },
    })),
    /backup failed/,
  );
  assert.equal(countRows(fixture.coreDbPath, "chunks"), 1);
  assert.equal(countRows(fixture.coreDbPath, "chunks_fts"), 1);
});

test("transaction rollback works if delete phase throws", () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, { id: "chunk-1" });

  assert.throws(
    () => applyConfirmedLegacySingletonStaleCleanup(defaultOptions(fixture, {
      confirm: CONFIRMED_LEGACY_SINGLETON_STALE_CLEANUP_CONFIRM_TOKEN,
      __testDeps: {
        afterDeleteHook: () => {
          throw new Error("delete hook boom");
        },
      },
    })),
    /delete hook boom/,
  );
  assert.equal(countRows(fixture.coreDbPath, "chunks"), 1);
  assert.equal(countRows(fixture.coreDbPath, "chunks_fts"), 1);
  assert.equal(countRows(fixture.engineDbPath, "memory_confidence"), 0);
});

test("JSON output is deterministic and markdown includes confirm token and side effects", () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, { id: "chunk-1" });

  const reportA = collectConfirmedLegacySingletonStaleCleanupDryRun(defaultOptions(fixture));
  const reportB = collectConfirmedLegacySingletonStaleCleanupDryRun(defaultOptions(fixture));
  assert.equal(JSON.stringify(reportA, null, 2), JSON.stringify(reportB, null, 2));

  const markdown = renderConfirmedLegacySingletonStaleCleanupMarkdown(reportA);
  assert.match(markdown, /confirm_token_required: cleanup-confirmed-legacy-singleton-stale/);
  assert.match(markdown, /## Preflight Failures/);
  assert.match(markdown, /## Would Delete/);
  assert.match(markdown, /## Side Effects/);
});

test("main writes selected output to --out", async () => {
  const fixture = createFixture();
  insertChunk(fixture.coreDbPath, { id: "chunk-1" });
  const outPath = resolve(fixture.root, "report.md");

  const exitCode = await withEnv({
    MEMORY_ENGINE_WORKSPACE_DIR: fixture.root,
    CORE_DB_PATH: fixture.coreDbPath,
    MEMORY_ENGINE_DB_PATH: fixture.engineDbPath,
  }, () => cli.main([
    "--markdown",
    "--out", outPath,
    "--path", "memory/daily.md",
    "--sample-limit", "5",
    "--dry-run",
  ]));

  assert.equal(exitCode, 0);
  assert.equal(existsSync(outPath), true);
  assert.match(readFileSync(outPath, "utf8"), /Confirmed Legacy Singleton Stale Cleanup/);
});
