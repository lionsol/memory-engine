import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import cycleCli from "../bin/run-production-evidence-monitor-cycle.js";
import { buildSustainedRuntimePreflightReport } from "../lib/recall/hybrid/sustained-runtime-preflight-gateway.js";
import {
  buildRuntimeBuildIdentity,
  REQUIRED_RUNTIME_FILES,
  ROOT_RUNTIME_FILES,
} from "../lib/version/runtime-build-identity.js";

const AS_OF = "2026-07-02T02:00:00.000Z";
const CONFIG = "b".repeat(64);

function createRuntimeRoot(parent, name) {
  const root = join(parent, name);
  for (const path of [...REQUIRED_RUNTIME_FILES, ...ROOT_RUNTIME_FILES, "lib/runtime.js"]) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `fixture:${path}\n`, "utf8");
  }
  return root;
}

function originEvidence(origin) {
  if (origin === "natural_user_turn") {
    return {
      source: "before_prompt_build",
      agent_id_present: true,
      run_id_present: true,
      session_id_present: true,
      tool_call_id_present: false,
      trigger: "user",
    };
  }
  if (origin === "scheduled_healthcheck") {
    return {
      source: "scheduled_healthcheck_wrapper",
      agent_id_present: true,
      run_id_present: false,
      session_id_present: true,
      tool_call_id_present: true,
      trigger: null,
      healthcheck_run_id: "healthcheck-run-cycle",
    };
  }
  return {
    source: "before_tool_call_agent",
    agent_id_present: true,
    run_id_present: true,
    session_id_present: true,
    tool_call_id_present: true,
    trigger: null,
  };
}

function hybridMetadata({ surface, completedAt, build, origin }) {
  return {
    schema_version: 1,
    surface,
    search_executed: true,
    completed_at: completedAt,
    production_evidence_enabled: true,
    evidence_epoch_id: "epoch-cycle",
    runtime_build_identity: build,
    rollout_config_fingerprint: CONFIG,
    traffic_origin_schema_version: 1,
    traffic_origin: origin,
    traffic_origin_valid: true,
    traffic_origin_reasons: [],
    traffic_origin_evidence: originEvidence(origin),
    legacy_db_fallback_used: false,
    legacy_db_fallback_channels: [],
    channel_error_count: 0,
    kg_access_mode: "isolated",
    kg_runtime_mode: "full_fail_closed",
    kg_rollout_scope: "full",
    kg_scope_required: false,
    kg_fail_closed_scope_match: null,
    recent_access_mode: "isolated",
    recent_runtime_mode: "full_fail_closed",
    recent_rollout_scope: "full",
    recent_scope_required: false,
    recent_fail_closed_scope_match: null,
  };
}

function insertEvent(insert, values) {
  insert.run({
    event_type: null,
    session_id: null,
    trace_id: null,
    memory_id: null,
    source: null,
    latency_ms: null,
    candidate_count: null,
    injected_count: null,
    metadata_json: "{}",
    created_at: null,
    ...values,
  });
}

