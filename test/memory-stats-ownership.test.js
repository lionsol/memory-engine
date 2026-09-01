import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const stats = require("../bin/memory-stats.js");

function createCoreFixture(root) {
  const coreDbPath = resolve(root, "core.sqlite");
  const db = new Database(coreDbPath);
  try {
    db.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        source TEXT NOT NULL,
        model TEXT NOT NULL,
        embedding TEXT,
        updated_at INTEGER NOT NULL
      );
    `);
    db.prepare(`
      INSERT INTO chunks (id, path, source, model, embedding, updated_at)
      VALUES (?, ?, 'memory', ?, ?, ?)
    `).run("chunk-1", "memory/2026-08-31.md", "fixture-model", "[0.1]", Date.now());
    db.prepare(`
      INSERT INTO chunks (id, path, source, model, embedding, updated_at)
      VALUES (?, ?, 'memory', ?, ?, ?)
    `).run("chunk-2", "memory/episodes/episode.md", "fixture-model", "", Date.now());
  } finally {
    db.close();
  }
  return coreDbPath;
}

function readCoreSnapshot(coreDbPath) {
  const db = new Database(coreDbPath, { readonly: true, fileMustExist: true });
  try {
    return {
      schema: db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all(),
      rows: db.prepare("SELECT id, path, source, model, embedding, updated_at FROM chunks ORDER BY id").all(),
    };
  } finally {
    db.close();
  }
}

function tableExists(db, tableName) {
  return Boolean(db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(tableName)?.name);
}

test("memory-stats observes Core read-only and persists only in Engine DB", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-stats-ownership-"));
  const workspaceDir = resolve(root, "workspace");
  const engineDbPath = resolve(root, "engine", "memory-engine.sqlite");
  mkdirSync(resolve(workspaceDir, "memory"), { recursive: true });
  const coreDbPath = createCoreFixture(root);
  const before = readCoreSnapshot(coreDbPath);

  const result = await stats.main({
    coreDbPath,
    engineDbPath,
    workspaceDir,
    dateStr: "2026-08-31",
  });

  assert.equal(result.runtime.coreDbPath, coreDbPath);
  assert.deepEqual(readCoreSnapshot(coreDbPath), before);

  const coreAfter = new Database(coreDbPath, { readonly: true, fileMustExist: true });
  try {
    assert.equal(tableExists(coreAfter, "memory_daily_stats"), false);
    assert.equal(tableExists(coreAfter, "memory_engine_events"), false);
  } finally {
    coreAfter.close();
  }

  const engine = new Database(engineDbPath, { readonly: true, fileMustExist: true });
  try {
    assert.equal(tableExists(engine, "memory_daily_stats"), true);
    assert.equal(tableExists(engine, "memory_engine_events"), false);
    assert.ok(Number(engine.prepare(
      "SELECT COUNT(*) AS c FROM memory_daily_stats WHERE date = ?",
    ).get("2026-08-31")?.c) > 0);
  } finally {
    engine.close();
  }

  const reportPath = resolve(workspaceDir, "memory/stats-history.md");
  assert.equal(existsSync(reportPath), true);
  assert.match(readFileSync(reportPath, "utf8"), /2026-08-31/);
});
