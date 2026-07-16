import test from "node:test";
import assert from "node:assert/strict";

import {
  RECENT_CANARY_DEFAULT_SAMPLE_RATE_BPS,
  resolveRecentCanaryDecision,
  resolveRecentCanarySampleBucket,
} from "../lib/recall/hybrid/recent-canary-policy.js";

test("recent canary policy defaults off when provider is missing or invalid", () => {
  assert.deepEqual(resolveRecentCanaryDecision(), {
    mode: "off",
    reason: "provider_unavailable",
    scope_class: null,
    sampled: false,
    sample_bucket: null,
    sample_rate_basis_points: 0,
    policy_error: false,
  });
  assert.equal(resolveRecentCanaryDecision({ provider: {} }).reason, "provider_invalid");
});

test("recent canary policy fails closed on provider errors and unsupported modes", () => {
  const providerError = resolveRecentCanaryDecision({
    provider() {
      throw new Error("boom");
    },
  });
  assert.equal(providerError.mode, "off");
  assert.equal(providerError.reason, "provider_error");
  assert.equal(providerError.policy_error, true);

  for (const mode of ["serve_isolated", "unknown"]) {
    const decision = resolveRecentCanaryDecision({
      scope: { sampleKey: "scope-1" },
      provider: () => ({ mode, scopeClass: "internal" }),
    });
    assert.equal(decision.mode, "off");
    assert.equal(decision.reason, "mode_not_allowed");
  }
});

test("recent canary policy keeps default sample rate at zero and requires sampled true", () => {
  const missingKey = resolveRecentCanaryDecision({
    scope: {},
    provider: () => ({ mode: "shadow", scopeClass: "internal" }),
  });
  assert.equal(missingKey.mode, "off");
  assert.equal(missingKey.reason, "missing_sample_key");
  assert.equal(missingKey.sample_rate_basis_points, RECENT_CANARY_DEFAULT_SAMPLE_RATE_BPS);

  const unsampled = resolveRecentCanaryDecision({
    scope: { sampleKey: "scope-1" },
    provider: () => ({ mode: "shadow", scopeClass: "internal", sampleRateBasisPoints: 0 }),
  });
  assert.equal(unsampled.mode, "off");
  assert.equal(unsampled.reason, "not_sampled");
  assert.equal(unsampled.sampled, false);
});

test("recent canary policy computes deterministic buckets and never exposes raw sample keys", () => {
  const bucketA = resolveRecentCanarySampleBucket("agent-123");
  const bucketB = resolveRecentCanarySampleBucket("agent-123");
  const bucketC = resolveRecentCanarySampleBucket("agent-456");
  assert.equal(bucketA, bucketB);
  assert.equal(Number.isInteger(bucketA), true);
  assert.equal(bucketA >= 0 && bucketA < 10000, true);
  assert.notEqual(bucketA, bucketC);

  const decision = resolveRecentCanaryDecision({
    scope: { sampleKey: "scope-secret-123" },
    provider: () => ({ mode: "shadow", scopeClass: "internal", sampleRateBasisPoints: 10000 }),
  });
  assert.equal(decision.mode, "shadow");
  assert.equal(decision.sampled, true);
  assert.equal(JSON.stringify(decision).includes("scope-secret-123"), false);
});
