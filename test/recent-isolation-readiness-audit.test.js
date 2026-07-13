import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  classifySqliteStorageRows,
  evaluateRecentTextIdInvariant,
  resolveRecentIsolationReadinessDecision,
  runRecentIsolationReadinessAudit,
} from "../lib/recall/hybrid/recent-isolation-readiness-audit.js";

function createFixtureRoot() {
  return mkdtempSync(join(tmpdir(), "memory-engine-recent-readiness-"));
}

function createDbs(root) {
  const coreDbPath = join(root, "core.sqlite");
  const engineDbPath = join(root, "engine.sqlite");
  const core = new Database(coreDbPath);
  core.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      text TEXT,
      path TEXT,
      updated_at INTEGER
    );
  `);
  const engine = new Database(engineDbPath);
  engine.exec(`
    CREATE TABLE memory_confidence (
      chunk_id TEXT PRIMARY KEY,
      confidence REAL,
      last_confidence_update INTEGER,
      base_tau REAL,
      hit_count INTEGER,
      is_protected INTEGER,
      conflict_flag INTEGER,
      category TEXT,
      is_archived INTEGER,
      kg_data TEXT
    );
  `);
  return { core, engine, coreDbPath, engineDbPath };
}

function reopenReadonly({ core, engine, coreDbPath, engineDbPath }) {
  core.close();
  engine.close();
  return {
    core: new Database(coreDbPath, { readonly: true, fileMustExist: true }),
    engine: new Database(engineDbPath, { readonly: true, fileMustExist: true }),
    coreDbPath,
    engineDbPath,
  };
}

function insertChunk(db, {
  id,
  path = "memory/smart-add/sensitive-path.md",
  text = "sensitive chunk text",
  updatedAt = 1000,
}) {
  db.prepare("INSERT INTO chunks (id, text, path, updated_at) VALUES (?, ?, ?, ?)")
    .run(id, text, path, updatedAt);
}

function insertConfidence(db, {
  id,
  isArchived = 0,
}) {
  db.prepare(`
    INSERT INTO memory_confidence (
      chunk_id, confidence, last_confidence_update, base_tau, hit_count,
      is_protected, conflict_flag, category, is_archived, kg_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, 0.82, 0, 7, 3, 0, 0, "raw_log", isArchived, "secret kg data");
}

