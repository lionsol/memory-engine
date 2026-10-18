import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

import { createMemoryEngineExecute } from "../lib/tools/memory-engine-actions.js";

const require = createRequire(import.meta.url);
const { ensureCheckpointTables } = require("../lib/checkpoint/db.js");
const stableIdentity = require("../lib/db/stable-memory-identity.cjs");

function createOldSchemaFixture() {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-old-schema-action-"));
  const core = new Database(join(root, "core.sqlite"));
  const engine = new Database(join(root, "engine.sqlite"));
  core.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      text TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
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
      kg_data TEXT
    )
  `);
  return { root, core, engine };
}

function createAddLanceTable({ schema = "ready", existing = false, fingerprint = null, fingerprintQueryError = false } = {}) {
  const state = { addCalls: 0, addedRows: [] };
  const table = {
    async schema() {
      if (schema === "throws") throw new Error("Lance schema unavailable");
      const fields = [
        { name: "id" },
        { name: "text" },
        { name: "vector", type: { listSize: 2 } },
      ];
      if (schema === "ready") fields.push({ name: "embedding_fingerprint" });
      return { fields };
    },
    query() {
      let predicate = "";
      let selected = [];
      const query = {
        where(value) {
          predicate = String(value);
          return query;
        },
        select(columns) {
          selected = [...columns];
          return query;
        },
        limit() {
          return query;
        },
        async toArray() {
          const ids = [...predicate.matchAll(/'((?:''|[^'])*)'/g)]
            .map(match => match[1].replace(/''/g, "'"));
          if (selected.includes("embedding_fingerprint")) {
            if (fingerprintQueryError) throw new Error("Lance fingerprint query failed");
            return ids.map(id => ({
              id,
              ...(fingerprint === null ? {} : { embedding_fingerprint: fingerprint }),
            }));
          }
          return existing ? ids.map(id => ({ id })) : [];
        },
      };
      return query;
    },
    async add(rows) {
      state.addCalls += 1;
      state.addedRows.push(...rows.map(row => ({ ...row })));
    },
  };
  return { table, state };
}

function createStableAddExecutor(fixture, lanceTable, { text = "trusted offline body" } = {}) {
  let embeddingCalls = 0;
  const execute = createMemoryEngineExecute({
    api: { config: {} },
    autoRouteCategory: () => "raw_log",
    dateStrInTimeZone: () => "2026-10-17",
    SMART_ADD_TIME_ZONE: "Asia/Shanghai",
    resolve: path.posix.resolve,
    WORKSPACE: "/tmp/ws",
    SMART_ADD_DIR: "memory/smart-add",
    buildSmartAddFingerprint: () => "stable-add-fingerprint",
    appendSmartAdd: async ({ syncRunner }) => {
      fixture.core.prepare(
        "INSERT INTO chunks (id, path, text, updated_at) VALUES (?, ?, ?, ?)",
      ).run("stable-add-core", "memory/smart-add/2026-10-17.md", text, 10);
      return { appended: true, sync: await syncRunner() };
    },
    syncIndexIfNeeded: async () => ({ synced: true }),
    catParams: () => ({ conf: 0.5, tau: 7 }),
    withCoreDb: fn => fn(fixture.core),
    withEngineDb: fn => fn(fixture.engine),
    getLancedbTable: () => lanceTable,
    generateEmbedding: async () => {
      embeddingCalls += 1;
      return [0.11, 0.22];
    },
    getCanonicalMemoryById: id => ({
      ok: true,
      memory: {
        memory_id: id,
        canonical_id: `canonical:${id}`,
        source: { text },
        content_ref: { content_hash: stableIdentity.contentHash(text) },
      },
    }),
    recordMemoryEvent: () => {},
    getMemorySearchManager: async () => ({ manager: null }),
    calcRealtimeConf: () => 0,
    existsSync: () => false,
    readFileSync: () => "",
    KG_PATH: join(fixture.root, "knowledge-graph.json"),
    batchReinforce: () => 0,
    CATEGORY_MAP: {},
    calcTau: () => 0,
  });
  return {
    execute,
    get embeddingCalls() {
      return embeddingCalls;
    },
  };
}

test("memory_engine.add preserves legacy writes and reports an unmigrated stable identity state", async () => {
  const fixture = createOldSchemaFixture();
  try {
    const execute = createMemoryEngineExecute({
      api: { config: {} },
      autoRouteCategory: () => "raw_log",
      dateStrInTimeZone: () => "2026-10-17",
      SMART_ADD_TIME_ZONE: "Asia/Shanghai",
      resolve: path.posix.resolve,
      WORKSPACE: "/tmp/ws",
      SMART_ADD_DIR: "memory/smart-add",
      buildSmartAddFingerprint: () => "old-schema-fingerprint",
      appendSmartAdd: async ({ syncRunner }) => {
        fixture.core.prepare(
          "INSERT INTO chunks (id, path, text, updated_at) VALUES (?, ?, ?, ?)",
        ).run("old-schema-core", "memory/smart-add/2026-10-17.md", "legacy body", 10);
        return { appended: true, sync: await syncRunner() };
      },
      syncIndexIfNeeded: async () => ({ synced: true }),
      catParams: () => ({ conf: 0.5, tau: 7 }),
      withCoreDb: fn => fn(fixture.core),
      withEngineDb: fn => fn(fixture.engine),
      getLancedbTable: () => null,
      generateEmbedding: async () => { throw new Error("provider must not be called"); },
      recordMemoryEvent: () => {},
      getMemorySearchManager: async () => ({ manager: null }),
      calcRealtimeConf: () => 0,
      existsSync: () => false,
      readFileSync: () => "",
      KG_PATH: join(fixture.root, "knowledge-graph.json"),
      batchReinforce: () => 0,
      CATEGORY_MAP: {},
      calcTau: () => 0,
    });

    const result = await execute("old-schema-action", { action: "add", text: "legacy body" });
    assert.equal(result.success, true);
    assert.equal(result.stable_identity_state, "unmigrated");
    assert.equal(result.lance_pending, 1);
    ensureCheckpointTables(fixture.engine);
    assert.deepEqual(
      fixture.engine.prepare("SELECT chunk_id FROM memory_confidence").all(),
      [{ chunk_id: "old-schema-core" }],
    );
    assert.equal(fixture.engine.prepare("SELECT name FROM sqlite_master WHERE name = 'memory_identity'").get(), undefined);
    assert.equal(
      fixture.engine.prepare("PRAGMA table_info(memory_confidence)").all().some(row => row.name === "entity_id"),
      false,
    );
  } finally {
    fixture.core.close();
    fixture.engine.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("memory_engine.add persists the trusted Core content hash and retries without a duplicate identity", async () => {
  const fixture = createOldSchemaFixture();
  try {
    stableIdentity.ensureStableMemoryIdentityTables(fixture.engine, { addConfidenceColumns: true });
    let appendCalls = 0;
    const execute = createMemoryEngineExecute({
      api: { config: {} },
      autoRouteCategory: () => "raw_log",
      dateStrInTimeZone: () => "2026-10-17",
      SMART_ADD_TIME_ZONE: "Asia/Shanghai",
      resolve: path.posix.resolve,
      WORKSPACE: "/tmp/ws",
      SMART_ADD_DIR: "memory/smart-add",
      buildSmartAddFingerprint: () => "stable-add-fingerprint",
      appendSmartAdd: async ({ syncRunner }) => {
        appendCalls += 1;
        if (appendCalls === 1) {
          fixture.core.prepare(
            "INSERT INTO chunks (id, path, text, updated_at) VALUES (?, ?, ?, ?)",
          ).run("stable-add-core", "memory/smart-add/2026-10-17.md", "trusted core body", 10);
        }
        return { appended: true, sync: await syncRunner() };
      },
      syncIndexIfNeeded: async () => ({ synced: true }),
      catParams: () => ({ conf: 0.5, tau: 7 }),
      withCoreDb: fn => fn(fixture.core),
      withEngineDb: fn => fn(fixture.engine),
      getLancedbTable: () => null,
      generateEmbedding: async () => { throw new Error("provider must not be called"); },
      recordMemoryEvent: () => {},
      getMemorySearchManager: async () => ({ manager: null }),
      calcRealtimeConf: () => 0,
      existsSync: () => false,
      readFileSync: () => "",
      KG_PATH: join(fixture.root, "knowledge-graph.json"),
      batchReinforce: () => 0,
      CATEGORY_MAP: {},
      calcTau: () => 0,
    });

    const first = await execute("stable-add-first", { action: "add", text: "trusted core body" });
    assert.equal(first.success, true);
    assert.equal(first.stable_identity_state, "migrated");
    assert.equal(first.lance_pending, 1);
    const expectedHash = stableIdentity.contentHash("trusted core body");
    const firstIdentity = fixture.engine.prepare(`
      SELECT mi.entity_id, mi.content_hash, mc.content_hash AS confidence_hash
      FROM memory_identity mi
      JOIN memory_confidence mc ON mc.entity_id = mi.entity_id
      WHERE mi.core_chunk_id_snapshot = 'stable-add-core'
    `).get();
    assert.equal(firstIdentity.content_hash, expectedHash);
    assert.equal(firstIdentity.confidence_hash, expectedHash);

    const second = await execute("stable-add-retry", { action: "add", text: "trusted core body" });
    assert.equal(second.success, true);
    assert.equal(second.chunks_added, 0);
    assert.equal(second.lance_pending ?? 0, 0);
    assert.equal(fixture.engine.prepare("SELECT COUNT(*) AS count FROM memory_identity WHERE core_chunk_id_snapshot = 'stable-add-core'").get().count, 1);
    assert.deepEqual(
      fixture.engine.prepare("SELECT content_hash FROM memory_identity WHERE core_chunk_id_snapshot = 'stable-add-core'").get(),
      { content_hash: expectedHash },
    );
  } finally {
    fixture.core.close();
    fixture.engine.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("memory_engine.add reports an unreadable Lance schema as unverified and keeps reconciliation pending", async () => {
  const fixture = createOldSchemaFixture();
  const lance = createAddLanceTable({ schema: "throws" });
  try {
    stableIdentity.ensureStableMemoryIdentityTables(fixture.engine, { addConfidenceColumns: true });
    const harness = createStableAddExecutor(fixture, lance.table);
    const result = await harness.execute("stable-add-schema-failure", { action: "add", text: "trusted offline body" });
    assert.equal(result.fingerprint_verification, "unverified");
    assert.equal(result.fingerprint_verification_reason, "schema_query_failed");
    assert.equal(result.derived_state, "partial");
    assert.equal(result.needs_reconcile, true);
    assert.equal(result.reconcile_reason, "embedding_metadata_unverified");
    assert.equal(result.lance_pending, 1);
    assert.equal(harness.embeddingCalls, 0);
    assert.equal(lance.state.addCalls, 0);
  } finally {
    fixture.core.close();
    fixture.engine.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("memory_engine.add reports a missing fingerprint column as unverified through the real add chain", async () => {
  const fixture = createOldSchemaFixture();
  const lance = createAddLanceTable({ schema: "missing", existing: true });
  try {
    stableIdentity.ensureStableMemoryIdentityTables(fixture.engine, { addConfidenceColumns: true });
    const harness = createStableAddExecutor(fixture, lance.table);
    const result = await harness.execute("stable-add-missing-fingerprint", { action: "add", text: "trusted offline body" });
    assert.equal(result.fingerprint_verification, "unverified");
    assert.equal(result.fingerprint_verification_reason, "fingerprint_column_missing");
    assert.equal(result.derived_state, "partial");
    assert.equal(result.needs_reconcile, true);
    assert.equal(result.lance_pending, 1);
    assert.equal(harness.embeddingCalls, 0);
    assert.equal(lance.state.addCalls, 0);
  } finally {
    fixture.core.close();
    fixture.engine.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("memory_engine.add reports a missing fingerprint value as unverified through the real add chain", async () => {
  const fixture = createOldSchemaFixture();
  const lance = createAddLanceTable({ schema: "ready", existing: true, fingerprint: null });
  try {
    stableIdentity.ensureStableMemoryIdentityTables(fixture.engine, { addConfidenceColumns: true });
    const harness = createStableAddExecutor(fixture, lance.table);
    const result = await harness.execute("stable-add-missing-fingerprint-value", { action: "add", text: "trusted offline body" });
    assert.equal(result.fingerprint_verification, "unverified");
    assert.equal(result.fingerprint_verification_reason, "fingerprint_value_missing");
    assert.equal(result.derived_state, "partial");
    assert.equal(result.needs_reconcile, true);
    assert.equal(result.lance_pending, 1);
    assert.equal(harness.embeddingCalls, 0);
    assert.equal(lance.state.addCalls, 0);
  } finally {
    fixture.core.close();
    fixture.engine.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("memory_engine.add preserves pending state when the existing fingerprint query fails", async () => {
  const fixture = createOldSchemaFixture();
  const lance = createAddLanceTable({ schema: "ready", existing: true, fingerprintQueryError: true });
  try {
    stableIdentity.ensureStableMemoryIdentityTables(fixture.engine, { addConfidenceColumns: true });
    const harness = createStableAddExecutor(fixture, lance.table);
    const result = await harness.execute("stable-add-fingerprint-query-failure", { action: "add", text: "trusted offline body" });
    assert.equal(result.fingerprint_verification, "unverified");
    assert.equal(result.fingerprint_verification_reason, "fingerprint_query_failed");
    assert.equal(result.derived_state, "partial");
    assert.equal(result.needs_reconcile, true);
    assert.equal(result.lance_pending, 1);
    assert.equal(harness.embeddingCalls, 0);
    assert.equal(lance.state.addCalls, 0);
  } finally {
    fixture.core.close();
    fixture.engine.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("memory_engine.add does not overwrite an Engine fingerprint after a Lance conflict", async () => {
  const fixture = createOldSchemaFixture();
  const lance = createAddLanceTable({ schema: "ready", existing: true, fingerprint: "sha256:lance" });
  try {
    stableIdentity.ensureStableMemoryIdentityTables(fixture.engine, { addConfidenceColumns: true });
    stableIdentity.assignStableMemoryIdentity(fixture.engine, {
      chunkId: "stable-add-core",
      entityId: "stable-add-entity",
      path: "memory/smart-add/2026-10-17.md",
      text: "trusted offline body",
      embeddingFingerprint: "sha256:engine",
      nowSec: 1,
    });
    const harness = createStableAddExecutor(fixture, lance.table);
    const result = await harness.execute("stable-add-fingerprint-conflict", { action: "add", text: "trusted offline body" });
    assert.equal(result.fingerprint_verification, "conflict");
    assert.equal(result.fingerprint_verification_reason, "embedding_fingerprint_conflict");
    assert.equal(result.derived_state, "partial");
    assert.equal(result.needs_reconcile, true);
    assert.equal(result.reconcile_reason, "embedding_fingerprint_conflict");
    assert.equal(result.lance_pending, 1);
    assert.equal(harness.embeddingCalls, 0);
    assert.equal(lance.state.addCalls, 0);
    assert.equal(
      fixture.engine.prepare("SELECT embedding_fingerprint FROM memory_identity WHERE entity_id = 'stable-add-entity'").get().embedding_fingerprint,
      "sha256:engine",
    );
  } finally {
    fixture.core.close();
    fixture.engine.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
