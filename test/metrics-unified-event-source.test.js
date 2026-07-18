import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { mkdtempSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { tableExists } from "../lib/db/schema.js";
import { readUnifiedMemoryEvents } from "../console/services/metrics-service.js";

const EVENTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS memory_events (
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
`;

function insertEvent(db, {
  event_type,
  session_id = "s1",
  trace_id = "t1",
  memory_id = null,
  latency_ms = null,
  candidate_count = null,
  injected_count = null,
  cited_count = null,
  vector_score = null,
  fts_score = null,
  final_score = null,
  source = "autoRecall",
  metadata_json = null,
  created_at = "2026-05-29 12:00:00",
} = {}) {
  db.prepare(`
    INSERT INTO memory_events
      (event_type, session_id, trace_id, memory_id, latency_ms, candidate_count, injected_count, cited_count, vector_score, fts_score, final_score, source, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event_type,
    session_id,
    trace_id,
    memory_id,
    latency_ms,
    candidate_count,
    injected_count,
    cited_count,
    vector_score,
    fts_score,
    final_score,
    source,
    metadata_json,
    created_at,
  );
}

function makeDbPair({ engineEvents = [], coreEvents = [], engineHasTable = true, coreHasTable = true } = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "metrics-unified-"));
  const enginePath = resolve(root, "engine.sqlite");
  const corePath = resolve(root, "core.sqlite");
  const engineDb = new Database(enginePath);
  const coreDb = new Database(corePath);
  try {
    if (engineHasTable) {
      engineDb.exec(EVENTS_TABLE_SQL);
      for (const event of engineEvents) insertEvent(engineDb, event);
    }
    if (coreHasTable) {
      coreDb.exec(EVENTS_TABLE_SQL);
      for (const event of coreEvents) insertEvent(coreDb, event);
    }
  } finally {
    coreDb.close();
  }
  engineDb.exec(`ATTACH DATABASE '${corePath.replace(/'/g, "''")}' AS core`);
  return { engineDb, corePath, enginePath };
}

test("unified events: only ENGINE_DB events", () => {
  const { engineDb } = makeDbPair({
    engineEvents: [{ event_type: "memory_candidate_retrieved", memory_id: "m-engine" }],
    coreHasTable: false,
  });
  try {
    const rows = readUnifiedMemoryEvents(engineDb);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].memory_id, "m-engine");
  } finally {
    engineDb.close();
  }
});

test("unified events: only CORE_DB events", () => {
  const { engineDb } = makeDbPair({
    engineHasTable: false,
    coreEvents: [{ event_type: "memory_candidate_retrieved", memory_id: "m-core" }],
  });
  try {
    const rows = readUnifiedMemoryEvents(engineDb);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].memory_id, "m-core");
  } finally {
    engineDb.close();
  }
});

test("unified events: merge ENGINE_DB and CORE_DB events", () => {
  const { engineDb } = makeDbPair({
    engineEvents: [{ event_type: "memory_candidate_retrieved", memory_id: "m-engine" }],
    coreEvents: [{ event_type: "memory_candidate_retrieved", memory_id: "m-core" }],
  });
  try {
    const rows = readUnifiedMemoryEvents(engineDb);
    assert.equal(rows.length, 2);
    const ids = new Set(rows.map(row => row.memory_id));
    assert.equal(ids.has("m-engine"), true);
    assert.equal(ids.has("m-core"), true);
  } finally {
    engineDb.close();
  }
});

test("unified events: missing core.memory_events does not throw", () => {
  const { engineDb } = makeDbPair({
    engineEvents: [{ event_type: "memory_candidate_retrieved", memory_id: "m-engine" }],
    coreHasTable: false,
  });
  try {
    const rows = readUnifiedMemoryEvents(engineDb);
    assert.equal(Array.isArray(rows), true);
  } finally {
    engineDb.close();
  }
});

test("unified events: missing engine.memory_events does not throw", () => {
  const { engineDb } = makeDbPair({
    engineHasTable: false,
    coreEvents: [{ event_type: "memory_candidate_retrieved", memory_id: "m-core" }],
  });
  try {
    const rows = readUnifiedMemoryEvents(engineDb);
    assert.equal(Array.isArray(rows), true);
    assert.equal(rows.length, 1);
  } finally {
    engineDb.close();
  }
});

test("unified events: duplicate events across engine/core are deduplicated", () => {
  const duplicate = {
    event_type: "memory_candidate_retrieved",
    session_id: "s1",
    trace_id: "t1",
    memory_id: "dup",
    final_score: 0.8,
    metadata_json: JSON.stringify({ rank: 1, category: "episodic" }),
    created_at: "2026-05-29 12:00:00",
  };
  const { engineDb } = makeDbPair({
    engineEvents: [duplicate],
    coreEvents: [duplicate],
  });
  try {
    const rows = readUnifiedMemoryEvents(engineDb);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].memory_id, "dup");
  } finally {
    engineDb.close();
  }
});

