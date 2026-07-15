import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";

import { openCoreDbReadonly, openEngineDbIsolated } from "../lib/db/isolated-dbs.js";
import { openEngineDb } from "../lib/db/engine-db.js";
import { runRecentRolloutReadinessAudit } from "../lib/recall/hybrid/recent-rollout-readiness-audit.js";

function createFixtureRoot() {
  return mkdtempSync(join(tmpdir(), "memory-engine-recent-rollout-"));
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

function createEngineDb(root) {
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
    close() {
      if (this.legacyDb?.open) this.legacyDb.close();
      if (this.isolatedCoreDb?.open) this.isolatedCoreDb.close();
      if (this.isolatedEngineDb?.open) this.isolatedEngineDb.close();
    },
  }));
}

async function withAudit(root, options, run) {
  const paths = {
    corePath: join(root, "core.sqlite"),
    enginePath: join(root, "engine.sqlite"),
  };
  const handles = openHandles(paths);
  try {
    const report = await runRecentRolloutReadinessAudit({
      legacyDb: handles.legacyDb,
      isolatedCoreDb: handles.isolatedCoreDb,
      isolatedEngineDb: handles.isolatedEngineDb,
      coreDbPath: paths.corePath,
      engineDbPath: paths.enginePath,
      openHandles: () => openHandles(paths),
      hybridSmokeRunner: async ({ capabilities }) => ({
        debug: {
          recent_access_mode: capabilities.isolatedRecent === true ? "isolated" : "legacy",
        },
        channels: [],
        results_count: 0,
      }),
      ...options,
    });
    return await run(report, handles);
  } finally {
    handles.close();
  }
}

