import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fingerprintConfig } from "../lib/config/config-fingerprint.js";
import {
  resolveEffectiveHybridRuntimeConfig,
} from "../lib/config/effective-hybrid-runtime-config.js";
import {
  createExplicitSearchRerankControlPolicy,
  R3_C0_CONTROL_ADAPTER_MUST_NOT_BE_CALLED,
} from "../lib/recall/hybrid/explicit-search-rerank-control-policy.js";
import { createHybridRuntimeContext } from "../lib/recall/hybrid/runtime-context.js";
import { createMemoryEngineSearchExecute } from "../lib/tools/memory-engine-actions.js";

const MANIFEST = new URL("../openclaw.plugin.json", import.meta.url);

function resolve(input = {}) {
  return resolveEffectiveHybridRuntimeConfig(input);
}

function validConfig(input = {}) {
  const result = resolve(input);
  assert.equal(result.valid, true, result.errors.join(", "));
  return result;
}

function configFingerprint(input = {}) {
  const { valid, errors, ...config } = resolve(input);
  assert.equal(valid, true, errors.join(", "));
  return fingerprintConfig(config).fingerprint;
}

test("manifest exposes only the default-off boolean C0 control object", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const control = manifest.configSchema.properties.explicitSearchRerankControl;

  assert.deepEqual(control, {
    type: "object",
    additionalProperties: false,
    default: { enabled: false },
    properties: {
      enabled: {
        type: "boolean",
        default: false,
      },
    },
  });
  assert.deepEqual(Object.keys(control.properties), ["enabled"]);
  for (const forbidden of [
    "mode",
    "candidateDepth",
    "maxCodePointsPerCandidate",
    "maxTotalCodePoints",
    "deadlineMs",
    "adapter",
    "adapterIdentity",
    "provider",
    "model",
    "endpoint",
    "apiKey",
    "credential",
    "tokenBudget",
  ]) {
    assert.equal(Object.hasOwn(control.properties, forbidden), false, forbidden);
  }
});

test("effective C0 config is plugin-scoped, normalized, and default-off", () => {
  const omitted = validConfig({});
  const explicitDisabled = validConfig({
    pluginConfig: { explicitSearchRerankControl: { enabled: false } },
  });
  const enabled = validConfig({
    pluginConfig: { explicitSearchRerankControl: { enabled: true } },
  });

  assert.deepEqual(omitted.explicitSearchRerankControl, { enabled: false });
  assert.deepEqual(explicitDisabled.explicitSearchRerankControl, { enabled: false });
  assert.deepEqual(enabled.explicitSearchRerankControl, { enabled: true });
  assert.equal(configFingerprint({}), configFingerprint({
    pluginConfig: { explicitSearchRerankControl: { enabled: false } },
  }));
  assert.notEqual(configFingerprint({}), configFingerprint({
    pluginConfig: { explicitSearchRerankControl: { enabled: true } },
  }));
  assert.deepEqual(Object.keys(enabled.explicitSearchRerankControl), ["enabled"]);

  const pluginWins = validConfig({
    pluginConfig: { explicitSearchRerankControl: { enabled: false } },
    pluginEntryConfig: { explicitSearchRerankControl: { enabled: true } },
  });
  assert.deepEqual(pluginWins.explicitSearchRerankControl, { enabled: false });

  const entryWins = validConfig({
    pluginEntryConfig: { explicitSearchRerankControl: { enabled: true } },
  });
  assert.deepEqual(entryWins.explicitSearchRerankControl, { enabled: true });

  const apiConfigOnly = validConfig({
    apiConfig: { explicitSearchRerankControl: { enabled: true } },
  });
  assert.deepEqual(apiConfigOnly.explicitSearchRerankControl, { enabled: false });
});

test("malformed high-priority C0 config blocks lower-priority enablement", () => {
  for (const malformed of [
    "bad",
    null,
    { enabled: "yes" },
    { enabled: true, mode: "rerank" },
  ]) {
    const result = resolve({
      pluginConfig: { explicitSearchRerankControl: malformed },
      pluginEntryConfig: { explicitSearchRerankControl: { enabled: true } },
    });
    assert.equal(result.valid, false);
    assert.deepEqual(result.explicitSearchRerankControl, { enabled: false });
  }
});

