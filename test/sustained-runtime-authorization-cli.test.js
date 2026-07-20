import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import parityCli from "../bin/build-runtime-source-parity-report.js";
import productCli from "../bin/build-auto-recall-product-health-report.js";
import projectionCli from "../bin/project-production-evidence-epoch.js";
import forecastCli from "../bin/audit-natural-traffic-forecast.js";
import authorizationCli from "../bin/build-sustained-runtime-authorization-plan.js";
import boundaryCli from "../bin/build-sustained-runtime-boundary-report.js";
import backupCli from "../bin/build-sustained-runtime-config-backup-manifest.js";
import effectiveConfigCli from "../bin/build-effective-hybrid-runtime-config-report.js";
import { buildSustainedRuntimePreflightReport } from "../lib/recall/hybrid/sustained-runtime-preflight-gateway.js";
import {
  REQUIRED_RUNTIME_FILES,
  ROOT_RUNTIME_FILES,
} from "../lib/version/runtime-build-identity.js";

const AUTHORIZED_AT = "2026-07-30T23:00:00.000Z";
const BUILD = "a".repeat(64);
const CONFIG = "b".repeat(64);

function root() {
  return mkdtempSync(resolve(tmpdir(), "memory-engine-a7-cli-"));
}

function writeJson(dir, name, value) {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

function runtimeRoot(dir, name) {
  const base = join(dir, name);
  for (const path of [...REQUIRED_RUNTIME_FILES, ...ROOT_RUNTIME_FILES, "lib/runtime.js"]) {
    const target = join(base, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `fixture:${path}\n`, "utf8");
  }
  return base;
}

function baseline(overrides = {}) {
  return {
    schema_version: 1,
    active: true,
    activation_source: "sustained_runtime_activation_finalizer",
    authorization_plan_generated_at: "2026-07-01T00:00:00.000Z",
    evidence_epoch_id: "epoch-1",
    runtime_build_identity: BUILD,
    rollout_config_fingerprint: CONFIG,
    expected_kg_mode: "full_fail_closed",
    expected_recent_mode: "full_fail_closed",
    openclaw_runtime_version: "2026.7.1",
    openclaw_config_file_path: "/home/lionsol/.openclaw/openclaw.json",
    openclaw_config_file_sha256: "c".repeat(64),
    openclaw_config_file_byte_count: 1024,
    openclaw_config_fingerprint: "d".repeat(64),
    authorized_at: "2026-07-01T00:00:00.000Z",
    activated_at: "2026-07-01T00:05:00.000Z",
    ...overrides,
  };
}

function hybridObservation(id, surface, completedAt, origin = "natural_agent_tool_call") {
  const tool = origin === "natural_agent_tool_call";
  return {
    id,
    event_type: "hybrid_search_observation",
    source: `hybrid.${surface}`,
    trace_id: `trace-${id}`,
    session_id: surface === "auto_recall" ? `session-${id}` : null,
    created_at: completedAt.replace("T", " ").replace(".000Z", ""),
    metadata_json: {
      schema_version: 1,
      surface,
      search_executed: true,
      completed_at: completedAt,
      production_evidence_enabled: true,
      evidence_epoch_id: "epoch-1",
      runtime_build_identity: BUILD,
      rollout_config_fingerprint: CONFIG,
      traffic_origin_schema_version: 1,
      traffic_origin: origin,
      traffic_origin_valid: true,
      traffic_origin_reasons: [],
      traffic_origin_evidence: tool
        ? {
          source: "before_tool_call_agent",
          agent_id_present: true,
          run_id_present: true,
          session_id_present: true,
          tool_call_id_present: true,
          trigger: null,
        }
        : {
          source: "before_prompt_build",
          agent_id_present: true,
          run_id_present: true,
          session_id_present: true,
          tool_call_id_present: false,
          trigger: "user",
        },
    },
  };
}

function healthyForecastRows() {
  const rows = [];
  let id = 0;
  for (let day = 1; day <= 30; day += 1) {
    for (let index = 0; index < 10; index += 1) {
      const date = `2026-07-${String(day).padStart(2, "0")}`;
      const hour = String(index).padStart(2, "0");
      rows.push(hybridObservation(++id, "memory_engine_search", `${date}T${hour}:00:00.000Z`));
      rows.push(hybridObservation(++id, "memory_engine_action_search", `${date}T${hour}:30:00.000Z`));
    }
  }
  return rows;
}

test("parity CLI writes a canonical clean report", async () => {
  const dir = root();
  const sourceRoot = runtimeRoot(dir, "source");
  const installedRoot = runtimeRoot(dir, "installed");
  const out = join(dir, "parity.json");
  const result = await parityCli.buildRuntimeSourceParityCli([
    "--source-root", sourceRoot,
    "--runtime-root", installedRoot,
    "--checked-at", AUTHORIZED_AT,
    "--out", out,
    "--pretty",
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(readFileSync(out, "utf8")).source_runtime_equal, true);
});

test("product-health CLI consumes report files without DB access", async () => {
  const dir = root();
  const events = writeJson(dir, "events.json", [
    { event_type: "recall_started", trace_id: "trace-1", created_at: "2026-07-30 22:50:00", metadata_json: {} },
    { event_type: "auto_recall_debug", trace_id: "trace-1", memory_id: "memory-1", created_at: "2026-07-30 22:51:00", metadata_json: { debug_type: "gate_decision", injected: true, allowed: true, reinforcement_allowed: true, deny_reasons: [] } },
    { event_type: "memory_injected", trace_id: "trace-1", memory_id: "memory-1", created_at: "2026-07-30 22:52:00", metadata_json: { reinforcement_allowed: true, deny_reasons: [] } },
    { event_type: "recall_completed", trace_id: "trace-1", latency_ms: 100, created_at: "2026-07-30 22:53:00", metadata_json: {} },
  ]);
  const review = writeJson(dir, "quality.json", {
    schema_version: 1,
    reviewed_at: AUTHORIZED_AT,
    sample_size: 1,
    sampled_injection_keys: ["trace-1:memory-1"],
    irrelevant_count: 0,
    severe_irrelevant_or_context_conflict_count: 0,
    user_reported_bad_injection_count: 0,
  });
  const result = await productCli.buildAutoRecallProductHealthCli([
    "--events", events,
    "--quality-review", review,
    "--checked-at", AUTHORIZED_AT,
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.status, "healthy");
});

test("epoch projection CLI writes selected rows and blocking report separately", async () => {
  const dir = root();
  const rows = writeJson(dir, "raw.json", [
    hybridObservation(1, "memory_engine_search", "2026-07-02T00:00:00.000Z"),
    hybridObservation(2, "memory_engine_search", "2026-07-02T01:00:00.000Z"),
  ]);
  const base = writeJson(dir, "baseline.json", baseline());
  const selectedOut = join(dir, "selected.jsonl");
  const reportOut = join(dir, "projection.json");
  const result = await projectionCli.projectProductionEvidenceEpochCli([
    "--observations", rows,
    "--baseline", base,
    "--as-of", "2026-07-03T00:00:00.000Z",
    "--selected-out", selectedOut,
    "--report-out", reportOut,
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(readFileSync(selectedOut, "utf8").trim().split("\n").length, 2);
  assert.equal(JSON.parse(readFileSync(reportOut, "utf8")).blocking_rejection_count, 0);
});

test("forecast and authorization CLIs compose without applying configuration", async () => {
  const dir = root();
  const observations = writeJson(dir, "history.json", healthyForecastRows());
  const forecastPath = join(dir, "forecast.json");
  const forecastResult = await forecastCli.auditNaturalTrafficForecastCli([
    "--observations", observations,
    "--as-of", AUTHORIZED_AT,
    "--out", forecastPath,
  ]);
  assert.equal(forecastResult.exitCode, 0);

  const parity = writeJson(dir, "parity.json", {
    schema_version: 1,
    checked_at: AUTHORIZED_AT,
    source_runtime_equal: true,
    difference_count: 0,
    runtime_build_identity: BUILD,
  });
  const openclawConfig = writeJson(dir, "openclaw.json", {
    plugins: {
      entries: {
        "active-memory": { enabled: false },
        "memory-engine": { enabled: true, config: {} },
      },
    },
  });
  const effectiveConfigReportPath = join(dir, "effective-config-report.json");
  const effectiveConfigResult = await effectiveConfigCli.buildEffectiveHybridRuntimeConfigCli([
    "--config", openclawConfig,
    "--checked-at", AUTHORIZED_AT,
    "--out", effectiveConfigReportPath,
  ]);
  assert.equal(effectiveConfigResult.exitCode, 0);
  const configBackupPath = join(dir, "openclaw-backup.json");
  copyFileSync(openclawConfig, configBackupPath);
  chmodSync(configBackupPath, 0o600);
  const backupManifestPath = join(dir, "config-backup-manifest.json");
  const backupResult = await backupCli.buildSustainedRuntimeConfigBackupManifestCli([
    "--live-config", openclawConfig,
    "--config-backup", configBackupPath,
    "--created-at", AUTHORIZED_AT,
    "--out", backupManifestPath,
  ]);
  assert.equal(backupResult.exitCode, 0);
  const boundaryPath = join(dir, "runtime-boundary.json");
  const boundaryResult = await boundaryCli.buildSustainedRuntimeBoundaryCli([
    "--config", openclawConfig,
    "--checked-at", AUTHORIZED_AT,
    "--out", boundaryPath,
  ]);
  assert.equal(boundaryResult.exitCode, 0);
  const preflightPath = writeJson(dir, "runtime-preflight.json", buildSustainedRuntimePreflightReport({
    openclawConfig: JSON.parse(readFileSync(openclawConfig, "utf8")),
    openclawRuntimeVersion: "2026.7.1",
    openclawConfigFilePath: openclawConfig,
    openclawConfigFileBytes: readFileSync(openclawConfig),
    effectiveRuntimeConfig: effectiveConfigResult.report.effective_config,
    effectiveRuntimeConfigValid: true,
    effectiveRuntimeConfigErrors: [],
    productionEvidenceIdentityContext: {
      runtimeBuildIdentity: BUILD,
      rolloutConfigFingerprint: effectiveConfigResult.report.rollout_config_fingerprint,
      runtimeBuildIdentityReport: { valid: true, errors: [] },
    },
    checkedAt: AUTHORIZED_AT,
  }));

  const planResult = await authorizationCli.buildSustainedRuntimeAuthorizationPlanCli([
    "--runtime-preflight", preflightPath,
    "--runtime-parity", parity,
    "--traffic-forecast", forecastPath,
    "--config-backup-manifest", backupManifestPath,
    "--authorized-at", AUTHORIZED_AT,
    "--head", "15923c5",
  ]);
  assert.equal(planResult.exitCode, 1);
  assert.equal(planResult.report.decision, "ready_for_operator_approval");
  assert.equal(planResult.report.execution_authorized, false);
});
