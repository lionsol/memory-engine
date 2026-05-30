import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReinforcementConcentrationSummary,
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
  category,
  sourceType,
  path,
  chunkId,
  createdAt = IN_WINDOW,
} = {}) {
  const metadata = {};
  if (rank !== undefined) metadata.rank = rank;
  if (category !== undefined) metadata.category = category;
  if (sourceType !== undefined) metadata.source_type = sourceType;
  if (path !== undefined) metadata.path = path;
  if (chunkId !== undefined) metadata.chunk_id = chunkId;
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

test("reinforcement concentration: empty data returns zero summary", () => {
  const summary = buildReinforcementConcentrationSummary([], { windowDays: 7, topN: 10, nowMs: NOW_MS });
  assert.equal(summary.total_references, 0);
  assert.equal(summary.unique_memories, 0);
  assert.equal(summary.hhi, 0);
  assert.equal(summary.top1_share, 0);
  assert.equal(summary.top5_share, 0);
  assert.equal(summary.top10_share, 0);
});

test("reinforcement concentration: single memory monopoly yields top1=1 and hhi=1", () => {
  const rows = [
    candidateRow({ id: 1, traceId: "t1", rank: 1, memoryId: "m1" }),
    candidateRow({ id: 2, traceId: "t1", rank: 2, memoryId: "m1" }),
    candidateRow({ id: 3, traceId: "t2", rank: 1, memoryId: "m1" }),
  ];
  const summary = buildReinforcementConcentrationSummary(rows, { windowDays: 7, topN: 10, nowMs: NOW_MS });
  assert.equal(summary.total_references, 3);
  assert.equal(summary.unique_memories, 1);
  assert.equal(summary.top1_share, 1);
  assert.equal(summary.hhi, 1);
});

test("reinforcement concentration: uniform distribution has low hhi", () => {
  const rows = Array.from({ length: 10 }, (_, i) => candidateRow({
    id: i + 1,
    traceId: "t1",
    rank: i + 1,
    memoryId: `m${i + 1}`,
  }));
  const summary = buildReinforcementConcentrationSummary(rows, { windowDays: 7, topN: 10, nowMs: NOW_MS });
  assert.equal(summary.unique_memories, 10);
  assert.ok(summary.hhi < 0.2);
});

test("reinforcement concentration: top5_share is computed correctly", () => {
  const rows = [
    candidateRow({ id: 1, traceId: "t1", rank: 1, memoryId: "m1" }),
    candidateRow({ id: 2, traceId: "t1", rank: 2, memoryId: "m1" }),
    candidateRow({ id: 3, traceId: "t1", rank: 3, memoryId: "m2" }),
    candidateRow({ id: 4, traceId: "t1", rank: 4, memoryId: "m3" }),
    candidateRow({ id: 5, traceId: "t1", rank: 5, memoryId: "m4" }),
    candidateRow({ id: 6, traceId: "t1", rank: 6, memoryId: "m5" }),
    candidateRow({ id: 7, traceId: "t1", rank: 7, memoryId: "m6" }),
  ];
  const summary = buildReinforcementConcentrationSummary(rows, { windowDays: 7, topN: 10, nowMs: NOW_MS });
  assert.equal(summary.total_references, 7);
  assert.equal(summary.top5_share, 0.8571);
});

test("reinforcement concentration: top10_share is computed correctly", () => {
  const rows = Array.from({ length: 20 }, (_, i) => candidateRow({
    id: i + 1,
    traceId: "t1",
    rank: i + 1,
    memoryId: `m${i + 1}`,
  }));
  const summary = buildReinforcementConcentrationSummary(rows, { windowDays: 7, topN: 20, nowMs: NOW_MS });
  assert.equal(summary.top10_share, 0.5);
});

test("reinforcement concentration: windowDays excludes old events", () => {
  const rows = [
    candidateRow({ id: 1, traceId: "t1", rank: 1, memoryId: "m1", createdAt: IN_WINDOW }),
    candidateRow({ id: 2, traceId: "t1", rank: 2, memoryId: "m2", createdAt: OUT_WINDOW }),
  ];
  const summary = buildReinforcementConcentrationSummary(rows, { windowDays: 7, topN: 10, nowMs: NOW_MS });
  assert.equal(summary.total_references, 1);
  assert.equal(summary.unique_memories, 1);
});

test("reinforcement concentration: topN limits entries per recall", () => {
  const rows = [
    candidateRow({ id: 1, traceId: "t1", rank: 1, memoryId: "m1" }),
    candidateRow({ id: 2, traceId: "t1", rank: 2, memoryId: "m2" }),
    candidateRow({ id: 3, traceId: "t1", rank: 3, memoryId: "m3" }),
    candidateRow({ id: 4, traceId: "t2", rank: 1, memoryId: "m1" }),
    candidateRow({ id: 5, traceId: "t2", rank: 2, memoryId: "m2" }),
    candidateRow({ id: 6, traceId: "t2", rank: 3, memoryId: "m3" }),
  ];
  const summary = buildReinforcementConcentrationSummary(rows, { windowDays: 7, topN: 2, nowMs: NOW_MS });
  assert.equal(summary.total_references, 4);
  assert.equal(summary.distribution.m3, undefined);
});

test("memory id fallback order: memory_id -> chunk_id -> path -> unknown", () => {
  assert.equal(resolveMemoryReferenceId({ memory_id: "m1" }, { chunk_id: "c1", path: "memory/a.md" }), "m1");
  assert.equal(resolveMemoryReferenceId({ memory_id: "" }, { chunk_id: "c1", path: "memory/a.md" }), "c1");
  assert.equal(resolveMemoryReferenceId({ memory_id: "" }, { chunk_id: "", path: "memory/a.md" }), "memory/a.md");
  assert.equal(resolveMemoryReferenceId({ memory_id: "" }, { chunk_id: "", path: "" }), "unknown");
});

