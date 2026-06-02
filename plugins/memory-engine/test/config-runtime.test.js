import test from "node:test";
import assert from "node:assert/strict";
import { getDefaultMemoryEngineConfig } from "../lib/config/defaults.js";
import { getMemoryEngineConfig } from "../lib/config/runtime.js";

test("getMemoryEngineConfig returns defaults when no runtime config is provided", () => {
  const defaults = getDefaultMemoryEngineConfig();
  const resolved = getMemoryEngineConfig(null);
  assert.deepEqual(resolved, defaults);
});

test("getMemoryEngineConfig merges api.config.memoryEngine overrides", () => {
  const resolved = getMemoryEngineConfig({
    config: {
      memoryEngine: {
        timezone: { business: "UTC" },
        recall: { topK: 9, vectorTopK: 44 },
        ranking: {
          rrfK: 99,
          recencyBoost: { base: 0.2 },
        },
        metrics: { windowDays: 30, topN: 5 },
      },
    },
  });
  assert.equal(resolved.timezone.business, "UTC");
  assert.equal(resolved.recall.topK, 9);
  assert.equal(resolved.recall.vectorTopK, 44);
  assert.equal(resolved.recall.lexicalConfidenceThreshold, 0.7);
  assert.equal(resolved.ranking.rrfK, 99);
  assert.equal(resolved.ranking.recencyBoost.base, 0.2);
  assert.equal(resolved.ranking.recencyBoost.decayDays, 2.5);
  assert.equal(resolved.metrics.windowDays, 30);
  assert.equal(resolved.metrics.topN, 5);
});

test("getMemoryEngineConfig does not mutate defaults", () => {
  const original = getDefaultMemoryEngineConfig();
  const resolved = getMemoryEngineConfig({
    memoryEngine: {
      recall: { topK: 11 },
    },
  });
  assert.equal(resolved.recall.topK, 11);
  const after = getDefaultMemoryEngineConfig();
  assert.deepEqual(after, original);
});

test("getDefaultMemoryEngineConfig exposes lexical confidence threshold", () => {
  const defaults = getDefaultMemoryEngineConfig();
  assert.equal(defaults.recall.lexicalConfidenceThreshold, 0.7);
});