function createDb(root, build) {
  const dbPath = join(root, "engine.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE memory_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT,
      session_id TEXT,
      trace_id TEXT,
      memory_id TEXT,
      source TEXT,
      latency_ms INTEGER,
      candidate_count INTEGER,
      injected_count INTEGER,
      metadata_json TEXT,
      created_at TEXT
    )
  `);
  const insert = db.prepare(`
    INSERT INTO memory_events
      (event_type, session_id, trace_id, memory_id, source, latency_ms,
       candidate_count, injected_count, metadata_json, created_at)
    VALUES
      (@event_type, @session_id, @trace_id, @memory_id, @source, @latency_ms,
       @candidate_count, @injected_count, @metadata_json, @created_at)
  `);
  const hybridRows = [
    ["auto_recall", "natural_user_turn", "2026-07-02T01:10:00.000Z"],
    ["memory_engine_search", "natural_agent_tool_call", "2026-07-02T01:20:00.000Z"],
    ["memory_engine_action_search", "natural_agent_tool_call", "2026-07-02T01:30:00.000Z"],
    ["memory_engine_search", "scheduled_healthcheck", "2026-07-02T01:40:00.000Z"],
    ["memory_engine_action_search", "scheduled_healthcheck", "2026-07-02T01:41:00.000Z"],
  ];
  hybridRows.forEach(([surface, origin, completedAt], index) => insertEvent(insert, {
    event_type: "hybrid_search_observation",
    session_id: surface === "auto_recall" ? "session-user" : null,
    trace_id: `hybrid-${index}`,
    source: `hybrid.${surface}`,
    metadata_json: JSON.stringify(hybridMetadata({ surface, completedAt, build, origin })),
    created_at: completedAt.replace("T", " ").replace(".000Z", ""),
  }));
  insertEvent(insert, {
    event_type: "recall_started",
    session_id: "session-user",
    trace_id: "product-trace",
    source: "autoRecall",
    created_at: "2026-07-02 01:00:00",
  });
  insertEvent(insert, {
    event_type: "auto_recall_debug",
    session_id: "session-user",
    trace_id: "product-trace",
    memory_id: "memory-1",
    source: "autoRecall",
    metadata_json: JSON.stringify({
      debug_type: "gate_decision",
      injected: true,
      allowed: true,
      reinforcement_allowed: true,
      deny_reasons: [],
    }),
    created_at: "2026-07-02 01:01:00",
  });
  insertEvent(insert, {
    event_type: "memory_injected",
    session_id: "session-user",
    trace_id: "product-trace",
    memory_id: "memory-1",
    source: "autoRecall",
    metadata_json: JSON.stringify({ reinforcement_allowed: true, deny_reasons: [] }),
    created_at: "2026-07-02 01:02:00",
  });
  insertEvent(insert, {
    event_type: "recall_completed",
    session_id: "session-user",
    trace_id: "product-trace",
    source: "autoRecall",
    latency_ms: 100,
    candidate_count: 1,
    injected_count: 1,
    created_at: "2026-07-02 01:03:00",
  });
  db.close();
  return dbPath;
}

function sustainedEffectiveConfig() {
  return {
    autoRecall: {
      enabled: true,
      topK: 3,
      timeoutMs: 4000,
      agentAllowlist: ["edi"],
      triggerAllowlist: ["user"],
      chatTypeAllowlist: ["interactive_user_chat"],
      messageRoleAllowlist: ["user"],
      cardFirstRuntime: { enabled: false },
    },
    kgFailClosedMode: "full_fail_closed",
    kgFailClosedCanary: { enabled: false, agentIds: [], sessionIds: [], tokens: [] },
    recentFailClosedMode: "full_fail_closed",
    recentFailClosedCanary: { enabled: false, agentIds: [], sessionIds: [], tokens: [] },
    productionEvidenceWindow: { enabled: true, epochId: "epoch-cycle" },
    hybridRetrieval: { recall: {}, ranking: {}, confidence: {} },
  };
}

function runtimePreflight(build, openclawConfig) {
  const bytes = Buffer.from(JSON.stringify(openclawConfig));
  return buildSustainedRuntimePreflightReport({
    openclawConfig,
    openclawRuntimeVersion: "2026.7.1",
    openclawConfigFilePath: "/tmp/openclaw-cycle.json",
    openclawConfigFileBytes: bytes,
    effectiveRuntimeConfig: sustainedEffectiveConfig(),
    effectiveRuntimeConfigValid: true,
    effectiveRuntimeConfigErrors: [],
    productionEvidenceIdentityContext: {
      runtimeBuildIdentity: build,
      rolloutConfigFingerprint: CONFIG,
      runtimeBuildIdentityReport: { valid: true, errors: [] },
    },
    checkedAt: AS_OF,
  });
}

test("one read-only monitor cycle composes raw export, parity, product health, projection, and A7.3 health", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "memory-engine-a7-cycle-"));
  const sourceRoot = createRuntimeRoot(root, "source");
  const runtimeRoot = createRuntimeRoot(root, "runtime");
  const build = buildRuntimeBuildIdentity({ rootDir: runtimeRoot }).identity;
  const dbPath = createDb(root, build);
  const livePreflight = runtimePreflight(build, {
    plugins: { entries: { "active-memory": { enabled: false } } },
  });
  const baselinePath = join(root, "baseline.json");
  writeFileSync(baselinePath, JSON.stringify({
    schema_version: 1,
    active: true,
    activation_source: "sustained_runtime_activation_finalizer",
    authorization_plan_generated_at: "2026-07-01T00:00:00.000Z",
    evidence_epoch_id: "epoch-cycle",
    runtime_build_identity: build,
    rollout_config_fingerprint: CONFIG,
    expected_kg_mode: "full_fail_closed",
    expected_recent_mode: "full_fail_closed",
    openclaw_runtime_version: "2026.7.1",
    openclaw_config_file_path: livePreflight.openclaw_config_file_path,
    openclaw_config_file_sha256: livePreflight.openclaw_config_file_sha256,
    openclaw_config_file_byte_count: livePreflight.openclaw_config_file_byte_count,
    openclaw_config_fingerprint: livePreflight.openclaw_config_fingerprint,
    authorized_at: "2026-07-01T00:00:00.000Z",
    activated_at: "2026-07-01T00:05:00.000Z",
  }), "utf8");
  const runtimePreflightPath = join(root, "runtime-preflight.json");
  writeFileSync(runtimePreflightPath, JSON.stringify(livePreflight), "utf8");
  const qualityPath = join(root, "quality.json");
  writeFileSync(qualityPath, JSON.stringify({
    schema_version: 1,
    reviewed_at: AS_OF,
    sample_size: 1,
    sampled_injection_keys: ["product-trace:memory-1"],
    irrelevant_count: 0,
    severe_irrelevant_or_context_conflict_count: 0,
    user_reported_bad_injection_count: 0,
  }), "utf8");
  const outputDir = join(root, "cycle");

  const result = await cycleCli.runProductionEvidenceMonitorCycle([
    "--db", dbPath,
    "--baseline", baselinePath,
    "--source-root", sourceRoot,
    "--runtime-root", runtimeRoot,
    "--runtime-preflight", runtimePreflightPath,
    "--quality-review", qualityPath,
    "--output-dir", outputDir,
    "--as-of", AS_OF,
    "--pretty",
  ]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.status, "healthy_collecting");
  assert.equal(result.summary.runtime_parity_status, "clean");
  assert.equal(result.summary.runtime_preflight_status, "clean");
  assert.equal(result.summary.runtime_preflight_blocker_count, 0);
  assert.equal(result.summary.openclaw_runtime_version, "2026.7.1");
  assert.equal(result.summary.runtime_boundary_status, "clean");
  assert.equal(result.summary.active_memory_enabled, false);
  assert.equal(result.summary.product_health_status, "healthy");
  assert.equal(result.summary.epoch_projection_status, "ready");
  assert.deepEqual(result.summary.monitor_thresholds, {
    maximum_latest_observation_age_hours: 72,
    maximum_healthcheck_age_hours: 14,
    maximum_runtime_parity_age_hours: 14,
    maximum_product_health_age_hours: 14,
  });
  for (const file of [
    "raw-hybrid-observations.jsonl",
    "canonical-epoch-observations.jsonl",
    "runtime-parity.json",
    "runtime-preflight.json",
    "runtime-boundary.json",
    "product-health.json",
    "epoch-projection.json",
    "health.json",
    "cycle-summary.json",
  ]) assert.equal(existsSync(join(outputDir, file)), true, file);
  const health = JSON.parse(readFileSync(join(outputDir, "health.json"), "utf8"));
  assert.equal(health.rollback_required, false);
  assert.deepEqual(health.stop_conditions, []);

  const conflictPreflightPath = join(root, "runtime-preflight-conflict.json");
  writeFileSync(conflictPreflightPath, JSON.stringify(runtimePreflight(build, {
    plugins: { entries: {} },
  })), "utf8");
  const conflictResult = await cycleCli.runProductionEvidenceMonitorCycle([
    "--db", dbPath,
    "--baseline", baselinePath,
    "--source-root", sourceRoot,
    "--runtime-root", runtimeRoot,
    "--runtime-preflight", conflictPreflightPath,
    "--quality-review", qualityPath,
    "--output-dir", join(root, "cycle-conflict"),
    "--as-of", AS_OF,
  ]);
  assert.equal(conflictResult.exitCode, 2);
  assert.equal(conflictResult.summary.status, "blocked_rollback_required");
  assert.equal(conflictResult.summary.runtime_preflight_status, "blocked");
  assert.equal(conflictResult.summary.runtime_preflight_blocker_count > 0, true);
  assert.equal(conflictResult.summary.runtime_boundary_status, "conflict");
  assert.equal(conflictResult.summary.active_memory_enabled, true);

  const versionDriftPath = join(root, "runtime-preflight-version-drift.json");
  writeFileSync(versionDriftPath, JSON.stringify({
    ...runtimePreflight(build, { plugins: { entries: { "active-memory": { enabled: false } } } }),
    openclaw_runtime_version: "2026.7.2",
  }), "utf8");
  const versionDriftResult = await cycleCli.runProductionEvidenceMonitorCycle([
    "--db", dbPath,
    "--baseline", baselinePath,
    "--source-root", sourceRoot,
    "--runtime-root", runtimeRoot,
    "--runtime-preflight", versionDriftPath,
    "--quality-review", qualityPath,
    "--output-dir", join(root, "cycle-version-drift"),
    "--as-of", AS_OF,
  ]);
  assert.equal(versionDriftResult.exitCode, 2);
  assert.equal(versionDriftResult.summary.status, "blocked_rollback_required");
  assert.equal(versionDriftResult.summary.openclaw_runtime_version, "2026.7.2");
});
