import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRecallMissAfterResponseSummary,
  resolveMemoryReferenceId,
} from "../console/services/metrics-service.js";

const NOW_MS = Date.parse("2026-05-30T00:00:00Z");
const IN_WINDOW = "2026-05-29 12:00:00";
const OUT_WINDOW = "2026-05-01 12:00:00";

function candidateRow({
  id,
  traceId,
  rank,
  memoryId,
  chunkId,
  path,
  category,
  sourceType,
  createdAt = IN_WINDOW,
} = {}) {
  const metadata = {};
  if (rank !== undefined) metadata.rank = rank;
  if (chunkId !== undefined) metadata.chunk_id = chunkId;
  if (path !== undefined) metadata.path = path;
  if (category !== undefined) metadata.category = category;
  if (sourceType !== undefined) metadata.source_type = sourceType;
  return {
    id,
    event_type: "memory_candidate_retrieved",
    trace_id: traceId,
    session_id: "s1",
    memory_id: memoryId,
    metadata_json: JSON.stringify(metadata),
    created_at: createdAt,
  };
}

function injectedRow({
  id,
  traceId,
  memoryId,
  chunkId,
  path,
  createdAt = IN_WINDOW,
} = {}) {
  const metadata = {};
  if (chunkId !== undefined) metadata.chunk_id = chunkId;
  if (path !== undefined) metadata.path = path;
  return {
    id,
    event_type: "memory_injected",
    trace_id: traceId,
    session_id: "s1",
    memory_id: memoryId,
    metadata_json: JSON.stringify(metadata),
    created_at: createdAt,
  };
}

test("recall miss: empty data returns zeros", () => {
  const summary = buildRecallMissAfterResponseSummary([], { windowDays: 7, topN: 10, nowMs: NOW_MS });
  assert.equal(summary.total_recall_opportunities, 0);
  assert.equal(summary.miss_count, 0);
  assert.equal(summary.miss_rate, 0);
  assert.deepEqual(summary.top_missed_memories, []);
});

test("recall miss: all injected yields miss_count=0 miss_rate=0", () => {
  const rows = [
    candidateRow({ id: 1, traceId: "t1", rank: 1, memoryId: "m1" }),
    candidateRow({ id: 2, traceId: "t1", rank: 2, memoryId: "m2" }),
    injectedRow({ id: 3, traceId: "t1", memoryId: "m1" }),
    injectedRow({ id: 4, traceId: "t1", memoryId: "m2" }),
  ];
  const summary = buildRecallMissAfterResponseSummary(rows, { windowDays: 7, topN: 10, nowMs: NOW_MS });
  assert.equal(summary.total_recall_opportunities, 2);
  assert.equal(summary.miss_count, 0);
  assert.equal(summary.miss_rate, 0);
});

test("recall miss: partial miss with topN and windowDays applied", () => {
  const rows = [
    candidateRow({ id: 1, traceId: "t1", rank: 1, memoryId: "m1" }),
    candidateRow({ id: 2, traceId: "t1", rank: 2, memoryId: "m2" }),
    candidateRow({ id: 3, traceId: "t1", rank: 3, memoryId: "m3" }),
    injectedRow({ id: 4, traceId: "t1", memoryId: "m1" }),
    candidateRow({ id: 5, traceId: "t2", rank: 1, memoryId: "old", createdAt: OUT_WINDOW }),
  ];
  const summary = buildRecallMissAfterResponseSummary(rows, { windowDays: 7, topN: 2, nowMs: NOW_MS });
  assert.equal(summary.total_recall_opportunities, 2);
  assert.equal(summary.miss_count, 1);
  assert.equal(summary.miss_rate, 0.5);
  assert.equal(summary.top_missed_memories[0]?.id, "m2");
});

