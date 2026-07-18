import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import exporter from "../bin/export-hybrid-search-observations.js";

const SCRIPT = new URL("../bin/export-hybrid-search-observations.js", import.meta.url);

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-hybrid-observations-"));
  const dbPath = join(root, "engine.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE memory_events (
      id INTEGER PRIMARY KEY,
      event_type TEXT,
      session_id TEXT,
      trace_id TEXT,
      source TEXT,
      metadata_json TEXT,
      created_at TEXT
    )
  `);
  const insert = db.prepare(`
    INSERT INTO memory_events
      (id, event_type, session_id, trace_id, source, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(
    1,
    "hybrid_search_observation",
    "session-a",
    "trace-a",
    "hybrid.auto_recall",
    JSON.stringify({ schema_version: 1, surface: "auto_recall", kg_runtime_mode: "full_fail_closed" }),
    "2026-07-01 00:00:00",
  );
  insert.run(
    2,
    "hybrid_search_observation",
    "session-b",
    "trace-b",
    "hybrid.memory_engine_search",
    JSON.stringify({ schema_version: 1, surface: "memory_engine_search", recent_runtime_mode: "full_fail_closed" }),
    "2026-07-15 00:00:00",
  );
  insert.run(
    3,
    "recall_completed",
    "session-c",
    "trace-c",
    "autoRecall",
    JSON.stringify({ surface: "auto_recall" }),
    "2026-07-16 00:00:00",
  );
  db.close();
  return { root, dbPath };
}

test("observation exporter requires an explicit DB and supports bounded filters", () => {
  assert.throws(() => exporter.parseArgs([]), /--db is required/);
  assert.deepEqual(exporter.parseArgs([
    "--db", "/tmp/engine.sqlite",
    "--since", "2026-07-02T00:00:00Z",
    "--until", "2026-07-31T00:00:00Z",
    "--surface", "memory_engine_search",
    "--format", "json",
  ]), {
    help: false,
    db: "/tmp/engine.sqlite",
    out: null,
    format: "json",
    since: "2026-07-02T00:00:00.000Z",
    until: "2026-07-31T00:00:00.000Z",
    surfaces: ["memory_engine_search"],
  });
  assert.throws(() => exporter.parseArgs([
    "--db", "/tmp/engine.sqlite",
    "--surface", "cli_search",
  ]), /--surface must be one of/);
  assert.throws(() => exporter.parseArgs([
    "--db", "/tmp/engine.sqlite",
    "--since", "2026-07-02T00:00:00",
  ]), /explicit timezone/);
});

test("exporter opens only the supplied SQLite file in readonly mode", () => {
  const source = readFileSync(SCRIPT, "utf8");
  assert.match(source, /new Database\(dbPath,[\s\S]*?readonly: true,[\s\S]*?fileMustExist: true/);
  assert.match(source, /WHERE event_type = \?/);
  assert.doesNotMatch(source, /MEMORY_ENGINE_DB_PATH|CORE_DB_PATH|ENGINE_DB_PATH|openEngineDb|withDb/);
  assert.doesNotMatch(source, /\bATTACH\b|\bINSERT\s+INTO\b|\bUPDATE\s+[A-Za-z_]\w*|\bDELETE\s+FROM\b|\bREPLACE\s+INTO\b/i);
});

test("exportObservations reads only canonical rows and preserves evidence payloads", () => {
  const fixture = createFixture();
  try {
    const allRows = exporter.exportObservations({ db: fixture.dbPath });
    assert.equal(allRows.length, 2);
    assert.deepEqual(allRows.map(row => row.id), [1, 2]);
    assert.equal(allRows.every(row => row.event_type === "hybrid_search_observation"), true);

    const filtered = exporter.exportObservations({
      db: fixture.dbPath,
      since: "2026-07-02T00:00:00.000Z",
      surfaces: ["memory_engine_search"],
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 2);
    assert.equal(JSON.parse(filtered[0].metadata_json).surface, "memory_engine_search");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("CLI writes only the explicitly requested report path", () => {
  const fixture = createFixture();
  const outPath = join(fixture.root, "observations.jsonl");
  try {
    const result = spawnSync(process.execPath, [
      SCRIPT.pathname,
      "--db", fixture.dbPath,
      "--format", "jsonl",
      "--out", outPath,
    ], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal((result.stdout || "").trim(), "");
    assert.equal((result.stderr || "").trim(), "");
    assert.equal(existsSync(outPath), true);
    const lines = readFileSync(outPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.equal(lines.length, 2);
    assert.equal(lines.every(row => row.event_type === "hybrid_search_observation"), true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