async function runFixture(seed, options = {}) {
  const root = createFixtureRoot();
  let fixture = createDbs(root);
  try {
    seed(fixture.core, fixture.engine, fixture);
    fixture = reopenReadonly(fixture);
    const result = await runRecentIsolationReadinessAudit({
      coreDb: fixture.core,
      engineDb: fixture.engine,
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
      ...options,
    });
    return { result, root, fixture };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function closeFixture({ root, fixture }) {
  if (fixture?.core?.open) fixture.core.close();
  if (fixture?.engine?.open) fixture.engine.close();
  rmSync(root, { recursive: true, force: true });
}

test("storage classifier and decision helpers fail closed on non-TEXT IDs", () => {
  assert.deepEqual(classifySqliteStorageRows([
    { storage_class: "text", count: 2 },
    { storage_class: "blob", count: 1 },
    { storage_class: "weird", count: 1 },
  ]), {
    total: 4,
    storage_classes: {
      text: 2,
      blob: 1,
      integer: 0,
      real: 0,
      null: 0,
      other: 1,
    },
    text_only: false,
    non_text_count: 2,
  });

  const invariant = evaluateRecentTextIdInvariant({
    globalCoreStorage: { text_only: false },
    globalEngineStorage: { text_only: true },
    recentCoreStorage: { text_only: true },
    archivedEngineStorage: { text_only: true },
  });
  assert.equal(invariant.passed, false);
  assert.deepEqual(invariant.failures, ["global_core_ids_non_text"]);

  assert.equal(resolveRecentIsolationReadinessDecision({
    topologyValid: true,
    stable: true,
    invariant,
  }).class, "fail_non_text_ids");
});

test("all-TEXT snapshot passes current readiness gate and reports Recent domain distributions", async () => {
  const handle = await runFixture((core, engine) => {
    insertChunk(core, { id: "sensitive-id-A", path: "memory/smart-add/sensitive-a.md", updatedAt: 1000 });
    insertChunk(core, { id: "sensitive-id-B", path: "memory/episodes/sensitive-b.md", updatedAt: 1000 });
    insertChunk(core, { id: "missing-confidence-secret", path: "memory/smart-add/missing.md", updatedAt: null });
    insertChunk(core, { id: "generated-secret", path: "memory/generated-smart-add/generated.md", updatedAt: 9000 });
    insertConfidence(engine, { id: "sensitive-id-A" });
    insertConfidence(engine, { id: "sensitive-id-B", isArchived: 1 });
    insertConfidence(engine, { id: "orphan-secret" });
  });
  try {
    const { result } = handle;
    assert.deepEqual(result.topology.core.database_names, ["main"]);
    assert.deepEqual(result.topology.engine.database_names, ["main"]);
    assert.equal(result.topology.core.readonly, true);
    assert.equal(result.topology.engine.readonly, true);
    assert.equal(result.global_id_storage.core.storage_classes.text, 4);
    assert.equal(result.global_id_storage.engine.storage_classes.text, 3);
    assert.equal(result.recent_domain.core_row_count, 3);
    assert.equal(result.recent_domain.active_row_count_under_legacy_semantics, 2);
    assert.equal(result.recent_domain.archived_excluded_count, 1);
    assert.equal(result.recent_domain.missing_confidence_count, 1);
    assert.equal(result.recent_domain.generated_smart_add_excluded_count, 1);
    assert.equal(result.recent_domain.episode_path_count, 1);
    assert.equal(result.recent_domain.smart_add_path_count, 2);
    assert.equal(result.recent_domain.null_updated_at_count, 1);
    assert.equal(result.timestamp_distribution.tie_group_count, 1);
    assert.equal(result.timestamp_distribution.rows_in_tie_groups, 2);
    assert.equal(result.timestamp_distribution.max_tie_group_size, 2);
    assert.equal(result.archived_exclusion_payload.row_count, 1);
    assert.equal(result.archived_exclusion_payload.all_text, true);
    assert.equal(result.archived_exclusion_payload.json_utf8_bytes > 0, true);
    assert.equal(result.cross_db_relationship.analysis_status, "completed");
    assert.equal(result.cross_db_relationship.recent_ids_missing_confidence, 1);
    assert.equal(result.cross_db_relationship.engine_ids_missing_core_global, 1);
    assert.equal(result.schema_contract.core_id_declared_type, "TEXT");
    assert.equal(result.schema_contract.engine_chunk_id_declared_type, "TEXT");
    assert.equal(result.schema_contract.schema_enforces_future_text_only, false);
    assert.equal(result.gates.deterministic_recent_order_complete, true);
    assert.equal(result.gates.current_snapshot_text_id_invariant, true);
    assert.equal(result.gates.current_recent_data_gate_passed, true);
    assert.equal(result.gates.production_enablement_gate_passed, false);
    assert.equal(result.decision.class, "pass_current_snapshot");
    assert.equal(result.decision.production_enablement_recommended, false);
    const json = JSON.stringify(result);
    for (const secret of [
      "sensitive-id-A",
      "sensitive-id-B",
      "missing-confidence-secret",
      "orphan-secret",
      "sensitive chunk text",
      "sensitive-a.md",
      "1000",
      "secret kg data",
    ]) {
      assert.equal(json.includes(secret), false, secret);
    }
  } finally {
    closeFixture(handle);
  }
});

test("non-TEXT IDs in Core, Engine, archived payload, or Recent domain fail without string coercion", async () => {
  for (const [name, seed, expectedFailure] of [
    ["core_blob", (core, engine) => {
      insertChunk(core, { id: Buffer.from("core-blob") });
      insertConfidence(engine, { id: "core-blob" });
    }, "global_core_ids_non_text"],
    ["engine_blob", (core, engine) => {
      insertChunk(core, { id: "engine-blob" });
      insertConfidence(engine, { id: Buffer.from("engine-blob") });
    }, "global_engine_ids_non_text"],
    ["archived_blob", (core, engine) => {
      insertChunk(core, { id: "archived-blob" });
      insertConfidence(engine, { id: Buffer.from("archived-blob"), isArchived: 1 });
    }, "global_engine_ids_non_text"],
    ["recent_core_blob", (core, engine) => {
      insertChunk(core, { id: Buffer.from("recent-blob"), path: "memory/smart-add/blob.md" });
      insertConfidence(engine, { id: "recent-blob" });
    }, "recent_core_ids_non_text"],
  ]) {
    const handle = await runFixture(seed);
    try {
      assert.equal(handle.result.decision.class, "fail_non_text_ids", name);
      assert.equal(handle.result.invariants.current_snapshot_text_id_invariant, false, name);
      assert.equal(handle.result.decision.reason.includes(expectedFailure), true, name);
      if (name === "archived_blob") {
        assert.equal(handle.result.archived_exclusion_payload.all_text, false);
        assert.equal(handle.result.archived_exclusion_payload.json_utf8_bytes, null);
      }
    } finally {
      closeFixture(handle);
    }
  }
});

test("database changes during audit produce inconclusive decision", async () => {
  const root = createFixtureRoot();
  let fixture = createDbs(root);
  try {
    insertChunk(fixture.core, { id: "stable-id" });
    insertConfidence(fixture.engine, { id: "stable-id" });
    const paths = { coreDbPath: fixture.coreDbPath, engineDbPath: fixture.engineDbPath };
    fixture = reopenReadonly(fixture);
    const result = await runRecentIsolationReadinessAudit({
      coreDb: fixture.core,
      engineDb: fixture.engine,
      ...paths,
      beforeAfterStabilityCheck: () => {
        const writer = new Database(paths.engineDbPath);
        try {
          insertConfidence(writer, { id: "changed-id" });
        } finally {
          writer.close();
        }
      },
    });
    assert.equal(result.database_stability.stable, false);
    assert.equal(result.decision.class, "inconclusive");
    assert.equal(result.decision.reason, "database_changed_during_audit");
  } finally {
    if (fixture?.core?.open) fixture.core.close();
    if (fixture?.engine?.open) fixture.engine.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid topology is reported as fail_topology", async () => {
  const root = createFixtureRoot();
  const fixture = createDbs(root);
  try {
    insertChunk(fixture.core, { id: "writable-topology" });
    insertConfidence(fixture.engine, { id: "writable-topology" });
    const result = await runRecentIsolationReadinessAudit({
      coreDb: fixture.core,
      engineDb: fixture.engine,
      coreDbPath: fixture.coreDbPath,
      engineDbPath: fixture.engineDbPath,
    });
    assert.equal(result.topology.core.readonly, false);
    assert.equal(result.decision.class, "fail_topology");
    assert.equal(result.decision.reason, "invalid_readonly_topology");
  } finally {
    if (fixture.core.open) fixture.core.close();
    if (fixture.engine.open) fixture.engine.close();
    rmSync(root, { recursive: true, force: true });
  }
});
