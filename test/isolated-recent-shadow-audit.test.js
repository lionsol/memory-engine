import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";

import { openCoreDbReadonly, openEngineDbIsolated } from "../lib/db/isolated-dbs.js";
import { openEngineDb } from "../lib/db/engine-db.js";
import {
  assertRecentShadowPrivacy,
  compareRecentShadowRuns,
  deriveRecentShadowDecision,
  deriveRecentShadowQueries,
  fingerprintRecentShadowValue,
  NO_HIT_CONTROL_QUERY,
  runRecentShadowAudit,
} from "../lib/recall/hybrid/recent-shadow-audit.js";

function createFixtureRoot() {
  return mkdtempSync(join(tmpdir(), "memory-engine-recent-shadow-"));
}

function withDbEnv(paths, fn) {
  const previous = {
    CORE_DB_PATH: process.env.CORE_DB_PATH,
    ENGINE_DB_PATH: process.env.ENGINE_DB_PATH,
  };
  process.env.CORE_DB_PATH = paths.corePath;
  process.env.ENGINE_DB_PATH = paths.enginePath;
  try {
    return fn();
  } finally {
    if (previous.CORE_DB_PATH == null) delete process.env.CORE_DB_PATH;
    else process.env.CORE_DB_PATH = previous.CORE_DB_PATH;
    if (previous.ENGINE_DB_PATH == null) delete process.env.ENGINE_DB_PATH;
    else process.env.ENGINE_DB_PATH = previous.ENGINE_DB_PATH;
  }
}

