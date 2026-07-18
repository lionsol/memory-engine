#!/usr/bin/env node

const { writeFileSync } = require("node:fs");
const Database = require("better-sqlite3");

const PRODUCTION_SURFACES = Object.freeze([
  "auto_recall",
  "memory_engine_action_search",
  "memory_engine_search",
]);

const QUERY = "alpha";
const IDS = Object.freeze({
  kg: "kg-legacy-00000001",
  recent: "recent-legacy-0001",
  fts: "fts-keep-000000001",
  vector: "vector-keep-00001",
});

function writeStdout(value = "") {
  writeFileSync(process.stdout.fd, `${value}\n`, "utf8");
}

function writeStderr(value = "") {
  writeFileSync(process.stderr.fd, `${value}\n`, "utf8");
}

function printHelp() {
  console.log(`Run Full Fail-Closed Safety Smoke

Usage:
  node bin/run-full-fail-closed-safety-smoke.js [options]

Options:
  --help        Show this help
  --json        Print JSON output (default)
  --markdown    Print Markdown summary

Safety boundary:
  - Synthetic SQLite :memory: fixtures only
  - No real OpenClaw or memory-engine database access
  - No plugin reload, configuration mutation, network access, or report-file write
  - Exercises auto_recall, memory_engine_action_search, and memory_engine_search surfaces
`);
}

