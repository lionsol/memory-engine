import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureCoreStoreCompatibility } from "../lib/db/core-store.js";
import {
  VECTOR_CHUNK_METADATA_SQL,
  loadVectorChunkMetaByIds,
} from "../lib/recall/hybrid/channels/vector.js";

function createCurrentCoreFixture() {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-vector-core-metadata-"));
  const db = new Database(join(root, "openclaw-agent.sqlite"));
  db.exec(`
    CREATE TABLE memory_index_chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      source TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT NOT NULL,
      model TEXT NOT NULL,
      text TEXT NOT NULL,
      embedding TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  const insert = db.prepare(`
    INSERT INTO memory_index_chunks
      (id, path, source, start_line, end_line, hash, model, text, embedding, updated_at)
    VALUES (?, ?, 'memory', 1, 1, 'hash', 'model', ?, ?, ?)
  `);
  insert.run("chunk-a", "memory/a.md", "alpha", "embedding sentinel A", 100);
  insert.run("chunk-b", "memory/b.md", "beta", "embedding sentinel B", 200);
  insert.run("chunk-c", "memory/c.md", "gamma", "embedding sentinel C", 300);
  ensureCoreStoreCompatibility(db);
  return { db, root };
}

function planDetails(db, sql, ...params) {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params)
    .map(row => String(row.detail ?? row[3] ?? ""));
}

test("current Core ID invariant snapshot uses a covering primary-key index", () => {
  const { db, root } = createCurrentCoreFixture();
  try {
    const details = planDetails(db, "SELECT id FROM chunks");
    assert.match(details.join("\n"), /COVERING INDEX/i);
    assert.doesNotMatch(details.join("\n"), /SCAN memory_index_chunks\s*$/i);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("candidate metadata lookup is bounded, deterministic, and uses the Core primary key", () => {
  const { db, root } = createCurrentCoreFixture();
  try {
    const calls = [];
    const metadata = loadVectorChunkMetaByIds({
      withCoreDb: run => run({
        prepare(sql) {
          calls.push(String(sql));
          return db.prepare(sql);
        },
      }),
      ids: [" chunk-b ", "", "chunk-a", "chunk-b", "missing"],
    });
    assert.deepEqual([...metadata.keys()], ["chunk-a", "chunk-b"]);
    assert.deepEqual(metadata.get("chunk-a"), {
      id: "chunk-a",
      path: "memory/a.md",
      updated_at: 100,
    });
    assert.equal(metadata.has("missing"), false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0], VECTOR_CHUNK_METADATA_SQL);

    const details = planDetails(db, VECTOR_CHUNK_METADATA_SQL, JSON.stringify(["chunk-a", "chunk-b"]));
    assert.match(details.join("\n"), /SEARCH memory_index_chunks USING (?:INDEX|INTEGER PRIMARY KEY).*\(id=\?\)/i);
    assert.doesNotMatch(details.join("\n"), /SCAN memory_index_chunks\s*$/i);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("candidate metadata helper has no unbounded Core query for an empty candidate pool", () => {
  let calls = 0;
  const metadata = loadVectorChunkMetaByIds({
    withCoreDb: () => {
      calls += 1;
      throw new Error("empty candidate pool must not open Core");
    },
    ids: ["", "  ", null],
  });
  assert.deepEqual([...metadata], []);
  assert.equal(calls, 0);
});

test("hybrid setup no longer contains the full Core metadata snapshot query", () => {
  const source = readFileSync(new URL("../lib/recall/hybrid-search.js", import.meta.url), "utf8");
  assert.match(source, /SELECT id FROM chunks/);
  assert.doesNotMatch(source, /SELECT id, path, updated_at FROM chunks/);
});
