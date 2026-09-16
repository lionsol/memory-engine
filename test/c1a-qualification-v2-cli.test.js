import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  prepareC1AV2FromFrozen,
  runC1AV2QualificationCli,
} from "../bin/run-c1a-qualification-v2.mjs";
import { buildC1AQualificationManifest } from "../lib/benchmark/c1a-qualification-manifest.js";
import {
  buildC1AV2QualificationManifest,
  C1A_V2_ACCEPTANCE_THRESHOLDS,
} from "../lib/benchmark/c1a-qualification-v2-contract.js";

const sourceCommit = "b".repeat(40);

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeCase(caseId, { control = 0, evidenceCount = 2, complete = true, category = 2 } = {}) {
  const candidates = [
    { id: `${caseId}-a`, text: `alpha-${caseId}`, egress: "ALLOW" },
    { id: `${caseId}-b`, text: `beta-${caseId}`, egress: "ALLOW" },
    { id: `${caseId}-c`, text: `gamma-${caseId}`, egress: "ALLOW" },
  ];
  return {
    case_id: caseId,
    query: `query-${caseId}`,
    query_egress: "ALLOW",
    candidates,
    control_order: candidates.map(item => item.id),
    control_top3: candidates.map(item => item.id),
    control_recall_all_at_3: control,
    gold_evidence_count: evidenceCount,
    gold_complete_in_top20: complete,
    category,
  };
}

function fixture() {
  const cases = [
    ...Array.from({ length: 250 }, (_, i) => makeCase(`p-${i}`, { control: 1, category: i % 5 === 0 ? 5 : 2 })),
    ...Array.from({ length: 250 }, (_, i) => makeCase(`r-${i}`, { complete: true })),
    ...Array.from({ length: 250 }, (_, i) => makeCase(`m-${i}`, { complete: false, category: 4 })),
    ...Array.from({ length: 250 }, (_, i) => makeCase(`b-${i}`, { evidenceCount: 4, category: 3 })),
  ];
  const eligibilityByCase = Object.fromEntries(cases.map(item => [item.case_id, true]));
  const observedManifest = buildC1AQualificationManifest({
    cases,
    eligibilityByCase,
    expectedSourceCaseCount: cases.length,
    primaryCount: 256,
    diagnosticQuotas: { protect: 20, recoverable_rank_miss: 20, candidate_miss: 12, top3_budget_infeasible: 12 },
    sentinelCount: 8,
  });
  const manifest = buildC1AV2QualificationManifest({
    cases,
    eligibilityByCase,
    observedManifest,
    expectedSourceCaseCount: cases.length,
    profile: {
      candidateDepth: 20,
      topK: 3,
      maxCodePointsPerCandidate: 4000,
      maxTotalCodePoints: 48000,
      deadlineMs: 5000,
      provider: {
        provider: "siliconflow",
        model: "Qwen/Qwen3-Reranker-0.6B",
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
      acceptance_thresholds: { ...C1A_V2_ACCEPTANCE_THRESHOLDS },
    },
    sourceIdentity: {
      qualification_source: { source_commit: sourceCommit, worktree_clean: true },
      egress_decision: "ALLOW",
    },
  });
  return { observedManifest, manifest };
}

const cleanIdentity = () => ({ sourceCommit, worktreeClean: true });

test("C1-A v2 prepare helper defaults to the exact frozen M2 prior manifest", () => {
  assert.throws(
    () => prepareC1AV2FromFrozen({
      frozenRoot: "/synthetic/frozen",
      repositoryRoot: "/synthetic/repo",
      observedManifest: { manifest_sha256: "f".repeat(64) },
      egressDecision: "ALLOW",
      loadFrozen: () => { throw new Error("must fail before loading frozen inputs"); },
    }),
    /C1A_V2_PREPARE_PRIOR_MANIFEST_NOT_FROZEN_M2/,
  );
});

test("C1-A v2 CLI prepare is zero-provider and binds the explicit observed manifest", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-c1a-v2-prepare-"));
  const observedPath = join(root, "observed.json");
  const outputPath = join(root, "manifest.json");
  const { observedManifest, manifest } = fixture();
  writeJson(observedPath, observedManifest);
  let prepareCalls = 0;
  let seenObservedHash = null;

  const result = await runC1AV2QualificationCli([
    "prepare",
    "--root", "/synthetic/frozen",
    "--repo", "/synthetic/repo",
    "--observed-manifest", observedPath,
    "--egress-decision", "ALLOW",
    "--output", outputPath,
  ], {
    prepareFromFrozen: ({ observedManifest: observed, egressDecision, qualificationSourceIdentity }) => {
      prepareCalls += 1;
      seenObservedHash = observed.manifest_sha256;
      assert.equal(egressDecision, "ALLOW");
      assert.deepEqual(qualificationSourceIdentity, { source_commit: sourceCommit, worktree_clean: true });
      return { manifest };
    },
    gitIdentity: cleanIdentity,
    expectedPriorObservedManifestSha256: observedManifest.manifest_sha256,
  });

  assert.equal(result.provider_calls, 0);
  assert.equal(prepareCalls, 1);
  assert.equal(seenObservedHash, observedManifest.manifest_sha256);
  assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), manifest);
});

