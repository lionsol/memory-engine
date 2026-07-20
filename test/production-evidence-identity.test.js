import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createProductionEvidenceIdentityContext,
  evaluateProductionEvidenceIdentity,
  fingerprintRolloutConfig,
} from "../lib/recall/hybrid/production-evidence-identity.js";

const BUILD = "a".repeat(64);
const CONFIG = "b".repeat(64);
const SURFACES = ["auto_recall", "memory_engine_search", "memory_engine_action_search"];

function row(surface, overrides = {}) {
  return {
    event_type: "hybrid_search_observation",
    source: `hybrid.${surface}`,
    session_id: surface === "auto_recall" ? "session-1" : null,
    trace_id: `trace-${surface}`,
    metadata_json: {
      schema_version: 1,
      surface,
      search_executed: true,
      completed_at: "2026-07-18T00:00:00.000Z",
      production_evidence_enabled: true,
      evidence_epoch_id: "epoch-1",
      runtime_build_identity: BUILD,
      rollout_config_fingerprint: CONFIG,
      ...overrides,
    },
  };
}

function allRows(overrides = {}) {
  return SURFACES.map(surface => row(surface, overrides));
}

test("rollout config fingerprint canonicalizes object keys but preserves array order", () => {
  const left = fingerprintRolloutConfig({ b: 2, a: { y: 1, x: 2 }, list: ["a", "b"] });
  const reordered = fingerprintRolloutConfig({ list: ["a", "b"], a: { x: 2, y: 1 }, b: 2 });
  const arrayChanged = fingerprintRolloutConfig({ b: 2, a: { x: 2, y: 1 }, list: ["b", "a"] });
  assert.equal(left.valid, true);
  assert.equal(left.fingerprint, reordered.fingerprint);
  assert.notEqual(left.fingerprint, arrayChanged.fingerprint);
  assert.notEqual(left.fingerprint, fingerprintRolloutConfig({ b: 2, a: { x: 2, y: 1 }, list: ["a", "b"], epochId: "other" }).fingerprint);
});

test("enabled identity context records configured epoch and deterministic fingerprints", () => {
  const context = createProductionEvidenceIdentityContext({
    config: {
      productionEvidenceWindow: { enabled: true, epochId: "epoch-1" },
      kgFailClosedMode: "full_fail_closed",
    },
    rootDir: new URL("..", import.meta.url).pathname,
  });
  assert.equal(context.productionEvidenceEnabled, true);
  assert.equal(context.evidenceEpochId, "epoch-1");
  assert.match(context.runtimeBuildIdentity, /^[a-f0-9]{64}$/);
  assert.match(context.rolloutConfigFingerprint, /^[a-f0-9]{64}$/);
});

test("manifest keeps evidence identity disabled by default and validates epoch shape", () => {
  const manifest = JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"));
  const schema = manifest.configSchema.properties.productionEvidenceWindow;
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.default.enabled, false);
  assert.equal(schema.properties.enabled.default, false);
  assert.equal(schema.properties.epochId.minLength, 1);
  assert.deepEqual(schema.allOf[0].then.required, ["epochId"]);
  assert.equal(schema.allOf[0].if.properties.enabled.const, true);
});

test("one epoch, build, and config across all production surfaces is ready", () => {
  const report = evaluateProductionEvidenceIdentity({ observations: allRows() });
  assert.equal(report.status, "identity_ready");
  assert.equal(report.observation_count, 3);
  assert.equal(report.qualifying_observation_count, 3);
  assert.deepEqual(report.evidence_epoch_ids, ["epoch-1"]);
});

test("missing identity, disabled evidence, and invalid provenance are blocked", () => {
  const missing = evaluateProductionEvidenceIdentity({ observations: allRows({ evidence_epoch_id: null }) });
  assert.equal(missing.status, "blocked");
  assert.ok(missing.blockers.some(item => item.code === "missing_evidence_epoch_id"));

  const disabled = evaluateProductionEvidenceIdentity({ observations: allRows({ production_evidence_enabled: false }) });
  assert.equal(disabled.status, "blocked");
  assert.ok(disabled.blockers.some(item => item.code === "production_evidence_not_enabled"));

  const invalid = evaluateProductionEvidenceIdentity({ observations: allRows({ schema_version: 2 }) });
  assert.equal(invalid.status, "blocked");
  assert.ok(invalid.blockers.some(item => item.code === "invalid_observation_provenance"));

  const invalidIdentity = evaluateProductionEvidenceIdentity({ observations: allRows({ runtime_build_identity: "not-a-sha256" }) });
  assert.equal(invalidIdentity.status, "blocked");
  assert.ok(invalidIdentity.blockers.some(item => item.code === "invalid_identity_format"));
  assert.equal(invalidIdentity.qualifying_observation_count, 0);
});

test("mixed epoch, build, and config identities are never ready", () => {
  const report = evaluateProductionEvidenceIdentity({
    observations: [
      row("auto_recall"),
      row("memory_engine_search", { evidence_epoch_id: "epoch-2" }),
      row("memory_engine_action_search", { runtime_build_identity: "c".repeat(64), rollout_config_fingerprint: "d".repeat(64) }),
    ],
  });
  assert.equal(report.status, "identity_mixed");
  assert.equal(report.mixed_epoch, true);
  assert.equal(report.mixed_runtime_build, true);
  assert.equal(report.mixed_rollout_config, true);
});

test("pre-A7 and CLI observations cannot satisfy the identity audit", () => {
  const preA7 = evaluateProductionEvidenceIdentity({ observations: allRows({ production_evidence_enabled: false }) });
  assert.notEqual(preA7.status, "identity_ready");
  const cli = evaluateProductionEvidenceIdentity({ observations: [row("cli_search")] });
  assert.equal(cli.status, "identity_incomplete");
  assert.equal(cli.excluded_non_production_observation_count, 1);
  const unknown = evaluateProductionEvidenceIdentity({ observations: [row("unknown_surface")] });
  assert.equal(unknown.status, "blocked");
  assert.equal(unknown.unknown_surface_observation_count, 1);
  assert.ok(unknown.blockers.some(item => item.code === "unknown_production_surface"));
});
