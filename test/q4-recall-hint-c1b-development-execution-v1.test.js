import test from "node:test";
import assert from "node:assert/strict";

import { buildQ4RecallHintC1FreshCorpusV1 } from "../lib/benchmark/q4-recall-hint-c1-corpus-v1.js";
import { buildQ4RecallHintC1ManifestV1 } from "../lib/benchmark/q4-recall-hint-c1-manifest-v1.js";
import {
  Q4_C1B_DEVELOPMENT_MAX_COST,
  Q4_C1B_DEVELOPMENT_MAX_REQUESTS,
  buildQ4RecallHintC1BDevelopmentAuthorizationV1,
  runQ4RecallHintC1BDevelopmentV1,
  validateQ4RecallHintC1BDevelopmentUsageV1,
} from "../lib/benchmark/q4-recall-hint-c1b-development-execution-v1.js";
import { buildQ4RecallHintC1BSiliconFlowPacketV1 } from "../lib/benchmark/q4-recall-hint-c1b-siliconflow-v4flash-v1.js";

function fixture() {
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  const manifest = buildQ4RecallHintC1ManifestV1(corpus);
  const sourceCommit = "q4-development-source-fixture";
  const packet = buildQ4RecallHintC1BSiliconFlowPacketV1({ manifest, sourceCommit });
  return { corpus, manifest, sourceCommit, packet };
}

function fakeHintTransport(counter) {
  return async ({ request, provider, model, endpoint }) => {
    counter.calls += 1;
    assert.equal(provider, "SiliconFlow");
    assert.equal(model, "deepseek-ai/DeepSeek-V4-Flash");
    assert.equal(endpoint, "https://api.siliconflow.cn/v1/chat/completions");
    assert.equal(typeof request.prompt, "string");
    const projectMatch = request.prompt.match(/"active_project":"([^"]+)"/u);
    const project = projectMatch?.[1] || null;
    return {
      text: project
        ? JSON.stringify({ version: "recall_hint_v1", project, entities: [project] })
        : JSON.stringify({ version: "recall_hint_v1" }),
      usage: { input_tokens: 120, output_tokens: 24 },
    };
  };
}

test("Q4-C1b development authorization is strictly 16 calls with zero acceptance authority", () => {
  const { manifest, sourceCommit, packet } = fixture();
  const authorization = buildQ4RecallHintC1BDevelopmentAuthorizationV1({ packet, manifest, sourceCommit });
  assert.equal(authorization.max_provider_requests, 16);
  assert.equal(authorization.max_acceptance_requests, 0);
  assert.equal(authorization.max_input_tokens, 32_768);
  assert.equal(authorization.max_output_tokens, 4_096);
  assert.equal(authorization.max_cost, 0.15);
  assert.equal(authorization.billing_currency, "CNY");
  assert.equal(authorization.acceptance_authorized, false);
  assert.equal(authorization.development_case_ids.length, 16);
});

test("Q4-C1b development runner executes exactly the frozen 16 development cases", async () => {
  const { corpus, manifest, sourceCommit, packet } = fixture();
  const counter = { calls: 0 };
  const result = await runQ4RecallHintC1BDevelopmentV1({
    corpus,
    manifest,
    packet,
    sourceCommit,
    transport: fakeHintTransport(counter),
  });
  assert.equal(counter.calls, Q4_C1B_DEVELOPMENT_MAX_REQUESTS);
  assert.equal(result.progress.status, "PASS");
  assert.equal(result.progress.completed.length, 16);
  assert.equal(result.progress.usage.provider_requests, 16);
  assert.equal(result.progress.usage.input_tokens, 1_920);
  assert.equal(result.progress.usage.output_tokens, 384);
  assert.equal(result.progress.usage.billing_currency, "CNY");
  assert.equal(result.progress.usage.cost < Q4_C1B_DEVELOPMENT_MAX_COST, true);
  assert.equal(result.progress.summary.valid_hint_count, 16);
  assert.equal(result.progress.summary.expansion_query_count <= 32, true);
  assert.equal(new Set(result.progress.completed.map(row => row.case_id)).size, 16);
});

test("Q4-C1b development runner resumes without reissuing completed provider calls", async () => {
  const { corpus, manifest, sourceCommit, packet } = fixture();
  const counter = { calls: 0 };
  let checkpoint = null;
  await assert.rejects(
    runQ4RecallHintC1BDevelopmentV1({
      corpus,
      manifest,
      packet,
      sourceCommit,
      transport: fakeHintTransport(counter),
      onProgress: async progress => {
        checkpoint = progress;
        if (progress.completed.length === 5) throw new Error("synthetic_interrupt");
      },
    }),
    /synthetic_interrupt/,
  );
  assert.equal(counter.calls, 5);
  assert.equal(checkpoint.completed.length, 5);

  const resumed = await runQ4RecallHintC1BDevelopmentV1({
    corpus,
    manifest,
    packet,
    sourceCommit,
    transport: fakeHintTransport(counter),
    existingProgress: checkpoint,
  });
  assert.equal(counter.calls, 16);
  assert.equal(resumed.progress.completed.length, 16);
  assert.equal(resumed.progress.usage.provider_requests, 16);
});

test("Q4-C1b development resume stops on ambiguous inflight case instead of reissuing", async () => {
  const { corpus, manifest, sourceCommit, packet } = fixture();
  let ambiguous = null;
  await assert.rejects(
    runQ4RecallHintC1BDevelopmentV1({
      corpus,
      manifest,
      packet,
      sourceCommit,
      transport: fakeHintTransport({ calls: 0 }),
      onProgress: async progress => {
        if (progress.inflight_case_id && progress.completed.length === 0) {
          ambiguous = progress;
          throw new Error("synthetic_pre_request_interrupt");
        }
      },
    }),
    /synthetic_pre_request_interrupt/,
  );
  assert.equal(typeof ambiguous.inflight_case_id, "string");
  await assert.rejects(
    runQ4RecallHintC1BDevelopmentV1({
      corpus,
      manifest,
      packet,
      sourceCommit,
      transport: fakeHintTransport({ calls: 0 }),
      existingProgress: ambiguous,
    }),
    /Q4_C1B_DEV_PROGRESS_INFLIGHT_AMBIGUOUS/,
  );
});

test("Q4-C1b development budget rejects over-cap progress and wrong currency", () => {
  assert.throws(() => validateQ4RecallHintC1BDevelopmentUsageV1({
    providerRequests: 17,
    inputTokens: 1,
    outputTokens: 1,
    cost: 0.01,
    billingCurrency: "CNY",
  }), /Q4_C1B_DEV_BUDGET_EXCEEDED/);
  assert.throws(() => validateQ4RecallHintC1BDevelopmentUsageV1({
    providerRequests: 1,
    inputTokens: 1,
    outputTokens: 1,
    cost: 0.01,
    billingCurrency: "USD",
  }), /Q4_C1B_DEV_CURRENCY_MISMATCH/);
});
