import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const identity = require("../lib/db/stable-memory-identity.cjs");
const orphanRepair = require("../lib/checkpoint/orphan-repair.js");
const checkpoint = require("../bin/session-checkpoint.js");
const lancedb = require("@lancedb/lancedb");

function oldEngineDb() {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-stable-identity-"));
  const path = join(root, "engine.sqlite");
  const db = new Database(path);
  db.exec(`
    CREATE TABLE memory_confidence (
      chunk_id TEXT PRIMARY KEY,
      initial_confidence REAL NOT NULL DEFAULT 0.5,
      confidence REAL NOT NULL DEFAULT 0.5,
      last_confidence_update INTEGER,
      base_tau REAL NOT NULL DEFAULT 7,
      hit_count INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      is_protected INTEGER NOT NULL DEFAULT 0,
      conflict_flag INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'raw_log',
      kg_data TEXT
    )
  `);
  return { root, path, db };
}

function closeFixture(fixture) {
  fixture.db?.close();
  rmSync(fixture.root, { recursive: true, force: true });
}

test("stable writes assign one entity/doc identity, rechunk supersedes, and archive/restore preserves identity", () => {
  const fixture = oldEngineDb();
  try {
    identity.ensureStableMemoryIdentityTables(fixture.db, { addConfidenceColumns: true });
    const first = identity.assignStableMemoryIdentity(fixture.db, {
      chunkId: "core-a",
      path: "memory/smart-add/a.md",
      text: "stable text",
      nowSec: 100,
      idFactory: kind => `${kind}-one`,
    });
    const repeated = identity.assignStableMemoryIdentity(fixture.db, {
      chunkId: "core-a",
      path: "memory/smart-add/a.md",
      text: "stable text",
      nowSec: 101,
      idFactory: kind => `${kind}-different`,
    });
    assert.equal(repeated.entity.entity_id, first.entity.entity_id);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS c FROM memory_identity").get().c, 1);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS c FROM memory_confidence").get().c, 1);

    const moved = identity.assignStableMemoryIdentity(fixture.db, {
      entityId: first.entity.entity_id,
      chunkId: "core-a",
      path: "memory/smart-add/renamed-a.md",
      text: "stable text",
      operation: "move",
      nowSec: 101,
    });
    assert.equal(moved.entity.doc_uuid, first.entity.doc_uuid);
    assert.equal(fixture.db.prepare("SELECT canonical_path FROM memory_source_docs WHERE doc_uuid = ?").get(first.entity.doc_uuid).canonical_path, "memory/smart-add/renamed-a.md");
    assert.throws(
      () => identity.assignStableMemoryIdentity(fixture.db, {
        chunkId: "unmapped-move",
        path: "memory/smart-add/another-name.md",
        text: "stable text",
        operation: "move",
      }),
      error => error?.code === identity.STABLE_MEMORY_IDENTITY_CONFLICT,
    );

    const updated = identity.assignStableMemoryIdentity(fixture.db, {
      chunkId: "core-a",
      path: "memory/smart-add/renamed-a.md",
      text: "stable text edited",
      operation: "update",
      nowSec: 102,
      idFactory: kind => `${kind}-updated`,
    });
    assert.notEqual(updated.entity.entity_id, first.entity.entity_id);
    assert.equal(fixture.db.prepare("SELECT state FROM memory_identity WHERE entity_id = ?").get(first.entity.entity_id).state, "superseded");
    assert.equal(fixture.db.prepare("SELECT entity_id FROM memory_confidence WHERE chunk_id = 'core-a'").get().entity_id, updated.entity.entity_id);

    const rechunked = identity.assignStableMemoryIdentity(fixture.db, {
      chunkId: "core-a-rechunked",
      path: "memory/smart-add/renamed-a.md",
      text: "stable text",
      operation: "rechunk",
      previousEntityId: updated.entity.entity_id,
      nowSec: 103,
      idFactory: kind => `${kind}-two`,
    });
    assert.notEqual(rechunked.entity.entity_id, updated.entity.entity_id);
    assert.equal(fixture.db.prepare("SELECT state FROM memory_identity WHERE entity_id = ?").get(updated.entity.entity_id).state, "superseded");

    const archived = identity.archiveMemoryIdentity(fixture.db, rechunked.entity.entity_id, { nowSec: 104 });
    assert.equal(archived.state, "archived");
    assert.equal(fixture.db.prepare("SELECT is_archived FROM memory_confidence WHERE entity_id = ?").get(rechunked.entity.entity_id).is_archived, 1);
    const restored = identity.restoreMemoryIdentity(fixture.db, rechunked.entity.entity_id, { nowSec: 105 });
    assert.equal(restored.state, "active");
    assert.equal(fixture.db.prepare("SELECT is_archived FROM memory_confidence WHERE entity_id = ?").get(rechunked.entity.entity_id).is_archived, 0);
  } finally {
    closeFixture(fixture);
  }
});

test("old schema cannot claim stable association before the explicit migration", () => {
  const fixture = oldEngineDb();
  try {
    identity.ensureStableMemoryIdentityTables(fixture.db);
    assert.throws(
      () => identity.assignStableMemoryIdentity(fixture.db, {
        chunkId: "pre-migration",
        path: "memory/pre-migration.md",
        text: "must fail closed",
      }),
      error => error?.code === identity.STABLE_MEMORY_IDENTITY_SCHEMA_REQUIRED,
    );
    assert.equal(fixture.db.prepare("SELECT chunk_id FROM memory_confidence WHERE chunk_id = 'pre-migration'").get(), undefined);
  } finally {
    closeFixture(fixture);
  }
});

test("concurrent-style identity creation leaves one active association", () => {
  const fixture = oldEngineDb();
  const secondConnection = new Database(fixture.path);
  try {
    identity.ensureStableMemoryIdentityTables(fixture.db, { addConfidenceColumns: true });
    const first = identity.assignStableMemoryIdentity(fixture.db, {
      chunkId: "concurrent-core",
      entityId: "concurrent-one",
      path: "memory/concurrent.md",
      text: "same source",
      nowSec: 110,
    });
    const second = identity.assignStableMemoryIdentity(secondConnection, {
      chunkId: "concurrent-core",
      entityId: "concurrent-two",
      path: "memory/concurrent.md",
      text: "same source",
      nowSec: 111,
    });
    assert.equal(second.entity.entity_id, first.entity.entity_id);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS c FROM memory_identity WHERE state IN ('active', 'recovered') AND core_chunk_id_snapshot = 'concurrent-core'").get().c, 1);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS c FROM memory_confidence WHERE entity_id = 'concurrent-one'").get().c, 1);
  } finally {
    secondConnection.close();
    closeFixture(fixture);
  }
});