test("C1-A v2 CLI prepare requires clean source and explicit ALLOW", async () => {
  const { observedManifest } = fixture();
  const root = mkdtempSync(join(tmpdir(), "memory-engine-c1a-v2-prepare-deny-"));
  const observedPath = join(root, "observed.json");
  writeJson(observedPath, observedManifest);

  await assert.rejects(
    () => runC1AV2QualificationCli([
      "prepare",
      "--observed-manifest", observedPath,
      "--egress-decision", "UNKNOWN",
      "--output", join(root, "unused.json"),
    ], {
      prepareFromFrozen: () => { throw new Error("must not prepare"); },
      gitIdentity: cleanIdentity,
    }),
    /C1A_V2_PREPARE_EGRESS_ALLOW_REQUIRED/,
  );

  await assert.rejects(
    () => runC1AV2QualificationCli([
      "prepare",
      "--observed-manifest", observedPath,
      "--egress-decision", "ALLOW",
      "--output", join(root, "unused-dirty.json"),
    ], {
      prepareFromFrozen: () => { throw new Error("must not prepare"); },
      gitIdentity: () => ({ sourceCommit, worktreeClean: false }),
    }),
    /C1A_V2_PREPARE_SOURCE_WORKTREE_NOT_CLEAN/,
  );
});

test("C1-A v2 CLI freeze-packet and validate are zero-provider exact-binding operations", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-engine-c1a-v2-packet-"));
  const manifestPath = join(root, "manifest.json");
  const packetPath = join(root, "packet.json");
  const executionRoot = join(root, "execution");
  const { manifest } = fixture();
  writeJson(manifestPath, manifest);

  const frozen = await runC1AV2QualificationCli([
    "freeze-packet",
    "--repo", "/synthetic/repo",
    "--manifest", manifestPath,
    "--execution-root", executionRoot,
    "--max-cost-usd", "1",
    "--input-price-usd-per-million", "0.01",
    "--pacing-min-interval-ms", "1000",
    "--pacing-token-window-ms", "60000",
    "--pacing-max-estimated-tokens-per-window", "400000",
    "--rate-limit-source", "synthetic-current-rate-limit",
    "--api-key-env", "SILICONFLOW_API_KEY",
    "--packet-output", packetPath,
  ], {
    gitIdentity: cleanIdentity,
    expectedPriorObservedManifestSha256: manifest.prior_observed_manifest_sha256,
  });

  assert.equal(frozen.provider_calls, 0);
  assert.equal(frozen.max_provider_requests, 336);
  const packet = JSON.parse(readFileSync(packetPath, "utf8"));
  assert.equal(packet.model, "Qwen/Qwen3-Reranker-0.6B");
  assert.equal(packet.max_provider_requests, 336);
  assert.equal(packet.input_price_usd_per_million, 0.01);
  assert.equal(packet.rate_limits.source, "synthetic-current-rate-limit");

  const validated = await runC1AV2QualificationCli([
    "validate",
    "--repo", "/synthetic/repo",
    "--manifest", manifestPath,
    "--packet", packetPath,
    "--execution-root", executionRoot,
  ], {
    gitIdentity: cleanIdentity,
    expectedPriorObservedManifestSha256: manifest.prior_observed_manifest_sha256,
  });

  assert.equal(validated.provider_calls, 0);
  assert.equal(validated.valid, true);
  assert.equal(validated.max_provider_requests, 336);
  assert.equal(validated.model, "Qwen/Qwen3-Reranker-0.6B");
});

test("C1-A v2 operator intentionally exposes no execute-provider command", async () => {
  await assert.rejects(
    () => runC1AV2QualificationCli(["execute-provider"], { gitIdentity: cleanIdentity }),
    /C1A_V2_CLI_COMMAND_INVALID/,
  );
});
