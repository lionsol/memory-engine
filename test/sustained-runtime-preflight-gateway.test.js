import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SUSTAINED_RUNTIME_PREFLIGHT_METHOD,
  buildSustainedRuntimePreflightReport,
  registerSustainedRuntimePreflightGateway,
} from "../lib/recall/hybrid/sustained-runtime-preflight-gateway.js";

const BUILD = "a".repeat(64);
const CONFIG = "b".repeat(64);
const CHECKED_AT = "2026-07-20T03:00:00.000Z";

function identityContext(overrides = {}) {
  return {
    runtimeBuildIdentity: BUILD,
    rolloutConfigFingerprint: CONFIG,
    runtimeBuildIdentityReport: { valid: true, errors: [] },
    ...overrides,
  };
}

function effectiveConfig() {
  return {
    autoRecall: { enabled: false, topK: 3, timeoutMs: 8000, agentAllowlist: ["edi"] },
    kgFailClosedMode: "legacy_fallback",
    kgFailClosedCanary: { enabled: false, tokens: ["secret-kg-token"] },
    recentFailClosedMode: "legacy_fallback",
    recentFailClosedCanary: { enabled: false, tokens: ["secret-recent-token"] },
    productionEvidenceWindow: { enabled: false, epochId: null },
    hybridRetrieval: { recall: {}, ranking: {}, confidence: {} },
  };
}

test("runtime preflight binds loaded runtime version, config file, build, effective config, and active-memory boundary", () => {
  const openclawConfig = { plugins: { entries: { "active-memory": { enabled: false } } } };
  const report = buildSustainedRuntimePreflightReport({
    openclawConfig,
    openclawRuntimeVersion: "2026.7.1",
    openclawConfigFilePath: "/tmp/openclaw.json",
    openclawConfigFileBytes: Buffer.from(JSON.stringify(openclawConfig)),
    effectiveRuntimeConfig: effectiveConfig(),
    effectiveRuntimeConfigValid: true,
    effectiveRuntimeConfigErrors: [],
    productionEvidenceIdentityContext: identityContext(),
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.status, "clean");
  assert.equal(report.openclaw_runtime_version, "2026.7.1");
  assert.equal(report.openclaw_config_file_path, "/tmp/openclaw.json");
  assert.match(report.openclaw_config_file_sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.openclaw_config_file_byte_count > 0, true);
  assert.equal(report.runtime_build_identity, BUILD);
  assert.equal(report.rollout_config_fingerprint, CONFIG);
  assert.equal(report.runtime_boundary.status, "clean");
  assert.equal(report.effective_config_report.effective_config.kgFailClosedCanary.token_count, 1);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("secret-kg-token"), false);
  assert.equal(serialized.includes("secret-recent-token"), false);
});

test("runtime preflight blocks active-memory default enablement and invalid identity", () => {
  const openclawConfig = { plugins: { entries: {} } };
  const report = buildSustainedRuntimePreflightReport({
    openclawConfig,
    openclawRuntimeVersion: "2026.7.1",
    openclawConfigFilePath: "/tmp/openclaw.json",
    openclawConfigFileBytes: Buffer.from(JSON.stringify(openclawConfig)),
    effectiveRuntimeConfig: effectiveConfig(),
    effectiveRuntimeConfigValid: false,
    effectiveRuntimeConfigErrors: ["invalid config"],
    productionEvidenceIdentityContext: identityContext({ runtimeBuildIdentity: null }),
    checkedAt: CHECKED_AT,
  });
  assert.equal(report.status, "blocked");
  assert.ok(report.blockers.includes("runtime_boundary_conflict"));
  assert.ok(report.blockers.includes("effective_runtime_config_invalid"));
  assert.ok(report.blockers.includes("runtime_build_identity_invalid"));
});

test("gateway preflight reads the live runtime config and config file and is operator-read scoped", async () => {
  let registration;
  const root = mkdtempSync(join(tmpdir(), "memory-engine-preflight-gateway-"));
  const configPath = join(root, "openclaw.json");
  writeFileSync(configPath, JSON.stringify({ plugins: { entries: { "active-memory": { enabled: false } } } }), "utf8");
  const api = {
    config: { stale: true },
    runtime: {
      version: "2026.7.1",
      config: {
        current() {
          return { plugins: { entries: { "active-memory": { enabled: false } } } };
        },
      },
    },
    registerGatewayMethod(method, handler, options) {
      registration = { method, handler, options };
    },
  };
  assert.equal(registerSustainedRuntimePreflightGateway({
    api,
    effectiveRuntimeConfig: effectiveConfig(),
    effectiveRuntimeConfigValid: true,
    effectiveRuntimeConfigErrors: [],
    productionEvidenceIdentityContext: identityContext(),
    openclawConfigPath: configPath,
  }), true);
  assert.equal(registration.method, SUSTAINED_RUNTIME_PREFLIGHT_METHOD);
  assert.deepEqual(registration.options, { scope: "operator.read" });
  let response;
  await registration.handler({
    respond(ok, payload, error) {
      response = { ok, payload, error };
    },
  });
  assert.equal(response.ok, true);
  assert.equal(response.payload.status, "clean");
  assert.equal(response.payload.openclaw_runtime_version, "2026.7.1");
  assert.equal(response.payload.openclaw_config_file_path, configPath);
  assert.match(response.payload.openclaw_config_file_sha256, /^[a-f0-9]{64}$/);
});
