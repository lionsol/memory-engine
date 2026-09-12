import assert from "node:assert/strict";
import test from "node:test";

import { rerankCanonicalMemories } from "../lib/recall/rerank/canonical-rerank-orchestrator.js";
import { RERANK_STATUS } from "../lib/recall/rerank/relevance-reranker.js";

function memory(id, text, extra = {}) {
  return {
    memory_id: id,
    source: {
      record_type: "chunk",
      record_id: id,
      text,
    },
    ...extra,
  };
}

function input(memories, adapter, overrides = {}) {
  return {
    query: "what is relevant?",
    memories,
    maxCodePointsPerCandidate: 40,
    maxTotalCodePoints: 120,
    deadlineMs: 100,
    adapter,
    ...overrides,
  };
}

test("maps ordered IDs back to complete canonical memories and preserves metadata/input", async () => {
  const memories = [
    memory("full-canonical-id-a", "alpha", { category: "project", lifecycle: { archived: false } }),
    memory("full-canonical-id-b", "beta", { category: "episodic", lifecycle: { archived: false } }),
    memory("full-canonical-id-c", "gamma", { category: "preference", lifecycle: { archived: false } }),
  ];
  const before = structuredClone(memories);
  let adapterTexts;
  const result = await rerankCanonicalMemories(input(memories, async (_query, texts) => {
    adapterTexts = texts;
    return {
      scores: [
        { index: 0, score: 0.2 },
        { index: 1, score: 0.9 },
        { index: 2, score: 0.5 },
      ],
      identity: { provider: "fake", model: "rerank-test", revision: null },
      usage: { total_tokens: 9 },
    };
  }));

  assert.deepEqual(adapterTexts, ["alpha", "beta", "gamma"]);
  assert.deepEqual(result.orderedIds, [
    "full-canonical-id-b",
    "full-canonical-id-c",
    "full-canonical-id-a",
  ]);
  assert.deepEqual(result.memories, [memories[1], memories[2], memories[0]]);
  assert.deepEqual(result.memories.map(item => item.category), ["episodic", "preference", "project"]);
  assert.equal(new Set(result.memories.map(item => item.memory_id)).size, memories.length);
  assert.equal(result.status, RERANK_STATUS.APPLIED);
  assert.equal(result.reason, "complete");
  assert.deepEqual(result.scores, {
    "full-canonical-id-a": 0.2,
    "full-canonical-id-b": 0.9,
    "full-canonical-id-c": 0.5,
  });
  assert.deepEqual(result.usage, { total_tokens: 9 });
  assert.deepEqual(result.adapterIdentity, { provider: "fake", model: "rerank-test", revision: null });
  assert.deepEqual(result.projectionMetadata, [
    { id: "full-canonical-id-a", originalCodePoints: 5, outputCodePoints: 5, truncated: false },
    { id: "full-canonical-id-b", originalCodePoints: 4, outputCodePoints: 4, truncated: false },
    { id: "full-canonical-id-c", originalCodePoints: 5, outputCodePoints: 5, truncated: false },
  ]);
  assert.equal(result.totalCodePoints, 14);
  assert.equal(Number.isFinite(result.projectionElapsedMs), true);
  assert.deepEqual(memories, before);
});

test("always projects canonical source text and ignores caller-supplied projection-shaped data", async () => {
  let adapterTexts;
  const memories = [memory("canonical-id", "canonical source text")];
  const result = await rerankCanonicalMemories(input(memories, async (_query, texts) => {
    adapterTexts = texts;
    return {
      scores: [{ index: 0, score: 1 }],
      identity: { provider: "fake", model: "rerank-test", revision: null },
    };
  }, {
    projection: {
      candidates: [{ id: "canonical-id", text: "caller-controlled text" }],
      metadata: [],
      totalCodePoints: 0,
    },
  }));

  assert.deepEqual(adapterTexts, ["canonical source text"]);
  assert.deepEqual(result.orderedIds, ["canonical-id"]);
});

