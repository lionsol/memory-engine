import test from "node:test";
import assert from "node:assert/strict";

import {
  proposeQ5B3DProductVisibleSwapV1,
} from "../lib/benchmark/q5-b3-product-visible-pair-set-feasibility-v1.js";

const config = Object.freeze({
  min_redundancy_gain: 0.10,
  min_score_gap: -0.05,
  max_candidate_rank: 5,
});

test("Q5-B3-D product-visible selector applies a bounded complementarity swap without gold", () => {
  const result = proposeQ5B3DProductVisibleSwapV1({
    query: "apple peach shape",
    servedTop3Ids: ["a", "b", "c"],
    candidates: [
      {
        id: "a",
        text: "apple round shared alpha beta red",
        rerank_score: 0.90,
        rerank_rank: 1,
      },
      {
        id: "b",
        text: "apple round shared alpha beta green",
        rerank_score: 0.89,
        rerank_rank: 2,
      },
      {
        id: "c",
        text: "watermelon unrelated context",
        rerank_score: 0.88,
        rerank_rank: 3,
      },
      {
        id: "d",
        text: "peach star distinct evidence",
        rerank_score: 0.86,
        rerank_rank: 4,
      },
    ],
    config,
  });

  assert.equal(result.applied, true);
  assert.equal(result.proposal.candidate_id, "d");
  assert.equal(["a", "b"].includes(result.proposal.displaced_id), true);
  assert.equal(result.proposal.incremental_query_terms >= 1, true);
  assert.equal(result.proposal.redundancy_gain >= config.min_redundancy_gain, true);
  assert.deepEqual(new Set(result.selected_ids).has("d"), true);
});

test("Q5-B3-D selector treats pools smaller than topK as no-op", () => {
  const result = proposeQ5B3DProductVisibleSwapV1({
    query: "apple peach",
    servedTop3Ids: ["a", "b"],
    candidates: [
      { id: "a", text: "apple", rerank_score: 0.9, rerank_rank: 1 },
      { id: "b", text: "peach", rerank_score: 0.8, rerank_rank: 2 },
    ],
    config,
  });

  assert.equal(result.applied, false);
  assert.equal(result.reason, "fewer_than_three_pool_candidates");
  assert.deepEqual(result.selected_ids, ["a", "b"]);
});

test("Q5-B3-D selector enforces score and rank guards", () => {
  const candidates = [
    {
      id: "a",
      text: "apple round shared alpha beta red",
      rerank_score: 0.90,
      rerank_rank: 1,
    },
    {
      id: "b",
      text: "apple round shared alpha alpha beta",
      rerank_score: 0.89,
      rerank_rank: 2,
    },
    {
      id: "c",
      text: "watermelon unrelated context",
      rerank_score: 0.88,
      rerank_rank: 3,
    },
    {
      id: "d",
      text: "peach star distinct evidence",
      rerank_score: 0.40,
      rerank_rank: 6,
    },
  ];

  const result = proposeQ5B3DProductVisibleSwapV1({
    query: "apple peach shape",
    servedTop3Ids: ["a", "b", "c"],
    candidates,
    config,
  });

  assert.equal(result.applied, false);
  assert.equal(result.reason, "no_product_visible_swap_passed_guards");
});