function parseArgs(argv = []) {
  const options = {
    help: false,
    json: false,
    markdown: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "help") {
      options.help = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--markdown") {
      options.markdown = true;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (options.json && options.markdown) {
    throw new Error("choose exactly one output format: --json or --markdown");
  }
  if (!options.json && !options.markdown) options.json = true;
  return options;
}

function createCoreSchema(db) {
  db.exec(`
    CREATE TABLE chunks (
      id PRIMARY KEY,
      text TEXT NOT NULL,
      path TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE chunks_fts USING fts5(
      id UNINDEXED,
      text,
      path
    );
  `);
}

function createEngineSchema(db) {
  db.exec(`
    CREATE TABLE memory_confidence (
      chunk_id PRIMARY KEY,
      initial_confidence REAL,
      confidence REAL,
      last_confidence_update INTEGER,
      base_tau REAL,
      hit_count INTEGER,
      is_archived INTEGER,
      is_protected INTEGER,
      conflict_flag INTEGER,
      category TEXT,
      kg_data TEXT
    );
  `);
}

function candidateRows(nowSec) {
  return [
    {
      id: IDS.kg,
      text: "alpha knowledge graph legacy fallback candidate",
      path: "memory/projects/kg-alpha.md",
      updated_at: nowSec - 10,
      category: "kg_node",
      kg_data: JSON.stringify({ entity: "alpha" }),
    },
    {
      id: IDS.recent,
      text: "alpha recent legacy fallback candidate",
      path: "memory/smart-add/2026-07-18.md",
      updated_at: nowSec - 20,
      category: "episodic",
      kg_data: null,
    },
    {
      id: IDS.fts,
      text: "alpha lexical channel remains available",
      path: "memory/projects/fts-alpha.md",
      updated_at: nowSec - 30,
      category: "project",
      kg_data: null,
    },
    {
      id: IDS.vector,
      text: "alpha semantic vector channel remains available",
      path: "memory/projects/vector-alpha.md",
      updated_at: nowSec - 40,
      category: "project",
      kg_data: null,
    },
  ];
}

function insertChunks(db, rows, { includeFts = false } = {}) {
  const insertChunk = db.prepare(
    "INSERT INTO chunks (id, text, path, updated_at) VALUES (?, ?, ?, ?)",
  );
  const insertFts = includeFts
    ? db.prepare("INSERT INTO chunks_fts (id, text, path) VALUES (?, ?, ?)")
    : null;
  for (const row of rows) {
    insertChunk.run(row.id, row.text, row.path, row.updated_at);
    if (insertFts && row.id === IDS.fts) insertFts.run(row.id, row.text, row.path);
  }
}

function insertConfidence(db, rows, nowSec) {
  const insert = db.prepare(`
    INSERT INTO memory_confidence (
      chunk_id, initial_confidence, confidence, last_confidence_update,
      base_tau, hit_count, is_archived, is_protected, conflict_flag, category, kg_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    insert.run(
      row.id,
      0.9,
      0.9,
      nowSec,
      7,
      1,
      0,
      0,
      0,
      row.category,
      row.kg_data,
    );
  }
}

function createSyntheticFixture({ nowMs = Date.now() } = {}) {
  const nowSec = Math.floor(nowMs / 1000);
  const rows = candidateRows(nowSec);
  const coreDb = new Database(":memory:");
  const engineDb = new Database(":memory:");
  const legacyDb = new Database(":memory:");

  createCoreSchema(coreDb);
  createEngineSchema(engineDb);
  createCoreSchema(legacyDb);
  createEngineSchema(legacyDb);
  insertChunks(coreDb, rows, { includeFts: true });
  insertConfidence(engineDb, rows, nowSec);
  insertChunks(legacyDb, rows, { includeFts: true });
  insertConfidence(legacyDb, rows, nowSec);

  const sentinelId = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
  coreDb.prepare(
    "INSERT INTO chunks (id, text, path, updated_at) VALUES (?, ?, ?, ?)",
  ).run(sentinelId, "synthetic non-text id sentinel", "memory/synthetic/sentinel.md", nowSec - 50);
  engineDb.prepare(`
    INSERT INTO memory_confidence (
      chunk_id, initial_confidence, confidence, last_confidence_update,
      base_tau, hit_count, is_archived, is_protected, conflict_flag, category, kg_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sentinelId, 0.9, 0.9, nowSec, 7, 0, 0, 0, 0, "raw_log", null);

  const queryLog = [];
  const events = [];
  let vectorSearchCalls = 0;

  function trackedDb(name, db) {
    return {
      readonly: true,
      prepare(sql) {
        queryLog.push({ db: name, sql: String(sql) });
        return db.prepare(sql);
      },
    };
  }

  const trackedCore = trackedDb("core", coreDb);
  const trackedEngine = trackedDb("engine", engineDb);
  const trackedLegacy = trackedDb("legacy", legacyDb);
  const access = {
    withCoreDb: run => run(trackedCore),
    withEngineDb: run => run(trackedEngine),
    withLegacyDb: run => run(trackedLegacy),
    capabilities: {
      isolatedFts: true,
      isolatedKg: true,
      isolatedRecent: true,
    },
  };

  function resetTelemetry() {
    queryLog.length = 0;
    events.length = 0;
    vectorSearchCalls = 0;
  }

  function recordMemoryEvent(event) {
    events.push({
      ...event,
      metadata_json: typeof event?.metadata_json === "string"
        ? event.metadata_json
        : JSON.stringify(event?.metadata_json ?? null),
      created_at: new Date(nowMs).toISOString(),
    });
  }

  function runtimeFor({
    kgMode = "legacy_fallback",
    recentMode = "legacy_fallback",
    scope = "none",
  } = {}) {
    const trustedRuntimeContext = scope === "none"
      ? null
      : {
          source: "openclaw_runtime",
          agentIdentity: scope === "match" ? "edi" : "other-agent",
          sessionIdentity: scope === "match" ? "smoke-session" : "other-session",
          requestIdentity: "full-fail-closed-safety-smoke",
        };
    const canary = {
      enabled: true,
      agentIds: ["edi"],
      sessions: ["smoke-session"],
    };
    const cfg = {
      memory: {
        autoRecallLexicalConfidenceThreshold: 1,
      },
    };
    const lancedbTable = {
      search() {
        return {
          limit() {
            return {
              async execute() {
                vectorSearchCalls += 1;
                return [{
                  id: IDS.vector,
                  text: "alpha semantic vector channel remains available",
                  _distance: 0.04,
                }];
              },
            };
          },
        };
      },
    };
    return {
      cfg,
      withDb: run => run(trackedLegacy),
      withHybridDbAccessScope: async run => run(access),
      calcRealtimeConf: row => Number(row?.confidence ?? 0.9),
      syncIndexIfNeeded: async () => ({ synced: false, reason: "synthetic_smoke" }),
      getLancedbTable: () => lancedbTable,
      generateEmbedding: async () => [0.1, 0.2],
      getMemorySearchManager: async () => ({ manager: null }),
      kgFailClosedMode: kgMode,
      kgFailClosedCanary: canary,
      recentFailClosedMode: recentMode,
      recentFailClosedCanary: canary,
      trustedRuntimeContext,
      recordMemoryEvent,
    };
  }

  function queryStats() {
    const legacyQueries = queryLog.filter(entry => entry.db === "legacy");
    return {
      kg_legacy_query_count: legacyQueries.filter(entry => entry.sql.includes("mc.kg_data LIKE")).length,
      recent_legacy_query_count: legacyQueries.filter(entry =>
        entry.sql.includes("FROM chunks c")
        && entry.sql.includes("c.path LIKE 'memory/smart-add/%' OR c.path LIKE 'memory/episodes/%'"),
      ).length,
      isolated_fts_query_count: queryLog.filter(entry =>
        entry.db === "core" && entry.sql.includes("FROM chunks_fts"),
      ).length,
      vector_search_count: vectorSearchCalls,
    };
  }

  function latestObservationEvent() {
    return [...events].reverse().find(event => event.event_type === "hybrid_search_observation") || null;
  }

  function close() {
    coreDb.close();
    engineDb.close();
    legacyDb.close();
  }

  return {
    nowMs,
    resetTelemetry,
    runtimeFor,
    recordMemoryEvent,
    queryStats,
    latestObservationEvent,
    close,
  };
}

function toolRuntime(runtime, hybridSearchRuntime) {
  return {
    api: { config: runtime.cfg },
    withDb: runtime.withDb,
    withHybridDbAccessScope: runtime.withHybridDbAccessScope,
    calcRealtimeConf: runtime.calcRealtimeConf,
    syncIndexIfNeeded: runtime.syncIndexIfNeeded,
    CATEGORY_MAP: {},
    getLancedbTable: runtime.getLancedbTable,
    generateEmbedding: runtime.generateEmbedding,
    getMemorySearchManager: runtime.getMemorySearchManager,
    hybridSearch: hybridSearchRuntime,
    recordMemoryEvent: runtime.recordMemoryEvent,
    trustedRuntimeContext: runtime.trustedRuntimeContext,
    kgFailClosedMode: runtime.kgFailClosedMode,
    kgFailClosedCanary: runtime.kgFailClosedCanary,
    recentFailClosedMode: runtime.recentFailClosedMode,
    recentFailClosedCanary: runtime.recentFailClosedCanary,
  };
}

async function executeSurface({ surface, fixture, config, modules }) {
  fixture.resetTelemetry();
  const runtime = fixture.runtimeFor(config);
  let result;

  if (surface === "auto_recall") {
    result = await modules.hybridSearch(QUERY, { topK: 10 }, runtime);
    modules.recordHybridSearchObservation({
      recordMemoryEvent: runtime.recordMemoryEvent,
      surface,
      result,
      completedAtMs: fixture.nowMs,
      sessionId: "smoke-session",
      traceId: "full-fail-closed-safety-smoke",
    });
  } else if (surface === "memory_engine_action_search") {
    const execute = modules.createMemoryEngineExecute(toolRuntime(runtime, modules.hybridSearch));
    result = await execute("smoke-action-call", {
      action: "search",
      text: QUERY,
      top_k: 10,
    });
  } else if (surface === "memory_engine_search") {
    const execute = modules.createMemoryEngineSearchExecute(toolRuntime(runtime, modules.hybridSearch));
    result = await execute("smoke-search-call", {
      query: QUERY,
      top_k: 10,
    });
  } else {
    throw new Error(`unsupported smoke surface: ${surface}`);
  }

  const event = fixture.latestObservationEvent();
  let observation = null;
  if (typeof event?.metadata_json === "string") {
    try {
      observation = JSON.parse(event.metadata_json);
    } catch {
      observation = null;
    }
  } else if (event?.metadata_json && typeof event.metadata_json === "object") {
    observation = event.metadata_json;
  }
  return {
    result,
    event,
    observation,
    query_stats: fixture.queryStats(),
  };
}

function channelHasId(result, channel, id) {
  const expectedId = String(id || "").slice(0, 16);
  return Array.isArray(result?.results)
    && result.results.some(candidate =>
      candidate?.id === expectedId
      && Array.isArray(candidate?.sources)
      && candidate.sources.includes(channel));
}

function channelFacts(run) {
  return {
    kg: channelHasId(run.result, "kg", IDS.kg),
    recent: channelHasId(run.result, "recent", IDS.recent),
    fts: channelHasId(run.result, "fts", IDS.fts),
    vector: channelHasId(run.result, "vector", IDS.vector),
  };
}

function compactRun(run) {
  return {
    channels: channelFacts(run),
    query_stats: run.query_stats,
    observation: {
      surface: run.observation?.surface ?? null,
      legacy_db_fallback_used: run.observation?.legacy_db_fallback_used ?? null,
      kg_runtime_mode: run.observation?.kg_runtime_mode ?? null,
      kg_rollout_scope: run.observation?.kg_rollout_scope ?? null,
      kg_scope_required: run.observation?.kg_scope_required ?? null,
      kg_scope_match: run.observation?.kg_fail_closed_scope_match ?? null,
      recent_runtime_mode: run.observation?.recent_runtime_mode ?? null,
      recent_rollout_scope: run.observation?.recent_rollout_scope ?? null,
      recent_scope_required: run.observation?.recent_scope_required ?? null,
      recent_scope_match: run.observation?.recent_fail_closed_scope_match ?? null,
    },
  };
}

function allSurfaceRuns(matrix, scenario, predicate) {
  return PRODUCTION_SURFACES.every(surface => predicate(matrix[surface][scenario], surface));
}

function surfaceDetails(matrix, scenario) {
  return Object.fromEntries(PRODUCTION_SURFACES.map(surface => [
    surface,
    compactRun(matrix[surface][scenario]),
  ]));
}

async function runSmoke({ now = new Date() } = {}) {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new Error("invalid smoke timestamp");

  const [hybridModule, observationModule, actionsModule, metricsModule] = await Promise.all([
    import("../lib/recall/hybrid-search.js"),
    import("../lib/recall/hybrid-observation.js"),
    import("../lib/tools/memory-engine-actions.js"),
    import("../console/services/metrics-service.js"),
  ]);
  const modules = {
    hybridSearch: hybridModule.hybridSearch,
    recordHybridSearchObservation: observationModule.recordHybridSearchObservation,
    createMemoryEngineExecute: actionsModule.createMemoryEngineExecute,
    createMemoryEngineSearchExecute: actionsModule.createMemoryEngineSearchExecute,
  };

  const scenarioConfigs = {
    legacy: {
      kgMode: "legacy_fallback",
      recentMode: "legacy_fallback",
      scope: "none",
    },
    canary_hit: {
      kgMode: "fail_closed_canary",
      recentMode: "fail_closed_canary",
      scope: "match",
    },
    canary_miss: {
      kgMode: "fail_closed_canary",
      recentMode: "fail_closed_canary",
      scope: "mismatch",
    },
    full: {
      kgMode: "full_fail_closed",
      recentMode: "full_fail_closed",
      scope: "none",
    },
    kg_full_only: {
      kgMode: "full_fail_closed",
      recentMode: "legacy_fallback",
      scope: "none",
    },
    recent_full_only: {
      kgMode: "legacy_fallback",
      recentMode: "full_fail_closed",
      scope: "none",
    },
    rollback_legacy: {
      kgMode: "legacy_fallback",
      recentMode: "legacy_fallback",
      scope: "none",
    },
  };

  const matrix = {};
  for (const surface of PRODUCTION_SURFACES) {
    const fixture = createSyntheticFixture({ nowMs });
    try {
      matrix[surface] = {};
      for (const [scenario, config] of Object.entries(scenarioConfigs)) {
        matrix[surface][scenario] = await executeSurface({
          surface,
          fixture,
          config,
          modules,
        });
      }
    } finally {
      fixture.close();
    }
  }

  const fullRows = PRODUCTION_SURFACES.map(surface => matrix[surface].full.event);
  const metrics = metricsModule.buildHybridFallbackObservabilitySummary(fullRows, {
    windowDays: 1,
    nowMs,
  });

  const checks = [
    {
      id: "production_surfaces_observed",
      name: "all three production surfaces emit canonical observations",
      pass: Object.values(matrix).every(surfaceRuns =>
        Object.values(surfaceRuns).every(run => run.observation?.surface && run.event?.event_type === "hybrid_search_observation")),
      details: Object.fromEntries(PRODUCTION_SURFACES.map(surface => [
        surface,
        Object.fromEntries(Object.entries(matrix[surface]).map(([scenario, run]) => [
          scenario,
          run.observation?.surface ?? null,
        ])),
      ])),
    },
    {
      id: "legacy_mode_restores_fallback",
      name: "legacy mode executes KG and Recent fallbacks while preserving FTS and vector",
      pass: allSurfaceRuns(matrix, "legacy", run => {
        const channels = channelFacts(run);
        return channels.kg && channels.recent && channels.fts && channels.vector
          && run.query_stats.kg_legacy_query_count > 0
          && run.query_stats.recent_legacy_query_count > 0;
      }),
      details: surfaceDetails(matrix, "legacy"),
    },
    {
      id: "canary_scope_hit_suppresses_fallback",
      name: "matching scoped canary suppresses KG and Recent fallbacks",
      pass: allSurfaceRuns(matrix, "canary_hit", run => {
        const channels = channelFacts(run);
        return !channels.kg && !channels.recent && channels.fts && channels.vector
          && run.query_stats.kg_legacy_query_count === 0
          && run.query_stats.recent_legacy_query_count === 0
          && run.observation?.kg_runtime_mode === "fail_closed_canary"
          && run.observation?.recent_runtime_mode === "fail_closed_canary";
      }),
      details: surfaceDetails(matrix, "canary_hit"),
    },
    {
      id: "canary_scope_miss_restores_fallback",
      name: "scoped canary miss restores KG and Recent fallbacks",
      pass: allSurfaceRuns(matrix, "canary_miss", run => {
        const channels = channelFacts(run);
        return channels.kg && channels.recent && channels.fts && channels.vector
          && run.query_stats.kg_legacy_query_count > 0
          && run.query_stats.recent_legacy_query_count > 0;
      }),
      details: surfaceDetails(matrix, "canary_miss"),
    },
    {
      id: "full_mode_suppresses_without_scope",
      name: "full mode suppresses KG and Recent fallbacks without canary scope",
      pass: allSurfaceRuns(matrix, "full", run => {
        const channels = channelFacts(run);
        return !channels.kg && !channels.recent && channels.fts && channels.vector
          && run.query_stats.kg_legacy_query_count === 0
          && run.query_stats.recent_legacy_query_count === 0;
      }),
      details: surfaceDetails(matrix, "full"),
    },
    {
      id: "kg_full_mode_channel_isolation",
      name: "KG full mode suppresses only KG fallback",
      pass: allSurfaceRuns(matrix, "kg_full_only", run => {
        const channels = channelFacts(run);
        return !channels.kg && channels.recent && channels.fts && channels.vector
          && run.query_stats.kg_legacy_query_count === 0
          && run.query_stats.recent_legacy_query_count > 0;
      }),
      details: surfaceDetails(matrix, "kg_full_only"),
    },
    {
      id: "recent_full_mode_channel_isolation",
      name: "Recent full mode suppresses only Recent fallback",
      pass: allSurfaceRuns(matrix, "recent_full_only", run => {
        const channels = channelFacts(run);
        return channels.kg && !channels.recent && channels.fts && channels.vector
          && run.query_stats.kg_legacy_query_count > 0
          && run.query_stats.recent_legacy_query_count === 0;
      }),
      details: surfaceDetails(matrix, "recent_full_only"),
    },
    {
      id: "full_mode_observation_markers",
      name: "full mode observations emit explicit full rollout markers",
      pass: allSurfaceRuns(matrix, "full", run =>
        run.observation?.kg_runtime_mode === "full_fail_closed"
        && run.observation?.kg_rollout_scope === "full"
        && run.observation?.kg_scope_required === false
        && run.observation?.kg_fail_closed_scope_match === null
        && run.observation?.recent_runtime_mode === "full_fail_closed"
        && run.observation?.recent_rollout_scope === "full"
        && run.observation?.recent_scope_required === false
        && run.observation?.recent_fail_closed_scope_match === null),
      details: surfaceDetails(matrix, "full"),
    },
    {
      id: "full_events_excluded_from_canary_metrics",
      name: "full rollout events do not increment scoped-canary metrics",
      pass: metrics.kg_full_fail_closed_events === PRODUCTION_SURFACES.length
        && metrics.recent_full_fail_closed_events === PRODUCTION_SURFACES.length
        && metrics.kg_fail_closed_canary.enabled_events === 0
        && metrics.kg_fail_closed_canary.applied_events === 0
        && metrics.recent_fail_closed_canary_runtime.enabled_events === 0
        && metrics.recent_fail_closed_canary_runtime.applied_events === 0,
      details: {
        kg_full_fail_closed_events: metrics.kg_full_fail_closed_events,
        recent_full_fail_closed_events: metrics.recent_full_fail_closed_events,
        kg_canary: metrics.kg_fail_closed_canary,
        recent_canary: metrics.recent_fail_closed_canary_runtime,
        production_observed_by_surface: metrics.production_observed_by_surface,
      },
    },
    {
      id: "dynamic_rollback_restores_fallback",
      name: "switching from full mode back to legacy restores both fallbacks",
      pass: allSurfaceRuns(matrix, "rollback_legacy", run => {
        const fullChannels = channelFacts(matrix[run.observation.surface].full);
        const rollbackChannels = channelFacts(run);
        return !fullChannels.kg && !fullChannels.recent
          && rollbackChannels.kg && rollbackChannels.recent
          && rollbackChannels.fts && rollbackChannels.vector
          && run.query_stats.kg_legacy_query_count > 0
          && run.query_stats.recent_legacy_query_count > 0;
      }),
      details: surfaceDetails(matrix, "rollback_legacy"),
    },
  ];

  const failedChecks = checks.filter(check => !check.pass);
  return {
    generated_at: new Date(nowMs).toISOString(),
    stage: "F1-D-B8-A5",
    summary: {
      mode: "synthetic_in_memory_safety_smoke",
      status: failedChecks.length === 0 ? "pass" : "fail",
      check_count: checks.length,
      passed_count: checks.length - failedChecks.length,
      failed_count: failedChecks.length,
      failed_check_ids: failedChecks.map(check => check.id),
      production_surfaces: [...PRODUCTION_SURFACES],
    },
    side_effects: {
      real_db_access: false,
      synthetic_in_memory_sqlite: true,
      plugin_reload: false,
      openclaw_runtime: false,
      config_mutation: false,
      network: false,
      runtime_report_files: false,
      legacy_code_removal: false,
    },
    checks,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# F1-D-B8-A5 Full Fail-Closed Safety Smoke",
    "",
    `- generated_at: ${report.generated_at}`,
    `- status: ${report.summary.status}`,
    `- checks_passed: ${report.summary.passed_count}/${report.summary.check_count}`,
    `- production_surfaces: ${report.summary.production_surfaces.join(", ")}`,
    `- failed_check_ids: ${report.summary.failed_check_ids.length > 0 ? report.summary.failed_check_ids.join(", ") : "none"}`,
    "",
    "## Checks",
    "",
  ];
  for (const check of report.checks) {
    lines.push(`- ${check.pass ? "PASS" : "FAIL"}: ${check.id} :: ${check.name}`);
  }
  lines.push("", "## Safety Boundary", "");
  for (const [key, value] of Object.entries(report.side_effects)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      printHelp();
      return 0;
    }
    const report = await runSmoke();
    writeStdout(options.markdown ? renderMarkdown(report) : JSON.stringify(report, null, 2));
    return report.summary.status === "pass" ? 0 : 1;
  } catch (error) {
    writeStderr(String(error?.stack || error?.message || error));
    return 1;
  }
}

module.exports = {
  PRODUCTION_SURFACES,
  IDS,
  parseArgs,
  runSmoke,
  renderMarkdown,
  main,
};

if (process.argv[1] && /run-full-fail-closed-safety-smoke\.js$/.test(process.argv[1])) {
  main().then(code => {
    process.exitCode = code;
  });
}
