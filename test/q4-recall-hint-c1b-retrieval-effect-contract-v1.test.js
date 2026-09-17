import test from "node:test";
import assert from "node:assert/strict";

import { buildQ4RecallHintC1FreshCorpusV1 } from "../lib/benchmark/q4-recall-hint-c1-corpus-v1.js";
import {
  Q4_C1B_DEVELOPMENT_PROVIDER_RESULT_SHA256,
  buildQ4RecallHintC1BDevelopmentHintsV1,
  summarizeQ4RecallHintC1BDevelopmentHintsV1,
} from "../lib/benchmark/q4-recall-hint-c1b-development-hints-v1.js";
import {
  Q4_C1B_RETRIEVAL_EFFECT_PROFILE,
  buildQ4RecallHintC1BRetrievalEffectContractV1,
} from "../lib/benchmark/q4-recall-hint-c1b-retrieval-effect-contract-v1.js";

const FROZEN_HINTS_SHA256 = "c6400bf9933271a48175b6a0be63533e71299b350fe6ba42ce04e69a2504c346";

function fixture() {
  const corpus = buildQ4RecallHintC1FreshCorpusV1();
  const hints = buildQ4RecallHintC1BDevelopmentHintsV1(corpus);
  const contract = buildQ4RecallHintC1BRetrievalEffectContractV1({ corpus, hintSnapshot: hints });
  return { corpus, hints, contract };
}

test("Q4-C1b freezes the real development Hint outputs without regenerating producer calls", () => {
  const { corpus, hints } = fixture();
  assert.equal(hints.provider_result_sha256, Q4_C1B_DEVELOPMENT_PROVIDER_RESULT_SHA256);
  assert.equal(hints.hints_sha256, FROZEN_HINTS_SHA256);
  assert.equal(hints.rows.length, 16);
  assert.deepEqual(summarizeQ4RecallHintC1BDevelopmentHintsV1(hints), {
    case_count: 16,
    expansion_query_count: 19,
    empty_hint_count: 4,
  });

  const caseById = new Map(corpus.cases.map(row => [row.case_id, row]));
  for (const row of hints.rows) {
    const source = caseById.get(row.case_id);
    assert.ok(source);
    assert.equal(row.family, source.family);
    if (row.family === "protection") {
      assert.deepEqual(row.hint, { version: "recall_hint_v1" });
      assert.equal(row.query_plan, null);
    } else {
      assert.equal(row.hint.project, source.bounded_context.active_project);
      assert.deepEqual(row.hint.entities, source.bounded_context.recent_entities);
      assert.ok(row.query_plan?.queries?.length >= 1);
      assert.ok(row.query_plan.queries.length <= 2);
    }
    if (row.family === "temporal_relation") {
      assert.equal(row.hint.time_relation.anchor, source.bounded_context.temporal_anchor);
    }
  }
});

test("Q4-C1b retrieval-effect contract is development-only and reuses frozen producer outputs", () => {
  const { contract } = fixture();
  assert.equal(contract.profile, Q4_C1B_RETRIEVAL_EFFECT_PROFILE);
  assert.equal(contract.scope, "development_only");
  assert.equal(contract.case_count, 16);
  assert.equal(contract.acceptance_case_count, 0);
  assert.equal(contract.candidate_depth, 20);
  assert.equal(contract.top_k, 3);
  assert.equal(contract.producer.provider_requests, 0);
  assert.equal(contract.producer.reuse_frozen_development_hints, true);
  assert.equal(contract.development_hints_sha256, FROZEN_HINTS_SHA256);
});

test("Q4-C1b semantic effect bounds 72 corpus + 16 original + 19 expansion embedding inputs", () => {
  const { contract } = fixture();
  assert.deepEqual(contract.embedding, {
    provider: "SiliconFlow",
    model: "Qwen/Qwen3-Embedding-4B",
    revision: "unavailable/unpinned",
    endpoint: "https://api.siliconflow.cn/v1/embeddings",
    dimension: 2560,
    canonical_projection_version: 1,
    canonical_vector_text_max_chars: 2000,
    shared_cache_required: true,
    corpus_embedding_inputs: 72,
    baseline_query_inputs: 16,
    hint_expansion_inputs: 19,
    max_provider_requests: 107,
    max_input_tokens_per_request: 32768,
    max_total_input_tokens: 3506176,
    deadline_ms: 15000,
    max_response_bytes: 524288,
  });
});

test("Q4-C1b semantic effect freezes the existing 0.6B rerank profile for both arms", () => {
  const { contract } = fixture();
  assert.deepEqual(contract.rerank, {
    provider: "siliconflow",
    model: "Qwen/Qwen3-Reranker-0.6B",
    revision: null,
    endpoint: "https://api.siliconflow.cn/v1/rerank",
    candidate_depth: 20,
    max_code_points_per_candidate: 4000,
    max_total_code_points: 48000,
    deadline_ms: 2500,
    baseline_max_requests: 16,
    hint_max_requests: 16,
    max_provider_requests: 32,
    max_pair_tokens: 12288,
    max_total_input_tokens: 7864320,
  });
});

test("Q4-C1b semantic effect permits only synthetic benchmark text/query egress and no live state", () => {
  const { contract } = fixture();
  assert.deepEqual(contract.egress.embedding_allow, [
    "synthetic_canonical_vector_projection_text",
    "development_original_query",
    "development_hint_expansion_query",
  ]);
  assert.deepEqual(contract.egress.rerank_allow, [
    "development_original_query",
    "bounded_canonical_candidate_text",
  ]);
  for (const denied of [
    "gold_evidence_ids",
    "case_labels",
    "acceptance_cases",
    "full_session",
    "tool_trace",
    "live_memory",
  ]) assert.equal(contract.egress.deny.includes(denied), true);
  assert.deepEqual(contract.mutation, {
    live_core: "DENY",
    live_engine: "DENY",
    live_lancedb: "DENY",
    runtime_config: "DENY",
    temporary_benchmark_artifacts: "ALLOW",
  });
});

test("Q4-C1b semantic effect freezes conservative USD prices and a hard cost cap", () => {
  const { contract } = fixture();
  assert.deepEqual(contract.cost_binding, {
    status: "FROZEN",
    billing_currency: "USD",
    embedding_price_usd_per_million_input_tokens: 0.02,
    rerank_price_usd_per_million_input_tokens: 0.01,
    embedding_max_input_tokens: 3506176,
    rerank_max_input_tokens: 7864320,
    embedding_cost_upper_bound_usd: 0.07012352,
    rerank_cost_upper_bound_usd: 0.0786432,
    theoretical_max_cost_usd: 0.14876672,
    max_cost_usd: 0.20,
    source: "SiliconFlow current model pages + project R3-C1 0.6B observed billing",
  });
  assert.equal(contract.cost_binding.theoretical_max_cost_usd < contract.cost_binding.max_cost_usd, true);
});

test("Q4-C1b retrieval-effect contract fails closed if the frozen Hint identity drifts", () => {
  const { corpus, hints } = fixture();
  const mutated = { ...hints, development_sha256: "0".repeat(64) };
  assert.throws(
    () => buildQ4RecallHintC1BRetrievalEffectContractV1({ corpus, hintSnapshot: mutated }),
    /Q4_C1B_RETRIEVAL_HINT_IDENTITY_MISMATCH/,
  );
});