function createCoreDb(root) {
  const db = new Database(join(root, "core.sqlite"));
  db.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      text TEXT,
      path TEXT,
      updated_at INTEGER
    );
  `);
  return db;
}

function createEngineDb(root, { blobSnapshot = false } = {}) {
  const db = new Database(join(root, "engine.sqlite"));
  db.exec(`
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
  if (blobSnapshot) {
    db.prepare(`
      INSERT INTO memory_confidence (
        chunk_id, confidence, last_confidence_update, base_tau, hit_count,
        is_protected, conflict_flag, category, is_archived, kg_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(Buffer.from("blob-only"), 0.82, 0, 7, 3, 0, 0, "raw_log", 0, "blob query");
  }
  return db;
}

function insertChunk(db, id, {
  text = `fixture text ${id}`,
  path = `memory/smart-add/${id}.md`,
  updatedAt = 1000,
} = {}) {
  db.prepare("INSERT INTO chunks (id, text, path, updated_at) VALUES (?, ?, ?, ?)")
    .run(id, text, path, updatedAt);
}

function insertConfidence(db, id, {
  confidence = 0.82,
  category = "raw_log",
  isArchived = 0,
  kgData = "alpha fixture",
} = {}) {
  db.prepare(`
    INSERT INTO memory_confidence (
      chunk_id, confidence, last_confidence_update, base_tau, hit_count,
      is_protected, conflict_flag, category, is_archived, kg_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, confidence, 0, 7, 3, 0, 0, category, isArchived, kgData);
}

function openHandles(paths) {
  return withDbEnv(paths, () => ({
    legacyDb: openEngineDb({ readonly: true }),
    isolatedCoreDb: openCoreDbReadonly({ coreDbPath: paths.corePath, engineDbPath: paths.enginePath }),
    isolatedEngineDb: openEngineDbIsolated({ coreDbPath: paths.corePath, engineDbPath: paths.enginePath, readonly: true }),
  }));
}

async function withAudit(root, options, run) {
  const paths = {
    corePath: join(root, "core.sqlite"),
    enginePath: join(root, "engine.sqlite"),
  };
  const handles = openHandles(paths);
  try {
    const report = await runRecentShadowAudit({
      legacyDb: handles.legacyDb,
      isolatedCoreDb: handles.isolatedCoreDb,
      isolatedEngineDb: handles.isolatedEngineDb,
      coreDbPath: paths.corePath,
      engineDbPath: paths.enginePath,
      ...options,
    });
    return await run(report, { paths, ...handles });
  } finally {
    if (handles.legacyDb.open) handles.legacyDb.close();
    if (handles.isolatedCoreDb.open) handles.isolatedCoreDb.close();
    if (handles.isolatedEngineDb.open) handles.isolatedEngineDb.close();
  }
}

function branch(legacyCount = 1, candidateCount = 1, id = "a", fp = "fp-a") {
  return {
    raw_count: legacyCount,
    raw_summaries: legacyCount === 0 ? [] : [{ id_hash: id, row_fingerprint: fp }],
    candidate_count: candidateCount,
    candidate_summaries: candidateCount === 0 ? [] : [{ id_hash: id, row_fingerprint: fp }],
  };
}

test("shadow audit reports isolated equivalence across fts and fallback scenarios with query counts and privacy", async () => {
  const root = createFixtureRoot();
  try {
    const core = createCoreDb(root);
    const engine = createEngineDb(root);
    insertChunk(core, "A", { text: "alpha smart text", path: "memory/smart-add/A.md", updatedAt: 1000 });
    insertChunk(core, "B", { text: "alpha episodic text", path: "memory/episodes/B.md", updatedAt: 1000 });
    insertChunk(core, "C", { text: "alpha fallback text", path: "memory/smart-add/C.md", updatedAt: 900 });
    insertConfidence(engine, "A", { category: "raw_log", kgData: "alpha smart text" });
    insertConfidence(engine, "B", { category: "episodic", kgData: "alpha episodic text" });
    insertConfidence(engine, "C", { category: "raw_log", kgData: "alpha fallback text" });
    core.close();
    engine.close();

    await withAudit(root, {
      queries: ["alpha", "episodic"],
      includeNoHitControl: true,
      recentTopK: 3,
      recentFallbackTopK: 3,
      recentRerankTopK: 3,
      likeTopK: 3,
    }, async (report, handles) => {
      assert.equal(report.topology.legacy.readonly, true);
      assert.deepEqual(report.topology.legacy.database_names, ["main", "core"]);
      assert.deepEqual(report.topology.isolated_core.database_names, ["main"]);
      assert.deepEqual(report.topology.isolated_engine.database_names, ["main"]);
      assert.equal(report.snapshot_guard.passed, true);
      assert.equal(report.decision.class, "pass");
      assert.equal(report.decision.reason, "all_recent_scenarios_isolated_equivalent");
      assert.equal(report.summary.isolated_equivalent_count > 0, true);
      assert.equal(report.summary.error_count, 0);
      assert.equal(report.summary.mismatch_count, 0);
      const ftsFalse = report.queries.find(item => item.scenario.ftsIsEmpty === false && item.comparison.classification === "isolated_equivalent");
      const ftsTrue = report.queries.find(item => item.scenario.ftsIsEmpty === true && item.comparison.classification === "isolated_equivalent");
      assert.equal(Boolean(ftsFalse), true);
      assert.equal(Boolean(ftsTrue), true);
      assert.deepEqual(ftsFalse.isolated_requested.query_counts, {
        archived_engine_query_count: 1,
        metadata_engine_query_count: 1,
        engine_query_count_total: 2,
        core_query_count: 1,
      });
      assert.equal(ftsTrue.isolated_requested.query_counts.engine_query_count_total, 2);
      assert.equal(ftsTrue.isolated_requested.query_counts.core_query_count, 3);
      assert.equal(ftsTrue.isolated_requested.archived_payload.payload_large, false);
      assert.equal(
        assertRecentShadowPrivacy(JSON.stringify(report), [
          "alpha smart text",
          "memory/smart-add/A.md",
          "A",
          "1000",
        ]),
        true,
      );
      assert.equal(handles.legacyDb.open, true);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shadow audit reports guarded_only when snapshot guard forces guarded fallback", async () => {
  const root = createFixtureRoot();
  try {
    const core = createCoreDb(root);
    const engine = createEngineDb(root, { blobSnapshot: true });
    insertChunk(core, "A", { text: "alpha smart text", path: "memory/smart-add/A.md", updatedAt: 1000 });
    insertConfidence(engine, "A", { category: "raw_log", kgData: "alpha smart text" });
    core.close();
    engine.close();

    await withAudit(root, {
      queries: ["alpha"],
      includeNoHitControl: false,
    }, async (report) => {
      assert.equal(report.snapshot_guard.passed, false);
      assert.equal(report.decision.class, "guarded_only");
      assert.equal(report.summary.guarded_fallback_equivalent_count > 0, true);
      assert.equal(
        report.queries.every(item => item.isolated_requested.recent_access_mode === "guarded_fallback"),
        true,
      );
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shadow audit reports no positive candidate evidence and missing-confidence semantics", async () => {
  const root = createFixtureRoot();
  try {
    const core = createCoreDb(root);
    const engine = createEngineDb(root);
    insertChunk(core, "A", { text: "alpha low confidence", path: "memory/smart-add/A.md", updatedAt: 1000 });
    insertChunk(core, "MISSING", { text: "alpha missing confidence", path: "memory/smart-add/MISSING.md", updatedAt: 900 });
    insertConfidence(engine, "A", { confidence: 0.01, category: "raw_log", kgData: "alpha low confidence" });
    core.close();
    engine.close();

    await withAudit(root, {
      queries: ["alpha"],
      includeNoHitControl: false,
      minConfidence: 0.9,
    }, async (report) => {
      assert.equal(report.decision.class, "inconclusive");
      assert.equal(report.decision.reason, "no_positive_candidate_evidence");
      assert.equal(report.summary.no_positive_candidate_evidence_count > 0, true);
      assert.equal(report.missing_confidence_evidence.real_snapshot_count, 1);
      assert.equal(report.missing_confidence_evidence.synthetic_contract_test_present, true);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shadow audit marks database changes inconclusive and can still pass with large archived payloads", async () => {
  const root = createFixtureRoot();
  try {
    const core = createCoreDb(root);
    const engine = createEngineDb(root);
    insertChunk(core, "ACTIVE", { text: "alpha active", path: "memory/smart-add/ACTIVE.md", updatedAt: 1000 });
    insertConfidence(engine, "ACTIVE", { category: "raw_log", kgData: "alpha active" });
    const insertMany = engine.transaction(() => {
      for (let index = 0; index < 4200; index += 1) {
        insertConfidence(engine, `archived-${String(index).padStart(5, "0")}-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`, {
          isArchived: 1,
          kgData: "alpha archived payload",
        });
      }
    });
    insertMany();
    core.close();
    engine.close();

    await withAudit(root, {
      queries: ["alpha"],
      includeNoHitControl: false,
      recentTopK: 1,
      recentRerankTopK: 1,
      afterScenarios: async () => {
        const writer = new Database(join(root, "core.sqlite"));
        try {
          writer.prepare("INSERT INTO chunks (id, text, path, updated_at) VALUES (?, ?, ?, ?)")
            .run("mutator", "mutator text", "memory/smart-add/mutator.md", 1);
        } finally {
          writer.close();
        }
      },
    }, async (report) => {
      assert.equal(report.queries[0].isolated_requested.archived_payload.payload_large, true);
      assert.equal(report.queries[0].isolated_requested.archived_payload.json_utf8_bytes > 262144, true);
      assert.equal(report.database_stability.stable, false);
      assert.equal(report.decision.class, "inconclusive");
      assert.equal(report.decision.reason, "database_changed_during_shadow_audit");
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deriveRecentShadowQueries deduplicates explicit, file, derived, and no-hit control sources without leaking raw text", () => {
  const root = createFixtureRoot();
  try {
    const file = join(root, "queries.txt");
    writeFileSync(file, "alpha\n# comment\nalpha\nbeta\n");
    const result = deriveRecentShadowQueries({
      queries: ["alpha", "alpha"],
      queriesFile: file,
      derivedRows: [{ text: "alpha beta gamma", path: "memory/smart-add/a.md" }],
      includeNoHitControl: true,
    });
    assert.equal(result.stats.explicit_input_count, 2);
    assert.equal(result.stats.file_input_count, 3);
    assert.equal(result.stats.derived_source_row_count, 1);
    assert.equal(result.stats.final_unique_query_count > 0, true);
    assert.equal(result.descriptors.some(item => item.query.source_type === "no_hit_control"), true);
    assert.equal(result.descriptors.some(item => item.text === NO_HIT_CONTROL_QUERY), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("comparison and decision helpers classify mismatch, error, ambiguity, and branch coverage correctly", () => {
  const legacy = {
    error: null,
    recent_access_mode: "legacy",
    candidate_counts: { like_raw: 1, recent_raw: 1, episode_raw: 0, recent_fallback_raw: 0 },
    branches: {
      like_fallback: branch(),
      recent_scored: branch(),
      episode_projection: branch(0, 0),
      recent_fallback: branch(0, 0),
    },
  };
  const isolated = {
    ...legacy,
    recent_access_mode: "isolated",
    query_count_contract_ambiguous: false,
  };
  assert.equal(compareRecentShadowRuns({
    legacy,
    isolatedRequested: isolated,
    scenario: { ftsIsEmpty: false },
  }).classification, "isolated_equivalent");

  const mismatch = compareRecentShadowRuns({
    legacy,
    isolatedRequested: {
      ...isolated,
      branches: {
        ...isolated.branches,
        recent_scored: {
          ...branch(),
          candidate_summaries: [{ id_hash: "b", row_fingerprint: "fp-b" }],
        },
      },
    },
    scenario: { ftsIsEmpty: false },
  });
  assert.equal(mismatch.classification, "mismatch");

  const error = compareRecentShadowRuns({
    legacy: { ...legacy, error: { message: "boom" } },
    isolatedRequested: isolated,
    scenario: { ftsIsEmpty: false },
  });
  assert.equal(error.classification, "error");

  const ambiguous = deriveRecentShadowDecision({
    topology: {
      legacy: { readonly: true, database_names: ["main", "core"] },
      isolated_core: { readonly: true, database_names: ["main"] },
      isolated_engine: { readonly: true, database_names: ["main"] },
    },
    databaseStability: { stable: true },
    episodeDomainPresent: false,
    scenarios: [{
      scenario: { ftsIsEmpty: false },
      legacy,
      isolated_requested: isolated,
      comparison: { classification: "isolated_equivalent", positive_candidate_evidence: true, query_count_contract_ambiguous: true, branches: {} },
    }],
  });
  assert.equal(ambiguous.class, "inconclusive");
  assert.equal(ambiguous.reason, "ambiguous_engine_query_count_contract");
});
