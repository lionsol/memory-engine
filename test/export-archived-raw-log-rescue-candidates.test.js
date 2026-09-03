import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { queryCandidates } = require("../bin/export-archived-raw-log-rescue-candidates.cjs");

function fileHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-archived-rescue-"));
  const coreDbPath = join(root, "core.sqlite");
  const engineDbPath = join(root, "engine", "memory-engine.sqlite");
  mkdirSync(join(root, "engine"), { recursive: true });

  const core = new Database(coreDbPath);
  core.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      updated_at INTEGER,
      text TEXT NOT NULL
    );
    INSERT INTO chunks (id, path, updated_at, text) VALUES
      ('rescue-1', 'memory/smart-add/2026-08-01.md', 10, '决定 rescue synthetic row'),
      ('active-1', 'memory/smart-add/2026-08-01.md', 11, 'rescue active row');
  `);
  core.close();

  const engine = new Database(engineDbPath);
  engine.exec(`
    CREATE TABLE memory_confidence (
      chunk_id TEXT PRIMARY KEY,
      category TEXT,
      confidence REAL,
      last_confidence_update INTEGER,
      hit_count INTEGER,
      base_tau REAL,
      conflict_flag INTEGER,
      is_archived INTEGER
    );
    INSERT INTO memory_confidence
      (chunk_id, category, confidence, last_confidence_update, hit_count, base_tau, conflict_flag, is_archived)
    VALUES ('rescue-1', 'raw_log', 0.7, 10, 2, 7, 0, 1);
  `);
  engine.close();
  return { root, coreDbPath, engineDbPath };
}

test("archived rescue export joins readonly Core and Engine handles by exact chunk id", async () => {
  const fixture = createFixture();
  const coreBefore = fileHash(fixture.coreDbPath);
  const engineBefore = fileHash(fixture.engineDbPath);
  try {
    const rows = await queryCandidates({
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
      keywords: ["rescue"],
      limit: 10,
      offset: 0,
    });

    assert.deepEqual(rows.map(row => row.chunk_id), ["rescue-1"]);
    assert.equal(rows[0].path, "memory/smart-add/2026-08-01.md");
    assert.equal(rows[0].is_archived, 1);
    assert.equal(fileHash(fixture.coreDbPath), coreBefore);
    assert.equal(fileHash(fixture.engineDbPath), engineBefore);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
