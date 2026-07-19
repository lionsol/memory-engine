import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_AUTO_RECALL,
  resolveEffectiveHybridRuntimeConfig,
} from "../lib/config/effective-hybrid-runtime-config.js";
import {
  createProductionEvidenceIdentityContext,
  fingerprintRolloutConfig,
} from "../lib/recall/hybrid/production-evidence-identity.js";

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
      autoRecall: { ...DEFAULT_AUTO_RECALL, topK: 5 },
      kgFailClosedMode: "legacy_fallback",
      kgFailClosedCanary: { enabled: false, agentIds: [], sessionIds: [], tokens: [] },
      recentFailClosedMode: "legacy_fallback",
      recentFailClosedCanary: { enabled: false, agentIds: [], sessionIds: [], tokens: [] },
      productionEvidenceWindow: { enabled: false, epochId: null },
    },
  });
  assert.equal(omitted, explicit);
});

test("AutoRecall topK uses memory-engine recall when not explicitly configured", () => {
  const inherited = normalized({
    apiConfig: { memoryEngine: { recall: { topK: 11 } } },
  });
  assert.equal(inherited.autoRecall.topK, 11);

  const overridden = normalized({
    pluginConfig: { autoRecall: { topK: 2 } },
    apiConfig: { memoryEngine: { recall: { topK: 11 } } },
  });
  assert.equal(overridden.autoRecall.topK, 2);
});

test("effective retrieval configuration changes the fingerprint", () => {
  const base = { apiConfig: { memoryEngine: { recall: { topK: 5 } } } };
  for (const section of [
    { recall: { ftsTopK: 41 } },
    { recall: { vectorTopK: 41 } },
    { recall: { recentTopK: 41 } },
    { recall: { lexicalConfidenceThreshold: 0.81 } },
    { ranking: { rrfK: 91 } },
    { confidence: { min: 0.21 } },
  ]) {
    assert.notEqual(
      fingerprint(base),
      fingerprint({ apiConfig: { memoryEngine: section } }),
      JSON.stringify(section),
    );
  }
});

test("effective retrieval sections exclude unrelated host configuration", () => {
  const config = normalized({
    apiConfig: {
      memoryEngine: {
        recall: { ftsTopK: 41 },
        ranking: { rrfK: 91 },
        confidence: { min: 0.21 },
      },
      unrelatedPlugin: { secret: "not hashed as config" },
    },
  });
  assert.equal(config.hybridRetrieval.recall.ftsTopK, 41);
  assert.equal(config.hybridRetrieval.ranking.rrfK, 91);
  assert.equal(config.hybridRetrieval.confidence.min, 0.21);
  assert.equal(Object.hasOwn(config, "unrelatedPlugin"), false);
});

test("environment retrieval overrides are normalized into the effective config", () => {
  const previousMin = process.env.MEMORY_ENGINE_MIN_CONFIDENCE;
  const previousLexical = process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD;
  try {
    process.env.MEMORY_ENGINE_MIN_CONFIDENCE = "0.31";
    process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD = "0.82";
    const config = normalized({});
    assert.equal(config.hybridRetrieval.effectiveMinConfidence, 0.31);
    assert.equal(config.hybridRetrieval.effectiveLexicalConfidenceThreshold, 0.82);
  } finally {
    if (previousMin === undefined) delete process.env.MEMORY_ENGINE_MIN_CONFIDENCE;
    else process.env.MEMORY_ENGINE_MIN_CONFIDENCE = previousMin;
    if (previousLexical === undefined) delete process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD;
    else process.env.AUTO_RECALL_LEXICAL_CONFIDENCE_THRESHOLD = previousLexical;
  }
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

test("malformed compatibility values use safe runtime values and invalidate identity", () => {
  const result = resolveEffectiveHybridRuntimeConfig({
    pluginConfig: {
      autoRecall: { enabled: "false", topK: "bad", timeoutMs: {} },
      kgFailClosedCanary: { enabled: "true" },
      productionEvidenceWindow: { enabled: 1, epochId: "epoch-1" },
    },
  });
  assert.equal(result.valid, false);
  assert.equal(result.autoRecall.enabled, false);
  assert.equal(result.autoRecall.topK, 5);
  assert.equal(result.autoRecall.timeoutMs, 8000);
  assert.equal(result.kgFailClosedCanary.enabled, false);
  assert.equal(result.productionEvidenceWindow.enabled, false);

  const identity = createProductionEvidenceIdentityContext({
    config: result,
    configErrors: result.errors,
  });
  assert.equal(identity.rolloutConfigFingerprint, null);
  assert.equal(identity.rolloutConfigFingerprintReport.valid, false);
});
