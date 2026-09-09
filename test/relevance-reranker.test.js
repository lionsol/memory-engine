import assert from "node:assert/strict";
import test from "node:test";

import {
  RERANK_MAX_CANDIDATES,
  RERANK_STATUS,
  rerankCandidates,
} from "../lib/recall/rerank/relevance-reranker.js";

function candidates(count, { empty = new Set() } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: `candidate-${index}`,
    text: empty.has(index) ? "" : `text-${index}`,
  }));
}

function completeAdapter(scores, options = {}) {
  return async (_query, texts, signal) => ({
    scores: scores.map((score, index) => ({ index, score })),
    identity: options.identity ?? "fake-adapter-v1",
    ...(options.usage === undefined ? {} : { usage: options.usage }),
    observed: { texts, aborted: signal.aborted },
  });
}

test("accepts 0 and 50 candidates, rejects 51 and duplicate IDs before adapter call", async () => {
  let calls = 0;
  const adapter = async () => {
    calls += 1;
    return { scores: [] };
  };

  const empty = await rerankCandidates({
    query: "query",
    candidates: [],
    deadlineMs: 100,
    adapter,
  });
  assert.equal(empty.status, RERANK_STATUS.BYPASSED);
  assert.deepEqual(empty.orderedIds, []);
  assert.equal(calls, 0);

  const fifty = await rerankCandidates({
    query: "query",
    candidates: candidates(RERANK_MAX_CANDIDATES),
    deadlineMs: 100,
    adapter: completeAdapter(Array.from({ length: 50 }, (_, index) => index)),
  });
  assert.equal(fifty.orderedIds.length, 50);

  await assert.rejects(
    () => rerankCandidates({
      query: "query",
      candidates: candidates(51),
      deadlineMs: 100,
      adapter,
    }),
    /rerank_candidate_count_exceeds_50/,
  );
  await assert.rejects(
    () => rerankCandidates({
      query: "query",
      candidates: [{ id: "same", text: "a" }, { id: "same", text: "b" }],
      deadlineMs: 100,
      adapter,
    }),
    /rerank_candidate_ids_must_be_unique/,
  );
  assert.equal(calls, 0);
});

test("does not mutate candidates and keeps stable score ties", async () => {
  const input = candidates(4);
  const before = structuredClone(input);
  const result = await rerankCandidates({
    query: "query",
    candidates: input,
    deadlineMs: 100,
    adapter: completeAdapter([0.5, 0.9, 0.9, 0.1]),
  });

  assert.deepEqual(input, before);
  assert.deepEqual(result.orderedIds, ["candidate-1", "candidate-2", "candidate-0", "candidate-3"]);
  assert.deepEqual(result.scores, {
    "candidate-0": 0.5,
    "candidate-1": 0.9,
    "candidate-2": 0.9,
    "candidate-3": 0.1,
  });
  assert.equal(result.status, RERANK_STATUS.APPLIED);
  assert.equal(result.reason, "complete");
});

test("submits only non-empty text and appends empty-text candidates", async () => {
  let submittedTexts;
  const result = await rerankCandidates({
    query: "query",
    candidates: candidates(4, { empty: new Set([1, 3]) }),
    deadlineMs: 100,
    adapter: async (_query, texts) => {
      submittedTexts = texts;
      return { scores: [{ index: 0, score: 0.1 }, { index: 1, score: 0.9 }] };
    },
  });

  assert.deepEqual(submittedTexts, ["text-0", "text-2"]);
  assert.deepEqual(result.orderedIds, ["candidate-2", "candidate-0", "candidate-1", "candidate-3"]);
  assert.deepEqual(result.scores, {
    "candidate-0": 0.1,
    "candidate-1": null,
    "candidate-2": 0.9,
    "candidate-3": null,
  });
  assert.equal(result.reason, "mixed_empty_text");
});

test("bypasses all-empty candidates without calling adapter", async () => {
  let calls = 0;
  const result = await rerankCandidates({
    query: "query",
    candidates: [{ id: "a", text: "" }, { id: "b", text: "" }],
    deadlineMs: 100,
    adapter: async () => {
      calls += 1;
      return { scores: [] };
    },
  });

  assert.equal(calls, 0);
  assert.equal(result.status, RERANK_STATUS.BYPASSED);
  assert.equal(result.reason, "all_text_empty");
  assert.deepEqual(result.orderedIds, ["a", "b"]);
  assert.deepEqual(result.scores, { a: null, b: null });
});

