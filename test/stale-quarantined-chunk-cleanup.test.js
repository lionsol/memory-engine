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
import {
  STALE_QUARANTINED_CHUNK_CONFIRM_TOKEN,
  applyStaleQuarantinedChunkCleanup,
  auditStaleQuarantinedChunks,
} from "../lib/quality/stale-quarantined-chunk-cleanup.js";

function createFixture() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-stale-quarantine-"));
  const memoryDir = resolve(root, "memory");
  const quarantineDir = resolve(memoryDir, "legacy-daily-mirrors");
  const coreDbPath = resolve(root, "main.sqlite");
  mkdirSync(quarantineDir, { recursive: true });

  const db = new Database(coreDbPath);
  try {
    db.exec(`
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
  } finally {
    db.close();
  }

  return { root, memoryDir, quarantineDir, coreDbPath };
}

function insertChunk(coreDbPath, { id, path, text = "body" }) {
  const db = new Database(coreDbPath);
  try {
    db.prepare(`
      INSERT INTO chunks (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
      VALUES (?, ?, 'memory', 1, 1, ?, 'mock', ?, '[]', 1)
    `).run(id, path, `hash-${id}`, text);
    db.prepare(`
      INSERT INTO chunks_fts (text, id, path, source, model, start_line, end_line)
      VALUES (?, ?, ?, 'memory', 'mock', 1, 1)
    `).run(text, id, path);
  } finally {
    db.close();
  }
}

function countRows(coreDbPath, table, path) {
  const db = new Database(coreDbPath, { readonly: true });
  try {
    return Number(db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE path = ?`).get(path)?.c || 0);
  } finally {
    db.close();
  }
}

test("dry-run does not modify DB and confirmed quarantined mirror chunks enter would_delete", () => {
  const fixture = createFixture();
  const confirmedPath = "memory/2026-06-20.md";
  const existingPath = "memory/2026-06-23.md";
  const missingUnknownPath = "memory/2026-06-24.md";

  insertChunk(fixture.coreDbPath, { id: "c1", path: confirmedPath });
  insertChunk(fixture.coreDbPath, { id: "c2", path: confirmedPath });
  insertChunk(fixture.coreDbPath, { id: "e1", path: existingPath });
  insertChunk(fixture.coreDbPath, { id: "m1", path: missingUnknownPath });

  writeFileSync(resolve(fixture.quarantineDir, "2026-06-20.md"), "quarantined");
  writeFileSync(
    resolve(fixture.quarantineDir, "quarantine-log.jsonl"),
    `${JSON.stringify({
      moved_at: "2026-06-24T00:00:00.000Z",
      moved_from: confirmedPath,
      moved_to: "memory/legacy-daily-mirrors/2026-06-20.md",
      reason: "legacy_daily_mirror_candidate",
      similarity: 1,
    })}\n`,
  );
  writeFileSync(resolve(fixture.memoryDir, "2026-06-23.md"), "manual daily");

  const report = auditStaleQuarantinedChunks({
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
    coreDbPath: fixture.coreDbPath,
  });

  assert.equal(report.would_delete_chunk_count, 2);
  assert.deepEqual(report.affected_paths, [confirmedPath]);
  assert.equal(report.stale_quarantined_legacy_mirror_chunks.length, 1);
  assert.equal(report.stale_quarantined_legacy_mirror_chunks[0].chunk_count, 2);
  assert.equal(report.stale_quarantined_legacy_mirror_chunks[0].quarantine_timestamp, "2026-06-24T00:00:00.000Z");
  assert.equal(report.stale_quarantined_legacy_mirror_chunks[0].episode_format, "unknown");
  assert.equal(report.missing_file_chunks_not_in_quarantine_log.length, 1);
  assert.equal(report.missing_file_chunks_not_in_quarantine_log[0].path, missingUnknownPath);
  assert.equal(report.existing_root_daily_chunks.length, 1);
  assert.equal(report.existing_root_daily_chunks[0].path, existingPath);
  assert.equal(countRows(fixture.coreDbPath, "chunks", confirmedPath), 2);
});

