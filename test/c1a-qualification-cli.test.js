import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createC1APacer,
  runC1AQualificationCli,
} from "../bin/run-c1a-qualification-v1.mjs";
import {
  C1A_EXECUTION_PACKET_SCHEMA,
  C1A_EGRESS_SCOPE,
} from "../lib/benchmark/c1a-execution-packet.js";
import { C1A_ACCEPTANCE_THRESHOLDS } from "../lib/benchmark/c1a-qualification-scorer.js";

const sourceCommit = "a".repeat(40);

function boundManifest(manifestSha) {
  return {
    schema: "memory_engine_r3_c1a_qualification_manifest_v1",
    manifest_sha256: manifestSha,
    population: { primary_count: 256 },
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
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function packet(manifestSha, executionRoot) {
  return {
    schema: C1A_EXECUTION_PACKET_SCHEMA,
    source_commit: sourceCommit,
    manifest_sha256: manifestSha,
    provider: "siliconflow",
    model: "Qwen/Qwen3-Reranker-8B",
    endpoint: "https://api.siliconflow.cn/v1/rerank",
    egress: { query: "ALLOW", canonical_text: "ALLOW", scope: C1A_EGRESS_SCOPE },
    max_provider_requests: 328,
    max_input_tokens: 6_000_000,
    max_cost_usd: 1,
    input_price_usd_per_million: 0.04,
    deadline_ms: 5000,
    execution_count: 1,
    pacing: {
      min_interval_ms: 0,
      token_window_ms: 60_000,
      max_estimated_tokens_per_window: 1_000_000,
    },
    rate_limits: { confirmed: true, source: "synthetic-account-limit" },
    api_key_env: "SILICONFLOW_API_KEY",
    execution_root: executionRoot,
  };
}

test("C1-A pacer enforces both request interval and rolling conservative token budget", async () => {
  let clock = 0;
  const sleeps = [];
  const pacer = createC1APacer({
    min_interval_ms: 1000,
    token_window_ms: 60_000,
    max_estimated_tokens_per_window: 100,
  }, {
    now: () => clock,
    sleep: async ms => {
      sleeps.push(ms);
      clock += ms;
    },
  });

  await pacer({ estimated_request_tokens: 60 });
  await pacer({ estimated_request_tokens: 40 });
  await pacer({ estimated_request_tokens: 50 });
  assert.deepEqual(sleeps, [1000, 59_000]);
  assert.equal(clock, 60_000);
  await assert.rejects(
    () => pacer({ estimated_request_tokens: 101 }),
    /C1A_PACING_SINGLE_REQUEST_EXCEEDS_TOKEN_WINDOW/,
  );
});

test("C1-A CLI prepare writes only the frozen manifest and makes zero provider calls", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-c1a-prepare-"));
  const output = join(root, "manifest.json");
  const manifest = boundManifest("b".repeat(64));
  let prepareCalls = 0;
  let adapterCalls = 0;

  const result = await runC1AQualificationCli([
    "prepare",
    "--root", "/synthetic/frozen",
    "--repo", "/synthetic/repo",
    "--egress-decision", "ALLOW",
    "--output", output,
  ], {
    prepareFromFrozen: () => {
      prepareCalls += 1;
      return { manifest };
    },
    adapterFactory: () => {
      adapterCalls += 1;
      throw new Error("adapter must not be constructed in prepare mode");
    },
    gitIdentity: () => ({ sourceCommit, worktreeClean: true }),
  });

  assert.equal(result.provider_calls, 0);
  assert.equal(prepareCalls, 1);
  assert.equal(adapterCalls, 0);
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), manifest);
});

test("C1-A CLI execute-provider binds packet/root and consumes the execution before fake execution", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-c1a-execute-"));
  const manifestPath = join(root, "manifest.json");
  const packetPath = join(root, "packet.json");
  const executionRoot = join(root, "execution");
  const manifest = boundManifest("c".repeat(64));
  writeJson(manifestPath, manifest);
  writeJson(packetPath, packet(manifest.manifest_sha256, executionRoot));

  let executeCalls = 0;
  let adapterFactoryCalls = 0;
  let transportFactoryCalls = 0;
  const fakeResult = {
    score: { pass: true },
    batch: { budget: { requests: 0 } },
  };

  const result = await runC1AQualificationCli([
    "execute-provider",
    "--root", "/synthetic/frozen",
    "--repo", "/synthetic/repo",
    "--manifest", manifestPath,
    "--packet", packetPath,
    "--execution-root", executionRoot,
  ], {
    prepareFromFrozen: () => ({ manifest, material: { cases: [] } }),
    executeQualification: async ({ adapter }) => {
      executeCalls += 1;
      assert.equal(typeof adapter, "function");
      return fakeResult;
    },
    adapterFactory: ({ apiKey, transport }) => {
      adapterFactoryCalls += 1;
      assert.equal(apiKey, "synthetic-secret");
      assert.equal(typeof transport, "function");
      return async () => ({ scores: [] });
    },
    transportFactory: () => {
      transportFactoryCalls += 1;
      return async () => { throw new Error("fake transport must not be called by fake execution"); };
    },
    gitIdentity: () => ({ sourceCommit, worktreeClean: true }),
    env: { SILICONFLOW_API_KEY: "synthetic-secret" },
  });

  assert.equal(result.result, "completed");
  assert.equal(executeCalls, 1);
  assert.equal(adapterFactoryCalls, 1);
  assert.equal(transportFactoryCalls, 1);
  const started = JSON.parse(readFileSync(join(executionRoot, "execution-started.json"), "utf8"));
  assert.equal(started.execution_count_consumed, 1);

  await assert.rejects(
    () => runC1AQualificationCli([
      "execute-provider",
      "--root", "/synthetic/frozen",
      "--repo", "/synthetic/repo",
      "--manifest", manifestPath,
      "--packet", packetPath,
      "--execution-root", executionRoot,
    ], {
      prepareFromFrozen: () => ({ manifest, material: { cases: [] } }),
      executeQualification: async () => fakeResult,
      adapterFactory: () => async () => ({ scores: [] }),
      transportFactory: () => async () => ({ status: 200, body: "{}" }),
      gitIdentity: () => ({ sourceCommit, worktreeClean: true }),
      env: { SILICONFLOW_API_KEY: "synthetic-secret" },
    }),
    /C1A_EXECUTION_PACKET_ALREADY_CONSUMED/,
  );
});

test("C1-A CLI refuses to freeze a manifest from a dirty source tree", async () => {
  await assert.rejects(
    () => runC1AQualificationCli([
      "prepare",
      "--egress-decision", "ALLOW",
      "--output", "/tmp/unused-c1a-dirty-manifest.json",
    ], {
      prepareFromFrozen: () => { throw new Error("must not reach material preparation"); },
      gitIdentity: () => ({ sourceCommit, worktreeClean: false }),
    }),
    /C1A_PREPARE_SOURCE_WORKTREE_NOT_CLEAN/,
  );
});

test("C1-A CLI refuses to freeze a manifest without explicit ALLOW egress decision", async () => {
  await assert.rejects(
    () => runC1AQualificationCli([
      "prepare",
      "--egress-decision", "UNKNOWN",
      "--output", "/tmp/unused-c1a-manifest.json",
    ], {
      prepareFromFrozen: () => { throw new Error("must not reach material preparation"); },
    }),
    /C1A_PREPARE_EGRESS_ALLOW_REQUIRED/,
  );
});