test("recall miss: all missed yields miss_rate=1", () => {
  const rows = [
    candidateRow({ id: 1, traceId: "t1", rank: 1, memoryId: "m1" }),
    candidateRow({ id: 2, traceId: "t1", rank: 2, memoryId: "m2" }),
  ];
  const summary = buildRecallMissAfterResponseSummary(rows, { windowDays: 7, topN: 10, nowMs: NOW_MS });
  assert.equal(summary.total_recall_opportunities, 2);
  assert.equal(summary.miss_count, 2);
  assert.equal(summary.miss_rate, 1);
});

test("recall miss: windowDays excludes out-of-window records", () => {
  const rows = [
    candidateRow({ id: 1, traceId: "t1", rank: 1, memoryId: "m1", createdAt: OUT_WINDOW }),
    injectedRow({ id: 2, traceId: "t1", memoryId: "m1", createdAt: OUT_WINDOW }),
    candidateRow({ id: 3, traceId: "t2", rank: 1, memoryId: "m2", createdAt: IN_WINDOW }),
  ];
  const summary = buildRecallMissAfterResponseSummary(rows, { windowDays: 7, topN: 10, nowMs: NOW_MS });
  assert.equal(summary.total_recall_opportunities, 1);
  assert.equal(summary.miss_count, 1);
});

test("recall miss: topN applies per recall", () => {
  const rows = [
    candidateRow({ id: 1, traceId: "t1", rank: 1, memoryId: "m1" }),
    candidateRow({ id: 2, traceId: "t1", rank: 2, memoryId: "m2" }),
    candidateRow({ id: 3, traceId: "t1", rank: 3, memoryId: "m3" }),
    injectedRow({ id: 4, traceId: "t1", memoryId: "m1" }),
  ];
  const summary = buildRecallMissAfterResponseSummary(rows, { windowDays: 7, topN: 2, nowMs: NOW_MS });
  assert.equal(summary.total_recall_opportunities, 2);
  assert.equal(summary.miss_count, 1);
  assert.equal(summary.top_missed_memories.some(item => item.id === "m3"), false);
});

test("recall miss: fallback order memory_id -> chunk_id -> path -> unknown", () => {
  assert.equal(resolveMemoryReferenceId({ memory_id: "m1" }, { chunk_id: "c1", path: "memory/a.md" }), "m1");
  assert.equal(resolveMemoryReferenceId({ memory_id: "" }, { chunk_id: "c1", path: "memory/a.md" }), "c1");
  assert.equal(resolveMemoryReferenceId({ memory_id: "" }, { chunk_id: "", path: "memory/a.md" }), "memory/a.md");
  assert.equal(resolveMemoryReferenceId({ memory_id: "" }, { chunk_id: "", path: "" }), "unknown");
});

test("recall miss: top missed memories sorted by count desc", () => {
  const rows = [
    candidateRow({ id: 1, traceId: "t1", rank: 1, memoryId: "mA", category: "episodic", sourceType: "managed", path: "memory/episodes/a.md" }),
    candidateRow({ id: 2, traceId: "t1", rank: 2, memoryId: "mB", category: "project", sourceType: "managed", path: "memory/projects/p1.md" }),
    candidateRow({ id: 3, traceId: "t2", rank: 1, memoryId: "mA", category: "episodic", sourceType: "managed", path: "memory/episodes/a.md" }),
    candidateRow({ id: 4, traceId: "t2", rank: 2, memoryId: "mC", category: "raw_log", sourceType: "managed", path: "memory/smart-add/2026-05-29.md" }),
    candidateRow({ id: 5, traceId: "t3", rank: 1, memoryId: "mA", category: "episodic", sourceType: "managed", path: "memory/episodes/a.md" }),
  ];
  const summary = buildRecallMissAfterResponseSummary(rows, { windowDays: 7, topN: 2, nowMs: NOW_MS });
  assert.equal(summary.top_missed_memories[0]?.id, "mA");
  assert.equal(summary.top_missed_memories[0]?.count, 3);
  assert.equal(summary.top_missed_memories[1]?.count, 1);
  assert.ok(summary.top_missed_memories[0]?.category);
  assert.ok(summary.top_missed_memories[0]?.source_type);
  assert.ok(summary.top_missed_memories[0]?.path);
});