test("migration is additive/idempotent, consumes a 129-row recovery manifest, and detects conflicts", () => {
  const fixture = oldEngineDb();
  try {
    const insert = fixture.db.prepare("INSERT INTO memory_confidence (chunk_id, category) VALUES (?, ?)");
    insert.run("manifest-core", "preference");
    insert.run("unknown-613", "raw_log");
    insert.run("unknown-36", "raw_log");
    const manifest = Array.from({ length: 129 }, (_, index) => ({
      chunk_id: index === 0 ? "manifest-core" : `manifest-core-${index}`,
      path: `memory/recovered/${index}.md`,
      content_hash: `sha256:manifest-${index}`,
      category: index === 0 ? "preference" : "raw_log",
    }));

    const first = identity.migrateStableMemoryIdentity(fixture.db, { manifest, nowSec: 200 });
    assert.equal(first.manifest_rows, 129);
    assert.equal(first.recovered, 129);
    const manifestEntityId = identity.deterministicId("migration-entity", "core:manifest-core");
    const manifestDocUuid = identity.deterministicId("migration-doc", "core:memory/recovered/0.md");
    assert.equal(fixture.db.prepare("SELECT state FROM memory_identity WHERE entity_id = ?").get(manifestEntityId).state, "recovered");
    assert.equal(fixture.db.prepare("SELECT doc_uuid FROM memory_identity WHERE entity_id = ?").get(manifestEntityId).doc_uuid, manifestDocUuid);
    assert.equal(fixture.db.prepare("SELECT entity_id FROM memory_confidence WHERE chunk_id = 'manifest-core'").get().entity_id, manifestEntityId);
    assert.equal(fixture.db.prepare("SELECT state FROM memory_identity WHERE core_chunk_id_snapshot = 'unknown-613'").get().state, "unknown_legacy");
    assert.equal(fixture.db.prepare("SELECT state FROM memory_identity WHERE core_chunk_id_snapshot = 'unknown-36'").get().state, "unknown_legacy");
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS c FROM memory_confidence WHERE chunk_id IN ('unknown-613', 'unknown-36')").get().c, 2);

    const identityCount = fixture.db.prepare("SELECT COUNT(*) AS c FROM memory_identity").get().c;
    const second = identity.migrateStableMemoryIdentity(fixture.db, { manifest, nowSec: 201 });
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS c FROM memory_identity").get().c, identityCount);
    assert.equal(second.already_migrated, 129);

    assert.throws(
      () => identity.migrateStableMemoryIdentity(fixture.db, {
        manifest: [{ entity_id: "other-entity", doc_uuid: "other-doc", canonical_path: "memory/recovered/0.md", core_chunk_id: "manifest-core" }],
      }),
      error => error?.code === identity.STABLE_MEMORY_IDENTITY_CONFLICT,
    );
    assert.equal(fixture.db.prepare("SELECT entity_id FROM memory_confidence WHERE chunk_id = 'manifest-core'").get().entity_id, manifestEntityId);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS c FROM memory_identity_migration_map").get().c, 129);
  } finally {
    closeFixture(fixture);
  }
});

test("migration consumes the real 129-row JSONL manifest and preserves legacy Lance membership", async () => {
  const fixture = oldEngineDb();
  const manifestPath = fileURLToPath(new URL("./fixtures/stable-memory-identity/path-recovery-manifest-v1.jsonl", import.meta.url));
  try {
    const rawRows = readFileSync(manifestPath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(rawRows.length, 129);
    assert.equal(rawRows.every(row => (
      Object.hasOwn(row, "lance_id")
      && Object.hasOwn(row, "engine_memory_id")
      && Object.hasOwn(row, "core_chunk_id")
      && Object.hasOwn(row, "path")
    )), true);
    assert.equal(rawRows.filter(row => row.lance_id !== row.core_chunk_id).length, 1);

    const insertConfidence = fixture.db.prepare(
      "INSERT INTO memory_confidence (chunk_id, category) VALUES (?, 'raw_log')",
    );
    for (const row of rawRows) insertConfidence.run(row.engine_memory_id);
    const unknownVectorIds = Array.from({ length: 613 }, (_, index) => `unknown-vector-${String(index + 1).padStart(3, "0")}`);
    const unmappedMemoryIds = Array.from({ length: 36 }, (_, index) => `unmapped-memory-${String(index + 1).padStart(3, "0")}`);
    for (const id of unmappedMemoryIds) insertConfidence.run(id);

    const first = identity.migrateStableMemoryIdentity(fixture.db, {
      manifestPath,
      nowSec: 800,
    });
    assert.equal(first.manifest_rows, 129);
    assert.equal(first.recovered, 129);
    assert.equal(fixture.db.prepare(
      "SELECT COUNT(*) AS c FROM memory_identity_migration_map WHERE lance_id IS NOT NULL",
    ).get().c, 129);
    assert.equal(fixture.db.prepare(
      "SELECT COUNT(*) AS c FROM memory_identity WHERE state = 'unknown_legacy'",
    ).get().c, 36);
    const mismatch = rawRows.find(row => row.lance_id !== row.core_chunk_id);
    const mismatchMap = fixture.db.prepare(
      "SELECT lance_id, engine_memory_id, core_chunk_id, entity_id FROM memory_identity_migration_map WHERE lance_id = ?",
    ).get(mismatch.lance_id);
    assert.deepEqual({
      lance_id: mismatch.lance_id,
      engine_memory_id: mismatch.engine_memory_id,
      core_chunk_id: mismatch.core_chunk_id,
    }, mismatchMap && {
      lance_id: mismatchMap.lance_id,
      engine_memory_id: mismatchMap.engine_memory_id,
      core_chunk_id: mismatchMap.core_chunk_id,
    });
    assert.equal(fixture.db.prepare(
      "SELECT core_chunk_id_snapshot FROM memory_identity WHERE entity_id = ?",
    ).get(mismatchMap.entity_id).core_chunk_id_snapshot, mismatch.core_chunk_id);

    const second = identity.migrateStableMemoryIdentity(fixture.db, {
      manifestPath,
      nowSec: 801,
    });
    assert.equal(second.already_migrated, 129);
    assert.equal(fixture.db.prepare(
      "SELECT COUNT(*) AS c FROM memory_identity_migration_map",
    ).get().c, 129);

    const changedManifest = [...rawRows];
    changedManifest[0] = { ...changedManifest[0], core_chunk_id: "conflicting-core" };
    assert.throws(
      () => identity.migrateStableMemoryIdentity(fixture.db, { manifest: changedManifest, nowSec: 802 }),
      error => error?.code === identity.STABLE_MEMORY_IDENTITY_CONFLICT,
    );
    assert.equal(fixture.db.prepare(
      "SELECT COUNT(*) AS c FROM memory_identity_migration_map",
    ).get().c, 129);
    const retry = identity.migrateStableMemoryIdentity(fixture.db, {
      manifestPath,
      nowSec: 803,
    });
    assert.equal(retry.already_migrated, 129);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS c FROM memory_identity").get().c, 129 + 36);

    const lance = pagedLanceTable([
      ...rawRows.map(row => ({ id: row.lance_id })),
      ...unknownVectorIds.map(id => ({ id })),
    ]);
    const beforeLanceIds = [...lance.rows.keys()];
    let embeddingRequests = 0;
    const result = await runStableRepairWithTable(fixture, lance.table, {
      embedText: async () => {
        embeddingRequests += 1;
        throw new Error("historical vectors must not be re-embedded");
      },
      getCanonicalMemoriesByIds: () => { throw new Error("mapped vectors need no canonical lookup"); },
    });
    assert.equal(result.complete, true);
    assert.equal(result.repaired, 0);
    assert.equal(result.counts.present_valid, 129);
    assert.equal(result.counts.unknown_identity, 613);
    assert.equal(embeddingRequests, 0);
    assert.deepEqual([...lance.rows.keys()], beforeLanceIds);
    assert.deepEqual(
      fixture.db.prepare("SELECT chunk_id FROM memory_confidence WHERE chunk_id LIKE 'unmapped-memory-%' ORDER BY chunk_id").all().map(row => row.chunk_id),
      unmappedMemoryIds,
    );
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS c FROM memory_identity_migration_map WHERE lance_id LIKE 'unknown-vector-%'").get().c, 0);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS c FROM memory_identity_migration_map WHERE lance_id LIKE 'unmapped-memory-%'").get().c, 0);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS c FROM memory_confidence WHERE chunk_id LIKE 'unmapped-memory-%' AND entity_id IS NOT NULL").get().c, 36);
  } finally {
    closeFixture(fixture);
  }
});