test("requires a complete unique in-range finite score set", async () => {
  const invalidResponses = [
    [{ index: 0, score: 1 }],
    [{ index: 0, score: 1 }, { index: 0, score: 2 }],
    [{ index: 0, score: 1 }, { index: 2, score: 2 }],
    [{ index: 0, score: Number.NaN }, { index: 1, score: 2 }],
  ];

  for (const scores of invalidResponses) {
    const result = await rerankCandidates({
      query: "query",
      candidates: candidates(2),
      deadlineMs: 100,
      adapter: async () => ({ scores }),
    });
    assert.equal(result.status, RERANK_STATUS.FALLBACK);
    assert.equal(result.reason, "invalid_response");
    assert.deepEqual(result.orderedIds, ["candidate-0", "candidate-1"]);
    assert.deepEqual(result.scores, { "candidate-0": null, "candidate-1": null });
  }
});

test("provider errors fall back without retry or partial scores", async () => {
  let calls = 0;
  const result = await rerankCandidates({
    query: "query",
    candidates: candidates(2),
    deadlineMs: 100,
    adapter: async () => {
      calls += 1;
      throw new Error("fake provider failure");
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.status, RERANK_STATUS.FALLBACK);
  assert.equal(result.reason, "adapter_error");
  assert.deepEqual(result.orderedIds, ["candidate-0", "candidate-1"]);
  assert.deepEqual(result.scores, { "candidate-0": null, "candidate-1": null });
});

test("deadline returns despite an adapter that ignores abort, and late success cannot change result", async () => {
  let resolveLate;
  let signalAtReturn;
  const late = new Promise(resolve => { resolveLate = resolve; });
  const result = await rerankCandidates({
    query: "query",
    candidates: candidates(2),
    deadlineMs: 10,
    adapter: async (_query, _texts, signal) => {
      signalAtReturn = signal;
      return late;
    },
  });

  assert.equal(result.status, RERANK_STATUS.FALLBACK);
  assert.equal(result.reason, "timeout");
  assert.equal(signalAtReturn.aborted, true);
  assert.deepEqual(result.scores, { "candidate-0": null, "candidate-1": null });

  resolveLate({ scores: [{ index: 0, score: 9 }, { index: 1, score: 8 }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(result.orderedIds, ["candidate-0", "candidate-1"]);
  assert.deepEqual(result.scores, { "candidate-0": null, "candidate-1": null });
});

test("late adapter failure after timeout is consumed without an unhandled rejection", async () => {
  let rejectLate;
  const late = new Promise((_resolve, reject) => { rejectLate = reject; });
  const result = await rerankCandidates({
    query: "query",
    candidates: [{ id: "a", text: "text" }],
    deadlineMs: 10,
    adapter: async () => late,
  });

  assert.equal(result.reason, "timeout");
  rejectLate(new Error("late fake failure"));
  await new Promise(resolve => setImmediate(resolve));
});

test("missing usage remains unknown and adapter identity is preserved", async () => {
  const result = await rerankCandidates({
    query: "query",
    candidates: [{ id: "a", text: "text" }],
    deadlineMs: 100,
    adapter: completeAdapter([0.7], { identity: { provider: "fake", model: "test", revision: null } }),
  });

  assert.deepEqual(result.adapterIdentity, { provider: "fake", model: "test", revision: null });
  assert.equal(result.usage, null);
});

test("invalid input is rejected before adapter invocation", async () => {
  let calls = 0;
  const adapter = async () => {
    calls += 1;
    return { scores: [] };
  };
  const cases = [
    { query: "", candidates: [], deadlineMs: 100 },
    { query: "query", candidates: [{ id: "", text: "x" }], deadlineMs: 100 },
    { query: "query", candidates: [{ id: "a", text: 1 }], deadlineMs: 100 },
    { query: "query", candidates: [], deadlineMs: 0 },
  ];

  for (const input of cases) {
    await assert.rejects(() => rerankCandidates({ ...input, adapter }));
  }
  assert.equal(calls, 0);
});