test("keeps empty-set, all-empty, and mixed-empty behavior from the components", async () => {
  let calls = 0;
  const adapter = async (_query, texts) => {
    calls += 1;
    return { scores: texts.map((_, index) => ({ index, score: index })) };
  };

  const empty = await rerankCanonicalMemories(input([], adapter));
  assert.equal(empty.status, RERANK_STATUS.BYPASSED);
  assert.equal(empty.reason, "empty_candidates");
  assert.deepEqual(empty.memories, []);

  const allEmptyMemories = [memory("empty-a", ""), memory("empty-b", "")];
  const allEmpty = await rerankCanonicalMemories(input(allEmptyMemories, adapter));
  assert.equal(allEmpty.status, RERANK_STATUS.BYPASSED);
  assert.equal(allEmpty.reason, "all_text_empty");
  assert.deepEqual(allEmpty.memories, allEmptyMemories);
  assert.deepEqual(allEmpty.scores, { "empty-a": null, "empty-b": null });

  const mixedMemories = [memory("empty", ""), memory("text-a", "a"), memory("text-b", "b")];
  const mixed = await rerankCanonicalMemories(input(mixedMemories, async (_query, texts) => {
    calls += 1;
    assert.deepEqual(texts, ["a", "b"]);
    return { scores: [{ index: 0, score: 0.1 }, { index: 1, score: 0.8 }] };
  }));
  assert.equal(mixed.status, RERANK_STATUS.APPLIED);
  assert.equal(mixed.reason, "mixed_empty_text");
  assert.deepEqual(mixed.orderedIds, ["text-b", "text-a", "empty"]);
  assert.deepEqual(mixed.memories, [mixedMemories[2], mixedMemories[1], mixedMemories[0]]);
  assert.deepEqual(mixed.scores, { empty: null, "text-a": 0.1, "text-b": 0.8 });
  assert.equal(calls, 1);
});

test("does not call adapter for malformed or over-budget input", async () => {
  let calls = 0;
  const adapter = async () => {
    calls += 1;
    return { scores: [] };
  };

  await assert.rejects(
    () => rerankCanonicalMemories(input([
      memory("good", "ok"),
      memory("bad", "wrong", { source: { record_type: "chunk", record_id: "other", text: "wrong" } }),
    ], adapter)),
    /source_record_id_must_match_memory_id/,
  );
  await assert.rejects(
    () => rerankCanonicalMemories(input(
      [memory("a", "1234"), memory("b", "5678")],
      adapter,
      { maxCodePointsPerCandidate: 4, maxTotalCodePoints: 7 },
    )),
    /total_code_points_exceeds_budget/,
  );
  assert.equal(calls, 0);
});

test("provider exception and incomplete response keep canonical order with null scores", async () => {
  const memories = [memory("id-a", "a"), memory("id-b", "b")];
  const thrown = await rerankCanonicalMemories(input(memories, async () => {
    throw new Error("fake adapter failure");
  }));
  assert.equal(thrown.status, RERANK_STATUS.FALLBACK);
  assert.equal(thrown.reason, "adapter_error");
  assert.deepEqual(thrown.memories, memories);
  assert.deepEqual(thrown.orderedIds, ["id-a", "id-b"]);
  assert.deepEqual(thrown.scores, { "id-a": null, "id-b": null });
  assert.equal(thrown.usage, null);

  const usage = { total_tokens: 4 };
  const incomplete = await rerankCanonicalMemories(input(memories, async () => ({
    scores: [{ index: 0, score: 0.9 }],
    usage,
  })));
  assert.equal(incomplete.status, RERANK_STATUS.FALLBACK);
  assert.equal(incomplete.reason, "invalid_response");
  assert.deepEqual(incomplete.memories, memories);
  assert.deepEqual(incomplete.scores, { "id-a": null, "id-b": null });
  assert.strictEqual(incomplete.usage, usage);
});

test("timeout ignores late adapter result and leaves returned canonical order unchanged", async () => {
  const memories = [memory("id-a", "a"), memory("id-b", "b")];
  let resolveLate;
  const late = new Promise(resolve => { resolveLate = resolve; });
  const result = await rerankCanonicalMemories(input(memories, async () => late, { deadlineMs: 10 }));

  assert.equal(result.status, RERANK_STATUS.FALLBACK);
  assert.equal(result.reason, "timeout");
  assert.deepEqual(result.memories, memories);
  assert.deepEqual(result.orderedIds, ["id-a", "id-b"]);
  assert.deepEqual(result.scores, { "id-a": null, "id-b": null });
  assert.equal(result.usage, null);

  resolveLate({ scores: [{ index: 0, score: 9 }, { index: 1, score: 1 }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(result.memories, memories);
  assert.deepEqual(result.orderedIds, ["id-a", "id-b"]);
  assert.deepEqual(result.scores, { "id-a": null, "id-b": null });
});
