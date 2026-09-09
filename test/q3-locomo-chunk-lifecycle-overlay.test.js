import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildLocomoChunkLifecycleOverlay,
  writeLocomoChunkLifecycleOverlay,
} from "../lib/benchmark/locomo-chunk-lifecycle-overlay.js";
import { validateLocomoChunkCanonicalMapping } from "../lib/benchmark/locomo-chunk-candidate-builder.js";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function materialChunk({ id, sampleId = "conv-test", text = `${id} text`, position = "exact" }) {
  const hash = sha256(text);
  return {
    sampleId,
    sessionId: "session_1",
    chunkIndex: Number(id.replace("chunk-", "")),
    memoryId: id,
    text,
    hash,
    startLine: 1,
    endLine: 1,
    source: {
      system: "openclaw_core",
      recordType: "chunk",
      recordId: id,
      path: `memory/q3-locomo-v1.2/locomo/${sampleId}/session_1.md`,
      coreSource: "memory",
      lineStart: 1,
      lineEnd: 1,
      text,
      coreHash: hash,
    },
    position: { status: position },
  };
}

function identity() {
  return {
    dataset_sha256: "1".repeat(64),
    chunk_material_manifest_sha256: "2".repeat(64),
    chunks_sha256: "3".repeat(64),
    chunks_path: "/isolated/material/chunks.jsonl",
    manifest_path: "/isolated/material/manifest.json",
  };
}

test("overlay is experimental, one-to-one, and uses nullable external lifecycle state", () => {
  const materialChunks = [
    materialChunk({ id: "chunk-0", sampleId: "conv-a" }),
    materialChunk({ id: "chunk-1", sampleId: "conv-b", position: "unknown" }),
  ];
  const overlay = buildLocomoChunkLifecycleOverlay({ materialChunks, materialIdentity: identity() });
  assert.equal(overlay.status, "experimental");
  assert.equal(overlay.productionEquivalent, false);
  assert.equal(overlay.provider_calls, 0);
  assert.equal(overlay.retrieval_runs, 0);
  assert.equal(overlay.gold_read, false);
  assert.equal(overlay.counts.input_chunk_count, 2);
  assert.equal(overlay.counts.covered_count, 2);
  assert.equal(overlay.counts.rejected_count, 0);
  assert.equal(overlay.counts.one_to_one, true);
  assert.deepEqual(overlay.counts.position_status_counts, { exact: 1, unknown: 1 });
  for (const memory of overlay.memories) {
    assert.equal(memory.lifecycle.management, "external");
    assert.equal(memory.lifecycle.category, null);
    assert.equal(memory.lifecycle.confidence, null);
    assert.equal(memory.lifecycle.archived, null);
    assert.equal(memory.lifecycle.protected, null);
    assert.equal(memory.lifecycle.conflict, null);
    assert.equal(memory.source.updated_at, null);
    assert.equal(memory.source.text, materialChunks.find(row => row.memoryId === memory.memory_id).text);
  }
  assert.equal(overlay.filtering_impact.excluded_count, 0);
  assert.equal(overlay.filtering_impact.eligible_before_query_count, 2);
  assert.equal(overlay.sorting_impact.lifecycle_dependent_differential_count, 0);
  assert.equal(overlay.sorting_impact.uniform_overlay_terms.confidence_boost, 0);
  assert.equal(overlay.sorting_impact.uniform_overlay_terms.recency_boost, 0);
});

test("overlay writer publishes an external hash list and does not perform retrieval", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "q3-locomo-lifecycle-overlay-test-"));
  try {
    const result = writeLocomoChunkLifecycleOverlay({
      materialChunks: [materialChunk({ id: "chunk-0" })],
      materialIdentity: identity(),
      outputDir,
    });
    assert.match(readFileSync(result.checksumsPath, "utf8"), /canonical-lifecycle-overlay\.json/);
    assert.doesNotMatch(readFileSync(result.checksumsPath, "utf8"), /SHA256SUMS/);
    assert.equal(result.report.overlay_sha256, result.overlaySha256);
    assert.equal(JSON.parse(readFileSync(result.reportPath, "utf8")).retrieval_runs, 0);
    assert.equal(existsSync(join(outputDir, "fts-index.sqlite")), false);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("overlay rejects incomplete source material and builder mapping remains strict one-to-one", () => {
  const materialChunks = [materialChunk({ id: "chunk-0" }), materialChunk({ id: "chunk-1" })];
  const malformed = materialChunks.map(row => ({ ...row, source: { ...row.source, text: "wrong" } }));
  assert.throws(
    () => buildLocomoChunkLifecycleOverlay({ materialChunks: malformed, materialIdentity: identity() }),
    /source_text_mismatch/,
  );
  const overlay = buildLocomoChunkLifecycleOverlay({ materialChunks, materialIdentity: identity() });
  assert.throws(
    () => validateLocomoChunkCanonicalMapping({
      materialChunks,
      canonicalMemories: overlay.memories.slice(0, 1),
    }),
    /material_canonical_mapping_missing/,
  );
});
