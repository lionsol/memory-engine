import test from "node:test";
import assert from "node:assert/strict";

import { projectHybridResultFromCanonical } from "../lib/recall/hybrid/canonical-result.js";
import { hybridSearch } from "../lib/recall/hybrid-search.js";

const TOP_ID = "exact-top-memory-id-01234567890123456789";
const LOWER_ID = "exact-lower-memory-id-01234567890123456789";

function canonicalMemory({ management = "managed", category = "project", path = "memory/projects/canonical.md" } = {}) {
  const external = management === "external";
  return {
    schema_version: 1,
    canonical_id: `cmem:core:${TOP_ID}`,
    memory_id: TOP_ID,
    source: {
      system: "openclaw_core",
      record_type: "chunk",
      record_id: TOP_ID,
      path,
      core_source: "memory",
      line_start: 11,
      line_end: 22,
      text: "FULL CORE TEXT MUST NOT BE RETURNED BY HYBRID SEARCH",
      core_hash: "core-index-hash",
      updated_at: 1780000000123,
    },
    classification: {
      category,
      category_authority: external ? "unknown" : "engine",
      kind: external ? "fact" : "project_state",
      kind_basis: "category",
    },
    temporal: {
      episode_date: null,
      episode_date_basis: null,
    },
    lifecycle: external
      ? {
        management: "external",
        category: null,
        initial_confidence: null,
        confidence: null,
        last_confidence_update: null,
        base_tau_days: null,
        hit_count: null,
        archived: null,
        protected: null,
        conflict: null,
      }
      : {
        management: "managed",
        category,
        initial_confidence: 0.7,
        confidence: 0.91,
        last_confidence_update: 1780000000,
        base_tau_days: 30,
        hit_count: 4,
        archived: false,
        protected: false,
        conflict: false,
      },
    content_ref: {
      mode: "core_chunk",
      content_hash: "sha256:full-core-text-hash",
    },
  };
}

function rankedItem(overrides = {}) {
  return {
    id: TOP_ID,
    text: "bounded runtime preview",
    path: "memory/smart-add/runtime.md",
    category: "raw_log",
    confidence_mode: "external",
    source_type: "openclaw-core",
    external_badge: true,
    decay_eligible: true,
    archive_eligible: true,
    semanticScore: 0.91,
    rrfScore: 0.0164,
    recencyBoost: 0.01,
    categoryBoost: 0.02,
    confidenceBoost: 0.03,
    externalBoost: 0,
    finalScore: 0.9864,
    sources: ["vector"],
    similarity: 0.91,
    confidence: 0.42,
    hits: 99,
    created_at: 1710000000,
    ...overrides,
  };
}

test("pure canonical Hybrid projector keeps exact identity, canonical authority, and runtime evidence separate", () => {
  const result = projectHybridResultFromCanonical(rankedItem(), canonicalMemory());

  assert.equal(result.id, TOP_ID.slice(0, 16));
  assert.equal(result.memory_id, TOP_ID);
  assert.equal(result.canonical_id, `cmem:core:${TOP_ID}`);
  assert.equal(result.path, "memory/projects/canonical.md");
  assert.equal(result.category, "project");
  assert.equal(result.kind, "project_state");
  assert.equal(result.category_authority, "engine");
  assert.equal(result.confidence_mode, "managed");
  assert.equal(result.source_type, "memory-engine-managed");
  assert.equal(result.external_badge, false);
  assert.equal(result.hits, 4);
  assert.equal(result.confidence, 0.42);
  assert.equal(result.final_score, 0.9864);
  assert.equal(result.text, "bounded runtime preview");
  assert.equal(result.source, undefined);
  assert.equal(result.canonical_memory, undefined);
});

test("external canonical Hybrid projection remains external and does not fabricate lifecycle hits", () => {
  const result = projectHybridResultFromCanonical(
    rankedItem({ confidence_mode: "managed", external_badge: false }),
    canonicalMemory({ management: "external", category: "unknown", path: "docs/unmanaged.md" }),
  );

  assert.equal(result.confidence_mode, "external");
  assert.equal(result.source_type, "openclaw-core");
  assert.equal(result.external_badge, true);
  assert.equal(result.hits, 0);
  assert.equal(result.confidence, 0.42);
  assert.equal(result.path, "docs/unmanaged.md");
});