test("49 identity-less confidence rows stay unknown_legacy in the offline vector regression", async () => {
  const fixture = oldEngineDb();
  try {
    const insert = fixture.db.prepare("INSERT INTO memory_confidence (chunk_id, category) VALUES (?, 'raw_log')");
    const legacyIds = Array.from({ length: 49 }, (_, index) => `legacy-confidence-${String(index + 1).padStart(2, "0")}`);
    for (const id of legacyIds) insert.run(id);

    const migration = identity.migrateStableMemoryIdentity(fixture.db, { manifest: [], nowSec: 850 });
    assert.equal(migration.unknown_legacy, 49);
    assert.equal(fixture.db.prepare(
      "SELECT COUNT(*) AS c FROM memory_identity WHERE state = 'unknown_legacy'",
    ).get().c, 49);
    assert.equal(fixture.db.prepare(
      "SELECT COUNT(*) AS c FROM memory_confidence WHERE entity_id IS NULL",
    ).get().c, 0);

    const lance = pagedLanceTable(legacyIds.map(id => ({ id })));
    let embeddingCalls = 0;
    const result = await runStableRepairWithTable(fixture, lance.table, {
      embedText: async () => {
        embeddingCalls += 1;
        throw new Error("unknown_legacy rows must not be embedded");
      },
      getCanonicalMemoriesByIds: () => {
        throw new Error("unknown_legacy rows must not resolve canonical content");
      },
    });
    assert.equal(result.complete, true);
    assert.equal(result.repaired, 0);
    assert.equal(result.counts.unknown_identity, 49);
    assert.equal(embeddingCalls, 0);
    assert.deepEqual([...lance.rows.keys()], legacyIds);
  } finally {
    closeFixture(fixture);
  }
});

test("a recovered entity whose Core snapshot disappeared leaves global convergence without backlog", async () => {
  const fixture = oldEngineDb();
  try {
    identity.migrateStableMemoryIdentity(fixture.db, {
      manifest: [{
        lance_id: "legacy-recovered-vector",
        engine_memory_id: "legacy-recovered-engine",
        core_chunk_id: "core-snapshot-that-disappeared",
        path: "memory/smart-add/reindexed.md",
      }],
      nowSec: 820,
    });
    const before = fixture.db.prepare("SELECT entity_id, state FROM memory_identity").get();
    assert.equal(before.state, "recovered");
    const lifecycle = identity.markMissingCoreSnapshotsUnknown(
      fixture.db,
      ["core-current-after-reindex"],
      { nowSec: 821 },
    );
    assert.equal(lifecycle.changed, 1);
    assert.equal(fixture.db.prepare("SELECT state FROM memory_identity WHERE entity_id = ?").get(before.entity_id).state, "unknown_legacy");
    const lance = pagedLanceTable([{ id: "legacy-recovered-vector" }]);
    let embeddings = 0;
    const result = await runStableRepairWithTable(fixture, lance.table, {
      embedText: async () => {
        embeddings += 1;
        throw new Error("disappeared Core snapshots must not be embedded");
      },
      getCanonicalMemoriesByIds: () => { throw new Error("unknown recovered vectors need no canonical lookup"); },
    });
    assert.equal(result.complete, true);
    assert.equal(result.remaining_backlog, 0);
    assert.equal(result.repair_failed, 0);
    assert.equal(embeddings, 0);
  } finally {
    closeFixture(fixture);
  }
});

function fakeLanceTable(initialRows) {
  const rows = new Map(initialRows.map(row => [String(row.id), { ...row }]));
  const calls = { query: 0, select: 0, add: 0 };
  const table = {
    query() {
      calls.query += 1;
      let limit = 400;
      let offset = 0;
      const query = {
        select() { calls.select += 1; return query; },
        limit(value) { limit = Number(value); return query; },
        offset(value) { offset = Number(value); return query; },
        async toArray() { return [...rows.values()].slice(offset, offset + limit).map(row => ({ ...row })); },
      };
      return query;
    },
    async add(newRows) {
      calls.add += 1;
      for (const row of newRows) rows.set(String(row.id), { ...row });
    },
  };
  return { table, rows, calls };
}

