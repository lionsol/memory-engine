import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_RERANK_MAX_CANDIDATES,
  projectCanonicalRerankTexts,
} from "../lib/recall/rerank/canonical-text-projector.js";
import { RERANK_STATUS, rerankCandidates } from "../lib/recall/rerank/relevance-reranker.js";

function memory(id, text, overrides = {}) {
  return {
    memory_id: id,
    source: {
      record_type: "chunk",
      record_id: id,
      text,
      ...overrides.source,
    },
    ...overrides,
  };
}

function project(memories, overrides = {}) {
  return projectCanonicalRerankTexts({
    memories,
    maxCodePointsPerCandidate: 8,
    maxTotalCodePoints: 40,
    ...overrides,
  });
}

test("projects exact canonical source text in input order without enrichment or mutation", () => {
  const input = [
    memory("full-memory-id-α", "  exact text\nwith punctuation  "),
    memory("second-memory-id", "second"),
  ];
  const before = structuredClone(input);
  const result = project(input, { maxCodePointsPerCandidate: 100 });

  assert.deepEqual(result.candidates, [
    { id: "full-memory-id-α", text: "  exact text\nwith punctuation  " },
    { id: "second-memory-id", text: "second" },
  ]);
  assert.deepEqual(result.metadata, [
    {
      id: "full-memory-id-α",
      originalCodePoints: 31,
      outputCodePoints: 31,
      truncated: false,
    },
    {
      id: "second-memory-id",
      originalCodePoints: 6,
      outputCodePoints: 6,
      truncated: false,
    },
  ]);
  assert.equal(result.totalCodePoints, 37);
  assert.deepEqual(input, before);
});

test("truncates by Unicode code points, preserves strict empty text, and records metadata", () => {
  const result = project([
    memory("unicode", "😀a𝄞z"),
    memory("empty", ""),
  ], {
    maxCodePointsPerCandidate: 3,
    maxTotalCodePoints: 3,
  });

  assert.deepEqual(result.candidates, [
    { id: "unicode", text: "😀a𝄞" },
    { id: "empty", text: "" },
  ]);
  assert.deepEqual(result.metadata, [
    { id: "unicode", originalCodePoints: 4, outputCodePoints: 3, truncated: true },
    { id: "empty", originalCodePoints: 0, outputCodePoints: 0, truncated: false },
  ]);
  assert.equal(result.totalCodePoints, 3);
});

test("enforces 0..50 candidates and explicit bounded budgets", () => {
  const fifty = project(Array.from({ length: CANONICAL_RERANK_MAX_CANDIDATES }, (_, index) => (
    memory(`id-${index}`, "x")
  )), {
    maxCodePointsPerCandidate: 1,
    maxTotalCodePoints: 50,
  });
  assert.equal(fifty.candidates.length, 50);

  assert.throws(
    () => project(Array.from({ length: 51 }, (_, index) => memory(`id-${index}`, "x"))),
    /candidate_count_exceeds_50/,
  );
  assert.throws(
    () => project([memory("id", "x")], { maxCodePointsPerCandidate: undefined }),
    /max_code_points_per_candidate/,
  );
  assert.throws(
    () => project([memory("id", "x")], { maxTotalCodePoints: 0 }),
    /max_total_code_points/,
  );
  assert.throws(
    () => project([memory("id", "x")], { maxCodePointsPerCandidate: 8001 }),
    /max_code_points_per_candidate/,
  );
});

test("rejects duplicate, mismatched, and malformed canonical records as a whole", () => {
  const invalidCases = [
    [memory("same", "a"), memory("same", "b")],
    [memory("id", "a", { source: { record_id: "other" } })],
    [memory("id", "a", { source: { record_type: "session" } })],
    [{ memory_id: "id", source: { record_type: "chunk", record_id: "id" } }],
    [{ memory_id: "id", source: { record_type: "chunk", record_id: "id", text: 7 } }],
  ];

  for (const memories of invalidCases) {
    assert.throws(
      () => project(memories),
      /canonical_rerank_text_/,
    );
  }
});

test("rejects aggregate over-budget projection before fake adapter invocation", async () => {
  let calls = 0;
  const memories = [memory("first", "1234"), memory("second", "5678")];
  assert.throws(
    () => project(memories, { maxCodePointsPerCandidate: 4, maxTotalCodePoints: 7 }),
    /total_code_points_exceeds_budget/,
  );

  await assert.rejects(
    async () => {
      const projected = project(memories, { maxCodePointsPerCandidate: 4, maxTotalCodePoints: 7 });
      return rerankCandidates({
        query: "query",
        candidates: projected.candidates,
        deadlineMs: 100,
        adapter: async () => {
          calls += 1;
          return { scores: [] };
        },
      });
    },
    /total_code_points_exceeds_budget/,
  );
  assert.equal(calls, 0);
});

test("composes projected candidates with reranker and preserves local metadata", async () => {
  const projected = project([
    memory("complete-memory-id", "alpha"),
    memory("empty-memory-id", ""),
    memory("emoji-memory-id", "😀beta"),
  ], { maxCodePointsPerCandidate: 5, maxTotalCodePoints: 20 });
  let adapterInput;
  const result = await rerankCandidates({
    query: "query",
    candidates: projected.candidates,
    deadlineMs: 100,
    adapter: async (_query, texts) => {
      adapterInput = texts;
      return {
        scores: [{ index: 0, score: 0.1 }, { index: 1, score: 0.9 }],
        identity: "fake-projector-composition",
      };
    },
  });

  assert.deepEqual(adapterInput, ["alpha", "😀beta"]);
  assert.deepEqual(result.orderedIds, ["emoji-memory-id", "complete-memory-id", "empty-memory-id"]);
  assert.equal(result.status, RERANK_STATUS.APPLIED);
  assert.equal(result.reason, "mixed_empty_text");
  assert.deepEqual(result.scores, {
    "complete-memory-id": 0.1,
    "empty-memory-id": null,
    "emoji-memory-id": 0.9,
  });
  assert.deepEqual(projected.metadata, [
    { id: "complete-memory-id", originalCodePoints: 5, outputCodePoints: 5, truncated: false },
    { id: "empty-memory-id", originalCodePoints: 0, outputCodePoints: 0, truncated: false },
    { id: "emoji-memory-id", originalCodePoints: 5, outputCodePoints: 5, truncated: false },
  ]);
});

test("composed invalid adapter response keeps projected order and all scores null", async () => {
  const projected = project([memory("id-a", "a"), memory("id-b", "b")]);
  const result = await rerankCandidates({
    query: "query",
    candidates: projected.candidates,
    deadlineMs: 100,
    adapter: async () => ({
      scores: [{ index: 0, score: 0.7 }],
      usage: { total_tokens: 2 },
    }),
  });

  assert.equal(result.status, RERANK_STATUS.FALLBACK);
  assert.equal(result.reason, "invalid_response");
  assert.deepEqual(result.orderedIds, ["id-a", "id-b"]);
  assert.deepEqual(result.scores, { "id-a": null, "id-b": null });
  assert.deepEqual(result.usage, { total_tokens: 2 });
});