test("rollout readiness audit passes canary readiness with branch coverage, no-hit classification, timing closure, and concurrency smoke", async () => {
  const root = createFixtureRoot();
  try {
    const core = createCoreDb(root);
    const engine = createEngineDb(root);
    insertChunk(core, "A", {
      text: "SECRET ALPHA SMART BODY",
      path: "memory/smart-add/SECRET-SMART-A.md",
      updatedAt: 1000,
    });
    insertChunk(core, "B", {
      text: "SECRET ALPHA EPISODE BODY",
      path: "memory/episodes/SECRET-EPISODE-B.md",
      updatedAt: 999,
    });
    insertChunk(core, "C", {
      text: "SECRET ALPHA FALLBACK BODY",
      path: "memory/smart-add/SECRET-SMART-C.md",
      updatedAt: 998,
    });
    insertConfidence(engine, "A", { category: "raw_log", kgData: "alpha smart text" });
    insertConfidence(engine, "B", { category: "episodic", kgData: "alpha episode text" });
    insertConfidence(engine, "C", { category: "raw_log", kgData: "alpha fallback text" });
    core.close();
    engine.close();

    await withAudit(root, {
      queries: ["alpha", "smart", "episode"],
      includeNoHitControl: true,
      recentTopK: 3,
      recentFallbackTopK: 3,
      recentRerankTopK: 3,
      likeTopK: 3,
      warmups: 0,
      repetitions: 2,
      concurrencyWorkerDelayMs: 50,
      sampleSensitiveValues: () => [
        "SECRET ALPHA SMART BODY",
        "SECRET-SMART-A.md",
        "SECRET ALPHA EPISODE BODY",
        "1000",
      ],
    }, async (report) => {
      assert.equal(report.decision.class, "pass_canary_readiness");
      assert.equal(report.production_enablement_recommended, false);
      assert.deepEqual(report.branch_coverage, {
        like_fallback: true,
        recent_scored: true,
        recent_fallback: true,
        episode_projection: true,
      });
      assert.equal(report.scenarios.length, 8);
      assert.equal(report.scenarios.some(item => item.comparison.classification === "no_positive_candidate_evidence"), true);
      assert.equal(report.scenarios.filter(item => item.comparison.classification === "isolated_equivalent").length >= 2, true);
      for (const item of report.scenarios) {
        assert.equal(item.comparison.repetition_consistent, true);
        assert.equal(item.comparison.stage_timing_closes, true);
        assert.equal(item.isolated_requested.query_counts.engine_query_count_total, item.isolated_requested.query_counts.archived_engine_query_count + item.isolated_requested.query_counts.metadata_engine_query_count);
      }
      const ftsFalse = report.scenarios.find(item => item.scenario.ftsIsEmpty === false && item.comparison.classification === "isolated_equivalent");
      const ftsTrue = report.scenarios.find(item => item.scenario.ftsIsEmpty === true && item.comparison.classification === "isolated_equivalent");
      assert.equal(ftsFalse.isolated_requested.query_counts.core_query_count, 1);
      assert.equal(ftsTrue.isolated_requested.query_counts.core_query_count, 3);
      assert.equal(report.concurrency.length, 2);
      assert.equal(report.concurrency.every(item =>
        item.error_count === 0
        && item.mismatch_count === 0
        && item.worker_error_count === 0
        && item.worker_exit_error_count === 0
        && item.concurrency_execution_established === true
      ), true);
      const concurrency2 = report.concurrency.find(item => item.level === 2);
      const concurrency4 = report.concurrency.find(item => item.level === 4);
      assert.equal(concurrency2.observed_max_in_flight >= 2, true);
      assert.equal(concurrency2.overlapping_call_count > 0, true);
      assert.equal(concurrency4.observed_max_in_flight >= 4, true);
      assert.equal(concurrency4.overlapping_call_count > 0, true);
      assert.equal(report.hybrid_integration_smoke.legacy.debug.recent_access_mode, "legacy");
      assert.equal(report.hybrid_integration_smoke.isolated.debug.recent_access_mode, "isolated");
      assert.equal(report.privacy_validation.passed, true);
      assert.equal(report.privacy_validation.leak_count, 0);
      assert.equal(ftsFalse.isolated_requested.timing.metadata_merge_measurement_method, "residual_estimate");
      assert.equal(ftsFalse.isolated_requested.timing.timing_attribution_complete, false);
      assert.equal(ftsFalse.isolated_requested.timing.timing_reconciliation_error_ms >= 0, true);
      const json = JSON.stringify(report);
      for (const secret of [
        "SECRET ALPHA SMART BODY",
        "SECRET-SMART-A.md",
        "SECRET ALPHA EPISODE BODY",
        "1000",
      ]) {
        assert.equal(json.includes(secret), false, secret);
      }
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rollout readiness audit guarded fallback preserves legacy and performs no isolated core query when snapshot guard fails", async () => {
  const root = createFixtureRoot();
  try {
    const core = createCoreDb(root);
    const engine = createEngineDb(root);
    insertChunk(core, "A", { text: "alpha smart text", path: "memory/smart-add/A.md", updatedAt: 1000 });
    insertConfidence(engine, "A", { category: "raw_log", kgData: "alpha smart text" });
    engine.prepare(`
      INSERT INTO memory_confidence (
        chunk_id, confidence, last_confidence_update, base_tau, hit_count,
        is_protected, conflict_flag, category, is_archived, kg_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(Buffer.from("blob-id"), 0.4, 0, 7, 1, 0, 0, "raw_log", 0, "blob");
    core.close();
    engine.close();

    await withAudit(root, {
      queries: ["alpha"],
      includeNoHitControl: false,
      warmups: 0,
      repetitions: 1,
    }, async (report) => {
      assert.equal(report.snapshot_guard.passed, false);
      const item = report.scenarios[0];
      assert.equal(item.comparison.classification, "guarded_fallback_equivalent");
      assert.equal(item.isolated_requested.recent_access_mode, "guarded_fallback");
      assert.equal(item.isolated_requested.query_counts.core_query_count, 0);
      assert.equal(report.decision.class, "inconclusive");
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rollout readiness audit fails when isolated core SQL errors and does not report guarded fallback", async () => {
  const root = createFixtureRoot();
  try {
    const core = createCoreDb(root);
    const engine = createEngineDb(root);
    insertChunk(core, "A", { text: "alpha smart text", path: "memory/smart-add/A.md", updatedAt: 1000 });
    insertConfidence(engine, "A", { category: "raw_log", kgData: "alpha smart text" });
    core.close();
    engine.close();

    const paths = {
      corePath: join(root, "core.sqlite"),
      enginePath: join(root, "engine.sqlite"),
    };
    const brokenOpenHandles = () => {
      const handles = openHandles(paths);
      const realCore = handles.isolatedCoreDb;
      handles.isolatedCoreDb = {
        readonly: true,
        prepare(sql) {
          if (String(sql).includes("FROM chunks c")) throw new Error("forced isolated core failure");
          return realCore.prepare(sql);
        },
      };
      return handles;
    };

    const initialHandles = brokenOpenHandles();
    try {
      const report = await runRecentRolloutReadinessAudit({
        legacyDb: initialHandles.legacyDb,
        isolatedCoreDb: initialHandles.isolatedCoreDb,
        isolatedEngineDb: initialHandles.isolatedEngineDb,
        coreDbPath: paths.corePath,
        engineDbPath: paths.enginePath,
        openHandles: brokenOpenHandles,
        hybridSmokeRunner: async () => ({ debug: { recent_access_mode: "isolated" }, channels: [], results_count: 0 }),
        queries: ["alpha"],
        includeNoHitControl: false,
        warmups: 0,
        repetitions: 1,
      });
      assert.equal(report.scenarios[0].comparison.classification, "error");
      assert.equal(report.scenarios[0].isolated_requested.recent_access_mode, "isolated");
      assert.equal(report.decision.class, "fail");
    } finally {
      initialHandles.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rollout readiness audit does not pass canary readiness when concurrency execution is not established", async () => {
  const root = createFixtureRoot();
  try {
    const core = createCoreDb(root);
    const engine = createEngineDb(root);
    insertChunk(core, "A", {
      text: "alpha body",
      path: "memory/smart-add/A.md",
      updatedAt: 1000,
    });
    insertConfidence(engine, "A", { category: "raw_log", kgData: "alpha body" });
    core.close();
    engine.close();

    await withAudit(root, {
      queries: ["alpha"],
      includeNoHitControl: false,
      warmups: 0,
      repetitions: 1,
      concurrencyLevels: [2],
      concurrencyWorkerDelayMs: 0,
    }, async (report) => {
      const concurrency2 = report.concurrency.find(item => item.level === 2);
      assert.equal(typeof concurrency2.concurrency_execution_established, "boolean");
      if (concurrency2.concurrency_execution_established === false) {
        assert.equal(report.decision.class, "semantic_pass_latency_inconclusive");
      }
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