test("retrievalMetrics uses unified events for category counts and aggregate", () => {
  const { engineDb } = makeDbPair({
    engineEvents: [
      {
        event_type: "memory_candidate_retrieved",
        memory_id: "m-engine",
        metadata_json: JSON.stringify({ rank: 1, category: "episodic", source_type: "managed", path: "memory/episodes/1.md" }),
      },
      {
        event_type: "recall_completed",
        candidate_count: 1,
        injected_count: 1,
        latency_ms: 100,
      },
      {
        event_type: "auto_recall_debug",
        metadata_json: JSON.stringify({ candidate_count: 1, candidate_count_after_gate: 1, injected_count: 1 }),
      },
      {
        event_type: "hybrid_search_observation",
        trace_id: "hybrid-isolated",
        metadata_json: JSON.stringify({
          schema_version: 1,
          surface: "memory_engine_search",
          search_executed: true,
          kg_access_mode: "isolated",
          recent_access_mode: "isolated",
        }),
      },
    ],
    coreEvents: [
      {
        event_type: "memory_candidate_retrieved",
        memory_id: "m-core",
        metadata_json: JSON.stringify({ rank: 2, category: "project", source_type: "managed", path: "memory/projects/p.md" }),
      },
      {
        event_type: "recall_completed",
        candidate_count: 1,
        injected_count: 0,
        latency_ms: 200,
      },
      {
        event_type: "hybrid_search_observation",
        trace_id: "hybrid-kg-fallback",
        metadata_json: JSON.stringify({
          schema_version: 1,
          surface: "memory_engine_action_search",
          search_executed: true,
          kg_access_mode: "legacy_fallback",
          kg_isolated_fallback_reason: "text_id_invariant_failed",
        }),
      },
    ],
  });
  try {
    const source = readFileSync(new URL("../console/services/metrics-service.js", import.meta.url), "utf8");
    const transformed = source
      .replace(/^import[^\n]*\n/gm, "")
      .replace(/export function /g, "function ");
    const context = {
      tableExists,
      withDb: fn => fn(engineDb),
      getMemoryEngineConfig: () => ({ metrics: { windowDays: 7, topN: 10 } }),
      Date,
      Math,
      JSON,
      Number,
      String,
      Array,
      Object,
      Map,
      Set,
      console,
    };
    vm.runInNewContext(`${transformed}\nthis.__retrievalMetrics = retrievalMetrics;`, context);
    const result = context.__retrievalMetrics({ nowMs: Date.parse("2026-06-01T12:00:00Z") });
    const categoryMap = Object.fromEntries((result.categories || []).map(row => [row.category, Number(row.count) || 0]));
    assert.equal(categoryMap.episodic, 1);
    assert.equal(categoryMap.project, 1);
    assert.equal(result.aggregate.completed, 2);
    assert.equal(JSON.stringify(result.hybrid_fallback_observability), JSON.stringify({
      window_days: 7,
      observation_schema_version: 1,
      observation_schema_versions: { "1": 2 },
      missing_schema_version_events: 0,
      unsupported_schema_version_events: 0,
      observation_start_at: "2026-05-29T12:00:00.000Z",
      search_executed_events: 2,
      search_not_executed_events: 0,
      observed_hybrid_events: 2,
      fully_observed_events: 1,
      partial_observed_events: 1,
      fully_isolated_events: 1,
      fallback_events: 1,
      fallback_rate: 0.5,
      kg_fallback_events: 1,
      recent_fallback_events: 0,
      both_fallback_events: 0,
      observed_by_surface: { memory_engine_action_search: 1, memory_engine_search: 1 },
      production_observed_by_surface: { memory_engine_action_search: 1, memory_engine_search: 1 },
      excluded_from_production_by_surface: {},
      unknown_surface_events: 0,
      fully_observed_by_surface: { memory_engine_search: 1 },
      fallback_by_surface: { memory_engine_action_search: 1 },
      kg_attempted_events: 2,
      recent_attempted_events: 1,
      kg_isolated_events: 1,
      recent_isolated_events: 1,
      kg_fallback_rate: 0.5,
      recent_fallback_rate: 0,
      partial_observation_rate: 0.5,
      kg_modes: { isolated: 1, legacy_fallback: 1 },
      recent_modes: { isolated: 1 },
      kg_fallback_reasons: { text_id_invariant_failed: 1 },
      recent_fallback_reasons: {},
      kg_fail_closed_shadow: {
        events: 0,
        would_fail_closed_events: 0,
        average_candidate_loss_ratio: 0,
        max_candidate_loss_ratio: 0,
        total_dropped_candidates: 0,
      },
      kg_fail_closed_canary: {
        enabled_events: 0,
        applied_events: 0,
        suppressed_fallback_events: 0,
        empty_candidate_events: 0,
        candidate_loss_ratio: 0,
        result_change_events: 0,
      },
      recent_fail_closed_shadow: {
        events: 0,
        would_fail_closed_events: 0,
        average_candidate_loss_ratio: 0,
        max_candidate_loss_ratio: 0,
        risk_level_distribution: {},
      },
      recent_fail_closed_canary_runtime: {
        enabled_events: 0,
        scope_match_events: 0,
        applied_events: 0,
        suppressed_fallback_events: 0,
        empty_candidate_events: 0,
      },
    }));
  } finally {
    engineDb.close();
  }
});
