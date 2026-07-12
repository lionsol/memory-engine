import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import Database from "better-sqlite3";

import { openCoreDbReadonly, openEngineDbIsolated } from "../lib/db/isolated-dbs.js";
import { openEngineDb } from "../lib/db/engine-db.js";
import {
  assertShadowAuditPrivacy,
  canonicalizeKgShadowCandidate,
  compareKgShadowRuns,
  deriveKgShadowQueries,
  fingerprintShadowValue,
  kgShadowLexicalMatchScore,
  NO_HIT_CONTROL_QUERY,
  runKgShadowAudit,
} from "../lib/recall/hybrid/kg-shadow-audit.js";

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

function createFixtureRoot() {
  return mkdtempSync(join(tmpdir(), "memory-engine-kg-shadow-"));
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

function createEngineDb(root, { duplicateFriendly = false } = {}) {
  const db = new Database(join(root, "engine.sqlite"));
  db.exec(`
    CREATE TABLE memory_confidence (
      ${duplicateFriendly ? "row_id INTEGER PRIMARY KEY AUTOINCREMENT," : "chunk_id TEXT PRIMARY KEY,"}
      ${duplicateFriendly ? "chunk_id TEXT," : ""}
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

function insertChunk(db, id, updatedAt, text, path = `memory/kg/${String(id)}.md`) {
  db.prepare("INSERT INTO chunks (id, text, path, updated_at) VALUES (?, ?, ?, ?)")
    .run(id, text, path, updatedAt);
}

function insertConfidence(db, id, {
  confidence = 0.82,
  last_confidence_update = 0,
  base_tau = 7,
  hit_count = 3,
  is_protected = 0,
  conflict_flag = 0,
  category = "raw_log",
  is_archived = 0,
  kg_data = "alpha",
} = {}) {
  const columns = db.prepare("PRAGMA table_info(memory_confidence)").all().map(row => row.name);
  if (columns.includes("row_id")) {
    db.prepare(`
      INSERT INTO memory_confidence (
        chunk_id, confidence, last_confidence_update, base_tau, hit_count,
        is_protected, conflict_flag, category, is_archived, kg_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, confidence, last_confidence_update, base_tau, hit_count, is_protected, conflict_flag, category, is_archived, kg_data);
    return;
  }
  db.prepare(`
    INSERT INTO memory_confidence (
      chunk_id, confidence, last_confidence_update, base_tau, hit_count,
      is_protected, conflict_flag, category, is_archived, kg_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, confidence, last_confidence_update, base_tau, hit_count, is_protected, conflict_flag, category, is_archived, kg_data);
}

function openHandles(paths) {
  return withDbEnv(paths, () => ({
    legacyDb: openEngineDb({ readonly: true }),
    isolatedEngineDb: openEngineDbIsolated({ readonly: true, coreDbPath: paths.corePath, engineDbPath: paths.enginePath }),
    isolatedCoreDb: openCoreDbReadonly({ coreDbPath: paths.corePath, engineDbPath: paths.enginePath }),
  }));
}

async function withAudit(root, options, run) {
  const paths = {
    corePath: join(root, "core.sqlite"),
    enginePath: join(root, "engine.sqlite"),
  };
  const { legacyDb, isolatedEngineDb, isolatedCoreDb } = openHandles(paths);
  try {
    const report = await runKgShadowAudit({
      legacyDb,
      isolatedEngineDb,
      isolatedCoreDb,
      coreDbPath: paths.corePath,
      engineDbPath: paths.enginePath,
      ...options,
    });
    return await run(report, { legacyDb, isolatedEngineDb, isolatedCoreDb, paths });
  } finally {
    if (legacyDb.open) legacyDb.close();
    if (isolatedEngineDb.open) isolatedEngineDb.close();
    if (isolatedCoreDb.open) isolatedCoreDb.close();
  }
}

test("shadow audit reports isolated equivalence with deterministic ordering and safe topology", async () => {
  const root = createFixtureRoot();
  try {
    const core = createCoreDb(root);
    const engine = createEngineDb(root);
    insertChunk(core, "A", 1000, "alpha fixture chunk text A", "memory/kg/alpha-path-A.md");
    insertChunk(core, "B", 1000, "alpha fixture chunk text B", "memory/kg/alpha-path-B.md");
    insertConfidence(engine, "A", { kg_data: "alpha term" });
    insertConfidence(engine, "B", { kg_data: "alpha term" });
    core.close();
    engine.close();

    await withAudit(root, { queries: ["alpha"] }, async (report) => {
      assert.deepEqual(report.topology.legacy.database_names, ["main", "core"]);
      assert.deepEqual(report.topology.isolated_engine.database_names, ["main"]);
      assert.deepEqual(report.topology.isolated_core.database_names, ["main"]);
      assert.equal(report.kg_text_id_invariant.passed, true);
      assert.equal(report.isolated_access_decision.mode, "isolated");
      assert.equal(report.summary.isolated_equivalent_count, 1);
      assert.equal(report.summary.positive_candidate_query_count, 1);
      assert.equal(report.summary.positive_multi_term_query_count, 0);
      assert.equal(report.summary.positive_single_term_query_count, 1);
      assert.equal(report.summary.raw_hit_query_count, 1);
      assert.equal(report.summary.no_raw_hit_query_count, 0);
      assert.equal(report.summary.mismatch_count, 0);
      assert.equal(report.summary.error_count, 0);
      assert.equal(report.decision.class, "pass");
      assert.equal(report.decision.reason, "all_queries_isolated_equivalent_with_broad_probe_only");
      assert.equal(report.decision.production_enablement_recommended, false);
      assert.equal(report.database_stability.stable, true);
      assert.equal(report.queries[0].comparison.ordered_ids_equal, true);
      assert.equal(report.queries[0].comparison.row_fingerprints_equal, true);
      assert.equal(report.queries[0].comparison.raw_hit, true);
      assert.equal(report.queries[0].comparison.positive_candidate_evidence, true);
      assert.equal(report.queries[0].query.source, "explicit");
      assert.equal(typeof report.queries[0].query.query_id, "string");
      assert.equal(report.queries[0].query.query_id.length, 16);
      assert.equal(report.queries[0].legacy.candidate_summaries.length, 2);
      assert.equal(report.queries[0].legacy.candidate_summaries[0].id_hash.length, 16);
      assert.equal(report.queries[0].legacy.candidate_summaries[0].path_hash.length, 16);
      assert.equal(report.queries[0].legacy.candidate_summaries[0].row_fingerprint.length, 64);
      assert.equal(report.queries[0].isolated_requested.kg_access_mode, "isolated");
      assert.equal(assertShadowAuditPrivacy(report, [
        "alpha",
        "fixture chunk text A",
        "memory/kg/path-A.md",
        "alpha term",
        "A",
        "B",
      ]), true);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shadow audit treats raw-hit but zero-post-filter equivalence as inconclusive evidence", async () => {
  const root = createFixtureRoot();
  try {
    const core = createCoreDb(root);
    const engine = createEngineDb(root);
    insertChunk(core, "A", 1000, "alpha low confidence chunk", "memory/kg/alpha-low.md");
    insertConfidence(engine, "A", { confidence: 0.05, kg_data: "alpha low confidence" });
    core.close();
    engine.close();

    await withAudit(root, { queries: ["alpha"] }, async (report) => {
      assert.equal(report.summary.raw_hit_query_count, 1);
      assert.equal(report.summary.positive_candidate_query_count, 0);
      assert.equal(report.summary.zero_post_filter_query_count, 1);
      assert.equal(report.queries[0].comparison.raw_hit, true);
      assert.equal(report.queries[0].comparison.positive_candidate_evidence, false);
      assert.equal(report.decision.class, "inconclusive");
      assert.equal(report.decision.reason, "no_positive_candidate_evidence");
      assert.equal(report.decision.production_enablement_recommended, false);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shadow audit treats candidate order differences and metadata differences as mismatches", () => {
  const query = { query_id: "q", source: "explicit", char_count: 1, term_count: 1, truncated: false };
  const base = {
    kg_raw: 1,
    kg_after_conf_filter: 1,
    error: null,
    candidate_summaries: [{ id_hash: "a", row_fingerprint: "fp-a" }],
  };
  assert.equal(compareKgShadowRuns({
    query,
    legacy: base,
    isolatedRequested: { ...base, candidate_summaries: [{ id_hash: "b", row_fingerprint: "fp-a" }] },
  }).classification, "mismatch");
  assert.equal(compareKgShadowRuns({
    query,
    legacy: base,
    isolatedRequested: { ...base, candidate_summaries: [{ id_hash: "a", row_fingerprint: "fp-b" }] },
  }).classification, "mismatch");
});

test("shadow audit reports guarded fallback equivalence for global non-text invariant failures", async () => {
  const root = createFixtureRoot();
  try {
    const core = createCoreDb(root);
    const engine = createEngineDb(root);
    insertChunk(core, "safe-text", 1000, "alpha fixture text", "memory/kg/alpha-safe.md");
    insertConfidence(engine, "safe-text", { kg_data: "alpha guard" });
    insertConfidence(engine, Buffer.from("blob-only"), { kg_data: "alpha guard" });
    core.close();
    engine.close();

    await withAudit(root, { queries: ["alpha"] }, async (report) => {
      assert.equal(report.kg_text_id_invariant.passed, false);
      assert.equal(report.isolated_access_decision.mode, "legacy");
      assert.equal(report.queries[0].comparison.classification, "guarded_legacy_fallback_equivalent");
      assert.equal(report.queries[0].isolated_requested.kg_access_mode, "legacy_fallback");
      assert.equal(report.queries[0].isolated_requested.fallback_reason, "text_id_invariant_failed");
      assert.equal(report.decision.class, "guarded_only");
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shadow audit detects metadata mismatches and orders as fail when compared at report level", async () => {
  const root = createFixtureRoot();
  try {
    const core = createCoreDb(root);
    const engine = createEngineDb(root);
    insertChunk(core, "A", 1000, "alpha fixture text", "memory/kg/alpha-a.md");
    insertConfidence(engine, "A", { kg_data: "alpha metadata" });
    core.close();
    engine.close();

    const paths = { corePath: join(root, "core.sqlite"), enginePath: join(root, "engine.sqlite") };
    const handles = openHandles(paths);
    try {
      const mismatchedLegacyDb = {
        ...handles.legacyDb,
        prepare(sql) {
          const stmt = handles.legacyDb.prepare(sql);
          if (!String(sql).includes("FROM memory_confidence mc")) return stmt;
          return {
            all(...args) {
              return stmt.all(...args).map((row) => ({ ...row, category: "legacy-only-category" }));
            },
          };
        },
      };
      const report = await runKgShadowAudit({
        legacyDb: mismatchedLegacyDb,
        isolatedEngineDb: handles.isolatedEngineDb,
        isolatedCoreDb: handles.isolatedCoreDb,
        coreDbPath: paths.corePath,
        engineDbPath: paths.enginePath,
        queries: ["alpha"],
      });
      assert.equal(report.summary.mismatch_count, 1);
      assert.equal(report.decision.class, "fail");
      assert.equal(report.queries[0].comparison.classification, "mismatch");
      assert.equal(report.queries[0].comparison.row_fingerprints_equal, false);
    } finally {
      if (handles.legacyDb.open) handles.legacyDb.close();
      if (handles.isolatedEngineDb.open) handles.isolatedEngineDb.close();
      if (handles.isolatedCoreDb.open) handles.isolatedCoreDb.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shadow audit classifies legacy and isolated SQL errors without retry fallback", async () => {
  const root = createFixtureRoot();
  try {
    const core = createCoreDb(root);
    const engine = createEngineDb(root);
    insertChunk(core, "safe-text", 1000, "alpha fixture text", "memory/kg/alpha-safe.md");
    insertConfidence(engine, "safe-text", { kg_data: "alpha" });
    core.close();
    engine.close();
    const paths = { corePath: join(root, "core.sqlite"), enginePath: join(root, "engine.sqlite") };

    const handles = openHandles(paths);
    try {
      const legacyFailingDb = {
        ...handles.legacyDb,
        prepare(sql) {
          const query = String(sql);
          if (query.includes("FROM memory_confidence mc") && query.includes("mc.kg_data LIKE")) {
            throw new Error("legacy shadow failure");
          }
          return handles.legacyDb.prepare(sql);
        },
      };
      const legacyError = await runKgShadowAudit({
        legacyDb: legacyFailingDb,
        isolatedEngineDb: handles.isolatedEngineDb,
        isolatedCoreDb: handles.isolatedCoreDb,
        coreDbPath: paths.corePath,
        engineDbPath: paths.enginePath,
        queries: ["alpha"],
      });
      assert.equal(legacyError.queries[0].comparison.classification, "legacy_error");
      assert.equal(legacyError.decision.class, "fail");
    } finally {
      if (handles.legacyDb.open) handles.legacyDb.close();
      if (handles.isolatedEngineDb.open) handles.isolatedEngineDb.close();
      if (handles.isolatedCoreDb.open) handles.isolatedCoreDb.close();
    }

    const handles2 = openHandles(paths);
    try {
      const isolatedCoreFailingDb = {
        ...handles2.isolatedCoreDb,
        prepare(sql) {
          const query = String(sql);
          if (query.includes("FROM json_each(?) AS candidate")) {
            return {
              all() {
                throw new Error("isolated core failure");
              },
            };
          }
          return handles2.isolatedCoreDb.prepare(sql);
        },
      };
      const isolatedError = await runKgShadowAudit({
        legacyDb: handles2.legacyDb,
        isolatedEngineDb: handles2.isolatedEngineDb,
        isolatedCoreDb: isolatedCoreFailingDb,
        coreDbPath: paths.corePath,
        engineDbPath: paths.enginePath,
        queries: ["alpha"],
      });
      assert.equal(isolatedError.queries[0].comparison.classification, "isolated_error");
      assert.equal(isolatedError.decision.class, "fail");
    } finally {
      if (handles2.legacyDb.open) handles2.legacyDb.close();
      if (handles2.isolatedEngineDb.open) handles2.isolatedEngineDb.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shadow audit tracks no-hit, skipped empty query, database instability, timing neutrality, and handle closure", async () => {
  const root = createFixtureRoot();
  try {
    const core = createCoreDb(root);
    const engine = createEngineDb(root);
    insertChunk(core, "A", 1000, "alpha visible fixture text", "memory/kg/alpha-path.md");
    insertConfidence(engine, "A", { kg_data: "alpha visible" });
    core.close();
    engine.close();

    const queriesFile = resolve(root, "queries.txt");
    writeFileSync(queriesFile, "# comment\nalpha visible\n\n", "utf8");

    const handles = openHandles({ corePath: join(root, "core.sqlite"), enginePath: join(root, "engine.sqlite") });
    const report = await runKgShadowAudit({
      ...handles,
      coreDbPath: join(root, "core.sqlite"),
      engineDbPath: join(root, "engine.sqlite"),
      queries: [""],
      queriesFile,
      includeNoHitControl: true,
      closeHandles: true,
    });
    assert.equal(handles.legacyDb.open, false);
    assert.equal(handles.isolatedEngineDb.open, false);
    assert.equal(handles.isolatedCoreDb.open, false);
    assert.equal(report.summary.skipped_count, 1);
    assert.equal(report.summary.raw_hit_query_count, 1);
    assert.equal(report.summary.no_raw_hit_query_count, 1);
    assert.equal(report.summary.zero_post_filter_query_count, 1);
    assert.equal(report.queries.some(item => item.comparison.classification === "skipped_empty_query"), true);
    assert.equal(report.queries.some(item => item.query.source === "no_hit_control"), true);
    assert.equal(report.queries.find(item => item.query.source === "no_hit_control").comparison.raw_hit, false);
    assert.equal(report.summary.legacy_duration_ms_median >= 0, true);
    assert.equal(report.summary.isolated_duration_ms_median >= 0, true);

    const handles2 = openHandles({ corePath: join(root, "core.sqlite"), enginePath: join(root, "engine.sqlite") });
    try {
      const unstablePromise = runKgShadowAudit({
        ...handles2,
        coreDbPath: join(root, "core.sqlite"),
        engineDbPath: join(root, "engine.sqlite"),
        queries: ["alpha"],
      });
      const writer = new Database(join(root, "engine.sqlite"));
      writer.prepare(`
        INSERT INTO memory_confidence (
          chunk_id, confidence, last_confidence_update, base_tau, hit_count,
          is_protected, conflict_flag, category, is_archived, kg_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("late-write", 0.5, 0, 7, 0, 0, 0, "raw_log", 0, "alpha");
      writer.close();
      const unstableReport = await unstablePromise;
      assert.equal(unstableReport.database_stability.stable, false);
      assert.equal(unstableReport.decision.class, "inconclusive");
      assert.equal(unstableReport.decision.reason, "inconclusive_database_changed");
    } finally {
      if (handles2.legacyDb.open) handles2.legacyDb.close();
      if (handles2.isolatedEngineDb.open) handles2.isolatedEngineDb.close();
      if (handles2.isolatedCoreDb.open) handles2.isolatedCoreDb.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("query derivation, fingerprinting, canonicalization, and lexical-match parity stay safe", () => {
  const fileRoot = createFixtureRoot();
  try {
    const queriesFile = resolve(fileRoot, "queries.txt");
    writeFileSync(queriesFile, "# comment\nhello\nhello\n", "utf8");
    const { descriptors, stats } = deriveKgShadowQueries({
      queries: ["hello", "world".repeat(500)],
      queriesFile,
      derivedKgRows: ["derived text sample extra", "derived text sample extra"],
      includeNoHitControl: true,
    });
    assert.equal(stats.explicit_input_count, 2);
    assert.equal(stats.file_input_count, 2);
    assert.equal(stats.derived_source_row_count, 2);
    assert.equal(stats.derived_truncated_row_count, 0);
    assert.equal(stats.derived_unique_full_query_count, 1);
    assert.equal(stats.derived_duplicate_query_count, 1);
    assert.equal(stats.no_hit_control_count, 1);
    assert.equal(stats.final_unique_query_count, descriptors.length);
    assert.equal(descriptors.some(item => item.query.source === "file"), false);
    assert.equal(descriptors.some(item => item.query.source === "no_hit_control"), true);
    assert.equal(descriptors.some(item => item.query.source === "derived_kg_data_full"), true);
    assert.equal(descriptors.some(item => item.query.source === "derived_kg_data_term_1"), true);
    assert.equal(descriptors.some(item => item.query.source === "derived_kg_data_term_2"), true);
    assert.equal(descriptors.some(item => item.query.source === "derived_kg_data_term_3"), true);
    assert.equal(descriptors.find(item => item.text.startsWith("world")).query.truncated, true);
    assert.equal(descriptors.find(item => item.query.source === "derived_kg_data_term_1").query.broad_probe, true);
    assert.equal(descriptors.find(item => item.query.source === "derived_kg_data_term_2").query.broad_probe, false);

    const canonical = canonicalizeKgShadowCandidate({ id: "raw-id", text: "body", path: "secret/path.md", source_type: "memory-engine-managed" });
    assert.equal(Object.keys(canonical).length > 10, true);
    assert.equal(canonical.kg_data, null);
    assert.notEqual(fingerprintShadowValue(canonical), fingerprintShadowValue({ id: "other" }));
    assert.equal(kgShadowLexicalMatchScore("alpha beta", ["alpha", "beta"]), 1);
    assert.equal(kgShadowLexicalMatchScore("alpha", ["beta"]), 0);

    const hybridSearchSource = readFileSync(resolve("lib/recall/hybrid-search.js"), "utf8");
    assert.equal(hybridSearchSource.includes("function lexicalMatchScore(haystack, terms)"), true);
    assert.equal(hybridSearchSource.includes("return round4(matched / terms.length);"), true);
  } finally {
    rmSync(fileRoot, { recursive: true, force: true });
  }
});