test("trusted C0 policy is frozen, source-bounded, and control-only", () => {
  assert.equal(createExplicitSearchRerankControlPolicy(validConfig()), null);
  assert.equal(createExplicitSearchRerankControlPolicy({ valid: false, explicitSearchRerankControl: { enabled: true } }), null);

  const policy = createExplicitSearchRerankControlPolicy(validConfig({
    pluginConfig: { explicitSearchRerankControl: { enabled: true } },
  }));
  assert.equal(Object.isFrozen(policy), true);
  assert.equal(Object.isFrozen(policy.adapterIdentity), true);
  assert.deepEqual({
    enabled: policy.enabled,
    mode: policy.mode,
    candidateDepth: policy.candidateDepth,
    maxCodePointsPerCandidate: policy.maxCodePointsPerCandidate,
    maxTotalCodePoints: policy.maxTotalCodePoints,
    deadlineMs: policy.deadlineMs,
    adapterIdentity: policy.adapterIdentity,
  }, {
    enabled: true,
    mode: "control",
    candidateDepth: 20,
    maxCodePointsPerCandidate: 4000,
    maxTotalCodePoints: 48000,
    deadlineMs: 2500,
    adapterIdentity: {
      provider: "local-control",
      model: "none",
      revision: "r3-c0-control-v1",
    },
  });
  assert.deepEqual(Object.keys(policy.adapterIdentity).sort(), ["model", "provider", "revision"]);
  assert.equal(Object.hasOwn(policy, "endpoint"), false);
  assert.equal(Object.hasOwn(policy, "credential"), false);
  assert.throws(policy.adapter, error => {
    assert.equal(error.code, R3_C0_CONTROL_ADAPTER_MUST_NOT_BE_CALLED);
    assert.equal(error.message, R3_C0_CONTROL_ADAPTER_MUST_NOT_BE_CALLED);
    return true;
  });
});

async function observeSearch(policy, params = {}) {
  const calls = [];
  const context = createHybridRuntimeContext({
    dataAccess: {
      getLancedbTable: () => null,
    },
    retrievalPolicy: {
      explicitSearchRerankPolicy: policy,
      hybridSearch: async (query, options, runtime) => {
        calls.push({ query, options, runtime });
        return { results: [], debug: {} };
      },
    },
    telemetry: {
      recordHybridSearchObservation: () => true,
    },
  });
  const executeSearch = createMemoryEngineSearchExecute({ hybrid: context });
  await executeSearch("c0-test", {
    query: "trusted control",
    top_k: 3,
    mode: "rerank",
    candidateDepth: 1,
    maxCodePointsPerCandidate: 1,
    maxTotalCodePoints: 1,
    deadlineMs: 1,
    adapter: "model-controlled",
    provider: "model-controlled",
    endpoint: "https://must-not-be-read",
    ...params,
  });
  return calls;
}

test("trusted policy reaches explicit search only after real context assembly", async () => {
  const enabledConfig = validConfig({
    pluginConfig: { explicitSearchRerankControl: { enabled: true } },
  });
  const policy = createExplicitSearchRerankControlPolicy(enabledConfig);
  const calls = await observeSearch(policy);
  assert.equal(calls.length, 1);
  assert.deepEqual({
    profile: calls[0].runtime.explicitSearchRerankProfile.profile,
    mode: calls[0].runtime.explicitSearchRerankProfile.mode,
    candidateDepth: calls[0].runtime.explicitSearchRerankProfile.candidateDepth,
    maxCodePointsPerCandidate: calls[0].runtime.explicitSearchRerankProfile.maxCodePointsPerCandidate,
    maxTotalCodePoints: calls[0].runtime.explicitSearchRerankProfile.maxTotalCodePoints,
    deadlineMs: calls[0].runtime.explicitSearchRerankProfile.deadlineMs,
  }, {
    profile: "q3_explicit_search_bounded_rerank_v1",
    mode: "control",
    candidateDepth: 20,
    maxCodePointsPerCandidate: 4000,
    maxTotalCodePoints: 48000,
    deadlineMs: 2500,
  });
});

test("disabled trusted configuration passes no explicit profile and cannot be model-enabled", async () => {
  const calls = await observeSearch(null);
  assert.equal(calls.length, 1);
  assert.equal(Object.hasOwn(calls[0].runtime, "explicitSearchRerankProfile"), false);
});

test("index assembly owns the trusted seam while createSearchRunner remains the propagation point", () => {
  const source = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  assert.match(source, /createExplicitSearchRerankControlPolicy\(effectiveRuntimeConfig\)/);
  assert.match(source, /explicitSearchRerankPolicy,?/);
});
