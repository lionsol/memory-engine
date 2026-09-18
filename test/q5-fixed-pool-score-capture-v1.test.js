import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { R3_C1_B_PROVIDER_PROFILE } from "../lib/recall/hybrid/explicit-search-rerank-provider-policy.js";
import {
  Q5_FIXED_POOL_SCORE_CAPTURE_EXPECTED_CALL_COUNT,
  Q5_FIXED_POOL_SCORE_CAPTURE_EXPECTED_FIXTURE_SHA256,
  Q5_FIXED_POOL_SCORE_CAPTURE_RETRY_POLICY,
  buildQ5FixedPoolScoreCapturePreflightV1,
  runQ5FixedPoolScoreCaptureV1,
} from "../lib/benchmark/q5-fixed-pool-score-capture-v1.js";

const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/q5-fixed-candidate-q4-derived-v1.json", import.meta.url),
  "utf8",
));
const SOURCE = "e".repeat(40);

function fakeAdapterFactory({ model }) {
  assert.equal(model, R3_C1_B_PROVIDER_PROFILE.adapterIdentity.model);
  const adapter = async (_query, documents) => ({
    scores: documents.map((_text, index) => ({
      index,
      score: 1 - index / 100,
    })),
    usage: {
      input_tokens: documents.length * 10,
      output_tokens: null,
      total_tokens: documents.length * 10,
      billed_input_tokens: documents.length * 10,
      billed_output_tokens: null,
    },
  });
  Object.defineProperty(adapter, "adapterIdentity", {
    value: R3_C1_B_PROVIDER_PROFILE.adapterIdentity,
    enumerable: true,
  });
  return adapter;
}

test("Q5 score-capture preflight freezes the exact 40-case / 80-call transaction", () => {
  const result = buildQ5FixedPoolScoreCapturePreflightV1({
    fixture,
    sourceCommit: SOURCE,
    env: { SILICONFLOW_API_KEY: "sk-test-only" },
  });

  assert.equal(result.status, "PASS");
  assert.equal(result.mode, "PREFLIGHT_ONLY");
  assert.equal(result.fixture_sha256, Q5_FIXED_POOL_SCORE_CAPTURE_EXPECTED_FIXTURE_SHA256);
  assert.equal(result.case_count, 40);
  assert.equal(result.planned_provider_calls, 80);
  assert.equal(result.candidate_depth, 20);
  assert.equal(result.top_k, 3);
  assert.equal(result.model, "Qwen/Qwen3-Reranker-0.6B");
  assert.equal(result.retry_policy, Q5_FIXED_POOL_SCORE_CAPTURE_RETRY_POLICY);
  assert.equal(result.embedding_calls, 0);
  assert.equal(result.hint_producer_calls, 0);
  assert.equal(result.model_training_runs, 0);
  assert.equal(result.runtime_mutation, false);
});

test("Q5 score capture invokes exactly 80 reranks and emits only bounded A3 signals", async () => {
  let attempts = 0;
  const result = await runQ5FixedPoolScoreCaptureV1({
    fixture,
    sourceCommit: SOURCE,
    env: { SILICONFLOW_API_KEY: "sk-test-only" },
    adapterFactory: fakeAdapterFactory,
    onProviderAttempt: ({ attempt }) => {
      attempts = attempt;
    },
  });

  assert.equal(attempts, Q5_FIXED_POOL_SCORE_CAPTURE_EXPECTED_CALL_COUNT);
  assert.equal(result.provider_attempts, 80);
  assert.equal(result.provider_successes, 80);
  assert.equal(result.packet.cases.length, 80);
  assert.equal(result.packet.fixture_sha256, fixture.fixture_sha256);
  assert.equal(result.packet.source_commit, SOURCE);
  assert.equal(result.packet.contains_gold_fields, false);
  assert.equal(result.retry_policy, "NO_RETRY_NO_RESUME_NO_REPLAY");
  assert.equal(result.packet.cases.every(row => row.candidate_count > 0 && row.candidate_count <= 20), true);
  assert.equal(result.packet.cases.every(row => row.candidates.every(candidate => Number.isFinite(candidate.rerank_score))), true);
  assert.equal(result.provider_usage.input_tokens > 0, true);
  assert.equal(result.provider_usage.total_tokens > 0, true);

  const serialized = JSON.stringify(result.packet);
  assert.equal(serialized.includes("selection rationale:"), false);
  assert.equal(serialized.includes("remaining limitation:"), false);
  assert.equal(serialized.includes("gold_evidence_ids"), false);
  assert.equal(serialized.includes('"query":'), false);
  assert.equal(serialized.includes('"text":'), false);
});

test("Q5 score capture stops on first failed provider attempt and never retries", async () => {
  let calls = 0;
  const adapterFactory = () => {
    const adapter = async (_query, documents) => {
      calls += 1;
      if (calls === 7) throw Object.assign(new Error("synthetic failure"), { code: "SYNTHETIC_PROVIDER_FAILURE" });
      return {
        scores: documents.map((_text, index) => ({ index, score: 1 - index / 100 })),
        usage: null,
      };
    };
    Object.defineProperty(adapter, "adapterIdentity", {
      value: R3_C1_B_PROVIDER_PROFILE.adapterIdentity,
      enumerable: true,
    });
    return adapter;
  };

  await assert.rejects(
    () => runQ5FixedPoolScoreCaptureV1({
      fixture,
      sourceCommit: SOURCE,
      env: { SILICONFLOW_API_KEY: "sk-test-only" },
      adapterFactory,
    }),
    /Q5_A3_RERANK_RESULT_NOT_COMPLETE|SYNTHETIC_PROVIDER_FAILURE/,
  );
  assert.equal(calls, 7);
});

test("Q5 score capture rejects fixture/credential drift before any provider call", async () => {
  let calls = 0;
  const adapterFactory = () => {
    calls += 1;
    return fakeAdapterFactory({ model: R3_C1_B_PROVIDER_PROFILE.adapterIdentity.model });
  };

  const drifted = structuredClone(fixture);
  drifted.fixture_sha256 = "f".repeat(64);
  await assert.rejects(
    () => runQ5FixedPoolScoreCaptureV1({
      fixture: drifted,
      sourceCommit: SOURCE,
      env: { SILICONFLOW_API_KEY: "sk-test-only" },
      adapterFactory,
    }),
    /Q5_SCORE_CAPTURE_FIXTURE_SHA_DRIFT/,
  );
  assert.equal(calls, 0);

  await assert.rejects(
    () => runQ5FixedPoolScoreCaptureV1({
      fixture,
      sourceCommit: SOURCE,
      env: { SILICONFLOW_API_KEY: "wrong" },
      adapterFactory,
    }),
    /Q5_SCORE_CAPTURE_CREDENTIAL_FORMAT_INVALID/,
  );
  assert.equal(calls, 0);
});
