import assert from "node:assert/strict";
import test from "node:test";

import {
  C1A_EXECUTION_PACKET_SCHEMA,
  C1A_EGRESS_SCOPE,
  validateC1AExecutionPacket,
} from "../lib/benchmark/c1a-execution-packet.js";
import { C1A_ACCEPTANCE_THRESHOLDS } from "../lib/benchmark/c1a-qualification-scorer.js";

const sourceCommit = "a".repeat(40);
const executionRoot = "/tmp/memory-engine-c1a-e0";
const manifest = {
  schema: "memory_engine_r3_c1a_qualification_manifest_v1",
  manifest_sha256: "b".repeat(64),
  source_identity: {
    qualification_source: { source_commit: sourceCommit, worktree_clean: true },
    egress_decision: "ALLOW",
  },
  profile: {
    provider: {
      provider: "siliconflow",
      model: "Qwen/Qwen3-Reranker-8B",
      endpoint: "https://api.siliconflow.cn/v1/rerank",
      revision: null,
    },
    token_preflight: {
      counter_id: "qwen3_utf8_byte_token_upper_bound_v1",
      maxQueryTokens: 4096,
      maxDocumentTokens: 8192,
      maxPairTokens: 12288,
      specialTokenReservePerPair: 256,
    },
    acceptance_thresholds: { ...C1A_ACCEPTANCE_THRESHOLDS },
  },
};

function packet(overrides = {}) {
  return {
    schema: C1A_EXECUTION_PACKET_SCHEMA,
    source_commit: sourceCommit,
    manifest_sha256: manifest.manifest_sha256,
    provider: "siliconflow",
    model: "Qwen/Qwen3-Reranker-8B",
    endpoint: "https://api.siliconflow.cn/v1/rerank",
    egress: {
      query: "ALLOW",
      canonical_text: "ALLOW",
      scope: C1A_EGRESS_SCOPE,
    },
    max_provider_requests: 328,
    max_input_tokens: 6_000_000,
    max_cost_usd: 1,
    input_price_usd_per_million: 0.04,
    deadline_ms: 2500,
    execution_count: 1,
    pacing: {
      min_interval_ms: 1000,
      token_window_ms: 60_000,
      max_estimated_tokens_per_window: 250_000,
    },
    rate_limits: { confirmed: true, source: "owner-verified-account-limit" },
    api_key_env: "SILICONFLOW_API_KEY",
    execution_root: executionRoot,
    ...overrides,
  };
}

test("C1-A execution packet binds exact source, manifest, provider, egress, budgets, and root", () => {
  const binding = validateC1AExecutionPacket({
    packet: packet(),
    manifest,
    sourceCommit,
    worktreeClean: true,
    executionRoot,
  });
  assert.equal(binding.provider, "siliconflow");
  assert.equal(binding.execution_count, 1);
  assert.equal(binding.execution_root, executionRoot);
  assert.equal(binding.max_provider_requests, 328);
  assert.equal(binding.max_input_tokens, 6_000_000);
});

test("C1-A execution packet fails closed on authority-binding drift", () => {
  const base = { manifest, sourceCommit, worktreeClean: true, executionRoot };
  assert.throws(
    () => validateC1AExecutionPacket({ ...base, packet: packet({ source_commit: "c".repeat(40) }) }),
    /C1A_EXECUTION_SOURCE_COMMIT_MISMATCH/,
  );
  assert.throws(
    () => validateC1AExecutionPacket({ ...base, packet: packet({ manifest_sha256: "d".repeat(64) }) }),
    /C1A_EXECUTION_MANIFEST_MISMATCH/,
  );
  assert.throws(
    () => validateC1AExecutionPacket({ ...base, packet: packet({ execution_root: "/tmp/other" }) }),
    /C1A_EXECUTION_ROOT_MISMATCH/,
  );
  assert.throws(
    () => validateC1AExecutionPacket({ ...base, packet: packet(), worktreeClean: false }),
    /C1A_EXECUTION_SOURCE_WORKTREE_NOT_CLEAN/,
  );
});

test("C1-A execution packet cannot infer missing egress or rate-limit approval", () => {
  const base = { manifest, sourceCommit, worktreeClean: true, executionRoot };
  assert.throws(
    () => validateC1AExecutionPacket({
      ...base,
      packet: packet({ egress: { query: "ALLOW", canonical_text: "UNKNOWN", scope: C1A_EGRESS_SCOPE } }),
    }),
    /C1A_EXECUTION_EGRESS_NOT_EXPLICITLY_ALLOWED/,
  );
  assert.throws(
    () => validateC1AExecutionPacket({
      ...base,
      packet: packet({ rate_limits: { confirmed: false, source: "unknown" } }),
    }),
    /C1A_EXECUTION_RATE_LIMITS_UNCONFIRMED/,
  );
});
