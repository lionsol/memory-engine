import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRetrievalDiversitySummary,
  derivePathPrefix,
} from "../console/services/metrics-service.js";

const NOW_MS = Date.parse("2026-05-30T00:00:00Z");
const IN_WINDOW = "2026-05-29 12:00:00";
const OUT_WINDOW = "2026-05-01 12:00:00";

function candidateRow({
  id,
  traceId,
  rank,
  memoryId,
  category,
  sourceType,
  path,
  createdAt = IN_WINDOW,
} = {}) {
  const metadata = {};
  if (rank !== undefined) metadata.rank = rank;
  if (category !== undefined) metadata.category = category;
  if (sourceType !== undefined) metadata.source_type = sourceType;
  if (path !== undefined) metadata.path = path;
  return {
    id,
    event_type: "memory_candidate_retrieved",
    trace_id: traceId,
    session_id: "s1",
    memory_id: memoryId || `m-${id}`,
    metadata_json: JSON.stringify(metadata),
    created_at: createdAt,
  };
}

test("retrieval diversity: empty data returns zeroed summaries", () => {
  const summary = buildRetrievalDiversitySummary([], { windowDays: 7, topN: 10, nowMs: NOW_MS });
  for (const dim of [summary.category, summary.source_type, summary.path_prefix]) {
    assert.equal(dim.total, 0);
    assert.equal(dim.entropy, 0);
    assert.equal(dim.normalized_entropy, 0);
    assert.equal(dim.top1_share, 0);
    assert.equal(dim.distinct_count, 0);
    assert.deepEqual(dim.distribution, {});
  }
});

test("retrieval diversity: single category yields normalized_entropy=0 and top1_share=1", () => {
  const rows = [
    candidateRow({ id: 1, traceId: "t1", rank: 1, category: "episodic", sourceType: "managed" }),
    candidateRow({ id: 2, traceId: "t1", rank: 2, category: "episodic", sourceType: "managed" }),
  ];
  const summary = buildRetrievalDiversitySummary(rows, { windowDays: 7, topN: 10, nowMs: NOW_MS });
  assert.equal(summary.category.normalized_entropy, 0);
  assert.equal(summary.category.top1_share, 1);
});

test("retrieval diversity: uniform multi-category distribution yields normalized_entropy near 1", () => {
  const rows = [
    candidateRow({ id: 1, traceId: "t1", rank: 1, category: "a" }),
    candidateRow({ id: 2, traceId: "t1", rank: 2, category: "b" }),
    candidateRow({ id: 3, traceId: "t1", rank: 3, category: "c" }),
    candidateRow({ id: 4, traceId: "t1", rank: 4, category: "d" }),
  ];
  const summary = buildRetrievalDiversitySummary(rows, { windowDays: 7, topN: 10, nowMs: NOW_MS });
  assert.equal(summary.category.distinct_count, 4);
  assert.ok(summary.category.normalized_entropy >= 0.99);
});

test("retrieval diversity: non-uniform distribution computes top1_share correctly", () => {
  const rows = [
    candidateRow({ id: 1, traceId: "t1", rank: 1, category: "episodic" }),
    candidateRow({ id: 2, traceId: "t1", rank: 2, category: "episodic" }),
    candidateRow({ id: 3, traceId: "t2", rank: 1, category: "episodic" }),
    candidateRow({ id: 4, traceId: "t2", rank: 2, category: "project" }),
  ];
  const summary = buildRetrievalDiversitySummary(rows, { windowDays: 7, topN: 10, nowMs: NOW_MS });
  assert.equal(summary.category.total, 4);
  assert.equal(summary.category.top1_share, 0.75);
});

test("retrieval diversity: topN limits per recall event", () => {
  const rows = [
    candidateRow({ id: 1, traceId: "t1", rank: 1, category: "a" }),
    candidateRow({ id: 2, traceId: "t1", rank: 2, category: "b" }),
    candidateRow({ id: 3, traceId: "t1", rank: 3, category: "c" }),
    candidateRow({ id: 4, traceId: "t2", rank: 1, category: "a" }),
    candidateRow({ id: 5, traceId: "t2", rank: 2, category: "b" }),
    candidateRow({ id: 6, traceId: "t2", rank: 3, category: "c" }),
  ];
  const summary = buildRetrievalDiversitySummary(rows, { windowDays: 7, topN: 2, nowMs: NOW_MS });
  assert.equal(summary.recall_count, 2);
  assert.equal(summary.sampled_items_total, 4);
  assert.equal(summary.category.distribution.c ?? 0, 0);
});

test("retrieval diversity: windowDays excludes out-of-window events", () => {
  const rows = [
    candidateRow({ id: 1, traceId: "t1", rank: 1, category: "episodic", createdAt: IN_WINDOW }),
    candidateRow({ id: 2, traceId: "t2", rank: 1, category: "project", createdAt: OUT_WINDOW }),
  ];
  const summary = buildRetrievalDiversitySummary(rows, { windowDays: 7, topN: 10, nowMs: NOW_MS });
  assert.equal(summary.sampled_items_total, 1);
  assert.equal(summary.category.distribution.episodic, 1);
  assert.equal(summary.category.distribution.project, undefined);
});

test("retrieval diversity: missing fields fallback to unknown", () => {
  const rows = [
    {
      id: 1,
      event_type: "memory_candidate_retrieved",
      trace_id: "t1",
      session_id: "s1",
      memory_id: "m-1",
      metadata_json: "{}",
      created_at: IN_WINDOW,
    },
  ];
  const summary = buildRetrievalDiversitySummary(rows, { windowDays: 7, topN: 10, nowMs: NOW_MS });
  assert.equal(summary.category.distribution.unknown, 1);
  assert.equal(summary.source_type.distribution.unknown, 1);
  assert.equal(summary.path_prefix.distribution.unknown, 1);
});

test("path prefix rule maps paths by first two segments", () => {
  assert.equal(derivePathPrefix("memory/2026-05-28.md"), "memory/2026-05-28.md");
  assert.equal(derivePathPrefix("memory/projects/foo.md"), "memory/projects");
  assert.equal(derivePathPrefix("memory/dreaming/xxx.md"), "memory/dreaming");
  assert.equal(derivePathPrefix(""), "unknown");
});