function pagedLanceTable(initialRows, {
  failOnceAtOffset = null,
  mutateAfterFirstPage = false,
  mutateMembersSameCount = false,
  failFirstAdd = false,
  withFingerprint = true,
  schemaFailure = false,
  queryFailure = false,
} = {}) {
  const rows = new Map(initialRows.map(row => [String(row.id), { ...row }]));
  const state = { version: 1, failed: false, pageCalls: 0, addCalls: 0 };
  const fields = [
    { name: "id" },
    { name: "text" },
    { name: "doc_uuid" },
    ...(withFingerprint ? [{ name: "embedding_fingerprint" }] : []),
    { name: "vector", type: { listSize: 3 } },
  ];
  const table = {
    async schema() {
      if (schemaFailure) throw new Error("schema unavailable");
      return { fields };
    },
    async version() { return state.version; },
    async countRows() { return rows.size; },
    query() {
      let limit = 400;
      let offset = 0;
      let predicate = null;
      const query = {
        select() { return query; },
        limit(value) { limit = Number(value); return query; },
        offset(value) { offset = Number(value); return query; },
        where(value) { predicate = String(value); return query; },
        async toArray() {
          state.pageCalls += 1;
          if (queryFailure) throw new Error("Lance query unavailable");
          if (failOnceAtOffset !== null && offset >= failOnceAtOffset && !state.failed) {
            state.failed = true;
            throw new Error("interrupted pagination");
          }
          let values = [...rows.values()];
          if (predicate) {
            const requested = [...predicate.matchAll(/'((?:''|[^'])*)'/g)]
              .map(match => match[1].replace(/''/g, "'"));
            values = values.filter(row => requested.includes(String(row.id)));
          } else {
            values = values.slice(offset, offset + limit);
          }
          if ((mutateAfterFirstPage || mutateMembersSameCount) && state.pageCalls === 1) {
            if (mutateMembersSameCount) {
              rows.clear();
              rows.set("dataset-change-member", { id: "dataset-change-member", embedding_fingerprint: "sha256:unknown" });
            } else {
              rows.set("dataset-change", { id: "dataset-change", embedding_fingerprint: "sha256:unknown" });
              state.version += 1;
            }
          }
          return values.map(row => ({ ...row }));
        },
      };
      return query;
    },
    async add(newRows) {
      state.addCalls += 1;
      if (failFirstAdd && state.addCalls === 1) throw new Error("cross-store vector write failed");
      for (const row of newRows) {
        if (rows.has(String(row.id))) throw new Error(`duplicate ${row.id}`);
        rows.set(String(row.id), { ...row });
      }
      state.version += 1;
    },
  };
  return { table, rows, state };
}

async function runStableRepairWithTable(fixture, table, options = {}) {
  const lancedbModule = require.resolve("@lancedb/lancedb");
  const previous = require.cache[lancedbModule];
  require.cache[lancedbModule] = {
    id: lancedbModule,
    filename: lancedbModule,
    loaded: true,
    exports: { connect: async () => ({ openTable: async () => table }) },
  };
  try {
    return await checkpoint.withRuntime({
      workspaceDir: fixture.root,
      memoryDir: fixture.root,
      lancedbDir: join(fixture.root, "paged-lance"),
      coreDbPath: join(fixture.root, "core.sqlite"),
      engineDbPath: fixture.path,
      configJsonPath: join(fixture.root, "openclaw.json"),
      now: () => 1700000000000,
    }, () => orphanRepair.repairOrphanVectors({
      authorization: "stable-memory-identity-global-maintenance",
      pageSize: 1,
      maxRows: 2000,
      embeddingDimension: 3,
      embedText: async () => [0.2, 0.3, 0.4],
      getCanonicalMemoriesByIds: ids => ({
        ok: true,
        results: ids.map(id => ({
          memory_id: id,
          ok: true,
          memory: {
            memory_id: id,
            canonical_id: `canonical:${id}`,
            source: { text: `canonical-${id}` },
            content_ref: { content_hash: `sha256:${id}` },
          },
        })),
      }),
      ...options,
    }));
  } finally {
    if (previous) require.cache[lancedbModule] = previous;
    else delete require.cache[lancedbModule];
  }
}

