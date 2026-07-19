import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_AUTO_RECALL,
  resolveEffectiveHybridRuntimeConfig,
} from "../lib/config/effective-hybrid-runtime-config.js";
import { fingerprintRolloutConfig } from "../lib/recall/hybrid/production-evidence-identity.js";

function normalized(input) {
  const { valid, errors, ...config } = resolveEffectiveHybridRuntimeConfig(input);
  assert.equal(valid, true, errors.join(", "));
  return config;
}

function fingerprint(input) {
  return fingerprintRolloutConfig(normalized(input)).fingerprint;
}

test("official plugin config is the highest-priority runtime source", () => {
  const config = normalized({
    pluginConfig: {
      kgFailClosedMode: "full_fail_closed",
      recentFailClosedMode: "full_fail_closed",
    },
    pluginEntryConfig: {
      kgFailClosedMode: "legacy_fallback",
      recentFailClosedMode: "legacy_fallback",
    },
    apiConfig: {
      kgFailClosedMode: "shadow_fail_closed",
      recentFailClosedMode: "shadow_fail_closed",
    },
  });
  assert.equal(config.kgFailClosedMode, "full_fail_closed");
  assert.equal(config.recentFailClosedMode, "full_fail_closed");
});

test("legacy nested and global compatibility sources resolve to the runtime mode", () => {
  const nested = normalized({
    pluginConfig: {},
    pluginEntryConfig: { autoRecall: { kgFailClosedMode: "full_fail_closed" } },
  });
  assert.equal(nested.kgFailClosedMode, "full_fail_closed");

  const global = normalized({ apiConfig: { kgFailClosedMode: "full_fail_closed" } });
  assert.equal(global.kgFailClosedMode, "full_fail_closed");
});

test("lower-priority changes do not change the effective fingerprint", () => {
  const base = {
    pluginConfig: { kgFailClosedMode: "full_fail_closed" },
    apiConfig: { kgFailClosedMode: "legacy_fallback" },
  };
  const changedLowerPriority = {
    pluginConfig: { kgFailClosedMode: "full_fail_closed" },
    apiConfig: { kgFailClosedMode: "shadow_fail_closed" },
  };
  assert.equal(fingerprint(base), fingerprint(changedLowerPriority));
});

test("omitted values and explicit schema defaults have the same effective fingerprint", () => {
  const omitted = fingerprint({});
  const explicit = fingerprint({
    pluginConfig: {
      autoRecall: { ...DEFAULT_AUTO_RECALL },
      kgFailClosedMode: "legacy_fallback",
      kgFailClosedCanary: { enabled: false, agentIds: [], sessionIds: [], tokens: [] },
      recentFailClosedMode: "legacy_fallback",
      recentFailClosedCanary: { enabled: false, agentIds: [], sessionIds: [], tokens: [] },
      productionEvidenceWindow: { enabled: false, epochId: null },
    },
  });
  assert.equal(omitted, explicit);
});

test("effective AutoRecall, mode, canary, and epoch changes change the fingerprint", () => {
  const base = { pluginConfig: { productionEvidenceWindow: { enabled: true, epochId: "epoch-1" } } };
  for (const change of [
    { autoRecall: { enabled: true } },
    { autoRecall: { topK: 9 } },
    { autoRecall: { timeoutMs: 1000 } },
    { autoRecall: { agentAllowlist: ["main"] } },
    { autoRecall: { triggerAllowlist: ["manual"] } },
    { autoRecall: { chatTypeAllowlist: ["other"] } },
    { autoRecall: { messageRoleAllowlist: ["assistant"] } },
    { kgFailClosedMode: "full_fail_closed" },
    { kgFailClosedCanary: { enabled: true, agentIds: ["edi"], sessionIds: [] } },
    { recentFailClosedMode: "full_fail_closed" },
    { recentFailClosedCanary: { enabled: true, agentIds: ["edi"], sessionIds: [] } },
    { productionEvidenceWindow: { enabled: true, epochId: "epoch-2" } },
  ]) {
    assert.notEqual(
      fingerprint(base),
      fingerprint({ pluginConfig: { ...base.pluginConfig, ...change } }),
      JSON.stringify(change),
    );
  }
});

test("invalid legacy values are marked invalid instead of silently fingerprinted", () => {
  const result = resolveEffectiveHybridRuntimeConfig({
    pluginConfig: { autoRecall: { agentAllowlist: "edi" } },
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("invalid_array:autoRecall.agentAllowlist"));
});

test("canary compatibility aliases are preserved in normalized config", () => {
  const config = normalized({
    pluginConfig: {
      recentFailClosedCanary: {
        enabled: true,
        agents: ["edi"],
        sessions: ["session-1"],
        tokenAllowlist: ["canary-token"],
      },
    },
  });
  assert.deepEqual(config.recentFailClosedCanary, {
    enabled: true,
    agentIds: ["edi"],
    sessionIds: ["session-1"],
    tokens: ["canary-token"],
  });
});

test("invalid fail-closed modes fail safe and invalidate evidence identity", () => {
  const result = resolveEffectiveHybridRuntimeConfig({
    pluginConfig: { kgFailClosedMode: "unexpected_mode" },
  });
  assert.equal(result.valid, false);
  assert.equal(result.kgFailClosedMode, "legacy_fallback");
  assert.ok(result.errors.includes("invalid_mode:kgFailClosedMode"));
});
