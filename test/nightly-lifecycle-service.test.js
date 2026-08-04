import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

const NIGHTLY = new URL("../bin/nightly-maintenance-command.cjs", import.meta.url);

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-nightly-"));
  const coreDbPath = join(root, "core.sqlite");
  const engineDbPath = join(root, "engine.sqlite");
  const kgPath = join(root, "knowledge-graph.json");

  const core = new Database(coreDbPath);
  core.exec("CREATE TABLE chunks (id TEXT PRIMARY KEY, text TEXT, path TEXT)");
  const insertChunk = core.prepare("INSERT INTO chunks (id, text, path) VALUES (?, ?, ?)");
  insertChunk.run("old-pref", "prefers compact terminal output and vim keybindings", "preferences/editor-a.md");
  insertChunk.run("new-pref", "prefers compact terminal output and vim keybindings with tabs", "preferences/editor-b.md");
  insertChunk.run("low-temp", "temporary low confidence item", "temporary/item.md");
  insertChunk.run("kg-row", "knowledge graph memory", "knowledge/kg.md");
  core.close();

  const engine = new Database(engineDbPath);
  engine.exec(`
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
    CREATE TABLE memory_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT,
      memory_id TEXT,
      source TEXT,
      metadata_json TEXT
    );
  `);
  const insertConfidence = engine.prepare(`
    INSERT INTO memory_confidence
    (chunk_id, confidence, last_confidence_update, hit_count, base_tau, is_protected, is_archived, conflict_flag, category)
    VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?)
  `);
  const now = Math.floor(Date.now() / 1000);
  insertConfidence.run("old-pref", 0.2, now - 86400, 0, 30, "preference");
  insertConfidence.run("new-pref", 0.9, now, 8, 30, "preference");
  insertConfidence.run("low-temp", 0.01, now - 30 * 86400, 0, 2, "temporary");
  insertConfidence.run("kg-row", 0.8, now, 1, 90, "kg_node");
  engine.close();

  writeFileSync(kgPath, JSON.stringify({
    nodes: [{ id: "n1", name: "Node 1" }],
    edges: [{ source: "n1", target: "n2", type: "RELATED_TO" }],
  }));

  return { root, coreDbPath, engineDbPath, kgPath };
}

function runNightly(fixture, args = []) {
  const result = spawnSync(process.execPath, [NIGHTLY.pathname, ...args], {
    env: {
      ...process.env,
      MEMORY_ENGINE_DB_PATH: fixture.engineDbPath,
      MEMORY_ENGINE_CORE_DB: fixture.coreDbPath,
      MEMORY_ENGINE_KG_PATH: fixture.kgPath,
      MEMORY_ENGINE_ARCHIVE_THRESHOLD: "0.15",
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("nightly maintenance delegates lifecycle mutations and preserves dry-run", () => {
  const fixture = createFixture();
  try {
    const dry = runNightly(fixture, ["--dry-run"]);
    assert.equal(dry.dry_run, true);
    assert.equal(dry.result.detect_conflicts.flagged_as_conflict, 1);
    assert.equal(dry.result.archive.archived, 1);
    assert.equal(dry.result.kg_bridge.chunks_updated, 1);

    let engine = new Database(fixture.engineDbPath, { readonly: true });
    assert.equal(engine.prepare("SELECT conflict_flag FROM memory_confidence WHERE chunk_id = 'old-pref'").get().conflict_flag, 0);
    assert.equal(engine.prepare("SELECT is_archived FROM memory_confidence WHERE chunk_id = 'low-temp'").get().is_archived, 0);
    assert.equal(engine.prepare("SELECT kg_data FROM memory_confidence WHERE chunk_id = 'kg-row'").get().kg_data, null);
    assert.equal(engine.prepare("SELECT COUNT(*) AS count FROM memory_events").get().count, 0);
    engine.close();

    const applied = runNightly(fixture);
    assert.equal(applied.dry_run, false);
    assert.equal(applied.result.detect_conflicts.flagged_as_conflict, 1);
    assert.equal(applied.result.archive.archived, 1);
    assert.equal(applied.result.kg_bridge.chunks_updated, 1);

    engine = new Database(fixture.engineDbPath, { readonly: true });
    assert.equal(engine.prepare("SELECT conflict_flag FROM memory_confidence WHERE chunk_id = 'old-pref'").get().conflict_flag, 1);
    assert.equal(engine.prepare("SELECT is_archived FROM memory_confidence WHERE chunk_id = 'low-temp'").get().is_archived, 1);
    assert.equal(engine.prepare("SELECT kg_data FROM memory_confidence WHERE chunk_id = 'kg-row'").get().kg_data !== null, true);
    assert.equal(engine.prepare("SELECT COUNT(*) AS count FROM memory_events").get().count, 4);
    engine.close();

    const core = new Database(fixture.coreDbPath, { readonly: true });
    assert.equal(core.prepare("SELECT COUNT(*) AS count FROM chunks").get().count, 4);
    core.close();
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