test("global convergence pages with query/select, classifies four ways, repairs only real stable identities, and is idempotent", async () => {
  const fixture = oldEngineDb();
  const lanceRoot = join(fixture.root, "lancedb");
  const configPath = join(fixture.root, "openclaw.json");
  const corePath = join(fixture.root, "core.sqlite");
  const core = new Database(corePath);
  core.exec("CREATE TABLE chunks (id TEXT PRIMARY KEY, path TEXT, source TEXT, start_line INTEGER, end_line INTEGER, hash TEXT, text TEXT, updated_at INTEGER)");
  core.close();
  const identityRows = [];
  identity.ensureStableMemoryIdentityTables(fixture.db, { addConfidenceColumns: true });
  const addStable = (chunkId, entityId, fingerprint = null) => {
    const result = identity.assignStableMemoryIdentity(fixture.db, {
      chunkId,
      entityId,
      path: `memory/stable/${chunkId}.md`,
      text: `text-${chunkId}`,
      embeddingFingerprint: fingerprint,
      nowSec: 300,
    });
    identityRows.push(result.entity);
    return result.entity;
  };
  const valid = addStable("chunk-valid", "entity-valid", identity.embeddingFingerprint([1, 0]));
  const missing = addStable("chunk-missing", "entity-missing", null);
  const stale = addStable("chunk-stale", "entity-stale", identity.embeddingFingerprint([0, 0, 1]));
  const unknown = addStable("chunk-unknown", "entity-unknown", null);
  identity.transitionMemoryIdentity(fixture.db, unknown.entity_id, "unknown_legacy", { nowSec: 301 });
  const lance = fakeLanceTable([
    { id: valid.entity_id, doc_uuid: valid.doc_uuid, embedding_fingerprint: valid.embedding_fingerprint },
    { id: stale.entity_id, doc_uuid: stale.doc_uuid, embedding_fingerprint: stale.embedding_fingerprint },
    { id: "legacy-vector-613", embedding_fingerprint: "sha256:legacy" },
    { id: "legacy-vector-36", embedding_fingerprint: "sha256:legacy-36" },
  ]);
  const lancedbModule = require.resolve("@lancedb/lancedb");
  const previous = require.cache[lancedbModule];
  require.cache[lancedbModule] = {
    id: lancedbModule,
    filename: lancedbModule,
    loaded: true,
    exports: { connect: async () => ({ openTable: async () => lance.table }) },
  };
  try {
    const result = await checkpoint.withRuntime({
      workspaceDir: fixture.root,
      memoryDir: fixture.root,
      lancedbDir: lanceRoot,
      coreDbPath: corePath,
      engineDbPath: fixture.path,
      configJsonPath: configPath,
      now: () => 1700000000000,
    }, () => orphanRepair.repairOrphanVectors({
      authorization: "stable-memory-identity-global-maintenance",
      pageSize: 2,
      maxRows: 20,
      embedText: async () => [0.25, 0.5],
      getCanonicalMemoriesByIds: ids => ({
        ok: true,
        results: ids.map(id => ({
          memory_id: id,
          ok: true,
          memory: {
            memory_id: id,
            canonical_id: `canonical:${id}`,
            source: { text: `canonical-${id}` },
            content_ref: { content_hash: `sha256:${id}` },
          },
        })),
      }),
    }));
    assert.equal(result.complete, true);
    assert.deepEqual(result.counts, {
      present_valid: 2,
      missing: 1,
      unknown_identity: 2,
      stale: 0,
    });
    assert.equal(result.repaired, 1);
    assert.equal(lance.calls.query > 0, true);
    assert.equal(lance.calls.select > 0, true);
    assert.equal(lance.calls.add, 1);
    const added = [...lance.rows.values()].find(row => row.id === missing.entity_id);
    assert.equal(added.id, missing.entity_id);
    assert.equal(added.doc_uuid, missing.doc_uuid);
    assert.equal(typeof added.embedding_fingerprint, "string");
    assert.equal([...lance.rows.keys()].includes("legacy-vector-613"), true);
    assert.equal([...lance.rows.keys()].includes("legacy-vector-36"), true);

    const second = await checkpoint.withRuntime({
      workspaceDir: fixture.root,
      memoryDir: fixture.root,
      lancedbDir: lanceRoot,
      coreDbPath: corePath,
      engineDbPath: fixture.path,
      configJsonPath: configPath,
      now: () => 1700000000000,
    }, () => orphanRepair.repairOrphanVectors({
      authorization: "stable-memory-identity-global-maintenance",
      pageSize: 2,
      maxRows: 20,
      embedText: async () => { throw new Error("provider must not be called for an idempotent run"); },
      getCanonicalMemoriesByIds: () => { throw new Error("canonical lookup must not be called for an idempotent run"); },
    }));
    assert.equal(second.repaired, 0);
    assert.equal(fixture.db.prepare("SELECT status FROM memory_identity_convergence_checkpoint WHERE checkpoint_key = 'global'").get().status, "complete");
  } finally {
    if (previous) require.cache[lancedbModule] = previous;
    else delete require.cache[lancedbModule];
    closeFixture(fixture);
  }
});

test("global recovery resolves migrated Engine/Core aliases by current Core snapshot and is idempotent", async () => {
  const fixture = oldEngineDb();
  const manifestPath = fileURLToPath(new URL("./fixtures/stable-memory-identity/path-recovery-manifest-v1.jsonl", import.meta.url));
  try {
    const rows = readFileSync(manifestPath, "utf8").trim().split(/\r?\n/).map(JSON.parse);
    const mismatch = rows.find(row => row.engine_memory_id !== row.core_chunk_id);
    const insert = fixture.db.prepare("INSERT INTO memory_confidence (chunk_id, category) VALUES (?, 'raw_log')");
    for (const row of rows) insert.run(row.engine_memory_id);
    identity.migrateStableMemoryIdentity(fixture.db, { manifestPath, nowSec: 900 });

    const mappedRows = fixture.db.prepare(`
      SELECT entity_id, engine_memory_id, core_chunk_id
      FROM memory_identity_migration_map
    `).all();
    const lanceRows = [];
    for (const row of mappedRows) {
      if (row.engine_memory_id === mismatch.engine_memory_id) continue;
      const fingerprint = `sha256:existing-${row.entity_id}`;
      fixture.db.prepare(`
        UPDATE memory_identity
        SET embedding_model = 'Qwen/Qwen3-Embedding-4B', embedding_fingerprint = ?
        WHERE entity_id = ?
      `).run(fingerprint, row.entity_id);
      fixture.db.prepare(`
        UPDATE memory_confidence
        SET embedding_model = 'Qwen/Qwen3-Embedding-4B', embedding_fingerprint = ?
        WHERE entity_id = ?
      `).run(fingerprint, row.entity_id);
      lanceRows.push({ id: row.entity_id, embedding_fingerprint: fingerprint });
    }

    const lance = pagedLanceTable(lanceRows);
    const canonicalCalls = [];
    let embeddingCalls = 0;
    const first = await runStableRepairWithTable(fixture, lance.table, {
      embedText: async text => {
        embeddingCalls += 1;
        assert.match(String(text), /canonical-/);
        return [0.2, 0.3, 0.4];
      },
      getCanonicalMemoriesByIds: ids => {
        canonicalCalls.push([...ids]);
        return {
          ok: true,
          results: ids.map(id => ({
            memory_id: id,
            ok: true,
            memory: {
              memory_id: id,
              canonical_id: `canonical:${id}`,
              source: { text: `canonical-${id}` },
              content_ref: { content_hash: `sha256:${id}` },
            },
          })),
        };
      },
    });
    assert.equal(first.complete, true);
    assert.equal(first.repaired, 1);
    assert.deepEqual(canonicalCalls, [[mismatch.core_chunk_id]]);
    assert.equal(embeddingCalls, 1);
    const mismatchEntity = fixture.db.prepare(
      "SELECT entity_id FROM memory_identity_migration_map WHERE engine_memory_id = ?",
    ).get(mismatch.engine_memory_id).entity_id;
    assert.equal(lance.rows.has(mismatchEntity), true);
    assert.equal(lance.rows.get(mismatchEntity).text, `canonical-${mismatch.core_chunk_id}`);

    const second = await runStableRepairWithTable(fixture, lance.table, {
      embedText: async () => { throw new Error("idempotent recovery must not embed again"); },
      getCanonicalMemoriesByIds: () => { throw new Error("idempotent recovery must not query canonical content"); },
    });
    assert.equal(second.complete, true);
    assert.equal(second.repaired, 0);
    assert.equal(lance.state.addCalls, 1);
    assert.equal(embeddingCalls, 1);
  } finally {
    closeFixture(fixture);
  }
});