test("apply deletes confirmed stale chunks but not missing-unlogged or existing root daily", () => {
  const fixture = createFixture();
  const confirmedPath = "memory/2026-06-20.md";
  const existingPath = "memory/2026-06-23.md";
  const missingUnknownPath = "memory/2026-06-24.md";

  insertChunk(fixture.coreDbPath, { id: "c1", path: confirmedPath });
  insertChunk(fixture.coreDbPath, { id: "c2", path: confirmedPath });
  insertChunk(fixture.coreDbPath, { id: "e1", path: existingPath });
  insertChunk(fixture.coreDbPath, { id: "m1", path: missingUnknownPath });

  writeFileSync(resolve(fixture.quarantineDir, "2026-06-20.md"), "quarantined");
  writeFileSync(
    resolve(fixture.quarantineDir, "quarantine-log.jsonl"),
    `${JSON.stringify({
      moved_at: "2026-06-24T00:00:00.000Z",
      moved_from: confirmedPath,
      moved_to: "memory/legacy-daily-mirrors/2026-06-20.md",
      reason: "legacy_daily_mirror_candidate",
      similarity: 1,
    })}\n`,
  );
  writeFileSync(resolve(fixture.memoryDir, "2026-06-23.md"), "manual daily");

  const result = applyStaleQuarantinedChunkCleanup({
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
    coreDbPath: fixture.coreDbPath,
    confirm: STALE_QUARANTINED_CHUNK_CONFIRM_TOKEN,
  });

  assert.equal(result.deleted_chunk_count, 2);
  assert.equal(result.deleted_fts_row_count, 2);
  assert.deepEqual(result.affected_paths, [confirmedPath]);
  assert.equal(existsSync(result.backup_path), true);
  assert.equal(countRows(fixture.coreDbPath, "chunks", confirmedPath), 0);
  assert.equal(countRows(fixture.coreDbPath, "chunks_fts", confirmedPath), 0);
  assert.equal(countRows(fixture.coreDbPath, "chunks", existingPath), 1);
  assert.equal(countRows(fixture.coreDbPath, "chunks", missingUnknownPath), 1);
});

test("missing but not in quarantine log never enters delete set", () => {
  const fixture = createFixture();
  const path = "memory/2026-06-24.md";
  insertChunk(fixture.coreDbPath, { id: "m1", path });

  const report = auditStaleQuarantinedChunks({
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
    coreDbPath: fixture.coreDbPath,
  });

  assert.equal(report.would_delete_chunk_count, 0);
  assert.equal(report.missing_file_chunks_not_in_quarantine_log.length, 1);
  assert.equal(report.missing_file_chunks_not_in_quarantine_log[0].path, path);
});

test("existing root daily chunk never enters delete set", () => {
  const fixture = createFixture();
  const path = "memory/2026-06-23.md";
  insertChunk(fixture.coreDbPath, { id: "e1", path });
  writeFileSync(resolve(fixture.memoryDir, "2026-06-23.md"), "manual daily");

  const report = auditStaleQuarantinedChunks({
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
    coreDbPath: fixture.coreDbPath,
  });

  assert.equal(report.would_delete_chunk_count, 0);
  assert.equal(report.existing_root_daily_chunks.length, 1);
  assert.equal(report.existing_root_daily_chunks[0].path, path);
});

test("v1 quarantine log entries remain eligible for stale cleanup without episode_format", () => {
  const fixture = createFixture();
  const confirmedPath = "memory/2026-06-27.md";
  insertChunk(fixture.coreDbPath, { id: "c1", path: confirmedPath });
  writeFileSync(resolve(fixture.quarantineDir, "2026-06-27.md"), "quarantined");
  writeFileSync(
    resolve(fixture.quarantineDir, "quarantine-log.jsonl"),
    `${JSON.stringify({
      moved_at: "2026-06-24T01:02:03.000Z",
      moved_from: confirmedPath,
      moved_to: "memory/legacy-daily-mirrors/2026-06-27.md",
      reason: "legacy_daily_mirror_candidate",
      similarity: 0.99,
    })}\n`,
  );

  const report = auditStaleQuarantinedChunks({
    rootDir: fixture.root,
    memoryDir: fixture.memoryDir,
    coreDbPath: fixture.coreDbPath,
  });

  assert.equal(report.would_delete_chunk_count, 1);
  assert.equal(report.stale_quarantined_legacy_mirror_chunks.length, 1);
  assert.equal(report.stale_quarantined_legacy_mirror_chunks[0].episode_format, "unknown");
  assert.equal(report.stale_quarantined_legacy_mirror_chunks[0].quarantine_timestamp, "2026-06-24T01:02:03.000Z");
});
