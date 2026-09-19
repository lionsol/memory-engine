import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveEffectiveHybridRuntimeConfig } from "../lib/config/effective-hybrid-runtime-config.js";
import { createExplicitSearchRerankProviderPolicy } from "../lib/recall/hybrid/explicit-search-rerank-provider-policy.js";
import { createHybridRuntimeContext } from "../lib/recall/hybrid/runtime-context.js";
import { createMemoryEngineSearchExecute } from "../lib/tools/memory-engine-actions.js";

const MANIFEST = new URL("../openclaw.plugin.json", import.meta.url);

function validConfig(input = {}) {
  const result = resolveEffectiveHybridRuntimeConfig(input);
  assert.equal(result.valid, true, result.errors.join(", "));
  return result;
}

test("manifest exposes a separate default-off experimental provider switch", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const provider = manifest.configSchema.properties.explicitSearchRerankProvider;
  assert.equal(provider.type, "object");
  assert.equal(provider.additionalProperties, false);
  assert.deepEqual(provider.default, { enabled: false });
  assert.deepEqual(Object.keys(provider.properties), ["enabled"]);
  assert.equal(provider.properties.enabled.type, "boolean");
});

test("provider switch is trusted-plugin scoped and conflicts fail closed", () => {
  assert.deepEqual(validConfig().explicitSearchRerankProvider, { enabled: false });
  assert.deepEqual(validConfig({
    pluginConfig: { explicitSearchRerankProvider: { enabled: true } },
  }).explicitSearchRerankProvider, { enabled: true });
  assert.deepEqual(validConfig({
    pluginEntryConfig: { explicitSearchRerankProvider: { enabled: true } },
  }).explicitSearchRerankProvider, { enabled: true });
  assert.deepEqual(validConfig({
    apiConfig: { explicitSearchRerankProvider: { enabled: true } },
  }).explicitSearchRerankProvider, { enabled: false });

  const conflicted = resolveEffectiveHybridRuntimeConfig({
    pluginConfig: {
      explicitSearchRerankControl: { enabled: true },
      explicitSearchRerankProvider: { enabled: true },
    },
  });
  assert.equal(conflicted.valid, false);
  assert.match(conflicted.errors.join("\n"), /conflict:explicitSearchRerankControl:explicitSearchRerankProvider/);
  assert.equal(createExplicitSearchRerankProviderPolicy(conflicted, { apiKey: "test-key" }), null);
});

test("enabled rerank provider disables only its policy when the credential is unavailable", () => {
  const warnings = [];
  const policy = createExplicitSearchRerankProviderPolicy(validConfig({
    pluginConfig: { explicitSearchRerankProvider: { enabled: true } },
  }), {
    apiKey: "",
    onCredentialMissing: code => warnings.push(code),
  });

  assert.equal(policy, null);
  assert.deepEqual(warnings, ["SILICONFLOW_RERANK_API_KEY_REQUIRED"]);
});

test("accepted 0.6B provider policy is fixed to the production-shaped explicit-search profile", async () => {
  let captured = null;
  const config = validConfig({
    pluginConfig: { explicitSearchRerankProvider: { enabled: true } },
  });
  const policy = createExplicitSearchRerankProviderPolicy(config, {
    apiKey: "test-key",
    transport: async request => {
      captured = request;
      return {
        status: 200,
        body: JSON.stringify({
          results: [
            { index: 1, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.1 },
          ],
        }),
      };
    },
  });

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
    mode: "rerank",
    candidateDepth: 20,
    maxCodePointsPerCandidate: 4000,
    maxTotalCodePoints: 48000,
    deadlineMs: 2500,
    adapterIdentity: {
      provider: "siliconflow",
      model: "Qwen/Qwen3-Reranker-0.6B",
      revision: null,
    },
  });

  const adapterResult = await policy.adapter("query", ["doc-a", "doc-b"], new AbortController().signal);
  assert.equal(captured.apiKey, "test-key");
  assert.deepEqual(captured.body, {
    model: "Qwen/Qwen3-Reranker-0.6B",
    query: "query",
    documents: ["doc-a", "doc-b"],
    top_n: 2,
    return_documents: false,
  });
  assert.deepEqual(adapterResult.adapterIdentity, policy.adapterIdentity);
});

test("provider policy propagates only through the trusted explicit-search runtime seam", async () => {
  const calls = [];
  const policy = createExplicitSearchRerankProviderPolicy(validConfig({
    pluginConfig: { explicitSearchRerankProvider: { enabled: true } },
  }), {
    apiKey: "test-key",
    transport: async () => { throw new Error("transport must not be called by propagation test"); },
  });
  const context = createHybridRuntimeContext({
    dataAccess: { getLancedbTable: () => null },
    retrievalPolicy: {
      explicitSearchRerankPolicy: policy,
      hybridSearch: async (query, options, runtime) => {
        calls.push({ query, options, runtime });
        return { results: [], debug: {} };
      },
    },
    telemetry: { recordHybridSearchObservation: () => true },
  });
  const executeSearch = createMemoryEngineSearchExecute({ hybrid: context });
  await executeSearch("c1b-test", { query: "real host", top_k: 3 });

  assert.equal(calls.length, 1);
  assert.deepEqual({
    mode: calls[0].runtime.explicitSearchRerankProfile.mode,
    candidateDepth: calls[0].runtime.explicitSearchRerankProfile.candidateDepth,
    deadlineMs: calls[0].runtime.explicitSearchRerankProfile.deadlineMs,
    adapterIdentity: calls[0].runtime.explicitSearchRerankProfile.adapterIdentity,
  }, {
    mode: "rerank",
    candidateDepth: 20,
    deadlineMs: 2500,
    adapterIdentity: {
      provider: "siliconflow",
      model: "Qwen/Qwen3-Reranker-0.6B",
      revision: null,
    },
  });
});

test("index assembly resolves the runtime key and prefers the provider seam over C0 control", () => {
  const source = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  assert.match(source, /createExplicitSearchRerankProviderPolicy/);
  assert.match(source, /resolveSFKey/);
  assert.match(source, /explicitSearchRerankProviderPolicy\s*\|\|\s*createExplicitSearchRerankControlPolicy/);
});