test("real temporary legacy LanceDB schema is enumerated and written without optional identity columns", async () => {
  const fixture = oldEngineDb();
  const lanceRoot = join(fixture.root, "real-lancedb");
  try {
    identity.ensureStableMemoryIdentityTables(fixture.db, { addConfidenceColumns: true });
    const missing = identity.assignStableMemoryIdentity(fixture.db, {
      chunkId: "real-schema-missing",
      entityId: "real-schema-entity",
      path: "memory/real-schema.md",
      text: "real schema source",
      nowSec: 400,
    }).entity;
    const lanceDb = await lancedb.connect(lanceRoot);
    const table = await lanceDb.createTable("chunks", [
      { id: "legacy-vector", text: "legacy", vector: [0.1, 0.2, 0.3], timestamp: 1 },
    ]);
    const enumerated = await orphanRepair.enumerateLanceRows(table, {
      pageSize: 10,
      maxRows: 10,
    });
    assert.deepEqual(enumerated.rows.map(row => ({ id: row.id })), [{ id: "legacy-vector" }]);

    const result = await checkpoint.withRuntime({
      workspaceDir: fixture.root,
      memoryDir: fixture.root,
      lancedbDir: lanceRoot,
      coreDbPath: join(fixture.root, "core.sqlite"),
      engineDbPath: fixture.path,
      configJsonPath: join(fixture.root, "openclaw.json"),
      now: () => 1700000000000,
    }, () => orphanRepair.repairOrphanVectors({
      authorization: "stable-memory-identity-global-maintenance",
      pageSize: 10,
      maxRows: 10,
      embeddingDimension: 3,
      embedText: async () => [0.2, 0.3, 0.4],
      getCanonicalMemoriesByIds: ids => ({
        ok: true,
        results: ids.map(id => ({
          memory_id: id,
          ok: true,
          memory: {
            memory_id: id,
            canonical_id: `canonical:${id}`,
            source: { text: `canonical-${id}` },
            content_ref: { content_hash: `sha256:${id}` },
          },
        })),
      }),
    }));
    assert.equal(result.complete, true);
    assert.equal(result.repaired, 1);
    const refreshedTable = await (await lancedb.connect(lanceRoot)).openTable("chunks");
    const rows = await refreshedTable.query().select(["id", "text", "vector", "timestamp"]).toArray();
    assert.equal(rows.some(row => row.id === missing.entity_id), true);
    const addedRow = rows.find(row => row.id === missing.entity_id);
    assert.deepEqual(["id", "text", "timestamp", "vector"].every(key => addedRow[key] !== undefined), true);
    assert.equal(fixture.db.prepare("SELECT embedding_fingerprint FROM memory_identity WHERE entity_id = ?").get(missing.entity_id).embedding_fingerprint.startsWith("sha256:"), true);
  } finally {
    closeFixture(fixture);
  }
});

test("global convergence handles more than 1,000 records with bounded pages", async () => {
  const fixture = oldEngineDb();
  const initialRows = [];
  try {
    identity.ensureStableMemoryIdentityTables(fixture.db, { addConfidenceColumns: true });
    const insertDoc = fixture.db.prepare("INSERT INTO memory_source_docs (doc_uuid, source, canonical_path, created_at, updated_at) VALUES (?, 'core', ?, 500, 500)");
    const insertIdentity = fixture.db.prepare("INSERT INTO memory_identity (entity_id, doc_uuid, core_chunk_id_snapshot, content_hash, state, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 500, 500)");
    const insertConfidence = fixture.db.prepare("INSERT INTO memory_confidence (chunk_id, entity_id, content_hash) VALUES (?, ?, ?)");
    fixture.db.transaction(() => {
      for (let index = 0; index < 1001; index += 1) {
        const chunkId = `scale-${index}`;
        const entityId = `scale-entity-${index}`;
        const docUuid = `scale-doc-${index}`;
        const contentHash = `sha256:scale-${index}`;
        insertDoc.run(docUuid, `memory/scale/${index}.md`);
        insertIdentity.run(entityId, docUuid, chunkId, contentHash);
        insertConfidence.run(chunkId, entityId, contentHash);
        if (index !== 1000) initialRows.push({ id: entityId });
      }
    })();
    const lance = pagedLanceTable(initialRows);
    const result = await runStableRepairWithTable(fixture, lance.table, { pageSize: 100 });
    assert.equal(result.complete, true);
    assert.equal(result.repaired, 1);
    assert.equal(result.remaining_backlog, 0);
    assert.equal(lance.rows.size, 1001);
    assert.equal(lance.state.pageCalls >= 10, true);
  } finally {
    closeFixture(fixture);
  }
});

test("global convergence clamps ordinary parameters to hard scan/write/provider caps", async () => {
  const fixture = oldEngineDb();
  try {
    identity.ensureStableMemoryIdentityTables(fixture.db, { addConfidenceColumns: true });
    for (let index = 0; index < 20; index += 1) {
      identity.assignStableMemoryIdentity(fixture.db, {
        chunkId: `capped-core-${index}`,
        entityId: `capped-entity-${index}`,
        path: `memory/capped/${index}.md`,
        text: `capped ${index}`,
        nowSec: 720,
      });
    }
    const lance = pagedLanceTable([]);
    let embeddings = 0;
    const result = await runStableRepairWithTable(fixture, lance.table, {
      pageSize: 999999,
      maxRows: 999999,
      maxWrites: 999999,
      embedText: async () => {
        embeddings += 1;
        return [0.2, 0.3, 0.4];
      },
    });
    assert.equal(result.complete, false);
    assert.equal(result.repaired, orphanRepair.MAX_LANCE_WRITES_PER_CYCLE);
    assert.equal(embeddings, orphanRepair.MAX_PROVIDER_REQUESTS_PER_CYCLE);
    assert.equal(result.checkpoint.pageSize, 400);
    assert.equal(result.checkpoint.maxRows, 5000);
    assert.equal(result.remaining_backlog, 10);
  } finally {
    closeFixture(fixture);
  }
});

test("interrupted pagination persists a resumable checkpoint and recovers", async () => {
  const fixture = oldEngineDb();
  try {
    identity.ensureStableMemoryIdentityTables(fixture.db, { addConfidenceColumns: true });
    identity.assignStableMemoryIdentity(fixture.db, {
      chunkId: "interrupt-1",
      entityId: "interrupt-entity-1",
      path: "memory/interrupt-1.md",
      text: "interrupt one",
      nowSec: 600,
    });
    identity.assignStableMemoryIdentity(fixture.db, {
      chunkId: "interrupt-2",
      entityId: "interrupt-entity-2",
      path: "memory/interrupt-2.md",
      text: "interrupt two",
      nowSec: 600,
    });
    const lance = pagedLanceTable([{ id: "interrupt-entity-1" }], { failOnceAtOffset: 1 });
    const first = await runStableRepairWithTable(fixture, lance.table);
    assert.equal(first.complete, false);
    assert.equal(first.completion_state, "failed");
    assert.equal(fixture.db.prepare("SELECT offset, status FROM memory_identity_convergence_checkpoint WHERE checkpoint_key = 'global'").get().offset, 1);
    const second = await runStableRepairWithTable(fixture, lance.table);
    assert.equal(second.complete, true);
    assert.equal(second.repaired, 1);
    assert.equal(lance.rows.has("interrupt-entity-2"), true);
  } finally {
    closeFixture(fixture);
  }
});