function createIsolatedHybridFixture({ dropCanonicalCore = false, external = false } = {}) {
  const coreQueries = [];
  const engineQueries = [];
  const core = {
    readonly: true,
    prepare(sql) {
      const query = String(sql);
      coreQueries.push(query);
      return {
        all(...params) {
          if (query === "PRAGMA database_list") return [{ name: "main" }];
          if (query.includes("SELECT id, path, updated_at FROM chunks")) {
            return [
              { id: TOP_ID, path: "memory/smart-add/runtime.md", updated_at: 1710000000 },
              { id: LOWER_ID, path: "memory/smart-add/lower.md", updated_at: 1700000000 },
            ];
          }
          if (query.includes("FROM chunks WHERE id IN")) {
            if (dropCanonicalCore) return [];
            return [{
              id: params[0],
              path: "memory/projects/canonical.md",
              source: "memory",
              start_line: 11,
              end_line: 22,
              hash: "core-index-hash",
              text: "FULL CORE TEXT MUST NOT BE RETURNED BY HYBRID SEARCH",
              updated_at: 1780000000123,
            }].filter(row => row.id === TOP_ID);
          }
          return [];
        },
        get() {
          return null;
        },
      };
    },
  };
  const engine = {
    readonly: true,
    prepare(sql) {
      const query = String(sql);
      engineQueries.push(query);
      return {
        all(...params) {
          if (query === "PRAGMA database_list") return [{ name: "main" }];
          if (query.includes("SELECT chunk_id, confidence, last_confidence_update")) {
            return [
              {
                chunk_id: TOP_ID,
                confidence: 0.8,
                last_confidence_update: 1780000000,
                base_tau: 30,
                hit_count: 2,
                is_protected: 0,
                conflict_flag: 0,
                category: "raw_log",
                is_archived: 0,
              },
              {
                chunk_id: LOWER_ID,
                confidence: 0.7,
                last_confidence_update: 1780000000,
                base_tau: 30,
                hit_count: 1,
                is_protected: 0,
                conflict_flag: 0,
                category: "raw_log",
                is_archived: 0,
              },
            ];
          }
          if (query.includes("FROM memory_confidence WHERE chunk_id IN")) {
            if (external) return [];
            return [{
              chunk_id: params[0],
              initial_confidence: 0.7,
              confidence: 0.91,
              last_confidence_update: 1780000000,
              base_tau: 30,
              hit_count: 4,
              is_archived: 0,
              is_protected: 0,
              conflict_flag: 0,
              category: "project",
            }].filter(row => row.chunk_id === TOP_ID);
          }
          return [];
        },
        get() {
          return null;
        },
      };
    },
  };

  return {
    coreQueries,
    engineQueries,
    runtime: {
      withHybridDbAccessScope: async run => run({
        withCoreDb: callback => callback(core),
        withEngineDb: callback => callback(engine),
        capabilities: {
          isolatedFts: true,
          isolatedKg: true,
          isolatedRecent: true,
          legacyFallbackAllowed: false,
        },
      }),
      calcRealtimeConf: row => Number(row.confidence || 0),
      categoryMap: { raw_log: { conf: 0.5, tau: 7 } },
      getMemorySearchManager: async () => ({
        manager: {
          search: async () => ({
            entries: [
              { id: TOP_ID, text: "bounded runtime preview", similarity: 0.91 },
              { id: LOWER_ID, text: "lower ranked preview", similarity: 0.4 },
            ],
          }),
        },
      }),
    },
  };
}

test("isolated Hybrid canonicalizes only served top-K with one Core and one Engine batch query", async () => {
  const fixture = createIsolatedHybridFixture();
  const result = await hybridSearch("x", { topK: 1 }, fixture.runtime);

  assert.equal(result.pool, 2);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].id, TOP_ID.slice(0, 16));
  assert.equal(result.results[0].memory_id, TOP_ID);
  assert.equal(result.results[0].canonical_id, `cmem:core:${TOP_ID}`);
  assert.equal(result.results[0].path, "memory/projects/canonical.md");
  assert.equal(result.results[0].category, "project");
  assert.equal(result.results[0].kind, "project_state");
  assert.equal(result.results[0].confidence_mode, "managed");
  assert.equal(result.results[0].external_badge, false);
  assert.equal(result.results[0].confidence, 0.8);
  assert.equal(result.results[0].hits, 4);
  assert.equal(result.results[0].text, "bounded runtime preview");
  assert.equal(result.results[0].text.includes("FULL CORE TEXT"), false);
  assert.equal(fixture.coreQueries.filter(sql => sql.includes("FROM chunks WHERE id IN")).length, 1);
  assert.equal(fixture.engineQueries.filter(sql => sql.includes("FROM memory_confidence WHERE chunk_id IN")).length, 1);
  assert.equal(result.debug.canonical_result_projection.resolved_count, 1);
  assert.equal(result.debug.canonical_result_projection.category_mismatch_count, 1);
  assert.equal(result.debug.canonical_result_projection.path_mismatch_count, 1);
  assert.equal(result.debug.canonical_result_projection.management_mismatch_count, 0);
  assert.equal(result.debug.canonical_result_projection.dropped_count, 0);
  assert.deepEqual(result.debug.canonical_result_projection.dropped_reasons, {
    core_not_found: 0,
    core_ambiguous: 0,
    core_malformed: 0,
    engine_ambiguous: 0,
    engine_malformed: 0,
    invalid_db_topology: 0,
  });

  const canonicalCoreQuery = fixture.coreQueries.find(sql => sql.includes("FROM chunks WHERE id IN"));
  assert.equal((canonicalCoreQuery.match(/\?/g) || []).length, 1);
});

test("isolated Hybrid drops a failed served canonical result without lower-ranked backfill", async () => {
  const fixture = createIsolatedHybridFixture({ dropCanonicalCore: true });
  const result = await hybridSearch("x", { topK: 1 }, fixture.runtime);

  assert.equal(result.pool, 2);
  assert.deepEqual(result.results, []);
  assert.equal(result.debug.canonical_result_projection.resolved_count, 0);
  assert.equal(result.debug.canonical_result_projection.dropped_count, 1);
  assert.equal(result.debug.canonical_result_projection.dropped_reasons.core_not_found, 1);
  assert.equal(fixture.coreQueries.filter(sql => sql.includes("FROM chunks WHERE id IN")).length, 1);
  assert.equal(fixture.coreQueries.find(sql => sql.includes("FROM chunks WHERE id IN")).includes("lower"), false);
});

test("isolated Hybrid accepts a valid external canonical result", async () => {
  const fixture = createIsolatedHybridFixture({ external: true });
  const result = await hybridSearch("x", { topK: 1 }, fixture.runtime);

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].memory_id, TOP_ID);
  assert.equal(result.results[0].confidence_mode, "external");
  assert.equal(result.results[0].source_type, "openclaw-core");
  assert.equal(result.results[0].external_badge, true);
  assert.equal(result.results[0].hits, 0);
  assert.equal(result.debug.canonical_result_projection.resolved_count, 1);
});
