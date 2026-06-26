import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  actions,
  diagnosticsOnlyNames,
  grades,
  p0PerMemoryFlags,
  p1PerMemoryFlags,
} from "../lib/quality/quality-types.js";
import {
  getPathFamily,
  isActiveMemoryPath,
  isDefaultIncludedPathFamily,
} from "../lib/quality/path-family.js";
import {
  classifyQualityScope,
  getQualityScopeFamily,
} from "../lib/quality/quality-scope.js";
import { attachEventStatsByPrefix } from "../lib/quality/event-prefix-join.js";
import {
  evaluateDuplicateFlags,
  evaluateQualityFlags,
} from "../lib/quality/quality-rules.js";
import { scoreQualityItem } from "../lib/quality/quality-score.js";
import {
  buildQualityReport,
  writeQualityReports,
} from "../lib/quality/quality-report.js";

function createQualityFixtureDbs() {
  const root = mkdtempSync(resolve(tmpdir(), "memory-quality-eval-"));
  const corePath = resolve(root, "core.sqlite");
  const engineDir = resolve(root, "engine");
  const enginePath = resolve(engineDir, "memory-engine.sqlite");
  mkdirSync(engineDir, { recursive: true });

  const coreDb = new Database(corePath);
  const engineDb = new Database(enginePath);

  try {
    coreDb.exec(`
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY,
        path TEXT,
        source TEXT,
        start_line INTEGER,
        end_line INTEGER,
        hash TEXT,
        text TEXT,
        updated_at INTEGER
      )
    `);

    engineDb.exec(`
      CREATE TABLE memory_confidence (
        chunk_id TEXT PRIMARY KEY,
        initial_confidence REAL NOT NULL DEFAULT 0.5,
        confidence REAL NOT NULL DEFAULT 0.5,
        last_confidence_update INTEGER,
        base_tau REAL NOT NULL DEFAULT 7.0,
        hit_count INTEGER NOT NULL DEFAULT 0,
        is_archived INTEGER NOT NULL DEFAULT 0,
        is_protected INTEGER NOT NULL DEFAULT 0,
        conflict_flag INTEGER NOT NULL DEFAULT 0,
        category TEXT NOT NULL DEFAULT 'raw_log',
        kg_data TEXT
      )
    `);

    engineDb.exec(`
      CREATE TABLE memory_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        session_id TEXT,
        trace_id TEXT,
        memory_id TEXT,
        latency_ms INTEGER,
        candidate_count INTEGER,
        injected_count INTEGER,
        cited_count INTEGER,
        vector_score REAL,
        fts_score REAL,
        final_score REAL,
        source TEXT,
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const insertChunk = coreDb.prepare(`
      INSERT INTO chunks (id, path, source, start_line, end_line, hash, text, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertChunk.run(
      "aaaaaaaaaaaaaaaa-1",
      "memory/dreaming/foo.md",
      "fixture",
      1,
      10,
      "hash-a",
      "dreaming text",
      1718670000,
    );
    insertChunk.run(
      "bbbbbbbbbbbbbbbb-1",
      "memory/smart-add/2026-06-18.md",
      "fixture",
      11,
      20,
      "hash-b",
      "smart add text",
      1718670100,
    );
    insertChunk.run(
      "cccccccccccccccc-1",
      "memory/stats-history.md",
      "fixture",
      21,
      30,
      "hash-c",
      "stats history text",
      1718670200,
    );
    insertChunk.run(
      "ffffffffffffffff-1",
      "memory/generated-smart-add/2026-06-18.md",
      "fixture",
      26,
      30,
      "hash-f",
      "generated smart add text",
      1718670250,
    );
    insertChunk.run(
      "dddddddddddddddd-1",
      "MEMORY.md",
      "fixture",
      31,
      40,
      "hash-d",
      "memory root text",
      1718670300,
    );
    insertChunk.run(
      "eeeeeeeeeeeeeeee-1",
      "memory/projects/archived.md",
      "fixture",
      41,
      50,
      "hash-e",
      "archived project text",
      1718670400,
    );

    const insertConfidence = engineDb.prepare(`
      INSERT INTO memory_confidence
      (chunk_id, initial_confidence, confidence, last_confidence_update, base_tau, hit_count, is_archived, is_protected, conflict_flag, category, kg_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertConfidence.run(
      "aaaaaaaaaaaaaaaa-1",
      0.7,
      0.8,
      1718600000,
      30,
      5,
      0,
      0,
      0,
      "dreaming",
      "{\"nodes\":1}",
    );
    insertConfidence.run(
      "dddddddddddddddd-1",
      0.8,
      0.9,
      1718610000,
      90,
      7,
      0,
      1,
      0,
      "preference",
      null,
    );
    insertConfidence.run(
      "eeeeeeeeeeeeeeee-1",
      0.5,
      0.4,
      1718620000,
      7,
      1,
      1,
      0,
      0,
      "project",
      null,
    );
    insertConfidence.run(
      "bbbbbbbbbbbbbbbb",
      0.5,
      0.5,
      1717200000,
      7,
      0,
      0,
      0,
      0,
      "raw_log",
      null,
    );
    insertConfidence.run(
      "zzzzzzzzzzzzzzzz-missing",
      0.5,
      0.5,
      1717286400,
      7,
      0,
      0,
      0,
      0,
      "raw_log",
      null,
    );

    const insertEvent = engineDb.prepare(`
      INSERT INTO memory_events
      (event_type, session_id, trace_id, memory_id, latency_ms, candidate_count, injected_count, cited_count, vector_score, fts_score, final_score, source, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertEvent.run(
      "memory_candidate_retrieved",
      "s1",
      "t1",
      "aaaaaaaaaaaaaaaa",
      10,
      2,
      0,
      0,
      0.9,
      0.1,
      0.8,
      "autoRecall",
      null,
      "2026-06-18 10:00:00",
    );
    insertEvent.run(
      "memory_injected",
      "s1",
      "t1",
      "aaaaaaaaaaaaaaaa",
      12,
      2,
      1,
      1,
      0.9,
      0.1,
      0.85,
      "autoRecall",
      null,
      "2026-06-18 10:01:00",
    );
    insertEvent.run(
      "memory_candidate_retrieved",
      "s2",
      "t2",
      "nomatchprefix1234",
      8,
      1,
      0,
      0,
      0.5,
      0.2,
      0.4,
      "autoRecall",
      null,
      "2026-06-18 10:02:00",
    );
  } finally {
    coreDb.close();
    engineDb.close();
  }

  return { corePath, enginePath };
}

async function importCollectorForFixture() {
  const bust = Date.now();
  return import(`../lib/quality/collect-quality-candidates.js?quality=${bust}`);
}

function makeScoredFixtureItems() {
  const duplicateFlags = evaluateDuplicateFlags([
    {
      id: "dup-1",
      path: "memory/smart-add/2026-06-18.md",
      path_family: "smart-add",
      text: "Same duplicate memory",
      category: "raw_log",
      source: "fixture",
      has_confidence_record: true,
    },
    {
      id: "dup-2",
      path: "memory/smart-add/2026-06-19.md",
      path_family: "smart-add",
      text: " same   duplicate   memory ",
      category: "raw_log",
      source: "fixture",
      has_confidence_record: true,
    },
  ]);

  const rawItems = [
    {
      id: "good-1",
      path: "memory/projects/roadmap.md",
      path_family: "projects",
      source: "fixture",
      text: "Completed v0.8.4-cli-core-guard update; kept docs/runtime-sync.md aligned and tagged commit abc1234 for rollout.",
      updated_at: 1718900000,
      category: "project",
      retrieved_count: 2,
      injected_count: 1,
      has_confidence_record: true,
    },
    {
      id: "dup-1",
      path: "memory/smart-add/2026-06-18.md",
      path_family: "smart-add",
      source: "fixture",
      text: "Same duplicate memory",
      updated_at: 1717000000,
      category: "raw_log",
      retrieved_count: 0,
      injected_count: 0,
      has_confidence_record: true,
    },
    {
      id: "dup-2",
      path: "memory/smart-add/2026-06-19.md",
      path_family: "smart-add",
      source: "fixture",
      text: " same   duplicate   memory ",
      updated_at: 1717000000,
      category: "raw_log",
      retrieved_count: 0,
      injected_count: 0,
      has_confidence_record: true,
    },
    {
      id: "bad-1",
      path: "memory/smart-add/debug.md",
      path_family: "smart-add",
      source: "fixture",
      text: "TypeError: boom\n    at runTask (/tmp/app.js:10:3)",
      updated_at: 1716000000,
      category: "raw_log",
      retrieved_count: 0,
      injected_count: 0,
      has_confidence_record: false,
      conflict_flag: 1,
    },
  ];

  return rawItems.map(item => {
    const qualityScope = classifyQualityScope(item.path);
    const evaluated = evaluateQualityFlags(item, {
      nowSec: 1719000000,
      duplicateFlags,
    });
    const scored = scoreQualityItem(evaluated.flags, item);
    return {
      ...item,
      quality_scope_family: qualityScope.family,
      quality_scope_owner: qualityScope.owner,
      expected_confidence: qualityScope.expected_confidence,
      default_quality_score_scope: qualityScope.default_quality_score_scope,
      diagnostic_scope: qualityScope.diagnostic_scope,
      retrieval_visible: qualityScope.retrieval_visible,
      quality_scope_reason: qualityScope.reason,
      ...evaluated,
      ...scored,
    };
  });
}

function makeOwnershipDiagnosticsFixture() {
  return {
    chunks_count: 4,
    memory_confidence_count: 3,
    memory_events_count: 2,
    exact_orphan_confidence_count: 1,
    truly_missing_orphan_confidence_count: 1,
    fake_orphan_confidence_count: 0,
    orphan_confidence_month_distribution: { "2026-06": 1 },
    orphan_confidence_event_prefix_seen_count: 0,
    sample_orphan_confidence_ids: ["orph-1"],
    chunks_without_confidence_count: 1,
    chunks_without_confidence_lifecycle_owned_count: 1,
    chunks_without_confidence_core_owned_count: 0,
    chunks_without_confidence_generated_diagnostic_count: 0,
    chunks_without_confidence_legacy_manual_count: 0,
    chunks_without_confidence_unknown_count: 0,
    confidence_id_length_distribution: { "16": 1, "18": 2 },
    event_type_distribution: { memory_candidate_retrieved: 1, memory_injected: 1 },
    chunk_prefix_unique_count: 4,
    chunk_prefix_ambiguous_count: 0,
    event_prefix_total_distinct: 2,
    event_prefix_matched_count: 1,
    event_prefix_unmatched_count: 1,
    event_prefix_ambiguous_count: 0,
    cite_signal_sparse: { retrieved_signal_count: 1, cite_signal_count: 1, sparse: true },
    path_family_distribution: { projects: 1, "smart-add": 3 },
    quality_scope_family_distribution: { project: 1, smart_add: 3 },
    quality_scope_owner_distribution: { memory_engine_lifecycle: 3, memory_engine_legacy_or_manual: 1 },
    non_lifecycle_recall_warnings: {
      non_lifecycle_retrieved_count: 1,
      non_lifecycle_injected_count: 1,
      examples: [
        {
          id: "good-1",
          path: "memory/projects/roadmap.md",
          owner: "memory_engine_legacy_or_manual",
          family: "project",
          retrieved_count: 2,
          injected_count: 1,
          reason: "project memory files look legacy or manual relative to the current confidence lifecycle",
        },
      ],
    },
  };
}

test("quality types export stable MVP v4 constants", () => {
  assert.deepEqual(grades, {
    A: "A",
    B: "B",
    C: "C",
    D: "D",
  });

  assert.deepEqual(actions, {
    keep: "keep",
    review: "review",
    dedupe_candidate: "dedupe_candidate",
    repair_candidate: "repair_candidate",
    archive_candidate: "archive_candidate",
  });

  assert.equal(p0PerMemoryFlags.missing_content, "missing_content");
  assert.equal(p0PerMemoryFlags.chunks_without_confidence, "chunks_without_confidence");
  assert.equal(p1PerMemoryFlags.duplicate_near, "duplicate_near");
  assert.equal(diagnosticsOnlyNames.orphan_confidence, "orphan_confidence");
  assert.equal(diagnosticsOnlyNames.path_family_unknown, "path_family_unknown");
});

test("getPathFamily classifies managed memory paths", () => {
  assert.equal(getPathFamily("memory/dreaming/foo.md"), "dreaming");
  assert.equal(getPathFamily("memory/episodes/2026-06-18.md"), "episodes");
  assert.equal(getPathFamily("memory/legacy-daily-mirrors/2026-06-18.md"), "legacy-daily-mirrors");
  assert.equal(getPathFamily("memory/2026-06-18.md"), "daily-root");
  assert.equal(getPathFamily("memory/smart-add/2026-06-18.md"), "smart-add");
  assert.equal(getPathFamily("memory/generated-smart-add/2026-06-18.md"), "generated-smart-add");
});

test("ownership-aware quality scope classifies initial ownership rules", () => {
  assert.equal(getQualityScopeFamily("memory/dreaming/foo.md"), "dreaming");
  assert.equal(getQualityScopeFamily("memory/episodes/2026-06-18.md"), "episode");
  assert.equal(getQualityScopeFamily("memory/generated-smart-add/2026-06-18.md"), "generated_smart_add");
  assert.equal(getQualityScopeFamily("memory/legacy-daily-mirrors/2026-06-18.md"), "quarantined_daily_mirror");
  assert.equal(getQualityScopeFamily("memory/2026-06-18.md"), "daily_memory");
  assert.equal(getQualityScopeFamily("MEMORY.md"), "curated_memory");
  assert.equal(getQualityScopeFamily("memory/projects/a.md"), "project");
  assert.equal(getQualityScopeFamily("memory/raw_log/a.md"), "raw_log");
  assert.equal(getQualityScopeFamily("memory/custom/a.md"), "unknown");

  assert.deepEqual(classifyQualityScope("memory/smart-add/2026-06-18.md"), {
    family: "smart_add",
    owner: "memory_engine_lifecycle",
    expected_confidence: true,
    default_quality_score_scope: true,
    diagnostic_scope: true,
    retrieval_visible: true,
    reason: "smart-add chunks are lifecycle-owned by memory-engine and should carry confidence metadata",
  });
  assert.equal(classifyQualityScope("memory/dreaming/foo.md").default_quality_score_scope, false);
  assert.deepEqual(classifyQualityScope("memory/generated-smart-add/2026-06-18.md"), {
    family: "generated_smart_add",
    owner: "memory_engine_generated_or_diagnostic",
    expected_confidence: false,
    default_quality_score_scope: false,
    diagnostic_scope: true,
    retrieval_visible: false,
    reason: "generated smart-add is checkpoint output, not eligible for recall or quality scoring",
  });
  assert.equal(classifyQualityScope("memory/legacy-daily-mirrors/2026-06-18.md").retrieval_visible, false);
  assert.equal(classifyQualityScope("MEMORY.md").owner, "openclaw_core");
  assert.equal(classifyQualityScope("memory/2026-06-18.md").retrieval_visible, true);
  assert.equal(classifyQualityScope("memory/custom/a.md").owner, "unknown");
  assert.equal(classifyQualityScope("memory/custom/a.md").expected_confidence, true);
});

test("default active-memory scope is ownership-aware and excludes dreaming", () => {
  assert.equal(isDefaultIncludedPathFamily("dreaming"), false);
  assert.equal(isDefaultIncludedPathFamily("episodes"), true);
  assert.equal(isDefaultIncludedPathFamily("generated-smart-add"), false);
  assert.equal(isActiveMemoryPath("memory/dreaming/foo.md"), false);
  assert.equal(isActiveMemoryPath("memory/episodes/2026-06-18.md"), true);
  assert.equal(isActiveMemoryPath("memory/generated-smart-add/2026-06-18.md"), false);
});

test("stats-history is excluded from default active-memory scope", () => {
  const family = getPathFamily("memory/stats-history.md");
  assert.equal(family, "stats-history");
  assert.equal(isDefaultIncludedPathFamily(family), false);
  assert.equal(isActiveMemoryPath("memory/stats-history.md"), false);
});

test("MEMORY.md is classified as memory-root and excluded from default score scope", () => {
  const family = getPathFamily("MEMORY.md");
  assert.equal(family, "memory-root");
  assert.equal(isDefaultIncludedPathFamily(family), false);
  assert.equal(isActiveMemoryPath("MEMORY.md"), false);
});

test("unknown paths fall back to non-memory and stay excluded", () => {
  assert.equal(getPathFamily("docs/unknown.md"), "non-memory");
  assert.equal(isDefaultIncludedPathFamily("non-memory"), false);
  assert.equal(isActiveMemoryPath("docs/unknown.md"), false);
});

test("attachEventStatsByPrefix attaches stats for a single prefix match", () => {
  const result = attachEventStatsByPrefix(
    [
      { id: "1234567890abcdef-aaa" },
      { id: "fedcba0987654321-bbb" },
    ],
    [
      {
        memory_id: "1234567890abcdef",
        retrieved_count: 3,
        injected_count: 1,
        last_retrieved_at: 1710000000,
        last_injected_at: 1710000100,
      },
    ]
  );

  assert.deepEqual(result.candidates[0], {
    id: "1234567890abcdef-aaa",
    id_prefix16: "1234567890abcdef",
    retrieved_count: 3,
    injected_count: 1,
    last_retrieved_at: 1710000000,
    last_injected_at: 1710000100,
    event_prefix_matched: true,
    event_prefix_ambiguous: false,
  });
  assert.deepEqual(result.candidates[1], {
    id: "fedcba0987654321-bbb",
    id_prefix16: "fedcba0987654321",
    retrieved_count: 0,
    injected_count: 0,
    last_retrieved_at: null,
    last_injected_at: null,
    event_prefix_matched: false,
    event_prefix_ambiguous: false,
  });
  assert.deepEqual(result.diagnostics, {
    chunk_prefix_unique_count: 2,
    chunk_prefix_ambiguous_count: 0,
    event_prefix_total_distinct: 1,
    event_prefix_matched_count: 1,
    event_prefix_unmatched_count: 0,
    event_prefix_ambiguous_count: 0,
  });
});

test("attachEventStatsByPrefix counts unmatched event prefixes without attaching stats", () => {
  const result = attachEventStatsByPrefix(
    [{ id: "1234567890abcdef-aaa" }],
    [
      {
        memory_id: "ffffffffffffffff",
        retrieved_count: 7,
        injected_count: 2,
        last_retrieved_at: 1710000200,
        last_injected_at: 1710000300,
      },
    ]
  );

  assert.equal(result.candidates[0].event_prefix_matched, false);
  assert.equal(result.candidates[0].event_prefix_ambiguous, false);
  assert.equal(result.candidates[0].retrieved_count, 0);
  assert.equal(result.candidates[0].injected_count, 0);
  assert.equal(result.diagnostics.event_prefix_total_distinct, 1);
  assert.equal(result.diagnostics.event_prefix_unmatched_count, 1);
  assert.equal(result.diagnostics.event_prefix_matched_count, 0);
});

test("attachEventStatsByPrefix counts ambiguous event prefixes and leaves candidates untouched", () => {
  const result = attachEventStatsByPrefix(
    [
      { id: "1234567890abcdef-aaa" },
      { id: "1234567890abcdef-bbb" },
      { id: "fedcba0987654321-ccc" },
    ],
    [
      {
        memory_id: "1234567890abcdef",
        retrieved_count: 4,
        injected_count: 2,
        last_retrieved_at: 1710000400,
        last_injected_at: 1710000500,
      },
    ]
  );

  assert.equal(result.candidates[0].retrieved_count, 0);
  assert.equal(result.candidates[1].retrieved_count, 0);
  assert.equal(result.candidates[0].event_prefix_matched, false);
  assert.equal(result.candidates[1].event_prefix_matched, false);
  assert.deepEqual(result.diagnostics, {
    chunk_prefix_unique_count: 1,
    chunk_prefix_ambiguous_count: 1,
    event_prefix_total_distinct: 1,
    event_prefix_matched_count: 0,
    event_prefix_unmatched_count: 0,
    event_prefix_ambiguous_count: 1,
  });
});

test("collectQualityCandidates reads chunks and confidence in readonly mode with default filters", async () => {
  const { corePath, enginePath } = createQualityFixtureDbs();
  const oldCore = process.env.MEMORY_ENGINE_CORE_DB;
  const oldEngine = process.env.MEMORY_ENGINE_DB;
  process.env.MEMORY_ENGINE_CORE_DB = corePath;
  process.env.MEMORY_ENGINE_DB = enginePath;

  try {
    const { collectQualityCandidates } = await importCollectorForFixture();
    const result = collectQualityCandidates();

    assert.equal(result.scope, "active-memory");
    assert.equal(result.candidates.length, 1);

    const byId = new Map(result.candidates.map(candidate => [candidate.id, candidate]));
    assert.equal(byId.has("aaaaaaaaaaaaaaaa-1"), false);
    assert.equal(byId.has("bbbbbbbbbbbbbbbb-1"), true);
    assert.equal(byId.has("dddddddddddddddd-1"), false);
    assert.equal(byId.has("cccccccccccccccc-1"), false);
    assert.equal(byId.has("eeeeeeeeeeeeeeee-1"), false);
    assert.equal(byId.has("ffffffffffffffff-1"), false);

    assert.equal(byId.get("bbbbbbbbbbbbbbbb-1").has_confidence_record, false);
    assert.equal(byId.get("bbbbbbbbbbbbbbbb-1").path_family, "smart-add");
    assert.equal(byId.get("bbbbbbbbbbbbbbbb-1").quality_scope_family, "smart_add");
    assert.equal(byId.get("bbbbbbbbbbbbbbbb-1").quality_scope_owner, "memory_engine_lifecycle");
    assert.equal(byId.get("bbbbbbbbbbbbbbbb-1").expected_confidence, true);
    assert.equal(byId.get("bbbbbbbbbbbbbbbb-1").default_quality_score_scope, true);

    assert.equal(byId.get("bbbbbbbbbbbbbbbb-1").retrieved_count, 0);

    assert.equal(result.diagnostics.chunks_count, 1);
    assert.equal(result.diagnostics.memory_confidence_count, 5);
    assert.equal(result.diagnostics.memory_events_count, 3);
    assert.equal(result.diagnostics.chunks_without_confidence_count, 1);
    assert.equal(result.diagnostics.path_family_distribution["smart-add"], 1);
    assert.equal(result.diagnostics.quality_scope_family_distribution.smart_add, 1);
    assert.equal(result.diagnostics.quality_scope_owner_distribution.memory_engine_lifecycle, 1);
    assert.equal(result.diagnostics.chunks_without_confidence_lifecycle_owned_count, 1);
    assert.equal(result.diagnostics.chunks_without_confidence_core_owned_count, 0);
    assert.equal(result.diagnostics.event_prefix_matched_count, 0);
    assert.equal(result.diagnostics.event_prefix_unmatched_count, 2);
    assert.equal(result.diagnostics.event_prefix_ambiguous_count, 0);
  } finally {
    if (oldCore === undefined) delete process.env.MEMORY_ENGINE_CORE_DB;
    else process.env.MEMORY_ENGINE_CORE_DB = oldCore;
    if (oldEngine === undefined) delete process.env.MEMORY_ENGINE_DB;
    else process.env.MEMORY_ENGINE_DB = oldEngine;
  }
});

test("collectQualityCandidates can include stats-history and archived entries when requested", async () => {
  const { corePath, enginePath } = createQualityFixtureDbs();
  const oldCore = process.env.MEMORY_ENGINE_CORE_DB;
  const oldEngine = process.env.MEMORY_ENGINE_DB;
  process.env.MEMORY_ENGINE_CORE_DB = corePath;
  process.env.MEMORY_ENGINE_DB = enginePath;

  try {
    const { collectQualityCandidates } = await importCollectorForFixture();
    const result = collectQualityCandidates({
      includeArchived: true,
      includeStatsHistory: true,
      scope: "all",
    });

    const ids = new Set(result.candidates.map(candidate => candidate.id));
    assert.equal(ids.has("cccccccccccccccc-1"), true);
    assert.equal(ids.has("eeeeeeeeeeeeeeee-1"), true);
    assert.equal(ids.has("ffffffffffffffff-1"), false);
    assert.equal(result.diagnostics.path_family_distribution["stats-history"], 1);
  } finally {
    if (oldCore === undefined) delete process.env.MEMORY_ENGINE_CORE_DB;
    else process.env.MEMORY_ENGINE_CORE_DB = oldCore;
    if (oldEngine === undefined) delete process.env.MEMORY_ENGINE_DB;
    else process.env.MEMORY_ENGINE_DB = oldEngine;
  }
});

test("collectQualityCandidates supports episodes path-family filter", async () => {
  const { corePath, enginePath } = createQualityFixtureDbs();
  const oldCore = process.env.MEMORY_ENGINE_CORE_DB;
  const oldEngine = process.env.MEMORY_ENGINE_DB;
  process.env.MEMORY_ENGINE_CORE_DB = corePath;
  process.env.MEMORY_ENGINE_DB = enginePath;

  try {
    const { collectQualityCandidates } = await importCollectorForFixture();
    const result = collectQualityCandidates({
      pathFamily: "dreaming",
      scope: "active-memory",
    });

    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].path_family, "dreaming");
    assert.equal(result.candidates[0].default_quality_score_scope, false);
    assert.equal(result.candidates[0].quality_scope_owner, "memory_engine_generated_or_diagnostic");
    assert.equal(result.diagnostics.path_family_distribution["dreaming"], 1);
    assert.equal(result.diagnostics.non_lifecycle_recall_warnings.non_lifecycle_retrieved_count, 1);
    assert.equal(result.diagnostics.non_lifecycle_recall_warnings.non_lifecycle_injected_count, 1);
  } finally {
    if (oldCore === undefined) delete process.env.MEMORY_ENGINE_CORE_DB;
    else process.env.MEMORY_ENGINE_CORE_DB = oldCore;
    if (oldEngine === undefined) delete process.env.MEMORY_ENGINE_DB;
    else process.env.MEMORY_ENGINE_DB = oldEngine;
  }
});

test("collectQualityCandidates keeps orphan confidence in diagnostics only", async () => {
  const { corePath, enginePath } = createQualityFixtureDbs();
  const oldCore = process.env.MEMORY_ENGINE_CORE_DB;
  const oldEngine = process.env.MEMORY_ENGINE_DB;
  process.env.MEMORY_ENGINE_CORE_DB = corePath;
  process.env.MEMORY_ENGINE_DB = enginePath;

  try {
    const { collectQualityCandidates } = await importCollectorForFixture();
    const result = collectQualityCandidates();

    const candidateIds = new Set(result.candidates.map(candidate => candidate.id));
    assert.equal(candidateIds.has("bbbbbbbbbbbbbbbb"), false);
    assert.equal(candidateIds.has("zzzzzzzzzzzzzzzz-missing"), false);
    assert.equal(result.diagnostics.exact_orphan_confidence_count, 2);
    assert.equal(result.diagnostics.fake_orphan_confidence_count, 1);
    assert.equal(result.diagnostics.truly_missing_orphan_confidence_count, 1);
    assert.equal(result.diagnostics.orphan_confidence_event_prefix_seen_count, 0);
    assert.deepEqual(result.diagnostics.sample_orphan_confidence_ids, [
      "bbbbbbbbbbbbbbbb",
      "zzzzzzzzzzzzzzzz-missing",
    ]);
    assert.equal(result.diagnostics.confidence_id_length_distribution["16"], 1);
  } finally {
    if (oldCore === undefined) delete process.env.MEMORY_ENGINE_CORE_DB;
    else process.env.MEMORY_ENGINE_CORE_DB = oldCore;
    if (oldEngine === undefined) delete process.env.MEMORY_ENGINE_DB;
    else process.env.MEMORY_ENGINE_DB = oldEngine;
  }
});

test("evaluateQualityFlags marks missing and empty content deterministically", () => {
  const missing = evaluateQualityFlags({
    id: "m1",
    path: "memory/smart-add/a.md",
    category: "raw_log",
    has_confidence_record: true,
  }, { nowSec: 1719000000 });
  const empty = evaluateQualityFlags({
    id: "m2",
    path: "memory/smart-add/b.md",
    text: "   ",
    category: "raw_log",
    has_confidence_record: true,
  }, { nowSec: 1719000000 });

  assert.equal(missing.p0_flags.includes("missing_content"), true);
  assert.equal(empty.p0_flags.includes("content_empty"), true);
});

test("evaluateQualityFlags marks short, timestamp-polluted, raw-log, and debug-noise content", () => {
  const short = evaluateQualityFlags({
    id: "s1",
    path: "memory/smart-add/a.md",
    text: "hello world",
    category: "raw_log",
    has_confidence_record: true,
  }, { nowSec: 1719000000 });
  const timestamped = evaluateQualityFlags({
    id: "s2",
    path: "memory/smart-add/b.md",
    text: "[2026-06-18 10:01:02] sync complete",
    category: "raw_log",
    has_confidence_record: true,
  }, { nowSec: 1719000000 });
  const rawLog = evaluateQualityFlags({
    id: "s3",
    path: "memory/smart-add/c.md",
    text: "User: discussed scope\nAssistant: proposed plan",
    category: "raw_log",
    has_confidence_record: true,
  }, { nowSec: 1719000000 });
  const debug = evaluateQualityFlags({
    id: "s4",
    path: "memory/smart-add/d.md",
    text: "TypeError: boom\n    at runTask (/tmp/app.js:10:3)",
    category: "raw_log",
    has_confidence_record: true,
  }, { nowSec: 1719000000 });
  const sessionHeading = evaluateQualityFlags({
    id: "s5",
    path: "memory/2026-06-18-2208.md",
    text: "# Session: 2026-06-18 22:08:20 GMT+8\n\n## Conversation",
    category: null,
    has_confidence_record: true,
  }, { nowSec: 1719000000 });
  const episodeMetadata = evaluateQualityFlags({
    id: "s6",
    path: "memory/episodes/2026-06-18.md",
    text: "# Episode: 2026-06-18\n\ngeneratedAt: 2026-06-19T12:00:00.000Z\n\n---\n_Generated at 2026-06-19T12:00:00.000Z_",
    category: "episodic",
    has_confidence_record: true,
  }, { nowSec: 1719000000 });

  assert.equal(short.p0_flags.includes("content_too_short"), true);
  assert.equal(timestamped.p0_flags.includes("timestamp_pollution"), true);
  assert.equal(rawLog.p0_flags.includes("raw_log_leak"), true);
  assert.equal(debug.p0_flags.includes("debug_noise"), true);
  assert.equal(sessionHeading.p0_flags.includes("timestamp_pollution"), false);
  assert.equal(episodeMetadata.p0_flags.includes("timestamp_pollution"), false);
});

test("evaluateDuplicateFlags detects exact duplicates via normalized text", () => {
  const duplicates = evaluateDuplicateFlags([
    { id: "d1", text: "  Same   MEMORY  " },
    { id: "d2", text: "same memory" },
    { id: "d3", text: "" },
  ]);

  assert.equal(duplicates.byId.get("d1").duplicate_exact, true);
  assert.equal(duplicates.byId.get("d2").duplicate_exact, true);
  assert.equal(duplicates.byId.get("d3").duplicate_exact, false);

  const evaluated = evaluateQualityFlags({
    id: "d1",
    path: "memory/smart-add/d1.md",
    text: "Same memory",
    category: "raw_log",
    has_confidence_record: true,
  }, {
    nowSec: 1719000000,
    duplicateFlags: duplicates,
  });
  assert.equal(evaluated.p0_flags.includes("duplicate_exact"), true);
});

test("evaluateQualityFlags marks conflict and missing confidence record", () => {
  const result = evaluateQualityFlags({
    id: "c1",
    path: "memory/projects/roadmap.md",
    text: "Project roadmap decision: keep v0.8.4 and docs/runtime-sync.md updated.",
    category: "project",
    has_confidence_record: false,
    conflict_flag: 1,
  }, { nowSec: 1719000000 });

  assert.equal(result.p0_flags.includes("conflict_flagged"), true);
  assert.equal(result.p0_flags.includes("chunks_without_confidence"), true);
});

test("evaluateQualityFlags applies deterministic age gates for utility flags", () => {
  const oldUnused = evaluateQualityFlags({
    id: "u1",
    path: "memory/projects/old.md",
    text: "Project migration note with file path src/index.js and status blocked.",
    category: "project",
    has_confidence_record: true,
    last_confidence_update: 1715000000,
    retrieved_count: 0,
    injected_count: 0,
  }, { nowSec: 1719000000 });
  const midNeverRetrieved = evaluateQualityFlags({
    id: "u2",
    path: "memory/projects/mid.md",
    text: "Project migration note with file path src/index.js and status blocked.",
    category: "project",
    has_confidence_record: true,
    updated_at: 1717600000,
    retrieved_count: 0,
    injected_count: 1,
  }, { nowSec: 1719000000 });
  const fresh = evaluateQualityFlags({
    id: "u3",
    path: "memory/projects/new.md",
    text: "Project migration note with file path src/index.js and status blocked.",
    category: "project",
    has_confidence_record: true,
    updated_at: 1718900000,
    retrieved_count: 0,
    injected_count: 0,
  }, { nowSec: 1719000000 });

  assert.equal(oldUnused.p1_flags.includes("old_and_unused"), true);
  assert.equal(oldUnused.p1_flags.includes("never_retrieved"), false);
  assert.equal(midNeverRetrieved.p1_flags.includes("never_retrieved"), true);
  assert.equal(fresh.p1_flags.includes("never_retrieved"), false);
  assert.equal(fresh.p1_flags.includes("old_and_unused"), false);
});

test("evaluateQualityFlags marks obvious category mismatches and generic summaries conservatively", () => {
  const mismatch = evaluateQualityFlags({
    id: "mismatch-1",
    path: "memory/projects/roadmap.md",
    text: "用户讨论了项目",
    category: "raw_log",
    has_confidence_record: true,
  }, { nowSec: 1719000000 });
  const highQuality = evaluateQualityFlags({
    id: "hq-1",
    path: "memory/projects/roadmap.md",
    text: "Completed v0.8.4-cli-core-guard update; kept docs/runtime-sync.md aligned and tagged commit abc1234 for rollout.",
    category: "project",
    has_confidence_record: true,
  }, { nowSec: 1719000000 });

  assert.equal(mismatch.p0_flags.includes("category_path_mismatch"), true);
  assert.equal(mismatch.p0_flags.includes("too_generic"), true);
  assert.equal(highQuality.p0_flags.includes("too_generic"), false);
});

test("scoreQualityItem applies hard caps for severe deterministic flags", () => {
  assert.equal(scoreQualityItem(["content_empty"]).score <= 20, true);
  assert.equal(scoreQualityItem(["raw_log_leak"]).score <= 40, true);
  assert.equal(scoreQualityItem(["debug_noise"]).score <= 55, true);
  assert.equal(scoreQualityItem(["duplicate_exact"]).score <= 60, true);
  assert.equal(scoreQualityItem(["conflict_flagged"]).score <= 65, true);
  assert.equal(scoreQualityItem(["chunks_without_confidence"]).score <= 70, true);
});

test("scoreQualityItem ignores diagnostics-only orphan flag semantics for hard caps", () => {
  const result = scoreQualityItem(["orphan_confidence", "never_retrieved"]);
  assert.equal(result.score, 94);
  assert.equal(result.grade, "A");
  assert.equal(result.penalties.some(item => item.flag === "orphan_confidence"), false);
});

test("scoreQualityItem keeps utility flags as light penalties without hard caps", () => {
  const neverRetrieved = scoreQualityItem(["never_retrieved"]);
  const oldUnused = scoreQualityItem(["old_and_unused"]);

  assert.equal(neverRetrieved.score, 94);
  assert.equal(neverRetrieved.grade, "A");
  assert.equal(oldUnused.score, 86);
  assert.equal(oldUnused.grade, "A");
  assert.equal(oldUnused.penalties.some(item => Object.hasOwn(item, "max_score")), false);
});

test("scoreQualityItem gives high-quality items an A or B and suggested keep action", () => {
  const flags = evaluateQualityFlags({
    id: "score-hq",
    path: "memory/projects/roadmap.md",
    text: "Completed v0.8.4-cli-core-guard update; kept docs/runtime-sync.md aligned and tagged commit abc1234 for rollout.",
    category: "project",
    has_confidence_record: true,
    retrieved_count: 2,
    injected_count: 1,
    updated_at: 1718900000,
  }, { nowSec: 1719000000 });

  const scored = scoreQualityItem(flags.flags);
  assert.equal(["A", "B"].includes(scored.grade), true);
  assert.equal(scored.suggested_action, "keep");
});

test("scoreQualityItem suggested_action follows deterministic remediation priorities", () => {
  assert.equal(scoreQualityItem(["duplicate_exact"]).suggested_action, "dedupe_candidate");
  assert.equal(scoreQualityItem(["chunks_without_confidence"]).suggested_action, "repair_candidate");
  assert.equal(scoreQualityItem(["debug_noise"]).suggested_action, "repair_candidate");
  assert.equal(scoreQualityItem(["conflict_flagged"]).suggested_action, "review");
  assert.equal(scoreQualityItem(["old_and_unused", "raw_log_leak"]).suggested_action, "archive_candidate");
  assert.equal(scoreQualityItem(["content_empty"]).suggested_action, "review");
});

test("buildQualityReport returns stable JSON-ready fields and duplicate groups", () => {
  const items = makeScoredFixtureItems();
  const diagnostics = makeOwnershipDiagnosticsFixture();

  const report = buildQualityReport({
    items,
    diagnostics,
    options: {
      runId: "run-123",
      generatedAt: "2026-06-19T12:00:00.000Z",
      gitSha: "abc1234",
      scope: "active-memory",
      topN: 5,
    },
  });

  assert.equal(report.run_id, "run-123");
  assert.equal(report.generated_at, "2026-06-19T12:00:00.000Z");
  assert.equal(report.git_sha, "abc1234");
  assert.equal(report.scope, "active-memory");
  assert.equal(report.summary.total_items, 4);
  assert.equal(report.diagnostics.chunks_count, 4);
  assert.equal(Array.isArray(report.items), true);
  assert.equal(report.groups.duplicates.length, 1);
  assert.equal(report.groups.duplicates[0].count, 2);
  assert.equal(report.groups.duplicates[0].suggested_action, "dedupe_candidate");
  assert.equal(report.breakdowns.by_category.project.count, 1);
  assert.equal(report.breakdowns.by_path_family["smart-add"].count, 3);
  assert.equal(report.breakdowns.by_quality_scope_owner.memory_engine_lifecycle.count, 3);
  assert.equal(report.breakdowns.by_source.fixture.count, 4);
});

test("buildQualityReport markdown includes required sections and MVP notes", () => {
  const report = buildQualityReport({
    items: makeScoredFixtureItems(),
    diagnostics: makeOwnershipDiagnosticsFixture(),
    options: {
      runId: "run-123",
      generatedAt: "2026-06-19T12:00:00.000Z",
      gitSha: "abc1234",
      scope: "active-memory",
    },
  });

  const markdown = report.markdown;
  assert.equal(markdown.includes("# Memory Quality Eval Report"), true);
  assert.equal(markdown.includes("## Summary"), true);
  assert.equal(markdown.includes("## DB Health Diagnostics"), true);
  assert.equal(markdown.includes("## Orphan Confidence Notes"), true);
  assert.equal(markdown.includes("## Scope / Path Family Diagnostics"), true);
  assert.equal(markdown.includes("## Signal Quality Notes"), true);
  assert.equal(markdown.includes("## Top Issues"), true);
  assert.equal(markdown.includes("## Worst Memories"), true);
  assert.equal(markdown.includes("## Duplicate Groups"), true);
  assert.equal(markdown.includes("## Category Breakdown"), true);
  assert.equal(markdown.includes("## Ownership Breakdown"), true);
  assert.equal(markdown.includes("## Ownership Warnings"), true);
  assert.equal(markdown.includes("## Recommended Next Actions"), true);
  assert.equal(markdown.includes("orphan confidence is confirmed stale data"), true);
  assert.equal(markdown.includes("orphan confidence diagnostics-only, not included in per-memory score"), true);
  assert.equal(markdown.includes("cleanup should be handled by a separate dry-run repair script"), true);
  assert.equal(markdown.includes("memory_events.memory_id is a 16-character prefix"), true);
  assert.equal(markdown.includes("chunks.id prefix16 is currently unique_count=4"), true);
  assert.equal(markdown.includes("cited / reinforced signals are too sparse to enter per-memory scoring"), true);
  assert.equal(markdown.includes("age uses last_confidence_update or updated_at as an approximation"), true);
  assert.equal(markdown.includes("stats-history is excluded by default"), true);
  assert.equal(markdown.includes("default quality score scope is ownership-aware"), true);
  assert.equal(markdown.includes("retrieval visibility does not imply memory-engine confidence ownership"), true);
});

test("writeQualityReports writes latest and run-id files and creates output directory", () => {
  const root = mkdtempSync(resolve(tmpdir(), "memory-quality-report-"));
  const outputDir = resolve(root, "nested/reports");
  const report = buildQualityReport({
    items: makeScoredFixtureItems(),
    diagnostics: makeOwnershipDiagnosticsFixture(),
    options: {
      runId: "run-123",
      generatedAt: "2026-06-19T12:00:00.000Z",
      gitSha: "abc1234",
      scope: "active-memory",
    },
  });

  const paths = writeQualityReports(report, { outputDir });
  assert.equal(existsSync(paths.latest_json), true);
  assert.equal(existsSync(paths.latest_md), true);
  assert.equal(existsSync(paths.run_json), true);
  assert.equal(existsSync(paths.run_md), true);

  const parsed = JSON.parse(readFileSync(paths.latest_json, "utf8"));
  const markdown = readFileSync(paths.latest_md, "utf8");
  assert.equal(parsed.run_id, "run-123");
  assert.equal(parsed.diagnostics.chunks_count, 4);
  assert.equal(parsed.groups.duplicates.length, 1);
  assert.equal(markdown.includes("## Duplicate Groups"), true);
});