test("dataset changes invalidate an unsafe recovery checkpoint before writes", async () => {
  const fixture = oldEngineDb();
  try {
    identity.ensureStableMemoryIdentityTables(fixture.db, { addConfidenceColumns: true });
    identity.assignStableMemoryIdentity(fixture.db, {
      chunkId: "dataset-change",
      entityId: "dataset-change-entity",
      path: "memory/dataset-change.md",
      text: "dataset change",
      nowSec: 700,
    });
    const lance = pagedLanceTable([], { mutateAfterFirstPage: true });
    const first = await runStableRepairWithTable(fixture, lance.table);
    assert.equal(first.complete, false);
    assert.equal(first.completion_state, "dataset_changed");
    assert.equal(first.repaired, 0);
    assert.equal(lance.state.addCalls, 0);
  } finally {
    closeFixture(fixture);
  }
});

test("same-count Lance membership changes invalidate the dataset checkpoint", async () => {
  const fixture = oldEngineDb();
  try {
    identity.ensureStableMemoryIdentityTables(fixture.db, { addConfidenceColumns: true });
    const lance = pagedLanceTable([{ id: "member-before" }], { mutateMembersSameCount: true });
    const result = await runStableRepairWithTable(fixture, lance.table, {
      embedText: async () => { throw new Error("dataset mutation must stop before embedding"); },
    });
    assert.equal(result.complete, false);
    assert.equal(result.completion_state, "dataset_changed");
    assert.equal(result.dataset_changed, true);
    assert.equal(lance.state.addCalls, 0);
    assert.notEqual(orphanRepair.stableJson({ members: ["member-before"] }), orphanRepair.stableJson({ members: ["member-after"] }));
  } finally {
    closeFixture(fixture);
  }
});

test("dataset identity serialization includes every stable identity and membership dimension", () => {
  const base = {
    entity_id: "entity-a",
    state: "active",
    core_chunk_id_snapshot: "core-a",
    embedding_model: "model-a",
    embedding_fingerprint: "sha256:a",
    members: ["member-a"],
  };
  for (const [field, value] of [
    ["entity_id", "entity-b"],
    ["state", "recovered"],
    ["core_chunk_id_snapshot", "core-b"],
    ["embedding_model", "model-b"],
    ["embedding_fingerprint", "sha256:b"],
    ["members", ["member-b"]],
  ]) {
    assert.notEqual(
      orphanRepair.stableJson(base),
      orphanRepair.stableJson({ ...base, [field]: value }),
      `dataset identity must include ${field}`,
    );
  }
  assert.notEqual(orphanRepair.stableJson({ value: undefined }), orphanRepair.stableJson({ value: null }));
});

test("invalid embeddings fail closed and never create a duplicate vector", async () => {
  const fixture = oldEngineDb();
  try {
    identity.ensureStableMemoryIdentityTables(fixture.db, { addConfidenceColumns: true });
    identity.assignStableMemoryIdentity(fixture.db, {
      chunkId: "invalid-embedding",
      entityId: "invalid-entity",
      path: "memory/invalid.md",
      text: "invalid embedding",
      nowSec: 800,
    });
    const lance = pagedLanceTable([]);
    const invalid = await runStableRepairWithTable(fixture, lance.table, {
      embedText: async () => [0, 0, Number.NaN],
    });
    assert.equal(invalid.complete, false);
    assert.equal(invalid.completion_state, "partial_failure");
    assert.equal(invalid.repaired, 0);
    assert.equal(lance.state.addCalls, 0);
    const valid = await runStableRepairWithTable(fixture, lance.table);
    assert.equal(valid.complete, true);
    assert.equal(valid.repaired, 1);
    assert.equal(lance.state.addCalls, 1);
  } finally {
    closeFixture(fixture);
  }
});

test("legacy Lance schema without fingerprint recovers membership without duplicate embedding", async () => {
  const fixture = oldEngineDb();
  try {
    identity.ensureStableMemoryIdentityTables(fixture.db, { addConfidenceColumns: true });
    const existing = identity.assignStableMemoryIdentity(fixture.db, {
      chunkId: "legacy-fingerprint-core",
      entityId: "legacy-fingerprint-entity",
      path: "memory/legacy-fingerprint.md",
      text: "already vectorized",
      nowSec: 740,
    }).entity;
    const lance = pagedLanceTable([{ id: existing.entity_id }], { withFingerprint: false });
    let embeddings = 0;
    const result = await runStableRepairWithTable(fixture, lance.table, {
      embedText: async () => {
        embeddings += 1;
        return [0.2, 0.3, 0.4];
      },
    });
    assert.equal(result.complete, true);
    assert.equal(result.fingerprint_verification, "unverified");
    assert.equal(result.repaired, 0);
    assert.equal(result.metadata_recovered, 0);
    assert.equal(embeddings, 0);
    assert.equal(lance.state.addCalls, 0);
    assert.equal(lance.rows.size, 1);
  } finally {
    closeFixture(fixture);
  }
});

