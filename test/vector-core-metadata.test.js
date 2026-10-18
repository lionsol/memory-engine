import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import { ensureCoreStoreCompatibility } from "../lib/db/core-store.js";
import {
  VECTOR_CHUNK_METADATA_SQL,
  loadVectorChunkMetaByIds,
  normalizeLanceCandidates,
} from "../lib/recall/hybrid/channels/vector.js";
import { normalizeExternalMemory, isCandidateAllowedForRerank } from "../lib/recall/hybrid/normalize-candidate.js";

const require = createRequire(import.meta.url);
const identity = require("../lib/db/stable-memory-identity.cjs");

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

test("stable Lance IDs normalize through the current Core snapshot and Engine confidence metadata", () => {
  const { db: core, root } = createCurrentCoreFixture();
  const engine = new Database(join(root, "engine.sqlite"));
  try {
    engine.exec(`
      CREATE TABLE memory_confidence (
        chunk_id TEXT PRIMARY KEY,
        initial_confidence REAL DEFAULT 0.5,
        confidence REAL DEFAULT 0.5,
        last_confidence_update INTEGER,
        base_tau REAL DEFAULT 7,
        hit_count INTEGER DEFAULT 0,
        is_archived INTEGER DEFAULT 0,
        is_protected INTEGER DEFAULT 0,
        conflict_flag INTEGER DEFAULT 0,
        category TEXT DEFAULT 'raw_log',
        entity_id TEXT,
        source_doc_id TEXT,
        content_hash TEXT,
        embedding_model TEXT,
        embedding_fingerprint TEXT
      )
    `);
    identity.ensureStableMemoryIdentityTables(engine, { addConfidenceColumns: false });
    const active = identity.assignStableMemoryIdentity(engine, {
      chunkId: "chunk-a",
      entityId: "entity-stable-a",
      path: "memory/a.md",
      text: "alpha",
      confidence: 0.91,
      nowSec: 900,
    }).entity;
    const archived = identity.assignStableMemoryIdentity(engine, {
      chunkId: "chunk-b",
      entityId: "entity-archived-b",
      path: "memory/b.md",
      text: "beta",
      confidence: 0.95,
      nowSec: 900,
    }).entity;
    identity.archiveMemoryIdentity(engine, archived.entity_id, { nowSec: 901 });
    engine.prepare(`
      INSERT INTO memory_identity_migration_map
        (migration_key, source_fingerprint, entity_id, lance_id, core_chunk_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "legacy-lance-alias",
      "sha256:legacy-manifest",
      active.entity_id,
      "legacy-lance-a",
      "chunk-a",
      900,
      900,
    );

    const normalizeCandidate = row => normalizeExternalMemory(row, {
      nowSec: 1000,
      calcRealtimeConf: rowValue => rowValue.confidence,
    });
    const candidates = normalizeLanceCandidates([
      { id: "legacy-lance-a", text: "vector alpha", _distance: 0.1 },
      { id: archived.entity_id, text: "vector beta", _distance: 0.1 },
    ], {
      confidenceMap: new Map(),
      withCoreDb: fn => fn(core),
      withEngineDb: fn => fn(engine),
      normalizeCandidate,
      filterForRerank: item => isCandidateAllowedForRerank(item, 0.15),
      vectorTopK: 10,
    });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].id, "chunk-a");
    assert.equal(candidates[0].stable_entity_id, active.entity_id);
    assert.equal(candidates[0].path, "memory/a.md");
    assert.equal(candidates[0].confidence, 0.91);
    assert.equal(candidates[0].is_archived, 0);
  } finally {
    engine.close();
    core.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("hybrid setup no longer contains the full Core metadata snapshot query", () => {
  const source = readFileSync(new URL("../lib/recall/hybrid-search.js", import.meta.url), "utf8");
  assert.match(source, /SELECT id FROM chunks/);
  assert.doesNotMatch(source, /SELECT id, path, updated_at FROM chunks/);
});