test("fingerprint verification distinguishes consistent, missing, conflicting, and failed states", async () => {
  const runCase = async ({ rows, tableOptions, expected }) => {
    const fixture = oldEngineDb();
    try {
      identity.ensureStableMemoryIdentityTables(fixture.db, { addConfidenceColumns: true });
      const entity = identity.assignStableMemoryIdentity(fixture.db, {
        chunkId: `fingerprint-${expected}`,
        entityId: `fingerprint-entity-${expected}`,
        path: `memory/fingerprint-${expected}.md`,
        text: `fingerprint-${expected}`,
        embeddingFingerprint: identity.embeddingFingerprint([1, 0, 0]),
        nowSec: 750,
      }).entity;
      const result = await runStableRepairWithTable(
        fixture,
        pagedLanceTable(rows(entity), tableOptions).table,
        { persistCheckpoint: false },
      );
      assert.equal(result.fingerprint_verification, expected);
      return { fixture, result, entity };
    } catch (error) {
      fixture.db.close();
      rmSync(fixture.root, { recursive: true, force: true });
      throw error;
    }
  };

  const consistent = await runCase({
    rows: entity => [{ id: entity.entity_id, embedding_fingerprint: entity.embedding_fingerprint }],
    tableOptions: {},
    expected: "verified",
  });
  assert.equal(consistent.result.complete, true);
  consistent.fixture.db.close();
  rmSync(consistent.fixture.root, { recursive: true, force: true });

  const missing = await runCase({
    rows: entity => [{ id: entity.entity_id }],
    tableOptions: { withFingerprint: false },
    expected: "unverified",
  });
  assert.equal(missing.result.complete, true);
  assert.equal(missing.result.fingerprint_verification_reason, "fingerprint_column_missing");
  missing.fixture.db.close();
  rmSync(missing.fixture.root, { recursive: true, force: true });

  const conflict = await runCase({
    rows: entity => [{ id: entity.entity_id, embedding_fingerprint: "sha256:other" }],
    tableOptions: {},
    expected: "conflict",
  });
  assert.equal(conflict.result.complete, false);
  assert.equal(conflict.result.completion_state, "fingerprint_conflict");
  assert.equal(conflict.result.fingerprint_conflicts, 1);
  assert.equal(conflict.fixture.db.prepare("SELECT embedding_fingerprint FROM memory_identity WHERE entity_id = ?").get(conflict.entity.entity_id).embedding_fingerprint, conflict.entity.embedding_fingerprint);
  conflict.fixture.db.close();
  rmSync(conflict.fixture.root, { recursive: true, force: true });

  const schemaFailure = await runCase({
    rows: entity => [{ id: entity.entity_id, embedding_fingerprint: entity.embedding_fingerprint }],
    tableOptions: { schemaFailure: true },
    expected: "unverified",
  });
  assert.equal(schemaFailure.result.complete, true);
  assert.equal(schemaFailure.result.fingerprint_verification_reason, "schema_query_failed");
  schemaFailure.fixture.db.close();
  rmSync(schemaFailure.fixture.root, { recursive: true, force: true });

  const queryFailureFixture = oldEngineDb();
  try {
    identity.ensureStableMemoryIdentityTables(queryFailureFixture.db, { addConfidenceColumns: true });
    identity.assignStableMemoryIdentity(queryFailureFixture.db, {
      chunkId: "fingerprint-query-failure",
      entityId: "fingerprint-query-failure-entity",
      path: "memory/fingerprint-query-failure.md",
      text: "query failure",
      nowSec: 750,
    });
    const queryFailure = await runStableRepairWithTable(
      queryFailureFixture,
      pagedLanceTable([], { queryFailure: true }).table,
      { persistCheckpoint: false },
    );
    assert.equal(queryFailure.complete, false);
    assert.equal(queryFailure.completion_state, "failed");
    assert.equal(queryFailure.fingerprint_verification, "unverified");
    assert.equal(queryFailure.fingerprint_verification_reason, "query_failed");
  } finally {
    queryFailureFixture.db.close();
    rmSync(queryFailureFixture.root, { recursive: true, force: true });
  }
});

test("cross-store vector failure remains resumable and recovery writes once", async () => {
  const fixture = oldEngineDb();
  try {
    identity.ensureStableMemoryIdentityTables(fixture.db, { addConfidenceColumns: true });
    identity.assignStableMemoryIdentity(fixture.db, {
      chunkId: "partial-vector",
      entityId: "partial-vector-entity",
      path: "memory/partial-vector.md",
      text: "partial vector",
      nowSec: 900,
    });
    const lance = pagedLanceTable([], { failFirstAdd: true });
    const first = await runStableRepairWithTable(fixture, lance.table);
    assert.equal(first.complete, false);
    assert.equal(first.completion_state, "partial_failure");
    assert.equal(first.remaining_backlog, 1);
    assert.equal(lance.rows.has("partial-vector-entity"), false);
    const second = await runStableRepairWithTable(fixture, lance.table);
    assert.equal(second.complete, true);
    assert.equal(second.repaired, 1);
    assert.equal(lance.rows.has("partial-vector-entity"), true);
    assert.equal(lance.state.addCalls, 2);
  } finally {
    closeFixture(fixture);
  }
});

test("cross-store metadata failure is recovered from the existing vector without re-embedding", async () => {
  const fixture = oldEngineDb();
  let metadataFailure = true;
  try {
    identity.ensureStableMemoryIdentityTables(fixture.db, { addConfidenceColumns: true });
    identity.assignStableMemoryIdentity(fixture.db, {
      chunkId: "metadata-partial",
      entityId: "metadata-partial-entity",
      path: "memory/metadata-partial.md",
      text: "metadata partial",
      nowSec: 950,
    });
    const lance = pagedLanceTable([]);
    const writable = fn => {
      if (metadataFailure) throw new Error("Engine metadata unavailable");
      return fn(fixture.db);
    };
    const first = await runStableRepairWithTable(fixture, lance.table, {
      persistCheckpoint: false,
      withEngineDbWritable: writable,
    });
    assert.equal(first.complete, false);
    assert.equal(first.repaired, 0);
    assert.equal(lance.rows.has("metadata-partial-entity"), true);
    metadataFailure = false;
    const second = await runStableRepairWithTable(fixture, lance.table, {
      persistCheckpoint: false,
      withEngineDbWritable: writable,
      embedText: async () => { throw new Error("must recover metadata without embedding"); },
    });
    assert.equal(second.complete, true);
    assert.equal(second.metadata_recovered, 1);
    assert.equal(lance.state.addCalls, 1);
    assert.equal(fixture.db.prepare("SELECT embedding_fingerprint FROM memory_identity WHERE entity_id = 'metadata-partial-entity'").get().embedding_fingerprint.startsWith("sha256:"), true);
  } finally {
    closeFixture(fixture);
  }
});

test("global maintenance entry is explicit and disabled without separate authorization", async () => {
  const result = await orphanRepair.runGlobalIdentityMaintenance();
  assert.equal(result.ok, false);
  assert.equal(result.trigger, orphanRepair.GLOBAL_MAINTENANCE_TRIGGER);
  assert.equal(result.completion_state, "disabled");
  assert.equal(result.remaining_backlog, null);
  const bypass = await orphanRepair.repairOrphanVectors({
    embedText: async () => { throw new Error("unauthorized global call must not embed"); },
  });
  assert.equal(bypass.completion_state, "disabled");
  const direct = await orphanRepair.repairGlobalOrphanVectors({});
  assert.equal(direct.completion_state, "disabled");
});
